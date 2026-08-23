//! Creation, extension, re-signing and offline verification of the static TUF
//! repository that mos releases are published as.
//!
//! Layout produced under `<repo>`:
//!
//! ```text
//! metadata/root.json        alias of the highest <n>.root.json (bootstrap copy)
//! metadata/targets.json     alias of the highest <n>.targets.json
//! metadata/snapshot.json    alias of the highest <n>.snapshot.json
//! metadata/timestamp.json
//! metadata/<n>.root.json    consistent-snapshot metadata as TUF requires
//! metadata/<n>.targets.json
//! metadata/<n>.snapshot.json
//! targets/<sha256>.<name>   hash-prefixed target files
//! ```
//!
//! Consistent snapshots are enabled, so target files carry their sha256 as a
//! filename prefix. The unversioned metadata aliases exist so the repository can
//! be served (and bootstrapped from) by fixed URLs.

use std::collections::HashMap;
use std::fs;
use std::num::NonZeroU64;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, ensure};
use chrono::{DateTime, Utc};
use ring::rand::SystemRandom;
use serde_json::Value;
use tough::editor::RepositoryEditor;
use tough::editor::signed::{PathExists, SignedRole};
use tough::schema::decoded::{Decoded, Hex};
use tough::schema::key::Key;
use tough::schema::{KeyHolder, RoleKeys, RoleType, Root, Target};
use tough::sign::Sign;
use tough::{ExpirationEnforcement, IntoVec, RepositoryLoader, TargetName};
use url::Url;

use crate::keys;

/// TUF specification version the metadata declares.
const SPEC_VERSION: &str = "1.0.0";

/// `custom` key under which a target records the RAUC bundle's dm-verity root hash.
pub const CUSTOM_VERITY_ROOT_HASH: &str = "verityRootHash";

/// `custom` key under which a target records the release version string.
pub const CUSTOM_RELEASE_VERSION: &str = "releaseVersion";

/// Expiration instants for the roles that every signing operation re-signs.
///
/// These are always supplied by the caller. Nothing in this crate reads the wall
/// clock to derive an expiration, so a given set of inputs always yields the same
/// metadata. `root.json` is only signed by [`init`], which takes its expiration
/// separately.
#[derive(Debug, Clone, Copy)]
pub struct Expirations {
    /// `targets.json` expiration.
    pub targets: DateTime<Utc>,
    /// `snapshot.json` expiration.
    pub snapshot: DateTime<Utc>,
    /// `timestamp.json` expiration.
    pub timestamp: DateTime<Utc>,
}

/// Metadata version numbers of a loaded repository.
#[derive(Debug, Clone, Copy)]
struct Versions {
    targets: NonZeroU64,
    snapshot: NonZeroU64,
    timestamp: NonZeroU64,
}

/// Result of a successful [`verify`].
#[derive(Debug, Clone)]
pub struct VerifyReport {
    /// Version of the trusted root metadata the repository resolved to.
    pub root_version: u64,
    /// Version of the verified timestamp metadata.
    pub timestamp_version: u64,
    /// Names of the targets whose bytes were read back and hash-checked.
    pub targets: Vec<String>,
}

/// The `metadata/` subdirectory of a repository.
#[must_use]
pub fn metadata_dir(repo: &Path) -> PathBuf {
    repo.join("metadata")
}

/// The `targets/` subdirectory of a repository.
#[must_use]
pub fn targets_dir(repo: &Path) -> PathBuf {
    repo.join("targets")
}

