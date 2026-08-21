//! The `com.mos.Item1` item-tree façade (PLAN-011 M1, M2).
//!
//! Projects the settings tree and the live-state tree as one flat item tree
//! per `docs/design/bus.md`: `GetItems() -> a{sa{sv}}` and the coalesced
//! `ItemsChanged(a{sa{sv}})` signal on the service root [`ROOT_PATH`], plus
//! `GetValue`/`SetValue` on every item object path below it (§1.1).
//!
//! The façade owns no state: every mutation still flows through
//! [`MosdService`], the single writer — `SetValue` calls the very method
//! `SetSettings` calls, so the two write paths cannot diverge (§1.2). It
//! learns about changes through the service's change marker
//! ([`MosdService::subscribe_changes`]), re-projects both trees, and emits one
//! signal per accumulated batch of differences.

use std::collections::{BTreeMap, HashMap};

use mosd_settings::SettingsError;
use serde_json::Value as Json;
use tokio::sync::watch;
use zbus::fdo;
use zbus::object_server::{InterfaceRef, ObjectServer, SignalEmitter};
use zbus::zvariant::Value;

use crate::bus::MosdService;

/// Object path `GetItems` and `ItemsChanged` are served at: the service root
/// (`docs/design/bus.md` §1.1). Item object paths are absolute slash paths
/// under it, so the root itself is `/`.
pub const ROOT_PATH: &str = "/";

/// Key names whose value never appears on the bus, matched at any depth
/// (`docs/design/bus.md` §8). Structural on purpose: the `psk` fields sit
/// inside arrays the dot-path syntax cannot name.
const SECRET_KEYS: [&str; 4] = ["password_hash", "passwordHash", "psk", "hash"];

/// Settings subtrees a bus client may write, as dot-path prefixes: the
/// platform-config surface, which is exactly what a reconciler applies to the
/// running system.
///
/// A fixed list rather than the daemon's reconciler set, because a dry-run
/// daemon carries no reconcilers at all and its tree must still report the
/// writability a real one has. Everything else — `schema_version`, the
/// credential metadata, provisioning bookkeeping, and the whole live-state
/// tree — is read-only on the bus.
const WRITABLE_SUBTREES: [&str; 5] = [
    "hostname",
    "network",
    "wifi.client",
    "wifi.ap",
    "access.ssh",
];

/// `SetValue` succeeded (`docs/design/bus.md` §1.1).
const SET_OK: i32 = 0;
/// No item at that path — including a path redacted out of the tree (§8).
const SET_UNKNOWN_PATH: i32 = -1;
/// The item exists but is not writable: live state, or a settings subtree
/// outside [`WRITABLE_SUBTREES`].
const SET_READ_ONLY: i32 = -2;
/// The value does not fit the typed settings tree at that path.
const SET_INVALID_VALUE: i32 = -3;
/// The write validated but could not be persisted.
const SET_FAILED: i32 = -4;

/// Attribute dict of one item (`a{sv}`): `value`, `writable`, and optionally
/// `min`/`max`/`unit` — none of which the two trees carry cheaply today.
type ItemAttrs = HashMap<String, Value<'static>>;
/// The `a{sa{sv}}` body of `GetItems` and `ItemsChanged`: absolute slash
/// path -> attribute dict.
type Items = HashMap<String, ItemAttrs>;

/// One projected item: its (already redacted) value and whether a bus client
/// may write it.
#[derive(Debug, Clone, PartialEq)]
struct Leaf {
    value: Json,
    writable: bool,
}

/// The projected item map: absolute slash path -> leaf.
type Projection = BTreeMap<String, Leaf>;

/// The projection [`install`] registered item objects for, handed to [`run`]
/// as its starting point so no change between the two is missed.
pub struct Snapshot(Projection);

/// Strip every secret-named key, at any depth, including inside arrays.
///
/// The ONE redaction point of the façade: [`project`] runs every tree
/// through here before anything else looks at it, so neither `GetItems` nor
/// an `ItemsChanged` payload nor a `GetValue` reply can carry a secret value.
/// A redacted key is therefore not an item at all, which is also what makes
/// `SetValue` on one answer [`SET_UNKNOWN_PATH`].
fn redact(value: &mut Json) {
    match value {
        Json::Object(map) => {
            map.retain(|key, _| !SECRET_KEYS.contains(&key.as_str()));
            map.values_mut().for_each(redact);
        }
        Json::Array(items) => items.iter_mut().for_each(redact),
        _ => {}
    }
}

