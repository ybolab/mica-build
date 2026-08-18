//! Atomic TOML persistence for the settings tree.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use crate::error::SettingsError;
use crate::migration::migrate;
use crate::model::{SCHEMA_VERSION, Settings};

/// Default on-disk location of the settings file.
pub const DEFAULT_PATH: &str = "/var/lib/mos/settings.toml";

/// TOML-backed settings store with atomic writes and load-time migrations.
#[derive(Debug, Clone)]
pub struct Store {
    path: PathBuf,
}

impl Store {
    /// Store backed by the file at `path`.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// Store backed by [`DEFAULT_PATH`].
    #[must_use]
    pub fn default_path() -> Self {
        Self::new(DEFAULT_PATH)
    }

    /// Load settings from disk.
    ///
    /// A missing file yields [`Settings::default`] without creating the file.
    /// An existing document is migrated to [`SCHEMA_VERSION`] before
    /// deserialization (a missing `schema_version` key means version 0).
    ///
    /// # Errors
    ///
    /// Returns [`SettingsError::Io`] on read failures, [`SettingsError::Parse`]
    /// on invalid TOML, and [`SettingsError::Migration`] when the document's
    /// version cannot be walked to [`SCHEMA_VERSION`].
    pub fn load(&self) -> Result<Settings, SettingsError> {
        let text = match fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Settings::default()),
            Err(err) => return Err(err.into()),
        };
        let mut doc: toml::Table = text
            .parse()
            .map_err(|err: toml::de::Error| SettingsError::Parse(err.to_string()))?;
        let from = match doc.get("schema_version") {
            None => 0,
            Some(toml::Value::Integer(version)) => u32::try_from(*version).map_err(|_| {
                SettingsError::Parse(format!("schema_version {version} out of range"))
            })?,
            Some(other) => {
                return Err(SettingsError::Parse(format!(
                    "schema_version must be an integer, got {other}"
                )));
            }
        };
        if from > SCHEMA_VERSION {
            return Err(SettingsError::Migration(format!(
                "on-disk schema_version {from} is newer than supported {SCHEMA_VERSION}"
            )));
        }
        migrate(&mut doc, from, SCHEMA_VERSION)?;
        let migrated =
            toml::to_string(&doc).map_err(|err| SettingsError::Parse(err.to_string()))?;
        toml::from_str(&migrated).map_err(|err| SettingsError::Parse(err.to_string()))
    }

    /// Persist `settings` atomically: write to a temp file in the target
    /// directory, fsync it, rename it over the target, then fsync the
    /// directory.
    ///
    /// # Errors
    ///
    /// Returns [`SettingsError::Io`] on filesystem failures and
    /// [`SettingsError::Parse`] when serialization fails.
    pub fn save(&self, settings: &Settings) -> Result<(), SettingsError> {
        let parent = match self.path.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => parent,
            _ => Path::new("."),
        };
        fs::create_dir_all(parent)?;
        let text =
            toml::to_string(settings).map_err(|err| SettingsError::Parse(err.to_string()))?;
        let mut temp = tempfile::NamedTempFile::new_in(parent)?;
        temp.write_all(text.as_bytes())?;
        temp.flush()?;
        temp.as_file().sync_all()?;
        temp.persist(&self.path).map_err(|err| err.error)?;
        File::open(parent)?.sync_all()?;
        Ok(())
    }
}
