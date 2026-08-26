//! MQTT reconciler: one master switch driving the broker and the bridge that
//! needs it, and the broker's runtime configuration rendered from `mqtt`.
//!
//! Two system effects, in this order:
//!
//! 1. `/run/mos/mqtt-broker.toml` is rendered from `mqtt.listen` and
//!    `mqtt.auth` — the three keys the `mos-mqtt-broker` binary parses.
//! 2. `mos-mqtt-broker.service` and `mos-mqttd.service` are brought to the
//!    state `mqtt.enabled` asks for.
//!
//! Configuration before service start, deliberately and for the same reason
//! `sshd.rs` renders before it starts: a broker started against a stale config
//! is listening on the wrong address, and nothing about that is visible from
//! the unit's state.
//!
//! **The config is rendered whether or not the switch is on.** The file on
//! disk then always describes what the switch *would* start, so turning it on
//! takes effect on that reconcile rather than waiting for a second one. It
//! lives on `/run`, so an unconditional render costs no flash write.
//!
//! **`mqtt.enabled` is a master switch and nothing else** (see
//! [`mosd_settings::MqttSettings`]). False means neither unit runs. It
//! validates nothing and depends on nothing below it: no combination of
//! `listen` and `auth` makes it mean anything other than "run both" or "run
//! neither".
//!
//! **Order is opposite on the way up and on the way down.** Starting: broker
//! then bridge, because the bridge is a client of the broker and starting the
//! client first buys nothing but a round of the bridge's own retry. Stopping:
//! bridge then broker, because stopping the server out from under its client
//! is how you get a client logging connection failures about a shutdown that
//! was deliberate.

use std::path::PathBuf;

use anyhow::{Context, Result};
use mosd_settings::{MqttSettings, Settings};
use serde_json::json;

use super::Reconciler;
use super::systemd::{Systemd, UnitControl, is_active, is_enabled};
use crate::fswrite::write_config;

/// Unit implementing the MQTT broker (rumqttd, used as a library).
const BROKER_UNIT: &str = "mos-mqtt-broker.service";
/// Unit implementing the bridge from the broker to the cloud. Predates this
/// reconciler; unchanged by it apart from who starts and stops it.
const BRIDGE_UNIT: &str = "mos-mqttd.service";
/// Config the broker binary reads, rendered by mosd at runtime.
///
/// On `/run`, not on STATE: it is derived entirely from the settings tree and
/// is re-rendered on every boot before the broker starts, so persisting it
/// would only create a second copy of the truth that could disagree with the
/// first.
const DEFAULT_CONFIG_PATH: &str = "/run/mos/mqtt-broker.toml";
/// Environment variable overriding the rendered config path.
///
/// Nothing in the image sets it; the override exists so tests run entirely
/// inside a temporary directory and never touch the host's `/run`.
const CONFIG_PATH_ENV: &str = "MOSD_MQTT_BROKER_CONFIG";
/// Mode of the rendered config: world-readable, owner-writable.
///
/// The broker runs as the unprivileged `mos-mqtt-broker` account and mosd
/// writes this file as root, so it has to be readable by somebody other than
/// its owner. It carries no secret — credentials live in the STATE-backed
/// `/var/lib/mos/mqtt-broker-users.toml`, precisely so that this file does
/// not need to be protected.
const CONFIG_MODE: u32 = 0o644;
/// `ActiveState` of a unit systemd has given up on.
///
/// Worth naming because it is not merely "down": it is the state in which a
/// unit that has exhausted its start limit REFUSES further start jobs, which
/// is what [`MqttReconciler::turn_broker_on`] has to clear before it can start
/// anything. `systemd::is_active` deliberately does not distinguish it from
/// `inactive` -- for "should I start this?" they are the same answer, and only
/// this reconciler needs the difference.
const FAILED_STATE: &str = "failed";

/// Reconciler for the `mqtt` settings subtree.
pub struct MqttReconciler<C: UnitControl> {
    /// Path the broker config is rendered to.
    config_path: PathBuf,
    control: C,
}

impl<C: UnitControl> MqttReconciler<C> {
    /// Create an MQTT reconciler rendering the broker config to `config_path`
    /// and driving both units through `control`.
    ///
    /// The path is a parameter so tests run entirely inside a temporary
    /// directory and never touch the host's `/run`.
    pub fn new(config_path: PathBuf, control: C) -> Self {
        Self {
            config_path,
            control,
        }
    }
}

impl MqttReconciler<Systemd> {
    /// Production reconciler: config path from [`CONFIG_PATH_ENV`] if set,
    /// else [`DEFAULT_CONFIG_PATH`].
    pub fn production() -> Self {
        let config_path = std::env::var(CONFIG_PATH_ENV)
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_CONFIG_PATH));
        Self::new(config_path, Systemd)
    }
}

