//! What the power pane's POST actually puts on the bus.
//!
//! The route tests in the parent module stop at the [`SettingsApi`] trait, and
//! `docs/design/bus.md` §7's switch — from the `com.mos.mosd1`
//! `Reboot`/`PowerOff` methods to a write on the `/Actions/<verb>` items —
//! happens below that trait, inside `bus_client`. No fake implementing the
//! trait can see which of the two apid used. The end-to-end test cannot see it
//! either: mosd logs the request and records it in live state before the power
//! call whichever spelling asks for it, which is exactly the property that
//! makes the switch safe and exactly the property that makes it invisible from
//! outside.
//!
//! So this module puts a fake mosd on a private `dbus-daemon --session` — the
//! same harness `tests/e2e.rs` uses, and never the host's bus — serving both
//! surfaces at once under the real well-known name, and drives the real router
//! through the real [`BusSettings`]. The methods are served rather than
//! omitted on purpose: a call recorded against them says "the switch did not
//! happen", where an unserved method would only say "something on the bus is
//! wrong". A missing `dbus-daemon` panics rather than skips, as e2e does: a
//! run that returned early would report green while asserting nothing.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::http::StatusCode;
use serde_json::Value;
use zbus::zvariant;

use super::{SIGNING_KEY, configured_tree, login, post_form};
use crate::bus_client::BusSettings;
use crate::routes::{AppState, app};
use crate::settings_api::SettingsApi;

/// The action items the power pane must write.
///
/// Spelled out here rather than imported from `bus_client`: `docs/design/bus.md`
/// §7 names these exact paths, and a test that borrowed the constant from the
/// code under test would follow it wherever it moved.
const REBOOT_ITEM: &str = "/Actions/reboot";
const POWER_OFF_ITEM: &str = "/Actions/poweroff";
/// Where the superseded `com.mos.mosd1` methods live. mosd still serves them.
const MOSD_PATH: &str = "/com/mos/mosd";
const MOSD_NAME: &str = "com.mos.mosd";

/// The types mosd's `SetValue` can hold (`tree::from_variant`). A value of any
/// other type is rejected as invalid before it reaches the action, so the
/// trigger would silently do nothing.
const MOSD_HOLDS: [&str; 10] = [
    "bool", "u8", "i16", "u16", "i32", "u32", "i64", "u64", "f64", "str",
];

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

/// What the fake mosd was asked to do, in call order, and what was written.
#[derive(Clone, Default)]
struct Recorder {
    calls: Arc<Mutex<Vec<String>>>,
    written: Arc<Mutex<Vec<String>>>,
}

impl Recorder {
    fn record(&self, call: String) {
        self.calls.lock().unwrap().push(call);
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }

    /// The type of every value written to an action item, in call order.
    fn written(&self) -> Vec<String> {
        self.written.lock().unwrap().clone()
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

/// The name of a variant's type, for the [`MOSD_HOLDS`] assertion.
fn kind(value: &zvariant::Value<'_>) -> String {
    match value {
        zvariant::Value::Bool(_) => "bool",
        zvariant::Value::U8(_) => "u8",
        zvariant::Value::I16(_) => "i16",
        zvariant::Value::U16(_) => "u16",
        zvariant::Value::I32(_) => "i32",
        zvariant::Value::U32(_) => "u32",
        zvariant::Value::I64(_) => "i64",
        zvariant::Value::U64(_) => "u64",
        zvariant::Value::F64(_) => "f64",
        zvariant::Value::Str(_) => "str",
        other => return format!("unsupported({other:?})"),
    }
    .to_string()
}

/// `com.mos.mosd1`: enough of the settings surface for the router to
/// authenticate, plus the two power methods the pane must no longer call.
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

    /// The superseded power surface. Recorded, never expected.
    async fn reboot(&self) {
        self.recorder.record("method:Reboot".to_string());
    }

    async fn power_off(&self) {
        self.recorder.record("method:PowerOff".to_string());
    }
}

/// `com.mos.Item1` on one action item's object path.
struct FakeItem {
    path: &'static str,
    /// What `SetValue` answers — the dispatch result (`docs/design/bus.md` §7).
    /// Shared so one fixture can answer differently call by call.
    code: Arc<AtomicI32>,
    recorder: Recorder,
}

#[zbus::interface(name = "com.mos.Item1")]
impl FakeItem {
    async fn set_value(&self, value: zvariant::Value<'_>) -> i32 {
        self.recorder.record(format!("item:{}", self.path));
        self.recorder.written.lock().unwrap().push(kind(&value));
        self.code.load(Ordering::SeqCst)
    }
}

/// A fake mosd on a private bus, and everything needed to talk to it.
struct Fake {
    /// The connection apid's client rides. Held here so it outlives every
    /// client minted from it.
    connection: zbus::Connection,
    recorder: Recorder,
    code: Arc<AtomicI32>,
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

