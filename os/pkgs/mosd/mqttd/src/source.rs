//! The bus side: reading the item tree and writing to it.
//!
//! [`ItemSource`] is the whole of what the bridge asks of mosd, and it is
//! deliberately two calls wide. Everything else the bridge knows about the
//! tree it learns from `ItemsChanged` payloads, which the runtime converts
//! with [`batch_of`] and hands to the state machine.

use std::collections::{BTreeMap, HashMap};

use async_trait::async_trait;
use serde_json::Value as Json;
use zbus::zvariant::{OwnedValue, Value};

use crate::config::{ACTIONS_PREFIX, SERVICE};
use crate::item::Item;

/// What became of a `SetValue`.
///
/// Deliberately **not** the result-code numbers. `docs/design/bus.md` §1.1
/// fixes the vocabulary — `0` ok, negative on failure, positives reserved —
/// and the negative half is still being refined in mosd. A bridge that
/// switched on literal values would be a second place that vocabulary has to
/// be kept in step, for no gain: the bridge cannot act differently on one
/// negative code than on another, because reasons never leave mosd (§3).
///
/// The distinction that *does* matter to a client, and that this bridge can
/// make without any code at all, is by **path** rather than by number:
///
/// - a write to a settings item that failed did not take effect — the item is
///   unchanged (§3), so retrying is safe;
/// - a write to an `/Actions/<verb>` item is a *dispatch*, and mosd logs it
///   and records it in live state **before** the power call (§7). A failure
///   reported back therefore does not mean nothing happened, so retrying is
///   not obviously safe. That distinction matters most for a reboot arriving
///   over MQTT.
///
/// [`retry_note`] is that reasoning, applied to a path, for the log line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteOutcome {
    /// `SetValue` returned `0`.
    Accepted,
    /// `SetValue` returned a negative code. Carried for the log; nothing in
    /// the bridge branches on its value.
    Refused { code: i32 },
    /// No item object at that path.
    ///
    /// A distinct case, not a generic failure: zbus dispatches by **exact**
    /// object path with no fallback handler, so a path the tree does not
    /// carry answers with a D-Bus `UnknownObject` error rather than with a
    /// result code. So does a path that is not a valid object path at all,
    /// which a settings key is free to be (`network.br-lan`).
    UnknownObject,
    /// The value could not be carried to the bus at all: JSON `null`, which
    /// is the invalid marker rather than a value, or a number D-Bus has no
    /// type for. Nothing was written.
    Unrepresentable,
    /// The call did not reach the service: it is not on the bus, or the
    /// connection failed.
    Unreachable { detail: String },
}

impl WriteOutcome {
    /// Whether the write took effect.
    pub fn accepted(&self) -> bool {
        matches!(self, Self::Accepted)
    }
}

/// What a failed write at `path` implies for a retry — the persist/dispatch
/// distinction of [`WriteOutcome`], resolved from the path alone.
pub fn retry_note(path: &str) -> &'static str {
    if path.starts_with(ACTIONS_PREFIX) {
        "dispatch: the action was recorded before the power call, so a retry is not obviously safe"
    } else {
        "persist: the item is unchanged, so a retry is safe"
    }
}

/// The two things the bridge does to the item tree.
#[async_trait]
pub trait ItemSource: Send + Sync {
    /// Every currently valid item: absolute slash path -> attributes.
    async fn get_items(&self) -> anyhow::Result<BTreeMap<String, Item>>;

    /// `SetValue` on the item at `path`.
    async fn set_value(&self, path: &str, value: Json) -> WriteOutcome;
}

/// Convert a D-Bus value into the JSON a payload carries.
///
/// The empty array is `docs/design/bus.md` §3's invalid sentinel and becomes
/// `null`, which is the same convention expressed in the only type system
/// that can express it. An item whose value genuinely is an empty array is
/// therefore indistinguishable from an invalid one — that is the contract's
/// own trade, inherited here rather than papered over.
pub fn json_of(value: &Value<'_>) -> Json {
    match value {
        Value::Bool(flag) => Json::Bool(*flag),
        Value::U8(number) => Json::from(*number),
        Value::I16(number) => Json::from(*number),
        Value::U16(number) => Json::from(*number),
        Value::I32(number) => Json::from(*number),
        Value::U32(number) => Json::from(*number),
        Value::I64(number) => Json::from(*number),
        Value::U64(number) => Json::from(*number),
        Value::F64(number) => Json::from(*number),
        Value::Str(text) => Json::String(text.to_string()),
        Value::ObjectPath(path) => Json::String(path.to_string()),
        Value::Signature(signature) => Json::String(signature.to_string()),
        Value::Value(inner) => json_of(inner),
        Value::Array(items) if items.is_empty() => Json::Null,
        Value::Array(items) => Json::Array(items.iter().map(json_of).collect()),
        Value::Dict(entries) => Json::Object(
            entries
                .iter()
                .filter_map(|(key, value)| match key {
                    Value::Str(key) => Some((key.to_string(), json_of(value))),
                    _ => None,
                })
                .collect(),
        ),
        _ => Json::Null,
    }
}

