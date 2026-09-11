# 20260911-0145-b7-fresh-lifecycle-acceptance B7 fresh lifecycle and rootfs acceptance

- **status**: implementing
- **createdAt**: 2026-09-11 01:45
- **approvedAt**: 2026-09-11 01:45 (prior user approval)
- **relatedTask**: 20260911-0145-b7-fresh-lifecycle-acceptance

## Context

The exact reviewed B0-B6 dependency tree is merged locally. B3 requires native
`mos-shutdown` in each same-architecture kernel input. B5 requires the runtime
report and selected-root package manifest. B6 already repaired startup archive
fixtures; fresh artifact and equal-input cold proof remain unexecuted.

## Proposal

1. Read the committed narrow B0/B3/B4/B5/B6 records and acceptance callers.
   Verify missing contracts with a focused failing check.
2. Repair only scoped caller/fixture gaps and run relevant cheap checks with
   exact source, command, UTC, log hashes and exit metadata. Review the diff.
3. Commit the coherent checkpoint, inventory immutable inputs and missing
   prerequisites, and submit exact existing-wrapper job recipes to L2.
4. After L2 reviews the checkpoint, integrate the exact approved A/C sources
   locally and submit actual J/input manifests for the one-time L1 joint review.
   After named L2 allocations, produce one x64, virt-arm64 and CX3576 image
   from J, with up to two independent jobs when capacity permits. Verify the
   complete selected-feature/runtime matrix and pinned C verifier; compare
   exactly two independent equal-input virt-arm64 root builds. No new S905 image.

## Risks

Source/package/tool/trust drift invalidates equal-input or final-image proof.
Fixtures cannot establish guest teardown, terminal action, memory or hardware
behavior. Out-of-scope product defects require L2 scheduling. Exact reviewed
C source enters through the authorized merge; unapproved semantic changes and
shared resource mutations remain excluded.

## Scope

Focused `tests/file-ab-x64/`, `tests/signed-boot-lab/`, packaging/runtime closure
acceptance fixtures, permitted final-output checks, and this tracking pair.
The approved continuation adds the exact SYSTEM geometry hunk and R1 wrapper
correction. The later joint-wave amendment authorizes exact A/C local merges
and mechanical unions as recorded below. No unrelated production/board, UI,
compatibility, main, push or publication changes.

## Alternatives

No old input fallback. Reuse only immutable inputs with demonstrated identity;
otherwise report the exact missing prerequisite before artifact production.

## Annotations

Prior full-tier approval persists. Milestone resource scheduling is required
by the dispatch and is not another proposal approval gate. B7 retains all five
historical runtime obligations separately; B coordinates and D reconciles.

## Input inventory and scheduling blockers

Read the existing B0/B3/B4/B5/B6 records named in the dispatch and only their
narrow acceptance call chains. Inventory at the caller checkpoint is
`/tmp/mos-b7-gates.D4K7zn/inventory.json`, SHA-256
`032c50d00c28b3db622ba2ffb22d6dcb6a6e0ddcc9c1a846532331458e0b173f`.
It records commands, exits, logs/hashes, full committed source blobs, Docker and
Buildx versions, builder limits/identity, relevant image IDs and selected sets.
No existing image result is used as evidence for current B artifacts.

- Both `_out/debs/{amd64,arm64}/{Packages,SHA256SUMS,manifest.txt}` and both
  `_out/boards/{x64,virt-arm64}/kernel` are absent. Neither root candidate,
  lifecycle export, factory OCI, final image nor selected manifest exists here.
  No signing key/public trust input or public-meta directory has been allocated.
  Do not inspect an unspecified secret source or relabel another package stamp.
- With the existing defaults (dev, mosd/containers enabled, no radios, no declined
  features or extra components), each board resolves 11 packages: mos-apid,
  its own mos-board package, mos-busybox, mos-ca-trust, mos-deploy,
  mos-mqtt-broker, mos-mqttd, mos-podman, mos-profile-dev, mos-system and mosd.
  Resolution is not a built package inventory. Keep feature-equivalent baselines;
  optional removal savings are excluded.
- Docker reports eight CPUs and 33,635,225,600 bytes total memory; this is total
  daemon capacity, not free capacity. `/srv` had about 279 GiB free at inventory.
  L2 must freshly check competing heavy work and memory before every job.
- `mos-arm64` exists, BuildKit v0.32.2, daemon image
  `sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8`.
  Its inspect output advertises amd64 variants and 386 only, not arm64. The
  documented bundled-emulator route remains to be demonstrated. Memory and
  NanoCpus limits are both zero; its name alone does not prove the requested
  8-vCPU/16-GiB cap. Do not alter that shared builder without L2 allocation.
- Relevant existing tool image IDs are recorded, including boot tools
  `sha256:4cac4ecfca71` (prefix), exitrd fixture tools `sha256:ccd0d6d0d246`
  (prefix), lab `sha256:d33be5a8f7b8` (prefix) and pinned acceptance Bun
  `sha256:aa526cb71ad4` (prefix). Full IDs are in individual inventory logs.
  These observations do not establish that each image embeds the final approved
  packaging source; revalidate source/tool provenance before using it.

### Original source conflicts and their disposition

These observations describe the pre-continuation source; preserve their negative
logs. L1 approved the exact geometry and non-publication test-consumer boundaries
below. Geometry is now committed as `5ead205523bdeb6a8cf0cb8dc9c35b2c9f47d56d`;
the private Cargo fetch and original offline fixture passed. The remaining
source work implements the bounded non-publication consumer, without a release
policy change. Artifact production still requires final source/input/job handoff.

1. `boards/x64/board.env:27` and `boards/virt-arm64/board.env:27` both declare
   `SYSTEM_SIZE_MIB=2048`; DATA starts at 2561 MiB. `parseFileLayout` consumes
   those values directly. The task-owned read-only probe
   `timeout 30 bun /tmp/mos-b7-gates.D4K7zn/layout-probe.ts` exits 1 and reports
   2,147,483,648 SYSTEM bytes for each board versus the required 1,073,741,824:
   `Approved SYSTEM=1 GiB invariant differs from both integrated board layouts`.
   Required proposed repair boundary: each board's SYSTEM size and DATA start,
   plus directly affected authoritative layout expectations, under an L2-assigned
   owner. Board implementation is outside B7; no wrapper-side layout override.
2. `boards/virt-arm64/board.env:58` sets `BOARD_RELEASE_TARGET=0` and
   `build/src/release-cli.ts:48` refuses release assembly for it. The required
   dual-architecture release provenance cannot silently bypass publication
   policy. L2 must specify the intended nonpublishing acceptance boundary or
   assign an explicit policy change. B7 changes neither file.
3. The fresh-worktree offline shutdown fixture lacks its Cargo dependency cache
   and exits 101 before compiling. L2 must allocate a matching immutable cache
   handoff or an explicit dependency-preparation step before rerunning it.

## Initial B-only wrapper recipes (routing superseded by the joint wave)

These are the exact supported command shapes read from B0/B6 and the committed
wrappers, not runnable allocations: the final source, frozen packages, trust,
BSP paths and resource routing are still missing. L2 must integrate this caller
checkpoint first and name the final local B HEAD. All artifact producers then
use that same clean commit/tree without intervening tracking edits.

1. Obtain both complete indexed package pools from that exact final source.
   Existing producer route: `bash build-env/deb/build.sh --producer NAME --arch
   amd64|arm64|all`, then `bash build-env/deb/repo.sh --arch ARCH`.
   `make os-debs` enumerates every producer and both indexes; it is broader than
   a single root job and is not implicitly allocated here. Request a precise
   package job or an identity-verified pool handoff from L2, with full selected
   archive digests, index hashes and matching `manifest.txt` source stamp.
2. With the matching pools and validated public-meta input, the exact B6 root
   recipe is `MOS_BOARD=virt-arm64 MOS_ROOTFS_NO_CACHE=1 BUILDX_BUILDER=mos-arm64
   bash rootfs/build.sh`. Propose `timeout 7200 env MOS_BOARD=virt-arm64
   MOS_ROOTFS_NO_CACHE=1 BUILDX_BUILDER=mos-arm64 bash rootfs/build.sh` for each
   separately allocated run. The builder route/cap must first be resolved above.
   Run twice serially with the same final source, selected archives, locks,
   Debian source configuration, platform images and packing tools. Archive each
   output under `_out/repro/virt-arm64/<final-source>/<UTC>-run1` or `-run2`
   before the next root build. The first may supply the fresh B7 arm64 root.
   Budget remains two to three hours serial, at most 8 vCPU/16 GiB/30 GiB;
   timeout is a ceiling, not a second job grant. No x64 cold-repeat matrix.
3. The x64 root entry is `timeout 7200 make os-rootfs-x64`, after the same
   package/trust/source preflight and its own named allocation. Root outputs are
   `_out/x64/` and `_out/virt-arm64/`; the wrappers have no arbitrary output flag.
   Preserve full verity img/env, exact `SQUASHFS_BYTES` prefix, runtime/package
   reports, `factory-root.oci`, build-inputs, boot/debug and logs. Compare full
   bytes/hashes and extracted content/type/mode/uid/gid/mtime/link/xattr/capability/
   hardlink identity. Input drift is distinct from equal-input variance.
4. Lifecycle export uses `bash pkgs/mos-deploy/hack/build-deb.sh --producer
   b7-lifecycle --bins "mos-init mos-shutdown" --arch ARCH --stage OWNED_STAGE`.
   `OWNED_STAGE` must already exist; binaries export directly into it. This is a
   task-specific native cache identity, not a new registered product producer.
   Allocate export inputs/time/resources explicitly; no kernel rebuild is
   borrowed. Existing matching BSP kernels must prove embedded content anchor,
   source/config/modules/support and signing identity before reuse.
5. Production component entry uses `bash build/run.sh --components kernel
   --input BSP_KERNEL --init MOS_INIT --shutdown MOS_SHUTDOWN --public-key BASE64
   --board BOARD --out OWNED_KERNEL --content-key KEY --content-cert CERT
   --boot-key BOOT_KEY --boot-cert BOOT_CERT`. Root entry consumes `--components
   root --input BOARD_OUT --arch ARCH --version VERSION --out OWNED_ROOT
   --content-key KEY --content-cert CERT`. Existing deployment/image/archive
   commands then authenticate those actual component bytes; resolve the exact
   generation, record/key paths and named image job through L2, never invent them.
6. Disposable runtime fixtures now use `bash tests/file-ab-x64/runtime-build.sh
   ROOT_IMAGE KERNEL_DIR CERTIFICATE PRIVATE_KEY MOS_INIT BOARD MOS_SHUTDOWN`.
   They add acceptance services and repack a root, so their images are distinct
   from unmodified release candidates and require their own hashes/provenance.
   `boot.sh image/disk.img writable 300 BOARD` is the existing lab invocation;
   guest CPU/memory are two CPUs/1024 MiB. A lab exit or shutdown text alone does
   not prove completed reboot/poweroff/halt. Allocate each complete command with
   its unique Docker name, narrow mounts and immutable lab ID.
7. Release assembly must pass `--runtime-report BOARD_OUT/rootfs-report.runtime.json`
   and `--package-manifest EXTRACTED_ROOT/usr/share/mos/manifest.tsv`, plus the
   matching captured `--baked-meta`, authenticated `--update`, full `--image`,
   firmware, public key, notes, board/version and owned output. Never substitute
   `build-inputs/manifest.tsv`. x64 uses the unchanged formal release CLI.
   virt-arm64 uses only the approved test consumer described below.
   Independently extract both actual SquashFS and factory OCI and run
   `python3 rootfs/runtime/select.py verify --root EXTRACTED_FACTORY --report
   BOARD_OUT/rootfs-report.runtime.json` (also for extracted SquashFS), with no
   omissions. Signed report consistency is not extraction evidence.

Before each allocated expensive command, L2 records the fresh capacity check,
exact source/package/tool/public-trust identity, board/job, owned timestamped
output and resource cap. B7 then launches it in the persistent-shell tmux,
reports `[gate-pending]` with command/source/UTC/log/exit metadata immediately,
and ends for L2 collection. There is no live heavy job at this checkpoint.

## Pinned verifier tool handoff

Read-only object checks passed for C source
`48acef7f1a3683b1f3bb6261911b1a5123197da2`, tree
`553c1e7af96203315f79e7ea61e862f7a753e3a5`. Both mode-100644 blobs match:
`checks-file-root.ts` = `6005fa89e7c5ab4e53e2bb72435dbe80d17f0b32` and
`checks-file-root.test.ts` = `58ee69d89c81942a18dd39e8d54815024e31887e`.
No C source was merged or copied into the B artifact baseline.

After fresh candidates exist, materialize a separate complete read-only snapshot
of that exact tool tree, with task-owned writable scratch, and run from it:
`bash verify/run.sh --verify --board BOARD --image FULL_FACTORY_IMAGE
--public-key EXACT_METADATA_PUBLIC_KEY --work TASK_OWNED_DIRECTORY`.
Record `verifierSourceCommit` separately from artifact source, the image/root
hashes and `/usr/bin/{mosd,apid,mos-deploy}` hashes, package linkage and nonzero
scannedFiles/scannedBytes. Retain exact embedded-resource attribution; no blanket
URL/domain exemption. The previously tested C suite and old sample are not rerun
or relabeled as evidence for these future candidates.

## Remaining acceptance and historical ownership

All rows below remain pending actual fresh artifact/guest proof. B coordinates,
B7 owns the software acceptance, and D owns historical/global status updates.
B4/B5 selected-file and composition evidence is accepted, not recreated here.

| Row | Current classification and required evidence |
| --- | --- |
| DATA system extension first boot | Historical STATE name superseded; loader/bind policy and fixture exist. Valid B4/B5 packaging coverage; B7 must observe the seeded unit marker on actual first boot. |
| Quadlet first boot and disabled condition | Independently valid; selected generator/resources and bind preserved. Require real first-boot container execution and disabled/declined policy result; system-unit marker is insufficient. |
| SSH listen conflict | Generator mask to `/dev/null` is delivered selected policy. Boot with `systemd.ssh_listen=` and prove conflicting generated socket/listener absent. |
| SSH image-only keys | Authorized-key policy is preserved. Independently accept the allowed image-policy key and refuse the alternative-key path; mask source is not authentication proof. |
| Login accounting | Old unbounded-var symptom superseded by `/run/mos` redirects and bounded `/run` policy. Verify effective mounts, targets, permissions and repeated-login writes for wtmp/btmp/lastlog. |
| Boot/deployment | Signed boot, signature/corruption refusal, selection/root-kernel-support agreement, root/kernel/combined upgrades, three-trial fallback, shared-storage recovery and record retirement. |
| Lifecycle | Actual PID1 switch_root/startup memory release, systemd and partial-startup argv/FD/child handoff, completed reboot/poweroff/halt after mount/DM/loop/backing teardown, actual/clamped watchdog and failed cleanup. Existing log checker never substitutes for observed guest action. Update success paths still need their final lifecycle evidence integration. |
| Memory/composition | Actual archive/native/retained/unique-root/SquashFS/verity sizes and provenance; runtime tmpfs allocation/inodes, process-tree startup peak and shutdown memory with feature-equivalent baseline. Capacity is not allocation/RSS. |
| Storage/authentication | SYSTEM 1 GiB, DATA staging, current final A/B records, whole-/var writable/bounded, unlimited /mos /srv /mos/containers bytes/inodes, private containers storage/tmp, reset isolation, authenticated tty2 and no autologin. |
| Selected services/devices | First/second boot persistence/permissions; actual udev/module indexes/devices/tooling; all applicable registered API phases including authentication, SSH/SFTP, DNS/time, MQTT and real selected container networking. No hidden skips. |
| Cold proof | Two independent serial equal-input virt-arm64 roots, unchanged source/package/tool inputs, complete byte and metadata equality; input drift reported separately. |
| A physical handoff | CX3576 coldboot, apid reboot/poweroff, watchdog, NOWAYOUT halt and physical power-cut integrity require A's exact affected source/artifact inputs and real board evidence. QEMU cannot close these rows. |

Service/native/reconciler defects outside B7 fixtures must name their exact
source/hunk to L2 before any repair. No stale historical symptom authorizes
recreating already delivered policy or removing the retained S5 shell/network
tools. The three historical detail files and their index statuses are untouched.

## Approved continuation: geometry and non-publication acceptance

L1's decision relayed by L2 on 2026-09-11 resolves the two earlier source-policy
blockers. Prior negative evidence stays preserved; no new proposal approval is
required. Continue the existing claim from clean caller commit
`64387f20d29405fa34790670b2e68e76593abb0b`, without any upstream/source import.
This continuation remains heavy=0 and does not allocate final artifacts/jobs.

- Sole geometry write ownership: `boards/x64/board.env` and
  `boards/virt-arm64/board.env`, only `SYSTEM_SIZE_MIB=1024` and
  `DATA_START_MIB=1537` in each; `build/src/file-layout.ts`, only an exact 1 GiB
  SYSTEM invariant for every current signed-file V3 board/backend;
  `build/src/file-layout.test.ts`, meaningful shipped-board/contiguous-small-or-
  large negatives plus current CX/S905 and reserve boundaries. Keep all other
  partition fields, firmware validation and capacity reserves. Commit this fix
  separately before final source freeze; no A board changes or wrapper override.
- Non-publication consumer: new `tests/file-ab-x64/provenance-acceptance.ts`,
  exercised through the existing Bun acceptance harness, and focused tests in
  `build/src/release-manifest.test.ts`. It must run the complete existing typed
  `assembleRelease` and `gateRelease` checks for virt-arm64/development/dev,
  deriving actual clean source identity with `sourceIdentity`, actual input
  hashes and current board evidence. A task-owned fresh output is required;
  a separate evidence record outside the gate's exact file set records
  `publicationEligible=false`. Emit `NON_PUBLICATION_ARTIFACT_ACCEPTANCE`, never
  release qualification. Normal CLI assemble and gate must both continue to
  refuse the same otherwise-valid candidate; no board-target flip, production
  CLI/function, sourceIdentity, Toolbox, signing or trust-policy edit. Prove
  tamper refusal for runtime report, provenance, image, update and firmware.
