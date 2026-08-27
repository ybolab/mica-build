//! Network reconciler: renders systemd-networkd `.network` units and reloads
//! networkd.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use mosd_settings::{IfaceKind, IfaceSettings, Settings};
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

/// Deletes a virtual network device from the kernel.
///
/// Removing a `.netdev` file and reloading does not delete the device networkd
/// built from it: networkd creates virtual devices, it does not reap them. So
/// a deleted VLAN would keep passing traffic until the next boot, and a VLAN
/// whose id changed would keep the old id, because netdev properties are
/// applied only when the device is created. Both need the device gone first,
/// which is a thing only an explicit delete does.
#[async_trait::async_trait]
pub trait LinkDelete: Send + Sync {
    /// Delete the kernel device named `iface`.
    async fn delete_link(&self, iface: &str) -> anyhow::Result<()>;
}

/// Production deleter running `ip link del dev <iface>`.
///
/// `iproute2` is in the base image, so this is a tool the appliance already
/// carries rather than a new dependency; the alternative, hand-rolled netlink,
/// would put a second engine next to the networkd this reconciler otherwise
/// speaks through.
pub struct IpLink;

#[async_trait::async_trait]
impl LinkDelete for IpLink {
    async fn delete_link(&self, iface: &str) -> anyhow::Result<()> {
        let output = tokio::process::Command::new("ip")
            .args(["link", "del", "dev", iface])
            .output()
            .await?;
        if !output.status.success() {
            return Err(anyhow::anyhow!(
                "ip link del dev {iface} failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(())
    }
}

/// A deleter that deletes nothing, for tests that exercise this reconciler for
/// its file handling alone.
///
/// `cfg(test)` rather than an allow: it exists only for tests, and an allow
/// would also silence the day it stops being used at all (the argument
/// `Hostnamed::with_path` makes).
#[cfg(test)]
pub struct NoDelete;

#[cfg(test)]
#[async_trait::async_trait]
impl LinkDelete for NoDelete {
    async fn delete_link(&self, _iface: &str) -> anyhow::Result<()> {
        Ok(())
    }
}

/// Reconciler for the `network` settings subtree.
pub struct NetworkReconciler<R: NetworkReload, D: LinkDelete> {
    target_dir: PathBuf,
    reloader: R,
    deleter: D,
}

impl<R: NetworkReload, D: LinkDelete> NetworkReconciler<R, D> {
    /// Create a network reconciler rendering units into `target_dir`,
    /// reloading through `reloader` and tearing devices down through
    /// `deleter`.
    pub fn new(target_dir: PathBuf, reloader: R, deleter: D) -> Self {
        Self {
            target_dir,
            reloader,
            deleter,
        }
    }
}

impl NetworkReconciler<Networkd, IpLink> {
    /// Production reconciler: target directory from `MOSD_NETWORK_DIR` if
    /// set, else the networkd runtime directory.
    pub fn production() -> Self {
        let dir = std::env::var(NETWORK_DIR_ENV)
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_NETWORK_DIR));
        Self::new(dir, Networkd, IpLink)
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

/// The spelling a kind has in the settings file, which is also the name of the
/// block that belongs to it.
fn kind_name(kind: IfaceKind) -> &'static str {
    match kind {
        IfaceKind::Physical => "physical",
        IfaceKind::Vlan => "vlan",
        IfaceKind::Bridge => "bridge",
        IfaceKind::Wireguard => "wireguard",
    }
}

/// Refuse an entry whose optional blocks disagree with its `kind`.
///
/// A block belonging to another kind is a statement about the link that the
/// render would silently ignore, and a kind with no block of its own is a link
/// with no parameters; both are refused rather than papered over. The rule
/// that a `wireguard` entry must CARRY its block belongs with the code that
/// renders the tunnel: this milestone renders none, so a wireguard entry is
/// inert here exactly as it is today, and only its foreign blocks are refused.
fn validate_kind_blocks(iface: &str, cfg: &IfaceSettings) -> anyhow::Result<()> {
    let kind = kind_name(cfg.kind);
    let own = (!matches!(cfg.kind, IfaceKind::Physical)).then_some(kind);
    for (block, present) in [
        ("vlan", cfg.vlan.is_some()),
        ("bridge", cfg.bridge.is_some()),
        ("wireguard", cfg.wireguard.is_some()),
    ] {
        if present && own != Some(block) {
            return Err(anyhow::anyhow!(
                "network.{iface} is kind {kind} but carries a {block} block"
            ));
        }
    }
    let missing = match cfg.kind {
        IfaceKind::Vlan => cfg.vlan.is_none(),
        IfaceKind::Bridge => cfg.bridge.is_none(),
        IfaceKind::Physical | IfaceKind::Wireguard => false,
    };
    if missing {
        return Err(anyhow::anyhow!(
            "network.{iface} is kind {kind} but carries no {kind} block"
        ));
    }
    Ok(())
}

/// Refuse a `network` subtree the renderer must not see, before any of it is
/// written.
///
/// Every entry is checked before the first file is created, which is what
/// makes a rejected tree leave the directory as it found it. The relational
/// rules -- a VLAN's parent and a bridge's ports name declared entries -- are
/// fail-closed on purpose: networkd creates a VLAN only when its parent's
/// `.network` names it, and this reconciler renders that line only for an
/// entry it knows about, so an undeclared parent is a VLAN that would never
/// come up. Enforcing it here rather than in apid is the same argument
/// `validate_static` makes: the settings file is writable without apid.
///
/// # Errors
///
/// Returns an error when a name, address, or kind/block pairing is invalid,
/// when a VLAN parent or a bridge port is not itself a declared entry, when a
/// bridge port carries addressing of its own, or when two bridges claim the
/// same port.
fn validate_network(network: &BTreeMap<String, IfaceSettings>) -> anyhow::Result<()> {
    for (iface, cfg) in network {
        validate_iface_name(iface)?;
        if let Some(static_cfg) = &cfg.static_ {
            validate_static(iface, static_cfg)?;
        }
        validate_kind_blocks(iface, cfg)?;
    }
    // Which bridge claimed each port, so the second claim on one port is an
    // error rather than a race between two `Bridge=` lines for the same file.
    let mut claimed_by: BTreeMap<&str, &str> = BTreeMap::new();
    for (iface, cfg) in network {
        if let Some(vlan) = &cfg.vlan
            && !network.contains_key(&vlan.parent)
        {
            return Err(anyhow::anyhow!(
                "network.{iface} has VLAN parent {:?}, which is not a declared network entry",
                vlan.parent
            ));
        }
        let Some(bridge) = &cfg.bridge else {
            continue;
        };
        for port in &bridge.ports {
            let Some(port_cfg) = network.get(port) else {
                return Err(anyhow::anyhow!(
                    "network.{iface} has bridge port {port:?}, which is not a declared network entry"
                ));
            };
            if port_cfg.dhcp || port_cfg.static_.is_some() {
                return Err(anyhow::anyhow!(
                    "network.{port} is a port of bridge {iface} and must not carry addressing of its own"
                ));
            }
            if let Some(other) = claimed_by.insert(port, iface) {
                return Err(anyhow::anyhow!(
                    "network.{port} is claimed as a port by both bridge {other} and bridge {iface}"
                ));
            }
        }
    }
    Ok(())
}

/// Which bridge each declared port belongs to.
fn bridge_ports(network: &BTreeMap<String, IfaceSettings>) -> BTreeMap<&str, &str> {
    let mut ports = BTreeMap::new();
    for (iface, cfg) in network {
        if let Some(bridge) = &cfg.bridge {
            for port in &bridge.ports {
                ports.insert(port.as_str(), iface.as_str());
            }
        }
    }
    ports
}

/// The declared VLAN children of each parent.
fn vlan_children(network: &BTreeMap<String, IfaceSettings>) -> BTreeMap<&str, Vec<&str>> {
    let mut children: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (iface, cfg) in network {
        if let Some(vlan) = &cfg.vlan {
            children
                .entry(vlan.parent.as_str())
                .or_default()
                .push(iface.as_str());
        }
    }
    children
}

/// Render the `.netdev` unit that creates `iface`, for a kind that needs one.
///
/// `None` for a physical entry, whose device the kernel already has, and for a
/// wireguard entry, whose unit carries a key path this milestone has nowhere
/// to get: rendering half a tunnel would claim a link that cannot come up, so
/// the entry stays inert until the milestone that owns the keystore.
fn render_netdev(iface: &str, cfg: &IfaceSettings) -> Option<String> {
    match (cfg.kind, &cfg.vlan) {
        (IfaceKind::Vlan, Some(vlan)) => Some(format!(
            "[NetDev]\nName={iface}\nKind=vlan\n\n[VLAN]\nId={}\n",
            vlan.id
        )),
        (IfaceKind::Bridge, _) => Some(format!("[NetDev]\nName={iface}\nKind=bridge\n")),
        _ => None,
    }
}

/// Render one networkd unit for `iface`.
///
/// `master` is the bridge that claimed this interface as a port, and `vlans`
/// the VLAN children declared on top of it: networkd creates a VLAN only when
/// the parent's `.network` names it, so the child's existence is a fact about
/// the PARENT's unit.
fn render_unit(iface: &str, cfg: &IfaceSettings, master: Option<&str>, vlans: &[&str]) -> String {
    let mut out = format!("[Match]\nName={iface}\n\n[Network]\n");
    if let Some(bridge) = master {
        // A port's addressing is the bridge's; validation has already refused
        // an entry that tried to keep its own.
        out.push_str(&format!("Bridge={bridge}\n"));
    } else if cfg.dhcp {
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
    for child in vlans {
        out.push_str(&format!("VLAN={child}\n"));
    }
    out
}

/// Whether `file_name` is one this reconciler wrote: `50-mos-<iface>.network`
/// or, for a virtual link, `50-mos-<iface>.netdev`.
///
/// Anchored to the exact prefix, not `contains("-mos-")`: the wifi reconcilers
/// embed the interface name in their unit names, and an interface like
/// `a-mos-b` (legal — `-` is a valid name character) would otherwise make this
/// sweep delete a sibling reconciler's unit on every pass, in a permanent
/// delete/re-render flap.
fn is_mos_managed(file_name: &str) -> bool {
    file_name.starts_with("50-mos-")
        && (file_name.ends_with(".network") || file_name.ends_with(".netdev"))
}

/// The interface a swept `50-mos-<iface>.netdev` created, and nothing for any
/// other file.
///
/// The swept file names are the exact set of virtual devices this reconciler
/// is giving up, which is what makes them the exact set to delete.
fn mos_netdev_iface(file_name: &str) -> Option<&str> {
    file_name
        .strip_prefix("50-mos-")
        .and_then(|rest| rest.strip_suffix(".netdev"))
}

#[async_trait::async_trait]
impl<R: NetworkReload, D: LinkDelete> Reconciler for NetworkReconciler<R, D> {
    fn name(&self) -> &'static str {
        "network"
    }

    fn subtree(&self) -> &'static str {
        "network"
    }

    async fn apply(&self, settings: &Settings) -> anyhow::Result<serde_json::Value> {
        validate_network(&settings.network)?;
        let masters = bridge_ports(&settings.network);
        let children = vlan_children(&settings.network);
        std::fs::create_dir_all(&self.target_dir)?;
        let mut rendered = BTreeSet::new();
        let mut state = serde_json::Map::new();
        // Devices whose netdev properties changed. They apply at creation
        // only, so the device has to go and be built again.
        let mut recreate = BTreeSet::new();
        for (iface, cfg) in &settings.network {
            let file_name = format!("50-mos-{iface}.network");
            let unit = render_unit(
                iface,
                cfg,
                masters.get(iface.as_str()).copied(),
                children.get(iface.as_str()).map_or(&[][..], Vec::as_slice),
            );
            std::fs::write(self.target_dir.join(&file_name), unit)?;
            state.insert(
                iface.clone(),
                json!({ "file": file_name, "dhcp": cfg.dhcp }),
            );
            rendered.insert(file_name);
            if let Some(netdev) = render_netdev(iface, cfg) {
                let netdev_name = format!("50-mos-{iface}.netdev");
                let path = self.target_dir.join(&netdev_name);
                if std::fs::read_to_string(&path).is_ok_and(|previous| previous != netdev) {
                    recreate.insert(iface.clone());
                }
                std::fs::write(&path, netdev)?;
                rendered.insert(netdev_name);
            }
        }
        let mut torn_down = BTreeSet::new();
        for entry in std::fs::read_dir(&self.target_dir)? {
            let entry = entry?;
            let file_name = entry.file_name();
            let Some(file_name) = file_name.to_str() else {
                continue;
            };
            if is_mos_managed(file_name) && !rendered.contains(file_name) {
                if let Some(iface) = mos_netdev_iface(file_name) {
                    torn_down.insert(iface.to_string());
                }
                std::fs::remove_file(entry.path())?;
            }
        }
        // Before the reload, so networkd builds the recreated devices back on
        // the same pass that deleted them. A failure is logged and not
        // returned: the unit file is already gone, the usual cause is a device
        // that was never created, and failing the apply here would report
        // every interface that did converge as unconverged.
        for iface in torn_down.union(&recreate) {
            if let Err(error) = self.deleter.delete_link(iface).await {
                tracing::warn!(iface, %error, "could not delete network device");
            }
        }
        self.reloader.reload().await?;
        Ok(serde_json::Value::Object(state))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use mosd_settings::{BridgeConfig, StaticConfig, VlanConfig};

    use super::*;

    const GOLDEN_DHCP: &str = "[Match]\nName=eth0\n\n[Network]\nDHCP=yes\n";
    const GOLDEN_STATIC: &str = "[Match]\nName=eth1\n\n[Network]\n\
        Address=192.168.1.10/24\nGateway=192.168.1.1\nDNS=1.1.1.1\nDNS=9.9.9.9\n";
    const GOLDEN_EMPTY: &str = "[Match]\nName=eth2\n\n[Network]\n";
    const GOLDEN_VLAN_NETDEV: &str = "[NetDev]\nName=eth0.100\nKind=vlan\n\n[VLAN]\nId=100\n";
    const GOLDEN_VLAN_PARENT: &str =
        "[Match]\nName=eth0\n\n[Network]\nDHCP=yes\nVLAN=eth0.100\n";
    const GOLDEN_VLAN_CHILD: &str =
        "[Match]\nName=eth0.100\n\n[Network]\nAddress=192.168.100.2/24\n";
    const GOLDEN_BRIDGE_NETDEV: &str = "[NetDev]\nName=br0\nKind=bridge\n";
    const GOLDEN_BRIDGE_PORT: &str = "[Match]\nName=eth1\n\n[Network]\nBridge=br0\n";

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

    /// Recording [`LinkDelete`], so a test can say which devices the
    /// reconciler asked the kernel to drop, and where those requests sit
    /// against the reload.
    struct MockLink {
        calls: Arc<Mutex<Vec<String>>>,
    }

    #[async_trait::async_trait]
    impl LinkDelete for MockLink {
        async fn delete_link(&self, iface: &str) -> anyhow::Result<()> {
            self.calls.lock().unwrap().push(format!("del {iface}"));
            Ok(())
        }
    }

    /// A reconciler in `dir` whose reload and device deletions share one call
    /// log, so their order is part of what a test can assert.
    fn reconciler_in(
        dir: &std::path::Path,
    ) -> (
        NetworkReconciler<MockReload, MockLink>,
        Arc<Mutex<Vec<String>>>,
    ) {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let reconciler = NetworkReconciler::new(
            dir.to_path_buf(),
            MockReload {
                calls: Arc::clone(&calls),
            },
            MockLink {
                calls: Arc::clone(&calls),
            },
        );
        (reconciler, calls)
    }

    fn vlan_iface(parent: &str, id: u16) -> IfaceSettings {
        IfaceSettings {
            kind: IfaceKind::Vlan,
            dhcp: false,
            static_: Some(StaticConfig {
                address: "192.168.100.2/24".to_string(),
                gateway: None,
                dns: Vec::new(),
            }),
            vlan: Some(VlanConfig {
                parent: parent.to_string(),
                id,
            }),
            ..IfaceSettings::default()
        }
    }

    fn bridge_iface(ports: &[&str]) -> IfaceSettings {
        IfaceSettings {
            kind: IfaceKind::Bridge,
            dhcp: true,
            bridge: Some(BridgeConfig {
                ports: ports.iter().map(|port| (*port).to_string()).collect(),
            }),
            ..IfaceSettings::default()
        }
    }

    /// An entry with no addressing of its own, which is what a bridge port has
    /// to be.
    fn port_iface() -> IfaceSettings {
        IfaceSettings {
            dhcp: false,
            ..IfaceSettings::default()
        }
    }

    fn dhcp_iface() -> IfaceSettings {
        IfaceSettings {
            dhcp: true,
            ..IfaceSettings::default()
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
            ..IfaceSettings::default()
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
                ..IfaceSettings::default()
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

    #[tokio::test]
    async fn renders_a_vlan_netdev_and_names_the_child_in_its_parent() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, calls) = reconciler_in(dir.path());
        let settings = settings_with(&[
            ("eth0", dhcp_iface()),
            ("eth0.100", vlan_iface("eth0", 100)),
        ]);

        reconciler.apply(&settings).await.unwrap();

        let netdev = std::fs::read_to_string(dir.path().join("50-mos-eth0.100.netdev")).unwrap();
        let parent = std::fs::read_to_string(dir.path().join("50-mos-eth0.network")).unwrap();
        let child = std::fs::read_to_string(dir.path().join("50-mos-eth0.100.network")).unwrap();
        assert_eq!(netdev, GOLDEN_VLAN_NETDEV);
        // networkd creates the VLAN only because the parent's unit names it.
        assert_eq!(parent, GOLDEN_VLAN_PARENT);
        assert_eq!(child, GOLDEN_VLAN_CHILD);
        // A device that did not exist before is not deleted on the way in.
        assert_eq!(*calls.lock().unwrap(), vec!["reload".to_string()]);
    }

    #[tokio::test]
    async fn renders_a_bridge_netdev_and_gives_its_port_only_the_master() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _calls) = reconciler_in(dir.path());
        let settings =
            settings_with(&[("br0", bridge_iface(&["eth1"])), ("eth1", port_iface())]);

        reconciler.apply(&settings).await.unwrap();

        let netdev = std::fs::read_to_string(dir.path().join("50-mos-br0.netdev")).unwrap();
        let port = std::fs::read_to_string(dir.path().join("50-mos-eth1.network")).unwrap();
        let bridge = std::fs::read_to_string(dir.path().join("50-mos-br0.network")).unwrap();
        assert_eq!(netdev, GOLDEN_BRIDGE_NETDEV);
        assert_eq!(port, GOLDEN_BRIDGE_PORT);
        // The bridge itself carries the addressing its ports gave up.
        assert_eq!(bridge, "[Match]\nName=br0\n\n[Network]\nDHCP=yes\n");
        // A bridge has no netdev-less port file left behind and no VLAN line.
        assert!(!dir.path().join("50-mos-eth1.netdev").exists());
    }

