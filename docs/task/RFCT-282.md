# RFCT-282 Deliver install, onboarding and provisioning

- **status**: pending
- **priority**: P0
- **owner**: unassigned
- **createdAt**: 2026-09-01
- **plan**: [PLAN-046](../plan/PLAN-046.md)

## Description

Provide a verified release-to-first-login journey for embedded boards,
including factory and zero/offline-network provisioning.

## Acceptance

- Every claimed board/profile has a tested artifact-selection, flash, first
  boot, status and recovery-entry procedure with data-loss warnings.
- A versioned validated provisioning document is idempotent and secret-safe.
- At least one appropriate offline/factory transport works per qualified board.
- Bootstrap claim/rotation survives retry and power loss without cloning or
  leaking identity.
- Manufacturing ownership, failure quarantine and first-run user guides are
  documented and tested end to end.

## ActiveForm

Delivering embedded installation and onboarding.

## Dependencies

- **blocked by**: explicit approval of PLAN-046; PLAN-043 release identity; board access
- **blocks**: repeatable customer and factory deployment

## Notes

- The common provisioning schema may have board-specific transports.
