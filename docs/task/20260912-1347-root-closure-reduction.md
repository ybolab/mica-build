# 20260912-1347-root-closure-reduction Reduce the read-only root closure

- **status**: in_progress
- **priority**: P2
- **owner**: worker/root-closure-20260912-1347
- **createdAt**: 2026-09-12 13:47

## Description

Turn the measurement report [root-closure.md](../research/root-closure.md)
into an approved plan, corrected against the current tree and the standing
decisions, and then implement only the approved subset. Plan:
[20260912-1347-root-closure-reduction](../plan/20260912-1347-root-closure-reduction.md).

Acceptance for the planning half: the plan re-measures the current x64 root,
records every correction to the research document, separates the items that
the PLAN-086 S5 decline already excludes, and names the verification for each
in-scope step. Acceptance for the implementation half is defined per step in
the plan; every step reports before/after bytes for the shipped root image at
equal feature selection.

## ActiveForm

Planning the root closure reduction from the research measurements.

## Dependencies

- **blocked by**: user approval of the plan
- **blocks**: (none)

## Notes

- Planning only was requested on 2026-09-12; no implementation is authorized
  by this task until the plan is approved.
