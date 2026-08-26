# RFCT-107 PLAN-014 M1: delete v1 and restructure the os/ tree without changing a byte of the image

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-25 10:50
- **claimedAt**: 2026-08-25 11:05
- **completedAt**: 2026-08-25 13:42
- **plan**: PLAN-014 (M1)

Delete the v1 single-slot chain and reshape `os/` into the PLAN-014 target
tree by pure `git mv` — zero logic changes.

## Scope

- Delete: `os/mkimage.sh`, `os/verify-image.sh`, `os/rootfs/build.sh`,
  `os/rootfs/Dockerfile`, their Makefile targets (`os-image-cx3576`,
  `os-verify-cx3576`), help text, and doc references. Sweep comments that
  cite v1 as a live sibling (e.g. `build-v2.sh`'s ROOT_PASSWORD note).
- Move (no content edits beyond path references):
  `layout/<b>-v2.env` → `boards/<b>/board.env`; `boot/cx3576-boot.cmd` and
  `boot/x64-grub.cfg` → `boards/<b>/`; `rootfs/overlay-<b>/` →
  `boards/<b>/overlay/`; `os/hwinit/` → `boards/cx3576/hwinit/`;
  `rauc/` + `bundle.sh` → `update/`; test scripts → `tests/`;
  `qemu-*.sh` → `tools/`; assemblers keep working from their new homes.
- Update every path reference: Makefile, inter-script, `shellcheck source=`,
  the consumer lists in the board env headers, doc citations.

## Acceptance

- `os-verify-*-v2` green for both boards on images rebuilt from the moved tree.
- A rebuilt image is byte-identical to one built from the pre-move commit,
  **apart from the enumerated set of shipped comment lines below** — seven files
  in which the only difference is a path string inside a comment.

  AMENDED 2026-08-25, at M1 close, **by the user**. The reason is that this
  clause and this task's own Scope were mutually unsatisfiable, not that the
  implementation fell short. Scope requires "Update every path reference:
  Makefile, inter-script, `shellcheck source=`, the consumer lists in the board
  env headers, doc citations". Seven of the files carrying such references are
  files the image SHIPS, so updating them changes image bytes, and not updating
  them leaves the shipped tree citing paths that no longer exist. No
  implementation could satisfy both clauses. The M1 gate built both sides,
  measured the delta, found it confined to comment lines, and refused to close on
  the unamended text; the decision the user took on that measurement was to
  accept the delta and enumerate it here rather than to exempt those seven files
  from Scope.

  The enumerated set — source file, and where it lands in the image:

  | source | shipped as |
  | --- | --- |
  | `os/rootfs/overlay-v2/etc/fstab.in` | `/etc/fstab` |
  | `os/rootfs/overlay-v2/etc/fw_env.config.in` | `/etc/fw_env.config` (cx3576 only; x64 has no U-Boot environment and the file is not rendered there) |
  | `os/rootfs/overlay-v2/usr/lib/mos/mos-health` | `/usr/lib/mos/mos-health` |
  | `os/rootfs/overlay-v2/usr/lib/mos/mos-seed-home` | `/usr/lib/mos/mos-seed-home` |
  | `os/update/rauc/system.conf.in` | `/etc/rauc/system.conf` |
  | `os/boards/cx3576/boot.cmd` | the `boot.scr` U-Boot executes, in both cx3576 boot slots |
  | `os/boards/x64/grub.cfg` | `/EFI/mos/grub.cfg` on the x64 ESP |

  The allowance is exactly this wide and no wider: a difference in any other
  file, or a difference outside a comment line in one of these seven, is a
  regression and not covered here. What was measured to establish that is
  recorded under "The M1 baseline" below.
- `make docs-verify` passes; **no code or build file references a deleted or
  pre-move path**; **live design documents that cite one are updated or
  annotated**; and **historical records that cite one are left standing**.

  AMENDED 2026-08-25, after M1 close, **by the user**, on the recommendation of
  L2 and L1. The reason is that the clause as drafted was unsatisfiable in
  principle, not that the sweep fell short of it.

  The original text read: "`make docs-verify` passes; a repo-wide grep finds no
  reference to a deleted or pre-move path." **No tree could satisfy that.** A
  path stops being named in the working tree as soon as the thing that names it
  is updated, but it cannot stop being named in the record of the work that
  moved it — and it must not. `docs/task/RFCT-*.md` and `docs/plan/PLAN-0*.md`
  are dated statements of what was true when they were written; editing their
  citations to the post-move paths would not correct a stale reference, it would
  falsify a historical record, and the grep would go quiet on a tree that had
  been made less truthful rather than more.

  What the clause did not admit is the distinction the amended text is built on:

  - a **live reference** is one something in the tree resolves — a Makefile
    target, an inter-script call, a `shellcheck source=` directive, a consumer
    list in a board env header. When it names a path that no longer exists it is
    a defect, and this is what the clause was aiming at.
  - a **historical citation** points into git history. It names the old path
    *because* that is where the thing it cites lives, and it is correct
    precisely for the reason the grep flags it.

  A live design document is the case between the two, and is why the middle
  requirement exists: it is read as current, so it may not silently cite a dead
  path, but its analysis was true when written and is not to be rewritten. The
  answer there is annotation — say that the anchors below are citations into
  history — and both such documents were handled that way.

  The work the clause was aiming at was done, and was verified done before this
  amendment was written. The evidence is the M1 gate's sweep, re-run at this
  commit; it is recorded under "The third acceptance clause: what was measured,
  and when" below, which is the same measurement the gate took and not a
  replacement for it.

## Dependencies

- Blocked on RFCT-106 landing on main (its working-tree changes touch
  `mkimage-v2.sh`, `mkimage-x64.sh`, `Dockerfile.v2`, `verify-image-v2.sh`).

## The M1 baseline

Anchored at close, from the gate run of 2026-08-25 (base `34d7b20`, moved
`457ad5d`). Read the next three subsections as three different kinds of claim:
the first is a durable contract, the second is the measurement that makes the
first checkable, and the third is dated evidence that is **deliberately not**
recorded as an expectation.

### What is anchored: the enumerated delta

The seven files in the Acceptance table above, and the fact that in every one of
them the entire difference is a path string inside a comment line — `os/layout/`
→ `os/boards/<board>/`, `os/rauc/` → `os/update/rauc/`, `os/health/test.sh` →
`os/tests/health-test.sh`, `os/boot/<board>-*` → `os/boards/<board>/*`, plus one
sentence in `mos-seed-home` that stopped saying "Both Dockerfiles" once there was
one. Two of the seven leave the packed root and reach the boot chain: the cx3576
`boot.scr` carries its comments verbatim into what U-Boot executes (6721 → 6724
bytes), and the x64 ESP `grub.cfg` likewise (7965 → 7970 bytes).

This is the part a later reader can check without rebuilding anything, and it is
what was actually accepted.

### The measurement that makes "only comments changed" a fact and not a claim

Both packed roots were unsquashed and compared entry by entry:

- **File presence and type are identical on both boards** — x64 7695 entries,
  cx3576 3741 entries, no additions, no removals, no type changes.
- **cx3576 differs in exactly 5 files**, all five from the enumerated set.
  Nothing else in the cx3576 image differs for any reason.
- **x64 differs in 10 files**: the same set (minus `fw_env.config`, not shipped
  there) plus 6 that this task did not cause — `boot/initrd.img-*`,
  `usr/share/factory/var/cache/ldconfig/aux-cache`, and four
  `usr/share/factory/var/log/*` apt/dpkg logs. Those six were isolated with a
  control: the base tree rebuilt against itself, with the buildkit cache broken
  at the same instruction, produces exactly those six and none of the four. They
  are wall-clock timestamps, they predate this task, and they are the subject of
  the follow-up work named below.
- **`rootfs-report-v2.txt` is byte-identical across the two trees on both
  boards** (x64 `3b7b3239…`, cx3576 `bbc3a5e2…`), so no package moved between the
  two builds and apt drift is excluded as an explanation.
- **`mosd`, `apid`, `mos-mqttd` and `mos-mqtt-broker` are byte-identical across
  the two trees on both boards**, so the differing absolute source path of the
  two worktrees does not leak into the binaries.

### The four image hashes: evidence of record, NOT a reproducible expectation

```
cx3576  base  34d7b20   6586b776cba3bb7e73e6050a8ba24c55c515ac8af58838d16c2278c0cfa6f97b  cx3576-mos-v2-1787661052.img
cx3576  moved 457ad5d   5412f70829b57e1ee48457aac78ad9d8fe783d6a0e45e95c581dbf4deede4017  cx3576-mos-v2-1787661246.img
x64     base  34d7b20   55883612c8482551e097f9e30f070c2426a2f786d6e2101a7e4c37d32d1c1b48  x64-mos-v2-1787660296.img
x64     moved 457ad5d   095f718e6593891df19638c4f5f37c3d550cbce11b1758e69800433b46e1c5d2  x64-mos-v2-1787660533.img

packed roots, same run:
cx3576  base  b31644504e17f4d52b1c9ec767b4ee5d8b109feacacb8299b6f31ed8814cbcd3  rootfs-verity.img
cx3576  moved 05b72468d04d35aca78f59072568f6e2ef9b17c4eab30e09e6413135f49b15ba  rootfs-verity.img
x64     base  e96cb6873138b260d963e35205ea7207d6cb8c03bdc8228a46d44376cecdc5b1  rootfs-verity.img
x64     moved 9522fba35cd7a69fb839e6a9a2081d880f7b6e77db86d5fccb18a57b97775ec6  rootfs-verity.img
```

**Do not treat these four image hashes as a baseline to compare a future build
against. They cannot be reproduced, including by the commit that produced them.**
That is a measured property of the assemblers as they stand at M1 close, not a
property of the build host:

- **cx3576**: two assemblies of byte-identical inputs, minutes apart, differ in
  exactly one MiB — the first MiB of EPHEMERAL. `os/mkimage-v2.sh:405` creates
  the seed stamp with `: >"${FACTORY_VAR_STAGE}/.mos-var-seeded"`, so it carries
  the wall clock, and `E2FSPROGS_FAKE_TIME` pins superblock times but not an
  mtime `mke2fs -d` copies in from its source. Read back with debugfs: inode 12,
  `.mos-var-seeded`, `25-Aug-2026 12:31` in one image and `12:36` in the other,
  every other entry equal. Everything else about cx3576 assembly is
  byte-reproducible.
- **x64**: two assemblies of byte-identical inputs differ in 9 one-MiB blocks —
  the ESP and both boot FATs, and the META/STATE/EPHEMERAL/DATA ext4 superblocks.
  `os/mkimage-x64.sh` pins none of the five determinism controls
  `os/mkimage-v2.sh` uses: `mkfs.vfat --invariant`, `mcopy -m`,
  `export E2FSPROGS_FAKE_TIME`, `mke2fs -E hash_seed=`, `mke2fs -E
  root_owner=0:0`. The differing bytes are FAT directory-entry create/write times
  and ext4 `s_wtime` / `s_lastcheck` / `s_hash_seed`.

A hash recorded as a baseline that nobody can reproduce is a check that looks
like coverage and is not — which is the failure this campaign has already hit
twice, in `os/tests/mkimage-v2-selftest.sh` being unrunnable from bb48e49 until
it was given a target, and in `os-bundle-cx3576` staying broken across two
merges. So the hashes are recorded as *what these two commits produced on this
date*, and nothing is asserted about what they will produce next time.

**A reproducible byte anchor becomes possible only after both assemblers are
made deterministic**, which is separate work already in flight at M1 close:
`bkd/kust5xxq` (the five x64 determinism controls) and `bkd/kyx2m64p` (the
EPHEMERAL seed times). When those land, the correct anchor is a hash taken from
the fixed assemblers and recorded then — not these.

**How to read a mismatch.** If a rebuild of `34d7b20` or `457ad5d` does not
reproduce the hashes above, that is expected and is not a regression: it is
either the nondeterminism described here or the deliberate repair of it by the
two branches named above. What a later reader should check instead is the
enumerated delta — that the two images differ in those files and only those
files, and only inside comment lines. That claim is stable across both the
current assemblers and the fixed ones, which is why it, and not a hash, is what
this task anchors.

No image-content normalisation mandate was added in the course of this decision.
M5's determinism normalisation in the `90-pack` stage stays exactly as
`docs/plan/PLAN-014.md` already defines it.

### The third acceptance clause: what was measured, and when

Two dates meet here, and the difference between them is the point.

**Measured by the M1 gate at close** (2026-08-25, base `34d7b20`, moved
`457ad5d`). The gate found the clause as drafted was not literally true, recorded
that instead of closing quietly over it, and **did not amend the requirement**,
because amending a requirement was not the gate's to do.

**Amended after close, the same day**, by the user — the third Acceptance bullet
above. So this subsection is no longer a note that the clause fails; it is the
evidence the amended clause rests on, and it stays for that reason.

**Re-run at this commit** rather than copied forward, before the amendment was
written. The numbers below are the re-run's.

#### The sweep, and how to repeat it

The paths at issue are every path `git diff --name-status -M 34d7b20 HEAD`
reports as deleted or as the source of a rename — **54 of them, 5 deleted and 49
moved** — each then searched for across every tracked file.

**A literal substring search overstates the result, and the overstatement lands
on code.** `os/rootfs/Dockerfile` was deleted; `os/rootfs/Dockerfile.v2` is live
and is cited widely. A substring match counts the second as a hit for the first,
adding 14 files — 8 of them code or build files, including `os/podman/Dockerfile`,
`os/build-env/images.env`, `os/update/rauc/Dockerfile` and
`os/rootfs/initramfs/scripts/mos-verity`. All 14 are false positives: every one
names `Dockerfile.v2` and none names the deleted file. The match has to reject a
path-continuation character:

```
git grep -lIP "\Qos/rootfs/Dockerfile\E(?![A-Za-z0-9_./-])"
```

Without that guard the sweep reports 68 files rather than 54 and appears to show
the tree's own build files citing a deleted path. It is the one trap in
re-checking this clause, so it is written down.

#### What the sweep returns

- **23 of the 54 paths are still named** somewhere in the tracked tree; the other
  31 are gone from it entirely.
- **54 files name at least one**, and the split is what the amended clause turns
  on:

  | where | files | what they are |
  | --- | --- | --- |
  | `docs/task/RFCT-*.md` | 44 | historical records |
  | `docs/plan/PLAN-0*.md` | 6 | historical records |
  | `docs/design/` | 2 | **live documents — annotated, below** |
  | `docs/research/` | 1 | historical record |
  | outside `docs/` | 1 | `os/rootfs/README.md` |

- **No code or build file references a pre-move path. Zero.** No Makefile target,
  no inter-script call, no `shellcheck source=` directive, no board env consumer
  list. The single hit outside `docs/` is `os/rootfs/README.md:8`, which names
  `os/mkimage.sh` and `os/verify-image.sh` in order to say that the v1 chain
  "was deleted" — it describes the deletion rather than depending on it.
- `make docs-verify` passes, 375/375.

#### The two live design documents

Both were annotated rather than rewritten, and by different means — worth knowing
before looking for a note that is not there in the shape expected:

- `docs/design/uboot-ab-handshake.md:32-38` carries **one note above the affected
  sections**: the v1 chain "still existed when this analysis was written",
  RFCT-107 deleted it, and "every `os/mkimage.sh:NN` anchor below is therefore a
  citation into git history, not into the tree".
- `docs/design/dashboard.md` instead annotates **at each citation** — `:1747-1748`,
  `:2787`, `:2789` and `:2891-2895` — each marking the v1 half of a claim as
  deleted by RFCT-107 and stating what survives it, e.g. "the cost is one
  verifier, not two; nothing else in the argument changes".

#### One correction to the gate's own count

The gate recorded 43 files under `docs/task/RFCT-*` and 5 under `docs/plan/`; the
re-run finds **44 and 6**. This is not drift since M1 close: the identical sweep
run against the gate's own commit `ab6ffe3` returns the same 54 files, name for
name, that it returns at this commit. The two extra are `docs/task/RFCT-107.md`
and `docs/plan/PLAN-014.md` — this record and its plan, the two documents the
campaign was writing as it measured, each of which names the v1 chain it deleted.
Excluding those two gives exactly 43 and 5. Every other number the gate recorded
stands as it wrote it.
