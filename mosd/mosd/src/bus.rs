//! D-Bus service implementation for `com.mos.mosd`.
//!
//! Exposes the settings tree and the live-state tree on the bus as the
//! `com.mos.mosd1` interface at [`OBJECT_PATH`], owned under [`BUS_NAME`].

use mosd_settings::{Settings, SettingsError, Store, json_path_get};
use serde_json::Value;
use tokio::sync::Mutex;
use zbus::fdo;
use zbus::message::Header;
use zbus::object_server::SignalEmitter;

use crate::power::PowerControl;
use crate::reconciler::Reconciler;

/// Well-known bus name owned by the daemon.
pub const BUS_NAME: &str = "com.mos.mosd";
/// Object path the service is registered at.
pub const OBJECT_PATH: &str = "/com/mos/mosd";

/// True when `a` and `b` overlap by dot segments in either direction:
/// one path is a segment-wise prefix of the other. The root path (`""` or
/// `"."`) matches everything.
pub fn paths_overlap(a: &str, b: &str) -> bool {
    let a = if a == "." { "" } else { a };
    let b = if b == "." { "" } else { b };
    if a.is_empty() || b.is_empty() {
        return true;
    }
    let mut a = a.split('.');
    let mut b = b.split('.');
    loop {
        match (a.next(), b.next()) {
            (Some(x), Some(y)) if x == y => {}
            (Some(_), Some(_)) => return false,
            _ => return true,
        }
    }
}

/// Mutable trees guarded by one lock so settings writes and live-state
/// updates stay consistent.
struct Inner {
    settings: Settings,
    state: Value,
}

/// The `com.mos.mosd1` service: settings tree, live-state tree, store,
/// reconcilers and the power control.
pub struct MosdService {
    store: Store,
    reconcilers: Vec<Box<dyn Reconciler>>,
    power: Box<dyn PowerControl>,
    inner: Mutex<Inner>,
}

impl MosdService {
    /// Build the service around loaded `settings` and an initial live-state
    /// root (an empty object, or `{"dry_run": true}` in dry-run mode).
    pub fn new(
        store: Store,
        settings: Settings,
        reconcilers: Vec<Box<dyn Reconciler>>,
        power: Box<dyn PowerControl>,
        state: Value,
    ) -> Self {
        Self {
            store,
            reconcilers,
            power,
            inner: Mutex::new(Inner { settings, state }),
        }
    }

    /// Log a power request from `sender` and record it in the live-state tree
    /// under `power`.
    ///
    /// Always called BEFORE the action: once systemd starts tearing the
    /// machine down there may be no system left to log on.
    async fn note_power_request(&self, action: &str, sender: &str) {
        tracing::warn!(action, sender, "power action requested");
        let mut inner = self.inner.lock().await;
        if let Some(root) = inner.state.as_object_mut() {
            root.insert(
                "power".to_string(),
                serde_json::json!({ "last_action": action, "requested_by": sender }),
            );
        }
    }

    /// Reboot the machine on behalf of `sender`.
    ///
    /// Split out from the D-Bus method so unit tests can drive it without
    /// forging a message header.
    pub async fn request_reboot(&self, sender: &str) -> fdo::Result<()> {
        self.note_power_request("reboot", sender).await;
        self.power
            .reboot()
            .await
            .map_err(|err| fdo::Error::Failed(format!("reboot: {err}")))
    }

    /// Power the machine off on behalf of `sender`.
    pub async fn request_power_off(&self, sender: &str) -> fdo::Result<()> {
        self.note_power_request("power_off", sender).await;
        self.power
            .power_off()
            .await
            .map_err(|err| fdo::Error::Failed(format!("power off: {err}")))
    }

    /// Run every reconciler against the current settings, recording each
    /// result in the live-state tree. Errors are recorded, never propagated.
    pub async fn apply_all(&self) {
        let mut inner = self.inner.lock().await;
        let settings = inner.settings.clone();
        for reconciler in &self.reconcilers {
            let result = reconciler.apply(&settings).await;
            record(&mut inner.state, reconciler.name(), result);
        }
    }
}

