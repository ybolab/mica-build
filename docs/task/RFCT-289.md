# RFCT-289 Define security and manufacturing lifecycle

- **status**: implementing
- **priority**: P0
- **owner**: unassigned
- **createdAt**: 2026-09-01
- **plan**: [PLAN-053](../plan/PLAN-053.md)

## Description

Make production trust, device identity, factory evidence, board boot assurance
and security response explicit without overstating binary boot chains.

## Acceptance

- Threat documentation separates rootfs integrity, update authenticity, boot
  authenticity, data confidentiality, recovery and rootful applications.
- Trust anchors and device credentials have generation, injection, rotation,
  revocation and recovery procedures with negative tests.
- Factory inputs/results are versioned and RMA/rework cannot clone identity.
- Each board/revision reports I1-I4 evidence and physical/debug boundaries;
  unsupported secure-boot claims fail publication checks.
- Vulnerability intake, advisory, incident and EOL operations have owners.

## ActiveForm

Defining production security and manufacturing lifecycle.

## Dependencies

- **blocked by**: explicit approval of PLAN-053; PLAN-043 keys and PLAN-050 board evidence
- **blocks**: production update trust and truthful security publication

## Notes

- Production private keys remain outside the repository; universal I3/I4 is not
  promised.
