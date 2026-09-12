# RFCT-926 Adopt per-board `SYS_BOOTM_LEN` derivations

- **status**: closed
- **priority**: P1
- **owner**: section-5-bootm-derivation
- **createdAt**: 2026-08-31 08:40 UTC
- **plan**: PLAN-915

## Description

Implement the owner decision of 2026-08-31: replace the shared
`CONFIG_SYS_BOOTM_LEN >= 0x8000000` rule in the section-5 U-Boot contract with
a reproducible per-board derivation. Every U-Boot-chain board must record its
derived value and arithmetic in its board definition; an unmeasured board must
state that it is pending, name the measurement method and responsible role, and
must not present a legacy configured number as a derived result.

Record the measured s905x5m value `0x4000000`, update its produced-config gate
to assert that value, and preserve the concurrent FIT/FIT_SIGNATURE debt work.
Do not enable FIT, change a boot script, deploy, access hardware, write eMMC or
its boot areas, write `bootloader_a`, or push this repository.

## Acceptance

- `docs/design/boards.md` section 5 contains a deterministic formula, states
  the limit's precise `bootm` scope, and requires a separate RAM-layout proof
  for FIT containers, DTBs and ramdisks.
- The three current board definitions state s905x5m's measured derivation,
  cx3576's explicitly pending derivation and x64's not-applicable result.
- The s905x5m gate checks its exact derived `0x4000000` value and retains all
  concurrent FIT-debt changes without overwrite.
- A built final `.config` is shown to carry `CONFIG_SYS_BOOTM_LEN=0x4000000`.
- The gate output demonstrates both its board-owned refusal behaviour and its
  loud, non-silent FIT tree-debt reporting after the concurrent change lands.

## ActiveForm

Closed as superseded by the current fixed signed-FIT contract.

## Dependencies

- **blocked by**: (none; historical boot-path derivation superseded)
- **blocks**: (none)

## Investigation

- RFCT-919 measured the s905x5m normal command as
  `booti ${loadaddr_kernel} - ${dtb_mem_addr}`: an uncompressed Image and no
  initramfs. `CONFIG_SYS_BOOTM_LEN` therefore does not bound today's direct
  `booti` load.
- For a future FIT invoked through `bootm`, the symbol is the maximum kernel
  copy/decompression output passed to `image_decomp`; it is not a total-RAM
  limit for the FIT container, DTB and ramdisk together.
- s905x5m measurements are: raw Image `0x1ea5a00`, effective ARM64 Image span
  `0x1f60000` (31.375 MiB), and a no-initramfs signed RSA-2048 FIT sample of
  30.727163 MiB. The source-derived current value is 64 MiB.
- cx3576 currently also executes `booti` on Image plus DTB. Its existing
  `0x8000000` configuration has no documented payload/decompression
  measurement, so it cannot become a claimed derived value in this task.
- x64 is UEFI firmware plus GRUB, has no U-Boot configuration and therefore no
  `SYS_BOOTM_LEN` applicability.
- RFCT-924 / PLAN-914 are concurrently extracting the same s905x5m gate to
  report FIT/FIT_SIGNATURE as a tree-wide debt. This task must re-read that
  change before editing the bootm assertion.

## Proposal

Apply this exact section-5 wording:

> The A/B design requires `CONFIG_BOOTCOUNT_LIMIT`, redundant environment
> (`CONFIG_ENV_OFFSET_REDUND`), `CONFIG_FIT` + `CONFIG_FIT_SIGNATURE`, a
> board-derived `CONFIG_SYS_BOOTM_LEN`, the RAUC BOOT_ORDER handshake script,
> and a rescue path (cx3576: recovery-key -> rockusb, boot-failure -> rockusb
> fallback). For every U-Boot-chain board, its `board.env` MUST record the
> configured value, boot command and FIT/`bootm` path, whether an initramfs is
> passed, the measured kernel input size `C`, the maximum uncompressed kernel
> output span `D`, the arithmetic below, and a separate RAM-layout result. A
> board with `pending measurement` is not compliant with this requirement and
> may not use a legacy configured number as its derivation.
>
> Set `K = max(C, D)`, where `C` is the bytes of the selected kernel component
> and `D` is the maximum kernel copy/decompression output span for `bootm`.
> Set `CONFIG_SYS_BOOTM_LEN` to the smallest power-of-two MiB value greater
> than or equal to `2 * K`. This is a 100% kernel-growth allowance; a different
> factor requires an owner-approved, board-recorded exception.
> The FIT container, mutable DTB workspace, ramdisk and their load/relocation
> ranges are deliberately not terms in `K`: they require a separate
> non-overlap and peak-RAM calculation on the board's smallest-RAM target. An
> uncompressed direct `booti` Image is not constrained by this symbol; a
> compressed direct `booti` path has its own compression-output bound and must
> record that independently.

