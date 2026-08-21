//! Integration tests: the read-only `com.mos.Item1` item-tree façade over a
//! private session bus (PLAN-011 M1, `docs/design/bus.md`).
//!
//! Same harness as `tests/bus.rs`: a private `dbus-daemon --session` plus the
//! `mosd` binary in dry-run mode (no reconcilers, so the host is never
//! touched). Skips gracefully when `dbus-daemon` is not installed.

use std::collections::HashMap;
use std::future::poll_fn;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::pin::pin;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use zbus::export::futures_core::Stream;
use zbus::zvariant::OwnedValue;

/// Secret values seeded into the settings file; none may ever cross the bus.
const WEB_HASH: &str = "$argon2id$fake-web-admin-hash";
const DEVICE_HASH: &str = "$argon2id$fake-device-hash";
const AP_PSK: &str = "topsecret-ap-psk";
const CLIENT_PSK: &str = "topsecret-client-psk";

/// One `ItemsChanged` payload as the client deserializes it.
type Items = HashMap<String, HashMap<String, OwnedValue>>;

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
    fn set_settings(&self, path: &str, value_json: &str) -> zbus::Result<()>;
}

#[zbus::proxy(
    interface = "com.mos.Item1",
    default_service = "com.mos.mosd",
    default_path = "/"
)]
trait Item {
    fn get_items(&self) -> zbus::Result<Items>;
    #[zbus(signal)]
    fn items_changed(&self, items: Items) -> zbus::Result<()>;
}

/// A private bus, a dry-run mosd on it, and a client connection.
struct Harness {
    connection: zbus::Connection,
    _mosd: ChildGuard,
    _bus: ChildGuard,
    _dir: tempfile::TempDir,
}

/// Settings tree every test seeds: secrets under every redacted key name the
/// schema can carry, plus enough ordinary leaves to assert the projection.
fn seeded_settings() -> mosd_settings::Settings {
    let mut settings = mosd_settings::Settings::default();
    settings.access.web_admin = Some(mosd_settings::WebAdminSettings {
        password_hash: WEB_HASH.to_string(),
    });
    settings.access.device.password_hash = Some(DEVICE_HASH.to_string());
    settings.access.device.generation = 1;
    settings.wifi.ap.ssid = Some("mos-test".to_string());
    settings.wifi.ap.psk = Some(AP_PSK.to_string());
    settings.wifi.client.networks = vec![mosd_settings::WifiNetwork {
        ssid: "home".to_string(),
        psk: Some(CLIENT_PSK.to_string()),
        hidden: false,
        priority: 7,
    }];
    settings
}

/// Spawn the private bus and the daemon; `None` when `dbus-daemon` is absent.
async fn start() -> anyhow::Result<Option<Harness>> {
    let Some(dbus_daemon) = find_dbus_daemon() else {
        eprintln!("skipping: dbus-daemon not found");
        return Ok(None);
    };

    // Private session bus; never the host system bus.
    let mut bus_child = Command::new(dbus_daemon)
        .args(["--session", "--print-address=1", "--nofork"])
        .stdout(Stdio::piped())
        .spawn()?;
    let bus_stdout = bus_child.stdout.take().expect("piped stdout");
    let bus_guard = ChildGuard(bus_child);
    let mut address = String::new();
    BufReader::new(bus_stdout).read_line(&mut address)?;
    let address = address.trim().to_string();
    anyhow::ensure!(!address.is_empty(), "dbus-daemon printed no address");

    let dir = tempfile::tempdir()?;
    let settings_path = dir.path().join("settings.toml");
    std::fs::write(&settings_path, toml::to_string(&seeded_settings())?)?;
    let shadow_path = dir.path().join("shadow");
    std::fs::write(&shadow_path, "root:!:19000:0:99999:7:::\n")?;
    // MOSD_DRY_RUN=1 is a hard safety requirement: production reconcilers
    // must never be constructed in tests.
    let mosd_guard = ChildGuard(
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
    Ok(Some(Harness {
        connection,
        _mosd: mosd_guard,
        _bus: bus_guard,
        _dir: dir,
    }))
}

/// Next `ItemsChanged` payload off `stream`, within a timeout.
async fn next_items(stream: &mut ItemsChangedStream) -> Items {
    let signal = tokio::time::timeout(Duration::from_secs(10), async {
        let mut stream = pin!(stream);
        poll_fn(|cx| stream.as_mut().poll_next(cx)).await
    })
    .await
    .expect("timed out waiting for ItemsChanged")
    .expect("signal stream ended");
    signal.args().expect("signal args").items().clone()
}

/// Poll `GetItems` until the daemon has claimed its name and answers.
async fn wait_items(proxy: &ItemProxy<'_>) -> anyhow::Result<Items> {
    let items = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match proxy.get_items().await {
                Ok(items) => break items,
                Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
            }
        }
    })
    .await?;
    Ok(items)
}

