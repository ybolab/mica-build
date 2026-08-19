//! Settings library for mosd.
//!
//! Provides the typed settings tree (schema v3), a Venus-style dot-path
//! get/set API, atomic TOML persistence on STATE, and a Bottlerocket-style
//! bidirectional migration framework.

#![forbid(unsafe_code)]

mod error;
mod migration;
mod model;
mod path;
mod store;

pub use error::SettingsError;
pub use migration::{
    MigrateV0ToV1, MigrateV1ToV2, MigrateV2ToV3, Migration, MigrationRegistry, migrate,
};
pub use model::{
    AccessSettings, ApMode, ConsoleSettings, DeviceCredentialSettings, IfaceSettings,
    ProvisioningSettings, ProvisioningState, SCHEMA_VERSION, Settings, SshSettings, StaticConfig,
    WebAdminSettings, WifiApSettings, WifiClientSettings, WifiNetwork, WifiSettings,
};
pub use path::json_path_get;
pub use store::{DEFAULT_PATH, Store};