/// Flatten `value` into slash-path leaves under `prefix`.
///
/// Objects recurse; everything else — scalars, and whole arrays, which the
/// dot-path syntax cannot address into — is a leaf. JSON `null` is the
/// invalid value and projects as an absent key (`docs/design/bus.md` §3).
fn flatten(prefix: &str, value: &Json, out: &mut BTreeMap<String, Json>) {
    match value {
        Json::Object(map) => {
            for (key, child) in map {
                flatten(&format!("{prefix}/{key}"), child, out);
            }
        }
        Json::Null => {}
        leaf => {
            if !prefix.is_empty() {
                out.insert(prefix.to_string(), leaf.clone());
            }
        }
    }
}

/// The dot-path an absolute slash path addresses: strip the leading slash and
/// replace `/` with `.` (`docs/design/bus.md` §4). `None` for the root and for
/// anything that is not an absolute slash path.
fn dot_path(slash: &str) -> Option<String> {
    let rest = slash.strip_prefix('/')?;
    (!rest.is_empty()).then(|| rest.replace('/', "."))
}

/// Whether the settings item at dot-path `dot` is writable through the bus:
/// it is, or lies under, one of [`WRITABLE_SUBTREES`].
fn is_writable(dot: &str) -> bool {
    WRITABLE_SUBTREES.iter().any(|subtree| {
        dot == *subtree
            || dot
                .strip_prefix(subtree)
                .is_some_and(|rest| rest.starts_with('.'))
    })
}

/// Project both trees into one redacted flat item map. The settings tree is
/// projected first, the live-state tree second; they share no top-level key
/// today, and if they ever do the live-state leaf wins — and with it its
/// `writable = false`, so an aliased path is never writable by accident.
fn project(settings: &Json, state: &Json) -> Projection {
    let mut items = Projection::new();
    for (tree, from_settings) in [(settings, true), (state, false)] {
        let mut tree = tree.clone();
        redact(&mut tree);
        let mut leaves = BTreeMap::new();
        flatten("", &tree, &mut leaves);
        for (path, value) in leaves {
            let writable = from_settings && dot_path(&path).as_deref().is_some_and(is_writable);
            items.insert(path, Leaf { value, writable });
        }
    }
    items
}

/// Leaves that differ between two projections: an added or changed path maps
/// to its new leaf, a vanished path to `None` (the transition to invalid).
fn diff(prev: &Projection, cur: &Projection) -> BTreeMap<String, Option<Leaf>> {
    let mut out = BTreeMap::new();
    for (path, leaf) in cur {
        if prev.get(path) != Some(leaf) {
            out.insert(path.clone(), Some(leaf.clone()));
        }
    }
    for path in prev.keys() {
        if !cur.contains_key(path) {
            out.insert(path.clone(), None);
        }
    }
    out
}

/// Convert a projected JSON leaf into the D-Bus variant it travels as.
/// `None` only for `null`, which [`flatten`] never emits as a leaf.
fn to_variant(value: &Json) -> Option<Value<'static>> {
    match value {
        Json::Null => None,
        Json::Bool(flag) => Some(Value::from(*flag)),
        Json::Number(number) => {
            if let Some(int) = number.as_i64() {
                Some(Value::from(int))
            } else if let Some(uint) = number.as_u64() {
                Some(Value::from(uint))
            } else {
                number.as_f64().map(Value::from)
            }
        }
        Json::String(text) => Some(Value::from(text.clone())),
        Json::Array(items) => Some(Value::from(
            items.iter().filter_map(to_variant).collect::<Vec<_>>(),
        )),
        Json::Object(map) => Some(Value::from(
            map.iter()
                .filter_map(|(key, child)| to_variant(child).map(|child| (key.clone(), child)))
                .collect::<HashMap<_, _>>(),
        )),
    }
}

