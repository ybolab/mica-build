//! End-to-end tests for the phase-2 device-side client (the verifier the
//! signer-side tests in `repository.rs` modelled their attacker scenarios
//! against).
//!
//! Same isolation as the signer suite (see `common/mod.rs`): everything in a
//! `TempDir`, throwaway keys, no network. Every `client::*` call here loads
//! the version state fresh from disk, so consecutive calls model consecutive
//! device restarts.

mod common;

use std::fs;
use std::num::NonZeroU64;
use std::path::PathBuf;

use common::{Fixture, at, read_json, valid_expirations};
use rauc_sign::client;
use rauc_sign::keys;
use rauc_sign::repo;
use ring::rand::SystemRandom;
use tough::editor::signed::SignedRole;
use tough::schema::{KeyHolder, RoleType, Root, Signed};

/// The persistent version state file, beside (not inside) the repository.
fn state_path(fx: &Fixture) -> PathBuf {
    fx.scratch("uptane-state.json")
}

/// The honest publish sequence — init, add, re-sign — verifies at every step,
/// and the persistent state follows the published versions.
#[tokio::test]
async fn honest_publish_sequence_verifies() {
    let fx = Fixture::new().await;
    let state = state_path(&fx);

    let report = client::verify_repository(&fx.repo, &fx.trusted_root, &state)
        .await
        .expect("verify after init+add");
    assert_eq!(report.root_version, 1);
    assert_eq!(report.targets_version, 2);
    assert_eq!(report.snapshot_version, 2);
    assert_eq!(report.timestamp_version, 2);
    assert_eq!(report.targets, vec!["update-1.0.0.raucb".to_string()]);

    // The state file recorded the verified versions.
    let recorded = read_json(&state);
    for role in ["targets", "snapshot", "timestamp"] {
        assert_eq!(recorded[role].as_u64(), Some(2), "state for {role}");
    }
    assert_eq!(recorded["root"].as_u64(), Some(1));

    // Re-verifying the same repository is not a rollback ("restart" with no
    // new publish must keep working).
    client::verify_repository(&fx.repo, &fx.trusted_root, &state)
        .await
        .expect("re-verify at the same versions");

    // An honest re-sign advances, and the state follows.
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
    let report = client::verify_repository(&fx.repo, &fx.trusted_root, &state)
        .await
        .expect("verify after resign");
    assert_eq!(report.timestamp_version, 3);
    assert_eq!(read_json(&state)["timestamp"].as_u64(), Some(3));
}

/// Target verification yields the verified local path, whose bytes are the
/// published bundle's bytes.
#[tokio::test]
async fn target_verification_reports_local_path() {
    let fx = Fixture::new().await;

    let path = client::verify_target(
        &fx.repo,
        &fx.trusted_root,
        &state_path(&fx),
        "update-1.0.0.raucb",
    )
    .await
    .expect("verify target");

    assert!(
        path.starts_with(repo::targets_dir(&fx.repo)),
        "verified path must be inside targets/: {}",
        path.display()
    );
    assert_eq!(
        fs::read(&path).expect("read verified path"),
        fs::read(&fx.bundle).expect("read original bundle"),
        "verified path must hold the published bytes"
    );
}

#[tokio::test]
async fn unknown_target_is_rejected() {
    let fx = Fixture::new().await;

    let err = client::verify_target(
        &fx.repo,
        &fx.trusted_root,
        &state_path(&fx),
        "no-such.raucb",
    )
    .await
    .expect_err("unlisted target must fail");
    assert!(
        format!("{err:#}").contains("not listed"),
        "error should say the target is unlisted: {err:#}"
    );
}

/// The client half of the rollback story the signer tests set up: a validly
/// signed older repository — published with `--allow-rollback` — is rejected
/// by a FRESH client call, i.e. the protection survives a restart because it
/// lives in the state file, not in process memory.
#[tokio::test]
async fn rollback_is_rejected_across_restarts() {
    let fx = Fixture::new().await;
    let state = state_path(&fx);

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
    let report = client::verify_repository(&fx.repo, &fx.trusted_root, &state)
        .await
        .expect("verify v5");
    assert_eq!(report.timestamp_version, 5);

    // Publish an older, still validly signed timestamp (the signer requires
    // the flag precisely because clients reject the result).
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

    let err = client::verify_repository(&fx.repo, &fx.trusted_root, &state)
        .await
        .expect_err("rollback must be rejected");
    let rendered = format!("{err:#}");
    assert!(
        rendered.contains("timestamp") && rendered.contains("previously verified version 5"),
        "error should name the role and the remembered version: {rendered}"
    );

    // A rejection must not advance the state: the remembered high-water mark
    // is still 5.
    assert_eq!(read_json(&state)["timestamp"].as_u64(), Some(5));
}

