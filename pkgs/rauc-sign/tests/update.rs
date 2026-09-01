//! End-to-end tests for the device-side update client: manifest publication,
//! compatibility selection, resumable HTTP download into a budgeted reserve,
//! metadata sync, and the offline lockbox import.
//!
//! Same isolation as the other suites (`common/mod.rs`): everything in a
//! `TempDir`, throwaway keys. The one addition is a loopback static HTTP
//! server (below) — bound to 127.0.0.1:0, serving only the test's own
//! `TempDir`, so no test touches an external network.

mod common;

use std::fs;
use std::path::{Path, PathBuf};

use common::{Fixture, VERITY_ROOT_HASH, at, read_json, valid_expirations};
use rauc_sign::repo::{
    self, CUSTOM_BOARD, CUSTOM_CHANNEL, CUSTOM_MANIFEST_FOR, CUSTOM_MANIFEST_SCHEMA_VERSION,
    CUSTOM_MANIFEST_TARGET, CUSTOM_PROFILE, CUSTOM_RELEASE_VERSION, Expirations,
};
use rauc_sign::update::{self, DeviceIdentity};

/// A loopback static file server with byte-range support, logging every
/// request's path and range start so a test can prove a resume actually
/// resumed.
mod server {
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::{TcpListener, TcpStream};
    use url::Url;

    /// `(request path, range start)` per request served.
    pub type RequestLog = Arc<Mutex<Vec<(String, Option<u64>)>>>;

    pub struct StaticServer {
        pub base: Url,
        pub requests: RequestLog,
    }

    pub async fn serve(root: PathBuf) -> StaticServer {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind loopback");
        let addr = listener.local_addr().expect("local addr");
        let requests = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&requests);
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let root = root.clone();
                let log = Arc::clone(&log);
                tokio::spawn(async move {
                    let _ = handle(stream, root, log).await;
                });
            }
        });
        StaticServer {
            base: Url::parse(&format!("http://{addr}/")).expect("base url"),
            requests,
        }
    }

    async fn handle(stream: TcpStream, root: PathBuf, log: RequestLog) -> std::io::Result<()> {
        let mut reader = BufReader::new(stream);
        let mut request_line = String::new();
        reader.read_line(&mut request_line).await?;
        let path = request_line
            .split_whitespace()
            .nth(1)
            .unwrap_or("/")
            .to_string();
        let mut range: Option<u64> = None;
        loop {
            let mut header = String::new();
            reader.read_line(&mut header).await?;
            let header = header.trim_end().to_ascii_lowercase();
            if header.is_empty() {
                break;
            }
            if let Some(value) = header.strip_prefix("range: bytes=") {
                range = value.trim_end_matches('-').parse().ok();
            }
        }
        log.lock().expect("request log").push((path.clone(), range));

        let mut stream = reader.into_inner();
        let rel = path.trim_start_matches('/');
        let file = root.join(rel);
        if rel.contains("..") || !file.is_file() {
            stream
                .write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await?;
            return stream.shutdown().await;
        }
        let bytes = std::fs::read(&file)?;
        match range {
            Some(start) if start as usize <= bytes.len() => {
                let body = &bytes[start as usize..];
                let head = format!(
                    "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                    body.len(),
                    start,
                    bytes.len().saturating_sub(1),
                    bytes.len()
                );
                stream.write_all(head.as_bytes()).await?;
                stream.write_all(body).await?;
            }
            _ => {
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    bytes.len()
                );
                stream.write_all(head.as_bytes()).await?;
                stream.write_all(&bytes).await?;
            }
        }
        stream.shutdown().await
    }
}

/// The identity of the device every test selects for, running 1.0.0.
fn identity() -> DeviceIdentity {
    DeviceIdentity {
        board: "cx3576".to_string(),
        profile: "prod".to_string(),
        version: "1.0.0".to_string(),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(ring::digest::digest(&ring::digest::SHA256, bytes))
}

struct Release<'a> {
    version: &'a str,
    board: &'a str,
    profile: &'a str,
    channel: &'a str,
    schema: u64,
}

