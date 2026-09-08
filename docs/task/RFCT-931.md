# RFCT-931 Rebuild the complete s905x5m eMMC package with boot.scr

- **status**: completed
- **priority**: P1
- **owner**: plan-910-emmc-rebuild
- **createdAt**: 2026-08-31 19:21 UTC
- **completedAt**: 2026-08-31 19:50 UTC
- **plan**: PLAN-910 M3 follow-up

## Description

Rebuild RFCT-929's complete Amlogic v2 eMMC USB-burning package at current
branch HEAD after RFCT-930 added the production `boot.cmd`, dual-slot
`boot.scr` assembly, the replacement U-Boot eMMC script route, and
`CONFIG_CMD_SETEXPR`. Reuse the committed RFCT-929 packaging chain; do not
change its bootloader framing, GPT producer, or payload topology.

The rebuild must export `/backup/mos-artifacts/rfct-291-4ee725d/update.img`
from commit `4ee725d103ff42d7b635562974091daecfea1bb8`. It must prove that the
package's BOOT-A and BOOT-B payloads both contain the identical compiled form
of `os/boards/s905x5m/boot.cmd`; that the built U-Boot config has
`CONFIG_CMD_SETEXPR=y` and the applied eMMC-slot boot-script route; and that
the section-5 board-owned groups pass while the FIT group remains a loud,
non-blocking warning. It must retain RFCT-929's package format, 18-entry
round-trip, and no-cache byte-equality checks.

No USB burner, `sdc_burn`, eMMC, eMMC boot area, `bootloader_a`, or board may
be written or invoked.

The owner subsequently confirmed on the board that RFCT-929's package did
write mos U-Boot and the intended twelve-entry GPT: both boot slots exposed
their expected kernel, slot-suffixed verity environment, and DTB, but neither
BOOT-A nor BOOT-B contained `boot.scr`. That is positive evidence that the
target-generated bootloader framing and payload placement were sound, and
isolates the observed U-Boot prompt to the pre-`4ee725d` script path.

It also exposes a separate deployed-layout hazard. The same static GUID set in
`os/boards/s905x5m/board.env` drives both the SD image and this eMMC package.
After this package is flashed, its eMMC and any mos SD card inserted with it
will present the same disk and partition GUIDs. This task records the
consequence and does not renumber either medium.

## ActiveForm

Completed the offline rebuild and verification of the complete s905x5m eMMC
package at HEAD with the production boot script and replacement U-Boot route.

## Dependencies

- **blocked by**: (none; the owner directed this rebuild at HEAD)
- **blocks**: the separately owner-controlled hardware flash and boot test

## Investigation

- RFCT-929's durable package was built at ancestor `acd48f85d46a`, before
  `4ee725d` introduced `os/boards/s905x5m/boot.cmd`, patch
  `0016-s7d-bm201-source-emmc-slot-boot-scripts.patch`, and the final-built
  `CONFIG_CMD_SETEXPR=y` contract. Its successful format and payload checks
  therefore cannot establish the presence or reachability of these later
  inputs.
- The current top-level target `make os-emmc-package-s905x5m-v2` already
  builds the kernel, U-Boot, and normal SD image, then delegates to the
  RFCT-929 `emmc-package` consumer. That consumer extracts the typed
  eMMC-safe payloads, invokes the same pinned Amlogic packer, runs its format
  check, and byte-compares all 18 manifest inputs after unpacking.
- The normal s905x5m assembler compiles the committed boot command once and
  copies the resulting legacy `boot.scr` unchanged into BOOT-A and BOOT-B.
  The typed extractor passes those two full FAT payloads into the package.
- The U-Boot Dockerfile applies all 16 patches, including patch 0016, and its
  contract reads `/uboot/bl33/v2023/build/.config` after `olddefconfig`. It
  positively counts `CONFIG_CMD_SETEXPR=y`, preserves the bootcount and
  redundant-environment assertions, and reports FIT/FIT_SIGNATURE as a loud
  tree-wide warning without blocking artifact export.
- The owner serial report establishes that the former `acd48f8` artifact
  reached the mos `s7d_bm201#` prompt and wrote the intended GPT and slot
  payloads. `ls mmc 1:5` and `ls mmc 1:6` each showed exactly `Image`, the
  slot-suffixed `mos-verity-*.env`, and the DTB, with no `boot.scr`. This
  confirms the missing script rather than a bootloader-framing regression.
