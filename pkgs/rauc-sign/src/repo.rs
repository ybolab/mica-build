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

use std::collections::{HashMap, HashSet};
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
use tough::schema::{KeyHolder, RoleKeys, RoleType, Root, Signed, Target};
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

/// Publishes the next root version, `<n+1>.root.json`, signed by the outgoing
/// root key and by the incoming one.
///
/// `new_keys_dir`, when given, holds the freshly generated `root.pk8` that takes
/// over the root role: that is the **rotation**, and the trust anchor changes
/// hands. When it is absent the root key is unchanged and this is the annual
/// **refresh**: a new version and a new expiration over the same anchor. One
/// implementation because TUF accepts both the same way; two commands in the CLI
/// because an operator who performs one while intending the other must be told,
/// not accommodated.
///
/// The cross-sign is the whole mechanism (TUF client workflow step 1.3): a
/// client pinned to version `n` accepts `n+1` only if it is signed by a
/// threshold of `n`'s root keys *and* a threshold of its own. So a rotation
/// carrying only the new key's signature is refused by exactly the clients it
/// exists to carry forward, and one carrying only the old key's cannot install
/// the new key.
///
/// No online key is read here. The ceremony runs on the offline machine, where
/// the release host's keys have no business being, and it does not need them:
/// `targets`, `snapshot` and `timestamp` keep their existing signatures, because
/// no top-level role's metadata pins `root.json`. Refreshing those three stays
/// [`resign`]'s job, on the release host, afterwards.
///
/// Returns the version that was published.
pub async fn rotate_root(
    repo: &Path,
    keys_dir: &Path,
    new_keys_dir: Option<&Path>,
    root_expires: DateTime<Utc>,
) -> Result<u64> {
    let meta_dir = metadata_dir(repo);
    let root_path = meta_dir.join("root.json");
    let current: Signed<Root> = serde_json::from_slice(
        &fs::read(&root_path).with_context(|| format!("read {}", root_path.display()))?,
    )
    .with_context(|| format!("parse {}", root_path.display()))?;
    // This file is carried to the offline machine on media. A copy its own keys
    // do not sign is not the anchor the fleet is on, and a chain rooted at it is
    // one no deployed client can walk -- which would only be discovered by the
    // fleet, after the ceremony, with the key sealed away again.
    current
        .signed
        .verify_role(&current)
        .with_context(|| format!("{} is not signed by its own root keys", root_path.display()))?;

    let next = bump(current.signed.version)?;
    let next_path = meta_dir.join(format!("{next}.root.json"));
    // A published root version is a file some device may already have walked to.
    // Rewriting one is not an update, it is a second document with one name.
    ensure!(
        !next_path.exists(),
        "{} already exists; a published root version is never rewritten \
         (is metadata/root.json a stale copy of an older version?)",
        next_path.display()
    );

    let mut new_root = current.signed.clone();
    new_root.version = next;
    new_root.expires = root_expires;
    let mut root_role = new_root
        .roles
        .remove(&RoleType::Root)
        .ok_or_else(|| anyhow!("{} does not delegate the root role", root_path.display()))?;
    let outgoing_keyids = root_role.keyids.clone();

    let mut sources = keys::sources(keys_dir, &["root"])?;
    if let Some(new_keys_dir) = new_keys_dir {
        let (new_key_id, new_key) = load_key(new_keys_dir, "root")?;
        ensure!(
            !outgoing_keyids.contains(&new_key_id),
            "the root key in {} is the one already holding the role; publishing a \
             new version with the same key is the annual refresh, not a rotation \
             -- run `rauc-sign refresh-root` if that is what this ceremony is",
            new_keys_dir.display()
        );
        new_root.keys.insert(new_key_id.clone(), new_key);
        root_role.keyids = vec![new_key_id];
        sources.extend(keys::sources(new_keys_dir, &["root"])?);
    }
    new_root.roles.insert(RoleType::Root, root_role);
    prune_unreferenced_keys(&mut new_root);

    // tough signs a role with exactly those supplied keys whose id the key
    // holder lists for it, so a holder listing only the new root key would drop
    // the outgoing signature and one listing only the old would drop the
    // incoming. This view lists both. It is a signing-time lookup table and is
    // never written: the document published is `new_root`.
    let mut view = new_root.clone();
    let mut view_role = view
        .roles
        .remove(&RoleType::Root)
        .ok_or_else(|| anyhow!("root role vanished from the new root metadata"))?;
    for key_id in &outgoing_keyids {
        if let Some(key) = current.signed.keys.get(key_id) {
            view.keys.insert(key_id.clone(), key.clone());
        }
        if !view_role.keyids.contains(key_id) {
            view_role.keyids.push(key_id.clone());
        }
    }
    view.roles.insert(RoleType::Root, view_role);

    let signed = SignedRole::new(
        new_root.clone(),
        &KeyHolder::Root(view),
        &sources,
        &SystemRandom::new(),
    )
    .await
    .context("sign the new root metadata")?;

    // tough skips its own threshold check when the role is root, because whether
    // a root is adequately signed depends on the version being rotated FROM as
    // well as the one being written. Both halves are checked here instead, and
    // before anything is published: these two calls are exactly what a client
    // pinned to the old anchor and a client pinned to the new one will each do,
    // so a rotation that would strand either is refused rather than written to a
    // ceremony's output media.
    current
        .signed
        .verify_role(signed.signed())
        .context("the new root is not signed by a threshold of the outgoing root keys")?;
    new_root
        .verify_role(signed.signed())
        .context("the new root is not signed by a threshold of its own root keys")?;

    signed
        .write(&meta_dir, true)
        .await
        .context("write the new root metadata")?;
    publish_alias(&meta_dir, next.get(), "root")?;
    Ok(next.get())
}

