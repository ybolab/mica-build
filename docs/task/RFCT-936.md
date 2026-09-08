# RFCT-936 Separate the MQTT reference application from board userland

- **status**: completed
- **priority**: P1
- **owner**: l2-mqtt-component-separation
- **createdAt**: 2026-09-01 02:52 UTC
- **completedAt**: 2026-09-01 03:41 UTC
- **plan**: [PLAN-918](../plan/PLAN-918.md)

## Description

Make the s905x5m MQTT reference application an explicitly selected rootfs
component rather than required board userland. The component must default off,
must not be selectable in a `prod` image, and must install its binary, unit,
target drop-in, enrollment, and D-Bus policy as one exact package when selected.

The s905x5m board contract must retain only its actual Bluetooth userland
paths. The cx3576 and x64 declarations must remain explicitly empty. The bus
design must identify the working reference package and its selection command.

The already sealed combined package at
`/backup/mos-artifacts/rfct-292-combined-0c9deaf6/update.img`, SHA-256
`1c09ad372ee33e2c2c5efc1bc4f1634481894c846ff493df19e363d10fd594e7`, remains
the pre-separation HDMI/MQTT verification artifact. This task applies only to
images built after that verification; it must neither rebuild nor invalidate
that package and must not access hardware.

## Acceptance

- A normal build does not select the reference component, and a `prod` image
  contains none of its five runtime paths; an image-contract check drives that
  absence from the failing side.
- The explicit component selection installs all five paths together and rejects
  a partial staged package, including a lone enrollment or a policy without its
  service.
- `BOARD_USERLAND_FILES` on s905x5m contains only board-required Bluetooth
  userland; cx3576 and x64 remain `BOARD_USERLAND_FILES=""`.
- `docs/design/bus.md` names the package source and the explicit selection
  mechanism without presenting it as production userland.
- Focused stage-selection, package, smoke-registration, and image-contract
  tests pass. No image/package build, remote push, or hardware action occurs.

## ActiveForm

Implemented the default-off `mqtt-reference` rootfs component. The package is
discoverable from the bus design, remains separate from board userland, and is
refused for production images.

## Dependencies

- **blocked by**: (none; PLAN-918 was approved on 2026-09-01)
- **blocks**: (none; subsequent production s905x5m builds now enforce reference-component absence)

## Notes

- The active record-renumbering work reserves the `9xx` range for this branch.
  This task uses the next currently available task and plan identifiers without
  changing that worker's records.
- Phase 1 investigation began on 2026-09-01. Source implementation began only
  after approval; no image or artifact build has been performed.
- PLAN-918 was approved on 2026-09-01. The subsequent hardware evidence is a
  historical result for the sealed pre-separation package only; this task does
  not rebuild it or access the board.
- Historical end-to-end evidence, 2026-09-01 03:0x UTC: with `mqtt.enabled`
  set, the pre-separation reference image brought the bridge up in `ReadOnly`
  mode and subscribed only to `R/<deviceId>/#`. A keepalive then published the
  complete reference tree: `N/<dev>/mqttsample/1/Connected` (`{"value":true}`),
  `DeviceInstance` (`{"value":1}`), `Example/ReadOnly`
  (`{"value":"ready"}`), `Example/Setpoint`,
  `Mgmt/{Connection,ProcessName,ProcessVersion}`, `ProductId`, `ProductName`,
  plus device-wide `N/<dev>/heartbeat` and
  `N/<dev>/full_publish_completed`. The class was `mqttsample` (the third
  service-name segment), the instance came from `/DeviceInstance`, and item
  payloads used the documented `{"value": ...}` shape. Device-wide topics
  carried neither class nor instance; the completion marker appeared once per
  device, not once per application. This is evidence for the reference
  contract, not an authorization to rebuild, deploy, or access hardware.
- Completed on 2026-09-01: the reference now uses the explicit
  `MOS_ROOTFS_COMPONENTS=mqtt-reference` component selection, which is
  development-only and refuses `prod`. Its package assets are owned by
  `os/pkgs/mosd/mqtt-reference/`; the s905x5m board userland list retains only
  Bluetooth artifacts. The installer and image verifier both enforce the
  complete five-path package, and every one of those paths is independently
  forbidden in a production root.
- Focused stage, smoke, board, lint, installer, and temporary-root
  image-contract checks passed. The sealed package was not rebuilt or
  invalidated; no deployment, remote push, or hardware access occurred.
