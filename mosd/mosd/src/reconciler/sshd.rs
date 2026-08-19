//! SSH access reconciler: renders the sshd drop-in from `access.ssh` and
//! drives `ssh.service`.
//!
//! Three system effects, in this order:
//!
//! 1. `/etc/ssh/authorized_keys.d/root` is rendered from
//!    `access.ssh.authorizedKeys`, at 0600, after the list has been
//!    re-validated.
//! 2. `/etc/ssh/sshd_config.d/10-mos.conf` is rendered from `access.ssh`. That
//!    directory is the one writable part of `/etc` on the v2 read-only root —
//!    it is a STATE-backed bind mount (`etc-ssh.mount`).
//! 3. `ssh.service` is brought to the state `access.ssh.enabled` asks for.
//!
//! Configuration before service start, deliberately: an sshd started against a
//! stale drop-in is listening on the wrong port, or accepting an
//! authentication method the operator has already turned off.
//!
//! **The device password no longer reaches PAM.** This reconciler used to hash
//! `secrets/device-password` with bcrypt and write it into the root account's
//! shadow entry, which made a fielded device carry a password that never
//! expired. The secret file stays on STATE and `identity::read_device_password`
//! still reads it, but the credential of record for shell access is now an SSH
//! public key, or a transient password the operator sets explicitly through
//! `crate::transient` and which the next boot clears.
//!
//! **`PasswordAuthentication` is gated on that transient password.** The
//! rendered value is the setting AND `transient::transient_password_active`:
//! root ships locked and stays locked unless a transient password is active, so
//! offering password authentication at any other time advertises an
//! authentication method that cannot succeed.
//!
//! **`AuthorizedKeysFile` is not rendered here.** It is a static image file,
//! `05-mos-authorized-keys.conf`, which sorts ahead of this reconciler's
//! `10-mos.conf`; sshd keeps the first value it obtains for a non-repeatable
//! keyword, so emitting the keyword here would be dead text at best.

use std::path::PathBuf;

use anyhow::{Context, Result};
use mosd_settings::{AuthorizedKey, Settings, SshSettings};
use serde_json::json;

use super::Reconciler;
use super::systemd::{Systemd, UnitControl, is_active, is_enabled};
use crate::transient;
use crate::transient::write_atomically;

/// Unit implementing the SSH server.
const SSH_UNIT: &str = "ssh.service";
/// Drop-in rendered from `access.ssh`; `sshd_config` includes this directory.
const DEFAULT_DROP_IN: &str = "/etc/ssh/sshd_config.d/10-mos.conf";
/// Authorized-keys file rendered from `access.ssh.authorizedKeys`.
///
/// Under `/etc/ssh` rather than `/root/.ssh` because `/etc/ssh` is a
/// STATE-backed bind mount (`etc-ssh.mount` binds `/mnt/state/ssh` over it), so
/// the file survives an A/B update. `/root` is on the ephemeral filesystem: a
/// key written there would be gone on the next boot, which is precisely what
/// "persistent access" must not mean.
///
/// The static `05-mos-authorized-keys.conf` points sshd at
/// `/etc/ssh/authorized_keys.d/%u`, and phase 1 has only the root account, so
/// the two agree by construction.
const DEFAULT_AUTHORIZED_KEYS: &str = "/etc/ssh/authorized_keys.d/root";
/// Environment variable overriding the drop-in path.
const DROP_IN_ENV: &str = "MOSD_SSHD_DROP_IN";
/// Environment variable overriding the authorized-keys path.
const AUTHORIZED_KEYS_ENV: &str = "MOSD_AUTHORIZED_KEYS";
/// Mode of the rendered drop-in: world-readable configuration, owner-writable.
const DROP_IN_MODE: u32 = 0o644;
/// Mode of the rendered authorized-keys file: owner-only. sshd reads it as
/// root, and nothing else has any business enumerating which keys open the
/// device.
const AUTHORIZED_KEYS_MODE: u32 = 0o600;
/// Mode of the authorized-keys directory when this reconciler creates it.
/// Traversable, because sshd checks the path, but writable only by root.
const AUTHORIZED_KEYS_DIR_MODE: u32 = 0o755;

/// Reconciler for the `access.ssh` settings subtree.
pub struct SshdReconciler<C: UnitControl> {
    drop_in_path: PathBuf,
    authorized_keys_path: PathBuf,
    /// Shadow file this reconciler's device operates on.
    ///
    /// Nothing here writes it. It is read — through
    /// [`transient::transient_password_active`], which looks for the marker
    /// beside it — because whether password authentication may be offered at
    /// all is a question about this exact path.
    shadow_path: PathBuf,
    control: C,
}

impl<C: UnitControl> SshdReconciler<C> {
    /// Create an sshd reconciler writing `drop_in_path` and
    /// `authorized_keys_path`, tracking the shadow file at `shadow_path`, and
    /// driving `ssh.service` through `control`.
    ///
    /// Every path is a parameter so tests run entirely inside a temporary
    /// directory and never touch the host's sshd.
    pub fn new(
        drop_in_path: PathBuf,
        authorized_keys_path: PathBuf,
        shadow_path: PathBuf,
        control: C,
    ) -> Self {
        Self {
            drop_in_path,
            authorized_keys_path,
            shadow_path,
            control,
        }
    }
}

