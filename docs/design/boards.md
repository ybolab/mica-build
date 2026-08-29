# Design: Board Support (BSP) Contract

> English | [中文](../zh/design/boards.md)
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

A board is a directory under `os/boards/`. `board.env` is the definition and the
only member every board has; the rest appear when the board needs them.

```
os/boards/<name>/
├── board.env          # partition layout, MOS_ARCH, console and cmdline extras,
│                      #   RAUC backend, firmware / radio / hwinit lists
├── overlay/           # files this board adds to the image root
├── boot.cmd           # U-Boot boot script source      (uboot-chain boards)
├── grub.cfg           # ESP GRUB configuration         (UEFI boards)
├── hwinit/            # the board's systemd hardware-init units
└── bsp/               # only where the board builds its own boot chain
    ├── Makefile       # make uboot | uboot-mos | kernel | rootfs | image
    ├── uboot/Dockerfile    # -> bootloader binary (u-boot-rockchip.bin)
    ├── kernel/             # -> Image, modules.tar, *.dtb
    │   ├── Dockerfile
    │   ├── config/         # kernel config baseline (vendor ikconfig + mos additions)
    │   ├── dts/            # in-tree board dts (open-source route, no overlay stacking)
    │   └── patches/        # ordered *.patch series
    ├── init/               # board hardware facts the hwinit units read
    └── rootfs/             # firmware drop + demo/smoke-test rootfs (NOT the product)
```

Boards with an upstream-supported boot chain (`os/boards/x64`, UEFI) have no
`bsp/` at all — board.env, grub.cfg, an overlay, and nothing that compiles a
bootloader: "a UEFI machine's firmware provides the boot chain, so nothing here
compiles a bootloader, and the kernel is a stock distro one"
(`os/boards/x64/board.env`) — Debian's `linux-image-amd64`, installed by
the rootfs stage chain.

## 3. Artifact interface into the OS image

| Artifact | Producer | Consumer |
|---|---|---|
| `Image` + `modules.tar` + `*.dtb` | `os/boards/<name>/bsp/kernel` | `os/rootfs/build-v2.sh` stages `MODULES_TAR`; `os/rootfs/stages/40-board.Dockerfile` extracts it into `/usr/lib/modules`; `os/build/src/mkimage-v2.ts` writes `Image` and the dtb into each boot slot, requiring each because "it is a BSP artifact" (`os/build/src/mkimage-v2.ts`) |
| bootloader binary | `os/boards/<name>/bsp/uboot` | `os/build/src/mkimage-v2.ts`: raw write at the board's `UBOOT_SEEK_SECTOR`, and it refuses the v1 debug blob — "A v2 image must carry the uboot-mos variant" (`os/build/src/mkimage-v2.ts`) |
| `board.env` | `os/boards/<name>/` | every consumer: both assemblers, the rootfs driver, RAUC's config renderer, os/verify. Read as data, never sourced — "Nothing here ever hands the file to a shell" (`os/verify/src/board-env.ts`) |
| firmware blobs | `os/boards/<name>/bsp/rootfs/firmware` | `os/rootfs/build-v2.sh` stages only what `BOARD_FIRMWARE_FILES` names, because "only the confirmed runtime set may enter a signed root" (`os/rootfs/build-v2.sh`) |

Modules/kernel version coupling is absolute: the modules tree inside the rootfs
MUST match the BSP kernel release, asserted at image assembly.

## 4. Kernel config assertions (CI gate per board)

Vendor defconfigs never ship these correctly; every board kernel build must
assert (grep on the final .config, fail the build otherwise):

- Boot path: `DM_INIT=y`, `DM_VERITY=y`, `BLK_DEV_DM=y`, `SQUASHFS=y` (+zstd),
  storage controller built-in, `OVERLAY_FS=y` — no-initramfs verity boot
 cannot load modules before root is mounted.
