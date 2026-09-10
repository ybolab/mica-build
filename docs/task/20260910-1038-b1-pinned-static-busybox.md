# 20260910-1038-b1-pinned-static-busybox B1 pinned static BusyBox boot package

- **status**: completed
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
- Official BusyBox 1.36.1 source SHA-256 is
  `b8cc24c9574d809e7279c3be349795c5d5ceb6fdf19ca709f80cde50e47de314`;
  packaged license provenance is `GPL-2.0-only` and the source archive is
  retained with the boot tools.
- RED started with a missing validator and the real build subsequently rejected
  dynamic linkage, missing multicall/shutdown applets, and missing arm64 libc
  headers. GREEN focused fixtures and real x64/aa64 payload checks exit 0.
- Built identities are x64
  `c48d13f5cc6f68e5ef897de4c04f85cb0d8af510ff1af0256490b37029fa6c4a`
  (1,213,152 bytes) and aa64
  `d32412a3ebd0997df9917995c3df54dc93c7bdbc18d0e08e331c24fbfcdc7f2a`
  (1,056,896 bytes), each with exactly 19 required applets and stable across two
  component builds.
- Final build source commit is `0e0951151569235a52af26e1fee0c7c77687c588`;
  metadata and log are under
  `/tmp/mos-b1-busybox-build-reviewed.dUQptc/`, and the build exited 0.
- The fixture, host-toolchain lint, docs verification, and PMA-CR review pass.
  Shell-pipefail lint exits 2 only at the known unrelated
  `pkgs/mosd/apid/ui/verify-ui-policy.sh:82` baseline; changed scripts pass.
- Full rootfs/kernel/image/QEMU/cold builds and hardware checks remain unrun
  because the L1 expensive-build grant is zero.
- [Implementation plan](../plan/20260910-1038-b1-pinned-static-busybox.md).

- complete: Bounded implementation and verification complete; B2/B3 integration and grant-only system evidence remain with L2.
