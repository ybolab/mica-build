# RFCT-289 Define security and manufacturing lifecycle

- **status**: completed
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

## Completion

Completed on 2026-09-02 after the campaign acceptance sweep.

| Acceptance | Verdict | Evidence and verification | Residue |
|---|---|---|---|
| Threat documentation separates rootfs integrity, update authenticity, boot authenticity, data confidentiality, recovery and rootful applications. | Satisfied | `docs/design/security-model.md`; `docs/design/security-lifecycle.md`; `make docs-verify` passed. | None. |
| Trust anchors and device credentials have generation, injection, rotation, revocation and recovery procedures with negative tests. | Partially satisfied | `docs/design/security-lifecycle.md`; `docs/design/release-signing.md`; `tests/rauc-trust-negative-test.sh`; negative and hygiene suites passed. | TUF-root provisioning, RAUC device-keyring rotation, managed device PKI and board boot-key procedures remain partial/proposed or operator-only. |
| Factory inputs/results are versioned and RMA/rework cannot clone identity. | Escalated | `docs/design/manufacturing.md`; `docs/design/provisioning.md`; documentation verification passed. | Factory station/MES tooling, immutable input issuance, result persistence, quarantine and RMA execution do not exist in this tree. |
| Each board/revision reports I1-I4 evidence and physical/debug boundaries; unsupported secure-boot claims fail publication checks. | Satisfied | `boards/cx3576/evidence.json`; `boards/x64/evidence.json`; `build/src/release-manifest.ts`; build Bun tests and the release verification gate passed. | Both boards truthfully remain I1; higher levels require the evidence named in their qualification prose. |
| Vulnerability intake, advisory, incident and EOL operations have owners. | Satisfied | `docs/design/security-lifecycle.md`; `make docs-verify` passed. | The owner roles and procedures exist, while the operational channels remain manual/proposed. |
