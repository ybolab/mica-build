//! The `com.mos.Item1` item-tree façade.
//!
//! Projects the settings tree and the live-state tree as one flat item tree per
//! `docs/design/bus.md`: `GetItems() -> a{sa{sv}}` and the coalesced
//! `ItemsChanged(a{sa{sv}})` signal on the service root [`ROOT_PATH`], plus
//! `GetValue`/`SetValue` on every item object path below it (§1.1). The façade
//! owns no state: every mutation flows through [`MosdService`], the single
//! writer — `SetValue` calls the very method `SetSettings` calls, so the two
//! write paths cannot diverge (§1.2). It learns about changes through
//! [`MosdService::subscribe_changes`], re-projects both trees, and emits one
//! signal per accumulated batch of differences.
//!
//! The one thing it projects that neither tree carries is the `/Actions/<verb>`
//! items (§7): constant-`0` items whose write triggers something instead of
//! storing anything, being [`crate::actions`]' verbs dispatched through the
//! same request paths `Reboot` and `PowerOff` use.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use mosd_settings::SettingsError;
use serde_json::Value as Json;
use tokio::sync::watch;
use zbus::fdo;
use zbus::message::Header;
use zbus::object_server::{InterfaceRef, ObjectServer, SignalEmitter};
use zbus::zvariant::{ObjectPath, Value};

use crate::actions::{Action, Actions};
use crate::bus::{MosdService, sender_of};

/// Object path `GetItems` and `ItemsChanged` are served at: the service root
/// (`docs/design/bus.md` §1.1). Item object paths are absolute slash paths
/// under it, so the root itself is `/`.
pub const ROOT_PATH: &str = "/";

/// Key names whose value never appears on the bus, matched at any depth
/// (`docs/design/bus.md` §8). Structural on purpose: the `psk` fields sit
/// inside arrays the dot-path syntax cannot name.
const SECRET_KEYS: [&str; 4] = ["password_hash", "passwordHash", "psk", "hash"];

/// Settings subtrees a bus client may write, as dot-path prefixes. NOT an
/// access boundary: `SetSettings` writes any path without consulting it, and
/// the bus policy grants that member to root alone. What this list bounds is
/// `SetValue`, the one write member the MQTT bridge holds
/// (`os/pkgs/mosd/dist/mos-mqttd.conf`) — so it is the REMOTE write surface.
/// Hence the class rule for platform switches (`docs/design/bus.md` §11.6): a
/// switch belongs here only if a broker client may flip it, which `container`
/// and `mqtt` may not, nor `schema_version`, the credential metadata,
/// provisioning or live state. A fixed list, because dry-run has no reconcilers.
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
/// A settings write that validated and then would not persist. The write did
/// not take effect anywhere, so retrying it is safe.
const SET_NOT_PERSISTED: i32 = -4;
/// An action that was accepted and then would not dispatch. NOT the same
/// failure as [`SET_NOT_PERSISTED`], and the difference is the caller's retry
/// policy: the request path logs the request and records it in live state
/// BEFORE the power call, so a request that failed to dispatch still exists in
/// live state. A caller that cannot tell the two apart cannot decide whether
/// re-sending a reboot is safe (`docs/design/mosd.md` §5.3: outcomes are
/// named, never merged).
const SET_NOT_DISPATCHED: i32 = -5;

/// Attribute dict of one item (`a{sv}`): `value`, `writable`, and optionally
/// `min`/`max`/`unit` — none of which the two trees carry cheaply today.
type ItemAttrs = HashMap<String, Value<'static>>;
/// The `a{sa{sv}}` body of `GetItems` and `ItemsChanged`: absolute slash
/// path -> attribute dict.
type Items = HashMap<String, ItemAttrs>;