/// Assert that none of the seeded secret values appears anywhere in `items`.
fn assert_no_secret(items: &Items, context: &str) {
    let dump = format!("{items:?}");
    for secret in [WEB_HASH, DEVICE_HASH, AP_PSK, CLIENT_PSK] {
        assert!(
            !dump.contains(secret),
            "secret value crossed the bus in {context}: {dump}"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn get_items_projects_both_trees_as_slash_paths() -> anyhow::Result<()> {
    let Some(harness) = start().await? else {
        return Ok(());
    };
    let proxy = ItemProxy::new(&harness.connection).await?;
    let items = wait_items(&proxy).await?;

    for (path, attrs) in &items {
        assert!(path.starts_with('/'), "not an absolute slash path: {path}");
        assert!(attrs.contains_key("value"), "no value attr on {path}");
        assert!(
            !bool::try_from(attrs["writable"].clone())?,
            "every item is read-only in M1, but {path} says writable"
        );
    }

    // The settings tree.
    assert_eq!(
        String::try_from(items["/hostname"]["value"].clone())?,
        "mos"
    );
    assert_eq!(
        i64::try_from(items["/schema_version"]["value"].clone())?,
        i64::from(mosd_settings::SCHEMA_VERSION)
    );
    assert_eq!(
        String::try_from(items["/wifi/ap/ssid"]["value"].clone())?,
        "mos-test"
    );
    assert_eq!(
        i64::try_from(items["/wifi/ap/channel"]["value"].clone())?,
        6
    );
    assert_eq!(
        i64::try_from(items["/access/device/generation"]["value"].clone())?,
        1
    );
    // The live-state tree, through the same façade.
    assert!(bool::try_from(items["/dry_run"]["value"].clone())?);
    // Arrays are whole-value leaves: the dot-path syntax cannot index them.
    assert!(items.contains_key("/wifi/client/networks"));
    assert!(!items.contains_key("/wifi/client/networks/0"));

    // The a{sa{sv}} signature on the wire, read back from the daemon, and the
    // M2 members absent: this façade is GetItems/ItemsChanged only.
    let introspectable = zbus::fdo::IntrospectableProxy::builder(&harness.connection)
        .destination("com.mos.mosd")?
        .path("/")?
        .build()
        .await?;
    let xml = introspectable.introspect().await?;
    assert!(
        xml.contains("com.mos.Item1"),
        "no com.mos.Item1 at /:\n{xml}"
    );
    assert_eq!(
        xml.matches("type=\"a{sa{sv}}\"").count(),
        2,
        "GetItems out-arg and ItemsChanged arg must both be a{{sa{{sv}}}}:\n{xml}"
    );
    assert!(
        !xml.contains("GetValue") && !xml.contains("SetValue"),
        "per-item GetValue/SetValue are M2 scope:\n{xml}"
    );
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_burst_of_changes_coalesces_into_one_items_changed() -> anyhow::Result<()> {
    let Some(harness) = start().await? else {
        return Ok(());
    };
    let item_proxy = ItemProxy::new(&harness.connection).await?;
    let mosd_proxy = MosdProxy::new(&harness.connection).await?;
    wait_items(&item_proxy).await?;

    let mut changed = item_proxy.receive_items_changed().await?;

    // One mutation, four new leaves — one turn inside the daemon.
    mosd_proxy
        .set_settings(
            "network.eth9",
            r#"{"dhcp":false,"static":{"address":"10.0.0.2/24","gateway":"10.0.0.1","dns":["10.0.0.1","1.1.1.1"]}}"#,
        )
        .await?;
    let first = next_items(&mut changed).await;
    let mut keys: Vec<&str> = first.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "/network/eth9/dhcp",
            "/network/eth9/static/address",
            "/network/eth9/static/dns",
            "/network/eth9/static/gateway",
        ],
        "the four leaves must arrive in ONE coalesced signal"
    );
    assert!(!bool::try_from(
        first["/network/eth9/dhcp"]["value"].clone()
    )?);

    // Exactly one: the next signal on the stream belongs to the NEXT mutation.
    // Had the burst been split, D-Bus ordering would put the remainder here.
    mosd_proxy
        .set_settings("hostname", "\"coalesce-probe\"")
        .await?;
    let second = next_items(&mut changed).await;
    assert_eq!(
        second.keys().collect::<Vec<_>>(),
        ["/hostname"],
        "a stray entry here means the first burst was split across signals"
    );
    assert_eq!(
        String::try_from(second["/hostname"]["value"].clone())?,
        "coalesce-probe"
    );
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn secret_values_appear_in_no_get_items_and_no_signal() -> anyhow::Result<()> {
    let Some(harness) = start().await? else {
        return Ok(());
    };
    let item_proxy = ItemProxy::new(&harness.connection).await?;
    let mosd_proxy = MosdProxy::new(&harness.connection).await?;
    let items = wait_items(&item_proxy).await?;

    assert_no_secret(&items, "GetItems");
    for path in items.keys() {
        let leaf = path.rsplit('/').next().unwrap_or_default();
        assert!(
            !["password_hash", "passwordHash", "psk", "hash"].contains(&leaf),
            "a secret-named path was projected: {path}"
        );
    }
    // webAdmin holds nothing but its hash, so redaction leaves no item at all.
    assert!(!items.contains_key("/access/webAdmin/password_hash"));
    // The sibling of a redacted key survives.
    assert!(items.contains_key("/access/device/generation"));

    // A change whose payload WOULD carry a psk: the signal must not.
    let mut changed = item_proxy.receive_items_changed().await?;
    mosd_proxy
        .set_settings(
            "wifi.client.networks",
            r#"[{"ssid":"cafe","psk":"signal-psk-secret","priority":1}]"#,
        )
        .await?;
    let payload = next_items(&mut changed).await;
    assert!(
        payload.contains_key("/wifi/client/networks"),
        "the changed networks leaf must be in the signal: {payload:?}"
    );
    assert_no_secret(&payload, "ItemsChanged");
    let dump = format!("{payload:?}");
    assert!(
        !dump.contains("signal-psk-secret"),
        "psk crossed the bus in ItemsChanged: {dump}"
    );
    assert!(dump.contains("cafe"), "the redacted network lost its ssid");
    Ok(())
}
