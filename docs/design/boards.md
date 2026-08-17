# Design: Board Support (BSP) Contract

> English | [中文](boards.zh.md)
>
> How a board joins mos: what it must produce, what the OS build consumes, and
> the hard assertions between them. Reference implementation: `board/cx3576`.

## 1. Separation rule

BSP layers produce **artifacts**; the OS build consumes **artifacts**. Neither
side reaches into the other's build. Yocto is permitted only inside a board
directory (when a vendor ships BSP solely as Yocto layers, run
`bitbake virtual/kernel virtual/bootloader` and export the deploy dir) — never
in the talos/OS build chain.

## 2. Board directory layout

```
board/<name>/
├── board.yaml          # metadata consumed by image assembly (arch, console,
│                       #   storage, cmdline extras, boot chain, features)
├── Makefile            # make uboot | kernel | rootfs | image (buildkit only)
├── uboot/Dockerfile    # -> bootloader binary (e.g. u-boot-rockchip.bin)
├── kernel/             # -> Image, modules.tar, dtb
│   ├── Dockerfile
│   ├── config/         # kernel config baseline (vendor ikconfig + mos additions)
│   ├── dts/            # in-tree board dts (open-source route, no overlay stacking)
│   └── patches/        # ordered *.patch series
└── rootfs/             # optional demo/smoke-test rootfs (NOT the product)
```

Boards with an upstream-supported boot chain (e.g. `board/x64`, UEFI) carry
only `board.yaml` + README — kernel and bootloader come from the talos build.

## 3. Artifact interface into the OS image

| Artifact | Producer | Consumer |
|---|---|---|
| `Image` + `modules.tar` + `*.dtb` | `board/<n>/kernel` | talos Dockerfile: replaces the `modules-arm64` stage (`ARG BSP_KERNEL_IMAGE`); modules land in `/usr/lib/modules/<ver>`, firmware in `/usr/lib/firmware` |
| bootloader binary | `board/<n>/uboot` | imager overlay `Install` step (raw write at `board.yaml` offset) |
| `board.yaml` | board dir | imager profile / overlay `GetOptions`: kernel args, console, partition offsets |
| firmware blobs | board dir | rootfs firmware injection, trimmed per board |

Modules/kernel version coupling is absolute: the modules tree inside the rootfs
MUST match the BSP kernel release, asserted at image assembly.

## 4. Kernel config assertions (CI gate per board)

Vendor defconfigs never ship these correctly; every board kernel build must
assert (grep on the final .config, fail the build otherwise):

- Boot path: `DM_INIT=y`, `DM_VERITY=y`, `BLK_DEV_DM=y`, `SQUASHFS=y` (+zstd),
  storage controller built-in, `OVERLAY_FS=y` — no-initramfs verity boot
  (PLAN-006 Part D) cannot load modules before root is mounted.
- Runtime: cgroup v2 set, containerd/netfilter prerequisites (the docker set
  already asserted in cx3576's Dockerfile), seccomp.
- Talos baseline fragment: maintained once for all boards at
  `board/common/mos-required.fragment` (buildx named context `mos-common`),
  merged before olddefconfig — the source of truth for the list above plus the
  machined-required pseudo filesystems (hugetlbfs, tracing, SELinux + LSM boot
  list). Board-specific requirements stay in the board's own config baseline.

## 5. U-Boot requirements (uboot-chain boards)

Per PLAN-006 Part E: `CONFIG_BOOTCOUNT_LIMIT`, redundant env
(`CONFIG_ENV_OFFSET_REDUND`), `CONFIG_FIT` + `CONFIG_FIT_SIGNATURE`,
`CONFIG_SYS_BOOTM_LEN ≥ 0x8000000`, RAUC BOOT_ORDER handshake script, and a
rescue path (cx3576: recovery-key → rockusb, boot-failure → rockusb fallback).
The boot script and RAUC `system.conf` are generated from one source
(`GenerateAssets`) to prevent drift.

## 6. Kernel support policy (decision 2026-08-17)

The Talos-based OS core has hard kernel floors (fsopen/fsconfig mount API =
5.2; `dm-mod.create=` verity = 5.1; legacy-overlay fallback shipped for < 6.7).
Board intake tiers:

| Tier | Kernel | Support |
|---|---|---|
| 1 | >= 5.10 LTS | Full support (mainstream vendor BSPs: RK 5.10/6.1, NXP 5.15/6.6, TI 6.1) |
| 2 | 5.4 | Per-board evaluation; small shims expected, no structural work |
| — | 4.x | **Not supported by the Talos core.** Options in order: (a) vendor kernel uplift / mainline the SoC; (b) "mos-lite" profile for that board (Alpine-class base + mos services as containers); (c) if 4.x boards become a primary requirement, that fires the init-strategy Plan B trigger (research/init-strategy.md) |

## 7. Adding a new board — checklist

1. Create `board/<name>/` with board.yaml (+ kernel/uboot dirs if not UEFI).
2. Kernel: vendor tree + mos-required fragment merged; assertions green.
3. U-Boot: §5 config; verified boot keys enrolled.
4. Smoke path first (Alpine or stock image) to validate hardware bring-up
   before the Talos image — this is the role cx3576's Alpine demo played.
5. Talos image consuming the artifacts boots to webd healthz on hardware.
6. Power-cut rig run before the board is called supported.

## 8. Current boards

| Board | Arch | Boot chain | Status |
|---|---|---|---|
| cx3576 (CX3576-Z, RK3576) | arm64 | U-Boot @ eMMC sector 64, FIT | BSP artifacts build; Talos bring-up = next campaign. Gaps tracked in board README: verity kconfig, FIT signing, RAUC env handshake |
| x64 (generic UEFI) | amd64 | upstream Talos (sd-boot/GRUB) | QEMU/CI baseline |
