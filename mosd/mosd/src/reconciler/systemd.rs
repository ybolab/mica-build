//! Shared systemd unit control: the operations a reconciler needs to converge
//! a named unit's runtime state.
//!
//! Deliberately unit-name-generic. The sshd reconciler drives `ssh.service`
//! through it; the WiFi client and AP reconcilers drive `wpa_supplicant@…`
//! and `hostapd` through the same trait. Nothing service-specific belongs
//! here.
//!
//! **Enablement is runtime-scoped.** `EnableUnitFiles` with `runtime = false`
//! writes symlinks under `/etc/systemd/system`, which the v2 read-only root
//! does not offer: `/etc` lives on the dm-verity squashfs and only
//! `/etc/ssh/sshd_config.d` is bind-mounted writable from STATE. Runtime scope
//! writes to `/run/systemd/system` instead, which always works, and mosd
//! reconciles the whole settings tree on every start — so the unit is brought
//! back to its configured state each boot without needing a persisted symlink.
//! `stop` is therefore the authoritative disablement at runtime, and `disable`
//! keeps `systemctl is-enabled` honest for the current boot.

use anyhow::Result;

/// systemd's well-known bus name.
const MANAGER_DESTINATION: &str = "org.freedesktop.systemd1";
/// Object path of systemd's manager object.
const MANAGER_PATH: &str = "/org/freedesktop/systemd1";
/// Manager interface carrying the unit lifecycle methods.
const MANAGER_INTERFACE: &str = "org.freedesktop.systemd1.Manager";
/// Unit interface carrying the `ActiveState` property.
const UNIT_INTERFACE: &str = "org.freedesktop.systemd1.Unit";
/// Standard D-Bus property interface.
const PROPERTIES_INTERFACE: &str = "org.freedesktop.DBus.Properties";
/// Job mode for start/stop/restart/reload: queue the job, displacing
/// conflicting ones.
const JOB_MODE: &str = "replace";

/// Controls the runtime state of a systemd unit by name.
///
/// The state readers exist so a reconciler can converge rather than command:
/// it reads first and only issues the calls that change something, which is
/// what makes a repeated `apply` a genuine no-op.
#[async_trait::async_trait]
pub trait UnitControl: Send + Sync {
    /// `ActiveState` of `unit` — one of systemd's `active`, `activating`,
    /// `reloading`, `deactivating`, `inactive`, `failed`.
    ///
    /// # Errors
    ///
    /// Returns an error when the unit cannot be loaded or the bus call fails.
    async fn active_state(&self, unit: &str) -> Result<String>;

    /// Unit file enablement state of `unit` — one of systemd's `enabled`,
    /// `enabled-runtime`, `disabled`, `static`, `masked`, `linked`, ….
    ///
    /// # Errors
    ///
    /// Returns an error when the unit file cannot be found or the bus call
    /// fails.
    async fn unit_file_state(&self, unit: &str) -> Result<String>;

    /// Start `unit`.
    ///
    /// # Errors
    ///
    /// Returns an error when the bus call fails or systemd refuses the job.
    async fn start(&self, unit: &str) -> Result<()>;

    /// Stop `unit`.
    ///
    /// # Errors
    ///
    /// Returns an error when the bus call fails or systemd refuses the job.
    async fn stop(&self, unit: &str) -> Result<()>;

    /// Restart `unit`, so a rewritten configuration file takes effect.
    ///
    /// # Errors
    ///
    /// Returns an error when the bus call fails or systemd refuses the job.
    async fn restart(&self, unit: &str) -> Result<()>;

    /// Reload `unit`, so a rewritten configuration file takes effect **without**
    /// tearing the running process down.
    ///
    /// The equivalent of `systemctl reload <unit>`. Only meaningful for a unit
    /// whose unit file carries `ExecReload`; systemd refuses the job on one that
    /// does not, and this returns that refusal rather than papering over it. A
    /// caller that needs the operator to understand *why* a reload is the right
    /// operation for its unit is expected to add that context to the error.
    ///
    /// # Errors
    ///
    /// Returns an error when the bus call fails or systemd refuses the job —
    /// notably when the unit file has no `ExecReload`.
    async fn reload(&self, unit: &str) -> Result<()>;

    /// Enable `unit` for this boot.
    ///
    /// # Errors
    ///
    /// Returns an error when the bus call fails or the unit file carries no
    /// install information.
    async fn enable(&self, unit: &str) -> Result<()>;

    /// Disable `unit` for this boot.
    ///
    /// # Errors
    ///
    /// Returns an error when the bus call fails.
    async fn disable(&self, unit: &str) -> Result<()>;

