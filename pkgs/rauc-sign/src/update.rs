//! Device-side update client: compatibility selection over signed release
//! metadata, resumable download into the `/mos/updates` workspace, metadata
//! mirroring over HTTP, and the offline "lockbox" import path.
//!
//! Everything here sits on top of [`crate::client`]'s verified walk: selection
//! reads the `custom` block that `rauc-sign add --manifest` stamps on a bundle
//! target — board, profile, channel, release version, manifest schema version —
//! so compatibility needs no unsigned side channel, and nothing in this module
//! can hand out a bundle path whose bytes were not verified against the signed
//! sha256 and length first. There is deliberately no flag that skips any of
//! that: the only unverified artifact this module ever writes is a `.part`
//! file under `downloads/` (or `staging/` for an import copy), and the only
//! way it reaches `verified/` under its final name is passing the digest
//! check — one same-filesystem rename, so `verified/` never holds a partial.
//!
//! Where the bytes go is [`crate::workspace`]'s contract, not a flag: partials
//! only in `downloads/`, verified bundles only in `verified/`, no fallback
//! filesystem, and a readiness probe before the first byte is written. This
//! module holds the budget side — never exceed `--max-bytes` of content
//! across the workspace, and refuse to start an acquisition the filesystem
//! visibly cannot hold.

use std::cmp::Ordering;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail, ensure};
use ring::digest;
use serde_json::Value;
use tough::Repository;
use url::Url;

use crate::client;
use crate::http;
use crate::repo::{
    CUSTOM_BOARD, CUSTOM_CHANNEL, CUSTOM_MANIFEST_SCHEMA_VERSION, CUSTOM_MANIFEST_TARGET,
    CUSTOM_PROFILE, CUSTOM_RELEASE_VERSION, metadata_dir,
};
use crate::workspace::Workspace;

/// The release-manifest schema version this client understands. Held as an
/// equality, the same rule `build/src/release-manifest.ts` states for its
/// validator: a manifest written by a newer schema may bind fields this client
/// has never heard of, and selecting on it would verify less than the writer
/// claimed. A device meets a newer schema by updating the OS first.
pub const RELEASE_SCHEMA_FLOOR: u64 = 1;

/// Default path of the device identity file ([`DeviceIdentity::from_env_file`]).
///
/// Nothing in the image pipeline writes this file yet — shipping it is the
/// image side's half of the contract and is recorded as such in
/// `docs/design/release-signing.md`. Until then the identity arrives via
/// `--board`/`--profile`/`--current-version` or an explicit `--identity` path.
pub const DEFAULT_IDENTITY_PATH: &str = "/usr/share/mos/release-identity.env";

/// Cap on any single metadata file fetched by [`sync_metadata`]. The signer's
/// metadata is a few kilobytes; a "metadata" file approaching a mebibyte is
/// not this repository's, and buffering it unbounded would let a hostile
/// mirror exhaust memory before verification ever runs.
const METADATA_CAP: u64 = 1024 * 1024;

/// Bound on the `<n>.root.json` chain walk in [`sync_metadata`].
const MAX_ROOT_CHAIN: u64 = 1024;

/// What this device is: the identity every compatibility check compares
/// against.
#[derive(Debug, Clone)]
pub struct DeviceIdentity {
    /// Board name, e.g. `cx3576` (`boards/<name>/`).
    pub board: String,
    /// Image profile the running system was built at, e.g. `prod`.
    pub profile: String,
    /// Release version currently running, for the rollback-safety check.
    pub version: String,
}

impl DeviceIdentity {
    /// Reads `BOARD=`, `PROFILE=` and `VERSION=` from a `KEY=VALUE` file
    /// (`#` comments and blank lines ignored), refusing a file that omits any
    /// of the three — a guessed identity would select for the wrong device.
    pub fn from_env_file(path: &Path) -> Result<Self> {
        let text = fs::read_to_string(path)
            .with_context(|| format!("read device identity {}", path.display()))?;
        let mut board = None;
        let mut profile = None;
        let mut version = None;
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                bail!(
                    "{} carries a line that is not KEY=VALUE: {line:?}",
                    path.display()
                );
            };
            let value = value.trim().to_string();
            match key.trim() {
                "BOARD" => board = Some(value),
                "PROFILE" => profile = Some(value),
                "VERSION" => version = Some(value),
                _ => {}
            }
        }
        let missing = |what: &str| {
            anyhow!(
                "{} does not state {what}; a device identity is not guessed",
                path.display()
            )
        };
        Ok(Self {
            board: board.ok_or_else(|| missing("BOARD"))?,
            profile: profile.ok_or_else(|| missing("PROFILE"))?,
            version: version.ok_or_else(|| missing("VERSION"))?,
        })
    }
}

