//! Reconciler contract shared by all mosd reconcilers.

use mosd_settings::Settings;

// dead_code: no reconcilers are registered yet; drop this once the reconcilers subtask lands.
#[allow(dead_code)]
#[async_trait::async_trait]
pub trait Reconciler: Send + Sync {
    /// Stable name; also this reconciler's key in the live-state tree (e.g. "hostname", "network").
    fn name(&self) -> &'static str;
    /// Dot-path prefix of the settings subtree this reconciler watches (e.g. "hostname", "network").
    fn subtree(&self) -> &'static str;
    /// Apply `settings` to the system; return the applied live-state as JSON.
    async fn apply(&self, settings: &Settings) -> anyhow::Result<serde_json::Value>;
}

/// All reconcilers compiled into mosd with production executors. Stub: empty; the reconcilers subtask fills this in.
pub fn all() -> Vec<Box<dyn Reconciler>> {
    Vec::new()
}
