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

Pass **absolute** paths. `run.sh` runs bun with `os/build/` as its working
directory, so a relative argument resolves against `os/build/` rather than
against wherever the driver stood, and the failure surfaces as "does not exist"
naming a path the driver can see.

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
it, then both were extracted with `--extract-oci`: one gzip layer each, **9,234
paths** each, **0 capability-bearing files** on either side. That zero is printed rather
than assumed -- on a root with no file capabilities that dimension compares an
empty set with an empty set, and `os/tests/factory-root-gate` says the same
thing about the same root.

The difference set is **10 records, every one of class `content`**. No path is
added or removed, and no mode, uid, gid, symlink target or capability differs
anywhere in 9,234 paths.

Eight of the ten are the mqtt stage, and they are not what the gate's author
expected. `stages/34-feature-mqtt` is the ACCOUNTS stage only -- its own header
says the binaries "come out of the same cargo build as mosd" and are installed
by `stages/33-feature-mosd` -- so `/usr/bin/mos-mqttd`,
`/usr/bin/mos-mqtt-broker` and both units are present and **byte-identical** in
the reduced root. What declining the stage removes is two service accounts,
`mos-mqttd` (970) and `mos-mqtt-broker` (969), from the eight files that carry
them: `/etc/passwd`, `/etc/passwd-`, `/etc/group`, `/etc/group-`,
`/etc/gshadow`, `/etc/gshadow-`, `/etc/shadow-` and
`/usr/share/factory/etc/shadow` (the real `/etc/shadow` is a symlink into
`/run`, so the factory copy is the one that ships).

The other two differ for reasons that have nothing to do with mqtt, and they
were opened rather than assumed:

- `/boot/initrd.img-6.12.107+deb13-amd64`. Every cpio entry sits at an identical
  offset in both builds; the whole 12-byte delta is inside a gzip segment whose
  UNCOMPRESSED size is byte-equal at 36,418,048. Of that segment's 183 entries,
  names, sizes, modes, owners and extracted contents are identical, 182 carry a
  different inode number, and 70 carry a different mtime -- the two builds'
  wall clocks, 245 s apart.
- `/usr/share/factory/var/cache/ldconfig/aux-cache`. Header identical, all 128
  library path strings identical with an empty set difference in both
  directions, and 2,001 of 8,062 bytes differing from offset 1,808 on: the
  binary entry table, which glibc fills with `{dev, ino, ctime, size}` per
  shared library.

Both are the stage chain failing to be reproducible, not composition
differences, and the composed-vs-chain gate will report them however faithful
the composition is. They are recorded here so that whoever writes their stanzas
writes the real reason -- or fixes the producers instead.

**INFERRED, not yet measured**, and marked as such: that two builds of the SAME
configuration would also differ on these two paths follows from what the bytes
are -- host inode numbers and a wall clock cannot repeat -- but the pair
measured above differ in configuration as well, so the inference is one step
past this evidence. A same-configuration measurement is queued; this paragraph
is corrected to a measurement or withdrawn when it lands.

### Why the archive grew while its content shrank

The reduced root's `factory-root.oci` is 250,955,776 bytes against the full
root's 250,955,264 -- 512 larger, one tar block, for a tree with two accounts
removed. Not "probably padding":

- The archive holds ONE gzip layer blob. Its declared size is 250,948,072 (full)
  against 250,948,264 (reduced): the COMPRESSED layer is **192 bytes larger**
  over a tree that is **501 bytes smaller** uncompressed (`/etc/passwd` -140,
  `/etc/passwd-` -116, `/etc/shadow-` -54, the factory shadow -54, `/etc/group`
  -40, `/etc/gshadow` -34, `/etc/group-` -29, `/etc/gshadow-` -22, the initrd
  -12, aux-cache unchanged). gzip's output size is not monotone in its input's.
- The `.oci` is a tar, which rounds every member up to 512 bytes. 250,948,072
  needs 490,133 blocks; 250,948,264 needs 490,134. Every other member -- the
  manifest at 567, the config at 412, `index.json` at 465, `oci-layout` at 30 --
  is byte-identical in size on both sides.

One extra block, and that is the whole 512.

The four outcomes, each run against those two roots:

1. **Non-empty difference set.** Against a ledger with no stanzas: 10
   differences, 0 sanctioned, 10 unsanctioned, `RESULT: FAIL`, exit **1**.
2. **Sanctions covering the set turn it green.** Ten stanzas, one per path:
   `differences found: 10 / sanctioned: 10 / unsanctioned: 0`,
   `RESULT: PASS (10 differences, all sanctioned; 10 active sanctions, all
   used)`, exit **0**.
3. **Deleting one stanza turns it red, by path.** With the `/etc/gshadow`
   stanza removed: `UNSANCTIONED /etc/gshadow content: A=4c46e199... B=6d545111...`,
   `RESULT: FAIL (1 unsanctioned difference(s), ...)`, exit **1**.
4. **A sanction for a path that does not differ turns it red, by stanza.**
   Adding `/usr/bin/mosd` on top of the ten:
   `UNUSED SANCTION .../proof-unused.md:50 '/usr/bin/mosd' (content) matched
   nothing`, `RESULT: FAIL (0 unsanctioned difference(s), 1 unused
   sanction(s), ...)`, exit **1**.

The reduced root is PROOF MATERIAL and not a shippable configuration: it ships
two units whose `User=` names accounts that no longer exist, which is exactly
the failure `stages/34-feature-mqtt` documents. Its build reported rc=1 for that
reason -- the smoke runner refuses a root built without a feature stage rather
than skipping the affected artifacts -- and the OCI archive was fully written
before that refusal, byte-identical to what the smoke runner had just printed.

The sanctions used for outcomes 2-4 are **not** in the shipped list below. They
are proof material: they describe the difference between two builds of the SAME
path, which is not the difference this gate exists to judge. Shipping them would
pre-sanction two service accounts vanishing from the composed root, and the two
non-reproducible paths besides -- three decisions nobody has taken, granted in
advance by a file whose whole purpose is that such decisions are written down.

### The queued measurement, and the prediction written before it

Two more x64 roots are being built to close two gaps this pair leaves. Both
predictions below are committed BEFORE the comparator runs against them, so that
a met prediction is worth what a met prediction is worth.

**Gap 1: only one of nine difference classes has been exercised on real
material.** All ten records above are `content`. The class the switch-over
actually rests on is `added` -- PLAN-036's two sanctioned differences are both
additions -- and it has been proven by fixtures only. Build C declines the
container engine, which is a real path payload and was confirmed to be one by
reading the assembled root rather than the stage's name: `/usr/bin/podman`,
`/usr/bin/crun`, `/usr/libexec/podman/{conmon,quadlet,netavark,aardvark-dns}`,
`/usr/lib/systemd/system-generators/podman-system-generator`,
`/etc/containers/systemd` and `/usr/sbin/nft` are all present in the full root.

*Prediction, full vs containers-declined:* a difference set containing
`removed` records for that payload and for the files of the apt packages the
stage installs (nftables, libjson-c5, libsubid5, libseccomp2, libcap2,
libglib2.0-0t64), plus the two non-reproducible paths; and, with the two
arguments SWAPPED, the identical path set reported as `added` instead. That
swap is the orientation trap this file's seam note warns about, demonstrated on
real material rather than asserted.

**Gap 2: the same-configuration claim above is an inference.** Build D repeats
the full build with no `MOS_ROOTFS_WITHOUT` at all. It cannot be a byte-repeat
of build A, because the tree has moved on by two commits and
`os/pkgs/mosd/hack/build-target.sh` embeds `<commit>` at compile time -- which
is itself what makes the experiment work, since it re-runs the stages that
generate both non-reproducible files.

*Prediction, build A vs build D:* exactly four `content` records and nothing
else --

1. `/usr/bin/mosd` and 2. `/usr/bin/apid`, the only two paths in the whole
   9,234-path root that carry the commit string (found by grepping build A's
   root for `cf2a07049c96`; same length, so the sizes are unchanged),
3. `/boot/initrd.img-6.12.107+deb13-amd64`, and
4. `/usr/share/factory/var/cache/ldconfig/aux-cache`,