- Runtime: cgroup v2 set, containerd/netfilter prerequisites (the docker set
  already asserted in cx3576's Dockerfile), seccomp.
- Shared baseline fragment: maintained once for all boards at
  `os/boards/common/mos-required.fragment` (buildx named context `mos-common`),
  merged before olddefconfig — the source of truth for the list above plus the
  pseudo filesystems and security options it also asserts (hugetlbfs, tracing,
  SELinux + LSM boot list). Board-specific requirements stay in the board's own
  config baseline.

## 5. U-Boot requirements (uboot-chain boards)

The A/B design requires: `CONFIG_BOOTCOUNT_LIMIT`, redundant env
(`CONFIG_ENV_OFFSET_REDUND`), `CONFIG_FIT` + `CONFIG_FIT_SIGNATURE`,
`CONFIG_SYS_BOOTM_LEN ≥ 0x8000000`, RAUC BOOT_ORDER handshake script, and a
rescue path (cx3576: recovery-key → rockusb, boot-failure → rockusb fallback).
The boot script and RAUC `system.conf` are generated from one source — the
board definition, since "the template plus os/boards/cx3576/board.env are the
single source of truth" (`os/pkgs/rauc/render-config.sh`) — to prevent
drift.

## 6. Kernel support policy

The boot path sets the floor. The root is a squashfs carrying its own dm-verity
hash tree, described by one `dm-mod.create=` table on the kernel command line —
"one boot contract, written once by os/rootfs/build-v2.sh, read by the kernel's
dm-init on a board whose kernel has it and by this script on a board whose kernel
does not" (`os/rootfs/initramfs/scripts/mos-verity:5-8`) — above a userland that
is "Debian trixie + systemd" (`os/rootfs/stages/10-base.Dockerfile`). A board
that builds its own kernel therefore has to carry the §4 assertion set built in —
`=y`, never `=m`, because nothing can load a module before the root is there;
x64 builds none and takes Debian's with a verity initramfs. Board intake tiers:

| Tier | Kernel | Support |
|---|---|---|
| 1 | >= 5.10 LTS | Full support (mainstream vendor BSPs: RK 5.10/6.1, NXP 5.15/6.6, TI 6.1) |
| 2 | 5.4 | Per-board evaluation; small shims expected, no structural work |
| — | 4.x | **Out of support.** Options in order: (a) uplift the vendor kernel, or mainline the SoC; (b) a separate profile for that board on a smaller base with the mos services as containers, which gives up the signed A/B verity root the rest of this document assumes |

## 7. Adding a new board — checklist

1. Create `os/boards/<name>/` with a `board.env`, plus a `bsp/` only if the
   board builds its own boot chain. The definition must first pass
   `bash os/verify/run.sh --lint os/boards/<name>/board.env`,
   "the board-definition schema lint" (`os/verify/run.sh`).
2. Kernel: vendor tree + `os/boards/common/mos-required.fragment` merged before
   olddefconfig, every `=y` line then asserted against the built `.config` — a
   "missing mos-required option" (`os/boards/cx3576/bsp/kernel/Dockerfile:100-103`)
   fails the build.
3. U-Boot: §5 config; verified boot keys enrolled. A UEFI board has none of it
   and ships a `grub.cfg` for the ESP instead.
4. Smoke path first — a stock or vendor image — to validate hardware bring-up
   before the full image is worth building.
5. Rootfs from the stage chain (`os/rootfs/stages/`, ordered by
   `os/build/src/stages-cli.ts`, which "decides the order and the tags"
   (`os/build/src/stages-cli.ts`)), image assembled by
   `bash os/build/run.sh --mkimage-v2` or `--mkimage-x64`, green against
   `bash os/verify/run.sh --verify --board <name>`, then apid liveness on
   hardware — `/healthz`, which proves only that the apid process is listening,
   not that mosd or any other service on the board is healthy.
6. Power-cut rig run before the board is called supported.

## 8. Current boards

| Board | Arch | Boot chain | Status |
|---|---|---|---|
| cx3576 (CX3576-Z, RK3576) | arm64 ("MOS_ARCH=arm64", `os/boards/cx3576/board.env`) | U-Boot at eMMC sector 64 -> `boot.scr` -> `booti` on `Image` + `rk3576-src.dtb` (`os/boards/cx3576/boot.cmd`) | BSP builds `uboot-mos` and the kernel; the §4 assertion set is enforced in the kernel build, and the RAUC `BOOT_ORDER` handshake is implemented in `os/boards/cx3576/boot.cmd`. `CONFIG_FIT_SIGNATURE` (§5) is configured nowhere in the tree |
| x64 (generic UEFI) | amd64 ("MOS_ARCH=amd64", `os/boards/x64/board.env`) | UEFI firmware -> GRUB from one static ESP -> the slot's own boot partition (`os/boards/x64/grub.cfg`) | QEMU/CI baseline. No `bsp/`, "by design, not by omission" (`os/boards/x64/board.env`) |
