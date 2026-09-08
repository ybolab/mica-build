# Design: U-Boot A/B Handshake — Contract for a Custom Mainline U-Boot

> Specification the custom U-Boot is built against. The U-Boot tree itself lives
> outside this repository; nothing under `boards/` (formerly `board/`, moved deliberately) is changed by this document.
> The A/B update contract on the systemd base.

## 0. Scope, status and evidence rules

The user builds a **custom U-Boot based on mainline upstream** for CX3576-Z
(Rockchip RK3576, eMMC `/dev/mmcblk0`). This document is the requirements
contract that build must satisfy so that the A/B-layout image, RAUC's `uboot`
bootloader backend, `/etc/fw_env.config` and the dm-verity boot path all agree.

Evidence convention used throughout:

- **[V]** verified in this environment, with the source file and relevant
  symbol named.
  Bare repository paths (`boards/`, `build/`, …) are this repository (`board/` paths are dated: that tree moved under `boards/`); paths starting
  `u-boot/` are the upstream tree at tag `v2026.07`, cloned read-only into a
  scratch directory for this analysis; paths starting `linux/` are
  `armbian/linux-rockchip` branch `rk-6.1-rkr5.1` (`Makefile` reports
  `6.1.115` [V]), fetched read-only.
- **[U]** UNVERIFIED — cannot be established without a board build or hardware.

The board definition had **not** landed when this analysis was
written against branch base `fd6233f`; no directory in the tree held it [V].
Every constant below is therefore quoted from the A/B-layout table. It
has since landed and moved to its present path, so
every generated file (defconfig fragment, `fw_env.config`, `boot.cmd`) **must
be regenerated from `boards/cx3576/board.env`** so the two sides cannot
drift.

`CONFIG_SQUASHFS_XATTR` is out of scope here: L1 approved and applied it to
`boards/common/mos-required.fragment` directly. No action in this document.

A/B-layout constants this document depends on:

| Name | Value | Meaning |
|---|---|---|
| `UENV_A_OFFSET_BYTES` | `0x1000000` (16 MiB) | p1 `uenv-a` start |
| `UENV_B_OFFSET_BYTES` | `0x1100000` (17 MiB) | p2 `uenv-b` start |
| `UENV_SIZE_BYTES` | `0x10000` (64 KiB) | one env copy |
| p3 / p4 | `boot-a` / `boot-b` | FAT32, 64 MiB each, at 18 / 82 MiB |
| p5 / p6 | `rootfs-a` / `rootfs-b` | squashfs+verity raw slots |
| p5 PARTUUID | `5AC35760-0002-4000-8000-000000000005` | rootfs-a |
| p6 PARTUUID | `5AC35760-0002-4000-8000-000000000006` | rootfs-b |

---

## 1. Current-state baseline — what exists today

### 1.1 Correction to the premise: the current tree is already mainline

The campaign brief describes the current U-Boot as a "vendor Rockchip" tree.
It is not. It clones U-Boot from
`ARG UBOOT_REPO=https://github.com/u-boot/u-boot.git`
(`boards/cx3576/bsp/uboot/Dockerfile`), pins it at
`ARG UBOOT_COMMIT=ece349ade2973e220f524ce59e59711cc919263f`
(`boards/cx3576/bsp/uboot/Dockerfile`) -- v2026.07, per the file's own
header -- and builds `make "${BOARD}_defconfig"`
(`boards/cx3576/bsp/uboot/build.sh`, which the Dockerfile hands the board name)
[V]. The only vendor content is:

- Rockchip **binary blobs** from `rockchip-linux/rkbin` — DDR init
  `rk3576_ddr_lp4_2112MHz_lp5_2736MHz_v1.12.bin` and TF-A
  `rk3576_bl31_v1.24.elf` (`boards/cx3576/bsp/uboot/Dockerfile`, the
  `DDR_BLOB`/`BL31_BLOB` args) [V];
- one local patch, `patches/0001-rockchip-usb-rockusb-loader-mode-and-maskrom-reboot.patch`,
  which sets `bcdUSB=0x0201` so Rockchip host tools see a *loader* rather than a
  maskrom device, and implements `rkusb_set_reboot_flag()` for `K_FW_RESET`
  subcodes 3/6 [V];
- a device-tree append (adc-keys recovery button on saradc ch1 with a 17 mV
  threshold, plus `vdd-microvolts = <1800000>` so the mainline `rockchip-saradc`
  driver probes at all). It was a `printf >>` inside the Dockerfile when this was
  written and is
  `boards/cx3576/bsp/uboot/patches/0007-rk3576-generic-cx3576z-recovery-key-saradc.patch`
  since RFCT-345 [V].

**Consequence for this task**: the "pivot to mainline" is mostly already done.
What the user is really deciding is whether to keep carrying these three
customisations in their own tree. All three are still required — see §9.

### 1.2 Environment storage today: there is none

Built from `generic-rk3576_defconfig` plus the Dockerfile's `scripts/config`
edits and `make olddefconfig`, the resulting `.config` contains [V]:

```
CONFIG_ENV_IS_DEFAULT=y
CONFIG_ENV_IS_NOWHERE=y
# CONFIG_ENV_IS_IN_MMC is not set
# CONFIG_ENV_IS_IN_FAT is not set
# CONFIG_ENV_IS_IN_EXT4 is not set
# CONFIG_ENV_IS_IN_SPI_FLASH is not set
# CONFIG_ENV_REDUNDANT is not set
CONFIG_ENV_SIZE=0x1f000
```

(reproduced by running `make generic-rk3576_defconfig`, the Dockerfile's
`scripts/config` line, then `make olddefconfig` in an `ubuntu:24.04` container
against the upstream `v2026.07` tag.)

So today:

- **the environment is not persisted at all.** `CONFIG_ENV_IS_NOWHERE=y` is
  reached because `ENV_IS_DEFAULT` is `def_bool y` when no `ENV_IS_IN_*` is
  selected, and it `select`s `ENV_IS_NOWHERE` (`u-boot/env/Kconfig`) [V].
- there is **no redundant copy** (`CONFIG_ENV_REDUNDANT` not set).
- `saveenv` cannot persist anything, so `BOOT_ORDER` / `BOOT_x_LEFT` cannot
  survive a reboot, and RAUC's `uboot` backend has nothing to talk to.

This is the single hard blocker for M4 and the reason §3 exists.

Naming note that will otherwise cost a build cycle: in `v2026.07` the symbols
are `CONFIG_ENV_REDUNDANT`, `CONFIG_ENV_MMC_DEVICE_INDEX` and
`CONFIG_ENV_MMC_EMMC_HW_PARTITION` (`u-boot/env/Kconfig:499, 738, 748`) [V].
The older spellings `CONFIG_SYS_REDUNDAND_ENVIRONMENT`, `CONFIG_SYS_MMC_ENV_DEV`
and `CONFIG_SYS_MMC_ENV_PART` **no longer exist as Kconfig symbols** — a
tree-wide grep finds them only as literal text inside three NXP `board/*.env`
files [V]. Putting the old names in a defconfig is silently ignored.

### 1.3 Boot flow today: bootstd, not `distro_bootcmd`

`CONFIG_BOOTCOMMAND` is set by the debug variant's build script to
`"setenv boot_targets; bootflow scan -lb; echo BOOT FAILED - entering rockusb; rockusb 0 mmc 0"`
(`boards/cx3576/bsp/uboot/build.sh`) [V], and the resulting config has [V]:

```
CONFIG_BOOTSTD=y
CONFIG_BOOTSTD_FULL=y
CONFIG_BOOTSTD_DEFAULTS=y
CONFIG_BOOTMETH_EXTLINUX=y
CONFIG_BOOTMETH_SCRIPT=y
CONFIG_BOOTMETH_DISTRO=y
CONFIG_BOOTMETH_RAUC is not set
# CONFIG_DISTRO_DEFAULTS is not set
CONFIG_HUSH_OLD_PARSER=y
# CONFIG_CMD_SETEXPR is not set
```

So `distro_bootcmd` is **not** active — the board uses U-Boot's standard boot
(bootstd). `include/config_distro_bootcmd.h` still exists in the tree but is
unused here [V].

**Ordering — the decisive fact for §5.** In *both* frameworks extlinux is tried
**before** `boot.scr`:

- legacy `distro_bootcmd`: `scan_dev_for_boot` runs `scan_dev_for_extlinux`
  then `scan_dev_for_scripts` (`u-boot/include/config_distro_bootcmd.h`)
  [V];
- bootstd: with no `bootmeths` ordering set, bootmeths run in linker-list order,
  which is alphabetical by driver name — and the drivers are deliberately
  numbered `bootmeth_1extlinux`, `bootmeth_2script`, `bootmeth_3efi_mgr`,
  `bootmeth_4efi` (`u-boot/boot/bootmeth_extlinux.c`,
  `bootmeth_script.c`, `bootmeth_efi_mgr.c`, `bootmeth_efi.c`) [V].
  `bootmeth_rauc` is unnumbered (`bootmeth_rauc.c`) and therefore sorts
  *last* [V].

Both frameworks also **continue to the next candidate when a boot attempt
fails**: `distro_bootcmd`'s `scan_dev_for_boot_part` loops over `devplist` and
only enters a partition whose `fstype` probe succeeds
(`config_distro_bootcmd.h`) [V]; bootstd's `bootflow scan -b` loop calls
`bootflow_run_boot()` and keeps iterating on failure
(`u-boot/cmd/bootflow.c`) [V].

The practical consequence: **if `extlinux/extlinux.conf` is present in a mos boot
slot, it wins and the A/B handshake is silently bypassed.** See §5.4.

### 1.4 Raw SPL + U-Boot placement

The assembler writes `u-boot-rockchip.bin` at `UBOOT_SEEK_SECTOR`, sector 64
(`boards/cx3576/board.env`), with a `dd` whose block size is the sector
size (`build/src/mkimage-cx3576.ts`) [V]. Inside that combined image,
SPL loads U-Boot proper from `CONFIG_SYS_MMCSD_RAW_MODE_U_BOOT_SECTOR=0x4000`
= sector 16384 = **8 MiB** [V].

