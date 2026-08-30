//! What APID's power pane puts on the management bus.
//!
//! This module serves a fake `com.mos.mosd1` on a private session bus and
//! drives the real router through the real [`BusSettings`]. It pins that
//! reboot and power-off use dedicated system-management methods; APID never
//! writes application item trees.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::http::StatusCode;
use serde_json::Value;

use super::{SIGNING_KEY, configured_tree, login, post_form};
use crate::bus_client::BusSettings;
use crate::routes::{AppState, app};
use crate::settings_api::SettingsApi;

/// The system-management interface location.
const MOSD_PATH: &str = "/com/mos/mosd";
const MOSD_NAME: &str = "com.mos.mosd";

const PASSWORD: &str = "hunter2secret";

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
/// A missing bus daemon means these tests cannot assert what they exist to
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

/// What the fake mosd was asked to do, in call order.
#[derive(Clone, Default)]
struct Recorder {
    calls: Arc<Mutex<Vec<String>>>,
}

impl Recorder {
    fn record(&self, call: String) {
        self.calls.lock().unwrap().push(call);
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }

    /// Poll [`Self::calls`] until it holds at least `count` entries or a short
    /// deadline passes, then return it.
    ///
    /// The routes fire power actions on a detached task so the HTTP response
    /// can go out first, so nothing has reached the bus yet when the POST
    /// returns. Returning whatever arrived by the deadline rather than
    /// asserting here is what lets the caller's `assert_eq!` print the wrong
    /// call it got instead of a timeout.
    async fn settled(&self, count: usize) -> Vec<String> {
        for _ in 0..500 {
            let calls = self.calls();
            if calls.len() >= count {
                return calls;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        self.calls()
    }
}

/// Subtree of `root` at dot-path `path`; `""` is the whole tree.
fn walk(root: &Value, path: &str) -> Option<Value> {
    if path.is_empty() {
        return Some(root.clone());
    }
    path.split('.')
        .try_fold(root, |node, segment| node.get(segment))
        .cloned()
}

/// `com.mos.mosd1`: enough for authentication and the two power methods.
struct FakeMosd {
    tree: Value,
    recorder: Recorder,
}

#[zbus::interface(name = "com.mos.mosd1")]
impl FakeMosd {
    async fn get_settings(&self, path: &str) -> zbus::fdo::Result<String> {
        walk(&self.tree, path)
            .map(|node| node.to_string())
            .ok_or_else(|| zbus::fdo::Error::Failed(format!("path not found: `{path}`")))
    }

    async fn reboot(&self) {
        self.recorder.record("method:Reboot".to_string());
    }

    async fn power_off(&self) {
        self.recorder.record("method:PowerOff".to_string());
    }
}

/// A fake mosd on a private bus, and everything needed to talk to it.
struct Fake {
    /// The connection apid's client rides. Held here so it outlives every
    /// client minted from it.
    connection: zbus::Connection,
    recorder: Recorder,
    _server: zbus::Connection,
    _bus: ChildGuard,
}

impl Fake {
    /// A real [`BusSettings`] pointed at this fake.
    ///
    /// One per call rather than one per fixture: a failed call empties the
    /// client's proxy cache, and rebuilding it is the client's own business.
    async fn client(&self) -> BusSettings {
        BusSettings::with_connection(&self.connection)
            .await
            .expect("mosd proxy")
    }

    /// The real router over a fresh client: a POST here travels the whole way.
    async fn router(&self) -> Router {
        let api: Arc<dyn SettingsApi> = Arc::new(self.client().await);
        app(AppState::new(api, SIGNING_KEY))
    }
}

/// Start a private session bus with a fake mosd on it. Panics when
/// `dbus-daemon` is not installed rather than skipping — see the module docs.
async fn fake() -> Fake {
    let dbus_daemon = dbus_daemon();

    // Private session bus; never the host system or session bus.
    let mut child = Command::new(dbus_daemon)
        .args(["--session", "--print-address=1", "--nofork"])
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn dbus-daemon");
    let stdout = child.stdout.take().expect("piped stdout");
    let bus = ChildGuard(child);
    let mut address = String::new();
    BufReader::new(stdout)
        .read_line(&mut address)
        .expect("read the bus address");
    let address = address.trim().to_string();
    assert!(!address.is_empty(), "dbus-daemon printed no address");

    let recorder = Recorder::default();
    let server = zbus::connection::Builder::address(address.as_str())
        .expect("bus address")
        .name(MOSD_NAME)
        .expect("well-known name")
        .serve_at(
            MOSD_PATH,
            FakeMosd {
                tree: configured_tree(PASSWORD),
                recorder: recorder.clone(),
            },
        )
        .expect("serve com.mos.mosd1")
        .build()
        .await
        .expect("fake mosd on the private bus");
    let connection = zbus::connection::Builder::address(address.as_str())
        .expect("bus address")
        .build()
        .await
        .expect("client connection to the private bus");

    Fake {
        connection,
        recorder,
        _server: server,
        _bus: bus,
    }
}

#[tokio::test]
async fn a_confirmed_reboot_post_calls_the_management_method() {
    let fake = fake().await;
    let router = fake.router().await;
    let cookie = login(&router, PASSWORD).await;

    let response = post_form(&router, "/power/reboot", "confirm=reboot", Some(&cookie)).await;

    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert_eq!(
        fake.recorder.settled(1).await,
        vec!["method:Reboot".to_string()],
        "the reboot POST must call the management method and write no item"
    );
}

#[tokio::test]
async fn a_confirmed_power_off_post_calls_the_management_method() {
    let fake = fake().await;
    let router = fake.router().await;
    let cookie = login(&router, PASSWORD).await;

    let response = post_form(
        &router,
        "/power/poweroff",
        "confirm=poweroff",
        Some(&cookie),
    )
    .await;

    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert_eq!(
        fake.recorder.settled(1).await,
        vec!["method:PowerOff".to_string()],
        "the power-off POST must call the management method and write no item"
    );
}

/// Each API verb calls only its matching management method. Confusing these
/// methods can power off an appliance that was expected to return.
#[tokio::test]
async fn each_verb_calls_only_its_matching_management_method() {
    let fake = fake().await;
    let api = fake.client().await;

    api.reboot().await.expect("reboot dispatched");
    api.power_off().await.expect("power-off dispatched");

    assert_eq!(
        fake.recorder.calls(),
        vec!["method:Reboot".to_string(), "method:PowerOff".to_string()]
    );
}
