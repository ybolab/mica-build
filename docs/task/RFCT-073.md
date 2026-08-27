# RFCT-073 Assert the custom-UI location as an on-image fact, and negative-test every assertion

- **status**: completed — six assertions added to the v2 verifier, each proved to fail against a mutated input, with its own message
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-20 14:27
- **claimedAt**: 2026-08-20 14:30
- **completedAt**: 2026-08-20 15:10

Campaign `l1-o7ee8v0o-20260820142702-ui`, phase 4 of `docs/design/api.md` §8.2.
Branch `bkd/5mhu1ohw`. Base `b4b7c72`.

```
$ git rev-parse HEAD
b4b7c72f09eb56ab420f93b8ff799abc95a15560
$ git merge-base --is-ancestor b4b7c72f09eb56ab420f93b8ff799abc95a15560 HEAD && echo BASE-OK
BASE-OK
```

No Rust was written or changed; `mosd/` was not touched.

## Description

`docs/design/api.md` §5.2 puts a customer's UI bundle root at `/srv/ui` and
argues that this needs **no ninth bind and no seed unit**, because `/srv` is the
DATA partition's own mountpoint. §10.2 concludes from this that *"no new
assertion is proposed"*, on the grounds that the three facts §5.2 leans on are
already asserted:

| §5.2's claim | where it is asserted |
| --- | --- |
| `/srv` is DATA, `noatime,x-systemd.growfs` | `os/verify-image-v2.sh:1425` |
| every fstab/bind mountpoint exists in the packed root | `os/verify-image-v2.sh:1277-1281` |
| `/srv` is in the packed root | `os/rootfs/Dockerfile.v2:255` |

**All three resolve, and all three are about `/srv` as a partition.** None of
them says *"this is where a custom UI lives"*. Move `UI_ROOT` to `/var/lib`, or
onto STATE for tidiness, and every one of them still passes while every custom
UI on every device either disappears at the next `/var` wipe (`/var` is *"fixed
size disposable residue"*) or fills a 64 MiB partition alongside the settings
tree and the sshd host keys. An assertion that holds whether or not the thing it
protects is true is the failure mode this repository's verifier idiom exists to
prevent, so §10.2's conclusion is the thing this task overturns.

## Deliverable

| file | what |
| --- | --- |
| `os/verify-image-v2.sh` | `UI_ROOT`, `DATA_MOUNT`, `PACKED_MOUNTPOINTS`, `fstab_covering_line`, `check_ui_location` (six assertions), and the `MOS_VERIFY_FIXTURE_ROOT` hook |
| `os/ui-location-test.sh` | nine cases driving the real verifier against mutated fixtures |
| `Makefile` | `os-ui-location-test`, with the comment block saying what it proves that the image contract cannot |
| `docs/task/RFCT-073.md`, `docs/task/index.md` | this record and its row |

```
$ git diff --cached --stat b4b7c72
 Makefile               |  19 +++-
 docs/task/RFCT-073.md  | 241 ++++++++++++++++++++++++++++++++++++++++
 docs/task/index.md     |   1 +
 os/ui-location-test.sh | 237 +++++++++++++++++++++++++++++++++++++++
 os/verify-image-v2.sh  | 150 ++++++++++++++++++++++--
 5 files changed, 639 insertions(+), 9 deletions(-)
```

Nothing under `mosd/`, `os/rootfs/`, `os/verify-image.sh`, `docs/design/api.md`
or `docs/README.md` was touched.

## The six assertions, named by what each catches

The covering fstab entry is **derived** from `UI_ROOT` by longest matching
mountpoint prefix, not looked up under `/srv`. Move `UI_ROOT` and the checks
follow it; mount something deeper over the path it sits under and they notice.
That derivation is itself negative-tested.

**They chain to the existing evidence rather than restating it.** Two constants
are now the single definition consumed both by the existing checks and by the
new ones:

| constant | consumed by |
| --- | --- |
| `DATA_MOUNT="/srv"` | the `check_fstab "DATA is the growth target"` call, and assertion 1 |
| `PACKED_MOUNTPOINTS="/mnt/state /mnt/meta /srv /var /home /root"` | the mountpoint-exists loop, and assertion 4 |

So assertion 1 says *"the entry that governs the path apid reads is the entry
the DATA check already proved out"*, and assertion 4 says *"the mountpoint that
governs it is one whose existence the mountpoint loop already proves"* — neither
re-stats a directory or re-validates a GUID. The new fact is only the one
neither existing check can express: **which** of them governs `/srv/ui`.

| # | catches | fires when |
| --- | --- | --- |
| 1 | a UI root drifted off the DATA mount | the covering mountpoint is not `DATA_MOUNT` from `${DATA_GUID}` |
| 2 | a UI root moved onto the 64 MiB STATE partition, where the first large bundle fills it and takes the settings tree and the sshd host keys with it | the covering entry is `${STATE_GUID}`'s |
| 3 | a UI root moved onto the wipeable `/var` partition, where every installed UI silently disappears at the first clear | the covering entry is `${EPHEMERAL_GUID}`'s |
| 4 | a UI root under a mountpoint **nothing** has asserted exists in the read-only root, which a verity root cannot create at boot | the covering mountpoint is outside `PACKED_MOUNTPOINTS` |
| 5 | a UI root with a fixed ceiling, where two bundle generations hit a wall no larger disk relieves | the covering entry lacks `x-systemd.growfs` |
| 6 | **any content baked under the UI root**, which sits on the read-only squashfs and either silently **wins** over the bundle an operator installed or silently **never updates** when that bundle changes — neither raises an error anywhere | anything exists at or under `${ROOT}/srv/ui` |

Assertion 5 is not the DATA entry's `growfs` restated: it is read off whichever
entry the derivation lands on, so it keeps holding in exactly the case
`:1425` cannot see — the covering entry being some other partition.

Assertion 6 is the one no existing check covers in **either** direction, and the
one §10.2 named as the only circumstance under which an assertion would become
owed. It is owed now, in the negative, and it is deliberately broader than
*"the directory is absent"*: the failure that matters is a **bundle** baked into
the image, not an empty directory.

## The verifier check total, before and after

Both runs are against the same image, `cx3576-mos-v2-1787236985.img`, built at
this task's base with `BOARD_DIR=/srv/ai/mos/board/cx3576` (the BSP artifacts
are prebuilt; this worktree has no `board/cx3576/out`).

