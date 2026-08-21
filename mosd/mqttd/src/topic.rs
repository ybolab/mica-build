//! The topic grammar: `N|R|W/<deviceId>/<class>/<instance>/<path>`
//! (`docs/design/bus.md` §10.1).
//!
//! Three verbs, and the direction is part of the verb: `N` is what the bridge
//! publishes, `R` and `W` are what it subscribes to. Building and parsing both
//! live here so the two can never drift apart.

use crate::item::Item;

/// Notification: device -> broker. The only verb this bridge publishes under.
pub const NOTIFY: &str = "N";
/// Read request: broker -> device. The bridge republishes the addressed item.
pub const READ: &str = "R";
/// Write request: broker -> device. Carried through to `SetValue` in full
/// mode, refused in read-only mode.
pub const WRITE: &str = "W";

/// `R/<deviceId>/keepalive` — arms the alive window and asks for a full
/// republish (the dbus-flashmq shape). Any payload it carries is ignored:
/// this bridge answers a keepalive with a full republish, never a partial
/// one.
pub const KEEPALIVE: &str = "keepalive";
/// `N/<deviceId>/full_publish_completed` — the marker that terminates a full
/// republish.
pub const FULL_PUBLISH_COMPLETED: &str = "full_publish_completed";
/// `N/<deviceId>/heartbeat` — the 3 s liveness beat, published only while the
/// alive window holds.
pub const HEARTBEAT: &str = "heartbeat";

/// The three topic segments between the verb and the item path.
///
/// `class` is the `com.mos.<class>` of the publishing service
/// (`docs/design/bus.md` §5): `mosd` for the management core. `instance` is
/// the service's `/DeviceInstance` (§6), `0` until a service publishes one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Address {
    pub device_id: String,
    pub class: String,
    pub instance: u64,
}

impl Address {
    /// The topic one item is addressed by under `verb`. `path` is the item's
    /// absolute slash path, whose leading slash is also the separator the
    /// topic needs.
    pub fn item_topic(&self, verb: &str, path: &str) -> String {
        let Self {
            device_id,
            class,
            instance,
            ..
        } = self;
        format!("{verb}/{device_id}/{class}/{instance}{path}")
    }

    /// A device-scoped topic — `keepalive`, `heartbeat`,
    /// `full_publish_completed` — which carries no class and no instance
    /// because it is about the device, not about one of its items.
    pub fn device_topic(&self, verb: &str, leaf: &str) -> String {
        let device_id = &self.device_id;
        format!("{verb}/{device_id}/{leaf}")
    }

    /// The subscription filter covering every request of one verb addressed
    /// to this device.
    pub fn request_filter(&self, verb: &str) -> String {
        let device_id = &self.device_id;
        format!("{verb}/{device_id}/#")
    }
}

/// A request the broker addressed to this device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Request {
    /// `R/<deviceId>/keepalive`.
    Keepalive,
    /// `R/<deviceId>/<class>/<instance>/<path>`.
    Read { path: String },
    /// `W/<deviceId>/<class>/<instance>/<path>`.
    Write { path: String },
}

/// The request `topic` carries, or `None` when it is not one of ours.
///
/// "Not ours" is every topic addressed to another device, another class,
/// another instance, or published under a verb this bridge does not accept —
/// including `N`, which is the bridge's own output and never an instruction
/// to it. A malformed topic is silently not-ours too: there is no error
/// channel back to a publisher, so the only sound answer is to ignore it.
pub fn parse(topic: &str, address: &Address) -> Option<Request> {
    let mut segments = topic.split('/');
    let verb = segments.next()?;
    if segments.next()? != address.device_id {
        return None;
    }
    let rest: Vec<&str> = segments.collect();
    if verb == READ && rest == [KEEPALIVE] {
        return Some(Request::Keepalive);
    }
    let [class, instance, path @ ..] = rest.as_slice() else {
        return None;
    };
    if *class != address.class
        || instance.parse::<u64>().ok()? != address.instance
        || path.is_empty()
    {
        return None;
    }
    let path = format!("/{}", path.join("/"));
    match verb {
        READ => Some(Request::Read { path }),
        WRITE => Some(Request::Write { path }),
        _ => None,
    }
}

/// The `class` of a `com.mos.<class>[.<suffix>]` bus name
/// (`docs/design/bus.md` §5), or `None` when the name is not one.
pub fn class_of(bus_name: &str) -> Option<&str> {
    let rest = bus_name.strip_prefix("com.mos.")?;
    let class = rest.split('.').next()?;
    (!class.is_empty()).then_some(class)
}

/// The `/DeviceInstance` an item map declares, or `0` when it declares none.
///
/// `/DeviceInstance` is `docs/design/bus.md` §6's mandatory path and is
/// `[proposed]` — mosd publishes no such item today, so the default is what
/// every mos service resolves to until §6 lands.
pub fn instance_of(items: &std::collections::BTreeMap<String, Item>) -> u64 {
    items
        .get("/DeviceInstance")
        .and_then(|item| item.value.as_u64())
        .unwrap_or(0)
}
