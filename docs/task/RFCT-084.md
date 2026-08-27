# RFCT-084 mosd update orchestration: RAUC install and confirm over the bus, update state, and a Reboot that knows about an unconfirmed slot

- **status**: completed — InstallUpdate/GetUpdateState/MarkUpdate on the bus, install off the service lock, Reboot warns on an unconfirmed slot; mosd 249/249
- **completedAt**: 2026-08-23 05:20
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-21 10:25
- **claimedAt**: 2026-08-21 10:25

Base `db57f2c` (RFCT-083 commit); finished against `5cf74d1` after main had
advanced through PLAN-011 M1–M5 (the `com.mos.Item1` façade, `/Actions/*`,
mos-mqttd, the `com.mos.ext` namespace and the service scan all landed while
this workstream was open). One of the five roadmap workstreams the RFCT-083
audit named and deferred.

## Scope

Give mosd the update half it was missing: speak RAUC's D-Bus API
(`de.pengutronix.rauc` / `.Installer`) behind a mockable client, expose
install/query/mark on `com.mos.mosd1`, record everything observable under
`update` in the live-state tree, and make `Reboot` aware of a slot that is
installed but not yet confirmed — the case where a reboot burns one of the new
slot's boot attempts, recorded as a follow-up in `docs/design/mosd.md` §5.4 at
M5 and resolved here.

