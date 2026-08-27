//! End-to-end tests for the phase-1 TUF repository tool (the signer side).
//!
//! The fixture and its isolation guarantees live in `common/mod.rs`, shared
//! with the phase-2 client suite in `client.rs`.

mod common;

use std::fs;

use common::{Fixture, VERITY_ROOT_HASH, at, read_json, root_expiry, valid_expirations};
use rauc_sign::keys;
use rauc_sign::repo;
use tempfile::TempDir;

/// Release-side offline verification of the fixture repository.
async fn verify(fx: &Fixture) -> anyhow::Result<repo::VerifyReport> {
    repo::verify(&fx.repo, &fx.trusted_root, None).await
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

    let report = verify(&fx).await.expect("verify");
    assert_eq!(report.root_version, 1);
    assert_eq!(report.timestamp_version, 2);
    assert_eq!(report.targets, vec!["update-1.0.0.raucb".to_string()]);

    // Re-signing bumps timestamp and snapshot but leaves the repository valid.
    repo::resign(
        &fx.repo,
        &fx.keys_dir,
        None,
        None,
        false,
        valid_expirations(),
    )
    .await
    .expect("resign");
    let report = verify(&fx).await.expect("verify after resign");
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

    let err = verify(&fx).await.expect_err("tampered target must fail");
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

    let err = verify(&fx)
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
    let datastore = fx.scratch("datastore");

    repo::resign(
        &fx.repo,
        &fx.keys_dir,
        None,
        Some(5),
        false,
        valid_expirations(),
    )
    .await
    .expect("resign to timestamp v5");
    let report = repo::verify(&fx.repo, &fx.trusted_root, Some(&datastore))
        .await
        .expect("verify v5");
    assert_eq!(report.timestamp_version, 5);

    // Publish an older, still validly signed timestamp. The signer refuses a
    // rollback unless told it is deliberate; this test's whole point is to
    // publish one so the CLIENT side can be shown to reject it, hence the flag.
    repo::resign(
        &fx.repo,
        &fx.keys_dir,
        None,
        Some(2),
        true,
        valid_expirations(),
    )
    .await
    .expect("resign to timestamp v2");
    let err = repo::verify(&fx.repo, &fx.trusted_root, Some(&datastore))
        .await
        .expect_err("rollback must be rejected");
    assert!(
        format!("{err:#}").contains("previously fetched version 5"),
        "error should report the rollback: {err:#}"
    );
}

/// The signer side of the rollback story: without `--allow-rollback`, an
/// explicit version below the published one is refused BEFORE anything is
/// written, so a fat-fingered `--timestamp-version` cannot quietly publish
/// metadata every client will reject.
#[tokio::test]
async fn explicit_version_rollback_requires_flag() {
    let fx = Fixture::new().await;

    repo::resign(
        &fx.repo,
        &fx.keys_dir,
        None,
        Some(5),
        false,
        valid_expirations(),
    )
    .await
    .expect("resign to timestamp v5");

    let err = repo::resign(
        &fx.repo,
        &fx.keys_dir,
        None,
        Some(2),
        false,
        valid_expirations(),
    )
    .await
    .expect_err("explicit rollback without the flag must be refused");
    assert!(
        format!("{err:#}").contains("--allow-rollback"),
        "error should name the escape hatch: {err:#}"
    );

    // The refusal must not have touched the repository.
    let report = verify(&fx).await.expect("repo still valid after refusal");
    assert_eq!(report.timestamp_version, 5);
}

/// A threshold above the per-role key count would sign metadata no set of
/// signatures can satisfy; `init` must refuse it rather than report success.
#[tokio::test]
async fn unsatisfiable_threshold_is_rejected() {
    let dir = TempDir::new().expect("tempdir");
    let repo = dir.path().join("repo");
    let keys_dir = dir.path().join("keys");
    keys::generate(&keys_dir).expect("generate keys");

    let err = repo::init(&repo, &keys_dir, 2, root_expiry(), valid_expirations())
        .await
        .expect_err("threshold 2 over 1 key per role must be refused");
    assert!(
        format!("{err:#}").contains("could never be satisfied"),
        "error should explain unsatisfiability: {err:#}"
    );
}

#[tokio::test]
async fn expired_timestamp_is_rejected() {
    let fx = Fixture::new().await;

    // Injected expiration in the past; nothing here reads the wall clock.
    let expired = repo::Expirations {
        timestamp: at("2020-01-01T00:00:00Z"),
        ..valid_expirations()
    };
    repo::resign(&fx.repo, &fx.keys_dir, None, None, false, expired)
        .await
        .expect("resign with expired timestamp");

    let err = verify(&fx).await.expect_err("expired timestamp must fail");
    assert!(
        format!("{err:#}").contains("expired"),
        "error should report expiry: {err:#}"
    );
}
