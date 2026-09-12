# 20260912-2251-rockchip-update-image Produce a Rockchip update.img for CX3576

- **status**: pending
- **priority**: P1
- **owner**: (unassigned)
- **createdAt**: 2026-09-12 22:51

## Description

The CX3576 image is written today as one raw whole-disk image with
`rkdeveloptool wl 0`. Rockchip's own flashing tools (RKDevTool "Upgrade
Firmware", `upgrade_tool uf`, FactoryTool, SDDiskTool) consume an RKFW
`update.img` instead: loader, `parameter.txt`, `package-file` and one image
per named partition. Produce that artifact from the same build, with the
same boot chain and on-disk result as the raw image.

Acceptance:

- Every CX3576 image build publishes `update.img` beside the raw image, and a
  static check proves its loader, partition table and partition payloads
  match the raw image byte for byte.
- The loader inside `update.img` carries the Mica OS SPL, not the vendor SPL.
- Physical bench: a board flashed with RKDevTool from Maskrom boots the
  signed deployment, grows DATA, and passes firmware maintenance readback.
  Until that runs, physical acceptance is recorded as not run.

Compatibility with LAYOUT_VERSION 3 devices and images is not required.

## ActiveForm

Planning the Rockchip update.img artifact for CX3576.

## Dependencies

- **blocked by**: bench measurement of tool-generated GPT and IDB (plan M0)
- **blocks**: (none)

## Notes

- Full-tier PMA task; [plan](../plan/20260912-2253-rockchip-update-image.md).
- Supersedes RFCT-007 item 2 ("no update.img"), recorded in the changelog
  when the plan is approved.
- Coordinate with 20260912-2043-unify-board-behavior (delivery compression)
  and 20260911-2003-split-package-repositories (build/ ownership).

- unclaim: plan awaits approval; execution deferred by the user
