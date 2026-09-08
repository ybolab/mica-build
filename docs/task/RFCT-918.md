# RFCT-918 Measure PLAN-910 section-5 gaps against built U-Boot configs

- **status**: completed
- **priority**: P1
- **owner**: plan-910-section5-measurement
- **createdAt**: 2026-08-31 06:24
- **completedAt**: 2026-08-31 06:32 UTC
- **plan**: PLAN-910 M2 follow-up

## Description

Measure the four PLAN-910 section-5 U-Boot requirement groups against actual
built `.config` files for both mos and `miehq/s905x5m-alpine`. Record the exact
build commands and config provenance, classify each group as a genuine gap, a
migration loss, or a false alarm, and identify the provenance of mos's 128 MiB
`CONFIG_SYS_BOOTM_LEN` floor. This is an investigation only: do not modify the
gate, U-Boot inputs, configuration, artifacts, or hardware.

## ActiveForm

Measured the two produced U-Boot configurations and reconciled PLAN-910 M2.

## Dependencies

- **blocked by**: (none)
- **blocks**: owner-level decisions on section-5 gap closure

## Notes

- The only admissible evidence for the four symbols is a built U-Boot `.config`.
- Heavy builds run on `192.168.27.200`; root filesystem capacity was checked
  before the current Alpine diagnostic build (298 GiB available).
- mos provenance: the preserved M2 diagnostic build ran
  `docker buildx build --target build --load` with
  `os/boards/s905x5m/bsp/uboot/Dockerfile`; it copied
  `/uboot/bl33/v2023/build/.config` from image
  `local/mos-plan034-m2-impl:20260830` to
  `/backup/mos-plan034-m2-impl.pxky2v/uboot-diagnostic/u-boot.config`.
  A `git archive HEAD` comparison confirmed that its full U-Boot input tree is
  identical to the current mos input tree.
- Alpine provenance: an isolated copy of the current
  `/workspace/miehq/s905x5m-alpine/uboot/` build context ran
  `docker buildx build --target build --load -t
  local/plan034-alpine-current-config:20260831 -f uboot/Dockerfile uboot`.
  The measured config was extracted from
  `/uboot/bl33/v2023/build/.config` in image
  `sha256:96abb62ea024aa50d29ebe57e037c8503f780505c37bdbee9d864cbdbf166209`.
  The build exited 0 and did not write either checkout, an artifact export
  directory, or hardware.

## Result

Both built configs are 50,016 bytes with SHA-256
`27c8f575638d456d913affb7a6864fc3222f8d8d05ba7813246f4ed70411a1b4` and are
byte-identical. `CONFIG_CMD_CFGLOAD=y` occurs once in each, so the positive
control validates the search.

| section-5 group | mos built `.config` | Alpine built `.config` | classification |
|---|---|---|---|
| `CONFIG_BOOTCOUNT_LIMIT=y` | `# CONFIG_BOOTCOUNT_LIMIT is not set` | same | genuine gap |
| redundant environment / `CONFIG_ENV_OFFSET_REDUND` | absent | absent | genuine gap |
| `CONFIG_FIT=y` + `CONFIG_FIT_SIGNATURE=y` | FIT disabled; signature absent | same | genuine gap |
| `CONFIG_SYS_BOOTM_LEN >= 0x8000000` | `0x4000000` (64 MiB) | `0x4000000` (64 MiB) | genuine numeric gap; not a migration loss |

There are no migration losses and no false alarms. In particular, the
source-config hypothesis proposing three enabled Alpine values is not borne out
by Alpine's built config; mos did not uniquely drop them during configuration.

The 128 MiB floor predates PLAN-910. Historical PLAN-005 Part E gives its
rationale: a Talos initramfs was 100 MiB or larger and the 8 MiB default failed
with `Image too large`. PLAN-005 also records that `CONFIG_SYS_BOOTM_LEN`, RAM
headroom, and initramfs decompression peak vary by board and require validation
on the smallest-RAM target. PLAN-910 contains no s905x5m-specific measurement
that independently establishes 128 MiB; retaining, lowering, or otherwise
redefining that floor is an owner-level decision outside this investigation.
