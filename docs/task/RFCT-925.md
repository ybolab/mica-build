# RFCT-925 Decide the tree-wide FIT verified-boot design

- **status**: pending
- **priority**: P1
- **owner**: mainline
- **createdAt**: 2026-08-31 UTC

## Description

Make the mainline decision and implementation plan for FIT verified boot across
the U-Boot-chain boards. This is a tree-wide security design, not a s905x5m
board-intake fix.

The decision must define:

1. how final FIT images are assembled from each board's kernel, DTB, and any
   future ramdisk;
2. signing-key custody, access controls, rotation, revocation, and release
   signing workflow;
3. how the verification public key is generated, reviewed, and incorporated
   into the U-Boot DTB that each board actually boots; and
4. which U-Boot-chain boards the policy binds, currently cx3576 and s905x5m,
   with UEFI-only x64 explicitly outside that set.

Until that decision is implemented, a missing `CONFIG_FIT` /
`CONFIG_FIT_SIGNATURE` pair remains an explicitly reported tree-wide debt.
It does not block s905x5m artifact export under the 2026-08-31 owner decision,
but it means s905x5m is not verifying its kernel and its U-Boot chain of trust
is incomplete.

## ActiveForm

Defining the shared FIT image and verified-boot design for U-Boot boards.

## Dependencies

- **blocked by**: mainline owner decision
- **blocks**: closure of the FIT verified-boot debt for cx3576 and s905x5m

## Notes

- Created by RFCT-924 to preserve the deferred decision beyond the s905x5m
  intake branch.
- This record does not authorize key generation, key-material storage, board
  configuration changes, deployment, or storage writes.