For s905x5m, record `K = max(0x1ea5a00, 0x1f60000) = 0x1f60000`,
`2 * K = 0x3ec0000`, and `round_up_power_of_two_mib(0x3ec0000) = 0x4000000`.
This leaves `0x20a0000` (32.625 MiB, about 104%) beyond the effective runtime
Image. The signed RSA-2048 FIT measurement is evidence about the separate
container layout, not an added term in this formula.

For cx3576, record `pending measurement`, identify the cx3576 board owner as
the responsible role, and state that the owner has not nominated an individual
for that measurement. That owner must measure the final kernel component and
decompressed span from the selected FIT/`bootm` design, apply the formula,
validate the separate layout on the smallest-RAM target, and only then set the
board value and its gate. For x64, record `not applicable`: its UEFI/GRUB chain
has no U-Boot or `CONFIG_SYS_BOOTM_LEN`; a future U-Boot port must create its
own record before it can claim section-5 compliance.

## Risks

- Treating the signed FIT byte count, DTB or ramdisk as part of the
  `SYS_BOOTM_LEN` formula would misstate U-Boot's limit and conceal a distinct
  RAM-layout obligation.
- Naming a cx3576 number from its current configuration would recreate the
  unsupported shared-floor inference. Its responsible individual is an owner
  choice not made by this decision, so the record must leave that assignment
  explicit and pending.
- The concurrently edited gate may move the check out of the Dockerfile. The
  implementation must change the resulting checker rather than restore the old
  inline block.

## Scope

- `docs/design/boards.md` and the three current board definitions.
- The s905x5m final-config gate after the FIT-debt change is present.
- This task and PLAN-915 records.
- No change to cx3576's current U-Boot configuration without its measurement.

## Alternatives

- Retain `0x8000000` as a shared floor: rejected by the owner because the
  historical Talos initramfs evidence is not s905x5m evidence.
- Lower the shared floor to `0x4000000`: rejected because s905x5m data cannot
  speak for cx3576.
- Say only that each board should size the value appropriately: rejected
  because it does not yield one reproducible value from one measurement set.

## Implementation

- Replaced the shared section-5 floor with the approved deterministic
  derivation and three-board status table.
- Recorded s905x5m's measured arithmetic in its board definition, cx3576's
  pending accountable measurement and x64's UEFI/GRUB non-applicability.
- Changed only the s905x5m bootm branch of the shared gate. It now requires
  exactly `0x4000000` and labels the expected value as derived for s905x5m.
  The FIT branch remains owned by RFCT-924.

## Verification

- Direct parser/linter execution over the three definitions passed 41/41
  checks. The standard wrapper's frozen Bun install is locally blocked by its
  unsupported `bun.lock` version.
- An isolated, non-Git snapshot on `192.168.27.200` used tracked source
  `28ca23f8b7c52fc0d612b8ec415efb7044fad6f3` plus only the current s905x5m
  U-Boot directory overlay. Its `--target build` completed successfully and
  the final config contained `CONFIG_SYS_BOOTM_LEN=0x4000000`,
  `CONFIG_BOOTCOUNT_LIMIT=y`, `CONFIG_BOOTCOUNT_ENV=y`, and
  `CONFIG_CMD_CFGLOAD=y`; FIT remained disabled as expected.
- Before RFCT-924's FIT-debt change, the normal artifact target exited 1 in
  exactly one group: FIT/FIT_SIGNATURE. It printed the derived bootm evidence
  with no bootm error, and its requested output directory was absent. Final
  integration verification must rerun this path after RFCT-924 lands to prove
  the loud non-blocking FIT-debt result.

## Notes

- The owner decision in the request is the explicit approval to implement this
  proposal. The separately unassigned cx3576 measurement owner remains an
  intentional escalation, not an implicit assignment.
- Implemented the shared contract and all three board-definition records.
  Direct parser/linter execution passed 41/41 checks. The standard lint wrapper
  could not run locally because its frozen install rejects this checkout's
  `bun.lock` version; that is an environment/tool-version failure, not a
  skipped board assertion.
- Before changing the shared Dockerfile, its working-tree diff was empty. Only
  the bootm branch was changed to require exactly `0x4000000`; the concurrent
  FIT debt change remains untouched and final gate verification waits for it.

- close: Superseded by the current fixed signed-FIT board contract and current complete-image acceptance.