/// What a bus client may do with an item — and, when it may write, through
/// which path the write goes.
///
/// Actions are their own case on purpose (`docs/design/bus.md` §7): they are
/// writable, but writing one dispatches something rather than storing a value,
/// so an action is deliberately NOT an entry in [`WRITABLE_SUBTREES`] and the
/// two never have to agree.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Access {
    /// The whole live-state tree, and every settings leaf outside
    /// [`WRITABLE_SUBTREES`].
    ReadOnly,
    /// A settings leaf, written through [`MosdService::write_setting`].
    Setting,
    /// An action item, dispatched through [`Actions::trigger`].
    Action(Action),
}

impl Access {
    /// The `writable` attribute this access reports in `GetItems`: an action
    /// is writable even though nothing it is written is ever stored.
    const fn writable(self) -> bool {
        !matches!(self, Self::ReadOnly)
    }
}

/// One projected item: its (already redacted) value and what a bus client may
/// do with it.
#[derive(Debug, Clone, PartialEq)]
struct Leaf {
    value: Json,
    access: Access,
}

/// The projected item map: absolute slash path -> leaf.
type Projection = BTreeMap<String, Leaf>;

/// What [`install`] set up, handed to [`run`] so it continues from exactly
/// that state and no change between the two is missed: the projection the
/// item objects were registered for, and the action registry those objects
/// dispatch into.
pub struct Snapshot {
    items: Projection,
    actions: Arc<Actions>,
}

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

/// The leaf an action item always projects as: the constant `0`, writable,
/// and not a setting (`docs/design/bus.md` §7).
fn action_leaf(action: Action) -> Leaf {
    Leaf {
        value: Json::from(crate::actions::IDLE),
        access: Access::Action(action),
    }
}

/// Project both trees into one redacted flat item map, then the action items
/// over the top.
///
/// The settings tree is projected first, the live-state tree second; they
/// share no top-level key today, and if they ever do the live-state leaf wins
/// — and with it its [`Access::ReadOnly`], so an aliased path is never
/// writable by accident. The action items go last for the same reason in
/// reverse: `/Actions/<verb>` is this daemon's to define, so a settings or
/// state key that collided with one would be shadowed rather than turn an
/// action into something else.
fn project(settings: &Json, state: &Json) -> Projection {
    let mut items = Projection::new();
    for (tree, from_settings) in [(settings, true), (state, false)] {
        let mut tree = tree.clone();
        redact(&mut tree);
        let mut leaves = BTreeMap::new();
        flatten("", &tree, &mut leaves);
        for (path, value) in leaves {
            let access = if from_settings && dot_path(&path).as_deref().is_some_and(is_writable) {
                Access::Setting
            } else {
                Access::ReadOnly
            };
            items.insert(path, Leaf { value, access });
        }
    }
    for action in Action::ALL {
        items.insert(action.path().to_string(), action_leaf(action));
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
            to_variant(&leaf.value)
                .map(|value| (path.clone(), attrs(value, leaf.access.writable())))
        })
        .collect()
}