    /// Re-run every systemd generator and reload the unit tree.
    ///
    /// The equivalent of `systemctl daemon-reload`, and unlike the methods
    /// above it names no unit because it acts on all of them. It exists for
    /// GENERATORS: Quadlet is one, so a `.container` file only becomes a
    /// service when systemd re-runs it, and a reconciler that mounted the
    /// directory holding those files without reloading would leave the mount
    /// correct and the units nonexistent -- with nothing reporting a problem.
    ///
    /// # Errors
    ///
    /// Returns an error when the bus call fails.
    async fn daemon_reload(&self) -> Result<()>;
}

/// True when `state` is an [`UnitControl::active_state`] value that means the
/// unit is running or on its way up, i.e. starting it again would be
/// redundant.
#[must_use]
pub fn is_active(state: &str) -> bool {
    matches!(state, "active" | "activating" | "reloading")
}

/// True when `state` is an [`UnitControl::unit_file_state`] value that means
/// the unit is already enabled, at either scope.
///
/// `static` counts as enabled: such a unit has no `[Install]` section, so
/// enabling it is both impossible and unnecessary.
#[must_use]
pub fn is_enabled(state: &str) -> bool {
    matches!(state, "enabled" | "enabled-runtime" | "static")
}

/// Production [`UnitControl`] calling `org.freedesktop.systemd1` on the system
/// bus.
///
/// The bus connection is created lazily inside each call, so constructing this
/// executor never touches the host.
pub struct Systemd;

impl Systemd {
    /// Call `method` on systemd's manager object with `body`.
    async fn manager_call<B>(&self, method: &str, body: &B) -> Result<zbus::Message>
    where
        B: zbus::export::serde::ser::Serialize + zbus::zvariant::DynamicType,
    {
        let connection = zbus::Connection::system().await?;
        let reply = connection
            .call_method(
                Some(MANAGER_DESTINATION),
                MANAGER_PATH,
                Some(MANAGER_INTERFACE),
                method,
                body,
            )
            .await?;
        Ok(reply)
    }
}

#[async_trait::async_trait]
impl UnitControl for Systemd {
    async fn active_state(&self, unit: &str) -> Result<String> {
        // LoadUnit rather than GetUnit: GetUnit fails outright on a unit
        // systemd has not loaded yet, which is the normal state of a service
        // that has never been started this boot.
        let reply = self.manager_call("LoadUnit", &(unit,)).await?;
        let unit_path: zbus::zvariant::OwnedObjectPath = reply.body().deserialize()?;

        let connection = zbus::Connection::system().await?;
        let reply = connection
            .call_method(
                Some(MANAGER_DESTINATION),
                &unit_path,
                Some(PROPERTIES_INTERFACE),
                "Get",
                &(UNIT_INTERFACE, "ActiveState"),
            )
            .await?;
        let value: zbus::zvariant::OwnedValue = reply.body().deserialize()?;
        Ok(String::try_from(value)?)
    }

    async fn unit_file_state(&self, unit: &str) -> Result<String> {
        let reply = self.manager_call("GetUnitFileState", &(unit,)).await?;
        Ok(reply.body().deserialize()?)
    }

    async fn start(&self, unit: &str) -> Result<()> {
        self.manager_call("StartUnit", &(unit, JOB_MODE)).await?;
        Ok(())
    }

    async fn stop(&self, unit: &str) -> Result<()> {
        self.manager_call("StopUnit", &(unit, JOB_MODE)).await?;
        Ok(())
    }

    async fn restart(&self, unit: &str) -> Result<()> {
        self.manager_call("RestartUnit", &(unit, JOB_MODE)).await?;
        Ok(())
    }

    async fn reload(&self, unit: &str) -> Result<()> {
        // ReloadUnit is what `systemctl reload` calls. It fails rather than
        // falling back to a restart when the unit file carries no ExecReload,
        // which is the behaviour a caller that chose reload for its
        // session-preserving property needs.
        self.manager_call("ReloadUnit", &(unit, JOB_MODE)).await?;
        Ok(())
    }

    async fn enable(&self, unit: &str) -> Result<()> {
        // (files, runtime, force): runtime = true keeps the symlinks in /run,
        // see the module docs. force = true replaces a stale symlink rather
        // than failing on it.
        self.manager_call("EnableUnitFiles", &(&[unit][..], true, true))
            .await?;
        Ok(())
    }

    async fn disable(&self, unit: &str) -> Result<()> {
        self.manager_call("DisableUnitFiles", &(&[unit][..], true))
            .await?;
        Ok(())
    }