/// Store a reconciler `result` in the live-state tree under `name`; a failure
/// is logged and recorded as `{"error": "..."}`.
fn record(state: &mut Value, name: &str, result: anyhow::Result<Value>) {
    let entry = match result {
        Ok(value) => value,
        Err(err) => {
            tracing::error!(reconciler = name, error = %err, "reconciler apply failed");
            serde_json::json!({ "error": err.to_string() })
        }
    };
    if let Some(map) = state.as_object_mut() {
        map.insert(name.to_string(), entry);
    }
}

/// Unique bus name of the caller, or `"(unknown)"` on an unnamed message.
fn sender_of<'a>(header: &'a Header<'a>) -> &'a str {
    header.sender().map_or("(unknown)", |name| name.as_str())
}

/// Map settings errors onto standard D-Bus error names.
fn to_fdo(err: SettingsError) -> fdo::Error {
    match err {
        SettingsError::NotFound(_)
        | SettingsError::ReadOnly(_)
        | SettingsError::Validation { .. } => fdo::Error::InvalidArgs(err.to_string()),
        SettingsError::Io(_) => fdo::Error::IOError(err.to_string()),
        SettingsError::Parse(_) | SettingsError::Migration(_) => {
            fdo::Error::Failed(err.to_string())
        }
    }
}

#[zbus::interface(name = "com.mos.mosd1")]
impl MosdService {
    /// JSON-encoded settings value at dot-path `path` (`""` = whole tree).
    async fn get_settings(&self, path: &str) -> fdo::Result<String> {
        let inner = self.inner.lock().await;
        let value = inner.settings.get(path).map_err(to_fdo)?;
        Ok(value.to_string())
    }

    /// Parse `value_json`, write it at `path`, persist atomically, re-apply
    /// the reconcilers whose subtree overlaps `path`, then emit
    /// [`SettingsChanged`](Self::settings_changed).
    async fn set_settings(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        path: &str,
        value_json: &str,
    ) -> fdo::Result<()> {
        let value: Value = serde_json::from_str(value_json)
            .map_err(|err| fdo::Error::InvalidArgs(format!("invalid JSON value: {err}")))?;
        let mut inner = self.inner.lock().await;
        let mut candidate = inner.settings.clone();
        candidate.set(path, value).map_err(to_fdo)?;
        self.store.save(&candidate).map_err(to_fdo)?;
        inner.settings = candidate;
        let settings = inner.settings.clone();
        for reconciler in &self.reconcilers {
            if paths_overlap(path, reconciler.subtree()) {
                let result = reconciler.apply(&settings).await;
                record(&mut inner.state, reconciler.name(), result);
            }
        }
        drop(inner);
        Self::settings_changed(&emitter, path, value_json)
            .await
            .map_err(|err| fdo::Error::Failed(format!("emit SettingsChanged: {err}")))?;
        Ok(())
    }

    /// JSON-encoded live-state subtree at dot-path `path` (`""` = whole tree).
    async fn get_state(&self, path: &str) -> fdo::Result<String> {
        let inner = self.inner.lock().await;
        let value = json_path_get(&inner.state, path)
            .ok_or_else(|| fdo::Error::InvalidArgs(format!("state path not found: `{path}`")))?;
        Ok(value.to_string())
    }

    /// Record a component health report in the live-state tree under
    /// `health.<component>` as `{"status": ..., "detail": ...}`.
    ///
    /// Used by the boot health gate (`mos-health`) to surface non-fatal
    /// pressure — a full `/var`, for example — without failing the gate.
    async fn report_health(&self, component: &str, status: &str, detail: &str) -> fdo::Result<()> {
        if component.is_empty() {
            return Err(fdo::Error::InvalidArgs(
                "component must not be empty".into(),
            ));
        }
        let mut inner = self.inner.lock().await;
        if let Some(root) = inner.state.as_object_mut() {
            let health = root
                .entry("health")
                .or_insert_with(|| Value::Object(serde_json::Map::new()));
            if let Some(health) = health.as_object_mut() {
                health.insert(
                    component.to_string(),
                    serde_json::json!({ "status": status, "detail": detail }),
                );
            }
        }
        tracing::info!(component, status, detail, "health report recorded");
        Ok(())
    }

