//! Network reconciler: renders systemd-networkd `.network` units and reloads
//! networkd.

use std::collections::BTreeSet;
use std::path::PathBuf;

use mosd_settings::{IfaceSettings, Settings};
use serde_json::json;

use super::Reconciler;

/// Directory networkd reads runtime unit files from.
const DEFAULT_NETWORK_DIR: &str = "/run/systemd/network";
/// Environment variable overriding the networkd unit directory.
const NETWORK_DIR_ENV: &str = "MOSD_NETWORK_DIR";

/// Asks the network stack to pick up freshly rendered unit files.
#[async_trait::async_trait]
pub trait NetworkReload: Send + Sync {
    /// Reload network configuration.
    async fn reload(&self) -> anyhow::Result<()>;
}

/// Production reloader calling `org.freedesktop.network1` `Manager.Reload` on
/// the system bus.
///
/// The bus connection is created lazily inside the call, so constructing this
/// reloader never touches the host.
pub struct Networkd;

#[async_trait::async_trait]
impl NetworkReload for Networkd {
    async fn reload(&self) -> anyhow::Result<()> {
        let connection = zbus::Connection::system().await?;
        connection
            .call_method(
                Some("org.freedesktop.network1"),
                "/org/freedesktop/network1",
                Some("org.freedesktop.network1.Manager"),
                "Reload",
                &(),
            )
            .await?;
        Ok(())
    }
}

/// Reconciler for the `network` settings subtree.
pub struct NetworkReconciler<R: NetworkReload> {
    target_dir: PathBuf,
    reloader: R,
}

impl<R: NetworkReload> NetworkReconciler<R> {
    /// Create a network reconciler rendering units into `target_dir` and
    /// reloading through `reloader`.
    pub fn new(target_dir: PathBuf, reloader: R) -> Self {
        Self {
            target_dir,
            reloader,
        }
    }
}

impl NetworkReconciler<Networkd> {
    /// Production reconciler: target directory from `MOSD_NETWORK_DIR` if
    /// set, else the networkd runtime directory.
    pub fn production() -> Self {
        let dir = std::env::var(NETWORK_DIR_ENV)
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_NETWORK_DIR));
        Self::new(dir, Networkd)
    }
}

/// Render one networkd unit for `iface`.
fn render_unit(iface: &str, cfg: &IfaceSettings) -> String {
    let mut out = format!("[Match]\nName={iface}\n\n[Network]\n");
    if cfg.dhcp {
        out.push_str("DHCP=yes\n");
    } else if let Some(static_cfg) = &cfg.static_ {
        out.push_str(&format!("Address={}\n", static_cfg.address));
        if let Some(gateway) = &static_cfg.gateway {
            out.push_str(&format!("Gateway={gateway}\n"));
        }
        for dns in &static_cfg.dns {
            out.push_str(&format!("DNS={dns}\n"));
        }
    }
    out
}

/// Whether `file_name` matches the mos-managed pattern `*-mos-*.network`.
fn is_mos_managed(file_name: &str) -> bool {
    file_name.ends_with(".network") && file_name.contains("-mos-")
}

