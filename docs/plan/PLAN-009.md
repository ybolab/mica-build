# PLAN-009 cx3576 board bring-up (B1: BSP readiness)

- **status**: implementing
- **createdAt**: 2026-08-17 06:00
- **approvedAt**: 2026-08-17 06:00
- **completedAt**: -
- **relatedTask**: RFCT-006

## Context

The cx3576 ROM delivery is split into two phases. B1 (this plan) makes the
`board/cx3576` BSP layer produce artifacts the Talos image phase can consume. B2 (Talos
image assembly) is a separate campaign in the talos repo and is out of scope here.

Design authority: `docs/architecture.md`, `docs/design/boards.md`,
`docs/design/display.md` section 5, and `docs/plan/PLAN-006` Parts D/E.

## Proposal

### Part A: Kernel verity readiness

Add `board/cx3576/kernel/config/mos-required.fragment` as the single source of truth for
the kernel options the appliance boot path requires:

- `CONFIG_BLK_DEV_DM=y`, `CONFIG_DM_INIT=y`, `CONFIG_DM_VERITY=y`
- restating `CONFIG_SQUASHFS=y`, `CONFIG_SQUASHFS_ZSTD=y`, `CONFIG_OVERLAY_FS=y`

The fragment is merged into `.config` in `kernel/Dockerfile` before `olddefconfig`, and an
assertion loop fails the build if any option is missing from the final `.config`. Options
must be `=y` (not `=m`) because the no-initramfs dm-verity boot path (PLAN-006 Part D)
cannot load modules.

### Part B: U-Boot FIT readiness (bring-up scope only)

Set `CONFIG_FIT=y` and `CONFIG_SYS_BOOTM_LEN=0x8000000` in `uboot/Dockerfile`, each with a
build-failing assertion. A/B slots, `BOOT_ORDER`, redundant env, and FIT signing are
explicitly deferred to the upgrade campaign (PLAN-005/PLAN-006).

### Part C: board.yaml contract

`board.yaml` gains two sections forming the B2 consumption contract:

- `display`: `output: hdmi`, `rotation: 0` (per `design/display.md` section 5).
- `artifacts`: documents `out/kernel/Image`, `out/kernel/modules.tar`,
  `out/kernel/rk3576-src.dtb`, and `out/uboot/u-boot-rockchip.bin` as the artifacts B2
  consumes.

### Part D: Credential hygiene

Replace the hardcoded demo WiFi credentials in `rootfs/alpine-rom/Dockerfile` with
`WIFI_SSID`/`WIFI_PSK` build args; an empty default means no network block is written.

## Acceptance criteria

1. Kernel build passes with all fragment options asserted `=y` in the final `.config`.
2. U-Boot build passes with the two FIT assertions.
3. Artifacts exist under `board/cx3576/out/`.
4. No WiFi credential literals in tracked files.
5. `board.yaml` parses with the `display` and `artifacts` sections.
