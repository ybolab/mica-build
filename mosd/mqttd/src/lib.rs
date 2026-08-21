//! `mos-mqttd` — the MQTT data-publishing bridge over the `com.mos.Item1`
//! item tree (PLAN-011 D6 / M3).
//!
//! The bridge is a **pure bus client**. It knows `GetItems`, `ItemsChanged`,
//! `SetValue` and nothing else about mosd: no store access, no reconciler
//! knowledge, no mosd internals. That is the property `docs/design/bus.md` §1
//! is built to give it, and it is why an extension service arriving later
//! (PLAN-011 D5) needs no bridge-side work.
//!
//! # The protocol is the mos-native grammar, and only that
//!
//! `docs/design/bus.md` §10 records the Sparkplug B evaluation and its
//! **OUTCOME**: the M3 bridge implements the mos-native grammar only —
//! `N|R|W/<deviceId>/<class>/<instance>/<path>` with `{"value": ...}`
//! payloads, a keepalive-triggered rate-limited full republish terminated by
//! `full_publish_completed`, a 3 s heartbeat, and read-only vs full modes.
//! Sparkplug B is **not** implemented here. Its revisit trigger is a named
//! integration requiring `spBv1.0`, and the outcome then is Sparkplug
//! *also* — a second publisher beside this one, never a replacement. Nothing
//! in this crate should be generalised in anticipation of it.
//!
//! # Shape: a state machine, a transport, and a source
//!
//! [`bridge::Bridge`] is the whole protocol, and it is a pure state machine:
//! events in ([`bridge::Bridge::on_keepalive`], [`bridge::Bridge::on_items_changed`],
//! [`bridge::Bridge::on_request`], [`bridge::Bridge::on_tick`],
//! [`bridge::Bridge::on_device_vanished`]), [`bridge::Effects`] out. It owns
//! no clock, no socket and no bus handle — time arrives as an explicit
//! monotonic `now`, so every protocol decision is reproducible.
//!
//! Around it sit two traits, [`transport::Transport`] (the broker) and
//! [`source::ItemSource`] (the bus), joined by [`runtime::apply`], which is
//! the one place effects become I/O.
//!
//! ## Recorded decision: a transport double, not a broker in CI
//!
//! The protocol tests drive the **production** path — the same
//! [`bridge::Bridge`], the same payload encoder and masker, the same
//! [`runtime::apply`] — against an in-memory [`transport::Transport`]
//! implementation instead of a real MQTT broker. Standing up mosquitto in CI
//! would test rumqttc's TCP client, which upstream already tests, at the cost
//! of a test that skips (and so reports green while asserting nothing) on
//! every machine without a broker. The abstraction boundary is deliberately
//! drawn *below* everything this crate is responsible for: topic grammar,
//! payload shape, masking, liveness gating, rate limiting and mode
//! enforcement are all above it and all covered. What the double does not
//! cover is the rumqttc wiring in [`runtime::run`], which is kept
//! correspondingly thin.
//!
//! # Write results do not travel
//!
//! A `W` becomes a `SetValue` and stops there. The grammar has no
//! acknowledgement topic and this bridge does not invent one: `SetValue`'s
//! result codes are mosd's contract with a bus client, and
//! `docs/design/bus.md` §3 keeps the reason inside mosd in any case. What a
//! subscriber observes is the item — a successful settings write arrives as
//! the `N` its `ItemsChanged` produces, and a successful action arrives as
//! the forced re-zero of §7 — so a refusal is precisely the absence of that.
//!
//! Nothing in this crate therefore switches on a result-code number, and
//! [`source::WriteOutcome`] is deliberately not those numbers. The
//! distinction that does matter to a remote client — a settings write that
//! did not persist is safe to retry, an action that did not dispatch was
//! already logged and recorded before the power call and is not — is a
//! property of the **path**, not of the code, and is drawn that way in
//! [`source::retry_note`].
//!
//! # Secrets
//!
//! `docs/design/bus.md` §8 redacts secrets **structurally at the source**: a
//! key named `password_hash`, `passwordHash`, `psk` or `hash`, at any depth,
//! is not an item at all, so the bridge should never see one. The
//! publish-side masking in [`payload`] is nevertheless required (PLAN-011 D6)
//! and applies the identical structural rule to every payload leaving this
//! process. It is defence in depth, not the primary control, and it should
//! find nothing to mask in practice.

pub mod bridge;
pub mod config;
pub mod item;
pub mod payload;
pub mod runtime;
pub mod source;
pub mod topic;
pub mod transport;
