# RFCT-279 Publish release identity and supply-chain artifacts

- **status**: implementing
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