/// Creates a fresh repository with all four roles at version 1 and no targets.
///
/// Requires the offline root key in addition to the online keys.
pub async fn init(
    repo: &Path,
    keys_dir: &Path,
    threshold: u64,
    root_expires: DateTime<Utc>,
    expires: Expirations,
) -> Result<()> {
    let meta_dir = metadata_dir(repo);
    ensure!(
        !meta_dir.join("root.json").exists(),
        "{} already contains a repository",
        repo.display()
    );
    fs::create_dir_all(&meta_dir).with_context(|| format!("create {}", meta_dir.display()))?;
    fs::create_dir_all(targets_dir(repo))
        .with_context(|| format!("create {}", targets_dir(repo).display()))?;

    let root = build_root(keys_dir, threshold, root_expires)?;
    let root_keys = keys::sources(keys_dir, &["root"])?;
    let signed_root = SignedRole::new(
        root.clone(),
        &KeyHolder::Root(root),
        &root_keys,
        &SystemRandom::new(),
    )
    .await
    .context("sign root.json")?;
    signed_root
        .write(&meta_dir, true)
        .await
        .context("write root metadata")?;
    publish_alias(&meta_dir, 1, "root")?;

    let one = nonzero(1)?;
    let mut editor = RepositoryEditor::new(meta_dir.join("root.json"))
        .await
        .context("load root.json into editor")?;
    editor
        .targets_version(one)?
        .targets_expires(expires.targets)?
        .snapshot_version(one)
        .snapshot_expires(expires.snapshot)
        .timestamp_version(one)
        .timestamp_expires(expires.timestamp);

    let online = keys::sources(keys_dir, &keys::ONLINE_ROLES)?;
    let signed = editor
        .sign(&online)
        .await
        .context("sign initial metadata")?;
    signed.write(&meta_dir).await.context("write metadata")?;
    publish_alias(&meta_dir, 1, "targets")?;
    publish_alias(&meta_dir, 1, "snapshot")?;
    Ok(())
}

/// Adds `file` as a target, pinning its sha256, length and the RAUC bundle's
/// dm-verity root hash, then re-signs targets, snapshot and timestamp.
///
/// `verity_root_hash` is supplied by the caller; this tool never shells out to
/// `rauc` to discover it.
pub async fn add(
    repo: &Path,
    keys_dir: &Path,
    file: &Path,
    name: Option<&str>,
    verity_root_hash: &str,
    release_version: Option<&str>,
    expires: Expirations,
) -> Result<TargetName> {
    let hash = verity_root_hash.trim();
    ensure!(
        hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()),
        "verity root hash must be 64 hex characters, got {:?}",
        verity_root_hash
    );

    let target_name = match name {
        Some(name) => TargetName::new(name)?,
        None => TargetName::new(
            file.file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| anyhow!("{} has no usable file name", file.display()))?,
        )?,
    };

    let mut target = Target::from_path(file)
        .await
        .with_context(|| format!("hash target {}", file.display()))?;
    target.custom.insert(
        CUSTOM_VERITY_ROOT_HASH.to_string(),
        Value::String(hash.to_ascii_lowercase()),
    );
    if let Some(version) = release_version {
        target.custom.insert(
            CUSTOM_RELEASE_VERSION.to_string(),
            Value::String(version.to_string()),
        );
    }

    let meta_dir = metadata_dir(repo);
    let out_targets = targets_dir(repo);
    fs::create_dir_all(&out_targets)
        .with_context(|| format!("create {}", out_targets.display()))?;

    let (mut editor, versions) = open_editor(repo).await?;
    editor.add_target(target_name.clone(), target)?;
    editor
        .targets_version(bump(versions.targets)?)?
        .targets_expires(expires.targets)?
        .snapshot_version(bump(versions.snapshot)?)
        .snapshot_expires(expires.snapshot)
        .timestamp_version(bump(versions.timestamp)?)
        .timestamp_expires(expires.timestamp);

    let online = keys::sources(keys_dir, &keys::ONLINE_ROLES)?;
    let signed = editor.sign(&online).await.context("sign metadata")?;
    signed.write(&meta_dir).await.context("write metadata")?;
    signed
        .copy_target(file, &out_targets, PathExists::Replace, Some(&target_name))
        .await
        .context("copy target into repository")?;
    publish_alias(&meta_dir, versions.targets.get() + 1, "targets")?;
    publish_alias(&meta_dir, versions.snapshot.get() + 1, "snapshot")?;
    Ok(target_name)
}

