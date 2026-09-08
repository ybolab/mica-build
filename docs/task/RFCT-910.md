# RFCT-910 Make the s905x5m kernel meet the shared floor

- **status**: completed
- **priority**: P1
- **owner**: bkd/i61iccx3
- **createdAt**: 2026-08-30 13:25
- **plan**: PLAN-910 M1

## Description

Build the pinned s905x5m kernel and inspect its final `.config`, then place its
kernel build behind the board artifact interface. The build must merge
`os/boards/common/mos-required.fragment` before `olddefconfig`, assert every
`=y` requirement against the produced `.config`, check the pinned `CONFIG_LSM`
string separately, and produce `Image`, `modules.tar`, and the board DTB.

## Acceptance

- The real baseline build records the five hypothesized gaps and any gap the
  baseline comparison missed.
- The board kernel build merges the shared fragment before `olddefconfig`,
  asserts every shared `=y` line and the exact LSM string afterward, and fails
  when a required option is absent.
- The artifact stage exports only `Image`, `modules.tar`, and the board DTB;
  the module archive includes indexes for the final module set.
- The documentation index and all board-definition lint checks pass.

## ActiveForm

Establishing the s905x5m kernel floor and artifact interface.

## Dependencies

- **blocked by**: (none)
- **blocks**: PLAN-910 M2

## Notes

- Investigation starts from Hardkernel 6.12.38 at `9ea2aa83` in
  `miehq/s905x5m-alpine`; heavy builds run on `192.168.27.200`.
- 2026-08-30 13:37 UTC: A clean full build at the pinned kernel commit found
  one shared-floor gap: `CONFIG_VLAN_8021Q=m`. The other four baseline
  hypotheses were false alarms after the source build's own fragment was
  merged, and the other shared requirements all matched.
- The baseline `modules.tar` has no module dependency/alias indexes because
  its Alpine consumer runs `depmod` after extraction. The mos producer must
  generate those indexes before packing to satisfy its artifact interface.
- The documentation index passes locally. Board lint must use `debian13`'s
  pinned-container route: the workstation Bun rejects lockfile v2 and its
  Docker daemon cannot mount the client's `/workspace` path.
- The final mos build matched all 18 shared `=y` lines plus the exact LSM
  list. Its missing-option sentinel failed before compilation could export an
  artifact.
- The artifact interface exported exactly three files for
  `6.12.38-m100-arm64`; the module indexes, three board-specific modules, and
  DTB compatible string were checked independently.
- Complete: documentation index 48/48 and board-definition lint 39/39.
