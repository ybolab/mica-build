//! The `/mos/updates` workspace: the one place on the device the update
//! client may write, and the readiness probe that runs before it does.
//!
//! PLAN-063 mounts the growable DATA pool at `/mnt/data` and binds two
//! subtrees of it: `/mos` (system-owned) and `/srv` (user-owned). The updater
//! owns one subtree of `/mos`, laid out by `mos-data-layout` before any
//! writer starts:
//!
//! ```text
//! /mos/updates/
//! ├── downloads/   resumable partial acquisition (`<name>.part`, nothing else)
//! ├── verified/    complete, digest-verified bundles — the only path RAUC is handed
//! └── staging/     transaction-local work (the import copy, the probe file)
//! ```
//!
//! There is no fallback filesystem. A workspace that is absent, not on the
//! DATA pool, read-only or exhausted is a named [`Unready`] state reported
//! BEFORE any byte is written, never a write failure discovered halfway
//! through a download and never a silent retreat to STATE, `/var`, the rootfs
//! or tmpfs. Two statuses, PLAN-061's words: **unavailable** when `/mos` is
//! not mounted or is not the DATA pool, **degraded** when it is DATA but
//! read-only, exhausted or the probe itself fails. Both refuse acquisition;
//! the split tells an operator whether to look at the mount or at the disk.
//! [`Workspace::reserve_dir`] refuses any partial-download directory outside
//! `downloads/`, and [`Workspace::installable`] refuses any path outside
//! `verified/` — a `.part` file, or a file under any other name anywhere
//! else, is never installable by filename alone.
//!
//! The root is a build-time constant. [`ROOT_ENV`] relocates the whole
//! workspace so the test suite can run in a temporary directory; it changes
//! where the workspace is, never what is required of it.

use std::fs;
use std::io::Write;
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};

use anyhow::{Context, Result, ensure};

/// The production workspace root.
pub const DEFAULT_ROOT: &str = "/mos/updates";

/// Where the DATA pool is mounted (PLAN-063). `/mos` and `/srv` are bind
/// mounts of subtrees of it, so "the mount source of `/mos` resolves to
/// DATA" means: the mount at `/mos` is on the same device as the mount at
/// this path. Capacity is that one pool's, stated once.
pub const DATA_MOUNT: &str = "/mnt/data";

/// Environment variable that relocates the workspace root (tests only; the
/// production default is the contract). The relocated root's parent stands
/// in for `/mos` and must satisfy every check the real namespace must.
pub const ROOT_ENV: &str = "RAUC_UPDATE_ROOT";

/// Environment variable naming a mountinfo table to read instead of
/// `/proc/self/mountinfo` (tests only): the mount checks are exercised
/// against fixture tables, since a test cannot mount filesystems.
pub const MOUNTINFO_ENV: &str = "RAUC_UPDATE_MOUNTINFO";

const MOUNTINFO_PATH: &str = "/proc/self/mountinfo";

/// The two ways a workspace is not ready — the vocabulary shared with the
/// storage status surface, so the two never disagree about one mount.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// `/mos` is not mounted, or what is mounted there is not the DATA pool.
    Unavailable,
    /// `/mos` is the DATA pool, but it cannot take the bytes right now:
    /// read-only, exhausted, or the probe could not complete.
    Degraded,
}

impl Status {
    /// The wire spelling (`rauc-update probe` output, mosd's `workspace.status`).
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unavailable => "unavailable",
            Self::Degraded => "degraded",
        }
    }
}

/// Why the workspace is not ready; the reason mosd records beside its
/// `update-unavailable` state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnreadyKind {
    /// The namespace, the DATA pool or a workspace directory is not there.
    MountMissing,
    /// The namespace is mounted, but not from the DATA pool (another device,
    /// symlink substitution, a foreign mount inside the workspace).
    NotData,
    /// DATA is mounted read-only.
    ReadOnly,
    /// The reserve budget is spent or the pool cannot hold what is asked.
    Exhausted,
    /// The probe itself could not complete (mountinfo unreadable, statvfs
    /// failed, the probe file could not be created for another reason).
    ProbeFailed,
}

