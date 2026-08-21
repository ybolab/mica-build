//! Read-only `com.mos.Item1` item-tree façade (PLAN-011 M1).
//!
//! Projects the settings tree and the live-state tree as one flat item tree
//! per `docs/design/bus.md`: `GetItems() -> a{sa{sv}}` and the coalesced
//! `ItemsChanged(a{sa{sv}})` signal, both served on the root object path
//! [`ROOT_PATH`]. Per-item `GetValue`/`SetValue` objects are M2 scope and
//! deliberately absent here.
//!
//! The façade only observes: every mutation still flows through
//! [`MosdService`], the single writer. It learns about changes through the
//! service's change marker ([`MosdService::subscribe_changes`]), re-projects
//! both trees, and emits one signal per accumulated batch of differences.

use std::collections::{BTreeMap, HashMap};

use serde_json::Value as Json;
use tokio::sync::watch;
use zbus::fdo;
use zbus::object_server::{InterfaceRef, SignalEmitter};
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

/// Attribute dict of one item (`a{sv}`): `value`, `writable`, and optionally
/// `min`/`max`/`unit` — none of which the two trees carry cheaply today.
type ItemAttrs = HashMap<String, Value<'static>>;
/// The `a{sa{sv}}` body of `GetItems` and `ItemsChanged`: absolute slash
/// path -> attribute dict.
type Items = HashMap<String, ItemAttrs>;

/// Strip every secret-named key, at any depth, including inside arrays.
///
/// The ONE redaction point of the façade: [`project`] runs every tree
/// through here before anything else looks at it, so neither `GetItems` nor
/// an `ItemsChanged` payload can ever carry a secret value.
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

/// Project both trees into one redacted flat item map. The settings tree is
/// projected first, the live-state tree second; they share no top-level key
/// today, and if they ever do the live-state leaf wins.
fn project(settings: &Json, state: &Json) -> BTreeMap<String, Json> {
    let mut items = BTreeMap::new();
    for tree in [settings, state] {
        let mut tree = tree.clone();
        redact(&mut tree);
        flatten("", &tree, &mut items);
    }
    items
}

/// Leaves that differ between two projections: an added or changed path maps
/// to its new value, a vanished path to `None` (the transition to invalid).
fn diff(
    prev: &BTreeMap<String, Json>,
    cur: &BTreeMap<String, Json>,
) -> BTreeMap<String, Option<Json>> {
    let mut out = BTreeMap::new();
    for (path, value) in cur {
        if prev.get(path) != Some(value) {
            out.insert(path.clone(), Some(value.clone()));
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

/// The on-wire invalid marker: an empty `av` (`docs/design/bus.md` §3).
fn invalid_sentinel() -> Value<'static> {
    Value::from(Vec::<Value<'static>>::new())
}

/// Attribute dict for one item. `writable` is `false` everywhere in M1;
/// writability arrives with M2's `SetValue`.
fn attrs(value: Value<'static>) -> ItemAttrs {
    HashMap::from([
        ("value".to_string(), value),
        ("writable".to_string(), Value::from(false)),
    ])
}

/// The full `GetItems` body for a projection.
fn items_from(projection: &BTreeMap<String, Json>) -> Items {
    projection
        .iter()
        .filter_map(|(path, json)| to_variant(json).map(|value| (path.clone(), attrs(value))))
        .collect()
}

/// The `ItemsChanged` body for a diff: vanished paths carry the invalid
/// sentinel so a subscriber sees the transition.
fn items_from_diff(diff: BTreeMap<String, Option<Json>>) -> Items {
    diff.into_iter()
        .filter_map(|(path, value)| match value {
            Some(json) => to_variant(&json).map(|value| (path, attrs(value))),
            None => Some((path, attrs(invalid_sentinel()))),
        })
        .collect()
}

/// The `com.mos.Item1` façade served at [`ROOT_PATH`].
pub struct ItemTree {
    service: InterfaceRef<MosdService>,
}

impl ItemTree {
    pub fn new(service: InterfaceRef<MosdService>) -> Self {
        Self { service }
    }
}

/// Snapshot the service's two trees and project them, redacted.
async fn projection(service: &InterfaceRef<MosdService>) -> BTreeMap<String, Json> {
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

/// Watch the service's change marker and emit coalesced [`ItemsChanged`]
/// signals. The watch channel collapses marks that arrive while a batch is
/// being projected into one wake, so N mutations in one turn flush as one
/// signal, never N. Runs until the service side of the channel is dropped.
pub async fn run(
    service: InterfaceRef<MosdService>,
    tree: InterfaceRef<ItemTree>,
    mut changes: watch::Receiver<u64>,
) {
    let mut prev = projection(&service).await;
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
        if let Err(err) =
            ItemTree::items_changed(tree.signal_emitter(), items_from_diff(batch)).await
        {
            tracing::warn!(error = %err, "emit ItemsChanged failed");
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

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
        let mut prev = BTreeMap::new();
        prev.insert("/hostname".to_string(), json!("mos"));
        prev.insert("/gone".to_string(), json!(1));
        prev.insert("/same".to_string(), json!("kept"));
        let mut cur = BTreeMap::new();
        cur.insert("/hostname".to_string(), json!("edge"));
        cur.insert("/new".to_string(), json!(2));
        cur.insert("/same".to_string(), json!("kept"));

        let batch = diff(&prev, &cur);
        assert_eq!(batch.get("/hostname"), Some(&Some(json!("edge"))));
        assert_eq!(batch.get("/new"), Some(&Some(json!(2))));
        assert_eq!(batch.get("/gone"), Some(&None));
        assert!(!batch.contains_key("/same"));
    }

    #[test]
    fn the_invalid_sentinel_is_an_empty_variant_array() {
        let sentinel = invalid_sentinel();
        assert_eq!(sentinel.value_signature().to_string(), "av");
    }

    #[test]
    fn every_item_is_read_only_in_m1() {
        let batch = items_from(&BTreeMap::from([("/hostname".to_string(), json!("mos"))]));
        let writable = &batch["/hostname"]["writable"];
        assert!(!bool::try_from(writable.clone()).expect("bool"));
    }
}
