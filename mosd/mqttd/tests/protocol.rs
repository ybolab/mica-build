//! Protocol tests for the MQTT bridge.
//!
//! These drive the production path — the real [`Bridge`], the real payload
//! encoder and masker, the real [`apply`] — against an in-memory
//! [`Transport`] and [`ItemSource`], per the decision recorded in the crate
//! docs. No broker, no D-Bus daemon, no filesystem: **none of these tests can
//! skip**, which is deliberate, because a test that skips reports green while
//! asserting nothing.

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;
use rumqttc::{AsyncClient, MqttOptions};
use serde_json::{Value as Json, json};

use mos_mqttd::bridge::{Bridge, Effects, Publication};
use mos_mqttd::config::{Mode, Timings};
use mos_mqttd::item::Item;
use mos_mqttd::runtime::{ReconnectBackoff, apply};
use mos_mqttd::source::{ItemSource, WriteOutcome};
use mos_mqttd::topic::{self, Address, Request};
use mos_mqttd::transport::Transport;

/// The device id the fixture tree carries at `/provisioning/deviceId`.
const DEVICE: &str = "abc123";
/// `com.mos.mosd`'s class (`docs/design/bus.md` §5).
const CLASS: &str = "mosd";
/// The bus name of an extension service under PLAN-011 D5's grammar, whose
/// class is its **fourth** dotted component.
const EXTENSION_SERVICE: &str = "com.mos.ext.sensor.abc123";
/// The class [`EXTENSION_SERVICE`] must publish under.
const EXTENSION_CLASS: &str = "sensor";
/// The extension namespace with no service under it — in the extension half
/// of the namespace, but naming no class (PLAN-011 D5, RFCT-093).
const EXTENSION_NAMESPACE: &str = "com.mos.ext";

fn secs(seconds: u64) -> Duration {
    Duration::from_secs(seconds)
}

/// Everything an item notification for `path` is addressed by.
fn notify(path: &str) -> String {
    format!("N/{DEVICE}/{CLASS}/0{path}")
}

/// A tree shaped like the one mosd projects: the provisioning identity, two
/// writable platform-config items, a read-only live-state item, and an action.
fn tree() -> BTreeMap<String, Item> {
    BTreeMap::from([
        (
            "/provisioning/deviceId".to_string(),
            Item::new(json!(DEVICE)),
        ),
        ("/hostname".to_string(), Item::writable(json!("mos-abc123"))),
        (
            "/network/eth0/dhcp".to_string(),
            Item::writable(json!(true)),
        ),
        ("/system/uptime".to_string(), Item::new(json!(42))),
        ("/Actions/reboot".to_string(), Item::writable(json!(0))),
    ])
}

/// A [`Transport`] that records instead of connecting.
#[derive(Default)]
struct Recorder {
    published: Mutex<Vec<Publication>>,
    filters: Mutex<Vec<String>>,
}

#[async_trait]
impl Transport for Recorder {
    async fn publish(&self, publication: &Publication) -> anyhow::Result<()> {
        self.published.lock().unwrap().push(publication.clone());
        Ok(())
    }

    async fn subscribe(&self, filter: &str) -> anyhow::Result<()> {
        self.filters.lock().unwrap().push(filter.to_string());
        Ok(())
    }

    async fn unsubscribe(&self, filter: &str) -> anyhow::Result<()> {
        self.filters.lock().unwrap().retain(|held| held != filter);
        Ok(())
    }
}

impl Recorder {
    fn topics(&self) -> Vec<String> {
        self.published
            .lock()
            .unwrap()
            .iter()
            .map(|publication| publication.topic.clone())
            .collect()
    }

    /// The decoded payload of the one publication on `topic`.
    fn payload(&self, topic: &str) -> Json {
        let published = self.published.lock().unwrap();
        // Built before the lookup, not inside the panic: a `self.topics()`
        // there would take the same lock a second time and hang the test
        // instead of failing it.
        let seen: Vec<&str> = published
            .iter()
            .map(|publication| publication.topic.as_str())
            .collect();
        let mut matching = published
            .iter()
            .filter(|publication| publication.topic == topic);
        let publication = matching
            .next()
            .unwrap_or_else(|| panic!("nothing published on {topic}; saw {seen:?}"));
        assert!(
            matching.next().is_none(),
            "{topic} was published more than once"
        );
        serde_json::from_slice(&publication.payload).expect("payload is JSON")
    }

