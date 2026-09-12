# 20260912-2058-auto-update-acceptance Accept automatic update scheduling scenarios

- **status**: pending
- **priority**: P3
- **owner**: (unassigned)
- **createdAt**: 2026-09-12 20:58

## Description

`pkgs/mosd/mosd/src/update_auto.rs` implements off/check/auto, maintenance
windows, fetch, install and reboot decisions. Existing guest tests cover manual
and component updates only.

Acceptance: QEMU tests cover check-only, auto install inside a window, deferral
outside a window, metered/offline refusal and the reboot decision.

## ActiveForm

Accepting automatic update scenarios.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Created by 20260912-2049-docs-restructure from the 2026-09-12 plan and task audit.
