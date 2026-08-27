# RFCT-095 The com.mos.ext policy assertions cannot fail, and hoisting them needs a different shape

- **status**: completed — closed by PLAN-011 M5 (RFCT-093), 2026-08-22, kept, not deleted; see Resolution
- **priority**: P2
- **owner**: (was unclaimed; closed in campaign)
- **createdAt**: 2026-08-22 18:05
- **closedAt**: 2026-08-22 19:45

Raised by PLAN-011 M5 (RFCT-093), deliberately not fixed there. Measured, not
inferred: RFCT-093's T9 planted an unconditional `fail` inside the policy block
and confirmed **zero FAIL lines and 18/18 PASS**.

Four assertions in `os/verify-image-v2.sh` covering `mosd/dist/com.mos.ext.conf`
— the file's presence, the `own_prefix` grant surviving comment-stripping, the
widened `own_prefix="com.mos"` guard, and the unexpected-prefixes/`own=` check —
sit below the fixture hook's exit and are therefore unreachable under
`MOS_VERIFY_FIXTURE_ROOT`. They can be defeated silently and no offline check
notices.

**The one that matters most is the widened-prefix guard.** Its own `fail`
message states the consequence: granting `own_prefix="com.mos"` instead of
`"com.mos.ext"` "hands ownership of com.mos.mosd to every local uid: a unit with
DefaultDependencies=no can claim the name before mosd does and apid then talks
to an impostor for the rest of the boot". That is a one-character edit, guarded
by an assertion measured to be inert.

**Why the D5 fix does not transfer.** M5 closed the equivalent gap for the unit
directory by hoisting a self-contained block into `check_ext_unit_dir` and
naming it in the hook's dispatch list. The policy assertions cannot follow it:

    fixture hook exits        ~471
    sq_grep()                 1250
    MOSD_POLICY_PATH          1557
    dbus_policy_rules_only()  1699
    EXT_POLICY_PATH           1757

A `check_ext_policy` placed above the hook would call helpers that do not exist
yet at that point. Making them reachable means **relocating two helpers that
many unrelated checks share** — a materially different and larger edit than
moving one self-contained block, with a regression surface across checks that
have nothing to do with this campaign.

The standard this is measured against is the repository's own
(`os/ui-location-test.sh:11-18`): "An assertion nobody has ever seen FAIL proves
nothing about the image — it is equally consistent with an assertion that cannot
fail at all."

Open questions for whoever claims this: whether to relocate `sq_grep` and
`dbus_policy_rules_only` above the hook (and what that costs the checks already
using them), whether the fixture hook's exit should move instead, or whether a
second hook is the right shape. None is settled here; M5 deliberately reported
the finding rather than improvising a shape.

Related: `docs/design/bus.md` §11, RFCT-093 (which closed the D5 half),
[[RFCT-092]]-adjacent in kind — a guard that cannot fire is the same false
signal as a citation nothing checks.

## Resolution (2026-08-22)

**Closed inside M5 after the estimate above was falsified by measurement.** This
record is amended rather than deleted, because the measurement in it is the
reason `check_ext_policy` exists as a function, and deleting the task would
erase why the file is shaped that way — the same mistake as retiring a warning
along with its inventory.

The deferral rested on an L1 estimate that relocating two shared helpers was "a
materially larger edit with regression surface across unrelated checks". M5's T9
measured it instead:

- assertion count **378 before, 378 after**, sorted diff empty;
- three byte-identical relocations, verified line-by-line — `sq_grep()`
  1311→538 (8/8 lines), `dbus_policy_rules_only()` 1761→547 (21/21),
  `MOSD_POLICY_PATH` 1619→569 (1/1);
- the policy block itself 56 lines, 56 byte-identical once the function indent
  is normalised;
- `check_ext_policy` called at the block's exact original position, and the
  moved definitions emit no assertions at definition time, so the non-fixture
  assertion sequence is unchanged.

The regression surface the deferral priced measured at zero, so the ruling went
with its reason.

**`MOSD_POLICY_PATH` had to move for a reason worth keeping**: under `set -u` an
unset variable is a hard error rather than an empty string, so a `fail` message
naming it would have killed the script instead of printing. That is the same
class as the `sed`/`pipefail` finding in the D5 block — an assertion that cannot
report its own failure.

**Both guards are now observable.** Mutation D — the widened-prefix guard whose
own message describes the impostor attack — reddens its own case where it
previously left the harness at 18/18 PASS with zero FAIL lines. Each of the ten
new register rows was mutation-tested individually.

Left deliberately undone, for whoever next owns the file: the policy block's
header says "every mosd policy check above still passing", which after the hoist
is true of execution order but misleading on the page. Rewording moved prose is
what MOVE-not-CHANGE forbids and would have broken the byte-identity proof, so
it needs a deliberate one-line follow-up rather than an opportunistic fix.