    /// The decoded payload of the most recent publication on `topic`, for
    /// topics a test expects more than one of.
    fn last_payload(&self, topic: &str) -> Json {
        let published = self.published.lock().unwrap();
        let publication = published
            .iter()
            .rev()
            .find(|publication| publication.topic == topic)
            .unwrap_or_else(|| panic!("nothing published on {topic}"));
        serde_json::from_slice(&publication.payload).expect("payload is JSON")
    }

    fn count(&self, topic: &str) -> usize {
        self.published
            .lock()
            .unwrap()
            .iter()
            .filter(|publication| publication.topic == topic)
            .count()
    }

    fn clear(&self) {
        self.published.lock().unwrap().clear();
    }
}

/// An [`ItemSource`] that records writes instead of making them.
struct Fake {
    items: BTreeMap<String, Item>,
    writes: Mutex<Vec<(String, Json)>>,
    outcome: WriteOutcome,
}

impl Fake {
    fn new() -> Self {
        Self {
            items: tree(),
            writes: Mutex::new(Vec::new()),
            outcome: WriteOutcome::Accepted,
        }
    }

    fn writes(&self) -> Vec<(String, Json)> {
        self.writes.lock().unwrap().clone()
    }
}

#[async_trait]
impl ItemSource for Fake {
    async fn get_items(&self) -> anyhow::Result<BTreeMap<String, Item>> {
        Ok(self.items.clone())
    }

    async fn set_value(&self, path: &str, value: Json) -> WriteOutcome {
        self.writes
            .lock()
            .unwrap()
            .push((path.to_string(), value.clone()));
        self.outcome.clone()
    }
}

/// Bridge, transport and source wired exactly as the daemon wires them.
struct Harness {
    bridge: Bridge,
    transport: Recorder,
    source: Fake,
}

impl Harness {
    fn new(mode: Mode) -> Self {
        Self::with_class(CLASS, mode)
    }

    /// The same wiring for a bridge publishing under some other class — an
    /// extension's, which is not the one its bus name's third component
    /// carries.
    fn with_class(class: &str, mode: Mode) -> Self {
        Self {
            bridge: Bridge::new(class, mode, Timings::default()),
            transport: Recorder::default(),
            source: Fake::new(),
        }
    }

    /// Carry out one event's effects through the production [`apply`].
    async fn run(&self, effects: Effects) {
        apply(effects, &self.transport, &self.source)
            .await
            .expect("effects applied");
    }

    /// The startup path: `GetItems` into the mirror, then a keepalive to open
    /// the alive window every later publication is gated on.
    async fn start(&mut self, now: Duration) {
        let items = self.source.get_items().await.expect("seed");
        let effects = self.bridge.seed(now, items);
        self.run(effects).await;
        let effects = self.bridge.on_keepalive(now);
        self.run(effects).await;
    }
}