    async fn daemon_reload(&self) -> Result<()> {
        self.manager_call("Reload", &()).await?;
        Ok(())
    }
}

/// Recording [`UnitControl`] mock for reconciler tests.
///
/// Lives here rather than in each reconciler's test module because every
/// reconciler that drives a unit needs the same one.
#[cfg(test)]
pub mod mock {
    use std::sync::Mutex;

    use anyhow::Result;

    /// Mutable half of [`MockUnitControl`].
    struct State {
        active: String,
        file: String,
        calls: Vec<String>,
        /// Per-unit overrides of `active`/`file`.
        ///
        /// A single pair was enough while every reconciler drove exactly one
        /// unit. `ContainerReconciler` drives a mount AND the units Quadlet
        /// generated behind it, and the ORDER it touches them in is the thing
        /// worth asserting -- which a mock that answers identically for every
        /// unit cannot express. `new` keeps its meaning: the pair it takes is
        /// the answer for any unit not named here.
        active_by_unit: std::collections::BTreeMap<String, String>,
        file_by_unit: std::collections::BTreeMap<String, String>,
    }

    /// [`super::UnitControl`] that records mutating calls and models the state
    /// transitions they would cause, so a second `apply` sees the world the
    /// first one left behind.
    pub struct MockUnitControl {
        state: Mutex<State>,
        /// When true, [`super::UnitControl::reload`] records its attempt and
        /// then fails.
        reload_fails: bool,
    }

    impl MockUnitControl {
        /// Mock starting from `active` ([`super::UnitControl::active_state`])
        /// and `file` ([`super::UnitControl::unit_file_state`]).
        pub fn new(active: &str, file: &str) -> Self {
            Self {
                state: Mutex::new(State {
                    active: active.to_string(),
                    file: file.to_string(),
                    calls: Vec::new(),
                    active_by_unit: std::collections::BTreeMap::new(),
                    file_by_unit: std::collections::BTreeMap::new(),
                }),
                reload_fails: false,
            }
        }

        /// Same, but every [`super::UnitControl::reload`] fails — the shape of
        /// a unit file that carries no `ExecReload`.
        ///
        /// The attempt is still recorded, so a test can assert both that the
        /// reload was tried and that nothing else was tried after it failed.
        pub fn with_failing_reload(active: &str, file: &str) -> Self {
            Self {
                reload_fails: true,
                ..Self::new(active, file)
            }
        }

        /// Answer `state` for `unit`'s [`super::UnitControl::active_state`],
        /// overriding the constructor's default for that unit only.
        pub fn set_active_state(&self, unit: &str, state: &str) {
            let mut guard = match self.state.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            guard
                .active_by_unit
                .insert(unit.to_string(), state.to_string());
        }

        /// Answer `state` for `unit`'s [`super::UnitControl::unit_file_state`].
        pub fn set_unit_file_state(&self, unit: &str, state: &str) {
            let mut guard = match self.state.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            guard
                .file_by_unit
                .insert(unit.to_string(), state.to_string());
        }

        /// Mutating calls seen so far, in order, as `"<verb> <unit>"`.
        ///
        /// State reads are deliberately not recorded: a reconciler is expected
        /// to read freely and only the writes are what "no redundant state
        /// change" is about.
        pub fn calls(&self) -> Vec<String> {
            match self.state.lock() {
                Ok(state) => state.calls.clone(),
                Err(poisoned) => poisoned.into_inner().calls.clone(),
            }
        }

