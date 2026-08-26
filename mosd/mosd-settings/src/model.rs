//! Typed settings tree (schema v6) and its dot-path accessors.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::error::SettingsError;
use crate::path::{json_path_get, json_path_set, split_path};

/// Current settings schema version written by this crate.
pub const SCHEMA_VERSION: u32 = 6;

/// Persistent mosd settings tree (schema v6).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    /// Schema version of this tree; read-only through [`Settings::set`].
    pub schema_version: u32,
    /// System hostname.
    pub hostname: String,
    /// Per-interface network configuration, keyed by interface name.
    pub network: BTreeMap<String, IfaceSettings>,
    /// Access control settings.
    #[serde(default)]
    pub access: AccessSettings,
    /// First-boot self-provisioning status.
    #[serde(default)]
    pub provisioning: ProvisioningSettings,
    /// WiFi station and access-point settings.
    #[serde(default)]
    pub wifi: WifiSettings,
    /// Container engine policy.
    #[serde(default)]
    pub container: ContainerSettings,
    /// MQTT broker and bridge policy.
    #[serde(default)]
    pub mqtt: MqttSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            hostname: "mos".to_string(),
            network: BTreeMap::new(),
            access: AccessSettings::default(),
            provisioning: ProvisioningSettings::default(),
            wifi: WifiSettings::default(),
            container: ContainerSettings::default(),
            mqtt: MqttSettings::default(),
        }
    }
}

/// Container engine policy, reconciled by `ContainerReconciler`.
///
/// Named for the CAPABILITY, not the implementation: if the engine is ever
/// replaced, this key, its bus item and its apid pane are unchanged and only
/// the binaries move.
///
/// **Disabled by default, and false means nothing runs.** The engine is
/// daemonless -- there is no socket and no service to leave stopped -- so what
/// this switch actually gates is whether `/etc/containers/systemd` is bound
/// from STATE. Unbound, that path is the empty directory inside the read-only
/// verity root, Quadlet finds nothing to parse, and no container unit exists
/// to be started.
///
/// The default is false because of what true costs: mos does not build
/// rootless, so containers run root-capable, and
/// **turning this on grants root-equivalent capability to whatever can write a
/// `.container` file into STATE.** That is the switch's whole purpose, not a
/// side effect of it.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ContainerSettings {
    /// Whether the Quadlet directory is bound from STATE and container units
    /// may run.
    pub enabled: bool,
}

/// MQTT policy: the master switch for the broker and the bridge, and the
/// listener and credential policy the broker is rendered from.
///
/// **`enabled` is a master switch and nothing else.** False means neither the
/// broker nor the bridge runs: no `mos-mqtt-broker.service`, no
/// `mos-mqttd.service`. It validates nothing, and it depends on nothing below
/// it -- there is no combination of `listen` and `auth` that makes the switch
/// mean something other than "run both" or "run neither".
///
/// **`listen` and `auth` are a separate configuration, deliberately NOT
/// coupled to the switch.** No code may refuse to start on a listen/auth
/// combination. A broker bound off-host with `auth.enabled = false` is worth a
/// loud WARN in the journal and is not worth a gate: an operator who widened
/// the bind made a decision, and a daemon that answers it by quietly not
/// starting is a daemon whose reason for being down cannot be read anywhere.
///
/// The default is false because of what the fleet actually looks like: no
/// shipped device has a broker, so the bridge has never once connected -- it
/// has only ever retried. Defaulting to true would ship that retry loop under
/// a new name. Defaulting to false makes turning MQTT on the operator action
/// it has always been in practice, at the cost -- accepted deliberately -- of
/// fielded devices dropping the bridge until the switch is set.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct MqttSettings {
    /// Whether the broker and the bridge run at all.
    pub enabled: bool,
    /// Where the broker listens.
    pub listen: MqttListenSettings,
    /// Whether the broker demands credentials.
    pub auth: MqttAuthSettings,
}

/// Where the broker listens.
///
/// Loopback and the MQTT default port: the bridge is an on-device client, so
/// the reachable-by-default listener a wider bind would create is one nobody
/// asked for. Widening it is a deliberate operator edit, and -- see
/// [`MqttSettings`] -- nothing refuses to start because of what is here.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct MqttListenSettings {
    /// Address the broker binds.
    pub address: String,
    /// TCP port the broker listens on.
    pub port: u16,
}

