//! Settings schema for mosd.
//!
//! Stub: a later subtask owns the full schema.

#![forbid(unsafe_code)]

/// Persistent mosd settings tree.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Settings {
    pub schema_version: u32,
    pub hostname: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            hostname: "mos".to_string(),
        }
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
        assert_eq!(parsed.schema_version, 1);
        assert_eq!(parsed.hostname, "mos");
    }
}
