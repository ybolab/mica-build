//! SSH access reconciler: renders the sshd drop-in from `access.ssh`, drives
//! `ssh.service`, and applies the device password hash to the root account.
//!
//! Three system effects, in this order:
//!
//! 1. `/etc/ssh/sshd_config.d/10-mos.conf` is rendered from `access.ssh`. That
//!    directory is the one writable part of `/etc` on the v2 read-only root —
//!    it is a STATE-backed bind mount (`etc-ssh.mount`).
//! 2. the device password is hashed with bcrypt and written into the root
//!    account's shadow entry, so the password the device generated for itself
//!    is the password SSH and the console accept.
//! 3. `ssh.service` is brought to the state `access.ssh.enabled` asks for.
//!
//! Credential before service start, deliberately: a running sshd whose root
//! account still carries the image's (locked, or worse, shared) hash is the
//! failure this ordering rules out.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow};
use mosd_settings::{Settings, SshSettings};
use serde_json::json;

use super::Reconciler;
use super::systemd::{Systemd, UnitControl, is_active, is_enabled};

/// Unit implementing the SSH server.
const SSH_UNIT: &str = "ssh.service";
/// Drop-in rendered from `access.ssh`; `sshd_config` includes this directory.
const DEFAULT_DROP_IN: &str = "/etc/ssh/sshd_config.d/10-mos.conf";
/// Shadow file holding the root account's password hash.
const DEFAULT_SHADOW: &str = "/etc/shadow";
/// Environment variable overriding the drop-in path.
const DROP_IN_ENV: &str = "MOSD_SSHD_DROP_IN";
/// Environment variable overriding the shadow file path.
const SHADOW_ENV: &str = "MOSD_SHADOW_PATH";
/// Environment variable overriding the STATE directory holding the secrets.
const STATE_DIR_ENV: &str = "MOSD_STATE_DIR";
/// Mode of the rendered drop-in: world-readable configuration, owner-writable.
const DROP_IN_MODE: u32 = 0o644;
/// Account whose password hash mosd owns.
const ROOT_ACCOUNT: &str = "root";
/// Prefix identifying that account's shadow entry.
const ROOT_PREFIX: &str = "root:";
/// bcrypt cost for the shadow hash. 12 is the current defensible default: a
/// few hundred milliseconds per verification on the target class of hardware,
/// which is tolerable for an interactive login and expensive for an attacker
/// working through a stolen shadow file.
const BCRYPT_COST: u32 = 12;
/// Field index of the password hash in a shadow entry.
const SHADOW_HASH_FIELD: usize = 1;

/// What the reconciler did to the root account's shadow entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RootPassword {
    /// The hash was written; the account's password changed.
    Applied,
    /// The stored hash already matched; the file was left alone.
    Unchanged,
    /// `access.device.password_hash` is unset, so there is nothing to apply
    /// yet. Distinct from an error: a device whose first boot has not
    /// provisioned itself has no credential, which is expected, whereas a
    /// missing shadow file or a shadow file without a root entry means the
    /// image wiring is broken and is reported as an error.
    Absent,
    /// The credential exists but its plaintext does not, so no crypt(3) hash
    /// can be derived from it.
    ///
    /// A real state rather than a defect: `identity::ensure_identity`
    /// deliberately never regenerates a credential whose hash is already
    /// present, so a STATE that lost only the plaintext file keeps the hash.
    /// The operator's password still authenticates against
    /// `access.device.password_hash` on the web UI; only the shadow entry
    /// cannot be refreshed. Kept distinct from [`Self::Absent`] so "not
    /// provisioned yet" and "provisioned, plaintext gone" are never read as
    /// the same condition.
    PlaintextMissing,
}

impl RootPassword {
    /// Live-state spelling of this outcome.
    fn as_str(self) -> &'static str {
        match self {
            Self::Applied => "applied",
            Self::Unchanged => "unchanged",
            Self::Absent => "absent",
            Self::PlaintextMissing => "plaintext-missing",
        }
    }
}

/// Reconciler for the `access.ssh` settings subtree.
pub struct SshdReconciler<C: UnitControl> {
    drop_in_path: PathBuf,
    shadow_path: PathBuf,
    state_dir: PathBuf,
    control: C,
}

impl<C: UnitControl> SshdReconciler<C> {
    /// Create an sshd reconciler writing `drop_in_path` and `shadow_path`,
    /// reading the device password from `state_dir`, and driving
    /// `ssh.service` through `control`.
    ///
    /// Every path is a parameter so tests run entirely inside a temporary
    /// directory and never touch the host's sshd.
    pub fn new(
        drop_in_path: PathBuf,
        shadow_path: PathBuf,
        state_dir: PathBuf,
        control: C,
    ) -> Self {
        Self {
            drop_in_path,
            shadow_path,
            state_dir,
            control,
        }
    }
}