impl SshdReconciler<Systemd> {
    /// Production reconciler: paths from [`DROP_IN_ENV`], [`AUTHORIZED_KEYS_ENV`]
    /// and [`transient::SHADOW_ENV`] if set, else the system locations.
    ///
    /// The shadow path is resolved by [`transient::production_shadow_path`]
    /// rather than by a second copy of the same constant and env var: two
    /// constants naming one file drift, and this reconciler and the transient
    /// module have to agree about which file the marker sits beside.
    pub fn production() -> Self {
        let drop_in = std::env::var(DROP_IN_ENV)
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_DROP_IN));
        let authorized_keys = std::env::var(AUTHORIZED_KEYS_ENV)
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_AUTHORIZED_KEYS));
        Self::new(
            drop_in,
            authorized_keys,
            transient::production_shadow_path(),
            Systemd,
        )
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
///
/// `password_authentication` is the **effective** value, not
/// `ssh.password_authentication`: the caller has already ANDed the setting with
/// whether a transient root password is active. It is a parameter rather than a
/// second read of the settings so that this function stays pure — the gating
/// input is state outside the settings tree, and a renderer that reached for it
/// itself could not be compared byte-for-byte in a test.
///
/// No `AuthorizedKeysFile` directive is emitted: the static
/// `05-mos-authorized-keys.conf` owns that keyword and sorts first.
fn render_drop_in(ssh: &SshSettings, password_authentication: bool) -> String {
    let yes_no = |value: bool| if value { "yes" } else { "no" };
    let mut out = String::from("# Managed by mosd from access.ssh. Do not edit.\n");
    out.push_str(&format!("Port {}\n", ssh.port));
    out.push_str(&format!(
        "PermitRootLogin {}\n",
        yes_no(ssh.permit_root_login)
    ));
    out.push_str(&format!(
        "PasswordAuthentication {}\n",
        yes_no(password_authentication)
    ));
    for address in &ssh.listen_addresses {
        out.push_str(&format!("ListenAddress {address}\n"));
    }
    out
}

/// Render the authorized-keys file for `keys`.
///
/// One entry per line in settings order — the operator's order, which is stable
/// across a load/store round-trip, so the render is deterministic and can be
/// compared against what is on disk. Each line is `<key>` or `<key> <comment>`.
///
/// An empty list renders an **empty file**, not an absent one. A removed key
/// has to stop working immediately, and "no file" versus "empty file" is a
/// distinction sshd does not need to make.
///
/// Pure: every value written here has already been through
/// [`mosd_settings::validate_authorized_keys`] at the call site.
fn render_authorized_keys(keys: &[AuthorizedKey]) -> String {
    let mut out = String::new();
    for entry in keys {
        match &entry.comment {
            Some(comment) => out.push_str(&format!("{} {}\n", entry.key, comment)),
            None => out.push_str(&format!("{}\n", entry.key)),
        }
    }
    out
}

/// OpenSSH fingerprint of a canonical `<type> <blob>` key line.
///
/// The standard form: `SHA256:` followed by the unpadded base64 of the SHA-256
/// digest of the **decoded** blob — the same string `ssh-keygen -lf` prints.
///
/// Returns `None` when the line has no blob or the blob does not decode.
/// Publishing state must not fail a reconcile that already succeeded, so the
/// caller renders that as `null` rather than propagating an error.
fn fingerprint(key: &str) -> Option<String> {
    let blob = key.split(' ').nth(1)?;
    let decoded = mosd_settings::decode_base64(blob)?;
    let digest = ring::digest::digest(&ring::digest::SHA256, &decoded);
    Some(format!(
        "SHA256:{}",
        mosd_settings::encode_base64_nopad(digest.as_ref())
    ))
}

