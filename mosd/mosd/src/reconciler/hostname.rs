//! Hostname reconciler: applies `settings.hostname` via systemd-hostnamed.

use mosd_settings::Settings;
use serde_json::json;

use super::Reconciler;

/// Executes the hostname change on the host.
#[async_trait::async_trait]
pub trait HostnameExecutor: Send + Sync {
    /// Set the system's static hostname to `name`.
    async fn set_static_hostname(&self, name: &str) -> anyhow::Result<()>;
}

/// Production executor calling `org.freedesktop.hostname1` on the system bus.
///
/// The bus connection is created lazily inside the call, so constructing this
/// executor never touches the host.
pub struct Hostnamed;

#[async_trait::async_trait]
impl HostnameExecutor for Hostnamed {
    async fn set_static_hostname(&self, name: &str) -> anyhow::Result<()> {
        let connection = zbus::Connection::system().await?;
        connection
            .call_method(
                Some("org.freedesktop.hostname1"),
                "/org/freedesktop/hostname1",
                Some("org.freedesktop.hostname1"),
                "SetStaticHostname",
                &(name, false),
            )
            .await?;
        Ok(())
    }
}

/// Reconciler for the `hostname` settings subtree.
pub struct HostnameReconciler<E: HostnameExecutor> {
    executor: E,
}

impl<E: HostnameExecutor> HostnameReconciler<E> {
    /// Create a hostname reconciler applying changes through `executor`.
    pub fn new(executor: E) -> Self {
        Self { executor }
    }
}

#[async_trait::async_trait]
impl<E: HostnameExecutor> Reconciler for HostnameReconciler<E> {
    fn name(&self) -> &'static str {
        "hostname"
    }

    fn subtree(&self) -> &'static str {
        "hostname"
    }

    async fn apply(&self, settings: &Settings) -> anyhow::Result<serde_json::Value> {
        self.executor
            .set_static_hostname(&settings.hostname)
            .await?;
        Ok(json!({ "hostname": settings.hostname }))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    struct MockExecutor {
        calls: Arc<Mutex<Vec<String>>>,
        fail: bool,
    }

    #[async_trait::async_trait]
    impl HostnameExecutor for MockExecutor {
        async fn set_static_hostname(&self, name: &str) -> anyhow::Result<()> {
            self.calls.lock().unwrap().push(name.to_string());
            if self.fail {
                anyhow::bail!("hostnamed unavailable");
            }
            Ok(())
        }
    }

    #[tokio::test]
    async fn apply_sets_hostname_once_and_returns_live_state() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let reconciler = HostnameReconciler::new(MockExecutor {
            calls: Arc::clone(&calls),
            fail: false,
        });
        let settings = Settings {
            hostname: "mos-test".to_string(),
            ..Settings::default()
        };

        let state = reconciler.apply(&settings).await.unwrap();

        assert_eq!(*calls.lock().unwrap(), vec!["mos-test".to_string()]);
        assert_eq!(state, json!({ "hostname": "mos-test" }));
        assert_eq!(reconciler.name(), "hostname");
        assert_eq!(reconciler.subtree(), "hostname");
    }

    #[tokio::test]
    async fn apply_propagates_executor_error() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let reconciler = HostnameReconciler::new(MockExecutor {
            calls: Arc::clone(&calls),
            fail: true,
        });
        let settings = Settings::default();

        let err = reconciler.apply(&settings).await.unwrap_err();

        assert!(err.to_string().contains("hostnamed unavailable"));
        assert_eq!(calls.lock().unwrap().len(), 1);
    }
}
