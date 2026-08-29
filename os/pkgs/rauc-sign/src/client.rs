//! Device-side Uptane/TUF metadata verifier.
//!
//! Verifies a LOCAL copy of the repository that [`crate::repo`] publishes,
//! starting from a pinned trusted `root.json` that reached the device out of
//! band. The walk is the TUF client workflow, delegated to `tough`: the root
//! chain from the pinned version upward (`<n+1>.root.json` until absent —
//! today the signer only ever writes version 1, so the chain is depth one),
//! then timestamp → snapshot → targets, enforcing per-role signature
//! thresholds, expiries, the version and hash/length pins each role places on
//! the next, and rejecting metadata whose signatures do not meet its role's
//! threshold.
//!
//! What this module adds on top of that walk:
//!
//! - **Persistent rollback protection.** A JSON state file records the highest
//!   verified version per role and is written atomically (sibling temp file,
//!   fsync, rename, directory fsync). A validly signed but older repository is
//!   rejected even across a restart, which an in-process comparison cannot do.
//! - **Model enforcement.** The signer defines exactly the four top-level
//!   roles and no delegated targets; a root missing a role, or targets
//!   metadata delegating to roles this client has no policy for, is refused
//!   instead of half-verified.
//! - **Target verification to a path.** A named target's bytes are read back
//!   through the metadata (sha256 and length pinned) and the verified local
//!   file path is returned, which is what an installer wants to hand to RAUC.
//!
//! Transport — how metadata and the pinned root reach the device — is
//! deliberately absent; see this crate's README for the provisioning story.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail, ensure};
use tough::schema::RoleType;
use tough::{IntoVec, Repository, RepositoryLoader, TargetName};

use crate::repo::{dir_url, metadata_dir, targets_dir};

/// Result of a successful client verification.
#[derive(Debug, Clone)]
pub struct ClientReport {
    /// Version of the root metadata the chain resolved to.
    pub root_version: u64,
    /// Version of the verified targets metadata.
    pub targets_version: u64,
    /// Version of the verified snapshot metadata.
    pub snapshot_version: u64,
    /// Version of the verified timestamp metadata.
    pub timestamp_version: u64,
    /// Names the verified targets metadata lists, sorted.
    pub targets: Vec<String>,
}

/// Verifies the repository's metadata from the pinned `trusted_root` and
/// enforces (then advances) the persistent version state at `state`.
///
/// The state file is created on first use. It is only written after every
/// role's version has passed the rollback check, so a rejection never
/// advances it.
pub async fn verify_repository(
    repo: &Path,
    trusted_root: &Path,
    state: &Path,
) -> Result<ClientReport> {
    let repository = load(repo, trusted_root).await?;
    enforce_and_record(&repository, state)
}

/// Verifies the repository's metadata (as [`verify_repository`]), then reads
/// `name`'s bytes back through the metadata — sha256 and length pinned — and
/// returns the verified local path of the target file.
pub async fn verify_target(
    repo: &Path,
    trusted_root: &Path,
    state: &Path,
    name: &str,
) -> Result<PathBuf> {
    let repository = load(repo, trusted_root).await?;
    enforce_and_record(&repository, state)?;

    let target_name =
        TargetName::new(name).with_context(|| format!("invalid target name {name:?}"))?;
    let Some(target) = repository.targets().signed.targets.get(&target_name) else {
        bail!("target {name} is not listed in the verified targets metadata");
    };
    let length = target.length;
    let sha256 = hex::encode(&target.hashes.sha256);

    let stream = repository
        .read_target(&target_name)
        .await
        .with_context(|| format!("read target {name}"))?
        .ok_or_else(|| anyhow!("target {name} is listed but missing"))?;
    let bytes = stream
        .into_vec()
        .await
        .with_context(|| format!("verify target {name}"))?;
    ensure!(
        bytes.len() as u64 == length,
        "target {name} is {} bytes where the metadata pins {length}",
        bytes.len()
    );

    // Consistent snapshots are on, so the file the read above verified lives
    // under its hash-prefixed name; this mirrors tough's own construction.
    let path = targets_dir(repo).join(format!("{sha256}.{}", target_name.resolved()));
    ensure!(
        path.is_file(),
        "target {name} verified but {} is not a file",
        path.display()
    );
    Ok(path)
}

