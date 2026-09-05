# RFCT-321 PLAN-071 U4/U5 and §7's clock predicate: close the reinstall loop

- **status**: completed
- **priority**: P1
- **owner**: plan071-suppression/bkd-24igw0ag
- **createdAt**: 2026-09-05 09:00

## Description

RFCT-317 landed U1/U2/U3 and stated what it left open. The largest item was
the one PLAN-071 §6 calls **the single most important safety property in this
plan**: with `auto`, `rebootPolicy = "window"` and a bundle that installs and
fails to confirm, the bootloader spends its credits and falls back, the device
boots the OLDER system, the failed version is once again strictly newer than
the running one, and the next window installs it again. Forever. The only
thing between a device and that loop was an operator setting `policy` back to
`check`.

This task builds:

- **U4** — the version suppression on STATE, its clearing action and its
  audit;
- **§7's clock predicate** — an automatic install requires a clock the device
  believes, refusal reason `clock-untrusted`;
- **U5** — the deferral facts, plus the channel-has-no-newer-release reason;
- the `docs/design/updates.md` §2 policy example, which still printed
  `[autoCheck]` and was therefore a **load error** on a document carrying
  `deny_unknown_fields` — a device configured from the shipped example failed
  closed.

## ActiveForm

Building the version suppression, the clock predicate and the deferral facts.

## Dependencies

