# Dual-build sanction ledger

PLAN-036 section 6 ends with a gate: before the rootfs stage chain is deleted,
x64 is built through **both** paths -- the chain and the package composer -- and
their unpacked trees are compared. "Expected additions are package documentation
and the package composition record; every other difference requires an explicit
explanation."

This file is where that explicit explanation lives. It is read by
`os/build/src/compare-roots.ts`, which fails the gate on any difference no
stanza here covers. Nothing else in this repository grants an exception to that
comparison, and there is no flag that turns it off.

## How the gate calls the comparator

```
bash os/build/run.sh --compare-roots [--sanctions FILE] DIR_A DIR_B
bash os/build/run.sh --compare-roots --extract-oci ARCHIVE DIR
```

`DIR_A` is the baseline root, the path being replaced: the stage chain.
`DIR_B` is the candidate, the path replacing it: the composer. That order is not
cosmetic -- `added` means *present in B, absent in A*, and the two sanctions
PLAN-036 grants in principle are additions, so a driver that swapped the
arguments would find every one of them classified as a removal and unsanctioned.

Both sides are **already-extracted directories**. `--extract-oci` is how one is
produced from the `factory-root.oci` that
`os/rootfs/stages/90-pack.Dockerfile`'s `factory-root` target writes to
`_out/<board>/`; it unpacks with `--numeric-owner --xattrs`, so ownership and
file capabilities arrive as the image carries them.

`--sanctions` defaults to this file, so the driver needs no path of its own.

Exit codes:

| code | meaning |
| ---- | ------- |
| 0 | compared: every difference sanctioned, every active sanction used, no pending sanction live |
| 1 | compared, and this ledger does not account for the result |
| 2 | **refused** -- no comparison was made at all |

2 is separate from 1 on purpose. A missing side, a side that is empty or under
the path floor, both sides being one directory, an unparseable ledger and a host
with no `getcap` all produce it, because each of them would otherwise produce a
green that is a fact about the harness rather than about the two roots.

The comparator prints its counters on every run, including passing ones: paths
on each side, paths in the union, capability-bearing files on each side, and
differences found / sanctioned / unsanctioned. "No differences" and "nothing was
examined" reach the same verdict by opposite routes and the counts are what
separate them.

## The format

Everything above the `## Sanctions` heading is prose and is not parsed. Under
it, one stanza per sanctioned difference:

```markdown
### /usr/share/doc/**
- classes: added
- status: pending
- reason: Why this difference is allowed. Mandatory, and it is the point of the file.
```

- The heading is a path pattern, matched as a glob against the path as it
  appears *inside* the root, with a leading slash: `/usr/bin/mosd`. `*` stops at
  a `/`, `**` does not. Backticks around the pattern are stripped.
- `classes` is a comma-separated subset of: `added`, `removed`, `type`, `mode`,
  `uid`, `gid`, `symlink`, `content`, `caps`. A sanction covers a difference
  only when **both** the pattern and the class match, so sanctioning a file's
  contents does not quietly sanction its mode changing too.
- `status` is `active` (the default) or `pending`.
- `reason` is free text on one line and may not be empty.

A stanza with an unknown key, an unknown class, no `classes`, no `reason`, an
empty `reason`, or a pattern already sanctioned above is refused by name with
its line number. A key this parser does not read is a condition its author
believed they had written down.

## The two hard rules

1. **An unsanctioned difference fails the run**, naming the path and the class.
2. **A sanction that matched nothing also fails the run**, naming the stanza and
   its line. A stale sanction covering an absence is how an instrument like this
   stops asking the question it was built for: the tree moves on, the stanza
   goes on sanctioning something that is no longer there, and the run stays
   green by comparing less than it used to.

## Pending stanzas, and the tension they resolve

Rule 2 and the shipped state of this file pull against each other. PLAN-036
sanctions two differences *in principle* -- package documentation and the
package composition record -- but the composed path does not exist yet, so
neither difference can be produced today. Writing those stanzas as ordinary
sanctions would make rule 2 fail every run until the composer lands; leaving
them out would lose the decision PLAN-036 already made.

`status: pending` is the resolution, and it is deliberately not a way of
switching a rule off:

- a pending stanza **must match nothing**. It is written down, it is not in
  force, and it sanctions no difference -- a difference that only a pending
  stanza matches is still reported as unsanctioned.
- a pending stanza that **does** match fails the run, naming it: the difference
  it describes has arrived, so the decision has to be taken for real by
  promoting it to `status: active`.

So the state of every stanza is asserted on every run in both directions, and
"not yet" is a claim the gate checks rather than a place to put things.

## Evidence that this instrument works

Four outcomes, driven against two REAL x64 roots -- not fixtures. Both were
built from this worktree at one commit, on this host, with x64 being amd64 and
therefore native:

```
a. full     MOS_BOARD=x64 bash os/rootfs/build-v2.sh
b. reduced  MOS_BOARD=x64 MOS_ROOTFS_WITHOUT=mqtt bash os/rootfs/build-v2.sh
```

Each run's `_out/x64/factory-root.oci` was preserved before the next overwrote
it, and both were extracted with `--extract-oci`.

<!-- EVIDENCE: filled from the measured run; see the L3 report for the raw output. -->

1. **The comparator over (full, reduced) reports a non-empty difference set.**
   PENDING MEASUREMENT.
2. **Sanctions covering that set turn the run green.** PENDING MEASUREMENT.
3. **Deleting one of those stanzas turns it red again**, naming the now
   unsanctioned path. PENDING MEASUREMENT.
4. **Adding a stanza for a path that does not differ turns it red**, naming the
   unused sanction. PENDING MEASUREMENT.

The sanctions used for outcomes 2-4 are **not** in the shipped list below. They
are proof material: they describe the difference between two builds of the same
path, which is not the difference this gate exists to judge, and leaving them
here would sanction in advance a whole payload's disappearance from the composed
root.

## Sanctions

### /usr/share/doc/**
- classes: added
- status: pending
- reason: PLAN-036 section 6 sanctions package documentation as an expected addition. The composed root installs real `.deb` packages, and each carries its own `/usr/share/doc/<package>/` payload -- the per-package Apache-2.0 copyright this campaign requires, at minimum. The stage chain installed those components by copying files into place and produced no such tree, so every path under it is an addition with no counterpart on side A. Pending until the composer exists; promote it to active in the same change that first produces the difference.

### /etc/mos/rootfs-packages.txt
- classes: added
- status: pending
- reason: PLAN-036 section 6's second sanctioned addition, the package composition record. Section 4 writes it to `_out/<board>/rootfs-packages.txt`, which is OUTSIDE both compared trees, so as specified today this difference cannot appear at all and the pattern here is a placeholder for the in-image copy the composer may also stage. The composer L3 owns correcting the pattern to the path it actually writes -- or deleting this stanza, if the record never enters the image. It is safe to be wrong while pending, because a pending stanza sanctions nothing: the worst a wrong pattern here can do is fail to match, which is its expected state.