/// A selectable release bundle, read out of the verified targets metadata.
#[derive(Debug, Clone)]
pub struct Candidate {
    /// Target name of the bundle.
    pub name: String,
    /// Release version, from the signed custom block.
    pub version: String,
    /// Channel the release was published to.
    pub channel: String,
    /// Byte length the metadata pins.
    pub length: u64,
    /// sha256 the metadata pins, lowercase hex.
    pub sha256: String,
    /// Target name of the pinned release manifest, when one was published.
    pub manifest_target: Option<String>,
    /// True when this candidate is not newer than the running version and was
    /// only admitted by `allow_downgrade`; the CLI logs that use.
    pub downgrade: bool,
}

/// The outcome of a selection pass: at most one candidate, and the reason
/// every other bundle target was not it.
#[derive(Debug)]
pub struct Selection {
    /// The chosen candidate, or `None` when nothing is compatible.
    pub selected: Option<Candidate>,
    /// `(target name, reason)` per rejected bundle target.
    pub rejected: Vec<(String, String)>,
}

/// Verifies the repository (metadata walk, persistent rollback state — exactly
/// [`client::verify_repository`]) and then selects the newest target
/// compatible with `identity` on `channel`.
///
/// Rollback-safe by default: a candidate not newer than the running version is
/// rejected unless `allow_downgrade` is set, and an admitted downgrade is
/// marked on the [`Candidate`] so the caller can log it.
pub async fn check(
    repo: &Path,
    trusted_root: &Path,
    state: &Path,
    identity: &DeviceIdentity,
    channel: &str,
    allow_downgrade: bool,
) -> Result<Selection> {
    let repository = client::verify_and_open(repo, trusted_root, state).await?;
    select(&repository, identity, channel, allow_downgrade)
}

/// Device selection after authenticating metadata with the baked signing keys.
pub async fn check_baked(
    repo: &Path,
    state: &Path,
    identity: &DeviceIdentity,
    channel: &str,
    allow_downgrade: bool,
) -> Result<Selection> {
    let repository = client::verify_baked(repo, state).await?;
    select(&repository, identity, channel, allow_downgrade)
}

