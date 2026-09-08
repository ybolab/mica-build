# RFCT-920 Close PLAN-910 section-5 bootcount and redundant environment gaps

- **status**: completed
- **priority**: P1
- **owner**: plan-910-section5-bootcount-env
- **createdAt**: 2026-08-31 UTC
- **approvedAt**: 2026-08-31 UTC
- **completedAt**: 2026-08-31 07:14 UTC
- **plan**: PLAN-910 M2 section-5 follow-up

## Description

Close exactly two of PLAN-910 section-5 U-Boot requirement groups for
s905x5m: `CONFIG_BOOTCOUNT_LIMIT` with a persistent pre-Linux backend, and
the redundant MMC environment at the approved `uenv-a`/`uenv-b` offsets.
Assert the result from the final built `.config`, retain the positive control,
and prove that the RAUC renderer rejects a deliberate layout-offset mismatch.

`CONFIG_FIT`, `CONFIG_FIT_SIGNATURE`, and `CONFIG_SYS_BOOTM_LEN` are out of
scope. The section-5 gate must continue to block artifact export while those
two remaining groups are open. No hardware, eMMC, boot area, bootloader_a,
deployment, or remote push is authorized.

## ActiveForm

Closed the bootcount and redundant-MMC-environment gaps with source and
produced-config checks.

## Dependencies

- **blocked by**: (none; owner approval recorded 2026-08-31)
- **blocks**: remaining FIT/signature and bootm-length section-5 decisions

## Notes

- RFCT-918 already established that the two baseline built configs are
  byte-identical and that both requested groups are genuine gaps. Do not
  remeasure that baseline.
- The approved environment pair is 64 KiB at `0x07800000` and `0x07c00000`
  on eMMC MMC device 1, hardware partition 0.

## Investigation

The pinned CoreELEC tree exposes the needed older-symbol MMC backend:
`CONFIG_ENV_IS_IN_MMC`, `CONFIG_SYS_REDUNDAND_ENVIRONMENT`,
`CONFIG_ENV_OFFSET`, `CONFIG_ENV_OFFSET_REDUND`, `CONFIG_ENV_SIZE`,
`CONFIG_SYS_MMC_ENV_DEV`, and `CONFIG_SYS_MMC_ENV_PART`. Its MMC environment
implementation reads both copies and alternates writes between the valid and
redundant copy; the selected copy is tracked by the redundant-environment
metadata. The `/config` device-tree properties
`u-boot,mmc-env-partition`, `u-boot,mmc-env-offset`, and
`u-boot,mmc-env-offset-redundant` would override the Kconfig offsets, so their
absence is part of the produced-artifact assertion.

The selected bootcount backend is `CONFIG_BOOTCOUNT_ENV=y`. In this source it
stores `bootcount` through `env_save()` when `upgrade_available=1`; therefore
the counter uses the same persistent, pre-Linux-readable redundant MMC pair.
RAM and generic-address backends do not establish persistence across a power
loss, and the existing Amlogic storage backend addresses only the vendor
environment rather than the approved pair.

`BOOTCOUNT_ENV` is a configuration capability, not the M3 slot-policy
implementation: the `upgrade_available` policy and the RAUC
`BOOT_<slot>_LEFT` script remain outside this exact two-group scope. No runtime
or hardware claim is made here.

## Proposal

1. Replace the defconfig's Amlogic storage environment selection with the MMC
   backend, enable redundant-environment support, and pin the approved pair at
   `0x7800000` / `0x7C00000` with `ENV_SIZE=0x10000`, eMMC device 1 and user
   hardware partition 0.
2. Enable `BOOTCOUNT_LIMIT` with `BOOTCOUNT_ENV`.
3. Strengthen the existing final-`.config` contract gate to assert those exact
   symbols and values plus the built-DT override-property absences, without
   changing either FIT/signature or bootm-length checks.
4. Build the diagnostic target, inspect the produced config, run the normal
   target to confirm exactly the two remaining requirement groups block export,
   and exercise the RAUC renderer with a temporary mismatched offset.

## Risks

- A mismatched MMC device or hardware partition would write the right offsets
  on the wrong storage; the gate therefore asserts both selection values.
- A device-tree override could silently move one copy; the gate must reject
  each known override property.
