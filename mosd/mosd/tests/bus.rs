//! Integration test: exercise `com.mos.mosd1` over a private session bus.
//!
//! Spawns a private `dbus-daemon --session` plus the `mosd` binary in
//! dry-run mode (no reconcilers, so the host is never touched), then drives
//! the interface with a zbus client. Skips gracefully when `dbus-daemon` is
//! not installed.

use std::future::poll_fn;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::pin::pin;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use zbus::export::futures_core::Stream;

/// Two accounts, nine fields each — the shape of a Debian `/etc/shadow`, with
/// `root` locked the way `mos-shadow-reconcile` leaves it.
const SHADOW: &str = "root:!:19000:0:99999:7:::\n\
    daemon:*:19000:0:99999:7:::\n";

/// Kills the wrapped child on drop, including on panic.
struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Locate `dbus-daemon`: `/usr/bin/dbus-daemon` first, then `$PATH`.
fn find_dbus_daemon() -> Option<PathBuf> {
    let fixed = PathBuf::from("/usr/bin/dbus-daemon");
    if fixed.exists() {
        return Some(fixed);
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join("dbus-daemon"))
        .find(|candidate| candidate.exists())
}

#[zbus::proxy(
    interface = "com.mos.mosd1",
    default_service = "com.mos.mosd",
    default_path = "/com/mos/mosd"
)]
trait Mosd {
    fn get_settings(&self, path: &str) -> zbus::Result<String>;
    fn set_settings(&self, path: &str, value_json: &str) -> zbus::Result<()>;
    fn get_state(&self, path: &str) -> zbus::Result<String>;
    fn report_health(&self, component: &str, status: &str, detail: &str) -> zbus::Result<()>;
    fn reboot(&self) -> zbus::Result<()>;
    fn power_off(&self) -> zbus::Result<()>;
    fn set_transient_root_password(&self, password: &str) -> zbus::Result<()>;
    #[zbus(signal)]
    fn settings_changed(&self, path: &str, value_json: &str) -> zbus::Result<()>;
}