/// The selection pass over verified targets metadata.
fn select(
    repository: &Repository,
    identity: &DeviceIdentity,
    channel: &str,
    allow_downgrade: bool,
) -> Result<Selection> {
    let mut rejected: Vec<(String, String)> = Vec::new();
    let mut candidates: Vec<Candidate> = Vec::new();

    for (target_name, target) in &repository.targets().signed.targets {
        let name = target_name.raw().to_string();
        let custom_str = |key: &str| {
            target
                .custom
                .get(key)
                .and_then(Value::as_str)
                .map(str::to_string)
        };
        let board = custom_str(CUSTOM_BOARD);
        let profile = custom_str(CUSTOM_PROFILE);
        let release_channel = custom_str(CUSTOM_CHANNEL);
        let version = custom_str(CUSTOM_RELEASE_VERSION);

        if board.is_none() && profile.is_none() && release_channel.is_none() {
            // Not a selectable release: a pinned manifest, or a bundle
            // published before selection metadata existed. Only the latter is
            // worth a reason — an operator wondering why their bundle is
            // invisible should be told, a manifest target is working as
            // intended.
            if name.ends_with(".raucb") {
                rejected.push((
                    name,
                    "carries no release selection metadata (published without \
                     `rauc-sign add --manifest`)"
                        .to_string(),
                ));
            }
            continue;
        }
        let (Some(board), Some(profile), Some(release_channel), Some(version)) =
            (board, profile, release_channel, version)
        else {
            rejected.push((
                name,
                "carries a partial selection block; refusing to guess the missing fields"
                    .to_string(),
            ));
            continue;
        };

        if board != identity.board {
            rejected.push((
                name,
                format!(
                    "board {board} does not match this device's {}",
                    identity.board
                ),
            ));
            continue;
        }
        if profile != identity.profile {
            rejected.push((
                name,
                format!(
                    "profile {profile} does not match this device's {}",
                    identity.profile
                ),
            ));
            continue;
        }
        if release_channel != channel {
            rejected.push((
                name,
                format!("channel {release_channel} is not the requested {channel}"),
            ));
            continue;
        }
        match target
            .custom
            .get(CUSTOM_MANIFEST_SCHEMA_VERSION)
            .and_then(Value::as_u64)
        {
            Some(schema) if schema == RELEASE_SCHEMA_FLOOR => {}
            Some(schema) => {
                rejected.push((
                    name,
                    format!(
                        "manifest schema version {schema} is outside this client's \
                         understanding ({RELEASE_SCHEMA_FLOOR}); a newer schema is taken \
                         by updating the OS first"
                    ),
                ));
                continue;
            }
            None => {
                rejected.push((name, "carries no manifest schema version".to_string()));
                continue;
            }
        }
        let downgrade = compare_versions(&version, &identity.version) != Ordering::Greater;
        if downgrade && !allow_downgrade {
            rejected.push((
                name,
                format!(
                    "version {version} is not newer than the running {} \
                     (--allow-downgrade overrides, and is logged)",
                    identity.version
                ),
            ));
            continue;
        }

        candidates.push(Candidate {
            name,
            version,
            channel: release_channel,
            length: target.length,
            sha256: hex::encode(&target.hashes.sha256),
            manifest_target: custom_str(CUSTOM_MANIFEST_TARGET),
            downgrade,
        });
    }

    candidates.sort_by(|a, b| compare_versions(&a.version, &b.version));
    if let [.., second, first] = candidates.as_slice()
        && compare_versions(&first.version, &second.version) == Ordering::Equal
    {
        bail!(
            "{} and {} both carry version {}; refusing to choose between two \
             equally-new candidates",
            first.name,
            second.name,
            first.version
        );
    }
    let selected = candidates.pop();
    for candidate in candidates {
        rejected.push((
            candidate.name,
            format!(
                "version {} is older than the selected candidate",
                candidate.version
            ),
        ));
    }
    Ok(Selection { selected, rejected })
}

/// Orders two release version strings: dot-separated components, compared
/// numerically where both sides parse as integers and byte-wise otherwise; on
/// a shared prefix the longer version is newer (`1.2.1` > `1.2`). Not semver —
/// pre-release tags carry no special meaning — which matches the plain
/// `x.y.z` versions this repository publishes.
#[must_use]
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let left: Vec<&str> = a.split('.').collect();
    let right: Vec<&str> = b.split('.').collect();
    for index in 0..left.len().max(right.len()) {
        let ordering = match (left.get(index), right.get(index)) {
            (Some(x), Some(y)) => match (x.parse::<u64>(), y.parse::<u64>()) {
                (Ok(xn), Ok(yn)) => xn.cmp(&yn),
                _ => x.cmp(y),
            },
            (Some(_), None) => Ordering::Greater,
            (None, Some(_)) => Ordering::Less,
            (None, None) => Ordering::Equal,
        };
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    Ordering::Equal
}

/// The outcome of a completed [`fetch`] or [`import_selected`].
#[derive(Debug)]
pub struct FetchReport {
    /// Verified local path of the bundle, inside the workspace's `verified/`.
    pub path: PathBuf,
    /// Byte offset the download resumed from (0 for a fresh download; the
    /// full length when the file was already present and verified).
    pub resumed_from: u64,
    /// Bytes actually transferred this run.
    pub fetched: u64,
}

