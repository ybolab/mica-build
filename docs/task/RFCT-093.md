# RFCT-093 PLAN-011 M5: extension enablement — writable unit directory, the com.mos.ext namespace, and the bus scan

- **status**: completed
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-22 09:40
- **claimedAt**: 2026-08-22 09:40
- **completedAt**: 2026-08-22

PLAN-011 milestone M5, per the revised D5 (PLAN-011 §Proposal D5, revised
2026-08-22). Third-party services run as plain systemd units the integrator
installs; mos neither registers nor supervises them. mos contributes three
things: a writable, persistent unit directory; a policy grant for the
`com.mos.ext.*` namespace; and a bus scan that makes what is running visible
and publishable.

Deliverables:

1. **Measure `own_prefix` semantics first.** In `mosd/hack/dbus-policy-test.sh`
   (RFCT-048's live-bus harness), establish empirically that
   `own_prefix="com.mos.ext"` matches `com.mos.ext.foo` and does **not** match
   `com.mos.mosd`. The whole namespace decision rests on this and it was not
   verified when PLAN-011 recorded it. Policy is written after the measurement.
2. **Policy and the writable unit directory.** A policy file granting
   `own_prefix="com.mos.ext"` in the default context — no deny list, because
   system names fall outside the prefix and D-Bus's default `deny own="*"`
   already closes them. `/etc/systemd/system` becomes a STATE bind mount, the
   seventh, following the pattern `/etc/ssh` and `/etc/hostname` already use
   (`docs/design/ro-root.md` §4). Image verifier assertions for both.
3. **Scan and registry.** mosd watches `NameOwnerChanged` (arg0namespace
   `com.mos`) and publishes into live state: bus name, `Connected`, a
   conformance field naming what the service is missing, and `/DeviceInstance`
   collisions between services of one class. Disconnected services are retained
   under their cached name with an explicit remove action. Non-conforming
   services are warned about and published best-effort, never refused;
   `/DeviceInstance` absent falls back to `0`.
4. **Bridge class derivation.** An extension's `<class>` is the fourth dotted
   component (`com.mos.ext.<class>`), a system service's is the third. The
   policy and `mosd/mqttd/src/topic.rs` must agree on one rule; publishing an
   extension under the wrong class is the defect to test for.

Verify: `bash mosd/hack/check.sh` green with 0 skipped; `make docs-verify`;
the policy test asserts both that a user identity CAN own an extension name and
CANNOT own a system name; the scan is tested against a fake service appearing
and vanishing; `docs/design/bus.md` §5/§6 markers flipped per statement on what
actually landed.

Out of scope: M6 (udev device attach), `os/` image wiring for
`mos-mqttd.service`, the on-device broker smoke test, RFCT-092. No settings
schema change is required anywhere — D4 and D5's `extensions.*` subtree are both
withdrawn.

## Investigation — `own_prefix` semantics (measured 2026-08-22)

Deliverable 1 is done. The measurement ran against **dbus-daemon 1.12.20** on a
bus stood up for the purpose, whose base configuration is the stock system.conf
`<policy context="default">` stanza — `<deny own="*"/>` included — plus exactly
one scaffolding rule, `<allow own_prefix="com.mos.ext"/>`. That grant is the only
thing on the bus that can hand out any name, so every result below is attributable
to `own_prefix` and to nothing else. The scaffolding fragment is written into a
temporary directory at run time; `mosd/dist/com.mos.ext.conf` does not exist yet
and was deliberately not created, because the sequencing — measure first, write
the policy against the measurement — is the point of the task. Each name was
requested by an unprivileged identity (uid 65534) via `RequestName`.

| Bus name | Observed |
| --- | --- |
| `com.mos.ext.foo` | `OWNED` |
| `com.mos.ext.sensor.abc123` | `OWNED` |
| `com.mos.mosd` | `ERROR org.freedesktop.DBus.Error.AccessDenied` |
| `com.mos.extra` | `ERROR org.freedesktop.DBus.Error.AccessDenied` |
| `com.mos.ext` | `OWNED` |
| `com.mos.other` | `ERROR org.freedesktop.DBus.Error.AccessDenied` |
| `org.example.thing` (control) | `ERROR org.freedesktop.DBus.Error.AccessDenied` |

**PLAN-011 D5's assumption holds:** `own_prefix="com.mos.ext"` grants
`com.mos.ext.foo` and does not reach `com.mos.mosd`, so the namespace decision
stands as written and the grant needs no accompanying deny list.

Two details the plan did not state. `com.mos.extra` is refused, which confirms the
mechanism the `com.mos.mosd` result rests on: `own_prefix` is not a string-prefix
match, it requires the next character after the prefix to be `.`. And the bare
prefix `com.mos.ext` is itself `OWNED` — `own_prefix` matches the prefix with no
suffix at all. That name is inside the namespace extensions were given, so it
gives away nothing the decision did not intend to, but it is a name the
`com.mos.ext.<class>[.<suffix>]` grammar never contemplated: it has no fourth
dotted component for deliverable 4's class derivation to read. Deliverable 4 has
to decide what the bridge does with it rather than assume it cannot occur.

All seven names are now asserted with explicit expected values in
`mosd/hack/dbus-policy-test.sh` (section 4), so a dbus-daemon upgrade that changed
any of these semantics would fail the suite rather than silently invalidate D5.
The stage was mutation-checked: widening the scaffolding grant to
`own_prefix="com.mos"` turns the `com.mos.mosd` case into
`FAIL ... expected [ERROR org.freedesktop.DBus.Error.AccessDenied], got [OWNED]`,
while the `org.example.thing` control stays refused — the section fails for the
reason it claims to test, not because the bus broke.

## Outcome

**Done 2026-08-22.** M5 landed as twelve tasks on campaign branch
`bkd/fcgv4ehp`. Everything below is stated against the merged tree at
`eb97eab`, and every path named here was checked to exist before it was written
down. Where a statement is about a moment rather than a mechanism it carries the
commit it was measured at, so that a later change can date it rather than
falsify it. Three of the boundaries below were open when they were first written
and were closed by tasks that landed while this record was being written; each
keeps both halves and dates them, because a record that quietly rewrites its own
history is one nobody can date.

### What landed

- **The `own_prefix` measurement, first, as deliverable 1 required.** Seven bus
  names asserted with explicit expected values in
  `mosd/hack/dbus-policy-test.sh` §4, against dbus-daemon 1.12.20, each
  requested by an unprivileged identity (uid 65534). The Investigation section
  above is the record; the stage is mutation-checked, so a widened grant fails
  the section for the reason it claims to test.
- **The shipped policy, written after the measurement.**
  `mosd/dist/com.mos.ext.conf` grants exactly one thing —
  `<allow own_prefix="com.mos.ext"/>` in the default context, own only, no
  `send_destination`, no `receive_sender`, and **no deny list**, because
  `own_prefix` requires the next character to be a `.` and every system name
  therefore falls outside the grant, closed by D-Bus's own `<deny own="*"/>`.
  Tested on a live bus (`mosd/hack/dbus-policy-test.sh` §5) and asserted in the
  image by four checks in `os/verify-image-v2.sh`.
- **The writable, persistent unit directory.**
  `os/rootfs/overlay-v2/etc/systemd/system/usr-local-lib-systemd-system.mount`
  binds `/mnt/state/systemd-units` onto `/usr/local/lib/systemd/system`, enabled
  into `local-fs.target.wants`. The source directory is created by
  `os/rootfs/overlay-v2/usr/lib/mos/mos-seed-state` with `mkdir -p` and **no
  `cp -an`** — deliberately, with a comment saying why, because a no-clobber
  seed here would freeze the mount topology against A/B updates. The load-path
  measurement that chose this target over `/etc/systemd/system` is recorded in
  `docs/plan/PLAN-011.md` D5.
- **One class rule, in one place.** `mosd/busname/src/lib.rs` — a
  zero-dependency crate whose `parse` is the only implementation of "an
  extension's class is the fourth dotted component, a system service's the
  third", plus the bare `com.mos.ext` case (extension origin, no class). Its two
  consumers depend on it rather than restating it: `mosd/mqttd/src/topic.rs` and
  `mosd/mosd/src/scan.rs`.
- **The scan and the registry.** `mosd/mosd/src/scan.rs` watches
  `NameOwnerChanged` (arg0namespace `com.mos`) and publishes into live state
  under `services`: bus name, `connected`, the `conformance` object naming what
  a service is missing, `instance_collision`, and a `/DeviceInstance` that falls
  back to `0`. Disconnected services are retained; `ForgetService`
  (`mosd/mosd/src/bus.rs`) is the only way an entry leaves, and it refuses a
  service that is still connected. Tested against a fake service appearing and
  vanishing (`mosd/mosd/tests/scan.rs`).
- **The image verifier's D5 assertions, driven offline.** Both sets —
  the mount unit and its negative guard (`check_ext_unit_dir`) and the
  `com.mos.ext.conf` policy set (`check_ext_policy`) — are functions named in
  `os/verify-image-v2.sh`'s fixture-hook dispatch list, with matching rows in
  `os/ui-location-test.sh`'s expected set, so each can be observed failing
  without an image. Both sat below the hook and could not fail at all for most
  of this campaign; see items (d) and (i).
- **The doctest gate.** `mosd/hack/check.sh` now runs
  `cargo test --doc --workspace --locked`. `cargo nextest` does not execute
  doctests, so without this line a broken doctest passed the gate silently — and
  `mosd/busname`'s reasoning lives partly in a doctest.
- **`docs/design/bus.md` §5 and §6 flipped per statement**, on what is in the
  tree and nothing else, each `[implemented]` naming its path.

### Boundaries, and what has since moved past them

Stated as boundaries of what was done, because a boundary a reader has to infer
is one they will infer wrongly. Four of these were written as open gaps and have
since been closed — by a real image run, and by three follow-up tasks that
landed on the campaign branch before this record did. Where that happened, both
halves are kept and dated rather than the earlier half deleted: a boundary that
was true at the moment it was written is not made wrong by later work, and a
record that quietly rewrites its own history is one nobody can date. What
remains open is item (b), item (c), item (e)'s standing boundary, item (g), and
item (k) — which qualifies the evidence behind everything above it.

**a. The image chain HAS now been run, and M5's assertions pass against a real
assembled image.** This item was written twice and both halves are kept, because
each is true of its own moment.

*What T4 could honestly claim when it wrote this, and what stood until
2026-08-22:* the image build and the assembled-image verifier had not been run
against this work, and — T4's words, kept verbatim as the record of that
moment — **"I am NOT claiming the against-a-real-image run happened."** The
offline-fixture work closed one half of the question and not the other: it
closed *whether the D5 assertions can fail at all*, and did **not** close
*whether a built image satisfies them*.

*What is now measured.* The full chain was run — rootfs build and image
assembly both clean, verity root hash matching the signed cmdline — and
`verify-image` was run twice, once on the campaign branch and once on `main` as
a baseline:

```
main            RESULT: FAIL (347/350)
bkd/fcgv4ehp    RESULT: FAIL (354/357)
```

The delta is **+7 assertions, all of them passing** — the campaign's own,
including T2's `com.mos.ext.conf` policy set and T4's mount unit and its
negative guard, which until this run had only ever been driven against fixture
stand-in roots. That is the single largest gap in M5's verification story
closing, and it is stronger than anything the offline work could establish.

The three failures are **identical, character for character, on both sides**, so
they are pre-existing and the campaign introduced **no regression**. That is
attribution by baseline comparison rather than by argument, which is the only
form of it worth recording. They are: the U-Boot debug-variant artifact absent
from the running host; the connd contract failing to parse out of
`mosd/mosd/src/reconciler/`; and eight stock systemd `.network` files colliding
with a reconciler-owned prefix.

*The boundary that survives all of this.* That run happened on a **different
commit** — an unmerged `4282921` — so the tree measured throughout this Outcome
(`eb97eab`) is **not byte-identical** to the tree that was built. Both facts are
true and neither replaces the other: the assertions pass against a real image,
and this record is anchored to a tree that particular image was not built from.

**Two pre-existing failures handed on, not fixed and not investigated here.** The
connd contract failure is load-bearing in exactly the family this campaign spent
its length on: its own `fail` message says every connd assertion below it
"compares against these, so none of them mean anything until this passes"
(`os/verify-image-v2.sh`). An entire group of assertions is therefore currently
inert — reporting neither pass nor a failure of its own. The `.network` prefix
collision is the second. Both belong to someone else and are named here only so
they are not lost.

**b. arm64 is a declaration read, not a run.** The `systemd-analyze unit-paths`
measurement behind the unit-directory choice ran on the host's own architecture.
That the same directory is compiled into the arm64 build was established by
**reading** the arm64 package's compiled `systemd.pc` declaration and the
corresponding string in the arm64 `systemctl` ELF. **No arm64 binary was
executed anywhere in this campaign.**

**c. `runtime::run`'s refusal branch is not reachable from a test.** The bridge
refuses to start when `topic::class_of` yields no class — the bare `com.mos.ext`
case. That call passes a `const SERVICE` (`mosd/mqttd/src/config.rs`), so no
test can drive the branch by choosing a name. The test asserts **the value the
refusal keys on** — that `class_of` on the bare namespace is `None` — not the
refusal firing.

**d. Both of D5's assertion sets are now reachable offline; the policy set was
provably inert before it was.** This is a limit that existed and was closed, and
the measurement matters more than the fix.

*The measurement.* An unconditional `fail` planted in the `com.mos.ext.conf`
policy block produced **zero FAIL lines and a fully green suite**. The guard it
defeated is the widened-`own_prefix` one — whose own failure text describes a
unit with `DefaultDependencies=no` taking `com.mos.mosd` before mosd does, and
apid spending the boot talking to an impostor. A guard against a one-character
edit, measured to be incapable of firing. That measurement is why
`check_ext_policy` exists **as a function** rather than as the inline block it
was, and it is the reason this paragraph is in the record instead of being
dropped as "fixed": inlining it back reopens the hole, and only the measurement
explains why the shape is not tidiness.

*What is in the tree as of `eb97eab`.* Both sets are functions named in
`os/verify-image-v2.sh`'s fixture-hook dispatch list — `check_ext_unit_dir` for
the mount unit and its negative guard, `check_ext_policy` for the four policy
assertions — with matching rows in `os/ui-location-test.sh`'s expected set. The
widened-prefix guard now goes **RED when broken**. `bash os/ui-location-test.sh`
reports **RESULT: PASS (27/27 cases)**, up from 23, and the verifier's assertion
count is **378 before and after**: the work moved assertions into reach and wrote
none. **RFCT-095** holds the measurement and its history; its status now reads
*closed by PLAN-011 M5 (RFCT-093)* and it was kept rather than deleted, so the
reason the function is shaped this way outlives the diff.

*One detail that had to move with it.* `MOSD_POLICY_PATH` was relocated above
the hook along with `sq_grep` and `dbus_policy_rules_only`, not for tidiness:
under `set -u` an unset variable is a hard error, so a `fail` message naming it
would have **killed the script instead of printing** — the same class of defect
as an assertion that cannot report its own failure.

*One thing left deliberately untouched, for whoever owns the verifier.* The
policy block's header still says "every mosd policy check above still passing".
After the hoist that block sits **above** those checks in file order while still
**executing** after them — true of execution, misleading on the page. It was not
reworded on purpose: rewording moved prose is what a move-not-change edit
forbids, and it would have cost the byte-identity proof that the assertions
themselves were unchanged by the move.

**e. The fixture register covers what was added to it.**
`os/ui-location-test.sh` drives the assertions **named in its expected set**, and
reports a member that went missing, or that ran when it was not expected to,
**by name**. That is a strong property and a bounded one: an assertion **never
added to the set** is invisible to the register, exactly as an assertion never
written is. A green run should not be read as "the verifier is fully driven";
the correct reading is "every assertion this file knows about behaved as
recorded". As of `eb97eab` the tree says this itself, in the durable form and in
**two** places: beside the register in `os/ui-location-test.sh`, whose inventory
of unreachable assertions is now **empty** because both sets are hoisted and
registered — and the warning is kept anyway, since the list was never the
durable part; and at the fixture hook's exit in `os/verify-image-v2.sh`, which
is where somebody is actually standing when they are about to write past it. Two
authors already did (item **j**); the warning exists for the third.

**f. The silent skip in `mosd/mosd/tests/bus.rs` is closed; three more like it
are not.** For most of this campaign `bus_roundtrip` did
`eprintln!("skipping ...")` and `return Ok(())` when `dbus-daemon` was absent —
green while asserting nothing.

**Why it was never caught is the part worth writing down, and the obvious answer
is wrong.** It is tempting to say the environment was lucky — that every CI host
happened to have `dbus-daemon`. That is measured false: a bare `ubuntu:latest`
carries no `/usr/bin/dbus-daemon`, and `docs/task/RFCT-083.md:20-23` records
`check.sh` reporting green on a host that lacked it. The skip had already fired,
invisibly. The real reason is that **nothing this repository runs could have
reported it either way**: an in-test `return Ok(())` is counted by `nextest` as
*passed*, never as *skipped*, so no gate we had was capable of saying the test
did not run. Blaming the environment would quietly exonerate the gate, which in
a document about false signals would make the sentence a fourth member of the
family it is cataloguing. The general defect is item (k) and **RFCT-096**; this
was one instance of it.

As of `eb97eab` the instance is closed (T11, `z3hubnnz`): the locator **panics
by name**, saying what to install and why the test must not skip, and CI
provisions the `dbus-daemon` package explicitly and proves a session bus can
start before running anything. `bus_roundtrip` now genuinely runs — measured
here at `PASS [1.571s]`, where the skip path returned in milliseconds, so the
difference is observable rather than asserted. The only honest outcome for a
test that cannot do its work is a red one.

Three instances of the same shape remain live and out of M5's scope, each still
reporting green while asserting nothing when `dbus-daemon` is absent:
`mosd/mosd/tests/tree.rs` (one shared start helper feeding five early-return
sites), `mosd/apid/tests/e2e.rs` (the case the previous campaign named and did
not remove), and `mosd/apid/src/tests/power_bus.rs` (which reaches the same
early return by propagating a `None` out of its locator rather than by an
explicit `return Ok(())` — the same defect, spelled differently). Tracked as
**RFCT-096**.

**g. M5 turns bus.md §11 item 2's dotted-key limit from POSSIBLE into
CERTAIN.** Before M5 the limit needed an operator to name an interface with a
dot, so it was a thing that could happen. The registry is keyed by **bus name**,
and a bus name always contains dots, so now it does happen: `mosd/mosd/src/tree.rs`
can build no item object for such a key and logs a WARN per field per service
(`no item object for this path`), on every device with an extension, at every
startup. Nothing is lost — the entries still read through `GetItems`/`GetState`.
The cost is not log volume. It is that a WARN which fires during correct
operation teaches an operator to ignore WARNs, which is the same false-signal
family this campaign spent its length removing: an assertion that cannot fail
proves nothing, and a warning that always fires warns nobody. Tracked as
**RFCT-094**, which owns the open questions; deliberately not fixed here.

**h. `MOSD_SCAN` is what makes the scan testable, and it is one-way.**
`MOSD_DRY_RUN=1` alone constructs no scan, and `mosd` has no lib target, so the
registry can only be exercised through the binary against a real bus. As of
`eb97eab` the gate is `service_scan_enabled` (`mosd/mosd/src/main.rs`):
production is unconditionally on and `MOSD_SCAN` is **inert** there whatever it
holds, while `MOSD_SCAN=1` lifts dry-run's suppression for `tests/scan.rs`. The
asymmetry is the point — a symmetric gate reads tidier but would also let one
stray or mistyped value (`MOSD_SCAN=0`, `MOSD_SCAN=true`) switch the service
registry off on a real device, with nothing left running to report that it had.
It widens nothing dry-run protects: the scan adds a match rule and read-only
calls on the bus the daemon is already connected to, and writes only to the
in-RAM live-state tree. The narrowing landed as a follow-up task, **T10
(`bmovafe9`)**; the earlier form of this gate could disable the scan in
production.

**k. "0 skipped" is weaker evidence than it reads, including in this record.**
`cargo nextest`'s skipped counter cannot see an in-test `return Ok(())`: a test
that decides at runtime it cannot do its work and returns early is counted
**passed**, not skipped. So this task's own acceptance criterion — "`check.sh`
green with 0 skipped" — is satisfiable by a test that asserted nothing, and every
"0 skipped" claim in this Outcome should be read as "no test was excluded by the
runner", not as "every test did its work". That is a limit on the evidence
behind this record, not a defect to fix here. Measured by T11 and tracked as
**RFCT-096**, which owns the packaging trap behind it and the open questions;
item (f) carries the one receipt this record needs and names the three sites that
still exploit it.

### Two properties observed, recorded as evidence

**i. For this campaign's whole span the `/etc/systemd/system` negative guard was
offline-unobservable.** Forcing it to always pass left the offline suite at
**18/18 PASS with zero FAIL lines** — the assertion carrying D5's rejection of
`/etc/systemd/system` could not fail, which is worse than its absence, because
its presence tells the next reader the hazard is watched. T9 closed it, and
**that is the reason `check_ext_unit_dir` is a function** rather than the inline
block it was: the fixture hook dispatches functions by name, so being a function
is what makes it driveable. Inlining it back at its one call site — a diff that
reads like a simplification — reopens the hole. Recorded here so the reason
survives the change that made it true.

**j. Two independent authors wrote assertions into a region the offline register
structurally cannot see, and neither extended the hook.** T2 (the policy set)
and T4 (the unit-directory set) each added assertions below the fixture hook and
each left the hook's dispatch list unchanged. Neither had reason to look: the
file gives no signal at the point of writing that "below this line" and "above
this line" differ. That is a property of the file, not of either author, and
stating it that way is the point — two independent authors hitting it is what
makes it worth stating at all. Whether it deserves a mechanism belongs to
RFCT-092's neighbourhood and is not proposed here.

### Two notes for whoever reads this next

- **The `EXT_` grep-prefix collision in `os/verify-image-v2.sh`.** T4's
  `EXT_UNIT_DIR` / `EXT_MOUNT_UNIT` (the extension *unit directory*) and T2's
  `EXT_POLICY_PATH` / `EXT_POLICY` (the extension *D-Bus policy*) are unrelated
  things sharing a prefix. A `grep EXT_` returns both sets and reads as one
  subsystem. Nothing is wrong in the file; the trap is in the search.
- **Every L3 worktree is cut from `main`, not from the campaign branch.** Each
  task's base is therefore a **snapshot** of `bkd/fcgv4ehp` taken at its own
  dispatch, and different tasks saw different bases. Line numbers, and any claim
  of the form "X is not in the tree", are true of the base the task that wrote
  them was standing on and not necessarily of the merged result. Several of this
  campaign's corrections trace to that — including one task's plan edit that was
  reverted at merge as already-recorded, whose measurement then had to be
  re-landed here.
