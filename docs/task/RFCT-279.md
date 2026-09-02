# RFCT-279 Publish release identity and supply-chain artifacts

- **status**: completed
- **priority**: P0
- **owner**: unassigned
- **createdAt**: 2026-09-01
- **plan**: [PLAN-043](../plan/PLAN-043.md)

## Description

Make each customer release a signed, machine-readable and supportable artifact
set rather than a collection of build-output filenames.

## Acceptance

- A validated release manifest binds version/channel, board compatibility,
  artifacts, sizes, digests, source/build identity and schema floors.
- Images and bundles ship with checksums/signatures, SBOM, provenance,
  licensing/source-offer data and release notes.
- Promotion, key custody, vulnerability/advisory, support-window and EOL
  procedures have named owners.
- Publication fails when required artifacts or board evidence are absent.
- Customer acquisition and verification instructions are tested.

## ActiveForm

Publishing complete release and supply-chain metadata.

## Dependencies

- **blocked by**: explicit approval of PLAN-043
- **blocks**: PLAN-046 installation identity and PLAN-047 target discovery

## Notes

- System packages remain build-time inputs delivered in whole-system RAUC
  images; this task adds no on-device package manager.

## Completion

Completed on 2026-09-02 after the campaign acceptance sweep.

| Acceptance | Verdict | Evidence and verification | Residue |
|---|---|---|---|
| A validated release manifest binds version/channel, board compatibility, artifacts, sizes, digests, source/build identity and schema floors. | Satisfied | `build/src/release-manifest.ts`; `build/src/release-manifest.test.ts`; `tests/release-verify-test.sh`; build Bun tests and the release verify gate passed. | None. |
| Images and bundles ship with checksums/signatures, SBOM, provenance, licensing/source-offer data and release notes. | Partially satisfied | `build/src/release-manifest.ts`; `docs/design/release-artifacts.md`; `docs/design/release-signing.md`; build Bun tests and the assembled fixture gate passed. | Production RAUC/TUF signing and publication require operator ceremonies and external keys; this sweep signed no production artifact set. |
| Promotion, key custody, vulnerability/advisory, support-window and EOL procedures have named owners. | Satisfied | `docs/design/security-lifecycle.md`; `docs/design/release-signing.md`; `make docs-verify` passed. | The channels are named procedures, not deployed workflow infrastructure. |
| Publication fails when required artifacts or board evidence are absent. | Satisfied | `build/src/release-manifest.ts`; `build/src/release-manifest.test.ts`; `tests/release-verify-test.sh`; both test layers proved the refusals. | None. |
| Customer acquisition and verification instructions are tested. | Partially satisfied | `docs/design/release-artifacts.md`; `tests/release-verify-test.sh`; three documented verification commands executed successfully. | Production download hosting/acquisition remains proposed and is not end-to-end tested. |