impl UnreadyKind {
    /// The kind's wire spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MountMissing => "mount-missing",
            Self::NotData => "not-data",
            Self::ReadOnly => "read-only",
            Self::Exhausted => "exhausted",
            Self::ProbeFailed => "probe-failed",
        }
    }

    /// Which status the kind belongs to: mount problems are `unavailable`,
    /// everything about a mounted DATA pool is `degraded`.
    #[must_use]
    pub fn status(self) -> Status {
        match self {
            Self::MountMissing | Self::NotData => Status::Unavailable,
            Self::ReadOnly | Self::Exhausted | Self::ProbeFailed => Status::Degraded,
        }
    }
}

/// The workspace is not ready to acquire anything. Its own error type so a
/// caller can tell it from every other failure (`err.downcast_ref::<Unready>()`)
/// and name the status and kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unready {
    pub kind: UnreadyKind,
    pub detail: String,
}

impl Unready {
    #[must_use]
    pub fn status(&self) -> Status {
        self.kind.status()
    }
}

impl std::fmt::Display for Unready {
    /// `<status> <kind>: <detail>` — the one line mosd parses.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{} {}: {}",
            self.status().as_str(),
            self.kind.as_str(),
            self.detail
        )
    }
}

impl std::error::Error for Unready {}

/// What a passed probe measured.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Readiness {
    /// The pool mount the namespace resolved to ([`DATA_MOUNT`]).
    pub pool: String,
    /// Mount source of the pool (the DATA device).
    pub source: String,
    /// The namespace's path within the pool (mountinfo's root field; `/mos`
    /// under the direct layout).
    pub fs_root: String,
    pub fstype: String,
    /// Bytes available on the pool — one figure for the whole pool, which
    /// `/mos` and `/srv` share; never a per-bind number.
    pub free_bytes: u64,
    /// Bytes of regular files under downloads/, verified/ and staging/.
    pub used_bytes: u64,
    /// The budget the probe was asked to check against.
    pub max_bytes: u64,
}

/// One workspace: its root and where to read the mount table from.
#[derive(Debug, Clone)]
pub struct Workspace {
    root: PathBuf,
    mountinfo: PathBuf,
}

/// One line of `/proc/self/mountinfo`, the fields the probe reads.
#[derive(Debug, Clone, PartialEq, Eq)]
struct MountEntry {
    device: String,
    root: String,
    mount_point: String,
    options: String,
    fstype: String,
    source: String,
    super_options: String,
}

impl Workspace {
    /// The production workspace, or the one [`ROOT_ENV`] relocates it to.
    pub fn from_env() -> Result<Self> {
        let root = match std::env::var_os(ROOT_ENV) {
            Some(value) => PathBuf::from(value),
            None => PathBuf::from(DEFAULT_ROOT),
        };
        let mountinfo = match std::env::var_os(MOUNTINFO_ENV) {
            Some(value) => PathBuf::from(value),
            None => PathBuf::from(MOUNTINFO_PATH),
        };
        Self::at(root, mountinfo)
    }