/// (a) N, R and W each map to what the grammar says they map to.
#[tokio::test]
async fn verbs_map_to_notify_read_and_write() {
    let mut harness = Harness::new(Mode::Full);
    harness.start(secs(0)).await;

    // N: the full republish carries every item under its own topic.
    assert_eq!(
        harness.transport.payload(&notify("/hostname")),
        json!({"value": "mos-abc123"})
    );
    assert_eq!(
        harness.transport.payload(&notify("/network/eth0/dhcp")),
        json!({"value": true})
    );
    assert_eq!(
        harness.transport.payload(&notify("/Actions/reboot")),
        json!({"value": 0})
    );
    assert_eq!(
        harness
            .transport
            .payload(&format!("N/{DEVICE}/full_publish_completed")),
        json!({"value": 5}),
        "the marker reports how many items preceded it"
    );

    // N: one item change publishes exactly that item, and nothing else.
    harness.transport.clear();
    let effects = harness.bridge.on_items_changed(
        secs(1),
        BTreeMap::from([(
            "/hostname".to_string(),
            Some(Item::writable(json!("mos-renamed"))),
        )]),
    );
    harness.run(effects).await;
    assert_eq!(harness.transport.topics(), vec![notify("/hostname")]);
    assert_eq!(
        harness.transport.payload(&notify("/hostname")),
        json!({"value": "mos-renamed"})
    );
    assert!(
        harness.transport.published.lock().unwrap()[0].retain,
        "item notifications are retained so a late subscriber still finds the tree"
    );

    // R: the addressed item is republished on its N topic.
    harness.transport.clear();
    let effects =
        harness
            .bridge
            .on_request(secs(2), &format!("R/{DEVICE}/{CLASS}/0/system/uptime"), b"");
    harness.run(effects).await;
    assert_eq!(harness.transport.topics(), vec![notify("/system/uptime")]);
    assert_eq!(
        harness.transport.payload(&notify("/system/uptime")),
        json!({"value": 42})
    );

    // W: the addressed item is written, and nothing is published for it.
    harness.transport.clear();
    let effects = harness.bridge.on_request(
        secs(3),
        &format!("W/{DEVICE}/{CLASS}/0/network/eth0/dhcp"),
        br#"{"value": false}"#,
    );
    harness.run(effects).await;
    assert_eq!(
        harness.source.writes(),
        vec![("/network/eth0/dhcp".to_string(), json!(false))]
    );
    assert!(harness.transport.topics().is_empty());

    // An item that became invalid publishes the JSON form of the §3 sentinel,
    // so a subscriber sees the transition rather than inferring it.
    harness.transport.clear();
    let effects = harness.bridge.on_items_changed(
        secs(4),
        BTreeMap::from([("/system/uptime".to_string(), None)]),
    );
    harness.run(effects).await;
    assert_eq!(
        harness.transport.payload(&notify("/system/uptime")),
        json!({ "value": Json::Null })
    );

    // Topics belonging to someone else are not instructions to this bridge.
    harness.transport.clear();
    for foreign in [
        format!("R/other-device/{CLASS}/0/hostname"),
        format!("R/{DEVICE}/sensor/0/hostname"),
        format!("R/{DEVICE}/{CLASS}/7/hostname"),
        notify("/hostname"),
    ] {
        let effects = harness.bridge.on_request(secs(5), &foreign, b"");
        assert_eq!(effects, Effects::default(), "{foreign} was acted on");
    }
}

/// (b) A keepalive triggers a full republish, and a storm of them does not
/// multiply it.
#[tokio::test]
async fn keepalive_republishes_fully_and_is_rate_limited() {
    let mut harness = Harness::new(Mode::Full);
    let marker = format!("N/{DEVICE}/full_publish_completed");

    // Nothing at all before the first keepalive: publishing is gated on the
    // alive window.
    let items = harness.source.get_items().await.expect("seed");
    let effects = harness.bridge.seed(secs(0), items);
    harness.run(effects).await;
    assert!(
        harness.transport.topics().is_empty(),
        "the bridge published before any keepalive armed it"
    );

    // Ten keepalives inside the rate limit's floor.
    for tenth in 0..10 {
        let now = Duration::from_millis(tenth * 100);
        let effects = harness
            .bridge
            .on_request(now, &format!("R/{DEVICE}/keepalive"), b"");
        harness.run(effects).await;
    }
    assert_eq!(
        harness.transport.count(&marker),
        1,
        "a keepalive storm produced more than one full republish"
    );
    assert_eq!(
        harness.transport.count(&notify("/hostname")),
        1,
        "the storm republished the tree more than once"
    );

    // Every one of them renewed the window, which is what must not be
    // throttled: the last keepalive landed at 0.9 s, so the window runs to
    // 60.9 s.
    assert!(harness.bridge.alive(secs(60)));
    assert!(!harness.bridge.alive(secs(61)));

    // The republishes the floor swallowed coalesce into exactly one, once the
    // floor has passed.
    let effects = harness.bridge.on_tick(secs(5));
    harness.run(effects).await;
    assert_eq!(
        harness.transport.count(&marker),
        2,
        "the deferred republish did not coalesce into exactly one"
    );

    // The heartbeat runs at 3 s while alive: the tick above beat at 5 s, so
    // the next is due at 8 s and the one after at 11 s, and the ticks in
    // between produce nothing.
    harness.transport.clear();
    let beat = format!("N/{DEVICE}/heartbeat");
    for (tick, expected) in [
        (secs(6), 0),
        (secs(8), 1),
        (secs(9), 1),
        (secs(10), 1),
        (secs(11), 2),
    ] {
        let effects = harness.bridge.on_tick(tick);
        harness.run(effects).await;
        assert_eq!(
            harness.transport.count(&beat),
            expected,
            "heartbeat cadence is wrong at {tick:?}"
        );
    }
    assert_eq!(
        harness.transport.last_payload(&beat),
        json!({"value": 11}),
        "the beat carries the bridge's uptime in seconds"
    );
    harness.transport.clear();
    let effects = harness.bridge.on_tick(secs(120));
    harness.run(effects).await;
    assert!(
        harness.transport.topics().is_empty(),
        "the bridge kept publishing after the alive window expired"
    );
}