impl SshdReconciler<Systemd> {
    /// Production reconciler: paths from [`DROP_IN_ENV`], [`SHADOW_ENV`] and
    /// [`STATE_DIR_ENV`] if set, else the system locations.
    pub fn production() -> Self {
        let drop_in = std::env::var(DROP_IN_ENV)
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_DROP_IN));
        let shadow = std::env::var(SHADOW_ENV)
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_SHADOW));
        let state_dir = std::env::var(STATE_DIR_ENV)
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(crate::identity::DEFAULT_STATE_DIR));
        Self::new(drop_in, shadow, state_dir, Systemd)
    }
}

/// Render the sshd drop-in for `ssh`.
///
/// Pure and deterministic: the same settings always produce the same bytes, so
/// a re-render can be compared against what is on disk to decide whether
/// anything actually changed.
///
/// An empty `listen_addresses` emits **no** `ListenAddress` directive at all,
/// which is sshd's "listen on every address". Encoding "listen nowhere" as the
/// empty list would make an operator who enables SSH without naming an address
/// end up with a running but unreachable server; closure is already expressed
/// by `enabled: false`.
fn render_drop_in(ssh: &SshSettings) -> String {
    let yes_no = |value: bool| if value { "yes" } else { "no" };
    let mut out = String::from("# Managed by mosd from access.ssh. Do not edit.\n");
    out.push_str(&format!("Port {}\n", ssh.port));
    out.push_str(&format!(
        "PermitRootLogin {}\n",
        yes_no(ssh.permit_root_login)
    ));
    out.push_str(&format!(
        "PasswordAuthentication {}\n",
        yes_no(ssh.password_authentication)
    ));
    for address in &ssh.listen_addresses {
        out.push_str(&format!("ListenAddress {address}\n"));
    }
    out
}

/// The hash field of the `root:` line in `shadow`.
///
/// # Errors
///
/// Returns an error when there is no `root:` line — mosd owns that account's
/// credential, so a shadow file without it is a broken image, not an empty
/// job.
fn root_hash(shadow: &str) -> Result<&str> {
    shadow
        .lines()
        .find(|line| line.starts_with(ROOT_PREFIX))
        .and_then(|line| line.split(':').nth(SHADOW_HASH_FIELD))
        .ok_or_else(|| anyhow!("no `{ROOT_ACCOUNT}:` entry in shadow file"))
}

/// Replace the hash field of the `root:` line in `shadow` with `hash`.
///
/// Read-modify-write on the exact bytes: every other account's line, the field
/// count and ordering of the root line, and the presence or absence of a
/// trailing newline all survive untouched.
///
/// # Errors
///
/// Returns an error when there is no `root:` line.
fn rewrite_root_hash(shadow: &str, hash: &str) -> Result<String> {
    let mut lines: Vec<String> = shadow.split('\n').map(str::to_string).collect();
    let root = lines
        .iter_mut()
        .find(|line| line.starts_with(ROOT_PREFIX))
        .ok_or_else(|| anyhow!("no `{ROOT_ACCOUNT}:` entry in shadow file"))?;

    // The line matched `root:`, so splitting on `:` yields at least the name
    // and the hash field; every further field is carried over untouched.
    let mut fields: Vec<&str> = root.split(':').collect();
    fields[SHADOW_HASH_FIELD] = hash;
    *root = fields.join(":");

    Ok(lines.join("\n"))
}

/// Write `contents` to `path` atomically: a temporary file in the same
/// directory, flushed, then renamed over the target.
///
/// Same directory because `rename` is only atomic within one filesystem, and
/// `/etc/ssh/sshd_config.d` is a separate mount from `/etc`.
///
/// `mode` is applied explicitly rather than left to the umask so the result is
/// deterministic, and `owner` (uid, gid) is restored when given — a shadow
/// file that comes back owned by `root:root` instead of `root:shadow` locks
/// out every setgid tool that reads it.
fn write_atomically(
    path: &Path,
    contents: &str,
    mode: u32,
    owner: Option<(u32, u32)>,
) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    let directory = path
        .parent()
        .ok_or_else(|| anyhow!("{} has no parent directory", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .ok_or_else(|| anyhow!("{} has no file name", path.display()))?;
    let temp = directory.join(format!(".{file_name}.mosd-tmp"));

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(mode)
        .open(&temp)
        .with_context(|| format!("create {}", temp.display()))?;
    file.write_all(contents.as_bytes())
        .with_context(|| format!("write {}", temp.display()))?;
    file.sync_all()
        .with_context(|| format!("flush {}", temp.display()))?;
    drop(file);

    // The mode above only takes effect when the temporary file is created; a
    // leftover from an interrupted run would keep its old mode.
    std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(mode))
        .with_context(|| format!("set mode on {}", temp.display()))?;
    if let Some((uid, gid)) = owner {
        std::os::unix::fs::chown(&temp, Some(uid), Some(gid))
            .with_context(|| format!("set owner on {}", temp.display()))?;
    }

    std::fs::rename(&temp, path)
        .with_context(|| format!("rename {} to {}", temp.display(), path.display()))?;
    Ok(())
}

