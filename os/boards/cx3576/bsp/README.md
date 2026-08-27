# board — CX3576-Z (Rockchip RK3576) BSP

Board support artifacts for the Talos-based appliance ROM. Each component is an
independent buildkit Dockerfile producing finished artifacts; nothing here
builds or modifies the OS rootfs (see the talos repo).

## Layout

- `uboot/` — mainline U-Boot v2026.07 + rkbin blobs -> `u-boot-rockchip.bin` (eMMC sector 64)
- `kernel/` — armbian rk-6.1-rkr5.1 (6.1.115): config baseline, in-tree dts, patches -> `Image`, `modules.tar`, `rk3576-src.dtb`
- `rootfs/` — Alpine demo rootfs (overlay under `alpine/rootfs/`, installed onto `/`)
  + WiFi firmware blobs (AP6275S / AIC8800 dual SKU); the demo image itself
  ships only the verified AIC8800D80 U02 blobs
- `init/` — board hardware facts consumed by the `os/boards/cx3576/hwinit`
  systemd units
- `Dockerfile.alpine` — assembles the flashable Alpine debug/demo disk image (extlinux boot)

The Alpine image is the board smoke-test path; the production ROM consumes
`kernel/` + `uboot/` artifacts from the talos repo build (PLAN-006 in the talos
repo docs).

## Known gaps (tracked in talos repo docs/plan)

- Kernel config lacks CONFIG_DM_INIT / CONFIG_DM_VERITY / CONFIG_BLK_DEV_DM (required for verity boot).
- U-Boot: no FIT signature, no RAUC BOOT_ORDER handshake, no redundant env yet.
- `make uboot/kernel/image` targets referenced in Dockerfile comments have no Makefile yet.