impl<C: UnitControl> SshdReconciler<C> {
    /// Render the drop-in and report whether its bytes changed.
    ///
    /// An unchanged render is not rewritten: the drop-in lives on STATE, and
    /// a rewrite that changes nothing still costs a flash write on every
    /// reconcile.
    fn apply_drop_in(&self, ssh: &SshSettings, password_authentication: bool) -> Result<bool> {
        let rendered = render_drop_in(ssh, password_authentication);
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

    /// Render the authorized-keys file and report whether its bytes changed.
    ///
    /// The caller has already re-validated the list, so anything reaching this
    /// point is renderable. An unchanged render is not rewritten: the file
    /// lives on STATE, and a rewrite that changes nothing still costs a flash
    /// write on every reconcile.
    fn apply_authorized_keys(&self, keys: &[AuthorizedKey]) -> Result<bool> {
        let rendered = render_authorized_keys(keys);
        if let Ok(current) = std::fs::read_to_string(&self.authorized_keys_path)
            && current == rendered
        {
            return Ok(false);
        }
        if let Some(directory) = self.authorized_keys_path.parent()
            && !directory.exists()
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::create_dir_all(directory)
                .with_context(|| format!("create {}", directory.display()))?;
            // Explicitly, rather than letting the umask decide: sshd refuses a
            // key file it reaches through a group- or world-writable directory.
            std::fs::set_permissions(
                directory,
                std::fs::Permissions::from_mode(AUTHORIZED_KEYS_DIR_MODE),
            )
            .with_context(|| format!("set mode on {}", directory.display()))?;
        }
        write_atomically(
            &self.authorized_keys_path,
            &rendered,
            AUTHORIZED_KEYS_MODE,
            None,
        )
        .with_context(|| format!("render {}", self.authorized_keys_path.display()))?;
        Ok(true)
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

        // Before anything is written. The settings file lives on STATE and is
        // editable by anything that can write STATE, so the parser is the
        // security boundary and this is the second place it has to hold. A
        // failure here aborts the whole apply with every rendered file exactly
        // as it was: silently dropping the offending entry and rendering the
        // rest would leave the operator looking at a key in the UI that grants
        // nothing.
        mosd_settings::validate_authorized_keys(&ssh.authorized_keys)?;

        // Outside the settings tree, so it has to be read on every apply: the
        // operator setting a transient password changes no setting at all, and
        // the bus method that sets one calls back through `apply_all`.
        let transient_active = transient::transient_password_active(&self.shadow_path);
        // `password_authentication` below is the EFFECTIVE value — what sshd is
        // actually told. `passwordAuthenticationRequested` in the published
        // state is the raw setting. Two similarly-named keys, so: effective =
        // requested AND a transient password is really active.
        let password_authentication = ssh.password_authentication && transient_active;

        // The returned "did it change" is deliberately discarded: only the
        // drop-in forces sshd to be restarted. sshd re-reads the
        // authorized-keys file on every authentication attempt, so a key added
        // or removed takes effect without touching the unit — and restarting on
        // a key change would drop the live session of the operator who just
        // added one.
        self.apply_authorized_keys(&ssh.authorized_keys)?;
        let config_changed = self.apply_drop_in(ssh, password_authentication)?;
        self.apply_unit(ssh, config_changed).await?;

        let authorized_keys: Vec<serde_json::Value> = ssh
            .authorized_keys
            .iter()
            .map(|entry| {
                json!({
                    // Never the key material itself: this tree is served over
                    // D-Bus and read by webd, and a fingerprint is what an
                    // operator needs in order to recognise a key.
                    "fingerprint": fingerprint(&entry.key),
                    "comment": entry.comment,
                })
            })
            .collect();

        Ok(json!({
            "enabled": ssh.enabled,
            "port": ssh.port,
            "permitRootLogin": ssh.permit_root_login,
            "passwordAuthentication": password_authentication,
            "passwordAuthenticationRequested": ssh.password_authentication,
            "transientPasswordActive": transient_active,
            "listenAddresses": ssh.listen_addresses,
            "dropIn": self.drop_in_path.display().to_string(),
            "authorizedKeysPath": self.authorized_keys_path.display().to_string(),
            "authorizedKeys": authorized_keys,
            "unit": SSH_UNIT,
            "activeState": self.control.active_state(SSH_UNIT).await?,
            "unitFileState": self.control.unit_file_state(SSH_UNIT).await?,
        }))
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    use super::super::systemd::mock::MockUnitControl;
    use super::*;

    const GOLDEN_DEFAULTS: &str = "# Managed by mosd from access.ssh. Do not edit.\n\
        Port 22\nPermitRootLogin yes\nPasswordAuthentication yes\n";
    /// What `apply` writes for default settings with **no** transient password
    /// active: the same drop-in with password authentication gated off.
    const GOLDEN_DEFAULTS_GATED: &str = "# Managed by mosd from access.ssh. Do not edit.\n\
        Port 22\nPermitRootLogin yes\nPasswordAuthentication no\n";
    const GOLDEN_LISTEN: &str = "# Managed by mosd from access.ssh. Do not edit.\n\
        Port 2222\nPermitRootLogin no\nPasswordAuthentication no\n\
        ListenAddress 10.0.0.5\nListenAddress fd00::1\n";

    /// Three accounts, nine fields each, trailing newline — the shape of a
    /// Debian `/etc/shadow`. `root` starts out locked (`!`).
    const SHADOW: &str = "root:!:19000:0:99999:7:::\n\
        daemon:*:19000:0:99999:7:::\n\
        operator:$6$rounds=5000$abcd$efgh:19100:0:99999:7:::\n";
    const SHADOW_MODE: u32 = 0o640;

    fn ssh_settings(enabled: bool) -> SshSettings {
        SshSettings {
            enabled,
            ..SshSettings::default()
        }
    }

    fn settings_with(ssh: SshSettings) -> Settings {
        Settings {
            access: mosd_settings::AccessSettings {
                ssh,
                ..mosd_settings::AccessSettings::default()
            },
            ..Settings::default()
        }
    }

    /// Paths of a fixture, all of them under the tempdir.
    struct Paths {
        drop_in: PathBuf,
        keys: PathBuf,
        shadow: PathBuf,
    }

    /// Fixture rooted entirely inside `dir`: a drop-in path that does not
    /// exist yet and a shadow file at [`SHADOW_MODE`].
    fn fixture(
        dir: &Path,
        active: &str,
        file_state: &str,
    ) -> (SshdReconciler<MockUnitControl>, Paths) {
        let paths = Paths {
            drop_in: dir.join("sshd_config.d").join("10-mos.conf"),
            keys: dir.join("authorized_keys.d").join("root"),
            shadow: dir.join("shadow"),
        };
        std::fs::write(&paths.shadow, SHADOW).unwrap();
        std::fs::set_permissions(&paths.shadow, std::fs::Permissions::from_mode(SHADOW_MODE))
            .unwrap();
        let reconciler = SshdReconciler::new(
            paths.drop_in.clone(),
            paths.keys.clone(),
            paths.shadow.clone(),
            MockUnitControl::new(active, file_state),
        );
        (reconciler, paths)
    }

    fn mode_of(path: &Path) -> u32 {
        std::fs::metadata(path).unwrap().permissions().mode() & 0o7777
    }

    // ---- R2: rendering ----------------------------------------------------

    #[test]
    fn empty_listen_addresses_emit_no_listen_address_directive() {
        let rendered = render_drop_in(&SshSettings::default(), true);

        assert_eq!(rendered, GOLDEN_DEFAULTS);
        assert!(
            !rendered.contains("ListenAddress"),
            "empty listenAddresses means listen on all, so no directive: {rendered}"
        );
    }

    #[test]
    fn each_listen_address_becomes_one_directive() {
        let rendered = render_drop_in(
            &SshSettings {
                enabled: true,
                port: 2222,
                permit_root_login: false,
                password_authentication: false,
                listen_addresses: vec!["10.0.0.5".to_string(), "fd00::1".to_string()],
                authorized_keys: Vec::new(),
            },
            false,
        );

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
            authorized_keys: Vec::new(),
        };

        assert_eq!(
            render_drop_in(&ssh, true),
            render_drop_in(&ssh.clone(), true)
        );
    }

