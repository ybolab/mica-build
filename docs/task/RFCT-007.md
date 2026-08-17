# RFCT-007 PLAN-010 M1 - systemd rootfs prototype image for cx3576

- **status**: in progress
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-17 19:21
- **claimedAt**: 2026-08-17 19:21
- **completedAt**: -

## Description

Execute PLAN-010 M1: build a new top-level `os/` buildkit pipeline that produces a
flashable cx3576 disk image with a Debian (bookworm-slim) systemd arm64 rootfs, booting
over the existing validated chain (U-Boot at sector 64 -> extlinux on FAT boot partition
-> BSP kernel 6.1.115 + dtb), with `root=PARTLABEL=rootfs` mounted directly (no
initramfs).

Scope / deliverables:

1. `os/rootfs/Dockerfile` + `os/rootfs/build.sh`: systemd + systemd-networkd (DHCP on
   `eth*`) + openssh-server dev profile via a `ROOT_PASSWORD` build arg (empty default
   disables login); kernel modules unpacked from the BSP `modules.tar`; WiFi firmware +
   bcmdhd symlinks; journald in volatile mode; strict package allowlist with the
   installed size logged (budget: <= 400 MB).
2. `os/mkimage.sh`: GPT image assembly — U-Boot at sector 64, 512 MiB FAT boot partition
   at 16 MiB carrying `extlinux.conf`, 1024 MiB ext4 rootfs partition; deterministic
   content (fixed partition GUIDs, FAT volume-id, and file mtimes); output
   `_out/cx3576/cx3576-mos-<epoch>.img` plus a `cx3576-mos-latest.img` symlink.
3. `os/verify-image.sh`: image assertions (partition table, boot files, rootfs
   contents), including at least one negative test.
4. Root `Makefile` targets `os-image-cx3576` / `os-verify-cx3576`.

Acceptance:

- `make os-image-cx3576` builds from a clean tree given the BSP artifacts.
- `make os-verify-cx3576` reports all-PASS.
- Rootfs <= 400 MB uncompressed.
- Hardware boot to sshd over DHCP is the user's manual acceptance — **pending user
  validation**; never claimed done by agents.

Out of scope: `board/**` changes, mosd (M2), RAUC/A-B updates (M4).

## ActiveForm

Building the M1 systemd rootfs prototype image pipeline for cx3576.

## Dependencies

- **blocked by**: (none; consumes RFCT-006 BSP artifacts)
- **blocks**: PLAN-010 M2 (mosd skeleton)
