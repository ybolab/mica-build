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
    // MOSD_DRY_RUN=1 is a hard safety requirement: production reconcilers
    // must never be constructed in tests.
    let _mosd_guard = ChildGuard(
        Command::new(env!("CARGO_BIN_EXE_mosd"))
            .env("DBUS_SESSION_BUS_ADDRESS", &address)
            .env("MOSD_BUS", "session")
            .env("MOSD_DRY_RUN", "1")
            .env("MOSD_SETTINGS_PATH", &settings_path)
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

    assert!(proxy.get_settings("no.such.path").await.is_err());
    assert!(proxy.set_settings("hostname", "not json").await.is_err());
    assert!(proxy.set_settings("schema_version", "2").await.is_err());

    Ok(())
}
