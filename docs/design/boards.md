# Design: Board Support (BSP) Contract

> English | [中文](boards.zh.md)
>
> How a board joins mos: what it must produce, what the OS build consumes, and
> the hard assertions between them. Reference implementation: `os/boards/cx3576/bsp`.

## 1. Separation rule

BSP layers produce **artifacts**; the OS build consumes **artifacts**. Neither
side reaches into the other's build. Yocto is permitted only inside a board
directory (when a vendor ships BSP solely as Yocto layers, run
`bitbake virtual/kernel virtual/bootloader` and export the deploy dir) — never
in the OS build chain.

## 2. Board directory layout

```
board/<name>/
├── board.yaml          # descriptive board metadata (arch, console, storage,
│                       #   cmdline extras, boot chain, features)
├── Makefile            # make uboot | kernel | rootfs | image (buildkit only)
├── uboot/Dockerfile    # -> bootloader binary (e.g. u-boot-rockchip.bin)
├── kernel/             # -> Image, modules.tar, dtb
│   ├── Dockerfile
│   ├── config/         # kernel config baseline (vendor ikconfig + mos additions)
│   ├── dts/            # in-tree board dts (open-source route, no overlay stacking)
│   └── patches/        # ordered *.patch series
└── rootfs/             # optional demo/smoke-test rootfs (NOT the product)
```

Boards with an upstream-supported boot chain (e.g. `os/boards/x64`, UEFI) carry
only `board.yaml` + README — firmware boots them, and the kernel is Debian's
own `linux-image-amd64`, installed by the rootfs stage chain.

## 3. Artifact interface into the OS image

| Artifact | Producer | Consumer |
|---|---|---|
| `Image` + `modules.tar` + `*.dtb` | `board/<n>/kernel` | `os/rootfs/build-v2.sh` stages `MODULES_TAR`; `os/rootfs/stages/40-board.Dockerfile` extracts it into `/usr/lib/modules`; `os/build/src/mkimage-v2.ts` writes `Image` and the dtb into each boot slot |
| bootloader binary | `board/<n>/uboot` | `os/build/src/mkimage-v2.ts`: raw write at the board's `UBOOT_SEEK_SECTOR` |
| `board.yaml` | board dir | nothing reads it; it records what the board's Makefile produces. Kernel args, console and every partition offset are `os/boards/<n>/board.env` |
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
- Shared baseline fragment: maintained once for all boards at
  `os/boards/common/mos-required.fragment` (buildx named context `mos-common`),
  merged before olddefconfig — the source of truth for the list above plus the
  pseudo filesystems and security options it also asserts (hugetlbfs, tracing,
  SELinux + LSM boot list). Board-specific requirements stay in the board's own
  config baseline.

## 5. U-Boot requirements (uboot-chain boards)

Per PLAN-006 Part E: `CONFIG_BOOTCOUNT_LIMIT`, redundant env
(`CONFIG_ENV_OFFSET_REDUND`), `CONFIG_FIT` + `CONFIG_FIT_SIGNATURE`,
`CONFIG_SYS_BOOTM_LEN ≥ 0x8000000`, RAUC BOOT_ORDER handshake script, and a
rescue path (cx3576: recovery-key → rockusb, boot-failure → rockusb fallback).
The boot script and RAUC `system.conf` are generated from one source
(`GenerateAssets`) to prevent drift.

## 6. Kernel support policy

The boot path sets the floor. The root is a squashfs carrying its own dm-verity
hash tree, opened straight from the kernel command line by `dm-init` with no
initramfs in front of it, and the userland above it is Debian trixie under
systemd. A board kernel therefore has to carry the §4 assertion set built in —
`=y`, never `=m`, because nothing can load a module before the root is there.
Board intake tiers:

| Tier | Kernel | Support |
|---|---|---|
| 1 | >= 5.10 LTS | Full support (mainstream vendor BSPs: RK 5.10/6.1, NXP 5.15/6.6, TI 6.1) |
| 2 | 5.4 | Per-board evaluation; small shims expected, no structural work |
| — | 4.x | **Out of support.** Options in order: (a) uplift the vendor kernel, or mainline the SoC; (b) a separate profile for that board on a smaller base with the mos services as containers, which gives up the signed A/B verity root the rest of this document assumes |

## 7. Adding a new board — checklist

1. Create `board/<name>/` with board.yaml (+ kernel/uboot dirs if not UEFI).
2. Kernel: vendor tree + mos-required fragment merged; assertions green.
3. U-Boot: §5 config; verified boot keys enrolled.
4. Smoke path first — a stock or vendor image — to validate hardware bring-up
   before the full image is worth building.
5. Rootfs from the stage chain (`os/rootfs/stages/`, ordered and driven by
   `os/build/src/stages-cli.ts`), image assembled by `os/build/`, green against
   `bash os/verify/run.sh --verify`, booting to apid healthz on hardware.
6. Power-cut rig run before the board is called supported.

## 8. Current boards

| Board | Arch | Boot chain | Status |
|---|---|---|---|
| cx3576 (CX3576-Z, RK3576) | arm64 | U-Boot @ eMMC sector 64, FIT | BSP artifacts build. Gaps tracked in the board README: verity kconfig, FIT signing, RAUC env handshake |
| x64 (generic UEFI) | amd64 | UEFI firmware -> GRUB | QEMU/CI baseline |