- The rootfs build renders dm-verity's `dm-mod.create` and `dm-mod.waitfor`,
  fstab mounts, and `/etc/fw_env.config` from those GUID constants; the RAUC
  renderer likewise names both boot and rootfs slots through
  `/dev/disk/by-partuuid`. With a mos SD card and this eMMC layout present,
  every such resolution can select either identically identified medium. In
  particular, RAUC can read or write the wrong U-Boot environment and target
  the wrong A/B slot. The reported provisioned hostname and disabled SSH are
  consistent with a fresh eMMC STATE partition winning a lookup, but do not
  establish which device actually won.
- Current build inputs cannot choose a distinct identity set for SD alone:
  `mkimage-s905x5m-sd-cli.ts` hard-codes `loadGeometry('s905x5m')`, and the
  eMMC extractor validates and packages the GPT read from that SD image. A
  naive alternate SD GUID set would therefore propagate into the eMMC package
  as well.

## Proposal

Create an isolated remote snapshot of exactly `4ee725d103ff42d7b635562974091daecfea1bb8`
on `192.168.27.200`. Run the existing full target once into an isolated build
directory, copy only its completed package to
`/backup/mos-artifacts/rfct-291-4ee725d/`, and perform read-only inspection of
the exported package. Re-run the same package construction with BuildKit
`--no-cache` against equivalent rebuilt inputs, then compare the two
`update.img` files byte-for-byte.

Record the built-config section-5 output; independently unpack the package
and inspect BOOT-A and BOOT-B for `boot.scr`, legacy-image magic, byte equality
with each other, and equality with a freshly compiled
`os/boards/s905x5m/boot.cmd`. Record the package's format result, per-entry
18/18 byte-exact round trip, image size, and SHA-256.

For a future owner-level layout decision only, a distinct SD identity set is
technically possible only by introducing a medium-specific geometry/profile
and keeping a canonical eMMC geometry as a separate package input. That work
would have to propagate its chosen identities consistently through the SD
rootfs's dm-verity command lines, fstab, RAUC slot devices, and
`fw_env.config`, while ensuring the SD GPT can never become the eMMC GPT. It
is not implemented or authorized by this task. The first flash makes any
renumbering a deployed-layout compatibility decision, not a free board-file
edit.

The owner-directed rebuild request is the explicit approval for this scoped
implementation phase.

## Risks

- A full cold rebuild is lengthy and can fail through source, builder,
  network, or capacity faults; no incomplete artifact will be published.
- Byte identity across a no-cache rebuild depends on the reproducible input
  chain. A mismatch is a verification failure, not a reason to substitute
  cached output.
- Offline format, payload, and source/config evidence proves construction only.
  It cannot prove USB protocol acceptance, successful flashing, U-Boot script
  execution on hardware, RAUC mark-good, rollback, or bootability.
- Duplicate SD/eMMC GUIDs make all `PARTUUID` consumers ambiguous while both
  media are present. This reaches the dm-verity root selection and wait,
  writable mounts, redundant environment access, and RAUC's A/B slot
  selection; no configuration currently distinguishes the intended medium.

## Scope

- One isolated remote rebuild at HEAD, artifact publication, offline container
  and payload verification, and PLAN-910/RFCT-931 records.
- No source, package topology, bootloader framing, configuration, board,
  device, eMMC, boot area, `bootloader_a`, burner, or remote-repository write.
- No GUID, partition-number, offset, dm-verity, fstab, `/etc/fw_env.config`,
  or RAUC slot-device change. Layout identity remains owner-controlled.

## Alternatives

- Reuse RFCT-929's existing `update.img`: rejected because it predates every
  missing boot-script prerequisite and cannot gain them retroactively.
- Repackage prior U-Boot or SD bytes: rejected because that would not prove the
  HEAD build graph or its final `.config` contract.
- Change bootloader packaging: rejected because the successful prompt proves
  RFCT-929's target-generated hardware-boot framing reached U-Boot correctly;
  the missing work is the later script path, not that framing.