- **blocked by**: RFCT-317 (U1/U2/U3) — landed
- **blocks**: U7 (the console's deferral display and the "already on the
  previous system" string), U9 (the rest of `updates.md`), U11 (the
  document's move; the suppression store must NOT move with it)

## Acceptance

- A version whose slot rolled back is recorded on STATE with the evidence
  (slot, instant, boot status), and the automatic path will not select it
  again; a manual install of it is still permitted.
- An operator clears one named suppression explicitly, and the clearing is
  audited on both sides.
- An automatic install is refused with `clock-untrusted` unless the device
  believes its clock in `docs/design/time.md`'s terms.
- Every automatic refusal is visible in `update.lifecycle.deferred` with its
  reason, the refusing rule, when it first applied and how many attempts it
  has refused.
- `docs/design/updates.md` §2's example loads.
- `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`
  green in `localhost/mos-build-rust-check:amd64`.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md`
  untouched.

## 1. U4 — the suppression

`pkgs/mosd/mosd/src/update_suppress.rs` is a JSON document on STATE
(`/var/lib/mos/update/suppressed-versions.json`, overridable with
`MOSD_UPDATE_SUPPRESSION_PATH`), read fresh per decision, holding one record
per refused version: the version, the slot it was written into, when the
rollback was first seen, the slot's boot status, and the sentence an operator
reads.

**On STATE, and derived from the state directory rather than from the policy
path.** §9.1 settles the same question for the downgrade floor and its
reasoning carries here unchanged: `/mos/config/` holds what an integrator
sets, STATE holds what the device observes about itself, and — the sharper
half — since PLAN-070 §5.3 the operator document is also where the *source
URL* lives, so the single write that re-points a device at a hostile server
would be the same write that could lift the refusal, if the refusal lived
there. The path is built from `state_dir_for(settings_path)` so that U11's
move of the policy document to DATA cannot take the store along.

**Fail-closed, and in the direction that matters.** A store that exists and
does not parse is NOT an empty store: `SuppressionStore::load` answers the
records *and* the error, and the automatic path defers on the error
(`suppression-unreadable`). Reading an unreadable store as "nothing is
suppressed" is precisely how the loop restarts.

**Where the record is written.** `UpdateLifecycle::refresh` — the one place
holding a fresh slot list beside the phase derived from it. The predicate
`rolled_back_slot` is now one function used by both `derive_boot_phase` and
the recorder, so the device cannot report a rollback it did not suppress. The
write is idempotent and keeps the FIRST evidence: `refresh` runs on every
`GetUpdateState` while the failed slot is visible, and overwriting would walk
the timestamp forward on every poll and lose the moment the failure happened.

Recording it in `refresh` rather than in the driver also means the loop closes
without anything else polling: the driver's own pending-slot guard calls
`GetUpdateState` before every automatic install, so the sequence inside one
tick is *refresh records the suppression* → *re-check names the same version*
→ *install refused*.

**Where it is consulted.** Twice, both on the automatic path only:

- in `drive`, before the fetch, so a metered link does not pay for the same
  bad bundle once per window — and the pass stops there rather than falling
  through, so the recorded reason names the suppression instead of whatever
  happens to be staged;
- in `install_if_allowed`, between the re-check and the install, which is the
  site RFCT-317 marked: it is the first point at which the version about to
  be written is known rather than guessed at.

Nothing on the manual path reads the store, which is how "a manual install of
a suppressed version is permitted" is a property of the code shape rather than
of a check that remembered to exempt humans.

**Clearing.** `ClearUpdateSuppression(version)` on `com.mos.mosd1`, exposed as
`POST /api/v1/update/clear-suppression`. The version is named and there is
deliberately no member that empties the store: an operator who has diagnosed
one bad release has not thereby diagnosed the others. A version that is not
suppressed is `InvalidArgs` → **422**, so a typo cannot read as a successful
clearing. Audited on both sides — mosd logs sender, version, slot and the
instant the suppression was taken; apid records `update-clear-suppression`.

The store is served read-only beside the policy that reads it, as
`update.lifecycle.suppressed[]` (with `suppressed_error` when it cannot be
read), so "this device refuses 1.5.0" always comes with its reason.

## 2. §6's rollback refusal — and §6 names the wrong code

§6 warns that after an automatic install and an automatic fallback the booted
slot is the older system and the alternate holds the newer failed one, so
`rollback_eligibility` refuses a manual rollback with `alternate_is_newer` —
correctly, and confusingly.

**On this device it refuses with `alternate_marked_bad` instead, and §6's
prediction is off by one guard.** `rollback_eligibility` checks the
alternate's `boot_status` BEFORE it orders the two installs, and after a
fallback the failed slot's U-Boot credit counter is exhausted, which is
exactly what `boot-status: bad` reads as (`rauc.rs`: the counter as a
boolean). So the post-fallback refusal is `alternate_marked_bad`.
`alternate_is_newer` is still reachable in this flow, at a different moment —
between an automatic install and its reboot, where the alternate holds a newer
system that has not booted yet.

Both are now explained rather than left as a raw code.
`RollbackEligibility::explanation` gives each of those two reasons a sentence
and `to_json` carries it as `rollback.explanation`; the other five reasons
keep `null`, because a member that is present only where it adds something is
one a reader can trust. The `alternate_marked_bad` sentence is the string §6
owes: *you are already on the previous system*. Rendering it is U7's.

## 3. §7's clock predicate

`ClockTrust` in `time_status.rs` gathers the two signals `docs/design/time.md`
already defines — §5's classification (`synchronized` is timedate1's
`NTPSynchronized`, i.e. the kernel's `maxerror < 16 s`, the same limb
RFCT-311's S4 uses) and §3's saved floor — and `believed()` is §7's rule
verbatim: *`synchronized`, or a floor that has advanced since boot*. No third
notion of trusted time was invented.

It is the FIRST precondition in `install_if_allowed`, ahead of the window,
because every other precondition is judged against a wall clock: a window
verdict computed from a clock nobody vouches for is not a verdict, and
refusing on the window afterwards would report the wrong reason for the same
refusal. Checks and fetches are unaffected — neither is time-keyed, and
refusing them would make a clockless device stop even discovering updates.

**What the floor limb actually asserts, stated because it is weaker than it
looks.** `saved_floor_advanced` is `mtime(/var/lib/systemd/timesync/clock) >
boot instant`. timesyncd touches that file every `SaveIntervalSec`, so on a
device where the mechanism is alive this limb is true within a minute of boot
and the predicate reduces to "the floor mechanism is running". It therefore
catches a dead floor — STATE not bound (the rootfs is squashfs, so the write
fails and the mtime never moves), timesyncd not running, the file absent — and
it does NOT catch a floor that is alive and absolutely wrong. That is what §7
asks for (`offline-degraded` *with no advance* is the deferral case) and it is
all the offline evidence there is; the stronger claim is the `synchronized`
limb. Named here so that nobody reads `clock-untrusted` as "the time is
right".

## 4. U5 — the deferral facts

`defer`'s body was a log line; it now also records. `update.lifecycle` gains a
`deferred` object with `reason`, `detail` (the refusing rule verbatim),
`since`, `at`, `waitedSeconds` and `attempts`. The same reason arriving again
extends the fact — `since` stays put and `attempts` rises — and a different
reason starts a new one, because the clock it would otherwise inherit belongs
to a different refusal. That is what makes "a permanently blocking
application" distinguishable from "a stuck update", which §2 says it must be.

Reasons reachable today: `clock-untrusted`, `outside-window`,
`reboot-gate-closed`, `version-suppressed`, `suppression-unreadable`,
`no-newer-release`, `check-refused`, `fetch-refused`, `install-refused`,
`recheck-failed`, `recheck-refused`, `workspace-unready`,
`slot-status-unknown`, `reboot-pending`, `superseded`.

`no-newer-release` is U5's second half: a check that finds the channel up to
date renders as plain `idle`, which is also what a device that has never
checked renders as. It is now recorded under both `check` and `auto`, naming
the channel.

Clearing is deliberate rather than blanket. `resume(Some(reason))` clears one
reason and is used where a step supersedes exactly that fact (a check that
finds a release ends `no-newer-release` and says nothing about the window);
`resume(None)` clears everything and is used at the two points where a pass
ran to its end — the install started, and the reboot was issued.

## 5. The document that taught a load error — and it got worse mid-task

`docs/design/updates.md` §2's example printed `[autoCheck] intervalMinutes`,
which `deny_unknown_fields` makes a load error: a device configured from the
shipped example failed closed. That was the brief.

**Then main landed PLAN-070 F5/F6/F6b (RFCT-313) and the whole example
became wrong** — not one stale key in it, but its format, its path and its
layering. `/var/lib/mos/update-policy.toml` is retired; the operator document
is `/mos/config/updates.json`, JSON, resolved per key over a baked
`/usr/share/mos/meta/updates/manifest.json`, with no `source.rootPath` at
all. RFCT-313 records `docs/design/updates.md` as owed by PLAN-070 **F10**.

Fixing the `[autoCheck]` line alone would have left a TOML example for a JSON
document at a path nothing reads — a smaller lie told more confidently. So §2
now describes the two layers, which four keys are overridable and what an
absent-versus-`null` key means, the fail-closed rule in its post-precedence
form (an unreadable document resolves to **no selection**, not to the baked
one), and the operator document with every key it accepts. A blockquote at
the top of §2 says plainly that F10 owns the full rewrite and that what is
there is the shape the shipped reader parses.

Held to that: §3's auto-check bullet, which named `intervalMinutes` and
claimed nothing is ever fetched or installed automatically, is now the three
modes. Nothing else moved. `mosd.md` and `release-signing.md` still name
`update-policy.toml` in passing and are left to F10 — neither teaches a
configuration that fails to load, which is the line this task was told to
cross for.

Both examples were extracted and parsed (the TOML one before the merge, the
JSON one after), and every key checked against the serde names in
`mosd-settings/src/configuration.rs`. No `docs/zh/` mirror is owed:
`docs/zh/verify-coverage.sh` gates `docs/{user,website,bsp}` and this file is
under `docs/design/`.

`docs/design/api.md`'s update row and `updates.md` §5.4's audit-event list
each gained the new action. Both are enumerations, and an enumeration that
omits an event this task shipped is a defect this task introduced — repairing
that is not U9's slice.

## 6. Reconciled with PLAN-070 F5/F6/F6b, which landed on main mid-task

`18cf6110` brought the baked reader and the precedence in on the same files.
Two textual conflicts and one semantic one:

- **`main.rs`** — `with_update` now takes the policy store *and* the
  suppression store, and the policy store carries the baked layer. The
  suppression path is built from `state_dir_for(settings_path)` and not from
  the policy path, which is what makes it survive this exact move; the
  comment that said so was written before the move landed and is now
  literally true.
- **`update_lifecycle.rs`** — the import block; both sides' lines kept.
- **The driver's channel read.** `loaded.policy.source.channel` is now
  `loaded.policy.selection`, an `Option`, because §5.1 forbids falling back
  to the baked channel when the operator document did not load. The
  `no-newer-release` detail reads it through a `match` rather than an
  `unwrap`: the unnamed arm is unreachable from there — a device with no
  selection has no cadence either — and is written out so a later caller
  cannot make it panic.

The merge also moved the ground under §5 of this record; see it.

## 7. Gates, as run

This batch was dispatched with per-task verification traded for wall-clock, so
the floor is "it compiles" and the coverage moved to L1's gate battery.

- `cargo fmt --all --check` — PASS.
- `cargo clippy --workspace --all-targets --locked -- -D warnings` — PASS,
  both crates re-checked.
- `cargo check -p mosd --all-targets`, `cargo check -p apid --all-targets` —
  PASS.
- `cargo run -p apid -- --openapi` — run, and its output committed as
  `pkgs/mosd/apid/openapi.json`, which
  `the_committed_openapi_document_is_the_generated_one` asserts byte for byte.
  Re-generated after the merge and confirmed identical to the committed file.
- The §2 example — extracted and parsed, and its keys checked against the
  reader's serde names.
- `bash docs/verify-links.sh` / `verify-index.sh` / `verify-status.sh` /
  `docs/zh/verify-coverage.sh` — PASS (450, 183, 734, 231).

Every Rust gate was run twice: before the merge with main, and again after
it. All inside `localhost/mos-build-rust-check:amd64`.

## 8. NOT verified, and owed

**Nothing in this task was executed.** No test was written or run: not one
line of the suppression store, the clock predicate or the deferral facts has
been driven, and "it compiles and clippy is quiet" is the whole of the
evidence. What that leaves owed, by name:

- **U4's own gate** — a full bad-bundle cycle where the second automatic pass
  selects nothing. This is the acceptance PLAN-071 wrote for the slice and it
  is the one thing that would prove the loop is actually closed.
- **The suppression store's file behaviour** — record/clear/idempotence, and
  the fail-closed reading of an unparseable document. The last is the one
  worth writing first: it is the branch whose failure silently restores the
  loop.
- **The clock predicate** — both limbs, and the deferral it produces. The
  floor limb in particular has never been observed against a device with no
  STATE bind, which is the case it exists for.
- **The deferral facts** — each reason reachable, and `since`/`attempts`
  surviving a repeat while a changed reason resets them.
- **The clearing route** — the 200, the 422 for a version that is not
  suppressed, and the audit event. `openapi.json` is regenerated but no test
  drives the handler.
- **RFCT-317's owed tests** are still owed; nothing here discharged them.

Three further things that are true and untested, listed so they are decisions
rather than surprises:

- **A manual `MarkUpdate bad other` also suppresses that slot's version.**
  `rolled_back_slot` matches any non-booted slot with `boot-status: bad`, and
  an operator marking a slot bad is saying "do not boot this", so refusing to
  install its version automatically is consistent. It is clearable.
- **A rolled-back slot RAUC names no `bundle_version` for cannot be
  suppressed.** There is no version to refuse; it is logged, not guessed at.
  It is the one hole in the mechanism.
- **The suppression is per-version, not per-bundle-digest.** A publisher who
  re-cuts a bundle under the same version string is still refused, which is
  the safe direction and may surprise someone.

## 9. Still open in PLAN-071 after this task

- **U6** — mosd's own confirmed-boot fact, which §7 makes a dependency of
  `auto`'s rollback ordering rather than a footnote.
- **U7** — the console: the `AutomaticUpdates` writes, the `deferred` display,
  and rendering `rollback.explanation` instead of the raw reason.
- **U9** — the rest of `updates.md` (§3's full rewrite, §5, §6) and
  `remote-management.md` §3. `updates.md` §1 does not yet document the
  `deferred` or `suppressed` members this task added.
- **U11** — the move itself landed on main mid-task (PLAN-070 F6b); the apid
  **write** route for the document, with its audit and its refusal of an
  `auto` with no window, is still owed. The suppression store did not move
  with it and must not (§9.1, and §1 above).
- **PLAN-070 F10** — the design documents that still describe
  `update-policy.toml`: `updates.md` beyond §2, `mosd.md` §, and
  `release-signing.md`.
- **§9's downgrade floor** — a separate mechanism from this one (§9.5): the
  floor records that the device has moved past a point, the suppression
  records that a specific version failed here. Neither substitutes for the
  other and only the second is built.
- **U10** — the bench cycle on hardware, blocking for shipping `auto`.