impl<C: UnitControl> SshdReconciler<C> {
    /// Render the drop-in and report whether its bytes changed.
    ///
    /// An unchanged render is not rewritten: the drop-in lives on STATE, and
    /// a rewrite that changes nothing still costs a flash write on every
    /// reconcile.
    fn apply_drop_in(&self, ssh: &SshSettings) -> Result<bool> {
        let rendered = render_drop_in(ssh);
        if let Ok(current) = std::fs::read_to_string(&self.drop_in_path)
            && current == rendered
        {
            return Ok(false);
        }
        if let Some(directory) = self.drop_in_path.parent() {
            std::fs::create_dir_all(directory)
                .with_context(|| format!("create {}", directory.display()))?;
        }
        write_atomically(&self.drop_in_path, &rendered, DROP_IN_MODE, None)
            .with_context(|| format!("render {}", self.drop_in_path.display()))?;
        Ok(true)
    }

    /// Apply the device password to the root account's shadow entry.
    ///
    /// The shadow field carries a **bcrypt** hash, not the Argon2id PHC string
    /// in `access.device.password_hash`. The two are not interchangeable and
    /// one cannot be derived from the other: the login stack verifies the
    /// shadow field through crypt(3), and the image's libcrypt implements
    /// bcrypt, yescrypt and the sha2crypt family but not Argon2 — a hash it
    /// cannot parse rejects every password while looking perfectly healthy on
    /// disk. So the plaintext is read from STATE and hashed a second time, in
    /// the format the device can actually verify. `access.device.password_hash`
    /// is untouched and stays the credential mosd and webd verify against
    /// themselves, where Argon2id is the right choice and libcrypt is not
    /// involved.
    fn apply_root_password(&self, settings: &Settings) -> Result<RootPassword> {
        use std::os::unix::fs::MetadataExt;
        use std::os::unix::fs::PermissionsExt;

        if settings.access.device.password_hash.is_none() {
            return Ok(RootPassword::Absent);
        }
        let Some(password) = crate::identity::read_device_password(&self.state_dir)? else {
            tracing::warn!(
                state_dir = %self.state_dir.display(),
                "device credential present but its plaintext is gone; the root shadow entry \
                 cannot be refreshed"
            );
            return Ok(RootPassword::PlaintextMissing);
        };

        let current = std::fs::read_to_string(&self.shadow_path).with_context(|| {
            format!(
                "read {} — the root credential cannot be applied without it",
                self.shadow_path.display()
            )
        })?;
        // bcrypt salts every hash, so the stored value and a fresh one never
        // compare equal. Verification is what "already applied" means here;
        // without it every reconcile would rewrite the shadow file with a new
        // salt.
        let stored = root_hash(&current)
            .with_context(|| format!("update {}", self.shadow_path.display()))?;
        if bcrypt::verify(&password, stored).unwrap_or(false) {
            return Ok(RootPassword::Unchanged);
        }

        let crypt_hash = bcrypt::hash(&password, BCRYPT_COST)
            .map_err(|err| anyhow!("hash the device password for the shadow file: {err}"))?;
        let updated = rewrite_root_hash(&current, &crypt_hash)
            .with_context(|| format!("update {}", self.shadow_path.display()))?;

        let metadata = std::fs::metadata(&self.shadow_path)
            .with_context(|| format!("stat {}", self.shadow_path.display()))?;
        write_atomically(
            &self.shadow_path,
            &updated,
            metadata.permissions().mode() & 0o7777,
            Some((metadata.uid(), metadata.gid())),
        )?;
        Ok(RootPassword::Applied)
    }