#[tokio::test]
async fn tampered_target_is_rejected() {
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

    let err = client::verify_target(
        &fx.repo,
        &fx.trusted_root,
        &state_path(&fx),
        "update-1.0.0.raucb",
    )
    .await
    .expect_err("tampered target must fail");
    assert!(
        format!("{err:#}").contains("update-1.0.0.raucb"),
        "error should name the target: {err:#}"
    );
}

/// An unsigned edit to targets metadata fails the walk: snapshot pins the
/// sha256 of targets.json, so the edit is caught even before the (also broken)
/// targets signature is checked.
#[tokio::test]
async fn unsigned_metadata_edit_is_rejected() {
    let fx = Fixture::new().await;
    let metadata = repo::metadata_dir(&fx.repo);

    let path = metadata.join("targets.json");
    let mut targets = read_json(&path);
    targets["signed"]["targets"]["update-1.0.0.raucb"]["custom"]["verityRootHash"] =
        serde_json::Value::String("0".repeat(64));
    let edited = serde_json::to_vec_pretty(&targets).expect("serialize");
    fs::write(&path, &edited).expect("write");
    fs::write(metadata.join("2.targets.json"), &edited).expect("write versioned");

    let err = client::verify_repository(&fx.repo, &fx.trusted_root, &state_path(&fx))
        .await
        .expect_err("unsigned metadata edit must fail");
    let rendered = format!("{err:#}").to_lowercase();
    assert!(
        rendered.contains("targets.json")
            && (rendered.contains("hash mismatch") || rendered.contains("signature")),
        "error should reject targets.json: {rendered}"
    );
}

#[tokio::test]
async fn expired_metadata_is_rejected() {
    let fx = Fixture::new().await;

    // Injected expiration in the past; nothing here reads the wall clock.
    let expired = repo::Expirations {
        timestamp: at("2020-01-01T00:00:00Z"),
        ..valid_expirations()
    };
    repo::resign(&fx.repo, &fx.keys_dir, None, None, false, expired)
        .await
        .expect("resign with expired timestamp");

    let err = client::verify_repository(&fx.repo, &fx.trusted_root, &state_path(&fx))
        .await
        .expect_err("expired timestamp must fail");
    assert!(
        format!("{err:#}").contains("expired"),
        "error should report expiry: {err:#}"
    );
}

/// A pinned root whose root role demands two signatures, carrying only one,
/// must be refused at the very start of the walk. The doctored root is built
/// with tough's own signing path because the signer (correctly) refuses to
/// produce an unsatisfiable threshold.
#[tokio::test]
async fn unmet_root_threshold_is_rejected() {
    let fx = Fixture::new().await;

    let mut root: Signed<Root> =
        serde_json::from_slice(&fs::read(&fx.trusted_root).expect("read trusted root"))
            .expect("parse trusted root");
    root.signed
        .roles
        .get_mut(&RoleType::Root)
        .expect("root role")
        .threshold = NonZeroU64::new(2).expect("nonzero");

    let root_keys = keys::sources(&fx.keys_dir, &["root"]).expect("root key source");
    let holder = KeyHolder::Root(root.signed.clone());
    let signed = SignedRole::new(root.signed, &holder, &root_keys, &SystemRandom::new())
        .await
        .expect("sign raised-threshold root with the single key");
    let pinned = fx.scratch("threshold-2-root.json");
    fs::write(&pinned, signed.buffer()).expect("write pinned root");

    let err = client::verify_repository(&fx.repo, &pinned, &state_path(&fx))
        .await
        .expect_err("one signature against threshold 2 must fail");
    assert!(
        format!("{err:#}").contains("threshold of 2 not met"),
        "error should report the unmet threshold: {err:#}"
    );
}