#[async_trait::async_trait]
impl<R: NetworkReload> Reconciler for NetworkReconciler<R> {
    fn name(&self) -> &'static str {
        "network"
    }

    fn subtree(&self) -> &'static str {
        "network"
    }

    async fn apply(&self, settings: &Settings) -> anyhow::Result<serde_json::Value> {
        std::fs::create_dir_all(&self.target_dir)?;
        let mut rendered = BTreeSet::new();
        let mut state = serde_json::Map::new();
        for (iface, cfg) in &settings.network {
            let file_name = format!("50-mos-{iface}.network");
            std::fs::write(self.target_dir.join(&file_name), render_unit(iface, cfg))?;
            state.insert(
                iface.clone(),
                json!({ "file": file_name, "dhcp": cfg.dhcp }),
            );
            rendered.insert(file_name);
        }
        for entry in std::fs::read_dir(&self.target_dir)? {
            let entry = entry?;
            let file_name = entry.file_name();
            let Some(file_name) = file_name.to_str() else {
                continue;
            };
            if is_mos_managed(file_name) && !rendered.contains(file_name) {
                std::fs::remove_file(entry.path())?;
            }
        }
        self.reloader.reload().await?;
        Ok(serde_json::Value::Object(state))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use mosd_settings::StaticConfig;

    use super::*;

    const GOLDEN_DHCP: &str = "[Match]\nName=eth0\n\n[Network]\nDHCP=yes\n";
    const GOLDEN_STATIC: &str = "[Match]\nName=eth1\n\n[Network]\n\
        Address=192.168.1.10/24\nGateway=192.168.1.1\nDNS=1.1.1.1\nDNS=9.9.9.9\n";
    const GOLDEN_EMPTY: &str = "[Match]\nName=eth2\n\n[Network]\n";

    struct MockReload {
        calls: Arc<Mutex<Vec<String>>>,
    }

    #[async_trait::async_trait]
    impl NetworkReload for MockReload {
        async fn reload(&self) -> anyhow::Result<()> {
            self.calls.lock().unwrap().push("reload".to_string());
            Ok(())
        }
    }

    fn reconciler_in(
        dir: &std::path::Path,
    ) -> (NetworkReconciler<MockReload>, Arc<Mutex<Vec<String>>>) {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let reconciler = NetworkReconciler::new(
            dir.to_path_buf(),
            MockReload {
                calls: Arc::clone(&calls),
            },
        );
        (reconciler, calls)
    }

    fn dhcp_iface() -> IfaceSettings {
        IfaceSettings {
            dhcp: true,
            static_: None,
        }
    }

    fn static_iface() -> IfaceSettings {
        IfaceSettings {
            dhcp: false,
            static_: Some(StaticConfig {
                address: "192.168.1.10/24".to_string(),
                gateway: Some("192.168.1.1".to_string()),
                dns: vec!["1.1.1.1".to_string(), "9.9.9.9".to_string()],
            }),
        }
    }

    fn settings_with(network: &[(&str, IfaceSettings)]) -> Settings {
        Settings {
            network: network
                .iter()
                .map(|(iface, cfg)| ((*iface).to_string(), cfg.clone()))
                .collect(),
            ..Settings::default()
        }
    }

    #[tokio::test]
    async fn renders_dhcp_iface() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _calls) = reconciler_in(dir.path());
        let settings = settings_with(&[("eth0", dhcp_iface())]);

        reconciler.apply(&settings).await.unwrap();

        let rendered = std::fs::read_to_string(dir.path().join("50-mos-eth0.network")).unwrap();
        assert_eq!(rendered, GOLDEN_DHCP);
    }

    #[tokio::test]
    async fn renders_static_iface() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _calls) = reconciler_in(dir.path());
        let settings = settings_with(&[("eth1", static_iface())]);

        reconciler.apply(&settings).await.unwrap();

        let rendered = std::fs::read_to_string(dir.path().join("50-mos-eth1.network")).unwrap();
        assert_eq!(rendered, GOLDEN_STATIC);
    }

    #[tokio::test]
    async fn renders_static_less_non_dhcp_iface_with_empty_network_section() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _calls) = reconciler_in(dir.path());
        let settings = settings_with(&[(
            "eth2",
            IfaceSettings {
                dhcp: false,
                static_: None,
            },
        )]);

        reconciler.apply(&settings).await.unwrap();

        let rendered = std::fs::read_to_string(dir.path().join("50-mos-eth2.network")).unwrap();
        assert_eq!(rendered, GOLDEN_EMPTY);
    }

    #[tokio::test]
    async fn renders_both_ifaces_and_returns_live_state() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, calls) = reconciler_in(dir.path());
        let settings = settings_with(&[("eth0", dhcp_iface()), ("eth1", static_iface())]);

        let state = reconciler.apply(&settings).await.unwrap();

        let dhcp = std::fs::read_to_string(dir.path().join("50-mos-eth0.network")).unwrap();
        let static_ = std::fs::read_to_string(dir.path().join("50-mos-eth1.network")).unwrap();
        assert_eq!(dhcp, GOLDEN_DHCP);
        assert_eq!(static_, GOLDEN_STATIC);
        assert_eq!(
            state,
            json!({
                "eth0": { "file": "50-mos-eth0.network", "dhcp": true },
                "eth1": { "file": "50-mos-eth1.network", "dhcp": false },
            })
        );
        assert_eq!(*calls.lock().unwrap(), vec!["reload".to_string()]);
        assert_eq!(reconciler.name(), "network");
        assert_eq!(reconciler.subtree(), "network");
    }

    #[tokio::test]
    async fn removes_stale_mos_managed_files_but_keeps_foreign_files() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, calls) = reconciler_in(dir.path());
        std::fs::write(dir.path().join("50-mos-eth9.network"), "stale").unwrap();
        std::fs::write(dir.path().join("80-dhcp.network"), "foreign").unwrap();
        let settings = settings_with(&[("eth0", dhcp_iface())]);

        reconciler.apply(&settings).await.unwrap();

        assert!(!dir.path().join("50-mos-eth9.network").exists());
        assert!(dir.path().join("80-dhcp.network").exists());
        assert!(dir.path().join("50-mos-eth0.network").exists());
        assert_eq!(calls.lock().unwrap().len(), 1);
    }
}
