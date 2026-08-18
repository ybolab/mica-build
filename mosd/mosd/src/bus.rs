//! D-Bus service implementation for `com.mos.mosd`.
//!
//! Exposes the settings tree and the live-state tree on the bus as the
//! `com.mos.mosd1` interface at [`OBJECT_PATH`], owned under [`BUS_NAME`].

use mosd_settings::{Settings, SettingsError, Store, json_path_get};
use serde_json::Value;
use tokio::sync::Mutex;
use zbus::fdo;
use zbus::object_server::SignalEmitter;

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

/// The `com.mos.mosd1` service: settings tree, live-state tree, store and
/// reconcilers.
pub struct MosdService {
    store: Store,
    reconcilers: Vec<Box<dyn Reconciler>>,
    inner: Mutex<Inner>,
}

impl MosdService {
    /// Build the service around loaded `settings` and an initial live-state
    /// root (an empty object, or `{"dry_run": true}` in dry-run mode).
    pub fn new(
        store: Store,
        settings: Settings,
        reconcilers: Vec<Box<dyn Reconciler>>,
        state: Value,
    ) -> Self {
        Self {
            store,
            reconcilers,
            inner: Mutex::new(Inner { settings, state }),
        }
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
    use super::paths_overlap;

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