    /// Bring `ssh.service` to the state `ssh.enabled` asks for.
    ///
    /// Reads before it writes, so a system already in the target state gets no
    /// calls at all. `config_changed` forces a restart of an already-running
    /// sshd, because a rewritten drop-in that nothing re-reads is a
    /// configuration that silently did not take effect.
    async fn apply_unit(&self, ssh: &SshSettings, config_changed: bool) -> Result<()> {
        if ssh.enabled {
            if !is_enabled(&self.control.unit_file_state(SSH_UNIT).await?) {
                self.control.enable(SSH_UNIT).await?;
            }
            if is_active(&self.control.active_state(SSH_UNIT).await?) {
                if config_changed {
                    self.control.restart(SSH_UNIT).await?;
                }
            } else {
                self.control.start(SSH_UNIT).await?;
            }
        } else {
            if is_active(&self.control.active_state(SSH_UNIT).await?) {
                self.control.stop(SSH_UNIT).await?;
            }
            if is_enabled(&self.control.unit_file_state(SSH_UNIT).await?) {
                self.control.disable(SSH_UNIT).await?;
            }
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl<C: UnitControl> Reconciler for SshdReconciler<C> {
    fn name(&self) -> &'static str {
        "sshd"
    }

    fn subtree(&self) -> &'static str {
        "access.ssh"
    }

    async fn apply(&self, settings: &Settings) -> Result<serde_json::Value> {
        let ssh = &settings.access.ssh;
        let config_changed = self.apply_drop_in(ssh)?;
        let root_password = self.apply_root_password(settings)?;
        self.apply_unit(ssh, config_changed).await?;

        Ok(json!({
            "enabled": ssh.enabled,
            "port": ssh.port,
            "permitRootLogin": ssh.permit_root_login,
            "passwordAuthentication": ssh.password_authentication,
            "listenAddresses": ssh.listen_addresses,
            "dropIn": self.drop_in_path.display().to_string(),
            "unit": SSH_UNIT,
            "activeState": self.control.active_state(SSH_UNIT).await?,
            "unitFileState": self.control.unit_file_state(SSH_UNIT).await?,
            "rootPassword": root_password.as_str(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    use mosd_settings::DeviceCredentialSettings;

    use super::super::systemd::mock::MockUnitControl;
    use super::*;

    const GOLDEN_DEFAULTS: &str = "# Managed by mosd from access.ssh. Do not edit.\n\
        Port 22\nPermitRootLogin yes\nPasswordAuthentication yes\n";
    const GOLDEN_LISTEN: &str = "# Managed by mosd from access.ssh. Do not edit.\n\
        Port 2222\nPermitRootLogin no\nPasswordAuthentication no\n\
        ListenAddress 10.0.0.5\nListenAddress fd00::1\n";

    /// Three accounts, nine fields each, trailing newline — the shape of a
    /// Debian `/etc/shadow`. `root` starts out locked (`!`).
    const SHADOW: &str = "root:!:19000:0:99999:7:::\n\
        daemon:*:19000:0:99999:7:::\n\
        operator:$6$rounds=5000$abcd$efgh:19100:0:99999:7:::\n";
    /// The two accounts the reconciler must never touch.
    const OTHER_ACCOUNTS: &str = "daemon:*:19000:0:99999:7:::\n\
        operator:$6$rounds=5000$abcd$efgh:19100:0:99999:7:::\n";
    /// Plaintext device password on STATE, in the shape `identity` generates.
    const PASSWORD: &str = "8XKD3Q7NRTV2MJH4";
    /// Argon2id PHC string in `access.device.password_hash`; the credential of
    /// record, and never what lands in the shadow file.
    const ARGON_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g";
    /// Opaque replacement hash for the pure-function rewrite tests.
    const CRYPT_HASH: &str = "$2b$12$abcdefghijklmnopqrstuvOJqM0iZ5wKzXwZ2G8bqZ0aVjPQnDGa";
    const SHADOW_MODE: u32 = 0o640;

    fn ssh_settings(enabled: bool) -> SshSettings {
        SshSettings {
            enabled,
            ..SshSettings::default()
        }
    }

    fn settings_with(ssh: SshSettings, password_hash: Option<&str>) -> Settings {
        Settings {
            access: mosd_settings::AccessSettings {
                ssh,
                device: DeviceCredentialSettings {
                    password_hash: password_hash.map(str::to_string),
                    generation: u32::from(password_hash.is_some()),
                },
                ..mosd_settings::AccessSettings::default()
            },
            ..Settings::default()
        }
    }

    /// Paths of a fixture, all of them under the tempdir.
    struct Paths {
        drop_in: PathBuf,
        shadow: PathBuf,
        state: PathBuf,
    }

    /// Fixture rooted entirely inside `dir`: a drop-in path that does not
    /// exist yet, a shadow file at [`SHADOW_MODE`], and a STATE directory
    /// holding `plaintext` when given.
    fn fixture_with(
        dir: &Path,
        active: &str,
        file_state: &str,
        plaintext: Option<&str>,
    ) -> (SshdReconciler<MockUnitControl>, Paths) {
        let paths = Paths {
            drop_in: dir.join("sshd_config.d").join("10-mos.conf"),
            shadow: dir.join("shadow"),
            state: dir.join("state"),
        };
        std::fs::write(&paths.shadow, SHADOW).unwrap();
        std::fs::set_permissions(&paths.shadow, std::fs::Permissions::from_mode(SHADOW_MODE))
            .unwrap();
        if let Some(plaintext) = plaintext {
            let secrets = paths.state.join("secrets");
            std::fs::create_dir_all(&secrets).unwrap();
            std::fs::write(secrets.join("device-password"), plaintext).unwrap();
        }
        let reconciler = SshdReconciler::new(
            paths.drop_in.clone(),
            paths.shadow.clone(),
            paths.state.clone(),
            MockUnitControl::new(active, file_state),
        );
        (reconciler, paths)
    }

    /// The common case: a provisioned device whose plaintext is on STATE.
    fn fixture(
        dir: &Path,
        active: &str,
        file_state: &str,
    ) -> (SshdReconciler<MockUnitControl>, Paths) {
        fixture_with(dir, active, file_state, Some(PASSWORD))
    }

    fn mode_of(path: &Path) -> u32 {
        std::fs::metadata(path).unwrap().permissions().mode() & 0o7777
    }

    /// The hash field of the root entry in the shadow file at `path`.
    fn stored_root_hash(path: &Path) -> String {
        root_hash(&std::fs::read_to_string(path).unwrap())
            .unwrap()
            .to_string()
    }

    // ---- R2: rendering ----------------------------------------------------

    #[test]
    fn empty_listen_addresses_emit_no_listen_address_directive() {
        let rendered = render_drop_in(&SshSettings::default());

        assert_eq!(rendered, GOLDEN_DEFAULTS);
        assert!(
            !rendered.contains("ListenAddress"),
            "empty listenAddresses means listen on all, so no directive: {rendered}"
        );
    }

    #[test]
    fn each_listen_address_becomes_one_directive() {
        let rendered = render_drop_in(&SshSettings {
            enabled: true,
            port: 2222,
            permit_root_login: false,
            password_authentication: false,
            listen_addresses: vec!["10.0.0.5".to_string(), "fd00::1".to_string()],
        });

        assert_eq!(rendered, GOLDEN_LISTEN);
        assert_eq!(rendered.matches("ListenAddress ").count(), 2);
    }

    #[test]
    fn render_is_deterministic() {
        let ssh = SshSettings {
            enabled: true,
            port: 2222,
            permit_root_login: false,
            password_authentication: true,
            listen_addresses: vec!["10.0.0.5".to_string()],
        };

        assert_eq!(render_drop_in(&ssh), render_drop_in(&ssh.clone()));
    }

    #[tokio::test]
    async fn apply_writes_the_golden_drop_in_creating_its_directory() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");

        reconciler
            .apply(&settings_with(ssh_settings(true), Some(ARGON_HASH)))
            .await
            .unwrap();

        assert_eq!(
            std::fs::read_to_string(&paths.drop_in).unwrap(),
            GOLDEN_DEFAULTS
        );
        assert_eq!(mode_of(&paths.drop_in), 0o644);
    }

    #[tokio::test]
    async fn apply_leaves_no_temporary_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");

        reconciler
            .apply(&settings_with(ssh_settings(true), Some(ARGON_HASH)))
            .await
            .unwrap();

        for directory in [paths.drop_in.parent().unwrap(), dir.path()] {
            let leftovers: Vec<_> = std::fs::read_dir(directory)
                .unwrap()
                .map(|entry| entry.unwrap().file_name())
                .filter(|name| name.to_string_lossy().contains("mosd-tmp"))
                .collect();
            assert!(leftovers.is_empty(), "temp files left: {leftovers:?}");
        }
    }

    // ---- R3: unit state ---------------------------------------------------

    #[tokio::test]
    async fn disabled_to_enabled_enables_then_starts() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _paths) = fixture(dir.path(), "inactive", "disabled");

        let state = reconciler
            .apply(&settings_with(ssh_settings(true), Some(ARGON_HASH)))
            .await
            .unwrap();

        assert_eq!(
            reconciler.control.calls(),
            vec![
                "enable ssh.service".to_string(),
                "start ssh.service".to_string()
            ]
        );
        assert_eq!(state["enabled"], json!(true));
        assert_eq!(state["activeState"], json!("active"));
        assert_eq!(state["unitFileState"], json!("enabled-runtime"));
        assert_eq!(state["unit"], json!("ssh.service"));
        assert_eq!(reconciler.name(), "sshd");
        assert_eq!(reconciler.subtree(), "access.ssh");
    }

    #[tokio::test]
    async fn enabled_to_disabled_stops_then_disables() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _paths) = fixture(dir.path(), "active", "enabled");

        let state = reconciler
            .apply(&settings_with(ssh_settings(false), Some(ARGON_HASH)))
            .await
            .unwrap();

        assert_eq!(
            reconciler.control.calls(),
            vec![
                "stop ssh.service".to_string(),
                "disable ssh.service".to_string()
            ]
        );
        assert_eq!(state["enabled"], json!(false));
        assert_eq!(state["activeState"], json!("inactive"));
        assert_eq!(state["unitFileState"], json!("disabled"));
    }

