//! The protocol, as a state machine.
//!
//! Events in, [`Effects`] out, and no clock, socket or bus handle inside: time
//! arrives as an explicit monotonic `now`, measured from the bridge's start, so
//! every rate limit, expiry and gate is a pure function of state and `now`.
//! That is what makes the protocol tests exact rather than timing-dependent.
//!
//! `docs/design/bus.md` §10.1's liveness rule is that a keepalive arms a 60 s
//! window and the device publishes only inside it. The gate applies to
//! publishing and only to publishing: an `N` for a changed item, an answer to
//! an `R`, a heartbeat, a full republish and the retained-state clear of a
//! vanished device are all silent without a live window. A `W` is not — it is
//! control, not publication.
//!
//! The bridge mirrors the item tree, seeded from `GetItems` and maintained from
//! `ItemsChanged`, so a full republish is served from memory and a keepalive
//! storm cannot become a `GetItems` storm against mosd — the second half of the
//! rate limit D6 asks for.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use serde_json::Value as Json;

use crate::config::{DEVICE_ID_PATH, Mode, Timings};
use crate::item::Item;
use crate::payload;
use crate::topic::{self, Address, Request};

/// One MQTT publication the runtime is to make.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Publication {
    pub topic: String,
    pub payload: Vec<u8>,
    /// Item notifications are retained, so a subscriber that arrives between
    /// keepalives still finds the tree's current state; the momentary
    /// topics — heartbeat and `full_publish_completed` — are not, because a
    /// stale beat left standing on the broker is a lie about liveness.
    pub retain: bool,
}

/// A `SetValue` the runtime is to perform, produced by a `W` request in full
/// mode.
#[derive(Debug, Clone, PartialEq)]
pub struct Write {
    pub path: String,
    pub value: Json,
}

/// What one event asks the runtime to do.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Effects {
    pub publications: Vec<Publication>,
    pub writes: Vec<Write>,
}

impl From<Vec<Publication>> for Effects {
    fn from(publications: Vec<Publication>) -> Self {
        Self {
            publications,
            ..Self::default()
        }
    }
}

/// The bridge's whole protocol state.
pub struct Bridge {
    /// The `com.mos.<class>` this bridge publishes for (`docs/design/bus.md`
    /// §5).
    class: String,
    mode: Mode,
    timings: Timings,
    /// The mirrored item tree: absolute slash path -> item.
    items: BTreeMap<String, Item>,
    /// The address the mirror currently resolves to, recomputed whenever the
    /// mirror changes.
    address: Option<Address>,
    /// Every topic this bridge has left retained state on, in full topic form
    /// so it stays clearable after the device — and with it the device id the
    /// topic was built from — is gone.
    published: BTreeSet<String>,
    /// Topics whose retained state is owed a clear, held until the bridge is
    /// alive enough to publish it.
    pending_clears: BTreeSet<String>,
    alive_until: Option<Duration>,
    last_full: Option<Duration>,
    /// A full republish asked for inside the rate limit's floor, coalesced
    /// into one deferred republish.
    full_pending: bool,
    next_heartbeat: Duration,
}

impl Bridge {
    pub fn new(class: impl Into<String>, mode: Mode, timings: Timings) -> Self {
        Self {
            class: class.into(),
            mode,
            timings,
            items: BTreeMap::new(),
            address: None,
            published: BTreeSet::new(),
            pending_clears: BTreeSet::new(),
            alive_until: None,
            last_full: None,
            full_pending: false,
            next_heartbeat: Duration::ZERO,
        }
    }

    /// Whether a keepalive window is currently open.
    pub fn alive(&self, now: Duration) -> bool {
        self.alive_until.is_some_and(|until| now < until)
    }

    /// The device id the tree reports, `None` until `provisioning.deviceId`
    /// is in the mirror. Without it no topic can be built, so a bridge that
    /// has not read one is silent by construction.
    pub fn device_id(&self) -> Option<&str> {
        self.address
            .as_ref()
            .map(|address| address.device_id.as_str())
    }

    /// The subscription filters this bridge needs, for the current address
    /// and mode. Read-only mode does not subscribe to `W` at all; the refusal
    /// in [`Self::on_request`] is the second lock on the same door.
    pub fn subscriptions(&self) -> Vec<String> {
        let Some(address) = self.address.as_ref() else {
            return Vec::new();
        };
        let mut filters = vec![address.request_filter(topic::READ)];
        if self.mode.writes_allowed() {
            filters.push(address.request_filter(topic::WRITE));
        }
        filters
    }

    /// Replace the mirror wholesale — the initial `GetItems`, and the one
    /// after a vanished device comes back — and republish, rate limit
    /// permitting.
    pub fn seed(&mut self, now: Duration, items: BTreeMap<String, Item>) -> Effects {
        self.items = items;
        self.resync_address();
        self.request_full(now).into()
    }

