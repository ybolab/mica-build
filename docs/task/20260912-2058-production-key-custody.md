# 20260912-2058-production-key-custody Establish production signing key custody

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-09-12 20:58

## Description

Current signing uses development keys. Define and execute the production
ceremony for the boot, content and metadata signing roles in
`docs/design/release-signing.md` and `docs/design/security-lifecycle.md`:
key generation media, custody, rotation rehearsal and the evidence a release
records. Remote re-anchoring of fielded development devices is not required.

Acceptance: a production-grade image is signed from ceremony-held keys, its
grade is reported by the device, and publication refuses development-grade
artifacts.

## ActiveForm

Establishing production key custody.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Created by 20260912-2049-docs-restructure from the 2026-09-12 plan and task audit.