/// The `ItemsChanged` body for a diff: vanished paths carry the invalid
/// sentinel so a subscriber sees the transition, and are reported read-only
/// because an item that is not there cannot be written.
fn items_from_diff(diff: BTreeMap<String, Option<Leaf>>) -> Items {
    diff.into_iter()
        .filter_map(|(path, leaf)| match leaf {
            Some(leaf) => {
                to_variant(&leaf.value).map(|value| (path, attrs(value, leaf.access.writable())))
            }
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
        SettingsError::Io(_) | SettingsError::Parse(_) | SettingsError::Migration(_) => {
            SET_NOT_PERSISTED
        }
    }
}

/// `SetValue` on the item at absolute slash `path`, on behalf of `sender`.
///
/// The façade's one write entry point, and where the two kinds of writable item
/// part ways — decided against the projection the reader sees, so an item
/// `GetItems` reports as `writable` is exactly an item this accepts. A setting
/// goes to [`MosdService::write_setting`], the same call `SetSettings` makes:
/// validated against the typed schema, persisted through the store, and the
/// reconcilers owning the path re-applied. An action goes to
/// [`Actions::trigger`], dispatched through the `MosdService` request path that
/// logs it and records it in live state before the power call, storing nothing;
/// `value` is ignored, the write itself being the trigger (`docs/design/bus.md`
/// §7). A failed write changes nothing (§3) and reports only its code, the
/// reason being logged locally and never travelling back to the caller:
/// [`SET_NOT_PERSISTED`] for a settings write that did not take effect,
/// [`SET_NOT_DISPATCHED`] for an action recorded before its dispatch failed.
async fn set_item(
    service: &MosdService,
    actions: &Actions,
    sender: &str,
    path: &str,
    value: Json,
) -> i32 {
    let Some(dot) = dot_path(path) else {
        return SET_UNKNOWN_PATH;
    };
    let (settings, state) = service.trees().await;
    let Some(leaf) = project(&settings, &state).get(path).cloned() else {
        tracing::debug!(path, "SetValue on a path the item tree does not carry");
        return SET_UNKNOWN_PATH;
    };
    match leaf.access {
        Access::ReadOnly => {
            tracing::debug!(path, "SetValue on a read-only item");
            SET_READ_ONLY
        }
        Access::Action(action) => match actions.trigger(service, action, sender).await {
            Ok(()) => SET_OK,
            Err(err) => {
                tracing::error!(path, error = %err, "SetValue could not dispatch the action");
                SET_NOT_DISPATCHED
            }
        },
        Access::Setting => match service.write_setting(&dot, value).await {
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
    /// Shared with [`run`], which drains the consumption edges a trigger
    /// through this object leaves pending.
    actions: Arc<Actions>,
    /// This item's absolute slash path, which is also the object path it is
    /// served at.
    path: String,
}

impl Item {
    fn new(service: InterfaceRef<MosdService>, actions: Arc<Actions>, path: String) -> Self {
        Self {
            service,
            actions,
            path,
        }
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
    ///
    /// On an action item the code is the dispatch result rather than a write
    /// result (`docs/design/bus.md` §7), and the header is what attributes the
    /// request: a power action triggered here is logged and recorded under the
    /// same caller name as one called through `Reboot`/`PowerOff`.
    async fn set_value(&self, #[zbus(header)] header: Header<'_>, value: Value<'_>) -> i32 {
        let Some(json) = from_variant(&value) else {
            tracing::debug!(
                path = self.path,
                "SetValue of a type the settings tree cannot hold"
            );
            return SET_INVALID_VALUE;
        };
        let service = self.service.get().await;
        set_item(
            &service,
            &self.actions,
            sender_of(&header),
            &self.path,
            json,
        )
        .await
    }
}

/// Register an item object for every path that appeared and drop the one for
/// every path that vanished, so the per-item members exist exactly where an
/// item does.
async fn sync_objects(
    server: &ObjectServer,
    service: &InterfaceRef<MosdService>,
    actions: &Arc<Actions>,
    batch: &BTreeMap<String, Option<Leaf>>,
) {
    for (path, leaf) in batch {
        if leaf.is_some() {
            // A settings key can be any string, and most strings are not valid
            // D-Bus object path elements — `network.br-lan`, and every bus
            // name in the service registry (`docs/design/bus.md` §11 item 2).
            // Such an item still reads through `GetItems`; it just has no
            // object of its own. That is the expected, per-boot-normal case,
            // so it logs at DEBUG; a path that IS a valid object path and
            // still fails to register is a real fault and keeps its WARN.
            if ObjectPath::try_from(path.as_str()).is_err() {
                tracing::debug!(
                    path,
                    "key is not a valid D-Bus path element; the item reads through GetItems without an object of its own"
                );
            } else if let Err(err) = server
                .at(
                    path.as_str(),
                    Item::new(service.clone(), Arc::clone(actions), path.clone()),
                )
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
    let actions = Arc::new(Actions::new());
    let batch = items
        .iter()
        .map(|(path, leaf)| (path.clone(), Some(leaf.clone())))
        .collect();
    sync_objects(
        tree.signal_emitter().connection().object_server(),
        service,
        &actions,
        &batch,
    )
    .await;
    Snapshot { items, actions }
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
    let Snapshot {
        items: mut prev,
        actions,
    } = snapshot;
    while changes.changed().await.is_ok() {
        // Let every mutation of the turn that woke us land, then clear the
        // marks it left: whatever the snapshot below captures is thereby
        // consumed, and anything later re-marks and re-wakes.
        tokio::task::yield_now().await;
        changes.mark_unchanged();
        let cur = projection(&service).await;
        let mut batch = diff(&prev, &cur);
        prev = cur;
        // The forced re-zero (`docs/design/bus.md` §7). An action item's value
        // is the constant `0`, so no diff of two projections can ever carry
        // one; the `0 -> 0` edge that makes a trigger's consumption
        // observable is therefore injected here, into the same coalesced
        // payload as whatever else the turn changed.
        for action in actions.take_triggered() {
            batch.insert(action.path().to_string(), Some(action_leaf(action)));
        }
        if batch.is_empty() {
            continue;
        }
        sync_objects(
            tree.signal_emitter().connection().object_server(),
            &service,
            &actions,
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
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex, Weak};

    use mosd_settings::{Settings, Store};
    use serde_json::json;

    use super::*;
    use crate::power::{MockPower, PowerControl};
    use crate::reconciler::Reconciler;

    /// A [`Leaf`] as a writable settings item projects one.
    fn writable(value: Json) -> Leaf {
        Leaf {
            value,
            access: Access::Setting,
        }
    }

    /// A [`Leaf`] as the live-state tree projects one.
    fn read_only(value: Json) -> Leaf {
        Leaf {
            value,
            access: Access::ReadOnly,
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
    ///
    /// `power` is a parameter so an action test can substitute a control that
    /// observes what had already happened when it was called.
    fn service_with(
        power: Box<dyn PowerControl>,
        state: Json,
    ) -> (
        MosdService,
        Arc<Mutex<Vec<String>>>,
        PathBuf,
        tempfile::TempDir,
    ) {
        let dir = tempfile::tempdir().expect("tempdir");
        let settings_path = dir.path().join("settings.toml");
        let (service, runs) = service_storing_at(power, state, &settings_path, dir.path());
        (service, runs, settings_path, dir)
    }

    /// [`service_with`] with the store's path chosen by the caller, because
    /// whether a write can persist at all is a property of that path.
    fn service_storing_at(
        power: Box<dyn PowerControl>,
        state: Json,
        settings_path: &Path,
        dir: &Path,
    ) -> (MosdService, Arc<Mutex<Vec<String>>>) {
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
            Store::new(settings_path),
            Settings::default(),
            reconcilers,
            power,
            dir.join("shadow"),
            state,
        );
        (service, runs)
    }

    /// [`service_with`] over a power control that only records the call.
    fn service_with_mocks(
        state: Json,
    ) -> (
        MosdService,
        Arc<Mutex<Vec<String>>>,
        PathBuf,
        tempfile::TempDir,
    ) {
        service_with(
            Box::new(MockPower {
                calls: Arc::new(Mutex::new(Vec::new())),
            }),
            state,
        )
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
        assert_eq!(items["/hostname"].access, Access::Setting);
        assert_eq!(items["/wifi/ap/channel"].access, Access::Setting);
        assert_eq!(items["/schema_version"].access, Access::ReadOnly);
        assert_eq!(items["/dry_run"].access, Access::ReadOnly);
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

        let actions = Actions::new();
        assert_eq!(
            set_item(&service, &actions, ":1.2", "/hostname", json!("edge-01")).await,
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
            set_item(&service, &actions, ":1.2", "/wifi/ap/channel", json!(11)).await,
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
        let actions = Actions::new();
        assert_eq!(
            set_item(&service, &actions, ":1.3", "/dry_run", json!(false)).await,
            SET_READ_ONLY
        );
        // A settings item outside every writable subtree.
        assert_eq!(
            set_item(&service, &actions, ":1.3", "/schema_version", json!(9)).await,
            SET_READ_ONLY
        );
        // Paths the tree does not carry: absent, redacted, an unknown verb
        // under the actions prefix, and the root.
        assert_eq!(
            set_item(&service, &actions, ":1.3", "/no/such/path", json!(1)).await,
            SET_UNKNOWN_PATH
        );
        assert_eq!(
            set_item(&service, &actions, ":1.3", "/wifi/ap/psk", json!("hunter2")).await,
            SET_UNKNOWN_PATH,
            "a redacted key is not an item, so it cannot be written either"
        );
        assert_eq!(
            set_item(
                &service,
                &actions,
                ":1.3",
                "/Actions/selfdestruct",
                json!(1)
            )
            .await,
            SET_UNKNOWN_PATH,
            "the actions prefix is not a wildcard: only the verbs exist"
        );
        assert_eq!(
            set_item(&service, &actions, ":1.3", "/", json!(1)).await,
            SET_UNKNOWN_PATH
        );

        // A writable path whose value does not fit the typed schema.
        assert_eq!(
            set_item(&service, &actions, ":1.3", "/hostname", json!(7)).await,
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
        assert!(
            actions.take_triggered().is_empty(),
            "nothing above was an action, so no consumption edge may be pending"
        );
    }

    /// Power control that snapshots the daemon's live-state tree at the moment
    /// it is called, so a test can assert what had ALREADY happened by then.
    ///
    /// The handle back to the service is weak and filled in after the fact:
    /// the control is constructed first (the service takes it by value), and a
    /// strong handle here would be a reference cycle.
    struct OrderingPower {
        calls: Arc<Mutex<Vec<String>>>,
        service: Arc<Mutex<Option<Weak<MosdService>>>>,
        /// The live-state tree as each call found it, one entry per call.
        seen: Arc<Mutex<Vec<Json>>>,
    }

    impl OrderingPower {
        async fn record(&self, member: &str) {
            let service = self
                .service
                .lock()
                .expect("ordering lock")
                .clone()
                .and_then(|service| service.upgrade());
            let state = match service {
                Some(service) => service.trees().await.1,
                None => Json::Null,
            };
            self.seen.lock().expect("ordering lock").push(state);
            self.calls
                .lock()
                .expect("ordering lock")
                .push(member.to_string());
        }
    }

    #[async_trait::async_trait]
    impl PowerControl for OrderingPower {
        async fn reboot(&self) -> anyhow::Result<()> {
            self.record("reboot").await;
            Ok(())
        }

        async fn power_off(&self) -> anyhow::Result<()> {
            self.record("power_off").await;
            Ok(())
        }
    }

    /// Power control that refuses every request, so a test can reach the
    /// dispatch-failure branch without a host that will not reboot.
    struct RefusingPower;

    #[async_trait::async_trait]
    impl PowerControl for RefusingPower {
        async fn reboot(&self) -> anyhow::Result<()> {
            anyhow::bail!("mock: reboot refused")
        }

        async fn power_off(&self) -> anyhow::Result<()> {
            anyhow::bail!("mock: power_off refused")
        }
    }

    /// A service whose power control observes the live-state tree at call
    /// time, plus everything the test needs to read back afterwards.
    struct Ordering {
        service: Arc<MosdService>,
        calls: Arc<Mutex<Vec<String>>>,
        seen: Arc<Mutex<Vec<Json>>>,
        runs: Arc<Mutex<Vec<String>>>,
        settings_path: PathBuf,
        _dir: tempfile::TempDir,
    }

    impl Ordering {
        fn new() -> Self {
            let calls = Arc::new(Mutex::new(Vec::new()));
            let seen = Arc::new(Mutex::new(Vec::new()));
            let slot = Arc::new(Mutex::new(None));
            let (service, runs, settings_path, dir) = service_with(
                Box::new(OrderingPower {
                    calls: Arc::clone(&calls),
                    service: Arc::clone(&slot),
                    seen: Arc::clone(&seen),
                }),
                json!({}),
            );
            let service = Arc::new(service);
            *slot.lock().expect("ordering lock") = Some(Arc::downgrade(&service));
            Self {
                service,
                calls,
                seen,
                runs,
                settings_path,
                _dir: dir,
            }
        }

        /// The power members called so far, in order. Cloned rather than
        /// borrowed, so no lock is held across the awaits that follow.
        fn calls(&self) -> Vec<String> {
            self.calls.lock().expect("ordering lock").clone()
        }

        /// The live-state tree as each of those calls found it.
        fn seen(&self) -> Vec<Json> {
            self.seen.lock().expect("ordering lock").clone()
        }
    }

    #[test]
    fn the_action_items_are_writable_constant_zeroes_that_are_not_settings() {
        let items = project(&json!({ "hostname": "mos" }), &json!({ "dry_run": true }));
        for action in Action::ALL {
            let leaf = &items[action.path()];
            assert_eq!(leaf.value, json!(0), "{} must read 0", action.path());
            assert_eq!(leaf.access, Access::Action(action));
            assert!(leaf.access.writable(), "{} must be writable", action.path());
        }
        // The writability of an action owes nothing to the settings list: no
        // action path is, or lies under, a writable settings subtree.
        for action in Action::ALL {
            let dot = dot_path(action.path()).expect("an action path is a slash path");
            assert!(!is_writable(&dot), "{dot} must not be a writable SETTING");
        }
    }

    #[tokio::test]
    async fn an_action_dispatches_once_after_the_request_was_already_recorded() {
        let fixture = Ordering::new();
        let service = &fixture.service;
        let actions = Actions::new();

        let (settings, state) = service.trees().await;
        assert_eq!(
            project(&settings, &state)["/Actions/reboot"].value,
            json!(0)
        );

        assert_eq!(
            set_item(service, &actions, ":1.4", "/Actions/reboot", json!(1)).await,
            SET_OK,
            "an accepted action reports the dispatch result, which is 0 (§7)"
        );

        // (a) The power control was reached EXACTLY once.
        assert_eq!(fixture.calls(), vec!["reboot".to_string()]);
        // (c) ... and by the time it was, the request had already been logged
        // and recorded: `note_power_request` writes this record immediately
        // after the log line and before the power call, so the record being
        // visible here is that ordering.
        let seen = fixture.seen();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0]["power"]["last_action"], "reboot");
        assert_eq!(
            seen[0]["power"]["requested_by"], ":1.4",
            "the bus caller must be attributed, exactly as `Reboot` attributes it"
        );

        // (b) The item still reads 0: an action never holds a value.
        let (settings, state) = service.trees().await;
        assert_eq!(
            project(&settings, &state)["/Actions/reboot"].value,
            json!(0)
        );

        // (d) The forced re-zero is pending for the next coalesced payload —
        // the only way a constant item can appear in one at all — and exactly
        // once.
        assert_eq!(actions.take_triggered(), vec![Action::Reboot]);
        assert!(
            actions.take_triggered().is_empty(),
            "the consumption edge is emitted once, not on every turn after"
        );

        // An action is not a settings write: nothing persisted, nothing
        // reconciled.
        assert!(fixture.runs.lock().expect("lock").is_empty());
        assert!(!fixture.settings_path.exists());
    }

    #[tokio::test]
    async fn each_verb_dispatches_its_own_power_request() {
        let fixture = Ordering::new();
        let service = &fixture.service;
        let actions = Actions::new();

        assert_eq!(
            set_item(service, &actions, ":1.5", "/Actions/poweroff", json!(0)).await,
            SET_OK,
            "the value written to an action is ignored: the write is the trigger"
        );
        assert_eq!(
            fixture.calls(),
            vec!["power_off".to_string()],
            "/Actions/poweroff must not reach the reboot path"
        );
        assert_eq!(fixture.seen()[0]["power"]["last_action"], "power_off");
        assert_eq!(actions.take_triggered(), vec![Action::PowerOff]);

        assert_eq!(
            set_item(service, &actions, ":1.5", "/Actions/reboot", json!(true)).await,
            SET_OK
        );
        assert_eq!(
            fixture.calls(),
            vec!["power_off".to_string(), "reboot".to_string()]
        );
        assert_eq!(actions.take_triggered(), vec![Action::Reboot]);
    }

    #[tokio::test]
    async fn a_dispatch_failure_and_a_persist_failure_report_different_codes() {
        // The vocabulary itself, asserted where it is defined: these two codes
        // are the wire contract (`docs/design/bus.md` §1.1) and the point of
        // the pair is that they are not each other.
        assert_eq!(SET_NOT_PERSISTED, -4);
        assert_eq!(SET_NOT_DISPATCHED, -5);
        assert_ne!(SET_NOT_PERSISTED, SET_NOT_DISPATCHED);

        // (1) An action that would not dispatch. Everything about the write is
        // fine — the path is an action item, the value is ignored — and only
        // the power call fails.
        let dir = tempfile::tempdir().expect("tempdir");
        let settings_path = dir.path().join("settings.toml");
        let (service, runs) = service_storing_at(
            Box::new(RefusingPower),
            json!({}),
            &settings_path,
            dir.path(),
        );
        let actions = Actions::new();
        assert_eq!(
            set_item(&service, &actions, ":1.6", "/Actions/reboot", json!(1)).await,
            SET_NOT_DISPATCHED,
            "an action that would not dispatch must not report the persist code"
        );
        // Which is exactly why it needs its own code: the request path logged
        // and recorded the request BEFORE the power call, so the reboot request
        // exists in live state even though nothing dispatched. A caller cannot
        // treat this like a settings write that simply did not happen.
        assert_eq!(
            service.trees().await.1["power"]["last_action"],
            "reboot",
            "the request is recorded before dispatch, so it survives the failure"
        );
        assert_eq!(
            actions.take_triggered(),
            vec![Action::Reboot],
            "the consumption edge is the write's, not the dispatch's"
        );
        assert!(runs.lock().expect("lock").is_empty());
        assert!(
            !settings_path.exists(),
            "an action persists nothing either way"
        );

        // (2) A settings write that validates and then cannot persist: a
        // DIRECTORY sits where the settings file belongs, so the write fails
        // at the filesystem, below the schema. -4 keeps its original,
        // persist-only meaning.
        let dir = tempfile::tempdir().expect("tempdir");
        let settings_path = dir.path().join("settings.toml");
        std::fs::create_dir(&settings_path).expect("blocking directory");
        let (service, runs) = service_storing_at(
            Box::new(RefusingPower),
            json!({}),
            &settings_path,
            dir.path(),
        );
        let before = service.trees().await;
        assert_eq!(
            set_item(&service, &actions, ":1.6", "/hostname", json!("edge-02")).await,
            SET_NOT_PERSISTED,
            "a validated settings write that would not persist still reports -4"
        );
        assert_eq!(
            service.trees().await,
            before,
            "a write that did not persist must leave the tree as it was, which \
             is what makes retrying it safe"
        );
        assert!(
            settings_path.is_dir(),
            "the blocking directory is still there: nothing was persisted over it"
        );
        assert!(
            actions.take_triggered().is_empty(),
            "a settings write is no action, so no consumption edge may be pending"
        );
        let _ = runs;
    }
}