/// How `mqtt.listen.address` reads to the broker.
///
/// Three states rather than a single "is it loopback" predicate, because the
/// two things worth warning about are different things and their messages
/// contradict each other. An address that does not parse is not a wide bind —
/// it is not a bind at all, and telling the operator it "accepts connections
/// from the network" would be false. Matching on this makes the two warnings
/// in [`MqttReconciler::apply`] mutually exclusive by construction rather than
/// by the order two `if`s happen to be written in.
#[derive(Debug, PartialEq, Eq)]
enum ListenAddress {
    /// Parses as an `IpAddr` and is loopback: reachable only from the device.
    Loopback,
    /// Parses as an `IpAddr` and is not loopback: reachable from the network.
    OffHost,
    /// Does not parse as an `IpAddr`.
    ///
    /// `mos-mqtt-broker` parses `listen_address` as an `IpAddr` and does not
    /// resolve names, so a value like `"localhost"` is a startup error and the
    /// process exits. Nothing here refuses anything for it — see
    /// [`MqttReconciler::apply`].
    Unparseable,
}

/// Classify `address` for the warnings in [`MqttReconciler::apply`].
///
/// Pure: it decides what to say, never whether to act.
fn classify_listen_address(address: &str) -> ListenAddress {
    match address.parse::<std::net::IpAddr>() {
        Ok(ip) if ip.is_loopback() => ListenAddress::Loopback,
        Ok(_) => ListenAddress::OffHost,
        Err(_) => ListenAddress::Unparseable,
    }
}

/// Render the broker config for `mqtt`.
///
/// Pure and deterministic: the same settings always produce the same bytes, so
/// a re-render can be compared against what is on disk to decide whether
/// anything actually changed — which is what tells [`MqttReconciler::apply`]
/// whether a running broker has to be restarted.
///
/// Three keys and no more, and all three always present: the broker's parser
/// requires exactly `listen_address`, `listen_port` and `auth_enabled`.
/// `mqtt.enabled` is deliberately absent -- it decides whether the broker RUNS,
/// which is a question about the unit and not one the broker process could act
/// on after it has already been started.
///
/// **The address is written verbatim, whatever it says.** No default is
/// substituted and no value is "corrected", not even one that cannot parse as
/// an `IpAddr`: a config file that disagrees with the settings tree is worse
/// than one the broker rejects loudly, because the operator then cannot tell
/// why the device is listening somewhere they did not ask for. An address the
/// broker cannot parse gets a WARN from [`MqttReconciler::apply`] and a failed
/// unit, both of which name it.
fn render_config(mqtt: &MqttSettings) -> String {
    let mut out = String::new();
    out.push_str(&format!("listen_address = \"{}\"\n", mqtt.listen.address));
    out.push_str(&format!("listen_port = {}\n", mqtt.listen.port));
    out.push_str(&format!("auth_enabled = {}\n", mqtt.auth.enabled));
    out
}

impl<C: UnitControl> MqttReconciler<C> {
    /// Render the broker config and report whether its bytes changed.
    ///
    /// An unchanged render is not rewritten. The file is on `/run` so the
    /// write itself is cheap, but "did the bytes change" is the signal that
    /// decides whether a running broker is restarted, and re-deriving it from
    /// the file's mtime rather than its contents would restart the broker on
    /// every reconcile.
    fn apply_config(&self, mqtt: &MqttSettings) -> Result<bool> {
        let rendered = render_config(mqtt);
        if let Ok(current) = std::fs::read_to_string(&self.config_path)
            && current == rendered
        {
            return Ok(false);
        }
        if let Some(directory) = self.config_path.parent() {
            std::fs::create_dir_all(directory)
                .with_context(|| format!("create {}", directory.display()))?;
        }
        write_config(&self.config_path, &rendered, CONFIG_MODE)
            .with_context(|| format!("render {}", self.config_path.display()))?;
        Ok(true)
    }

