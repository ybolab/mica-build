# 20260912-2043-unify-board-behavior Unify board build, compression and acceptance behavior

- **status**: draft
- **createdAt**: 2026-09-12 20:43
- **revisedAt**: 2026-09-12 20:50
- **approvedAt**: (pending)
- **relatedTask**: [20260912-2043-unify-board-behavior](../task/20260912-2043-unify-board-behavior.md)

## Context

The user requested common board behavior to reduce maintenance, zstd delivery,
and an explicit plan. This proposal is based on main at `fd93f5cd`; it does not
restart migration handoff work or reopen completed ARM64 builds.

| Layer | x64 | virt-arm64 | cx3576 / s905x5m |
|---|---|---|---|
| Boot container | Signed UKI / UEFI | Signed UKI / UEFI | Signed FIT / U-Boot |
| Kernel compression today | gzip in bzImage | Raw Image | zstd in FIT |
| Initramfs | zstd cpio | zstd cpio | zstd cpio |
| Root / support filesystem | SquashFS zstd | SquashFS zstd | SquashFS zstd |
| Module files | Uncompressed inside support | Same | Same |
| Trust roles | Boot RSA, verity RSA, updates Ed25519 | Same | Same |

Source anchors: `boards/x64/bsp/kernel/config/x64.config`,
`boards/virt-arm64/bsp/kernel/{Dockerfile,config/virt-arm64.config}`,
`pkgs/mos-boot/{kernel,fit,initramfs,compression,dev-keys,init-keys}.sh`,
`rootfs/scripts/pack-squashfs.sh`, and `build/src/component-build.ts`.
The ARM64 config disables EFI_ZBOOT and its Dockerfile builds Image.
The UKI builder embeds the supplied kernel; it does not compress it.

Existing ARM release artifacts have verified zstd transport wrappers. These
are not yet a uniform release-entry contract. The updater consumes the raw
MOSUPD01 archive in `build/src/component-archive.ts`; wrapping it in zstd does
not make compressed input supported by the device API.

The completed [ARM build record](20260912-1329-arm64-board-builds.md) establishes
build and virt-arm64 QEMU evidence, not physical CX3576/S905X5M acceptance.
The [boot-size plan](20260911-1927-boot-artifact-size.md) covers existing FIT and
early-userspace compression; this proposal adds the remaining UKI kernel gap
and shared policy without reopening its delivered implementation.

## Proposal

### 1. Establish shared policy at the existing board boundary

Use existing board discovery and build entry points. Keep architecture,
boot backend, kernel source/config, firmware, DT and hardware initialization
as board inputs. Share compression, artifact validation, trust-role checks and
lifecycle assertions. Avoid a second board registry or a generic plugin layer.

Inventory current board capabilities and output receipts before editing.
Record the source commit, pinned container images and input digests for each
acceptance image. Capability differences must be explicit, not inferred from
silent board-name exceptions.

Verify: all four boards resolve through the common entry; missing required
inputs fail before composition; hardware-specific capabilities remain visible.

### 2. Close the kernel compression gap

- x64: enable CONFIG_KERNEL_ZSTD and disable CONFIG_KERNEL_GZIP. Continue to
  deliver a valid self-decompressing bzImage inside the signed UKI.
- virt-arm64: first prove the pinned kernel's EFI zboot path with zstd,
  the current UKI stub/tooling and signature verification. Determine the exact
  EFI artifact target from that kernel's build rules. A raw Image.zst must not
  be substituted into the current UKI without an executable decompressor.
- FIT boards: retain current zstd kernel compression and U-Boot decompression.
- All boards: retain zstd initramfs and SquashFS root/support. Keep individual
  modules uncompressed inside the compressed support filesystem.

The ARM64 proof must boot through the intended firmware trust path, not just
QEMU direct-kernel loading. If current pinned components cannot load the
compressed EFI kernel safely, retain failure evidence and revise this phase
before any dependency upgrade or alternative loader implementation.