impl Default for MqttListenSettings {
    fn default() -> Self {
        Self {
            address: "127.0.0.1".to_string(),
            port: 1883,
        }
    }
}

/// Whether the broker demands credentials from a connecting client.
///
/// **There is no username and no password here, and that absence is the
/// point.** mosd publishes the settings tree over `com.mos.Item1`, so a
/// credential in this struct would be a credential published to every client
/// that can call `GetItems`. The broker reads its accounts from
/// `/var/lib/mos/mqtt-broker-users.toml` on STATE instead, which is how the
/// device password is already handled: the tree carries the policy, the STATE
/// file carries the secret.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct MqttAuthSettings {
    /// Whether a client must authenticate to connect.
    pub enabled: bool,
}

/// Access control settings.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccessSettings {
    /// Web admin credentials; absent until apid sets them.
    #[serde(rename = "webAdmin", default, skip_serializing_if = "Option::is_none")]
    pub web_admin: Option<WebAdminSettings>,
    /// SSH channel policy.
    #[serde(default)]
    pub ssh: SshSettings,
    /// Local console policy.
    #[serde(default)]
    pub console: ConsoleSettings,
    /// Device credential metadata; never holds a plaintext secret.
    #[serde(default)]
    pub device: DeviceCredentialSettings,
}

/// Web admin credentials, written by apid.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WebAdminSettings {
    /// Argon2id password hash in PHC string format.
    pub password_hash: String,
}

/// SSH channel policy, reconciled into sshd configuration.
///
/// Disabled by default: `prod` images ship sshd but never open it without an
/// authenticated admin action (see `docs/design/access.md` section 5).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SshSettings {
    /// Whether sshd is started.
    pub enabled: bool,
    /// TCP port sshd listens on.
    pub port: u16,
    /// Whether the root account may log in; phase 1 has only that account.
    #[serde(rename = "permitRootLogin")]
    pub permit_root_login: bool,
    /// Whether password authentication is offered; phase 1 auth is the device
    /// password.
    #[serde(rename = "passwordAuthentication")]
    pub password_authentication: bool,
    /// Addresses sshd binds to; empty means every address.
    #[serde(rename = "listenAddresses")]
    pub listen_addresses: Vec<String>,
    /// Public keys rendered into the root account's `authorized_keys` file.
    ///
    /// Empty by default: a key baked into the signed rootfs would let whoever
    /// holds its private half into every device built from that image. Keys
    /// arrive one at a time through an authenticated admin action, and every
    /// entry must satisfy [`crate::validate_authorized_keys`] before it is
    /// rendered.
    ///
    /// Declared last so the TOML serializer emits this array of tables after
    /// every scalar key of `access.ssh`.
    #[serde(rename = "authorizedKeys")]
    pub authorized_keys: Vec<AuthorizedKey>,
}

impl Default for SshSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 22,
            permit_root_login: true,
            password_authentication: true,
            listen_addresses: Vec::new(),
            authorized_keys: Vec::new(),
        }
    }
}

/// One SSH public key authorized to log in.
///
/// The comment lives in its own field rather than inside `key` so that the
/// canonical key text is what duplicate detection runs on: two operators
/// pasting the same key under different labels must not end up with two
/// entries granting the same access.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorizedKey {
    /// Canonical single-line key text, `<type> <base64blob>`, with no comment.
    pub key: String,
    /// Operator-supplied label; absent when the key was pasted without one.
    #[serde(rename = "comment", default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/// Local console policy.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ConsoleSettings {
    /// Whether the tty3 root shell is started; only the `debug` image profile
    /// ships that shell at all.
    #[serde(rename = "shellEnabled")]
    pub shell_enabled: bool,
}

/// Device credential metadata.
///
/// Holds the hash of the per-device password and its revision, never the
/// password itself. Both stay `None`/`0` in a freshly built tree: a non-empty
/// default here would be a fleet-wide shared secret baked into the signed
/// rootfs.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DeviceCredentialSettings {
    /// Argon2id password hash in PHC string format; absent until first boot
    /// generates the credential.
    #[serde(
        rename = "passwordHash",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub password_hash: Option<String>,
    /// Revision of the stored credential, bumped on every regeneration.
    pub generation: u32,
}