    /// Start `unit`, and on failure WARN instead of failing the reconcile.
    ///
    /// **`mqtt.enabled` is a master switch, and a switch that cannot be turned
    /// on is not a reason to fail everything it switches.** `apply` covers the
    /// whole `mqtt` subtree, so an `Err` from a start makes the reconcile of
    /// `mqtt.enabled` itself depend on a unit being startable -- which in
    /// practice means depending on `mqtt.listen` being valid. That is the
    /// coupling this reconciler does not have, and the module docs and
    /// [`mosd_settings::MqttSettings`] both say so.
    ///
    /// The refusal is REACHABLE, not theoretical. `mos-mqtt-broker.service`
    /// carries `StartLimitIntervalSec=60` / `StartLimitBurst=5`, so a broker
    /// that fails for a persistent reason -- an unparseable
    /// `mqtt.listen.address` is the one this reconciler renders verbatim and
    /// refuses to correct -- exhausts five attempts in about 25 seconds, and
    /// systemd then rejects every start job for the rest of that minute.
    ///
    /// And it is worse than one operator seeing one error, because reconcilers
    /// run together: an unrelated settings write -- a hostname change, a WiFi
    /// edit -- would fail on a broker in cool-off that has nothing to do with
    /// the change being made.
    ///
    /// **Nothing is hidden by this.** The WARN names the unit and the error,
    /// and the live state below publishes each unit's `activeState`, which the
    /// apid MQTT pane already renders as a failed broker pointing the operator
    /// at `journalctl -u mos-mqtt-broker`. Report, do not gate.
    ///
    /// Start only. The stop and disable path keeps propagating its errors: a
    /// unit that will not stop is not something a start limit causes, and
    /// `mqtt.enabled = false` that silently left a broker listening is a
    /// failure worth failing on.
    async fn start_or_warn(&self, unit: &str) {
        if let Err(error) = self.control.start(unit).await {
            tracing::warn!(
                unit,
                %error,
                "mqtt: the unit refused to start; mqtt.enabled stays applied and the unit's real \
                 state is published as it is"
            );
        }
    }

    /// Clear `unit`'s failed state so the start after it is not refused.
    ///
    /// Warns rather than propagating, for the same reason
    /// [`MqttReconciler::start_or_warn`] does: this call exists only on the
    /// way up, and a bus failure here would fail the reconcile of
    /// `mqtt.enabled` over a broker that is already broken. Continuing costs
    /// nothing -- the start below is attempted either way, and if it is
    /// refused it warns in its own right.
    async fn reset_failed_or_warn(&self, unit: &str) {
        if let Err(error) = self.control.reset_failed(unit).await {
            tracing::warn!(
                unit,
                %error,
                "mqtt: could not clear the unit's failed state; a start may be refused until its \
                 start-limit window elapses"
            );
        }
    }

    /// Bring the broker up, restarting it when the config it is running
    /// against has been rewritten.
    ///
    /// **`restart`, not `reload`.** The broker is rumqttd used as a library and
    /// its unit carries no `ExecReload`; `systemd.rs` documents that `reload`
    /// fails rather than falling back to a restart, which is the right
    /// behaviour for a caller that chose reload deliberately for its
    /// session-preserving property (sshd does) and the wrong call here — it
    /// would turn every config change into an error and leave the broker
    /// listening on the old address. A broker restart drops MQTT sessions, and
    /// the bridge reconnects; that is a cost this unit can pay and sshd's
    /// cannot.
    ///
    /// Reads before it writes, so a broker already in the target state and
    /// running against the current config gets no calls at all.
    async fn turn_broker_on(&self, config_changed: bool) -> Result<()> {
        if !is_enabled(&self.control.unit_file_state(BROKER_UNIT).await?) {
            self.control.enable(BROKER_UNIT).await?;
        }
        let active_state = self.control.active_state(BROKER_UNIT).await?;
        if is_active(&active_state) {
            if config_changed {
                self.control.restart(BROKER_UNIT).await?;
            }
        } else {
            // A FAILED broker may be inside its start-limit window, and inside
            // it systemd refuses start jobs outright. Clear the failure first,
            // so an operator who has just corrected the address gets a broker
            // that comes up on THIS apply -- rather than one that stays down
            // until the minute expires and something else happens to trigger
            // another reconcile, with nothing anywhere saying they have to save
            // twice and wait.
            //
            // Guarded on the state and not issued unconditionally. It would be
            // harmless -- `reset-failed` on a healthy unit does nothing -- but
            // a call log that shows it on every apply stops distinguishing the
            // broker that needed rescuing from the one that did not.
            //
            // Broker only. The bridge carries no StartLimit override, so it
            // inherits systemd's 10-second default, which at its RestartSec=5
            // fits about two attempts and so cannot reach the limit at all.
            // The broker's 60-second interval is what makes it reachable
            // there.
            if active_state == FAILED_STATE {
                self.reset_failed_or_warn(BROKER_UNIT).await;
            }
            // Not running: start it. A restart here would work too, but
            // starting says what is meant, and a broker that is down is not
            // running a stale config — it is running none.
            self.start_or_warn(BROKER_UNIT).await;
        }
        Ok(())
    }

