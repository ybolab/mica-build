# RFCT-328 mosd records its own confirmed-boot fact, and the rollback guard orders installs by it

- **status**: completed
- **priority**: P1
- **owner**: bkd/6ewbkf81
- **createdAt**: 2026-09-05
- **baseline**: `9243aeea804e572b2423bf525cd58ee6d07ae980`
- **worktree**: `/srv/bkd/worktrees/33z9aa5q/6ewbkf81`, branch `bkd/6ewbkf81`

## Description

[PLAN-071](../plan/PLAN-071.md) §7, backlog item **U6**. The rollback guard's
central rule is that a rollback goes backward — the target must be the older
of the two installs — and until now the only thing that ordered them was
`installed.timestamp`, the wall clock the device happened to hold when RAUC
wrote the slot. `docs/design/updates.md` §5.2 records the consequence: a
device that installed with a wrong clock can record **an order that did not
happen**.

§7 is why that stopped being a footnote. A manual install has a witness — the
human who pressed the button knows when — and the automatic install U2/U3
shipped ([RFCT-317](RFCT-317.md)) has none. So `auto` has been standing on the
weaker story, and U6's gate row says what closing it means: *"dependency, not
an extra"* — the slice is done when `auto`'s rollback ordering **rests on**
the fact, not when the fact exists.

## ActiveForm

Recording mosd's own observation of the system it is running from, on STATE,
and making it the first ordering source the rollback guard asks.

## Dependencies

- **blocked by**: (none)
- **blocks**: U9/F10 — the design-doc sentences §7 lists below are the doc
  branch's to write, not this task's.

## Acceptance

- `pkgs/mosd/mosd/src/confirmed_boot.rs`: the fact, on STATE, ordered by a
  counter mosd mints and by no clock. §1, §2.
- `pkgs/mosd/mosd/src/rauc.rs`: `rollback_eligibility` — the consumer —
  orders the two installs by that record and reaches `installed.timestamp`
  only where the record cannot order them. §3.
- `pkgs/mosd/mosd/src/bus.rs`, `main.rs`: the observation is written on every
  update-state refresh, before the guard in that same refresh reads it. §4.
- Asserted in both directions: the record permits a rollback the clock
  refuses, and refuses one the clock permits. §5.
- `cargo test --locked -p mosd`, `cargo fmt --all -- --check`,
  `cargo clippy --workspace --all-targets --locked -- -D warnings` — green.
  §6.
- **Not done, deliberately**: no API route, no design-doc edit, no image
  composition, no bench. §7, §8.

## 1. What the fact is, and what it is grounded in

One entry per slot, in `<STATE>/update/confirmed-boots.json`:

```json
{ "boots": [ { "slot": "rootfs.1", "bundleVersion": "2026.08",
               "installedTimestamp": "2026-08-30T10:00:00Z",
               "sequence": 1, "firstSeenAt": "2026-09-01T10:00:00Z" } ] }
```

It is written when mosd observes **itself running from a slot** — the system
in that slot booted far enough to start the daemon that serves this API. That
is the whole of the observation, and it is deliberately not a reading of
anything the bootloader was told.

**The ordering key is `sequence`, and it is not a clock.** It is one higher
than any sequence the record already holds, minted by this store at the moment
of the first sighting. A wrong clock cannot move it, a clock that jumps
backward cannot invert it, and network time arriving later cannot rewrite it.
`firstSeenAt` is recorded beside it as evidence for a human and is never
compared — it is a reading of exactly the clock this record exists to stop
depending on.