**No collision with the A/B layout**: the actual artifact
`_out/boards/cx3576/uboot/u-boot-rockchip.bin` is 9 393 152 bytes (8.96 MiB) [V],
so written at sector 64 it occupies 0.031 MiB … 8.989 MiB, leaving 7.01 MiB of
headroom before `uenv-a` at 16 MiB. The custom U-Boot must
keep `CONFIG_SYS_MMCSD_RAW_MODE_U_BOOT_SECTOR` at or below sector `0x7000`
(14 MiB) so that `u-boot.itb` still ends before 16 MiB; `0x4000` satisfies this
with ~7 MiB of headroom. The assembler asserts the fit rather than trusting it:
a U-Boot larger than `UBOOT_MAX_BYTES` — the span from sector 64 to `uenv-a`,
`boards/cx3576/board.env` — fails the build
(`build/src/mkimage-cx3576.ts`) [V].

The kernel command line is not the assembler's. `rootfs/build.sh`
composes one per rootfs slot from that slot's verity parameters and the board's
`BOARD_CMDLINE_ARGS` (`boards/cx3576/board.env`) [V].

---

## 2. Mainline RK3576 support status

Established by probing the GitHub contents API for each release tag (200 = file
present at that tag) [V]:

| Path | first release present |
|---|---|
| `arch/arm/mach-rockchip/rk3576/Kconfig` | **v2025.07** |
| `configs/generic-rk3576_defconfig` | **v2025.10** |
| `configs/sige5-rk3576_defconfig` | **v2025.10** |
| `boot/bootmeth_rauc.c` | **v2025.10** |

So RK3576 SoC support landed upstream in **v2025.07**, and the first board
defconfigs (including the `generic-rk3576` one this project uses) in
**v2025.10**. At `v2026.07` there are seven RK3576 defconfigs: `generic`,
`nanopi-m5`, `nanopi-r76s`, `omni3576`, `rock-4d`, `roc-pc`, `sige5` [V].

What `generic-rk3576_defconfig` at `v2026.07` provides [V]
(`u-boot/configs/generic-rk3576_defconfig`):

- **eMMC**: `CONFIG_MMC_SDHCI=y`, `CONFIG_MMC_SDHCI_ROCKCHIP=y`,
  `CONFIG_MMC_SDHCI_SDMA=y`, `CONFIG_SUPPORT_EMMC_RPMB=y`, plus `MMC_DW` /
  `MMC_DW_ROCKCHIP` for SD.
- **Serial**: `CONFIG_DEBUG_UART_BASE=0x2AD40000`, `CONFIG_BAUDRATE=1500000`,
  `CONFIG_SYS_NS16550_MEM32=y` — matches
  `boards/cx3576/board.env` `console=ttyFIQ0,1500000` /
  `earlycon=...0x2ad40000` [V].
- **USB**: DWC3 host + gadget, `CONFIG_USB_FUNCTION_ROCKUSB=y`.
- **DM / distro boot**: full driver model; bootstd with extlinux, script and EFI
  bootmeths (`CONFIG_BOOTSTD_DEFAULTS=y`) [V].
- **Device tree**: `arch/arm/dts/rk3576-generic.dts` with
  `aliases { mmc0 = &sdhci; mmc1 = &sdmmc; }` — **eMMC is `mmc 0`**
  (`u-boot/arch/arm/dts/rk3576-generic.dts`) [V]. This is what makes
  `CONFIG_ENV_MMC_DEVICE_INDEX=0` correct in §3.

Known gaps / vendor-only pieces, i.e. what mainline does **not** give you:

1. **DDR init (TPL) and BL31 are closed-source blobs.** Upstream documents
   building rk3576 with `ROCKCHIP_TPL=` and `BL31=` from `rkbin`
   (`u-boot/doc/board/rockchip/rockchip.rst`) [V]. Mainline has no
   open TPL for RK3576. The current Dockerfile already pins DDR `v1.12` /
   BL31 `v1.24` with a comment that armbian reports `v1.09+` failing to boot on
   some RK3576 boards (`boards/cx3576/bsp/uboot/Dockerfile`) [V] — **keep these
   exact blob versions**; this is the highest-risk item in the whole pivot.
2. **The recovery button does not work out of the box.** Mainline's
   `rockchip-saradc` fails to probe without a `vdd` supply, and the generic
   board DT has no PMIC — hence the `vdd-microvolts = <1800000>` the saradc
   patch adds (`boards/cx3576/bsp/uboot/patches/0007-rk3576-generic-cx3576z-recovery-key-saradc.patch`)
   [V]. Without it there is no ADC, so no `button recovery`, so no `PREBOOT`
   rockusb entry.
3. **Rockusb reports as maskrom, not loader**, without patch 0001 [V]. Rockchip
   host tools then speak the 0x471/0x472 maskrom protocol the gadget does not
   implement.
4. `CONFIG_CMD_SETEXPR` is explicitly disabled by the generic defconfig
   (`configs/generic-rk3576_defconfig`) [V] — required by §5's `boot.cmd`.
5. **The board DT is the *generic* RK3576 DT, not a CX3576-Z DT.** [U] Whether
   the generic DT drives this board's specific eMMC pinmux/voltage correctly is
   only provable on hardware; the current v1 image boots, which is evidence it
   does, but that evidence comes from the existing build, not from this
   analysis.

**Gating risk** for the whole approach: item 1. Everything else is a patch we
already carry. If a future mainline rebase changes the SPL/TPL interface such
that DDR `v1.12` no longer loads, the board does not boot at all — mitigate by
pinning `UBOOT_REF` and the two blob names together, and never bumping them in
the same change.

---

## 3. Storage contract — non-negotiable

The environment MUST be a **redundant pair** at exactly these absolute byte
offsets in the eMMC **user area** of `/dev/mmcblk0` (hardware partition 0, not a
boot hardware partition):

```
UENV_A_OFFSET_BYTES = 0x1000000    # 16 MiB, GPT p1 "uenv-a"
UENV_B_OFFSET_BYTES = 0x1100000    # 17 MiB, GPT p2 "uenv-b"
UENV_SIZE_BYTES     = 0x10000      # 64 KiB per copy
```

They are non-negotiable because three independent artefacts are already pinned
to them: the A/B-layout GPT (p1/p2 exist purely to reserve this space and to give
Linux a bounds-checked block device per copy), `/etc/fw_env.config` shipped by
the boot contract, and RAUC's `uboot` backend which reaches the env only through
`fw_setenv`/`fw_printenv`.

### 3.1 Why redundant, precisely

the power-loss table has a row "Mid-env-write → redundant UENV
pair → One valid CRC copy always exists". That guarantee is not rhetorical: with
`CONFIG_ENV_REDUNDANT=y` each copy carries a CRC and an active/obsolete flag
byte, and U-Boot writes the *inactive* copy first, then flips the flag. A power
cut at any instant leaves at least one copy with a valid CRC, so `BOOT_ORDER`
and the attempt counters can never be lost mid-update. Without redundancy a
power cut during `saveenv` leaves a single corrupt copy and the device falls
back to the compiled-in default environment — which means `BOOT_ORDER` reverts
silently and a freshly installed slot can be abandoned, or worse, a known-bad
slot re-selected.

### 3.2 Defconfig fragment (paste into the custom defconfig)

Verified symbol names and semantics against `v2026.07`. Regenerate the three
hex values from `boards/cx3576/board.env`, which has since landed with
the image assembler, whenever the layout changes.

```
# --- persistent environment: redundant pair in the eMMC user area -----------
# uenv-a @ 16 MiB (GPT p1), uenv-b @ 17 MiB (GPT p2), 64 KiB each.
# Offsets are absolute byte offsets into the mmc 0 user area, which is exactly
# where A/B-layout places p1/p2.
CONFIG_ENV_IS_IN_MMC=y
CONFIG_ENV_OFFSET=0x1000000
CONFIG_ENV_SIZE=0x10000
CONFIG_ENV_REDUNDANT=y
CONFIG_ENV_OFFSET_REDUND=0x1100000
CONFIG_ENV_MMC_DEVICE_INDEX=0
CONFIG_ENV_MMC_EMMC_HW_PARTITION=0
CONFIG_SAVEENV=y
CONFIG_CMD_SAVEENV=y

# --- commands the A/B boot script needs ------------------------------------
CONFIG_CMD_SETEXPR=y
CONFIG_CMD_SOURCE=y
CONFIG_CMD_IMPORTENV=y
CONFIG_CMD_FS_GENERIC=y
CONFIG_CMD_FAT=y
CONFIG_CMD_BOOTI=y
CONFIG_CMD_PART=y
CONFIG_CMD_CRC32=y
CONFIG_CRC32_VERIFY=y
CONFIG_LEGACY_IMAGE_FORMAT=y
CONFIG_HUSH_PARSER=y

# --- keep these OFF: they would relocate the env away from ENV_OFFSET -------
# CONFIG_ENV_MMC_USE_DT is not set
# CONFIG_ENV_MMC_USE_SW_PARTITION is not set
# CONFIG_PARTITION_TYPE_GUID is not set
```

Notes, each with its evidence:

- `CONFIG_CRC32_VERIFY=y` — `default n` (`u-boot/cmd/Kconfig`) [V], so it is not
  optional and not automatic. It is what gives `crc32` the `-v address count
  crc` form the load guard uses (§5.3 divergence 3, §5.6): one command that
  compares and returns the verdict as an exit status hush can branch on, and
  prints both values when they differ. `CONFIG_CMD_CRC32` alone (`default y`)
  gives only `crc32 address count [addr]`, which can write its answer to memory
  and nowhere else; reading it back needs a byte swap — `crc32_wd_buf` stores
  the digest big-endian and `setexpr`'s `*addr` does a native load
  (`u-boot/cmd/setexpr.c`) [V] — and an unpadded `%llx` comparison, two
  spellings nothing would check. **Losing this symbol does not degrade the
  script, it bricks the device**: an unknown flag is a usage error, the script
  reads that as a failed verification, and both slots burn. It is asserted by
  name in `boards/cx3576/bsp/uboot/build-mos.sh`.
- `CONFIG_ENV_MMC_DEVICE_INDEX=0` — `mmc0 = &sdhci` = eMMC in the generic DT
  (`u-boot/arch/arm/dts/rk3576-generic.dts`) [V]. Rockchip additionally
  overrides `mmc_get_env_dev()` to resolve `/chosen/u-boot,spl-boot-device`
  when present (`u-boot/arch/arm/mach-rockchip/board.c`) [V], which
  lands on the same device.