/// Publishes the next root version with **fresh online role keys** bound to
/// `targets`, `snapshot` and `timestamp`, then re-signs the online metadata
/// with them. The outgoing online keys are revoked: no metadata they sign
/// after this verifies against the new root.
///
/// This is the recovery for a compromised (or retiring) release host, and it
/// is an **offline ceremony**: it needs the sealed root key, because only a
/// new root version can change which online keys the fleet accepts. The root
/// key itself does not change hands — the root role's binding is untouched, so
/// the one signature the unchanged root key produces satisfies both halves of
/// the cross-sign check and no anchor needs redistributing.
///
/// Unlike [`rotate_root`], this cannot stop at the root document: the
/// repository's `targets`, `snapshot` and `timestamp` are signed by the very
/// keys being revoked, so a repository left as-is would be refused whole by
/// every client that walks to the new root. The re-sign therefore happens
/// here, in the same ceremony, with the incoming keys — target entries are
/// carried forward unchanged and every online role's version is bumped. The
/// target files themselves are content-addressed and unchanged, so nothing is
/// copied.
///
/// Expiration is deliberately not enforced when loading the outgoing
/// repository: revoking a compromised key is most urgent exactly when the
/// repository has been left to rot.
///
/// Returns the root version that was published.
pub async fn rotate_online_keys(
    repo: &Path,
    keys_dir: &Path,
    new_keys_dir: &Path,
    root_expires: DateTime<Utc>,
    expires: Expirations,
) -> Result<u64> {
    let meta_dir = metadata_dir(repo);
    let root_path = meta_dir.join("root.json");
    let root_bytes =
        fs::read(&root_path).with_context(|| format!("read {}", root_path.display()))?;
    let current: Signed<Root> = serde_json::from_slice(&root_bytes)
        .with_context(|| format!("parse {}", root_path.display()))?;
    // Same reasoning as rotate_root: an anchor its own keys do not sign is not
    // the anchor the fleet is on, and building on it would be discovered by
    // the fleet, after the ceremony.
    current
        .signed
        .verify_role(&current)
        .with_context(|| format!("{} is not signed by its own root keys", root_path.display()))?;

    let next = bump(current.signed.version)?;
    let next_path = meta_dir.join(format!("{next}.root.json"));
    ensure!(
        !next_path.exists(),
        "{} already exists; a published root version is never rewritten \
         (is metadata/root.json a stale copy of an older version?)",
        next_path.display()
    );

    // Load the repository while the outgoing root still validates it, to carry
    // the target entries into the re-signed metadata. Once the new root is
    // written, metadata signed by the revoked keys can no longer be loaded —
    // which is the point of the ceremony, and why the load happens first.
    let repository = RepositoryLoader::new(
        &root_bytes,
        dir_url(&meta_dir)?,
        dir_url(&targets_dir(repo))?,
    )
    .expiration_enforcement(ExpirationEnforcement::Unsafe)
    .load()
    .await
    .context("load repository under the outgoing online keys")?;
    let versions = Versions {
        targets: repository.targets().signed.version,
        snapshot: repository.snapshot().signed.version,
        timestamp: repository.timestamp().signed.version,
    };
    let carried: Vec<(TargetName, Target)> = repository
        .targets()
        .signed
        .targets
        .iter()
        .map(|(name, target)| (name.clone(), target.clone()))
        .collect();

    let mut new_root = current.signed.clone();
    new_root.version = next;
    new_root.expires = root_expires;
    for role in keys::ONLINE_ROLES {
        let role_type: RoleType = role.parse().map_err(|_| anyhow!("unknown role {role}"))?;
        let (new_key_id, new_key) = load_key(new_keys_dir, role)?;
        let role_keys = new_root
            .roles
            .get_mut(&role_type)
            .ok_or_else(|| anyhow!("{} does not delegate the {role} role", root_path.display()))?;
        ensure!(
            !role_keys.keyids.contains(&new_key_id),
            "the {role} key in {} is the one already holding the role; an online-key \
             rotation revokes the outgoing keys, so it must introduce keys the root \
             does not already trust",
            new_keys_dir.display()
        );
        role_keys.keyids = vec![new_key_id.clone()];
        new_root.keys.insert(new_key_id, new_key);
    }
    prune_unreferenced_keys(&mut new_root);

    // The root role's binding is unchanged, so the one key in `keys_dir` signs
    // a document that both the outgoing root and the new root accept. Both
    // halves are still checked explicitly, exactly as in rotate_root, so a
    // wrong sealed key is refused in the room rather than by the fleet.
    let sources = keys::sources(keys_dir, &["root"])?;
    let signed = SignedRole::new(
        new_root.clone(),
        &KeyHolder::Root(new_root.clone()),
        &sources,
        &SystemRandom::new(),
    )
    .await
    .context("sign the new root metadata")?;
    current
        .signed
        .verify_role(signed.signed())
        .context("the new root is not signed by a threshold of the outgoing root keys")?;
    new_root
        .verify_role(signed.signed())
        .context("the new root is not signed by a threshold of its own root keys")?;

    signed
        .write(&meta_dir, true)
        .await
        .context("write the new root metadata")?;
    publish_alias(&meta_dir, next.get(), "root")?;

    // Re-sign the online roles with the incoming keys, carrying the targets
    // forward. The editor is opened from the just-published root, so what it
    // signs is exactly what a client walking to the new root will demand.
    let mut editor = RepositoryEditor::new(meta_dir.join("root.json"))
        .await
        .context("load the new root.json into the editor")?;
    for (name, target) in carried {
        editor.add_target(name, target)?;
    }
    editor
        .targets_version(bump(versions.targets)?)?
        .targets_expires(expires.targets)?
        .snapshot_version(bump(versions.snapshot)?)
        .snapshot_expires(expires.snapshot)
        .timestamp_version(bump(versions.timestamp)?)
        .timestamp_expires(expires.timestamp);
    let online = keys::sources(new_keys_dir, &keys::ONLINE_ROLES)?;
    let signed_repo = editor
        .sign(&online)
        .await
        .context("sign metadata with the incoming online keys")?;
    signed_repo
        .write(&meta_dir)
        .await
        .context("write metadata")?;
    publish_alias(&meta_dir, versions.targets.get() + 1, "targets")?;
    publish_alias(&meta_dir, versions.snapshot.get() + 1, "snapshot")?;
    Ok(next.get())
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
        let (key_id, key) = load_key(keys_dir, role)?;
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

/// Reads one role's private key from `keys_dir` and returns its TUF key id and
/// public key. The private half is dropped with the parsed keypair; only the
/// public key and its id are ever returned or written.
fn load_key(keys_dir: &Path, role: &str) -> Result<(Decoded<Hex>, Key)> {
    let path = keys::key_path(keys_dir, role);
    let bytes =
        fs::read(&path).with_context(|| format!("read {role} key at {}", path.display()))?;
    let keypair = tough::sign::parse_keypair(&bytes)
        .with_context(|| format!("parse {role} key at {}", path.display()))?;
    let key = keypair.tuf_key();
    let key_id = key.key_id().context("compute key id")?;
    Ok((key_id, key))
}

/// Drops keys that no role references any more.
///
/// After a rotation the outgoing root key is bound to nothing. Leaving it in the
/// `keys` map could not make it authoritative -- verification only counts a
/// signature whose key id the role itself lists -- but it would leave a revoked
/// key printed in the one document a device trusts, and which listed keys still
/// count is the last question an operator reading a trust anchor should have to
/// answer.
fn prune_unreferenced_keys(root: &mut Root) {
    let referenced: HashSet<Decoded<Hex>> = root
        .roles
        .values()
        .flat_map(|role| role.keyids.iter().cloned())
        .collect();
    root.keys.retain(|key_id, _| referenced.contains(key_id));
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