/// Downloads `candidate`'s bundle from the published repository at `base_url`
/// into the workspace: the partial lives in `reserve_dir` (`downloads/`
/// unless a directory inside it is named), resumes via an HTTP range
/// request, and moves into `verified/` by one same-filesystem rename only
/// after sha256 and length agree with the signed metadata. A digest mismatch
/// deletes the partial. The verification is not optional and has no bypass.
///
/// The readiness probe ([`Workspace::probe`]) runs before any byte is
/// written; its failure is an [`crate::workspace::Unready`] the caller can
/// downcast and name.
pub async fn fetch(
    base_url: &Url,
    candidate: &Candidate,
    workspace: &Workspace,
    reserve_dir: Option<&Path>,
    max_bytes: u64,
) -> Result<FetchReport> {
    let file_name = plain_file_name(&candidate.name)?;
    let reserve_dir = workspace.reserve_dir(reserve_dir)?;
    let final_path = workspace.verified().join(&file_name);
    let part_name = format!("{file_name}.part");
    let part_path = reserve_dir.join(&part_name);

    // An already-verified file is the idempotent success; a wrong one is a
    // corrupt leftover and is deleted rather than trusted or appended to.
    if take_verified(&final_path, &candidate.sha256)? {
        return Ok(FetchReport {
            path: final_path,
            resumed_from: candidate.length,
            fetched: 0,
        });
    }
    // A final-named file in the download directory is not this module's
    // output (nothing loses its `.part` suffix there): an unverified
    // leftover, never installable, removed rather than counted or trusted.
    let stale = reserve_dir.join(&file_name);
    if fs::symlink_metadata(&stale).is_ok() {
        fs::remove_file(&stale)
            .with_context(|| format!("remove unverified leftover {}", stale.display()))?;
    }

    // Resume state: hash whatever verified-length prefix is already on disk.
    // The bytes are NOT trusted — they only feed the digest that decides at
    // the end — so a corrupted partial costs one wasted download, never a
    // wrong file. Read before the probe, so the probe asks for exactly what
    // is still needed.
    let mut hasher = digest::Context::new(&digest::SHA256);
    let mut have: u64 = 0;
    if part_path.is_file() {
        let part_len = fs::metadata(&part_path)
            .with_context(|| format!("stat {}", part_path.display()))?
            .len();
        if part_len > candidate.length {
            fs::remove_file(&part_path)
                .with_context(|| format!("remove oversized partial {}", part_path.display()))?;
        } else {
            hash_file_into(&part_path, &mut hasher)?;
            have = part_len;
        }
    }
    let still_needed = candidate.length - have;

    // Readiness before the first byte: DATA mounted, writable, not
    // exhausted. Then the budget, which the probe's free-space check does
    // not replace — the budget is what the workspace may hold, free space
    // is what the filesystem can.
    workspace
        .probe(max_bytes, Some(still_needed))
        .map_err(anyhow::Error::new)?;
    admit_into_budget(
        workspace,
        max_bytes,
        &[file_name.as_str(), part_name.as_str()],
        candidate.length,
        &candidate.name,
    )?;
    if reserve_dir != workspace.downloads() {
        fs::create_dir_all(&reserve_dir)
            .with_context(|| format!("create reserve directory {}", reserve_dir.display()))?;
    }

    let mut fetched: u64 = 0;
    let resumed_from = have;
    if have < candidate.length {
        let url = target_url(base_url, &candidate.sha256, &file_name)?;
        let mut response = http::get(&url, (have > 0).then_some(have)).await?;
        match response.status {
            206 => ensure!(
                response.range_start == Some(have),
                "{url} resumed at {:?} where byte {have} was asked for",
                response.range_start
            ),
            // The server ignored the range request (or none was sent): the
            // response is the whole file, so the download restarts clean.
            200 => {
                if have > 0 {
                    hasher = digest::Context::new(&digest::SHA256);
                    have = 0;
                }
            }
            404 => bail!("{url} is not served by the repository (HTTP 404)"),
            status => bail!("{url} answered HTTP {status}"),
        }
        if let Some(content_length) = response.content_length {
            ensure!(
                have + content_length == candidate.length,
                "{url} offers {content_length} bytes from offset {have} where the signed \
                 metadata pins {} in total; a file of the wrong length cannot verify",
                candidate.length
            );
        }

        let mut out = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&part_path)
            .with_context(|| format!("open {}", part_path.display()))?;
        if have == 0 {
            out.set_len(0)
                .with_context(|| format!("truncate {}", part_path.display()))?;
        }
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = response.read_body(&mut buf).await?;
            if n == 0 {
                break;
            }
            if have + n as u64 > candidate.length {
                drop(out);
                fs::remove_file(&part_path)
                    .with_context(|| format!("remove {}", part_path.display()))?;
                bail!(
                    "{url} sent more than the {} bytes the signed metadata pins for {}; \
                     deleted the partial",
                    candidate.length,
                    candidate.name
                );
            }
            hasher.update(&buf[..n]);
            out.write_all(&buf[..n])
                .with_context(|| format!("write {}", part_path.display()))?;
            have += n as u64;
            fetched += n as u64;
        }
        out.sync_all()
            .with_context(|| format!("sync {}", part_path.display()))?;
        ensure!(
            have == candidate.length,
            "the connection ended after {have} of {} bytes of {}; the partial is kept \
             and a re-run resumes from it",
            candidate.length,
            candidate.name
        );
    }

    finalize_part(
        &part_path,
        &final_path,
        hasher,
        &candidate.sha256,
        &candidate.name,
    )?;
    Ok(FetchReport {
        path: final_path,
        resumed_from,
        fetched,
    })
}