/// (c) Secrets are masked at publish, structurally, at any depth.
#[tokio::test]
async fn secrets_are_masked_at_publish() {
    const SECRET: &str = "s3cr3t-never-on-the-wire";

    let mut harness = Harness::new(Mode::Full);
    // Neither of these can reach a real bridge — mosd redacts them
    // structurally before they are items at all (`docs/design/bus.md` §8) —
    // which is exactly why the second control is tested against them.
    harness
        .source
        .items
        .insert("/access/ssh/hash".to_string(), Item::new(json!(SECRET)));
    harness.source.items.insert(
        "/wifi/client/networks".to_string(),
        Item::new(json!([
            {"ssid": "home", "psk": SECRET},
            {"ssid": "field", "password_hash": SECRET, "nested": {"passwordHash": SECRET}},
        ])),
    );
    harness.start(secs(0)).await;

    // A secret-named path is the secret, so it publishes as invalid rather
    // than as a masked value.
    assert_eq!(
        harness.transport.payload(&notify("/access/ssh/hash")),
        json!({ "value": Json::Null })
    );
    // A secret-named key inside a value is stripped, and its siblings are not.
    assert_eq!(
        harness.transport.payload(&notify("/wifi/client/networks")),
        json!({"value": [
            {"ssid": "home"},
            {"ssid": "field", "nested": {}},
        ]})
    );
    // And, the assertion that does not depend on knowing where to look: the
    // secret is in no payload this bridge produced, anywhere.
    for publication in harness.transport.published.lock().unwrap().iter() {
        let payload = String::from_utf8_lossy(&publication.payload);
        assert!(
            !payload.contains(SECRET),
            "{} carried the secret: {payload}",
            publication.topic
        );
    }
}

/// (d) Read-only mode refuses W, and full mode does not — the same request,
/// so the refusal cannot be an accident of the fixture.
#[tokio::test]
async fn read_only_mode_refuses_writes() {
    let topic = format!("W/{DEVICE}/{CLASS}/0/network/eth0/dhcp");
    let payload = br#"{"value": false}"#;

    let mut read_only = Harness::new(Mode::ReadOnly);
    read_only.start(secs(0)).await;
    read_only.transport.clear();
    let effects = read_only.bridge.on_request(secs(1), &topic, payload);
    read_only.run(effects).await;
    assert!(
        read_only.source.writes().is_empty(),
        "a read-only bridge carried a write through to SetValue"
    );
    assert!(read_only.transport.topics().is_empty());
    assert_eq!(
        read_only.bridge.subscriptions(),
        vec![format!("R/{DEVICE}/#")],
        "a read-only bridge subscribed to W topics"
    );

    let mut full = Harness::new(Mode::Full);
    full.start(secs(0)).await;
    let effects = full.bridge.on_request(secs(1), &topic, payload);
    full.run(effects).await;
    assert_eq!(
        full.source.writes(),
        vec![("/network/eth0/dhcp".to_string(), json!(false))],
        "the same request must reach the bus in full mode"
    );
    assert_eq!(
        full.bridge.subscriptions(),
        vec![format!("R/{DEVICE}/#"), format!("W/{DEVICE}/#")]
    );
}