Verify: inspect resolved kernel configs and actual payloads, validate signatures,
boot the full image, and measure signed boot bytes, load/decompression time and
peak memory. Preserve existing size bounds and watchdog deadlines; do not infer
runtime memory savings from smaller files.

### 3. Make zstd delivery a common build result

Move the already demonstrated wrapping operation into the existing release
entry. Produce `.img.zst` and `.mosupd.zst` for every board, plus a compressed
recovery image where the board requires one. Keep raw artifacts as composition
and validation inputs. Record both raw and compressed sizes and SHA-256 digests.

Before publishing a completed result, run zstd integrity checks and compare the
decompressed stream with the source artifact. Use temporary outputs followed by
atomic completion. A failed compression or verification must not leave a result
advertised as ready. Reject truncated/corrupt inputs in verification.

The common host-side delivery workflow decompresses before flashing or importing
updates. The device continues to receive authenticated raw MOSUPD01 archives.
Direct compressed device API ingestion and a new archive schema are outside this
proposal. Preserve the authenticated content boundaries and verification order;
regenerate signatures with the selected profiles in phase 4.

Verify: the same packaging and round-trip checks pass for all boards; the
unwrapped update passes existing archive verification and device acceptance.

### 4. Share signing policy with explicit platform algorithm profiles

Keep three independent trust domains under meta. The target policy is:

| Domain | Target algorithm | Selection rule |
|---|---|---|
| updates | ECDSA P-256 with SHA-256 | One shared profile across all boards |
| boot | RSA-2048 with SHA-256 or ECDSA P-256 with SHA-256 | Select from verified firmware, signing-tool and boot-backend support |
| verity | RSA-2048 with SHA-256 or ECDSA P-256 with SHA-256 | Select from verified kernel X.509/PKCS#7 support |

Prefer ECDSA for boot/verity where the complete verification chain is proven;
use RSA where the target requires it. Compatibility here means the current
platform's verification capabilities, not support for old images or keys.
Resolve one explicit algorithm per domain in each board's build profile. Do not
silently downgrade after a signing or verification failure. Do not require every
device to trust both algorithms. Record the selected algorithm and public-key
fingerprint in build/signing receipts; verifiers enforce that profile rather
than accepting an algorithm chosen by an untrusted payload.

Replace Ed25519 in the update key initializer, signer, verifier and contract tests.
Use PKCS#8 PEM private keys and a single documented public-key representation
(SPKI PEM) for updates. Specify update signatures as fixed-width 64-byte P-256
r || s values, with each integer encoded as 32-byte big-endian, and SHA-256 over
the existing authenticated message bytes. Use a maintained cryptographic library
for signing and verification; do not implement nonce generation or curve math.
Check all manifest/archive signature and key-size assumptions. Boot and verity
retain their backend-required X.509 and signature encodings; the update encoding
does not replace FIT, Authenticode or CMS encoding.

Extend the existing one-command key initializer to detect the selected profiles,
create missing fresh sets and reuse valid matching keys idempotently. Keep RSA
and ECDSA material separate when different board profiles require both, with an
explicit domain/algorithm lookup under meta. Never share private keys across
boot, verity and updates. Reject partial sets, wrong curves and mismatched
certificates. Existing Ed25519 update keys must be explicitly replaced during
implementation; report new public fingerprints and rebuild all affected signed
artifacts and embedded trust anchors. Do not silently overwrite existing keys
or convert their identity by changing a filename. No dual Ed25519/ECDSA update
verification or old-image migration path is required.

UEFI and FIT retain their respective signature backends. Prove ECDSA against the
actual pinned UEFI firmware/tooling, both vendor U-Boot trees and kernel configs
before selecting it for a board. An upstream capability alone is insufficient.
Keep private material confined to initialization/signing operations; only required
public anchors enter firmware/kernel build inputs.

