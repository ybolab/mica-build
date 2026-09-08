# RFCT-350 PLAN-086 S2: separate the debug and boot artefacts from the shipped root

- **status**: completed
- **priority**: P1
- **owner**: bkd/vjrvcif5
- **createdAt**: 2026-09-08 00:10
- **relatedPlans**: [PLAN-086](../plan/PLAN-086.md) S2

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

PLAN-086's second slice, and the first that changes the bytes of files the
image ships. Two removals, each of which is only defensible together with an
export:

- **The debug information.** [RFCT-346](RFCT-346.md) measured the root: of
  1,022 user-space ELF files, thirteen carry any `.debug*`, `.symtab` or
  `.strtab` at all -- 44,804,825 bytes -- and every one of the thirteen is
  built by this repository. Debian ships its own stripped. Stripping alone
  would be a size reduction that costs the ability to resolve a core taken off
  a device, so the deliverable is the split: strip with target-aware tools,
  export the debug halves, and assert the match.
- **The boot inputs.** cx3576 carries its kernel `Image`, device tree, U-Boot
  blob and `boot.cmd` under `/usr/lib/mos/board/cx3576`; a UEFI board carries
  `/boot/vmlinuz-<release>`. Neither is read by anything running on the device
  -- the kernel a slot boots is on the boot partition and U-Boot is in the
  loader region -- and both are already in the image somewhere the hardware
  can reach. The plan requires ONE export, consumed by image and bundle
  assembly, before the copies leave the root.

## ActiveForm

Splitting the debug information out of the shipped binaries, and taking the
boot blobs out of the root into the export both assemblers read

## Dependencies

- **blocked by**: (none) -- S1 shipped the baseline this measures against
- **blocks**: (none) -- S3 and S6 are separate slices

## Acceptance

- The thirteen debug files stripped and exported outside the rootfs, with the
  match to the shipped binary asserted rather than the existence of some files.
- Boot inputs exported once and consumed by image AND bundle assembly, cx3576
  included.
- `verify/run.sh --smoke` green on every board touched; `--verify` at its
  current count or higher, with any change explained.
- The size delta measured with `tools/measure-rootfs.sh` against S1's baseline,
  per board, and recorded in PLAN-086's S2 row.
- `make docs-verify` green from a `git archive` into an empty directory.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

## Notes

The durable record is PLAN-086's S2 row. What follows is what only this task
can say.

### Where the work went, and the one place the plan expected it elsewhere

Both removals happen in **90-pack's `pack` stage**, beside each other, and
PLAN-086's Scope line says "user-space producer packaging for debug
separation" -- i.e. it expected the strip in `build-env/deb/pack.sh`, once per
producer. It is here instead, and the reason is the verification clause rather
than convenience: S2's own row asks to *"reject boot blobs and removable
user-space debug sections in the packed root"*, and that is an assertion about
one tree, made in the one place that has it. Doing the strip per producer would
have left that assertion with no remedy for anything a producer did not build,
would have needed a second export path out of sixteen producer Dockerfiles into
a pool directory `repo.sh` indexes, and would not have covered a future Debian
package that ships unstripped. The cost is stated rather than hidden: the
`.deb` archives in the pool still carry their debug sections, so the pool is
unchanged in size and only the shipped root shrinks.

The tools are the TARGET's. The `pack` stage runs on `$BUILDPLATFORM` while
`/rootfs` is the board's, so `binutils-x86-64-linux-gnu` and
`binutils-aarch64-linux-gnu` are both installed and `MOS_ARCH` picks the
prefix. Both, not the selected one, so the apt layer stays keyed on the base
digest alone instead of on the board.

### The match is the build-id, and it was nearly asserted vacuously

`readelf -nW` prints the value on the SAME line as the note type, after a tab;
`readelf -n` puts it on its own line. The first draft of the extraction was
`sed -n 's/^[[:space:]]*Build ID: ...'`, anchored -- which matches the narrow
output a human sees at a terminal and matches NOTHING here. Under it the
verification `[ "${id}" = "${dbg_id}" ]` compared two empty strings and passed
for all thirteen files. The rehearsal that caught it was a
`printf` whose field count went wrong, not the check itself.