/// A refused write puts nothing on the wire.
///
/// `SetValue`'s result codes are deliberately **not** part of this bridge's
/// grammar: `docs/design/bus.md` §10.1 has no acknowledgement topic, and §3
/// keeps the reason inside mosd. What a client observes is the item — a
/// successful write arrives as the `N` its `ItemsChanged` produces, and a
/// successful action arrives as the forced re-zero of §7 — so a refusal is
/// exactly the absence of that, and nothing here invents a topic to say so.
#[tokio::test]
async fn a_refused_write_publishes_nothing() {
    for (path, outcome) in [
        // The two halves of the persist/dispatch distinction, which this
        // bridge draws by path rather than by result code.
        ("/network/eth0/dhcp", WriteOutcome::Refused { code: -2 }),
        ("/Actions/reboot", WriteOutcome::UnknownObject),
    ] {
        let mut harness = Harness::new(Mode::Full);
        harness.source.outcome = outcome;
        harness.start(secs(0)).await;
        harness.transport.clear();

        let effects = harness.bridge.on_request(
            secs(1),
            &format!("W/{DEVICE}/{CLASS}/0{path}"),
            br#"{"value": 1}"#,
        );
        harness.run(effects).await;

        assert_eq!(
            harness.source.writes(),
            vec![(path.to_string(), json!(1))],
            "the request must still reach SetValue"
        );
        assert!(
            harness.transport.topics().is_empty(),
            "a refused write on {path} was reported on the wire"
        );
    }
}

/// (e) A device that leaves the bus has its retained state cleared.
#[tokio::test]
async fn a_vanished_device_clears_its_retained_state() {
    let mut harness = Harness::new(Mode::Full);
    harness.start(secs(0)).await;
    let published: Vec<String> = harness
        .transport
        .topics()
        .into_iter()
        .filter(|topic| topic.contains(CLASS))
        .collect();
    assert_eq!(published.len(), 5, "the fixture tree published five items");

    harness.transport.clear();
    let effects = harness.bridge.on_device_vanished(secs(1));
    harness.run(effects).await;

    let mut cleared = harness.transport.topics();
    cleared.sort();
    let mut expected = published;
    expected.sort();
    assert_eq!(
        cleared, expected,
        "the clear did not cover every item topic"
    );
    for publication in harness.transport.published.lock().unwrap().iter() {
        assert!(
            publication.payload.is_empty(),
            "{} was cleared with a payload, which sets state instead of deleting it",
            publication.topic
        );
        assert!(
            publication.retain,
            "{} was cleared without the retain flag, so the retained message survives",
            publication.topic
        );
    }
}

/// A device that vanishes while the bridge is silent still owes those clears,
/// and pays them at the next keepalive.
///
/// The alive gate makes the vanish itself silent, and the vanish takes the
/// device id with it — so the clears have to survive both, or the retained
/// state is stranded on the broker under an address nothing will publish to
/// again.
#[tokio::test]
async fn clears_owed_while_silent_are_paid_at_the_next_keepalive() {
    let mut harness = Harness::new(Mode::Full);
    harness.start(secs(0)).await;
    let published: Vec<String> = harness
        .transport
        .topics()
        .into_iter()
        .filter(|topic| topic.contains(CLASS))
        .collect();

    // The window shuts, and only then does the device leave the bus.
    harness.transport.clear();
    let effects = harness.bridge.on_device_vanished(secs(120));
    harness.run(effects).await;
    assert!(
        harness.transport.topics().is_empty(),
        "the bridge published after the alive window expired"
    );

    // The keepalive still parses — the device id outlives the process that
    // reported it — so the window reopens and the owed clears go out.
    let effects = harness
        .bridge
        .on_request(secs(121), &format!("R/{DEVICE}/keepalive"), b"");
    harness.run(effects).await;
    let mut cleared: Vec<String> = harness
        .transport
        .topics()
        .into_iter()
        .filter(|topic| topic.contains(CLASS))
        .collect();
    cleared.sort();
    let mut expected = published;
    expected.sort();
    assert_eq!(cleared, expected, "the owed clears were never paid");
    assert_eq!(
        harness
            .transport
            .payload(&format!("N/{DEVICE}/full_publish_completed")),
        json!({"value": 0}),
        "the republish of a vanished device carries no items"
    );
}

