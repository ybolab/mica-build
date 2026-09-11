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
4. After L2 integrates the checkpoint and allocates each named job, produce
   fresh dual-architecture candidates serially, verify their complete selected
   feature/runtime matrix and the pinned C verifier, and compare the two
   independent equal-input virt-arm64 root builds.

## Risks

Source/package/tool/trust drift invalidates equal-input or final-image proof.
Fixtures cannot establish guest teardown, terminal action, memory or hardware
behavior. Out-of-scope product defects require L2 scheduling. C-owned source
and shared resources must remain untouched.

## Scope

Focused `tests/file-ab-x64/`, `tests/signed-boot-lab/`, packaging/runtime closure
acceptance fixtures, permitted final-output checks, and this tracking pair.
The approved continuation below adds only the exact SYSTEM geometry hunk.
No other production/board, UI, compatibility, main, push or publication changes.

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

## Existing-wrapper recipes for the next allocation

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
