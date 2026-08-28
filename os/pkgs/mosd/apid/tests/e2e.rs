//! End-to-end test: private `dbus-daemon --session` + real `mosd` + real
//! `apid`, driven over HTTPS/HTTP with a real client.
//!
//! Everything lives in tempdirs on ephemeral ports; `MOSD_DRY_RUN=1` keeps
//! the host untouched.
//!
//! # This test does not skip
//!
//! `dbus-daemon` is a hard requirement, not an optional extra: a run that
//! returned early when the binary is missing would report green while
//! asserting nothing. [`dbus_daemon`] panics instead, naming the tool it
//! could not find, exactly as `mosd/tests/bus.rs` does; CI provisions the
//! `dbus-daemon` package alongside the other build dependencies.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::time::Duration;

use anyhow::Context;
use reqwest::StatusCode;
use reqwest::header::{ALLOW, CONTENT_TYPE, LOCATION, SET_COOKIE};

/// Kills the wrapped child on drop, including on panic.
struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Locate `dbus-daemon` (`/usr/bin/dbus-daemon` first, then `$PATH`), or
/// FAIL — never skip.
///
/// A missing bus daemon means this test cannot assert what it exists to
/// assert, and the only honest outcome for a test that cannot run is a red
/// one. See the module docs.
fn dbus_daemon() -> PathBuf {
    let fixed = PathBuf::from("/usr/bin/dbus-daemon");
    if fixed.exists() {
        return fixed;
    }
    let found = std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|dir| dir.join("dbus-daemon"))
            .find(|candidate| candidate.exists())
    });
    found.unwrap_or_else(|| {
        panic!(
            "dbus-daemon was not found at /usr/bin/dbus-daemon or on PATH. This test asserts \
             real bus behaviour over a private session bus and MUST NOT skip: install it \
             (Debian/Ubuntu: the `dbus-daemon` package -- note that `dbus-bin` ships \
             dbus-send and dbus-monitor but NOT the daemon itself; Fedora: `dbus-daemon`) \
             and run it again."
        )
    })
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

/// POST `/login` with `password` on `client`'s own cookie jar.
async fn post_login(
    client: &reqwest::Client,
    https_base: &str,
    password: &str,
) -> anyhow::Result<reqwest::Response> {
    client
        .post(format!("{https_base}/login"))
        .form(&[("password", password)])
        .send()
        .await
        .with_context(|| format!("POST {https_base}/login"))
}