with `/usr/bin/mos-mqttd` and `/usr/bin/mos-mqtt-broker` byte-IDENTICAL -- they
do not read that variable -- and with no added or removed path and no mode, uid,
gid, symlink or capability difference anywhere. If 3 and 4 appear while their
unpacked contents stay byte-identical, the inference above becomes a
measurement: the configuration is the same, so nothing but the rebuild itself
can explain them. If anything else appears it is a third non-reproducible
surface and goes to L2 before it goes here. If instead the set comes back EMPTY,
build D was a cache replay and proves nothing -- which is what will be reported,
rather than a green dressed up as agreement.

#### Addendum: the builder changed after those predictions were committed

The two predictions above were written against builds that would run on the
`default` docker-driver builder, chaining stages through the daemon-global
`mos-rootfs-stage:x64-*` tags. Those tags are shared by every worktree on the
host, so the builds now run on a private docker-container builder instead,
where `os/build/src/stages-cli.ts` chains by OCI layout under `_out/<board>/
stages/` -- worktree-local, and unable to collide with a sibling.

That is the right change and it has a consequence the predictions did not
account for: a fresh builder has an empty cache, so build D is a COLD rebuild of
all nine stages rather than a re-run of 33 through 90 over a warm one. Two
things follow, and they are recorded here rather than quietly absorbed:

- It removes the risk the predictions were most exposed to. A cold build cannot
  be a cache replay, so an empty difference set from D would now mean something
  is wrong with the experiment rather than that the cache answered it.
- It admits a confound they did not have. `stages/10-base` and `20-install` run
  `apt-get update && apt-get install` against the live Debian archive -- the
  BASE IMAGE is digest-pinned, the package versions are not -- so a cold
  rebuild can legitimately install different package versions than build A did,
  and any file that differs for that reason is package drift rather than a
  non-reproducible surface. They are told apart by ownership: the four
  predicted paths are two self-built binaries and two files generated at build
  time, while drift would show up as Debian-owned paths under
  `/usr/lib/x86_64-linux-gnu/`, `/usr/share/doc/` and the like, most likely with
  added and removed paths beside the content changes.

The predictions are NOT edited to cover this. They stand as committed, and if
the measured set is wider, what widened it is named here in advance.

### What the two queued builds measured

Build D (the full build again, commit 23037394a539) and build C
(`MOS_ROOTFS_WITHOUT=containers`, same commit) ran on a private
docker-container builder, so both chained by OCI layout under this worktree's
own `_out/x64/stages/` and wrote no daemon-global tag. Build D was cold: 142
`DONE` against 28 `CACHED`, and 379 apt progress lines. Build C exits 1, which
is the smoke runner refusing a feature-declined root rather than a failure --
the archive is written before the refusal.

**The predicted drift did not happen, and the prediction that did fail was mine
about the drift, not the one committed at 38743fc.** Build D's log shows
`Unpacking libssl3t64 (3.5.7-1~deb13u2) over (3.5.6-1~deb13u2)`, and from that
line alone this file previously expected openssl-owned paths in the difference
set. Measured against the roots: `/usr/lib/x86_64-linux-gnu/libcrypto.so.3` and
`libssl.so.3` are BYTE-IDENTICAL in both. The `over (3.5.6)` is relative to the
digest-pinned base image, and both builds upgraded to the same 3.5.7. A build
log said what a root did not.

**Build A vs build D: six content records, and the four predicted are among
them.** `/usr/bin/mosd` and `/usr/bin/apid` carry the embedded commit, as
predicted. `/boot/initrd.img-6.12.107+deb13-amd64` and
`/usr/share/factory/var/cache/ldconfig/aux-cache` differ, as predicted. Nothing
is added or removed and no mode, uid, gid, symlink or capability differs.

That comparison is the one the inference above needed, and it now settles it
for the initramfs. mosd and apid are not IN the initramfs, and the package
versions are identical, so its inputs were the same on both builds. Per cpio
entry: 183 entries, identical names, **zero entries whose content differs**, 182
differing in inode number and 71 in mtime, with the maximum mtime 2,615 seconds
apart -- the 43 minutes between the two builds. The aux-cache likewise: header
identical, all 128 library-path strings identical with an empty set difference
in both directions, only the binary `{dev, ino, ctime, size}` table moving. So
for these two paths the claim is no longer an inference: **the content is
identical and only the build's own metadata moves.**

