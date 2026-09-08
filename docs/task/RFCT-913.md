# RFCT-913 Boot s905x5m from SD and establish peripheral initialization

- **status**: completed
- **priority**: P1
- **owner**: implementation/plan-910-ms-20260830
- **createdAt**: 2026-08-30 16:30
- **plan**: PLAN-910 MS and M4

## Description

Assemble the s905x5m v2 whole-disk image from the landed kernel and rootfs
artifacts, add only the board-specific boot-slot input required by the vendor
U-Boot `cfgload` path, verify the image, and boot it from a confirmed SD card.
Then establish which HDMI, USB, Ethernet, Wi-Fi, Bluetooth, and audio support
needs a hwinit unit and which is already supplied by the kernel and firmware
staging.

The milestone is SD-only. Do not write the eMMC boot area, `bootloader_a`, or
any eMMC partition. The vendor U-Boot does not implement the mos RAUC A/B
handshake, so handshake-dependent verification failures are recorded as out of
scope rather than worked around.

## ActiveForm

Completed the s905x5m SD boot and established peripheral initialization.

## Dependencies

- **blocked by**: (none)
- **blocks**: PLAN-910 M5 acceptance

## Notes

- The authoritative checkout is local branch `board/s905x5m` at `2186182`;
  mos is not pushed to a remote.
- Heavy builds run on `192.168.27.200`.
- No block device may be written until its identity is resolved and it is
  confirmed to be a removable SD card rather than the board's eMMC.

## Investigation

The vendor `cfgload` SD arm does not search the mos boot slots. It first
validates FAT partition `mmc 0:1`, requires a non-empty `/Image` there, and only
then executes `/boot.ini` or `/boot/boot.ini`. The real mos boot pair remains
p5/p6. The SD path therefore needs a medium-specific p1 compatibility
filesystem, not a different boot-slot contract.

The built kernel and DT provide HDMI, USB and Ethernet coldplug support, with
networkd configuring Ethernet. The Seekwave Wi-Fi/Bluetooth combo module needs
firmware, ordered power/module initialization, its target-libc vHCI bridge and
BlueZ. The Amlogic sound card needs its codec/card modules and explicit HDMI
mixer routing.

## Proposal

- Add a dedicated SD assembler whose output name contains `-sd-`. It formats
  p1 with exactly `/Image` and `/boot.ini`, loads the real kernel and DTB from
  p5, carries no bootloader, and leaves p5/p6 and
  `BOOT_SLOT_REQUIRED_FILES` unchanged.
- Extend the board-rootfs artifact inputs only for declared board packages and
  target-libc userland files. Install no undeclared firmware or userland path.
- Declare and install hwinit for Wi-Fi, Bluetooth and audio only. Leave HDMI,
  USB and Ethernet to vendor display setup, kernel/DT and generic networkd.
- Run the normal verifier without suppressing the production `boot.scr` and
  RAUC-handshake failures that vendor U-Boot cannot satisfy in this phase.

## Result

The canonical build is `make os-image-s905x5m-sd-v2`; its direct assembler
entry point is `bash os/build/run.sh --mkimage-s905x5m-sd`, not
`--mkimage-v2`. The final clean build produced the 1,494,220,800-byte
`s905x5m-mos-v2-sd-1788124881.img` with SHA-256
`82f922650b3c7141fa9a10441c7a82030d7e667f3541bb62aad9bb5713c12205`.
ROOTFS-A has SHA-256
`8dd7d1df2c0dcbf58103b98d70d2dcc0c967e4a5c2a4a5e49a5ac8001c76c52a`
and verity root hash
`eff883635614f237f9faf0231a1e94692eb6f10e19c4b6cbccaa190037747c8b`.

Before writing, the target was identified as Linux `/dev/mmcblk1`, type `SD`,
name `SR64G`, CID `03534453523634478664e2c850019500`, with no boot devices.
The eMMC was separately identified as `/dev/mmcblk0`, type `MMC`, name
`AT3SFA`, CID `ec290041543353464130229911cf2c00`, with `boot0` and `boot1`.
Vendor U-Boot confirmed the same distinction as `sd: 0` and `emmc: 1`; every
card write selected `mmc dev 0` and every final payload was read back with a
matching CRC. No eMMC partition or hardware boot area was written.

A normal reset selected the strict SD cfgload path, executed the p1 bridge,
loaded the real boot payload from p5, created `dm-0`, mounted the squashfs root
read-only, and reached multi-user and graphical targets. All mounted MMC
filesystems came from `/dev/mmcblk1`; apid `/healthz` returned `ok`. The only
failed service was `mos-health`, at the expected vendor-U-Boot
`rauc status mark-good` boundary.

HDMI was connected and enabled at 1080p60. USB enumerated the external hub,
keyboard and mouse. Ethernet linked at 1 Gbit/s full duplex and obtained DHCP.
An actual Wi-Fi scan returned 38 APs. The Bluetooth SDIO transport, vHCI
bridge, powered controller and BlueZ all came up. A two-second HDMI PCM playback
completed. `BOARD_HWINIT_CONFS="wireless audio bluetooth"` now records the
measured split; HDMI, USB and Ethernet need no board hwinit unit.

## Verification

`bash os/verify/run.sh --verify --board s905x5m` completed with 360 of 371
checks passing and 9 named board-inapplicable skips. Its eleven failures are
all consequences of the deliberately absent production mos `boot.scr`: two
missing files, four A/B boot/root partition extractions, three script
identity/magic/root-argument checks, and two RAUC slot-source checks. The image
geometry, boot artifacts, verity metadata and ROOTFS-A payload all passed.

The final root-required Bun run completed 1,785 tests successfully. Its only
two failures were existing toolbox assertions that hard-code `sgdisk` as the
missing host tool; this build host now has `sgdisk` but lacks mtools. Rerunning
that file with the host PATH its own fixture documents passed 23/23. The RAUC
handshake harness passed all three scenarios, the separately exercised bundle
suite passed 81/81, documentation indexing passed 48/48, and all four negative
documentation-index cases passed.

## Follow-ups

- A cold arm64 rebuild changed only
  `/usr/share/factory/var/cache/ldconfig/aux-cache` in a full unpack diff, but
  consequently changed the squashfs and verity hashes. Normalize or remove
  this generated cache before claiming cold-build byte reproducibility.
- A ten-second Bluetooth discovery run found no discoverable peer. Exercise
  pairing and a profile exchange with a controlled peer; the current evidence
  proves the transport and controller, not a peer interaction.
- M3's first eMMC boot-area write remains owner-gated on a hardware-proven
  rescue path. The SD result does not relax that gate.
