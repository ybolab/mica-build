# RFCT-933 Build a reusable s905x5m eMMC installer-card image

- **status**: completed
- **priority**: P1
- **owner**: plan-910-emmc-installer
- **createdAt**: 2026-08-31 20:23 UTC
- **completedAt**: 2026-08-31
- **plan**: [PLAN-910](../plan/PLAN-910.md)

## Description

Design and build a reusable installer-card image for the complete s905x5m
eMMC package. The image builder must accept a package path as an input rather
than pinning an artifact, and it must not write any block device, eMMC boot
area, `bootloader_a`, or SD card.

## Acceptance

- An installer image contains a FAT partition large enough for the supplied
  complete package and its private configuration, request marker, and package
  identity.
- The card cannot enter the vendor's unattended autoburn path; a private
  request/receipt gate controls every flash attempt.
- The installed eMMC U-Boot has explicit semantics for an absent card, an
  unreadable installer card, a disappearing source after a valid request, and
  an already-installed package identity.
- The producer reads all installer artifacts back from the final disk image,
  verifies their bytes and identity, rejects boot-card payloads, and reports
  image size, SHA-256, FAT geometry, and free space after the package.
- The documented bootstrap route states how an older board gains the required
  private U-Boot protocol without using the installer card first.

## ActiveForm

Completed the parameterized private-protocol installer-card image and its
offline verification; no media or board storage write was part of this task.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Investigation

- The current complete `update.img` is 1,369,400,096 bytes and the existing
  `aml_sdc_burn.ini` is deliberately bootloader-only. Reusing that sidecar with
  the complete package would leave `erase_flash = 0` and is unsafe.
- The intake vendor U-Boot exposed only the manual
  `sdc_burn aml_sdc_burn.ini` path. The mos replacement source already imports
  the private request/receipt protocol, byte-identically matching the Alpine
  reference, but its 768 MiB FAT / 640 MiB package limits reject the complete
  mos package before `sdc_burn` can start.
- The existing protocol test explicitly distinguishes an absent card (normal
  boot), an unreadable selected FAT (stop), source loss after a valid request
  (stop), a matching eMMC receipt (skip), and a non-zero burn result or receipt
  write/readback failure (stop).
- The external input package must be checked as a complete Amlogic container;
  accepting a bootloader-only `update.img` with a full-flash sidecar would be
  destructive.

## Proposal

- Use the private `bm201upd.ini` protocol rather than the vendor magic
  `aml_sdc_burn.ini` path. The card will carry only the private 8.3-compatible
  configuration, an exact request, a SHA-256 identity, and `update.img`; the
  existing U-Boot wrapper remains responsible for the request/receipt gate and
  invokes `sdc_burn` only after its preflight passes.
- Raise the shared U-Boot/card bounds to a 1,792 MiB FAT filesystem and a
  1,536 MiB maximum package. The current package is 1,305.961700 MiB, leaving
  230.038300 MiB before the package limit and 486.038300 MiB of raw FAT space;
  the maximum package still leaves 256 MiB before FAT metadata. The final
  image check will require at least 240 MiB actual free space.
- Add a file-only `os-emmc-installer-s905x5m-v2` target that requires
  `EMMC_INSTALLER_PACKAGE=/path/to/update.img`, consumes the existing U-Boot
  artifact, validates the supplied package as the 18-entry complete package,
  and exports `out/emmc-installer/disk.img` plus its SHA-256. It will not add a
  flash target.
- Read the bootloader and all four FAT files back from the final image, verify
  geometry, byte identity, request content, package digest, actual free space,
  and the absence of boot files or the magic vendor configuration.
- Document the bootstrap boundary: a board whose installed U-Boot lacks these
  enlarged private-protocol constants must receive a newly built complete
  package through host USB burning once. The card cannot bootstrap that state
  because normal boot starts from eMMC boot0, not the card's LBA-1 U-Boot.

## Risks

- `erase_flash = 1` is required for a complete package and deliberately
  replaces the eMMC user-area layout only after the private gate accepts an
  exact request. Offline verification cannot prove the vendor write protocol
  on hardware.