    /// Bring the bridge up.
    ///
    /// No config concern: the bridge reads its own settings subtree, which this
    /// reconciler does not render, so a broker config change is nothing to it
    /// beyond a reconnect its retry loop already handles.
    async fn turn_bridge_on(&self) -> Result<()> {
        if !is_enabled(&self.control.unit_file_state(BRIDGE_UNIT).await?) {
            self.control.enable(BRIDGE_UNIT).await?;
        }
        if !is_active(&self.control.active_state(BRIDGE_UNIT).await?) {
            self.start_or_warn(BRIDGE_UNIT).await;
        }
        Ok(())
    }

    /// Stop and disable `unit` if it is not already down.
    async fn turn_unit_off(&self, unit: &str) -> Result<()> {
        if is_active(&self.control.active_state(unit).await?) {
            self.control.stop(unit).await?;
        }
        if is_enabled(&self.control.unit_file_state(unit).await?) {
            self.control.disable(unit).await?;
        }
        Ok(())
    }

    /// Live state of `unit`, read after the transition so what is published is
    /// what the system now is rather than what it was asked to become.
    async fn unit_state(&self, unit: &str) -> Result<serde_json::Value> {
        Ok(json!({
            "unit": unit,
            "activeState": self.control.active_state(unit).await?,
            "unitFileState": self.control.unit_file_state(unit).await?,
        }))
    }
}

