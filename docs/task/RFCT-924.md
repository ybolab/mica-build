# RFCT-924 Classify FIT signature as a tree-wide export debt

- **status**: completed
- **priority**: P1
- **owner**: s905x5m-fit-debt-gate
- **createdAt**: 2026-08-31 UTC
- **completedAt**: 2026-08-31 09:06 UTC
- **plan**: PLAN-914

## Description

Apply the owner decision of 2026-08-31 to the s905x5m U-Boot section-5 gate:
keep measuring `CONFIG_FIT` and `CONFIG_FIT_SIGNATURE`, report their absence
as an unmistakable tree-wide security debt, and stop treating that debt as an
artifact-export blocker for this board. `CONFIG_BOOTCOUNT_LIMIT`, redundant
environment support, and `CONFIG_SYS_BOOTM_LEN` remain board-owned gates;
`CONFIG_SYS_BOOTM_LEN` must remain blocking until its separate owner decision
lands.

Create a separate mainline tracking record for the FIT verified-boot design
and cross-reference it from `docs/design/boards.md` section 5. Do not enable
FIT, create signing keys, alter any board configuration, deploy, write eMMC or
its boot areas, write `bootloader_a`, or push this repository.

## Acceptance

- The produced-config gate still checks `CONFIG_FIT` and
  `CONFIG_FIT_SIGNATURE`, but a missing pair does not increment its
  artifact-export failure count.
- A missing FIT signature emits a prominent message that s905x5m is not
  verifying its kernel and that its U-Boot chain of trust is incomplete.
- A too-small `CONFIG_SYS_BOOTM_LEN` still refuses artifact export.
- A focused fixture proves both the blocking `SYS_BOOTM_LEN` case and a
  successful board-owned gate with the FIT debt still visible.
- The deferred tree-wide design is tracked separately and linked from the
  section-5 contract without changing the contract's requirement text.

## ActiveForm

Separating the tree-wide FIT signing debt from board-owned export blockers.

## Dependencies

- **blocked by**: (none; explicit implementation authorization received 2026-08-31)
- **blocks**: artifact export once the separate `SYS_BOOTM_LEN` decision lands

## Notes

- Claimed for investigation and proposal on 2026-08-31. No implementation is
  authorized until PLAN-914 receives explicit approval.
- The existing diagnostic build showed the exact currently produced state:
  `CONFIG_FIT` disabled, `CONFIG_FIT_SIGNATURE` absent, and
  `CONFIG_SYS_BOOTM_LEN=0x4000000`.
- RFCT-925 is the durable mainline debt record; it is intentionally left open
  when this classification change completes.
- The 2026-08-31 review instruction explicitly authorized implementation and
  requires preserving z8j0yomt's concurrent s905x5m-derived bootm assertion.

## Investigation

- `os/boards/s905x5m/bsp/uboot/Dockerfile` currently counts all four
  section-5 groups in one `failures` variable. Its FIT branch reports the
  symbols and then increments that variable, so a shared FIT absence blocks
  the artifact stage exactly like a board-owned gap.
- RFCT-920 closed the bootcount and redundant-MMC-environment groups. Its
  clean produced config retains only the FIT/signature group and the 64 MiB
  `SYS_BOOTM_LEN` group as failures.
- `docs/design/boards.md` section 5 requires FIT plus FIT signature for every
  U-Boot-chain board, while its cx3576 row states that FIT signature is
  configured nowhere in the tree. x64 uses UEFI rather than this chain.
- The current inline Dockerfile gate has no fast fixture seam. Extracting only
  the section-5 checker permits controlled configs to prove both a blocking
  board-owned failure and a loud successful export under the deferred FIT debt.

## Implementation

- Coordination narrowed the implementation to the inline gate: the concurrent
  `SYS_BOOTM_LEN` hunk is preserved while the existing counter is split into
  board-owned export failures and a separate FIT tree-debt state.
- The FIT branch still counts and prints both observed symbols. When either is
  missing, it sets only the tree-debt state and emits the explicit statements
  that the FIT signature is absent or disabled, s905x5m does not verify its
  kernel, and its U-Boot chain of trust is incomplete. The final success text
  says that only board-owned requirements pass while the debt remains.
- Bootcount, redundant environment, and the concurrent exact derived bootm
  assertion each increment the board-owned export-failure count. The terminal
  rejection identifies that count as board-owned before refusing export.
- `docs/design/boards.md` section 5 now links RFCT-925 without changing the
  long-term FIT requirement text. RFCT-925 remains pending for mainline's FIT
  image, signing-key, public-key-DTB, and board-scope decision.

## Verification

- `bash docs/verify-index.sh` passed 48/48 and `git diff --check` passed.
- An isolated non-Git snapshot on `192.168.27.200`, built with the current
  s905x5m Dockerfile, exited 0 and exported `DDR.USB`,
  `u-boot.bin.sd.bin.signed`, and `u-boot.bin.signed`. Its final config had
  `CONFIG_FIT` disabled, no `CONFIG_FIT_SIGNATURE` line, and
  `CONFIG_SYS_BOOTM_LEN=0x4000000`. The output stated that the FIT signature
  was absent or disabled, that s905x5m does not verify its kernel, that the
  U-Boot chain of trust is incomplete, and that tree-wide FIT debt remains.
- A second isolated non-Git snapshot added one temporary Dockerfile layer that
  changed only the already-built final `.config` value to
  `CONFIG_SYS_BOOTM_LEN=0x2000000` before the contract ran. The contract
  printed the same FIT warnings, then rejected the mismatched value with one
  board-owned requirement-group failure and no `out/uboot` directory. The
  temporary mutation was outside this repository and did not change a board
  configuration or artifact.
- Local-diff review found the original debt-path final text could have implied
  full compliance; it was changed to distinguish board-owned success from the
  remaining tree-wide security debt. No high-confidence findings remain.

## Result

FIT/FIT_SIGNATURE remains measured and loudly reported, but it no longer
blocks s905x5m artifact export. Board-owned gaps, including
`CONFIG_SYS_BOOTM_LEN`, still refuse export. No hardware, eMMC, boot area,
`bootloader_a`, deployment, or remote Git push was performed.
