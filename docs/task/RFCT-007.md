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
3. First-boot disk growth, fully automatic and systemd-native: `systemd-repart`
   (`/etc/repart.d/50-rootfs.conf`, `Type=linux-generic`) grows the rootfs partition to
   fill the eMMC and relocates the backup GPT header; the ext4 filesystem grows online
   via the `x-systemd.growfs` fstab option (systemd-growfs). Rationale: zero extra
   packages (systemd-repart ships inside bookworm's systemd 252 package; verified),
   idempotent on every boot, cannot wedge boot on failure; the boot partition carries
   the ESP typecode so the repart definition uniquely matches the rootfs partition.
   A growpart fallback was rejected as unnecessary.
4. `os/verify-image.sh`: image assertions (partition table, boot files, rootfs
   contents), including at least one negative test.
5. Root `Makefile` targets `os-image-cx3576` / `os-verify-cx3576`.

Acceptance:

- `make os-image-cx3576` builds from a clean tree given the BSP artifacts.
- `make os-verify-cx3576` reports all-PASS.
- Rootfs <= 400 MB uncompressed.
- First-boot growth config (repart definition + `x-systemd.growfs` fstab option)
  asserted by `os/verify-image.sh`; actual on-device growth (116 GiB eMMC) is part of
  the user's hardware acceptance.
- Hardware boot to sshd over DHCP is the user's manual acceptance — **pending user
  validation**; never claimed done by agents.

Out of scope: `board/**` changes, mosd (M2), RAUC/A-B updates (M4).

## ActiveForm

Building the M1 systemd rootfs prototype image pipeline for cx3576.

## Dependencies

- **blocked by**: (none; consumes RFCT-006 BSP artifacts)
- **blocks**: PLAN-010 M2 (mosd skeleton)