#[async_trait::async_trait]
impl<C: UnitControl> Reconciler for MqttReconciler<C> {
    fn name(&self) -> &'static str {
        "mqtt"
    }

    fn subtree(&self) -> &'static str {
        "mqtt"
    }

    async fn apply(&self, settings: &Settings) -> Result<serde_json::Value> {
        let mqtt = &settings.mqtt;

        // Unconditionally, and before any unit is touched: the file then
        // describes what the switch would start even while it is off, and a
        // broker is never started against a config older than the settings
        // that were just applied.
        //
        // The ordering is load-bearing in a way that fails SILENTLY if it is
        // ever reversed. The broker unit carries
        // `ConditionPathExists=/run/mos/mqtt-broker.toml`, so with the file
        // absent systemd does not fail the start -- it skips it, and the unit
        // reads as perfectly healthy having never run. Do not move this below
        // the unit calls.
        let config_changed = self.apply_config(mqtt)?;

        if mqtt.enabled {
            // WARNs, and deliberately NOT gates. Neither of these may become a
            // refusal, and neither may skip a unit. An operator who widened the
            // bind made a decision; a daemon that answers it by quietly not
            // starting is a daemon whose reason for being down cannot be read
            // anywhere. `listen`/`auth` are deliberately not coupled to the
            // master switch -- see the doc comment on
            // `mosd_settings::MqttSettings`.
            //
            // Returning `Err` here would be that same rejected coupling wearing
            // a different hat: `apply` covers the WHOLE `mqtt` subtree, so an
            // error raised over `listen` fails the reconcile of `mqtt.enabled`
            // itself and makes the master switch depend on `listen` being
            // valid. This is deliberately a different rule from
            // `SshdReconciler`, which does reject an unparseable
            // `ListenAddress` -- sshd has one key, `access.ssh.enabled`, and no
            // separate switch to protect.
            match classify_listen_address(&mqtt.listen.address) {
                // Not a wide bind -- not a bind at all. The config is rendered
                // verbatim anyway (see `apply_config`), the unit is started
                // anyway, and the broker exits with a parse error naming the
                // file and the value. That lands the unit in `failed`, which
                // the `units` array below reports, so the operator reads the
                // real cause in one place instead of two half-causes.
                ListenAddress::Unparseable => tracing::warn!(
                    address = %mqtt.listen.address,
                    "mqtt: listen address is not an IP address; the broker does not resolve names \
                     and will refuse to start against it"
                ),
                ListenAddress::OffHost if !mqtt.auth.enabled => tracing::warn!(
                    address = %mqtt.listen.address,
                    port = mqtt.listen.port,
                    "mqtt: the broker is bound off-host with authentication disabled; it accepts \
                     unauthenticated connections from the network"
                ),
                ListenAddress::Loopback | ListenAddress::OffHost => {}
            }
            // Broker first: the bridge is its client.
            self.turn_broker_on(config_changed).await?;
            self.turn_bridge_on().await?;
        } else {
            // Bridge first, the reverse of start: the client goes before the
            // server it talks to, so a deliberate shutdown does not read as a
            // connection failure in the bridge's journal.
            self.turn_unit_off(BRIDGE_UNIT).await?;
            self.turn_unit_off(BROKER_UNIT).await?;
        }

        // The shape below is a contract with a consumer in another crate:
        // `mosd/apid/src/routes.rs` renders the MQTT pane by reading these
        // keys by name out of the bus item this becomes. Nothing in the type
        // system connects the two -- apid talks to mosd over the bus -- so
        // `the_published_shape_is_the_contract_with_the_apid_pane` below
        // asserts the exact key set, and changing a key here means changing
        // the pane. Skipping that does not break loudly: the pane renders
        // "unknown", keeps its 200, and the warning it exists to raise
        // silently never fires again.
        Ok(json!({
            "enabled": mqtt.enabled,
            "listen": {
                "address": mqtt.listen.address,
                "port": mqtt.listen.port,
            },
            "auth": {
                // Policy only. There is no credential in the settings tree to
                // publish -- the broker's accounts live on STATE.
                "enabled": mqtt.auth.enabled,
            },
            "configPath": self.config_path.display().to_string(),
            "units": [
                self.unit_state(BROKER_UNIT).await?,
                self.unit_state(BRIDGE_UNIT).await?,
            ],
        }))
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use mosd_settings::{MqttAuthSettings, MqttListenSettings};

    use super::super::systemd::mock::MockUnitControl;
    use super::*;

    /// What `apply` renders for default `mqtt` settings.
    const GOLDEN_DEFAULTS: &str =
        "listen_address = \"127.0.0.1\"\nlisten_port = 1883\nauth_enabled = false\n";

    fn mqtt_settings(enabled: bool, address: &str, port: u16, auth: bool) -> MqttSettings {
        MqttSettings {
            enabled,
            listen: MqttListenSettings {
                address: address.to_string(),
                port,
            },
            auth: MqttAuthSettings { enabled: auth },
        }
    }

    fn settings_with(mqtt: MqttSettings) -> Settings {
        Settings {
            mqtt,
            ..Settings::default()
        }
    }

    /// The two above composed, because every unit test names all four values
    /// and nothing else in the tree.
    fn settings(enabled: bool, address: &str, port: u16, auth: bool) -> Settings {
        settings_with(mqtt_settings(enabled, address, port, auth))
    }

    /// Reconciler rendering into a directory that does not exist yet, so every
    /// test also proves the parent is created, and driving both units through
    /// a mock starting at `active`/`file_state`.
    fn fixture(
        dir: &Path,
        active: &str,
        file_state: &str,
    ) -> (MqttReconciler<MockUnitControl>, PathBuf) {
        let config = dir.join("mos").join("mqtt-broker.toml");
        (
            MqttReconciler::new(config.clone(), MockUnitControl::new(active, file_state)),
            config,
        )
    }

    #[tokio::test]
    async fn disabled_to_enabled_starts_the_broker_before_the_bridge() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _config) = fixture(dir.path(), "inactive", "disabled");

        reconciler
            .apply(&settings(true, "127.0.0.1", 1883, false))
            .await
            .unwrap();

        assert_eq!(
            reconciler.control.calls(),
            vec![
                "enable mos-mqtt-broker.service".to_string(),
                "start mos-mqtt-broker.service".to_string(),
                "enable mos-mqttd.service".to_string(),
                "start mos-mqttd.service".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn enabled_to_disabled_stops_the_bridge_before_the_broker() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _config) = fixture(dir.path(), "active", "enabled");

        reconciler
            .apply(&settings(false, "127.0.0.1", 1883, false))
            .await
            .unwrap();

        assert_eq!(
            reconciler.control.calls(),
            vec![
                "stop mos-mqttd.service".to_string(),
                "disable mos-mqttd.service".to_string(),
                "stop mos-mqtt-broker.service".to_string(),
                "disable mos-mqtt-broker.service".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn a_second_apply_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _config) = fixture(dir.path(), "inactive", "disabled");
        let unchanged = settings(true, "127.0.0.1", 1883, false);

        reconciler.apply(&unchanged).await.unwrap();
        let after_first = reconciler.control.calls();
        reconciler.apply(&unchanged).await.unwrap();

        assert_eq!(
            reconciler.control.calls(),
            after_first,
            "a repeated apply against an unchanged system must issue no calls"
        );
    }

    #[tokio::test]
    async fn a_changed_listen_config_restarts_the_running_broker() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _config) = fixture(dir.path(), "inactive", "disabled");

        reconciler
            .apply(&settings(true, "127.0.0.1", 1883, false))
            .await
            .unwrap();
        let after_first = reconciler.control.calls().len();
        reconciler
            .apply(&settings(true, "127.0.0.1", 1884, false))
            .await
            .unwrap();

        // Restarted, not reloaded: the unit carries no ExecReload. And only the
        // broker -- the bridge does not read this config.
        assert_eq!(
            reconciler.control.calls()[after_first..],
            ["restart mos-mqtt-broker.service".to_string()]
        );
    }

    /// There is deliberately no gate here -- nothing refuses to start a
    /// broker bound off-host with authentication disabled. `mqtt.enabled` is a
    /// master switch and nothing else; `listen` and `auth` are a separate
    /// configuration that nothing may refuse to start on. The warning in
    /// `apply` is the whole of the response. Do not delete this test in order
    /// to add the gate.
    #[tokio::test]
    async fn off_host_without_auth_still_starts() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _config) = fixture(dir.path(), "inactive", "disabled");

        let state = reconciler
            .apply(&settings(true, "0.0.0.0", 1883, false))
            .await
            .expect("an off-host bind without auth warns; it must never fail");

        assert_eq!(
            reconciler.control.calls(),
            vec![
                "enable mos-mqtt-broker.service".to_string(),
                "start mos-mqtt-broker.service".to_string(),
                "enable mos-mqttd.service".to_string(),
                "start mos-mqttd.service".to_string(),
            ]
        );
        assert_eq!(state["enabled"], serde_json::json!(true));
    }

    /// The other half of the StartLimit amendment. `mos-mqtt-broker.service`
    /// carries `StartLimitIntervalSec=60` / `StartLimitBurst=5`, and inside
    /// that window systemd REFUSES start jobs on a unit that has exhausted its
    /// burst. Converging by "not active, so start it" therefore issues a start
    /// that cannot succeed, and the operator who has just fixed the address
    /// would have to save again after the minute expired -- with nothing
    /// telling them so.
    #[tokio::test]
    async fn a_failed_broker_is_reset_before_it_is_started() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _config) = fixture(dir.path(), "inactive", "enabled");
        reconciler.control.set_active_state(BROKER_UNIT, "failed");

        reconciler
            .apply(&settings(true, "127.0.0.1", 1883, false))
            .await
            .unwrap();

        // ORDER is the assertion: a reset AFTER the start would clear the
        // failure and leave the broker still down.
        assert_eq!(
            reconciler.control.calls(),
            vec![
                "reset-failed mos-mqtt-broker.service".to_string(),
                "start mos-mqtt-broker.service".to_string(),
                "start mos-mqttd.service".to_string(),
            ]
        );
    }

    /// No wasted call on the healthy path, and -- more to the point -- a call
    /// log in which `reset-failed` means something. Issued on every apply it
    /// would stop distinguishing the broker that needed rescuing from the one
    /// that never failed.
    #[tokio::test]
    async fn a_broker_that_is_not_failed_is_not_reset() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _config) = fixture(dir.path(), "inactive", "disabled");

        reconciler
            .apply(&settings(true, "127.0.0.1", 1883, false))
            .await
            .unwrap();

        assert_eq!(
            reconciler.control.calls(),
            vec![
                "enable mos-mqtt-broker.service".to_string(),
                "start mos-mqtt-broker.service".to_string(),
                "enable mos-mqttd.service".to_string(),
                "start mos-mqttd.service".to_string(),
            ],
            "a broker that never failed must not be reset-failed"
        );
    }

    /// A start systemd REFUSES must not fail the reconcile. `apply` covers the
    /// whole `mqtt` subtree, so an `Err` here fails `mqtt.enabled` itself over
    /// a unit in start-limit cool-off -- the same coupling that
    /// `an_address_that_cannot_parse_still_starts_both_units` exists to
    /// forbid, arriving one step later. Worse, reconcilers run together: an
    /// unrelated hostname or WiFi write would fail on a broker in cool-off that
    /// has nothing to do with it. Do not "fix" this into an `Err`.
    #[tokio::test]
    async fn a_refused_broker_start_does_not_fail_the_reconcile() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _config) = fixture(dir.path(), "inactive", "enabled");
        reconciler.control.refuse_start(BROKER_UNIT);

        let state = reconciler
            .apply(&settings(true, "127.0.0.1", 1883, false))
            .await
            .expect("a refused start warns; it must never fail the reconcile");

        // The bridge is still driven: the broker's refusal must not abort the
        // rest of the subtree's convergence either.
        assert_eq!(
            reconciler.control.calls(),
            vec![
                "start mos-mqtt-broker.service".to_string(),
                "start mos-mqttd.service".to_string(),
            ]
        );
        // And the failure is REPORTED rather than hidden. Both units are still
        // in the published state, and the broker's `activeState` is what it
        // really is -- which is what the apid pane renders and points at
        // `journalctl -u mos-mqtt-broker`.
        assert_eq!(
            state["units"],
            json!([
                {
                    "unit": "mos-mqtt-broker.service",
                    "activeState": "inactive",
                    "unitFileState": "enabled",
                },
                {
                    "unit": "mos-mqttd.service",
                    "activeState": "active",
                    "unitFileState": "enabled",
                },
            ])
        );
    }

    /// The bridge gets the same treatment as the broker, for the same reason:
    /// `mqtt.enabled` is one switch over two units, and neither of them being
    /// startable is a reason to fail the switch.
    #[tokio::test]
    async fn a_refused_bridge_start_does_not_fail_the_reconcile_either() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _config) = fixture(dir.path(), "inactive", "enabled");
        reconciler.control.refuse_start(BRIDGE_UNIT);

        let state = reconciler
            .apply(&settings(true, "127.0.0.1", 1883, false))
            .await
            .expect("a refused bridge start warns; it must never fail the reconcile");

        assert_eq!(state["enabled"], json!(true));
        assert_eq!(state["units"][0]["activeState"], json!("active"));
        assert_eq!(state["units"][1]["activeState"], json!("inactive"));
    }

    /// Stop and disable keep propagating. A start limit cannot cause them, and
    /// `mqtt.enabled = false` that quietly left a broker listening is a failure
    /// worth failing on -- the leniency above is scoped to the start path and
    /// must not spread.
    #[tokio::test]
    async fn turning_the_switch_off_still_propagates_a_failure() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _config) = fixture(dir.path(), "active", "enabled");
        // Refusing `start` is the only injectable failure, and the off path
        // must never reach it: what this asserts is that turning the switch off
        // issues stops and disables and no start at all, so the `?` on those
        // calls is still the code that runs.
        reconciler.control.refuse_start(BROKER_UNIT);
        reconciler.control.refuse_start(BRIDGE_UNIT);

        reconciler
            .apply(&settings(false, "127.0.0.1", 1883, false))
            .await
            .unwrap();

        let calls = reconciler.control.calls();
        assert!(
            calls.iter().all(|call| !call.starts_with("start ")),
            "the off path must issue no start: {calls:?}"
        );
        assert_eq!(
            calls,
            vec![
                "stop mos-mqttd.service".to_string(),
                "disable mos-mqttd.service".to_string(),
                "stop mos-mqtt-broker.service".to_string(),
                "disable mos-mqtt-broker.service".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn apply_writes_the_golden_config_creating_its_directory() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, config) = fixture(dir.path(), "inactive", "disabled");
        assert!(!config.parent().unwrap().exists());

        reconciler
            .apply(&settings_with(MqttSettings::default()))
            .await
            .unwrap();

        assert!(config.parent().unwrap().is_dir());
        assert_eq!(std::fs::read_to_string(&config).unwrap(), GOLDEN_DEFAULTS);
    }

    #[tokio::test]
    async fn the_config_is_rendered_even_while_the_switch_is_off() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, config) = fixture(dir.path(), "inactive", "disabled");

        reconciler
            .apply(&settings(false, "10.0.0.5", 8883, true))
            .await
            .unwrap();

        // So turning the switch on does not have to wait for a second
        // reconcile to get a config that matches the settings.
        assert_eq!(
            std::fs::read_to_string(&config).unwrap(),
            "listen_address = \"10.0.0.5\"\nlisten_port = 8883\nauth_enabled = true\n"
        );
    }

    #[test]
    fn the_render_is_deterministic() {
        let mqtt = mqtt_settings(true, "10.0.0.5", 8883, true);
        assert_eq!(render_config(&mqtt), render_config(&mqtt));
    }

    #[test]
    fn a_listen_address_is_loopback_off_host_or_not_an_address() {
        use ListenAddress::{Loopback, OffHost, Unparseable};

        assert_eq!(classify_listen_address("127.0.0.1"), Loopback);
        assert_eq!(classify_listen_address("127.0.0.2"), Loopback);
        assert_eq!(classify_listen_address("::1"), Loopback);
        assert_eq!(classify_listen_address("0.0.0.0"), OffHost);
        assert_eq!(classify_listen_address("10.0.0.5"), OffHost);
        assert_eq!(classify_listen_address("::"), OffHost);
        // A name, not an address. The broker does not resolve names, so this
        // is NOT an off-host bind -- it is not a bind at all, and it gets its
        // own warning rather than one claiming the network can reach it.
        assert_eq!(classify_listen_address("localhost"), Unparseable);
        assert_eq!(classify_listen_address(""), Unparseable);
        assert_eq!(classify_listen_address("127.0.0.1:1883"), Unparseable);
    }

    /// An unparseable address must NOT fail the reconcile. `apply` covers the
    /// whole `mqtt` subtree, so an `Err` raised over `listen` would fail the
    /// reconcile of `mqtt.enabled` itself -- making the master switch depend on
    /// `listen` being valid, which is exactly the coupling this reconciler
    /// refuses. The broker is started, exits with its own parse error naming
    /// the file and the value, and lands in `failed` where live state reports
    /// it. Do not "fix" this into an `Err`; that introduces the coupling.
    #[tokio::test]
    async fn an_address_that_cannot_parse_still_starts_both_units() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, config) = fixture(dir.path(), "inactive", "disabled");

        let state = reconciler
            .apply(&settings(true, "localhost", 1883, true))
            .await
            .expect("an unparseable listen address warns; it must never fail the reconcile");

        assert_eq!(
            reconciler.control.calls(),
            vec![
                "enable mos-mqtt-broker.service".to_string(),
                "start mos-mqtt-broker.service".to_string(),
                "enable mos-mqttd.service".to_string(),
                "start mos-mqttd.service".to_string(),
            ]
        );
        // Rendered verbatim: no default substituted, no value corrected.
        assert_eq!(
            std::fs::read_to_string(&config).unwrap(),
            "listen_address = \"localhost\"\nlisten_port = 1883\nauth_enabled = true\n"
        );
        assert_eq!(state["listen"]["address"], json!("localhost"));
    }

    /// The keys of a JSON object, sorted, for an exact-set assertion.
    fn key_set(value: &serde_json::Value) -> Vec<&str> {
        let mut keys: Vec<&str> = value
            .as_object()
            .expect("published live state is an object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        keys
    }

    /// The exact published shape, asserted key by key, because the consumer
    /// is in another crate and cannot be seen from this file.
    ///
    /// That consumer is `mosd/apid/src/routes.rs` -- the MQTT pane, which
    /// reads `listen.address`, `listen.port`, `auth.enabled` and the `units`
    /// entry named `mos-mqtt-broker.service` out of the bus item `apply`
    /// returns. **Changing this shape requires changing the pane.**
    ///
    /// The key SET is asserted and not only the values: a pane written against
    /// a flat shape this reconciler does not publish passes its own tests while
    /// its off-host-without-authentication warning can never fire, because
    /// `auth.enabled` does not arrive where it looks for it. An exact key set
    /// is what makes a rename here fail in a place that names who else cares.
    ///
    /// `mosd/apid/src/tests.rs` carries a verbatim copy of
    /// `live_state_names_both_units_and_the_config_path`'s expectation as its
    /// fixture -- two copies in two crates, but with a named source, so the
    /// copy is auditable.
    #[tokio::test]
    async fn the_published_shape_is_the_contract_with_the_apid_pane() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _config) = fixture(dir.path(), "inactive", "disabled");

        let state = reconciler
            .apply(&settings(true, "10.0.0.5", 8883, true))
            .await
            .unwrap();

        assert_eq!(
            key_set(&state),
            ["auth", "configPath", "enabled", "listen", "units"],
            "the pane reads these top-level keys by name"
        );
        assert_eq!(
            key_set(&state["listen"]),
            ["address", "port"],
            "the pane reads `listen.address` and `listen.port`"
        );
        assert_eq!(
            key_set(&state["auth"]),
            ["enabled"],
            "the pane reads `auth.enabled`; it is what the open-listener warning is gated on"
        );

        let units = state["units"]
            .as_array()
            .expect("`units` is an array -- the pane iterates it");
        assert_eq!(units.len(), 2);
        for unit in units {
            assert_eq!(
                key_set(unit),
                ["activeState", "unit", "unitFileState"],
                "the pane selects a unit by its `unit` field and shows its `activeState`"
            );
        }
        // Both names must be here. The pane selects by name and not by index,
        // so the ORDER is deliberately not part of this assertion -- but the
        // names are, and dropping one would leave that half of the switch
        // reading "unknown" on the page forever.
        let names: Vec<&str> = units
            .iter()
            .map(|unit| unit["unit"].as_str().expect("`unit` is a string"))
            .collect();
        assert!(names.contains(&BROKER_UNIT), "{names:?}");
        assert!(names.contains(&BRIDGE_UNIT), "{names:?}");
    }

    #[tokio::test]
    async fn live_state_names_both_units_and_the_config_path() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, config) = fixture(dir.path(), "inactive", "disabled");

        let state = reconciler
            .apply(&settings(true, "127.0.0.1", 1883, false))
            .await
            .unwrap();

        assert_eq!(state["configPath"], json!(config.display().to_string()));
        assert_eq!(state["listen"]["address"], json!("127.0.0.1"));
        assert_eq!(state["listen"]["port"], json!(1883));
        assert_eq!(state["auth"]["enabled"], json!(false));
        // Read after the transition, so both report what they now are.
        assert_eq!(
            state["units"],
            json!([
                {
                    "unit": "mos-mqtt-broker.service",
                    "activeState": "active",
                    "unitFileState": "enabled-runtime",
                },
                {
                    "unit": "mos-mqttd.service",
                    "activeState": "active",
                    "unitFileState": "enabled-runtime",
                },
            ])
        );
    }
}
