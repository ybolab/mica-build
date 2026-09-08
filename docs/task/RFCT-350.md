# RFCT-350 PLAN-086 S2: separate the debug and boot artefacts from the shipped root

- **status**: in-progress
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

(filled in on completion)