/// The offline import: verifies `candidate` inside the lockbox repository —
/// the same walk and byte verification as online, via
/// [`client::verify_target`] — then copies the bundle through `staging/`
/// (transaction-local, never resumed) into `verified/` under the same
/// readiness, budget and digest rules as [`fetch`].
///
/// The caller obtains `candidate` from [`check`] over the same lockbox
/// directory, so board/profile/channel/version compatibility has already been
/// enforced against signed metadata by the time this runs.
pub async fn import_selected(
    lockbox: &Path,
    trusted_root: &Path,
    state: &Path,
    candidate: &Candidate,
    workspace: &Workspace,
    max_bytes: u64,
) -> Result<FetchReport> {
    let verified = client::verify_target(lockbox, trusted_root, state, &candidate.name)
        .await
        .with_context(|| format!("verify {} inside the lockbox", candidate.name))?;

    stage_import(&verified, candidate, workspace, max_bytes)
}

/// Offline device import uses the same baked keys as online selection.
pub async fn import_baked(
    lockbox: &Path,
    state: &Path,
    candidate: &Candidate,
    workspace: &Workspace,
    max_bytes: u64,
) -> Result<FetchReport> {
    let verified = client::verify_baked_target(lockbox, state, &candidate.name).await?;
    stage_import(&verified, candidate, workspace, max_bytes)
}

