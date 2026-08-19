//! SSH access reconciler: renders the sshd drop-in from `access.ssh` and
//! drives `ssh.service`.
//!
//! Two system effects, in this order:
//!
//! 1. `/etc/ssh/sshd_config.d/10-mos.conf` is rendered from `access.ssh`. That
//!    directory is the one writable part of `/etc` on the v2 read-only root —
//!    it is a STATE-backed bind mount (`etc-ssh.mount`).
//! 2. `ssh.service` is brought to the state `access.ssh.enabled` asks for.
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

use std::path::PathBuf;

use anyhow::{Context, Result};
use mosd_settings::{Settings, SshSettings};
use serde_json::json;

use super::Reconciler;
use super::systemd::{Systemd, UnitControl, is_active, is_enabled};
use crate::transient::write_atomically;

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
/// Mode of the rendered drop-in: world-readable configuration, owner-writable.
const DROP_IN_MODE: u32 = 0o644;

/// Reconciler for the `access.ssh` settings subtree.
pub struct SshdReconciler<C: UnitControl> {
    drop_in_path: PathBuf,
    /// Shadow file this reconciler's device operates on.
    ///
    /// dead_code: nothing here writes it any more. It is kept, with its env
    /// override, because deciding whether password authentication may be
    /// offered at all means asking `transient::transient_password_active` about
    /// this exact path, and that question is asked from here.
    #[allow(dead_code)]
    shadow_path: PathBuf,
    control: C,
}

impl<C: UnitControl> SshdReconciler<C> {
    /// Create an sshd reconciler writing `drop_in_path`, tracking the shadow
    /// file at `shadow_path`, and driving `ssh.service` through `control`.
    ///
    /// Every path is a parameter so tests run entirely inside a temporary
    /// directory and never touch the host's sshd.
    pub fn new(drop_in_path: PathBuf, shadow_path: PathBuf, control: C) -> Self {
        Self {
            drop_in_path,
            shadow_path,
            control,
        }
    }
}

impl SshdReconciler<Systemd> {
    /// Production reconciler: paths from [`DROP_IN_ENV`] and [`SHADOW_ENV`] if
    /// set, else the system locations.
    pub fn production() -> Self {
        let drop_in = std::env::var(DROP_IN_ENV)
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_DROP_IN));
        let shadow = std::env::var(SHADOW_ENV)
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_SHADOW));
        Self::new(drop_in, shadow, Systemd)
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
            shadow: dir.join("shadow"),
        };
        std::fs::write(&paths.shadow, SHADOW).unwrap();
        std::fs::set_permissions(&paths.shadow, std::fs::Permissions::from_mode(SHADOW_MODE))
            .unwrap();
        let reconciler = SshdReconciler::new(
            paths.drop_in.clone(),
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
            authorized_keys: Vec::new(),
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
            authorized_keys: Vec::new(),
        };

        assert_eq!(render_drop_in(&ssh), render_drop_in(&ssh.clone()));
    }

    #[tokio::test]
    async fn apply_writes_the_golden_drop_in_creating_its_directory() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "inactive", "disabled");

        reconciler
            .apply(&settings_with(ssh_settings(true)))
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
            .apply(&settings_with(ssh_settings(true)))
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
        std::fs::write(&paths.drop_in, GOLDEN_DEFAULTS).unwrap();

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
            GOLDEN_DEFAULTS
        );
    }

    #[tokio::test]
    async fn changing_the_config_of_a_running_sshd_restarts_it() {
        let dir = tempfile::tempdir().unwrap();
        let (reconciler, paths) = fixture(dir.path(), "active", "enabled");
        std::fs::create_dir_all(paths.drop_in.parent().unwrap()).unwrap();
        std::fs::write(&paths.drop_in, GOLDEN_DEFAULTS).unwrap();

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

        for path in [&paths.drop_in, &paths.shadow] {
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