Two consequences in the tree. The extraction now matches unanchored and says
why in a comment. And `verify/src/checks-debug.ts` reads the note with its own
ELF parser (`verify/src/elf.ts`, 214 lines: header, section table, note walk)
rather than grepping another program's prose -- a claim that a debug file
belongs to a binary should not be one spelling change away from matching
nothing and reporting green.

### What the export actually resolves -- measured, not assumed

`--only-keep-debug` keeps what is there, and what is there differs by
toolchain. Read back out of the thirteen exported files:

| carries | binaries |
|---|---|
| **DWARF + symbols** (file and line) | podman, crun, quadlet, catatonit |
| **symbols only** (function names) | apid (68,004 syms), netavark (76,448), mosd (51,238), mos-mqtt-broker (36,947), mos-mqttd (36,743), rauc-update (30,105), rauc-verify (28,661), aardvark-dns (18,034), conmon (543) |

The nine had no DWARF before this slice either -- the Rust release profile
emits none -- so nothing was destroyed and nothing was gained for them beyond
moving the bytes out of the signed root. It is recorded because "export
matching debug files" reads like "a core is now fully resolvable", and for nine
of thirteen it is not; making it so is a change to how those crates are
compiled, not to where the result is put. PLAN-086's annotations carry the same
paragraph so a reader of the plan does not have to find this record.

### The numbers, and the one that did not move

| | cx3576 | virt-arm64 |
|---|---:|---:|
| payload bytes | 362,588,488 -> **263,535,103** | 412,668,495 -> **314,622,397** |
| the same, MiB | 345.79 -> 251.33 | 393.55 -> 300.05 |
| delta | **-99,053,385 B (-94.47 MiB)** | **-98,046,098 B (-93.50 MiB)** |
| squashfs bytes | 115,187,712 -> 79,671,296 | 124,088,320 -> 88,702,976 |
| rootfs image bytes | 116,391,936 -> 80,740,352 | 125,829,120 -> 90,177,536 |
| `TOTAL_MB` | 358 -> 262 | 408 -> 314 |
| user-space debug bytes | 44,804,736 -> **0** | 44,804,736 -> **0** |
| boot inputs in the root | 54,464,989 -> 227,622 | 53,535,273 -> 305,193 |
| kernel-module symbol bytes | 736,766 -> **736,766** | 10,854,802 -> **10,854,802** |
| regular files | 3,108 -> 3,104 | 4,031 -> 4,030 |

Both "before" columns were measured HERE, with
`bash tools/measure-rootfs.sh --board <board>` against the post-S4 roots this
worktree inherited, rather than copied from S1's table -- the cx3576 debug
figure differs from RFCT-346's by 89 bytes, which is a rebuilt binary and not a
disagreement worth propagating.

**The kernel-module row is the point of the two rows above it.** Stripping a
module breaks loading, so the plan's *"preserve module symbols needed for
loading"* clause is discharged by that number being byte-identical on both
boards while the user-space one goes to zero. `pack-export-debug.sh` excludes
modules twice -- by path and by `e_type == ET_REL` -- and prints both counts
(157 by path on cx3576, 1,273 on virt-arm64; 0 by type on either), so neither
rule can be the only one working without that being visible.