/// First-boot self-provisioning status.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ProvisioningSettings {
    /// Whether first-boot provisioning has run to completion.
    pub state: ProvisioningState,
    /// Device identity assigned at first boot, lowercase hex.
    #[serde(rename = "deviceId", default, skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    /// Seeding revision that produced this tree.
    #[serde(rename = "seededGeneration")]
    pub seeded_generation: u32,
}

/// Stage of first-boot self-provisioning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProvisioningState {
    /// The device has not provisioned itself yet.
    #[default]
    Pending,
    /// First-boot provisioning finished; the tree is the device's own.
    Complete,
}

/// WiFi settings, reconciled by connd into wpa_supplicant and hostapd.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct WifiSettings {
    /// Station (uplink) configuration.
    pub client: WifiClientSettings,
    /// Access-point (provisioning) configuration.
    pub ap: WifiApSettings,
}

/// WiFi station configuration.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct WifiClientSettings {
    /// Whether the station role is started.
    pub enabled: bool,
    /// Interface the station role runs on.
    pub interface: String,
    /// Known networks, most preferred by `priority`.
    ///
    /// Written as a whole JSON array through the dot-path API; the path syntax
    /// has no array indexing.
    pub networks: Vec<WifiNetwork>,
}

impl Default for WifiClientSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            interface: "wlan0".to_string(),
            networks: Vec::new(),
        }
    }
}

/// One known WiFi network.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WifiNetwork {
    /// Network name.
    pub ssid: String,
    /// Pre-shared key; absent means an open network.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub psk: Option<String>,
    /// Whether the network hides its SSID.
    #[serde(default)]
    pub hidden: bool,
    /// Selection preference; higher wins.
    #[serde(default)]
    pub priority: i32,
}

/// WiFi access-point configuration used by the provisioning flow.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct WifiApSettings {
    /// When the access point runs.
    pub mode: ApMode,
    /// Interface the access point runs on.
    pub interface: String,
    /// Advertised SSID; absent means derive it from the device identity at
    /// render time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssid: Option<String>,
    /// Pre-shared key; absent means derive it from the device credential at
    /// render time. A fleet-wide constant default is forbidden
    /// (`docs/plan/PLAN-008.md` Part D auth note).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub psk: Option<String>,
    /// 2.4 GHz channel the access point uses.
    pub channel: u8,
    /// Regulatory domain the radio is configured for.
    #[serde(rename = "countryCode")]
    pub country_code: String,
    /// AP-side address in CIDR notation.
    pub address: String,
    /// Seconds without a usable uplink before the access point starts.
    #[serde(rename = "holdDownSeconds")]
    pub hold_down_seconds: u32,
    /// Seconds the access point stays up after an uplink is restored.
    #[serde(rename = "graceSeconds")]
    pub grace_seconds: u32,
}

impl Default for WifiApSettings {
    fn default() -> Self {
        Self {
            mode: ApMode::Off,
            interface: "wlan0".to_string(),
            ssid: None,
            psk: None,
            channel: 6,
            country_code: "US".to_string(),
            address: "192.168.4.1/24".to_string(),
            hold_down_seconds: 120,
            grace_seconds: 60,
        }
    }
}

/// When the WiFi access point runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApMode {
    /// Never.
    #[default]
    Off,
    /// Only while no usable uplink exists.
    Provisioning,
    /// Always, regardless of the uplink.
    Always,
}

/// Network configuration for a single interface.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IfaceSettings {
    /// Whether the interface acquires its address via DHCP.
    pub dhcp: bool,
    /// Static addressing, used when `dhcp` is false.
    #[serde(rename = "static", default, skip_serializing_if = "Option::is_none")]
    pub static_: Option<StaticConfig>,
}

/// Static addressing for a single interface.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StaticConfig {
    /// Interface address in CIDR notation, e.g. `"192.168.1.10/24"`.
    pub address: String,
    /// Default gateway address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gateway: Option<String>,
    /// DNS server addresses.
    #[serde(default)]
    pub dns: Vec<String>,
}

impl Settings {
    /// Read the node at `path` as JSON. `""` or `"."` return the whole tree.
    ///
    /// # Errors
    ///
    /// Returns [`SettingsError::NotFound`] when the path does not resolve.
    pub fn get(&self, path: &str) -> Result<Value, SettingsError> {
        let root = self.to_json()?;
        json_path_get(&root, path)
            .cloned()
            .ok_or_else(|| SettingsError::NotFound(path.to_string()))
    }