/// Publishes one release — bundle plus manifest — and returns the bundle's
/// target name.
async fn publish_release(fx: &Fixture, release: &Release<'_>) -> String {
    let name = format!("mos-{}-{}.raucb", release.board, release.version);
    let bundle = fx.scratch(&format!("src-{name}"));
    let content = format!(
        "bundle bytes for {name} profile {} channel {}\n",
        release.profile, release.channel
    );
    fs::write(&bundle, &content).expect("write bundle");
    let manifest = fx.scratch(&format!("manifest-{name}.json"));
    fs::write(
        &manifest,
        serde_json::to_vec_pretty(&serde_json::json!({
            "schemaVersion": release.schema,
            "release": { "version": release.version, "channel": release.channel },
            "board": { "name": release.board, "profile": release.profile },
            "artifacts": [
                {
                    "filename": name,
                    "role": "bundle",
                    "bytes": content.len(),
                    "sha256": sha256_hex(content.as_bytes()),
                }
            ],
        }))
        .expect("manifest json"),
    )
    .expect("write manifest");
    repo::add(
        &fx.repo,
        &fx.keys_dir,
        &bundle,
        VERITY_ROOT_HASH,
        repo::AddOptions {
            name: Some(&name),
            manifest: Some(&manifest),
            ..Default::default()
        },
        valid_expirations(),
    )
    .await
    .expect("publish release");
    name
}

fn reason_for<'a>(selection: &'a update::Selection, name: &str) -> &'a str {
    selection
        .rejected
        .iter()
        .find(|(rejected, _)| rejected == name)
        .map(|(_, reason)| reason.as_str())
        .unwrap_or_else(|| panic!("{name} is not among the rejected candidates"))
}