fn stage_import(
    verified: &Path,
    candidate: &Candidate,
    workspace: &Workspace,
    max_bytes: u64,
) -> Result<FetchReport> {
    let file_name = plain_file_name(&candidate.name)?;
    let final_path = workspace.verified().join(&file_name);
    let part_name = format!("{file_name}.part");
    let part_path = workspace.staging().join(&part_name);

    if take_verified(&final_path, &candidate.sha256)? {
        return Ok(FetchReport {
            path: final_path,
            resumed_from: candidate.length,
            fetched: 0,
        });
    }

    workspace
        .probe(max_bytes, Some(candidate.length))
        .map_err(anyhow::Error::new)?;
    admit_into_budget(
        workspace,
        max_bytes,
        &[file_name.as_str(), part_name.as_str()],
        candidate.length,
        &candidate.name,
    )?;

    // Copy through a hasher and a .part name in staging/, so no workspace
    // directory ever holds an unverified file under a final name — the same
    // invariant the download path keeps.
    let mut hasher = digest::Context::new(&digest::SHA256);
    let mut input = fs::File::open(&verified)
        .with_context(|| format!("open verified bundle {}", verified.display()))?;
    let mut out =
        fs::File::create(&part_path).with_context(|| format!("create {}", part_path.display()))?;
    let mut copied: u64 = 0;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = input
            .read(&mut buf)
            .with_context(|| format!("read {}", verified.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        out.write_all(&buf[..n])
            .with_context(|| format!("write {}", part_path.display()))?;
        copied += n as u64;
    }
    out.sync_all()
        .with_context(|| format!("sync {}", part_path.display()))?;
    if copied != candidate.length {
        drop(out);
        fs::remove_file(&part_path).with_context(|| format!("remove {}", part_path.display()))?;
        bail!(
            "{} is {copied} bytes where the signed metadata pins {}; the lockbox copy \
             changed between verification and staging (deleted the copy)",
            verified.display(),
            candidate.length
        );
    }

    finalize_part(
        &part_path,
        &final_path,
        hasher,
        &candidate.sha256,
        &candidate.name,
    )?;
    Ok(FetchReport {
        path: final_path,
        resumed_from: 0,
        fetched: copied,
    })
}

/// Report of a completed [`sync_metadata`].
#[derive(Debug)]
pub struct SyncReport {
    /// Highest `<n>.root.json` mirrored.
    pub root_version: u64,
    /// Snapshot version the mirrored timestamp names.
    pub snapshot_version: u64,
    /// Targets version the mirrored snapshot names.
    pub targets_version: u64,
}

/// Mirrors the repository's metadata over HTTP into `<mirror>/metadata`.
///
/// The mirror is **unverified input** to the verified walk, never a substitute
/// for it: version numbers are read out of the fetched documents only to know
/// which consistent-snapshot filenames to fetch next, every file is capped at
/// [`METADATA_CAP`] bytes, and nothing is trusted until [`check`] (or
/// `rauc-verify`) walks the result from the pinned root. Target files are not
/// mirrored here — [`fetch`] downloads exactly the selected bundle.
pub async fn sync_metadata(base_url: &Url, mirror: &Path) -> Result<SyncReport> {
    let meta_dir = metadata_dir(mirror);
    fs::create_dir_all(&meta_dir).with_context(|| format!("create {}", meta_dir.display()))?;
    // The verified walk resolves both directories up front; an empty targets/
    // is the honest state of a metadata-only mirror.
    fs::create_dir_all(crate::repo::targets_dir(mirror))
        .with_context(|| format!("create {}", crate::repo::targets_dir(mirror).display()))?;

    // The root chain, from 1 upward until absent: the walk a client performs,
    // so a device pinned to an older anchor finds every cross-signed step.
    let mut latest_root: Option<(u64, Vec<u8>)> = None;
    for version in 1..=MAX_ROOT_CHAIN {
        let name = format!("{version}.root.json");
        match fetch_metadata_file(base_url, &name).await? {
            Some(bytes) => {
                fs::write(meta_dir.join(&name), &bytes).with_context(|| format!("write {name}"))?;
                latest_root = Some((version, bytes));
            }
            None => break,
        }
    }
    let Some((root_version, root_bytes)) = latest_root else {
        bail!("{base_url} serves no metadata/1.root.json; not a published repository");
    };
    fs::write(meta_dir.join("root.json"), &root_bytes).context("write root.json alias")?;

    let timestamp = require_metadata_file(base_url, "timestamp.json").await?;
    fs::write(meta_dir.join("timestamp.json"), &timestamp).context("write timestamp.json")?;
    let snapshot_version = named_meta_version(&timestamp, "snapshot.json", "timestamp.json")?;

    let snapshot_name = format!("{snapshot_version}.snapshot.json");
    let snapshot = require_metadata_file(base_url, &snapshot_name).await?;
    fs::write(meta_dir.join(&snapshot_name), &snapshot)
        .with_context(|| format!("write {snapshot_name}"))?;
    fs::write(meta_dir.join("snapshot.json"), &snapshot).context("write snapshot.json alias")?;
    let targets_version = named_meta_version(&snapshot, "targets.json", &snapshot_name)?;

    let targets_name = format!("{targets_version}.targets.json");
    let targets = require_metadata_file(base_url, &targets_name).await?;
    fs::write(meta_dir.join(&targets_name), &targets)
        .with_context(|| format!("write {targets_name}"))?;
    fs::write(meta_dir.join("targets.json"), &targets).context("write targets.json alias")?;

    Ok(SyncReport {
        root_version,
        snapshot_version,
        targets_version,
    })
}

/// Fetches `metadata/<name>` from the published repository; `None` on 404.
async fn fetch_metadata_file(base_url: &Url, name: &str) -> Result<Option<Vec<u8>>> {
    let url = join_repo_path(base_url, &format!("metadata/{name}"))?;
    let response = http::get(&url, None).await?;
    match response.status {
        200 => Ok(Some(
            response
                .body_capped(METADATA_CAP, &format!("metadata file {name}"))
                .await?,
        )),
        404 => Ok(None),
        status => bail!("{url} answered HTTP {status}"),
    }
}

async fn require_metadata_file(base_url: &Url, name: &str) -> Result<Vec<u8>> {
    fetch_metadata_file(base_url, name)
        .await?
        .ok_or_else(|| anyhow!("{base_url} does not serve metadata/{name} (HTTP 404)"))
}

/// Reads `signed.meta["<name>"].version` out of an (unverified) metadata
/// document — only ever used to learn which consistent-snapshot filename to
/// fetch next; the verified walk re-checks everything.
fn named_meta_version(document: &[u8], name: &str, from: &str) -> Result<u64> {
    let value: Value =
        serde_json::from_slice(document).with_context(|| format!("parse mirrored {from}"))?;
    value
        .get("signed")
        .and_then(|signed| signed.get("meta"))
        .and_then(|meta| meta.get(name))
        .and_then(|entry| entry.get("version"))
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow!("mirrored {from} does not pin a version for {name}"))
}