Explicitly OUT of scope, investigated first so nothing is duplicated:
**confirming the booted slot.** The boot health gate
(`os/rootfs/overlay-v2/usr/lib/mos/mos-health`) owns the automatic
`rauc status mark-good` — it probes systemd, mosd and apid and only then
confirms. An automatic mark in mosd would duplicate the gate and could confirm
a slot the gate would have failed. What mosd offers instead is `MarkUpdate`,
the *manual* operator escape hatch, validated down to `good`/`bad` on
`booted`/`other` (activation is the installer's job and is not offered).

## Provenance: a killed predecessor, and what survived it

A prior agent on this task was killed mid-work, leaving one uncommitted,
undeclared file: `mosd/mosd/src/rauc.rs`. Surveyed rather than assumed, it
turned out to be finished and good — the `RaucClient` trait, the production
`Rauc` client (lazy per-call connection, the `Networkd` shape;
Completed-signal subscription BEFORE `InstallBundle` so a fast failure cannot
be missed), `DryRunRauc`, the recording `MockRauc`, the curated `SlotStatus`,
the `pending_not_confirmed`/`unconfirmed_slot_warning` pair with its honest
limit stated, and a private-bus test that drives the production call path
against a fake `de.pengutronix.rauc` (so a typo'd member name goes red, which
a mock cannot do). All of it was kept as-is. What did NOT exist yet — this
task's work — was everything that makes the module reachable: the module
declaration, the service wiring, the three bus members, the live-state
recording, the Reboot awareness, the tests above the module, the policy-suite
coverage and the docs.

## What ships

**`mosd/mosd/src/rauc.rs`** (declared in `main.rs`): the inherited module,
plus three additions — `update_entry` (the one accessor for the live-state
`update` object, so no writer can clobber a sibling's key),
`validate_bundle_path` (absolute, exists, regular file — validated before the
in-flight flag or any record), and `validate_mark` (`good`/`bad` on
`booted`/`other`, nothing else).

**`mosd/mosd/src/bus.rs`**: `MosdService` gains an `Arc<dyn RaucClient>`
(builder `with_rauc`, defaulting to `DryRunRauc` — only `main.rs` attaches the
production client, and only outside dry-run) and an in-flight `AtomicBool`;
`inner` became `Arc<Mutex<…>>` so the install's background task can record its
outcome after the bus call returned. Three members on `com.mos.mosd1`:

- `InstallUpdate(bundle_path)` — validate, refuse a concurrent install
  (compare-exchange, released only by the background task after the outcome is
  recorded), record `update.install = running`, spawn. **Neither the service
  lock nor the bus dispatcher is held across the install.** Completion records
  `done`/`failed` (with the anyhow chain on failure) plus a fresh status
  query, and bumps the change marker so the item façade projects it
  (the RFCT-089 cross-workstream contract).
- `GetUpdateState()` — query RAUC **without the service lock**, merge
  field-by-field into `update` (so `install`/`last_mark` survive a refresh),
  answer the entry as JSON. A query failure is the caller's error and records
  nothing — last-known state stays, staleness distinguishable from absence.
- `MarkUpdate(state, slot)` — validate first, forward, record
  `update.last_mark`, answer RAUC's `(slot_name, message)`.

**Reboot awareness**: `request_reboot` — the path both the `Reboot` member and
`/Actions/reboot` dispatch through — reads slot status + primary first and,
when the bootloader's first pick is not the booted slot, logs a warning and
records it as `power.update_warning` beside `last_action`, BEFORE the power
call (the existing log-before-teardown contract). Bounded (2 s timeout) and
non-fatal: a reboot goes through when RAUC is absent (v1 image, container,
dry-run) or wedged — a reboot that hangs on an installer is worse than one
that misses a warning. `PowerOff` deliberately does not warn: it boots
nothing, so it spends no attempt.

**Policy surfaces**: `mosd/dist/com.mos.mosd.conf` needs no rule change (the
root-only blanket covers the new members) but its DEFERRED per-method note now
lists them — and records that mos-mqttd, the one non-root client that exists,
already is granted per-member. `mosd/hack/dbus-policy-test.sh` section 6
gained three refusal checks: the bridge uid CANNOT call `InstallUpdate`,
`MarkUpdate` or `GetUpdateState` (inherited from the blanket refusal, asserted
by name anyway because these are the members whose accidental grant would be
worst).

**Docs**: `docs/design/mosd.md` §5.4 — full member table (including the
previously missing `SetTransientRootPassword` and `ForgetService` rows), the
update-orchestration record, and the M5 burns-a-boot-attempt follow-up
resolved with its residue named; §5.5 restated for 2026-08-23.

## Verification (local; nothing observed on hardware)

Measured 2026-08-23 against `5cf74d1`, crate-scoped because a concurrent
workstream held `mosd/apid`:

- `cargo fmt -p mosd -- --check`, `cargo clippy -p mosd --all-targets -- -D
  warnings`: clean.
- `cargo nextest run -p mosd`: **249 tests, all green** (18 test functions new
  against HEAD: the inherited module's six — including the production-path
  fake-RAUC bus test — plus validator/entry units and nine bus-layer tests:
  install lifecycle `running → done` observed through a gated mock, concurrent
  install refused and the flag released after failure, path validation stops
  requests before the installer, query recorded-equals-answered with
  `pending_not_confirmed`, unreachable-RAUC query fails without a
  half-record, mark vocabulary enforced, and the three reboot cases — pending
  slot warns in `power.update_warning`, converged system has no key,
  unreachable RAUC still reboots).
- `mosd/mosd/tests/bus.rs` (`bus_roundtrip`) now also pins the PascalCase
  member names by introspection (`InstallUpdate`, `GetUpdateState`,
  `MarkUpdate`; snake_case absent) and drives all three over a real bus
  against the dry-run client.
- `bash -n mosd/hack/dbus-policy-test.sh` clean; the suite itself needs root +
  dbus-daemon and was not run here (same standing constraint recorded by
  RFCT-083's audit for this host).
- `make docs-verify` green.

## Deferred, recorded rather than half-built

- **The second unconfirmed window is invisible.** Booted into the new slot but
  before the health gate's mark-good: RAUC's U-Boot backend reads
  `BOOT_x_LEFT` only as exhausted-or-not, so `boot_status` cannot show
  pending-vs-confirmed. Closing it means the gate reporting its confirmation
  into mosd (e.g. via `ReportHealth`), an `os/` change out of this task's
  ownership.
- **apid has no update pane** and does not display `power.update_warning` or
  the `update` subtree; that is the UI half, out of scope here (the apid crate
  is another workstream's).
- **No `/Actions/*` update verbs.** PLAN-011 D3 anticipated them, but
  `InstallUpdate` carries an argument and answers matter (`MarkUpdate` returns
  RAUC's message), which the write-is-the-trigger action-item shape cannot
  carry. Methods now; an item projection can follow if the D3 grammar grows an
  argument convention.
- **No install progress streaming.** `GetUpdateState` is a polling surface;
  RAUC's `Progress` property is read per query, not subscribed. Fine for a
  minutes-long install polled by a UI; revisit only with a real consumer.
