# 20260912-2043-unify-board-behavior Unify board build, compression and acceptance behavior

- **status**: in_progress
- **priority**: P1
- **owner**: worker/board-unification-20260912-2043
- **createdAt**: 2026-09-12 20:43

## Description

Prepare and, after review, implement shared board policy for zstd compression and
delivery, independent signing roles and lifecycle acceptance. Updates use ECDSA
P-256/SHA-256; boot and verity select RSA or ECDSA from verified platform support.
Preserve legitimate UEFI/FIT differences and SYSTEM 1 GiB. Replace affected trust
identities explicitly, without legacy image or Ed25519 update compatibility.

Acceptance: all four boards use validated common delivery and policy checks;
complete current images pass their applicable lifecycle suite; physical results
require hardware evidence. Missing evidence remains explicitly not run.

## ActiveForm

Preparing the board-unification proposal for review.

## Dependencies

- **blocked by**: (none for planning; implementation awaits plan review)
- **blocks**: (none)

## Notes

- Full-tier PMA task; current request is the written proposal.
- [Plan](../plan/20260912-2043-unify-board-behavior.md) records source findings,
  implementation phases, scope boundaries and verification criteria.
- Completed ARM build work is reused as a baseline, not reopened.

- 2026-09-12 20:50: Revised signing policy at the user's direction; the plan records
  algorithm selection, key replacement and negative acceptance cases. No keys
  or executable behavior were changed during this documentation revision.
