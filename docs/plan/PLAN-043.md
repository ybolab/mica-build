# PLAN-043 Publish release identity and supply-chain artifacts

- **status**: implementing
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: 2026-09-02
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

## Annotations

- 2026-08-31: Package publication was clarified as build-time `.deb`
  composition followed by signed whole-OS release.
- 2026-09-01: Split from PLAN-037 so release engineering can be approved and
  accepted independently from the documentation site and device updater.