    #[tokio::test]
    async fn deletes_the_kernel_device_of_a_removed_vlan() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, calls) = reconciler_in(dir.path());
        let with_vlan = settings_with(&[
            ("eth0", dhcp_iface()),
            ("eth0.100", vlan_iface("eth0", 100)),
        ]);
        reconciler.apply(&with_vlan).await.unwrap();

        reconciler
            .apply(&settings_with(&[("eth0", dhcp_iface())]))
            .await
            .unwrap();

        assert!(!dir.path().join("50-mos-eth0.100.netdev").exists());
        assert!(!dir.path().join("50-mos-eth0.100.network").exists());
        // The device is deleted BEFORE the reload, and the swept `.network`
        // asks for no deletion of its own: networkd would otherwise leave the
        // VLAN passing traffic until the next boot.
        assert_eq!(
            *calls.lock().unwrap(),
            vec![
                "reload".to_string(),
                "del eth0.100".to_string(),
                "reload".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn recreates_a_vlan_whose_id_changed() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, calls) = reconciler_in(dir.path());
        reconciler
            .apply(&settings_with(&[
                ("eth0", dhcp_iface()),
                ("eth0.100", vlan_iface("eth0", 100)),
            ]))
            .await
            .unwrap();

        reconciler
            .apply(&settings_with(&[
                ("eth0", dhcp_iface()),
                ("eth0.100", vlan_iface("eth0", 200)),
            ]))
            .await
            .unwrap();

        // Netdev properties are applied when the device is created, so a
        // rewritten file alone would leave the old id in the kernel.
        let netdev = std::fs::read_to_string(dir.path().join("50-mos-eth0.100.netdev")).unwrap();
        assert!(netdev.contains("Id=200"), "{netdev}");
        assert_eq!(
            *calls.lock().unwrap(),
            vec![
                "reload".to_string(),
                "del eth0.100".to_string(),
                "reload".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn reapplying_an_unchanged_vlan_deletes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, calls) = reconciler_in(dir.path());
        let settings = settings_with(&[
            ("eth0", dhcp_iface()),
            ("eth0.100", vlan_iface("eth0", 100)),
        ]);
        reconciler.apply(&settings).await.unwrap();

        reconciler.apply(&settings).await.unwrap();

        // A convergent reconcile that tore its own VLAN down every pass would
        // drop the link on every settings write in the tree.
        assert_eq!(
            *calls.lock().unwrap(),
            vec!["reload".to_string(), "reload".to_string()]
        );
    }

    #[tokio::test]
    async fn sweeps_a_stale_netdev_but_spares_a_foreign_one() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _calls) = reconciler_in(dir.path());
        std::fs::write(dir.path().join("50-mos-br9.netdev"), "stale").unwrap();
        std::fs::write(dir.path().join("70-vpn.netdev"), "foreign").unwrap();

        reconciler
            .apply(&settings_with(&[("eth0", dhcp_iface())]))
            .await
            .unwrap();

        assert!(!dir.path().join("50-mos-br9.netdev").exists());
        assert!(dir.path().join("70-vpn.netdev").exists());
    }

    #[tokio::test]
    async fn leaves_a_wireguard_entry_inert() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, calls) = reconciler_in(dir.path());
        let settings = settings_with(&[(
            "wg0",
            IfaceSettings {
                kind: IfaceKind::Wireguard,
                dhcp: false,
                wireguard: Some(mosd_settings::WireguardConfig::default()),
                ..IfaceSettings::default()
            },
        )]);

        reconciler.apply(&settings).await.unwrap();

        // The tunnel's unit carries a private-key path this milestone has
        // nowhere to get, so the entry renders exactly what a v7 entry renders
        // today: a `.network` matching a device nothing creates yet.
        assert!(!dir.path().join("50-mos-wg0.netdev").exists());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("50-mos-wg0.network")).unwrap(),
            "[Match]\nName=wg0\n\n[Network]\n"
        );
        assert_eq!(*calls.lock().unwrap(), vec!["reload".to_string()]);
    }

    #[tokio::test]
    async fn rejects_a_kind_whose_own_block_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, calls) = reconciler_in(dir.path());
        let settings = settings_with(&[(
            "eth0.100",
            IfaceSettings {
                kind: IfaceKind::Vlan,
                dhcp: true,
                ..IfaceSettings::default()
            },
        )]);

        let err = reconciler.apply(&settings).await.unwrap_err();

        assert!(err.to_string().contains("carries no vlan block"), "{err}");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        assert!(calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn rejects_a_block_that_does_not_match_the_kind() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _calls) = reconciler_in(dir.path());
        // A physical entry with bridge parameters is a statement about the
        // link that the render would silently drop.
        let settings = settings_with(&[
            (
                "eth0",
                IfaceSettings {
                    dhcp: true,
                    bridge: Some(BridgeConfig::default()),
                    ..IfaceSettings::default()
                },
            ),
            ("eth1", port_iface()),
        ]);

        let err = reconciler.apply(&settings).await.unwrap_err();

        assert!(
            err.to_string()
                .contains("is kind physical but carries a bridge block"),
            "{err}"
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn rejects_a_vlan_parent_that_is_not_declared() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _calls) = reconciler_in(dir.path());
        let settings = settings_with(&[("eth0.100", vlan_iface("eth9", 100))]);

        let err = reconciler.apply(&settings).await.unwrap_err();

        // Fail closed: the VLAN line lives in the parent's unit, so an
        // undeclared parent is a VLAN that would never come up.
        assert!(
            err.to_string()
                .contains("VLAN parent \"eth9\", which is not a declared network entry"),
            "{err}"
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn rejects_a_bridge_port_that_is_not_declared() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _calls) = reconciler_in(dir.path());
        let settings = settings_with(&[("br0", bridge_iface(&["eth9"]))]);

        let err = reconciler.apply(&settings).await.unwrap_err();

        assert!(
            err.to_string()
                .contains("bridge port \"eth9\", which is not a declared network entry"),
            "{err}"
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn rejects_a_bridge_port_that_carries_its_own_addressing() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _calls) = reconciler_in(dir.path());
        let settings =
            settings_with(&[("br0", bridge_iface(&["eth1"])), ("eth1", static_iface())]);

        let err = reconciler.apply(&settings).await.unwrap_err();

        // The port's `.network` is `Bridge=br0` and nothing else, so an
        // address on it is a value the render has no line for.
        assert!(
            err.to_string()
                .contains("must not carry addressing of its own"),
            "{err}"
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn rejects_a_port_two_bridges_both_claim() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _calls) = reconciler_in(dir.path());
        let settings = settings_with(&[
            ("br0", bridge_iface(&["eth1"])),
            ("br1", bridge_iface(&["eth1"])),
            ("eth1", port_iface()),
        ]);

        let err = reconciler.apply(&settings).await.unwrap_err();

        // One port, one `Bridge=` line: the second claim has to be an error
        // rather than whichever bridge the map iteration reached last.
        assert!(
            err.to_string()
                .contains("claimed as a port by both bridge br0 and bridge br1"),
            "{err}"
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
}
