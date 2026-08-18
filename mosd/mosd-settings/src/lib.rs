//! Settings library for mosd.
//!
//! Provides the typed settings tree (schema v2), a Venus-style dot-path
//! get/set API, atomic TOML persistence on STATE, and a Bottlerocket-style
//! bidirectional migration framework.

#![forbid(unsafe_code)]

mod error;
mod migration;
mod model;
mod path;
mod store;

pub use error::SettingsError;
pub use migration::{MigrateV0ToV1, MigrateV1ToV2, Migration, MigrationRegistry, migrate};
pub use model::{
    AccessSettings, IfaceSettings, SCHEMA_VERSION, Settings, StaticConfig, WebAdminSettings,
};
pub use path::json_path_get;
pub use store::{DEFAULT_PATH, Store};