```
$ BOARD_DIR=/srv/ai/mos/board/cx3576 make os-verify-cx3576-v2     # base b4b7c72
RESULT: PASS (317/317 checks)

$ BOARD_DIR=/srv/ai/mos/board/cx3576 make os-verify-cx3576-v2     # with this change
RESULT: PASS (323/323 checks)
```

**Delta +6, which is exactly the number of assertions added.** A change that
added assertions and left the total unmoved would mean they never ran.

The six new lines, quoted from the second run:

```
PASS: catches a custom UI root moved off DATA: /srv/ui resolves under /srv, the DATA mount asserted above (partuuid=5ac35760-0002-4000-8000-000000000010)
PASS: catches a custom UI root moved onto STATE: /srv/ui is not governed by partuuid=5ac35760-0002-4000-8000-000000000008
PASS: catches a custom UI root moved onto the wipeable /var partition: /srv/ui is not governed by partuuid=5ac35760-0002-4000-8000-000000000009
PASS: catches a custom UI root under an unasserted mountpoint: /srv is in the set the packed-root mountpoint check proves exists (/mnt/state /mnt/meta /srv /var /home /root)
PASS: catches a custom UI root with a fixed ceiling: the entry governing /srv/ui (/srv) carries x-systemd.growfs
PASS: catches content baked under the custom UI root: the packed read-only root ships nothing at or under /srv/ui, which is the defined shipped state -- apid creates it on first install and no seed unit is owed
```

The last line is also the answer to *"does the image bake anything under
`/srv/ui` today?"* — **it does not**, so `os/rootfs/**` is owed no change and
none was made.

The two hoisted constants render the pre-existing checks identically, which the
same run shows:

```
PASS: every fstab/bind mountpoint exists in the read-only root (/mnt/state /mnt/meta /srv /var /home /root)
PASS: /etc/fstab mounts /srv from PARTUUID=5ac35760-0002-4000-8000-000000000010 with noatime,x-systemd.growfs (DATA is the growth target)
```

## The negative direction

`os/ui-location-test.sh` runs the **real** `os/verify-image-v2.sh` once per
case, with `MOS_VERIFY_FIXTURE_ROOT` naming a fixture directory that stands in
for the unpacked read-only root. That env var is the same shape
`mos-shadow-reconcile` already carries for `os/shadow-reconcile-test.sh`
(`MOS_SHADOW_PASSWD`, `MOS_SHADOW_FACTORY`): the real script's inputs are
redirected so the real script can be driven, rather than reimplemented in a
test — a reimplementation would be testing the test's idea of the assertion.

The baseline fixture is not hand-written either. It is the shipped
`os/rootfs/overlay-v2/etc/fstab.in` rendered with the shipped
`os/layout/cx3576-v2.env`, exactly as `os/rootfs/build-v2.sh:165-190` renders
it, with one directory per mountpoint the rendered file names. Every case then
mutates that baseline. Mutating an fstab the test had authored would prove only
that the test can spell.