- `CONFIG_ENV_MMC_EMMC_HW_PARTITION=0` — "partition 0 … is the user area"
  (`u-boot/env/Kconfig`) [V]. This is the symbol the brief calls
  `CONFIG_SYS_MMC_ENV_PART`.
- The three "keep OFF" symbols matter. `env/mmc.c` resolves the env
  offset in priority order: a software partition name
  (`CONFIG_ENV_MMC_SW_PARTITION` or the `u-boot,mmc-env-partition` DT
  property), then a GPT partition carrying the "U-Boot ENV" type GUID (only if
  `CONFIG_PARTITION_TYPE_GUID`), and only then `CONFIG_ENV_OFFSET` [V].
  The partition paths place the env at the **end** of the partition
  (`env/mmc.c`) [V], which would silently move it off the pinned
  offsets. Leaving all three off forces the plain `ENV_OFFSET` path.
- `CONFIG_ENV_SIZE` must be `0x10000`, not the `0x1f000` the Rockchip default
  produces (§1.2) — 0x1f000 is 124 KiB and would overrun the 64 KiB partition
  and scribble into `uenv-b`.
- `CONFIG_CMD_SETEXPR` is off in the generic defconfig
  (`configs/generic-rk3576_defconfig`) [V] and must be turned back on.

### 3.3 `/etc/fw_env.config` (shipped deliberately)

```
# /etc/fw_env.config — U-Boot environment access from Linux.
# Generated from boards/cx3576/board.env; do not hand-edit.
# Two device lines == redundant environment; both copies must be listed.
#
# Device name     Device offset   Env. size
/dev/mmcblk0p1    0x0000          0x10000
/dev/mmcblk0p2    0x0000          0x10000
```

The partition form is preferred over the equivalent whole-disk form
(`/dev/mmcblk0 0x1000000 0x10000` + `/dev/mmcblk0 0x1100000 0x10000`) because
the kernel bounds-checks writes to `p1`/`p2`, so a wrong offset cannot corrupt
`boot-a`. Both forms describe the same bytes only as long as p1/p2 start
exactly at `UENV_A_OFFSET_BYTES` / `UENV_B_OFFSET_BYTES` — hence "generate both
sides from the same file".

**Toolchain**: in Debian bookworm `fw_printenv` and `fw_setenv` are shipped by
**`libubootenv-tool`**, not `u-boot-tools` (`dpkg -S` on a bookworm container
resolves both binaries to `libubootenv-tool`) [V]. Bookworm ships **no**
`/etc/fw_env.config` by default [V], so the rootfs work must add both the package to
the rootfs allowlist and the file above.

`fw_setenv` infers redundancy from the presence of two device lines; the
on-disk record layout (CRC + flag byte) then matches U-Boot's
`CONFIG_ENV_REDUNDANT` format. If exactly one of the two sides is configured
redundant, every read from the other side fails its CRC check.

---

## 4. Environment variable contract

| Variable | Owner (writer) | When | Meaning |
|---|---|---|---|
| `BOOT_ORDER` | RAUC (`fw_setenv`) | on install / `mark-bad` | Space-separated slot names, leftmost tried first. Initial value `"A B"`. |
| `BOOT_A_LEFT` | `boot.scr` (decrement) and RAUC (reset) | every boot / on `mark-good`, `mark-bad`, install | Remaining boot attempts for slot A. |
| `BOOT_B_LEFT` | same, for slot B | | |
| `machine_id` | Linux oneshot (`fw_setenv`), once | first boot only | 32 lowercase hex chars, no dashes. §6. |
| `bootslot` | `boot.scr` | every boot, RAM only | Slot chosen this boot. Never saved. |
| `bootpart` / `rootpart` | `boot.scr` | every boot, RAM only | GPT partition numbers of the chosen slot. |
| `verity_args` | `boot.scr` via `env import` | every boot, RAM only | The `dm-mod.create=` / `dm-mod.waitfor=` cmdline tail for the chosen slot. §7. |

RAUC's side of this is fixed by its source, not by convention
(`rauc/src/bootloaders/uboot.c`, master) [V]:

- it reads `BOOT_ORDER` and `BOOT_<bootname>_LEFT` where `<bootname>` is the
  slot's `bootname=` from `system.conf`;
- `mark-good` → `BOOT_<slot>_LEFT` = `boot-attempts` (default 3);
- `mark-bad` → the slot is **removed from `BOOT_ORDER`** and its counter set to
  0;
- `set_primary` → the slot is moved to the **front** of `BOOT_ORDER` and its
  counter set to `boot-attempts-primary`. Both attempt counts
  come from `[system] boot-attempts=` / `boot-attempts-primary=` in
  `system.conf` (`rauc/src/config_file.c`) [V].

### 4.1 Radix trap — the counter is hexadecimal

RAUC **writes** the counter with `g_strdup_printf("%x", attempts)` and **reads**
it with `g_ascii_strtoull(..., 16)` (`rauc/src/bootloaders/uboot.c`)
[V] — i.e. bare hex, no `0x` prefix. On the U-Boot side:

- `setexpr` parses arguments with `hextoul()` and stores results with
  `env_set_hex()` (`u-boot/cmd/setexpr.c`) [V] — also hex. **Matches.**
- `test -gt` parses with `simple_strtol(..., 0)` (`u-boot/cmd/test.c`)
  [V] — i.e. decimal unless `0x`-prefixed. **Does not match**, but the two
  agree for every value 0–9.

