# RFCT-006 cx3576 board bring-up (B1: BSP readiness)

- **status**: completed
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-17 06:00
- **claimedAt**: 2026-08-17 06:00
- **completedAt**: -

## Description

Execute PLAN-009: bring the `board/cx3576` BSP layer to a state whose artifacts the Talos
image phase (B2) can consume.

Scope:

1. Part A: add `kernel/config/mos-required.fragment` (dm-verity/squashfs/overlayfs options
   `=y`), merge it into `.config` in `kernel/Dockerfile` before `olddefconfig`, and fail
   the build if any option is missing.
2. Part B: set `CONFIG_FIT=y` and `CONFIG_SYS_BOOTM_LEN=0x8000000` in `uboot/Dockerfile`
   with build-failing assertions (bring-up scope only).
3. Part C: extend `board.yaml` with the `display` section (hdmi, rotation 0) and the
   `artifacts` section documenting the B2 consumption contract.
4. Part D: replace hardcoded demo WiFi credentials in `rootfs/alpine-rom/Dockerfile` with
   `WIFI_SSID`/`WIFI_PSK` build args (empty default writes no network block).
5. Final build verification: kernel and U-Boot builds pass with all assertions; artifacts
   present under `board/cx3576/out/`.

Out of scope: talos/ repo (B2), docs/design/** bilingual set, A/B-slot or signature work,
flashing hardware.

## ActiveForm

Bringing board/cx3576 BSP to Talos-consumable state (B1).

## Dependencies

- **blocked by**: (none)
- **blocks**: B2 Talos image assembly
