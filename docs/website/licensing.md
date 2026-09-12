# Page brief: Source & licensing

- **Purpose**: state the license facts the site must carry — what license Mica OS
  is under, what the shipped image contains, and what source-availability
  obligations the project meets — verified against the repository's actual
  license files, never asserted from memory.
- **Audience**: legal and compliance reviewers; integrators embedding Mica OS in
  a shipped product who inherit its notice obligations.
- **Navigation position**: page 8, the final navigation entry and a permanent
  footer link.

## Content outline

1. The Mica OS license.
2. What the shipped image contains, license-wise.
3. Notices on the device.
4. SBOM and source offer — status, honestly.

## Draft copy

### The Mica OS license

Mica OS — the build system, the management plane, the tooling and this
documentation — is licensed under the Apache License, Version 2.0. The
license text is the repository's top-level `LICENSE` file.

> status: shipped — evidence: `LICENSE`

### What a shipped image contains

A Mica OS image is composed from two kinds of packages: Debian packages from the
Debian archive, each carrying its own upstream license, and packages produced
by this repository, which are Apache-2.0. The image ships a machine-readable
inventory of every installed package and its version, so "what is in this
image" is a recorded fact, not an estimate.

> status: shipped — evidence: `rootfs/compose/90-pack.Dockerfile`, `docs/design/build.md`

### Notices on the device

Every package this repository produces installs its own
`/usr/share/doc/<package>/copyright` file in Debian machine-readable format,
carrying the full Apache-2.0 text rather than a reference — the image does not
ship Debian's shared license directory, so a reference would dangle on the
device. Producers that package vendor or Debian-sourced content record that
content's own license instead.

> status: shipped — evidence: `rootfs/packages-src/copyright`

### SBOM and source offer

A release directory now carries the supply-chain delivery: a CycloneDX SBOM
with one component per row of the image's own bill of materials, and a license
and source-offer inventory carrying the written offer, the source identity it
is redeemable against, and the package list it covers. Both are derived from
the image's package manifest and from nothing else, so two builds of one image
emit identical bytes, and the publication gate refuses a release whose SBOM
has no components.

> status: shipped — evidence: `docs/design/release-artifacts.md`, `make os-release-gate`

The site may say a release carries an SBOM and a source offer. It may not yet
say where either is published, or who answers a source request: no release is
hosted, and the operational channel for honouring the offer — an address and a
responder — does not exist.

> status: unsupported

### Rules for this page

License statements on this page regenerate from the repository's license
files and the release inventory, per the [content contract](contract.md).
Adding a component with a new license obligation must surface here through
that regeneration — a hand-edited license summary that drifts from the shipped
inventory is the exact failure this contract exists to prevent.