**Contract**: keep `boot-attempts` and `boot-attempts-primary` in the range
1–9 (RAUC's default of 3 is fine). Above 9 the counter would be decremented
correctly but compared wrongly. Record this in the RAUC `system.conf` renderer.

### 4.2 Decrement-then-save-then-boot, in that order

The required per-boot sequence is:

1. read `BOOT_ORDER`; walk it left to right;
2. for the first slot whose `BOOT_<slot>_LEFT` is greater than 0: decrement that
   counter in RAM;
3. **`saveenv`** — write the decremented counter to the redundant pair;
4. only then load the kernel and `booti`.

Saving *before* booting is what makes the counter a watchdog rather than a hint.
If the save happened after a successful boot, then a slot that hangs in early
kernel, panics, or resets before userspace would be retried forever: the counter
never reaches disk, so every reset re-reads the same value and re-selects the
same dead slot. With the save first, each *attempt* costs one credit whether or
not the attempt gets anywhere, so a slot that cannot complete a boot is
guaranteed to exhaust its credits in at most `boot-attempts` resets and hand
over to the other slot. The credit is only refunded by userspace reaching the
health gate and running `rauc status mark-good`, which is precisely the
condition we want to test.

Failure handling when no slot has credits left: reset **all** counters to the
default, `saveenv`, and `reset` the board. This is the same policy as upstream's
`CONFIG_BOOTMETH_RAUC_RESET_ALL_ZERO_TRIES` (`u-boot/boot/bootmeth_rauc.c`)
[V]. It prevents a permanently unbootable device at the cost of one extra reset
loop; the operator-visible symptom is a device that reboots repeatedly, which is
what the rescue path is for.

---

## 5. Slot selection logic

### 5.1 The two options

**(A) `boot.scr` shipped on BOOT-A and BOOT-B.** All slot-selection and counter
logic lives in a U-Boot script compiled into the boot partitions. U-Boot itself
only needs persistent env plus a `bootcmd` that finds and sources a script.

**(B) logic compiled into the custom U-Boot** — either hand-written into the
default environment / `bootcmd`, or by enabling upstream's
`CONFIG_BOOTMETH_RAUC`, which implements the same handshake in C: it defaults
`BOOT_ORDER` and `BOOT_<slot>_LEFT`, picks the first slot with credits,
decrements, `env_save()`s, exports `distro_bootpart` / `distro_rootpart` /
`raucargs`, then sources that slot's `boot.scr`
(`u-boot/boot/bootmeth_rauc.c`, `bootmeth_rauc_read_bootflow`) [V].

### 5.2 Recommendation: (A), with (B) as a documented fallback

Take **(A)**. The decisive arguments:

- **An update must be able to change the boot logic.** The boot script is the
  only place that knows how to construct the `dm-mod.create=` verity table, and
  that table changes shape whenever the verity parameters change (block size,
  hash offset, algorithm). In (A) the script is a file in the boot partition, so
  RAUC rewrites it as part of the slot group and a bad boot script is rolled
  back by the same mechanism as a bad kernel. In (B) the logic is in U-Boot,
  which the layout stores as raw sectors outside any slot — updating it is a
  non-atomic, non-rollback-able write to the one thing that must never break.
  This asymmetry decides it.
- **Fall-through when BOOT-A's filesystem is unreadable** works in (A) without
  any extra machinery, because both boot partitions carry the *same* script:
  U-Boot tries the p3 bootflow, fails to read the FAT or the script, and
  continues to the p4 bootflow (`u-boot/cmd/bootflow.c` [V]; the legacy
  equivalent is `config_distro_bootcmd.h` [V]). Whichever copy actually
  runs then honours `BOOT_ORDER` and can boot *either* slot — the script is
  slot-agnostic by construction (§5.3), so BOOT-A's script booting rootfs-B is
  a normal, tested path rather than a special case.
- **Cost**: (A) needs `CONFIG_CMD_SETEXPR=y` back on (§3.2), and the script is
  hush, which has no arithmetic and no arrays — the two-slot case is written out
  explicitly below rather than looped generically.

**When to switch to (B).** If hush proves too fragile on hardware — in
particular if quoting the `dm-mod.create=` string does not survive
`env import` + `setenv` (§7.4) — enabling `CONFIG_BOOTMETH_RAUC=y` moves the
counter arithmetic and `env_save()` into upstream C code that is already
verified to do the right ordering, and reduces `boot.cmd` to just "load kernel
and dtb from `${distro_bootpart}`, build bootargs, `booti`". That is a strictly
smaller script and still leaves the bootargs construction updatable. Its
configuration would be:

```
CONFIG_BOOTMETH_RAUC=y
CONFIG_BOOTMETH_RAUC_BOOT_ORDER="A B"
CONFIG_BOOTMETH_RAUC_PARTITIONS="3,5 4,6"
CONFIG_BOOTMETH_RAUC_DEFAULT_TRIES=3
CONFIG_BOOTMETH_RAUC_RESET_ALL_ZERO_TRIES=y
```

(`"3,5 4,6"` = slot A is boot p3 + root p5, slot B is boot p4 + root p6, in the
`<boot>,<root>` pair syntax of `u-boot/boot/Kconfig` [V].) Note that
this bootmeth reads the counter with `env_get_ulong(..., 10, ...)`
(`bootmeth_rauc.c`) [V] — decimal — so §4.1's 1–9 range still applies.

**Rescue path.** The A/B design wants a last-resort rescue when every slot is
exhausted. It does **not** need U-Boot-resident logic: the "reset all counters
and `reset`" behaviour of §4.2 keeps the device alive, and the actual rescue
entry is the existing `PREBOOT` recovery-button path into rockusb
(`boards/cx3576/bsp/uboot/build.sh`) plus the `bootcmd` tail that enters rockusb
when boot fails (`boards/cx3576/bsp/uboot/build.sh`) [V]. Both are already in the current tree and
must be preserved in the custom build — that is the rescue path, and it is
U-Boot-resident for the right reason (it must work when no slot is readable).

### 5.3 `boot.cmd`

Slot-agnostic: the running copy may boot either slot. Per-slot verity parameters
are *not* baked in — they are imported from the chosen slot's boot partition
(§7.3), so the script is byte-identical in both boot partitions.

**This block is synced to the shipped `boards/cx3576/boot.cmd`**, which is
what `build/src/mkimage-cx3576.ts` compiles into `boot.scr`. It now differs from the
version first published here in **three** places. All three were defects, and
all three are recorded in the shipped script's provenance header:

1. **The slot-suffixed verity env.** The script sets `slotsuffix` alongside
   `bootslot` and loads `mos-verity-${slotsuffix}.env`, falling back to the
   unsuffixed name. A RAUC bundle installs one boot image into whichever slot is
   inactive, so it must ship *both* slots' verity files under distinct names and
   an unsuffixed file cannot identify a slot. With the original unsuffixed load,
   every installed slot took the else-branch and rolled back. The unsuffixed
   fallback is kept only for hand-assembled boot partitions; nothing this tree
   builds relies on it. (escalation E1.)
2. **`bootargs` carries `rauc.slot=${bootslot}`.** The root device is
   `/dev/dm-0`, a device-mapper node rather than a partition, and rauc cannot
   match that against any slot's `bootname`, slot name or `realpath(device)`.
   Verified against rauc 1.8: without `rauc.slot=` it fails with *"Did not find
   booted slot (matching '/dev/dm-0')"*, so the health gate never reaches
   `rauc status mark-good` and the installed slot is rolled back. This is a
   requirement on the boot path that only became visible once the handshake was
   integrated end to end. (integration check, fixed deliberately.)
3. **The kernel and the dtb are loaded through a guard.** The version first
   published here checked the 370-byte verity env and not the 42 MB kernel, and
   a cx3576 board booted a **mixture of two kernel builds** and died in
   `paging_init` (`kernel BUG at arch/arm64/mm/mmu.c:283`) while the console
   reported the full `44493312 bytes read`. `mos-boot-digest-<slot>.env` (§5.6)
   carries each file's byte count and CRC-32, the script asserts both, and
   either disagreeing burns the slot down the same route the
   missing-verity-env case already takes. (RFCT-352.)

   **The checksum is the guard; the size compare is a first line.** That is a
   measurement, not a preference. At the U-Boot prompt the word under
   `swapper_pg_dir[256]` was poisoned before the load and read back after it:

   ```
   => mw.q 0x43e87800 deadbeefdeadbeef 1
   => md.q 0x43e87800 1
   43e87800: deadbeefdeadbeef
   => load mmc 0:4 $kernel_addr_r Image
   44493312 bytes read in 621 ms (68.3 MiB/s)
   => md.q 0x43e87800 1
   43e87800: 910fa02190ffef61
   ```

   The load reported the **exact right size** — 44,493,312, the byte count of
   the file this repository builds — so a `${filesize}` assertion passes here.
   It **did** write the address: the poison is gone, nothing was skipped. And
   what it wrote is the **previous kernel's** bytes
   (`early_kvm_mode_cfg+0x10` out of the 2026-09-07 08:12 build). The file on
   eMMC is itself a mixture and `load` read it faithfully. A size check is
   green on this failure; only a checksum is not.

   **This one is not deployable by an update alone**, unlike the other two. It
   needs `CONFIG_CRC32_VERIFY=y` in the U-Boot build (§3.2), and the loader
   lives in raw sectors outside every RAUC slot group, so a device carrying the
   previous `uboot-mos` blob would read `crc32 -v` as a usage error, treat that
   as a failed verification, and burn both slots. The blob and the boot payload
   have to be flashed together.

```sh
# boot.cmd — mos A/B handshake for CX3576-Z (A/B layout).
# Compiled to boot.scr and written to BOTH boot partitions by the assembler.
# Identical in both slots: whichever copy runs may boot either slot.
#
# hush notes: no arithmetic without setexpr; setexpr is HEXADECIMAL, which is
# also the radix RAUC uses for BOOT_x_LEFT. Keep boot-attempts in 1..9.
#
# PARTITION NUMBERS. bootpart/rootpart below are literal GPT partition numbers,
# because hush cannot read boards/cx3576/board.env. They are BOOT_A_PARTNUM /
# BOOT_B_PARTNUM / ROOTFS_A_PARTNUM / ROOTFS_B_PARTNUM from that file, and
# build/src/mkimage-cx3576.ts refuses to compile this script if any of the four disagrees.
# Do not edit one here without editing the layout: a stale number sends U-Boot
# to the wrong partition after it has already persisted the attempt decrement.

setenv verityaddr 0x40f00000
setenv digestaddr 0x40f10000

# --- defaults, only used on a virgin environment ---------------------------
test -n "${BOOT_ORDER}"  || setenv BOOT_ORDER "A B"
test -n "${BOOT_A_LEFT}" || setenv BOOT_A_LEFT 3
test -n "${BOOT_B_LEFT}" || setenv BOOT_B_LEFT 3

# --- pick the leftmost slot in BOOT_ORDER that still has credits -----------
setenv bootslot
for slot in ${BOOT_ORDER}; do
    if test -n "${bootslot}"; then
        echo "skipping ${slot}"
    elif test "${slot}" = "A"; then
        if test ${BOOT_A_LEFT} -gt 0; then
            setexpr BOOT_A_LEFT ${BOOT_A_LEFT} - 1
            setenv bootslot A
            setenv slotsuffix a
            setenv bootpart 4
            setenv rootpart 6
        fi
    elif test "${slot}" = "B"; then
        if test ${BOOT_B_LEFT} -gt 0; then
            setexpr BOOT_B_LEFT ${BOOT_B_LEFT} - 1
            setenv bootslot B
            setenv slotsuffix b
            setenv bootpart 5
            setenv rootpart 7
        fi
    fi
done

# --- no credits anywhere: refill, persist, reboot --------------------------
if test -z "${bootslot}"; then
    echo "mos: no bootable slot left, resetting attempt counters"
    setenv BOOT_A_LEFT 3
    setenv BOOT_B_LEFT 3
    saveenv
    reset
fi

# --- persist the decrement BEFORE booting: this is what makes it a watchdog -
# An unpersisted decrement quietly degrades the whole scheme to boot-forever:
# every reset would start from the old counter, so a slot that can never reach
# mark-good would be retried without end instead of rolling back. saveenv's
# result cannot change what happens next (the kernel either boots or it does
# not), but a failing env write must not be silent -- it is the watchdog
# disarming itself, and the console line is the only witness.
saveenv || echo "mos: WARNING: saveenv FAILED, boot-attempt decrement NOT persisted; the A/B watchdog cannot count this attempt and a bad slot will be retried forever"

echo "mos: booting slot ${bootslot} (A=${BOOT_A_LEFT} B=${BOOT_B_LEFT} left)"

# --- per-slot verity parameters, from the chosen slot's boot partition ------
# mos-verity-<slot>.env is a one-line text env file defining verity_args= with
# the full dm-mod.create=/dm-mod.waitfor= tail for THIS slot's rootfs.
# The name carries the slot because one RAUC boot payload can be installed into
# either boot partition: it ships both slots' files, so the slot-identifying
# file cannot be slot-neutral. slotsuffix is set alongside bootslot above,
# lowercase to match the filenames, rather than leaning on FAT case folding.
# The unsuffixed name is a fallback for older, hand-assembled boot partitions;
# nothing this tree builds relies on it.
if load mmc 0:${bootpart} ${verityaddr} mos-verity-${slotsuffix}.env; then
    env import -t ${verityaddr} ${filesize}
elif load mmc 0:${bootpart} ${verityaddr} mos-verity.env; then
    env import -t ${verityaddr} ${filesize}
else
    echo "mos: slot ${bootslot} has no mos-verity-${slotsuffix}.env"
    setenv BOOT_${bootslot}_LEFT 0
    saveenv
    reset
fi

# --- machine identity: only when U-Boot actually has one (see section 6) ---
setenv machineid_arg
if test -n "${machine_id}"; then
    setenv machineid_arg "systemd.machine_id=${machine_id}"
fi

setenv consoleargs "console=ttyFIQ0,1500000 earlycon=uart8250,mmio32,0x2ad40000"
setenv rootargs "root=/dev/dm-0 rootfstype=squashfs ro rootwait"

# rauc.slot= is how rauc identifies which slot it is running from. It cannot be
# derived from root=: the verity design makes root a device-mapper node, and
# rauc matches the boot slot by bootname, slot name or realpath(device), none of
# which /dev/dm-0 can ever be. ${bootslot} is A or B, which are exactly the
# bootname values /etc/rauc/system.conf declares, so no separate mapping exists
# to drift. Without this, `rauc status` fails, the health gate never runs
# `rauc status mark-good`, and U-Boot rolls the new slot back on credit
# exhaustion — an update that reverts while the device looks healthy.
setenv raucargs "rauc.slot=${bootslot}"

setenv bootargs "${rootargs} ${verity_args} ${raucargs} ${consoleargs} net.ifnames=0 ${machineid_arg}"

# --- load the kernel and the dtb, and prove what landed ---------------------
# mos-boot-digest-<slot>.env records the byte count and the CRC-32 of the Image
# and the rk3576-src.dtb sitting beside it, and it is what turns `load` from a
# command whose success means "the FAT directory had an entry and the read did
# not error" into one whose success means "the bytes in DRAM are the bytes on
# the card".
#
# WHY THE CHECKSUM IS THE GUARD, measured on the board rather than reasoned.
# The word under swapper_pg_dir[256] was poisoned at the U-Boot prompt before
# the load and read back after it:
#
#   => mw.q 0x43e87800 deadbeefdeadbeef 1
#   => load mmc 0:4 $kernel_addr_r Image
#   44493312 bytes read in 621 ms (68.3 MiB/s)
#   => md.q 0x43e87800 1
#   43e87800: 910fa02190ffef61
#
# Three things, and they decide the shape of this block. The load reported the
# EXACT right size, the byte count of the file this repository builds. It DID
# write the address -- the poison is gone, so nothing was skipped. And what it
# wrote is the PREVIOUS kernel's text (early_kvm_mode_cfg+0x10 out of the
# 2026-09-07 08:12 build). The file on eMMC is itself a mixture and `load` read
# it faithfully. RFCT-351, RFCT-352.
#
# The name carries the slot for the same reason mos-verity-<slot>.env does: one
# RAUC boot payload is installed into whichever boot slot is inactive, so it
# ships both slots' files and a slot-neutral name could not be one of them.
#
# The four values are cleared first. `env import` leaves whatever a previous
# boot persisted in place for any key the file does not carry, and the burn
# paths call saveenv, so a truncated digest file could otherwise be checked
# against a stale value some earlier boot wrote -- the guard passing on the
# strength of the number it exists to test.
setenv bootfault
setenv kernel_bytes
setenv kernel_crc
setenv fdt_bytes
setenv fdt_crc

if load mmc 0:${bootpart} ${digestaddr} mos-boot-digest-${slotsuffix}.env; then
    env import -t ${digestaddr} ${filesize} || setenv bootfault "mos-boot-digest-${slotsuffix}.env would not import"
else
    setenv bootfault "no mos-boot-digest-${slotsuffix}.env beside Image"
fi

# THE SIZE COMPARE IS A FIRST LINE, NOT THE GUARD. It is free, and it names a
# short read precisely where the checksum would only say "wrong" -- but on the
# failure this block exists for it is GREEN: the console printed the exact
# 44493312 the file has, and the bytes underneath were another build's. Never
# read a passing size compare as "the kernel is the right one"; only the
# crc32 -v below says that. It is here because a short read is a different
# fault worth naming, not because it catches this one.
#
# `load` reports ${filesize} through env_set_hex, i.e. "%lx": lowercase hex, no
# 0x prefix, no leading zeros. The digest file spells the byte counts the same
# way, so this is a string compare and needs no arithmetic -- hush has none
# without setexpr, and setexpr is hexadecimal (see the header).
if test -z "${bootfault}"; then
    if load mmc 0:${bootpart} ${kernel_addr_r} Image; then
        if test "${filesize}" != "${kernel_bytes}"; then
            setenv bootfault "Image: ${filesize} bytes landed, the digest says ${kernel_bytes}"
        elif crc32 -v ${kernel_addr_r} ${filesize} ${kernel_crc}; then
            echo "mos: Image ${kernel_bytes} bytes, crc32 ${kernel_crc} verified in DRAM"
        else
            setenv bootfault "Image: ${kernel_bytes} bytes landed and their crc32 is not ${kernel_crc}"
        fi
    else
        setenv bootfault "Image would not load"
    fi
fi

if test -z "${bootfault}"; then
    if load mmc 0:${bootpart} ${fdt_addr_r} rk3576-src.dtb; then
        if test "${filesize}" != "${fdt_bytes}"; then
            setenv bootfault "rk3576-src.dtb: ${filesize} bytes landed, the digest says ${fdt_bytes}"
        elif crc32 -v ${fdt_addr_r} ${filesize} ${fdt_crc}; then
            echo "mos: rk3576-src.dtb ${fdt_bytes} bytes, crc32 ${fdt_crc} verified in DRAM"
        else
            setenv bootfault "rk3576-src.dtb: ${fdt_bytes} bytes landed and their crc32 is not ${fdt_crc}"
        fi
    else
        setenv bootfault "rk3576-src.dtb would not load"
    fi
fi

# WHAT NEITHER ASSERTION CATCHES: a corruption that happens after the check and
# before the kernel reads the page. The window is now the crc32-to-booti gap
# instead of the whole load, and it is not zero. This script cannot make it zero
# and does not pretend to.
#
# The same route the missing-verity-env case takes, for the same reason: burn
# this slot's remaining credits so the next reset moves on instead of retrying a
# slot we know cannot boot. It is not a permanent loss -- when both slots reach
# zero the refill block above puts three credits back on each -- so a transient
# fault costs a trip through the other slot and back, not the device.
if test -n "${bootfault}"; then
    echo "mos: slot ${bootslot} p${bootpart}: ${bootfault}"
    setenv BOOT_${bootslot}_LEFT 0
    saveenv
    reset
fi

booti ${kernel_addr_r} - ${fdt_addr_r}

# booti only returns on failure: burn this slot's remaining credits so the
# next reset moves on instead of retrying a slot we know cannot boot.
echo "mos: booti returned, slot ${bootslot} is bad"
setenv BOOT_${bootslot}_LEFT 0
saveenv
reset
```

`${kernel_addr_r}` = `0x42000000`, `${fdt_addr_r}` = `0x52000000`,
`${scriptaddr}` = `0x40c00000`, `${pxefile_addr_r}` = `0x40e00000`
(`u-boot/include/configs/rk3576_common.h`) [V]; `verityaddr=0x40f00000` and
`digestaddr=0x40f10000` sit in the 18 MiB gap between `pxefile_addr_r` and
`kernel_addr_r`, 64 KiB apart, and both files they hold are a few hundred bytes.

### 5.4 Composition with `extlinux/extlinux.conf`

Per §1.3, extlinux is tried **before** `boot.scr` in both bootstd and
`distro_bootcmd`. Therefore:

> **The mos boot slots must not contain `extlinux/extlinux.conf`.** If they do,
> U-Boot boots it directly and the entire A/B handshake — counter decrement,
> `BOOT_ORDER`, rollback — is bypassed with no error message.

Two acceptable ways to satisfy this, in order of preference:

1. `build/src/mkimage-cx3576.ts` simply does not write `extlinux/extlinux.conf` into
   BOOT-A/BOOT-B. `boot.scr` replaces it. This is the recommendation.
2. If a manual recovery entry is wanted, write it under a name the automatic
   scan does not look for (e.g. `extlinux/extlinux.conf.manual`) and document
   the U-Boot console incantation to use it. `boot.scr` must still be the only
   automatically discoverable boot entry.

Belt and braces on the U-Boot side: pin the bootmeth order in `bootcmd` so an
accidental `extlinux.conf` cannot win.

```
CONFIG_BOOTCOMMAND="bootmeth order script; bootflow scan -lb; echo BOOT FAILED - entering rockusb; rockusb 0 mmc 0"
```

`bootmeth order` takes bootmeth **device** names, which are the driver names with
the `bootmeth_` prefix stripped (`u-boot/boot/bootstd-uclass.c`) [V] —
so `script` here, and `rauc` if option (B) is taken. Names are matched exactly
(`u-boot/boot/bootmeth-uclass.c`) [V]. `CONFIG_CMD_BOOTMETH=y` is
already on in the current config [V].

### 5.5 `mkimage` invocation and the assembler handoff

```sh
SOURCE_DATE_EPOCH=1577836800 \
mkimage -T script -C none -n "mos boot" -d boot.cmd boot.scr
```

`SOURCE_DATE_EPOCH` is **mandatory**: `mkimage` stamps the legacy image header
with the current time unless it is set (`u-boot/tools/imagetool.c`) [V],
which would break the campaign's byte-identical-rebuild contract. `1577836800`
is the A/B-layout fixed mtime (2020-01-01T00:00:00Z). `-C none` because the
script is not compressed; `-T script` requires `CONFIG_LEGACY_IMAGE_FORMAT=y`
in U-Boot, which is already set [V].

**Owner of the assembly step: the image assembler** (`build/src/mkimage-cx3576.ts`). What it must do:

1. Build `boot.scr` from the `boot.cmd` above with the exact invocation above,
   and write the **same** `boot.scr` to both BOOT-A and BOOT-B (FAT root, since
   bootstd's default filename prefixes are `/` and `/boot/` —
   `u-boot/boot/bootstd-uclass.c` [V]).
2. Write a per-slot `mos-verity-<slot>.env` into each boot partition
   (`mos-verity-a.env` in BOOT-A, `mos-verity-b.env` in BOOT-B — see §5.3 for
   why the name carries the slot), containing exactly one line:
   `verity_args=dm-mod.create="rootfs,,0,ro,<table>" dm-mod.waitfor=PARTUUID=<slot rootfs PARTUUID>`
   with `<table>` built from that slot's verity metadata (§7.3). Slot A's file
   references PARTUUID `...0005`, slot B's references `...0006`.
3. Write that slot's `mos-boot-digest-<slot>.env` into each boot partition —
   `mos-boot-digest-a.env` in BOOT-A, `mos-boot-digest-b.env` in BOOT-B, and
   only its own, as with the verity env — computed from the **staged** copies of
   `Image` and `rk3576-src.dtb` rather than from the inputs, because those are
   the bytes `mcopy` is about to write and a digest of anything else describes a
   file that is not there (§5.6). The bundle builder writes **both** into the
   single `boot.vfat` its payload carries, for the same reason it writes both
   verity envs: the payload does not know which slot it will land in.
4. Not write `extlinux/extlinux.conf` into the mos boot slots (§5.4).
5. Apply the fixed mtime `@1577836800` to every staged file before the `mcopy`
   that fills the slot (`build/src/mkimage-cx3576.ts`) [V].
6. Zero-fill uenv-a/uenv-b so a freshly flashed device starts from the
   compiled-in default environment rather than stale bytes. (These were p1/p2
   when this section was written; they are **p2/p3** since the loader partition
   landed — see §8.0. Their start sectors and therefore U-Boot's `ENV_OFFSET`
   are unchanged.)

Inputs it needs that this design does not provide: the verity root hash, data
block count and hash-tree start block for each slot — those come from the
`veritysetup format` step in the rootfs/verity task, which must surface them as
shell variables for the `mos-verity-<slot>.env` renderer.

### 5.6 `mos-boot-digest-<slot>.env`

One file per slot per boot partition, written beside `Image` and
`rk3576-src.dtb` by whatever produced them — the image assembler at flash time,
the RAUC boot payload at update time — recording what those two files are:

```
kernel_bytes=2a6ea00
kernel_crc=5f867ac9
fdt_bytes=46ce7
fdt_crc=703d24cf
```

Those are the real values for the kernel this repository builds, and they were
checked through U-Boot's own `crc32` rather than assumed to match a host tool:
loading the shipped `Image` in the sandbox binary and running `crc32` prints
`==> 5f867ac9`, `crc32 -v … 5f867ac9` returns success, and a one-bit-different
expectation returns `** ERROR **`.

**The checksum is the guard. The size compare is a first line and must never be
read as more.** §5.3's divergence 3 has the board transcript: the load that
delivered another build's bytes reported the exact right byte count, so a
`${filesize}` assertion is *green* on the failure this whole mechanism exists
for. The size compare stays because a short read is a different fault and
naming it precisely is worth the zero cost — not because it catches this one.
`boot.cmd` says so at the point of use, and
`build/src/boot-cx3576.ts`'s guard refuses a script that has the size compare
and not the `crc32 -v`.

**What neither catches**: a corruption after the check and before the kernel
reads the page. The window is the `crc32`-to-`booti` gap rather than the whole
load; it is not zero, and the script cannot make it zero.

**The two spellings are contract, not presentation.** `load` publishes
`${filesize}` through `env_set_hex`, which is `sprintf(str, "%lx", ...)` —
lowercase hex, no `0x`, no leading zeros — and boot.scr compares the two as
strings, because hush has no arithmetic without `setexpr` and `setexpr` is
hexadecimal (§4.1). The checksum is zero-padded to eight digits because
`parse_verify_sum` (`u-boot/common/hash.c`) reads an argument of exactly
`2 * digest_size` characters as a hex literal and **anything else as the name of
an environment variable to look up**: a checksum with a zero top byte written as
six digits would not be compared against the image at all, and would refuse a
slot that was fine.

**The name carries the slot**, for the reason `mos-verity-<slot>.env` does: a
RAUC bundle installs its single boot payload into whichever boot slot is
inactive, so the payload ships *both* slots' files and a slot-neutral name could
not be one of them. The image assembler writes only the slot's own file into
that slot — as it does for the verity env — so a factory slot and an updated
slot have the same layout and the suffixed path is exercised from the first
boot.

**Cost.** `crc32` over 44,493,312 bytes measured **≈100 ms** in the U-Boot
sandbox on an x86 host (Xeon 8581C @ 2.10 GHz; 1466 ms for load + one pass,
2365 ms for load + ten, so ≈100 ms per pass — about 445 MB/s). `lib/crc32.c` is
a portable byte-at-a-time table loop, so the RK3576 figure will differ with
clock and IPC. **It has not been measured on the board and is owed**; the
measurement is one line at the U-Boot prompt:

```
=> load mmc 0:4 $kernel_addr_r Image     # prints its own ms
=> crc32 $kernel_addr_r $filesize        # time this against the line above
```

The yardstick is in the transcript above: the board reads the same 42 MB off
eMMC in **621 ms**. A checksum pass of comparable order is affordable on every
boot; if it turns out to be seconds, the answer is not a switch — a guard that
can be turned off will be off on the machine that needed it — but a narrower
check chosen with the number in hand.

**A refusal burns the slot, and that is right even on a first boot.** The burn
is `BOOT_<slot>_LEFT=0`, which is not a permanent loss: when both slots reach
zero the script refills each to three and resets (§4.2). So on a
factory-flashed board whose `rootfs-b` is still zero-filled that trip ends in
slot B's own credits being spent and the counters refilling, which returns to
slot A — the guard cannot strand a device that a retry would have saved. It
costs boot cycles, and it buys a board that says why it will not boot instead of
one that executes a kernel it cannot vouch for.

---

## 6. machine-id via the U-Boot environment

### 6.1 The problem

The mos root is a read-only squashfs with no initramfs and no `/etc` overlay, so
systemd cannot persist `/etc/machine-id` the normal way. Without persistence
every boot gets a fresh transient ID, which breaks anything keyed on device
identity (journal continuity, D-Bus machine ID, fleet enrolment).

### 6.2 The mechanism

`systemd.machine_id=<id>` is a first-class systemd kernel command line option.
The bookworm PID 1 binary contains the literal `systemd.machine_id` alongside
`set_machine_id` and `machine_id_setup` (`strings /usr/lib/systemd/systemd` on
`debian:bookworm-slim`, systemd `252.39-1~deb12u2`) [V]. It sets the machine ID
for the boot without writing to `/etc`.

**Format: exactly 32 lowercase hexadecimal characters, no dashes.** This is the
`/etc/machine-id` format and the most likely integration bug — a
`uuidgen`-style dashed UUID is 36 characters and is the wrong shape. Generate it
as, e.g.:

```sh
machine_id="$(tr -dc 'a-f0-9' < /proc/sys/kernel/random/uuid | head -c 32)"
```

or equivalently `systemd-id128 new` (which emits the 32-hex form directly).

**Rootfs requirement**: the image must ship an **empty** `/etc/machine-id`
(0 bytes). systemd bind-mounts a writable copy over that file when `/etc` is
read-only; if the file does not exist there is nothing to mount over. [U] — the
exact code path lives in `libsystemd-shared`, which was not disassembled here;
the requirement is stated from documented `machine-id(5)` behaviour. Note this
is a *rootfs build* requirement, not a U-Boot one, and belongs to the root and rootfs work.

### 6.3 U-Boot side

Already written into `boot.cmd` in §5.3; restated in isolation:

```sh
setenv machineid_arg
if test -n "${machine_id}"; then
    setenv machineid_arg "systemd.machine_id=${machine_id}"
fi
setenv bootargs "${rootargs} ${verity_args} ${consoleargs} storagemedia=emmc net.ifnames=0 ${machineid_arg}"
```

The guard matters: appending `systemd.machine_id=` with an empty value would
give systemd an invalid ID and, worse, would make
`ConditionKernelCommandLine=!systemd.machine_id` in §6.4 false forever, so the
first-boot unit would never run and the device would never acquire an identity.
`test -n` on an unset variable is false in hush, so an unset `machine_id`
correctly yields no argument at all.

### 6.4 Linux side (implemented deliberately)

A oneshot unit gated on the option being absent:

```ini
[Unit]
Description=Persist machine-id into the U-Boot environment
ConditionKernelCommandLine=!systemd.machine_id
ConditionPathExists=/etc/fw_env.config
DefaultDependencies=no
After=local-fs.target
Before=sysinit.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/lib/mos/mos-machine-id-persist

[Install]
WantedBy=sysinit.target
```

with the helper generating a 32-hex id and running
`fw_setenv machine_id <id>`. The id takes effect on the **next** boot: this boot
already has a transient one, and nothing rewrites `/etc/machine-id` under it.
That one-boot lag is intentional and acceptable — do not try to close it by
re-execing systemd.

### 6.5 Ordering against RAUC — who owns what

Both RAUC and the machine-id helper write the same redundant env pair through
`fw_setenv`, and `fw_setenv` has no cross-process locking that this design may
rely on [U]. Ownership is therefore partitioned by variable and by time:

- **RAUC owns** `BOOT_ORDER`, `BOOT_A_LEFT`, `BOOT_B_LEFT`. Nothing else writes
  them from Linux.
- **The machine-id helper owns** `machine_id`, writes it **exactly once** in the
  device's lifetime, and is gated by `ConditionKernelCommandLine=!systemd.machine_id`
  so it cannot run again once U-Boot is passing the id.
- **U-Boot owns the counters during boot**, and Linux is not running then, so
  there is no overlap with the `boot.scr` `saveenv`.
- **Ordering constraint**: the machine-id write happens in early `sysinit.target`,
  long before any RAUC install can be triggered (RAUC runs from mosd, after
  `multi-user.target`). A concurrent write is therefore not reachable in normal
  operation. If a future component needs to write the env outside first boot, it
  must serialise against RAUC explicitly — state that requirement then; do not
  add speculative locking now.

### 6.6 Status until the custom U-Boot lands

The unit is **inert on current hardware**: today's U-Boot has no persistent
environment at all (§1.2), so `fw_setenv` has nothing to write to and no
`machine_id` can ever reach the kernel command line. Until the custom U-Boot
ships, **machine-id is per-boot transient**. the machine-id oneshot should ship the unit
anyway — it is condition-gated and harmless — but must not claim machine-id
persistence as working until §8's checklist passes on hardware.

---

## 7. Kernel command line / dm-verity boot contract

All four questions answered against the actual vendor kernel tree
(`armbian/linux-rockchip`, branch `rk-6.1-rkr5.1`, `Makefile` reports 6.1.115) [V].

### 7.1 `CONFIG_DM_INIT=y` is genuinely effective

- `DM_INIT` is `bool` and `depends on BLK_DEV_DM=y`
  (`linux/drivers/md/Kconfig`) [V] — it *cannot* be modular, and it
  cannot be enabled unless device-mapper itself is built in. Both are asserted
  by `boards/common/mos-required.fragment` [V].
- `dm_init_init()` is registered with `late_initcall()`
  (`linux/drivers/md/dm-init.c`) [V]. `late_initcall` runs inside
  `do_basic_setup()`, which completes before `prepare_namespace()` mounts the
  root filesystem — so `/dev/dm-0` exists by the time the kernel looks for
  `root=`. Effective, no initramfs needed.
- `dm-init` only permits a fixed target list, and `verity` is on it
  (`linux/drivers/md/dm-init.c`) [V].

### 7.2 `PARTUUID=` references resolve, and `dm-mod.waitfor=` exists

- `dm_get_dev_t()` tries `lookup_bdev()` first and falls back to
  `name_to_dev_t()` (`linux/drivers/md/dm-table.c`) [V]. At
  `late_initcall` there is no populated `/dev`, so `lookup_bdev()` fails and the
  fallback is what actually runs.
- `name_to_dev_t()` handles `PARTUUID=` (with optional `/PARTNROFF=`),
  `PARTLABEL=`, `/dev/<name>` and `<major>:<minor>`
  (`linux/init/do_mounts.c`) [V], and it is **not** `__init` — it is
  `EXPORT_SYMBOL_GPL`'d (`do_mounts.c`) [V], so calling it from a
  `late_initcall` is legitimate.
  `PARTUUID=` is resolved by `devt_from_partuuid()` walking `block_class`
  (`do_mounts.c`) [V].

  **So A/B-layout's fixed partition GUIDs are directly usable in the verity
  table** — no `/dev/mmcblk0p5` hardcoding, and slot A vs slot B differ only by
  which GUID is named.
- `dm-mod.waitfor=` **exists** on this tree: `static char *waitfor[DM_MAX_WAITFOR]`
  with `module_param_array(waitfor, charp, NULL, 0)`
  (`linux/drivers/md/dm-init.c`) [V], consumed by a
  `while (!dm_get_dev_t(waitfor[i])) msleep(5)` loop before any table is created
  (`dm-init.c`) [V].

  **It is required, not optional.** `dm_init_init()` does call
  `wait_for_device_probe()` first (`dm-init.c`) [V], but eMMC card discovery
  runs from a delayed workqueue that `wait_for_device_probe()` does not cover,
  so without `dm-mod.waitfor=` the verity table can be created before the
  partitions exist and the device-mapper setup fails outright — the no-initramfs
  equivalent of the `rootwait` problem. Always pass
  `dm-mod.waitfor=PARTUUID=<slot rootfs GUID>`.

### 7.3 SHA-256 is built in, and the table shape

- `DM_VERITY` `select`s `CRYPTO` and `CRYPTO_HASH` but **no specific digest**
  (`linux/drivers/md/Kconfig`) [V] — "You'll need to activate the digests
  you're going to use in the cryptoapi configuration".
- The board config already provides them built-in:
  `CONFIG_CRYPTO_SHA256=y` (`boards/cx3576/bsp/kernel/config/kernel-cx3576z.config`),
  `CONFIG_CRYPTO_SHA256_ARM64=y`,
  `CONFIG_CRYPTO_SHA2_ARM64_CE=y` [V]. Nothing is modular.
  No fragment change is needed today; if a future board's defconfig lacks
  `CRYPTO_SHA256=y` the failure is at runtime, not build time, so it is worth
  adding to `mos-required.fragment` when that file is next touched — noted, not
  escalated.

The `dm-mod.create=` value has the form:

```
dm-mod.create="<name>,<uuid>,<minor>,<flags>,<start> <len> verity <ver> <data_dev> <hash_dev> <data_blk> <hash_blk> <n_blocks> <hash_start> <alg> <digest> <salt>"
```

with, for slot A:

- `<name>` = `rootfs`, `<uuid>` empty, `<minor>` `0`, `<flags>` `ro`. (Earlier
  drafts of this section said `mos`. The shipped generator
  (`rootfs/build.sh`) emits `rootfs`, and that is the authority. Nothing
  depends on the choice: the boot path uses `root=/dev/dm-0`, never
  `/dev/mapper/<name>`, so the name is only what shows up in `dmsetup` output.)
- `<data_dev>` = `<hash_dev>` = `PARTUUID=5AC35760-0002-4000-8000-000000000005`
  (hash tree appended to the same partition)
- `<alg>` = `sha256`, `<salt>` = the A/B-layout pinned salt
  `0000000000000000000000000000000000000000000000000000000000000001`
- `<digest>`, `<n_blocks>`, `<hash_start>` from `veritysetup format` output

and `PARTUUID=...0006` for slot B. This whole string is what the assembler puts
into each slot's `mos-verity-<slot>.env` as `verity_args=` (§5.3, §5.5), together with
`dm-mod.waitfor=PARTUUID=<same GUID>`.

Root device: **`root=/dev/dm-0`**, not `/dev/mapper/rootfs` — there is no udev at
root-mount time, and `devt_from_devname()` resolves `dm-0` through
`blk_lookup_devt()` (`linux/init/do_mounts.c`) [V]. Add
`rootfstype=squashfs ro rootwait`.

### 7.4 What U-Boot must NOT do to the command line

1. **Do not mangle the quoting.** The verity table contains spaces, so
   `dm-mod.create="..."` must reach `/proc/cmdline` with its double quotes
   intact — the kernel's own parser is what strips them. Anything that
   re-tokenises `bootargs` on whitespace breaks this. Concretely: keep the value
   inside one env variable (`verity_args`) end to end, and only ever expand it
   inside double quotes, as §5.3 does.
2. **Do not truncate.** The full `bootargs` for a slot is roughly 400–500
   characters. U-Boot's env has room (64 KiB per copy), and arm64
   `COMMAND_LINE_SIZE` is 2048, so there is headroom — but any board hook that
   copies `bootargs` through a fixed-size stack buffer will silently cut the
   digest in half, producing a verity device that fails to open with no obvious
   cause. Do not add one.
3. **Do not let U-Boot append its own `root=`.** Some distro/bootstd paths set
   `root=` from `distro_rootpart`; two `root=` arguments means last-one-wins and
   the verity device is bypassed. `boot.cmd` sets `bootargs` wholesale, so
   nothing must append to it afterwards.
4. **Do not rely on `${bootargs}` surviving `saveenv`.** `boot.cmd` builds
   `bootargs` *after* the `saveenv` in §4.2 precisely so that the per-boot
   command line is never written to the persistent environment. Keep that
   ordering; a persisted `bootargs` would pin one slot's verity digest forever.
5. [U] Whether `env import -t` preserves a value containing double quotes
   verbatim is not verifiable without hardware. This is on the bring-up
   checklist as an explicit step (§8.6) because it is the single most likely
   failure of this design.

### 7.5 Cross-check with the read-only-root work

the read-only-root work is answering §7.1–§7.3 in parallel for `docs/design/ro-root.md`. The
findings above are all sourced to specific lines in the 6.1.115 tree. If
the read-only-root work reports anything different — in particular about `PARTUUID=` support or
`dm-mod.waitfor=` availability — that disagreement must be resolved explicitly
rather than by picking one document; it is flagged in the completion report.

---

## 8. Acceptance / bring-up checklist

### 8.0 Before anything: a board flashed with an older image needs a maskrom re-flash

**Any board flashed with an image built before 2026-08-19 has already lost its
bootloader.** It must be re-flashed **in maskrom**, which rewrites the idbloader
at LBA 64. Writing a new image over eMMC from the running system does **not**
recover it.

The cause, because it generalises and is worth understanding before it is
rediscovered on another SoC:

> `systemd-repart` **discards every region of the disk that no GPT partition
> entry covers**, and it does so on the first boot, while growing the last
> partition. The Rockchip idbloader lives at raw LBA 64, which was outside every
> partition in both image pipelines. The first-boot growth run therefore TRIMmed
> it away: the device booted once and came up in maskrom on the next power-on.

Reproduced on a real image on a loop device before the fix — LBA 64 went from
`524b4e53` (`RKNS`) to `00000000`, with repart's own log line
`Successfully discarded gap at beginning of disk.`

**This is not Rockchip-specific.** It applies to any SoC that boots from a raw
offset rather than from a partition. The general rule: *if the boot ROM reads
from a fixed sector, that sector must be inside a GPT partition entry, or
first-boot growth will eventually eat it.*

**The fix is structural, not a flag.** A `--discard=no` drop-in on the repart
unit would suppress the symptom; instead the loader area is now a real GPT
partition (`loader`, p1, LBA 64, 32704 sectors, type
`8DA63339-0007-60C0-C436-083AC8230908`). First-boot TRIM stays enabled and the
final state carries **no `--discard=no` anywhere** — protection comes from the
partition entry existing. `tests/repart-loader-test.sh` proves both directions with
a real `systemd-repart` on a real image: the image as built keeps LBA 64, and the
same image with only that one GPT entry deleted loses it.

**The geometry was revised BEFORE any fielded flash**, which is the only reason
this was cheap. There is no fielded fleet and images are flashed whole-disk, so
changing the layout cost nothing today and would have been expensive later.

Every partition after the loader shifted up by one (uenv-a is p2, … DATA is p11).
**Partition GUIDs did not move** — the identity digits are allocated in the order
partitions were added and frozen once allocated, which is precisely why the
dm-verity cmdline, `/etc/fstab`, `/etc/fw_env.config` and the RAUC slot devices
are pinned to PARTUUIDs. `ENV_OFFSET` / `ENV_OFFSET_REDUND` (`0x1000000` /
`0x1100000`) are unchanged, because uenv-a/uenv-b keep their start sectors.

Boards flashed from 2026-08-19 onwards are unaffected.

### 8.1 Checklist

Run in order on the custom U-Boot. Each step is independently observable.

1. **Env is persistent.** At the U-Boot prompt: `setenv mos_probe 1; saveenv;
   reset`. After reset, `printenv mos_probe` must print `1`. Failure here means
   `CONFIG_ENV_IS_IN_MMC` did not take effect (check for
   `Saving Environment to nowhere` on the console).
2. **Env is at the pinned offsets.** From U-Boot:
   `mmc read ${loadaddr} 0x8000 0x8` (sector 0x8000 = 16 MiB) and confirm the
   buffer is not all-zero after a `saveenv`; repeat at sector `0x8800`
   (17 MiB) for the redundant copy. Both must show data.
3. **Redundancy survives a power cut.** Loop `saveenv` in U-Boot while cutting
   power at random points, at least 50 iterations. After every cut, U-Boot must
   come up with a valid environment (no `*** Warning - bad CRC, using default
   environment`). This is the direct test of the "mid-env-write"
   row.
4. **Linux ↔ U-Boot round trip.** From Linux: `fw_printenv mos_probe` must print
   the value set in step 1. Then `fw_setenv mos_probe 2`, reboot, and
   `printenv mos_probe` in U-Boot must print `2`. A mismatch here almost always
   means the redundancy setting differs between the two sides (§3.3).
5. **`BOOT_ORDER` selection.** `fw_setenv BOOT_ORDER "B A"`, reboot; the console
   must report `mos: booting slot B`, and `/proc/cmdline` must reference
   PARTUUID `...0006`. Set it back to `"A B"` and confirm slot A.
6. **Command line integrity.** `cat /proc/cmdline` must show the complete
   `dm-mod.create="..."` string with both quotes present and the digest at full
   length, plus `dm-mod.waitfor=`. `dmsetup table rootfs` must show a `verity`
   target. `findmnt /` must show `/dev/dm-0` with `squashfs` and `ro`.
7. **Counter exhaustion falls through.** `fw_setenv BOOT_A_LEFT 1`, then
   deliberately corrupt slot A's kernel (or point slot A's `mos-verity-a.env`
   at a wrong digest) and reboot twice. Boot 1 tries A and fails; boot 2 must report
   `mos: booting slot B`. Then confirm `fw_printenv BOOT_A_LEFT` reads `0`.