    /// Apply one coalesced `ItemsChanged` batch: `None` is the item becoming
    /// invalid, which leaves the mirror (`docs/design/bus.md` §3: invalid is
    /// an absent key) but still publishes, as `{"value": null}`, so a
    /// subscriber sees the transition instead of inferring it from silence.
    pub fn on_items_changed(
        &mut self,
        now: Duration,
        batch: BTreeMap<String, Option<Item>>,
    ) -> Effects {
        for (path, item) in &batch {
            match item {
                Some(item) => self.items.insert(path.clone(), item.clone()),
                None => self.items.remove(path),
            };
        }
        self.resync_address();
        if !self.alive(now) {
            return Effects::default();
        }
        batch
            .iter()
            .filter_map(|(path, item)| self.publish_item(path, item.as_ref()))
            .collect::<Vec<_>>()
            .into()
    }

    /// The service left the bus: clear every topic it left retained, so no
    /// subscriber reads a value from a device that is no longer there. A clear
    /// is a zero-length payload, which deletes the retained message rather than
    /// replacing it with a value — distinct from `{"value": null}`, which says
    /// the item is there and invalid.
    ///
    /// The address survives the device, deliberately. It is read out of the
    /// tree, and the tree just left — but the device id it named is the
    /// identity of the machine this bridge runs on, not of the process that
    /// reported it. Forgetting it would leave the bridge unable to parse even a
    /// keepalive addressed to itself. If the device comes back under a
    /// different id, [`Self::resync_address`] notices and clears the old topics
    /// then.
    pub fn on_device_vanished(&mut self, now: Duration) -> Effects {
        self.items.clear();
        self.pending_clears
            .extend(std::mem::take(&mut self.published));
        if !self.alive(now) {
            return Effects::default();
        }
        self.flush_clears().into()
    }

    /// A keepalive: arm or renew the alive window, and ask for a full
    /// republish.
    pub fn on_keepalive(&mut self, now: Duration) -> Effects {
        if !self.alive(now) {
            self.next_heartbeat = now + self.timings.heartbeat;
        }
        self.alive_until = Some(now + self.timings.alive_window);
        self.request_full(now).into()
    }

    /// One message from the broker.
    pub fn on_request(&mut self, now: Duration, topic: &str, payload: &[u8]) -> Effects {
        let Some(address) = self.address.clone() else {
            tracing::debug!(topic, "request before the device id is known");
            return Effects::default();
        };
        let Some(request) = topic::parse(topic, &address) else {
            tracing::debug!(topic, "request not addressed to this device");
            return Effects::default();
        };
        match request {
            Request::Keepalive => self.on_keepalive(now),
            Request::Read { path } => {
                if !self.alive(now) {
                    return Effects::default();
                }
                let item = self.items.get(&path).cloned();
                self.publish_item(&path, item.as_ref())
                    .into_iter()
                    .collect::<Vec<_>>()
                    .into()
            }
            Request::Write { path } => {
                if !self.mode.writes_allowed() {
                    tracing::warn!(path, "write request refused: bridge is in read-only mode");
                    return Effects::default();
                }
                let Some(value) = payload::decode(payload) else {
                    tracing::warn!(path, "write request carried no value payload");
                    return Effects::default();
                };
                Effects {
                    writes: vec![Write { path, value }],
                    ..Effects::default()
                }
            }
        }
    }

    /// Time passed: the heartbeat, and any full republish the rate limit
    /// deferred.
    pub fn on_tick(&mut self, now: Duration) -> Effects {
        if !self.alive(now) {
            return Effects::default();
        }
        let mut publications = Vec::new();
        if self.full_pending && self.full_publish_ready(now) {
            publications.extend(self.full_publish(now));
        }
        if now >= self.next_heartbeat {
            // Scheduled from `now`, not from the missed deadline: a late tick
            // resumes the beat, it does not fire a burst of catch-up beats.
            self.next_heartbeat = now + self.timings.heartbeat;
            if let Some(beat) = self.heartbeat(now) {
                publications.push(beat);
            }
        }
        publications.into()
    }

    /// When [`Self::on_tick`] next has something to do, so the runtime can
    /// sleep exactly that long. `None` while not alive: nothing is due until
    /// a keepalive arrives, and that arrives as a message, not as time.
    pub fn next_wake(&self, now: Duration) -> Option<Duration> {
        if !self.alive(now) {
            return None;
        }
        let deferred = self
            .full_pending
            .then(|| self.full_publish_due())
            .flatten()
            .unwrap_or(self.next_heartbeat);
        Some(self.next_heartbeat.min(deferred))
    }