**A THIRD non-reproducible surface, which nothing predicted.** The other two
records are `/usr/share/factory/etc/shadow` and `/etc/shadow-`, and they are a
different mechanism from the first two -- not an inode number but a DATE:

```
-  systemd-network:!*:20691:::::1:      20691 = 2026-08-26
+  systemd-network:!*:20696:::::1:      20696 = 2026-08-31
```

`messagebus`, `systemd-resolve` and `sshd` move with it. These are accounts
created by Debian package postinst scripts, and the shadow last-change field is
the day the account was made. The mos-owned accounts do NOT move -- `mos`,
`mos-mqttd` and `mos-mqtt-broker` all read 18262 (2020-01-01) in both builds,
because `os/rootfs/scripts/account-*.sh` pins them with `chage -d`. The
distribution's accounts get no such treatment.

This one is worse than the other two for a gate, because it is quiet. It is a
DAY, so two builds on the same day agree and only builds on different days
differ: it passes every same-session test and fails whenever the two paths of
the dual-build gate happen to straddle midnight. No stanza is written for it
here, for the same reason none is written for the other two.

**Build D vs build C: the addition and removal dimension, on real material for
the first time.** 9,234 paths against 9,199, and 38 differences: **35 `removed`
and 3 `content`**. The removals are the container engine and what only it pulls
in -- `/usr/bin/podman`, `/usr/bin/crun`, the five binaries under
`/usr/libexec/podman/` and that directory itself,
`/usr/lib/systemd/system-generators/podman-system-generator`, `/run/crun`,
`/usr/sbin/nft`, `/etc/nftables.conf`, `/usr/lib/systemd/system/nftables.service`,
its `deb-systemd-helper-enabled` record, the nftables/nftnl/jansson/subid
shared libraries with both their soname and real-name links, and eleven paths
under `/usr/share/doc/`. The three content records are the two non-reproducible
paths above plus `/etc/ld.so.cache`, which differs because the library set
really did change -- a consequence of the configuration, not a surface.

**The orientation trap, demonstrated rather than asserted.** Swapping the two
arguments gives the IDENTICAL 38-path set with 35 records reported as `added`
instead of `removed`, the 3 content records unchanged. A gate driver that got
the order backwards would not fail loudly; it would report a plausible set with
every class inverted, and a ledger written for one order would go green against
the other only by accident.

**The shipped `pending` stanza fired on real material.** Run in the composed
orientation, the difference set contains real added `/usr/share/doc/<package>/`
paths -- copyright files among them, which is exactly what PLAN-036 sanctions
in principle. The run reported:

```
PENDING SANCTION NOW LIVE .../dual-build-sanctions.md:377 '/usr/share/doc/**'
  (added) matches a real difference; promote it to 'status: active'
```

while still counting those paths as unsanctioned. That is both directions of
the pending rule, on real paths rather than on a fixture.

It also exposed a gap in that stanza, which is why it is written down here and
fixed below: `/usr/share/doc/**` matched
`/usr/share/doc/libjansson4/copyright` but NOT `/usr/share/doc/libjansson4`
itself, because `**` does not match zero path segments. The directory entry a
package creates is a difference of its own, and the shipped list now carries a
second pattern for it.

## What an x64-only comparison does not cover

PLAN-036 section 6 runs this comparison on x64 only; cx3576 is then built and
verified through the composer alone. That is a ratified decision, and this
section is what it costs, stated so that a verdict printed by the gate is not
read as covering more than it does.

**The limit is not in the comparator.** It knows nothing about boards or
architectures: it walks two directories and reports what differs between them.
Pointed at two cx3576 roots on a host that can execute arm64 it would work
unchanged, with no flag to set and no code to add. So what an x64-only run buys
is exactly one thing -- the amd64 pair of roots -- and everything that differs
only on the arm64 side is outside the set it was HANDED, not outside what it can
see. That distinction matters practically: closing this gap later is a matter of
running the same command against two cx3576 roots.

Not covered, and each of these is a real difference between the two boards
rather than a hypothetical one:

- **Architecture-dependent package selection and dependency closure.** Every ELF
  in a cx3576 root is a different build -- mosd, apid, mos-mqttd and
  mos-mqtt-broker from the aarch64 rust target, the seven engine binaries from
  `os/pkgs/podman/out-arm64`, rauc from `os/pkgs/rauc/out-arm64` -- and under the
  composer APT resolves the local and Debian dependency closure per
  architecture. A composition that resolves correctly for amd64 and wrongly for
  arm64 produces two trees this gate never saw.
- **Kernel and module handling**, which is not merely arch-different but
  structurally different. x64 takes kernel, initramfs and modules from Debian's
  `linux-image-amd64`, and `os/rootfs/build-v2.sh` stages an EMPTY `modules.tar`
  for it precisely because there is no vendor tree; cx3576 stages a vendor
  `modules.tar` out of its BSP. The module payload path is therefore
  UNEXERCISED on x64, not exercised at another architecture.
- **The cx3576 board payload**: the board's `bsp/rootfs` and `bsp/firmware`
  trees, the board overlay, and the per-board rendered
  `/etc/rauc/system.conf`, whose slot model comes from that board's `board.env`.
  None of it is in an x64 root at all, so no stanza here can ever have been
  written about it.

Two further boundaries belong in the same breath, because they are this
comparator's own rather than x64's, and a reader who assumed otherwise would
over-trust the verdict:

- It compares the **file tree of the packed root** and nothing else. Anything
  that is not a path inside a root is invisible to it: the
  `_out/<board>/` composition record and package-manager logs, the buildkit
  cache, and the squashfs + dm-verity encoding the device actually boots.
  `os/tests/factory-root-gate` is what ties the exported root back to the
  shipped image; this gate assumes that tie rather than re-checking it.
- It compares **no timestamps**. Both trees are `SOURCE_DATE_EPOCH`-pinned, but
  extraction carries no timestamp guarantee, so an mtime difference here would
  be a fact about tar. Reproducibility of the archives is gated elsewhere.

**What covers the gap instead**: the composed cx3576 image's own full verify run
and its smoke run. Both have to run on a host that can execute arm64. This
repository's smoke runner reports `executor-limited` under an emulated executor
-- a healthy line, and explicitly not a pass on the thing that was limited -- so
"covered by cx3576 verify" is a claim about a run on a binfmt-capable host, not
about one made here.

**And the escalation.** If a composed cx3576 verify ever fails in a way this
comparator would have caught had it been pointed at two arm64 roots -- a path
present in one composition and absent from the other, or a differing file type,
mode, uid, gid, symlink target, content hash or file capability -- that is
evidence against the x64-only choice, and it is to be reported to L1 rather than
fixed in place.

## Sanctions

### /usr/share/doc/**
- classes: added
- status: pending
- reason: PLAN-036 section 6 sanctions package documentation as an expected addition. The composed root installs real `.deb` packages, and each carries its own `/usr/share/doc/<package>/` payload -- the per-package Apache-2.0 copyright this campaign requires, at minimum. The stage chain installed those components by copying files into place and produced no such tree, so every path under it is an addition with no counterpart on side A. Pending until the composer exists; promote it to active in the same change that first produces the difference.

### /usr/share/doc/*
- classes: added
- status: pending
- reason: The directory entry itself, which the pattern above does not cover -- `**` does not match zero path segments, so `/usr/share/doc/**` matches `/usr/share/doc/mos-system/copyright` and not `/usr/share/doc/mos-system`. Measured, not reasoned: a real run against two roots differing by the container engine reported eleven added paths under `/usr/share/doc/`, and the `**` stanza matched the files while leaving the five package directories unsanctioned. Same sanction, same reason as above; a separate stanza because one glob cannot express both.

### /etc/mos/rootfs-packages.txt
- classes: added
- status: pending
- reason: PLAN-036 section 6's second sanctioned addition, the package composition record. Section 4 writes it to `_out/<board>/rootfs-packages.txt`, which is OUTSIDE both compared trees, so as specified today this difference cannot appear at all and the pattern here is a placeholder for the in-image copy the composer may also stage. The composer L3 owns correcting the pattern to the path it actually writes -- or deleting this stanza, if the record never enters the image. It is safe to be wrong while pending, because a pending stanza sanctions nothing: the worst a wrong pattern here can do is fail to match, which is its expected state.