/// An extension publishes under its class, not under `ext`.
///
/// PLAN-011 D5 gives an extension the name `com.mos.ext.<class>[.<suffix>]`,
/// so the class is the fourth component where a system service's is the
/// third. Reading the third unconditionally — which is what this bridge did
/// before `mos-busname` — puts every extension's items under the class `ext`,
/// and M5 names that as the defect to test for. The negative assertion is
/// half the test: the equality alone would not say which wrong answer was
/// ruled out.
#[tokio::test]
async fn an_extension_publishes_under_its_class_and_never_under_ext() {
    let class = topic::class_of(EXTENSION_SERVICE).expect("a com.mos.* bus name");
    let mut harness = Harness::with_class(class, Mode::Full);
    harness.start(secs(0)).await;

    let published = harness.transport.topics();
    assert!(
        published.contains(&format!("N/{DEVICE}/{EXTENSION_CLASS}/0/hostname")),
        "{EXTENSION_SERVICE} did not publish under its class {EXTENSION_CLASS}; saw {published:?}"
    );
    assert!(
        !published
            .iter()
            .any(|topic| topic.starts_with(&format!("N/{DEVICE}/ext/"))),
        "{EXTENSION_SERVICE} published under the namespace `ext` instead of its class; saw {published:?}"
    );
}

/// And the system half does not move: `com.mos.mosd` still publishes under
/// `mosd`, the third component, exactly as it did before the rule learnt
/// about extensions.
#[tokio::test]
async fn a_system_service_still_publishes_under_its_third_component() {
    let class = topic::class_of("com.mos.mosd").expect("a com.mos.* bus name");
    let mut harness = Harness::with_class(class, Mode::Full);
    harness.start(secs(0)).await;

    let published = harness.transport.topics();
    assert!(
        published.contains(&format!("N/{DEVICE}/mosd/0/hostname")),
        "com.mos.mosd stopped publishing under mosd; saw {published:?}"
    );
}

/// Building and parsing agree for an extension too: a topic built for an
/// extension's address parses back to the request that built it, and a topic
/// addressed under `ext` is not one of ours.
#[test]
fn an_extension_topic_round_trips_and_ext_is_not_ours() {
    let address = Address {
        device_id: DEVICE.to_string(),
        class: topic::class_of(EXTENSION_SERVICE)
            .expect("a com.mos.* bus name")
            .to_string(),
        instance: 0,
    };

    let read = address.item_topic(topic::READ, "/system/uptime");
    assert_eq!(
        read,
        format!("R/{DEVICE}/{EXTENSION_CLASS}/0/system/uptime")
    );
    assert_eq!(
        topic::parse(&read, &address),
        Some(Request::Read {
            path: "/system/uptime".to_string()
        })
    );

    let under_ext = format!("R/{DEVICE}/ext/0/system/uptime");
    assert_eq!(
        topic::parse(&under_ext, &address),
        None,
        "a topic addressed to the namespace rather than the class was accepted as ours"
    );
}

