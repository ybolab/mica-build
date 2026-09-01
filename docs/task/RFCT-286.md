# RFCT-286 Document BSP porting and qualify field reliability

- **status**: implementing
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
