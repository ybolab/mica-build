# PLAN-915 Adopt per-board `SYS_BOOTM_LEN` derivations

- **status**: implementing
- **createdAt**: 2026-08-31 08:40 UTC
- **approvedAt**: 2026-08-31 08:40 UTC (owner decision)
- **relatedTask**: RFCT-926

## Context

Section 5 currently gives every U-Boot-chain board one 128 MiB
`CONFIG_SYS_BOOTM_LEN` floor. RFCT-919 establishes that s905x5m's current
uncompressed, no-initramfs `booti` path does not consume this limit and that a
future `bootm` FIT kernel has a measured 64 MiB derivation. The old floor came
from a different board's historical Talos initramfs and is not evidence for
s905x5m, cx3576 or x64.

The owner chose per-board derivation. RFCT-924 concurrently changes the same
s905x5m section-5 gate to classify FIT/FIT_SIGNATURE as tree-wide debt; this
plan must retain that change and only replace the old bootm arithmetic.

## Proposal

1. Replace the shared fixed floor with the deterministic `K = max(C, D)` and
   `next_power_of_two_mib(2 * K)` rule, while explicitly separating the
   `bootm` kernel buffer from total FIT/DTB/ramdisk RAM layout.
2. Add board-definition records: measured `0x4000000` arithmetic for s905x5m,
   pending measurement and accountable role for cx3576, and not-applicable
   UEFI/GRUB status for x64.
3. After RFCT-924's gate change lands, require exactly s905x5m's derived
   `0x4000000`, not a 128 MiB shared minimum. Verify the final config and both
   the board-blocking and FIT-debt reporting paths.

## Risks

- cx3576 lacks the measurements needed for a numeric value. The plan records
  the missing owner assignment rather than inventing a number.
- A successful board-owned gate must still print the FIT security debt; the
  focused checker fixture introduced by RFCT-924 is the evidence for that
  non-silent path.

## Scope

`docs/design/boards.md`, the three board definitions, the final s905x5m
section-5 checker, and the RFCT-926/PLAN-915 records only. No hardware,
storage, bootloader, deployment, key or remote-push action is permitted.

## Alternatives

- A shared 64 MiB replacement would carry the same cross-board inference as
  the shared 128 MiB floor.
- A per-board prose instruction without arithmetic would not be repeatable.

## Annotations

- Owner-approved option (c) on 2026-08-31 authorizes implementation.
- RFCT-924 / PLAN-914 own the FIT tree-debt classification and must not be
  overwritten by this work.
- The contract, board records and narrow bootm assertion are implemented;
  integration verification remains pending the concurrently owned FIT change.
- The isolated s905x5m `--target build` on 192.168.27.200 completed with
  `CONFIG_SYS_BOOTM_LEN=0x4000000`; the pre-RFCT-924 artifact gate rejected
  only FIT/FIT_SIGNATURE and exported no output.
