# RFCT-007 cx3576 flashing: rockusb loader-mode descriptor + RK update.img packaging

- **status**: in progress
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-17
- **claimedAt**: 2026-08-17
- **completedAt**: -

> Approved scope for this round: Scope item 1 (U-Boot patches: bcdUSB loader
> descriptor + rkusb_set_reboot_flag maskrom bridge, split artifacts).
> Items 2-3 (update.img pipeline, README matrix) remain pending approval.
>
> Progress 2026-08-17: item 1 implemented and build-verified —
> `uboot/patches/0001-rockchip-usb-rockusb-loader-mode-and-maskrom-reboot.patch`
> applied cleanly in the Docker build, `make uboot` produced
> `u-boot-rockchip.bin` + `u-boot-spl.bin` + `u-boot.itb`. Recovery key stays
> single-mode (rockusb) per user decision. Hardware verification pending:
> `rkdeveloptool ld` shows Loader; `rd 3` re-enumerates as real Maskrom.

## Description

Two flashing-workflow improvements for `board/cx3576`, based on the investigation below.

### Part A — rockusb enumerates as "Maskrom" instead of "Loader"

Root cause (verified in sources):

- rkdeveloptool classifies a device solely by the low bit of the USB device
  descriptor `bcdUSB` (`RKScan.cpp`): `0x0200` (even) -> Maskrom, `0x0201` (odd)
  -> Loader.
- Mainline U-Boot's gadget core hardcodes `bcdUSB = 0x0200`
  (`drivers/usb/gadget/g_dnl.c`) and neither `f_rockusb.c` nor
  `arch/arm/mach-rockchip/board.c:g_dnl_bind_fixup()` overrides it.
- Rockchip vendor U-Boot (`next-dev`) explicitly sets `bcdUSB = 0x0201`
  ("Enumerate as a loader device") in its `g_dnl_bind_fixup()`.

Fix: patch `g_dnl_bind_fixup()` in `uboot/Dockerfile` to set `bcdUSB = 0x0201`
for the rockusb gadget. Cosmetic-plus: tools stop offering maskrom-only paths
(`db`/`ul`, 0x471/0x472 control transfers) that mainline does not implement.

Note: mainline `f_rockusb` implements only 7 opcodes (LBA read/write/erase,
chip version, flash id, test, reset). `rkdeveloptool wl/wlx/rl/rd/td` work;
`upgrade_tool uf` does NOT work against it regardless of the descriptor fix —
`uf` must run from real BootROM maskrom (it downloads the loader itself).

### Part A2 — entering real BootROM maskrom from our U-Boot

`rkdeveloptool db` / `upgrade_tool uf` need real BootROM maskrom; our rockusb
(fake "Maskrom") cannot serve them. Verified mainline mechanism
(`arch/arm/mach-rockchip/boot_mode.c` + `rk3576/Kconfig`):

- RK3576 `CONFIG_ROCKCHIP_BOOT_MODE_REG = 0x26024040` (defined in mainline).
- `set_back_to_bootrom_dnl_flag()` writes `BOOT_BROM_DOWNLOAD` (0xEF08A53C) to
  that register; after reset the BootROM enters maskrom download mode.
- Console equivalent: `mw.l 0x26024040 0xef08a53c; reset`.

How stock firmware serves `uf` from Loader mode (verified in vendor
`f_rockusb.c`, next-dev): the tool sends `K_FW_RESET` with subcode in CDB[1];
vendor `__do_reset()` maps `0x03 -> BOOT_BROM_DOWNLOAD`, `0x06 -> BOOT_LOADER`,
writes the flag to `CONFIG_ROCKCHIP_BOOT_MODE_REG` and resets — i.e. `uf` from
Loader jumps the device back to real maskrom, then proceeds with the normal
maskrom download flow. The loader itself never flashes the IDB in this path.

Mainline `f_rockusb.c` already captures the subcode: `cb_reboot()` stores
`cbw->CDB[1]` and `compl_do_reset()` calls `rkusb_set_reboot_flag(flag)` —
but that hook is only a weak stub; no rockchip implementation exists (checked
`mach-rockchip/board.c`). Fix: implement `rkusb_set_reboot_flag()` (subcode 3
-> write `BOOT_BROM_DOWNLOAD` to the boot-mode reg, 6 -> `BOOT_LOADER`).
Together with the bcdUSB=0x0201 fix this reproduces stock behavior:
`upgrade_tool uf` / `rkdeveloptool rd 3` against our rockusb bounces the board
into real maskrom; no hardware button or serial console needed. Recovery-key
preboot stays `rockusb` as today.

