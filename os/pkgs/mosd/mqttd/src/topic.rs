//! The topic grammar: `N|R|W/<deviceId>/<class>/<instance>/<path>`
//! (`docs/design/bus.md`, MQTT grammar).
//!
//! Three verbs, and the direction is part of the verb: `N` is what the bridge
//! publishes, `R` and `W` are what it subscribes to. Building and parsing both
//! live here so the two can never drift apart.

use mos_busname::Origin;

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

/// A bus service admitted to the MQTT application data plane.
///
/// Construction is deliberately private to [`application_of`]. A bridge can
/// therefore carry only a class-bearing extension name; a system name cannot
/// be smuggled in by pairing it with an application-looking class string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Application {
    bus_name: String,
    class: String,
}

impl Application {
    /// The exact well-known D-Bus name to read and write.
    pub fn bus_name(&self) -> &str {
        &self.bus_name
    }

    /// The MQTT class derived by the shared bus-name parser.
    pub fn class(&self) -> &str {
        &self.class
    }
}

/// Admit one D-Bus name to the MQTT application data plane.
///
/// Only `com.mos.ext.<class>[.<suffix>]` is accepted. System-origin names,
/// names outside the mos namespace, and the classless `com.mos.ext`
/// namespace are all refused. This positive application allowlist is the
/// MQTT system/application security boundary.
pub fn application_of(bus_name: &str) -> Option<Application> {
    let parsed = mos_busname::parse(bus_name)?;
    if parsed.origin != Origin::Extension {
        return None;
    }
    Some(Application {
        bus_name: bus_name.to_string(),
        class: parsed.class?.to_string(),
    })
}

/// The three topic segments between the verb and the item path.
///
/// `class` is the admitted application's class: the fourth component of
/// `com.mos.ext.<class>[.<suffix>]`, so an application publishes under its
/// class and never under `ext`. `instance` is the service's
/// `/DeviceInstance`, or `0` when a non-conforming application omits one.
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
    Read {
        class: String,
        instance: u64,
        path: String,
    },
    /// `W/<deviceId>/<class>/<instance>/<path>`.
    Write {
        class: String,
        instance: u64,
        path: String,
    },
}

/// The request `topic` carries, or `None` when it is not one of ours.
///
/// This function validates the grammar and device identity. The bridge then
/// resolves class and instance against its admitted application set; a valid
/// topic with no unique application target is ignored there.
pub fn parse(topic: &str, device_id: &str) -> Option<Request> {
    let mut segments = topic.split('/');
    let verb = segments.next()?;
    if segments.next()? != device_id {
        return None;
    }
    let rest: Vec<&str> = segments.collect();
    if verb == READ && rest == [KEEPALIVE] {
        return Some(Request::Keepalive);
    }
    let [class, instance, path @ ..] = rest.as_slice() else {
        return None;
    };
    let instance = instance.parse::<u64>().ok()?;
    if path.is_empty() {
        return None;
    }
    let path = format!("/{}", path.join("/"));
    if !valid_item_path(&path) {
        return None;
    }
    match verb {
        READ => Some(Request::Read {
            class: (*class).to_string(),
            instance,
            path,
        }),
        WRITE => Some(Request::Write {
            class: (*class).to_string(),
            instance,
            path,
        }),
        _ => None,
    }
}

/// Whether `segment` can safely occupy one MQTT topic level.
///
/// `/` would add an unintended level, `+` and `#` are subscription wildcards,
/// and control characters are not accepted in identifiers. Device identities
/// originate in persistent settings, so validating at the I/O edge prevents
/// corrupted or migrated state from changing the topic grammar.
pub fn valid_topic_segment(segment: &str) -> bool {
    !segment.is_empty()
        && !segment
            .chars()
            .any(|character| character.is_control() || matches!(character, '/' | '+' | '#'))
}

/// Whether an application item key is a real D-Bus object path.
///
/// Application `GetItems` replies cross a trust boundary: an extension can
/// return arbitrary strings even though `SetValue` can address only object
/// paths. Rejecting invalid keys here also prevents MQTT wildcard characters
/// from reaching a publish topic and making the transport tear down the
/// bridge.
pub fn valid_item_path(path: &str) -> bool {
    zbus::zvariant::ObjectPath::try_from(path).is_ok()
}

/// The `class` a `com.mos.*` bus name declares, or `None` when the name is not
/// one: the third
/// component of a system name `com.mos.<class>[.<suffix>]`, the fourth of an
/// extension name `com.mos.ext.<class>[.<suffix>]`.
///
/// The rule itself lives in [`mos_busname`] and only there. mosd's service
/// registry derives the same class from the same names, and a second copy
/// here would be a second rule — one that can drift into publishing an
/// extension under `ext`.
///
/// The two ways of having no class are one answer here, deliberately: a name
/// that is not ours at all and the bare `com.mos.ext` namespace, which is in
/// the extension half but names no service under it, both yield `None`. The
/// bridge's only question is which class to address a service by, and neither
/// answers it — so [`application_of`] refuses to admit it rather than invent
/// one. Telling the two apart matters to mosd's service
/// registry, which records the second as a conformance gap; it reads
/// `mos_busname` directly and gets the distinction from the type.
pub fn class_of(bus_name: &str) -> Option<&str> {
    mos_busname::parse(bus_name).and_then(|name| name.class)
}

/// The `/DeviceInstance` an item map declares, or `0` when it declares none.
///
/// `/DeviceInstance` is mandatory for applications. The `0` fallback keeps a
/// non-conforming application observable, while collision handling prevents
/// ambiguous reads or writes.
pub fn instance_of(items: &std::collections::BTreeMap<String, Item>) -> u64 {
    items
        .get("/DeviceInstance")
        .and_then(|item| item.value.as_u64())
        .unwrap_or(0)
}