#[tokio::test(flavor = "multi_thread")]
async fn web_flow_end_to_end() -> anyhow::Result<()> {
    let dbus_daemon = dbus_daemon();
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
    // MOSD_SHADOW_PATH below is the second hard safety requirement, alongside
    // MOSD_DRY_RUN: setting a transient root password rewrites the shadow file
    // mosd was pointed at, and without the override that is the host's
    // /etc/shadow. The SSH section asserts that THIS file is the one that
    // changed and that the host's is untouched, so a spawn that lost the
    // variable fails loudly here rather than quietly editing the machine.
    let shadow_path = dir.path().join("shadow");
    std::fs::write(&shadow_path, "root:!:20000:0:99999:7:::\n")?;
    let marker_path = dir.path().join("transient-root-password");
    // MOSD_DRY_RUN=1 is a hard safety requirement: production reconcilers
    // must never be constructed in tests.
    let _mosd_guard = ChildGuard(
        Command::new(&mosd_bin)
            .env("DBUS_SESSION_BUS_ADDRESS", &address)
            .env("MOSD_BUS", "session")
            .env("MOSD_DRY_RUN", "1")
            .env("MOSD_SETTINGS_PATH", &settings_path)
            .env("MOSD_SHADOW_PATH", &shadow_path)
            .spawn()?,
    );

    let mut apid_child = Command::new(env!("CARGO_BIN_EXE_apid"))
        .env("DBUS_SESSION_BUS_ADDRESS", &address)
        .env("APID_BUS", "session")
        .env("APID_STATE_DIR", dir.path().join("apid"))
        .env("APID_HTTPS_ADDR", "127.0.0.1:0")
        .env("APID_HTTP_ADDR", "127.0.0.1:0")
        .stdout(Stdio::piped())
        .spawn()?;
    let apid_stdout = apid_child.stdout.take().expect("piped stdout");
    let _apid_guard = ChildGuard(apid_child);
    let marker = wait_for_line(apid_stdout, "APID_LISTENING ")?;
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
        cookie.starts_with("apid_session="),
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

    // §3.2's bootstrap, end to end and against a live server: the operator
    // holds a browser session and nothing else, and mints the first bearer at
    // `POST /builtin/tokens` -- not an `/api/v1/` route, which is the whole
    // reason it can still take the cookie after M9 (RFCT-245) withdrew the
    // cookie from `/api/v1/`. The plaintext is displayed once, in a <pre>.
    let response = admin
        .post(format!("{https_base}/builtin/tokens"))
        .form(&[("name", "e2e")])
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let minted = response.text().await?;
    let token = minted
        .split_once("<pre>")
        .and_then(|(_, rest)| rest.split_once("</pre>"))
        .map(|(wire, _)| wire.to_string())
        .unwrap_or_else(|| panic!("the plaintext is displayed once, in a <pre>:\n{minted}"));

    // `docs/design/api.md` §2.4 case 3's second, differently-scoped endpoint,
    // against a live mosd on a real bus: 200, `mosd: "ok"`, and the answer
    // stamped with the appliance's own uptime. `/healthz` above says apid's
    // listener is up; this says the appliance is manageable, and only a real
    // round trip can tell the difference.
    //
    // Presented with the bearer and not the session: since M9 this is the only
    // credential the route takes, and the token above is where a real operator
    // gets one.
    let response = admin
        .get(format!("{https_base}/api/v1/health"))
        .bearer_auth(&token)
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let health: serde_json::Value = serde_json::from_str(&response.text().await?)?;
    assert_eq!(health["apid"], "ok");
    assert_eq!(health["mosd"], "ok");
    assert!(health["checkedAt"].is_u64(), "checkedAt: {health}");
    assert!(health.get("detail").is_none(), "{health}");

    // It is authenticated, and its refusal is §2.4's envelope rather than the
    // gate's redirect (§3.1).
    let response = anon
        .get(format!("{https_base}/api/v1/health"))
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let error: serde_json::Value = serde_json::from_str(&response.text().await?)?;
    assert_eq!(error["error"]["code"], "not_authenticated");

    // M9 (RFCT-245): and the session cookie is refused here exactly as the
    // absent credential is. `admin` carries a cookie jar, so this request is
    // the authenticated browser -- 401 with the envelope, never a 303 to
    // /login, against a live server rather than a router in a unit test.
    let response = admin
        .get(format!("{https_base}/api/v1/health"))
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(response.headers().get(LOCATION).is_none());
    let error: serde_json::Value = serde_json::from_str(&response.text().await?)?;
    assert_eq!(error["error"]["code"], "not_authenticated");

    // PLAN-023 M4's write route, against a live mosd on a real bus: a bare
    // JSON string at `hostname` answers 204 and the value is in mosd's own
    // settings tree afterwards. Read back through `GetSettings` rather than
    // through `GetState`, for the reason the form-path assertion above reads
    // back the same way: `state.hostname` is published by the hostname
    // reconciler, which writes `/etc/hostname` and calls hostnamed, and
    // neither is available to this harness.
    let response = admin
        .put(format!("{https_base}/api/v1/settings/hostname"))
        .bearer_auth(&token)
        .header(CONTENT_TYPE, "application/json")
        .body("\"e2e-host3\"")
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(response.text().await?.is_empty());
    assert_eq!(proxy.get_settings("hostname").await?, "\"e2e-host3\"");

    // The refusal list is apid's and is answered before the bus: a dot-path
    // the schema has and this route does not write is 409, with mosd's tree
    // untouched.
    let response = admin
        .put(format!("{https_base}/api/v1/settings/network.eth9"))
        .bearer_auth(&token)
        .header(CONTENT_TYPE, "application/json")
        .body(r#"{"dhcp": true}"#)
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let error: serde_json::Value = serde_json::from_str(&response.text().await?)?;
    assert_eq!(error["error"]["code"], "settings_read_only");
    assert_eq!(error["error"]["source"], "apid");
    assert!(
        proxy.get_settings("network.eth9").await.is_err(),
        "the refused write must not have created the entry"
    );

    // §2.4's one shape, on a method a declared route does not serve, with the
    // `Allow` header naming what it does serve.
    let response = admin
        .post(format!("{https_base}/api/v1/meta"))
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(response.headers().get(ALLOW).unwrap(), "GET,HEAD");
    let error: serde_json::Value = serde_json::from_str(&response.text().await?)?;
    assert_eq!(error["error"]["code"], "method_not_allowed");
    assert_eq!(error["error"]["source"], "apid");

    // The login curve over the real listener. A wrong password is answered
    // 401 and costs a backoff window (`access.md` §3.3's `backoffBase`, one
    // second, doubling per consecutive failure); every attempt inside that
    // window is refused 429 without being checked -- the correct password
    // included, which is the point of the rule. The guard is one global
    // counter rather than one per client, so a second connection does not step
    // around it either. `apid::tests::the_first_failure_arms_the_backoff_window`
    // pins the same curve as a unit test; a 429 here turning back into a 303
    // means the guard has regressed, so do not "fix" this sequence by dropping
    // the wait.
    //
    // The run is driven up first, so the window under test is eight seconds
    // rather than `backoffBase`'s one. The assertion below needs the window
    // still armed when the next request arrives, and between the two there is
    // a full HTTPS round trip with an argon2 verification inside it — argon2
    // is expensive on purpose. At the base step that is a one-second budget
    // for work whose cost nothing in this test bounds, and under
    // parallel-suite load a round trip of 1.5 s lapses the window, so the
    // expected 429 arrives as a 303. Four consecutive failures arm eight
    // seconds, five times the worst round trip seen. Do not "fix" this by
    // dropping the loop and going back to one failure; the sequence below is
    // what makes the 429 assertion deterministic rather than a race against
    // argon2.
    //
    // A refused attempt is turned away before it is charged, so a 429 does not
    // advance the run — only an admitted-and-failed attempt (401) does. That
    // is why this polls for 401 rather than sleeping: it is the same reasoning
    // as the ride-it-out loop further down, and it means the loop measures the
    // curve instead of guessing at it.
    const RUN_BEFORE_ASSERT: u32 = 4;
    let mut failures = 0u32;
    tokio::time::timeout(Duration::from_secs(60), async {
        while failures < RUN_BEFORE_ASSERT {
            let response = post_login(&anon, &https_base, "wrong-password").await?;
            match response.status() {
                StatusCode::UNAUTHORIZED => {
                    assert!(
                        response.headers().get(SET_COOKIE).is_none(),
                        "a wrong password must not mint a session"
                    );
                    failures += 1;
                }
                StatusCode::TOO_MANY_REQUESTS => {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                other => anyhow::bail!("a wrong password answered {other}, expected 401 or 429"),
            }
        }
        anyhow::Ok(())
    })
    .await
    .context("the login curve never admitted enough attempts to arm a long window")??;

    let response = post_login(&anon, &https_base, "e2e-password").await?;
    assert_eq!(
        response.status(),
        StatusCode::TOO_MANY_REQUESTS,
        "the correct password inside an armed window is refused unchecked"
    );
    assert!(
        response.headers().get(SET_COOKIE).is_none(),
        "a refused attempt must not mint a session"
    );

    // Ride the window out. A refused attempt is turned away before it is
    // charged, so retrying does not push the window back and the first
    // attempt after it lapses is admitted -- which makes polling for the
    // window's end deterministic where a fixed sleep would be a guess about
    // both the window and the argon2 verification in front of it.
    let response = tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let response = post_login(&anon, &https_base, "e2e-password").await?;
            if response.status() != StatusCode::TOO_MANY_REQUESTS {
                break anyhow::Ok(response);
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .context("the login backoff window never lapsed")??;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(location(&response), "/");
    let response = anon.get(format!("{https_base}/network")).send().await?;
    assert_eq!(response.status(), StatusCode::OK);

    // Power actions travel apid -> D-Bus -> mosd. Assert the safety
    // precondition FIRST: mosd must be in dry-run, where its PowerControl is
    // the no-op one and the system-bus `Systemd` control is never constructed.
    // If someone drops MOSD_DRY_RUN from the spawn above, this fails before a
    // single power request is sent rather than after.
    assert_eq!(
        proxy.get_state("dry_run").await?,
        "true",
        "refusing to POST power actions against a daemon that is not in dry-run"
    );

    // What is proven below is that the POST reaches mosd, which mosd records
    // in its live-state tree before acting.
    let response = admin
        .post(format!("{https_base}/power/reboot"))
        .form(&[("confirm", "reboot")])
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    // The response is sent before the D-Bus call completes, so poll for the
    // record rather than expecting it to be there already.
    let recorded = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Ok(json) = proxy.get_state("power").await
                && let Ok(value) = serde_json::from_str::<serde_json::Value>(&json)
                && value["last_action"] == "reboot"
            {
                break value;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .context("reboot request never reached mosd")?;
    assert_eq!(recorded["last_action"], "reboot");

    let response = admin
        .post(format!("{https_base}/power/poweroff"))
        .form(&[("confirm", "poweroff")])
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let recorded = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Ok(json) = proxy.get_state("power").await
                && let Ok(value) = serde_json::from_str::<serde_json::Value>(&json)
                && value["last_action"] == "power_off"
            {
                break value;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .context("power-off request never reached mosd")?;
    assert_eq!(recorded["last_action"], "power_off");

    // GET is not routed for either action, and an unconfirmed POST is
    // rejected; neither leaves a new record behind.
    for path in ["/power/reboot", "/power/poweroff"] {
        let response = admin.get(format!("{https_base}{path}")).send().await?;
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "GET {path}"
        );
        let response = admin
            .post(format!("{https_base}{path}"))
            .form(&[("confirm", "")])
            .send()
            .await?;
        assert_eq!(
            response.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "unconfirmed POST {path}"
        );
    }
    let after: serde_json::Value = serde_json::from_str(&proxy.get_state("power").await?)?;
    assert_eq!(
        after["last_action"], "power_off",
        "no rejected request may reach mosd"
    );

    // Anonymous power requests never get past the auth gate, correct
    // confirmation token or not.
    for (path, token) in [("/power/reboot", "reboot"), ("/power/poweroff", "poweroff")] {
        let response = http_client(false)?
            .post(format!("{https_base}{path}"))
            .form(&[("confirm", token)])
            .send()
            .await?;
        assert_eq!(response.status(), StatusCode::SEE_OTHER, "anonymous {path}");
        assert_eq!(location(&response), "/login");
    }
    let after: serde_json::Value = serde_json::from_str(&proxy.get_state("power").await?)?;
    assert_eq!(
        after["last_action"], "power_off",
        "no anonymous request may reach mosd"
    );

    // ---- SSH pane -------------------------------------------------------
    // Real `ssh-keygen` output; the same key the route tests use. Public keys
    // are not secrets and this one corresponds to no device.
    const KEY_LINE: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL99V7xPTOP3jZjnbVPM7xC+ckwzkOQPalUpsvtPzYo8 rfct-034-test-ed25519";
    const KEY_BLOB: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIL99V7xPTOP3jZjnbVPM7xC+ckwzkOQPalUpsvtPzYo8";
    /// As `ssh-keygen -lf` prints it for the key above.
    const KEY_FINGERPRINT: &str = "SHA256:HrgN3GLi6Mop2uSRjgOoxImM8zRkFmgqCKoeGD9QOaM";
    const TRANSIENT_PASSWORD: &str = "e2e-transient-secret";

    let response = admin.get(format!("{https_base}/ssh")).send().await?;
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.text().await?;
    assert!(
        body.contains("Every authorized key is a root key."),
        "the SSH pane must say what a key grants:\n{body}"
    );

    // The toggle travels apid -> D-Bus -> mosd's typed settings tree.
    let response = admin
        .post(format!("{https_base}/ssh/enable"))
        .form(&[("enabled", "on")])
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(proxy.get_settings("access.ssh.enabled").await?, "true");

    // A key added through the pane is accepted by the same schema mosd
    // validates against, and comes back with its comment split out.
    let response = admin
        .post(format!("{https_base}/ssh/keys/add"))
        .form(&[("key", KEY_LINE)])
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    let stored = proxy.get_settings("access.ssh.authorizedKeys").await?;
    assert!(
        stored.contains("rfct-034-test-ed25519"),
        "the key should be in the settings tree: {stored}"
    );

    // The pane identifies it by fingerprint and never republishes the blob.
    let body = admin
        .get(format!("{https_base}/ssh"))
        .send()
        .await?
        .text()
        .await?;
    assert!(body.contains(KEY_FINGERPRINT), "{body}");
    assert!(!body.contains(KEY_BLOB), "key material reached the pane");

    // An unparsable line is refused by apid and never reaches mosd.
    let response = admin
        .post(format!("{https_base}/ssh/keys/add"))
        .form(&[("key", "ssh-ed25519  AAAA")])
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        proxy.get_settings("access.ssh.authorizedKeys").await?,
        stored,
        "a rejected key must leave the list untouched"
    );

    // The transient password: it reaches mosd's shadow file and NOT the
    // settings tree. The host's own shadow file is checked either side, which
    // is what makes the MOSD_SHADOW_PATH override above provably in force.
    let host_shadow_before = std::fs::metadata("/etc/shadow")
        .and_then(|meta| meta.modified())
        .ok();
    let settings_before = proxy.get_settings("").await?;
    let response = admin
        .post(format!("{https_base}/ssh/password"))
        .form(&[
            ("confirm", "set-transient-password"),
            ("password", TRANSIENT_PASSWORD),
        ])
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    let shadow = std::fs::read_to_string(&shadow_path)?;
    assert!(
        shadow.starts_with("root:$2"),
        "the temporary shadow file should now carry a bcrypt hash: {shadow}"
    );
    assert!(
        std::fs::metadata(&marker_path)?.len() > 0,
        "the transient marker should have been written beside it"
    );
    assert_eq!(
        std::fs::metadata("/etc/shadow")
            .and_then(|meta| meta.modified())
            .ok(),
        host_shadow_before,
        "the host's shadow file must not have been touched"
    );
    let settings_after = proxy.get_settings("").await?;
    assert_eq!(
        settings_after, settings_before,
        "a transient password must change no setting"
    );
    assert!(
        !settings_after.contains(TRANSIENT_PASSWORD),
        "the password must not appear in the settings tree"
    );

    // Removal is addressed by the fingerprint the pane rendered.
    let response = admin
        .post(format!("{https_base}/ssh/keys/remove"))
        .form(&[("identifier", KEY_FINGERPRINT)])
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(proxy.get_settings("access.ssh.authorizedKeys").await?, "[]");

    // Removing it again is an error, not a silent success.
    let response = admin
        .post(format!("{https_base}/ssh/keys/remove"))
        .form(&[("identifier", KEY_FINGERPRINT)])
        .send()
        .await?;
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // No mutating SSH route is reachable by GET, and none is reachable
    // without a session.
    let settings_before = proxy.get_settings("access.ssh").await?;
    for path in [
        "/ssh/enable",
        "/ssh/password",
        "/ssh/keys/add",
        "/ssh/keys/remove",
    ] {
        let response = admin.get(format!("{https_base}{path}")).send().await?;
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "GET {path}"
        );
        let response = http_client(false)?
            .post(format!("{https_base}{path}"))
            .form(&[("enabled", "on"), ("confirm", "set-transient-password")])
            .send()
            .await?;
        assert_eq!(response.status(), StatusCode::SEE_OTHER, "anonymous {path}");
        assert_eq!(location(&response), "/login");
    }
    assert_eq!(
        proxy.get_settings("access.ssh").await?,
        settings_before,
        "no rejected SSH request may reach mosd"
    );

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