Verify: both supported boot/verity profiles have focused signing and rejection
checks; each board passes its selected profile through the actual boot and
verity path. Updates pass a cross-board ECDSA sign/verify contract with fixed
fixtures, followed by full-image update/rollback acceptance. Reject malformed
signatures, wrong keys/curves/profiles, Ed25519 update inputs and altered payloads.
Key initialization must prove matching-set reuse and clear failure on a conflicting
existing set. Physical results remain pending until actually executed.

### 5. Unify execution and acceptance

Build packages separately from rootfs composition. Reuse successful components
only when input receipts match; rebuild affected downstream artifacts after a
change. Align with the [package repository split](20260911-2006-split-package-repositories.md)
without implementing its repository/registry work here. Root closure reduction
remains owned by its [separate plan](20260912-1347-root-closure-reduction.md).

Compile and test in pinned Docker environments. Inspect daemon resources and
mounts before execution, mount only the needed project directories, label every
started container, and run long processes in persistent tmux sessions. Do not
install host toolchains, restart old scheduling or create parallel agents.
Report progress in the current conversation every 30 minutes during long builds.

Run shared lifecycle checks in this order using complete current images:

1. x64: boot, authenticated API, native reboot and shutdown, successful update,
   failed-update rollback, reset and storage persistence/clearing contracts.
2. virt-arm64: repeat the shared suite through its signed EFI boot path, including
   compressed kernel loading. Full-system execution is required for runtime
   behavior that qemu-user cannot exercise.
3. CX3576 and S905X5M: static artifact gates followed by physical boot, lifecycle,
   recovery, watchdog and applicable peripheral acceptance on each board.

Keep SYSTEM exactly 1 GiB. Preserve authentication, signed-file deployment,
verity, storage and watchdog contracts. Record actual pass/fail/not-run outcomes
and artifact digests. Missing hardware blocks physical qualification; QEMU and
static checks cannot substitute for it. Preserve failed logs and images.

Verify: common assertions have board/backend parameters only where necessary;
negative cases exercise rejection paths; every claimed hardware result identifies
its tested image and device. No legacy image compatibility matrix is added.

## Scope

Expected changes are limited to kernel configs/export targets, shared boot and
release scripts, key initialization, update signing/verification and public-key
loading, existing build entry wiring, focused contract tests and the
corresponding task/plan records. Implement in phases 1–5 after review; qualify
x64 before expanding to ARM64. Reuse completed work rather than rebuild unrelated
packages. This document authorizes no implementation by its draft status.

Out of scope: kernel-version unification, vendor BSP rewrites, a single key shared
across trust domains, automatic key rotation, Ed25519 firmware/kernel support,
fleet cloud implementation, OCI activation, legacy compatibility, repository
renaming, and additional rootfs feature removal.

## Risks

- EFI zboot may expose UKI loading or signature-chain constraints; the bounded
  proof precedes broad orchestration edits and must not weaken verification.
- Compression may increase CPU time or boot memory. Measure within existing
  watchdog and memory limits before qualification.
- Shared scripts can hide hardware differences. Keep explicit capability inputs
  and test both UEFI and FIT backends.
- Algorithm changes replace trust identities and invalidate previous signatures.
  Rebuild affected firmware, kernels and releases together; test only complete
  current images and reject stale profile/key receipts.
- Existing outputs can be stale relative to main. Receipt matching, full-image
  acceptance and digest-linked evidence are required for every changed release.

## Alternatives

Keeping per-board policy duplicates maintenance and leaves inconsistent delivery.
Forcing all boards onto one firmware/container or one signature algorithm expands
scope without removing their hardware constraints. Shared policy with small
backend-specific implementations is the proposed boundary.

## Annotations

The user requested a written plan after discussing unified board behavior, then
approved revising its algorithm policy: updates use ECDSA P-256/SHA-256; boot
and verity allow RSA or ECDSA according to target-platform support. This replaces
the original proposal to retain RSA/RSA/Ed25519 and all existing identities.
This is a reviewable draft; no compression, trust or build behavior has been
changed by writing it. Existing build authorization and local-commit permission
remain separate from approval of this new cross-board implementation proposal.