    /// Recompute the address from the mirror, and orphan-clear on a change.
    ///
    /// The device id and the instance are read out of the tree, so they can
    /// move — and every topic already published carries the old ones. Rather
    /// than leave that retained state standing under an address nothing will
    /// ever publish to again, it is queued for a clear.
    fn resync_address(&mut self) {
        let device_id = self
            .items
            .get(DEVICE_ID_PATH)
            .and_then(|item| item.value.as_str());
        let current = device_id.map(|device_id| Address {
            device_id: device_id.to_string(),
            class: self.class.clone(),
            instance: topic::instance_of(&self.items),
        });
        if current == self.address {
            return;
        }
        self.pending_clears
            .extend(std::mem::take(&mut self.published));
        self.address = current;
    }

    /// Whether the rate limit's floor has elapsed since the last full
    /// republish.
    fn full_publish_ready(&self, now: Duration) -> bool {
        self.full_publish_due().is_none_or(|due| now >= due)
    }

    /// When the next full republish may go out; `None` when one may go out
    /// immediately.
    fn full_publish_due(&self) -> Option<Duration> {
        self.last_full
            .map(|last| last + self.timings.full_publish_min_interval)
    }

    /// A full republish was asked for: do it now, or coalesce it into the one
    /// already deferred.
    ///
    /// This is the rate limit. A storm of keepalives renews the alive window
    /// every time — cheap, and it must not be throttled — but produces at
    /// most one immediate full republish plus one deferred one, never one per
    /// keepalive.
    fn request_full(&mut self, now: Duration) -> Vec<Publication> {
        if !self.alive(now) {
            return Vec::new();
        }
        if self.full_publish_ready(now) {
            return self.full_publish(now);
        }
        self.full_pending = true;
        Vec::new()
    }

    /// Every mirrored item, then the marker that terminates the republish.
    ///
    /// The marker's payload is the number of item publications that preceded
    /// it, which is within the `{"value": ...}` grammar and gives a client
    /// something to check the batch it received against.
    fn full_publish(&mut self, now: Duration) -> Vec<Publication> {
        // Clears come first, and come out even when there is no address: they
        // are full topics carrying the id they were published under, and a
        // device that vanished while the bridge was silent left both the
        // retained state and no address behind. Owing them to an address that
        // no longer exists would strand them forever.
        let mut publications = self.flush_clears();
        if self.address.is_none() {
            // Nothing addressable, so nothing was republished and the rate
            // limit must not start running.
            return publications;
        }
        self.last_full = Some(now);
        self.full_pending = false;
        let paths: Vec<String> = self.items.keys().cloned().collect();
        let mut items = 0;
        for path in paths {
            let item = self.items.get(&path).cloned();
            if let Some(publication) = self.publish_item(&path, item.as_ref()) {
                publications.push(publication);
                items += 1;
            }
        }
        if let Some(address) = self.address.as_ref() {
            publications.push(Publication {
                topic: address.device_topic(topic::NOTIFY, topic::FULL_PUBLISH_COMPLETED),
                payload: payload::value_only(Json::from(items)),
                retain: false,
            });
        }
        publications
    }

    /// The retained-state clears that are owed, as publications.
    fn flush_clears(&mut self) -> Vec<Publication> {
        std::mem::take(&mut self.pending_clears)
            .into_iter()
            .map(|topic| Publication {
                topic,
                payload: payload::CLEAR.to_vec(),
                retain: true,
            })
            .collect()
    }

    /// The `N` publication for one item — `None` while there is no address to
    /// build a topic from.
    fn publish_item(&mut self, path: &str, item: Option<&Item>) -> Option<Publication> {
        let topic = self.address.as_ref()?.item_topic(topic::NOTIFY, path);
        let payload = match item {
            Some(item) => payload::encode(path, item),
            None => payload::invalid(),
        };
        self.published.insert(topic.clone());
        Some(Publication {
            topic,
            payload,
            retain: true,
        })
    }

    /// The 3 s beat. Its value is the bridge's uptime in seconds, which is
    /// monotonic, needs no wall clock, and lets a subscriber see a bridge
    /// restart as the reset it is.
    ///
    /// It reports that the **bridge** is connected and inside a live window.
    /// Whether the *device* is on the bus is reported by its item state,
    /// which a vanish clears — a beat over a cleared tree is a bridge with
    /// nothing to publish, and says so precisely.
    fn heartbeat(&self, now: Duration) -> Option<Publication> {
        Some(Publication {
            topic: self
                .address
                .as_ref()?
                .device_topic(topic::NOTIFY, topic::HEARTBEAT),
            payload: payload::value_only(Json::from(now.as_secs())),
            retain: false,
        })
    }
}
