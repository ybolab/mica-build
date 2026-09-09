# Page brief: Downloads

The downloads page selects an exact board, profile and signed deployment, then
shows the complete factory image and its independent component/update artifacts.
The current targets are x64, virt-arm64 and cx3576. No public download list is
published by this repository; source builds remain the documented route.

## Artifact facts

Each entry must come from actual artifact metadata: board, profile, release
version/generation, deployment/kernel/root IDs, byte lengths and digests. A full
`disk.img` initializes the current three-partition system. A `.mosupd` archive is
a signed component deployment update. Firmware has its own maintenance artifact,
recovery and readback workflow.

> status: shipped — evidence: `build/src/component-cli.ts`, `build/src/components.ts`, `docs/design/build.md`

## Verification

Link the exact trusted public-key source and the current image verification
command. Explain that boot, content and metadata have separate anchors; a checksum
served beside an untrusted artifact is insufficient authentication. All current
development acceptance flashes complete latest images. No old-layout migration
or historical update compatibility is offered.

> status: shipped — evidence: `verify/run.sh`, `docs/design/release-signing.md`, `docs/user/download.md`

## Publication

The operator-managed update server publishes authenticated component releases
and serves channel catalogs. Its UI also handles separate firmware artifacts.
A running server is not a public product release or physical-board qualification.
Generate any download list from its actual published metadata and delivered
artifact records; do not hand-write release identities or claim absent evidence.

> status: shipped — evidence: `update-server/src`, `docs/design/updates.md`

Public hosting, release support windows and a public downloadable release history
remain unprovided. Link [build instructions](../design/build.md),
[user downloads](../user/download.md) and [installation](../user/install.md).

> status: unsupported