8. **Refill on total exhaustion.** `fw_setenv BOOT_A_LEFT 0; fw_setenv
   BOOT_B_LEFT 0`, reboot. U-Boot must print the reset message, refill both
   counters, and reboot into slot A rather than hanging.
9. **RAUC agrees.** `rauc status` must report the running slot; `rauc status
   mark-good` must set the running slot's counter back to the configured
   `boot-attempts` (check with `fw_printenv`).
10. **machine-id reaches userspace.** On a device with no `machine_id` set:
    boot, confirm the oneshot ran and `fw_printenv machine_id` returns 32 hex
    chars, reboot, then confirm `/proc/cmdline` contains
    `systemd.machine_id=<same value>` and `cat /etc/machine-id` matches it.
    Reboot once more and confirm it is unchanged.
11. **Recovery still works.** Hold the recovery button at power-on; the board
    must enter rockusb and be visible to `rkdeveloptool ld` as a loader-mode
    device. This is the regression test for the two customisations of §2.

---

## 9. Open questions and risks

Ordered by how badly each could sink the approach.

1. **DDR/BL31 blob provenance (highest).** Mainline has no open TPL for RK3576;
   the boot chain depends on `rkbin` binaries whose versions are pinned by a
   comment describing empirical breakage (`boards/cx3576/bsp/uboot/Dockerfile`)
   [V]. A custom tree must pin `UBOOT_REF`, `DDR_BLOB` and `BL31_BLOB` together
   and treat any bump as a hardware-test-gated change. If a mainline SPL change
   ever breaks compatibility with DDR `v1.12`, the board stops booting entirely
   and there is no software workaround.