- The corrected package supplied by the parallel boot-script work must include
  the enlarged U-Boot limit before it can serve as the bootstrap package.
- Packages above 1,536 MiB are intentionally rejected rather than producing a
  card that the installed U-Boot would refuse.

## Scope

- The s905x5m U-Boot installer constants and their host test, a private card
  configuration, a containerized image producer, target wiring, documentation,
  and PLAN-910/RFCT-933 tracking.
- No block-device writer, package burner, eMMC/boot-area/`bootloader_a` write,
  SD-card write, or remote push.

## Alternatives

- Reusing `aml_sdc_burn.ini`: rejected because it is both the vendor magic name
  that bypasses the private gate and a bootloader-only sidecar with
  `erase_flash = 0`.
- Reusing the bootable mos SD card: rejected because its large partition is
  ext4 while `sdc_burn` reads FAT only, and an installer must not be a Linux
  boot card.
- Keeping Alpine's 768 MiB / 640 MiB constants: rejected because the current
  mos package alone is 1,369,400,096 bytes.

## Notes

- Claimed for Phase 1 investigation on 2026-08-31. No implementation, package
  build, media write, or board storage write has been performed.
- Phase 2 proposal recorded on 2026-08-31; explicit approval is required
  before implementation.
- The owner approved the recorded proposal on 2026-08-31. This is not a
  protocol port: mos already has the Alpine-equivalent request/receipt
  implementation; implementation changes only its capacity constants and adds
  the file-only card producer around it.

## Implementation

- Changed only the two shared U-Boot capacity constants from 768 MiB / 640 MiB
  to 1,792 MiB / 1,536 MiB and updated the corresponding host-test
  expectations. No installer state-machine code or protocol patch changed.
- Added the private, non-magic `bm201upd.ini` full-package sidecar and the
  parameterized `os-emmc-installer-s905x5m-v2` target. The target accepts only
  a caller-supplied file named `update.img`, validates its 18 payload entries
  plus the packer-generated `image.cfg` manifest, and emits a regular
  `disk.img` plus SHA-256 sidecar.
- The image producer uses the shared header for the 1,792 MiB FAT32 geometry,
  writes exactly four FAT files, rejects boot files and vendor autoburn names,
  and reads the LBA-1 loader and all four FAT files back before export.

## Verification

- `bash uboot/installer/test-config.sh ...` and
  `make -C os/boards/s905x5m/bsp emmc-installer-test` passed locally.
- An isolated build on `192.168.27.200` rebuilt the SD U-Boot artifact and
  passed the existing `emmc_installer_test.c` contract before the installer
  producer exported it. Those tests retain the five established outcomes:
  absent card continues boot; unreadable selected FAT stops; source loss after
  a valid request stops; matching receipt skips; and non-zero burn or receipt
  failure stops.
- The public target completed with
  `/backup/mos-artifacts/rfct-290-a5919d3/update.img` (1,369,400,096 bytes,
  SHA-256
  `c2955b05d8d85e04bd6109ec042c0755685992923c085c388b20b0aa8c538bec`).
  Its final image is
  `/backup/mos-artifacts/rfct-293-ff357295/disk.img`, 1,900,019,712 bytes,
  SHA-256
  `ff357295136ad454c8698bf45a14bc3342e9d69f5faf2c0eb42f4745a47b0661`.
  Its FAT starts at sector 8192, has 3,670,016 sectors (1,792 MiB), and has
  505,933,824 bytes free after the package and three control files; this
  exceeds the 240 MiB final-image minimum.
- The generated checksum sidecar passed `sha256sum -c`. A separate run with
  the 10,267,648-byte RFCT-928 bootloader-only package failed at the exact
  18-payload complete-package check and left the accepted artifact unchanged.

## Result

The durable output is an offline regular file only. It is not an authorization
to write media. A host USB burn of a complete package rebuilt with the enlarged
U-Boot constants remains the one-time bootstrap for vendor or older mos
U-Boot; later corrected complete packages can be supplied to this target
without changing the card logic.