    /// A workspace rooted at `root`, reading its mount table from `mountinfo`.
    pub fn at(root: PathBuf, mountinfo: PathBuf) -> Result<Self> {
        ensure!(
            root.is_absolute() && root.parent().is_some_and(|parent| parent != Path::new("/")),
            "workspace root {} must be an absolute path below a namespace directory",
            root.display()
        );
        ensure!(
            root.components()
                .all(|component| !matches!(component, Component::ParentDir | Component::CurDir)),
            "workspace root {} must not contain `.` or `..` components",
            root.display()
        );
        Ok(Self { root, mountinfo })
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The namespace the root lives in: `/mos` in production.
    #[must_use]
    pub fn namespace(&self) -> &Path {
        self.root.parent().unwrap_or(&self.root)
    }

    #[must_use]
    pub fn downloads(&self) -> PathBuf {
        self.root.join("downloads")
    }

    #[must_use]
    pub fn verified(&self) -> PathBuf {
        self.root.join("verified")
    }

    #[must_use]
    pub fn staging(&self) -> PathBuf {
        self.root.join("staging")
    }

    /// The directory partial downloads are written to: `downloads/` unless
    /// `requested` names a directory inside it. Anything else is refused —
    /// a partial never lives outside `downloads/`, and no flag moves the
    /// workspace to another filesystem.
    pub fn reserve_dir(&self, requested: Option<&Path>) -> Result<PathBuf> {
        let downloads = self.downloads();
        let Some(requested) = requested else {
            return Ok(downloads);
        };
        ensure!(
            requested.is_absolute()
                && requested.components().all(|component| {
                    !matches!(component, Component::ParentDir | Component::CurDir)
                })
                && requested.starts_with(&downloads),
            "reserve directory {} is outside {}; partial downloads live only there \
             ({ROOT_ENV} relocates the whole workspace, nothing relocates a part of it)",
            requested.display(),
            downloads.display()
        );
        Ok(requested.to_path_buf())
    }

    /// The one shape of path that may be handed to RAUC: a regular file (not
    /// a symlink) directly inside `verified/`, not a `.part`.
    pub fn installable(&self, path: &Path) -> Result<PathBuf> {
        let verified = self.verified();
        ensure!(
            path.is_absolute() && path.parent() == Some(verified.as_path()),
            "{} is not inside {}; only a verified bundle is handed to RAUC",
            path.display(),
            verified.display()
        );
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        ensure!(
            !name.is_empty() && !name.ends_with(".part"),
            "{} is a partial download, not a verified bundle",
            path.display()
        );
        let meta =
            fs::symlink_metadata(path).with_context(|| format!("stat {}", path.display()))?;
        ensure!(
            meta.file_type().is_file(),
            "{} is not a regular file (a symbolic link is not followed)",
            path.display()
        );
        Ok(path.to_path_buf())
    }

    /// The readiness probe, in PLAN-061's order: the namespace is a real
    /// directory mounted on the same device as the DATA pool at
    /// [`DATA_MOUNT`] (mount table, not `access(W_OK)`), no symlink stands in
    /// for any workspace directory, nothing foreign is mounted inside, the
    /// pool is not read-only, a private probe file is created + fsynced +
    /// removed in `staging/`, and the pool's free space is measured once
    /// against `need` (default: the unspent part of `max_bytes`, i.e. DATA
    /// must back the reserve it promises).
    ///
    /// Read-only apart from the probe file: nothing is created, cleaned or
    /// moved here.
    pub fn probe(&self, max_bytes: u64, need: Option<u64>) -> Result<Readiness, Unready> {
        let namespace = self.namespace();
        let (entry, pool) = self.namespace_mount(namespace)?;
        self.check_subtree(namespace)?;

        let stat = rustix::fs::statvfs(&self.root).map_err(|err| Unready {
            kind: UnreadyKind::ProbeFailed,
            detail: format!("statvfs {}: {err}", self.root.display()),
        })?;
        if stat.f_flag.contains(rustix::fs::StatVfsMountFlags::RDONLY) {
            return Err(Unready {
                kind: UnreadyKind::ReadOnly,
                detail: format!(
                    "{} is on a read-only filesystem ({})",
                    self.root.display(),
                    pool.source
                ),
            });
        }
        let used_bytes = self.used_bytes(&[]).map_err(|err| Unready {
            kind: UnreadyKind::ProbeFailed,
            detail: format!("{err:#}"),
        })?;
        self.write_probe_file()?;
        let free_bytes = stat.f_bavail.saturating_mul(stat.f_frsize);

        if used_bytes >= max_bytes {
            return Err(Unready {
                kind: UnreadyKind::Exhausted,
                detail: format!(
                    "the reserve budget of {max_bytes} bytes is spent: {used_bytes} bytes are \
                     already held under {}; reconcile downloads/, verified/ and staging/",
                    self.root.display()
                ),
            });
        }
        let need = need.unwrap_or(max_bytes - used_bytes);
        if free_bytes < need {
            return Err(Unready {
                kind: UnreadyKind::Exhausted,
                detail: format!(
                    "free space on the DATA pool ({}) is {free_bytes} bytes, below the {need} \
                     bytes needed; DATA does not back the reserve it promises",
                    pool.mount_point
                ),
            });
        }
        Ok(Readiness {
            pool: pool.mount_point,
            source: pool.source,
            fs_root: entry.root,
            fstype: entry.fstype,
            free_bytes,
            used_bytes,
            max_bytes,
        })
    }

    /// Bytes of regular files under the three workspace directories
    /// (recursive, symlinks not followed), skipping `skip` file names — the
    /// names an operation itself owns and accounts for separately.
    pub(crate) fn used_bytes(&self, skip: &[&str]) -> Result<u64> {
        let mut used = 0u64;
        for dir in [self.downloads(), self.verified(), self.staging()] {
            used = used.saturating_add(sum_regular_files(&dir, skip)?);
        }
        Ok(used)
    }

    /// The mount-table half of the probe: the namespace exists, is not a
    /// symlink, is a mount point on the same device as the DATA pool, is
    /// mounted read-write, and has no foreign mount inside the workspace.
    /// Answers the namespace's entry and the pool's.
    fn namespace_mount(&self, namespace: &Path) -> Result<(MountEntry, MountEntry), Unready> {
        match fs::symlink_metadata(namespace) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(Unready {
                    kind: UnreadyKind::NotData,
                    detail: format!(
                        "{} is a symbolic link; refusing the substitution",
                        namespace.display()
                    ),
                });
            }
            Ok(meta) if !meta.is_dir() => {
                return Err(Unready {
                    kind: UnreadyKind::NotData,
                    detail: format!("{} is not a directory", namespace.display()),
                });
            }
            Ok(_) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Err(Unready {
                    kind: UnreadyKind::MountMissing,
                    detail: format!(
                        "{} does not exist; DATA is not mounted there",
                        namespace.display()
                    ),
                });
            }
            Err(err) => {
                return Err(Unready {
                    kind: UnreadyKind::ProbeFailed,
                    detail: format!("stat {}: {err}", namespace.display()),
                });
            }
        }
        let table = fs::read_to_string(&self.mountinfo).map_err(|err| Unready {
            kind: UnreadyKind::ProbeFailed,
            detail: format!("read {}: {err}", self.mountinfo.display()),
        })?;
        let entries = parse_mountinfo(&table);
        let namespace_str = namespace.to_string_lossy();
        let Some(entry) = entries
            .iter()
            .rev()
            .find(|entry| entry.mount_point == namespace_str)
        else {
            return Err(Unready {
                kind: UnreadyKind::MountMissing,
                detail: format!(
                    "{} is not a mount point; DATA is not mounted there",
                    namespace.display()
                ),
            });
        };
        let Some(pool) = entries
            .iter()
            .rev()
            .find(|candidate| candidate.mount_point == DATA_MOUNT)
        else {
            return Err(Unready {
                kind: UnreadyKind::MountMissing,
                detail: format!(
                    "DATA is not mounted at {DATA_MOUNT}; nothing backs {}",
                    namespace.display()
                ),
            });
        };
        if entry.device != pool.device {
            return Err(Unready {
                kind: UnreadyKind::NotData,
                detail: format!(
                    "{} is mounted from {} ({}), not the DATA pool at {DATA_MOUNT} ({})",
                    namespace.display(),
                    entry.source,
                    entry.fstype,
                    pool.source
                ),
            });
        }
        if [&entry.options, &entry.super_options, &pool.options]
            .iter()
            .any(|options| has_option(options, "ro"))
        {
            return Err(Unready {
                kind: UnreadyKind::ReadOnly,
                detail: format!(
                    "{} is mounted read-only ({})",
                    namespace.display(),
                    pool.source
                ),
            });
        }
        let root_prefix = format!("{}/", self.root.to_string_lossy());
        if let Some(foreign) = entries
            .iter()
            .find(|candidate| candidate.mount_point.starts_with(&root_prefix))
        {
            return Err(Unready {
                kind: UnreadyKind::NotData,
                detail: format!(
                    "{} is a separate mount ({} {}) inside the workspace; a same-filesystem \
                     rename cannot cross it",
                    foreign.mount_point, foreign.fstype, foreign.source
                ),
            });
        }
        Ok((entry.clone(), pool.clone()))
    }

    /// The directory half: the root and its three subdirectories exist, are
    /// real directories, and sit on the namespace's filesystem.
    fn check_subtree(&self, namespace: &Path) -> Result<(), Unready> {
        let namespace_dev = fs::metadata(namespace)
            .map_err(|err| Unready {
                kind: UnreadyKind::ProbeFailed,
                detail: format!("stat {}: {err}", namespace.display()),
            })?
            .dev();
        for dir in [
            self.root.clone(),
            self.downloads(),
            self.verified(),
            self.staging(),
        ] {
            let meta = match fs::symlink_metadata(&dir) {
                Ok(meta) => meta,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                    return Err(Unready {
                        kind: UnreadyKind::MountMissing,
                        detail: format!(
                            "{} does not exist; mos-data-layout lays the workspace out before \
                             any writer starts",
                            dir.display()
                        ),
                    });
                }
                Err(err) => {
                    return Err(Unready {
                        kind: UnreadyKind::ProbeFailed,
                        detail: format!("stat {}: {err}", dir.display()),
                    });
                }
            };
            if meta.file_type().is_symlink() {
                return Err(Unready {
                    kind: UnreadyKind::NotData,
                    detail: format!(
                        "{} is a symbolic link; refusing the substitution",
                        dir.display()
                    ),
                });
            }
            if !meta.is_dir() {
                return Err(Unready {
                    kind: UnreadyKind::NotData,
                    detail: format!("{} is not a directory", dir.display()),
                });
            }
            if meta.dev() != namespace_dev {
                return Err(Unready {
                    kind: UnreadyKind::NotData,
                    detail: format!(
                        "{} is not on the same filesystem as {}",
                        dir.display(),
                        namespace.display()
                    ),
                });
            }
        }
        Ok(())
    }

    /// Create (`O_EXCL`), fsync and remove a private file in `staging/`,
    /// then fsync the directory: the positive proof of writability, with the
    /// failure mapped onto the kind it evidences.
    fn write_probe_file(&self) -> Result<(), Unready> {
        let staging = self.staging();
        let probe = staging.join(format!(".readiness-probe.{}", std::process::id()));
        let classify = |(what, err): (&str, std::io::Error)| {
            let kind = match err.kind() {
                std::io::ErrorKind::ReadOnlyFilesystem => UnreadyKind::ReadOnly,
                std::io::ErrorKind::StorageFull | std::io::ErrorKind::QuotaExceeded => {
                    UnreadyKind::Exhausted
                }
                _ => UnreadyKind::ProbeFailed,
            };
            Unready {
                kind,
                detail: format!("{what} {}: {err}", probe.display()),
            }
        };
        let written = create_sync_probe(&probe);
        // Removed even when the write failed, so a partial probe file never
        // outlives the probe that made it.
        let removed = fs::remove_file(&probe);
        written.map_err(classify)?;
        removed.map_err(|err| classify(("remove", err)))?;
        fs::File::open(&staging)
            .and_then(|dir| dir.sync_all())
            .map_err(|err| Unready {
                kind: UnreadyKind::ProbeFailed,
                detail: format!("sync directory {}: {err}", staging.display()),
            })
    }
}