/// Convert an incoming `SetValue` variant into the JSON the settings tree is
/// written from.
///
/// `None` for the types the typed settings tree cannot hold — structures, file
/// descriptors, signatures, non-string dict keys, and non-finite doubles.
/// Refusing them here keeps the rejection a plain result code, which is the
/// only error channel `SetValue` has (`docs/design/bus.md` §3).
fn from_variant(value: &Value<'_>) -> Option<Json> {
    Some(match value {
        Value::Bool(flag) => Json::Bool(*flag),
        Value::U8(number) => Json::from(*number),
        Value::I16(number) => Json::from(*number),
        Value::U16(number) => Json::from(*number),
        Value::I32(number) => Json::from(*number),
        Value::U32(number) => Json::from(*number),
        Value::I64(number) => Json::from(*number),
        Value::U64(number) => Json::from(*number),
        Value::F64(number) => Json::Number(serde_json::Number::from_f64(*number)?),
        Value::Str(text) => Json::String(text.to_string()),
        Value::ObjectPath(path) => Json::String(path.to_string()),
        Value::Value(inner) => from_variant(inner)?,
        Value::Array(items) => Json::Array(items.iter().map(from_variant).collect::<Option<_>>()?),
        Value::Dict(entries) => Json::Object(
            entries
                .iter()
                .map(|(key, value)| match key {
                    Value::Str(key) => Some((key.to_string(), from_variant(value)?)),
                    _ => None,
                })
                .collect::<Option<_>>()?,
        ),
        _ => return None,
    })
}

/// The on-wire invalid marker: an empty `av` (`docs/design/bus.md` §3).
fn invalid_sentinel() -> Value<'static> {
    Value::from(Vec::<Value<'static>>::new())
}

/// Attribute dict for one item.
fn attrs(value: Value<'static>, writable: bool) -> ItemAttrs {
    HashMap::from([
        ("value".to_string(), value),
        ("writable".to_string(), Value::from(writable)),
    ])
}

/// The full `GetItems` body for a projection.
fn items_from(projection: &Projection) -> Items {
    projection
        .iter()
        .filter_map(|(path, leaf)| {
            to_variant(&leaf.value).map(|value| (path.clone(), attrs(value, leaf.writable)))
        })
        .collect()
}

/// The `ItemsChanged` body for a diff: vanished paths carry the invalid
/// sentinel so a subscriber sees the transition, and are reported read-only
/// because an item that is not there cannot be written.
fn items_from_diff(diff: BTreeMap<String, Option<Leaf>>) -> Items {
    diff.into_iter()
        .filter_map(|(path, leaf)| match leaf {
            Some(leaf) => to_variant(&leaf.value).map(|value| (path, attrs(value, leaf.writable))),
            None => Some((path, attrs(invalid_sentinel(), false))),
        })
        .collect()
}

/// The `SetValue` result code a rejected settings write reports
/// (`docs/design/bus.md` §1.1: negative on failure, positives reserved).
fn code_for(err: &SettingsError) -> i32 {
    match err {
        SettingsError::ReadOnly(_) => SET_READ_ONLY,
        SettingsError::NotFound(_) | SettingsError::Validation { .. } => SET_INVALID_VALUE,
        SettingsError::Io(_) | SettingsError::Parse(_) | SettingsError::Migration(_) => SET_FAILED,
    }
}

/// `SetValue` on the item at absolute slash `path`.
///
/// The façade's one write entry point. It decides writability against the
/// projection the reader sees — so an item that `GetItems` reports as
/// `writable` is exactly an item this accepts — and then hands the value to
/// [`MosdService::write_setting`], the same call `SetSettings` makes: the
/// value is validated against the typed schema, persisted through the store,
/// and the reconcilers owning the path are re-applied. Nothing here reconciles
/// or persists on its own.
///
/// A failed write changes nothing (`docs/design/bus.md` §3) and reports only
/// its code; the reason is logged locally and never travels back to the caller.
async fn set_item(service: &MosdService, path: &str, value: Json) -> i32 {
    let Some(dot) = dot_path(path) else {
        return SET_UNKNOWN_PATH;
    };
    let (settings, state) = service.trees().await;
    match project(&settings, &state).get(path) {
        None => {
            tracing::debug!(path, "SetValue on a path the item tree does not carry");
            SET_UNKNOWN_PATH
        }
        Some(leaf) if !leaf.writable => {
            tracing::debug!(path, "SetValue on a read-only item");
            SET_READ_ONLY
        }
        Some(_) => match service.write_setting(&dot, value).await {
            Ok(()) => SET_OK,
            Err(err) => {
                tracing::warn!(path, error = %err, "SetValue rejected");
                code_for(&err)
            }
        },
    }
}

