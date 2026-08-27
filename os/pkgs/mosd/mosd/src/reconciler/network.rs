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

/// Linux `IFNAMSIZ` minus the terminator: the longest name an interface can
/// actually have.
const MAX_IFACE_LEN: usize = 15;

/// Refuse an interface name the kernel could not have and the renderer must
/// not see.
///
/// The settings file is editable by anything that can write STATE, so the
/// reconciler is the security boundary (the same argument `sshd.rs` makes for
/// its parser). The name is used twice, and both uses need this: it becomes
/// part of a file name under the networkd directory (a `/` or `..` would
/// escape it), and it is interpolated into `Name=` (an embedded newline would
/// smuggle in arbitrary networkd directives).
///
/// # Errors
///
/// Returns an error when the name is empty, longer than [`MAX_IFACE_LEN`],
/// a directory self-reference, or contains anything but ASCII alphanumerics
/// and `.`, `-`, `_`, `:`.
fn validate_iface_name(iface: &str) -> anyhow::Result<()> {
    if iface.is_empty() {
        return Err(anyhow::anyhow!("network interface name is empty"));
    }
    if iface.len() > MAX_IFACE_LEN {
        return Err(anyhow::anyhow!(
            "network interface {iface:?} is longer than {MAX_IFACE_LEN} characters"
        ));
    }
    if iface == "." || iface == ".." {
        return Err(anyhow::anyhow!("network interface {iface:?} is not a name"));
    }
    if !iface
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b':'))
    {
        return Err(anyhow::anyhow!(
            "network interface {iface:?} contains a character an interface name cannot have"
        ));
    }
    Ok(())
}

/// True when `value` parses as an IP address with an optional `/prefix`.
fn is_ip_or_cidr(value: &str) -> bool {
    let (addr, prefix) = match value.split_once('/') {
        Some((addr, prefix)) => (addr, Some(prefix)),
        None => (value, None),
    };
    let Ok(addr) = addr.parse::<std::net::IpAddr>() else {
        return false;
    };
    match prefix {
        None => true,
        Some(prefix) => prefix
            .parse::<u8>()
            .is_ok_and(|p| p <= if addr.is_ipv4() { 32 } else { 128 }),
    }
}

/// Refuse a static configuration whose values could not be addresses.
///
/// `render_unit` interpolates these verbatim onto networkd directive lines,
/// where a newline is a new directive; requiring each value to parse as an
/// address makes injection structurally impossible rather than filtering for
/// it. apid validates the address on its write path, but the settings file is
/// writable without apid, so the boundary must hold here.
fn validate_static(iface: &str, cfg: &mosd_settings::StaticConfig) -> anyhow::Result<()> {
    if !is_ip_or_cidr(&cfg.address) {
        return Err(anyhow::anyhow!(
            "network.{iface} static address {:?} is not an IP address or CIDR",
            cfg.address
        ));
    }
    if let Some(gateway) = &cfg.gateway
        && gateway.parse::<std::net::IpAddr>().is_err()
    {
        return Err(anyhow::anyhow!(
            "network.{iface} gateway {gateway:?} is not an IP address"
        ));
    }
    for dns in &cfg.dns {
        if dns.parse::<std::net::IpAddr>().is_err() {
            return Err(anyhow::anyhow!(
                "network.{iface} DNS server {dns:?} is not an IP address"
            ));
        }
    }
    Ok(())
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

/// Whether `file_name` is one this reconciler wrote: `50-mos-<iface>.network`.
///
/// Anchored to the exact prefix, not `contains("-mos-")`: the wifi reconcilers
/// embed the interface name in their unit names, and an interface like
/// `a-mos-b` (legal — `-` is a valid name character) would otherwise make this
/// sweep delete a sibling reconciler's unit on every pass, in a permanent
/// delete/re-render flap.
fn is_mos_managed(file_name: &str) -> bool {
    file_name.starts_with("50-mos-") && file_name.ends_with(".network")
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
            validate_iface_name(iface)?;
            if let Some(static_cfg) = &cfg.static_ {
                validate_static(iface, static_cfg)?;
            }
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

    #[tokio::test]
    async fn rejects_an_iface_name_that_would_escape_the_directory() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, calls) = reconciler_in(dir.path());
        let settings = settings_with(&[("../evil", dhcp_iface())]);

        let err = reconciler.apply(&settings).await.unwrap_err();

        assert!(err.to_string().contains("interface"), "{err}");
        // Nothing was rendered and networkd was never told to reload: the
        // reconcile aborted before any I/O it would have to undo.
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        assert!(calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn rejects_a_gateway_that_is_not_an_address() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _calls) = reconciler_in(dir.path());
        let mut cfg = static_iface();
        // A newline here would land verbatim on the Gateway= line, where it
        // starts a new networkd directive.
        cfg.static_.as_mut().unwrap().gateway = Some("192.168.1.1\nDNS=6.6.6.6".to_string());
        let settings = settings_with(&[("eth1", cfg)]);

        let err = reconciler.apply(&settings).await.unwrap_err();

        assert!(err.to_string().contains("gateway"), "{err}");
        assert!(!dir.path().join("50-mos-eth1.network").exists());
    }

    #[tokio::test]
    async fn sweep_spares_a_wifi_unit_whose_iface_embeds_mos() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _calls) = reconciler_in(dir.path());
        // The wifi reconcilers embed the interface in their unit names, and
        // `a-mos-b` is a legal interface name; the sweep must only ever eat
        // its own `50-mos-*` namespace.
        std::fs::write(dir.path().join("90-wifi-client-a-mos-b.network"), "wifi").unwrap();
        let settings = settings_with(&[("eth0", dhcp_iface())]);

        reconciler.apply(&settings).await.unwrap();

        assert!(dir.path().join("90-wifi-client-a-mos-b.network").exists());
    }
}
