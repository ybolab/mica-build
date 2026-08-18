//! Typed settings tree (schema v1) and its dot-path accessors.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::error::SettingsError;
use crate::path::{json_path_get, json_path_set, split_path};

/// Current settings schema version written by this crate.
pub const SCHEMA_VERSION: u32 = 1;

/// Persistent mosd settings tree (schema v1).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    /// Schema version of this tree; read-only through [`Settings::set`].
    pub schema_version: u32,
    /// System hostname.
    pub hostname: String,
    /// Per-interface network configuration, keyed by interface name.
    pub network: BTreeMap<String, IfaceSettings>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            hostname: "mos".to_string(),
            network: BTreeMap::new(),
        }
    }
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
    }
}
