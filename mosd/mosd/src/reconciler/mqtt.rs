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

/// True when `address` is something other than a loopback address.
///
/// An address that does not parse at all counts as off-host: the broker will
/// either fail to bind it or bind something unintended, and both are worth the
/// same warning. Nothing here refuses anything — see [`MqttReconciler::apply`].
fn listens_off_host(address: &str) -> bool {
    !address
        .parse::<std::net::IpAddr>()
        .is_ok_and(|ip| ip.is_loopback())
}

/// Render the broker config for `mqtt`.
///
/// Pure and deterministic: the same settings always produce the same bytes, so
/// a re-render can be compared against what is on disk to decide whether
/// anything actually changed — which is what tells [`MqttReconciler::apply`]
/// whether a running broker has to be restarted.
///
/// Three keys and no more. `mqtt.enabled` is deliberately absent: it decides
/// whether the broker RUNS, which is a question about the unit and not one the
/// broker process could act on after it has already been started.
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
        if is_active(&self.control.active_state(BROKER_UNIT).await?) {
            if config_changed {
                self.control.restart(BROKER_UNIT).await?;
            }
        } else {
            // Not running: start it. A restart here would work too, but
            // starting says what is meant, and a broker that is down is not
            // running a stale config — it is running none.
            self.control.start(BROKER_UNIT).await?;
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
            self.control.start(BRIDGE_UNIT).await?;
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
        let config_changed = self.apply_config(mqtt)?;

        if mqtt.enabled {
            // A WARN, and deliberately NOT a gate. An operator who widened the
            // bind made a decision; a daemon that answers it by quietly not
            // starting is a daemon whose reason for being down cannot be read
            // anywhere. Coupling `listen`/`auth` to the master switch was
            // proposed once and rejected -- see the doc comment on
            // `mosd_settings::MqttSettings`. Do not turn this into a refusal.
            if listens_off_host(&mqtt.listen.address) && !mqtt.auth.enabled {
                tracing::warn!(
                    address = %mqtt.listen.address,
                    port = mqtt.listen.port,
                    "mqtt: the broker is bound off-host with authentication disabled; it accepts \
                     unauthenticated connections from the network"
                );
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

    /// A gate here -- refusing to start a broker bound off-host with
    /// authentication disabled -- was proposed and REJECTED. `mqtt.enabled` is
    /// a master switch and nothing else; `listen` and `auth` are a separate
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
    fn only_a_loopback_address_is_on_host() {
        assert!(!listens_off_host("127.0.0.1"));
        assert!(!listens_off_host("127.0.0.2"));
        assert!(!listens_off_host("::1"));
        assert!(listens_off_host("0.0.0.0"));
        assert!(listens_off_host("10.0.0.5"));
        assert!(listens_off_host("::"));
        // Not an address at all: the broker cannot bind it, and that is worth
        // the same warning rather than a different silence.
        assert!(listens_off_host("localhost"));
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