/// The `com.mos.Item1` façade served at [`ROOT_PATH`]: the tree-wide members.
pub struct ItemTree {
    service: InterfaceRef<MosdService>,
}

impl ItemTree {
    pub fn new(service: InterfaceRef<MosdService>) -> Self {
        Self { service }
    }
}

/// Snapshot the service's two trees and project them, redacted.
async fn projection(service: &InterfaceRef<MosdService>) -> Projection {
    let service = service.get().await;
    let (settings, state) = service.trees().await;
    project(&settings, &state)
}

#[zbus::interface(name = "com.mos.Item1")]
impl ItemTree {
    /// Every currently valid item: absolute slash path -> attribute dict.
    async fn get_items(&self) -> fdo::Result<Items> {
        Ok(items_from(&projection(&self.service).await))
    }

    /// Emitted once per accumulated batch of tree changes: a burst of N item
    /// changes in one turn produces exactly one signal carrying N entries
    /// (`docs/design/bus.md` §1.1).
    #[zbus(signal)]
    async fn items_changed(emitter: &SignalEmitter<'_>, items: Items) -> zbus::Result<()>;
}

/// One item object: `com.mos.Item1`'s per-item members, served at the item's
/// own absolute slash path (`docs/design/bus.md` §1.1, §4).
///
/// Holds no value of its own. Both members resolve [`Item::path`] against the
/// live projection on every call, so an object that outlives its item — the
/// window between a leaf vanishing and [`run`] unregistering it — answers
/// exactly as an absent item must.
pub struct Item {
    service: InterfaceRef<MosdService>,
    /// This item's absolute slash path, which is also the object path it is
    /// served at.
    path: String,
}

impl Item {
    fn new(service: InterfaceRef<MosdService>, path: String) -> Self {
        Self { service, path }
    }
}

#[zbus::interface(name = "com.mos.Item1")]
impl Item {
    /// This item's current value, redacted like every other read, or the
    /// invalid sentinel when the tree does not carry it (`docs/design/bus.md`
    /// §3).
    async fn get_value(&self) -> Value<'static> {
        projection(&self.service)
            .await
            .get(&self.path)
            .and_then(|leaf| to_variant(&leaf.value))
            .unwrap_or_else(invalid_sentinel)
    }

    /// Write `value` to this item; `0` on success, a negative code on failure.
    async fn set_value(&self, value: Value<'_>) -> i32 {
        let Some(json) = from_variant(&value) else {
            tracing::debug!(
                path = self.path,
                "SetValue of a type the settings tree cannot hold"
            );
            return SET_INVALID_VALUE;
        };
        let service = self.service.get().await;
        set_item(&service, &self.path, json).await
    }
}

/// Register an item object for every path that appeared and drop the one for
/// every path that vanished, so the per-item members exist exactly where an
/// item does.
async fn sync_objects(
    server: &ObjectServer,
    service: &InterfaceRef<MosdService>,
    batch: &BTreeMap<String, Option<Leaf>>,
) {
    for (path, leaf) in batch {
        if leaf.is_some() {
            // A settings key can be any string, and most strings are not valid
            // D-Bus object path elements (`network.br-lan` is the realistic
            // case). Such an item still reads through `GetItems`; it just has
            // no object of its own, which is loud here and nowhere else.
            if let Err(err) = server
                .at(path.as_str(), Item::new(service.clone(), path.clone()))
                .await
            {
                tracing::warn!(path, error = %err, "no item object for this path");
            }
        } else if let Err(err) = server.remove::<Item, _>(path.as_str()).await {
            tracing::debug!(path, error = %err, "removing a vanished item object");
        }
    }
}