    /// Reboot the appliance through systemd.
    ///
    /// The request is logged and recorded in the live-state tree before the
    /// call is made.
    async fn reboot(&self, #[zbus(header)] header: Header<'_>) -> fdo::Result<()> {
        self.request_reboot(sender_of(&header)).await
    }

    /// Power the appliance off through systemd.
    ///
    /// The request is logged and recorded in the live-state tree before the
    /// call is made.
    async fn power_off(&self, #[zbus(header)] header: Header<'_>) -> fdo::Result<()> {
        self.request_power_off(sender_of(&header)).await
    }

    /// Emitted after a successful `SetSettings` with the changed dot-path and
    /// its new JSON-encoded value.
    #[zbus(signal)]
    async fn settings_changed(
        emitter: &SignalEmitter<'_>,
        path: &str,
        value_json: &str,
    ) -> zbus::Result<()>;
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::{MosdService, paths_overlap};
    use crate::power::MockPower;

    /// Service backed by a throwaway settings file and a recording power mock;
    /// the shared call log is returned alongside.
    fn service_with_mock() -> (MosdService, Arc<Mutex<Vec<String>>>, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = mosd_settings::Store::new(dir.path().join("settings.toml"));
        let calls = Arc::new(Mutex::new(Vec::new()));
        let service = MosdService::new(
            store,
            mosd_settings::Settings::default(),
            Vec::new(),
            Box::new(MockPower {
                calls: Arc::clone(&calls),
            }),
            serde_json::json!({}),
        );
        (service, calls, dir)
    }

    #[tokio::test]
    async fn reboot_reaches_the_power_control_and_is_recorded_first() {
        let (service, calls, _dir) = service_with_mock();

        service.request_reboot(":1.7").await.expect("reboot");

        assert_eq!(*calls.lock().expect("lock"), vec!["reboot".to_string()]);
        let state = service.get_state("power").await.expect("power state");
        let state: serde_json::Value = serde_json::from_str(&state).expect("json");
        assert_eq!(state["last_action"], "reboot");
        assert_eq!(state["requested_by"], ":1.7");
    }

    #[tokio::test]
    async fn power_off_reaches_the_power_control_and_is_recorded_first() {
        let (service, calls, _dir) = service_with_mock();

        service.request_power_off(":1.9").await.expect("power off");

        assert_eq!(*calls.lock().expect("lock"), vec!["power_off".to_string()]);
        let state = service.get_state("power").await.expect("power state");
        let state: serde_json::Value = serde_json::from_str(&state).expect("json");
        assert_eq!(state["last_action"], "power_off");
        assert_eq!(state["requested_by"], ":1.9");
    }

    #[tokio::test]
    async fn power_requests_do_not_touch_the_settings_tree() {
        let (service, _calls, _dir) = service_with_mock();
        let before = service.get_settings("").await.expect("settings");

        service.request_reboot(":1.1").await.expect("reboot");
        service.request_power_off(":1.1").await.expect("power off");

        assert_eq!(service.get_settings("").await.expect("settings"), before);
    }

    #[test]
    fn root_matches_everything() {
        assert!(paths_overlap("", "network"));
        assert!(paths_overlap("network", ""));
        assert!(paths_overlap("", ""));
        assert!(paths_overlap(".", "hostname"));
        assert!(paths_overlap("hostname", "."));
    }

    #[test]
    fn prefix_matches_both_directions() {
        assert!(paths_overlap("network.eth0.dhcp", "network"));
        assert!(paths_overlap("network", "network.eth0.dhcp"));
        assert!(paths_overlap("hostname", "hostname"));
    }

    #[test]
    fn disjoint_paths_do_not_match() {
        assert!(!paths_overlap("hostname", "network"));
        assert!(!paths_overlap("network.eth0", "network2"));
        assert!(!paths_overlap("net", "network"));
    }
}
