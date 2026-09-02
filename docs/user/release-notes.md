# Release identification and release notes policy

This page defines how a mos release is named, which artifacts carry its
identity, and where release-note facts are allowed to come from. It contains
no release history: **no public mos release has been published yet**, and this
documentation set does not fabricate one.

## 1. How a release is identified today

A build stamps identity into its artifacts rather than into a hand-maintained
changelog:

- **The disk image** is named `<board>-mos-<epoch>.img`; the epoch is the
  build's timestamp identity, and `<board>-mos-latest.img` points at the
  newest.
- **The update bundle** carries the version string the release owner passes
  at build time (`bash build/run.sh --bundle 1.2.3`).
- **The rootfs identity** is its dm-verity root hash: the pack is
  deterministic, so the hash is a pure function of the release's content, and
  two builds of the same tree produce the same hash. It is recorded beside
  the artifact in `rootfs-verity.env` and pinned again by the TUF metadata
  when a bundle is published.
- **The package inventory** ships in the image at
  `/usr/share/mos/manifest.tsv`: every installed package, its version, and
  the git stamp of the source tree the package pool was built from. A build
  from an uncommitted tree is marked `.dirty` and refused by later steps, so
  a shipped identity always names a real commit.

A support case cites the bundle version, the verity root hash, and the
manifest's git stamp; together they identify a release unambiguously.

> status: shipped — evidence: `docs/design/build.md`, `rootfs/compose/90-pack.Dockerfile`, `docs/design/ro-root.md`

## 2. Where release-note facts come from

The policy, binding on whoever publishes a release:

- **Facts come from artifacts.** Version, board and profile compatibility,
  digests and the package delta come from the build outputs and the manifest
  — never retyped by hand, because a hand-copied digest is a digest nobody
  re-checked.
- **Capability claims follow the documentation contract.** A release note
  claims shipped behaviour only with the same evidence discipline as this
  documentation set ([doc-contract.md](doc-contract.md)); roadmap items are
  labelled as such or omitted.
- **Security-relevant changes are named.** A release that changes the trust
  chain, the access model or a default is not summarized as "misc fixes".
- **No release history is invented.** Absence of published releases is stated
  as absence.

> status: shipped — evidence: `docs/user/doc-contract.md`

## 3. Channels, the manifest and gated publication

`manifest.json` in the release directory is now the machine-readable source
this page's prose defers to. It binds the release version, the channel
(`development`, `candidate` or `stable`), the board and its profile, the full
source commit and whether the tree was dirty, the builder-image pins, the
board's boot-assurance level read out of the board evidence file, and every
artifact's filename, role, size and sha256. Nothing in it is typed by hand:
each number is measured off the staged file or read out of the mechanism that
stamped it, and the tooling has no flag that overrides a measurement.

The publication gate re-checks an assembled release directory from scratch and
refuses it by name — a missing artifact role, a file whose size or digest
moved, `SHA256SUMS` disagreeing with the manifest, **empty release notes**, an
SBOM with no components, absent or diverged board evidence. There is no waiver
flag, and each refusal is proven red by mutation in the tooling's own tests. A
release without notes is therefore not a release.

The downloads brief for the official site is
[../website/downloads.md](../website/downloads.md).

> status: shipped — evidence: `docs/design/release-artifacts.md`, `make os-release-gate`

**What promotion still is not.** A channel is a claim recorded in a manifest,
not a place: nothing hosts releases, nothing moves one from `candidate` to
`stable`, and no support window or end-of-life date is bound to a release by
any mechanism.

> status: unsupported