/// Create `probe` exclusively, write it, fsync it; the failing step is named
/// so the caller can classify the error by what it was doing.
fn create_sync_probe(probe: &Path) -> Result<(), (&'static str, std::io::Error)> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(probe)
        .map_err(|err| ("create", err))?;
    file.write_all(b"mos update workspace readiness probe\n")
        .map_err(|err| ("write", err))?;
    file.sync_all().map_err(|err| ("sync", err))?;
    Ok(())
}

/// Sum of regular-file sizes under `dir`, recursing into subdirectories,
/// never following symlinks, skipping `skip` names at any depth.
fn sum_regular_files(dir: &Path, skip: &[&str]) -> Result<u64> {
    let mut used = 0u64;
    for entry in fs::read_dir(dir).with_context(|| format!("read directory {}", dir.display()))? {
        let entry = entry.with_context(|| format!("read {}", dir.display()))?;
        let name = entry.file_name();
        if skip.iter().any(|own| name.as_os_str() == *own) {
            continue;
        }
        let meta = fs::symlink_metadata(entry.path())
            .with_context(|| format!("stat {}", entry.path().display()))?;
        if meta.file_type().is_file() {
            used = used.saturating_add(meta.len());
        } else if meta.is_dir() {
            used = used.saturating_add(sum_regular_files(&entry.path(), skip)?);
        }
    }
    Ok(used)
}