/// Loads and verifies the repository via the TUF client walk, then refuses the
/// shapes the signer never produces and this client has no policy for.
async fn load(repo: &Path, trusted_root: &Path) -> Result<Repository> {
    let root_bytes = fs::read(trusted_root)
        .with_context(|| format!("read trusted root {}", trusted_root.display()))?;
    let repository = RepositoryLoader::new(
        &root_bytes,
        dir_url(&metadata_dir(repo))?,
        dir_url(&targets_dir(repo))?,
    )
    .load()
    .await
    .context("verify repository metadata")?;

    // The signer binds a key to every top-level role. A root that omits one
    // leaves that role unverifiable; tough reports the gap only when the role
    // is reached, this names it up front.
    let root = &repository.root().signed;
    for role in [
        RoleType::Root,
        RoleType::Targets,
        RoleType::Snapshot,
        RoleType::Timestamp,
    ] {
        ensure!(
            root.roles.contains_key(&role),
            "trusted root does not delegate the {role} role"
        );
    }

    // The signer writes an empty delegations block (tough's editor default).
    // A non-empty one names roles this client holds no keys or policy for,
    // and half-verifying a repository is worse than refusing it.
    if let Some(delegations) = &repository.targets().signed.delegations {
        ensure!(
            delegations.roles.is_empty(),
            "targets metadata delegates to {} role(s); delegated targets are outside this client's model",
            delegations.roles.len()
        );
    }
    Ok(repository)
}

/// Checks every role's version against the persistent state, then advances the
/// state — all checks before any write, so a rejection persists nothing.
fn enforce_and_record(repository: &Repository, state_path: &Path) -> Result<ClientReport> {
    let mut names: Vec<String> = repository
        .targets()
        .signed
        .targets
        .keys()
        .map(|name| name.raw().to_string())
        .collect();
    names.sort();
    let report = ClientReport {
        root_version: repository.root().signed.version.get(),
        targets_version: repository.targets().signed.version.get(),
        snapshot_version: repository.snapshot().signed.version.get(),
        timestamp_version: repository.timestamp().signed.version.get(),
        targets: names,
    };

    let mut state = load_state(state_path)?;
    let mut changed = false;
    for (role, version) in [
        ("root", report.root_version),
        ("targets", report.targets_version),
        ("snapshot", report.snapshot_version),
        ("timestamp", report.timestamp_version),
    ] {
        match state.get(role) {
            // A validly signed lower version is exactly the rollback the
            // persistent state exists to catch: without it, a client restarted
            // onto an older repository would accept it.
            Some(&seen) if version < seen => bail!(
                "{role} version {version} is below the previously verified version {seen}: \
                 refusing rollback"
            ),
            Some(&seen) if version == seen => {}
            _ => {
                state.insert(role.to_string(), version);
                changed = true;
            }
        }
    }
    if changed {
        save_state(state_path, &state)?;
    }
    Ok(report)
}

/// Loads the version state. A missing file is the honest first-run state; a
/// present-but-unreadable one is an error, because silently resetting it would
/// erase the rollback protection it exists to provide.
fn load_state(path: &Path) -> Result<BTreeMap<String, u64>> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(err) => {
            return Err(err).with_context(|| format!("read version state {}", path.display()));
        }
    };
    serde_json::from_slice(&bytes)
        .with_context(|| format!("parse version state {}", path.display()))
}

/// Writes the version state atomically: sibling temp file, fsync, rename, then
/// directory fsync. The rename is what makes a crashed write invisible; the
/// directory fsync is what makes a completed one durable.
fn save_state(path: &Path, state: &BTreeMap<String, u64>) -> Result<()> {
    let json = serde_json::to_vec_pretty(state).context("serialize version state")?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("{} has no usable file name", path.display()))?;
    let parent = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;

    let tmp = parent.join(format!("{file_name}.tmp"));
    let mut file = fs::File::create(&tmp).with_context(|| format!("create {}", tmp.display()))?;
    file.write_all(&json)
        .with_context(|| format!("write {}", tmp.display()))?;
    file.sync_all()
        .with_context(|| format!("sync {}", tmp.display()))?;
    fs::rename(&tmp, path)
        .with_context(|| format!("rename {} to {}", tmp.display(), path.display()))?;
    fs::File::open(parent)
        .and_then(|dir| dir.sync_all())
        .with_context(|| format!("sync directory {}", parent.display()))?;
    Ok(())
}
