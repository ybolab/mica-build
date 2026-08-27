//! One item as the bridge mirrors it: what `GetItems` and `ItemsChanged`
//! carry per path (`docs/design/bus.md` §1.1).

use serde_json::Value as Json;

/// The attributes of one item, converted out of the `a{sv}` the bus carries.
///
/// `value` is [`Json::Null`] for an item that is present but **invalid** —
/// the empty-array sentinel an `ItemsChanged` payload carries for a vanished
/// path, and what `GetValue` answers while invalid (`docs/design/bus.md` §3).
/// JSON is where `null` is expressible, so the sentinel crosses to `null`
/// here and the convention survives the transition (§10.1).
#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    pub value: Json,
    pub writable: bool,
    /// `min`/`max` travel when the publishing service carries them; mosd's
    /// two trees do not today, so both are `None` for every item it exports.
    pub min: Option<Json>,
    pub max: Option<Json>,
}

impl Item {
    /// A plain read-only item with no bounds — the shape most of the tree has.
    pub fn new(value: Json) -> Self {
        Self {
            value,
            writable: false,
            min: None,
            max: None,
        }
    }

    /// The same item marked writable.
    pub fn writable(value: Json) -> Self {
        Self {
            writable: true,
            ..Self::new(value)
        }
    }
}
