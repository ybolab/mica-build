//! The `/Actions/<verb>` items: actions are writable items
//! (`docs/design/bus.md` §7).
//!
//! An action item is neither a setting nor live state. Its value **always
//! reads `0`**; a `SetValue` on it *triggers* the action, and the value is
//! forced back to `0` with a change signal afterwards — so the consumption
//! edge of every trigger is observable even though the value never actually
//! moves (the `VeQItemAction` semantics, `veutil ve_qitem_utils.hpp:146-162`).
//!
//! Nothing here logs the request or records it in live state. Every verb
//! dispatches through the [`MosdService`] request path that already does both
//! **before** the power call — the existing `Reboot`/`PowerOff` contract,
//! preserved by reusing it rather than by restating it.

use std::collections::BTreeSet;
use std::sync::Mutex;

use zbus::fdo;

use crate::bus::MosdService;

/// Every action item's value, at every moment (`docs/design/bus.md` §7): `0`
/// before a trigger, `0` in `GetItems`, and forced back to `0` after one.
pub const IDLE: i64 = 0;

/// The action verbs mosd publishes as items.
///
/// `Ord` because [`Actions`] keeps pending triggers in a set — see there for
/// why a set is the right shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Action {
    /// `/Actions/reboot` — [`MosdService::request_reboot`].
    Reboot,
    /// `/Actions/poweroff` — [`MosdService::request_power_off`].
    PowerOff,
}

impl Action {
    /// Every verb, in the order they are projected into the item tree.
    pub const ALL: [Self; 2] = [Self::Reboot, Self::PowerOff];

    /// This action's absolute slash path, which is also the object path its
    /// item is served at.
    pub const fn path(self) -> &'static str {
        match self {
            Self::Reboot => "/Actions/reboot",
            Self::PowerOff => "/Actions/poweroff",
        }
    }
}

/// The action items' one piece of state: which triggers have not yet had their
/// forced re-zero emitted.
///
/// Shared between the item objects that dispatch (`crate::tree::Item`) and the
/// change watcher that emits (`crate::tree::run`), because the edge has to
/// ride the coalesced `ItemsChanged` rather than a signal of its own — a
/// second signal in the same turn would break the coalescing guarantee
/// (`docs/design/bus.md` §1.1).
#[derive(Debug, Default)]
pub struct Actions {
    /// A set, not a queue: two triggers of one verb inside a single turn
    /// collapse to one payload entry, which is all a path-keyed
    /// `ItemsChanged` map can carry anyway.
    triggered: Mutex<BTreeSet<Action>>,
}

impl Actions {
    /// A registry with nothing pending.
    pub fn new() -> Self {
        Self::default()
    }

    /// Trigger `action` on behalf of `sender`.
    ///
    /// The consumption edge is recorded **before** dispatching, for two
    /// reasons: the request path marks the tree changed while recording the
    /// request, so the edge and the live-state power record leave in ONE
    /// coalesced signal; and on a real reboot the edge is already pending
    /// before systemd starts tearing the process down.
    ///
    /// Nothing is validated and nothing is stored — an action item ignores the
    /// value written to it, because the write *is* the trigger.
    ///
    /// # Errors
    ///
    /// Whatever the underlying power request failed with. The caller turns
    /// that into the `SetValue` result code and logs the reason locally; it
    /// never travels back to the bus caller (`docs/design/bus.md` §3).
    pub async fn trigger(
        &self,
        service: &MosdService,
        action: Action,
        sender: &str,
    ) -> fdo::Result<()> {
        self.triggered
            .lock()
            .expect("actions registry lock")
            .insert(action);
        let result = match action {
            Action::Reboot => service.request_reboot(sender).await,
            Action::PowerOff => service.request_power_off(sender).await,
        };
        // Wake the change watcher explicitly rather than leaning on the
        // request path having marked the tree itself: the forced re-zero is a
        // change of its own, and a future verb that touches no tree would
        // otherwise sit pending until something unrelated moved.
        service.mark_changed();
        result
    }

    /// Take the pending consumption edges, leaving none behind.
    ///
    /// Called once per projection turn by `crate::tree::run`, which turns each
    /// into the forced `0 -> 0` entry of that turn's `ItemsChanged` payload.
    pub fn take_triggered(&self) -> Vec<Action> {
        std::mem::take(&mut *self.triggered.lock().expect("actions registry lock"))
            .into_iter()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_action_has_a_distinct_path_under_the_actions_prefix() {
        let paths: Vec<&str> = Action::ALL.iter().map(|action| action.path()).collect();
        assert_eq!(paths, ["/Actions/reboot", "/Actions/poweroff"]);
        for path in &paths {
            assert!(
                path.starts_with("/Actions/"),
                "an action item lives under /Actions (docs/design/bus.md §7): {path}"
            );
        }
    }

    #[test]
    fn pending_edges_are_taken_once_and_collapse_per_verb() {
        let actions = Actions::new();
        assert!(
            actions.take_triggered().is_empty(),
            "nothing is pending before a trigger"
        );

        actions.triggered.lock().expect("lock").extend([
            Action::Reboot,
            Action::PowerOff,
            Action::Reboot,
        ]);
        assert_eq!(
            actions.take_triggered(),
            vec![Action::Reboot, Action::PowerOff],
            "a repeated verb is one entry: a path-keyed payload cannot hold two"
        );
        assert!(
            actions.take_triggered().is_empty(),
            "an edge is emitted exactly once"
        );
    }
}
