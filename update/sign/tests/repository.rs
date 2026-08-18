//! End-to-end tests for the phase-1 TUF repository tool.
//!
//! Everything happens inside a `TempDir`: keys are generated per test and thrown
//! away, no fixture holds key material, no host state is touched and no network
//! access occurs (tough's default transport is filesystem-only here).

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use mos_sign::keys;
use mos_sign::repo::{self, Expirations};
use tempfile::TempDir;

/// A verity root hash shaped like the real thing; the tool records it verbatim.
const VERITY_ROOT_HASH: &str = "5ac357600002400080000000000000055ac35760000240008000000000000005";

fn at(rfc3339: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(rfc3339)
        .expect("fixed test timestamp")
        .with_timezone(&Utc)
}

/// A `root.json` expiration far enough out that no test trips over it.
fn root_expiry() -> DateTime<Utc> {
    at("2099-01-01T00:00:00Z")
}

/// Every expiration far in the future, so only what a test deliberately expires
/// is expired.
fn valid_expirations() -> Expirations {
    Expirations {
        targets: at("2099-01-01T00:00:00Z"),
        snapshot: at("2099-01-01T00:00:00Z"),
        timestamp: at("2099-01-01T00:00:00Z"),
    }
}

struct Fixture {
    _dir: TempDir,
    repo: PathBuf,
    keys_dir: PathBuf,
    bundle: PathBuf,
}

impl Fixture {
    /// Initializes a repository with a single fake `.raucb` target already added.
    async fn new() -> Self {
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
        repo::add(
            &repo,
            &keys_dir,
            &bundle,
            None,
            VERITY_ROOT_HASH,
            Some("1.0.0"),
            valid_expirations(),
        )
        .await
        .expect("add");

        Self {
            _dir: dir,
            repo,
            keys_dir,
            bundle,
        }
    }

    fn trusted_root(&self) -> PathBuf {
        repo::metadata_dir(&self.repo).join("root.json")
    }

    async fn verify(&self) -> anyhow::Result<repo::VerifyReport> {
        repo::verify(&self.repo, &self.trusted_root(), None).await
    }
}

fn read_json(path: &Path) -> serde_json::Value {
    serde_json::from_slice(&fs::read(path).expect("read metadata")).expect("parse metadata")
}

#[tokio::test]
async fn roundtrip_init_add_sign_verify() {
    let fx = Fixture::new().await;

    let metadata = repo::metadata_dir(&fx.repo);
    for role in ["root", "targets", "snapshot", "timestamp"] {
        assert!(
            metadata.join(format!("{role}.json")).is_file(),
            "metadata/{role}.json must exist"
        );
    }

    // Targets are published under their hash-prefixed TUF filename.
    let targets_json = read_json(&metadata.join("targets.json"));
    let target = &targets_json["signed"]["targets"]["update-1.0.0.raucb"];
    let sha256 = target["hashes"]["sha256"].as_str().expect("sha256");
    assert!(
        repo::targets_dir(&fx.repo)
            .join(format!("{sha256}.update-1.0.0.raucb"))
            .is_file(),
        "target file must be hash-prefixed"
    );

    // The RAUC verity root hash and length are pinned in targets metadata.
    assert_eq!(
        target["custom"]["verityRootHash"].as_str(),
        Some(VERITY_ROOT_HASH)
    );
    assert_eq!(target["custom"]["releaseVersion"].as_str(), Some("1.0.0"));
    assert_eq!(
        target["length"].as_u64(),
        Some(fs::metadata(&fx.bundle).expect("bundle stat").len())
    );

    let report = fx.verify().await.expect("verify");
    assert_eq!(report.root_version, 1);
    assert_eq!(report.timestamp_version, 2);
    assert_eq!(report.targets, vec!["update-1.0.0.raucb".to_string()]);

    // Re-signing bumps timestamp and snapshot but leaves the repository valid.
    repo::resign(&fx.repo, &fx.keys_dir, None, None, valid_expirations())
        .await
        .expect("resign");
    let report = fx.verify().await.expect("verify after resign");
    assert_eq!(report.timestamp_version, 3);
}

#[tokio::test]
async fn tampered_target_file_is_rejected() {
    let fx = Fixture::new().await;
    let sha256 = read_json(&repo::metadata_dir(&fx.repo).join("targets.json"))["signed"]["targets"]
        ["update-1.0.0.raucb"]["hashes"]["sha256"]
        .as_str()
        .expect("sha256")
        .to_string();

    let path = repo::targets_dir(&fx.repo).join(format!("{sha256}.update-1.0.0.raucb"));
    let mut bytes = fs::read(&path).expect("read target");
    bytes[0] ^= 0xff;
    fs::write(&path, &bytes).expect("write tampered target");

    let err = fx.verify().await.expect_err("tampered target must fail");
    assert!(
        format!("{err:#}").contains("update-1.0.0.raucb"),
        "error should name the target: {err:#}"
    );
}

#[tokio::test]
async fn tampered_targets_metadata_is_rejected() {
    let fx = Fixture::new().await;
    let metadata = repo::metadata_dir(&fx.repo);

    // Edit the signed portion without re-signing.
    let path = metadata.join("targets.json");
    let mut targets = read_json(&path);
    targets["signed"]["targets"]["update-1.0.0.raucb"]["custom"]["verityRootHash"] =
        serde_json::Value::String("0".repeat(64));
    let edited = serde_json::to_vec_pretty(&targets).expect("serialize");
    fs::write(&path, &edited).expect("write");
    // The consistent-snapshot copy is what the client actually fetches.
    fs::write(metadata.join("2.targets.json"), &edited).expect("write versioned");

    let err = fx
        .verify()
        .await
        .expect_err("unsigned metadata edit must fail");
    // snapshot.json pins the sha256 of targets.json, so the edit is caught there
    // before the (also broken) targets signature is ever checked.
    let rendered = format!("{err:#}").to_lowercase();
    assert!(
        rendered.contains("targets.json")
            && (rendered.contains("hash mismatch") || rendered.contains("signature")),
        "error should reject targets.json: {rendered}"
    );
}

#[tokio::test]
async fn rolled_back_timestamp_is_rejected() {
    let fx = Fixture::new().await;
    let datastore = fx.repo.parent().expect("parent").join("datastore");

    repo::resign(&fx.repo, &fx.keys_dir, None, Some(5), valid_expirations())
        .await
        .expect("resign to timestamp v5");
    let report = repo::verify(&fx.repo, &fx.trusted_root(), Some(&datastore))
        .await
        .expect("verify v5");
    assert_eq!(report.timestamp_version, 5);

    // Publish an older, still validly signed timestamp.
    repo::resign(&fx.repo, &fx.keys_dir, None, Some(2), valid_expirations())
        .await
        .expect("resign to timestamp v2");
    let err = repo::verify(&fx.repo, &fx.trusted_root(), Some(&datastore))
        .await
        .expect_err("rollback must be rejected");
    assert!(
        format!("{err:#}").contains("previously fetched version 5"),
        "error should report the rollback: {err:#}"
    );
}

#[tokio::test]
async fn expired_timestamp_is_rejected() {
    let fx = Fixture::new().await;

    // Injected expiration in the past; nothing here reads the wall clock.
    let expired = Expirations {
        timestamp: at("2020-01-01T00:00:00Z"),
        ..valid_expirations()
    };
    repo::resign(&fx.repo, &fx.keys_dir, None, None, expired)
        .await
        .expect("resign with expired timestamp");

    let err = fx.verify().await.expect_err("expired timestamp must fail");
    assert!(
        format!("{err:#}").contains("expired"),
        "error should report expiry: {err:#}"
    );
}