- Environment preparation: after owned cache users exit, resolve the unchanged
  Rust-check image and require full ID
  `sha256:f962663a6b90735118eb2ce954d3a457e1ba784b023fc346469927b5ecc3f0a1`.
  Run one bounded `cargo fetch --locked --manifest-path
  /src/pkgs/mos-deploy/Cargo.toml` with read-only source and only private
  registry/git mounts writable, then the original offline shutdown fixture
  once if fetch succeeds. Record source/lock/image/argv/UTC/log/exit identities.
  No alternate registry/toolchain, lock mutation or repeated retries.
- Resolve the source's pinned ARM64 Debian platform and run one short fixed
  target executable probe without host/source/device mounts. Record image and
  program architecture separately from builder-advertised platforms. No binfmt,
  shared-builder, host-emulation or privileged changes.

Verification order: geometry RED -> minimal GREEN plus layout/capacity callers;
non-publication consumer RED -> GREEN with normal CLI refusals and tampering;
owned environment checks at safe serial boundaries; scoped review/docs/diff.
Only necessary dependent fixture geometry may change; report any additional
production need before editing it. Final image, cold proof and physical rows
remain pending their original source/input/job handoffs.

The necessary dependent fixture is `tests/file-ab-x64/faults.sh`: its shared-DATA
corruption offset must move from 2561 MiB to 1537 MiB with the approved geometry.
The SYSTEM corruption offset and all fault expectations remain unchanged.

## Non-publication consumer contract and readiness

`tests/file-ab-x64/provenance-acceptance.ts` is a test-only artifact consumer.
Run it from the final frozen B checkout via the existing harness:

```bash
timeout 300 bash tests/file-ab-x64/bun.sh tests/file-ab-x64/provenance-acceptance.ts TASK_INPUTS_JSON
```

The JSON contains the existing `ReleaseInputs` fields: `out`, `board`, `version`,
`channel`, `profile`, `source`, `builderImages`, `image`, `update`, `firmware`,
`packages`, `meta`, `runtimeReport`, `notes`, `evidence`, and base64 public `keys`.
Use absolute input paths and a fresh task-owned output. This file contains no
private key. The source is the producer's exact frozen commit with dirty=false;
the consumer independently calls the unchanged read-only `sourceIdentity` on
its actual checkout before and after the complete typed artifact checks. There
is no CLI commit or checkout override. Inputs must be the same-source frozen
package/artifact handoff; this check does not reconstruct a build from bytes.

Only virt-arm64/development/dev is accepted. Builder declarations and board
evidence must match the frozen checkout byte identities. Both `assembleRelease`
and `gateRelease` run in full, including signed update/firmware, selected-root
manifest, shipped metadata marker, runtime image/verity and derived provenance
checks. The output directory's exact artifact set stays unchanged. A new sibling
`OUT.acceptance.json` exclusively records publicationEligible=false, actual
source, manifest/artifact SHA-256 mapping, public-key fingerprints and UTC.
The result is `NON_PUBLICATION_ARTIFACT_ACCEPTANCE`; it does not upgrade board
qualification or claim image/guest/physical acceptance. The real CLI continues
to refuse both assemble and gate for the same otherwise-valid virt-arm64 input.

The regression's separate clean Git fixture and signed small byte objects are
explicitly synthetic. They exercise actual source identity, ARM64 selector/
composition, typed checks and tamper refusals, not a fresh bootable image. Its
exported-function checkout argument is fixture injection; the operational CLI
always checks its own repository. No normal release function, sourceIdentity,
Toolbox, C verifier, signing/trust code or board publication flag changes.

The pinned Debian index was read without execution and SHA-256 matches the
committed index. It advertises linux/arm64/v8 manifest
`sha256:7215f78f35ffe58fe13f244fac9c4f21326d55187271fbb3e1a8aa5cc7e387ab`.
The actual requested ARM64 probe failed before its first program instruction;
ordinary local inspection reports amd64. Neither advertised platforms nor that
ordinary inspection proves target execution. Request an exact working ARM64
platform route from L2; no binfmt, host emulation or shared builder was changed.
`continuation-inventory.json` in the current evidence directory records that
both package pools, root/runtime/OCI outputs and BSP kernel inputs are still
absent. Rust fixture caches are now present, but are not release binary exports.

No heavy job has started. L2 must review/merge the caller, separate geometry and
consumer commits, then supply the exact integrated clean source, matching
selected package pools, native/BSP/support/tool/trust identities and per-job
capacity/output allocation. The two virt-arm64 cold roots must use that same
future source and pool. All fresh lifecycle/API/storage/historical rows and A's
physical rows remain outstanding as listed above.

## Approved identity refinement and API read-only handoff

L2's 2026-09-11 continuation preserves the reviewed caller and completed geometry/
consumer checkpoints. Source remains clean commit
`178a1ee1d285221546127865517ac30829ef9e86` before this tracking update;
no upstream merge or implementation retry is needed. Heavy=0 remains in force.

L2 explicitly authorizes reading the committed `pkgs/mosd/tests/apid-api/`
registration, phase imports, configuration, guest support and launchers to derive
the complete selected-feature command/conditions. Record actual gaps and current
source identities; do not edit API/product code, contact an endpoint, seed a guest
or run QEMU before a named allocation.

L2 also schedules exactly one evidence-refined ARM64 probe. Resolve the pinned
Debian index to its immutable arm64 child manifest/config, create one uniquely
named labelled container with no source/host/device mounts, inspect its actual
image/config, and copy only dash/dpkg ELF bytes into external owned evidence.
Require e_machine=183 and record their hashes before attempting the fixed short
program checks once. Preserve the original indexed-ref exit 255 as a separate
failure; this result is not a BuildKit or root-build proof. Retain the stopped
container briefly for exit-state inspection, then remove only that owned
container after confirming it stopped. No shared tags/builders/binfmt/host
emulation or privileged settings may change. Stop probe repetition on failure.

## Current API registration and exact pending job recipe

Read-only registration/launcher evidence is bound to software source
`178a1ee1d285221546127865517ac30829ef9e86`, tree
`3c932de591c777d98374c4e8e3d6e4a43bca7752`, in
`/tmp/mos-b7-refinement.vaDgut/api-inventory.json`. All inspected source bytes
match that commit. No API endpoint, guest, service port or physical interface was
contacted. The inventory reads `src/main.ts`; it never imports that executable
entry, whose final `await main()` would start the network suite.

| Order / registered phase | Actual coverage and required state |
| --- | --- |
| 01-spa-boundary | Fresh setup state, built-in UI/API route separation, served application entry, HTTP-to-HTTPS redirect, public health/version endpoints and retired form refusal. |
| 02-session | JSON setup, password floor, bearer/browser tokens, cookie attributes, CSRF logout refusal, logout and authenticated login. Leaves session/CSRF/bearer for later phases. |
| 03-api-management | Authenticated API reads/writes, CSRF/bearer controls and distinct terminal tasks for enabling container/MQTT/SSH settings. This is not a protocol connection or container-network test. |
| 04-network-observation | Live networkd observation and nonempty interface/state/address records; no DNS resolution, time synchronization or peer traffic. |
| 05c-kernel-net | Seeded guest smoke requires END plus eleven explicit conclusions: real generated key readability, state mount, three module resolutions, three link kinds, network account, key readability and secrets refusal. The helper creates permission fixtures itself and identifies that origin; it cannot close untouched first-boot ownership evidence. |
| 06-onboarding-claim | Setup claim persisted through the real API/store, no-import provisioning record, baked/operator/effective consistency and repeat-setup refusal. No provisioning-media import. |
| 07-update-rollback | Two authenticated distinct factory deployments, health confirmation, confirm/CSRF controls, retained-fallback retirement and repeat-rollback refusal. It deliberately does not reboot or install an upgrade. |
| 08-reset-recovery | Configuration-reset intent and refused full-factory/credential recovery without presence. It deliberately does not reboot or apply reset; physical-positive recovery remains separate. |

The eight entries above are the exact full registry. `MOS_APID_PHASES` must be
unset for final acceptance; `run.sh` then sends an empty `APID_PHASES`, which
means all phases. `APID_NEGATIVE` must be unset for the positive candidate run.
A selected or prerequisite-skipped phase is incomplete even if a wrapper prints
PASS. `src/report.ts` counts skips separately and can print PASS with skips;
B7 must require all eight phase IDs, every phase/check status pass, positive
assertion counts, totals.fail=0 and totals.skip=0 in `result-boot1.json` and the
merged envelope. No phase is silently removed to satisfy a missing feature.

The exact supported future command shape, after L2 allocation, is:

```bash
timeout 3000 env -u MOS_APID_PHASES -u APID_PHASES -u APID_NEGATIVE \
  MOS_BOARD=BOARD MOS_QEMU_IMAGE=FULL_FACTORY_IMAGE \
  MOS_QEMU_BOOT_CERT=EXACT_BOOT_PUBLIC_CERT MOS_APID_KEEP_DISK=1 \
  bash pkgs/mosd/tests/apid-api/run.sh
```

BOARD is separately x64 or virt-arm64. The image/certificate are absolute,
immutable, task-assigned paths; no placeholder value is runnable. The certificate
is the boot-enrollment public certificate, distinct from the metadata key used
by the artifact verifier. The harness derives the owned QEMU container's actual
address on the observed shared Docker network and forwards HTTP/HTTPS with
18443/18080 defaults. Do not guess `APID_HOST`, reuse another guest, borrow `_out`
or copy credentials into logs. Record the actual network/container/endpoint at
job start and bind it to the exact image and captured boot console.

`src/qemu.ts` enforces explicit regular image/certificate inputs and rejects
kernel append overrides. The launcher prepares a disposable 4096 MiB copy,
seeds DATA console/network units, and uses enrolled UEFI on q35/x64 or virt/arm64.
Its guest command uses two virtual CPUs, default 2048 MiB, an i6300esb watchdog
and `-no-reboot`. Readiness defaults to container discovery 240 seconds and
listener/health 900 seconds; backstops are 2400/2700 seconds. The wrapper builds
or resolves its lab/Bun tool images before boot, so their exact immutable IDs,
source mapping and any required resource allocation belong in the named job.
Its Docker containers have no explicit CPU/memory limit flags; L2 must specify
how the awarded capacity is enforced. No runner build was started here.

Outputs are task-owned `_out/BOARD/.qemu/` and `_out/BOARD/apid-api/`, including
prepare/seed/tool logs, console-boot1.log, suite-boot1.log, result-boot1.json and
result.json. KEEP_DISK=1 preserves the disposable disk for identity/after-state
collection. The existing merged envelope records image path/mtime/length but no
SHA-256 (`run.sh:777-795`), so B7 must additionally hash the input image,
certificate, source, tool images, seeded files, prepared disk and all result/log
artifacts. Stopping the QEMU container in `teardown()` is not completed graceful
guest action evidence and cannot close any lifecycle row.

### Concrete remaining API/service acceptance gaps

The current registry has no SSH authentication/SFTP transfer, DNS resolution,
time synchronization, MQTT publish/subscribe or real selected-container network
operation phase. Phase 03 only enables settings and observes task outcomes;
phase 04 observes network state. Existing `tests/file-ab-x64/runtime.sh` checks
Podman storage paths/volumes and private mounts, not container network traffic.
Those original B7 obligations remain independent rows and need exact controlled
peer/key/container-image inputs plus scoped fixtures in the awarded guest job.

`src/qemu.ts:114-120` supports an optional `MOS_QEMU_SSH_PORT`, but
`run.sh:461-470` does not pass that variable through QEMU_ENV into its container.
Setting it on the top-level command therefore does not establish an SSH route.
Report this precise launcher limitation to L2 before any change in the read-only
API tree; do not invent an endpoint or management-network override. Any needed
API launcher/phase edit requires a precise L2 write handoff; no product change
or general API phase rewrite is proposed by this inventory.

`HARNESS.md:11-12,30-35,82-84` and old launcher comments retain latest-image,
shared-_out and kernel-append instructions. Current `run.sh:42-43` and `qemu.ts`
are authoritative for this campaign: explicit full image/public certificate,
private DATA-seeded disk, no kernel append override. These historical docs were
not edited. The CI job runs only `os-apid-api-spec-pins`; it is not the live API
suite. No old published phase timing/result qualifies the future images.

## Joint wave and R1 authorized continuation (2026-09-11)

Campaign `mos-open-plans-20260910-100408`: L2 reviewed caller `64387f20`
and geometry `5ead2055` as PASS. Review round B7-R1 identified the actual pinned
outer-wrapper failure: `ENOENT: no such file or directory, lstat
'/srv/mos/.git/worktrees/75btxdqb'`. Only `tests/file-ab-x64/bun.sh` and a focused
identity fixture may change for this correction. Resolve checkout/gitdir/commonDir
outside the container, preserve the writable checkout and existing host route,
and mount required Git metadata read-only. Production sourceIdentity, Toolbox
and release policy remain unchanged. Verify the real linked-worktree route,
ordinary-checkout metadata protection and consumer entry beyond source validation.
Submit the isolated correction and clean checkpoint to L2 before joint merges.

The user-authorized joint wave replaces the earlier B-only freeze and one-B-job
serialization. After this source review, synchronize the exact reviewed local B,
then no-ff merge exact A `e4154126b7e38eb90db210adfb412b19535637a8` (tree
`04de9264c7eb0d190e13852955789ceea7439a71`) and full C
`48acef7f1a3683b1f3bb6261911b1a5123197da2` (tree
`553c1e7af96203315f79e7ea61e862f7a753e3a5`) in this same worktree. J remains
unformed. Preserve every original ancestor and all reviewed C production inputs,
including the six offline configuration/API/manifest/lock files. Mechanical
index/import/test unions must preserve sibling rows, status, ownership and
behavior. Semantic conflicts require exact evidence; no main access or merge.

The future matrix uses one J and one new image each for x64, virt-arm64 and
CX3576, with exactly two independent equal-input virt-arm64 cold roots and no
new S905 image. CX kernel/firmware reuse requires complete input equality;
previous A artifacts remain historical, never relabeled J. The independent C
verifier remains pinned to C-final separately from payload J. L2 schedules up
to two independent heavy jobs only after J/input manifests and the one-time L1
cross-workstream review. No heavy job is allocated in this source checkpoint.

The explicit ARM64 route is now authorized: preserve both unassisted Docker
failures; verify A's pinned BuildKit emulator and execute the identified Debian
ARM64 child once with an explicit read-only emulator, no network/capabilities,
2 CPUs and 512 MiB. A task-owned BuildKit replica may run one tiny target probe
using pinned v0.32.2, remote docker-container connection, labels and enforced
4 CPU / 10 GiB limits. Do not modify shared builders, binfmt or host state.
Actual package/root/image/guest production still waits for J and named jobs.

### R1 correction evidence

The outer wrapper now resolves canonical Git directories on the host and mounts
only `.git`/gitdir/commonDir read-only, retaining the existing writable checkout,
Docker socket and `/work`/`/root` host translations. Common-directory coverage
avoids duplicate child mounts. The linked gitfile is protected too. No production
sourceIdentity/Toolbox/release change is included.

Evidence directory: `/tmp/mos-b7-r1.9BVl5b`; per-gate JSON records source/tree,
working-file hashes, exact timeout command, UTC, exit code and log SHA-256.
The exact L2 command (`timeout 60 bash tests/file-ab-x64/bun.sh -e` importing
and calling production sourceIdentity) reproduced exit 1 and the unchanged
ENOENT at release-cli.ts:29 in `r1-original-red`. The focused wrapper regression
also failed both tests before the fix: missing linked metadata and writable
ordinary `.git/HEAD`. It opens existing metadata with `r+` without changing bytes,
so the RED does not alter Git metadata. Initial GREEN passed 2 tests / 13 assertions.
The final fixture additionally confines the writable-checkout test to a unique
owned directory. Original native, geometry, release, offline Cargo and unrelated
environment/baseline results remain unchanged. The clean committed consumer
entry check and explicit ARM64 route metadata follow in the continuation record.

PMA-CR reviewed the complete wrapper/fixture diff against `66cc7874`: no introduced
findings. The new fixture invokes the pinned wrapper, not a mock container or host
sourceIdentity bypass. Ordinary-checkout scope checks mount protection; the real
production sourceIdentity call runs on this actual linked worktree. Existing
release policy and tamper fixtures are preserved. Task/plan remain open.

## R1 clean checkpoint and bounded ARM64 route results

Isolated R1 correction commit: `fa817ca9b1bfe118c9ef4d5d98a1e87c20a63bc8`,
tree `8cace615cb023ebb560a0feb361cfffdfb1e3914`. Final wrapper regression passed
2 tests / 13 assertions; strict TypeScript, shell syntax, host-toolchain lint
422/422, docs and diff checks passed. Prior successful native/caller, geometry,
release and offline shutdown gates were preserved, not relabeled or replaced.

On that exact clean commit, the original pinned wrapper command returned
`{"commit":"fa817ca9b1bfe118c9ef4d5d98a1e87c20a63bc8","dirty":false}`.
The unchanged consumer CLI then used a task-owned negative fixture with that
actual source, exact committed board evidence and actual builder-image mapping.
It passed source/policy/evidence/tool checks and refused intentionally empty notes
inside typed assembleRelease: `Invalid release: empty release notes` (exit 1).
No artifact directory or acceptance record was created. This proves entry beyond
source validation, not complete artifact qualification. Evidence:
`/tmp/mos-b7-r1.9BVl5b/{r1-clean-identity,r1-clean-consumer}.{json,log}` and
`entry-proof.json`; the fixture path/hash and exact command are preserved there.

### ARM64 input and execution identities

All route evidence is task-owned under
`/srv/station/work/tmp/mos/75btxdqb/route-ICNGawQo/`; `/srv` paths map identically
to the Docker host. Per-step records include argv, UTC, source commit, stdout,
stderr, exit code and hashes. No private trust material is included.

- Debian source index: `d7e12182ce18b85b93007c1dedf31f2d29e01ccf3182cc4017c709b6259bc132`.
- Actual arm64/v8 child: `7215f78f35ffe58fe13f244fac9c4f21326d55187271fbb3e1a8aa5cc7e387ab`;
  config: `7e3898f7b011a107d0ef7393d5f604a6e0c0ff05ac4f2476630a8af21059ec9b`.
- Actual target `/usr/bin/dash`: 199256 bytes,
  `367967c823a0c391e5049b15a67c6a0a629c88b9b6dcdca75ef13ac9d65334b1`;
  `/usr/bin/dpkg`: 396184 bytes,
  `d8878dcd8949b2d18359b98082e18b2c3bb77f4cbe14e7a90f58b3fad2670e79`.
  Prior extracted ELF64 little-endian headers have e_machine=183. The successful
  BuildKit RUN independently reproduced both executable hashes in its output.