/// A bus name that yields no class cannot be addressed, and no class is
/// invented for it.
///
/// `com.mos.ext` is in the extension namespace but names no service under it,
/// so there is no `<class>` segment to build `N/<deviceId>/<class>/...` from.
/// The bridge's gate is [`topic::class_of`] returning `None`: `runtime::run`
/// takes the class from it and fails startup on `None` before it opens either
/// connection. That call passes a `const SERVICE`, so the refusal cannot be
/// driven from a test without editing the constant — what is asserted here is
/// the value the refusal keys on, and that neither wrong answer is produced
/// in its place.
#[test]
fn a_bus_name_with_no_class_yields_no_address_and_no_invented_class() {
    let class = topic::class_of(EXTENSION_NAMESPACE);
    assert_eq!(
        class, None,
        "{EXTENSION_NAMESPACE} names no service, so the bridge must refuse it rather than \
         publish under a class it chose itself"
    );
    assert_ne!(
        class,
        Some("ext"),
        "the namespace was substituted for a class, which is the wrong-class defect \
         PLAN-011 D5 names, reached by the other route"
    );
    assert_ne!(
        class,
        Some(""),
        "an empty class segment would publish on N/<deviceId>//<instance>/<path>"
    );
}

// ---------------------------------------------------------------------------
// Reconnect backoff
// ---------------------------------------------------------------------------

/// The schedule itself: doubling from the floor, capped, and reset by any
/// successful poll.
#[test]
fn reconnect_backoff_doubles_to_a_ceiling_and_resets() {
    let mut backoff = ReconnectBackoff::default();
    let climb: Vec<u64> = (0..8).map(|_| backoff.next_delay().as_secs()).collect();
    assert_eq!(
        climb,
        vec![1, 2, 4, 8, 16, 30, 30, 30],
        "the delay must double from 1s and then hold at the 30s ceiling; a backoff that \
         keeps doubling eventually stops retrying a broker that is merely slow to come back"
    );

    backoff.reset();
    assert_eq!(
        backoff.next_delay(),
        Duration::from_secs(1),
        "a connection that worked must not inherit the penalty of the outage before it"
    );
}

/// The FIRST delay is what stops the spin, so it is asserted on its own: a
/// backoff whose floor drifted to zero is a backoff that does nothing, and
/// every other assertion in the test above still passes.
#[test]
fn the_first_reconnect_delay_is_not_zero() {
    let first = ReconnectBackoff::default().next_delay();
    assert!(
        first >= Duration::from_millis(500),
        "the first retry delay is {first:?}; a refused connection returns in microseconds, so \
         anything near zero is still a spin loop"
    );
}

/// The PREMISE the backoff exists for, held as a test against the real
/// upstream event loop.
///
/// `rumqttc::EventLoop::poll` reconnects with no delay of its own. This is
/// asserted rather than trusted, because the whole justification for the
/// backoff in `runtime.rs` is that upstream lacks one: if a future rumqttc
/// grows a reconnect delay, this test fails and says so at the exact place
/// the workaround is described, instead of leaving a second backoff stacked
/// silently on top of theirs.
///
/// Port 1 on loopback with nothing listening: `connect` returns ECONNREFUSED
/// immediately. No broker, no network, no skip.
#[tokio::test]
async fn rumqttc_reconnects_with_no_delay_of_its_own() {
    let mut options = MqttOptions::new("mos-mqttd-backoff-premise", "127.0.0.1", 1);
    options.set_keep_alive(Duration::from_secs(30));
    let (_client, mut eventloop) = AsyncClient::new(options, 8);

    let started = std::time::Instant::now();
    let mut refusals = 0;
    for _ in 0..5 {
        if eventloop.poll().await.is_err() {
            refusals += 1;
        }
    }
    let elapsed = started.elapsed();

    assert_eq!(
        refusals, 5,
        "nothing listens on 127.0.0.1:1, so every poll must fail; if they succeeded this \
         test is measuring something other than a refused connection"
    );
    assert!(
        elapsed < Duration::from_secs(1),
        "five refused reconnects took {elapsed:?}. rumqttc now delays between attempts, so \
         runtime.rs's ReconnectBackoff is stacked on top of an upstream backoff and should \
         be reconsidered -- see the RECONNECT_BACKOFF_MIN docs"
    );
}