- The normal artifact target is expected to fail because FIT/signature and the
  unchanged bootm floor remain open. A successful artifact export would be a
  regression, not a pass.

## Scope

- Defconfig, its produced-config gate, and the s905x5m RAUC source-layout
  cross-check, plus this task/plan record.
- No FIT, FIT-signature, `SYS_BOOTM_LEN`, boot script, partition layout,
  hardware, deployment, eMMC write, boot-area write, `bootloader_a`, or remote
  push.

## Alternatives

- Keep `ENV_IS_IN_STORAGE`: rejected because it uses the vendor environment
  and cannot implement the approved redundant absolute-offset pair.
- Use RAM, generic-address, or EXT bootcount storage: rejected because they do
  not provide this board's persistent pre-Linux counter on the redundant pair.
- Enable the two requested top-level symbols without backend assertions:
  rejected because `olddefconfig` can drop or redirect dependent symbols.

## Implementation

- Replaced `CONFIG_ENV_IS_IN_STORAGE` with the standard MMC environment
  backend in `s7d_bm201_defconfig`, enabled redundant-environment support, and
  pinned the pair to `0x7800000` / `0x7C00000`, 64 KiB each, on eMMC device 1
  user hardware partition 0.
- Enabled `CONFIG_BOOTCOUNT_LIMIT=y` with `CONFIG_BOOTCOUNT_ENV=y`.
- Expanded the final-config gate to require the bootcount backend and saveenv,
  every MMC environment selection value, and the absence of all three
  device-tree overrides. It continues to accumulate failures for FIT/signature
  and bootm length without modifying either group.
- Added the s905x5m source-layout check to `render-config.sh`: every bundle
  render now compares the defconfig's MMC backend, redundancy, pair offsets,
  size, device, and hardware partition with the selected `board.env` values.

## Verification

- Arithmetic: 120 MiB = 125829120 = `0x7800000`; 124 MiB = 130023424 =
  `0x7C00000`; 64 KiB = 65536 = `0x10000`.
- A clean isolated diagnostic build on `192.168.27.200` produced final config
  SHA-256 `6aa91b562a35fbfdf0d8acea1038f5d2ffb84e858abb199a8f82bfd564476c4c`.
  Its `CONFIG_CMD_CFGLOAD=y` positive control matched once, and every required
  bootcount/MMC environment line matched once. `CONFIG_ENV_IS_IN_STORAGE=y`
  matched zero times because this Kconfig hides the deselected dependent symbol
  rather than emitting a `not set` line.
- The built DTB was
  `build/arch/arm/dts/amlogic/meson-s7d-bm201.dtb`; none of
  `u-boot,mmc-env-partition`, `u-boot,mmc-env-offset`, or
  `u-boot,mmc-env-offset-redundant` occurred in it.
- The normal artifact target exited 1 with exactly two remaining requirement
  groups: the shared FIT/signature gap and the unchanged 64 MiB bootm limit.
  It exported no artifact directory.
- An isolated renderer fixture rendered and checked the correct s905x5m input,
  then rejected all direct disagreement tests: a defconfig primary offset of
  `0x7800001`, `UENV_A_OFFSET_BYTES=125829121`, and
  `UENV_B_OFFSET_BYTES=130023425` each made `render-config.sh --check` exit 1
  with the exact expected/observed defconfig-line diagnostic.
- The shared checkout's normal renderer check reaches its pre-existing stale
  generated `system.conf` failure after the new check; it was not rewritten
  because it is outside this task. The isolated fixture renders that generated
  file first, so it validates this task's cross-check independently.

## Result

The requested bootcount and redundant-environment groups are closed in both
the source-layout and produced-config checks. FIT/signature and
`CONFIG_SYS_BOOTM_LEN` remain intentionally visible and blocking; no hardware
or deployment action was performed.

## Reopened

The first renderer fixture proved only the board-layout arithmetic. A stricter
fixture changed `CONFIG_ENV_OFFSET` in the copied s905x5m defconfig to
`0x7800001` while retaining the approved board layout; the unmodified
`render-config.sh --check` incorrectly returned success because it did not read
the U-Boot defconfig. The completed source-layout check closes that gap, while
the Dockerfile gate continues to validate the final post-`olddefconfig`
`.config`.
