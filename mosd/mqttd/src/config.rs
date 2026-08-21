//! What the bridge is told at startup, and the protocol's fixed timings.

use std::time::Duration;

/// Whether write requests are carried through to the bus
/// (`docs/design/bus.md` §10.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, clap::ValueEnum)]
pub enum Mode {
    /// `N` only. `W` topics are refused and never reach `SetValue`, and the
    /// bridge does not even subscribe to them — the refusal is belt and
    /// braces, because a broker that ignores the subscription set, or a
    /// message already in flight when the mode changed, must still be
    /// refused by the code that acts on it.
    ///
    /// The default: a bridge nobody configured cannot be a control path.
    #[default]
    ReadOnly,
    /// `W` topics become `SetValue` on the addressed item — which is
    /// sufficient for all control, since actions are writable items
    /// (`docs/design/bus.md` §7).
    Full,
}

impl Mode {
    /// Whether a write request may proceed to the bus.
    pub fn writes_allowed(self) -> bool {
        matches!(self, Self::Full)
    }
}

/// The protocol's three time constants (`docs/design/bus.md` §10.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Timings {
    /// How long one keepalive keeps the bridge publishing. Every publication
    /// is gated on this window: no keepalive, or an expired one, and the
    /// bridge is silent.
    pub alive_window: Duration,
    /// The interval between heartbeat publications while alive.
    pub heartbeat: Duration,
    /// The floor between two full republishes.
    ///
    /// This is the rate limit D6 asks for. A keepalive storm renews the alive
    /// window every time — that part is cheap and must not be throttled — but
    /// the full republish it asks for is coalesced: keepalives arriving inside
    /// the floor collapse into a single deferred republish rather than one
    /// per keepalive.
    pub full_publish_min_interval: Duration,
}

impl Default for Timings {
    fn default() -> Self {
        Self {
            alive_window: Duration::from_secs(60),
            heartbeat: Duration::from_secs(3),
            full_publish_min_interval: Duration::from_secs(5),
        }
    }
}

/// The bus name the bridge publishes for.
///
/// One service today. PLAN-011 D5's registry is what turns this into a set,
/// and when it does the change is here and in the runtime's subscription
/// bookkeeping — the grammar already carries `<class>/<instance>` for exactly
/// that reason.
pub const SERVICE: &str = "com.mos.mosd";

/// The item the device id is read from: `provisioning.deviceId` in the
/// settings tree, which is the slash path below on the bus (§4).
pub const DEVICE_ID_PATH: &str = "/provisioning/deviceId";

/// The `/Actions/<verb>` prefix (`docs/design/bus.md` §7). The bridge treats
/// these paths as ordinary items in every respect but one — see
/// [`crate::source::WriteOutcome`] on why a refused dispatch is not a refused
/// write.
pub const ACTIONS_PREFIX: &str = "/Actions/";