#[tokio::test(flavor = "multi_thread")]
async fn bus_roundtrip() -> anyhow::Result<()> {
    let Some(dbus_daemon) = find_dbus_daemon() else {
        eprintln!("skipping bus_roundtrip: dbus-daemon not found");
        return Ok(());
    };

    // Private session bus; never the host system bus.
    let mut bus_child = Command::new(dbus_daemon)
        .args(["--session", "--print-address=1", "--nofork"])
        .stdout(Stdio::piped())
        .spawn()?;
    let bus_stdout = bus_child.stdout.take().expect("piped stdout");
    let _bus_guard = ChildGuard(bus_child);
    let mut address = String::new();
    BufReader::new(bus_stdout).read_line(&mut address)?;
    let address = address.trim().to_string();
    anyhow::ensure!(!address.is_empty(), "dbus-daemon printed no address");

    let dir = tempfile::tempdir()?;
    let settings_path = dir.path().join("settings.toml");
    // The daemon must never be pointed at the host's /etc/shadow, so the
    // transient-password method gets a throwaway file of its own.
    let shadow_path = dir.path().join("shadow");
    let marker_path = dir.path().join("transient-root-password");
    std::fs::write(&shadow_path, SHADOW)?;
    // MOSD_DRY_RUN=1 is a hard safety requirement: production reconcilers
    // must never be constructed in tests.
    let _mosd_guard = ChildGuard(
        Command::new(env!("CARGO_BIN_EXE_mosd"))
            .env("DBUS_SESSION_BUS_ADDRESS", &address)
            .env("MOSD_BUS", "session")
            .env("MOSD_DRY_RUN", "1")
            .env("MOSD_SETTINGS_PATH", &settings_path)
            .env("MOSD_SHADOW_PATH", &shadow_path)
            .spawn()?,
    );

    let connection = zbus::connection::Builder::address(address.as_str())?
        .build()
        .await?;
    let proxy = MosdProxy::new(&connection).await?;

    // Wait for the daemon to claim the well-known name.
    let defaults = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match proxy.get_settings("").await {
                Ok(json) => break json,
                Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
            }
        }
    })
    .await?;
    let defaults: serde_json::Value = serde_json::from_str(&defaults)?;
    assert_eq!(defaults["hostname"], "mos");
    assert_eq!(defaults["schema_version"], mosd_settings::SCHEMA_VERSION);

    let mut changed = proxy.receive_settings_changed().await?;
    proxy.set_settings("hostname", "\"unit-test-host\"").await?;

    let signal = tokio::time::timeout(Duration::from_secs(10), async {
        let mut changed = pin!(&mut changed);
        poll_fn(|cx| changed.as_mut().poll_next(cx)).await
    })
    .await?
    .expect("signal stream ended");
    let args = signal.args()?;
    assert_eq!(args.path(), &"hostname");
    assert_eq!(args.value_json(), &"\"unit-test-host\"");

    let hostname = proxy.get_settings("hostname").await?;
    assert_eq!(hostname, "\"unit-test-host\"");

    let persisted = std::fs::read_to_string(&settings_path)?;
    assert!(
        persisted.contains("unit-test-host"),
        "settings.toml should contain the new hostname, got:\n{persisted}"
    );

    let state = proxy.get_state("").await?;
    let state: serde_json::Value = serde_json::from_str(&state)?;
    assert_eq!(state["dry_run"], true);

    // ReportHealth: the health gate's /var pressure report lands in the
    // live-state tree and reads back through the existing GetState call.
    proxy
        .report_health("var", "degraded", "/var at 91% of capacity (threshold 85%)")
        .await?;
    let health = proxy.get_state("health.var").await?;
    let health: serde_json::Value = serde_json::from_str(&health)?;
    assert_eq!(health["status"], "degraded");
    assert_eq!(health["detail"], "/var at 91% of capacity (threshold 85%)");
    assert!(proxy.report_health("", "ok", "").await.is_err());

    // Power actions. Assert the safety precondition FIRST: the daemon under
    // test must be in dry-run, where its PowerControl is the no-op one and
    // `Systemd` — the only thing that can reach the host system bus — is never
    // constructed. If someone drops MOSD_DRY_RUN from the spawn above, this
    // fails before a single power method is invoked rather than after.
    let dry_run = proxy.get_state("dry_run").await?;
    assert_eq!(
        dry_run, "true",
        "refusing to invoke power methods against a daemon that is not in dry-run"
    );

    // What is asserted below is the wiring — that D-Bus member `Reboot` runs
    // the reboot handler and `PowerOff` runs the power-off handler, each
    // recording itself in the live-state tree before acting.
    proxy.reboot().await?;
    let power = proxy.get_state("power").await?;
    let power: serde_json::Value = serde_json::from_str(&power)?;
    assert_eq!(power["last_action"], "reboot");
    assert!(
        power["requested_by"]
            .as_str()
            .is_some_and(|sender| sender.starts_with(':')),
        "requested_by should be the caller's unique bus name, got {power}"
    );

    proxy.power_off().await?;
    let power = proxy.get_state("power").await?;
    let power: serde_json::Value = serde_json::from_str(&power)?;
    assert_eq!(power["last_action"], "power_off");

    // Settings are untouched by power actions: they are actions, not state.
    let after = proxy.get_settings("hostname").await?;
    assert_eq!(after, "\"unit-test-host\"");

    // SetTransientRootPassword. What is asserted first is the MEMBER NAME on
    // the real interface: zbus renames a snake_case method to PascalCase, and
    // a client that guesses wrong gets UnknownMethod, not a compile error. So
    // read the interface back out of the daemon instead of trusting the rename.
    let introspectable = zbus::fdo::IntrospectableProxy::builder(&connection)
        .destination("com.mos.mosd")?
        .path("/com/mos/mosd")?
        .build()
        .await?;
    let xml = introspectable.introspect().await?;
    let opening = "<method name=\"SetTransientRootPassword\">";
    let start = xml
        .find(opening)
        .unwrap_or_else(|| panic!("no SetTransientRootPassword on com.mos.mosd1:\n{xml}"));
    let body = &xml[start + opening.len()..];
    let body = &body[..body
        .find("</method>")
        .expect("the method element must close")];
    assert_eq!(
        body.matches("<arg").count(),
        1,
        "SetTransientRootPassword takes exactly one argument, got:\n{body}"
    );
    assert!(
        body.contains("type=\"s\"") && body.contains("direction=\"in\""),
        "its one argument must be an `in` string, got:\n{body}"
    );
    assert!(
        !xml.contains("set_transient_root_password"),
        "the snake_case name must NOT be what a client sees:\n{xml}"
    );

    // Then the behaviour, over the bus, against the daemon's own shadow file.
    proxy
        .set_transient_root_password("correct horse battery")
        .await?;
    let after = std::fs::read_to_string(&shadow_path)?;
    let root_hash = after
        .lines()
        .find(|line| line.starts_with("root:"))
        .and_then(|line| line.split(':').nth(1))
        .expect("root entry");
    assert!(
        bcrypt::verify("correct horse battery", root_hash)?,
        "the shadow root hash must verify against the password that was set"
    );
    assert_eq!(
        std::fs::read_to_string(&marker_path)?,
        format!("{root_hash}\n"),
        "the marker beside the shadow file must repeat the stored hash exactly"
    );
    assert_eq!(
        after.lines().skip(1).collect::<Vec<_>>(),
        SHADOW.lines().skip(1).collect::<Vec<_>>(),
        "every other account must survive byte-for-byte"
    );

    // A rejected password is an error, changes nothing, and does not echo the
    // password back to the caller.
    let err = proxy
        .set_transient_root_password("short12")
        .await
        .expect_err("seven bytes is below the floor");
    assert!(!err.to_string().contains("short12"), "leaked: {err}");
    assert_eq!(
        std::fs::read_to_string(&shadow_path)?,
        after,
        "a rejected password must leave the shadow file exactly as it was"
    );

    // A password is never a setting: the tree is untouched and nothing about it
    // reached the persisted file.
    assert_eq!(proxy.get_settings("hostname").await?, "\"unit-test-host\"");
    let persisted = std::fs::read_to_string(&settings_path)?;
    assert!(
        !persisted.contains("correct horse"),
        "the password reached settings.toml:\n{persisted}"
    );

    assert!(proxy.get_settings("no.such.path").await.is_err());
    assert!(proxy.set_settings("hostname", "not json").await.is_err());
    assert!(proxy.set_settings("schema_version", "2").await.is_err());

    Ok(())
}
