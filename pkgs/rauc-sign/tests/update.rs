//! End-to-end tests for the device-side update client: manifest publication,
//! compatibility selection, the `/mos/updates` workspace and its readiness
//! probe, resumable HTTP download under a byte budget, metadata sync, and the
//! offline lockbox import.
//!
//! Same isolation as the other suites (`common/mod.rs`): everything in a
//! `TempDir`, throwaway keys. Two additions: a loopback static HTTP server
//! (below) — bound to 127.0.0.1:0, serving only the test's own `TempDir`, so
//! no test touches an external network — and a workspace laid out in the
//! `TempDir` whose mount table is a fixture file ([`laid_out`]), because a
//! test cannot mount a filesystem and the probe's mount checks are exactly
//! the part that must be exercised against tables it did not write itself.

mod common;

use std::fs;
use std::path::{Path, PathBuf};

use common::{Fixture, VERITY_ROOT_HASH, at, read_json, valid_expirations};
use rauc_sign::repo::{
    self, CUSTOM_BOARD, CUSTOM_CHANNEL, CUSTOM_MANIFEST_FOR, CUSTOM_MANIFEST_SCHEMA_VERSION,
    CUSTOM_MANIFEST_TARGET, CUSTOM_PROFILE, CUSTOM_RELEASE_VERSION, Expirations,
};
use rauc_sign::update::{self, Candidate, DeviceIdentity};
use rauc_sign::workspace::{self, Status, UnreadyKind, Workspace};

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
        serve_with(root, None).await
    }

    /// A server that announces the full body length but closes the
    /// connection after `truncate_after` bytes of it — a link dropping
    /// mid-download.
    pub async fn serve_truncated(root: PathBuf, truncate_after: usize) -> StaticServer {
        serve_with(root, Some(truncate_after)).await
    }

    async fn serve_with(root: PathBuf, truncate_after: Option<usize>) -> StaticServer {
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
                    let _ = handle(stream, root, log, truncate_after).await;
                });
            }
        });
        StaticServer {
            base: Url::parse(&format!("http://{addr}/")).expect("base url"),
            requests,
        }
    }

    async fn handle(
        stream: TcpStream,
        root: PathBuf,
        log: RequestLog,
        truncate_after: Option<usize>,
    ) -> std::io::Result<()> {
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
        let sent = |body: &[u8]| -> Vec<u8> {
            match truncate_after {
                Some(keep) => body[..keep.min(body.len())].to_vec(),
                None => body.to_vec(),
            }
        };
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
                stream.write_all(&sent(body)).await?;
            }
            _ => {
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    bytes.len()
                );
                stream.write_all(head.as_bytes()).await?;
                stream.write_all(&sent(&bytes)).await?;
            }
        }
        stream.shutdown().await
    }
}

/// A mount table with the DATA pool at /mnt/data and `namespace` as a bind
/// of its `/mos` subtree (PLAN-063), beside the tiers that are not DATA.
fn mount_table(namespace: &Path, namespace_line: Option<&str>) -> String {
    let ns = namespace.display();
    let namespace_line = namespace_line
        .map(str::to_string)
        .unwrap_or_else(|| format!("34 21 179:7 /mos {ns} rw,noatime - ext4 /dev/data rw,noatime"));
    format!(
        "21 1 0:20 / / ro,relatime - ext4 /dev/dm-0 ro,errors=remount-ro\n\
         30 21 0:25 / /run rw,nosuid,nodev - tmpfs tmpfs rw,size=204800k\n\
         31 21 179:5 / /var rw,noatime - ext4 /dev/mmcblk0p5 rw,noatime\n\
         32 21 179:6 /mos /var/lib/mos rw,noatime - ext4 /dev/mmcblk0p6 rw,noatime\n\
         33 21 179:7 / /mnt/data rw,noatime - ext4 /dev/data rw,noatime\n\
         {namespace_line}\n"
    )
}

