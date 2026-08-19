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
/// Job mode for start/stop/restart: queue the job, displacing conflicting ones.
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
    }

    /// [`super::UnitControl`] that records mutating calls and models the state
    /// transitions they would cause, so a second `apply` sees the world the
    /// first one left behind.
    pub struct MockUnitControl {
        state: Mutex<State>,
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
                }),
            }
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
            match verb {
                "start" | "restart" => state.active = "active".to_string(),
                "stop" => state.active = "inactive".to_string(),
                "enable" => state.file = "enabled-runtime".to_string(),
                "disable" => state.file = "disabled".to_string(),
                _ => {}
            }
        }
    }

    #[async_trait::async_trait]
    impl super::UnitControl for MockUnitControl {
        async fn active_state(&self, _unit: &str) -> Result<String> {
            Ok(match self.state.lock() {
                Ok(state) => state.active.clone(),
                Err(poisoned) => poisoned.into_inner().active.clone(),
            })
        }

        async fn unit_file_state(&self, _unit: &str) -> Result<String> {
            Ok(match self.state.lock() {
                Ok(state) => state.file.clone(),
                Err(poisoned) => poisoned.into_inner().file.clone(),
            })
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

        async fn enable(&self, unit: &str) -> Result<()> {
            self.record("enable", unit);
            Ok(())
        }

        async fn disable(&self, unit: &str) -> Result<()> {
            self.record("disable", unit);
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
}
