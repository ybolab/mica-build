# 20260910-0338-minimal-boot-shutdown Assess minimal BusyBox boot and shutdown environments

- **status**: completed
- **priority**: P1
- **owner**: worker/minimal-boot-20260910
- **createdAt**: 2026-09-10 03:38

## Description

Assess replacing generic early-userspace and shutdown tools with a minimal
BusyBox environment. Preserve signed file deployment verification, native A/B
selection and failure handling, watchdog handoff, and complete storage teardown.
The current request is a feasibility question; implementation is a separate
approval decision. No compatibility or migration paths are required.

## ActiveForm

Checking the current command contract and preparing a concrete replacement plan.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Full-tier proposal: packaging, authenticated init and shutdown acceptance cross
  module boundaries. Investigation and proposal only in this turn.
- Keep the concurrent CX3576 board, HDMI and console repairs unchanged.
- The existing boot-log cleanup investigation remains with its current owner.

## Findings

- [Replacement proposal](../plan/20260910-0341-minimal-boot-shutdown.md) records the inspected command
  differences, measured ELF closures and verification scope.
- BusyBox can provide basic startup tools and the shutdown execution environment;
  the current signature/A/B policy and device-mapper helpers remain necessary.
- Feasibility investigation is complete. No implementation or image change was
  requested or performed as part of this assessment.

- complete: Feasibility and measured dependency analysis completed; implementation remains a draft proposal.

## Verification

- `make docs-verify`: passed all index, link, status, coverage and board checks.
- `git diff --check`: passed.
- Runtime binaries were inspected only; no boot or shutdown implementation was
  changed, and no replacement image was built.

- 2026-09-11 current cross-reference: the original feasibility result remains
  complete. B3 delivered the native HYBRID scope and now owns the user-directed
  static refinement in [its existing plan](../plan/20260910-1206-b3-bounded-exitrd-teardown.md);
  B7 owns joint image acceptance. This does not reopen the feasibility task.
