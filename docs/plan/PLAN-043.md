# PLAN-043 Publish release identity and supply-chain artifacts

- **status**: completed
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: 2026-09-02
- **completedAt**: 2026-09-02
- **relatedTask**: [RFCT-279](../task/RFCT-279.md)

## Context

The build produces board images, dm-verity artifacts and RAUC bundles, and the
repository contains host-side TUF and signing tooling. Customers still lack a
canonical release identity, compatibility manifest, channel, download metadata,
checksums/signature procedure, complete SBOM/source offer and support window.
The final image intentionally has no customer `apt`/`dpkg` workflow.

## Proposal

- **SW:** generate one signed machine-readable release manifest naming version,
  channel, board/profile compatibility, image and RAUC artifacts, sizes,
  digests, build/source identities, boot assurance and required schema floors.
- **SW:** publish per-artifact checksums/signatures, SPDX or CycloneDX SBOM,
  license/source-offer inventory and reproducible provenance alongside the
  existing TUF/RAUC outputs.
- **OPS:** define development, candidate and stable promotion; signing/key
  custody; vulnerability triage; advisory, support-window and end-of-life
  procedures.
- **DOC:** document how a customer chooses, downloads, verifies and identifies
  a release and how a support case cites that identity.
- **SW/OPS:** gate publication on artifact completeness, manifest/schema
  validation, supported-board evidence and release-note presence.

System packages and OS-integrated native applications remain build-time Debian
package inputs. Their field release unit is the signed whole-system RAUC image;
this plan adds no system-extension or on-device package repository.

## Risks

- TUF metadata is not a substitute for provisioning a production RAUC trust
  anchor to devices; PLAN-047 owns device-side update authenticity.
- A generated SBOM without license/source-offer and vulnerability operations is
  incomplete supply-chain delivery.
- A compatibility claim can exceed board evidence; publication must consume the
  PLAN-050 qualification state.

## Scope

In scope: release schema, artifact index, checksums/signatures, SBOM, provenance,
license/source offer, channels, release notes and operating policy. Out of
scope: device-side download/install, fleet rollout and arbitrary on-device
package installation.

## Alternatives

1. Treat filenames as the release contract. Rejected because they do not bind
   compatibility, provenance, support or the full artifact set.
2. Publish only RAUC bundles. Rejected because installation/recovery images and
   customer verification inputs are also required.
3. Add an on-device APT repository. Rejected because it breaks the immutable
   A/B system lifecycle selected for mos.

## Completion

### Delivered

- `build/src/release-manifest.ts` and `build/src/release-cli.ts` assemble and
  gate the release identity, artifact floor, digests, supply-chain records and
  board evidence consumed by `Makefile`'s `os-release-cx3576` and
  `os-release-gate` targets.
- `docs/design/release-artifacts.md` documents the release unit, evidence
  contract and customer verification commands; `docs/design/security-lifecycle.md`
  and `docs/design/release-signing.md` assign the operating roles and signing
  procedures.

### Verification

- `(cd build && bun test)` — release schema, artifact, evidence-floor and
  unsupported-claim refusals.
- `bash tests/release-verify-test.sh` — assembled fixture, documented customer
  commands and seven distinct publication refusals.
- `make docs-verify`, `bash tests/trust-domain-hygiene-test.sh` and
  `bash tests/shell-pipefail-lint.sh`.

Cargo gates were not rerun in this acceptance sweep: each merged Rust subtask
ran its Cargo gates on the identical delivered commit.

### Residue

- Production signing and key-custody ceremonies still require the release
  owner and production keys outside the repository; this sweep created no
  production release.
- Download hosting and automated channel promotion remain external/proposed,
  so customer verification is executable but acquisition is not end-to-end
  tested against a production distribution service.
- Stable promotion still owes per-board soak/update/rollback evidence; the
  support-window, advisory and EOL channels remain operator-run procedures.

### Acceptance matrix

| Acceptance | Verdict | Evidence and verification | Residue |
|---|---|---|---|
| A validated release manifest binds version/channel, board compatibility, artifacts, sizes, digests, source/build identity and schema floors. | Satisfied | `build/src/release-manifest.ts`; `build/src/release-manifest.test.ts`; `tests/release-verify-test.sh`; proved by build Bun tests and the release verify gate. | None. |
| Images and bundles ship with checksums/signatures, SBOM, provenance, licensing/source-offer data and release notes. | Partially satisfied | `build/src/release-manifest.ts`; `docs/design/release-artifacts.md`; `docs/design/release-signing.md`; proved by build Bun tests and the assembled fixture gate. | Production RAUC/TUF signing and publication are operator ceremonies using external keys; no production artifact set was signed during this sweep. |
| Promotion, key custody, vulnerability/advisory, support-window and EOL procedures have named owners. | Satisfied | `docs/design/security-lifecycle.md`; `docs/design/release-signing.md`; checked by `make docs-verify`. | The named channels are procedures, not deployed workflow infrastructure. |
| Publication fails when required artifacts or board evidence are absent. | Satisfied | `build/src/release-manifest.ts`; `build/src/release-manifest.test.ts`; `tests/release-verify-test.sh`; both test layers prove the missing-artifact and missing-evidence refusals. | None. |
| Customer acquisition and verification instructions are tested. | Partially satisfied | `docs/design/release-artifacts.md`; `tests/release-verify-test.sh`; three documented verification commands execute against a generated release. | Section 6.1 still marks hosting/download acquisition as proposed; no production download service is available to test. |

## Annotations

- 2026-08-31: Package publication was clarified as build-time `.deb`
  composition followed by signed whole-OS release.
- 2026-09-01: Split from PLAN-037 so release engineering can be approved and
  accepted independently from the documentation site and device updater.
- 2026-09-02: Campaign `l1-6rjx4wrt-20260901180748` was integrated from merge
  branch `bkd/v0nvqwf3` for acceptance and completion.