No root, no image, no docker, nothing outside a temp dir; it fails loudly when
it cannot run rather than skipping (`os/repart-loader-test.sh`'s rule).

**Which mutation makes each assertion fail, and what it prints:**

| assertion | mutated input | the FAIL it prints |
| --- | --- | --- |
| 1 (off DATA) | `/srv` mounted from `${EPHEMERAL_GUID}`; also from `${STATE_GUID}`; also a deeper `/srv/ui` entry | `catches a custom UI root moved off DATA: /srv/ui resolves under mountpoint /srv mounted from '...009', not under /srv from partuuid=...010` |
| 2 (STATE) | `/srv` mounted from `${STATE_GUID}` | `catches a custom UI root moved onto STATE: ... STATE is 64 MiB, section 5.3 keeps TWO bundle generations, and the first large bundle fills it -- taking the settings tree and the sshd host keys down with it` |
| 3 (`/var`) | `/srv` mounted from `${EPHEMERAL_GUID}` | `catches a custom UI root moved onto the wipeable /var partition: ... every installed custom UI silently disappears the first time it is cleared` |
| 4 (unasserted mountpoint) | a deeper `/srv/ui` entry, so the covering mountpoint leaves `PACKED_MOUNTPOINTS` | `catches a custom UI root under an unasserted mountpoint: /srv/ui is governed by /srv/ui, which is NOT in the set the packed-root mountpoint check covers` |
| 5 (ceiling) | `x-systemd.growfs` stripped from the `/srv` entry | `catches a custom UI root with a fixed ceiling: the entry governing /srv/ui (/srv) lacks x-systemd.growfs; options are 'noatime'` |
| 6 (baked content) | the bare `/srv/ui` directory added; **and** a bundle baked at `/srv/ui/bundles/1/index.html` | `catches content baked under the custom UI root: the packed read-only root ships /srv/ui /srv/ui/bundles /srv/ui/bundles/1 /srv/ui/bundles/1/index.html. Anything baked there ... either silently WINS over the bundle an operator installed or silently NEVER UPDATES` |
| derivation | a deeper `/srv/ui` fstab entry on `${EPHEMERAL_GUID}`, `/srv` left correct | the messages name `mountpoint /srv/ui`, not `/srv` — derived, not hardcoded |
| no-cover branch | the `/srv` entry deleted outright | `catches a custom UI root with NO filesystem under it: no /etc/fstab entry covers /srv/ui` |
| *the chain itself* | `/srv` removed from the fixture **tree** | **all six still pass** — existence is `:1277-1281`'s fact, and a UI assertion that also fired here would be the parallel copy the chaining exists to avoid |

Each case asserts a non-zero exit **and** an exact expected count of `FAIL:`
lines — stated rather than inferred, since two substrings can legitimately
belong to one message — **and** that each expected substring appears in a FAIL
line. Matching only the exit status would let an assertion that fired for an
unrelated reason count as a pass, and an extra assertion firing is a failure of
the test rather than a bonus.

Case 0 is the positive control — the unmutated fixture, six PASS, zero FAIL,
exit 0. Without it every negative could be passing because the fixture is
malformed in some way that has nothing to do with the mutation. The
`/srv`-removed case is a second deliberate all-pass, documenting the chain.

```
$ make os-ui-location-test
RESULT: PASS (9/9 cases)
```

## Checks run

| command | result |
| --- | --- |
| `bash docs/verify-index.sh` | `158/158 PASS` |
| `make os-ui-location-test` | `RESULT: PASS (8/8 cases)` |
| `make os-image-cx3576-v2` | image assembled |
| `make os-verify-cx3576-v2` | `317/317` at base, `323/323` after |
| `make os-image-cx3576` + `make os-verify-cx3576` | `RESULT: PASS (136/136 checks)`, unchanged |
| `mosd/hack/check.sh` | **not run, and not owed**: `git diff --name-only` lists `Makefile`, `os/ui-location-test.sh`, `os/verify-image-v2.sh` and two files under `docs/task/`. No `.rs`, no `Cargo.toml`, nothing under `mosd/`. |

## Findings — reported, not fixed

**F1. v1 is owed nothing, and this is structural.** `os/verify-image.sh` was not
touched. The v1 image is three partitions — `loader`, `boot`, `rootfs` — and its
root filesystem is a **writable, growable ext4** mounted from
`PARTLABEL=rootfs` with `x-systemd.growfs` (`os/verify-image.sh:569`). There is
no DATA partition, no STATE, no EPHEMERAL and no `/srv` mount anywhere in the v1
layout; `os/layout/` contains only `cx3576-v2.env`. Every premise of §5.2 — the
DATA tier, the verity root that cannot create a mountpoint, the bind that is not
needed — is absent there, so there is nothing for a v1 assertion to assert.
`make os-verify-cx3576` prints `RESULT: PASS (136/136 checks)`, the same total
as at base.

**F2. Two §5.2 citations into `docs/design/access.md` no longer resolve.**
Reported here; `docs/design/api.md` belongs to L3 I and was not edited.

| §5.2 cites | for | actually at |
| --- | --- | --- |
| `access.md:476-479` | *"one mount unit plus one verifier assertion"* | **`:486-487`** (§10.2's heading is `:484`; `:476-479` lands inside §10.1) |
| `access.md:481-492` | the eight-bind table | **`:491-500`** (`:491` header, `:492` separator, the eight rows `:493-500`); the cited range covers ten lines of §10.1/§10.2 prose and only the table's first two lines |

**F3. The §5.2 citations into the image and the verifier all resolve exactly.**
`os/verify-image-v2.sh:1425` is the `check_fstab "DATA is the growth target"`
call verbatim; `:1277-1281` is the mountpoint-exists loop and its `pass` line;
`os/rootfs/Dockerfile.v2:255` is `mkdir -p /srv /mnt/state /mnt/meta /home`;
`fstab.in:12` is the storage-tier comment naming `/srv` as DATA, `:16` is *"Only
/srv carries x-systemd.growfs"*, `:23` is the `@SRV_LINE@` placeholder itself.
Also checked and resolving: `home.mount:12-14`, `:20-21`, `root.mount:29-30`,
`mos-seed-home:9-18`, `:24-30`, `:44-47`, and `fstab.in:7-9` from §5.1.

*(These line numbers are as of `b4b7c72`. The assertions added by this task
shift `os/verify-image-v2.sh:1425` and `:1277-1281` downward; F3 records that
they resolved on the base the citations were measured against.)*

**F4. Two §5.1/§5.2 citations outside `access.md` have also shifted.** Lower
confidence that these matter, and reported for the same owner:

- `docs/design/dashboard.md:2186`, `:2198-2199` — cited for the scorecard row
  *"`webd` can be non-root: yes"*. That row is now `:2358` and reads
  `| \`apid\` can be non-root | **never** | **yes** | unchanged |`. The file
  belongs to campaign `l1-o7ee8v0o-20260819152009-apid`.
- `docs/design/ro-root.md:239` — cited for *"there is no remount to perform"*.
  The string is at `os/rootfs/overlay-v2/etc/fstab.in:7-9` (which does resolve);
  `ro-root.md:239` is now a sentence about the pack stage's `/etc/passwd`.
  `ro-root.md:13-27` still contains the dm-verity hash-tree diagram at `:25`.

**F5. The pre-rename path spelling in §§4-6 is expected and is reported once.**
`mosd/webd/Cargo.toml`, `mosd/dist/webd.service`, `/usr/bin/webd` and the rest
predate `b1e23b2`; the crate, the binary and the unit are `apid` now
(`mosd/dist/apid.service` exists, `mosd/dist/webd.service` does not). §10.2
already flags one of these in passing. Not enumerated per citation.

## What is NOT claimed — hardware

**This work was not exercised on hardware.** The precise position, because both
overstatements are equally wrong:

- Hardware **has** booted. A **v1** image reached the `mos login:` prompt on a
  real CX3576-Z, and the repart/maskrom and SPL-hash investigations were both
  conducted against a real board. "Never booted" would be false.
- What has **never been exercised on hardware** is the **v2** stack: the verity
  root, A/B, `rauc install`, and apid itself. "Verified on device" would be
  equally false.

What this task did: built a v2 image with `make os-image-cx3576-v2` and checked
it on the host with `make os-verify-cx3576-v2`, and ran fixtures in a temp dir.
**A packed image verified on a host is not a booted device.** No assertion here
observes DATA mounting, `systemd-growfs` growing it, or apid creating `/srv/ui`
on first install. Those are first-boot facts on the unexercised v2 stack and
this task establishes none of them.

The assertions constrain **the image**, not apid. Assertion 6 says the image
must bake nothing under `/srv/ui`; it cannot say apid creates it, because apid
does not implement the custom-UI lifecycle yet — that is phase 5, and this
campaign has no upload route.

## Deliberately out of scope

§6.3's **reserved built-in prefix** — the assertion that it is absent from the
writable root and served from the binary, unshadowable by construction rather
than by dispatch order — is **not** part of this task. The prefix does not exist
in the tree yet; it is created by a later L3 and asserted by RFCT-077. Nothing
here stubs it or asserts against an invented prefix.