/// `<base>/targets/<sha256>.<name>`, tolerating a base URL without a trailing
/// slash.
fn target_url(base_url: &Url, sha256: &str, file_name: &str) -> Result<Url> {
    join_repo_path(base_url, &format!("targets/{sha256}.{file_name}"))
}

fn join_repo_path(base_url: &Url, path: &str) -> Result<Url> {
    let mut base = base_url.clone();
    if !base.path().ends_with('/') {
        base.set_path(&format!("{}/", base.path()));
    }
    base.join(path)
        .with_context(|| format!("build URL for {path} under {base_url}"))
}

/// A target name that is usable as a plain file name in the reserve
/// directory. Bundle names satisfy this by construction; anything else must
/// not be able to point a write outside the reserve.
fn plain_file_name(name: &str) -> Result<String> {
    ensure!(
        !name.is_empty()
            && !name.starts_with('.')
            && name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'+' | b'-')),
        "target name {name:?} is not a plain file name; refusing to write it into the reserve"
    );
    Ok(name.to_string())
}

/// Refuses a download/import whose completed size would push the
/// workspace's content (downloads/, verified/ and staging/ together) past
/// `max_bytes`. Files this operation itself owns (the final name and its
/// `.part`) do not count against it.
fn admit_into_budget(
    workspace: &Workspace,
    max_bytes: u64,
    own_names: &[&str],
    length: u64,
    target: &str,
) -> Result<()> {
    let used = workspace.used_bytes(own_names)?;
    ensure!(
        used.saturating_add(length) <= max_bytes,
        "{target} is {length} bytes and the workspace at {} already holds {used}, \
         which would exceed the {max_bytes}-byte budget; make room or raise the \
         budget deliberately",
        workspace.root().display()
    );
    Ok(())
}

/// Whether `final_path` already holds the verified bundle. A regular file
/// with the pinned digest is the idempotent success (`true`); anything else
/// under that name — wrong bytes, a symbolic link — is removed, and `false`
/// says the acquisition must produce the file.
fn take_verified(final_path: &Path, expected_sha256: &str) -> Result<bool> {
    let Ok(meta) = fs::symlink_metadata(final_path) else {
        return Ok(false);
    };
    if meta.file_type().is_file() && file_sha256(final_path)? == expected_sha256 {
        return Ok(true);
    }
    fs::remove_file(final_path)
        .with_context(|| format!("remove corrupt {}", final_path.display()))?;
    Ok(false)
}

/// The one gate between a `.part` file and `verified/`: digest agreement
/// with the signed metadata. A mismatch deletes the partial; agreement is
/// one `rename(2)` on one filesystem, so `verified/` holds either the whole
/// verified bundle or nothing — never a partial, whatever interrupts it.
fn finalize_part(
    part_path: &Path,
    final_path: &Path,
    hasher: digest::Context,
    expected_sha256: &str,
    target: &str,
) -> Result<()> {
    let got = hex::encode(hasher.finish());
    if got != expected_sha256 {
        fs::remove_file(part_path).with_context(|| format!("remove {}", part_path.display()))?;
        bail!(
            "{target} has sha256 {got} where the signed metadata pins {expected_sha256}; \
             deleted the partial — a re-run starts clean"
        );
    }
    fs::rename(part_path, final_path)
        .with_context(|| format!("rename {} to {}", part_path.display(), final_path.display()))?;
    for dir in [final_path.parent(), part_path.parent()]
        .into_iter()
        .flatten()
    {
        fs::File::open(dir)
            .and_then(|handle| handle.sync_all())
            .with_context(|| format!("sync directory {}", dir.display()))?;
    }
    Ok(())
}

/// sha256 of a file's bytes, streamed, lowercase hex.
fn file_sha256(path: &Path) -> Result<String> {
    let mut hasher = digest::Context::new(&digest::SHA256);
    hash_file_into(path, &mut hasher)?;
    Ok(hex::encode(hasher.finish()))
}

fn hash_file_into(path: &Path, hasher: &mut digest::Context) -> Result<()> {
    let mut file = fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .with_context(|| format!("read {}", path.display()))?;
        if n == 0 {
            return Ok(());
        }
        hasher.update(&buf[..n]);
    }
}