    #[tokio::test]
    async fn already_running_and_enabled_needs_no_calls() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "active", "enabled");
        std::fs::create_dir_all(paths.drop_in.parent().unwrap()).unwrap();
        std::fs::write(&paths.drop_in, GOLDEN_DEFAULTS).unwrap();

        reconciler
            .apply(&settings_with(ssh_settings(true), Some(ARGON_HASH)))
            .await
            .unwrap();

        assert!(
            reconciler.control.calls().is_empty(),
            "converged system got calls: {:?}",
            reconciler.control.calls()
        );
    }

    #[tokio::test]
    async fn already_stopped_and_disabled_needs_no_calls() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _paths) = fixture(dir.path(), "inactive", "disabled");

        reconciler
            .apply(&settings_with(ssh_settings(false), Some(ARGON_HASH)))
            .await
            .unwrap();

        assert!(
            reconciler.control.calls().is_empty(),
            "converged system got calls: {:?}",
            reconciler.control.calls()
        );
    }

    #[tokio::test]
    async fn reapplying_the_same_settings_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");
        let settings = settings_with(ssh_settings(true), Some(ARGON_HASH));

        let first = reconciler.apply(&settings).await.unwrap();
        let after_first = reconciler.control.calls();
        let shadow_after_first = std::fs::read_to_string(&paths.shadow).unwrap();
        // A marker the reconciler would clobber if it rewrote the file: the
        // renderer always produces mode 0644.
        std::fs::set_permissions(&paths.drop_in, std::fs::Permissions::from_mode(0o600)).unwrap();

        let second = reconciler.apply(&settings).await.unwrap();

        assert_eq!(reconciler.control.calls(), after_first);
        assert_eq!(
            mode_of(&paths.drop_in),
            0o600,
            "an unchanged drop-in must not be rewritten"
        );
        assert_eq!(
            std::fs::read_to_string(&paths.drop_in).unwrap(),
            GOLDEN_DEFAULTS
        );
        assert_eq!(first["rootPassword"], json!("applied"));
        assert_eq!(second["rootPassword"], json!("unchanged"));
        assert_eq!(
            std::fs::read_to_string(&paths.shadow).unwrap(),
            shadow_after_first,
            "bcrypt re-salts on every hash, so a re-hash would show up here"
        );
    }

    #[tokio::test]
    async fn changing_the_config_of_a_running_sshd_restarts_it() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "active", "enabled");
        std::fs::create_dir_all(paths.drop_in.parent().unwrap()).unwrap();
        std::fs::write(&paths.drop_in, GOLDEN_DEFAULTS).unwrap();

        let state = reconciler
            .apply(&settings_with(
                SshSettings {
                    enabled: true,
                    port: 2222,
                    ..SshSettings::default()
                },
                Some(ARGON_HASH),
            ))
            .await
            .unwrap();

        assert_eq!(
            reconciler.control.calls(),
            vec!["restart ssh.service".to_string()]
        );
        assert!(
            std::fs::read_to_string(&paths.drop_in)
                .unwrap()
                .contains("Port 2222\n")
        );
        assert_eq!(state["port"], json!(2222));
    }

    // ---- R4: root password ------------------------------------------------

    #[tokio::test]
    async fn shadow_gets_a_bcrypt_hash_that_verifies_against_the_plaintext() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");

        let state = reconciler
            .apply(&settings_with(ssh_settings(true), Some(ARGON_HASH)))
            .await
            .unwrap();

        let written = stored_root_hash(&paths.shadow);
        assert_eq!(state["rootPassword"], json!("applied"));
        assert!(
            written.starts_with("$2b$12$"),
            "shadow must carry a crypt(3) format the image's libcrypt implements, got {written}"
        );
        assert!(
            bcrypt::verify(PASSWORD, &written).unwrap(),
            "the device password must verify against what was written"
        );
        assert!(
            !bcrypt::verify("WRONGPASSWORD123", &written).unwrap(),
            "a different password must not verify"
        );
        assert!(
            !written.contains("argon2"),
            "the Argon2id credential must not reach the shadow file: {written}"
        );
    }

    #[tokio::test]
    async fn shadow_rewrite_touches_nothing_but_the_root_hash() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");

        reconciler
            .apply(&settings_with(ssh_settings(true), Some(ARGON_HASH)))
            .await
            .unwrap();

        let written = stored_root_hash(&paths.shadow);
        assert_eq!(
            std::fs::read_to_string(&paths.shadow).unwrap(),
            format!("root:{written}:19000:0:99999:7:::\n{OTHER_ACCOUNTS}"),
            "every other account and every other field must survive byte-for-byte"
        );
    }

    #[tokio::test]
    async fn the_settings_credential_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _paths) = fixture(dir.path(), "inactive", "disabled");
        let settings = settings_with(ssh_settings(true), Some(ARGON_HASH));

        reconciler.apply(&settings).await.unwrap();

        assert_eq!(
            settings.access.device.password_hash.as_deref(),
            Some(ARGON_HASH),
            "access.device.passwordHash stays the Argon2id credential of record"
        );
    }

    #[test]
    fn rewrite_preserves_field_count_ordering_and_a_missing_trailing_newline() {
        let without_newline = SHADOW.trim_end_matches('\n');

        let updated = rewrite_root_hash(without_newline, CRYPT_HASH).unwrap();

        assert_eq!(
            updated,
            format!("root:{CRYPT_HASH}:19000:0:99999:7:::\n{OTHER_ACCOUNTS}")
                .trim_end_matches('\n')
        );
        assert!(!updated.ends_with('\n'));
        for line in updated.lines() {
            assert_eq!(line.split(':').count(), 9, "field count changed: {line}");
        }
    }

    #[test]
    fn rewrite_does_not_match_an_account_merely_containing_root() {
        let shadow = "chroot:!:19000:0:99999:7:::\nroot:!:19000:0:99999:7:::\n";

        let updated = rewrite_root_hash(shadow, CRYPT_HASH).unwrap();

        assert_eq!(
            updated,
            format!("chroot:!:19000:0:99999:7:::\nroot:{CRYPT_HASH}:19000:0:99999:7:::\n")
        );
    }

    #[test]
    fn root_hash_reads_the_root_entry_not_a_lookalike() {
        assert_eq!(root_hash(SHADOW).unwrap(), "!");
        assert_eq!(
            root_hash("chroot:LOOKALIKE:1::::::\nroot:REAL:1::::::\n").unwrap(),
            "REAL"
        );
        assert!(root_hash("daemon:*:1::::::\n").is_err());
    }

    #[tokio::test]
    async fn shadow_rewrite_preserves_mode_and_ownership() {
        use std::os::unix::fs::MetadataExt;

        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");
        let before = std::fs::metadata(&paths.shadow).unwrap();
        let (uid, gid) = (before.uid(), before.gid());
        // Only root may hand a file to another group; where that is possible,
        // assert against a gid the process would not produce by accident.
        let foreign_gid = std::os::unix::fs::chown(&paths.shadow, None, Some(12))
            .is_ok()
            .then_some(12);

        reconciler
            .apply(&settings_with(ssh_settings(true), Some(ARGON_HASH)))
            .await
            .unwrap();

        let after = std::fs::metadata(&paths.shadow).unwrap();
        assert_eq!(after.permissions().mode() & 0o7777, 0o640);
        assert_eq!(after.uid(), uid);
        assert_eq!(after.gid(), foreign_gid.unwrap_or(gid));
    }

    #[tokio::test]
    async fn absent_password_hash_skips_the_write_cleanly() {
        let dir = tempfile::tempdir().unwrap();
        // The plaintext is present; only the credential of record is missing,
        // so this asserts the not-provisioned case keys on the settings tree.
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");

        let state = reconciler
            .apply(&settings_with(ssh_settings(true), None))
            .await
            .unwrap();

        assert_eq!(state["rootPassword"], json!("absent"));
        assert_eq!(
            std::fs::read_to_string(&paths.shadow).unwrap(),
            SHADOW,
            "an unprovisioned device must leave the root entry alone"
        );
        assert_eq!(
            reconciler.control.calls(),
            vec![
                "enable ssh.service".to_string(),
                "start ssh.service".to_string()
            ],
            "an absent credential is not a failure, so the rest still converges"
        );
    }

    #[tokio::test]
    async fn a_credential_whose_plaintext_is_gone_skips_with_its_own_outcome() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture_with(dir.path(), "inactive", "disabled", None);

        let state = reconciler
            .apply(&settings_with(ssh_settings(true), Some(ARGON_HASH)))
            .await
            .unwrap();

        assert_eq!(state["rootPassword"], json!("plaintext-missing"));
        assert_ne!(
            state["rootPassword"],
            json!("absent"),
            "provisioned-but-plaintext-gone must not read as not-provisioned"
        );
        assert_eq!(
            std::fs::read_to_string(&paths.shadow).unwrap(),
            SHADOW,
            "no plaintext means no derivable crypt hash, so the entry is left alone"
        );
        assert_eq!(
            reconciler.control.calls(),
            vec![
                "enable ssh.service".to_string(),
                "start ssh.service".to_string()
            ]
        );
    }

    #[tokio::test]
    async fn an_already_applied_password_reports_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");
        let existing = bcrypt::hash(PASSWORD, BCRYPT_COST).unwrap();
        let seeded = format!("root:{existing}:19000:0:99999:7:::\n{OTHER_ACCOUNTS}");
        std::fs::write(&paths.shadow, &seeded).unwrap();

        let state = reconciler
            .apply(&settings_with(ssh_settings(true), Some(ARGON_HASH)))
            .await
            .unwrap();

        assert_eq!(state["rootPassword"], json!("unchanged"));
        assert_eq!(std::fs::read_to_string(&paths.shadow).unwrap(), seeded);
    }

    #[tokio::test]
    async fn a_stale_hash_of_a_different_password_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");
        let stale = bcrypt::hash("OLDPASSWORD12345", BCRYPT_COST).unwrap();
        std::fs::write(
            &paths.shadow,
            format!("root:{stale}:19000:0:99999:7:::\n{OTHER_ACCOUNTS}"),
        )
        .unwrap();

        let state = reconciler
            .apply(&settings_with(ssh_settings(true), Some(ARGON_HASH)))
            .await
            .unwrap();

        let written = stored_root_hash(&paths.shadow);
        assert_eq!(state["rootPassword"], json!("applied"));
        assert_ne!(written, stale);
        assert!(bcrypt::verify(PASSWORD, &written).unwrap());
    }

    #[tokio::test]
    async fn a_shadow_file_without_a_root_entry_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");
        std::fs::write(&paths.shadow, "daemon:*:19000:0:99999:7:::\n").unwrap();

        let err = reconciler
            .apply(&settings_with(ssh_settings(true), Some(ARGON_HASH)))
            .await
            .unwrap_err();

        let chain = format!("{err:#}");
        assert!(chain.contains("no `root:` entry"), "{chain}");
        assert!(
            reconciler.control.calls().is_empty(),
            "a broken shadow file must stop the reconcile before sshd starts"
        );
    }

    #[tokio::test]
    async fn a_missing_shadow_file_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");
        std::fs::remove_file(&paths.shadow).unwrap();

        let err = reconciler
            .apply(&settings_with(ssh_settings(true), Some(ARGON_HASH)))
            .await
            .unwrap_err();

        let chain = format!("{err:#}");
        assert!(
            chain.contains("the root credential cannot be applied"),
            "{chain}"
        );
        assert!(
            !paths.shadow.exists(),
            "a missing shadow file must not be created"
        );
        assert!(reconciler.control.calls().is_empty());
    }

    // ---- containment ------------------------------------------------------

    #[tokio::test]
    async fn every_path_the_reconciler_writes_stays_inside_the_tempdir() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");

        let state = reconciler
            .apply(&settings_with(ssh_settings(true), Some(ARGON_HASH)))
            .await
            .unwrap();

        for path in [&paths.drop_in, &paths.shadow, &paths.state] {
            assert!(
                path.starts_with(dir.path()),
                "{} escapes the tempdir",
                path.display()
            );
        }
        assert_eq!(state["dropIn"], json!(paths.drop_in.display().to_string()));
        assert_ne!(state["dropIn"], json!(DEFAULT_DROP_IN));
    }
}
