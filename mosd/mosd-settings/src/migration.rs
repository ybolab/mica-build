//! Bottlerocket-style bidirectional schema migrations over TOML documents.

use crate::error::SettingsError;

/// One schema migration step between adjacent versions.
///
/// `up` migrates a document from `target_version() - 1` to `target_version()`;
/// `down` reverses it.
pub trait Migration {
    /// Version this migration's `up` step produces.
    fn target_version(&self) -> u32;
    /// Migrate a document from `target_version() - 1` to `target_version()`.
    ///
    /// # Errors
    ///
    /// Returns [`SettingsError::Migration`] when the document cannot be migrated.
    fn up(&self, doc: &mut toml::Table) -> Result<(), SettingsError>;
    /// Migrate a document from `target_version()` back to `target_version() - 1`.
    ///
    /// # Errors
    ///
    /// Returns [`SettingsError::Migration`] when the document cannot be migrated.
    fn down(&self, doc: &mut toml::Table) -> Result<(), SettingsError>;
}

/// Ordered set of migrations able to walk a document between schema versions.
pub struct MigrationRegistry {
    migrations: Vec<Box<dyn Migration>>,
}

impl MigrationRegistry {
    /// Registry over `migrations`, ordered by target version.
    #[must_use]
    pub fn new(mut migrations: Vec<Box<dyn Migration>>) -> Self {
        migrations.sort_by_key(|migration| migration.target_version());
        Self { migrations }
    }

    /// Walk `doc` from schema version `from` to `to`, applying `up` steps
    /// ascending or `down` steps descending.
    ///
    /// # Errors
    ///
    /// Returns [`SettingsError::Migration`] when a required step is missing
    /// (version gap) or a step fails.
    pub fn migrate(&self, doc: &mut toml::Table, from: u32, to: u32) -> Result<(), SettingsError> {
        if from < to {
            for version in from + 1..=to {
                self.find(version)?.up(doc)?;
            }
        } else if from > to {
            for version in (to + 1..=from).rev() {
                self.find(version)?.down(doc)?;
            }
        }
        Ok(())
    }

    fn find(&self, target_version: u32) -> Result<&dyn Migration, SettingsError> {
        self.migrations
            .iter()
            .find(|migration| migration.target_version() == target_version)
            .map(Box::as_ref)
            .ok_or_else(|| {
                SettingsError::Migration(format!(
                    "no migration targeting schema version {target_version}"
                ))
            })
    }
}

impl Default for MigrationRegistry {
    /// Registry holding every migration shipped with this crate.
    fn default() -> Self {
        Self::new(vec![Box::new(MigrateV0ToV1), Box::new(MigrateV1ToV2)])
    }
}

/// Walk `doc` between schema versions using the built-in migrations.
///
/// # Errors
///
/// Returns [`SettingsError::Migration`] when a required step is missing or fails.
pub fn migrate(doc: &mut toml::Table, from: u32, to: u32) -> Result<(), SettingsError> {
    MigrationRegistry::default().migrate(doc, from, to)
}

/// v0 -> v1: v0 is a legacy document holding only `hostname`.
///
/// `up` stamps `schema_version = 1` and adds an empty `network` table when
/// absent; `down` removes both keys.
pub struct MigrateV0ToV1;

impl Migration for MigrateV0ToV1 {
    fn target_version(&self) -> u32 {
        1
    }

    fn up(&self, doc: &mut toml::Table) -> Result<(), SettingsError> {
        doc.insert("schema_version".to_string(), toml::Value::Integer(1));
        if !doc.contains_key("network") {
            doc.insert(
                "network".to_string(),
                toml::Value::Table(toml::Table::new()),
            );
        }
        Ok(())
    }

    fn down(&self, doc: &mut toml::Table) -> Result<(), SettingsError> {
        doc.remove("schema_version");
        doc.remove("network");
        Ok(())
    }
}

/// v1 -> v2: adds the webd-owned `access` subtree.
///
/// `up` stamps `schema_version = 2` and adds an empty `access` table when
/// absent; `down` removes the `access` key entirely. Rolling back to v1 drops
/// the web admin password, which is acceptable because v1 software has no
/// webd.
pub struct MigrateV1ToV2;

impl Migration for MigrateV1ToV2 {
    fn target_version(&self) -> u32 {
        2
    }

    fn up(&self, doc: &mut toml::Table) -> Result<(), SettingsError> {
        doc.insert("schema_version".to_string(), toml::Value::Integer(2));
        if !doc.contains_key("access") {
            doc.insert("access".to_string(), toml::Value::Table(toml::Table::new()));
        }
        Ok(())
    }

    fn down(&self, doc: &mut toml::Table) -> Result<(), SettingsError> {
        doc.insert("schema_version".to_string(), toml::Value::Integer(1));
        doc.remove("access");
        Ok(())
    }
}