/// `add --manifest` pins the manifest as its own target and stamps the
/// selection block on the bundle target — all of it signed metadata.
#[tokio::test]
async fn manifest_is_pinned_and_bundle_annotated() {
    let fx = Fixture::new().await;
    let name = publish_release(
        &fx,
        &Release {
            version: "1.1.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;

    let targets = read_json(&repo::metadata_dir(&fx.repo).join("targets.json"));
    let bundle = &targets["signed"]["targets"][&name];
    assert_eq!(bundle["custom"][CUSTOM_BOARD], "cx3576");
    assert_eq!(bundle["custom"][CUSTOM_PROFILE], "prod");
    assert_eq!(bundle["custom"][CUSTOM_CHANNEL], "stable");
    assert_eq!(bundle["custom"][CUSTOM_RELEASE_VERSION], "1.1.0");
    assert_eq!(bundle["custom"][CUSTOM_MANIFEST_SCHEMA_VERSION], 1);
    let manifest_name = format!("{name}.manifest.json");
    assert_eq!(
        bundle["custom"][CUSTOM_MANIFEST_TARGET],
        manifest_name.as_str()
    );

    let manifest = &targets["signed"]["targets"][&manifest_name];
    assert_eq!(manifest["custom"][CUSTOM_MANIFEST_FOR], name.as_str());
    assert!(
        manifest["hashes"]["sha256"].is_string(),
        "manifest sha256 pinned"
    );
    assert!(manifest["length"].is_u64(), "manifest length pinned");
}

/// A manifest that does not pin the bundle being published is refused: the
/// binding is the whole point of pinning it.
#[tokio::test]
async fn add_refuses_a_manifest_that_does_not_pin_the_bundle() {
    let fx = Fixture::new().await;
    let bundle = fx.scratch("other.raucb");
    fs::write(&bundle, b"bytes the manifest does not know\n").expect("bundle");
    let manifest = fx.scratch("manifest.json");
    fs::write(
        &manifest,
        serde_json::json!({
            "schemaVersion": 1,
            "release": { "version": "1.1.0", "channel": "stable" },
            "board": { "name": "cx3576", "profile": "prod" },
            "artifacts": [
                { "filename": "other.raucb", "role": "bundle", "bytes": 1,
                  "sha256": "0".repeat(64) }
            ],
        })
        .to_string(),
    )
    .expect("manifest");
    let err = repo::add(
        &fx.repo,
        &fx.keys_dir,
        &bundle,
        VERITY_ROOT_HASH,
        repo::AddOptions {
            manifest: Some(&manifest),
            ..Default::default()
        },
        valid_expirations(),
    )
    .await
    .expect_err("a manifest that does not list the bundle must be refused");
    assert!(
        format!("{err:#}").contains("binds nothing"),
        "refusal must say the binding is empty: {err:#}"
    );
}

/// The happy path: the newest compatible release wins, the older compatible
/// one is rejected as older, and the pre-manifest bundle is named as
/// unselectable.
#[tokio::test]
async fn check_selects_the_newest_compatible_release() {
    let fx = Fixture::new().await;
    let older = publish_release(
        &fx,
        &Release {
            version: "1.1.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;
    let newer = publish_release(
        &fx,
        &Release {
            version: "1.2.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;

    let selection = update::check(
        &fx.repo,
        &fx.trusted_root,
        &fx.scratch("state.json"),
        &identity(),
        "stable",
        false,
    )
    .await
    .expect("check");
    let selected = selection
        .selected
        .as_ref()
        .expect("a compatible release exists");
    assert_eq!(selected.name, newer);
    assert_eq!(selected.version, "1.2.0");
    assert!(!selected.downgrade);
    assert!(selected.length > 0);
    assert_eq!(
        selected.manifest_target.as_deref(),
        Some(format!("{newer}.manifest.json").as_str())
    );
    assert!(reason_for(&selection, &older).contains("older than the selected"));
    // The fixture's manifest-less bundle is named, not silently invisible.
    let legacy = fx
        .bundle
        .file_name()
        .and_then(|name| name.to_str())
        .expect("fixture bundle name");
    assert!(reason_for(&selection, legacy).contains("no release selection metadata"));
}

/// Every compatibility axis rejects with its own discriminating reason:
/// board, profile, channel, schema floor, and version.
#[tokio::test]
async fn check_rejects_by_board_profile_channel_schema_and_version() {
    let fx = Fixture::new().await;
    let wrong_board = publish_release(
        &fx,
        &Release {
            version: "1.1.0",
            board: "x64",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;
    let wrong_profile = publish_release(
        &fx,
        &Release {
            version: "1.2.0",
            board: "cx3576",
            profile: "dev",
            channel: "stable",
            schema: 1,
        },
    )
    .await;
    let wrong_channel = publish_release(
        &fx,
        &Release {
            version: "1.3.0",
            board: "cx3576",
            profile: "prod",
            channel: "development",
            schema: 1,
        },
    )
    .await;
    let wrong_schema = publish_release(
        &fx,
        &Release {
            version: "1.4.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 2,
        },
    )
    .await;
    let too_old = publish_release(
        &fx,
        &Release {
            version: "0.9.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;

    let selection = update::check(
        &fx.repo,
        &fx.trusted_root,
        &fx.scratch("state.json"),
        &identity(),
        "stable",
        false,
    )
    .await
    .expect("check");
    assert!(selection.selected.is_none(), "nothing is compatible");
    assert!(reason_for(&selection, &wrong_board).contains("board x64 does not match"));
    assert!(reason_for(&selection, &wrong_profile).contains("profile dev does not match"));
    assert!(
        reason_for(&selection, &wrong_channel)
            .contains("channel development is not the requested stable")
    );
    assert!(reason_for(&selection, &wrong_schema).contains("manifest schema version 2"));
    assert!(reason_for(&selection, &too_old).contains("version 0.9.0 is not newer"));
}

/// Rollback safety: an older release is never selected silently; the explicit
/// flag admits it and marks the candidate so the CLI logs the use.
#[tokio::test]
async fn downgrade_needs_the_explicit_flag() {
    let fx = Fixture::new().await;
    let old = publish_release(
        &fx,
        &Release {
            version: "0.9.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;

    let refused = update::check(
        &fx.repo,
        &fx.trusted_root,
        &fx.scratch("state.json"),
        &identity(),
        "stable",
        false,
    )
    .await
    .expect("check without the flag");
    assert!(refused.selected.is_none());
    assert!(reason_for(&refused, &old).contains("not newer than the running 1.0.0"));

    let admitted = update::check(
        &fx.repo,
        &fx.trusted_root,
        &fx.scratch("state.json"),
        &identity(),
        "stable",
        true,
    )
    .await
    .expect("check with --allow-downgrade");
    let selected = admitted.selected.expect("the downgrade is admitted");
    assert_eq!(selected.name, old);
    assert!(
        selected.downgrade,
        "an admitted downgrade is marked for logging"
    );
}

/// A fresh download lands verified in the reserve directory, and a second
/// fetch of the same target is an idempotent no-op.
#[tokio::test]
async fn fetch_downloads_verifies_and_is_idempotent() {
    let fx = Fixture::new().await;
    let name = publish_release(
        &fx,
        &Release {
            version: "1.1.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;
    let selection = update::check(
        &fx.repo,
        &fx.trusted_root,
        &fx.scratch("state.json"),
        &identity(),
        "stable",
        false,
    )
    .await
    .expect("check");
    let candidate = selection.selected.expect("selected");
    assert_eq!(candidate.name, name);

    let srv = server::serve(fx.repo.clone()).await;
    let reserve = fx.scratch("reserve");
    let report = update::fetch(&srv.base, &candidate, &reserve, 1024 * 1024)
        .await
        .expect("fetch");
    assert_eq!(report.resumed_from, 0);
    assert_eq!(report.fetched, candidate.length);
    assert_eq!(report.path, reserve.join(&name));
    let staged = fs::read(&report.path).expect("staged bundle");
    assert_eq!(sha256_hex(&staged), candidate.sha256);
    assert!(
        !reserve.join(format!("{name}.part")).exists(),
        "no partial left behind"
    );

    let again = update::fetch(&srv.base, &candidate, &reserve, 1024 * 1024)
        .await
        .expect("re-fetch");
    assert_eq!(
        again.fetched, 0,
        "an already-verified file is not re-downloaded"
    );
}

/// A correct partial is resumed with a range request, not re-downloaded.
#[tokio::test]
async fn fetch_resumes_from_a_partial() {
    let fx = Fixture::new().await;
    let name = publish_release(
        &fx,
        &Release {
            version: "1.1.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;
    let selection = update::check(
        &fx.repo,
        &fx.trusted_root,
        &fx.scratch("state.json"),
        &identity(),
        "stable",
        false,
    )
    .await
    .expect("check");
    let candidate = selection.selected.expect("selected");

    let full = fs::read(repo::targets_dir(&fx.repo).join(format!("{}.{}", candidate.sha256, name)))
        .expect("published bundle");
    let half = full.len() / 2;
    let reserve = fx.scratch("reserve");
    fs::create_dir_all(&reserve).expect("reserve");
    fs::write(reserve.join(format!("{name}.part")), &full[..half]).expect("seed partial");

    let srv = server::serve(fx.repo.clone()).await;
    let report = update::fetch(&srv.base, &candidate, &reserve, 1024 * 1024)
        .await
        .expect("resumed fetch");
    assert_eq!(report.resumed_from, half as u64);
    assert_eq!(report.fetched, (full.len() - half) as u64);
    assert_eq!(fs::read(&report.path).expect("staged"), full);
    let ranged = srv
        .requests
        .lock()
        .expect("log")
        .iter()
        .any(|(_, range)| *range == Some(half as u64));
    assert!(ranged, "the server must have been asked for bytes {half}-");
}

/// A corrupted partial cannot survive: the digest check fails, the partial is
/// deleted, and the message says both.
#[tokio::test]
async fn corrupted_partial_is_deleted_on_digest_mismatch() {
    let fx = Fixture::new().await;
    let name = publish_release(
        &fx,
        &Release {
            version: "1.1.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;
    let selection = update::check(
        &fx.repo,
        &fx.trusted_root,
        &fx.scratch("state.json"),
        &identity(),
        "stable",
        false,
    )
    .await
    .expect("check");
    let candidate = selection.selected.expect("selected");

    let reserve = fx.scratch("reserve");
    fs::create_dir_all(&reserve).expect("reserve");
    let part = reserve.join(format!("{name}.part"));
    fs::write(&part, vec![b'X'; candidate.length as usize / 2]).expect("corrupt partial");

    let srv = server::serve(fx.repo.clone()).await;
    let err = update::fetch(&srv.base, &candidate, &reserve, 1024 * 1024)
        .await
        .expect_err("a corrupted partial must not verify");
    let message = format!("{err:#}");
    assert!(
        message.contains("where the signed metadata pins")
            && message.contains("deleted the partial"),
        "the refusal must name the digest mismatch and the deletion: {message}"
    );
    assert!(!part.exists(), "the corrupt partial must be deleted");
    assert!(
        !reserve.join(&name).exists(),
        "nothing may appear under the final name"
    );
}

/// A tampered bundle on the mirror is refused by the digest check even though
/// every byte downloaded fine.
#[tokio::test]
async fn tampered_bundle_is_refused_and_partial_deleted() {
    let fx = Fixture::new().await;
    let name = publish_release(
        &fx,
        &Release {
            version: "1.1.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;
    let selection = update::check(
        &fx.repo,
        &fx.trusted_root,
        &fx.scratch("state.json"),
        &identity(),
        "stable",
        false,
    )
    .await
    .expect("check");
    let candidate = selection.selected.expect("selected");

    // Same length, different bytes: the length precheck passes, the digest
    // check is what must catch it.
    let published = repo::targets_dir(&fx.repo).join(format!("{}.{}", candidate.sha256, name));
    let mut bytes = fs::read(&published).expect("read bundle");
    bytes[0] ^= 0xff;
    fs::write(&published, &bytes).expect("tamper bundle");

    let srv = server::serve(fx.repo.clone()).await;
    let reserve = fx.scratch("reserve");
    let err = update::fetch(&srv.base, &candidate, &reserve, 1024 * 1024)
        .await
        .expect_err("a tampered bundle must not verify");
    let message = format!("{err:#}");
    assert!(
        message.contains("where the signed metadata pins"),
        "the refusal must name the digest mismatch: {message}"
    );
    assert!(
        !reserve.join(format!("{name}.part")).exists(),
        "the partial must be deleted"
    );
}

/// The byte budget refuses a download it cannot fit — whether the budget is
/// smaller than the bundle or already spent by other content.
#[tokio::test]
async fn fetch_refuses_to_exceed_the_byte_budget() {
    let fx = Fixture::new().await;
    let name = publish_release(
        &fx,
        &Release {
            version: "1.1.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;
    let selection = update::check(
        &fx.repo,
        &fx.trusted_root,
        &fx.scratch("state.json"),
        &identity(),
        "stable",
        false,
    )
    .await
    .expect("check");
    let candidate = selection.selected.expect("selected");
    let srv = server::serve(fx.repo.clone()).await;

    let reserve = fx.scratch("reserve");
    let err = update::fetch(&srv.base, &candidate, &reserve, candidate.length - 1)
        .await
        .expect_err("a budget below the bundle length must refuse");
    assert!(
        format!("{err:#}").contains("byte budget"),
        "the refusal must name the budget: {err:#}"
    );
    assert!(!reserve.join(&name).exists());
    assert!(!reserve.join(format!("{name}.part")).exists());

    // Enough for the bundle alone, but the reserve already holds other bytes.
    fs::create_dir_all(&reserve).expect("reserve");
    fs::write(reserve.join("previous.raucb"), vec![0u8; 8]).expect("existing content");
    let err = update::fetch(&srv.base, &candidate, &reserve, candidate.length + 7)
        .await
        .expect_err("existing content counts against the budget");
    assert!(format!("{err:#}").contains("byte budget"), "{err:#}");
}

/// Expired metadata fails `check` before any selection happens.
#[tokio::test]
async fn expired_metadata_is_refused() {
    let fx = Fixture::new().await;
    publish_release(
        &fx,
        &Release {
            version: "1.1.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;
    repo::resign(
        &fx.repo,
        &fx.keys_dir,
        None,
        None,
        false,
        Expirations {
            targets: at("2099-01-01T00:00:00Z"),
            snapshot: at("2099-01-01T00:00:00Z"),
            timestamp: at("2020-01-01T00:00:00Z"),
        },
    )
    .await
    .expect("publish with an expired timestamp");

    let err = update::check(
        &fx.repo,
        &fx.trusted_root,
        &fx.scratch("state.json"),
        &identity(),
        "stable",
        false,
    )
    .await
    .expect_err("expired metadata must fail the walk");
    assert!(
        format!("{err:#}").to_lowercase().contains("expir"),
        "the refusal must name the expiry: {err:#}"
    );
}

/// A validly signed but older repository is refused against the persistent
/// state — the same rollback protection `rauc-verify` holds, reached through
/// the update client's path.
#[tokio::test]
async fn rolled_back_metadata_is_refused() {
    let fx = Fixture::new().await;
    publish_release(
        &fx,
        &Release {
            version: "1.1.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;
    let old_copy = fx.scratch("repo-before-resign");
    copy_dir(&fx.repo, &old_copy);
    repo::resign(
        &fx.repo,
        &fx.keys_dir,
        None,
        None,
        false,
        valid_expirations(),
    )
    .await
    .expect("advance the repository");

    let state = fx.scratch("state.json");
    update::check(
        &fx.repo,
        &fx.trusted_root,
        &state,
        &identity(),
        "stable",
        false,
    )
    .await
    .expect("check at the advanced versions");
    let err = update::check(
        &old_copy,
        &fx.trusted_root,
        &state,
        &identity(),
        "stable",
        false,
    )
    .await
    .expect_err("the older copy is a rollback");
    assert!(
        format!("{err:#}").contains("refusing rollback"),
        "the refusal must name the rollback: {err:#}"
    );
}

/// `sync` mirrors the metadata over HTTP well enough that the verified walk,
/// selection and fetch all run against the mirror.
#[tokio::test]
async fn sync_then_check_then_fetch_from_a_mirror() {
    let fx = Fixture::new().await;
    let name = publish_release(
        &fx,
        &Release {
            version: "1.1.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;
    let srv = server::serve(fx.repo.clone()).await;

    let mirror = fx.scratch("mirror");
    let report = update::sync_metadata(&srv.base, &mirror)
        .await
        .expect("sync");
    assert_eq!(report.root_version, 1);
    assert_eq!(report.snapshot_version, 3);
    assert_eq!(report.targets_version, 3);

    let selection = update::check(
        &mirror,
        &fx.trusted_root,
        &fx.scratch("state.json"),
        &identity(),
        "stable",
        false,
    )
    .await
    .expect("check against the mirror");
    let candidate = selection.selected.expect("selected from mirrored metadata");
    assert_eq!(candidate.name, name);

    let reserve = fx.scratch("reserve");
    let fetched = update::fetch(&srv.base, &candidate, &reserve, 1024 * 1024)
        .await
        .expect("fetch the bundle the mirror selected");
    assert_eq!(
        sha256_hex(&fs::read(&fetched.path).expect("staged")),
        candidate.sha256
    );
}

/// A hostile "metadata" file larger than the cap is refused instead of
/// buffered.
#[tokio::test]
async fn sync_refuses_oversized_metadata() {
    let fx = Fixture::new().await;
    let doctored = fx.scratch("doctored-repo");
    copy_dir(&fx.repo, &doctored);
    fs::write(
        repo::metadata_dir(&doctored).join("timestamp.json"),
        vec![b'{'; 2 * 1024 * 1024],
    )
    .expect("oversized timestamp");

    let srv = server::serve(doctored).await;
    let err = update::sync_metadata(&srv.base, &fx.scratch("mirror"))
        .await
        .expect_err("an oversized metadata file must be refused");
    assert!(
        format!("{err:#}").contains("cap"),
        "the refusal must name the cap: {err:#}"
    );
}

/// The lockbox round trip: `rauc-sign lockbox` produces a directory that the
/// client walks like an online mirror, and `import` selects, verifies and
/// stages the bundle from it — fully offline.
#[tokio::test]
async fn lockbox_import_places_a_verified_bundle() {
    let fx = Fixture::new().await;
    let name = publish_release(
        &fx,
        &Release {
            version: "1.1.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;

    // A full lockbox is a complete repository: the release-side verifier
    // (which reads every listed target back) walks it whole.
    let full = fx.scratch("lockbox-full");
    repo::lockbox(&fx.repo, &full, &[]).expect("produce full lockbox");
    repo::verify(&full, &fx.trusted_root, None)
        .await
        .expect("a full lockbox verifies as a repository");

    // A partial lockbox still carries the complete (signed) metadata — it
    // cannot be re-signed offline — so it lists targets it does not carry;
    // `import` verifies exactly the target it selects.
    let lockbox = fx.scratch("lockbox");
    let carried =
        repo::lockbox(&fx.repo, &lockbox, std::slice::from_ref(&name)).expect("produce lockbox");
    assert_eq!(
        carried,
        vec![name.clone(), format!("{name}.manifest.json")],
        "a named bundle brings its pinned manifest along"
    );

    let state = fx.scratch("state.json");
    let selection = update::check(
        &lockbox,
        &fx.trusted_root,
        &state,
        &identity(),
        "stable",
        false,
    )
    .await
    .expect("check over the lockbox");
    let candidate = selection.selected.expect("selected from the lockbox");
    assert_eq!(candidate.name, name);

    let reserve = fx.scratch("reserve");
    let report = update::import_selected(
        &lockbox,
        &fx.trusted_root,
        &state,
        &candidate,
        &reserve,
        1024 * 1024,
    )
    .await
    .expect("import");
    assert_eq!(report.path, reserve.join(&name));
    assert_eq!(
        sha256_hex(&fs::read(&report.path).expect("staged")),
        candidate.sha256
    );
    assert!(!reserve.join(format!("{name}.part")).exists());
}

/// A tampered lockbox bundle is refused by the same verification as online.
#[tokio::test]
async fn import_refuses_a_tampered_lockbox() {
    let fx = Fixture::new().await;
    let name = publish_release(
        &fx,
        &Release {
            version: "1.1.0",
            board: "cx3576",
            profile: "prod",
            channel: "stable",
            schema: 1,
        },
    )
    .await;
    let lockbox = fx.scratch("lockbox");
    repo::lockbox(&fx.repo, &lockbox, &[]).expect("produce lockbox");

    let state = fx.scratch("state.json");
    let selection = update::check(
        &lockbox,
        &fx.trusted_root,
        &state,
        &identity(),
        "stable",
        false,
    )
    .await
    .expect("check over the lockbox");
    let candidate = selection.selected.expect("selected");

    let target_file = repo::targets_dir(&lockbox).join(format!("{}.{}", candidate.sha256, name));
    let mut bytes = fs::read(&target_file).expect("read lockbox bundle");
    bytes[0] ^= 0xff;
    fs::write(&target_file, &bytes).expect("tamper lockbox bundle");

    let reserve = fx.scratch("reserve");
    let err = update::import_selected(
        &lockbox,
        &fx.trusted_root,
        &state,
        &candidate,
        &reserve,
        1024 * 1024,
    )
    .await
    .expect_err("a tampered lockbox bundle must not import");
    assert!(
        format!("{err:#}").contains("inside the lockbox"),
        "the refusal must come from the lockbox verification: {err:#}"
    );
    assert!(!reserve.join(&name).exists(), "nothing may be staged");
}

/// `lockbox` refuses a target nothing signed pins.
#[tokio::test]
async fn lockbox_refuses_an_unlisted_target() {
    let fx = Fixture::new().await;
    let err = repo::lockbox(
        &fx.repo,
        &fx.scratch("lockbox"),
        &["ghost.raucb".to_string()],
    )
    .expect_err("an unlisted target must be refused");
    assert!(
        format!("{err:#}").contains("not listed"),
        "the refusal must say the target is unlisted: {err:#}"
    );
}

/// The device identity file: the three keys are read, and a file missing one
/// is refused rather than guessed around.
#[tokio::test]
async fn device_identity_env_file_is_read_and_enforced() {
    let fx = Fixture::new().await;
    let path = fx.scratch("release-identity.env");
    fs::write(
        &path,
        "# device identity\nBOARD=cx3576\nPROFILE=prod\nVERSION=1.0.0\n",
    )
    .expect("identity file");
    let id = DeviceIdentity::from_env_file(&path).expect("parse identity");
    assert_eq!(
        (id.board.as_str(), id.profile.as_str(), id.version.as_str()),
        ("cx3576", "prod", "1.0.0")
    );

    fs::write(&path, "BOARD=cx3576\nPROFILE=prod\n").expect("truncated identity");
    let err = DeviceIdentity::from_env_file(&path).expect_err("a missing key must be refused");
    assert!(
        format!("{err:#}").contains("VERSION"),
        "the refusal must name the missing key: {err:#}"
    );
}

/// The version ordering the rollback check rests on.
#[test]
fn version_ordering_is_numeric_per_component() {
    use std::cmp::Ordering::{Equal, Greater, Less};
    for (a, b, expected) in [
        ("1.2.0", "1.10.0", Less),
        ("1.10.0", "1.9.9", Greater),
        ("1.2", "1.2.0", Less),
        ("2.0.0", "2.0.0", Equal),
        ("10", "9", Greater),
    ] {
        assert_eq!(update::compare_versions(a, b), expected, "{a} vs {b}");
    }
}

/// Recursive directory copy, for snapshotting repositories mid-test.
fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).expect("create copy target");
    for entry in fs::read_dir(from).expect("read dir") {
        let entry = entry.expect("dir entry");
        let dest: PathBuf = to.join(entry.file_name());
        if entry.metadata().expect("metadata").is_dir() {
            copy_dir(&entry.path(), &dest);
        } else {
            fs::copy(entry.path(), &dest).expect("copy file");
        }
    }
}