- Verified A emulator and the private daemon's own copy both hash to
  `239ff153cde81b6a6ab2c48eef9cff234751caa8e9d841363eace8db51e000e8`.
- BuildKit image: `moby/buildkit@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8`,
  actual amd64 / v0.32.2; installed Buildx v0.36.1. No floating-tag replacement.

The explicit Docker probe used the exact child and read-only emulator copy,
network none, dropped capabilities, no-new-privileges, 2 CPUs and 512 MiB. Its
shell command explicitly invoked the emulator again for dpkg. It exited 255:
`.buildkit_qemu_emulator: /dev/.buildkit_qemu_emulator: Invalid ELF image for this architecture`.
That invocation failed and was not repeated. It is separate from both prior
unassisted exec-format failures and the successful BuildKit route below.

### Private BuildKit RUN proof and resource retirement

Only one actual ARM64 RUN probe executed. The successful route used a private
labelled container `ai-agent-mos-wave-75btxdqb-arm`, builder
`mos-wave-75btxdqb-arm`, and labelled state volume
`ai-agent-mos-wave-75btxdqb-arm-state-icngawqo`. It exposed only the Unix socket
through `docker-container://ai-agent-mos-wave-75btxdqb-arm`; no TCP listener,
host/source/device/socket bind, shared-builder change or binfmt registration.
HostConfig verified NanoCpus=4000000000, Memory=MemorySwap=10737418240,
AutoRemove=true and exactly the owned state-volume mount. The source-approved
rootful namespace privilege remained confined to this daemon. Configuration
`[worker.oci] max-parallelism = 4` has SHA-256
`6d07b01fdf2dafa4aead7cfcca4e35036f8842349cd6e8e144b153eaec2b9063`.

For deterministic startup, configuration was copied into the created, stopped
container and verified before starting the image's original entrypoint. Buildx
remote create/bootstrap succeeded. Exact timeout-180 build argv and a tiny
Dockerfile are in `buildkit-prepared/arm64-buildkit-run.json` and
`buildkit-prepared/probe-context/Dockerfile`. The RUN used network none and
no-cache, executed dpkg, checked arm64 and both target ELF hashes, then exported
only three small evidence files. It returned 0 with
`ARM64_BUILDKIT_RUN_PASS`. Proof: `buildkit-prepared/buildkit-proof.json`.
This establishes emulated BuildKit userspace execution, not host binfmt, native
crun, system-QEMU boot, lifecycle, physical hardware or any final root/image.

Preserved setup/cleanup failures remain individually visible:

1. Initial read-only volume-absence parsing expected capitalized `No such`;
   Docker returned `no such volume`. No resource existed or was created then.
2. `timeout 30 docker ps --format '{{json .}}'` timed out (124, empty streams)
   before resource creation. The subsequent bounded inventory used explicit
   ID/name/image/status fields; no daemon/host setting changed.
3. The first private container's immediate post-start configuration copy failed:
   `Could not find the file /tmp/b7-buildkitd.toml in container 9a852383f08a78297296abfc553efe0f6e1f11f55556482376590d53471947e9`.
   No Buildx handle or RUN existed. That container and its empty volume were
   retired; the verified pre-start configuration sequence resolved the ordering.
4. After the successful RUN, immediate volume removal reported `volume is in use`
   while Docker auto-removal was settling. The enclosing script exited 1; it is
   not an aggregate PASS. Once absence was observed, a separate owned-resource
   cleanup verified labels and removed the volume successfully. The successful
   RUN was not replayed. `buildkit-prepared/cleanup-proof.json` records completion.

