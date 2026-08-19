//! Reconciler contract shared by all mosd reconcilers.

mod hostname;
mod network;
mod sshd;
mod systemd;
mod wifi_client;

use mosd_settings::Settings;

// dead_code: name/subtree/apply are unused until the daemon loop lands; drop this then.
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

/// All reconcilers compiled into mosd with production executors.
///
/// Safe to call anywhere: executors connect to the system bus lazily, so
/// nothing touches the host until a reconciler's `apply` runs.
pub fn all() -> Vec<Box<dyn Reconciler>> {
    vec![
        Box::new(hostname::HostnameReconciler::new(hostname::Hostnamed)),
        Box::new(network::NetworkReconciler::production()),
        Box::new(sshd::SshdReconciler::production()),
        Box::new(wifi_client::WifiClientReconciler::production()),
    ]
}