**Why first-boot order IS install order.** An install is written into a slot
the device is not running from, and it is booted after it is written. So a
slot whose install mosd saw running earlier necessarily carries the earlier
install: at the moment the later one was written, the earlier one was already
the running system. The record answers the question `installed.timestamp`
answered, from an observation instead of from a timestamp — and it answers a
second one the timestamp only ever *implied*, that the target really did boot
(`docs/design/recovery.md` §3 node 2's precondition), because the entry exists
only because mosd ran there.

**Why that is better than the install timestamp, stated as the failure it
removes.** The timestamp route derives "the target booted successfully before"
from RAUC's invariant that an install never writes the running slot, and then
orders the two installs by a clock neither mosd nor RAUC vouches for. Both
halves can be wrong at once and nothing goes red. The record replaces the
second half entirely wherever it has seen both installs run, and it is also
robust to the first half in a way the derivation is not: a hypothetical
install path that DID write the running slot would change that slot's install
identity, so the record would simply hold no observation of the new system and
decline to order — where the timestamp route would keep deriving confidently
from a premise that had stopped holding.

**Identity, not name.** An entry matches a slot only when the bundle version
and the install timestamp still match too. A re-installed slot carries a
different system, and an entry about the system it used to carry must not read
as an observation of the one it carries now. The install timestamp appears
here as part of an identity compared for EQUALITY against the same slot's own
value — never as an ordering key, and nothing in the module compares two of
them.

## 2. Where it lives, and why it is not an operator key

STATE, not `/mos/config/`. PLAN-071 §9.1 settles the same question for the
downgrade floor and `update_suppress.rs` carries it unchanged: `/mos/config/`
holds what an integrator SETS and STATE holds what the device MINTS or
OBSERVES about itself. "mosd ran here" is squarely the second. The sharper
half applies too — since PLAN-070 §5.3 the operator document is also where the
source URL lives, so a single write that re-points a device at a hostile
server would be the same write that could reorder this device's own boots.

The store mirrors `SuppressionStore` in shape (a named JSON object, `0644`,
`fswrite::write_config`'s atomic rename, read fresh per decision, `none()` for
dry-run), which is also why nothing in `reset.rs` changes: the reset tiers do
not enumerate the suppression store either, and a reset does not un-boot
anything the device has already booted.

## 3. The consumer, and exactly how it changed

`rollback_eligibility` in `pkgs/mosd/mosd/src/rauc.rs` — the single place the
two installs are ordered anywhere in the tree (`installed_timestamp` is read
nowhere else in mosd or apid; checked, not assumed). Its backward-only step:

```rust
    match boots
        .older_install(target, booted)
        .or_else(|| older_install(target, booted))
```

mosd's own record answers first. The install-time clock is reached only where
the record cannot order the two installs — an install mosd never saw running,
a device whose record predates this code, an entry about a system a slot no
longer holds, or a store that did not parse. **In that fallback the verdict is
bit-for-bit the one it was before this task**, which is what the existing
timestamp tests keep asserting.

`auto`'s rollback story rests on this function and on nothing else: it is what
writes `update.rollback` into the live-state document, which is the single
read route for the verdict (`GET /api/v1/update`) and the guard `POST
/api/v1/update/rollback` consults. The automatic driver adds no ordering of
its own — it never orders two installs — so making this function's ordering
independent of the install clock is precisely what U6's gate row asks for.

## 4. Where the observation is made

`MosdService` holds the store; `main.rs` hands it the STATE path in the same
non-dry-run block that builds the suppression store, and a dry-run daemon gets
`ConfirmedBootStore::none()`, which observes nothing and writes nothing.

Both update-state refreshes observe before they merge, so the guard in a
refresh reads the record that refresh just wrote:

- `refresh_update_state` — every `GetUpdateState`.
- the background install task's refresh — the observation is about the slot
  the daemon is RUNNING from, which an install does not change, so recording
  it there keeps the two refreshes reading one record.

The write happens only when the sighting is new: once per install, not once
per poll. A repeat sighting deliberately keeps the FIRST sequence — re-stamping
on every poll would walk a record forward past installs that really are newer
and invert the ordering it exists to establish.

Never fatal. An unreadable record is logged and NOT overwritten (it may hold
boots nothing else witnessed, and a fixed parser could still read them); a
failed write is logged; both leave the guard on the install-time clock. A
daemon that refused to serve the update state because it could not write a
note about its own boot would be the worse failure.

## 5. What is asserted

New, in `rauc.rs` — the consumer, in both directions:

- `mosd_s_own_boot_order_overrules_a_wrong_install_clock` — the timestamps say
  the alternate is NEWER and the same case is asserted refused without the
  record; with mosd's observations the rollback is permitted, and the mark is
  still `("bad", "booted")`.
- `mosd_s_own_boot_order_also_refuses_what_the_clock_would_permit` — the
  mirror, and the one that matters more: the timestamps permit, the record
  says the alternate booted AFTER the running system, the guard refuses
  `alternate_is_newer`.
- `a_record_that_cannot_order_the_two_installs_leaves_the_clock_deciding` —
  a record holding only the running system, and a record holding a stale entry
  for the alternate, each produce a verdict EQUAL to the no-record one.
- `a_factory_flash_that_wrote_both_slots_still_fails_closed` — equal stamps
  plus an alternate mosd never saw run stays `install_order_unknown`. §7.
- `no_input_lets_a_rollback_mark_the_target_good` gains a third ordering
  dimension (no record; the two slots observed in either order), so PLAN-048's
  invariant is enumerated over the source the guard now asks FIRST rather than
  only over the one it now asks second.

New, in `bus.rs` — the wiring, through the surface that serves the verdict:

- `a_refresh_records_mosd_s_own_boot_and_leaves_the_clock_deciding` — the
  first refresh writes exactly one entry, for the booted slot, at sequence 1.
- `the_recorded_rollback_verdict_follows_mosd_s_own_boot_order` — a seeded
  record plus a lying install clock, and the recorded `rollback` object comes
  out `permitted` with the alternate as `target`.

New, in `confirmed_boot.rs` — the store: first sequence, idempotent repeat, a
re-install replacing that slot's entry with a higher sequence, ordering that
contradicts the install clock, the two shapes that decline to order, an
unreadable record left intact, and a `none()` store observing nothing.

## 6. Verification

Run in the worktree, against `pkgs/mosd`:

- `cargo test --locked -p mosd` in `localhost/mos-build-rust:amd64` —
  **516 unit tests pass, 0 failed**. `tests/bus.rs::bus_roundtrip` FAILS in
  that image and the failure is the image, not the change: the test asserts
  real bus behaviour over a private session bus and refuses to skip, and
  `mos-build-rust:amd64` carries no `dbus-daemon` (`command -v dbus-daemon`
  finds nothing). It is not a test this branch touches.
- The same `cargo test --locked -p mosd` in
  `localhost/mos-build-rust-check:amd64`, which does carry `/usr/bin/dbus-daemon`
  — **516 + 1 + 7 pass, 0 failed**, `bus_roundtrip` included.
- `cargo fmt --all -- --check` — clean.
- `cargo clippy --workspace --all-targets --locked -- -D warnings` — clean.
  `--all-targets` and `--workspace`, so apid, mqttd, broker and the test trees
  all compile against the changed signature.

**Not run**, per the batch working mode this dispatch set: `cargo nextest`,
`cargo test --doc` (this task adds no doctest — no ``` block was written into
any doc comment), `cargo deny` (no dependency changed), image composition,
`verify/run.sh`, and the bench. U10 is the bench slice and it is
hardware-blocked; it was not attempted.

## 7. The two shapes §7 does not decide, and why neither needed deciding

The dispatch said to stop rather than invent a design decision about a slot
mos never installed into or about a factory flash that wrote both slots at
once. `rauc.rs`'s existing reasoning already answers both, and this change
leaves both answers exactly where it found them:

- **A slot mos never installed into** is refused before ordering is ever
  consulted — `alternate_never_installed` fires on "no bundle version and no
  install timestamp". "What confirmed means" for it therefore never arises:
  the record simply holds no entry for a system that never ran, and the
  earlier refusal decides. Nothing new is asserted about such a slot.
- **A factory flash that wrote both slots at once** shows up as equal
  timestamps and `install_order_unknown`, failing CLOSED on purpose. mosd has
  only ever run from one of the two, so the record cannot order them either,
  and the refusal is unchanged — asserted, so a later change cannot quietly
  turn it into a permission.

The chosen rule is the narrow one for that reason: the record ORDERS the two
installs where it has seen both run, exactly as §7 says `auto`'s ordering
depends on it, and it never introduces a refusal of its own.

**The residual gap, named rather than closed.** An alternate whose install
mosd never observed running is still ordered by the install clock. Making
"mosd never saw the target run" a refusal in its own right would close it —
and would be a NEW rule about devices whose history predates this record, plus
a new refusal reason on a surface a concurrent branch owns. That is a decision
PLAN-071 §7 does not make, so it is reported and not taken.

## 8. What was deliberately not touched

- **No API route, and no new refusal reason.** The dispatch forbade route
  edits this week, and a new reason would have to be added to apid's
  `ROLLBACK_REASONS` and to `openapi.json`, which another branch owns. The
  reason vocabulary is unchanged at seven; what changed is which verdict the
  device reaches, not what it can say. **If the fact should be served**, the
  shape I would add is a `rollback.orderedBy` member on the existing
  `GET /api/v1/update` answer (`confirmed-boot` | `install-timestamp`) — one
  key, no new route, and it makes a support case answerable without reading
  STATE. L1 sequences it.
- **No design document.** `docs/design/updates.md` §5.2 and
  `docs/design/recovery.md` §3 node 2 both still say the ordering is
  `installed.timestamp` and that the fact "is a separate design". The doc
  branch owns the edit (U9/F10); the sentences are named in the report.
- **`pending_not_confirmed` and its HONEST LIMIT are unchanged.** The health
  gate still owns PENDING_CONFIRM -> CONFIRMED, mosd still marks nothing, and
  `an_unconfirmed_booted_slot_leaves_the_rollback_to_the_bootloader` is
  untouched and still passes. This record changes what mosd KNOWS about
  ordering, not who acts.
- **No env-var override for the record's path.** `MOSD_UPDATE_SUPPRESSION_PATH`
  exists because the automatic driver's tests drive that store; nothing here
  needs one, and an unused relocation knob on a STATE fact is surface with no
  caller.
