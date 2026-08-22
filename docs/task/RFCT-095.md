# RFCT-095 The com.mos.ext policy assertions cannot fail, and hoisting them needs a different shape

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
- **createdAt**: 2026-08-22 18:05

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
