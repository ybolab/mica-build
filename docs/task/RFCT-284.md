# RFCT-284 Deliver recovery and credential access recovery

- **status**: pending
- **priority**: P0
- **owner**: unassigned
- **createdAt**: 2026-09-01
- **plan**: [PLAN-048](../plan/PLAN-048.md)

## Description

Provide guarded manual rollback, board recovery, administrator access recovery
and explicit reset/wipe semantics beyond automatic bad-slot fallback.

## Acceptance

- Operators can inspect slot state and request a guarded manual rollback.
- Every qualified board has a physical-presence recovery entry and tested
  both-slots-failed procedure.
- Credential recovery rotates rather than reveals secrets and is audited.
- Reset modes name effects on identity, calibration, STATE, DATA, META and
  system slots before implementation.
- Power-loss/corruption tests and a data-preserving-first decision tree pass.

## ActiveForm

Delivering local recovery and access recovery.

## Dependencies

- **blocked by**: explicit approval of PLAN-048; PLAN-047 slot state; PLAN-049 data semantics
- **blocks**: supportable field recovery and safe factory reset

## Notes

- A permanent production SSH/root shell is not the recovery design.