    #[tokio::test]
    async fn apply_writes_the_golden_drop_in_creating_its_directory() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");

        reconciler
            .apply(&settings_with(ssh_settings(true)))
            .await
            .unwrap();

        // GOLDEN_DEFAULTS_GATED, not GOLDEN_DEFAULTS: the fixture writes no
        // transient marker, so password authentication is gated off.
        assert_eq!(
            std::fs::read_to_string(&paths.drop_in).unwrap(),
            GOLDEN_DEFAULTS_GATED
        );
        assert_eq!(mode_of(&paths.drop_in), 0o644);
    }

    #[tokio::test]
    async fn apply_leaves_no_temporary_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");

        reconciler
            .apply(&settings_with(ssh_settings(true)))
            .await
            .unwrap();

        for directory in [
            paths.drop_in.parent().unwrap(),
            paths.keys.parent().unwrap(),
            dir.path(),
        ] {
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
            .apply(&settings_with(ssh_settings(true)))
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
            .apply(&settings_with(ssh_settings(false)))
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
        std::fs::write(&paths.drop_in, GOLDEN_DEFAULTS_GATED).unwrap();

        reconciler
            .apply(&settings_with(ssh_settings(true)))
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
            .apply(&settings_with(ssh_settings(false)))
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
        let settings = settings_with(ssh_settings(true));

        reconciler.apply(&settings).await.unwrap();
        let after_first = reconciler.control.calls();
        // A marker the reconciler would clobber if it rewrote the file: the
        // renderer always produces mode 0644.
        std::fs::set_permissions(&paths.drop_in, std::fs::Permissions::from_mode(0o600)).unwrap();

        reconciler.apply(&settings).await.unwrap();

        assert_eq!(reconciler.control.calls(), after_first);
        assert_eq!(
            mode_of(&paths.drop_in),
            0o600,
            "an unchanged drop-in must not be rewritten"
        );
        assert_eq!(
            std::fs::read_to_string(&paths.drop_in).unwrap(),
            GOLDEN_DEFAULTS_GATED
        );
    }

    #[tokio::test]
    async fn changing_the_config_of_a_running_sshd_restarts_it() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "active", "enabled");
        std::fs::create_dir_all(paths.drop_in.parent().unwrap()).unwrap();
        std::fs::write(&paths.drop_in, GOLDEN_DEFAULTS_GATED).unwrap();

        let state = reconciler
            .apply(&settings_with(SshSettings {
                enabled: true,
                port: 2222,
                ..SshSettings::default()
            }))
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

    // ---- the device password no longer reaches the shadow file ------------

    #[tokio::test]
    async fn no_reconcile_writes_anything_into_the_shadow_file() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");

        let state = reconciler
            .apply(&settings_with(ssh_settings(true)))
            .await
            .unwrap();

        assert_eq!(
            std::fs::read_to_string(&paths.shadow).unwrap(),
            SHADOW,
            "the root entry is not this reconciler's to write any more"
        );
        assert_eq!(mode_of(&paths.shadow), SHADOW_MODE);
        assert!(
            state.get("rootPassword").is_none(),
            "the removed device-password write must not still be advertised: {state}"
        );
    }

    #[tokio::test]
    async fn a_shadow_file_that_is_missing_or_broken_does_not_stop_the_reconcile() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");
        std::fs::remove_file(&paths.shadow).unwrap();

        reconciler
            .apply(&settings_with(ssh_settings(true)))
            .await
            .expect("the shadow file is no longer an input to this reconciler");

        assert!(
            !paths.shadow.exists(),
            "a missing shadow file must not be created"
        );
        assert_eq!(
            reconciler.control.calls(),
            vec![
                "enable ssh.service".to_string(),
                "start ssh.service".to_string()
            ]
        );
    }

    // ---- containment ------------------------------------------------------

    #[tokio::test]
    async fn every_path_the_reconciler_writes_stays_inside_the_tempdir() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");

        let state = reconciler
            .apply(&settings_with(ssh_settings(true)))
            .await
            .unwrap();

        for path in [&paths.drop_in, &paths.keys, &paths.shadow] {
            assert!(
                path.starts_with(dir.path()),
                "{} escapes the tempdir",
                path.display()
            );
        }
        assert_eq!(state["dropIn"], json!(paths.drop_in.display().to_string()));
        assert_ne!(state["dropIn"], json!(DEFAULT_DROP_IN));
        assert_eq!(
            state["authorizedKeysPath"],
            json!(paths.keys.display().to_string())
        );
        assert_ne!(
            state["authorizedKeysPath"],
            json!(DEFAULT_AUTHORIZED_KEYS),
            "a test must never render into the real /etc/ssh"
        );
    }

    // ---- R1: real keys, committed as test constants -----------------------
    //
    // Generated with `ssh-keygen` purely for this test. Public keys are not
    // secrets, and these correspond to no device: the private halves were
    // discarded at generation time and exist nowhere.

    /// `ssh-keygen -t ed25519 -C rfct-034-test-ed25519`, verbatim.
    const REAL_ED25519_LINE: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL99V7xPTOP3jZjnbVPM7xC+ckwzkOQPalUpsvtPzYo8 rfct-034-test-ed25519";
    /// `ssh-keygen -t rsa -b 2048 -C rfct-034-test-rsa`, verbatim.
    const REAL_RSA_LINE: &str = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDT2F3imgGgI+xGNSQI+0alU1qRwyU3gCc8wU6msXSzZsVc8OYlg4VIqxsV/GLpBmgRz5lGoxjTT2TU0t1VwaMs845NqRIWzpG88ohD1LMn7RnUrNTxf4syFuvmELmYstqMfc6Q6rApqFoA6023Rl2orgd8N3SQ2wPAw8Rk9OLwim9/R7tX8C8FTbnMtepzTvOUNGTDAaKYhTZZnZpsGCwKa9f2aWyaS2XqLwn9uWpmHRUAkV10l45W2rLhnceejwwHotlZUIAFt8rlmS1ojRaLWqECVAuO5CDTt64KLLRniw8yHIYsWkeVsHZXCxq+J7oUVI3ogOSYs1M4I2eFCccD rfct-034-test-rsa";
    /// A second Ed25519 key, so the multi-key golden holds three distinct keys.
    const REAL_ED25519_SECOND_LINE: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILFM+HTH5h41h/zyK4CwjXx9E1l8Nwks1NaywRMiSsEP rfct-034-test-ed25519-second";

    /// Fingerprints as reported by `ssh-keygen -lf <file>` for the three keys
    /// above, copied from that command's output. Comparing this module's
    /// fingerprint against a constant that came from OpenSSH is the point: a
    /// fingerprint function checked only against itself proves nothing.
    const REAL_ED25519_FINGERPRINT: &str = "SHA256:HrgN3GLi6Mop2uSRjgOoxImM8zRkFmgqCKoeGD9QOaM";
    const REAL_RSA_FINGERPRINT: &str = "SHA256:zv0xTYuVTo5pFpcl/svzzz/vJFvoguWxKlghlXQS1bE";
    const REAL_ED25519_SECOND_FINGERPRINT: &str =
        "SHA256:d7yiR/zCsNFh8WmU6CGLWEG5vE06icIelqVoNc8TT2E";

    /// The canonical `<type> <blob>` half of a full `ssh-keygen` line.
    fn canonical(line: &str) -> String {
        let mut fields = line.splitn(3, ' ');
        let key_type = fields.next().unwrap();
        let blob = fields.next().unwrap();
        format!("{key_type} {blob}")
    }

    /// An [`AuthorizedKey`] built directly, bypassing the parser — the shape a
    /// corrupted settings file on STATE would present.
    fn raw_key(key: &str, comment: Option<&str>) -> AuthorizedKey {
        AuthorizedKey {
            key: key.to_string(),
            comment: comment.map(str::to_string),
        }
    }

    fn settings_with_keys(keys: Vec<AuthorizedKey>) -> Settings {
        settings_with(SshSettings {
            enabled: true,
            authorized_keys: keys,
            ..SshSettings::default()
        })
    }

    /// Set a transient password marker beside `shadow`, the way
    /// `transient::set_transient_root_password` does.
    fn set_marker(shadow: &Path) {
        std::fs::write(
            crate::transient::transient_marker_path(shadow),
            "$2b$12$notarealhashjustnonempty\n",
        )
        .unwrap();
    }

    // ---- R7.1: golden renders --------------------------------------------

    #[test]
    fn an_empty_list_renders_an_empty_file() {
        assert_eq!(render_authorized_keys(&[]), "");
    }

    #[test]
    fn one_key_without_a_comment_renders_one_bare_line() {
        let rendered = render_authorized_keys(&[raw_key(&canonical(REAL_ED25519_LINE), None)]);

        assert_eq!(rendered, format!("{}\n", canonical(REAL_ED25519_LINE)));
    }

    #[test]
    fn one_key_with_a_comment_renders_key_space_comment() {
        let rendered = render_authorized_keys(&[raw_key(
            &canonical(REAL_ED25519_LINE),
            Some("laptop@example"),
        )]);

        assert_eq!(
            rendered,
            format!("{} laptop@example\n", canonical(REAL_ED25519_LINE))
        );
    }

    #[test]
    fn three_keys_render_in_settings_order_mixing_commented_and_bare() {
        let rendered = render_authorized_keys(&[
            raw_key(&canonical(REAL_ED25519_LINE), Some("first")),
            raw_key(&canonical(REAL_RSA_LINE), None),
            raw_key(&canonical(REAL_ED25519_SECOND_LINE), Some("third")),
        ]);

        assert_eq!(
            rendered,
            format!(
                "{} first\n{}\n{} third\n",
                canonical(REAL_ED25519_LINE),
                canonical(REAL_RSA_LINE),
                canonical(REAL_ED25519_SECOND_LINE)
            )
        );
        assert_eq!(rendered.lines().count(), 3);
    }

    #[test]
    fn rendering_the_same_keys_twice_gives_identical_bytes() {
        let keys = vec![
            raw_key(&canonical(REAL_ED25519_LINE), Some("first")),
            raw_key(&canonical(REAL_RSA_LINE), None),
        ];

        assert_eq!(
            render_authorized_keys(&keys),
            render_authorized_keys(&keys.clone())
        );
    }

    // ---- R7.2: a real ssh-keygen key round-trips --------------------------

    /// Closes the gap RFCT-032 recorded: its spec forbade pasting key material,
    /// so it could not prove that genuine `ssh-keygen` output survives the
    /// parser and comes back out byte-identical. There is a rendered file to
    /// compare against here, so it is proved here.
    #[test]
    fn a_real_ssh_keygen_line_parses_canonicalises_and_renders_back_identically() {
        for line in [REAL_ED25519_LINE, REAL_RSA_LINE, REAL_ED25519_SECOND_LINE] {
            let parsed = mosd_settings::parse_authorized_key(line)
                .unwrap_or_else(|err| panic!("real ssh-keygen line rejected: {line}: {err}"));

            assert_eq!(parsed.key, canonical(line), "comment leaked into `key`");
            assert_eq!(
                parsed.comment.as_deref(),
                Some(line.splitn(3, ' ').nth(2).unwrap())
            );
            assert_eq!(
                render_authorized_keys(std::slice::from_ref(&parsed)),
                format!("{line}\n"),
                "rendered line differs from the ssh-keygen line it came from"
            );
            mosd_settings::validate_authorized_keys(std::slice::from_ref(&parsed)).unwrap();
        }
    }

    /// The same round-trip on a key generated at test time, so the committed
    /// constants above cannot quietly drift away from what OpenSSH emits.
    ///
    /// Skipped when `ssh-keygen` is absent, which is why the committed-constant
    /// test above exists as well: this file never becomes a silent no-op.
    #[test]
    fn a_freshly_generated_key_round_trips_when_ssh_keygen_is_available() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fresh");
        let generated = std::process::Command::new("ssh-keygen")
            .args([
                "-q",
                "-t",
                "ed25519",
                "-N",
                "",
                "-C",
                "fresh@rfct-034",
                "-f",
            ])
            .arg(&path)
            .status();
        let Ok(status) = generated else {
            eprintln!("ssh-keygen not on this host; committed-constant round-trip still ran");
            return;
        };
        assert!(status.success(), "ssh-keygen failed");

        let line = std::fs::read_to_string(path.with_extension("pub")).unwrap();
        let line = line.trim_end_matches('\n');
        let parsed = mosd_settings::parse_authorized_key(line).unwrap();

        assert_eq!(parsed.key, canonical(line));
        assert_eq!(parsed.comment.as_deref(), Some("fresh@rfct-034"));
        assert_eq!(
            render_authorized_keys(std::slice::from_ref(&parsed)),
            format!("{line}\n")
        );
    }

    // ---- R7.3: fingerprints agree with ssh-keygen -lf ---------------------

    #[test]
    fn fingerprints_match_what_ssh_keygen_reports() {
        for (line, expected) in [
            (REAL_ED25519_LINE, REAL_ED25519_FINGERPRINT),
            (REAL_RSA_LINE, REAL_RSA_FINGERPRINT),
            (REAL_ED25519_SECOND_LINE, REAL_ED25519_SECOND_FINGERPRINT),
        ] {
            assert_eq!(fingerprint(&canonical(line)).as_deref(), Some(expected));
        }
    }

    #[test]
    fn a_key_with_no_decodable_blob_has_no_fingerprint() {
        assert_eq!(fingerprint("ssh-ed25519"), None);
        assert_eq!(fingerprint("ssh-ed25519 not!base64"), None);
    }

    // ---- R7.4: validation failures leave the file untouched ---------------

    /// Apply once with a good key so there is a rendered file to protect, then
    /// apply `bad` and assert the failure changed nothing.
    async fn assert_bad_keys_leave_the_file_untouched(bad: Vec<AuthorizedKey>, what: &str) {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");
        let good = vec![raw_key(&canonical(REAL_ED25519_LINE), Some("keep-me"))];
        reconciler
            .apply(&settings_with_keys(good))
            .await
            .expect("the good apply must succeed");
        let before = std::fs::read(&paths.keys).unwrap();
        assert!(!before.is_empty(), "nothing was rendered to protect");

        let error = reconciler
            .apply(&settings_with_keys(bad))
            .await
            .expect_err(&format!("{what} must fail the apply"));

        assert_eq!(
            std::fs::read(&paths.keys).unwrap(),
            before,
            "{what}: the rendered file must be byte-identical after a failed apply"
        );
        let message = format!("{error:#}");
        assert!(
            message.contains("access.ssh.authorizedKeys"),
            "{what}: error should name the setting: {message}"
        );
    }

    #[tokio::test]
    async fn a_newline_embedded_in_the_key_field_fails_and_changes_nothing() {
        let injected = format!(
            "{}\nssh-ed25519 AAAAsomethingelse",
            canonical(REAL_ED25519_LINE)
        );
        assert_bad_keys_leave_the_file_untouched(
            vec![raw_key(&injected, None)],
            "a newline in the key field",
        )
        .await;
    }

    #[tokio::test]
    async fn a_comment_smuggled_into_the_key_field_fails_and_changes_nothing() {
        assert_bad_keys_leave_the_file_untouched(
            vec![raw_key(REAL_ED25519_LINE, None)],
            "a comment inside the key field",
        )
        .await;
    }

    #[tokio::test]
    async fn a_duplicate_key_pair_fails_and_changes_nothing() {
        assert_bad_keys_leave_the_file_untouched(
            vec![
                raw_key(&canonical(REAL_ED25519_LINE), Some("one")),
                raw_key(&canonical(REAL_ED25519_LINE), Some("two")),
            ],
            "a duplicated key",
        )
        .await;
    }

    #[tokio::test]
    async fn the_error_from_an_invalid_list_names_the_offending_index() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _paths) = fixture(dir.path(), "inactive", "disabled");

        let error = reconciler
            .apply(&settings_with_keys(vec![
                raw_key(&canonical(REAL_ED25519_LINE), None),
                raw_key("ssh-ed25519 !!!!", None),
            ]))
            .await
            .expect_err("an unparseable entry must fail the apply");

        let message = format!("{error:#}");
        assert!(
            message.contains("entry 1"),
            "error should name the offending index: {message}"
        );
    }

    /// The positive direction of the same guard: a valid list renders, and it
    /// overwrites whatever was there before rather than appending to it.
    #[tokio::test]
    async fn a_valid_list_renders_and_overwrites_the_previous_content() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");

        reconciler
            .apply(&settings_with_keys(vec![
                raw_key(&canonical(REAL_ED25519_LINE), Some("first")),
                raw_key(&canonical(REAL_RSA_LINE), None),
            ]))
            .await
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(&paths.keys).unwrap(),
            format!(
                "{} first\n{}\n",
                canonical(REAL_ED25519_LINE),
                canonical(REAL_RSA_LINE)
            )
        );

        reconciler
            .apply(&settings_with_keys(vec![raw_key(
                &canonical(REAL_ED25519_SECOND_LINE),
                None,
            )]))
            .await
            .unwrap();

        assert_eq!(
            std::fs::read_to_string(&paths.keys).unwrap(),
            format!("{}\n", canonical(REAL_ED25519_SECOND_LINE)),
            "the removed keys must be gone, not appended to"
        );
    }

    /// Removing every key empties the file rather than deleting it: an absent
    /// file and an empty file mean the same thing to sshd, and a key removed
    /// has to stop working immediately either way.
    #[tokio::test]
    async fn removing_every_key_empties_the_file_without_deleting_it() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");
        reconciler
            .apply(&settings_with_keys(vec![raw_key(
                &canonical(REAL_ED25519_LINE),
                None,
            )]))
            .await
            .unwrap();

        reconciler
            .apply(&settings_with_keys(Vec::new()))
            .await
            .unwrap();

        assert!(paths.keys.exists(), "the file must not be deleted");
        assert_eq!(std::fs::read_to_string(&paths.keys).unwrap(), "");
    }

    // ---- R7.5: per-character hostile input in the comment -----------------

    #[tokio::test]
    async fn each_control_character_in_a_comment_fails_and_changes_nothing() {
        for (ch, name) in [
            ('\0', "NUL"),
            ('\n', "line feed"),
            ('\r', "carriage return"),
            ('\t', "tab"),
            ('\u{7f}', "delete"),
        ] {
            assert_bad_keys_leave_the_file_untouched(
                vec![raw_key(
                    &canonical(REAL_ED25519_LINE),
                    Some(&format!("host{ch}name")),
                )],
                &format!("a {name} in the comment"),
            )
            .await;
        }
    }

    /// The other direction: shell metacharacters are ordinary comment text.
    /// The rendered file is read by sshd, not by a shell, and a guard that
    /// rejected these would refuse comments operators really write.
    #[tokio::test]
    async fn shell_metacharacters_in_a_comment_render_verbatim() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");
        let comment = "a$b`c\\d\"e;f";

        reconciler
            .apply(&settings_with_keys(vec![raw_key(
                &canonical(REAL_ED25519_LINE),
                Some(comment),
            )]))
            .await
            .expect("shell metacharacters are legitimate comment text");

        assert_eq!(
            std::fs::read_to_string(&paths.keys).unwrap(),
            format!("{} {comment}\n", canonical(REAL_ED25519_LINE))
        );
    }

    // ---- R7.6: PasswordAuthentication gating ------------------------------

    #[tokio::test]
    async fn without_a_transient_password_password_authentication_is_off() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");

        let state = reconciler
            .apply(&settings_with(SshSettings {
                enabled: true,
                password_authentication: true,
                ..SshSettings::default()
            }))
            .await
            .unwrap();

        assert!(
            std::fs::read_to_string(&paths.drop_in)
                .unwrap()
                .contains("PasswordAuthentication no\n"),
            "root is locked, so the method cannot succeed and must not be offered"
        );
        assert_eq!(state["passwordAuthentication"], json!(false));
        assert_eq!(state["passwordAuthenticationRequested"], json!(true));
        assert_eq!(state["transientPasswordActive"], json!(false));
    }

    #[tokio::test]
    async fn a_marker_appearing_between_two_applies_turns_passwords_on_and_restarts_sshd() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "active", "enabled");
        let settings = settings_with(SshSettings {
            enabled: true,
            password_authentication: true,
            ..SshSettings::default()
        });

        let before = reconciler.apply(&settings).await.unwrap();
        assert_eq!(before["passwordAuthentication"], json!(false));
        assert!(
            std::fs::read_to_string(&paths.drop_in)
                .unwrap()
                .contains("PasswordAuthentication no\n")
        );

        // Nothing in the settings tree changes here — this is exactly what
        // `SetTransientRootPassword` does before it calls `apply_all`.
        set_marker(&paths.shadow);
        let after = reconciler.apply(&settings).await.unwrap();

        assert_eq!(after["passwordAuthentication"], json!(true));
        assert_eq!(after["transientPasswordActive"], json!(true));
        assert!(
            std::fs::read_to_string(&paths.drop_in)
                .unwrap()
                .contains("PasswordAuthentication yes\n")
        );
        assert!(
            reconciler
                .control
                .calls()
                .contains(&"restart ssh.service".to_string()),
            "sshd must re-read the flipped drop-in: {:?}",
            reconciler.control.calls()
        );
    }

    #[tokio::test]
    async fn a_marker_does_not_turn_passwords_on_when_the_setting_says_no() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");
        set_marker(&paths.shadow);

        let state = reconciler
            .apply(&settings_with(SshSettings {
                enabled: true,
                password_authentication: false,
                ..SshSettings::default()
            }))
            .await
            .unwrap();

        assert_eq!(
            state["passwordAuthentication"],
            json!(false),
            "the gate is an AND of setting and marker, not an OR"
        );
        assert_eq!(state["transientPasswordActive"], json!(true));
        assert_eq!(state["passwordAuthenticationRequested"], json!(false));
        assert!(
            std::fs::read_to_string(&paths.drop_in)
                .unwrap()
                .contains("PasswordAuthentication no\n")
        );
    }

    #[tokio::test]
    async fn an_empty_marker_does_not_count_as_a_transient_password() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");
        std::fs::write(crate::transient::transient_marker_path(&paths.shadow), "").unwrap();

        let state = reconciler
            .apply(&settings_with(SshSettings {
                enabled: true,
                password_authentication: true,
                ..SshSettings::default()
            }))
            .await
            .unwrap();

        assert_eq!(state["transientPasswordActive"], json!(false));
        assert_eq!(state["passwordAuthentication"], json!(false));
    }

    #[test]
    fn the_rendered_drop_in_never_carries_an_authorized_keys_file_directive() {
        // The static 05-mos-authorized-keys.conf owns that keyword and sorts
        // first; sshd keeps the first value it sees, so emitting it here would
        // be dead text that a later reader would try to "fix".
        for effective in [true, false] {
            assert!(
                !render_drop_in(&SshSettings::default(), effective).contains("AuthorizedKeysFile")
            );
        }
    }

    // ---- R7.7: published state --------------------------------------------

    #[tokio::test]
    async fn published_state_carries_fingerprints_and_never_key_material() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");

        let state = reconciler
            .apply(&settings_with_keys(vec![
                raw_key(&canonical(REAL_ED25519_LINE), Some("laptop")),
                raw_key(&canonical(REAL_RSA_LINE), None),
            ]))
            .await
            .unwrap();

        assert_eq!(
            state["authorizedKeysPath"],
            json!(paths.keys.display().to_string())
        );
        assert_eq!(
            state["authorizedKeys"],
            json!([
                {"fingerprint": REAL_ED25519_FINGERPRINT, "comment": "laptop"},
                {"fingerprint": REAL_RSA_FINGERPRINT, "comment": null},
            ]),
            "fingerprints in render order, comment null when the key has none"
        );

        let serialised = state.to_string();
        for line in [REAL_ED25519_LINE, REAL_RSA_LINE] {
            let blob = line.split(' ').nth(1).unwrap();
            assert!(
                !serialised.contains(blob),
                "key material must never reach the published state tree"
            );
        }
    }

    #[tokio::test]
    async fn published_state_reports_an_empty_key_list_as_an_empty_array() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, _paths) = fixture(dir.path(), "inactive", "disabled");

        let state = reconciler
            .apply(&settings_with_keys(Vec::new()))
            .await
            .unwrap();

        assert_eq!(state["authorizedKeys"], json!([]));
    }

    // ---- R7.8: permissions -------------------------------------------------

    #[tokio::test]
    async fn the_rendered_key_file_is_0600_in_a_0755_directory() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");

        reconciler
            .apply(&settings_with_keys(vec![raw_key(
                &canonical(REAL_ED25519_LINE),
                None,
            )]))
            .await
            .unwrap();

        assert_eq!(mode_of(&paths.keys), 0o600);
        assert_eq!(mode_of(paths.keys.parent().unwrap()), 0o755);
    }

    #[tokio::test]
    async fn an_unchanged_key_list_is_not_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");
        let settings = settings_with_keys(vec![raw_key(&canonical(REAL_ED25519_LINE), None)]);
        reconciler.apply(&settings).await.unwrap();
        // A marker the reconciler would clobber if it rewrote the file: the
        // renderer always produces mode 0600.
        std::fs::set_permissions(&paths.keys, std::fs::Permissions::from_mode(0o640)).unwrap();

        reconciler.apply(&settings).await.unwrap();

        assert_eq!(
            mode_of(&paths.keys),
            0o640,
            "an unchanged key file must not be rewritten"
        );
    }
}
