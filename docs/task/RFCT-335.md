# RFCT-335 Add a generic virtual arm64 board, bootable in QEMU

- **status**: completed
- **priority**: P1
- **owner**: bkd/y6gfy207
- **createdAt**: 2026-09-06 08:20

> The index line in `docs/task/index.md` is written by L1, not by this task.
> `scripts/task-state.sh claim` was deliberately not used: it edits the index
> under a lock, and this branch must not touch it.

## Description

This tree ships two boards and neither covers the case that matters most for
testing arm64:

- `x64` is the QEMU target and says so in its own layout header — it exists
  because "the arm64 build cannot prove that a container actually starts".
- `cx3576` is arm64 and is a real board: U-Boot, an SPL at a fixed sector, a
  vendor BSP. It cannot be booted here.

So every arm64 claim in this repository is either static (the image contract
reads the assembled image) or owed to a bench. PLAN-071 U10 — bad bundle,
automatic install, fallback, suppression, observed on serial — is blocked for
exactly this reason, and so is every other arm64 runtime assertion.

Add a third board: the same architecture as the shipping device, booting the
standard ARM flow (UEFI firmware + GRUB) under QEMU exactly as x64 does.

Acceptance for the planning round (this round):

- `docs/plan/PLAN-085.md` written and reported to L1.
- The board surface enumerated by grep, stated as a count a reader can
  re-derive from a published command.
- No implementation until the plan is approved.

## ActiveForm

Completed; the current architecture records the virtual ARM64 QEMU board.

## Dependencies

- **blocked by**: RFCT-334 (arm64 compose) — approved 2026-09-06 to move
  `debootstrap --second-stage` off `chroot` onto a Docker stage boundary, but
  not yet landed. Only the *implementation* slices that need an arm64 root to
  exist wait on it (slice 4, and slice 5 through slice 4's image). The plan
  itself is not blocked, and neither are the source-level slices (board
  definition, assembler generalisation, kernel, deb producers, dossier).
- **blocks**: PLAN-071 U10 and every other arm64 runtime assertion currently
  owed to a bench.

## Notes

- Related plan: [PLAN-085](../plan/PLAN-085.md).
- PMA ids were assigned at dispatch rather than chosen here: RFCT-334 is held
  by a task running beside this one.

- complete: PLAN-085 is completed and the virtual arm64 board obligation is represented by the current architecture.
