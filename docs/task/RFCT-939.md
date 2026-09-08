# RFCT-939 Integrate the BM201 front-panel userland

- **status**: completed
- **priority**: P1
- **owner**: l2-bm201-front-panel
- **createdAt**: 2026-09-01 07:00 UTC
- **completedAt**: 2026-09-01 07:39 UTC
- **plan**: [PLAN-921](../plan/PLAN-921.md)

## Description

Port the proven s905x5m-alpine BM201 front-panel daemon to the mos systemd
rootfs without redoing its already-complete kernel driver work. Preserve the
POSIX shell daemon behavior, its optional-panel failure mode, the overridable
`BM201_PANEL_ROOT`, stop-time panel disable, and clock/network ordering. The
approved classification is an ordinary long-running board service delivered as
the explicit `MOS_ROOTFS_COMPONENTS=bm201-front-panel` component: it is not
hardware initialization and must not widen `BOARD_USERLAND_FILES` beyond its
Bluetooth runtime files.

## Acceptance

- The installed daemon checks `text`, `symbols`, `brightness`, and `enabled`,
  warns and exits successfully when the optional panel interface is absent, and
  retains `BM201_PANEL_ROOT` for fixture testing.
- A generated systemd service runs only after time synchronization and network
  availability, and `ExecStopPost` writes `0` to `enabled`.
- Board wiring delivers an explicit optional component without misclassifying
  the renderer as hardware initialization; `BOARD_HWINIT_CONFS` remains
  `wireless audio bluetooth` and `BOARD_USERLAND_FILES` remains Bluetooth-only.
- Focused tests prove unit generation and ordering plus sysfs writes through a
  temporary panel-root fixture. Physical display behavior is explicitly
  reported as requiring visual board confirmation.
- No kernel/front-panel implementation, reboot, slot change, eMMC boot-area,
  or `bootloader_a` write is part of this task. The board at `192.168.27.62`
  remains untouched while its runtime acceptance suite is active unless a
  separately announced, read-only check is approved.

## ActiveForm

Implemented the optional BM201 systemd component and its board-service boundary.

## Dependencies

- **blocked by**: (none; PLAN-921 was approved on 2026-09-01)
- **blocks**: (none; the selected component now supplies the BM201 renderer)

## Notes

- Claimed on 2026-09-01 after confirming the branch-reserved `RFCT-939` and
  `PLAN-921` identifiers were free. Existing uncommitted RFCT-937/RFCT-938 and
  PLAN-919/PLAN-920 work belongs to other active tasks and is excluded.
- The board at `192.168.27.62` is currently in use by the RFCT-938 runtime
  acceptance work. This task has not connected to it and will not reboot it,
  change a slot, or write eMMC boot areas or `bootloader_a`.
- PLAN-921 was approved on 2026-09-01. The owner clarified that optional-panel
  semantics select `MOS_ROOTFS_COMPONENTS`, not `BOARD_USERLAND_FILES`; the
  Bluetooth allowlist must remain narrowed. No board access is needed for
  implementation or fixture verification.
- Completed on 2026-09-01. The selected `bm201-front-panel` component supplies
  the unchanged Alpine daemon behavior, systemd ordering, exact four-file
  package, and stop-time display disable. The daemon and unit fixtures, exact
  installer, stage-selection suite, documentation index, and a generated arm64
  component-stage fixture all pass. The latter installed the four paths, wrote
  brightness/text/symbols/enabled through an overridden temporary panel root,
  and verified `enabled` becomes `0` at stop.
- The remote standard rootfs build was intentionally not forced through a
  kernel or RAUC rebuild: its isolated snapshot lacked the unrelated existing
  RAUC artifact, so verification used the build host's standard cached
  `34-feature-mqtt` predecessor and built the new `36` stage from it. No
  connection, reboot, slot change, eMMC boot-area write, `bootloader_a` write,
  deployment, or push occurred. Physical panel output remains unverified and
  requires owner visual confirmation on `192.168.27.62`.
