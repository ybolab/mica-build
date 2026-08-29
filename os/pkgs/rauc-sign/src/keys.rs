//! Ed25519 key generation and loading.
//!
//! Keys are stored as raw PKCS#8 v1 documents (`<role>.pk8`), the encoding
//! `tough::sign::parse_keypair` accepts for ed25519. Generated material is only
//! ever written to a gitignored directory; nothing in this crate reads or writes
//! key material inside the repository tree.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail, ensure};
use ring::rand::SystemRandom;
use ring::signature::Ed25519KeyPair;
use tough::key_source::{KeySource, LocalKeySource};

/// The four TUF top-level roles, one ed25519 key each.
pub const ROLES: [&str; 4] = ["root", "targets", "snapshot", "timestamp"];

/// Roles whose keys the release pipeline holds online.
///
/// `root` is deliberately absent: the root key is an offline key and is only
/// needed by `init` and by the root ceremonies that republish `root.json`.
pub const ONLINE_ROLES: [&str; 3] = ["targets", "snapshot", "timestamp"];

/// Path of the private key file for `role` inside `dir`.
#[must_use]
pub fn key_path(dir: &Path, role: &str) -> PathBuf {
    dir.join(format!("{role}.pk8"))
}

/// Generates one ed25519 key per top-level role into `dir`.
///
/// Existing files are never overwritten, so a stale key cannot be silently
/// replaced. Files are created mode 0600.
pub fn generate(dir: &Path) -> Result<Vec<PathBuf>> {
    generate_roles(dir, &ROLES)
}

/// Generates one ed25519 key for each of `roles` into `dir`.
///
/// Same refusal to overwrite, same 0600. A root rotation asks for `["root"]`
/// alone: the media that leaves a rotation ceremony carries one new offline
/// key, and writing three online keys beside it that the ceremony never uses
/// would put spare copies of the release host's keys on offline media, each
/// then needing its own destruction record.
pub fn generate_roles(dir: &Path, roles: &[&str]) -> Result<Vec<PathBuf>> {
    for role in roles {
        ensure!(
            ROLES.contains(role),
            "unknown role {role:?}; expected one of {}",
            ROLES.join(", ")
        );
    }
    fs::create_dir_all(dir).with_context(|| format!("create key directory {}", dir.display()))?;

    let mut written = Vec::new();
    for role in roles {
        let path = key_path(dir, role);
        if path.exists() {
            bail!(
                "{} already exists; refusing to overwrite key material",
                path.display()
            );
        }
        let rng = SystemRandom::new();
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&rng)
            .map_err(|e| anyhow::anyhow!("generate ed25519 key for {role}: {e}"))?;
        fs::write(&path, pkcs8.as_ref()).with_context(|| format!("write {}", path.display()))?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .with_context(|| format!("chmod 0600 {}", path.display()))?;
        written.push(path);
    }
    Ok(written)
}

/// Loads the key sources for `roles` from `dir`.
pub fn sources(dir: &Path, roles: &[&str]) -> Result<Vec<Box<dyn KeySource>>> {
    roles
        .iter()
        .map(|role| {
            let path = key_path(dir, role);
            if !path.is_file() {
                bail!(
                    "missing {role} key at {}; run `rauc-sign gen-dev-keys`",
                    path.display()
                );
            }
            Ok(Box::new(LocalKeySource { path }) as Box<dyn KeySource>)
        })
        .collect()
}