/// Whether a comma-separated mount option list carries `flag` as a whole
/// token.
fn has_option(options: &str, flag: &str) -> bool {
    options.split(',').any(|option| option == flag)
}

/// Parse a `/proc/self/mountinfo` table. Lines that do not have the
/// documented shape are skipped: a probe must not fail on a mount it does
/// not understand, only on the one it is asking about.
fn parse_mountinfo(table: &str) -> Vec<MountEntry> {
    let mut entries = Vec::new();
    for line in table.lines() {
        let fields: Vec<&str> = line.split(' ').collect();
        let Some(separator) = fields.iter().position(|field| *field == "-") else {
            continue;
        };
        if separator < 6 || fields.len() < separator + 4 {
            continue;
        }
        entries.push(MountEntry {
            device: fields[2].to_string(),
            root: unescape(fields[3]),
            mount_point: unescape(fields[4]),
            options: fields[5].to_string(),
            fstype: fields[separator + 1].to_string(),
            source: unescape(fields[separator + 2]),
            super_options: fields[separator + 3].to_string(),
        });
    }
    entries
}

/// Undo mountinfo's octal escaping of space, tab, newline and backslash.
fn unescape(field: &str) -> String {
    let mut out = String::with_capacity(field.len());
    let bytes = field.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\\'
            && index + 4 <= bytes.len()
            && let Some(value) = std::str::from_utf8(&bytes[index + 1..index + 4])
                .ok()
                .and_then(|digits| u8::from_str_radix(digits, 8).ok())
        {
            out.push(value as char);
            index += 4;
            continue;
        }
        out.push(bytes[index] as char);
        index += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const TABLE: &str = "\
21 1 0:20 / / ro,relatime - ext4 /dev/dm-0 ro,errors=remount-ro
30 21 0:25 / /run rw,nosuid,nodev - tmpfs tmpfs rw,size=204800k
31 21 179:5 / /var rw,noatime - ext4 /dev/mmcblk0p5 rw,noatime
32 21 179:6 /mos /var/lib/mos rw,noatime - ext4 /dev/mmcblk0p6 rw,noatime
33 21 179:7 / /mnt/data rw,noatime - ext4 /dev/mmcblk0p7 rw,noatime
34 21 179:7 /mos /mos rw,noatime - ext4 /dev/mmcblk0p7 rw,noatime
35 21 179:7 /srv /srv rw,noatime - ext4 /dev/mmcblk0p7 rw,noatime
36 21 0:30 / /mnt/with\\040space rw - tmpfs tmpfs rw
";

    #[test]
    fn mountinfo_is_parsed_by_field_position_and_unescaped() {
        let entries = parse_mountinfo(TABLE);
        assert_eq!(entries.len(), 8);
        let mos = entries
            .iter()
            .find(|e| e.mount_point == "/mos")
            .expect("/mos");
        assert_eq!(
            mos,
            &MountEntry {
                device: "179:7".to_string(),
                root: "/mos".to_string(),
                mount_point: "/mos".to_string(),
                options: "rw,noatime".to_string(),
                fstype: "ext4".to_string(),
                source: "/dev/mmcblk0p7".to_string(),
                super_options: "rw,noatime".to_string(),
            }
        );
        // The pool and both binds are one device: the fact the probe rests on.
        let pool = entries
            .iter()
            .find(|e| e.mount_point == DATA_MOUNT)
            .expect("pool");
        assert_eq!(pool.device, mos.device);
        assert!(entries.iter().any(|e| e.mount_point == "/mnt/with space"));
        // A line without the separator is skipped, not fatal.
        assert!(parse_mountinfo("garbage line\n").is_empty());
    }

    #[test]
    fn options_are_matched_as_whole_tokens() {
        assert!(has_option("rw,ro", "ro"));
        assert!(!has_option("rw,errors=remount-ro", "ro"));
        assert!(!has_option("rw,noatime", "ro"));
    }

    #[test]
    fn every_kind_has_a_status_and_the_line_names_both() {
        for (kind, status) in [
            (UnreadyKind::MountMissing, Status::Unavailable),
            (UnreadyKind::NotData, Status::Unavailable),
            (UnreadyKind::ReadOnly, Status::Degraded),
            (UnreadyKind::Exhausted, Status::Degraded),
            (UnreadyKind::ProbeFailed, Status::Degraded),
        ] {
            assert_eq!(kind.status(), status);
            let unready = Unready {
                kind,
                detail: "why".to_string(),
            };
            assert_eq!(
                unready.to_string(),
                format!("{} {}: why", status.as_str(), kind.as_str())
            );
        }
    }

    #[test]
    fn a_workspace_root_must_be_absolute_and_below_a_namespace() {
        assert!(Workspace::at(PathBuf::from("relative/updates"), PathBuf::from("/x")).is_err());
        assert!(Workspace::at(PathBuf::from("/updates"), PathBuf::from("/x")).is_err());
        assert!(Workspace::at(PathBuf::from("/mos/../updates"), PathBuf::from("/x")).is_err());
        let ws = Workspace::at(PathBuf::from(DEFAULT_ROOT), PathBuf::from("/x")).expect("default");
        assert_eq!(ws.namespace(), Path::new("/mos"));
        assert_eq!(ws.downloads(), PathBuf::from("/mos/updates/downloads"));
        assert_eq!(ws.verified(), PathBuf::from("/mos/updates/verified"));
        assert_eq!(ws.staging(), PathBuf::from("/mos/updates/staging"));
    }
}