**What did NOT move: the assembled disk image.** cx3576 stays 1,378,877,440
bytes and virt-arm64 2,032,140,288 -- byte for byte what each was before --
because both rootfs slots are at their FLOOR
(`ROOTFS_SLOT_MIB` 256 and 512) and the payload was already under it. The
saving is real and it is in the slot's free space, in the update bundle
(cx3576's rootfs.img 116,391,936 -> 80,740,352 bytes) and in every byte a
device has to download. Setting tighter slot floors from these numbers is S6's
"set tighter image budgets from verified results", not this slice's; the
`BOARD_SIZE_BUDGET_MB` gates are untouched and both boards now pass them with
138 and 166 MB of headroom.

### `TOTAL_MB` moved stages, and it had to

It was measured in `closed`, whose own comment says it is there so the budget
gate "weighs the root that ships". Both of this slice's removals happen in
`pack`, after that point, so a number taken where it was would have overstated
the shipping root by ~95 MB on either board. It is now measured over `/rootfs`
at the last moment before mksquashfs reads it, and appended to the same report
in the same position, so the file's shape does not move.

### Verification

| | cx3576 | virt-arm64 |
|---|---|---|
| `rootfs/build.sh` | green | green |
| `verify/run.sh --smoke` | **PASS**, 11 pass + 1 executor-limited of 12 | **PASS**, same |
| `verify/run.sh --verify` | **426/426**, 3 skipped | **321/321**, 22 skipped |
| image assembly | `--mkimage-cx3576` green | `--mkimage-uefi --board virt-arm64` green |
| bundle | `--bundle` green, rootfs.img 80,740,352 | `--bundle` green, rootfs.img 90,177,536 |
| `tools/measure-rootfs.sh` | green | green |

**The check count moved by exactly +3 on each board, and the three are named:**
`packed-no-user-debug-sections`, `debug-export-matches-shipped` and
`packed-no-boot-blobs`. 423 -> 426 and 318 -> 321. Nothing else in the register
changed verdict -- including
`factory: root hash in BOOT-A's cmdline vs the locally built rootfs-verity.env`,
which is the check the boot move was most likely to break and which reports
`75941718...` on the cx3576 image assembled from the new export.

The executor-limited entry is crun's pre-existing one: its CVE-2024-21626
mitigation re-executes libcrun through a memfd and `qemu-user` cannot service
that `fexecve`. It is declared per artefact in `verify/src/smoke-register.ts`
and predates this task.

Unit suites: `bash verify/run.sh` **1349/1349**, of which 41 are new -- 27
cases in `checks-debug.test.ts` and 14 in `elf.test.ts`; `bash build/run.sh`
**936/936**, `bash tests/shell-pipefail-lint.sh` 92/92,
`bash tests/host-toolchain-lint.sh` 347/347 with 0 findings, `make docs-verify`
green from a `git archive` of HEAD into an empty directory.

Every negative in the new family is driven from the failing side, including its
own vacuity: the debug scan's search space is pinned to the manifest's own
paths (deleting the stripped binaries turns it RED rather than green), the boot
scan's to `/boot/config-*`, and the export check refuses an empty manifest and
an export holding only the `.no-kernel-in-root` marker.

### What is owed, and one defect found on the way

- **x64.** Not covered. No x64 root can be composed in this tree without a full
  amd64 pool, which RFCT-347 measured at ~40 minutes for 13 producers, and this
  worktree has neither `pkgs/podman/out-amd64` nor an x64 BSP kernel. Only the
  arm64 pool was rebuilt at this commit; `_out/debs/amd64` in this worktree
  holds the four `Architecture: all` packages at the new stamp beside older
  ones and was deliberately NOT re-indexed. x64's boot half is the same code
  path virt-arm64 exercises (`/boot/vmlinuz-<release>`, one export, GRUB), and
  its debug half is the same thirteen binaries at a different architecture --
  but that is an argument, not a measurement.
- **Physical cx3576.** Everything here is cross-build, image-contract and
  emulated-execution evidence. No device booted.
- **`make os-factory-root-gate` cannot pass on ANY arm64 root, and this is not
  S2's doing.** `tests/factory-root-gate/inner.sh` compares the two exports with
  `diff -r --no-dereference`, and `diff` cannot compare device nodes: it reports
  `File .../dev/null is a character special file while file .../dev/null is a
  character special file` for each of the eight under `/dev`, which the script
  counts as eight differing lines and turns into
  `FIDELITY: 1 of 4 comparisons differ`. Verified to PREDATE this task by running
  the same gate against the untouched pre-S2 cx3576 pair from `/srv/mos/_out`:
  **identical failure, same eight lines, `METADATA: identical`, `CAPS:
  identical`, `HARDLINKS: identical`**. The gate's own README already says
  "cx3576 is unmeasured", and this is why. Left for whoever owns that gate.
- **`_out/<board>/mosd-build.txt` is not written**, so the smoke run prints
  `build commit NOT ASSERTED` instead of checking the commit mosd and apid
  embed. Also pre-existing: the file is absent in `/srv/mos/_out/cx3576` too.

### Files touched outside the repository

`pkgs/podman/out-arm64`, `pkgs/rauc/out-arm64` and `pkgs/rauc/out-amd64` were
copied in from `/srv/mos` (all gitignored build outputs, needed to rebuild the
pool and to sign a bundle on this host), and `_out/` was seeded from the same
place. Nothing under version control was touched outside the commit.
