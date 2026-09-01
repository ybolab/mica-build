//! Shared fixture for the repository (signer), client (device) and root-
//! ceremony suites.
//!
//! Everything happens inside a `TempDir`: keys are generated per test and
//! thrown away, no fixture holds key material, no host state is touched and no
//! network access occurs (tough's default transport is filesystem-only here).
//! Each test binary compiles its own copy of this module, so everything in it
//! is used by every suite.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use rauc_sign::keys;
use rauc_sign::repo::{self, Expirations};
use tempfile::TempDir;

/// A verity root hash shaped like the real thing; the tool records it verbatim.
pub const VERITY_ROOT_HASH: &str =
    "5ac357600002400080000000000000055ac35760000240008000000000000005";

pub fn at(rfc3339: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(rfc3339)
        .expect("fixed test timestamp")
        .with_timezone(&Utc)
}

/// A `root.json` expiration far enough out that no test trips over it.
pub fn root_expiry() -> DateTime<Utc> {
    at("2099-01-01T00:00:00Z")
}

/// Every expiration far in the future, so only what a test deliberately expires
/// is expired.
pub fn valid_expirations() -> Expirations {
    Expirations {
        targets: at("2099-01-01T00:00:00Z"),
        snapshot: at("2099-01-01T00:00:00Z"),
        timestamp: at("2099-01-01T00:00:00Z"),
    }
}

pub struct Fixture {
    _dir: TempDir,
    pub repo: PathBuf,
    pub keys_dir: PathBuf,
    pub bundle: PathBuf,
    /// Copy of `root.json` taken at init, held OUTSIDE the repository. Verify
    /// requires an out-of-band root -- checking a repository against its own
    /// metadata/root.json proves only internal consistency -- so the tests
    /// model that distribution channel instead of reaching into the repo.
    pub trusted_root: PathBuf,
}

impl Fixture {
    /// Initializes a repository with a single fake `.raucb` target already added.
    pub async fn new() -> Self {
        let dir = TempDir::new().expect("tempdir");
        let repo = dir.path().join("repo");
        let keys_dir = dir.path().join("keys");
        let bundle = dir.path().join("update-1.0.0.raucb");
        fs::write(
            &bundle,
            b"not a real RAUC bundle, but it hashes just fine\n",
        )
        .expect("bundle");

        keys::generate(&keys_dir).expect("generate keys");
        repo::init(&repo, &keys_dir, 1, root_expiry(), valid_expirations())
            .await
            .expect("init");
        let trusted_root = dir.path().join("trusted-root.json");
        fs::copy(repo::metadata_dir(&repo).join("root.json"), &trusted_root)
            .expect("copy trusted root out of the repository");
        repo::add(
            &repo,
            &keys_dir,
            &bundle,
            VERITY_ROOT_HASH,
            repo::AddOptions {
                release_version: Some("1.0.0"),
                ..Default::default()
            },
            valid_expirations(),
        )
        .await
        .expect("add");

        Self {
            _dir: dir,
            repo,
            keys_dir,
            bundle,
            trusted_root,
        }
    }

    /// A scratch path beside the repository, for datastores and state files.
    #[must_use]
    pub fn scratch(&self, name: &str) -> PathBuf {
        self._dir.path().join(name)
    }
}

pub fn read_json(path: &Path) -> serde_json::Value {
    serde_json::from_slice(&fs::read(path).expect("read metadata")).expect("parse metadata")
}
