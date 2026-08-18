//! End-to-end test: private `dbus-daemon --session` + real `mosd` + real
//! `webd`, driven over HTTPS/HTTP with a real client.
//!
//! Everything lives in tempdirs on ephemeral ports; `MOSD_DRY_RUN=1` keeps
//! the host untouched. Skips gracefully when `dbus-daemon` is not installed.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::time::Duration;

use anyhow::Context;
use reqwest::StatusCode;
use reqwest::header::{LOCATION, SET_COOKIE};

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

/// Locate the `mosd` binary: `MOSD_BIN` override first, otherwise next to
/// the test executable (tests live in `target/<profile>/deps/`, the binary
/// in `target/<profile>/`).
fn find_mosd() -> anyhow::Result<PathBuf> {
    if let Some(path) = std::env::var_os("MOSD_BIN") {
        return Ok(PathBuf::from(path));
    }
    let exe = std::env::current_exe().context("locate test executable")?;
    let candidate = exe
        .parent()
        .and_then(|deps| deps.parent())
        .context("test executable has no target profile directory")?
        .join("mosd");
    anyhow::ensure!(
        candidate.exists(),
        "mosd binary not found at {}; build it with `cargo build -p mosd` or set MOSD_BIN",
        candidate.display()
    );
    Ok(candidate)
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
}

/// Read `stdout` on a helper thread until a line starting with `prefix`
/// appears, with a timeout.
fn wait_for_line(stdout: ChildStdout, prefix: &'static str) -> anyhow::Result<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if line.starts_with(prefix) {
                let _ = tx.send(line);
                break;
            }
        }
    });
    rx.recv_timeout(Duration::from_secs(30))
        .with_context(|| format!("timed out waiting for `{prefix}` on stdout"))
}

/// HTTPS client trusting the self-signed cert, with redirects disabled so
/// every redirect is asserted explicitly.
fn http_client(cookies: bool) -> anyhow::Result<reqwest::Client> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::none())
        .cookie_store(cookies)
        .build()
        .context("build reqwest client")
}

fn location(response: &reqwest::Response) -> &str {
    response
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("(no Location header)")
}

#[tokio::test(flavor = "multi_thread")]
async fn web_flow_end_to_end() -> anyhow::Result<()> {
    let Some(dbus_daemon) = find_dbus_daemon() else {
        eprintln!("skipping web_flow_end_to_end: dbus-daemon not found");
        return Ok(());
    };
    let mosd_bin = find_mosd()?;

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
        Command::new(&mosd_bin)
            .env("DBUS_SESSION_BUS_ADDRESS", &address)
            .env("MOSD_BUS", "session")
            .env("MOSD_DRY_RUN", "1")
            .env("MOSD_SETTINGS_PATH", &settings_path)
            .spawn()?,
    );

    let mut webd_child = Command::new(env!("CARGO_BIN_EXE_webd"))
        .env("DBUS_SESSION_BUS_ADDRESS", &address)
        .env("WEBD_BUS", "session")
        .env("WEBD_STATE_DIR", dir.path().join("webd"))
        .env("WEBD_HTTPS_ADDR", "127.0.0.1:0")
        .env("WEBD_HTTP_ADDR", "127.0.0.1:0")
        .stdout(Stdio::piped())
        .spawn()?;
    let webd_stdout = webd_child.stdout.take().expect("piped stdout");
    let _webd_guard = ChildGuard(webd_child);
    let marker = wait_for_line(webd_stdout, "WEBD_LISTENING ")?;
    let field = |name: &str| {
        marker
            .split_whitespace()
            .find_map(|part| part.strip_prefix(&format!("{name}=")))
            .map(str::to_string)
            .with_context(|| format!("`{name}=` missing from marker `{marker}`"))
    };
    let https_addr = field("https")?;
    let http_addr = field("http")?;
    let https_base = format!("https://{https_addr}");

    // Wait for mosd to claim the well-known name on the private bus.
    let connection = zbus::connection::Builder::address(address.as_str())?
        .build()
        .await?;
    let proxy = MosdProxy::new(&connection).await?;
    tokio::time::timeout(Duration::from_secs(10), async {
        while proxy.get_settings("").await.is_err() {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .context("mosd did not come up on the private bus")?;

    // First run: unauthenticated requests bounce to the setup wizard.
    let admin = http_client(true)?;
    let response = admin.get(format!("{https_base}/")).send().await?;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/setup");

    // Complete the wizard: password + hostname, no initial interface.
    let response = admin
        .post(format!("{https_base}/setup"))
        .form(&[
            ("password", "e2e-password"),
            ("confirm", "e2e-password"),
            ("hostname", "e2e-host"),
        ])
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/");
    let cookie = response
        .headers()
        .get(SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .expect("setup should set a session cookie");
    assert!(
        cookie.starts_with("webd_session="),
        "unexpected cookie: {cookie}"
    );

    // The session cookie authenticates the status pane.
    let response = admin.get(format!("{https_base}/")).send().await?;
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.text().await?;
    assert!(
        body.contains("e2e-host"),
        "status page should show the hostname:\n{body}"
    );

    // Change the hostname over HTTP, then verify it landed in mosd.
    let response = admin
        .post(format!("{https_base}/hostname"))
        .form(&[("hostname", "e2e-host2")])
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/hostname?saved=1");
    assert_eq!(proxy.get_settings("hostname").await?, "\"e2e-host2\"");

    // With the password set, anonymous requests bounce to login instead.
    let anon = http_client(true)?;
    let response = anon.get(format!("{https_base}/network")).send().await?;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/login");

    // /healthz never requires auth.
    let response = anon.get(format!("{https_base}/healthz")).send().await?;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.text().await?, "ok");

    // Wrong password fails; the right one yields a usable session.
    let response = anon
        .post(format!("{https_base}/login"))
        .form(&[("password", "wrong-password")])
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let response = anon
        .post(format!("{https_base}/login"))
        .form(&[("password", "e2e-password")])
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/");
    let response = anon.get(format!("{https_base}/network")).send().await?;
    assert_eq!(response.status(), StatusCode::OK);

    // The HTTP listener only redirects to the HTTPS origin.
    let response = anon.get(format!("http://{http_addr}/")).send().await?;
    assert_eq!(response.status(), StatusCode::PERMANENT_REDIRECT);
    let target = location(&response);
    assert!(
        target.starts_with("https://"),
        "unexpected redirect target: {target}"
    );

    Ok(())
}
