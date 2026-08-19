//! Typed settings tree (schema v3) and its dot-path accessors.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::error::SettingsError;
use crate::path::{json_path_get, json_path_set, split_path};

/// Current settings schema version written by this crate.
pub const SCHEMA_VERSION: u32 = 3;

/// Persistent mosd settings tree (schema v3).
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
        }
    }
}

/// Access control settings.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccessSettings {
    /// Web admin credentials; absent until webd sets them.
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

/// Web admin credentials, written by webd.
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
}

impl Default for SshSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 22,
            permit_root_login: true,
            password_authentication: true,
            listen_addresses: Vec::new(),
        }
    }
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