/// A laid-out workspace under `<scratch>/<name>/mos/updates`, with a mount
/// table declaring `<scratch>/<name>/mos` as a DATA mount: what
/// `mos-data-layout` plus `mos.mount` leave behind on a device.
fn laid_out(fx: &Fixture, name: &str) -> Workspace {
    let namespace = fx.scratch(name).join("mos");
    let root = namespace.join("updates");
    for dir in ["downloads", "verified", "staging"] {
        fs::create_dir_all(root.join(dir)).expect("lay out the workspace");
    }
    let table = fx.scratch(&format!("{name}.mountinfo"));
    fs::write(&table, mount_table(&namespace, None)).expect("write mount table");
    Workspace::at(root, table).expect("workspace")
}

/// Rewrite a workspace's mount table with a different line for its namespace
/// (`None` drops the line: not mounted at all).
fn set_namespace_mount(ws: &Workspace, table: &Path, line: Option<&str>) {
    let text = mount_table(ws.namespace(), Some(line.unwrap_or("")));
    fs::write(table, text).expect("rewrite mount table");
}

/// Publish one release and select it: the candidate every acquisition test
/// starts from.
async fn published_candidate(fx: &Fixture) -> (String, Candidate) {
    let name = publish_release(
        fx,
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
    (name, candidate)
}

/// Names of the entries directly inside `dir`, sorted; empty when absent.
fn entries(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = match fs::read_dir(dir) {
        Ok(read) => read
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect(),
        Err(_) => Vec::new(),
    };
    names.sort();
    names
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
    let ws = laid_out(&fx, "ws");
    let report = update::fetch(&srv.base, &candidate, &ws, None, 1024 * 1024)
        .await
        .expect("fetch");
    assert_eq!(report.resumed_from, 0);
    assert_eq!(report.fetched, candidate.length);
    assert_eq!(report.path, ws.verified().join(&name));
    let staged = fs::read(&report.path).expect("staged bundle");
    assert_eq!(sha256_hex(&staged), candidate.sha256);
    assert_eq!(
        entries(&ws.downloads()),
        Vec::<String>::new(),
        "no partial left behind"
    );
    assert_eq!(
        entries(&ws.staging()),
        Vec::<String>::new(),
        "no probe file left behind"
    );

    let again = update::fetch(&srv.base, &candidate, &ws, None, 1024 * 1024)
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
    let ws = laid_out(&fx, "ws");
    fs::write(ws.downloads().join(format!("{name}.part")), &full[..half]).expect("seed partial");

    let srv = server::serve(fx.repo.clone()).await;
    let report = update::fetch(&srv.base, &candidate, &ws, None, 1024 * 1024)
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

    let ws = laid_out(&fx, "ws");
    let part = ws.downloads().join(format!("{name}.part"));
    fs::write(&part, vec![b'X'; candidate.length as usize / 2]).expect("corrupt partial");

    let srv = server::serve(fx.repo.clone()).await;
    let err = update::fetch(&srv.base, &candidate, &ws, None, 1024 * 1024)
        .await
        .expect_err("a corrupted partial must not verify");
    let message = format!("{err:#}");
    assert!(
        message.contains("where the signed metadata pins")
            && message.contains("deleted the partial"),
        "the refusal must name the digest mismatch and the deletion: {message}"
    );
    assert!(!part.exists(), "the corrupt partial must be deleted");
    assert_eq!(
        entries(&ws.verified()),
        Vec::<String>::new(),
        "nothing may appear in verified/"
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
    let ws = laid_out(&fx, "ws");
    let err = update::fetch(&srv.base, &candidate, &ws, None, 1024 * 1024)
        .await
        .expect_err("a tampered bundle must not verify");
    let message = format!("{err:#}");
    assert!(
        message.contains("where the signed metadata pins"),
        "the refusal must name the digest mismatch: {message}"
    );
    assert!(
        !ws.downloads().join(format!("{name}.part")).exists(),
        "the partial must be deleted"
    );
    assert_eq!(entries(&ws.verified()), Vec::<String>::new());
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

    let ws = laid_out(&fx, "ws");
    let err = update::fetch(&srv.base, &candidate, &ws, None, candidate.length - 1)
        .await
        .expect_err("a budget below the bundle length must refuse");
    assert!(
        format!("{err:#}").contains("byte budget"),
        "the refusal must name the budget: {err:#}"
    );
    assert!(!ws.verified().join(&name).exists());
    assert!(!ws.downloads().join(format!("{name}.part")).exists());

    // Enough for the bundle alone, but the workspace already holds other
    // bytes — in verified/, which counts like every other directory of it.
    fs::write(ws.verified().join("previous.raucb"), vec![0u8; 8]).expect("existing content");
    let err = update::fetch(&srv.base, &candidate, &ws, None, candidate.length + 7)
        .await
        .expect_err("existing content counts against the budget");
    assert!(format!("{err:#}").contains("byte budget"), "{err:#}");
    assert!(
        srv.requests.lock().expect("log").is_empty(),
        "a budget refusal happens before any byte is asked for"
    );
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

    let ws = laid_out(&fx, "ws");
    let fetched = update::fetch(&srv.base, &candidate, &ws, None, 1024 * 1024)
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

    let ws = laid_out(&fx, "ws");
    let report = update::import_selected(
        &lockbox,
        &fx.trusted_root,
        &state,
        &candidate,
        &ws,
        1024 * 1024,
    )
    .await
    .expect("import");
    assert_eq!(report.path, ws.verified().join(&name));
    assert_eq!(
        sha256_hex(&fs::read(&report.path).expect("staged")),
        candidate.sha256
    );
    // The copy went through staging/ and left nothing there; downloads/ is
    // for resumable partials and an import never has one.
    assert_eq!(entries(&ws.staging()), Vec::<String>::new());
    assert_eq!(entries(&ws.downloads()), Vec::<String>::new());
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

    let ws = laid_out(&fx, "ws");
    let err = update::import_selected(
        &lockbox,
        &fx.trusted_root,
        &state,
        &candidate,
        &ws,
        1024 * 1024,
    )
    .await
    .expect_err("a tampered lockbox bundle must not import");
    assert!(
        format!("{err:#}").contains("inside the lockbox"),
        "the refusal must come from the lockbox verification: {err:#}"
    );
    assert!(!ws.verified().join(&name).exists(), "nothing may be staged");
    assert_eq!(entries(&ws.staging()), Vec::<String>::new());
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

/// The production contract, stated where a reader of this suite looks for
/// it: the workspace is `/mos/updates`, partials live in its `downloads/`,
/// verified bundles in its `verified/`, and no reserve directory outside
/// `downloads/` is accepted — the test override relocates the workspace,
/// never a part of it.
#[tokio::test]
async fn the_reserve_directory_is_inside_downloads_or_refused() {
    assert_eq!(workspace::DEFAULT_ROOT, "/mos/updates");
    let production = Workspace::at(PathBuf::from(workspace::DEFAULT_ROOT), PathBuf::from("/x"))
        .expect("production workspace");
    assert_eq!(
        production.reserve_dir(None).expect("default"),
        PathBuf::from("/mos/updates/downloads")
    );
    assert_eq!(
        production.verified(),
        PathBuf::from("/mos/updates/verified")
    );
    for outside in [
        "/var/lib/mos/update/reserve",
        "/var/tmp/updates",
        "/tmp/updates",
        "/srv/updates",
        "/mos/updates",
        "/mos/updates/verified",
        "/mos/updates/staging",
        "/mos/updates/downloads/../verified",
        "relative/downloads",
    ] {
        let err = production
            .reserve_dir(Some(Path::new(outside)))
            .expect_err(outside);
        assert!(
            format!("{err:#}").contains("outside"),
            "{outside}: the refusal must say the directory is outside: {err:#}"
        );
    }
    assert_eq!(
        production
            .reserve_dir(Some(Path::new("/mos/updates/downloads/sub")))
            .expect("a subdirectory of downloads/"),
        PathBuf::from("/mos/updates/downloads/sub")
    );

    // Through `fetch`: the refusal comes before any byte is asked for, and
    // nothing is written anywhere.
    let fx = Fixture::new().await;
    let (name, candidate) = published_candidate(&fx).await;
    let srv = server::serve(fx.repo.clone()).await;
    let ws = laid_out(&fx, "ws");
    let elsewhere = fx.scratch("elsewhere");
    let err = update::fetch(&srv.base, &candidate, &ws, Some(&elsewhere), 1024 * 1024)
        .await
        .expect_err("a reserve directory outside downloads/ must be refused");
    assert!(format!("{err:#}").contains("outside"), "{err:#}");
    assert!(
        !elsewhere.exists(),
        "nothing may be created outside the workspace"
    );
    assert!(srv.requests.lock().expect("log").is_empty());
    assert_eq!(entries(&ws.verified()), Vec::<String>::new());

    // A subdirectory of downloads/ is admitted: the partial lives there, the
    // verified bundle still lands in verified/.
    let sub = ws.downloads().join("sub");
    let report = update::fetch(&srv.base, &candidate, &ws, Some(&sub), 1024 * 1024)
        .await
        .expect("fetch into a subdirectory of downloads/");
    assert_eq!(report.path, ws.verified().join(&name));
    assert_eq!(
        entries(&sub),
        Vec::<String>::new(),
        "the partial was renamed away"
    );
}

/// Every unready kind the probe can name, each simulated the way it happens
/// on a device, and the ready report when nothing is wrong.
#[tokio::test]
async fn the_probe_names_every_unready_kind() {
    let fx = Fixture::new().await;
    let budget = 1024 * 1024;
    let probe = |ws: &Workspace| ws.probe(budget, None);
    let unready = |ws: &Workspace, kind: UnreadyKind, needle: &str| {
        let err = probe(ws).expect_err(needle);
        assert_eq!(err.kind, kind, "{err}");
        assert!(err.detail.contains(needle), "{err}");
        let status = match kind {
            UnreadyKind::MountMissing | UnreadyKind::NotData => Status::Unavailable,
            UnreadyKind::ReadOnly | UnreadyKind::Exhausted | UnreadyKind::ProbeFailed => {
                Status::Degraded
            }
        };
        assert_eq!(err.status(), status, "{err}");
        assert!(
            err.to_string()
                .starts_with(&format!("{} {}: ", status.as_str(), kind.as_str())),
            "{err}"
        );
    };

    // Ready: the pool the namespace resolved to, its source, the namespace's
    // root within it, and the two space figures — the pool's, stated once.
    let ws = laid_out(&fx, "ready");
    fs::write(ws.verified().join("kept.raucb"), vec![0u8; 100]).expect("seed");
    let ready = probe(&ws).expect("a laid-out DATA workspace is ready");
    assert_eq!(ready.pool, workspace::DATA_MOUNT);
    assert_eq!(ready.pool, "/mnt/data");
    assert_eq!(ready.source, "/dev/data");
    assert_eq!(ready.fs_root, "/mos");
    assert_eq!(ready.fstype, "ext4");
    assert_eq!(ready.used_bytes, 100);
    assert!(ready.free_bytes > 0);
    assert_eq!(ready.max_bytes, budget);
    assert_eq!(
        entries(&ws.staging()),
        Vec::<String>::new(),
        "the probe file is removed"
    );

    // Mount missing: the namespace does not exist at all…
    let absent = Workspace::at(
        fx.scratch("absent").join("mos").join("updates"),
        fx.scratch("absent.mountinfo"),
    )
    .expect("workspace");
    unready(&absent, UnreadyKind::MountMissing, "does not exist");
    // …or exists as a plain directory nothing is mounted at (DATA absent,
    // the rootfs healthy: the case PLAN-047 names).
    let ws = laid_out(&fx, "unmounted");
    let table = fx.scratch("unmounted.mountinfo");
    set_namespace_mount(&ws, &table, None);
    unready(&ws, UnreadyKind::MountMissing, "not a mount point");
    // …or is mounted but a workspace directory is missing…
    let ws = laid_out(&fx, "half-laid-out");
    fs::remove_dir(ws.downloads()).expect("remove downloads/");
    unready(&ws, UnreadyKind::MountMissing, "downloads");
    // …or the namespace is a mount but the DATA pool itself is not mounted,
    // so there is nothing to resolve it against.
    let ws = laid_out(&fx, "no-pool");
    fs::write(
        fx.scratch("no-pool.mountinfo"),
        format!(
            "21 1 0:20 / / ro,relatime - ext4 /dev/dm-0 ro,errors=remount-ro\n\
             34 21 179:7 /mos {} rw,noatime - ext4 /dev/data rw,noatime\n",
            ws.namespace().display()
        ),
    )
    .expect("table");
    unready(&ws, UnreadyKind::MountMissing, "not mounted at /mnt/data");

    // Not DATA: a tmpfs at the namespace…
    let ws = laid_out(&fx, "tmpfs");
    let line = format!(
        "34 21 0:40 / {} rw - tmpfs tmpfs rw",
        ws.namespace().display()
    );
    set_namespace_mount(&ws, &fx.scratch("tmpfs.mountinfo"), Some(&line));
    unready(&ws, UnreadyKind::NotData, "tmpfs");
    // …the rootfs's own device bound there (an ext4 like the pool, so only
    // the device comparison against /mnt/data can tell)…
    let ws = laid_out(&fx, "rootfs");
    let line = format!(
        "34 21 0:20 /mos {} rw,relatime - ext4 /dev/dm-0 rw",
        ws.namespace().display()
    );
    set_namespace_mount(&ws, &fx.scratch("rootfs.mountinfo"), Some(&line));
    unready(&ws, UnreadyKind::NotData, "not the DATA pool at /mnt/data");
    // …STATE's device bound there…
    let ws = laid_out(&fx, "state");
    let line = format!(
        "34 21 179:6 /updates {} rw,noatime - ext4 /dev/mmcblk0p6 rw,noatime",
        ws.namespace().display()
    );
    set_namespace_mount(&ws, &fx.scratch("state.mountinfo"), Some(&line));
    unready(&ws, UnreadyKind::NotData, "/dev/mmcblk0p6");
    // …a symbolic link standing in for the namespace…
    let target = fx.scratch("symlink-target");
    fs::create_dir_all(target.join("updates").join("downloads")).expect("target");
    let linked = fx.scratch("symlinked").join("mos");
    fs::create_dir_all(linked.parent().expect("parent")).expect("parent");
    std::os::unix::fs::symlink(&target, &linked).expect("symlink the namespace");
    let table = fx.scratch("symlinked.mountinfo");
    fs::write(&table, mount_table(&linked, None)).expect("table");
    let ws = Workspace::at(linked.join("updates"), table).expect("workspace");
    unready(&ws, UnreadyKind::NotData, "symbolic link");
    // …or for one workspace directory…
    let ws = laid_out(&fx, "symlinked-verified");
    fs::remove_dir(ws.verified()).expect("remove verified/");
    std::os::unix::fs::symlink(fx.scratch("elsewhere-verified"), ws.verified())
        .expect("symlink verified/");
    fs::create_dir_all(fx.scratch("elsewhere-verified")).expect("target");
    unready(&ws, UnreadyKind::NotData, "symbolic link");
    // …or a foreign mount inside the workspace.
    let ws = laid_out(&fx, "foreign");
    let table = fx.scratch("foreign.mountinfo");
    let mut text = mount_table(ws.namespace(), None);
    text.push_str(&format!(
        "40 34 0:41 / {} rw - tmpfs tmpfs rw\n",
        ws.verified().display()
    ));
    fs::write(&table, text).expect("table");
    unready(&ws, UnreadyKind::NotData, "separate mount");

    // Read-only (degraded: it IS the pool, it just cannot take bytes): the
    // mount flags say so — on the bind, on its superblock, or on the pool
    // mount (a test cannot remount, and root ignores directory modes, so
    // the mount table is the honest signal).
    let ws = laid_out(&fx, "readonly");
    let line = format!(
        "34 21 179:7 /mos {} ro,noatime - ext4 /dev/data rw,noatime",
        ws.namespace().display()
    );
    set_namespace_mount(&ws, &fx.scratch("readonly.mountinfo"), Some(&line));
    unready(&ws, UnreadyKind::ReadOnly, "read-only");
    let line = format!(
        "34 21 179:7 /mos {} rw,noatime - ext4 /dev/data ro,noatime",
        ws.namespace().display()
    );
    set_namespace_mount(&ws, &fx.scratch("readonly.mountinfo"), Some(&line));
    unready(&ws, UnreadyKind::ReadOnly, "read-only");
    let ns = ws.namespace().display().to_string();
    let table =
        mount_table(ws.namespace(), None).replace("/mnt/data rw,noatime", "/mnt/data ro,noatime");
    assert!(table.contains(&ns) && table.contains("/mnt/data ro,noatime"));
    fs::write(fx.scratch("readonly.mountinfo"), table).expect("table");
    unready(&ws, UnreadyKind::ReadOnly, "read-only");

    // Exhausted: the budget is spent by what the workspace already holds…
    let ws = laid_out(&fx, "spent");
    fs::write(ws.downloads().join("old.raucb.part"), vec![0u8; 600]).expect("seed");
    fs::write(ws.staging().join("copy.raucb.part"), vec![0u8; 424]).expect("seed");
    let err = ws
        .probe(1024, None)
        .expect_err("a spent budget is exhausted");
    assert_eq!(err.kind, UnreadyKind::Exhausted);
    assert!(err.detail.contains("budget"), "{err}");
    // …or the filesystem cannot hold what is asked.
    let ws = laid_out(&fx, "full");
    let err = ws
        .probe(budget, Some(u64::MAX))
        .expect_err("more than the filesystem holds is exhausted");
    assert_eq!(err.kind, UnreadyKind::Exhausted);
    assert!(
        err.detail
            .contains("free space on the DATA pool (/mnt/data)"),
        "{err}"
    );

    // Probe failed: the mount table itself cannot be read.
    let ws = Workspace::at(
        laid_out(&fx, "unreadable").root().to_path_buf(),
        fx.scratch("no-such.mountinfo"),
    )
    .expect("workspace");
    unready(&ws, UnreadyKind::ProbeFailed, "mountinfo");
}

/// An unready workspace stops `fetch` and `import` before the first byte:
/// nothing is requested from the server, nothing is written anywhere, and
/// the error is the named kind, reachable by downcast.
#[tokio::test]
async fn an_unready_workspace_refuses_acquisition_before_any_byte() {
    let fx = Fixture::new().await;
    let (name, candidate) = published_candidate(&fx).await;
    let srv = server::serve(fx.repo.clone()).await;

    let ws = laid_out(&fx, "ws");
    let line = format!(
        "34 21 179:7 /mos {} ro,noatime - ext4 /dev/data rw,noatime",
        ws.namespace().display()
    );
    set_namespace_mount(&ws, &fx.scratch("ws.mountinfo"), Some(&line));
    let err = update::fetch(&srv.base, &candidate, &ws, None, 1024 * 1024)
        .await
        .expect_err("a read-only workspace must refuse the fetch");
    let unready = err
        .downcast_ref::<workspace::Unready>()
        .expect("the error is the named readiness failure");
    assert_eq!(unready.kind, UnreadyKind::ReadOnly);
    assert!(
        srv.requests.lock().expect("log").is_empty(),
        "no byte was asked for"
    );
    assert_eq!(entries(&ws.downloads()), Vec::<String>::new());
    assert_eq!(entries(&ws.verified()), Vec::<String>::new());

    let lockbox = fx.scratch("lockbox");
    repo::lockbox(&fx.repo, &lockbox, &[]).expect("lockbox");
    let err = update::import_selected(
        &lockbox,
        &fx.trusted_root,
        &fx.scratch("state.json"),
        &candidate,
        &ws,
        1024 * 1024,
    )
    .await
    .expect_err("a read-only workspace must refuse the import");
    assert_eq!(
        err.downcast_ref::<workspace::Unready>()
            .expect("named")
            .kind,
        UnreadyKind::ReadOnly
    );
    assert_eq!(entries(&ws.staging()), Vec::<String>::new());
    assert!(!ws.verified().join(&name).exists());
}

/// A download the link drops halfway leaves exactly one artifact — the
/// `.part` in downloads/ — and nothing in verified/; the next fetch resumes
/// it with a range request, and only then does the whole bundle appear in
/// verified/ under its final name. Between those two moments there is no
/// state in which verified/ holds a partial.
#[tokio::test]
async fn an_interrupted_download_never_reaches_verified() {
    let fx = Fixture::new().await;
    let (name, candidate) = published_candidate(&fx).await;
    let keep = candidate.length as usize / 3;

    let dropping = server::serve_truncated(fx.repo.clone(), keep).await;
    let ws = laid_out(&fx, "ws");
    let err = update::fetch(&dropping.base, &candidate, &ws, None, 1024 * 1024)
        .await
        .expect_err("a dropped connection is a failure, not a bundle");
    let message = format!("{err:#}");
    assert!(message.contains("connection ended"), "{message}");
    assert!(message.contains("resumes"), "{message}");
    let part = ws.downloads().join(format!("{name}.part"));
    assert_eq!(
        fs::metadata(&part).expect("the partial is kept").len(),
        keep as u64
    );
    assert_eq!(
        entries(&ws.verified()),
        Vec::<String>::new(),
        "verified/ holds no partial"
    );
    assert_eq!(entries(&ws.staging()), Vec::<String>::new());
    assert!(
        ws.installable(&part).is_err() && ws.installable(&ws.verified().join(&name)).is_err(),
        "neither the partial nor the missing final name is installable"
    );

    let srv = server::serve(fx.repo.clone()).await;
    let report = update::fetch(&srv.base, &candidate, &ws, None, 1024 * 1024)
        .await
        .expect("the resumed fetch completes");
    assert_eq!(report.resumed_from, keep as u64);
    assert_eq!(report.path, ws.verified().join(&name));
    assert_eq!(
        sha256_hex(&fs::read(&report.path).expect("verified")),
        candidate.sha256
    );
    assert!(!part.exists(), "the partial was renamed, not copied");
    assert!(
        srv.requests
            .lock()
            .expect("log")
            .iter()
            .any(|(_, range)| *range == Some(keep as u64)),
        "the resume asked for bytes {keep}-"
    );
    assert_eq!(
        ws.installable(&report.path).expect("installable"),
        report.path
    );
}

/// Only a regular file directly inside verified/ is ever handed to RAUC:
/// not a `.part` anywhere (even in verified/), not a file in downloads/ or
/// staging/, not a symbolic link, not a name that is not there.
#[tokio::test]
async fn only_a_verified_regular_file_is_installable() {
    let fx = Fixture::new().await;
    let ws = laid_out(&fx, "ws");
    let good = ws.verified().join("mos-cx3576-1.1.0.raucb");
    fs::write(&good, b"verified bytes").expect("seed");
    assert_eq!(ws.installable(&good).expect("verified bundle"), good);

    let refused = |path: &Path, needle: &str| {
        let err = ws.installable(path).expect_err(needle);
        assert!(
            format!("{err:#}").contains(needle),
            "{}: {err:#}",
            path.display()
        );
    };
    let part_in_verified = ws.verified().join("mos-cx3576-1.2.0.raucb.part");
    fs::write(&part_in_verified, b"partial bytes").expect("seed");
    refused(&part_in_verified, "partial download");
    let in_downloads = ws.downloads().join("mos-cx3576-1.2.0.raucb");
    fs::write(&in_downloads, b"unverified bytes").expect("seed");
    refused(&in_downloads, "not inside");
    let in_staging = ws.staging().join("mos-cx3576-1.2.0.raucb");
    fs::write(&in_staging, b"unverified bytes").expect("seed");
    refused(&in_staging, "not inside");
    let link = ws.verified().join("link.raucb");
    std::os::unix::fs::symlink(&in_downloads, &link).expect("symlink");
    refused(&link, "not a regular file");
    refused(&ws.verified().join("absent.raucb"), "stat");
    refused(Path::new("relative.raucb"), "not inside");
    refused(&ws.verified(), "not inside");
}

/// The `rauc-update` binary's side of the contract mosd drives: `probe`
/// answers `ready ...` with exit 0 or `unavailable <kind>: ...` with exit 3,
/// and a `fetch` against an unready workspace is the same exit 3 with the
/// same line — driven through the environment override, on a child process,
/// which is the only place a test may set it.
#[tokio::test]
async fn the_cli_reports_readiness_with_its_own_exit_code() {
    let fx = Fixture::new().await;
    let ws = laid_out(&fx, "ws");
    let table = fx.scratch("ws.mountinfo");
    let run = |args: &[&str]| {
        std::process::Command::new(env!("CARGO_BIN_EXE_rauc-update"))
            .args(args)
            .env(workspace::ROOT_ENV, ws.root())
            .env(workspace::MOUNTINFO_ENV, &table)
            .output()
            .expect("run rauc-update")
    };

    let ready = run(&["probe", "--max-bytes", "1048576"]);
    assert_eq!(ready.status.code(), Some(0), "{ready:?}");
    let stdout = String::from_utf8_lossy(&ready.stdout);
    assert!(stdout.starts_with("ready root="), "{stdout}");
    assert!(stdout.contains("pool=/mnt/data"), "{stdout}");
    assert!(stdout.contains("source=/dev/data"), "{stdout}");
    assert!(stdout.contains("fs_root=/mos"), "{stdout}");

    // Unavailable (mount): the pool is missing from the table.
    let ns = ws.namespace().display().to_string();
    fs::write(
        &table,
        format!("34 21 179:7 /mos {ns} rw,noatime - ext4 /dev/data rw,noatime\n"),
    )
    .expect("table");
    let unmounted = run(&["probe", "--max-bytes", "1048576"]);
    assert_eq!(unmounted.status.code(), Some(3), "{unmounted:?}");
    assert!(
        String::from_utf8_lossy(&unmounted.stdout).starts_with("unavailable mount-missing: "),
        "{unmounted:?}"
    );

    let line = format!(
        "34 21 179:7 /mos {} ro,noatime - ext4 /dev/data rw,noatime",
        ws.namespace().display()
    );
    set_namespace_mount(&ws, &table, Some(&line));
    let unready = run(&["probe", "--max-bytes", "1048576"]);
    assert_eq!(unready.status.code(), Some(3), "{unready:?}");
    let stdout = String::from_utf8_lossy(&unready.stdout);
    assert!(stdout.starts_with("degraded read-only: "), "{stdout}");

    // A fetch against the same unready workspace: exit 3, the kind on
    // stderr, nothing acquired.
    let (name, _) = published_candidate(&fx).await;
    let srv = server::serve(fx.repo.clone()).await;
    let fetch = run(&[
        "fetch",
        "--repo",
        fx.repo.to_str().expect("utf-8"),
        "--root",
        fx.trusted_root.to_str().expect("utf-8"),
        "--state",
        fx.scratch("cli-state.json").to_str().expect("utf-8"),
        "--board",
        "cx3576",
        "--profile",
        "prod",
        "--current-version",
        "1.0.0",
        "--url",
        srv.base.as_str(),
        "--max-bytes",
        "1048576",
    ]);
    assert_eq!(fetch.status.code(), Some(3), "{fetch:?}");
    let stderr = String::from_utf8_lossy(&fetch.stderr);
    assert!(stderr.contains("degraded read-only: "), "{stderr}");
    assert!(!ws.verified().join(&name).exists());
    assert_eq!(entries(&ws.downloads()), Vec::<String>::new());

    // A reserve directory outside downloads/ is refused by the binary too,
    // with the ordinary failure exit: it is a wrong invocation, not a
    // workspace state.
    let outside = run(&[
        "fetch",
        "--repo",
        fx.repo.to_str().expect("utf-8"),
        "--root",
        fx.trusted_root.to_str().expect("utf-8"),
        "--state",
        fx.scratch("cli-state-2.json").to_str().expect("utf-8"),
        "--board",
        "cx3576",
        "--profile",
        "prod",
        "--current-version",
        "1.0.0",
        "--url",
        srv.base.as_str(),
        "--reserve-dir",
        "/var/lib/mos/update/reserve",
        "--max-bytes",
        "1048576",
    ]);
    assert_eq!(outside.status.code(), Some(1), "{outside:?}");
    assert!(
        String::from_utf8_lossy(&outside.stderr).contains("outside"),
        "{outside:?}"
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