Interim, zero-change route: wipe the IDB via existing rockusb
(`rkdeveloptool wl 64 <64KiB zeros>` + `rd`) — BootROM finds no valid IDB and
falls into maskrom; acceptable for dev since a full reflash follows anyway.

### Part B — pack the image as RK standard `update.img` for `upgrade_tool uf`

Verified toolchain and constraints:

- Pack: `afptool -pack ./ Image/update.img` (needs `package-file` +
  `Image/parameter.txt`), then
  `rkImageMaker -RK3576 Image/MiniLoaderAll.bin Image/update.img update.img -os_type:androidos`.
  Tools live in the SDK `Linux_Pack_Firmware/rockdev/` tree (not in rkbin).
- `parameter.txt` `TYPE: GPT` + `mtdparts` (hex `size@offset` in 512-byte
  sectors); the flashing tool generates real GPT from it and partition names
  become PARTLABELs, so `root=PARTLABEL=rootfs` keeps working.
- The IDB area (sector 64) is written by the tool from the `bootloader` entry
  (MiniLoaderAll.bin), NOT from a partition. Our combined `u-boot-rockchip.bin`
  cannot be packed as-is; split required:
  - `bootloader` = MiniLoaderAll.bin built with `rkbin/tools/boot_merger` from
    `RK3576MINIALL.ini`-style recipe: rkbin boost v1.03 + DDR v1.12 (our pin) +
    usbplug (CODE471/472 kept for maskrom uf) + mainline `u-boot-spl.bin`
    (Armbian PR #7500 validated this on RK3576; mkimage-only idbloader cannot
    boot RK3576 because of the boost pre-stage).
  - `uboot` partition `0x2000@0x4000` = mainline `u-boot.itb` (SPL loads FIT
    from sector 0x4000 — matches current layout).
  - `boot` partition `0x20000@0x8000` = existing FAT32 boot.img (16 MiB start,
    64 MiB — identical to current `Dockerfile.alpine` layout).
  - `rootfs` partition `-@0x28000(rootfs:grow)` = existing rootfs.img.
- `rkdeveloptool` cannot flash update.img (no `uf`); flashing uses
  `upgrade_tool uf update.img` (Linux) or RKDevTool "Upgrade Firmware"
  (Windows), from real maskrom or vendor loader.

Lightweight alternative for daily iteration (no update.img needed): once GPT is
on eMMC, `rkdeveloptool wlx boot boot.img` / `wlx rootfs rootfs.img` through
our U-Boot rockusb (recovery key) writes only the changed partition.

## Scope (proposed)

1. `uboot/Dockerfile` (patches): (a) bcdUSB=0x0201 fixup; (b) implement
   `rkusb_set_reboot_flag()` mapping reset subcode 3/6 to
   `BOOT_BROM_DOWNLOAD`/`BOOT_LOADER` boot-mode-reg writes; also emit
   `u-boot-spl.bin` + `u-boot.itb` as separate artifacts.
   Hardware verify: `rkdeveloptool ld` shows Loader; `rkdeveloptool rd 3`
   re-enumerates as real Maskrom; then `upgrade_tool uf` end-to-end.
2. New `Dockerfile.update` (or extend `Dockerfile.alpine`): boot_merger
   MiniLoaderAll.bin, generate parameter.txt/package-file, afptool +
   rkImageMaker -> `out/update.img`; `make update-img` target.
3. README: flashing matrix (uf vs wlx vs ums vs raw dd). Note: `ums` is
   already available — `generic-rk3576_defconfig` sets
   `CONFIG_CMD_USB_MASS_STORAGE=y`; it runs only from U-Boot (console), never
   from maskrom (BootROM speaks only the 0x471/0x472 protocol).

Out of scope: production ROM (talos repo) packaging, A/B layout.

## Risks

- afptool/rkImageMaker are closed-source SDK binaries; must be vendored or
  fetched from a mirror (e.g. rockchip-android/RKTools, openFyde
  rk3588-image-maker).
- Mainline-SPL-in-boot_merger path is Armbian-validated on ArmSoM CM5, not yet
  on CX3576-Z; fallback is rkbin prebuilt `rk3576_spl_loader_v1.12.108.bin`
  (then `uboot` partition must be `loaderimage --pack --uboot` format instead
  of u-boot.itb).
- opensource.rock-chips.com was unreachable during research; parameter format
  confirmed via rkbin `parameter_gpt.txt`, Firefly/Radxa wikis, rkdeveloptool
  source, and a real RK3576 Fedora parameter.txt.

## ActiveForm

Investigating cx3576 rockusb mode detection and RK update.img packaging.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)