- Renumber the GUIDs now: rejected. The values are already pinned into the
  flashed dm-verity, fstab, environment, and RAUC contracts; changing them
  after a first flash is an owner-level compatibility and migration decision.

## Notes

- Claimed for investigation and the owner-directed implementation on
  2026-08-31. Hardware flashing remains exclusively owner-controlled.
- The owner hardware report was incorporated before completion: it confirms
  the old package's framing and payload placement, confirms the absent script,
  and records the shared-GUID risk without authorizing a layout change.

## Implementation

- Rebuilt the committed chain, unchanged, from an isolated archive of
  `4ee725d103ff42d7b635562974091daecfea1bb8` on `192.168.27.200` through
  `make os-emmc-package-s905x5m-v2`. No package source, bootloader framing,
  layout, GUID, or board bytes were changed.
- Published only the completed result to
  `/backup/mos-artifacts/rfct-291-4ee725d/update.img`, after all offline
  checks passed. The final directory was absent before publication and its
  `update.img.sha256` sidecar was generated and checked after the copy.

## Verification

- The normal container passed `aml_image_v2_packer -c`. An independent unpack
  compared every one of the 18 manifest inputs byte-for-byte with the normal
  artifacts and re-extracted typed payloads: `18/18` passed. The unpacker also
  writes its generated `image.cfg`; it was not counted as a manifest payload.
- BOOT-A and BOOT-B each contained four files, including `boot.scr`. A fresh
  `SOURCE_DATE_EPOCH=1577836800` compilation of
  `os/boards/s905x5m/boot.cmd` was byte-identical to both slot files and the
  two slot files were byte-identical to each other. Each `boot.scr` is 7,674
  bytes, SHA-256
  `8e9e4adeae569e9e82aa82b5a36409c3d8f73ba99d84ba5c013e10dcfb8b2849`.
- The packaged `bootloader.PARTITION` byte-matched the normal built
  `u-boot.bin.signed`. That producer exports only after its Dockerfile
  `contract` stage. A separate no-cache U-Boot build applied
  `0016-s7d-bm201-source-emmc-slot-boot-scripts.patch` and directly asserted
  `/uboot/bl33/v2023/build/.config`: `CONFIG_CMD_SETEXPR=y` matched exactly
  once, and the complete production boot-script command contract passed.
- The three RFCT-927 board-owned section-5 groups still passed (persistent
  bootcount, redundant MMC environment, and the derived
  `CONFIG_SYS_BOOTM_LEN=0x4000000`); the added production boot-script group
  also passed. `CONFIG_FIT=y` and `CONFIG_FIT_SIGNATURE=y` each matched zero,
  producing the required loud tree-wide FIT warning while export continued.
- `src/boot-s905x5m.test.ts` passed `7/7` tests with 24 assertions. Its four
  stale partition-number mutations were rejected, preserving the p5/p6
  boot-slot and p7/p8 rootfs-slot guard.
- A `docker buildx build --no-cache` package reconstruction passed its own
  format check and `18/18` round trip, then produced an `update.img`
  byte-identical to the normal package. Both images have SHA-256
  `b5d8b4f8b91a017d12d21db6412c4f0167d2d5f9ab33133852e149c6671d636a`.
- The durable artifact is
  `/backup/mos-artifacts/rfct-291-4ee725d/update.img` (1,369,400,096 bytes,
  SHA-256 `b5d8b4f8b91a017d12d21db6412c4f0167d2d5f9ab33133852e149c6671d636a`).
  Its 77-byte sidecar passed `sha256sum -c`.

## Result

This establishes a complete, format-valid, byte-faithful eMMC package at HEAD
that contains the previously missing boot script in both boot slots and an
export-gated U-Boot build that applies the eMMC script route and has the
required final-built configuration. It is better founded than RFCT-929's
artifact, but it does not establish that a board boots: only the owner-gated
flash and hardware boot can establish that.

After that flash, the eMMC and any concurrently inserted mos SD card will
still have identical GUIDs. Any `PARTUUID` lookup can therefore resolve the
wrong medium, including dm-verity, mounts, `/etc/fw_env.config`, and RAUC A/B
slot selection. No GUID change was made here; the separate SD-identity-profile
proposal remains an owner-level layout decision. No USB burn, `sdc_burn`,
eMMC, boot area, `bootloader_a`, or board write was performed.
