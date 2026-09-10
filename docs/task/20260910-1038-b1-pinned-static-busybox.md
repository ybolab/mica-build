# 20260910-1038-b1-pinned-static-busybox B1 pinned static BusyBox boot package

- **status**: in_progress
- **priority**: P1
- **owner**: b1/627utly7
- **createdAt**: 2026-09-10 10:38

## Description

Build and validate one deliberately configured static early-boot BusyBox payload
for each existing x64 and arm64 boot packaging architecture. Pin the current
stable upstream source and archive digest, enforce the required applet and ELF
contract, and keep the main-runtime BusyBox policy unchanged.

## ActiveForm

Pinning and validating the static early-boot BusyBox package contract.

## Dependencies

- **blocked by**: B0 task `20260910-1013-b0-lifecycle-rootfs-audit` and the
  L1-approved #313 source handoff, both integrated through L2 B commit
  `3ac8ca287df2fdca4aa639b036d789d63a336aec`.
- **blocks**: B2/B3 startup and shutdown assembly work scheduled by L2 B.

## Notes

- Full tier. The user explicitly approved this bounded proposal and local
  scoped commit before execution on 2026-09-10.
- Development-only delivery: no backward compatibility, migration, RAUC, old
  raw-slot, or old-update support is required.
- The approved L2 dependency was merged first as commit
  `3973dfe3f819ce83e87b39d737bdcf88fa86280d`; the pre-merge worktree was clean
  and the branch was `bkd/627utly7`.
- [Implementation plan](../plan/20260910-1038-b1-pinned-static-busybox.md).