/// Re-signs the repository, bumping `snapshot` and `timestamp`.
///
/// The targets list is unchanged, so its version is preserved. The offline root
/// key is not required by this path; only the online role keys are.
///
/// Explicit versions lower than the currently published ones are refused unless
/// `allow_rollback` is set: a signer that publishes a lower version has produced
/// a rollback that every correct client will reject, and doing so silently is
/// exactly the kind of quiet failure this tool exists to prevent. The escape
/// hatch exists for tests that need to publish a rollback in order to prove
/// clients reject it.
pub async fn resign(
    repo: &Path,
    keys_dir: &Path,
    snapshot_version: Option<u64>,
    timestamp_version: Option<u64>,
    allow_rollback: bool,
    expires: Expirations,
) -> Result<()> {
    let meta_dir = metadata_dir(repo);
    let (mut editor, versions) = open_editor(repo).await?;

    let snapshot = match snapshot_version {
        Some(v) => explicit_version("snapshot", v, versions.snapshot, allow_rollback)?,
        None => bump(versions.snapshot)?,
    };
    let timestamp = match timestamp_version {
        Some(v) => explicit_version("timestamp", v, versions.timestamp, allow_rollback)?,
        None => bump(versions.timestamp)?,
    };
    editor
        .targets_version(versions.targets)?
        .targets_expires(expires.targets)?
        .snapshot_version(snapshot)
        .snapshot_expires(expires.snapshot)
        .timestamp_version(timestamp)
        .timestamp_expires(expires.timestamp);

    let online = keys::sources(keys_dir, &keys::ONLINE_ROLES)?;
    let signed = editor.sign(&online).await.context("sign metadata")?;
    signed.write(&meta_dir).await.context("write metadata")?;
    publish_alias(&meta_dir, versions.targets.get(), "targets")?;
    publish_alias(&meta_dir, snapshot.get(), "snapshot")?;
    Ok(())
}

/// Verifies a repository offline against a trusted root, then reads every target
/// back through the metadata so target bytes are hash-checked too.
///
/// When `datastore` is given, previously trusted metadata is persisted there and
/// rollback protection is enforced against it across invocations.
pub async fn verify(
    repo: &Path,
    trusted_root: &Path,
    datastore: Option<&Path>,
) -> Result<VerifyReport> {
    let root_bytes = fs::read(trusted_root)
        .with_context(|| format!("read trusted root {}", trusted_root.display()))?;

    let mut loader = RepositoryLoader::new(
        &root_bytes,
        dir_url(&metadata_dir(repo))?,
        dir_url(&targets_dir(repo))?,
    );
    if let Some(datastore) = datastore {
        fs::create_dir_all(datastore)
            .with_context(|| format!("create datastore {}", datastore.display()))?;
        loader = loader.datastore(datastore);
    }
    let repository = loader.load().await.context("verify repository metadata")?;

    let names: Vec<TargetName> = repository
        .targets()
        .signed
        .targets
        .keys()
        .cloned()
        .collect();
    let mut verified = Vec::with_capacity(names.len());
    for name in names {
        let stream = repository
            .read_target(&name)
            .await
            .with_context(|| format!("read target {}", name.raw()))?
            .ok_or_else(|| anyhow!("target {} is listed but missing", name.raw()))?;
        stream
            .into_vec()
            .await
            .with_context(|| format!("verify target {}", name.raw()))?;
        verified.push(name.raw().to_string());
    }
    verified.sort();

    Ok(VerifyReport {
        root_version: repository.root().signed.version.get(),
        timestamp_version: repository.timestamp().signed.version.get(),
        targets: verified,
    })
}

