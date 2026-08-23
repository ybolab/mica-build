//! Settings library for mosd.
//!
//! Provides the typed settings tree (schema v4), a Venus-style dot-path
//! get/set API, atomic TOML persistence on STATE, and a Bottlerocket-style
//! bidirectional migration framework.

#![forbid(unsafe_code)]

mod authorized_key;
mod error;
mod migration;
mod model;
mod path;
mod store;

pub use authorized_key::{
    decode_base64, encode_base64_nopad, parse_authorized_key, validate_authorized_keys,
};
pub use error::SettingsError;
pub use migration::{
    MigrateV0ToV1, MigrateV1ToV2, MigrateV2ToV3, MigrateV3ToV4, MigrateV4ToV5, Migration,
    MigrationRegistry, migrate,
};
pub use model::{
    AccessSettings, ApMode, AuthorizedKey, ConsoleSettings, ContainerSettings,
    DeviceCredentialSettings, IfaceSettings, ProvisioningSettings, ProvisioningState,
    SCHEMA_VERSION, Settings, SshSettings, StaticConfig, WebAdminSettings, WifiApSettings,
    WifiClientSettings, WifiNetwork, WifiSettings,
};
pub use path::json_path_get;
pub use store::{DEFAULT_PATH, RollbackReport, Store};