No private daemon, builder, state volume or detached gate remains. Resource
snapshots record 8 daemon CPUs / 33635225600 total bytes and approximately
297 GB free disk, with explicit per-container usage; these are snapshots, not a
future heavy-job reservation. Shared builders and A's historical proof remain
unchanged. The remote connection and worker setting follow the
[Docker remote driver](https://docs.docker.com/build/builders/drivers/remote/)
and [pinned BuildKit configuration](https://github.com/moby/buildkit/blob/v0.32.2/docs/buildkitd.toml.md).

### Next dependency boundary

L2 must review this isolated R1 correction and the already delivered consumer
before the authorized exact A/C joint merges. Local B is still
`ebdd7208f3c026c96e08d003d9d4f383c22f1eb9`; J does not exist yet. The route proof
removes a generic BuildKit ARM64-route blocker but supplies no selected package
pool, native release export, trust material, kernel equality manifest or fresh
artifact. Actual joint input freeze, one-time L1 source review, named heavy jobs,
full provenance/image/verifier/API/runtime/cold proof and physical bench rows
remain pending. No passed expensive matrix was repeated and no expensive
package/root/kernel/image/guest production was started.

## Authorized API launcher continuation (2026-09-11)

Campaign `mos-open-plans-20260910-100408`: L2 independently reproduced the
missing outer-container SSH forwarding input. It authorizes only conditional
propagation of a supplied `MOS_QEMU_SSH_PORT` into QEMU_ENV in
`pkgs/mosd/tests/apid-api/run.sh`, plus a focused regression in
`tests/file-ab-x64/api-launcher.test.ts` and necessary adjacent fixtures.
Preserve unset behavior, raw supplied values, source/image/certificate/board
arguments and all eight phases. Existing qemu.ts performs validation; do not
add another port parser. No guest, port opening, API product/service/registry
change or heavy job is authorized in this source phase. This is a new evidenced
caller obligation; the B7-R1 corrective count remains one.

Use byte-for-byte copies of the real launcher and qemu.ts in an owned fixture
checkout. Isolate Docker/build boundaries and observed networking; send the
actual launcher-generated container environment to the actual qemu.ts capture
path on an existing tiny fixture disk. Record the planned inner Docker argv
without executing Docker or QEMU. RED/GREEN must cover both boards, a supplied
port, absence and existing invalid-value refusals. Commit this correction
separately after focused tests/type/shell/docs checks and PMA-CR review. Retain
all independent service-traffic, actual reboot/reset and physical rows.

### API launcher correction evidence

The source change is exactly three lines after QEMU_ENV: append the supplied
`MOS_QEMU_SSH_PORT` verbatim when the variable is set. No default, coercion or
additional parser is introduced; absent remains absent. The original qemu.ts,
phase registry, service policy and image/certificate/board arguments are unchanged.

Evidence: `/tmp/mos-b7-api-launcher.Uoeguq/<gate>.{json,log}`, with exact commands,
UTC, source/tree, working-file identities and log hashes. Before implementation,
`timeout 120 bun test tests/file-ab-x64/api-launcher.test.ts` returned 1: 2 pass,
8 fail, each supplied value missing at the outer boundary. After the three-line
fix it returned 0: 10 tests / 134 assertions. The same ten cases passed through
`timeout 120 bash tests/file-ab-x64/bun.sh test tests/file-ab-x64/api-launcher.test.ts`.
Strict TypeScript for both new fixture files, bash syntax and diff checks passed.

The fixture copies real run.sh/qemu.ts and board inputs byte-for-byte and executes
them. It isolates the expensive images.sh and Docker boundary, supplies a local
Unix socket plus simulated network observations, and reconstructs the inner
environment solely from actual `-e` arguments. To reach the existing forward
validator without disk production, it invokes real qemu.ts capture on an existing
tiny private disk. Inner Docker is recorded and deliberately exits 73. The outer
harness deliberately fails before preparation/guest/API phases; that exit is not
an API or boot PASS. Unset has no SSH forward; 22345 survives to both HOSTFWD and
Docker port argv; 0/non-numeric values reach `Invalid positive integer`, 65536
reaches `Invalid forwarding port`, and invalid values never reach inner Docker.
The fixture Docker executable never delegates to the real daemon; the pinned
run uses only the existing Bun tool container. No TCP listener, guest or service
is started. Temporary fixture files/socket are removed after every case.

PMA-CR inspected the three-line source hunk and complete two-file fixture;
PASS, zero introduced findings. This is the separately authorized launcher
obligation, not another failed R1 round. Existing R1/geometry/caller/provenance,
ARM64 BuildKit and earlier negative evidence are retained without replay.

### Service-input preparation for the eventual J manifest

Preparation only; no endpoint is live and no key has been installed. Public
input manifest: `/srv/station/work/tmp/mos/75btxdqb/service-inputs-I5cyEHJc/public-inputs.json`, SHA-256 `24a8096f4235d4168f244d281e0637a02bd8098623b0ae321597b658583dce9d`. Its exact read-only image queries
and timeout-30 key-generation commands are in sibling `steps.json`; the parent
source-bound `service-inputs` gate is under the API launcher evidence directory.
The four Ed25519 keys are task-owned, separated by board and allowed/alternative
role, with mode-0600 private files in a mode-0700 directory. Only public-file
hashes/fingerprints enter these records; these are not boot/signing keys or
existing system credentials. Rebind the source-key/image selection to actual J
before allocating their use.

| Board | Role | Actual public-key fingerprint |
| --- | --- | --- |
| x64 | allowed | `SHA256:WAkNB8+bZ0nj+ArrfNS08uIxmk/QwxeJ1+ZQSmGQcoc` |
| x64 | alternative | `SHA256:+0eS7UcH7dnFQSiePP8tFyeLH71hCN+0bDN67m8OBMM` |
| virt-arm64 | allowed | `SHA256:JGMexfoiWWfwYpLRWYoM0i/NJwh475uehH1QIf8lX3o` |
| virt-arm64 | alternative | `SHA256:cWe4XWQUrx1s0DNPpVKZODZihohCRbgKsXTIKoe3VAQ` |

The proposed selected-container network fixture uses the already source-pinned
IMAGE_ALPINE_3_21 index, with architecture-specific immutable children:

| Architecture | Child manifest | Config |
| --- | --- | --- |
| amd64 | `alpine@sha256:f27cad9117495d32d067133afff942cb2dc745dfe9163e949f6bfe8a6a245339` | `sha256:2607caa9805847fac4de202017bb1b830deb09f4c07dc9964a0157abbc604577` |
| arm64 | `alpine@sha256:1832327faf048390adc33852575d37c7ba155e064a339e78b9bd81983a8c7a00` | `sha256:2155344e09b47f8ea09459100e050bed74b5202316318fd0ad0f7f6856089efc` |

These are verified registry index/manifest identities, not proof of a pulled
OCI archive, target executable, selected guest runtime or container network.
The eventual named job must freeze the exact archive/image content used by the
guest, including architecture and loaded digest, before network assertions.

The SSH/SFTP command recipe, after a named guest/port/account allocation, is
`timeout 30 ssh -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none
-o StrictHostKeyChecking=yes -o UserKnownHostsFile=TASK_KNOWN_HOSTS
-i TASK_BOARD_ALLOWED_KEY -p ASSIGNED_SSH_PORT ACCOUNT@OBSERVED_GUEST /usr/bin/true`.
Use the separate alternative key with the same endpoint and options and require
an authentication refusal, not a timeout or network failure. The positive key
must be installed only through the selected image/managed authorization policy;
the alternative default-location key must not grant access. Capture the host
public key through the authenticated owned guest/console path and pin it in the
task known-hosts file. Do not use an unverified ssh-keyscan or ignore host-key
checks. SFTP uses `timeout 30 sftp -b TASK_BATCH -P ASSIGNED_SSH_PORT` with the
same explicit identity and host-key options; batch put/get/remove a unique
campaign file in the assigned writable test directory and compare both hashes.
The placeholders are mandatory recorded job inputs, not runnable defaults or
guessed endpoints. No SSH/SFTP command was executed during preparation.

For the container network row, use only the board's frozen child/image digest
with the selected Podman/crun runtime. A task-owned HTTP peer should return a
unique campaign payload whose exact bytes/hash are captured in the job manifest;
record the peer container identity, network attachment and observed address,
then run the selected guest container against that peer and compare received
bytes/hash. Keep HTTP success separate from DNS, storage and native-runtime
qualification. Peer startup, guest image transfer and its exact executable
wrapper remain job preparation inputs; no service was started here.

Controlled DNS responder, NTP responder and MQTT publisher/subscriber tool
images/configuration have not been supplied by the registered eight phases or
an existing traffic fixture. Their exact program/image/config hashes, selected
guest broker/authentication policy, packet/request/response capture and cleanup
commands remain concrete missing J-job inputs. Do not invent tool digests,
peer endpoints, credentials or a traffic PASS from phase-03 setting enables.
The runtime-build.sh helper modifies/repackages a root and image; its earlier
fixture results cannot qualify the joint wave's immutable final image. New
scenario scripts must run from DATA-seeded units on disposable copies of the
one board image, using the existing seeding path, without rebuilding an image
per scenario. Actual rollback reboot, reset application, firstboot/Quadlet,
accounting, lifecycle and physical rows remain separate pending evidence.

Final source gates: host-toolchain lint 424/424, docs and staged diff checks
passed in `launcher-final-gates`. No full unrelated suite was replayed.

## Reviewed upstream sync and pre-J input inventory (2026-09-11)

Campaign `mos-open-plans-20260910-100408`: L2 accepted R1 `fa817ca9` and
`6049df8f`, including the earlier caller, geometry and non-publication consumer.
Corrective count remains one, resolved. At a clean boundary, verified LOCAL B
`53fc261f66aba95b9b0b03b4edbadadfb9ffc6e6`, tree
`bdb81b568558f272f23275f728898eb721ed13e2`, and merged it with `--no-ff` as
`53eeee9dd2df23cc9a191e9e5d0f7b67703e11e0`. The resulting tree
`cc020280a5f6a9855847836688480cacbbce181b` exactly equals the preceding API
checkpoint `d691708827994a36b9f2015c503c785d61120860`; no conflict or source
change occurred. Merge metadata: `/tmp/mos-b7-upstream.x9SubY/merge.json`,
SHA-256 `08691ae9db26f6810845bf2067ea49157e623cd19e974d5325abfe0a8d28ac79`.

The isolated API correction is still submitted for L2 review. Its original
RED/GREEN and five-file identities remain at
`/tmp/mos-b7-api-launcher.Uoeguq/delivery.json`, SHA-256
`a94ea8de17cf9ae99aa20057ba8c03f32068a3cc30aafd7497f9d0e423f9d510`.
No unchanged API, Rust, route or consumer suite was replayed after this
tree-identical sync. Exact A/C merges remain authorized after this remaining
source review boundary; neither is merged here and J is still absent.

### Current immutable candidates and missing inputs

Read-only inventory on clean `53eeee9d`:
`/tmp/mos-b7-wave-inputs.DalRgH/readiness.json`, SHA-256
`d1839b7c4f7526bbfed49d4e7dfdd1f72a9e7622420b81a13bf26a9f6fd65876`.
It records 233 committed source/config/lock/selection files, actual selected
package names and producer definitions, all six required C production blobs,
the separately pinned C verifier blobs, tool-image IDs and exact missing paths.
These are pre-J observations, not a frozen package manifest or J qualification.
All files under `rootfs/debian/packages/` and the debootstrap helper pin are
hashed; both target package records remain available in their committed JSON.

| Board | Architecture/profile/radios | Selected packages | Current package/artifact availability |
| --- | --- | --- | --- |
| x64 | amd64 / dev / none | 11 | Indexed pool, external kernel, root report/verity/factory OCI absent |
| virt-arm64 | arm64 / dev / none | 11 | Indexed pool, external kernel, root report/verity/factory OCI absent |
| CX3576 | arm64 / dev / wifi, bluetooth | 14 | Indexed pool and root outputs absent; historical kernel/firmware candidates verified below |

All selected features are retained; no declined feature or optional component
was added. SYSTEM is 1024 MiB in all three definitions; DATA starts at 1537 MiB
for x64/virt and 1042 MiB for CX3576. Publication targets remain 1/0/1.
Actual resolver stdout hashes and per-package producer mapping are in the
inventory. ARM64 sharing requires equal complete inputs and matching J package
stamps; the architecture alone does not permit reusing a root or an old pool.

The source resolver found both architectures' local base/C/Go/Rust/Deb images
and the amd64 OpenSSL image. Each actual ID, architecture and RepoDigest was
captured with bounded `build-env/from.sh --arch=ARCH --ref KEY` and Docker
inspection. `LOCAL_MOS_BUILD_OPENSSL` for arm64 returned 1: the local image is
absent; exact stderr is retained. `verity-tool.sh` selects its host architecture,
so the present amd64 tool is its current route. No arm64 OpenSSL build, floating
replacement, registry pull or toolchain installation was attempted. Local tags
are observations; freeze the actual image/lock/config identities again for J.

CX3576 compiled manifest
`/srv/station/work/tmp/mos/1zjiu5h5/recovery-1/compiled/SHA256SUMS` matches the
approved SHA-256 `9aab7b62df43ed349728e4f24d4041b557392d28c16a20fd7ef001eee349af0e`;
all 42 listed files passed actual byte/hash checks, including Image, DTB,
modules, config and debug objects. The 28 recorded kernel-source/support-input
files are identical between compiled source `38a362cd` and approved A `e4154126`.
Current B differs in A's kernel build/patch/fixture files because A is not yet
merged; this is expected pending ancestry, not a newly introduced defect.
The staged public content certificate SHA is
`101209c31085b09853c688d64c374d899ab904d508a4f69f0ae9b676c4ea0212`.
Preserved Buildx provenance records kernel pin `c6157104418d012823413c02f9222f3fe123dd25`,
version 6.1.115, Ubuntu index `33ceb719...`, frontend `ecfaec9e...` and the original
build arguments. Final J equality, actual compiler/package-version evidence and
joint signing-anchor selection remain required before claiming reuse.

The historical A image's actual firmware segment at offset 32768, length
9394688, hashes to `1386f1ce5263fa66b04ee3cab2f40d19802dac923f477f4691968b31c6a1af05`,
matching its preserved firmware identity. No live-main source or signing key
was read. Firmware source/config/patch/tool/trust equality and the explicit
joint boot-key/public-metadata mapping remain pending. This segment is historical
source `9d1218e2`, not J; none of A's old native/root/support/image bytes qualify
the new payload. Fresh J init/shutdown and dependent authenticated components
must be produced even if Linux Image/DTB/modules or firmware are reused.

The first inventory command completed with exit 0, retaining every command's
UTC/argv/stdout/stderr/exit code. Its detailed inventory initially used the
runner metadata filename and was overwritten by the runner's completion record.
`reconstruct.py` regenerated the detailed record from those hash-checked captured
outputs plus unchanged committed/local artifact bytes; no resolver or Docker
command was replayed. Both scripts, original log/metadata and reconstruction
metadata remain in the same evidence directory. This is evidence bookkeeping,
not a package build or a new source corrective round.

### Current joint job recipe boundary

The earlier B-only builder/serialization recipe is historical. The approved
route is now the private pinned BuildKit daemon, 4 CPU / 10 GiB per job with
worker parallelism 4, at most two allocated independent jobs after fresh L2
capacity checks. Its accepted ARM64 RUN and completed cleanup are retained;
no daemon/state, detached gate or new production build is left running here.

The actual discovered producers support a bounded package wave: build
`ca-trust`, `profile`, `system`, `bluetooth` and `wifi` once with `--arch all`
before parallel architecture jobs, since those invocations export to both
pools. Build `busybox`, `deploy`, `mosd`, `mqtt` and `podman` for each required
architecture, then `board-x64` for amd64 and `board-virt-arm64`/`board-cx3576`
for arm64. Use the existing `bash build-env/deb/build.sh --producer NAME --arch
ARCH` with the explicitly allocated `BUILDX_BUILDER`; index using existing
`bash build-env/deb/repo.sh --arch ARCH`. Producer PREPARE hooks and all declared
build contexts must be frozen from J before execution; this inventory does not
grant an implicit kernel, toolchain or package build.

Root command shape is `timeout 7200 env MOS_BOARD=BOARD MOS_PROFILE=dev
MOS_ROOTFS_NO_CACHE=1 BUILDX_BUILDER=ALLOCATED_PRIVATE_HANDLE bash rootfs/build.sh`.
This uses the existing root wrapper with no layout/output override. Actual
board source snapshot, public metadata, selected package inputs and output
paths must be bound in the named job. Exactly two independent equal-input virt
root runs remain; run 1 supplies its single candidate image, run 2 has separate
private state/output. No second x64 cold run or new S905 image is proposed.
Native/component/release command contracts above remain current; runtime-build.sh
repacking is excluded from qualification of the one final image per board.

Still missing: actual reviewed J and one-time L1 cross-workstream review;
J-stamped pools and complete selected archive/index digests; native release and
BusyBox outputs; x64/virt kernel/firmware equality handoffs; exact public trust,
signing input locations and shipped metadata; immutable source/output layout;
controlled service-peer inputs and exact named L2 job allocations. Runtime,
fresh authenticated verifier, extraction equivalence, cold and physical rows
remain open. Only own task/plan records change at this checkpoint.

## Joint source integration and candidate J (2026-09-11)

Campaign `mos-open-plans-20260910-100408`: L2 accepted API correction `d6917088`
and dispatched immediate integration. No reviewed source defect remains;
corrective count stays one, resolved. At a clean boundary, verified LOCAL B
`c2861fdfa347a819092e77f33daf2391a47d6396`, tree
`cc020280a5f6a9855847836688480cacbbce181b`. Completed these local no-ff merges,
preserving the preceding `53fc261f` synchronization and all B7 history:

| Merge | Exact incoming commit | Result |
| --- | --- | --- |
| Reviewed B API source | `c2861fdfa347a819092e77f33daf2391a47d6396` | `a4e48a6f568a3c44d3fc60ba5bbe0d27bd6ce634` |
| Full reviewed A | `e4154126b7e38eb90db210adfb412b19535637a8` | `6e8e6bf1ffc1ac4551a68a0603b7525bdebf7128` |
| Full reviewed C production source | `48acef7f1a3683b1f3bb6261911b1a5123197da2` | `e176876b733d675d1e20b40b42628cd4e18b197d` |

Candidate J is the actual clean final merge
`e176876b733d675d1e20b40b42628cd4e18b197d`, tree
`7e8e8bc62b52f3d78263d717e186a07f0d3430a1`. This candidate awaits L2 review and
the one-time L1 cross-workstream review. Subsequent task/plan-only commits do
not change this payload-source identity; production must use a clean snapshot
at J, not a later documentation HEAD or an overridden package stamp.

Both merges conflicted in the task/plan indexes. The granted mechanical union
retains every row from both parents verbatim and exactly once, with no status,
owner, priority, title or link changes. Final indexes contain 114 task rows and
67 plan rows. D still owns reconciliation. C also conflicted at the single
`acceptProvenance` import in `build/src/release-manifest.test.ts`: retaining the
required B7 import produces a file byte-identical to reviewed B7. No test or
behavior was removed/duplicated, and no production correction was needed.

`/tmp/mos-b7-joint.rggwkleq/joint-source-proof.json`, SHA-256
`03e033fb6e9163d4cbaa6090a2e3a7c2027e65bb46ee34ec1ed20c019fdff4ee`, records
the exact modes/blobs for 1827 non-index files, each matching an authorized
input. All required A/C/B/API/caller/geometry/consumer/R1/#313/Git-handoff
ancestors are present. C's six required production blobs and both independent
verifier blobs match reviewed C exactly. The only mosd-tree difference from C
is the reviewed API launcher correction; build/rootfs/mos-deploy remain exact B
source. There is no new Rust integration delta requiring a repeated workspace
matrix. PMA-CR reviewed the actual conflicts, unions and source provenance;
no introduced finding or additional code-correction round.

### Merge gates and retained diagnostics

Evidence lives in `/tmp/mos-b7-joint.rggwkleq/`, with original merge streams,
three-stage conflict snapshots, commands, UTC, source/tree, exit codes and hashes.
The persistent shell is `75btxdqb-7e0f1b`; no production build ran in it.

- `timeout 180 bash build/run.sh src/release-manifest.test.ts -t non-publication`
  passed typecheck, nonzero-test guard and 3 tests / 45 assertions. The 48 other
  cases are explicitly filtered; this is only the import-affected focused gate.
- The real pinned `tests/file-ab-x64/bun.sh` sourceIdentity command returned
  exact J and `dirty=false`. It did not assemble a real release artifact.
- `timeout 120 make docs-verify` and `timeout 30 git diff --check HEAD^ HEAD`
  passed on clean J. No passed ARM64 probe or unchanged full suite was replayed.
- A's initial full staged `git diff --cached --check` returned 2 on the two
  unchanged imported `.patch` files. Original output is preserved in
  `A-union.json`, including `0005-mpp-rkvenc2-rk3576-fixed-rate-opp.patch:14:
  space before tab in indent.` and
  `0006-fbcon-retain-and-restore-board-logo.patch:150: trailing whitespace,
  space before tab in indent.` These are original patch/context bytes;
  every non-index A import was verified against its reviewed blob. The actual
  index-union diff check passed. The full staged check is not labeled PASS.
- The initial external gate launcher had a shell quoting syntax error after
  the focused consumer completed. The original script and syntax exit 2 are
  retained; only the remaining identity/docs commands were then launched.
  The input-manifest helper's first invocation had an unmatched-brace syntax
  error before any commands executed (exit 1); its original script/log remains.
  The corrected helper completed with exit 0. These are execution/evidence
  diagnostics, not product behavior REDs or hidden source corrective rounds.

### Board-keyed job inputs bound to candidate J

`/tmp/mos-b7-joint.rggwkleq/J-job-inputs.json`, SHA-256
`c8d5eacaccc4dec388e3647d4b66e450da99625691779c94e6d4587ad1aaefbc`, binds all
three board definitions, profile/radios/feature selections, current locks,
producer definitions/PREPARE hooks/declared context trees and tool identities
to actual J. Resolver outputs remain 11/11/14 selected packages. Actual local
tool IDs were re-inspected without target execution; no ARM route probe was
repeated. The mosd Cargo.lock SHA is
`b128a26205660c81cd770192bc324bf4569ef46f2377d3648073ab1e323a131f`;
the native lock remains
`816a21311421587b088bc65239c1489998db43421e458d2f163a180af13a049e`.

Planned source snapshots, frozen pools and outputs are under task-owned
`_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/`. They are not created yet.
Every board row records supported producer/native/root commands, source-local
wrapper output and disjoint artifact directories, followed by package-to-root-
native/support/signature/image/verifier/runtime dependencies. Shared package
commands are references to one job per producer/architecture, not repeated
invocations per board. `all` producers run once before architecture jobs because
they export both pools. Missing pools and native/root/image hashes are explicitly
outputs to produce, not absent immutable prerequisites or invented old stamps.

All 28 recorded CX kernel inputs now equal compiled source `38a362cd` at J.
A bounded, read-only, mount-free metadata query against preserved image
`sha256:2da9f07e885f4ddff2f0a66493782a6f62cc241cf11de170ad0c27f5ca78d3cb`
recorded actual cross-GCC 13.3.0 and its complete installed package inventory;
this was not a kernel/root build or target-emulation probe. Original artifact
hashes and compiled provenance remain in the manifest. The content certificate
candidate is the previously verified `101209c3...` public anchor; final joint
signing-input mapping is still required. CX firmware has verified historical
bytes but still needs complete compiled-source/tool/trust equality. No x64/virt
external kernel/firmware handoff has been supplied. No borrowed kernel rebuild
or historical payload relabeling is scheduled.

### Exact execution-envelope and remaining allocation requirements

The private BuildKit cap does not contain siblings launched directly by
production hooks. Read-only inspection identified these job-readiness rows:

| Existing source operation | Required named-job execution boundary |
| --- | --- |
| `pkgs/mosd/hack/build-deb.sh:180` direct Rust Docker run | Add actual CPU/memory limits, unique task name and explicit traefik network in the task execution envelope; preserve locked compiler/source/target/cache inputs |
| `pkgs/mos-deploy/hack/build-deb.sh:134` direct native Docker run | Enforce actual sibling CPU/memory caps; current name/network/label do not provide those limits |
| `build/src/kernel-package.ts:25` and boot-tool build routing | Bind exact task-owned boot/FIT tool images and sibling names/caps without replacing shared fixed tags; preserve measured packager identity |

These production paths were not edited. L2's concrete allocation must cover
their execution routing, not assume BuildKit daemon limits cover direct Rust or
packaging containers. The J boot packaging tool must contain the current static
early-boot BusyBox and native shutdown closure; selected `mos-busybox` is a
separate runtime Debian package. No old tool payload substitutes for the new
closure. Existing wrapper contracts, signing checks and release policy remain.

Still pending: candidate review and one-time L1 joint review; exact public
metadata/boot/content/signing input mapping; external kernel/firmware equality;
the task execution envelope and fresh capacity/job allocation. The prepared
SSH public identities and Alpine child digests remain uninstalled candidates.
Controlled DNS/NTP/MQTT peer programs/configs, guest account/host-key/port and
container archive identity remain specific runtime job inputs. Missing peers
did not delay source integration. Every original guest/physical/teardown/cold
row remains open, with one final image per required board, only the second
independent virt root, and no new S905 image or physical qualification.

## Granted automatic wave and first actual outputs (2026-09-11 09:04 UTC)

The 08:43 UTC L1 final review accepts J
`e176876b733d675d1e20b40b42628cd4e18b197d` and authorizes W0-W4 without
per-producer approval. The later recovery relay directs immediate execution.
The earlier pending grant rows are historical. Execution uses independent J
checkouts under `W/sources`; documentation HEAD does not label payloads.
`W` is `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d` in this worktree.

W0 is now complete: the five original all-architecture producers and both
original index commands exited 0. Seven J-stamped packages have identical bytes
in the amd64 and arm64 pools. Exact source/tool/script/resource/command/time/log
and output evidence is in `W/metadata/W0.json`; immutable consumer copies and
hashes are bound by `W/metadata/W0-delivery.json`. The task record carries both
manifest hashes and the original recorder environment failure. The producer
sources were unchanged and clean after execution. No architecture-specific
package, root, signature, image, guest, API or physical result follows from W0.

Continue W1 with the frozen shared packages and the existing named architecture
producer sets. The grant permits at most two freshly capacity-checked jobs,
each with an aggregate 4 CPU/10 GiB/no-swap envelope. Direct siblings and private
BuildKit execution divide that same envelope. Preserve task wrapper bytes and
actual resolved tool identities; no shared tag changes. The read-only public
trust capture is an available input, while pairing/schema proofs precede actual
signing/root staging. Controlled service setup does not gate package production.

For W2, x64 and CX use `MOS_ROOTFS_NO_CACHE=0`; virt-arm64 run1 and its sole
independent equal-input run2 use `MOS_ROOTFS_NO_CACHE=1`. This corrects the old
x64 draft value. Reuse the approved unchanged CX Linux export. Required pinned
x64/virt kernel production is authorized if complete input equality cannot
establish reuse. Build one final image each for x64, virt-arm64 and CX; use
disposable copies for scenarios. The independent C verifier stays pinned to
`48acef7f1a3683b1f3bb6261911b1a5123197da2`. All earlier distinct lifecycle,
storage, authentication, API, runtime-memory and physical limitations remain.

## Installed-device capture correction (2026-09-11)

L2 authorized diagnosis and one bounded integration correction after x64 W2
refused `unsupported node: /installed/dev/console`. This uses the existing
approved task; the prior B7 review corrective count is 1. Preserve both frozen
J source checkouts, every successful package/cache input and all failed root
logs. The independently completed virt cold run1 also reports this refusal at
J; it was not interrupted or restarted and is not successor-source evidence.

The immutable 10-compose OCI layers contain eight character devices in their
first layer, before 90-pack runs. Their paths, device numbers, mode 0666 and
root ownership match `setup_devices_simple` in the exact pinned debootstrap
1.0.141 input. They are installation content, not devices injected into the
capture executor. The layer and helper-source evidence is in
`W/metadata/W2/device-capture/layer-audit.json`.

Limit the correction to `rootfs/runtime/compose.py` and focused regressions in
`tests/rootfs-runtime/composition_test.py`: record these exact bootstrap
character-device inodes in the disposable installation snapshot and transfer
comparison, without copying them into the selected runtime tree. Keep
`select.py` and its strict unsupported-node refusal unchanged. Reproduce the
old snapshot refusal first; then cover complete metadata/transfer equality,
selected-device refusal, wrong identity/ownership/mode, and unrelated special
nodes. Do not ignore a subtree, remove input devices, or change board/runtime
policy. Review with PMA-CR and run the affected runtime suite and docs gate.

Commit the source correction separately for L2/L1 review. It changes build
composition inputs, so no new production root may consume it until the narrow
successor source and truthful unchanged-package reuse are reviewed. Do not
rename J-stamped packages or treat either failed J root as a successor result.

The minimal patch and five focused fixtures passed, as did the complete
85-test runtime suite and reproducibility contracts. No Dockerfile, selector,
package producer, lock, trust, board or signed-artifact policy changed. The
eight bootstrap identities are checked, not ignored; transfer metadata is
retained and final runtime special nodes still refuse. The pending source
checkpoint is a candidate successor to J, not permission to change frozen
checkouts or attribute old outputs to that successor.

One precise source/freshness boundary needs L2/L1 disposition with this patch:
`rootfs/build.sh:313-317` compares the pool's Git stamp against
`build-env/deb/version.sh` for the current checkout. The successful pools retain
`gite176876b733d-1`; a successor checkout necessarily has a different stamp.
Although this patch leaves package recipes and payload source unchanged, the
driver also derives package version and source epoch from Git identity.
Therefore complete equal-input package reuse must not be asserted merely from
unchanged recipe files. Preserve existing package bytes and original identities;
do not rebuild successful producers, override the check or rename stamps.
Request a precise reviewed lineage/consumer boundary through L2 before a new
production root. The failed virt run remains a J result and cannot be reused
as the first half of an equal-source successor cold comparison.

### Approved package and composition source lineage (2026-09-11)

The existing full-tier approval now covers the exact L1 package-lineage decision relayed at 12:05 UTC. Package source remains e176876b733d675d1e20b40b42628cd4e18b197d and version 0.1.0+gite176876b733d-1; composition source will be the real clean successor containing the reviewed device capture correction and this consumer change. Original package, control, index, native and kernel bytes keep their original identities. The completed x64 kernel is collected and must not be rebuilt; the independent immutable-J ARM kernel remains untouched.

Implementation is limited to rootfs/build.sh source selection/staging, a new rootfs/runtime/source-lineage.py verifier, compose-capture.sh transport, compose.py report binding, release-manifest.ts strict consumption, and their directly affected Python/TypeScript fixtures. compose-install.sh changes only if transport requires them. An explicit clean ancestor checkout and a SHA256-pinned frozen component receipt authorize reuse; an exact checked-in composition-only path policy rejects every other tree delta. Actual Git bytes/modes, package controls/indexes, tool and receipt identities must verify before the container boundary. Default same-source refusal remains.

The deterministic private capture records separate full package/composition commits, trees and epochs, the root epoch, architecture, frozen pool/control digests, verified input receipts and exact path/blob/mode delta. Runtime and derived release provenance must consume those roles and bind the capture bytes. No private runtime configuration or policy bypass is introduced. Real Git/pool/caller RED/GREEN covers source, ancestry, input/tool/lock, archive/index, architecture, epoch/version and capture/release tampering, including equality across disjoint paths.

The original real J-pool/successor stamp refusal remains RED evidence. No production root uses changed source before B's review and the actual successor freeze. Two successful independent virt-arm64 cold roots must use the same final successor and equal package/tool/config/trust/root-epoch/lineage inputs; the two failed J roots do not qualify. W0/W1 and completed kernels are retained, not relabelled or repeated.

### Lineage implementation and validation checkpoint

The consumer now verifies full clean Git trees (including executable modes and hidden index changes), ancestor identity, the exact composition-only delta and producer context boundaries before running the package version script or any container. Existing permitted files cannot change type/mode or disappear. Explicit reuse requires `MOS_ROOTFS_PACKAGE_SOURCE`, `MOS_ROOTFS_PACKAGE_RECEIPT`, and the externally frozen `MOS_ROOTFS_PACKAGE_RECEIPT_SHA256`; the receipt binds original producer evidence, every recorded input, actual immutable tools, both native exports, all archive/control identities and the complete indexed pool. These are verified input facts, not an approval flag. `GIT_OPTIONAL_LOCKS=0` preserves read-only Git metadata. The original public-meta staging block moves intact after source/pool validation; its schema/helper, trust and policy are unchanged.

`source-lineage.json` is canonical sorted JSON with separate package/composition commits, trees and Git epochs, the root epoch, architecture, exact pool/control digest set, frozen input-receipt digest and before/after Git blob/mode delta. Absolute paths and wall-clock observations remain only in external producer evidence. The composition captures and hashes those exact bytes, joins installed/selected packages against them, and retains structured source roles in the runtime report. Release validation requires the clean actual composition source, capture/pool/package agreement, strict schemas and normalized root epoch; derived provenance retains the same record. Package version/date and `mosd-build.txt` continue to come from the original package producer. No production CLI, publication target, signing or runtime selector change is included.

Verification evidence is under `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/metadata/lineage/`, with immutable command/source/working-file/log/UTC/exit metadata:

- `caller-original-red-v2`: the actual pre-change rootfs caller rejects an explicitly supplied original pool at its old stamp comparison. Exit 1 preserves the exact differing stamps and refusal. The first RED recorder only found an incomplete public-meta fixture; it is retained as fixture setup evidence, not the behavioral RED.
- `final-policy-python`: 20 real Git/pool/caller and capture checks pass, including same-source operation, explicit ancestor reuse, disjoint-path byte identity, dirty/hidden/mode/nonancestor source, changed lock/tool inputs, missing/wrong/forged receipt identities, replaced archives with recomputed indexes, wrong architecture/stamp, altered native bytes and missing/swapped/unknown capture.
- `final-python`: 17 then-current lineage fixtures plus all 87 existing/affected runtime cases and the rootfs reproducibility checks pass. The subsequent delta mode/deletion checks are covered by `final-policy-python`; no successful root build is implied.
- `final-policy-release`: TypeScript passes; all 12 focused lineage positives/negatives pass. `final-release-types` ran the exact current release module: 57 passed, five Git-container cases refused the inappropriate host-toolbox environment. Their original refusal is retained: `the release-git-fixture toolset was asked to run on the host (MOS_BUILD_TOOLBOX=host asked for it), and it will not.` No host-route exception was added.
- `final-release-container-route`: three non-publication acceptance cases pass on their existing container route. The two older CLI fixtures exposed their implicit use of the dirty developer checkout. `cli-frozen-source-green` now freezes the actual CLI/direct imports in each real ordinary/linked checkout, retains clean/dirty and read-only Git write-refusal checks, and passes both actual CLI/documented-command cases with their honest composition identity.
- Earlier type errors and the superseded nanosecond fixture expectation remain in the original logs. The final epoch fixture retains exact nanosecond comparison and refuses a one-nanosecond divergence. The first Bun filename filter also matched read-only frozen J source copies; its 122-pass/one-failure aggregate is not attributed to the current source. Subsequent commands use an explicit `./build/src/release-manifest.test.ts` path and focused filters; no frozen source was edited.

Actual immutable inputs were verified through the production helper, not only fixture data: `verified-real-inputs.json` SHA256 `fe33e5a2ea2bea23209ece63a0e834025eabb2892943b001e6c97872e81cf06f`. Both source snapshots are J with producer epoch 1789097968 and version 0.1.0+gite176876b733d-1. The amd64 frozen receipt is `frozen-inputs/amd64.json`, SHA256 `fc79903fcd6dc8bf40191c5f4cdf4979d664dfd0315a53521d57af821f80d166` (57 inputs, 6 actual tools, 15 archives plus three indexes, two native exports). The arm64 receipt is `frozen-inputs/arm64.json`, SHA256 `034bfe1387a770bcd35a6f29a5b026d3e7ca606dcd7200c64b69299e95dd9aad` (63 inputs, 9 tools, 16 archives plus three indexes, two native exports). Original W0/W1 receipts and aggregate environment failures remain unchanged. No producer/cache acquisition was repeated.

Both original-J kernels are complete. x64 result SHA256 `86bbbe6b0a4ea13f8af0f0ebebee67dc7d1aeab90d9dca06747c4c2f7d17e4be` retains bzImage `536a9d276d01fe116371f71ccd22d703f693f5642da0174163495bfb81876e0b`. virt-arm64 finished at 2026-09-11T12:10:20.012083+00:00, exit 0; result SHA256 `6136b2c57a825697a1e2acf5a1ce3e22b2f3df2cbdb8b12977ebb80cf88e5fc6`, Image `544f6bcba99c50313e36cdf72ff513965ba1dc5cc3e4d1cb830fc4a7ae3fcf4e`, modules `1839ff93f53e1af2a0a24a5d4c8075a605ca029a7ed441ebd998325ca54e945a`, kernel release 6.12.107. All 21 ARM step logs and four output identities were collected once in `arm-kernel-collection.json`; no compiler remains active and neither kernel will be rebuilt.

PMA-CR review covers the actual Bash/Python/TypeScript diff, strict input boundaries, subprocess argument handling, immutable pool joins, producer-context exclusion, unchanged private/source/trust policies and exact CLI fixtures. No unresolved finding remains in this candidate. B7-R1 remains the prior resolved review round; this is the separately authorized lineage contract extension and does not self-dispatch a corrective round. Candidate source identity and source-bound final manifests are supplied in the external delivery record after committing. B review and final input validation precede affected root-stage execution. All fresh image, successful dual cold-root comparison, guest/service/lifecycle and physical evidence rows remain pending under their existing owners.

Final shell validation preserves the accepted unrelated baseline failure verbatim:

```text
FAIL: pkgs/mosd/apid/ui/verify-ui-policy.sh:82: an early-exiting grep on the right of a pipe, in a file that sets pipefail: the pipeline reports failure when the pattern IS found. Use 'grep -c ... >/dev/null'
RESULT: FAIL (161/162 files clean, 162 scanned)
```

Both changed shell files pass syntax and the pipefail scan; the aggregate is not a PASS. The UI source is unchanged. `final-docs` passed, and final scoped whitespace is recorded separately because the shell aggregate exits before its chained diff command. After final review, the 20-case policy/capture gate includes the additional consumer mode/deletion refusal; the 12-case release lineage gate includes the corresponding symlink-mode refusal. The later CLI fixture uses the pinned Toolbox Git route for its actual commit/tree/epoch rather than requiring a host Git tool inside the Bun container.

### Reviewed J2 production root start (2026-09-11)

L2 reviewed and integrated f183a35d4ee581ab2a73cf68ea0fcef7c2b56c25, tree 0b0c4ed62bffa0006bdf85eabff1f2fbab1f9d4f, with no unresolved bounded findings. The local integration label 9ba74ee9a48c9c737e000fec9588382c88d21178 does not change the frozen composition identity. `J2_DIR` is `W/J2-f183a35d4ee581ab2a73cf68ea0fcef7c2b56c25`. The existing automatic W2-W4 authorization now applies after the completed source/input review.

Both production commands passed real clean-source, frozen pool/receipt/tool/native, deterministic lineage, wrapper boundary and fresh resource checks. They run in separate full Git checkouts and output directories; no fixture environment injection is present. Original J packages, native exports and both successful kernels retain their original identity. Fixed Debian cache copies preserve verified bytes; no acquisition or producer was repeated.

- x64: 2026-09-11T13:09:43.034922+00:00, orchestrator 2484332, root timeout 2485260, pane %102; `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh`; `MOS_ROOTFS_NO_CACHE=0`. Metadata `J2_DIR/metadata/W2/x64-run1.json`, log `J2_DIR/logs/W2/x64-run1/root-build.log`.
- virt-arm64: 2026-09-11T13:09:43.035742+00:00, orchestrator 2484334, root timeout 2485261, pane %103; `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh`; `MOS_ROOTFS_NO_CACHE=1`. Metadata `J2_DIR/metadata/W2/virt-arm64-run1.json`, log `J2_DIR/logs/W2/virt-arm64-run1/root-build.log`.

Each owned slot retains aggregate 4 CPU / 10 GiB with MemorySwap equal to Memory, x64 cpuset 0-3 and ARM cpuset 4-7. Direct children use the verified 3 CPU / 5 GiB allocation alongside the idle 1 CPU / 5 GiB daemon; positive-headroom refusal and owned-state preservation remain enforced. BuildKit stages use the full bounded slot. Source/output/tag/log changes exist only in versioned task-local root-v1 wrappers; original wrappers and evidence remain unchanged.

`J2_DIR/metadata/W2/initial-running-snapshot.json`, SHA256 `55404e5b591fbcafca4bb610b1a988995ea003660d1200a7a1ac180c7bed6bf7`, binds actual PIDs, commands, UTC, per-step logs, public trust, lineage and resource identities. Gate-pending was acknowledged by L2 with HTTP 200 and success=true. These are running production gates, not successful root, cold comparison, image or guest results. The two successful equal-input virt cold roots, independent CX root/firmware reuse checks and dependent signed image/runtime/API gates remain outstanding.

The x64 J2 gate subsequently ended at 2026-09-11T13:10:57.364923+00:00, exit 1, after passing the original bootstrap-device capture boundary. The exact new 90-pack pack-step 11/19 refusal is:

```text
runtime composition refused: missing path: /usr/lib/systemd/system/sysinit.target.wants/systemd-hwdb-update.service
```

`J2_DIR/metadata/W2/x64-run1-terminal-collection.json`, SHA256 `0abe1634e9fbf66bade6f7520383951beda01080f50ffb6e97ec984366574f92`, verifies every completed step-log digest and absence of both terminated x64 PIDs. The root log SHA256 is `69453e946350d26da34d4444419844bed27fe37eae79596c967ce9395ec692a6`. The frozen source remains clean f183a35d. The independent ARM cold1 gate remains active; it was not interrupted. L2 acknowledged the terminal report with HTTP 200 and success=true. No root success, cold equivalence or new source correction is claimed; successful original packages/native/kernels and both failed original J roots remain unchanged.

### Shared hwdb selector diagnosis after J2 root failures

The ARM cold1 gate settled at 2026-09-11T13:16:36.369358+00:00, exit 1, with the same vendor hwdb enablement refusal as x64. Its original PIDs 2484334 and 2485261 exited without interruption. Metadata SHA256 is `c3372be5691aa23512cea2947461bd564e97890a93c8ad2ddabc90ea2744a1af`; root log SHA256 is `5f36d74d2d7ba3b1b545bad2b6d6d64c0c34ebb3c88e14904216c028810edf4e`. Both architectures' 12 completed step-log hashes were verified. Neither failed f183 root qualifies a successful cold run, image or guest result.

Read-only diagnosis used both fixed `udev` 257.13-1~deb13u1 archives and all four preserved 10-compose OCI layers per architecture. The package-owned unit and symlink occur in the installed `udev.list`; the symlink targets `../systemd-hwdb-update.service`. The `mos-system` consumer's udev-owned `/usr/lib/systemd/system/*.wants/*` rule matches that link. The existing hwdb script removes it, but the selector's exact exclusions contain only the corresponding `/etc` enablement. The first diagnostic incorrectly assumed the owner was the systemd package; the second isolated fixture lacked the mandatory runtime_links field. Both setup failures remain preserved and are not behavioral RED evidence.

`J2_DIR/diagnostics/hwdb-20260911-1320-v3/diagnosis.json`, SHA256 `2b00e866ef98371b97ba45827a644767c0db4af1c0afe4a5ae577802e05f357e`, records the valid original-selector CLI RED using actual fixed package bytes and ownership. Two independent negative controls still refuse a missing systemd-udevd.service and an unrelated owned enablement link. The versioned diagnostic gate exited 0 because it verified the intended RED and both negative refusals; no patched selector ran and no correction GREEN is claimed.

The external review-only `proposed.patch`, SHA256 `ccae05119655020fd2832e79fc1161bc06c92fd41a4c5a8e91045dce115a68d9`, adds only the exact removed vendor link, focused positive/negative/explicit-selection fixtures, and the two necessary selector/fixture path entries in the existing Python and release lineage policies with direct tests. All current producer contexts were enumerated; those paths are outside package inputs. No hunk has been applied. L2 acknowledged the source-bound diagnosis and precise proposal with HTTP 200 and success=true. The separately required L1 path decision remains pending; no root replay, CX/cold2 start, package/native/kernel rebuild or source relabelling occurred.

### Approved exact hwdb selector reconciliation

L1's concrete decision, relayed through L2 B, authorizes only the existing removed `/usr/lib/systemd/system/sysinit.target.wants/systemd-hwdb-update.service` exclusion and its direct selection fixtures. The Python and release lineage path sets may add only `rootfs/runtime/select.py` and `tests/rootfs-runtime/selection_test.py`, with direct lineage tests. All other ownership, special-node, missing-path, context, source/tool/receipt/epoch, signing and release-policy guards remain unchanged. This resolves the prior scope hold; no further generic approval is required.

Implementation will preserve the real udev archive/installed-layer diagnostic and both failed f183 roots, capture scoped test RED before changing the three production lines, and run the affected selection/lineage/type/release gates. A clean isolated successor must pass L2 review and actual frozen input verification before affected production stages resume. Original J package/native/kernel identities remain fixed; neither failed f183 run qualifies cold reproducibility. Existing nkglvdlt and sighz7r7 are retained without changes.

The correction adds exactly one excluded path in select.py and exactly two allowed path strings in each existing lineage consumer. Tests construct ownership before configured removal, retain a nonempty required unit set, reject unrelated missing owned units/links and reject explicit selection of the removed link. Direct lineage fixtures cover both exact delta paths and refusal when a producer context actually consumes the selector. No other production behavior or source was changed.

Scoped RED is retained in `W/metadata/hwdb-correction-v1`: selection-red (2 pass / 2 fail, including the real removed-link missing-path refusal), lineage-red-unittest (one test refusing the newly requested selector delta), and release-red (one existing allowed path passes; two new paths refuse, one exact file). The first lineage-red invocation exited zero without a unittest entry point; its empty log is explicitly invalid test evidence and was replaced by the real one-test RED without changing assertions.

GREEN evidence: selection-green runs all 57 affected selector tests; lineage-green runs 20 affected helper/capture tests; release-green runs TypeScript plus 15 lineage/nanosecond tests in exactly one explicit release test file. The added producer-context negative passes separately. actual-package-fixture-green reuses the preserved real udev package-byte/ownership fixture without changing its inputs: the corrected selector retains the required unit, omits only the existing removed hwdb unit/link and passes report verification; both unrelated missing unit/link cases retain their exact original refusals. This is fixture acceptance, not a successful root build.

PMA-CR review of the actual three production lines and direct Python/TypeScript fixtures found no unresolved introduced issue. Existing ancestry/mode/blob/context checks, fixed receipts and strict release/capture/source binding remain intact. The final commit/tree, complete approved delta, deterministic records for two disjoint source checkouts and actual J package/native/tool/input verification will be bound in the external candidate delivery after committing. L2 review precedes production use; both failed f183 roots, original J producer outputs and the unrelated UI shell baseline remain preserved.

### Reviewed J3 production roots and first terminal collection

L2 accepted composition commit 92a877dd4644ed7b886763e7927f668cab9d63a6, tree 7d926cb4690f00be64e855ee753a7988181856ae, and independently verified the real frozen inputs and deterministic lineage. Its integration label 80dcd35bc3c5127afb8c8fc5b25c879b1ca97d2b does not relabel payloads. The original J package/native/kernel identities remain unchanged. Production uses new clean checkouts and versioned root-v1 tools under `W/J3-92a877dd4644ed7b886763e7927f668cab9d63a6`; no fixture boundary injection is present.

Both jobs passed actual source/pool/receipt/tool/trust/lineage checks, wrapper forwarding and positive-headroom checks, and fresh resource checks before running `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh`. Each slot retains aggregate 4 CPU / 10 GiB with MemorySwap equal to Memory; direct children use 3 CPU / 5 GiB beside the idle 1 CPU / 5 GiB daemon. Both owned daemons were idle before launch, with disjoint CPU sets and more than 350 GB free on /srv.

- x64 ordinary root (`MOS_ROOTFS_NO_CACHE=0`) started at 2026-09-11T13:42:12.784756+00:00, orchestrator 2511362 and root timeout 2512310, tmux pane %102. It ended at 13:43:18.262726+00:00 with aggregate exit 1. The actual 90-pack failure is `runtime composition refused: root package not installed: readline-common`. Root log SHA256 is `be70e367ea5604f6e07bc80573cbb2ad2c8e83446f1a847ea186c015bad4d60d`. Both PIDs were absent at collection. The hwdb missing-link refusal did not recur; no complete root success follows.
- virt-arm64 cold1 (`MOS_ROOTFS_NO_CACHE=1`) started at 2026-09-11T13:42:12.767867+00:00, orchestrator 2511367 and root timeout 2512297, pane %103. Both were present at first collection. The existing command, source, inputs and resources remain intact; this observation is not a completed cold-root result.

The immutable first collection is `J3_DIR/metadata/first-root-collection.json`, SHA256 `449e347e51cc0ecaa26242d188c813def76450b0231ba58146c92c315bc3e8b7`. It binds both exact command/environment/source/resource records, completed step logs, process observations and preserved root-log snapshots. Ongoing log snapshots are explicitly prefixes, not final hashes. Launch metadata is `J3_DIR/metadata/W2-launch.json`, SHA256 `56e8577c27707f80abcbb647d6ab9878bfdf0067e20667d3d2c50a393c0f63c4`. The runner SHA256 is `f6951c2b69b1705ddb8d36a870d4bf65af163fd5ed8e82c1bd5c208dc14b6058`; original J/f183 wrapper bytes remain preserved.

The first report preparation encountered the already-exited x64 PID and stopped before sending. The replacement report collected its real terminal state and the continuing ARM state; this is reporting recovery, not a build or code retry. L2 accepted the guarded follow-up with HTTP 200 and success=true, message 01M28BDSQP8EPPN8ACVG66SDH6. Evidence is under `/srv/station/work/tmp/mos/75btxdqb/j3-root-start-terminal-q9rf2t0o`.

The new direct source anchors are `rootfs/runtime/consumers.json:65` (required readline-common resource owner), `rootfs/runtime/select.py:427` (strict installed-root-package check), and the committed readline-common Debian pin. No selector, consumer, package, dependency or installation policy was changed for this new failure. Preserve the existing ARM job and diagnose the exact installed ownership/selection mismatch before repeating dependent roots. Both final successful virt cold roots, all final images and runtime/physical acceptance remain outstanding. No W0/W1/native/kernel build was repeated.

### J3 selected-owner diagnosis and external proposal

L2 authorized a bounded read-only diagnosis of the readline-common refusal, a single pass over the other required owners in selected consumer rows, and external proposed hunks/tests. This does not authorize changing consumers.json, package pins or the fixed lineage policy. Production source remains 92a877dd4644ed7b886763e7927f668cab9d63a6; only these existing records are updated.

The actual x64 and virt-arm64 10-compose OCI manifests and all eight layer digests were verified. Captured native status, sources.tsv, selected.pkgs and ownership lists agree: each has 173 installed packages and 11 selected local consumers. Across each selected declaration's 88 owner requirements (70 distinct package names), only readline-common is absent. The same resource row's other five package owners are installed with captured ownership. Both roots lack /etc/inputrc. The locked selection command agrees with both actual installed inventories; no fixture is substituted for those observations. Collection is `J3_DIR/diagnostics/readline-v1/collection.json`, SHA256 `5795e456b9e49e055193cb43f04844d2fd456b3a3b42348faffa9f53a75abd9e`.

The pinned readline-common archive is SHA256 f77e8aa0bf0de618f11cb0b21658a4ed60f177d63b3cf26d7fc3706b6d0eaaa9, version 8.2-6, architecture all. It owns /usr/share/readline/inputrc; /etc/inputrc is absent from archive ownership and is generated by its actual postinst on initial configure using cp -p from that template. Consequently merely moving an owned /etc/inputrc glob into radio declarations would not preserve the intended configuration. The external proposal moves the readline requirement out of unconditional mos-system roots and into both actually selected Wi-Fi/Bluetooth consumers, explicitly retaining the owned template and the named generated /etc/inputrc. The two actual Bash ELFs remain installed, reference /etc/inputrc, and have no DT_NEEDED libreadline dependency; that observation does not independently prove guest interaction behavior or authorize removing Bash/GNU/S5 tools.

An isolated actual-package resource fixture reproduces the unchanged original consumer row's missing-owner RED. The external proposal passes no-radio, Wi-Fi, Bluetooth and combined-radio cases and report verification. Required-owner absence, missing owned default and missing generated inputrc each still refuse. Eight cases retain exact argv/log/source identities and real pinned resource bytes. Two earlier fixture setup failures (absolute archive symlink handling and accidental inclusion of foreign-board inventory) remain preserved, not behavioral RED or GREEN. No production assertion was changed.

The same single-pass candidate check identifies an independent CX mismatch before another root is launched: CX's selected radio packages include readline-common, but unconditional mos-system also requires dmsetup, whose current amd64 and arm64 pins select it only for mos-board-x64 and mos-board-virt-arm64. This is a locked-input finding, not a newly installed CX-root result. The external alternative moves that exact executable owner rule to those board consumers, matching current selection; L1 must confirm that policy or disposition a different package requirement. No dmsetup/libdevmapper package pin, producer, runtime policy or selected tool was changed, and no CX build was used to rediscover the known mismatch.

Required production scope for the proposed reconciliation is the exact consumer rules in rootfs/runtime/consumers.json plus that one exact path in the existing Python/release lineage sets. Direct selection/composition and lineage/release fixtures remain necessary after a concrete disposition. All 15 actual producer contexts exclude consumers.json; the existing producer-context guard remains intact and would be revalidated against a reviewed successor. Combined external proposal: `J3_DIR/diagnostics/readline-v1/combined-proposal.json`, SHA256 `cc841daca22dd37273070a8c9ce447a5f3c7edf228316cc02faff75a64877af1`. Readline and CX proposals are separately inspectable; neither is applied to the repository.

ARM J3 cold1 also completed failure without interruption: root ended 2026-09-11T13:48:57.934605+00:00, aggregate exit 1 at 13:48:57.935605+00:00, with the same readline-common error. Orchestrator 2511367 and root timeout 2512297 are absent. All 12 step-log hashes were collected once; metadata SHA256 is 1f1645768a2bc8661af71d77de1091b6c2d95a4cf57883d0518a0a7b4f5330a0 and root log SHA256 is 127dd4b8f861feedd2eb6531704af832e7807e9ba932372b1bf09fc569e2edfc. The collection `arm-terminal-collected.json` has SHA256 8fa1a157fb9ffa679ed4018c5b803e046f574f31b2d1a4a2eaf316c5001c60c4. Both J3 roots remain failures; no completed root, cold comparison, image or guest result follows. No producer/native/kernel/root was rerun during diagnosis. New dependent roots await the exact consumer-policy disposition and reviewed successor, with all original component identities preserved.

### Approved readline resources and CX locked tool selection

L1 approved the conditional readline template/generated-inputrc rules, preserving the common dmsetup executable rule. Only mos-board-cx3576 is appended to the arm64 consumer lists for dmsetup and libdevmapper1.02.1; existing pins, versions, digests, amd64 selections and all other dependencies stay unchanged. The fixed lineage sets may add only consumers.json and those two lock files. The external board-only dmsetup-rule move is declined and remains unapplied. Direct fixture, real locked-selection/ELF closure, source-context/receipt/capture/release validation and a clean reviewed successor precede any production root. Original J local packages/native/kernels and all failed root histories retain their identities. This concrete decision is authorized; no further generic approval is needed.

### Feature-resource correction verification

The bounded implementation preserves the common mos-system dmsetup rule, moves only readline-owned defaults and their explicitly generated configuration into selected Wi-Fi/Bluetooth consumers, and appends CX only to the two existing ARM lock entries. The Python and release fixed delta sets gain exactly those three authorized paths. No package producer, version, archive digest, tool pin, native binary, kernel, signing policy or previous source snapshot changes.

Focused source-bound RED records under `W/metadata/feature-resource-v1/` retain the original no-radio `runtime selection refused: root package not installed: readline-common`, real CX locked-selection missing dmsetup/libdevmapper assertion, Python unapproved-delta refusal and three exact one-file release refusals. GREEN comprises 66 selection tests, 21 source-lineage tests, 18 release tests/45 assertions across exactly one file, TypeScript and four direct generated-resource/lineage capture tests. Seven real pinned-resource cases cover no radio, either radio, both radios and missing owner/template/generated path; the three negatives correctly exit 1. The actual pinned postinst/template evidence remains bound to the preceding diagnostic.

The real manifest driver produces identical archive/version/architecture/URL/SHA rows for x64 and virt-arm64. CX gains only dmsetup SHA256 f802c1ec2d6f45a6544f09c5da72f9688e06208d12bb76ac9b25f2cfa8033306 and libdevmapper1.02.1 SHA256 4d783b235eb9857ec96fabd0f161a84426706d079ec82ef5a91cbbf9dd644904. The existing virt rows' consumer annotations now also name CX; their payload identities do not change. All selected candidate required-owner references are present. This is locked-input coverage, not an installed CX inventory.

The real ARM dmsetup closure uses the unchanged common executable rule, 14 already selected pinned package/control inputs and 11 retained ARM ELFs, including Bash for the package-owned blkdeactivate script and the actual base-files merged-/usr aliases. Its dmsetup ELF SHA256 is 554e3526e1683a710be0c8aa89ea52be72e2cc5a96c7029d07a80de7827554f2. Archive dependency/version checks include the actual mawk Provides: awk relation. Selection and report verification pass; a removed real loader still refuses. No additional pin beyond the approved two is required. `dmsetup-closure-v5/result.json` contains the full library/interpreter/hash mapping; no ARM target program, installed CX root or guest was executed.

All intermediate fixture/recorder failures remain evidence, not behavior RED or PASS: duplicate fixture ownership (`ambiguous ownership: /etc/libaudit.conf`), a colliding temporary result/metadata name (`KeyError: 'cx3576'`), missing fixture `/bin` for blkdeactivate, an initially unmodelled virtual `awk` dependency, and the fixture's attempted synthetic aliases despite their presence in actual base-files. The corrected fixture uses actual selected archives and their existing aliases; production selection/integrity checks were unchanged. Local PMA-CR review of the complete scoped diff reports PASS with zero introduced findings. `precommit-review.json` binds every gate/log hash. Final clean successor source, deterministic lineage, actual receipt/tool/pool/native checks and isolated real caller checks are recorded after commit; production roots remain pending L2 review/input acceptance. Task ownership and all historical failures remain unchanged.

### Frozen feature-resource successor input handoff

The isolated correction is `259681e809b7093688211c6db69822d376c4d9f7`, tree `cc4f46cf02d391a620efc01fcdcce52ae825030c`, composition epoch `1789136510`, with 11 scoped files. The distinct output/evidence namespace is `W/J4-259681e809b7093688211c6db69822d376c4d9f7`. Both clean verification checkouts contain this exact commit/tree. Actual final-source helper checks validate the full J-to-successor delta, producer contexts, unchanged original J receipts/pool/control/index/tool/native identities and clean ancestry. Two disjoint paths produce byte-identical lineage: amd64 `83c8f36da7a21664d92a9928d3b8bcc193a3a799044f01aaee41de995b7a24ae`; arm64 `027097a644867db75c3ddab33cb6cc340020eb47bd34efd8edd87fdf722b4732`. Package identity remains original J/version/epoch, and root epoch remains `1577836800`.

`J4_DIR/metadata/candidate-inputs.json` SHA256 `9d401947f7edaf629762b5e712ce5d1002e7f002de08b1728e90ba5371ae3669` records the four successful helper calls and three real caller boundary exits 79. These deliberate pre-resolver boundary tests are not production roots; their BASH_ENV fixture is forbidden as a production input. `J4_DIR/metadata/successor-readiness.json` SHA256 `9aa09d8e4dd3998d688e76b112566495d1044f98fe4ae90d543abc99ac8ef402` binds all three board configurations/selections, exact public trust and frozen receipts, current Debian rows, resource proofs and reuse/invalidation decisions. The bounded owner checks cover 87 x64, 87 virt and 99 CX references, with zero missing owners. Existing virt lock rows gain only the shared CX consumer annotation; their selected archive identities are unchanged.

No J4 production build or guest action has started. L2 must review/integrate this bounded correction and verify the real input handoff before the already-authorized affected W2-W4 jobs resume. Original J packages/native and successful kernels, prior root failures, physical limitations and final equal-input cold-root requirements remain intact. This later tracking entry does not relabel frozen composition `259681e809b7093688211c6db69822d376c4d9f7` or any binary artifact. Task remains owned and in progress; final campaign/global reconciliation remains with D.

### Reviewed J4 production startup

L2 accepted and integrated the bounded correction at B merge 82ad2fcdce99f44e67ac8a06799d534df21da029; immutable composition remains 259681e809b7093688211c6db69822d376c4d9f7/tree cc4f46cf02d391a620efc01fcdcce52ae825030c. J4 versioned wrappers change only source/tree/readiness, private paths/tags and event names. The original resource envelope, input verification, archive adapter and prior wrapper bytes remain intact. Fresh launch inspection found both owned daemons idle at 4 CPU/10 GiB/no swap, separate CPU sets, more than 60 GiB free disk; each runner repeats checks immediately before its root command.

Virt-arm64 cold1 started the actual `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh` at 2026-09-11T14:36:20.849530+00:00, orchestrator 2541422, root timeout 2542260, persistent tmux 75btxdqb-7e0f1b pane %103. Its clean J4 source is `J4_DIR/sources/production-virt-arm64-run1`; logs and metadata are `J4_DIR/logs/W2/virt-arm64-run1/root-build.log` and `J4_DIR/metadata/W2/virt-arm64-run1.json`. No BASH_ENV boundary fixture enters production. The verified original J arm64 pool/native/receipt, fixed cached archives, trust and expected J4 lineage are unchanged. This is a running gate, not root/cold/image/guest success.

The x64 orchestrator 2541362 ended before any root command at 2026-09-11T14:36:19.699415+00:00, aggregate exit 1. Its exact unchanged capacity refusal was `('station', '60.42%')`: station CPU exceeded the existing 50 percent per-container preflight threshold. No threshold was weakened, root invoked or successful producer replayed. The clean prepared source and all failed preparation logs remain in J4. `J4_DIR/metadata/startup-collection.json` binds completed step hashes and process evidence; x64 metadata SHA256 is `bbc51c18b912a1a01bf0d9694d29e79b79a3c10b8b345d597ec8f5a5c3157926`. L2 collects the ARM gate and the x64 execution-only capacity failure; no product correction or root PASS is inferred. The earlier failed root attempts and all physical limitations remain distinct.

### J4 ARM terminal and shared tmpfiles dependency diagnosis

The next x64 continuation collected a newly settled ARM cold1 before launching another root. ARM ended at 2026-09-11T14:43:02.792157+00:00, aggregate exit 1, with exact error `runtime composition refused: missing path: /usr/lib/systemd/systemd-tmpfiles` in 90-pack pack 11/19. Orchestrator 2541422 and root timeout 2542260 are absent. All 12 completed step/log hashes verify. Metadata SHA256 is `3234f9d106759bacdbc54c4ce0f3482bd148f134236774df0c19fe4809fbcd83` and root log SHA256 is `e4ba596ddc17a89f1004c47e6343a25aa9226394587c230299c7c5ac91169237`. Installation of 173 packages completed, but no successful root, cold comparison, image or guest is claimed. All original wrappers, source and result files remain unchanged.

A single fresh read-only x64 preflight passed the unchanged resource/input checks: station CPU 5.17%, all unrelated container CPU below 50 percent, disk/memory bounds, idle owned 4 CPU/10 GiB/no-swap daemon and builder, clean prepared J4 source, original pool/cache/receipt/native/trust identities and deterministic lineage. Nevertheless the new shared producer-resource declaration is unsatisfiable for both architectures, so the previously unexecuted x64 root was not launched into the confirmed same prerequisite failure. No source was recloned, resource threshold waived, or successful producer/kernel replayed.

The actual retained J4 ARM 10-compose OCI layers contain `/usr/bin/systemd-tmpfiles`, its dpkg ownership and setup unit, and contain no `/usr/lib/systemd/systemd-tmpfiles`. Its bytes equal the exact ARM systemd archive. Both fixed systemd archives (amd64 and arm64) own the `/usr/bin` executable; their retained setup unit invokes `systemd-tmpfiles`. The common `consumers.json` line 72 instead names the absent `/usr/lib/systemd` path in exactly three accounting-link `requires` arrays (wtmp, btmp, lastlog). `select.py` adds those explicit producer resources while preserving the runtime links; the real package declaration remains strict.

`J4_DIR/diagnostics/tmpfiles-v1/result.json` SHA256 `6f86fcd6f74e1b745f9cb113d2d0fb41783da7b8193698fccf41be15bb1b7565` binds terminal collection, fresh capacity/input checks, exact OCI layers and both package-node identities. A focused external fixture uses the pinned path placement/setup-unit bytes with a small synthetic ELF: original path refuses (exit 1), exact path proposal selects/verifies (exit 0), and removal of the required real-path producer still refuses (exit 1). This is scoped fixture evidence, not target execution. The external `proposed-consumers.patch` SHA256 `000e207f28e7f7dfc24b1d1534d3e2c25e0ff7f3a61179f23fd7e7ccbcd7f465` changes only the three `requires` values to `/usr/bin/systemd-tmpfiles`; it is unapplied. Production path correction and matching existing selection/composition fixtures need L2/L1's precise disposition under the current execution-only continuation. No new lineage path, package pin, producer, runtime quota, auth, signature or release-policy change is proposed. Both J4 roots remain unqualified: ARM failed and x64 never started. Existing crons and all hardware limits remain unchanged.

### Approved tmpfiles runtime-link correction

L1 explicitly approved changing only the three accounting links' requires member from `/usr/lib/systemd/systemd-tmpfiles` to `/usr/bin/systemd-tmpfiles`. Existing pinned archives and the J4 ARM installed-view failure establish the wrong declaration; preserve their original RED and all preceding failures. Direct selection/composition regressions cover all three links, generator ELF dependencies, unchanged configuration and unit, and missing required resources. No producer, pin, selector or fixed lineage path policy changes. The current source scope is consumers.json, the two direct test files and these existing records.

Validate all enabled runtime-link requirements in one bounded captured-input pass, distinguishing installed ARM evidence, earlier equal-input x64 evidence and CX locked inputs. Revalidate final clean successor lineage against original J receipts/pool/native/tool identities before L2 review and production continuation. Neither J4 nor any earlier failed root qualifies a cold half. The later notification policy keeps nkglvdlt and c9ea0np3; deleted sighz7r7 is not recreated. No cron is changed.

### Tmpfiles correction verification

The production diff is exactly three replacements in consumers.json; no other production bytes or fixed lineage paths change. The new direct test fails on the original declaration with `runtime selection refused: missing path: /usr/lib/systemd/systemd-tmpfiles`, then passes after the exact correction. New tests cover all three links, their generator dependencies and capture/report ownership; missing generator, unit, configuration and an unrelated required resource still refuse. The targeted accounting discovery records seven executions of four unique tests (the existing imported fixture class is discovered twice); six distinct existing runtime-link regressions pass. Two capture-lineage tests, six exact-delta/context/package/tool/native/receipt refusals and 18 release-lineage/epoch tests with 45 assertions across exactly one Bun file pass. No aggregate full suite or target execution is claimed.

`W/metadata/tmpfiles-correction-v1/actual-links-v4/result.json` SHA256 `0c0eab24803e558a77b3f4268f245ee4d97e6add10d5f72cd143b88f6381b63b` binds the actual x64 J3 and ARM J4 installed OCI inputs, full layer/node identities, captured ownership and 173-package inventories. J4 x64 never executed a root; the earlier x64 view remains labeled with its actual source. Each diagnostic accounting selection retains 19 real ELF files and all three links with exact configuration/unit/generator hashes. Actual producer, unit, configuration and loader removal each refuse (eight negative cases across architectures); selection and report verification succeed without executing target code. All 11 distinct requires are accounted for: ten are captured regular owned files, while factory shadow is the existing explicit pack-shadow-relocate transformation of captured /etc/shadow. Unit commands retain the actual basename `ExecStart=systemd-tmpfiles`; no unit or alias is rewritten.

The complete enabled-link inventory covers 12 common links per captured board and three additional CX Wi-Fi/AP /dev/null masks from its frozen selected package archives. CX remains locked-input evidence, not an installed-root result. The final audit binds these declarations, mask metadata, source cleanliness and unchanged scope. Capture was performed once per architecture; subsequent diagnostic fixture corrections reused its immutable node/object evidence. Preserved preparation errors are the host Python missing hashlib.file_digest, missing fixture generated origins for accounting links and ld.so.cache, and an initial two-mask assumption that omitted CX's already-selected AP mask. They are fixture/recorder failures, not policy RED or product changes. The preliminary metadata-print TypeError is also retained as setup history.

Local PMA-CR review finds no introduced issue in the exact consumer/test diff. Final clean successor source/input verification and L2 review precede production. Original J package/native/kernel identities, failed J/J2/J3/J4 roots, both required future equal-input virt cold successes and all guest/physical evidence rows remain unchanged. No producer/kernel/root replay or cron mutation occurred during this correction.

### Frozen tmpfiles successor input handoff

The isolated five-file correction is `1ff1d03c202f874e691acd2b61311e41b5ce1074`, tree `6e5c0644afbf5404f4cf7290af27d07cb1316038`, composition epoch `1789139904`, parent `cd9de21519fd1f76d04732910a2aa73f1d78ffbf`. The new namespace is `W/J5-1ff1d03c202f874e691acd2b61311e41b5ce1074`. Two disjoint clean checkouts independently validate the final full allowed delta and actual producer contexts against original J sources, frozen receipts/control/index/pool bytes, tools and both native exports. Four helper calls pass; three actual rootfs/build.sh caller checks reach the deliberately isolated exit-79 boundary. They are not production root results and their BASH_ENV boundary is forbidden in production.

Both independent lineage copies match exactly: amd64 SHA256 `09af46eb3d2da7009a0a665a0d24e29825dd91116bb1943aa15c4afd85265683`; arm64 `5cfbf3ba95f14560c99ef199d430e55c3cc089c2c326b2683beff7dd42db385a`. Original J package commit/version/epoch and root epoch `1577836800` remain unchanged. `J5_DIR/metadata/candidate-inputs.json` SHA256 `91b33dfb9836d5dc7739169d446893a03dda3c0f175f57447af123a4364d4f48` and `successor-readiness.json` SHA256 `672046b5134f51e58ae8c3af88c2660eee39edbb28205c1990079798df9c6ed9` bind all three board inputs, original public trust and unchanged selected Debian rows (162/162/174). The final enabled-link audit is `W/metadata/tmpfiles-correction-v1/final-audit-v2.json`, SHA256 `b542aef862b24ff4b58c72b96d3dec3e308955bf13b1eb0b37b05a8977212013`.

All candidate-input checks completed; no detached gate or heavy job remains. L2 bounded review/internal integration and final input validation precede the already-authorized J5 production successors. x64 ordinary root and virt cold1 are the first ready jobs after that handoff; CX and independent equal-input virt cold2 follow the existing resource/dependency rules. Original J packages/native/kernels are reused with their actual source identities. This later documentation checkpoint does not relabel the frozen correction or any artifact. Task remains in progress, final images/runtime/cold/hardware rows remain outstanding, and no other issue or cron was changed.

### Reviewed J5 production startup and audit reference recovery

L2 accepted the exact tmpfiles correction and verified final inputs, integrating records at B merge `947eff0646876294761278387c0c3313afef733f`. Frozen composition remains `1ff1d03c202f874e691acd2b61311e41b5ce1074`, tree `6e5c0644afbf5404f4cf7290af27d07cb1316038`, epoch `1789139904`; original J package/native/kernel identities and root epoch remain unchanged. No product or test suite was replayed for the handoff.

L2 detected that final-audit-v2.py and its gate recorder used the same output filename: the surviving final-audit-v2.json is gate metadata, SHA256 `d2bb09502c708065d5f2726b4efc6c832f781f34731dff78f01c7ed3d3021454`. The logged audit payload hash `b542aef862b24ff4b58c72b96d3dec3e308955bf13b1eb0b37b05a8977212013` was reconstructed from unchanged captured metadata and frozen archive members, matching exactly. This resolves the historical evidence-reference collision without rerunning diagnostics or changing payload source. Its exact recovered bytes now have the distinct filename `J5_DIR/metadata/runtime-link-input-audit-recovered.json`. `execution-readiness-v1.json` SHA256 `45a596bb7728e4d0dedc3a2264106e579c030730d950d59e43540e5ecb1dde9c` differs from L2's verified readiness only in that copied reference path. Original readiness and failed/colliding records remain intact.

Both versioned production runners passed clean source, frozen input/lineage/public trust, wrapper/adapter and immediate resource checks, then executed the real `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh` command. x64 normal root started at 2026-09-11T15:33:25.397735Z (orchestrator 2572009, root timeout 2572927, pane %102); virt-arm64 cold1 started at 15:33:25.456886Z (orchestrator 2572011, root timeout 2572951, pane %103). Their independent clean sources are `J5_DIR/sources/production-{x64,virt-arm64}-run1`; no production BASH_ENV/DEBUG fixture is present. Each owned slot preserves 4 CPU/10 GiB/no swap and CPU sets 0-3/4-7, with the unchanged positive-headroom 3 CPU/5 GiB direct-child plus 1 CPU/5 GiB idle-daemon transition. No shared builder, tag, binfmt, cache or earlier wrapper was changed.

Initial live-state evidence is `J5_DIR/metadata/initial-root-state.json`, SHA256 `5c6ab780e966ec0014423bb525ae154e0ccd6aa6e079bc9af90cdad13c8ae4c7`; its process/environment, completed log hashes and running log-prefix snapshots are explicitly a startup observation. Live gate metadata is `metadata/W2/{x64,virt-arm64}-run1.json`, with logs in `logs/W2/{x64,virt-arm64}-run1/root-build.log`. Runner SHA256 is `a9f65d31de6a921fc1b24feaa1778c2d82111ec08414d59b04971e4abc09bafe`; versioned wrapper-inputs.json SHA256 is `709a5763d9f550044ab88dee0e5c58a1adcd169baee2aea086e2c0875852ad48`. L2 received the immediate gate-pending follow-up with HTTP 200/success=true, message `01M28HQ7MJSXAE9DGVQ6ECGCXH`; transport evidence is `/srv/station/work/tmp/mos/75btxdqb/j5-root-start-xx_ggk2j`.

The two actual production jobs occupy the allocated heavy slots until their terminal collection. Startup is not root, image, guest or cold comparison success. No J4 or earlier failed run counts toward either successful final virt cold root. B collects terminal events and dispatches the already-authorized same-node eligible successors; CX/cold2 and all remaining signed-image/runtime/physical rows remain distinct. Task ownership, notification restrictions and all crons are unchanged.

### J5 x64 terminal during startup bookkeeping

The actual x64 root ended at 2026-09-11T15:36:13.851328+00:00 with exit 1; orchestrator 2572009 and root timeout 2572927 are absent. All 12 completed step log hashes were verified. The new 90-pack pack-11 failure is `runtime composition refused: unresolved shared library libsystemd-shared-257.so for /usr/lib/x86_64-linux-gnu/systemd/libsystemd-core-257.so`. This is a new unresolved closure finding; neither the earlier tmpfiles correction nor a successful root is inferred beyond the actual log. Preserve the original source/output and do not replay the unchanged root or change loader/selector policy as a workaround.

Terminal evidence is `J5_DIR/metadata/x64-first-terminal.json` SHA256 `c2c182e4b0ed3a95bfc360ef1fd9b14d7c322234522dd4057a76ded0dc16cc29`; root log SHA256 `72c75d42b988b92a1efff2292e3aeefa7014011e6956ca4615ba518cb9f200f8`, metadata SHA256 `b944cb4004ecec53dd3ed56175ab6983d82fffe2b10494a27325348a92749734`. ARM cold1 remains running at this terminal observation, with recorded process identities in the evidence; its immutable source/wrapper/outputs continue untouched. L2 receives the exact new failing operation for the bounded diagnostic/scope successor. No production pass, cold-half success or physical claim is made.

### J5 dual-architecture ELF resolution diagnosis

The L2 terminal follow-up authorized a bounded read-only diagnosis and external proposal, with no production selector edit. The previously collected x64 terminal is reused unchanged. ARM cold1 also ended at 2026-09-11T15:41:43.709604Z, exit 1, with `runtime composition refused: unresolved shared library libsystemd-shared-257.so for /usr/lib/aarch64-linux-gnu/systemd/libsystemd-core-257.so`. Orchestrator 2572011 and root timeout 2572951 are absent; all 12 step logs verify. ARM metadata SHA256 is `24748e0074534a4d8ba655eac0d70f2d74767f610d7f458a43295ef10bd6bf72`, root log SHA256 `ac4c591ca834c24890dd63932ff5aeaf508036311a8d06758a5bf10a3ed6bd38`. Both owned daemons have only buildkitd. No process was interrupted or root retried; neither failed J5 root is a successful cold half.

Evidence is under `J5_DIR/diagnostics/systemd-loader-v1`. `arm-terminal-collection.json` SHA256 `f18583d3bac478b7b643fc1cc8f261fd2f692ee5dba0f9f9ae76ff826800ce8b` records the deduplicated terminal. `diagnostic-result.json` SHA256 `d577f1db77df5574432c6859cd4c13a32c31c4a246cc0c26bf3fab3cded382e8` binds the actual-file selector RED, pinned archive/control/member identities, ownership, loader/cache/config, SONAME/DT_NEEDED/RPATH/RUNPATH and reached graph. The one current-J5 x64 OCI pass verifies all 21 reached ELF hashes/modes/uid/gid and owners against retained inputs. The ARM graph uses actual earlier captured bytes bound to exact pinned archives; its separate J5 terminal confirms the same operation, without relabeling the input graph as a new installed-root result. CX remains unqualified.

Both `libsystemd-core-257.so` and `libsystemd-shared-257.so` are present regular files owned by the installed `libsystemd-shared` package, version `257.13-1~deb13u1`. The systemd executable needs core then shared and has RUNPATH `/usr/lib/{triplet}/systemd`. Core needs shared but has neither RPATH nor RUNPATH; neither private SONAME is in the real loader cache. `Selector.add` recursively enters core before processing the executable's shared sibling. Its global bindings check conflicting identities but do not model already loaded objects in a single entry context. The glibc 2.41 [dependency walk](https://raw.githubusercontent.com/bminor/glibc/glibc-2.41/elf/dl-deps.c) and [loaded-object lookup](https://raw.githubusercontent.com/bminor/glibc/glibc-2.41/elf/dl-load.c), retained with hashes in the evidence, establish ordered breadth-first discovery and namespace-local name/SONAME reuse. This identifies unsupported resolution semantics, not a missing package.

The external diagnostic model resolves 21 ELF nodes/53 dependency edges for x64 and 21/66 for ARM without adding search directories or inheriting RUNPATH. Actual shared-library removal, unrelated libacl removal and a new independent core entry each refuse on both architectures. Six additional small external fixtures preserve original-selector sibling RED, demonstrate model sibling/RPATH positives, and refuse missing shared, missing unrelated, inherited RUNPATH and cross-entry reuse. `proposed-fixture-v3-results.json` SHA256 is `5247db3377454c9f86e59f5e127629e1e0b4d26087ff709369ab3e18e48daa61`. These are diagnostic model results, not changed production-selector GREEN or target execution. Two earlier synthetic-fixture setup failures (`no origin: /usr/bin`, then `no origin: /`) remain recorded; complete fixture ownership resolves them without weakening the selector. The diagnostic import's own bytecode is preserved under the evidence directory, outside tracked source.

`proposal.json` SHA256 `1ac89165e04999fb82387dd504d65fad0972caed2117fad52f9cd48384fb6dc8` requests only the ELF parser/entry dependency branch in `rootfs/runtime/select.py` and direct existing `selection_test.py` fixtures: strict SONAME decoding, ordered dependency discovery and validated loaded-object reuse confined to one entry, while retaining existing conflicting-library identity refusal and all ownership/architecture/cache/search-path checks. Both files already occur in both fixed composition lineage sets; no allowance expansion, producer/pin/consumer change or private-directory fallback is proposed. The source correction still needs the exact L1 disposition through L2 before implementation. Subsequent final-source/context/receipt checks and a reviewed immutable composition successor precede any dependent root retry. Original J packages/native/kernels and all previous failures remain immutable; no W0/W1/kernel/full-suite replay or root/image/guest/physical PASS occurred.

### Current J5 loader proof after the A reference handoff

The new L1 handoff authorizes only additional read-only engineering evidence, not production repair. The seven exact A reference files were read once and their three supplied hashes verified; the valid historical proof is `proof-final/loader-proof.json`, not the empty earlier instrumentation output. A's private checker/tests were neither run nor imported. Its historical image and proof remain separate from J5. The already committed original-selector RED and dependency graph were reused without another root, producer, kernel or suite run.

`J5_DIR/diagnostics/systemd-loader-v2/actual-loader-proof-final.json` SHA256 `e0bc798a9243e673dcc7edb1874c53983f83814a394f5d2501d7de8db7f6bd58` records actual current-J5 interpreter execution. The exact x64 10-compose manifest is `cff6cb98ed27317da6a6013745b8e2d97944090b0226f05aabe7af23f897d75b`, config `abcea9dd30b313122accc7a88d0359c6f8e31611b1b60985e9bd65acce51ec60`; ARM manifest is `bf7893066cc7d2f82ba5b53e83d15c0002b36aef07d1d1583746607e54b43c3f`, config `378e20f645ccaafd596790af4871af79cc0a54829d1bfaffdacb629f82131f98`. All four layers and diff IDs per architecture remain exact. Fresh task-only load indexes change only image-name annotations, preserving config, labels and payload bytes. Current OCI capture independently binds the 21 reached ELF bytes/modes from the prior graph, retaining its archive/ownership bindings, and actual loader cache/config; the ARM content binding now has its own current J5 layer evidence.

The actual x64 interpreter `/lib64/ld-linux-x86-64.so.2 --list /usr/lib/systemd/systemd` exited 0 at 2026-09-11T16:09:35.276302Z..16:09:35.649582Z, recorded timeout PID 2590830. The actual ARM interpreter `/lib/ld-linux-aarch64.so.1 --list /usr/lib/systemd/systemd`, through the previously verified task emulator SHA256 `239ff153cde81b6a6ab2c48eef9cff234751caa8e9d841363eace8db51e000e8`, exited 0 at 16:09:51.207997Z..16:09:51.590561Z, timeout PID 2591038. Each entry's 20 actual provider paths agree with the entire 21-ELF graph. Both runs use read-only, network-none, capability-dropped containers and only ARM's explicit read-only emulator mount. No service, added library/cache/alias, LD_LIBRARY_PATH or target-file mutation is involved. This proves the current installed-stage consumer namespace; it is not a completed selected root, signed image, boot, guest or cold comparison.

The initial x64 OCI load succeeded, but Docker tag inspection returned `No such image: ai-agent/mos-b7-loader-j5:x64-proof-v2`; inspection by the original manifest digest proved the loaded immutable identity. This setup failure is retained. The continuation used that content ID without another load or interpreter retry. Exactly one loader invocation per architecture ran. Each child was inspected before start under the existing direct-child 3 CPU/5 GiB plus idle-daemon 1 CPU/5 GiB envelope. Auto-removed children and the two task-owned diagnostic image references were retired; both idle owned daemons were restored to 4 CPU/10 GiB/no swap and original disjoint cpusets. `restored-owned-envelopes.json` SHA256 `8b4366274ce5009173e12b66fe0024d2d6aec5088e9526d28aa9a30a51c3e563` records the result. No shared builder, state volume/cache, original source/output or cron changed.

`version-proof-result.json` SHA256 `ef026868e4496f5732a6a1032e1655a85d12e021ec12918ed6e5ce81ec7617d1` binds current exact readelf dynamic/version tables: 21 ELF files with 240 version requirements on x64, 21 with 138 on ARM, all satisfied by the observed exact providers. Core requires shared's `SD_SHARED`. Four in-memory metadata/identity negatives per architecture reject wrong observed-provider SONAME, changed expected provider hash, missing version and missing transitive libacl provider. They leave original ELF bytes untouched and are not additional target executions. Prior missing-library, RPATH/RUNPATH and independent-consumer negatives remain preserved. The external proposal supplement requests only the same parser/entry branch and direct test paths, including bounded version/provider validation before loaded-object reuse; no fixed lineage-set expansion. Optional SONAME absence is not converted into a universal missing-library rule, and A's artifact-specific whitelist/equality policy is not a production template. Production repair still requires the exact L1 disposition through B. Original J package/native/kernel identities, both failed J5 roots and outstanding root/cold/image/guest/physical rows are unchanged.

### Approved independent ELF entry correction

L1 approved only strict DT_SONAME parsing and the directly necessary ordered ELF dependency traversal/context in select.py, direct selection_test.py fixtures and these existing records. Both fixed lineage sets remain unchanged. Source tests establish RED before production edits, then exercise real select/copy/verify on retained architecture inputs and bounded other-entry checks. The already completed current-J5 loader/version evidence and earlier failed roots are preserved without replay. The grant does not authorize ELF symbol-version parser expansion: existing exact provider/version input evidence remains separate. The correction must preserve requested-name/actual-SONAME identity, independent entries, first discovery context, global conflicting-library/cache refusal, RPATH/RUNPATH, architecture, interpreter, ownership and report/copy checks. No systemd-specific rule, production loader/cache/config/pin change or compatibility fallback is permitted. A clean source candidate and actual final lineage/receipt/context/native/tool/trust checks precede B review and affected production successors.

### Independent ELF entry correction evidence

The change is confined to `rootfs/runtime/select.py`, `tests/rootfs-runtime/selection_test.py` and these two records. The parser now validates an optional unique SONAME using the existing bounded string-table decoder. A per-entry FIFO resolves direct DT_NEEDED siblings in declaration order before child traversal and registers only validated requested names and actual SONAMEs. Canonical objects keep their first discovery context; retention does not suppress validation of a later independent entry. Existing strict global identity/cache conflict, architecture, symlink, interpreter, RPATH/RUNPATH, owner and copy/report checks remain. No loader-directory, consumer, package/pin, lineage path-set or symbol-version parser change was made.

Evidence is in `W/metadata/elf-context-correction-v1`. The original source-bound entry RED ran 10 cases (5 failures); the separate duplicate-SONAME RED failed once. A further original-source breadth-first grandchild fixture fails with unresolved `libshared.so` before the corrected selector succeeds. The final selector suite passes 82 tests, including requested-name and SONAME reuse, sibling/grandchild ordering, bounded cycles, first-context preservation, independent-entry refusal, missing/transitive/wrong-architecture providers, duplicate/malformed SONAME, ambiguous cache and conflicting aliases. Four direct composition/capture tests and the exact-file release lineage/nanosecond gate (18 tests, 45 assertions, one file) pass. The initial direct `source_lineage_test.py` command had no test runner and executed zero helper tests; it is not helper GREEN. The separate explicit six-test unittest runner supplies the helper/context/stamp/lock/native/mode/deletion evidence.

The actual corrected select/copy/verify CLI passes on both retained systemd architecture graphs: x64 91 paths/21 ELF files and ARM 89 paths/21 ELF files, with exact prior archive/current-J5 loader/ownership bindings. Three actual-input refusals per architecture preserve missing shared, missing unrelated libacl and independent core-entry isolation. The existing current-J5 target-loader and version/provider proof was not replayed; these new results are changed-selector evidence, not new target executions.

One bounded pass checks the other selected ELF entry graphs against current J5 installed OCI metadata and captured ownership: 761 entrypoints and 857 reached ELF files per architecture, zero dependency refusals. `selected-entry-collection.json` binds both results. It does not qualify non-ELF configured transformations, a complete installed root or CX. The first pass refused a diagnostic subset mode mismatch at `/usr/bin/chage`: an earlier fixture materializer had called chown after chmod, clearing 14 set-ID modes per architecture. Only new private fixture copies were restored to the exact current OCI modes. The subsequent x64 pass succeeded; an ARM source-directory locator setup error was retained, then only the unexecuted ARM continuation ran using the actual `production-virt-arm64-run1` path. Neither failure was waived or counted as a product/root result.

Original J packages/native/kernels, both failed J5 roots, prior RED/setup failures and A historical evidence remain immutable. The candidate will keep package source/version/producer epoch at J and fixed root epoch 1577836800; its own composition commit/tree/epoch must be verified by the unchanged lineage helper before L2 review. All root/cold/signed-image/guest/API/lifecycle/storage/service and physical evidence rows remain outstanding. No producer, native, kernel or root rebuild ran for this correction.

### Frozen J6 candidate and component reuse verification

The isolated correction is `ad56474bcf394cff995764eed1671462f8ddd4a5`, tree `61ee87675eb3a5085368bbeedc9e2ac757bfcd24`, composition epoch `1789144684`, parent `f21293349429f492c375b87834bb30a1d0c2f9a7`. The later record commit is not payload source. PMA-CR finds no introduced issue; `W/metadata/elf-context-correction-v1/precommit-review.json` SHA256 `39e1b02d78197421c81668f33843e6d2a4e902f6e85ce2f397a635820c21d29e` binds source, exact scope, unchanged script-interpreter/other-selector-method ASTs and meaningful gates. Both fixed lineage path sets remain unchanged.

Two clean independent snapshots at `W/J6-ad56474bcf394cff995764eed1671462f8ddd4a5/sources/verification-{1,2}` ran the actual successor helper against the complete frozen original J pools, receipts, tools and native exports. Both produce identical deterministic bytes: amd64 `8151dfc07540f78470ec58b5b180274b54b632830700be89089b6209a0c34175`, arm64 `d9db79fc678bc4fdeb342f1335aa6d993cc76356f135e76b5b5d98f414affedc`. The whole 15-path delta and real producer-context exclusion checks pass. Package commit/tree/version/epoch remain original J/`7e8e8bc62b52f3d78263d717e186a07f0d3430a1`/`0.1.0+gite176876b733d-1`/`1789097968`; root epoch remains `1577836800`. Three actual rootfs callers reach the deliberate exit-79 boundary with original package identity; this is source/input plumbing proof, not a production root.

`J6_DIR/metadata/candidate-inputs.json` SHA256 `63630e00afe2f10d0adb928416c163d34ca5f2821f9a536ccad605c813df8f63` and `successor-readiness.json` SHA256 `fa13d6eabad504e9592224016078489b512057b30810e41b744406c161282ebc` bind all three board configurations, unchanged selected upstream inputs (162/162/174), pool/receipt/public-trust identities and separate verifier source. The readiness inherits the exact L2-recovered J5 runtime-link audit payload reference and adds the actual selector graph, required refusals and selected-entry audit; it does not reuse the collided historical audit filename. Root/support/signed-component/image bytes and their checks must be produced at J6 after L2 review/input collection, with x64 no-cache=0, both equal-input independent virt roots no-cache=1, and CX no-cache=0. No original J package/native/kernel is relabeled or rebuilt. All existing physical, guest and complete-root limitations remain open.

### J6 production start and first terminal

L2 accepted the exact composition candidate and independently verified original J inputs; the local B integration label does not change payload source. J6 production uses `ad56474bcf394cff995764eed1671462f8ddd4a5` / tree `61ee87675eb3a5085368bbeedc9e2ac757bfcd24` / epoch `1789144684`, original J package/native/kernel identities and root epoch `1577836800`. No accepted source suite or current-J5 loader proof was replayed.

The new task-owned `J6_DIR/tools/root-v1` preserves the previous recipe arguments, checks, strict OCI adapter and refusal thresholds. Only composition/path/tag/event/readiness identities and actual tmux-pane recording change; MAKEFLAGS is tightened from -j5 to the granted compiler ceiling -j4. Wrapper inputs SHA256 `cae1633fdcfceff967ddc6cb6b788195350c1ae32f78f361e7d09fb79e535607` bind every old/new script. The launch preflight initially treated a shared builder's docker-init plus buildkitd as an active build; the instrumentation assertion is preserved separately. Read-only process inspection established only those two daemon processes. The corrected observation preserves all existing station/unrelated CPU<50%, disk/memory, owned-daemon and positive-headroom checks; no shared resource was modified. Fresh capacity was 6/30 with 24 available execution slots, and both owned daemons were idle at 4 CPU/10 GiB/no swap with cpusets 0-3 and 4-7.

Both actual root commands started after their own full input/resource checks: x64 at `2026-09-11T16:57:21.075355Z`, orchestrator `2608907`, root timeout `2609834`, pane `%105`; virt-arm64 cold1 at `2026-09-11T16:57:21.096927+00:00` (see exact step metadata), orchestrator `2608919`, root timeout `2609847`, pane `%106`, session `75btxdqb-7e0f1b`. Each executes `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh` in its own clean `J6_DIR/sources/production-BOARD-run1`, with ordinary x64 no-cache=0 and virt cold1 no-cache=1. No production BASH_ENV/DEBUG fixture is present. Outputs, logs and temporary tags are confined to J6; the source-bound initial snapshot SHA256 `73ae5f99664f7b770043b27a69c72a1763232331beff5fc76712475c6f8473f3` contains real process/environment/argv, resource identities and immutable log prefixes. The bounded direct-child 3 CPU/5 GiB plus idle-daemon 1 CPU/5 GiB route remains enforced.

The x64 root already reached a new terminal at `2026-09-11T16:58:26.903664+00:00`, aggregate `2026-09-11T16:58:26.908425+00:00`, exit 1 in 90-pack pack 11/19: `runtime composition refused: script interpreter of /usr/bin/routel: missing env command: python3`. The preceding systemd shared-library error is no longer the stopping point. `J6_DIR/metadata/x64-first-terminal.json` SHA256 `1b969730eb0825efefe4f6b49784e964b53495feaf9dfa3e272de9216a4c123d` records PID absence, clean frozen source and all 12 completed step-log hashes. Root metadata SHA256 `9a4f44f66e7024f305e6d2f1711a55ad167de59e353401d3a9c4938f6c9e2b3f`; root log SHA256 `55ef0a0c6d4b75f493262785622b0f2d08cadffcafa35b1b8573adb070d52e4e`. The existing 761-entry/857-ELF input audit explicitly covered ELF graphs, not all non-ELF script/configured transformations. This new actual script closure failure is preserved without adding Python, removing a selected tool, modifying declarations/pins, weakening the interpreter check or restarting the failed root.

At terminal collection ARM remained running on immutable J6, PID `2609847`; it was neither interrupted nor modified. Actual gate-pending and x64 terminal reports were sent to the same L2 B endpoint with HTTP 200/success=true. The x64 slot is free after collection, but dependent root attempts require this newly evidenced script contract to be resolved first; no CX/cold2 replay was started. Original J/J2/J3/J4/J5 failures and all successful original package/native/kernel outputs are preserved. No full root, cold comparison, image, guest, lifecycle/API/storage/service or physical acceptance is claimed.

### J6 script-closure decision boundary

The read-only routel diagnosis is complete in `J6_DIR/diagnostics/script-closure-v1`; collection SHA256 `5cd425449cbf4bdc6f795942cc3acfe8414fe1c2f26214a10b588583ca6ddfd5`, proposal SHA256 `5a3d732ebcdd916f9af764062a8f0bf58d431bca0a2f1f3646990ee9d4b070ff`. Both J6 roots are now terminal failures; ARM ended at 17:04:26.637359Z with the same missing-python3 refusal. Preserve their exact immutable source, logs and outputs. The reviewed J6 ELF correction remains source-bound software evidence, not a root PASS.

Actual x64/virt OCI inputs each have 173 installed packages and 52 selected scripts. CX's distinct locked-archive overlay has 188 package rows and 64 scripts; it is not an installed or executed CX result. The only actual missing shebang/env interpreter is python3 for iproute2's 1,658-byte routel script (SHA256 `e348c708ec6d0b3252b5ac42b21a27c7dafad2ca32e1bba2f19aee3b7bf45bbe`). Package control marks Python suggested. Current-source real-script RED, actual shell/env controls and eight strict negatives are retained. All setup/diagnostic mistakes remain explicit, including the corrected resource-kind classification and the two failed external-proposal aggregate wrappers; successful nested select/copy/verify results are not an aggregate PASS.

The unapplied external one-row proposal enumerates 18 current iproute2 entry paths and omits only routel. This is a precise product-selection decision for L1 through B, not authorization inferred from the S5 rejection. Keeping routel instead requires a verified current-snapshot Python/module resource input contract before new pins can be named or edited. No generic filter, missing-interpreter waiver, lineage-path widening or tool deletion was implemented. After an exact disposition, any approved correction must be isolated, reviewed and frozen with actual component-reuse proof; only affected roots and descendants resume. Original J producers/native/kernels remain reusable with their original identities. No new root, cold-half, image, guest/API/lifecycle/storage/service or physical qualification is claimed.

### J6 S5 and named-resource diagnosis supplement

The complete L1 supplement was consumed in the same read-only diagnosis. Both J6 roots remain terminal failures, with no live root or new heavy job. Their existing terminal, 52-script-per-architecture audit and CX 64-script input audit were reused without replay. Production source, frozen inputs and prior evidence remain unchanged.

B4's operator transfer contract and B5's actual `compose.py` surviving-executable guard require retaining routel. The earlier external 18-entry proposal is therefore superseded: an isolated execution of the exact committed guard against the real transformed 0755 routel refuses `operator executable omitted: /usr/bin/routel`; its retained-entry control passes. This is a guard fixture, not full composition success. No tool was removed or policy changed.

Evidence is under `J6_DIR/diagnostics/script-closure-v1/s5-supplement`. `collection.json` SHA256 `5539582984659ee6838036478fac3615c53d5a27836bdea40f20a056450cbe24` binds 136 supplemental evidence files and the preserved original delivery. `combined-proposal-final.json` SHA256 `fb3d8ba7ca9f292a6de58810800c47a263dac234abdbba1b1fd7de62c9272246` is the single current proposal; its unapplied patch SHA256 is `0435f4c1cf9b1d1036450a8ae7fa3172888a3b22e8554ba77bfa149cc1e89964`.

The fixed Debian 20260905 snapshot's InRelease signature and both package-index hashes verify. Six downloaded archives were checked against those exact signed-index identities and controls, without installing packages or executing target code. Keeping routel requires the candidate `python3-minimal` 3.13.5-1, `python3.13-minimal` and `libpython3.13-minimal` 3.13.5-2+deb13u3, plus their owned interpreter/stdlib/default/helper resources. Actual minimal archives contain json, getopt, subprocess and encodings; required built-in module symbols and current production select/copy/verify pass on the external real-byte fixture (424 x64 / 422 ARM paths, eight control dependency checks each). Existing installed libc6, libssl3t64, libexpat1, zlib1g and dpkg satisfy the declared installation constraints. Dpkg remains removed from the final image: optional Python package-database helper modes are not qualified, and no package-manager restoration is proposed.

The three archives total 3,114,764 / 2,886,084 compressed bytes and 12,370,964 / 12,231,701 regular unpacked bytes for amd64/arm64. The proposed Python runtime subset accounts for 12,213,212 / 12,073,949 regular bytes before final packing. These are archive/fixture measurements, not final hardlink/xattr, SquashFS/verity, memory or guest results. The original select-only caller on an isolated proposal input copy selects 165/165/177 upstream rows for x64/virt/CX, exactly three more than 162/162/174. Existing pin files are byte-identical; the 15 real producer contexts do not consume the three proposed new pin paths. Both fixed lineage sets would need exactly those three additions after an explicit scope disposition; no set was changed.

Read-only metadata copies from the two idle owned BuildKit daemons identify the actual J6 pre-failure snapshot chains: x64 413 through 422, ARM 443 through 452, bound to J6 source-lineage and cache parent/command records. Named resource subtrees were read from those chains without executing a build or service. The 18/18 actual transformed named-resource rows and 25 CX locked-input rows identify additional declaration omissions: tzselect's country/zone tables and timezone data, plus update-shells' baseline and Bash/dash fragments. They are present inputs, not missing packages. The proposal retains their existing owned resources (630,088 additional regular timezone bytes and 106 shell-template bytes). The present 685-byte e2scrub.conf is also undeclared; its script permits built-in defaults, so preserving it is separately classified as configuration preservation, not the routel interpreter failure. Existing PAM, health, account, factory-shadow, SSH, hostname and resolver declarations remain; runtime-generated DATA/run targets and CX board behavior still require actual acceptance.

Only consumer resource additions, three exact new Python pin files, their two fixed lineage-set additions and direct existing tests are proposed. Selector strictness, iproute2 pins, existing tools, producers, signatures, authentication and runtime policy remain unchanged. Original real RED and refusal cases are retained. The supplemental duplicate-package index parser, public-key/tool setup, binary metadata decoder, incorrect lineage-field lookup and empty-tar instrumentation failures remain recorded separately; successful recovery outputs do not relabel those gates. No unchanged full suite, producer, native, kernel or root was replayed. L2 receives this exact combined packet for L1's production-hunk disposition before any implementation or dependent root successor.

### L1 retained-routel decision and actual Python module evidence

L1 explicitly declined the historical 18-entry omission alternative and confirmed that unchanged routel and the complete existing iproute2 set must remain. The decision permits bounded fixed-input acquisition and completion of the current packet, but grants no production pin, consumer or lineage edits. Prior script/resource inventories, six verified binary archives and original terminal evidence were reused. No production root or unchanged test matrix was replayed.

The remaining actual-module check is complete under `J6_DIR/diagnostics/script-closure-v1/python-runtime-v1`. Using the existing pinned, task-owned BuildKit route, each architecture ran one short FROM-scratch input fixture containing only the previously verified selected bytes and a fixed diagnostic program. It imported the actual Python json/getopt/subprocess modules and executed the unchanged routel through its real env/python shebang, including its real ip subprocess. Four read-only IPv4/IPv6 queries per architecture exited 0 in network-none execution; no interface, service, guest or external endpoint was configured. BuildKit reported the actual RUN duration as 0.5 seconds for amd64 and 4.7 seconds for ARM. Both daemons retained 4 CPU/10 GiB/no-swap and disjoint cpusets, with fresh CPU/memory/disk/quiescence checks. Source fixture bytes remained identical, and both daemons were idle after collection. This is target userspace input evidence, not a completed root/image/guest or native ARM host claim.

Each run traces 51 imported file-backed modules to exact package/ownership/report hashes. The actual archive sitecustomize symlink resolves to its owned `/etc/python3.13/sitecustomize.py`; no fabricated alias, PYTHONHOME, LD_LIBRARY_PATH, pip or third-party module is used. The original missing-interpreter RED and strict resource/interpreter negatives remain unchanged. The new package candidate remains exactly python3-minimal 3.13.5-1 and python3.13-minimal/libpython3.13-minimal 3.13.5-2+deb13u3, selected by mos-system for amd64 and arm64, including CX's existing mos-system selection. No additional binary dependency was discovered by actual execution.

The already verified fixed InRelease binds newly acquired Sources.xz SHA256 `e8bbadd8389119e841494630998187f961d7de4d5b1dcbeed4f792a1d423299f`. Exact source descriptors are python3-defaults 3.13.5-1 SHA256 `206e2f527ca126e46f007b3dd668ae9d35a03c7653bee137a03161df33063d2c` and python3.13 3.13.5-2+deb13u3 SHA256 `2f6c3f83cd3de0355f4411807871a95f99a0aae9b397daba5dbdbf1bd5169cc8`. Their source archive names/hashes are recorded without claiming those tarballs were downloaded or rebuilt. All three actual copyright files remain selected by the existing contributor-license rule. The existing producer-context proof and original J local component identities remain prerequisites for final reviewed source reuse, not blanket equivalence claims.

The proposed new Python subset plus its retained copyright files occupies 12,329,044 / 12,189,781 hardlink-aware regular bytes in the amd64/arm64 input fixtures (323 reported paths each). Prior compressed/archive and named-tool-resource measurements remain separate. Final packed bytes and filesystem overhead are unknown. SYSTEM stays exactly 1 GiB, with two full deployments plus 128 MiB reserve and the stricter actual ext4 overhead/reserved/internal-cluster check. The raw geometric ceiling is 448 MiB per SYSTEM deployment before that overhead; CX includes boot content in the same amount. EFI boards also retain their separate 512 MiB ESP/two-boot/64 MiB reserve check. No budget, reserve or partition change is proposed and no capacity PASS is claimed.

`successor-proposal.json` SHA256 `34fdfe6f0ff7bd32ebff31d9ed49d0f161f85963578e6bbc913ae3432fa1a607` is the single input-bound successor packet, extending the previous unapplied exact patch with actual modules, source/license bindings and capacity limits. `collection.json` SHA256 `d74837c0be8f40ee9a8724ae348f18b8dce886931ec5fd87a236913425ea6da8` binds 36 new evidence files and the prior supplement. The source-index multiline-field parser error and initial symlink-digest attribution error are preserved; their corrections reused existing bytes/results without replaying target execution. Production source and all original J components remain unchanged. L2 receives this packet for the exact code-hunk grant and later reviewed successor/input freeze; all root/cold/image/guest and physical obligations remain open.
