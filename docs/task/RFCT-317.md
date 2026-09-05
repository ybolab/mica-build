# RFCT-317 PLAN-071 U1/U2/U3: the automatic update driver

- **status**: completed
- **priority**: P2
- **owner**: plan071-auto/bkd-f1xdmgc0
- **createdAt**: 2026-09-05 10:00

## Description

PLAN-071 approved `off | check | auto` with automatic installation inside a
maintenance window. Three of its backlog slices land here:

- **U1** — the `policy` and `rebootPolicy` enums, the `[autoCheck]` retirement,
  and the rule that `auto` requires at least one maintenance window.
- **U2** — the automatic driver: check → fetch → re-check → install, every step
  calling the function the manual route calls.
- **U3** — the reboot under `rebootPolicy`, honouring the safe-to-reboot gate,
  with the invariant that automation never arms the gate's override.

The re-check in U2 is the load-bearing part of §5: a verified bundle sitting in
`verified/` may have been withdrawn since it was fetched, and TUF offers no
revocation signal beyond the target's absence from the current metadata. So the
automatic path installs only what the current metadata still names and deletes
what it does not; a human installing a staged path is not stopped, because the
human may be doing it deliberately.

**§6's version suppression is U4 and is NOT in this task.** Without it `auto` is
a reboot loop — see §5 below, which states what the shipped code does today.

## ActiveForm

Building the automatic update driver and the policy enums it reads.

## Dependencies

- **blocked by**: (none)
- **blocks**: U4 (version suppression), U5 (deferral facts), U11 (the document's
  move to `/mos/config/updates.json` and its write route)

## Acceptance

- `policy` and `rebootPolicy` parse, default to `check`/`manual`, and render
  into `update.lifecycle.policy`; `[autoCheck]` is gone and any document
  carrying it is a load error.
- `auto` with zero maintenance windows fails validation with a message naming
  the rule, and the validator is one function with one spelling.
- The driver's check, fetch, install and reboot are the manual routes'
  functions, so no gate has a second implementation to bypass it in.
- The automatic path holds no capability to arm the reboot-gate override.
- `cargo check`/`cargo clippy -D warnings`/`cargo fmt --check` green for
  `-p mosd` in `localhost/mos-build-rust-check:amd64`.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

## 1. What U1 changed in `update_policy.rs`

`UpdateMode` (`off`/`check`/`auto`) and `RebootPolicy` (`manual`/`window`) join
the document as `policy`, `checkIntervalMinutes` and `rebootPolicy` — three
top-level keys. The Rust field for `policy` is `mode`, so that reading it is not
`policy.policy`; the wire key is the plan's.

`[autoCheck]` is retired rather than migrated. `AutoCheckPolicy` is deleted and
`intervalMinutes` moves up as `checkIntervalMinutes`. `deny_unknown_fields` is
already on the document, so a device carrying the old section fails to load and
fails closed — which is the intended outcome and not a migration path: PLAN-071
§1.1 says nothing migrates.

`validate` becomes `pub` and gains the `auto`-requires-a-window rule. Public
because U11's write route must refuse the same document at the API with the same
sentence the reader refuses it with, and two spellings of one rule is how they
drift. **The U1 gate as written — "refused at the API naming the rule" — is
therefore only half discharged here**: the reader refuses it, and there is no
API write route to refuse it at until U11 exists.

## 2. What U2 added

`pkgs/mosd/mosd/src/update_auto.rs`: one task, a 60-second tick, and a policy
re-read every turn. The tick is 60 seconds because a maintenance window is
`HH:MM`-precise and may be one minute long, so a driver that slept longer could
not honestly claim to act inside one.

Per tick, under `auto`:

| Step | Calls | Gates it meets |
|---|---|---|
| check | `UpdateLifecycle::check_now` | policy refusal, client availability, busy slot, workspace probe |
| fetch | `UpdateLifecycle::fetch_now` | the above plus metered-mode, `maxBytes` |
| re-check | `check_now` again | the same, and §5's withdrawal rule |
| install | the `InstallUpdate` route | maintenance window, bundle-path validation, storage reservation, install-in-flight |
| reboot | the `Reboot` route | the safe-to-reboot gate |

