# RFCT-030 Power actions: mosd Reboot/PowerOff + webd POST routes

- **status**: implementation complete
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 00:23
- **claimedAt**: 2026-08-19 01:38
- **completedAt**: 2026-08-19 02:05

## Description

RAUC installs an update into the inactive slot; a **reboot** is what activates
it. Until this task, nothing in mos could ask for one. `mos-health` could mark
a boot good, RAUC could stage a slot, and the operator still had no way to get
from "installed" to "running" other than a shell.

This task adds the missing step: `Reboot` and `PowerOff` as methods on
`com.mos.mosd1`, forwarded to systemd, and exposed in webd as authenticated
POST-only routes behind an explicit confirmation.

### Layering

webd is the UI; mosd owns system actions. webd does not spawn processes, does
not talk to systemd, and does not touch `/sbin/reboot`. Its only route to a
power action is `com.mos.mosd1`. The two new `SettingsApi` methods
(`reboot`/`power_off`) are D-Bus calls like every other method on that trait.

### Not a reconciler

These live in `mosd/mosd/src/power.rs`, not `mosd/mosd/src/reconciler/`. A
reconciler converges a settings subtree and re-applies on boot; a power action
has no settings subtree, nothing to converge, and nothing to re-apply. The
`PowerControl` trait duplicates a little boilerplate with
`reconciler::systemd::UnitControl`, which is correct: that one is for unit
lifecycle, this one is for manager-level actions.

### No new settings

`mosd-settings` is untouched and `SCHEMA_VERSION` stays at 3. A power request
is recorded in the **live-state** tree under `power` as
`{"last_action": ..., "requested_by": ...}` — state, not settings, and not
persisted.

## What was built

### mosd

`mosd/mosd/src/power.rs` (new):

- `PowerControl` — the trait; `reboot()` and `power_off()`.
- `Systemd` — production impl. Calls `Reboot` / `PowerOff` on
  `org.freedesktop.systemd1.Manager` at `/org/freedesktop/systemd1`, service
  `org.freedesktop.systemd1`, over the system bus. The connection is made
  lazily inside the call, so constructing it never touches the host.
- `DryRunPower` — no-op impl selected when `MOSD_DRY_RUN=1`.
- `MockPower` — `#[cfg(test)]` recording impl used by the bus-layer tests.

`mosd/mosd/src/bus.rs`: `Reboot` and `PowerOff` on `com.mos.mosd1`. Each takes
the message header, resolves the caller's unique bus name, and calls
`request_reboot` / `request_power_off`, which **log the action and its source
and record it in live state before invoking `PowerControl`** — after the call
there may be no system left to log on.

`mosd/mosd/src/main.rs`: constructs `DryRunPower` under dry-run and
`Systemd::new()` otherwise, and injects it into `MosdService`.

### webd

`GET /power` renders the pane. `POST /power/reboot` and `POST /power/poweroff`
perform the actions. There is no GET handler for either action path — a GET
gets 405, so a browser prefetch, a crawler, or a mis-clicked link cannot power
the appliance off.

Both action routes sit behind the existing gate middleware and session check;
no new auth mechanism was added.

The confirmation is a required checkbox whose value is the action's own token
(`reboot` / `poweroff`), and the handler rejects anything else with 422 without
touching the bus. The other action's token does not unlock this one.

The handler answers **202 Accepted with a rendered page** and hands the D-Bus
call to a detached task, so the operator gets a page rather than a dropped
connection when the machine goes down mid-call.

## Testing

The rule taken from the M4 `RAUC_SYSTEM_BOOTED_SLOT` defect — where a wrong
name was green everywhere because the mock was handed the same wrong name — is
that a mock may not be the only thing proving a name.

`power::tests::production_path_dispatches_to_the_real_systemd_names` stands up
a **fake systemd on a private session bus**: it claims
`org.freedesktop.systemd1`, serves `org.freedesktop.systemd1.Manager` at
`/org/freedesktop/systemd1`, and declares its members as the literals `Reboot`
and `PowerOff`. The test then drives the **production `Systemd` impl** at that
bus. A wrong service name, object path, interface or member fails to dispatch
and the test goes red. The same test also asserts that a member the fake does
not serve (`Halt`) errors, so dispatch is demonstrably name-sensitive rather
than accepting anything.

Coverage otherwise:

- `bus::tests` — `request_reboot` / `request_power_off` against `MockPower`,
  asserting the exact call and that the live-state record exists afterwards;
  plus a test that neither touches the settings tree.
- `mosd/mosd/tests/bus.rs` — D-Bus members `Reboot` and `PowerOff` over a
  private bus, asserting each runs its own handler and that `requested_by` is
  the caller's unique name.
- `webd/src/tests.rs` — confirmed POST reaches mosd; unconfirmed POST, the
  wrong token, anonymous POST, forged-cookie POST, setup-mode POST and GET on
  both action paths are each rejected **and asserted not to have reached the
  power API at all**, not merely to have returned the right status.
- `webd/tests/e2e.rs` — the full webd → D-Bus → mosd path on a private bus.

### No test can power off the build host

Three independent reasons, in order of how early they stop it:

1. Every test that spawns `mosd` spawns it with `MOSD_DRY_RUN=1`, under which
   `main.rs` builds `DryRunPower` and never constructs `Systemd`.
   `Systemd::new()` — the only thing that reaches the host system bus — is
   constructed at exactly one place in the tree, `main.rs`, in the non-dry-run
   branch.
2. Both integration tests assert `dry_run == true` over the bus **before**
   issuing any power request, so removing `MOSD_DRY_RUN` from the harness
   fails the test before a power method is invoked, not after.
3. The one test that exercises the production `Systemd` impl uses
   `Systemd::at_address`, a `#[cfg(test)]` constructor pointed at a private
   `dbus-daemon --session`. It cannot reach the system bus.

Whether the appliance actually reboots is hardware acceptance and is not
claimed here.

## Recorded follow-ups (not implemented)

- **Rebooting a PENDING_CONFIRM slot burns a boot attempt.** A slot that RAUC
  has installed but that has not yet been marked good has a limited number of
  boot attempts. Rebooting into it spends one. The power pane has no update-state
  awareness and does not warn about this. A later milestone may want the UI to
  surface the pending-confirm state next to the reboot button. Deliberately not
  built here: it would make the power pane depend on update state, which is a
  different subsystem.
- **No auto-reboot after `rauc install`.** Installation does not trigger a
  reboot and should not. The user decides when the appliance goes down. This is
  a decision, not a gap.

## Deviation from the task's declared file scope

The spec listed `webd/src/routes.rs`, `webd/src/tests.rs` and
`webd/tests/e2e.rs` as the webd files in scope. Two more had to change, because
webd's only sanctioned path to mosd runs through them:

- `mosd/webd/src/settings_api.rs` — `reboot()` / `power_off()` added to the
  `SettingsApi` trait and to the test fake. Without this the routes have no
  mosd-shaped API to call.
- `mosd/webd/src/bus_client.rs` — the two zbus proxy methods and their
  `SettingsApi` impl. This is the actual D-Bus call.

The alternative — a second trait object on `AppState` — would have needed a
`main.rs` change as well and bought nothing. No settings were touched, no
schema bumped, and no dependency added; `mosd/Cargo.lock` is unmodified.