/// Convert JSON back into the D-Bus value a `SetValue` carries.
///
/// `None` for what D-Bus cannot hold: a non-finite number, and a `null`,
/// which is the invalid marker rather than a value and is never written.
pub fn value_of(json: &Json) -> Option<Value<'static>> {
    Some(match json {
        Json::Null => return None,
        Json::Bool(flag) => Value::from(*flag),
        Json::Number(number) => {
            if let Some(int) = number.as_i64() {
                Value::from(int)
            } else if let Some(uint) = number.as_u64() {
                Value::from(uint)
            } else {
                Value::from(number.as_f64()?)
            }
        }
        Json::String(text) => Value::from(text.clone()),
        Json::Array(items) => Value::from(items.iter().filter_map(value_of).collect::<Vec<_>>()),
        Json::Object(map) => Value::from(
            map.iter()
                .filter_map(|(key, child)| value_of(child).map(|child| (key.clone(), child)))
                .collect::<HashMap<_, _>>(),
        ),
    })
}

/// The item one `a{sv}` attribute dict describes, or `None` when it describes
/// an invalid one (`docs/design/bus.md` §3: absent key, or the sentinel).
pub fn item_of(attrs: &HashMap<String, OwnedValue>) -> Option<Item> {
    let bound = |key: &str| attrs.get(key).map(|value| json_of(value));
    let value = bound("value")?;
    if value.is_null() {
        return None;
    }
    Some(Item {
        value,
        writable: attrs
            .get("writable")
            .map(|value| json_of(value))
            .is_some_and(|writable| writable == Json::Bool(true)),
        min: bound("min"),
        max: bound("max"),
    })
}

/// An `ItemsChanged` payload as the bridge consumes it: path -> new item, or
/// `None` where the item became invalid.
pub fn batch_of(
    items: HashMap<String, HashMap<String, OwnedValue>>,
) -> BTreeMap<String, Option<Item>> {
    items
        .into_iter()
        .map(|(path, attrs)| (path, item_of(&attrs)))
        .collect()
}

/// The tree-wide half of `com.mos.Item1`, served on the service root
/// (`docs/design/bus.md` §1.1) — which is the object path `/`, since item
/// object paths are absolute slash paths below it (§4).
#[zbus::proxy(
    interface = "com.mos.Item1",
    default_service = "com.mos.mosd",
    default_path = "/"
)]
pub trait ItemTree {
    fn get_items(&self) -> zbus::Result<HashMap<String, HashMap<String, OwnedValue>>>;

    #[zbus(signal)]
    fn items_changed(
        &self,
        items: HashMap<String, HashMap<String, OwnedValue>>,
    ) -> zbus::Result<()>;
}

/// [`ItemSource`] over a real D-Bus connection.
pub struct BusSource {
    connection: zbus::Connection,
}

impl BusSource {
    pub fn new(connection: zbus::Connection) -> Self {
        Self { connection }
    }

    pub fn connection(&self) -> &zbus::Connection {
        &self.connection
    }
}

/// D-Bus errors that mean "there is no item object at that path", as opposed
/// to "the call failed". zbus dispatches by exact object path and has no
/// fallback handler, so this is the only answer an unknown path can give.
const NO_SUCH_ITEM: [&str; 3] = [
    "org.freedesktop.DBus.Error.UnknownObject",
    "org.freedesktop.DBus.Error.UnknownInterface",
    "org.freedesktop.DBus.Error.UnknownMethod",
];

#[async_trait]
impl ItemSource for BusSource {
    async fn get_items(&self) -> anyhow::Result<BTreeMap<String, Item>> {
        let proxy = ItemTreeProxy::new(&self.connection).await?;
        Ok(proxy
            .get_items()
            .await?
            .into_iter()
            .filter_map(|(path, attrs)| item_of(&attrs).map(|item| (path, item)))
            .collect())
    }

    async fn set_value(&self, path: &str, value: Json) -> WriteOutcome {
        let Some(value) = value_of(&value) else {
            return WriteOutcome::Unrepresentable;
        };
        // A settings key is free to be a string no object path can spell, and
        // such an item has no object of its own — the same case as a path the
        // tree does not carry, reported the same way.
        let proxy = match zbus::Proxy::new(&self.connection, SERVICE, path, "com.mos.Item1").await {
            Ok(proxy) => proxy,
            Err(zbus::Error::Variant(_) | zbus::Error::InvalidField) => {
                return WriteOutcome::UnknownObject;
            }
            Err(err) => {
                return WriteOutcome::Unreachable {
                    detail: err.to_string(),
                };
            }
        };
        match proxy.call::<_, _, i32>("SetValue", &(value,)).await {
            Ok(0) => WriteOutcome::Accepted,
            Ok(code) => WriteOutcome::Refused { code },
            Err(zbus::Error::MethodError(name, _, _)) if NO_SUCH_ITEM.contains(&name.as_str()) => {
                WriteOutcome::UnknownObject
            }
            Err(err) => WriteOutcome::Unreachable {
                detail: err.to_string(),
            },
        }
    }
}