/// Builds an unsigned `root.json` binding one ed25519 key to each role.
fn build_root(keys_dir: &Path, threshold: u64, expires: DateTime<Utc>) -> Result<Root> {
    let threshold = nonzero(threshold)?;
    let mut key_map: HashMap<Decoded<Hex>, Key> = HashMap::new();
    let mut roles: HashMap<RoleType, RoleKeys> = HashMap::new();

    for role in keys::ROLES {
        let path = keys::key_path(keys_dir, role);
        let bytes =
            fs::read(&path).with_context(|| format!("read {role} key at {}", path.display()))?;
        let keypair = tough::sign::parse_keypair(&bytes)
            .with_context(|| format!("parse {role} key at {}", path.display()))?;
        let key = keypair.tuf_key();
        let key_id = key.key_id().context("compute key id")?;
        let role_type: RoleType = role.parse().map_err(|_| anyhow!("unknown role {role}"))?;
        let keyids = vec![key_id.clone()];
        // A threshold above the key count signs metadata no set of signatures
        // can ever satisfy; every client would reject the repository while this
        // tool reported success. Checked per role so the message can name the
        // role once roles carry differing key counts.
        ensure!(
            threshold.get() <= keyids.len() as u64,
            "threshold {threshold} for role {role} exceeds its {} key(s); \
             the resulting metadata could never be satisfied",
            keyids.len()
        );
        roles.insert(
            role_type,
            RoleKeys {
                keyids,
                threshold,
                _extra: HashMap::new(),
            },
        );
        key_map.insert(key_id, key);
    }

    Ok(Root {
        spec_version: SPEC_VERSION.to_string(),
        consistent_snapshot: true,
        version: nonzero(1)?,
        expires,
        keys: key_map,
        roles,
        _extra: HashMap::new(),
    })
}

/// Loads the repository for editing and returns its current version numbers.
///
/// Expiration is not enforced here: an expired repository is exactly the one that
/// most needs re-signing.
async fn open_editor(repo: &Path) -> Result<(RepositoryEditor, Versions)> {
    let meta_dir = metadata_dir(repo);
    let root_path = meta_dir.join("root.json");
    let root_bytes =
        fs::read(&root_path).with_context(|| format!("read {}", root_path.display()))?;

    let repository = RepositoryLoader::new(
        &root_bytes,
        dir_url(&meta_dir)?,
        dir_url(&targets_dir(repo))?,
    )
    .expiration_enforcement(ExpirationEnforcement::Unsafe)
    .load()
    .await
    .context("load repository for editing")?;

    let versions = Versions {
        targets: repository.targets().signed.version,
        snapshot: repository.snapshot().signed.version,
        timestamp: repository.timestamp().signed.version,
    };
    let editor = RepositoryEditor::from_repo(&root_path, repository)
        .await
        .context("open repository editor")?;
    Ok((editor, versions))
}

/// Copies `<version>.<role>.json` to the unversioned `<role>.json` alias.
fn publish_alias(meta_dir: &Path, version: u64, role: &str) -> Result<()> {
    let from = meta_dir.join(format!("{version}.{role}.json"));
    let to = meta_dir.join(format!("{role}.json"));
    fs::copy(&from, &to).with_context(|| format!("copy {} to {}", from.display(), to.display()))?;
    Ok(())
}

/// A `file://` URL for a directory, which is what tough's filesystem transport wants.
pub(crate) fn dir_url(dir: &Path) -> Result<Url> {
    let dir = dir
        .canonicalize()
        .with_context(|| format!("resolve {}", dir.display()))?;
    Url::from_directory_path(&dir)
        .map_err(|()| anyhow!("{} is not a valid base URL", dir.display()))
}

/// Validates an explicitly requested metadata version against the published one.
///
/// A version below the current one is a rollback: still validly signed, so
/// nothing downstream of the signer would flag it, and every correct client
/// would then refuse the repository. That combination -- succeeds here, fails
/// everywhere else -- is why it is an error rather than a warning.
fn explicit_version(
    role: &str,
    requested: u64,
    current: NonZeroU64,
    allow_rollback: bool,
) -> Result<NonZeroU64> {
    let requested = nonzero(requested)?;
    ensure!(
        allow_rollback || requested >= current,
        "{role} version {requested} is below the published version {current}: \
         this publishes a rollback that clients will reject; \
         pass --allow-rollback if that is deliberate"
    );
    Ok(requested)
}

fn nonzero(value: u64) -> Result<NonZeroU64> {
    NonZeroU64::new(value).ok_or_else(|| anyhow!("metadata versions start at 1, got 0"))
}

fn bump(value: NonZeroU64) -> Result<NonZeroU64> {
    nonzero(
        value
            .get()
            .checked_add(1)
            .ok_or_else(|| anyhow!("metadata version overflow"))?,
    )
}