    /// Write `value` at `path`. `""` or `"."` replace the whole tree.
    ///
    /// Missing intermediate map entries are created (e.g. setting
    /// `network.eth1.dhcp` creates `eth1`), provided the resulting tree still
    /// deserializes into a valid [`Settings`]. On any error the settings are
    /// left unchanged.
    ///
    /// # Errors
    ///
    /// Returns [`SettingsError::ReadOnly`] for writes that would change
    /// `schema_version`, [`SettingsError::NotFound`] for malformed paths, and
    /// [`SettingsError::Validation`] when the value does not fit the tree.
    pub fn set(&mut self, path: &str, value: Value) -> Result<(), SettingsError> {
        let mut root = self.to_json()?;
        if path.is_empty() || path == "." {
            root = value;
        } else {
            let segments = split_path(path)?;
            if segments[0] == "schema_version" {
                return Err(SettingsError::ReadOnly(path.to_string()));
            }
            json_path_set(&mut root, &segments, value)?;
        }
        let candidate: Self =
            serde_json::from_value(root).map_err(|err| SettingsError::Validation {
                path: path.to_string(),
                message: err.to_string(),
            })?;
        if candidate.schema_version != self.schema_version {
            return Err(SettingsError::ReadOnly("schema_version".to_string()));
        }
        *self = candidate;
        Ok(())
    }

    fn to_json(&self) -> Result<Value, SettingsError> {
        serde_json::to_value(self).map_err(|err| SettingsError::Parse(err.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_roundtrips_via_toml() {
        let settings = Settings::default();
        let text = toml::to_string(&settings).unwrap();
        let parsed: Settings = toml::from_str(&text).unwrap();
        assert_eq!(parsed, settings);
        assert_eq!(parsed.schema_version, SCHEMA_VERSION);
        assert_eq!(parsed.hostname, "mos");
        assert!(parsed.network.is_empty());
        assert!(parsed.access.web_admin.is_none());
        assert_eq!(parsed.access.ssh, SshSettings::default());
        assert_eq!(parsed.access.console, ConsoleSettings::default());
        assert_eq!(parsed.access.device, DeviceCredentialSettings::default());
        assert_eq!(parsed.provisioning, ProvisioningSettings::default());
        assert_eq!(parsed.wifi, WifiSettings::default());
        assert_eq!(parsed.container, ContainerSettings::default());
        assert_eq!(parsed.mqtt, MqttSettings::default());
    }

    /// The MQTT defaults, spelled out: off, loopback, and no auth. The switch
    /// is what an operator turns on; the listener is what the broker is
    /// rendered from, and neither constrains the other.
    #[test]
    fn mqtt_defaults_are_off_and_loopback() {
        let settings = Settings::default();
        assert!(!settings.mqtt.enabled);
        assert_eq!(settings.mqtt.listen.address, "127.0.0.1");
        assert_eq!(settings.mqtt.listen.port, 1883);
        assert!(!settings.mqtt.auth.enabled);

        // No credential field exists in the subtree to be published over
        // `com.mos.Item1`; the broker's accounts live in a STATE file instead.
        let mqtt = toml::to_string(&settings.mqtt).unwrap();
        assert!(!mqtt.contains("password"), "{mqtt}");
        assert!(!mqtt.contains("username"), "{mqtt}");
    }

    #[test]
    fn no_secret_is_present_in_a_freshly_built_tree() {
        // A non-None default here would be a fleet-wide shared secret baked
        // into a byte-identical signed rootfs.
        let settings = Settings::default();
        assert_eq!(settings.access.device.password_hash, None);
        assert_eq!(settings.access.device.generation, 0);
        assert_eq!(settings.access.web_admin, None);
        assert_eq!(settings.wifi.ap.psk, None);
        assert_eq!(settings.wifi.ap.ssid, None);
        assert!(settings.wifi.client.networks.is_empty());
        assert_eq!(settings.provisioning.device_id, None);

        let text = toml::to_string(&settings).unwrap();
        assert!(
            !text.contains("psk"),
            "serialized tree must hold no key: {text}"
        );
        assert!(
            !text.contains("passwordHash"),
            "serialized tree must hold no credential: {text}"
        );
    }
}