2. **The generic DT is not a board DT.** [U] The build uses
   `rk3576-generic.dts` plus a Dockerfile-appended saradc/adc-keys node. Nothing
   in it is specific to CX3576-Z. Anything that depends on board-specific
   pinmux, regulators or eMMC signal voltage is untested by construction. A
   proper `rk3576-cx3576z.dts` for U-Boot is the clean fix; adopting one is a
   separate task.
3. **Carrying the rockusb loader-mode patch forward.** Patch 0001 is
   `Upstream-Status: Pending` [V] and touches
   `arch/arm/mach-rockchip/board.c`, a file that moves. Every U-Boot rebase must
   re-apply it, and losing it silently degrades recovery from "works" to "host
   tools see a maskrom device and speak a protocol we do not implement" — which
   looks like a hardware fault, not a regression.
4. **Boot ROM signing expectations.** [U] Nothing in the current build signs
   SPL or the FIT, and the board evidently boots unsigned images. Whether this
   part is fused for secure boot, and what that would require of a custom
   U-Boot, is unknown from this environment. the trust model
   assumes signature verification of `boot.fit` in U-Boot; that is **not**
   implemented today and is not in M4 scope. Flagging it so it is not assumed.
5. **Hush fragility around the verity command line** (§7.4 item 5). Mitigation
   is already designed: fall back to `CONFIG_BOOTMETH_RAUC=y` (§5.2), which
   removes the arithmetic from the script but not the bootargs construction.