/// Register the item objects for the tree as it stands, and return that
/// projection for [`run`] to continue from.
///
/// Called before the well-known name is claimed, so a client that resolves the
/// service never finds an item it cannot write.
pub async fn install(
    tree: &InterfaceRef<ItemTree>,
    service: &InterfaceRef<MosdService>,
) -> Snapshot {
    let items = projection(service).await;
    let batch = items
        .iter()
        .map(|(path, leaf)| (path.clone(), Some(leaf.clone())))
        .collect();
    sync_objects(
        tree.signal_emitter().connection().object_server(),
        service,
        &batch,
    )
    .await;
    Snapshot(items)
}

/// Watch the service's change marker, keep the item objects in step with the
/// tree, and emit coalesced [`ItemsChanged`](ItemTree::items_changed) signals.
///
/// The watch channel collapses marks that arrive while a batch is being
/// projected into one wake, so N mutations in one turn flush as one signal,
/// never N. Runs until the service side of the channel is dropped.
pub async fn run(
    service: InterfaceRef<MosdService>,
    tree: InterfaceRef<ItemTree>,
    mut changes: watch::Receiver<u64>,
    snapshot: Snapshot,
) {
    let mut prev = snapshot.0;
    while changes.changed().await.is_ok() {
        // Let every mutation of the turn that woke us land, then clear the
        // marks it left: whatever the snapshot below captures is thereby
        // consumed, and anything later re-marks and re-wakes.
        tokio::task::yield_now().await;
        changes.mark_unchanged();
        let cur = projection(&service).await;
        let batch = diff(&prev, &cur);
        prev = cur;
        if batch.is_empty() {
            continue;
        }
        sync_objects(
            tree.signal_emitter().connection().object_server(),
            &service,
            &batch,
        )
        .await;
        if let Err(err) =
            ItemTree::items_changed(tree.signal_emitter(), items_from_diff(batch)).await
        {
            tracing::warn!(error = %err, "emit ItemsChanged failed");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    use mosd_settings::{Settings, Store};
    use serde_json::json;

    use super::*;
    use crate::power::MockPower;
    use crate::reconciler::Reconciler;

    /// A [`Leaf`] as the settings tree projects one.
    fn writable(value: Json) -> Leaf {
        Leaf {
            value,
            writable: true,
        }
    }

    /// A [`Leaf`] as the live-state tree projects one.
    fn read_only(value: Json) -> Leaf {
        Leaf {
            value,
            writable: false,
        }
    }

    /// Reconciler that applies nothing and records that it ran, so a test can
    /// assert which reconcilers a write scheduled without touching the host.
    struct MockReconciler {
        name: &'static str,
        subtree: &'static str,
        runs: Arc<Mutex<Vec<String>>>,
    }

    #[async_trait::async_trait]
    impl Reconciler for MockReconciler {
        fn name(&self) -> &'static str {
            self.name
        }

        fn subtree(&self) -> &'static str {
            self.subtree
        }

        async fn apply(&self, _settings: &Settings) -> anyhow::Result<Json> {
            self.runs.lock().expect("mock lock").push(self.name.into());
            Ok(json!({ "applied": true }))
        }
    }

    /// A service over a throwaway store, the five real reconciler subtrees
    /// behind mocks, and the shared run log; the settings file does not exist
    /// until something persists to it.
    fn service_with_mocks(
        state: Json,
    ) -> (
        MosdService,
        Arc<Mutex<Vec<String>>>,
        PathBuf,
        tempfile::TempDir,
    ) {
        let dir = tempfile::tempdir().expect("tempdir");
        let settings_path = dir.path().join("settings.toml");
        let runs = Arc::new(Mutex::new(Vec::new()));
        let reconcilers: Vec<Box<dyn Reconciler>> = [
            ("hostname", "hostname"),
            ("network", "network"),
            ("wifiClient", "wifi.client"),
            ("wifiAp", "wifi"),
            ("sshd", "access.ssh"),
        ]
        .into_iter()
        .map(|(name, subtree)| {
            Box::new(MockReconciler {
                name,
                subtree,
                runs: Arc::clone(&runs),
            }) as Box<dyn Reconciler>
        })
        .collect();
        let service = MosdService::new(
            Store::new(&settings_path),
            Settings::default(),
            reconcilers,
            Box::new(MockPower {
                calls: Arc::new(Mutex::new(Vec::new())),
            }),
            dir.path().join("shadow"),
            state,
        );
        (service, runs, settings_path, dir)
    }

    #[test]
    fn redaction_strips_secret_keys_at_any_depth() {
        let mut tree = json!({
            "access": {
                "webAdmin": { "password_hash": "web-secret" },
                "device": { "passwordHash": "device-secret", "generation": 3 },
            },
            "wifi": {
                "ap": { "psk": "ap-secret", "channel": 6 },
                "client": { "networks": [
                    { "ssid": "home", "psk": "client-secret", "priority": 1 },
                ]},
            },
            "update": { "hash": "digest-secret" },
        });
        redact(&mut tree);
        let text = tree.to_string();
        for secret in [
            "web-secret",
            "device-secret",
            "ap-secret",
            "client-secret",
            "digest-secret",
        ] {
            assert!(!text.contains(secret), "secret survived redaction: {text}");
        }
        assert_eq!(tree["access"]["device"]["generation"], 3);
        assert_eq!(tree["wifi"]["ap"]["channel"], 6);
        assert_eq!(tree["wifi"]["client"]["networks"][0]["ssid"], "home");
    }

    #[test]
    fn flatten_produces_absolute_slash_paths_with_arrays_as_leaves() {
        let tree = json!({
            "hostname": "mos",
            "network": { "eth0": { "dhcp": true, "static": null } },
            "dns": ["1.1.1.1", "9.9.9.9"],
        });
        let mut out = BTreeMap::new();
        flatten("", &tree, &mut out);
        assert_eq!(out.get("/hostname"), Some(&json!("mos")));
        assert_eq!(out.get("/network/eth0/dhcp"), Some(&json!(true)));
        assert_eq!(out.get("/dns"), Some(&json!(["1.1.1.1", "9.9.9.9"])));
        assert!(
            !out.contains_key("/network/eth0/static"),
            "null is invalid and must project as an absent key"
        );
        assert_eq!(out.len(), 3);
    }

    #[test]
    fn diff_reports_added_changed_and_vanished_paths() {
        let prev = Projection::from([
            ("/hostname".to_string(), writable(json!("mos"))),
            ("/gone".to_string(), read_only(json!(1))),
            ("/same".to_string(), read_only(json!("kept"))),
        ]);
        let cur = Projection::from([
            ("/hostname".to_string(), writable(json!("edge"))),
            ("/new".to_string(), read_only(json!(2))),
            ("/same".to_string(), read_only(json!("kept"))),
        ]);

        let batch = diff(&prev, &cur);
        assert_eq!(batch.get("/hostname"), Some(&Some(writable(json!("edge")))));
        assert_eq!(batch.get("/new"), Some(&Some(read_only(json!(2)))));
        assert_eq!(batch.get("/gone"), Some(&None));
        assert!(!batch.contains_key("/same"));
    }

    #[test]
    fn the_invalid_sentinel_is_an_empty_variant_array() {
        let sentinel = invalid_sentinel();
        assert_eq!(sentinel.value_signature().to_string(), "av");
    }

    #[test]
    fn only_platform_config_settings_are_writable() {
        for dot in [
            "hostname",
            "network",
            "network.eth0.dhcp",
            "wifi.client.networks",
            "wifi.ap.channel",
            "access.ssh.enabled",
            "access.ssh.authorizedKeys",
        ] {
            assert!(is_writable(dot), "{dot} must be writable");
        }
        for dot in [
            "schema_version",
            "access",
            "access.device.generation",
            "access.console.shellEnabled",
            "provisioning.deviceId",
            "wifi",
            // A prefix match must be segment-wise, not textual.
            "network2.dhcp",
            "hostnamed",
        ] {
            assert!(!is_writable(dot), "{dot} must not be writable");
        }
    }

    #[test]
    fn the_projection_marks_platform_config_writable_and_live_state_not() {
        let settings = json!({
            "hostname": "mos",
            "schema_version": 4,
            "wifi": { "ap": { "channel": 6 } },
        });
        let state = json!({ "dry_run": true });
        let items = project(&settings, &state);
        assert!(items["/hostname"].writable);
        assert!(items["/wifi/ap/channel"].writable);
        assert!(!items["/schema_version"].writable);
        assert!(!items["/dry_run"].writable);
    }

    #[test]
    fn variants_convert_back_to_the_json_the_settings_tree_is_written_from() {
        assert_eq!(from_variant(&Value::from("edge")), Some(json!("edge")));
        assert_eq!(from_variant(&Value::from(true)), Some(json!(true)));
        assert_eq!(from_variant(&Value::from(6u8)), Some(json!(6)));
        // A nested variant is transparent: this is what a client sends when it
        // wraps the value it means.
        assert_eq!(
            from_variant(&Value::Value(Box::new(Value::from(22u16)))),
            Some(json!(22))
        );
        assert_eq!(
            from_variant(&Value::from(vec![Value::from("1.1.1.1")])),
            Some(json!(["1.1.1.1"]))
        );
        // Types the typed tree cannot hold are refused, not guessed at.
        assert_eq!(from_variant(&Value::from((1i32, 2i32))), None);
    }

    #[tokio::test]
    async fn a_set_value_persists_and_schedules_only_the_owning_reconciler() {
        let (service, runs, settings_path, _dir) = service_with_mocks(json!({}));

        assert_eq!(
            set_item(&service, "/hostname", json!("edge-01")).await,
            SET_OK
        );

        // Persisted through the store: a fresh reader sees the new value.
        let reloaded = Store::new(&settings_path).load().expect("reload");
        assert_eq!(reloaded.hostname, "edge-01");
        // And exactly the reconciler that owns the path was scheduled.
        assert_eq!(*runs.lock().expect("lock"), vec!["hostname".to_string()]);

        // A subtree write reaches the reconcilers whose subtree overlaps it,
        // and no others — the same rule `SetSettings` applies.
        runs.lock().expect("lock").clear();
        assert_eq!(
            set_item(&service, "/wifi/ap/channel", json!(11)).await,
            SET_OK
        );
        assert_eq!(
            *runs.lock().expect("lock"),
            vec!["wifiAp".to_string()],
            "wifi.ap belongs to the AP reconciler alone"
        );
        assert_eq!(
            Store::new(&settings_path)
                .load()
                .expect("reload")
                .wifi
                .ap
                .channel,
            11
        );
    }

    #[tokio::test]
    async fn set_value_on_a_read_only_item_or_an_unknown_path_changes_nothing() {
        let (service, runs, settings_path, _dir) = service_with_mocks(json!({ "dry_run": true }));
        let before = service.trees().await;

        // A live-state item: it is in the tree, and it is not a setting.
        assert_eq!(
            set_item(&service, "/dry_run", json!(false)).await,
            SET_READ_ONLY
        );
        // A settings item outside every writable subtree.
        assert_eq!(
            set_item(&service, "/schema_version", json!(9)).await,
            SET_READ_ONLY
        );
        // Paths the tree does not carry: absent, redacted, and the root.
        assert_eq!(
            set_item(&service, "/no/such/path", json!(1)).await,
            SET_UNKNOWN_PATH
        );
        assert_eq!(
            set_item(&service, "/wifi/ap/psk", json!("hunter2")).await,
            SET_UNKNOWN_PATH,
            "a redacted key is not an item, so it cannot be written either"
        );
        assert_eq!(set_item(&service, "/", json!(1)).await, SET_UNKNOWN_PATH);

        // A writable path whose value does not fit the typed schema.
        assert_eq!(
            set_item(&service, "/hostname", json!(7)).await,
            SET_INVALID_VALUE
        );

        assert_eq!(
            service.trees().await,
            before,
            "a rejected SetValue must leave the tree exactly as it was"
        );
        assert!(
            runs.lock().expect("lock").is_empty(),
            "a rejected SetValue must schedule no reconciler"
        );
        assert!(
            !settings_path.exists(),
            "a rejected SetValue must persist nothing at all"
        );
    }
}
