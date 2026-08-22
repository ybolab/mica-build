# RFCT-093 PLAN-011 M5: extension enablement — writable unit directory, the com.mos.ext namespace, and the bus scan

- **status**: done
- **priority**: P1
- **owner**: ai-agent (BKD campaign 2, dispatched by L1 0yncfnol)
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

**Done 2026-08-22.** M5 landed as nine tasks on campaign branch `bkd/fcgv4ehp`.
Everything below is stated against the merged tree at `fe85813`, and every path
named here was checked to exist before it was written down.

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
- **The doctest gate.** `mosd/hack/check.sh` now runs
  `cargo test --doc --workspace --locked`. `cargo nextest` does not execute
  doctests, so without this line a broken doctest passed the gate silently — and
  `mosd/busname`'s reasoning lives partly in a doctest.
- **`docs/design/bus.md` §5 and §6 flipped per statement**, on what is in the
  tree and nothing else, each `[implemented]` naming its path.

### What is not covered

Stated as boundaries of what was done, because a boundary a reader has to infer
is one they will infer wrongly.

**a. The image build and the assembled-image verifier were not run.** As of
`fe85813`, neither the image build nor `os/verify-image-v2.sh` against an
assembled image has been run against this work. **I am NOT claiming the
against-a-real-image run happened.** The offline-fixture work closed one half of
this and not the other: it closed *whether the D5 unit-directory assertions can
fail at all* — they are now driven by `os/ui-location-test.sh` against a fixture
root, and each of the five branches was shown to redden its own case. It did
**not** close *whether a built image satisfies them*. Every read in those
assertions is `${ROOT}`-relative, so they are offline-capable; being
offline-capable is not the same as having been run against the artifact they
describe.

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

**d. T2's four `com.mos.ext.conf` policy assertions remain
offline-unobservable.** They sit inline in `os/verify-image-v2.sh`'s main body,
below the fixture hook, so `MOS_VERIFY_FIXTURE_ROOT` never reaches them; an
unconditional failure planted there left the offline suite green. T9 measured
that hoisting them is **not** the mechanical shape that worked for the D5 unit
block: every dependency of that block — `sq_grep()` (line 1312),
`MOSD_POLICY_PATH` (1619), `dbus_policy_rules_only()` (1761) and
`EXT_POLICY_PATH` (1819) — is defined **after** the fixture hook, whose block
ends at line 548 and exits rather than falling through. A function placed above
the hook would therefore call helpers that do not exist yet. Making them
reachable means relocating two helpers shared with unrelated checks: a larger
edit, deliberately scoped out rather than attempted late.

**e. The fixture register covers what was added to it.**
`os/ui-location-test.sh` drives the assertions **named in its expected set**, and
reports a member that went missing, or that ran when it was not expected to,
**by name**. That is a strong property and a bounded one: an assertion **never
added to the set** is invisible to the register, exactly as an assertion never
written is. A green run should not be read as "the verifier is fully driven";
the correct reading is "every assertion this file knows about behaved as
recorded". One detail for the next reader: that file's own boundary comment
still describes the extension mount-unit assertions as unreachable. T9's hoist
made them reachable and added their rows without shrinking the comment, so the
prose over-states the boundary while the register itself is correct. Noted here
rather than edited — this task is docs-only.

**f. A pre-existing silent skip is still live.** `mosd/mosd/tests/bus.rs`'s
`bus_roundtrip` does `eprintln!("skipping ...")` and `return Ok(())` when
`dbus-daemon` is not found — it reports green while asserting nothing. It has
never been caught because every CI host has `dbus-daemon`. M5 neither touched
nor introduced it; it is recorded here, not fixed, because it is the same
false-signal family this campaign spent its length removing.

**g. The registry makes bus.md §11 item 2's dotted-key limit certain.** Registry
keys are bus names, and a bus name always contains dots, so
`mosd/mosd/src/tree.rs` can build no item object for them and logs a WARN per
field per service (`no item object for this path`). Nothing is lost — the
entries still read through `GetItems`/`GetState` — but a device with extensions
emits a burst of WARNs at boot for a condition that is normal and expected. That
is §11 item 2 one layer down, raised as **RFCT-094** and deliberately not fixed
here.

**h. `MOSD_SCAN` is what makes the scan testable.** `MOSD_DRY_RUN=1` alone
constructs no scan, and `mosd` has no lib target, so the registry can only be
exercised through the binary against a real bus. `MOSD_SCAN` decides
independently: `1` constructs the scan, any other value does not, and unset
means on unless dry-run (`mosd/mosd/src/main.rs`). It widens nothing dry-run
protects — the scan adds a match rule and read-only calls on the bus the daemon
is already connected to, and writes only to the in-RAM live-state tree.

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