## Coordinated handoff (2026-09-01)

- The existing `/backup/mos-artifacts/rfct-293-ff357295/disk.img` is retained
  as offline producer evidence only. It embeds the RFCT-930 input and must not
  be given to the owner for the combined HDMI, MQTT, and A/B hardware pass.
- RFCT-932 / `zut3l32o` is the sole complete-package builder. After
  `8yaodbbi` lands the approved HDMI change and the committed
  `com.mos.mqttsample.reference` application is present in that same source
  revision, it will build exactly one eMMC `update.img` on `192.168.27.200` and
  record its source revision, path, size, and SHA-256. It will not build a card
  or flash hardware.
- RFCT-933 is the sole card producer for that handoff. It will consume exactly
  that `update.img`, from the same source revision, to build one installer
  image and run its normal readback verification. It will not rebuild a package
  or write media, eMMC, a boot area, or `bootloader_a`.
- The installer card is not an authorized board-write mechanism under the
  current campaign boundary. Its private complete-package configuration has
  `erase_bootloader = 1`, and the required complete-package manifest carries
  the special `bootloader.PARTITION` destination, which reaches the eMMC
  hardware boot area. A later board operation therefore needs a separately
  owner-approved, readback-verified slot-content-only procedure; this task
  continues to build and verify regular files only.
- The upcoming hardware target is `192.168.27.56`, with eMMC
  `/dev/mmcblk0` only: root is on p7 and p8 is zero-filled. The historical
  `/dev/mmcblk1` SD deployment artifacts are not inputs to this pass. This
  task will neither write p8 nor reboot the board. RFCT-934 exclusively owns
  the p7-to-p8 fallback construction and its byte-for-byte verification before
  A/B testing; MQTT proof must not overlap that partition work.

## Combined-package refresh (2026-09-01)

- The selected input is the hardware-proven combined package
  `/backup/mos-artifacts/rfct-292-combined-0c9deaf6/update.img`, built from
  `0c9deaf6c75b43beb47c0d335757a7f42bb55dbb`. It is 1,369,400,096 bytes with
  SHA-256
  `1c09ad372ee33e2c2c5efc1bc4f1634481894c846ff493df19e363d10fd594e7`.
- An isolated source archive at that exact commit ran `make s905x5m-uboot` and
  then the parameterized installer target with that absolute input path. No
  complete-package build, burner, block-device command, media write, board
  access, reboot, or remote push occurred.
- The capacity check remains valid: 1,369,400,096 bytes is below the 1,536 MiB
  (1,610,612,736-byte) U-Boot limit by 241,212,640 bytes (230.038300 MiB). The
  1,792 MiB FAT filesystem has 509,648,096 bytes of raw space after the
  package before FAT metadata; the final-image check measured 505,933,824 bytes
  free, above the 240 MiB minimum.
- The refreshed regular-file artifact is
  `/backup/mos-artifacts/rfct-293-0c9deaf6/disk.img`, 1,900,019,712 bytes,
  SHA-256
  `04da31efd8ef6734eafa09ad3c58c0ea3ac2ab7197fdb59b0b104e8b1d18c111`.
  Its FAT32 partition starts at sector 8192, spans 3,670,016 sectors (1,792
  MiB), and has 505,933,824 bytes free after the package and three controls.
- The producer retained the private protocol and all five state-machine
  outcomes unchanged. It read the LBA-1 loader and each of `update.img`,
  `bm201upd.ini`, `emmc-system-install.request`, and `update.img.sha256` back
  from the final image, compared their bytes, recomputed the 65-byte identity,
  checked the geometry and free-space gate, and rejected the prohibited boot
  and vendor-autoburn files. A separate exported-image container check repeated
  those four FAT readbacks, loader comparison, identity, geometry, and
  forbidden-file checks before publishing the artifact.
- This proves a reproducible, byte-verified card image around the combined
  package. It does not prove a physical card, `sdc_burn`, or card-flashing on
  this board: no physical media has been written and every eMMC flash so far
  used host USB burning. The board at `192.168.27.61` was not accessed.
