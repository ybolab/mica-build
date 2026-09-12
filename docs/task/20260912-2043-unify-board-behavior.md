# 20260912-2043-unify-board-behavior Unify board build, compression and acceptance behavior

- **status**: in_progress
- **priority**: P1
- **owner**: worker/board-unification-20260912-2043
- **createdAt**: 2026-09-12 20:43

## Description

Prepare and, after review, implement shared board policy for zstd compression and
delivery, existing signing roles and lifecycle acceptance. Preserve legitimate
UEFI/FIT and hardware differences, SYSTEM 1 GiB and existing trust identities.

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
