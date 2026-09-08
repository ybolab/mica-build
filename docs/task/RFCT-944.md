# RFCT-944 Resolve runtime defects observed on the mainline S905X5M SD image

- **status**: pending
- **priority**: P1
- **owner**: (unassigned)
- **createdAt**: 2026-09-08 08:18 UTC

## Description

RFCT-943 inspected the newly composed SD image on hardware. Initialization,
management, networking, MQTT and container execution work, but the device is
degraded because the optional front-panel scripts cannot execute.

## Confirmed blocker

- `/usr/sbin/bm201-front-panel` and
  `/usr/lib/mos/bm201-front-panel-stop` both have mode 0644 in the running root.
- Their source files are tracked as 100644. The board's Debian producer
  `boards/s905x5m/deb/bm201-front-panel/Dockerfile` uses `COPY` without setting
  executable modes, so the non-executable files reach the package/image.
- systemd reports 203/EXEC for both entry points. `mos-health` then refuses
  the failed unit and leaves the boot unconfirmed. Existing source tests use
  `sh` to interpret the files and did not assert installed executable modes.

## Additional observations to classify

- `systemd-gpt-auto-generator` creates an EFI automount that fails because
  `/efi` is absent. This is not one of the two final failed units.
- The system-info API cannot identify the board model because the running DT
  exports no `/sys/firmware/devicetree/base/model` property.
- The inherited runtime verifier assumes eMMC `mmcblk0` and `/boot/Image`.
  The new SD root uses `mmcblk1`, while current mainline leaves only the kernel
  config in `/boot`. RFCT-943 used direct boot-partition hash comparisons and
  observed mounts instead of reporting those stale assumptions as device bugs.
- SD and eMMC have identical fixed partition UUIDs when both carry this
  layout. This run resolved the storage UUIDs to SD, but update/reboot safety
  with both media present has not been qualified.

## Acceptance

- Set explicit executable modes in the package producer and assert them on
  the actual Debian payload and composed root.
- Rebuild the affected package and image; verify the front-panel unit starts
  and the normal health gate can confirm the intended boot medium/slot.
- Classify the additional observations before changing EFI, DT or verifier
  behavior; keep board policy and actual media identities explicit.
- Preserve the reported SD/eMMC state until an implementation and device
  validation scope are approved.

## ActiveForm

Awaiting a scoped fix proposal and implementation approval.

## Dependencies

- **blocked by**: (none for investigation)
- **blocks**: full runtime qualification of the mainline S905X5M image

## Notes

Evidence and scope are recorded in [RFCT-943](RFCT-943.md). No workaround,
service restart, health allowlist change or device slot write was applied.
