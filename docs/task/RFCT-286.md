# RFCT-286 Document BSP porting and qualify field reliability

- **status**: completed
- **completedAt**: 2026-09-01
- **priority**: P0
- **owner**: unassigned
- **createdAt**: 2026-09-01
- **plan**: [PLAN-050](../plan/PLAN-050.md)

## Description

Give customer/integrators a complete board-porting contract and a reusable,
evidence-based field-reliability qualification process.

## Acceptance

- The porting guide covers vendor intake through boot, kernel/DTS/firmware,
  board.env, image, hwinit, factory, update, recovery and maintenance.
- Board schemas/templates identify provenance, revisions, owners, media,
  peripherals, recovery and known limitations.
- Qualification uses dated pass/fail/N/A/not-tested evidence for boot, power,
  storage, network/radio, RTC, thermal, watchdog and recovery.
- Releases distinguish mos-qualified from integrator-qualified boards.
- Binary-only inputs are accepted only with digest/rights/behavior evidence and
  honest I1-I4 assurance claims.

## ActiveForm

Documenting BSP porting and board qualification.

## Dependencies

- **blocked by**: explicit approval of PLAN-050; vendor inputs and physical boards
- **blocks**: supported-hardware and per-board security/reliability claims

## Notes

- Hardware selection and evidence normally remain the integrating customer's
  responsibility unless mos explicitly owns qualification.

## Completion

Completed 2026-09. The porting manual, `board.env` reference, intake rubric,
dossier template and instance, qualification process, support tiers and the
I1-I4 assurance ladder are in the tree, held to the template by
`docs/bsp/verify-board.sh` under `make docs-verify`. The delivered artifacts,
the gate that proves them, and the hardware evidence that remains outstanding —
every qualification row still reads `not tested` — are recorded in
[PLAN-050](../plan/PLAN-050.md)'s Completion section.
