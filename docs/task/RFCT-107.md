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

  AMENDED 2026-08-25, at M1 close. The reason is that this clause and this task's
  own Scope were mutually unsatisfiable, not that the implementation fell short.
  Scope requires "Update every path reference: Makefile, inter-script,
  `shellcheck source=`, the consumer lists in the board env headers, doc
  citations". Seven of the files carrying such references are files the image
  SHIPS, so updating them changes image bytes, and not updating them leaves the
  shipped tree citing paths that no longer exist. No implementation could satisfy
  both clauses. The M1 gate built both sides, measured the delta, found it
  confined to comment lines, and refused to close on the unamended text; the
  decision taken on that measurement was to accept the delta and enumerate it
  here rather than to exempt those seven files from Scope.

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
- `make docs-verify` passes; a repo-wide grep finds no reference to a
  deleted or pre-move path.

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

### The third acceptance clause, as measured

Recorded because it is not literally true and closing the task without saying so
would mislead. `make docs-verify` passes (375/375). The repo-wide grep does
**not** return nothing: 23 of the 54 deleted or pre-move paths are still named
somewhere. Every one of those places is a document — 43 files under
`docs/task/RFCT-*`, 5 under `docs/plan/`, 1 under `docs/research/`, and two live
design documents. **No code or build file references a pre-move path**; the only
non-docs hit is `os/rootfs/README.md:8`, which states that the v1 chain "was
deleted". The two live design documents were annotated rather than rewritten —
`docs/design/uboot-ab-handshake.md:32-38` records that every `os/mkimage.sh:NN`
anchor below it "is therefore a citation into git history, not into the tree",
and `docs/design/dashboard.md` carries the equivalent note. The historical task
and plan records were deliberately left standing, because rewriting them would
falsify what was true when they were written. The clause as drafted does not
admit that distinction; the work it was aiming at was done.