    /// What every subsequent `SetValue` answers.
    fn answers(&self, code: i32) {
        self.code.store(code, Ordering::SeqCst);
    }
}

/// Start a private session bus with a fake mosd on it. Panics when
/// `dbus-daemon` is not installed rather than skipping — see the module docs.
async fn fake(code: i32) -> Fake {
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
    let code = Arc::new(AtomicI32::new(code));
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
        .serve_at(
            REBOOT_ITEM,
            FakeItem {
                path: REBOOT_ITEM,
                code: code.clone(),
                recorder: recorder.clone(),
            },
        )
        .expect("serve the reboot item")
        .serve_at(
            POWER_OFF_ITEM,
            FakeItem {
                path: POWER_OFF_ITEM,
                code: code.clone(),
                recorder: recorder.clone(),
            },
        )
        .expect("serve the power-off item")
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
        code,
        _server: server,
        _bus: bus,
    }
}

#[tokio::test]
async fn a_confirmed_reboot_post_writes_the_reboot_action_item() {
    let fake = fake(0).await;
    let router = fake.router().await;
    let cookie = login(&router, PASSWORD).await;

    let response = post_form(&router, "/power/reboot", "confirm=reboot", Some(&cookie)).await;

    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert_eq!(
        fake.recorder.settled(1).await,
        vec![format!("item:{REBOOT_ITEM}")],
        "the reboot POST must write the action item and call no method"
    );
}

#[tokio::test]
async fn a_confirmed_power_off_post_writes_the_poweroff_action_item() {
    let fake = fake(0).await;
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
        vec![format!("item:{POWER_OFF_ITEM}")],
        "the power-off POST must write the action item and call no method"
    );
}

/// Each verb writes its own item and nothing else — `/Actions/poweroff` is not
/// reachable by asking for a reboot, which is the one confusion whose cost is
/// an appliance that does not come back.
///
/// Also the trigger-value check: the value is arbitrary — the write itself is
/// the trigger — but a type `from_variant` refuses is rejected before reaching
/// the action, and from here that failure would look exactly like a working
/// trigger, a code coming back and nothing rebooting.
#[tokio::test]
async fn each_verb_writes_only_its_own_item_with_a_value_mosd_can_hold() {
    let fake = fake(0).await;
    let api = fake.client().await;

    api.reboot().await.expect("reboot dispatched");
    api.power_off().await.expect("power-off dispatched");

    assert_eq!(
        fake.recorder.calls(),
        vec![
            format!("item:{REBOOT_ITEM}"),
            format!("item:{POWER_OFF_ITEM}")
        ]
    );
    for written in fake.recorder.written() {
        assert!(
            MOSD_HOLDS.contains(&written.as_str()),
            "the trigger must be a type mosd's SetValue can hold, got {written}"
        );
    }
}

/// `0` is success and nothing else is, whatever the number.
///
/// mosd's failure vocabulary is not fixed — `-4` is being narrowed back to
/// "validated but would not persist" while a new code takes "accepted but
/// would not dispatch" — so apid recognises `0` and no other number. This is
/// the assertion that makes that split a non-event here: it names every code
/// mosd uses today, the one it is about to add, ones it will never use, and a
/// positive code, which §1.1 reserves rather than defining as a second kind of
/// success.
#[tokio::test]
async fn only_a_zero_dispatch_code_is_success() {
    let fake = fake(0).await;
    fake.client().await.reboot().await.expect("0 is dispatched");

    for code in [-1, -2, -3, -4, -5, -6, -99, i32::MIN, 1, i32::MAX] {
        fake.answers(code);

        let err = fake
            .client()
            .await
            .reboot()
            .await
            .expect_err(&format!("code {code} must not read as dispatched"));

        // The code reaches the log line the route already writes, and that is
        // the whole of apid's interest in it: there is no decision here that
        // telling two failures apart would change.
        assert!(
            err.to_string().contains(&code.to_string()),
            "the failure should report the code it got, said: {err}"
        );
    }
}