`request_check`/`request_fetch` were split into an admission, a run and a
settlement. The manual route spawns the run; the driver awaits it. Both go
through the same `admit_*` and the same `settle_*`, so "the automatic and manual
paths meet the same gate set" is a property of the code shape rather than of two
implementations agreeing.

The fetch step compares the check's candidate against the **staged file name**
rather than firing only when nothing is staged. That is what lets a pass move on
when the publisher released something newer between the fetch and the window.

## 3. What U3 added

`rebootPolicy = manual` stops at `reboot-required`. `window` reboots inside the
same window, through `request_reboot`, which asks the gate first. A closed gate
is a deferral with the gate's own reason; the next window re-attempts.

**Automation never arms the override, and it is structural.** The driver is
written against the `AutoRoutes` trait, and `SetRebootOverride` is not a method
on it. The driver holds `Arc<dyn AutoRoutes>` and nothing else, so there is no
path from the automatic code to the arming call — not "does not today", but
"cannot from here". `BusRoutes` in `bus.rs` is the only implementation and it
exposes install, reboot, the lifecycle's check/fetch and the RAUC-derived facts.

## 4. The pending-slot guard, which is not in the plan and is needed anyway

Between an install and its reboot the device runs the OLD system, so a check run
in that window selects the same candidate again — and would install it again,
into the slot the fallback needs, every tick of the window. The driver therefore
asks `GetUpdateState` for `pending_not_confirmed` before every automatic
install and defers while a slot is waiting for its first boot. An unanswered
RAUC query is not "nothing is pending": `facts()` answers `None` and the driver
defers.

## 5. What happens today in §6's loop, with U4 absent

It loops, and the record should say so plainly.

`auto` + `rebootPolicy = window`, a bundle that installs and fails to confirm:
the bootloader spends its credits, falls back, and the device boots the older
system. The next check finds the same version — still strictly newer than the
running one — the bundle is very likely still in `verified/` (a re-fetch is
idempotent when the digest matches), the re-check names it, the window opens,
and it installs again. Forever, once per window.

Under `rebootPolicy = manual` the loop is slower rather than absent: each
automatic install is followed by the pending-slot guard, so the device stops
until a human reboots — and the human's reboot restarts the cycle.

Nothing in this task closes that. **U4 is what closes it**, and the one place it
goes is marked in `install_if_allowed`, between the re-check and the install: the
re-check's `Available` already carries the version the suppression store would be
consulted with, and `version-suppressed` is already the vocabulary the deferral
call sites use.

## 6. Owed

- **U4** — the version suppression on STATE. Until it lands, `auto` with
  `rebootPolicy = "window"` can reboot-loop on a bad bundle; the only thing
  between a device and the loop is an operator setting `policy` back to `check`.
- **U5** — the deferral facts. Every reason PLAN-071 §2 names is already a
  `defer(...)` call site in the driver, and `defer`'s body is a log line; U5
  replaces the body rather than hunting for the sites.
- **§7's clock predicate** — an automatic install requires a clock the device
  believes. Not built: it is named in no U1/U2/U3 row, and its refusal reason
  (`clock-untrusted`) is U5's vocabulary. The install precondition list in
  `install_if_allowed` is where it goes.
- **U9** — `docs/design/updates.md` §2 still prints `[autoCheck]` in its policy
  example, which is now a load error. U9 owns that file (and the `docs/zh/`
  mirror that moves with it) and this task did not touch it.
- **Tests.** This batch was dispatched with per-task verification traded for
  wall-clock, so no test was written or run. Owed by name: U2's gate (the
  automatic and manual paths meet the same gate set), U3's gate (the automatic
  path against a closed gate arms no override), the `auto`-with-zero-windows
  refusal, and the re-check's three outcomes (still named, superseded,
  withdrawn-and-deleted).
- **A restart between an automatic install and its reboot** drops the owed
  reboot: `Stage` is process-local by design, and a reboot owed to an automatic
  install must not be inherited by whatever a human left staged. The device sits
  at `reboot-required` until a human reboots.