6. **`fw_setenv` concurrency** (§6.5). Currently unreachable by construction,
   but the design has no lock. If a future component writes the env at
   arbitrary times, revisit before shipping it.
7. **Counter radix** (§4.1). Contained by keeping `boot-attempts` ≤ 9, but it is
   an invisible constraint — it must be asserted by the `system.conf` renderer,
   not left as a comment.

---

## 10. Requirements summary (the escalation)

> **Status update — items 1-3 are RESOLVED.** The user landed a second U-Boot
> variant as commit `8b24f9d` ("board(cx3576): add uboot-mos A/B variant
> alongside the debug build"). `make -C boards/cx3576/bsp uboot-mos` builds into
> `_out/boards/cx3576/uboot-mos/` and implements this contract: the redundant
> environment pair at `0x1000000` / `0x1100000`, `setexpr` / `source` /
> `importenv` / `fs_generic` / `fat` / `booti` / `part`, `LEGACY_IMAGE_FORMAT`,
> `HUSH_PARSER`, `bootmeth order` pinned to `script`, and the rockusb rescue
> tail preserved. The analysis below is kept as written, because it is the
> reasoning the variant was built against and the record of why each item is
> required.
>
> The existing `make -C boards/cx3576/bsp uboot` debug variant is unchanged and pairs
> with the **v1** image. The two are not interchangeable in either direction and
> neither mistake announces itself: `uboot-mos` on a v1 image corrupts the boot
> FAT partition on the first `saveenv` (v1's boot partition starts at 16 MiB,
> exactly the copy-A offset), and the debug variant on a mos image has no
> persistent environment, so it boots, looks healthy, and silently never runs
> the A/B handshake. `build/src/mkimage-cx3576.ts` asserts both directions.
>
> Items 4-8 were requirements on the build and are satisfied by that variant;
> they remain listed as the contract it must keep satisfying. On-device A/B
> switch and rollback remain the user's hardware acceptance — see §8.

What the custom U-Boot must satisfy, in dependency order. Items 1–3 were the
ones that blocked M4 entirely; all three are resolved by `8b24f9d`.

1. **Persistent redundant environment** at `0x1000000` / `0x1100000`, `0x10000`
   each, eMMC user area, device index 0 — the defconfig fragment in §3.2.
   Without it: no `BOOT_ORDER` persistence, RAUC's `uboot` backend is
   non-functional, machine-id cannot persist. The **debug** variant still has
   `CONFIG_ENV_IS_NOWHERE=y` [V], which is why it must never be paired with a
   mos image. **RESOLVED for `uboot-mos` by `8b24f9d`.**
2. **`CONFIG_CMD_SETEXPR=y`** plus `CMD_SOURCE`, `CMD_IMPORTENV`,
   `CMD_FS_GENERIC`, `CMD_BOOTI`, `LEGACY_IMAGE_FORMAT` (§3.2). Without
   `setexpr` the attempt counter cannot be decremented in a script; the generic
   defconfig disables it [V]. **RESOLVED by `8b24f9d`.**
3. **`boot.scr` must be the only automatically discoverable boot entry** in
   BOOT-A/BOOT-B — no `extlinux/extlinux.conf` in mos boot slots — and `bootcmd`
   should pin `bootmeth order script` (§5.4). Without this, extlinux wins and
   the handshake is silently bypassed in both bootstd and `distro_bootcmd` [V].
   **RESOLVED by `8b24f9d` (`bootmeth order script`) together with
   `build/src/mkimage-cx3576.ts`, which writes no extlinux config into a mos boot slot.**
4. **Preserve the three existing customisations**: DDR `v1.12` + BL31 `v1.24`
   blob pins, the saradc `vdd-microvolts` DT append, and the rockusb loader-mode
   patch (§2). Without them, respectively: no boot, no recovery button, no
   usable rockusb recovery.
5. **Keep `CONFIG_SYS_MMCSD_RAW_MODE_U_BOOT_SECTOR` ≤ `0x7000`** so SPL+U-Boot
   stays clear of `uenv-a` at 16 MiB; `0x4000` is the current value and is fine
   (§1.4).
6. **Use the v2026.07-era symbol names** `CONFIG_ENV_REDUNDANT`,
   `CONFIG_ENV_MMC_DEVICE_INDEX`, `CONFIG_ENV_MMC_EMMC_HW_PARTITION`. The
   `CONFIG_SYS_*` spellings no longer exist and are silently ignored [V].
7. **Keep `ENV_MMC_USE_DT`, `ENV_MMC_USE_SW_PARTITION` and
   `PARTITION_TYPE_GUID` off**, or the env moves to the end of a partition
   instead of the pinned offsets (§3.2) [V].
8. **Keep the rescue paths**: `PREBOOT` recovery-button → rockusb, and the
   `bootcmd` tail entering rockusb on boot failure (§5.2).
9. **`bootargs` must carry `rauc.slot=${bootslot}`** (§5.3). Added after
   `8b24f9d` resolved items 1-3, so it is not covered by that commit: it is a
   requirement on the **boot script**, not on the U-Boot build, and it emerged
   only once the handshake was integrated end to end. rauc identifies its booted
   slot from `rauc.slot=`, the `root=` device, or `realpath(device)`; the mos root
   is `/dev/dm-0`, a device-mapper node that matches no slot's `bootname`, slot
   name or device path, so the other two routes have nothing to work with.
   Verified against rauc 1.8: without it, `rauc status` reports *"Did not find
   booted slot (matching '/dev/dm-0')"*, `mark-good` is never reached, and every
   installed slot rolls back. Shipped in `boards/cx3576/boot.cmd`.

Dependencies this creates on other subtasks, for scheduling:

- **the image assembler** (`build/src/mkimage-cx3576.ts`): generate and install `boot.scr` +
  per-slot `mos-verity-<slot>.env`, drop `extlinux.conf` from mos boot slots,
  zero-fill p1/p2 (§5.5). **Delivered.**
- **the rootfs work** (rootfs): add `libubootenv-tool` to the package allowlist, ship
  `/etc/fw_env.config` from §3.3, ship an empty `/etc/machine-id` (§6.2).
- **the machine-id oneshot**: the machine-id oneshot of §6.4, inert until this U-Boot lands.
- **RAUC `system.conf` renderer**: `bootloader=uboot`, `bootname=A`/`bootname=B`,
  `boot-attempts` in 1–9 (§4.1).