        /// Record `verb` against `unit` and apply its state transition.
        fn record(&self, verb: &str, unit: &str) {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(poisoned) => poisoned.into_inner(),
            };
            state.calls.push(format!("{verb} {unit}"));
            // The transition lands on the per-unit entry as well, so a second
            // apply sees what the first left behind for THAT unit rather than
            // for whichever unit was touched last.
            // PER-UNIT ONLY. An earlier version also moved the shared
            // `active`/`file` defaults, so starting ONE unit made every unit
            // the test had not named read back as active -- and a reconciler
            // that then skipped starting a container looked correct. The
            // constructor's pair stays what it is: the answer for units
            // nothing has touched.
            match verb {
                "start" | "restart" => {
                    state
                        .active_by_unit
                        .insert(unit.to_string(), "active".to_string());
                }
                "stop" => {
                    state
                        .active_by_unit
                        .insert(unit.to_string(), "inactive".to_string());
                }
                "enable" => {
                    state
                        .file_by_unit
                        .insert(unit.to_string(), "enabled-runtime".to_string());
                }
                "disable" => {
                    state
                        .file_by_unit
                        .insert(unit.to_string(), "disabled".to_string());
                }
                // "reload" among them: a reload leaves the unit exactly as
                // active as it already was, which is the whole point of it.
                _ => {}
            }
        }
    }

    #[async_trait::async_trait]
    impl super::UnitControl for MockUnitControl {
        async fn active_state(&self, unit: &str) -> Result<String> {
            let state = match self.state.lock() {
                Ok(state) => state,
                Err(poisoned) => poisoned.into_inner(),
            };
            Ok(state
                .active_by_unit
                .get(unit)
                .cloned()
                .unwrap_or_else(|| state.active.clone()))
        }

        async fn unit_file_state(&self, unit: &str) -> Result<String> {
            let state = match self.state.lock() {
                Ok(state) => state,
                Err(poisoned) => poisoned.into_inner(),
            };
            Ok(state
                .file_by_unit
                .get(unit)
                .cloned()
                .unwrap_or_else(|| state.file.clone()))
        }

        async fn start(&self, unit: &str) -> Result<()> {
            self.record("start", unit);
            Ok(())
        }

        async fn stop(&self, unit: &str) -> Result<()> {
            self.record("stop", unit);
            Ok(())
        }

        async fn restart(&self, unit: &str) -> Result<()> {
            self.record("restart", unit);
            Ok(())
        }

        async fn reload(&self, unit: &str) -> Result<()> {
            self.record("reload", unit);
            if self.reload_fails {
                return Err(anyhow::anyhow!("Unit {unit} does not support reload"));
            }
            Ok(())
        }

        async fn enable(&self, unit: &str) -> Result<()> {
            self.record("enable", unit);
            Ok(())
        }

        async fn disable(&self, unit: &str) -> Result<()> {
            self.record("disable", unit);
            Ok(())
        }

        async fn daemon_reload(&self) -> Result<()> {
            // Recorded with a unit name of "-" rather than "": a test asserting
            // on the call log reads `daemon-reload -`, and an empty second
            // field would render as a trailing space that is easy to miss in a
            // diff of expected calls.
            self.record("daemon-reload", "-");
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_states_that_mean_running_or_coming_up() {
        assert!(is_active("active"));
        assert!(is_active("activating"));
        assert!(is_active("reloading"));
        assert!(!is_active("inactive"));
        assert!(!is_active("deactivating"));
        assert!(!is_active("failed"));
    }

    #[test]
    fn enablement_states_that_mean_already_enabled() {
        assert!(is_enabled("enabled"));
        assert!(is_enabled("enabled-runtime"));
        assert!(is_enabled("static"));
        assert!(!is_enabled("disabled"));
        assert!(!is_enabled("masked"));
        assert!(!is_enabled("linked"));
    }

    #[tokio::test]
    async fn mock_records_mutations_and_models_their_transitions() {
        use mock::MockUnitControl;

        let control = MockUnitControl::new("inactive", "disabled");
        control.enable("u.service").await.unwrap();
        control.start("u.service").await.unwrap();

        assert_eq!(control.active_state("u.service").await.unwrap(), "active");
        assert_eq!(
            control.unit_file_state("u.service").await.unwrap(),
            "enabled-runtime"
        );

        control.stop("u.service").await.unwrap();
        control.disable("u.service").await.unwrap();

        assert_eq!(control.active_state("u.service").await.unwrap(), "inactive");
        assert_eq!(
            control.unit_file_state("u.service").await.unwrap(),
            "disabled"
        );
        assert_eq!(
            control.calls(),
            vec![
                "enable u.service".to_string(),
                "start u.service".to_string(),
                "stop u.service".to_string(),
                "disable u.service".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn mock_records_a_reload_and_leaves_the_unit_as_active_as_it_was() {
        use mock::MockUnitControl;

        let control = MockUnitControl::new("active", "enabled");
        control.reload("u.service").await.unwrap();

        assert_eq!(control.calls(), vec!["reload u.service".to_string()]);
        assert_eq!(control.active_state("u.service").await.unwrap(), "active");
    }

    #[tokio::test]
    async fn mock_can_model_a_unit_whose_unit_file_has_no_exec_reload() {
        use mock::MockUnitControl;

        let control = MockUnitControl::with_failing_reload("active", "enabled");
        let error = control.reload("u.service").await.unwrap_err();

        assert!(
            error.to_string().contains("does not support reload"),
            "unexpected error: {error}"
        );
        // Recorded even though it failed: a caller asserting "no fallback"
        // needs to see the attempt and nothing after it.
        assert_eq!(control.calls(), vec!["reload u.service".to_string()]);
    }
}
