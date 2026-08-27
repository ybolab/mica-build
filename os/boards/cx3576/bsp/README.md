# bsp — CX3576-Z (Rockchip RK3576)

The board's bootloader and kernel are built here. Each component is an
independent buildkit Dockerfile producing finished artifacts under `out/`;
nothing here builds or modifies the mos rootfs, which `os/rootfs/` owns.

`Makefile` in this directory drives every target. The repo root delegates to it:
`make cx3576-<target>` runs `make -C os/boards/cx3576/bsp <target>`
(`Makefile:318`).

## Layout

- `uboot/` — mainline U-Boot v2026.07 + rkbin blobs -> `u-boot-rockchip.bin` (eMMC sector 64).
  `make uboot` builds the v1/Alpine debug variant into `out/uboot/`; `make uboot-mos`
  builds the A/B variant with the redundant environment and the `boot.scr` contract
  into `out/uboot-mos/`, which is the one the v2 image takes
- `kernel/` — armbian rk-6.1-rkr5.1 (6.1.115): config baseline, in-tree dts, patches -> `Image`, `modules.tar`, `rk3576-src.dtb`.
  The config must satisfy `os/boards/common/mos-required.fragment`
- `rootfs/` — Alpine demo rootfs (overlay under `alpine/rootfs/`, installed onto `/`)
  + WiFi firmware blobs (AP6275S / AIC8800 dual SKU); the demo image itself
  ships only the verified AIC8800D80 U02 blobs
- `init/` — board hardware facts consumed by the `os/boards/cx3576/hwinit`
  systemd units
- `Dockerfile.alpine` — assembles the flashable Alpine debug/demo disk image (extlinux boot)

The Alpine image is the board smoke-test path. The v2 mos image consumes
`out/uboot-mos/` and `out/kernel/` from here, defaulting to this directory and
overridable with `BOARD_DIR` (`os/build/src/bundle-cli.ts:256`).

Upstream provenance and the deliberate deviations from it are recorded in
`docs/design/bsp-cx3576-sync.md`.
