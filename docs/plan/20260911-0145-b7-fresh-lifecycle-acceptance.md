# 20260911-0145-b7-fresh-lifecycle-acceptance B7 fresh lifecycle and rootfs acceptance

- **status**: implementing
- **createdAt**: 2026-09-11 01:45
- **approvedAt**: 2026-09-11 01:45 (prior user approval)
- **relatedTask**: 20260911-0145-b7-fresh-lifecycle-acceptance

## Current coordination boundary (2026-09-12)

The parent completed the authorized early source/workflow integration at main
24f14d0afcb99e0cbda85b1974885384a5c70faa, tree
4da7e15be971834956105422e0a673657edd7f82. This is source integration, not
runtime acceptance. B7 keeps its branch and immutable ed723 image; no main sync,
image relabeling, push, publication or done follows. The workflow in that main
commit authorizes the existing execution owner to repair the complete evidenced
in-scope call chain, run direct RED/GREEN and submit new product changes to B
once. There are no per-stage/path/recovered-fixture generic approval waits.

The enabled L1 watchdog is gb4a328c (30 minutes); old c9ea0np3 and B nkglvdlt
are deleted, as is sighz7r7. B is an event-driven reviewer. B7 changes no cron
and sends no parent receipt/progress notification. Its aggregate 4 CPU/10 GiB,
no-extra-swap, cpuset 0-3 envelope still includes the daemon and every child.

The accepted ed7231cdf9820c310e483b4cb479a3b52259467c / tree
31e3fd25f91cd0c3b03055591f68896a8e351d81 image retains SHA256
ca6bdd50cad6c3dc2e93160316316092c84cc0da995f022909014e36556037b9.
Its failed first guest and unexecuted lifecycle/API scenarios remain pending.
Only genuinely affected producers and dependents get new source/output
identities after a correction; unchanged successful inputs keep their original
witnesses. Stable x64 acceptance precedes the consolidated ARM baseline;
physical CX and two independent equal-input virt cold samples remain owed.

## Context

The reviewed B0-B6 dependency tree and J7 no-Python correction are integrated
in B. The original B3 is implementing the user-directed single-static-shutdown
refinement after its completed hybrid scope. B7 remains the final acceptance
executor. Runtime report and selected-root package provenance stay mandatory;
prior failed roots and historical architecture checks retain their exact inputs.

## Proposal

1. Read the committed narrow B0/B3/B4/B5/B6 records and acceptance callers.
   Verify missing contracts with a focused failing check.
2. Repair only scoped caller/fixture gaps and run relevant cheap checks with
   exact source, command, UTC, log hashes and exit metadata. Review the diff.
3. Commit the coherent checkpoint, inventory immutable inputs and missing
   prerequisites, and submit exact existing-wrapper job recipes to L2.
4. After B reviews and integrates the static correction with no-Python and
   existing A/C, freeze the exact combined source and affected producer inputs.
   B7 automatically runs ready x64 component/root/signed-image and actual
   lifecycle, update/fallback/reset, authentication/API/storage/service/size
   acceptance. Submit the Phase1 evidence with explicit deferred ARM obligations
   for L1 and existing D/D3 integration review; human main-merge approval remains
   required. After that approved merge exists, freeze its exact commit/tree and
   run one consolidated virt-arm64/CX3576 wave, one image per board and two
   independent equal-input virt cold roots. No new S905 image.

## Current architecture gate and producer investigation (2026-09-11)

Actual user direction: generic changes iterate on x64. Only an identified
ARM64-specific change justifies a focused ARM64 check of the affected surface;
touching portable Rust or shared rootfs code is insufficient. Full ARM builds,
images and cold-root acceptance are deferred until the actual approved main
merge. Keep old ARM outputs under their original identities and mark future
rows deferred-by-user, not PASS. Missing future ARM hashes cannot block x64
producers or source review. No-Python/routel-only and static shutdown remain
cumulative requirements. Main/#343/#344, push and physical boundaries remain.

Current allocation is one implementation L3 (B3), then the original B7. Retain
4 CPU/10 GiB/no-swap as the initial x64 job envelope. The conditional maximum is
8 CPU/20 GiB/no-swap across all active task jobs and consuming owned daemons,
with at most two heavy jobs. Reallocation requires fresh proof of no competing
owned ARM job, host/daemon/disk headroom and actual worker needs; preserve
labelled state when quiescing only owned idle resources. No automatic resize or
extra compiler parallelism follows from a spare ARM slot.

Read-only findings at reviewed B `da65dd92`:

- `Makefile` separates `os-debs` from the board rootfs targets.
  `rootfs/build.sh` consumes and validates prebuilt package pools; it is not the
  local software compilation driver. Original W0/W1 reuse across failed roots
  remains valid history, not evidence of repeated software recompilation.
- `build-env/deb/build.sh` uses one declared producer recipe for amd64/arm64;
  `Architecture: all` is built once and exported to both pools. Native ELF
  outputs remain target-specific. `os-debs` traverses all declared producers
  and architectures, and each invocation runs its declared `PREPARE` hook.
  Rust hooks use persistent producer/target caches; invocation does not imply
  a complete recompile. `pkgs/podman/deb/podman/prepare.sh` reuses complete,
  correctly stamped outputs.
- `build-env/deb/version.sh` derives the common producer Git stamp from HEAD;
  `build-env/deb/build.sh` also derives the package epoch from HEAD.
  `pkgs/mosd/hack/build-deb.sh` embeds the global `MOS_BUILD_COMMIT`.
  Root/release consumers enforce a common package source. Thus even a
  documentation/composition commit can change freshness/packaging inputs.
- The existing verified package-source/composition-source split handles only
  its fixed allowed deltas and actual producer-context checks. It does not
  authorize hiding changed static-shutdown native/package inputs or relabelling
  original J binaries. Keep source, version, epoch, receipts and digests truthful.
- The exact `mos-podman -> mos-system (= SYSTEM_VERSION)` dependency must be
  preserved. Producer identities cannot permit arbitrary package mixtures or
  ignore embedded build identity and real dependency edges.

Bounded follow-on proposal, not implementation authorization or a Phase1 gate:

1. Extend the existing producer engine with relevant source/lock/recipe/toolchain/
   target/feature identities and verified immutable outputs per package.
2. Record each producer's exact source and digest in an explicit root package
   manifest. Rebuild changed producers and actual dependents; preserve exact
   package dependency/version constraints and embedded identities.
3. Composition-only changes rebuild affected root/support/image stages.
   Data-only `all` packages are shared; generic ARM packages can serve both ARM
   boards only when their relevant inputs match. Batch dual-target production
   at a chosen stable source milestone with isolated outputs and atomic pool
   publication, rather than on each x64 edit.
4. Before any cross-module implementation, identify the exact consumer/producer
   hunks and refusal checks for changed context, wrong digest/source, incomplete
   pool and broken dependency edges. No new build system, broad cache rewrite,
   global freshness override or ARM batch is approved by this investigation.

Continue the current B3 static/x64 work and B7 acceptance independently. If the
existing identity consumer cannot express the actual changed-native and reused
package inputs, return that smallest concrete technical correction; the broader
proposal must not become an invented prerequisite for the existing delivery.

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

The remaining recursive control pass is also complete: `python-runtime-v1/recursive-package-inputs.json` SHA256 `7f202318cbd6af8dbc8c4d13046f31c404e020420814db584e38be99cc9cb923` binds all 19 reached packages and 38 Depends/Pre-Depends edges per architecture, using the real installed controls and exact new archive controls. Every existing and proposed lock path, file digest, target version/architecture/archive digest/URL and selected-consumer set is retained in that record. The closure requires only the three proposed new packages; the other 16 remain existing inputs. This read-only pass does not install, update or rebuild them.

### Approved retained Python correction implementation

Campaign `mos-open-plans-20260910-100408`: the recovered complete L1 implementation grant (SHA256 `1875a4ac377a7f46cca603e747955ed6818410883d4221bd666b07aae918fdf7`) authorizes the exact external patch `0435f4c1cf9b1d1036450a8ae7fa3172888a3b22e8554ba77bfa149cc1e89964`: three fixed Python minimal-package pins and five owner-bound Python/timezone/shell/e2scrub resource rows in `rootfs/runtime/consumers.json`. Only those three new pin paths may be added to the fixed Python and release composition lineage sets. Direct regressions use the existing selection, lineage and release test files. No selector, operator guard, producer, existing pin or release policy changes are authorized. Existing snapshot/version pins take precedence over dependency freshness defaults for this immutable acceptance wave.

The target Python/module/routel subprocess and recursive source/license input proofs at records `7b2f1f69` and `6b5c1c2f` are complete and will be reused without target execution replay. Source tests must first expose the missing retention/lineage behavior, then pass on the exact approved changes with missing interpreter/module/named-resource, wrong owner/input and unapproved-pin/context controls. Final actual locked selection must be 165/165/177; original J pool/native/kernel bytes and release identity remain unchanged. A clean correction and deterministic final-source input proof precede L2 review and automatic affected W2-W4 successors. No root or final packed-capacity success is claimed by these source checks.

### Superseding user direction: omit only routel, no target Python

The user explicitly changed the product direction after the preceding grant. Only `/usr/bin/routel` may be omitted from its iproute2 owner; every other existing iproute2/operator entry and all original pins remain. The three new Python pin files, their two resource rows, fixed-lineage additions and Python-only tests are withdrawn from the implementation and preserved under `W/metadata/no-python-correction-v1` with the complete uncommitted patch. The parent also preserved `/tmp/mos-no-python-direction-dwEX0U/b7-uncommitted-before.patch`. Earlier input/target execution successes and the historical declined omission remain evidence of their original scope, not current target requirements.

Current authorized changes are the exact iproute2 selection row and the narrow owner-bound composition surviving-operator exception, necessary direct selection/composition tests, and these records. The independent tzselect timezone, update-shells templates and existing e2scrub defaults remain approved resources. No selector interpreter/ELF/ownership refusal or lineage path set is broadened. Both existing affected production paths are already within the fixed composition set. Real selected script/resource inputs and production select/copy/compose controls must pass before review; missing unrelated interpreters, omitted retained tools and wrong ownership still refuse. Original J package/native/kernel and unchanged upstream inputs remain reusable only after final-source verification. Root/cold/image/guest results remain pending.

### No-Python source checks and review

The final production delta is two files: the iproute2 declaration names its other 18 entries explicitly, while compose accepts only an omitted regular `/usr/bin/routel` with sole owner `iproute2`. A symlink substitution, another owner, another omitted operator, selected routel or missing interpreter of a retained script still refuses. Three independent existing-tool resource rows preserve timezone tables/data, shell templates and e2scrub defaults. All original upstream pins, both fixed lineage sets, selector code and package/native/kernel bytes remain unchanged; no Python target package is introduced.

Under `W/metadata/no-python-correction-v1`, valid source RED records reproduce missing Python and the surviving-operator routel refusal. Direct GREEN comprises five selection/resource tests, six composition/capture tests, three source-context/default-source controls, and two release source-role tests across exactly one Bun file (six assertions), plus syntax and scoped review. The first compose fixture omitted its retained env declaration and two negative fixtures attempted to overwrite a prior snapshot; both setup errors are preserved and corrected without changing production behavior. The superseded Python test preparation/zero-test records also remain historical, never GREEN.

The current-source real-input batch verifies 51 selected scripts per installed x64/virt input and 63 in the CX locked overlay, with 513 named-resource metadata/owner checks each. x64/virt completed before a stale CX diagnostic classification stopped the aggregate; their successful results were reused. The corrected final batch consumes the already-established effective CX resource-kind proof. CX remains locked-overlay/shared ARM transformed-resource evidence, not an installed CX result. Original pin selections are byte-identical: 162/162/174. The tar-type instrumentation error and original aggregate remain preserved. `actual-inputs-result.json` binds each input and original archive/control/source evidence. No target Python, ELF suite, root or kernel was replayed.

PMA-CR scoped review has zero introduced findings. Freeze this correction independently of later tracking commits, then run final clean-source receipt/context/native/lineage validation and the real captured iproute production compose/copy/verify fixture before L2 review. The successor uses original J package identity and unchanged root epoch. All complete-root, cold, image, guest, service, lifecycle and physical evidence remains outstanding.

### Frozen no-Python successor and actual input handoff

Composition source is `ce361585dc6971ad42bae870e590a1dbebb38b82`, tree `186b1dea92b61bee0dda22394c33a702d44cf272`, Git epoch `1789153454`. The separate namespace is `W/J7-ce361585dc6971ad42bae870e590a1dbebb38b82`. Two clean independent verification checkouts run the unchanged lineage helper against the actual original J frozen pools/receipts/tools/native exports. Both architectures pass the whole allowed delta/context and original package identity checks; deterministic outputs match between directories: amd64 `1cdff4f87dfa1dcbe4d7b0771624be05f7fa37c02797e7ee1e40ef4e87dac44f`, arm64 `2605d690bcdb866868909a9d960d6a995db7b5ce78bd698cce2f39cac3f50e38`. Original package version/epoch and root epoch remain unchanged. Three actual rootfs caller checks stop at the deliberate exit-79 fixture boundary; production has not run and must not inherit that boundary environment.

The frozen production compose/copy/verify code also succeeds on real captured iproute2 files and their actual ELF closure: x64 retains all 18 expected entries in 110 report paths; ARM retains all 18 in 108 paths. Every entry preserves original owner, bytes/symlink target and mode. Routel and Python are absent. This is a bounded real-input fixture with generated inventory and isolated installer tables, not a complete root or guest. It retains actual archive/source identity joins and the new composition lineage; no target command, service or historical Python test is executed.

`J7_DIR/metadata/candidate-inputs.json` SHA256 `110eb7054f85e359438a21e0f733b837b594f2aea4083e9a49a7da3f38b20a1b` and `successor-readiness.json` SHA256 `9a9ae36f872d9b5d14ec84add771c04562502ef8f6e96846080605e222416c9c` bind the board selections, 162/162/174 unchanged fixed upstream rows, public trust, separate C verifier, original components and 35 checked readiness references. The first readiness recorder used an incorrect existing field name; that error is retained and only the recorder was corrected. No source, gate result, input bytes or tests were changed/replayed for that recovery.

L2 receives the clean source and this evidence for independent bounded review/integration. Afterwards the existing automatic affected W2-W4 grant applies to this exact successor, with at most two capped disjoint heavy jobs. Both successful virt cold roots must use the same final source and equal inputs; every previous failed root remains a failure. No producer/native/kernel replay, hardware qualification, main write, push, publication, done transition or sibling notification occurred.

### Phase1 combined static-shutdown source and x64 producers

Campaign `mos-open-plans-20260910-100408`: the complete reviewed B handoff returns the sole B L3 allocation to this existing executor. B3 has settled; no sibling is woken. The authorized local no-ff synchronization is `d279c0086ebf64ebe52d58e50b0b64a581eb61fa`, preserving the original record head and all reviewed ancestry. Actual frozen production source is independently checked out at `fb6c4597bb902f69d528bcdc3c8372f310c322b1`, tree `cbf2fa8ff2c8fc03534b218c952a511b6a6ba392`, Git epoch `1789157855`, version `0.1.0+gitfb6c4597bb90-1`. Its new namespace is `W/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1` (P). Neither this local merge nor later tracking relabels production bytes. No target Python or additional iproute2 omission is introduced.

The new production native hook completed at 2026-09-11 20:35:26 UTC with exit 0, from P/sources/producer-x64: `timeout 7200 bash pkgs/mos-deploy/hack/build-deb.sh --producer boot --bins "mos-init mos-shutdown" --arch amd64 --stage P/artifacts/amd64/native`. Actual output is mos-init 1,673,848 bytes, SHA256 `738391aa650a58fb3819f52831f6affd57ddd17e357c2a161faaf39d800ec642`, and static mos-shutdown 2,047,144 bytes, SHA256 `d2c5c9a6e2473c0125670031c79014c6ee946b834e2e26f32a65f38939e68b35`. These equal B3's measured bytes but were actually rebuilt from the combined source in separate targets; the retained dynamic startup and static shutdown routes were not relabeled. Production static ELF refusal checks passed. GNU NSS linker warnings remain in the log, and this is not real guest shutdown or memory evidence.

`P/metadata/native-v2/result.json` and `terminal-collection.json` bind the source, unchanged Cargo.lock/tool pins, actual Rust image `sha256:b13d4a7b877c9d6dd9a2766c4e80f1fd020218715d62877c69ce0dc2abe4fc12`, private fixed-cache copy, exact compiler argv, source read-only/target-and-cache writable mounts, create/inspect/start metadata and terminal outputs. The real caller boundary and eight resource/architecture/forwarding refusal controls passed. Native-v1 stopped only the proven idle owned ARM daemon, retaining its labelled state; its immediate post-stop inspect raced asynchronous AutoRemove and failed before compilation. Native-v2 reused the completed source/cache/checks after actual absence was observed, preserving the original failure. A subsequent report-time top observation raced the already completed native child; no nonexistent running snapshot was claimed.

The existing lineage helper was run against the actual new clean source and original J source/pool/receipt. Its source-bound RED is `source lineage refused: source lineage: package-relevant source changed: build/src/kernel-package.ts`. `P/metadata/native-v1/consumer-input-assessment.json` records the full Git delta, all 15 primary/named producer contexts and actual inputs. Changed deploy/native/boot inputs require new producers; they cannot be admitted by broadening composition-only exclusions. The existing rootfs single-stamp guard, Python lineage pool/native/source checks, strict release lineage parser and package-gate stamp checks cannot yet describe retained original-J packages plus the rebuilt deploy/native. This exact consumer gap and a bounded explicit producer-receipt/source/version/epoch join proposal have been sent to B for technical disposition. No guard, source identity, schema or stamp has been changed. Complete transitive/tool equality still precedes each unrelated component reuse; declared-context equality alone is not final reuse proof.

The independent changed deploy producer actually started at 20:40:01 UTC: `timeout 7200 bash build-env/deb/build.sh --producer deploy --arch amd64`, followed only by the original `repo.sh --arch amd64` index command. Its separate target and empty new pool preserve successful native outputs and all original J pools. `P/metadata/deploy-v1/result.json`, `start-observation.json` and `P/logs/deploy-v1/deploy-build.log` record actual execution (orchestrator 2716008, producer timeout 2716271, persistent tmux `75btxdqb-7e0f1b` pane `%101`). The launch observation is not a terminal result. The actual original producer hook is preserved; five direct wrapper refusals and fresh station/unrelated CPU, disk, memory and idle-daemon checks passed. Direct compilation/index uses 3 CPU/5 GiB plus idle BuildKit 1 CPU/5 GiB; packaging uses the owned 4 CPU/10 GiB BuildKit only, always no swap and cpuset 0-3. The owned ARM daemon is absent with state retained; no ARM work was launched.

The boot-tools default recipe is also recorded as an unresolved Phase1 route: `pkgs/mos-boot/build-tools.sh` invokes a Dockerfile whose shared tools stage copies the changed initramfs before unconditional x64 and ARM loader/BusyBox compilation. It has not been executed under an x64-only grant. An exact existing-input reuse or bounded x64 production route must precede that producer; it does not block the independent deploy job.

Phase1 remains x64 software/image/runtime acceptance. Phase2 virt-arm64/CX images and equal-input cold roots are deferred until the separately approved actual main merge, with original ARM identities retained and no PASS claim. Root/image/guest/API/lifecycle/storage/service/capacity/RSS and physical evidence remain outstanding. No successful unrelated producer or kernel, B3 source suite, original root or historical target-Python test was replayed. No main, push, publication, done transition, sibling or parent progress notification occurred. Actual native terminal and deploy gate-start reports were accepted by the sole B endpoint with HTTP success and `success=true`.

The deploy producer and original index have now completed successfully at 20:41:10 UTC. The new archive is `mos-deploy_0.1.0+gitfb6c4597bb90-1_amd64.deb`, 757,444 bytes, SHA256 `5c86a35df5ce3a495fdd8390f40a6e3d099fac4f10346e53783481ccda281168`. Its actual compiled and archived `/usr/bin/mos-deploy` is 2,631,888 bytes, SHA256 `20217cdc353dcc57e7d6fb07a4b0d62a09c87ee0b49ff0a595d3943ed22c0528`, mode 0755 and uid/gid 0. `P/metadata/deploy-v1/archive-payload-proof.json` joins archive/control/owner bytes to the real new target. Package-tool diversion warnings are retained. No producer replay was needed; all original-J archives and the newly completed native outputs still match their hashes.

A separate diagnostic checkout at the same frozen combined source contains exactly 14 unchanged original-J archives plus the new deploy archive, indexed by the unchanged production `repo.sh` and fixed bounded Debian tool. The actual `bash rootfs/build.sh` caller then refuses before any root/container build: `manifest.txt carries more than one git stamp: gite176876b733d-1 gitfb6c4597bb90-1`. `P/metadata/mixed-caller-v1/result.json` records successful reproduction of this expected exit 1, actual archive/index bytes, clean source identity and rootBuildStarted=false. No simulated package, modified stamp, ignored check or production-root fallback was used. `P/metadata/consumer-identity-proposal-v1.json` SHA256 `6ecf69b3dfda4c8916556566b4211e33dbae8010e2d1eb1de8e51f0bf3285e1a` binds the exact four consumer/gate paths and direct regression surfaces requiring technical disposition; compose capture/installed joins and package release identity must remain strict. Both producer jobs are settled. Root production remains blocked only by the identified source/consumer identity contract, with the x64 boot-tools input/route assessment separate. These terminal results supersede the earlier gate-start observation without overwriting it.


### Phase1 boot-tool input assessment and resource allocation

Campaign `mos-open-plans-20260910-100408`: the later B resource assignment reserves this executor's aggregate 4 CPU/10 GiB/no-swap envelope on CPUs 0-3, including its daemon/child split. Worker 347 separately owns 2 CPU/4 GiB on CPUs 4-5. The old conditional 8 CPU/20 GiB concentration is unavailable while that assignment remains. No other worker source, resource or gate was imported, changed or awaited; production identity remains the clean frozen `fb6c4597bb902f69d528bcdc3c8372f310c322b1`. The completed native/deploy results and prior mixed-source refusal were not replayed.

The bounded read-only tool inspection ran at 20:52:53-20:52:54 UTC in persistent pane %111 (PID 2726592). `P/metadata/boot-tools-input-v1/result.json` SHA256 `80ab0cb1883b4bf07a15e7afefbef09fac49db46f8c6a2f10cf8fee552e3192d` records 16 timed steps, immutable image identity, exact copied inputs and cleanup. The task-labelled, mount-free container was created with 1 CPU/256 MiB/no-swap and read-only/no-new-privileges/cap-drop controls, but never started; it was confirmed in created/stopped state before removal. No target executable, ARM code or build ran. Audit success means evidence collection completed, not producer reuse.

The existing production tag resolves to amd64 image `sha256:4cac4ecfca71752a5012b09d6fc5e4e89d064afc56568f703b8c04244cd53631`. Its initramfs script differs from the frozen source, and its required x64 startup BusyBox directory, BusyBox copyright and pinned source archive are absent. Exact docker-copy refusals are retained. The matching kernel/ELF helper scripts and retained x64 loader bytes do not make this image a complete current producer; a script-only overlay cannot supply the missing authenticated startup payload and provenance. B3's fixture image is not promoted to production.

`P/metadata/boot-tools-input-v1/route-proposal.json` SHA256 `c56d536d28aca9cb494038d474ff7dff7785b6a37665b7ff5034588969af4317` requests the narrow architecture-selective production route in `pkgs/mos-boot/build-tools.sh` and its Dockerfile, with direct existing caller/producer tests. The current recipe unconditionally acquires/builds both x64 and ARM loader/BusyBox inputs, so it cannot be launched as an x64-only Phase1 job. The proposal preserves pinned sources/configuration/patches/compiler flags, x64 paths/license/provenance, task-owned tags and explicit later ARM selection. No recipe, composition-only policy, pin or production source was changed; B receives this concrete scope/input mismatch alongside the already submitted mixed-package consumer contract.

`P/metadata/kernel-x64-reuse-v1.json` SHA256 `6ff78030ecd962762d9be3bb147400e3430878b056cefbf77c3be418405e0b42` proves unchanged relevant BSP/resolver/trust contexts, all 12 recorded input mode/blob/hash identities, pinned base/tool/public-cert identities and all four original output digests. The original J Linux 6.12.107 image, config, modules and release are reusable with their original source identity; no kernel was rebuilt or relabeled. New native/root/support/signed-envelope inputs remain separate. This input proof supplies no root, image, guest, teardown, RSS or capacity qualification. Both identified consumer/tool source boundaries remain open, while all successful component evidence is preserved.


### Approved bounded producer join implementation

Campaign `mos-open-plans-20260910-100408`: L1-PRODUCER-JOIN-20260911-2052 approves the exact existing-consumer correction in source-lineage.py, rootfs/build.sh, release-manifest.ts and tests/deb-package-gate.sh, with their direct existing tests and these records. The sole added fixed composition-consumer path is tests/deb-package-gate.sh, subject to real producer/PREPARE context exclusion. No producer path, selector, capture/install transport, package selection, pin or signing policy is added to that scope. Previous same-source/composition-only modes and refusals remain strict.

The joined x64 pool retains exactly 14 original-J archives and replaces only mos-deploy with its actual successful fb6c archive; native mos-init/mos-shutdown use their successful fb6c witness. Original mos-system version/date, mos-podman dependency and embedded mosd identity remain J. Both source delta legs, full source mode/blob/bytes, primary/named contexts, PREPARE/transitive workspace hooks, lock/tool/flag identities, actual archive/control/index/native bytes and successful evidence must validate before explicit join mode bypasses any one-stamp shortcut. Default invocation still refuses mixed pools. Root epoch remains 1577836800; regenerated merged indexes are new outputs.

Implementation will retain the existing pool capture shape and bind a strict canonical join to release/capture and source roles. Direct RED/GREEN covers actual shell consumers, replacement/source/receipt/tool/native mutations, unexpected producers and dependencies, missing release/capture binding and default refusal. Existing producer/kernel/input successes are not replayed; two clean final consumer checkouts must derive identical join bytes before B review and root production. The separate x64-only boot-tool route proposal remains outside this consumer grant. Resource allocation stays 4 CPU/10 GiB/no swap on 0-3; worker347 remains independent.


### Producer join source checkpoint

The implementation now uses an explicitly requested `mos/producer-join-inputs/v1` input and deterministic `mos/source-lineage/join-v1` capture. Fixed reviewed source/receipt anchors are checked against actual clean Git objects, all 37 original-to-rebuilt delta entries, 15 producer/PREPARE input proofs, actual successful commands/logs/tools and archive/native bytes. A separate consumer-only delta binds the real composition successor. The complete joined pool has 15 archives: 14 original J outputs plus the witnessed fb6c deploy output. Its regenerated indexes keep their own bytes; original pools and producer outputs were not modified. No caller-supplied path set or additional producer authorization exists.

The default root caller still refuses the real mixed stamps. The explicit caller reaches the isolated resolver boundary with the original J mos-system version/date; exit 79 is only an input-boundary fixture, not root production. The real pinned x64 package input mode passed 140 checks over 15 archives, 600 paths, three scripts and seven frozen Architecture:all witnesses. Cross-architecture and repeat-build claims remain deferred. The actual child had 3 CPU/5 GiB/no-swap on CPUs 0-3 alongside the verified idle 1 CPU/5 GiB owned daemon, with read-only pool/template mounts and unchanged resource refusals. Its source/wrapper/container/log identities are in `P/metadata/join-v1/actual-callers-result.json` and `package-container.json`.

Focused final checks: 28 source-lineage tests, 30 exact-file release tests/68 assertions, two capture/transport tests and TypeScript passed. Real release-side validation used the actual 15-package canonical join plus both new native outputs, with 25 checks including source/mapping/control/archive/tool/PREPARE/capture/native mutations. The joined release path also verifies all three native entries in the authenticated x64 UKI initrd (init, sbin/mos-shutdown and exitrd/shutdown), rather than trusting a path list. The real-byte UKI test is a bounded fixture, not a signed final image or guest result. `P/metadata/join-v1` and `P/logs/join-v1` retain source-bound gates and direct real-input results.

Original helper and mixed-stamp RED remain. Additional self-review reproduced a joined-index extra dependency/multiline control mismatch, then required exact complete control/index fields; the real unchanged pool passed that stricter check. Earlier test-policy alias mistakes, diagnostic Python bytecode dirtiness and a fixture recorder's native-v3 path typo remain failed setup/test evidence; the native-v2 success and all frozen inputs are unchanged. No failed check, zero-test result or fixture boundary is a production PASS.

The clean commit and two independent exact-source canonical outputs are recorded in the external final delivery after commit creation. B performs the required independent review before any affected root. The boot-tools x64 route is a separately submitted exact caller/input issue; no default ARM-producing tool recipe ran and it was not added to this join scope. Phase1 remains x64, and no unrelated package/native/kernel/ARM suite was rebuilt or relabeled. This checkpoint does not qualify root, image, guest, lifecycle, RSS, capacity or physical behavior.


### Producer join frozen candidate and final input delivery

The isolated consumer correction is `fdf8a480057b64073c9b9e15e399fca1b38d607d` / tree `7eed91c48aa9a00fc75d8661260aac78a004c00e` / Git epoch 1789162665; its parent is `e2b832e79fabdcdfcfc78595a3ea98a642ab3f3f`. The final candidate changes exactly eight files in the authorized scope. No producer, selector, capture/install transport, package pin or boot-tools source changed. Source and component identities remain separate from this later tracking record.

`P/Consumer-fdf8a480057b64073c9b9e15e399fca1b38d607d/sources/verification-1` and `verification-2` are clean independent checkouts of that exact commit. Both actual helper invocations generated byte-identical canonical joined lineage SHA256 `f6ea92cdf5778a78b43214ac664428dd9ac45a7afc90c1aaa6ab64eb65bb97a1` against the original J receipt/pool and successful fb6c native/deploy witnesses. The actual final root caller preserves default mixed-stamp refusal, then reaches only the explicit input boundary at exit 79 with the original J package release version/date. The final real x64 package input gate again reports 140 passed checks, 15 archives, 600 paths, three scripts and seven original Architecture:all witnesses. The final source's real-record/native release fixture passes 25 checks. No root or image build ran.

Final input metadata SHA256 `394f715893881b2f84588c536b219f287a88392d24eb3b657abbfe8f53d1fd07` records all ten steps, both source copies, canonical lineage, original and rebuilt sources and unchanged joined-pool bytes. The temporary archive-checking child exited 0 and was confirmed removed; its actual bounded create/inspect/start resource evidence and eight wrapper forwarding/refusal/cleanup controls are in `P/metadata/join-final`. No shared daemon or active worker was modified.

Review delivery `P/metadata/join-final/delivery-v2.json` SHA256 `68dc4e550088670ab023f73063ba7e5655c42a7bf1763e081e6f99fa0d6d4c95` binds all eight committed file modes/blobs/bytes, six ancestry anchors, 22 gate/log pairs and the complete external evidence. Execution readiness is `P/Consumer-fdf8a480057b64073c9b9e15e399fca1b38d607d/metadata/execution-readiness-v2.json` SHA256 `4b37fc8d3452a979e76241b2b82c08f6515b0b9f597152b492f269a82e7af05a`. It explicitly names the owned x64 builder and planned fresh production checkout/wrapper; previous readiness bytes remain preserved. B's independent source review precedes root execution. The already submitted x64-only boot-tools route correction remains a separate technical dependency for its dependent assembly, with no generic approval request, ARM work or producer/kernel replay.


### Approved single-target boot-tools route

Campaign `mos-open-plans-20260910-100408`, L1-BOOT-TOOLS-TARGET-ROUTE-20260911-2145: implement the exact target-selective producer in `pkgs/mos-boot/build-tools.sh` and `pkgs/mos-boot/Dockerfile`. The direct existing test is `tests/boot-busybox-package-test.sh`; it will exercise the real launcher with only Docker isolated and the actual recipe's selected command branches with acquisition/compiler boundaries isolated. Omitted target defaults to x64; explicit empty, invalid, repeated or conflicting target inputs refuse before resolution. The Dockerfile also validates its target before acquisition. The x64 branch must perform no ARM foreign-package, cross-compiler, loader, BusyBox or emulator work. Explicit aa64 is inspected with command fixtures only. Original pins/config/patches/applets/epochs and source/license output paths remain unchanged.

This is real boot-tools producer attribution, not a composition-only exception. Neither producer path enters COMPOSITION_PATHS or JOIN_CONSUMERS. The completed fdf8a480 join source and fb6c native/deploy outputs remain preserved. Source-only route review will precede the real x64 producer; its successful output/tool receipt is an output of that build. The already granted join consumers then bind that exact named boot-tools role and final caller use, with both original J and fb6c input legs still verified. Missing future tool hashes cannot delay the producer's source review or authorized execution. The minimum next delta and its actual producer/PREPARE non-overlap will be recorded, without a generic producer engine.

B7 owns only the aggregate 4 CPU/10 GiB/no-swap allocation on CPUs 0-3. Worker347's later separate allocation is 4 CPU/10 GiB/no swap on 4-7; its source and results are independent. No eight-CPU concentration, ARM execution, worker import, producer/kernel replay, shared resource mutation or new task is authorized here. B performs the required bounded review and local integration before the real corrected tool build and dependent final input/Phase1 root acceptance.


The target route now has source-bound RED/GREEN. The original launcher accepted an explicitly empty `--target` and called the recorded Docker boundary; that semantic RED remains. The corrected launcher validates CLI/environment target agreement before invoking the resolver, defaults to x64, uses an explicit amd64 producer platform and an architecture-specific target tag. The Dockerfile rejects invalid target arguments in its first RUN before acquisition. Its x64 command path performs no foreign architecture registration, ARM package acquisition, cross-compiler/emulator installation or ARM compilation; only one loader and BusyBox output directory reaches final COPY. Selected loader Ninja concurrency is two, alongside the existing two-worker BusyBox limit and the external aggregate job cap. Original compiler/config/source/patch/epoch flags and required helpers, licensing and source archive outputs remain.

`P/metadata/boot-route-v1/target-final.json` binds the actual source bytes and passing existing package/target-route test: ten real launcher argument cases, three direct Dockerfile target refusals and two isolated recipe branch/provenance cases. Existing wrong/missing BusyBox, wrong architecture, missing applet, dynamic linkage and digest controls pass. The original optional unsupplied-payload notices remain explicitly unqualified. The first branch-fixture attempt had a shell-function-name/path-redirection setup error, retained separately and corrected only in the fixture. No Docker build or target execution occurred in these source tests; explicit aa64 remains inspection only.

The bounded actual context proof covers all 19 boot-tools context entries, 13 protected source/config/resolver inputs and all 15 unchanged package producer/PREPARE input maps. The complete pkgs/mos-deploy, pkgs/mosd and build-env trees equal the existing fb6c producer source, so the successful deploy/native witnesses remain their original inputs and identities. The two producer files and this one direct test remain absent from both composition-only sets. After the required source review, build the corrected x64 tool once, then bind its real immutable image and selected payload/license/source hashes in the already-authorized named boot-tools join role. This is the explicit producer-output predecessor for the final join/root consumer, not a demand for future output hashes before launching the producer. No unrelated source or successful package/native/kernel gate was replayed.


### Boot-tools route source handoff

The exact route source is `4716a2b2020737559fa8798c01fb37e3900ec6e6` / tree `cf419477827eb9441ad9c26eb4d18cbd5b303b30` / epoch 1789163851, parent `884e542f6456d845e6ba10f91c5230c6b8acf23a`. It changes only the two granted producer files, `tests/boot-busybox-package-test.sh` and these two records. Final `target-final-v2`, syntax/whitespace and clean-source proof gates pass. Loader staging uses `cp -p` to retain the produced file's mode/timestamps. The earlier direct source-test identity remains preserved separately.

`P/BootTools-4716a2b2020737559fa8798c01fb37e3900ec6e6/metadata/source-readiness.json` SHA256 `c861ea8848863efabb86286f13df2fb55700b20eab5ded7eb02179f551ee4579` records the clean immutable verification checkout, all 19 actual boot-tool context identities, 13 unchanged protected inputs, all 15 unchanged local producer/PREPARE input maps, the pinned amd64 base resolver and the exact planned x64 invocation/tag/resource envelope. Existing joined-consumer verification intentionally refuses this unwitnessed producer delta at `pkgs/mos-boot/Dockerfile`; no producer path was hidden in a composition-only set and no root ran. This expected refusal waits for the newly authorized tool output witness, not another product scope decision. fb6c remains the actual deploy/native source with its original epoch/version/receipts, and J retains unrelated package/kernel identities.

Review delivery `P/metadata/boot-route-v1/delivery.json` SHA256 `defc9e018130359e235a7c03941841930d6ad8e88ffc19954deeb5bf4e470c72` binds five committed files, four ancestry anchors, 8 gate/log pairs and 30 evidence files. B reviews this stable route before the actual tool producer. Then the already granted named boot-tools role binds that reviewed source, successful recipe/tool/output witness and actual caller/release use; only after those actual inputs pass can the affected root/signed-image successors run. The tool image, loader and BusyBox production hashes remain outputs to create. No production, ARM target run, kernel/native/package replay, shared-tag replacement, sibling source import or main/publication action occurred in this source handoff.


### Reviewed join and boot producer invocation preparation

B independently accepted consumer `fdf8a480057b64073c9b9e15e399fca1b38d607d` and its original-J/fb6c inputs in B-JOIN-REVIEW-PASS-20260911-2158. Local integration `78e3b5c08767656f0b17491dce7a53e6b37803e7` is a tracking/integration identity; it does not replace the frozen producer or composition identities. The accepted canonical lineage remains `f6ea92cdf5778a78b43214ac664428dd9ac45a7afc90c1aaa6ab64eb65bb97a1`. No accepted join suite, native, deploy or kernel producer was repeated. The separate boot route `4716a2b2020737559fa8798c01fb37e3900ec6e6` remains in B's existing source-review handoff; no root-only retry from fdf8 was launched.

The new task-local producer runner and wrapper are confined to `P/tools/boot-producer-v1`. At 22:14:19-22:14:20 UTC, pane %101/PID 2800286 prepared a separate clean 1831-entry production checkout at exact `4716a2b2`, checked its actual boot context against the source-readiness record, and exercised the real launcher with only Docker replaced by an argument recorder. All 12 wrapper checks passed: exact pinned x64 arguments, private tag mapping, explicit owned builder/load/metadata outputs, and refusal of altered platform/target/base/snapshot/context/tag or extra/alternate commands. This is invocation preparation, not a Docker build, resource transition, target execution or successful tool witness.

Preparation metadata `P/metadata/boot-producer-preparation-v1/result.json` SHA256 `08ec3028db88082cfe1782c8767685fbf1e1935b933e58c633ff662de75e81ef` and forwarding record SHA256 `a90474d4c2d5d36d64621c0c83052e85a00a340be09e44dee8aa02b3326b98d8` bind the exact runner/wrapper bytes. The source remains `4716a2b2` / tree `cf419477827eb9441ad9c26eb4d18cbd5b303b30` / epoch 1789163851. The planned image tag is `ai-agent/mos-75btxdqb-boot-x64-4716a2b20207`; shared tags are never replaced. The immutable previous envelope helper supplies the owned-daemon quiescence and 4 CPU/10 GiB/no-swap transition, with no direct child during compilation and at most four BuildKit workers. The runner repeats full fresh CPU/memory/disk/input checks at actual launch, retains worker347's separate 4 CPU/10 GiB reservation and refuses without retry if a condition fails. No live resource was changed by preparation.

The actual x64 boot producer starts only after the already-requested bounded B route review. Its resulting immutable image, BuildKit metadata and payload/license/source bytes are generated outputs. The separately granted named boot-tools join role then binds those real outputs, source/context and actual caller/release use; it remains unfinished until that evidence exists. Producer paths remain excluded from both composition-only sets. No future output digest is requested as permission to build the tool, and no unwitnessed tool is admitted to a root. The final combined consumer/source/input proof and affected x64 acceptance remain pending under the existing automatic grant.


### Actual boot-tools start and bounded transport recovery

B-BOOT-TOOLS-SOURCE-REVIEW-PASS-20260911-2206 independently accepted the exact route `4716a2b2020737559fa8798c01fb37e3900ec6e6` / tree `cf419477827eb9441ad9c26eb4d18cbd5b303b30` / epoch 1789163851. Its local integration `85c54845976c7b9c02cf223419d56e950e1b38da` is not the producer source. The prepared clean production checkout and immutable recipe/inputs were reused. No source suite, native, deploy or kernel producer was repeated.

The first actual invocation ran at 22:18:04.560049-22:18:24.800720 UTC, runner 2802774/build timeout 2803048/adapter 2803062, and exited 1 while BuildKit waited for connection: `context deadline exceeded`. No Dockerfile stage or compiler started. Terminal collection `P/metadata/boot-producer-launch-v1/terminal-collection.json` SHA256 `26a12bd629d80f50df70ab120024d2be0fb1771171638076084035ca334b8a4b` preserves all nine step/log bindings, absent processes and the original invocation/resource identity. Build log SHA256 `614da669ffd6a29c2a072c4426646bde48a9fc97552e96a7d9d729c9fee07fc4` remains unchanged. The first start recorder crossed that fast terminal and failed its running-state assertion; its files with historical running-snapshot names contain terminal metadata and are not counted as live evidence.

The bounded read-only reproduction captured the remote driver's exact internal `docker exec -i ai-agent-mos-wave-75btxdqb-x64 buildctl dial-stdio` call through PATH. The strict task wrapper had refused that necessary connection command. Plain remote inspection and direct owned buildctl were healthy, so no daemon restart, cache deletion, binfmt or source correction was needed. Original wrapped inspection returned an inactive status (its CLI exit 0 is not a successful connection). A separate `tools/boot-producer-v2` permits only that exact owned-container stdio command, retaining every other strict argv refusal and the immutable v1 bytes. All 19 forwarding/refusal checks and actual corrected-PATH remote inspection passed. Proof SHA256 `e8eb26680b9c90712f88ca132918689eb78097e93db710e8e9e01428e6a334af` binds wrapper `435eee63d49d12ef70b09c6f42ab1921affb6b2c78a4076174698aceb8d86152` and runner `a098fafdd111e7293c3eec8c0c8dcb8f61045654adda467009fccda1a2cfa972`. This is execution-adapter recovery, not another product-code repair round.

After fresh capacity/CPU/memory/disk/headroom and owned-quiescence checks, the unchanged reviewed launcher started again at 2026-09-11T22:23:41.930939+00:00, runner 2803900/build timeout 2804182/adapter 2804196, persistent tmux `75btxdqb-7e0f1b` pane %101. This continuation reached real Dockerfile package acquisition/installation, resolving the connection failure. Immutable start snapshot `P/metadata/boot-transport-v1/v2-startup.json` SHA256 `e4889a131eafd458e8fc717a20d8004db26c25fc6bd7d6ccbb770e06c603545e` records exact source, environment, actual buildx argv and limits. The sole owned daemon remains 4 CPU/10 GiB/no-swap on 0-3 with worker parallelism four; worker347's independent 4 CPU/10 GiB on 4-7 stays reserved. No additional B7 heavy child or ARM producer runs. Build-time ukify/compiler Python is existing tool-container content, not target-root Python.

The live gate writes `P/BootTools-4716a2b2020737559fa8798c01fb37e3900ec6e6/metadata/production-v2/result.json` and `logs/production-v2/boot-tools-build.log`. Actual-start handoff `01M2995PVX7CK8ND704G3647RC` went to B. The private tool tag is unchanged and the old shared tag remains untouched. At the recorded snapshot the producer is running, with no final tool/root/image/guest PASS. Its terminal will be collected once; actual loader/BusyBox/helpers/license/source/image identities then feed the already-granted named boot-tools join and final consumer/input review. All original component identities and automatic x64 successors remain in effect; no producer path enters composition-only policy.


### Boot output collection and named producer join

The real `4716a2b2020737559fa8798c01fb37e3900ec6e6` x64 tool build completed at 22:28:10.387591 UTC with exit 0, followed by successful immutable image inspection. The original production-v2 aggregate remains exit 1: its recorder requested the absent `containerimage.config.digest` metadata key after import. Its result SHA256 `d7acc26c71a82faf763e7fa36e564184cb5b95027a2a059af688746f709319b2`, build log and all ten step records remain unchanged. No producer was replayed.

Separate task-local `boot-output-v2` collection verified the canonical OCI manifest `sha256:28164316a7d6d6c04cdbbec7c654be7b1ee83e61e680ae1872804e3f6bfb496c`, its distinct config `sha256:58c3ff0bf4198c236f289846e0bbdb7ce3dbef732e4ecba584ed2b83135b274e`, all nine compressed/uncompressed layer identities, actual immutable Docker lookup, source/target labels and recipe/frontend/base/snapshot provenance. The old config lookup failure is an address distinction, not a product failure. The first collection setup errors (inspect has no Descriptor; host Python lacks hashlib.file_digest) are retained in boot-output-v1, with the exact correction in a separate collector. No generic optional-field bypass or target execution was added.

Output witness `P/metadata/boot-output-v2/output-witness.json` SHA256 `af5bc012346a99d360612a1340df58de35265b9a7cc638d2286401b2a3ab7112` binds 15 payload files. Both EFI members are AMD64. Startup BusyBox is static, 1,213,152 bytes, SHA256 `c48d13f5cc6f68e5ef897de4c04f85cb0d8af510ff1af0256490b37029fa6c4a`, with the exact 19 required/available applets, reviewed config, original 1.36.1 source archive and copyright. The actual initramfs/kernel/closure scripts equal the frozen source; required tool packages and licenses are retained. BuildKit reports incomplete materials/reproducible=false; collection preserves that limitation rather than claiming reproducibility. Twelve focused collector tests pass, including wrong/missing metadata, manifest/config conflict, corrupted layer, wrong source/target/owner and missing/mutated required payload controls. No ARM payload, container or root was produced during collection.

The granted named join now separates J -> fb6c native/deploy attribution, fb6c -> 4716 boot producer attribution, and 4716 -> the actual clean consumer successor. The exact reviewed 11-entry boot leg and 22 context/protected inputs are bound separately; all 15 local producer/PREPARE maps remain equal to fb6c. Neither boot producer path nor its direct test enters either composition-only set. The immutable canonical boot role SHA256 is `a893b517c2a249afed8d34d323e6f5148aa55ec353c9956f5e422766d516b664`. Creation verifies actual source Git objects/modes/bytes, ancestry, immutable producer/output evidence, all original step logs and current image/payload identities. Only the specific preserved recorder terminal is distinguished from its successful producer command; failed or incomplete production remains refused.

The root caller consumes the verified immutable tool identity before resolving or building containers and rejects a conflicting supplied identity. The unchanged capture shape carries the strict named role. Release validation binds the same role, receipts and captured bytes, records LOCAL_BOOT_TOOLS_X64 by manifest identity, and checks the authenticated UKI's actual startup BusyBox bytes in addition to all three native entries. Missing/changed BusyBox and missing tool records refuse. A source-bound downgrade RED demonstrated that removing the tool role and selecting the old join schema needed an explicit guard: old schema acceptance is now pinned to the already-reviewed fdf8 composition; a successor cannot remove its tool obligations by relabeling its schema. Same-source/composition-only defaults and original J package/control/version/date identities are unchanged.

The initial source-bound REDs cover the old helper's missing tool receipt contract and the old native-only archive checker accepting missing/changed BusyBox. Focused GREEN covered eight joined helper tests, 31 exact-one-file release/lineage tests (72 assertions), types and shell syntax; the final downgrade guard and clean final input checks are recorded separately in the following handoff. Actual helper validation already reproduces the canonical tool role from the frozen source/output bytes. A clean candidate, two disjoint equal-input lineages and actual root/package/release consumer boundaries are required before B reviews readiness; boundary exit 79 is never root acceptance. Only the existing authorized x64 successors follow that review. Original J/fb6 native/package/kernel artifacts, no-Python/routel-only selection and failed root histories remain unchanged. Latest worker347 reservation is 2 CPU/4 GiB on 4-5; B7 retains aggregate 4 CPU/10 GiB on 0-3. No shared resources, main, publication, cron or parent progress actions occurred.


Final pre-commit source checks passed: eight joined-helper cases, 31 exact-file release/lineage cases with 72 assertions, two capture/lineage cases, TypeScript, shell syntax and docs/scoped whitespace. The added missing-role/schema-downgrade control has its own real RED and final GREEN; original fdf8 legacy join remains accepted only at its actual reviewed composition identity. PMA-CR self-review covers all five changed implementation/test files and their callers; no remaining introduced finding was identified. This is self-review pending B's independent review.

The task-local final test recorder reused `first-green.json`. Its final seven-step content was preserved byte-for-byte as `final-green.json`; the original first four-step summary is no longer available. All original four logs and observed exit codes remain, and no original timing was fabricated. `P/metadata/boot-join-v1/summary-path-collision.json` records the limitation explicitly. Final checks carry their own current source hashes and timing; no check was replayed solely to reconstruct the lost summary. This evidence-recorder error does not change product bytes, successful producer outputs or test results.


### Clean named-tool consumer and final input handoff

The isolated consumer is `fbd700480ec3eb32f40c493056aa2557f8015129` / tree `d504aba7490ad975d08df36c9fabb574eafef4b0` / epoch 1789167736, parent `94ad24ac3ab1822d35fe3901af2f3ab1b21f7b65`. Its seven files are the three granted production consumers, two direct tests and these original two records. Tool producer/source remains 4716; native/deploy remain fb6; unrelated packages/kernel remain J. No producer, consumer-selection, pin, no-Python/routel, signature or composition-only path-set change is included. A generated untracked source-lineage bytecode cache was moved into scoped evidence before clean freeze; it was not committed or used as a source input.

`P/BootConsumer-fbd700480ec3eb32f40c493056aa2557f8015129/metadata/final-input-validation.json` SHA256 `33bfaa0febe352c5d12d5365a394b5e0170554eb73bd2429be66e2e217dfb068` records 13 actual steps ending 23:03:00.050981 UTC. Two clean disjoint checkouts each verify all 1,831 mode/blob/byte entries and generate byte-identical canonical lineage SHA256 `aadcadcb30bf3e05473253255d4d9b376b8f538ea23f35c4b25eae0965a62eb5`. The exact boot producer leg has 11 entries; the final consumer leg has seven. Actual native/deploy receipts, tool image, boot payloads and every reused pool/control/index byte were verified without rebuilding them.

The actual root caller retains its default mixed-stamp refusal, passes the explicit joined-input path to the isolated resolver boundary (exit 79), emits the original J package version/date and exact immutable tool manifest, and refuses the config digest supplied as a conflicting tool identity (exit 1). No production BASH_ENV/DEBUG injection is proposed. The input-only package gate passes 140 checks over 15 archives, 600 paths, three scripts and seven frozen all-architecture witnesses. Its actual container used 3 CPU/5 GiB/no swap alongside the quiescent owned daemon at 1 CPU/5 GiB after positive-headroom checks; the daemon's original 4 CPU/10 GiB envelope was restored after the child exited. Both lifecycle records and actual create/inspect/start/exit proof remain under `P/metadata/boot-join-final`. No other daemon or worker allocation changed.

The exact final-source release consumer passes 35 checks with actual native/BusyBox bytes in a bounded UKI/cpio fixture. Thirty-three refusals include removed/downgraded tool roles, source/context/recipe/manifest/payload/receipt changes, capture/installed archive mapping changes, wrong caller identity and changed actual boot bytes. It is an input/fixture gate, not a signed final artifact, root or guest result. Readiness `metadata/successor-readiness.json` in that same immutable consumer directory has SHA256 `26c496ae0ca3f55d3589a85275aca90c44e591f950381d142e0365e301ac2996`. It binds source roles, public metadata, kernel reuse, actual producer receipts and the planned x64 no-cache=0 environment without boundary fixtures.

B's independent bounded review/integration remains the next source-quality gate. After its actual input review passes, the existing automatic x64 root/support/signed-image and real Phase1 lifecycle/API/authentication/storage/update/fallback/reset/service/size successors proceed. No future root/image output hash is required before its authorized producer. The final two-architecture/physical obligations remain deferred until approved main integration, never counted as passed. The original boot production recorder failure, collection setup errors and overwritten initial test-summary limitation remain explicitly preserved alongside their valid final evidence.


### Reviewed boot join: actual x64 root start

B accepted the exact `fbd700480ec3eb32f40c493056aa2557f8015129` composition / tree `d504aba7490ad975d08df36c9fabb574eafef4b0` / epoch 1789167736 and actual joined inputs. B's newer integration also carries the independent startup worker, so it was not synchronized into this candidate. This original worktree advances records only; the new clean `BootConsumer-fbd700480ec3eb32f40c493056aa2557f8015129/sources/production-x64-run1` freezes all 1,831 tracked entries at the reviewed source.

The normal x64 root command `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh` actually started at 2026-09-11T23:29:07.576599+00:00. Orchestrator 2842349 and root timeout 2843152 were live in persistent tmux `75btxdqb-7e0f1b`, pane %101, at the immutable startup observation. The environment selects x64/dev, mosd and containers, no-cache=0, root epoch 1577836800 and the explicit verified join; no BASH_ENV/DEBUG fixture is present. The 15-archive/18-file joined pool and 163 fixed cached inputs were verified in the new directory; canonical lineage remains `aadcadcb30bf3e05473253255d4d9b376b8f538ea23f35c4b25eae0965a62eb5`. J package/mos-system/mosd identity, fb6 native/deploy and 4716 boot-tool manifest identity remain separate. No producer/native/kernel/tool was rebuilt.

Fresh capacity, unrelated CPU below 50%, memory/disk, owned quiescence/builder and positive-headroom checks passed. Free disk was 323474878464 bytes; unrelated working memory was 3210990616 bytes. The sole B7 slot remains aggregate 4 CPU/10 GiB/no swap on 0-3, with the existing verified 3 CPU/5 GiB direct child plus 1 CPU/5 GiB idle-daemon transition when required. The separate worker allocation is not consumed or changed. The versioned root-v2 wrapper preserves original resource and OCI integrity refusals, bounds compiler workers at four, forwards the exact owned BuildKit stdio route, maps only the reviewed boot-tool request to its immutable manifest and refuses tool rebuilding/unassigned FIT production. A later component caller must still prove actual use; the environment alone is not that evidence.

The first root-v1 preparation copied old binary test fixtures and text rewriting stopped with UnicodeDecodeError before any runner or root started. Its partial files remain preserved. Root-v2 copies only the named execution scripts; focused forwarding/headroom/tool-mapping checks passed. Runner SHA256 `17bd5448dd36b68dc97b10e59d48e49b9a1212d8080ef69bfe88a6245618d633`, wrapper `8074c37449658589cb8a58463f04929d5e4c86621e91cc6d0689826c54d802eb`, execution patch `bad1c2695b115dc0d3f71d54ae236760aea46d4e6a54fc0a951b1c6207b36a21`. Original frozen source/wrapper/output and all historical failures remain unchanged.

Immutable actual-start snapshot `D/metadata/root-x64-start-v1.json` SHA256 `1e5329f363427e8fdbad70cc3157c98956ead54f6fbcb2d2d23d9c947dca1489` binds the actual source, input, environment, process and resource observations; D is the BootConsumer directory above under the existing Phase1 directory. The live gate records `D/metadata/W2/x64-run1.json`, log `D/logs/W2/x64-run1/root-build.log`, and outputs `D/sources/production-x64-run1/_out/x64`. Actual-start handoff `01M29CX5ZX6MA9C83X9Z3DYR9X` went to B. This is gate-pending, not root/image/guest acceptance. Collect its actual terminal once, then automatically advance only eligible affected x64 successors. No ARM, sibling-source import, main, publication or cron action occurred.


The root's terminal supersedes the live startup observation above. It failed at 2026-09-11T23:30:12.430561 UTC (aggregate 23:30:12.431727 UTC), exit 1, in `90-pack` pack 11/19: `runtime composition refused: unsupported node: /rootfs/dev/null`. The log records 11 local packages and 173 installed packages before that refusal. Debug export completed (134,009,869 -> 95,227,256 bytes); it is not a final packed-root measurement. Both original runner/root PIDs are absent. All 14 completed step/log hashes verify; the actual 1,831-entry source, all 18 joined-pool files and both native exports remain unchanged.

Terminal `D/metadata/root-x64-terminal-v1.json` SHA256 `c6467d5ff8f84d338b3efdd6bfca88d17e7095c1539ff9fb4340e52cf23ab007` binds metadata `b62c1c046179ba045015eea6a775e1935a8a04429dae02e3ccd6483027c40e5f` and root log `a62807b8b8d43d920592306d3128ea5441b820500e0647dd52ef2edd1cf95a79`. B received the concrete terminal in `01M29D25G7A8M5Q6NFR55AK7K5`. The selected origin that reaches `/dev/null` remains unestablished; existing bootstrap-device capture and explicitly named runtime-link rules do not authorize a blanket special-node exception. No product hunk or unchanged-root retry was applied. The affected composition stage and its descendants remain blocked by this actual refusal; all successful producer/kernel inputs and independent worker work remain preserved. This attempt provides no successful root, verity image, signed image or guest result. B7 has no active heavy child after collection.


### Read-only diagnosis: systemd masks reached the disposable null device

The deduplicated failed fbd root remains unchanged; its 14-log terminal collection was reused. The actual 10-compose OCI manifest `3abdf8ca36ba4373dbb7d84da8d7955d9cc3a4cb6649969b6cdd417e6fc7440b`, all four compressed/diff layers and captured ownership inputs were checked. Layer `dd7c7862f3fea696729e2524362ff0107e9eda9cd9d43519267f22aaae03ed65` already contains `/dev/null` as a character device 1:3, mode 0666, uid/gid 0. The owned BuildKit's cached pack-transfer snapshot 484 has the same device and the exact canonical fbd lineage `aadcadcb30bf3e05473253255d4d9b376b8f538ea23f35c4b25eae0965a62eb5`. Its original closed/configured snapshots retain nanosecond timestamps and security.selinux xattrs. Narrow read-only export `diagnostics/dev-null-v1/actual-transfer-capture.tar` SHA256 `b59d6067132d8099473e438f19677814eeddbe7449b2fda7dd24e7b0080b551d` preserves the relevant cache inputs. No daemon, cache, source or producer was rebuilt or changed.

The first concrete selected route is `/usr/lib/systemd/system/cryptdisks-early.service -> /dev/null`. The systemd-owned resource rule matches this mask; `Selector.add` follows the undeclared ordinary symlink, then `retain`/`metadata` correctly refuse its special-node target. The same actual systemd 257.13-1~deb13u1 archive SHA256 `ee81302a1d5b7434762b6e784a572854d4b6cf6235e33e2d104ad4e1cae71ab4` supplies four masks: `cryptdisks-early.service`, `cryptdisks.service`, `hwclock.service` and `x11-common.service`, all under `/usr/lib/systemd/system`. Each is already a root-owned symlink to `/dev/null`; none is a new package or generator. Existing declarations cover six other installed null masks. A bounded audit accounts for 24 related captured endpoints, including eight bootstrap devices, all ten null masks and the relative `/etc/mtab -> /proc/self/mounts` link (not a selected root). The initial 23-entry audit is preserved; v2 adds that normalized relative mount endpoint without replaying the root.

Eight external source-bound fixtures use the unchanged frozen production selector and actual cached device/link/unit/ownership inputs. Original RED follows the exact cryptdisks-early chain. Adding the four explicit runtime-link declarations in an external rules fixture passes actual select/copy/verify with 14 retained paths and a nonempty original `basic.target`; it also passes when disposable `/dev/null` is absent. Wrong link target, missing owner, missing required unit, undeclared mask and a selected device remain refused. These are focused subset fixtures, not a full composed root or target service execution. Original source metadata/xattrs are recorded; the host fixtures preserve mode, owner, target, device numbers, nanosecond timestamps and regular bytes but do not reproduce security.selinux. The difference is explicit in `fixture-metadata-comparison.json` and is not a full metadata-transfer PASS. The exited RUN mount namespace is unavailable; original mount arguments and OCI/cache identity establish the image-owned device provenance.

The minimal external proposal changes `consumers.json` only by adding the four exact runtime links with the existing kernel-devtmpfs generator/order contract. It needs no selector/compose algorithm change, device whitelist, broad /dev exclusion, package/pin change or producer replay. One additional existing consumer-policy boundary is real: `consumers.json` already belongs to COMPOSITION_PATHS, but not the stricter JOIN_CONSUMERS set. An actual canonical-validator fixture refuses that delta. The proposal therefore requests only that exact path in Python and release JOIN_CONSUMERS, with direct existing composition/helper/release tests. No producer path or test-directory allowance is proposed. Final clean successor/context/receipt/tool/capture validation remains required after source review; original J/fb6/4716 component identities stay unchanged.

Proposal `D/diagnostics/dev-null-v1/proposal.json` SHA256 `9077c0cd58373cd32cc6b01bce96282961ada3dccd1219e7f764a8cd8c7a52a6` and delivery `2cb51b7949e91f758b2d9aa1d8438b645def83cad6aaf024da358e1d5cc3ac0d` were sent to B in `01M29E46XTG08EBB9NXM2WYWH0`, starting its existing execution `39f82831-a851-4efc-9ba4-3cc268ddadf1`. The exact product hunk awaits that technical disposition; none is applied. This bounded round used no new container, root, kernel, native/deploy/tool build, sibling wake, main/publication or cron action. No successful root/image/guest/cold/physical result is claimed.

### 2026-09-12 four-mask implementation grant

L1-FOUR-SYSTEMD-MASKS-20260912-0005, delivered by the 00:33 transport recovery, approves the four exact existing systemd mask declarations and the matching `rootfs/runtime/consumers.json` JOIN_CONSUMERS entry. Implement on the current B7 branch; reuse dev-null-v1 evidence and original J/fb6/4716 outputs. Direct source-bound composition/lineage checks and two clean final input copies precede B review and any root successor. No selector algorithm, producer, unrelated source, index, or status change.

Source-bound RED reaches the original `/dev/null` special-node refusal and both joined-path refusals. The exact approved production patches are applied. Final composition tests retain all four systemd links plus an ordinary required unit, with and without disposable null; wrong target/origin/required unit/undeclared mask and direct selected device still refuse. The final actual cached-input select/copy/verify has seven cases. Original SELinux-xattr fixture limitations remain explicit; this is not a full root result.

Evidence under `Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-v1`: direct composition GREEN, joined helper plus final context negative, capture lineage, exact single-file release tests and types pass. Two fixture preparation failures (parent ownership, then preserving existing fixture runtime links) remain separately recorded; production checks were not relaxed. Self-review confirms only the four declared rows and the one matching path in each JOIN_CONSUMERS set; no producer/pin/selector/compose algorithm change. Clean successor two-copy actual-input proof and B review are the remaining source handoff gates; no root or producer replay is claimed.

### 2026-09-12 four-mask clean candidate and actual input handoff

Composition candidate `f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd` / tree `164725070bac579b771ba137b13cbe36a6c3678a` / epoch `1789173629` is the isolated eight-file correction. Two independent clean1831-entry copies produce identical canonical lineage `e4e8e56c0cbf15d5fe1d9b3b12567212b2f7326bffcb452e9fa8f38ad414f91b` against the unchanged actual J14 archives, fb6 deploy/native and4716 tool witnesses. The final helper verifies all15 actual producer/PREPARE maps and the full nine-path consumer-only delta from4716; the present correction has eight files relative to its own parent. Pool/control/index/native/tool bytes retain their original identities; root epoch remains1577836800.

Direct gates: three composition tests (two positive cases and four refusal subcases), direct selected-device refusal, eight joined helper tests plus the separately final-bound context-negative test, two capture/lineage tests, exact single-file32 release tests/76 assertions and type/docs/diff checks. The final actual cached-node select/copy/verify has seven source-bound cases. Three original source REDs and two fixture setup failures remain historical evidence. The final shell caller keeps default mixed-pool refusal1, verified join boundary79, and wrong tool refusal1; the final release input validator checks the actual new lineage with33 total positive/negative cases. These are source/input fixtures, not a real root/image/guest result.

Evidence: `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/metadata/final-input-validation.json` and `successor-readiness-v2.json`; implementation gates, source bindings, self-review and retained failures are in `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-v1`. Readiness preparation v1 compared the two different delta bases and refused; v2 checks both exact Git bases, without rerunning input gates. No producer/kernel/native/tool or unchanged140-check package-gate replay. B independent review/local integration is next; no later347 source was imported. The previous fbd root remains failed and immutable.

### 2026-09-12 reviewed four-mask root command and environment terminal

B independent review/input PASS is consumed; frozen composition stays `f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd`, not B's later integration. Actual x64 root command started at `2026-09-12T00:51:54.238828+00:00` after 14 preflight checks, then exited1 at `2026-09-12T00:51:59.167224+00:00` before any root stage/direct validation child. Orchestrator2889090/root timeout2889904 are absent. Exact refusal: `W2 execution envelope: Auto-removed daemon still exists; refuse replacement`. The idle daemon held5157154816 bytes; the unchanged 1GiB positive-headroom requirement triggered orderly owned-daemon stop, whose immediate removal check refused during the asynchronous transition. A later single read-only observation finds the daemon absent and its labelled state volume retained. No forced shrink, shared/cache change, source defect or root PASS.

All15 completed step/log identities and absent processes are bound by `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/metadata/root-run1-terminal.json` SHA256`50fe8163a53478d152f7c5b2f92a41fe3b3355cba37b671ac93266ce20446ff4`. New tools under `tools/root-v1` preserve the original envelope and immutable4716 image, with separate source/tag/output paths and explicit cgroup checks. Runner `a6086c36...` and wrapper `89486dc5...` are fully bound in metadata. Original J/fb6/4716 source roles and verified pools/native/tool/kernel/cache remain unchanged. The startup recorder observed the quick terminal instead of a still-running process; its failed assertion/HTTP400 transport is retained, not a delivered notice. Actual start+terminal handoff to B is `01M29HSC690ESC4K0JFHNPKT1J`.

Next: existing same-node environment recovery may recreate only the now-absent owned pinned daemon with retained state after fresh capacity and create/inspect/start proof, then resume the never-executed producer using versioned attempt records. No product re-review, producer/kernel/native/tool replay, root success, main action or retry loop follows from this failure.


### 2026-09-12 exact daemon recovery and resumed root stages

B's explicit environment continuation was consumed without reopening the reviewed f4 source/input gate. The absent owned daemon was recreated exactly once with the retained labelled `ai-agent-mos-wave-75btxdqb-x64-state-w0-20260911` volume (creation 2026-09-11T09:04:20Z), pinned BuildKit image and unchanged config `6d07b01f...`. The create/inspect-before-start/start/actual-cgroup/worker/private-transport receipt `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/metadata/daemon-recreate-v2/result.json` SHA256 `e624623b8b6a24c8cf56dc393cd2c1d534ccef2208e22f471bdd02b5f80acab6` passes 23 recorded expected outcomes, including the intentional absent-object inspect exit1. New daemon `e7da1887391e765034cc5492a0847155a9615e161e4d720372b2a3797e3f9b35` keeps 4 CPU/10 GiB/no swap on 0-3; initial actual charged memory 17362944 bytes allows the unchanged 1 GiB headroom and 1 CPU/5 GiB daemon plus 3 CPU/5 GiB direct-child transition. No shared resource, cache, binfmt or other worker allocation changed.

The separate resume-v2 runner stopped before any root command because its new preparation assertion incorrectly required `verify/node_modules`, absent in both the original and prepared inputs. Its terminal metadata/log and exact runner bytes remain immutable. Resume-v3 corrects only that execution assertion to compare optional-cache presence with the original input; package/lock equality remains required. No host installation, producer replay, source edit, resource threshold change or second daemon recreation occurred. Exact old/new runner and wrapper substitutions are recorded in `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/metadata/root-resume-v3-preparation.json`. Original run1 wrappers, short-terminal notifier error and all preceding failures remain intact.

The actual normal root command `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh` started `2026-09-12T01:07:49.642855+00:00` after 12 successful immediate checks. Runner 2899709 and root timeout 2900658 were live in `75btxdqb-7e0f1b` pane %101 at the start observation. Immutable snapshot `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/metadata/root-resume-v3-started.json` SHA256 `046cc9511ca63eab406016dfcf2179cb4281852dfd41495b0e4b2a4e4034fc56` binds source f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/tree164725070bac579b771ba137b13cbe36a6c3678a/epoch1789173629, all 1,831 source entries, 18 joined pool files, 163 existing cached archives, actual boot image and exact input environment. Root epoch remains1577836800, x64/dev/no-cache0, with no BASH_ENV/DEBUG fixture. Original J package identity, fb6 native/deploy and4716 tools/kernel reuse evidence are unchanged.

The existing production-x64-run1 checkout is reused. Its fixed caller output initially contained only the byte-identical canonical lineage; that preflight-only output is independently preserved in `artifacts/x64/root-run1-preflight-preserved`. New root-stage bytes are associated with the new `root-resume-v3` artifact link, logs, OCI tag and metadata, not a successful original attempt. Canonical lineage remains `e4e8e56c0cbf15d5fe1d9b3b12567212b2f7326bffcb452e9fa8f38ad414f91b`. Live gate metadata is `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/metadata/W2/x64-resume-v3.json`; log is `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/logs/W2/x64-resume-v3/root-build.log`. B received the actual execution handoff as `01M29JHNJFYAQF1VPQW2GDKV4Y` (queued at its normal boundary). This is gate-pending, not root/image/guest acceptance. Collect the real terminal once and continue only eligible affected successors under the existing grant.


The actual terminal supersedes the preceding live start: root ended `2026-09-12T01:09:22.672968+00:00`, aggregate `2026-09-12T01:09:22.674910+00:00`, exit1; runner/root PIDs [2899709, 2900658] are absent. Installation reached 11 local packages and 173 total, then 90-pack pack11/19 refused `runtime composition refused: operator executable omitted: /usr/bin/docker`. The previous null-device refusal is no longer the stopping error. No root, final image or guest PASS follows, and the cause of this newly reached operator assertion has not yet been diagnosed.

Terminal `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/metadata/root-resume-v3-terminal.json` SHA256 `78f312ff44b6650fcc8aae10a4b11066d83001d03096b13171462fb7cf2671a2` verifies all13 completed step/log hashes, four wrapper execution records, actual clean1831-entry source, all18 joined-pool files and both native outputs. Root log SHA256 `41bf0b99c835a95eb6de90958fff9985eca2cf8c3b6d81f43d3ee33e75d06538`, metadata `789bdff0e30e708c4a0bec8c2b51cca81145a45cd65742fdb8542adbe2121158`. Daemon recovery remains successful; only the owned bounded daemon remains after terminal collection. New root failure and prior runner preparation failure remain separate. B terminal handoff is `01M29JPTRAF0KPZRGJ06KAJ4WX`. Preserve exact installed/stage evidence for one bounded read-only discrepancy diagnosis; no unchanged root, producer, native, tool, kernel or source suite was replayed. Strict missing/omitted-resource checks remain unchanged.


### 2026-09-12 read-only docker operator diagnosis

The f4 terminal and completed recreation checks were reused. Current task-cache snapshot514 binds the exact canonical f4 lineage, configured ownership and closed installation; `/usr/bin/docker` is the unchanged uniquely `mos-podman`-owned symlink to `podman`, mode0777, uid/gid0, with the original J epoch. The real archive `mos-podman_5.8.6+gite176876b733d-1_amd64.deb` SHA256 `3385040b78388bc31c942b89c0e11897c338f670b43f69334f1c7239f7e47209`, payload manifest and producer recipe all agree. The original Podman bytes are `d797bc3a...`; actual current debug-export snapshot523 records the stripped target SHA256 `4b5e4a489f09165b3cdbebe60d9ca1876ffbcba2530dd379dcb7b806937cccaf`. Debug transformation does not rewrite the alias. This is not missing package input.

The exact consumer root list retains `/usr/bin/podman` and private helpers but omits `/usr/bin/docker`. `Selector.add` follows a selected symlink forward; selecting a target does not select every alias pointing to it. The unchanged compose surviving-operator assertion therefore refuses correctly. The minimal external patch adds one exact executable root for the existing alias, bound to `mos-podman` and expected target/mode/uid/gid. No selector/compose algorithm, producer, pin or lineage-set expansion is needed; direct regression cases fit the existing composition test file. No production patch was applied.

Six diagnostic cases bind actual source selection/copy/CLI verification and the exact AST-extracted production operator loop: original omission RED, proposed owner-bound alias with82 retained paths, missing owner, changed target, missing target and an unrelated omitted alias. The focused input includes 19 actual ELF objects; no target command/service or full root was executed. These pre-strip package/closed-input fixtures do not reproduce security.selinux and are not final metadata-transfer or full compose acceptance. Two preparation failures remain distinct: omitted existing generated loader-cache origin, then an incorrect local verify function signature. The valid RED and already-copied output were reused; actual CLI verification and remaining negatives completed without replaying them.

A single bounded current-view operator pass accounts for523 entries:490 direct roots,17 captured alternatives, the sole approved routel omission, and15 owned entries lacking direct/generated roots. The other14 are systemd-sysv's halt/init/poweroff/reboot/runlevel/shutdown/telinit, systemd-resolved's resolvectl/resolvconf, init-system-helpers' invoke-rc.d/service, and dpkg's dpkg-realpath/update-alternatives/start-stop-daemon. Their exact metadata, ownership, target and pinned upstream rows are retained. They are eight aliases and six regular commands, not another generic symlink class exemption. The three dpkg helpers survive the current named purge; retaining or removing them must agree with the existing operator and no-package-manager contracts, without restoring a database or silently pruning tools. These14 are not folded into the one-row Docker proposal, and another root must not serve as their inventory query.

Proposal `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/diagnostics/docker-operator-v1/proposal.json` SHA256 `01c579b5db8fa98c6d3cebcb5f2f46101fcf4551331d666f17ff2f6ce34ec5a3`, external patch `ba0b58045f9dfc5f3bbafe744b72c65d52529ff1fdab1d2729781acde089608e`, and72-binding delivery `e36fb014181b2e623570e5edeace113d697b7f99eabe82e11eb49f7888afe9a6` were handed to B as `01M29KN969MDY7P78ADVX2GA4V` on its existing execution. The exact production boundary is consumers.json plus direct composition tests and these two records; any companion14-row reconciliation needs the concrete L1 source disposition. No new container/daemon, source write, J/fb6/4716 producer/native/tool/kernel replay, cache mutation, source synchronization, parent notification, main action or cron change occurred. Source/input quality evidence remains separate from the failed root and unexecuted guest acceptance.


### 2026-09-12 approved package-owned Docker entry correction

L1-DOCKER-ENTRY-20260912-0133 authorizes exactly one mos-podman root for the existing docker -> podman symlink with its actual owner and target/mode/uid/gid. Implementation remains in the original B7 branch; existing selection, compose algorithms and joined path sets stay unchanged. Direct production composition RED/GREEN and final two-copy source/input proof precede B review. The fourteen companion entries remain separately attributed, unapproved source proposals; they prevent a premature expensive root. Historical diagnostic and failed-root evidence are preserved.

The direct production compose RED reproduces the actual omitted Docker entry. The approved one-row change passes the existing target/helper fixture plus eight refusal cases (missing/wrong package owner, changed target, conflicting mode, absent target/interpreter/library, unrelated omitted operator). The actual captured pre-strip Podman input now passes the unmodified compose/copy/verify CLI with84 paths and eight matching negative cases; its source/archive/capture identities are bound. This is a scoped real-input composition fixture, not complete root or final stripped/SELinux transfer acceptance. The fixture preserves the actual captured join; subset inventory preparation initially omitted the mosd name distinction and failed, then was corrected without weakening production checks.

The fourteen companion entries are now separately attributed: production add(/sbin/init) already retains /usr/sbin/init and its47-path current-equivalent systemd graph. The external proposal retains eleven runtime entries, with their existing service/init-script/default/LSB resources and nine captured native rc links, and extends the installation-only purge by only dpkg-realpath/update-alternatives. start-stop-daemon has actual runtime callers in the retained service scripts; its dpkg package owner alone is not a reason to remove it. This companion patch and exact additional lineage-path request remain unapplied, pending technical disposition through B. B received this substantive packet as01M29MYNTATEKEQVNK9PXD9P00. No complete root was launched.

Evidence and source-bound self-review are under Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/DockerEntry-v1. Original root/setup failures and discarded proposals remain immutable. Only consumers.json, its existing composition tests and these two original records are changed. Final clean candidate/two-copy joined input and capture/release proof follow before B review.


### 2026-09-12 Docker entry clean candidate and exact input handoff

Composition `e1c84ed054329410d19201131bfebacd05554e09` / tree `e8eacf2bccff7b53319bfd251a90b3b37ae33eec` / epoch `1789177973`, parent `1e1bf96ce9e6cb463aa3cc495ab6c8d6a78a7a5c`, contains exactly the one approved consumer row, direct existing composition tests and these two records. Self-review has zero introduced findings. Both clean1831-entry copies verify all tracked modes/blobs/bytes and produce identical canonical lineage `bc49ae17e6be4f7bbfc0a988cc5e3a280d5c1f8eff94da31e6497ccb00cd3452`. The complete nine-path cumulative consumer delta, all15 producer/PREPARE maps, actual18 joined-pool files, J14 archives, fb6 deploy/native and4716 tool remain bound under their original identities. No producer, native, tool, kernel or140-check package-gate replay.

Final input steps: default mixed-source refusal1, explicit joined caller fixture boundary79, wrong immutable-tool refusal1, and33 actual joined release-input checks pass. The exact one-file release test has1 pass/4 assertions; current consumer-context refusal, types, docs and scoped diff also pass. The actual production compose/copy/verify fixture runs again only to bind the final canonical lineage:84 paths, exact existing Docker symlink and target bytes, final capture SHA joined to the actual new composition source by release sourceLineage. Earlier eight real-input negatives remain source-bound; no extracted AST loop is counted as complete compose. This limited captured-input result does not claim final stripped/Selinux metadata, packed geometry, full root or guest acceptance.

Readiness `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/DockerEntry-e1c84ed054329410d19201131bfebacd05554e09/metadata/successor-readiness.json` SHA256 `7d2fdcba75d2091ddf065217694487d01e5d2dc8e69192af73fc0ee1dbff2c8a` references the two copies, unchanged public/input/tool witnesses, final capture/release report and separate companion prerequisite. The candidate is ready for B's bounded source/input review. The known companion proposal remains unapplied and prevents another expensive whole-root attempt until its exact technical disposition/input proof; the sole Docker correction is not permission to prune other operators. All prior root failures remain failures.

Preparation failures remain preserved: original missing-mosd subset inventory; initial init proof omitted captured library symlinks; external proposal recorder syntax error; and a tmux launch path typo before its corrected command ran. None is product RED, a successful root, or an assertion waiver. Final direct checks use final relevant source bytes; historical metadata and wrappers were not overwritten. No B/main/347 synchronization, new node, parent notification, resource recreation or cron change.


Final evidence-reference correction: the companion proposal runner and gate wrapper reused metadata names. The initial SyntaxError gate metadata was overwritten by the v2 proposal payload; the original exact gate metadata/start timestamp is not recoverable and is not claimed as a verified binding. Original failed script/stderr remain. The v3 proposal payload was then replaced by its wrapper gate metadata, so the earlier B pointer identified a successful proposal-generation gate rather than its payload. This is disclosed in DockerEntry-v1/metadata/proposal-recorder-collision.json. The external patch was retained. A separately named v4 payload/gate generated from clean candidate e1c84ed0 resolves the reference without replaying tests/producers/root.

Authoritative companion payload is DockerEntry-v1/metadata/companion-proposal-v4-payload.json SHA256 `2f8ddb053ec64fd8e428369ae82197e76ac5adfc906a9a011770ca83f7630baa`; corrected execution-readiness reference is `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/DockerEntry-e1c84ed054329410d19201131bfebacd05554e09/metadata/successor-readiness-v2.json` SHA256 `eea1b98ed33284bd09571c295d345ebdf8309d3c2ea0d7bbdc2e827070a730a7`. Its only changes from readiness-v1 are that reference and this history. Candidate source/tree/epoch, both identical lineage records, real caller/capture/release checks and original producer witnesses remain unchanged. Prior general immutability wording is qualified by this explicit recorder failure. The generated selector .pyc from the scoped inline fixture was moved into DockerEntry-v1/preserved-generated-pycache, preserving bytes and restoring a clean original worktree.


### 2026-09-12 companion producer-attribution review correction

B-EXACT-COMPANION-REVIEW-FINDINGS-20260912-0158 establishes that package-manager-purge.sh is an actual frozen ca-trust producer input: full438 proof SHA25693902df4c3351b3d3e2c3ca3977f6b4bbd07fb2361c2f0aedc1f0c1c3d1b87ba, mode100755/blobd751770e7fdf8cbb113f224bdf2f6fe5120ac64a. Withdraw the earlier external proposal to edit this file or admit it into either consumer-only set. Neither proposal was applied. B instead proposes the same two exact removals after the existing purge in90-pack.Dockerfile, with only its exact JOIN_CONSUMERS additions; this remains pending L1 technical disposition, not implementation authority. No source/producer-input scan or gate was replayed for this record.

The v3 proposal/gate collision was already disclosed and recovered before this follow-up in the distinct v4 payload/gate and handoff01M29NHQP3F5JZXAWGJC0TGV07. Preserve those original bytes; no regeneration or test replay is needed. The v4 payload remains a historical proposal whose purge-path attribution is now superseded. The count remains11 new retained entries,1 already retained init,2 proposed installer removals, with9 native rc links. B is reconciling the remaining exact quota helper/default/state-directory inputs; no complete companion readiness or new root is claimed. Record: DockerEntry-v1/metadata/B-companion-findings-consumed.json. Frozen Docker composition e1c84ed0 and all source/input receipts stay unchanged; current B review continues independently.

### 2026-09-12 operator companion disposition

L1-OPERATOR-COMPANIONS-AND-MERGE-20260912-0138 and the 02:11 B handoff authorize retaining the existing named survivors, including all three dpkg-owned utilities. The earlier two-removal alternatives are withdrawn and remain unapplied evidence. Reuse the accepted Docker source/input gates and the existing indirect `/sbin/init` proof; add only missing exact owner-bound roots and necessary existing resources in consumers.json, with direct composition tests. Purge, selector, compose, producer and lineage policy bytes stay outside this correction. No root starts before the complete captured-input batch and independent source/input review.

Batch 1 is complete at main `677d326f40834d192b38d3b8d1097334d02ea86a`, tree `ea3b1218769dc1870680b3dc881a7e939006fcc5`; it is not imported here. The user conditionally authorized batch 2 after the complete reviewed combined x64 lifecycle/acceptance packet and batch 3 reconciliation through the designated owners. No repeat generic main approval is required once those conditions hold. Consolidated ARM acceptance starts only after the actual batch 2 merged startup chain is frozen; hardware obligations remain pending. No push or publication is authorized.

The implemented companion correction adds exactly 13 previously missing owner-bound operator roots, 17 existing native service/configuration/directory resources, and nine captured SysV rc links. The complete pre-change production selector closure retained 509 of 523 operators (Docker and indirect init included); the 14 omissions were the 13 approved companions and routel. The corrected real captured-input compose/copy/verify retains 522 operators, all 15 named candidates and 17 generated alternative operator paths, with routel as the only omission. It reports 3,187 selected paths, 861 ELF files and 62 script resources. Ten fixed upstream archives and 30 exact members match captured modes/owners/bytes; nine native rc links match capture. No target script, service, image or guest was executed.

The direct original-source test failed at omitted dpkg-realpath. Final focused tests cover successful composition plus 14 refusal mutations (owner, wrong owner, metadata/target, missing target/interpreter/library/resource, native rc target, unrelated omission, selected special node, package-manager restoration and database selection). Matching joined-consumer context, explicit single-file release tests, typecheck and docs checks pass. Full captured-input checks preserve removed apt/dpkg/Perl/databases and no target Python. Original preflight/root failures and the capture-recorder Python-version and whiteout preparation errors remain separate evidence. The tar transport preserves actual bytes/modes/ownership with recorded xattrs but cannot reproduce original SELinux labels on this host; it is not original-container metadata-transfer or real root PASS. Bootstrap device identities remain in the immutable capture and are not materialized in this diagnostic copy.

Evidence: Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/OperatorCompanions-v1 under the original J wave. Final clean two-copy joined-lineage/capture/release validation and B review precede any new production root. J package, fb6 native/deploy, 4716 tools and original kernel identities remain unchanged. Optional package-database modes, guest RSS, compressed/verity geometry and real lifecycle qualification remain unqualified.

The same bounded related-service pass found quota.service already retained with both ConditionPathExists and ExecStart naming /usr/share/quota/quota-initial-check.sh, while that exact pinned helper was absent from selection. The unit is not enabled in the captured view; its ordinary service action remains an existing retained-tool call edge. Add only this existing quota-owned 0755/root:root resource, using the already-retained sh, quotaon/quotacheck, grep/rm, LSB functions and quota state directory. Its archive/captured SHA256 is 528fb0267228ad40d75533ce9cca9c7052f21effb2a357ef742d5b94368b6b69. The concrete mismatch was reported to B as message 01M29QGAX21EFWT720JM9EEEMZ. No unit, enablement, package, algorithm or policy changed. This completes the same correction with 18 resources (40 exact rows total). Intermediate 9cb462e6 and its successful source/input checks are preserved; they are not the final composition identity or root PASS.

### 2026-09-12 final operator companion candidate

Final composition commit 6638575781a593fba3f14f30c2f12ac7cee72694, tree eea998068629cc460fbb8c4115971d3b56e08839, Git epoch 1789180557, includes the same correction's intermediate 9cb462e6 and exact quota service resource completion. The final two clean source copies verify all 1,831 tracked mode/blob/byte identities. Both canonical joined lineages are SHA256 218b21a6b56fad5dccaeee3365d23edfdbc555afe33865437934412f954d0181; all 18 pool files, 15 producer context maps and original J/fb6/4716 roles remain verified. Actual root caller default refusal (exit 1), explicit joined isolated boundary (exit 79), wrong-tool refusal (exit 1), and 33 final-source release-input checks pass. Exit 79 remains fixture-only, not production execution.

The final candidate's complete retained-input compose/copy/verify passes with 3188 selected paths, 522/523 retained operator entries, all 15 named candidates, 17 alternative operator paths, 861 ELF files and 63 script resources. The only operator omission is routel. All 13 new operator roots, 18 existing resources and nine rc links are verified; 10 exact pinned archives bind 31 member bytes/modes/owners. Both final release consumers accept the same actual report/capture lineage and refuse wrong caller, missing/changed capture and swapped lineage. No package-manager/database or target Python was restored. Current captured regular hardlink-group count is zero; the final diagnostic copier nevertheless preserves original inode groups. Original SELinux transfer qualification remains explicit.

Readiness: /srv/bkd/worktrees/33z9aa5q/75btxdqb/_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/OperatorCompanions-6638575781a593fba3f14f30c2f12ac7cee72694/metadata/successor-readiness.json, SHA256 699c3628d0765c73c215a7bb8576d9393d03ed44ea000d17a457ed732ad2514c. Final captured report SHA256 c0998f218584d2e50206eb19d73fc2760d736bb0ed07b3e9ba9175146090d09c. The packet is ready for B's bounded independent source/input review; no new root was launched, no successful producer was replayed, and no main/347 source was imported. Later records do not relabel this composition. Actual packed geometry, signed image and full x64 lifecycle/size/RSS acceptance remain pending.

### 2026-09-12 exact retention-patch reconciliation

The later L1 retention-only patch SHA256 1370de0da4148f880629cbfde4c5b480de9aef95994b45b13e6e925e395cb725 was applied only to an external reference file from exact e1c84ed0, with every original context line and hunk count verified. Its 39 paths (13 executable entries, 17 existing resources and nine native rc links) match the final 66385757 candidate's exact path, singleton package owner, kind, mode, uid/gid and link-target requirements. The candidate uses individual path rows instead of grouped rows to preserve nonempty per-path ownership checks. Reasons and named-generator wording are recorded differences; the actual canonical lineage/report binds the candidate wording. No duplicate Docker/init root or source rewrite was needed.

The only additional selected path is /usr/share/quota/quota-initial-check.sh, already independently accepted by B as the authorized existing service-resource closure in message 01M29QP5RBZT72DXMER61CX44F. Final count remains 18 resources. The purge, 90-pack, selector/compose and both source-lineage/release consumer policies remain byte-identical to e1. All matching actual retained-file report entries were checked read-only; no source suite, producer, root, capture or release gate was replayed. A patch-applet availability preparation error is retained separately; the exact one-hunk comparison completed without an external patch tool.

Evidence: OperatorCompanions-v1/retention-patch-reconciliation-v1/reconciliation.json, SHA256 9bd13c271612c27c2bf8caf574b7639de23a683797e9a8b65d064334da8894ec. Frozen composition 6638575781a593fba3f14f30c2f12ac7cee72694, canonical join 218b21a6b56fad5dccaeee3365d23edfdbc555afe33865437934412f954d0181, readiness 699c3628d0765c73c215a7bb8576d9393d03ed44ea000d17a457ed732ad2514c and full delivery fa5c2a7bd4018c7141db26ab2ce5d2d3676dc46ab2edd3475911536cb7afc371 remain unchanged. The existing independent B review and combined-source successor boundary continue; this tracking reconciliation does not create a new binary identity or a build start.


### 2026-09-12 reviewed 663 root execution

B-FINAL-COMPANIONS-ACCEPTED-20260912-0250 completed the independent source/input review and isolated integration. The frozen composition remains 6638575781a593fba3f14f30c2f12ac7cee72694, tree eea998068629cc460fbb8c4115971d3b56e08839, epoch 1789180557. Readiness SHA256 699c3628d0765c73c215a7bb8576d9393d03ed44ea000d17a457ed732ad2514c and canonical join 218b21a6b56fad5dccaeee3365d23edfdbc555afe33865437934412f954d0181 were consumed in the new production-x64-run1 checkout. The actual input check verified all 1,831 tracked entries, 18 joined pool files and 163 existing fixed cache archives. Original J packages, fb6 deploy/native, 4716 boot tools and the existing kernel preserve their producer identities.

The actual normal root command started 2026-09-12T02:55:44.753486+00:00: timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh. Orchestrator PID 3028477 and root timeout PID 3029287 run in persistent tmux 75btxdqb-7e0f1b pane %101. MOS_ROOTFS_NO_CACHE=0 and the accepted environment match the actual root process; no BASH_ENV/DEBUG fixture is present. All 14 preparation/input/resource steps passed before that start. This is a running production gate, not a root/image/guest success.

The original owned daemon e7da1887391e765034cc5492a0847155a9615e161e4d720372b2a3797e3f9b35 and labelled state remain. Fresh preflight found capacity 6/30 with 24 free, an idle buildkitd and actual 4 CPU/10 GiB/swap0/cpuset0-3 cgroups. The versioned adapter preserves the existing aggregate envelope and direct-child split, records actual daemon cgroups after transitions, and refuses insufficient 1 GiB shrink headroom without automatically stopping or recreating the daemon. No cache prune, threshold reduction, shared tag mutation or new resource allocation occurred.

All new execution evidence is under OperatorCompanions-6638575781a593fba3f14f30c2f12ac7cee72694. Start packet metadata/W2/root-run1-start-event.json has SHA256 dec41661e44f002a72e0ac36210c28442a4bb7194d667ae6575beb06cca25d84; adapter-version record SHA256 0b282615e2c6bfdf0331d0be0b9d05a295e758855c94b2c51288fa009f2c02fa. Runner SHA256 17c3433b44b8824780fe99624ce2636b962f3db9c578ae8bf86c50cc6dca4f2e and wrapper SHA256 d692608a5d59800bb906f4b8d9bd97fa629ca2099198bd67871347620e30fc74 are immutable. Metadata is metadata/W2/x64-run1.json; the actual root log is logs/W2/x64-run1/root-build.log. B received the concrete start as message 01M29RS2F2F67DAKW45FFDYJE9. Historical f4/root/preparation failures remain separate.

Worker347 source/input work remains independent. This root does not claim the later 438 combined identity. Consume only the exact reviewed combined delta at a natural source/stage boundary before the complete combined signed-image/lifecycle acceptance, avoiding duplicate full matrices. Batch 1 is complete; batches 2/3 retain conditional user authority through the designated owners after their real acceptance conditions. Broad ARM waits for the actual frozen batch 2 startup-chain main merge. Physical obligations remain pending. No successful producer or unchanged suite replay, B/main/347 sync, parent notice, main/push/publication/done or cron change occurred.


### 2026-09-12 packed-root terminal and successful smoke continuation

The 663 root command ended 2026-09-12T02:59:09.050117+00:00, aggregate 02:59:09.053566, exit 1. Its real pack stage completed, including the corrected operator/resource selection and 198 MB installed-size check against the 520 MB budget. The failure occurred after actual OCI import when the task adapter required the private annotation name to resolve as a Docker image reference. Terminal collection metadata/W2/root-run1-terminal-collected.json SHA256 f29fb32a3d0e975dc2f5661435c25ac58e2680c4d6fee020472a26dba8c731e2 binds all 15 completed step logs, original runner/wrapper and PID absence. Root metadata SHA256 dd673c910ed4e7f705b87cf64639a126fb858c3c9156065fc075a096d1a89cd2 and log SHA256 056510fbdcd93fb1f2d86613a1d37b89e52fed8296af09599fb54ec7631ac226 remain immutable. B received the terminal as 01M29RYC2031PE6KHPEBYFJ784.

Bounded read-only inspection proved that the imported manifest 2b2fbfe13b0eb31d7d54f3480d9df3ffe7ec750ea542522e4718990f446ccdc9 resolves with the correct architecture, actual layer and ownership metadata and lists the private annotation in RepoTags; looking up that annotation name fails. Config 092289b61db9eaefec37362fe59c16058c0c9c8f919778bcdd17afc59366b5b8 is distinct from the current store's manifest address. The shared root tag remains its original 5a7e0687 identity. Diagnosis diagnostics/oci-load-v1/diagnosis.json SHA256 9c2933635a66695b186d66986521a9abb95851ce1902cc8030c9fbe428306611 establishes a task-adapter boundary, with no product source correction. The actual original lookup RED, immutable-image positive and nine missing/wrong/duplicate identity refusals are retained in check.log SHA256 8270c0b75934808e0b7c3fa44f1b90e2bfb9cf2a5b1ca215ff3dfc25315e3515. The preliminary adapter manifest is historical; adapter-correction-final.json SHA256 0f6528c634741f76c555f56110401b1c3866b6e66d1ae8f32b7d2d5db0ebe031 binds the final executor bytes.

A separate versioned task adapter preserves the real Docker load, exact original/private OCI member comparisons and shared-tag refusal, and verifies the actual manifest/platform/diff layers/ownership labels/stored private annotation. The unchanged production smoke consumer addresses the archive-derived immutable digest. Only the failed smoke stage ran again: timeout 3600 bash verify/run.sh --smoke --board x64 --builder mos-wave-75btxdqb-x64, started 03:06:09.373614 UTC, aggregate ended 03:06:43.905491 exit 0. Orchestrator 3043476 and smoke timeout 3044257 are absent. All 12 shipped artifacts executed successfully: 12 pass, zero failures, executor limitations or unclaimed entries. mosd and apid report the original J embedded commit; mos-deploy retains its fb6 producer identity. This is successful failed-stage continuation, and does not rewrite the original root aggregate failure. The late start-only collector found the already-ended process absent; its preparation error is preserved and no stale start follow-up was sent.

Continuation metadata/W2/smoke-resume-v1-terminal-collected.json SHA256 a5f3cac5fd04c4e614ba4b61584ea1fd71bad6f316195135940e0175e519e8ac binds the actual logs, invocation, source, resource and Docker receipts. All 261 packed input files, clean source identity and canonical joined lineage are unchanged before/after. The original daemon stays within the existing 1 CPU/5 GiB plus serial 3 CPU/5 GiB child split, cpuset0-3 and swap0; fresh capacity/headroom checks passed. No root reconstruction, native/deploy/tool/kernel replay, source synchronization, daemon recreation or cache prune occurred. B received the concrete diagnosis and terminal as 01M29SDW9YC9ZD8GHBVZPW9P56.

Actual packed output observation metadata/W2/packed-root-output-observation.json SHA256 490df1efdd5f15d910d32766c78dd6da06cbc1e7c5e832d0763b46a31cec256c records 3,188 selected physical paths, SquashFS 70,639,616 bytes and verity image 71,204,864 bytes. The unchanged OCI is 80,724,480 bytes, SHA256 7686a6b38dee45bfb3857dfd87ac218dd4c53efad55b68a9df132f268f67ebc1. Direct reading of its real layer found exactly one mosd (58aac19fdf7e760b698caf7883a43749adb7a3577150cb85c663129a2e388f37), apid (980b5b5878f024ef03176537600a5d2d0508e5398a6e8ef888d4e77518fc5e51), and mos-deploy (f63e71633758e8fe3aa247a13896483d49a826483ccd9f99d186a1d751220247), matching report bytes/modes/owners. This output scan is not the fixed C guest verifier. Full signed-image capacity/reserve, runtime allocation/RSS, startup/shutdown/update/lifecycle and physical qualification remain pending. The natural packed-root/smoke boundary is ready for B's exact reviewed combined347 source/input handoff before final combined image acceptance; no duplicate standalone signed-image/lifecycle matrix was started.


### 2026-09-12 exact reviewed combined startup handoff

B-FINAL-STARTUP-OVERLAP-ACCEPTED-20260912-0318 authorizes the exact 56-path handoff from reviewed 0972015680538cff6355ccf3244521c8bcf8157a, tree db7979669fc68e44c0e22786aa5ddc524422f497. The supplied patch SHA256 64f23569de54d882f36b48cbca3058e4b773d98f24972c8d7ea16d8dc2c5ae14 applies to the current B7 record head 5f3d1a71baac3c7cded9cd3c4e4227ec8d0c563a. All 56 before/after mode/blob identities were checked; resulting source bytes exactly match the reviewed handoff. The two B7 records, rootfs/build.sh, tests/deb-package-gate.sh and the already-equal operator consumer/test files were preserved. Evidence: CombinedStartup-v1/patch-application.json, SHA256 aa9c4bc238c18639aa5cb1dd21e32311bdf576e04cc13742f56a9e3c6e30e4b9.

The exact index tree is integrated with parents 5f3d1a71 and reviewed 09720156, retaining both actual histories and the startup creator's mandatory 438 ancestor relationship. This is a manifest-limited source integration; no broad B/main or live-worktree copy is used. The new composition identity is frozen independently of later records. Two real clean-copy startup joins and current shell/capture/release admission must bind that actual identity before B's final context review and any combined production root.

The fixed startup selector fbcdf84608e4a5a9efe9b590e2bb389f26f59f539117bec650fad1d71edd4d8d retains original J packages and actual 438 native/deploy/tool witnesses. Existing 663/fb6/4716 packed root and successful smoke continuation remain separate history, not a 438 installed report. No producer/native/deploy/tool/kernel or completed source suite is replayed. The preserved root caller's named-tool extraction is being checked against the startup schema at the isolated input boundary; any concrete mismatch will be reported with the actual source and evidence before production.

B7 keeps its existing aggregate 4 CPU/10 GiB/no-swap/cpuset0-3 resource ceiling. No daemon, shared resource, ARM or root operation is part of this source handoff. Batch 1 main 677d326f is complete; conditional batches 2/3 still require the exact combined x64 acceptance and designated integration. Physical and post-batch-2 ARM obligations remain pending.


### 2026-09-12 frozen combined source and exact startup caller finding

Combined composition 7b6f4b5a0881cbe30584ea76292ba661a88689b4, tree 4558e58e704e5a290e9ced61147343e60e10b368, epoch 1789183485 preserves the exact supplied 56-path payload and both actual histories. Both independent clean copies verify all 1,841 tracked mode/blob/byte entries. Their canonical startup lineage is SHA256 d4075053291a01fa8db7c1aaad3fe11d7d8a10383af8bb50b0f6312e5a132b7b. All 18 actual joined-pool files, 15 producer maps, 49 native/59 deploy/19 boot-tool inputs and the original J/438 witness roles are verified by the actual unchanged creator. Two current-source capture/release admissions preserve the historical 663 report only under its original source and reject all seven cross-source/capture/index cases per copy.

The exact-file release gate runs two tests/23 assertions in one file; typecheck, docs and scoped whitespace pass. The focused Python discovery runs two tests including 20 mutation cases. An earlier direct-file Python invocation ran zero tests despite exit 0 and is excluded from GREEN. The first capture preparation introduced a node_modules symlink that the actual clean-source assertion correctly rejected; that symlink and original failed log are retained separately, dependency files were staged in the ordinary ignored directory, and only the unfinished capture/caller checks continued. Neither canonical creator run nor any successful producer was repeated.

The actual protected rootfs/build.sh caller confirms a concrete startup schema gap at lines 321-332. Default mixed-source input refuses, and the explicit startup input reaches the isolated resolver boundary with the correct manifest. However, omitted MOS_BOOT_TOOLS_IMAGE remains UNSET, and the tool config digest also reaches exit 79 instead of the existing pre-resolver tool refusal. The canonical helper and release admission are strict; the shell currently extracts only boot-tools-v1. A two-line external proposal adds startup-v1's already-verified production.boot_tools.image to that existing comparison/export block. It is not applied because the exact reviewed payload explicitly preserved the caller. No source policy expansion, witness change or producer rebuild is needed.

Evidence: CombinedStartup-7b6f4b5a0881cbe30584ea76292ba661a88689b4/metadata/caller-proposal.json and proposed-startup-caller.patch, SHA256 bb5f91f07471af256b85fb9ee0ef7e6cad39f1b75b9b8d77b76f3890af1993c3. The actual input logs, two source manifests, canonical records and Python invocation correction are retained in the same directory. Exit 79 remains fixture-only. Production readiness is false pending this precise caller disposition and B's final context review. No combined root, image, guest, daemon/container action or broad source sync occurred. The source/input proof can be reviewed independently; all prior 663 and producer results remain immutable.


### 2026-09-12 approved startup caller schema correction

L1-STARTUP-CALLER-SCHEMA-20260912-0338 approves only the two-line startup-v1 extraction into rootfs/build.sh's existing immutable comparison/export block. The exact external patch bb5f91f07471af256b85fb9ee0ef7e6cad39f1b75b9b8d77b76f3890af1993c3 is applied; removing those two lines yields the unchanged caller SHA256 d3002d6c5010edf0b5c35daaa54634f09fda0403679e9f2287f405743ccb0521. Named4716/default behavior, full canonical verification, all fixed policy sets and producer inputs remain unchanged.

The new direct actual-shell tests first ran against the retained clean 7b6f4b5a caller and actual J/438 inputs. Five tests ran, with five expected failures: unset tool stayed UNSET and config/old4716/tag/wrong manifest reached the resolver boundary. Exact manifest, default mixed-source refusal and unverified join refusal were retained controls. The source-bound RED log has SHA256 012337f6d6a25ec67a509f1c3e8219a4f5c8933e1a54d927a54b55838766e282. These are isolated BASH_ENV/DEBUG caller fixtures, never production launch inputs.

The corrected combined source is frozen before new two-copy canonical proofs and direct GREEN. The original 7b6f join d4075053, previous source/capture preparation errors and zero-test receipt remain immutable history. Existing 438 native/deploy/tool witnesses and 14 original J archives are reused only under the actual final creator/context proof; no producer, kernel, root or unchanged full suite is replayed. Final B source/input review remains the automatic affected x64 production predecessor, not another generic product/main permission checkpoint.


### 2026-09-12 corrected startup caller final input handoff

Frozen corrected composition ed7231cdf9820c310e483b4cb479a3b52259467c, tree 31e3fd25f91cd0c3b03055591f68896a8e351d81, epoch 1789184687, contains exactly the two approved root caller lines, direct actual-shell tests and these two records. Final caller SHA256 77608427c363de06484cb72cdcc5be28bf4d6acf89453182e217fe0ca623c546 and test SHA256 7da243e69682e5d14c9bf39c3e0a987f21c3738a7c683f5b4bced01a98736608 are bound to both RED and final GREEN as applicable. No helper, release, policy set, producer, pin or tool source changed.

Both new clean copies verify all 1,841 tracked mode/blob/byte entries before and after the affected checks. Their current canonical startup joins match byte-for-byte at SHA256 fbbfc4b30514dc90539076a7f725e3fb9df62b048b9e7f6411fe22ae301fbb86. All 18 actual pool files/15 archives, 15 complete producer maps and original J/438 receipt/tool/native identities pass the real creator. The exact two-line caller delta remains outside the producer/PREPARE inputs. The actual protected default and named4716 historical controls are retained with their original logs; subtracting only the two new lines reproduces their exact tested caller bytes. Those old cases were not replayed or relabelled as startup results.

Five corrected direct tests execute eight actual shell cases: unset and exact manifest reach the isolated boundary at exit 79; config, old4716 manifest, arbitrary tag and wrong manifest refuse before the resolver at exit 1; default mixed-source and unverified join also refuse at exit 1. The actual canonical verifier runs before extraction. Both current capture/release admissions pass seven cross-source/index/capture refusals each. The explicit single-file release gate passes two tests/23 assertions against the final record; shell syntax, docs and scoped diff pass. Unchanged type/parser/producer suites retain prior source-bound evidence and were not repeated.

Readiness: StartupCaller-ed7231cdf9820c310e483b4cb479a3b52259467c/metadata/successor-readiness.json, SHA256 6225ea865c16d7bc709089300b89f11380b2eb0a4523445684ccb80df11674fd. It binds exact af672edb manifest rather than configccf6474, fixed startup input selector, actual 438 native/deploy/tool witnesses, original J release identity and root epoch 1577836800. Planned production environment contains no BASH_ENV or DEBUG fixture. The current source/input packet is ready for independent B review; no corrected combined root, signed image or guest acceptance is claimed. After that review, existing automatic combined x64 successors use separate production paths and fresh owned resource/headroom guards. Prior 663 root failure and successful 12/12 same-OCI smoke remain immutable under their original identities.


### 2026-09-12 accepted combined startup production root

B-FINAL-STARTUP-CALLER-ACCEPTED-20260912-0402 completed the independent source/input review and precise local B integration. The frozen production identity remains ed7231cdf9820c310e483b4cb479a3b52259467c, tree 31e3fd25f91cd0c3b03055591f68896a8e351d81, epoch 1789184687; B's integration and later tracking labels are not binary identities. Readiness 6225ea865c16d7bc709089300b89f11380b2eb0a4523445684ccb80df11674fd and canonical fbbfc4b30514dc90539076a7f725e3fb9df62b048b9e7f6411fe22ae301fbb86 were verified in a new production-x64-run1 clone.

The actual normal x64 root began 2026-09-12T04:07:36.298638+00:00, with orchestrator PID 3095477 and root timeout PID 3096289 in persistent tmux 75btxdqb-7e0f1b pane %101. Actual argv is timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh. All 14 preparation/capacity/resource steps passed; the actual process environment matches the accepted input environment and contains no BASH_ENV/ENV/LD_PRELOAD/LD_LIBRARY_PATH/SHELLOPTS/BASHOPTS injection. MOS_ROOTFS_NO_CACHE=0, root epoch 1577836800 and exact startup tool manifest af672edb remain bound. All 1,841 source entries, 18 joined pool files and 163 fixed cache archives were verified. Original J package identities and 438 native/deploy/tool receipts are preserved, including native hashes 57c865ed/77bf04b4. This is a production start, not a root/image/guest result.

The original daemon e7da1887391e765034cc5492a0847155a9615e161e4d720372b2a3797e3f9b35 and labelled volume remain. Initial actual cgroups are 1 CPU/5 GiB/swap0/cpuset0-3, within the established serial 3 CPU/5 GiB child split; the adapter retains the existing owned-idle transition to daemon-alone 4 CPU/10 GiB for BuildKit. Fresh capacity, station/unrelated CPU<50%, memory/disk and 1 GiB shrink-headroom checks passed. No daemon recreation, resource expansion, shared state, binfmt or producer replay occurred.

The new task-only adapter versions the successful immutable-manifest OCI load correction with exact new namespace/source/tag/tool identities. Runner SHA256 6fdfd9d2989744496d5b0966738dd03daed11f7c2527bf0f18ee76c5f283e2a1 and wrapper 62019a7b4eed1481a89648fa01c3b469f9f510f8ed9904152cac6c2148724aec are recorded in StartupCaller-ed7231cdf9820c310e483b4cb479a3b52259467c/metadata/execution-preparation-v1/adaptation.json, SHA256 c72675e992e71e9a40a8d1bddf3425fe46c1860563c8547995e366292161f92f. Original wrappers and 663 root/smoke history remain unchanged. Start event metadata/W2/root-run1-start-event.json has SHA256 64ac3db315d47d78a24e138df105a7dcec4afdb774d12b5b2102f4617eb1b4dd; the original metadata snapshot is retained separately. B received the actual start as message 01M29WX22ACGW4ZDGWQ64TJ92X. Current terminal metadata is metadata/W2/x64-run1.json and full log is logs/W2/x64-run1/root-build.log.

The detached gate is preserved for event-driven terminal collection. Required affected support/component/signed-image and complete combined x64 acceptance remain automatic after actual predecessors; no duplicate standalone image matrix or future-output prerequisite is introduced. No ARM, main/push/publication/done, parent notification or cron change occurred. Conditional batch 2/3 and pending physical/post-batch-2 ARM obligations remain unchanged.


### 2026-09-12 combined packed-root terminal and owned-memory continuation

The actual ed723 root ended 2026-09-12T04:11:28.648476+00:00, aggregate 04:11:28.649881, exit 1. The earlier running-only handoff is historical. Deduplicated metadata/W2/root-run1-terminal-collected.json SHA256 e970f40770b7c50a6a543e280bf6566870869fbe8de0c718db58c965c9364c1f binds all 15 step logs, 1,841 clean source entries, 18 pool files, both unchanged 438 native outputs, 261 packed files and six Docker receipts. The root log SHA256 3736a570fffce544b78cff32778a1888d93250b3d66a6c4ef4f883a94dbf82fe records the 198 MB installed-size check against 520 MB. Its actual OCI is 80,726,528 bytes, SHA256 81899b4eef4bc74798427beeb22d30c74876be1e06e2f80db079df67a5129239, manifest d917f81039ef32f139aaaad6d7f4a11c6e5049de8886b0948349216b06cb7576. The task load adapter refused before Docker load or private archive creation because retained daemon memory lacked the unchanged 1 GiB shrink headroom. Smoke had not executed. The original aggregate remains failure; no image or guest acceptance is inferred.

Read-only inspection found only buildkitd in the original e7da1887 daemon, with 4,375,576,576 bytes charged before continuation, principally file cache. The single stop/start attempt retained diagnostics/daemon-memory-v1/metadata/result.json as failure: stop succeeded, but Docker refused start because the original AutoRemove=true container was marked for removal. No forced shrink, cache prune or product build occurred. The subsequent absence and unchanged labelled volume/creation identity are bound in auto-remove-terminal.json SHA256 5542a66f392a729a24009dc91314be02ac3dbaf5182e2f5ebdcffb5e2dd7d2b1. After complete absence and no volume users were verified, one exact recreation used the existing pinned image, normal entrypoint, configuration 6d07b01f, sole retained volume, private transport and unchanged limits. Result metadata/daemon-memory-recreate-v1/result.json SHA256 8fdebb8872b26578e54367be01d6c1688834d87781970baf4558d523394f1d08 passed at 04:25:54.975633 UTC. New container 724215ac6b5cf8f56ed900b450dd9fe1e5dfb4c2ce9a9bf0ac6447eb39b27808 has actual 4 CPU/10 GiB/swap0/cpuset0-3 cgroups, one idle OCI worker and 18,624,512 bytes retained memory. Create-inspect-before-start and actual config/worker/transport checks passed. The old stop/start failure remains immutable; no resource ceiling, cache or source identity changed. B received these substantive events as 01M29XXE8DENC2MMGGFAHWPJM2.

Only the unexecuted smoke stage is eligible on the existing production-x64-run1 source and packed bytes. Versioned tools/smoke-resume-v1/adaptation.json SHA256 2bbece26e0a6c28aaeba8500c0f7617ce58b351f40a7133bb5f5521b0a1cdbee binds the new runner 3f342a115688e077a7db383b9849a0dcaa53ff6baea9a518b546ecd1121b0d9f and task wrapper b61c8047e6279ae441d6ae631975ccc919ae4adb95a0a488dc1dc4a9dc6b1397. The wrapper changes only private log/import/tag paths; immutable manifest/config/layer validation, real load, shared-tag refusal and original resource guards remain. The runner binds the actual recovery identity and current startup readiness/canonical/pool/native inputs, then invokes only verify/run.sh --smoke --board x64 under timeout 3600. It scrubs fixture environment injection and preserves the original packed inputs. No root reconstruction, producer/native/deploy/tool/kernel replay, B/main/347 sync, ARM, parent notice, main/push/publication/done or cron action occurred. Smoke start/terminal identity is recorded separately at its actual boundary. Conditional batch 2/3 and remaining physical/post-batch-2 ARM obligations are unchanged.


### 2026-09-12 combined same-OCI smoke terminal

The smoke continuation actually ran 2026-09-12T04:28:47.435551+00:00 through 04:29:00.345521, aggregate success at 04:29:02.671386, exit 0. Orchestrator 3107577 and smoke timeout 3108367 are absent. The final log SHA256 514b705faf3a84f81918202f84c7f3f713ccd86415dff74e026025d5370f9fd1 reports 12 pass, zero failures, executor limitations or unclaimed entries. All 12 completed runner steps, 14 Docker receipts including the real immutable OCI load and 13 serial create-inspect-start calls are verified. Metadata/W2/smoke-resume-v1-terminal-collected.json SHA256 60bedb3c3c0c0987916be1bae0fbbac318200c84c004b742a7a0a752234fa145 binds the final current-source/readiness/canonical/input/resource evidence. All 261 packed files are unchanged before and after; original root aggregate exit 1 remains unchanged. The first collector preparation failed because this installed Python lacks hashlib.file_digest; its error is retained separately and only unfinished collection resumed using streamed SHA256, without test or build replay.

One actual copy each of mosd, apid and mos-deploy is present in the immutable OCI layer: mosd 7,813,432 bytes / 58aac19fdf7e760b698caf7883a43749adb7a3577150cb85c663129a2e388f37; apid 12,206,576 bytes / 980b5b5878f024ef03176537600a5d2d0508e5398a6e8ef888d4e77518fc5e51; configured mos-deploy 2,052,984 bytes / eabc230632b9aff6efdb598a53e2df4aad89a584a6ff2e975f4db214b45e57d1. The executable smoke preserves original J mosd/apid embedded identity and the actual 438 deploy/package lineage. These are container artifact results, not real guest lifecycle, RSS or physical qualification. The daemon is idle in its verified 1 CPU/5 GiB/swap0 split; completed direct children were each limited to 3 CPU/5 GiB on0-3.

The next existing component routes were checked against frozen ed723 bytes in metadata/W3/caller-input-assessment-v1.json. Root packaging uses a bounded detached Toolbox and closes it before its separate content signer; kernel/support packaging has a nested signing/boot-tool lifetime that must also fit the unchanged aggregate. The smoke-only adapter deliberately refuses detached containers and non-BuildKit exec, so it cannot be reused unchanged for these callers. The next same-node task-local adapter must bind the exact owned Toolbox lifecycle and complete resource accounting, with no frozen product source change, new resource grant or producer replay. Signing key/certificate pairing and actual named boot-tool usage remain prelaunch checks. No component/full-image/guest gate has started or passed at this record boundary. Existing automatic component/signed-image/full combined x64 acceptance continues from the successful smoke; the task remains in progress.


### 2026-09-12 accepted smoke and component executor continuation

B independently accepted the ed723 same-OCI 12/12 artifact smoke and integrated record-only 1ced2b21. Frozen composition, canonical fbbfc4b3, all packed inputs and J/438 source roles remain unchanged. Under B-ED723-SMOKE-ACCEPTED-COMPONENT-CONTINUATION-20260912-0449, this same task is implementing only the task-local component adapter and existing signing-input preflight. The fixed overlapping allocation is daemon 1 CPU/5 GiB, Toolbox 1 CPU/3 GiB, and one short signing/boot-tool container 2 CPU/2 GiB, all on CPUs0-3 with MemorySwap=Memory. Exact-instance registration, operation refusal, create-inspect-start, actual cgroups and fresh per-launch headroom remain required. No product caller is edited; the earlier smoke adapter stays immutable. Actual private/public pairing is checked without exposing private material or creating/replacing trust. Only affected component production follows successful executor/input checks, with no root or successful producer replay.

The component executor now binds exact detached Toolbox instances, exec/close operations, and nested signing/boot-tool lifetimes. Its final 43 direct checks include 33 refusal controls; original smoke-adapter refusals remain separate. Read-only signing-input preflight passed for the existing content, boot and metadata private/public pairs, with task-scoped mode-0600 copies and no trust replacement. Metadata/W3/signing-inputs-v1/result.json SHA256 f42f3fddb4e8ce94c886296fc4b93ef1e0c11645fda95037d9302058cc983937 binds public identities and private-path ownership without exposing private material.

Components attempt 1 reached root verity verification and empty support-directory checks, closed its Toolbox, then failed before signing because the task adapter did not admit the existing resolver's exact image Architecture query. Its aggregate exit 1 at 05:05:48.827256, eight Docker receipts, original adapter/runner and root-v1.building outputs remain immutable; terminal SHA256 5ab842d4727083c9818e7b8f70c5c1794b163ca5baa20d4c3e69cc505a14fb5c. The versioned components-v2 adapter adds only that known immutable-image query; actual amd64/immutable-ID probes passed, while unknown format, shared root tag and unrelated instance still refused. Frozen product source was unchanged.

Actual components-v2 ran 05:08:17.181478 through 05:09:04.816067 UTC, aggregate exit 0. Root component, kernel/support component and firmware commands all exited 0. Terminal metadata/W3/components-run2-terminal.json SHA256 f855696068df941547527ad568f2b839023791826a8cdec00fc8aa1d6284babb verifies 20 final outputs, 23 production Docker receipts, two closed Toolboxes, original source/canonical/input identities and absent terminal PIDs. Every created child had pre-start inspection and actual cgroup proof. The retained daemon stayed 1 CPU/5 GiB; a Toolbox used 1 CPU/3 GiB and an overlapping short signer/boot tool used 2 CPU/2 GiB, preserving the aggregate 4 CPU/10 GiB/swap0 envelope. The exact named boot-tool calls used immutable af672edb and its original 438 labels; original J kernel and 438 native outputs were reused after current-context equality checks, without compilation.

Root image 71,200,768 bytes / fc08de8f038802f53fabec304d669b8248baf4c68c03f8c0e0962e5fc67246c6 is the original packed verity image, now with its new signed component record. Kernel boot.efi is 16,178,216 bytes / b741593ae5b3c07803628a151f52c74ccff46efd773adc756cb75b811edb0c46; support.img is 69,632 bytes / bae83be1fa21a494ed5c6773623a2b4304fd4abbdf3a2e74a3fa28e408951cd7. Firmware BOOTX64.EFI is 180,264 bytes / b5f4cdf7ec6a6366d7b0a6839e51ed7c8545163a62425b1e4cabcc6464f9c07e. Both detached CMS signatures verify against frozen content trust. The initial read-only collector omitted the deliberately external signer certificate and failed signer lookup; component-cms-collector-preparation.json preserves that preparation error. The corrected collector supplies the same frozen certificate for signer lookup and trust validation; no signed bytes or producer was replayed.

The same-node image successor uses tools/image-v1/readiness.json SHA256 ebd23f58e4c6473b1b37f3de890c4aeee1d0cb5571ce4565096b01b3c7289cb8, the unchanged component adapter and eleven bound existing caller/layout/tool source files. Its bounded caller assessment covers all thirteen reached tool names and exact instance/image refusals. Orchestrator 3125811 started at 05:17:01.836384 in persistent pane %101. Actual deployment generations 1, 2 and 3 each exited 0; the first two are the two distinct factory records, and generation 3 is the existing update-archive acceptance input. Original component/package source roles remain distinct: new component version 0.1.0+gited7231cdf982-1 does not relabel original-J package versions. Full-image output is a separate pending producer result under metadata/W3/image-run1.json. The unchanged 1 GiB SYSTEM, two-deployment and filesystem reserve guards run in the real assembler. Signed components and packed smoke are not full-image, guest lifecycle, RSS, physical or post-batch-2 ARM acceptance. Existing automatic successors and conditional batch 2/3 authority remain; this task is in progress.


Image attempt 1 subsequently ended at 05:17:24.696939 with aggregate exit 1. All three signed deployment commands and the generation-3 update archive exited 0; the archive is 87,452,324 bytes / 70be6a78c070e0f9ada053d0ccc6214593067d544490e8994928a82524af1db6. The full-image command refused before Docker create: the unchanged factory caller repeats the identical kernel/root mount pair for its two deployment records, and components-v2 rejected duplicate mounts. Metadata/W3/image-run1-terminal.json SHA256 24870b13fe30db2cfee65b4e6282401790169704a684fb7b26a3ea448a995cdc preserves all five step logs, the exact Docker argv/refusal, successful signed inputs and absent terminal PIDs. No full image or filesystem assembly was produced by that attempt. B received the substantive component terminal and image preparation failure as 01M2A0XF473SW57DRW3Y360P14.

The task-local components-v3 adapter accepts only this exact factory mount tuple, emits one read-only mount per reused component and preserves the writable task output parent. Conflicting source, destination, mode, broader mount, image and unrelated-instance cases still refuse. Eight focused checks, including actual original-argv RED and corrected GREEN, are bound in tools/components-v3/check-result.json SHA256 bb1fd998f5d292715cb38f13441e810e8bcf149c976335b73fe7c4b4de8c0f0f. Existing resource, source, operation, image and cgroup guards are unchanged. Neither product code nor signed input was altered.

Only the never-executed image stage resumed under tools/image-v2/readiness.json SHA256 57553d64afd723f07ab8a5942b1ec8153ecf3c0ea1e6a171b00ff42ffbfa3fe7. Orchestrator 3128936 started at 05:21:31.166416; the actual full-x64-image command is PID 3129055, step boundary 05:21:31.592232, persistent pane %101. The first-event snapshot SHA256 4df327bbf7f77818f982e1d2adf30e3d924a778116558515746dfc551238ab58 binds the actual running argv, frozen ed723/J/438 inputs, fresh capacity/envelope and inspected process environment with no BASH_ENV/DEBUG injection. It is a start snapshot, not a terminal result. New metadata/W3/image-run2.json and separate image-v2 outputs preserve the failed attempt and reuse the already signed deployment/component/archive bytes. Full-image terminal and the dependent actual guest/lifecycle acceptance remain pending at this record boundary. No main, push, publication, completion, ARM or cron action occurred.


### 2026-09-12 full x64 image terminal and guest executor boundary

The image-only continuation completed at 05:22:53.200333 UTC with producer exit 0. The single factory image is artifacts/W3/image-v2/mos-x64-20260912-052246.img, 1,881,145,344 bytes, SHA256 ca6bdd50cad6c3dc2e93160316316092c84cc0da995f022909014e36556037b9. Both distinct authenticated factory deployments use the same accepted ed723/J/438 components. Real GPT, ext4 checks, DATA quota initialization and the two-deployment/reserve guards completed; SYSTEM remains 1,073,741,824 bytes. Metadata/W3/image-run2-terminal-v2.json SHA256 a7685d28fd6f5328770c1c2660ba26cea24cc43259f5aee0547c8da3dfd87971 binds 19 output files and 29 Docker records. DATA e2fsck -fy exit 1 is the caller's explicitly accepted correction result, not an unrelated failed check.

The Toolbox close client timed out after 45 seconds and remains a failed Docker receipt, although the existing production caller did not propagate it and returned image exit 0. Collection refused to call every Docker record successful. Exact later inspection proves container 43a5eb75d26fbdbf03f3bee85b877df954420f9aaf4205a27074f82c66cfea40 absent; image-run2-cleanup-observation.json SHA256 f34c3dd17980d7cc5ba6a36f0d2b69facb3724e4451f809a7d7760ae8a90e314 preserves the original stale running registry separately. No second removal, daemon recreation or artifact reconstruction occurred. This is image production with a retained cleanup-client failure and a verified absent resource, not an all-green executor receipt.

The next same-node guest executor assessment is metadata/W4/caller-assessment-v1/result.json. It binds the frozen API/QEMU/seeding/lab callers and the actual image. The existing lab build unconditionally acquires ARM packages; it must not run in Phase1. A local amd64 lab candidate is inspected by immutable ID, with its history preserved, but its complete recipe/base/snapshot/payload reuse proof remains a prelaunch input check. The component adapter intentionally cannot serve the API controller's nested Docker/socket/QEMU/suite route or write its disposable .qemu directory. The next authorized task-local work is that exact bounded adapter and tool-input validation, preserving the aggregate resource envelope, private transport, fixed C verifier and all eight API phases. No guest has started, and no boot/lifecycle/API/service/RSS/physical or post-batch-2 ARM result is claimed. Existing automatic acceptance continues; no new product or generic approval is requested.


### 2026-09-12 accepted image and bounded guest executor continuation

B accepted the final ed723 image at its actual production scope and integrated eddff80c as records only. This same task now validates the existing immutable lab and controller inputs and implements only the authorized task-local QEMU/controller/API transport. The selected design uses a private task Unix socket and exact operation/instance/mount admission; no shared Docker socket enters a container. The retained daemon stays 1 CPU/5 GiB. Guest, controller, preparation and API lifetimes share the remaining 3 CPU/5 GiB on0-3 without extra swap. Current product callers, final image, signed archive, source roles and prior failed cleanup receipts remain unchanged. No ARM acquisition, guest start or completed lifecycle claim is implied by this input/executor preparation.


The existing lab reuse check now passes against its current immutable d33be5a8 image, pinned amd64 base, exact normalized recipe history and fixed snapshot. Actual read-only collection binds 192 installed package rows and 123 program, firmware, library and module files, including QEMU 10.0.11, OVMF and the real virt-fw-vars payload. Lab payload SHA256 5e8da9b5da38b3a3d2dd7b1f80bff629fbba0e72fd5c91fd1c2f82611deeb1a0 preserves original package ownership/md5sums and current SHA256 identities. The controller's Bun, Docker CLI and buildx bytes independently match the fixed Bun and CLI images; port-payload/result.json SHA256 97f14d2550640ce6c2311f4d0d8d34b92d896fb0f0bf3110b9bc660b1f09c195 binds the actual bounded execution. No lab build, ARM acquisition or target-root Python addition occurred. The initial collector syntax error, unsupported virt-fw-vars --version invocation, generated source-bytecode refusal and wrong recorder source filename remain preparation failures.

The final task-local guest transport passed 41 direct checks, including 33 refusals, and five real host/Bun-client protocol cases. It forwards exact immutable images and known operations through a private task socket, with no shared Docker socket mount. Controller 0.25 CPU/256 MiB, guest 2 CPU/3 GiB and API suite 0.75 CPU/1792 MiB fit beside the retained daemon 1 CPU/5 GiB; DATA preparation is separately limited to 2 CPU/2 GiB and cannot overlap the guest. Every created child requires fresh input/resource checks, pre-start image/mount/argv inspection and actual cgroups. Unknown images, operations, instances, mounts, target architecture, fixture environment and excess overlap remain refusals. tools/guest-v1/readiness.json SHA256 1d49a4c3b4828718b2c1efe9b3717415c5320ca1dd0fb29d23dcbd6449482743 binds this executor and the unchanged product callers.

The first guest attempt ran only preflight at 06:10:20.688425..06:10:26.704324 UTC. Actual 1841-entry source and original final-image integrity checks passed, then the unchanged resource guard refused station CPU 112.69%, above its strict <50% threshold. Orchestrator 3260772 is absent. No bridge, API controller, QEMU, DATA seed or disposable disk was started; there is no guest result. metadata/W4/guest-v1/terminal-v1.json SHA256 feb0ac08013eaac4838a7a54ee9f113274fc490e41be694699f7394e0a1b251c binds the exact failure, immutable runner/readiness and separate subsequent observation of only the original 724215ac buildkitd at 1 CPU/5 GiB/swap0/0-3. The guard raised before retaining the full CPU snapshot; its exact assertion remains the launch evidence, and the later resource observation does not substitute for it. This round ends without a retry, threshold relaxation or daemon recreation. Fresh capacity is required at the next eligible event.

Frozen ed723 source, final ca6bdd50 image, signed generation-3 update archive and J/438 producer identities remain unchanged. All eight API phases and the independent complete shutdown/reboot/update-fallback/lifecycle/auth/storage/service/size/RSS and fixed-C-verifier acceptance remain pending. API teardown will not qualify completed shutdown. Conditional batch 2/3 authority remains, with no current main/push/publication/done or broad ARM action. This task remains in progress.


### 2026-09-12 source-merge steering and guest-only continuation

L1-EARLY-SOURCE-MERGE-AND-WORKFLOW-STEERING-20260912 is consumed. Parent 304kmj92 alone performs the newly authorized early reviewed-source main transaction. B7 retains the existing ed723 source and accepted ca6bdd50 image; no main merge, rebase, broad workflow patch or duplicate image is made here. This source merge does not qualify pending x64 guest/lifecycle results or trigger the deferred broad ARM wave. Per-stage generic approval waits are removed within the existing scope; concrete trust, source, executor and resource checks remain. The verified main/workflow handoff and final D reconciliation are still separate prerequisites for their respective scope.

A fresh current-boundary resource observation passed (capacity.json SHA256 4ad1b844c31d3713afbb6b30532103b319619e6f261636ade474600acaf55adb). Guest attempt 2 preserved the first CPU refusal and moved only the current-image hash into a read-only 0.25 CPU/256 MiB input child, removed before launch; every previous threshold remained unchanged. Its actual API preamble ran 06:18:09.360973..06:18:10.128112, exit 1, because three exact Go-template newline arguments were mismatched by the task adapter. No controller or guest started. Actual original-argv RED/GREEN and four unknown-format/image/instance refusals qualify the versioned correction; no product caller changed.

Attempt 3 passed network discovery and created controller 3abbc1a2684e, but refused before start because Docker reordered the identical bind list. Actual source/destination/mode mappings and command/image were equal. The never-started container was removed and observed absent. A new adapter compares the exact sorted bind list plus the unchanged per-destination source/read-write map; wrong source, permission, extra/duplicate bind, image and command still refuse. Both previous attempts, their Docker receipts and guest-x64-v1 preparation logs remain immutable. A separate clean guest-x64-v2 source/output namespace preserves those paths.

The affected guest-only attempt 4 uses tools/guest-v3/readiness.json SHA256 23469605688566f5008925ee645fdc714c126328cf2e1a7e4a7167e0987ee217. Orchestrator 3288565, private bridge 3288813 and actual API timeout PID 3288814 run under persistent pane %101; API invocation began 2026-09-12T06:24:23.657050+00:00. Actual 1841-entry source, immutable input hash and fresh capacity/envelope checks passed. The unmodified caller has prepared the disposable 4 GiB disk from the one accepted signed image. The original image, signed update archive, J/438 inputs and root/source identities remain unchanged. Metadata/W4/guest-v1/production-v4.json records actual state; preparation or a running harness is not guest/API/lifecycle PASS. The existing eight-phase suite and subsequent complete shutdown/update-fallback/lifecycle checks retain their original assertions and bounded resource allocation.


Actual first guest boot ran 06:24:50.853150..06:25:16.240280 UTC in container 84d3493b19f2b5b0d9f29c67ea453cf1152c1cc51fca7b506e244b930a393ed2. Its real Docker command exited 0 and the container/client are absent, but guest acceptance failed before APID: mos-init refused SYSTEM discovery, then the authenticated static shutdown path reported partial-startup poweroff and the kernel powered down. This is neither normal completed shutdown qualification nor an API pass. The original API harness continues its unchanged bounded readiness deadline; it is not interrupted and no second guest is started.

Read-only first-boot-v4/terminal-and-gpt.json SHA256 75ba245b65c7fbc0581a270395b20f046bbd9791cfabdb9a094b8df30fd8d196 binds the actual console, guest resource/argv receipt and exact source/header bytes. The factory image has 3,674,112 sectors with alternate GPT at LBA3,674,111. The unchanged QEMU caller extends its disposable copy to 8,388,608 sectors; its byte-identical primary GPT still names alternate LBA3,674,111 instead of actual last LBA8,388,607. Both primary CRCs and all three partition identities match, including SYSTEM UUID5ac35760-0064-4000-8000-000000000002. Linux enumerated vda1/vda2/vda3 and warned about the stale alternate-header location. The current native GPT parser requires alternateLba == sectors - 1 and skips a disk when parsing refuses; mos-init subsequently reports SYSTEM partition not found uniquely. This establishes a concrete caller/medium-geometry refusal path, not new target-parser execution or an exhaustive exclusion of other paths. No GPT source, disk header, trust input or producer was changed. The exact technical correction belongs at the existing owner boundary while the newly authorized early reviewed-source main transaction remains separate from failed acceptance.

## GPT geometry correction and implemented workflow (2026-09-12)

The verified early main source/workflow handoff is recorded in the current
coordination boundary above. It authorizes this evidenced in-scope correction;
no new user decision or generic path/stage approval is requested.

The original ed723 API attempt ended at 06:40:00 UTC with exit 1 (launcher
9/10, zero API phases). Its guest had already powered off after SYSTEM
lookup refused the primary GPT on the enlarged 4 GiB disposable medium.
`guest-v1/terminal-v4.json` binds that actual terminal; the immutable image and
all prior snapshots, partial-startup cleanup and failure classifications remain.

`GptMedia-v1` records the native parser repair. Its primary GPT backup location
may precede the physical medium end, but must remain inside the medium; the
usable range still ends before the declared backup table/header. Existing CRC,
UUID, partition range, overlap, device and ownership checks are unchanged.
The original parser failed both the new larger-media unit case and the actual
captured factory/disposable parser case. The final source passes four GPT unit
tests and one actual captured-input test, with no skips; smaller media and
malformed/out-of-range/CRC/UUID/overlap controls refuse. This is parser evidence,
not a corrected native binary, successful boot or API acceptance.

Offline-cache preparation failures, a missing host TOML reader, initial
external-fixture formatting failure and the unrelated Clippy fixture-path
failure remain explicit history. The exact locked 114 cached crate archives
were checksum-verified into task-private storage without network acquisition
or lock/tool changes. Final affected quality results remain separately named.

Actual input attribution checks all 49 native, 59 deploy and 19 boot-tool
entries. Only native/deploy consume the changed module; all boot-tool entries
match. Affected native/deploy outputs need new actual witnesses and dependent
component/image admission. The fixed438 join remains strict until those inputs
are truthfully represented; no producer path was placed in a consumer set.
Original J packages, reusable kernel, boot tools and all old outputs retain
original identities. B receives this clean source/direct evidence for its one
independent review; eligible execution then continues under the existing grant.


## GPT correction native producer terminal (2026-09-12)

B independently accepted d2e352d0a4226f10b8b2587cd7c1bc5040b8d234 and
integrated its exact source into c2058188. The production checkout remains
frozen to d2e352d0/tree190ffef0/epoch1789196122, with all 1841 Git entries
verified before and after production. No B or main source was imported.

The real x64 native hook ran 07:08:53.159666..07:11:07.924441 UTC, exit 0;
its container aaca62aac238 ran 07:08:56.237536..07:09:54.560850 UTC, exit 0.
The bounded cleanup exited 0 and the exact container and original processes
are absent. Aggregate native-v1 completed 07:11:10.010628 UTC, exit 0.
`GptProducer-d2e352d0a4226f10b8b2587cd7c1bc5040b8d234/metadata/native-terminal-v1.json`
SHA256 e9bcc367562f3eba08ccd30c1284e947797434ca39f36b3b0df390499306dbd8
binds all four steps, 20 evidence files, actual source/argv/environment,
output checks and retained resource observations. The earlier start snapshot
of the removing container remains separate from the successful cleanup.

New mos-init is 2403504 B, SHA256
9d1b164b3af709cc382e6bdbc29e222225ac76e0f8c6e9d4a948f425d7548682;
new mos-shutdown is 2043048 B, SHA256
28ccd8655a02d54b4229f9674e297fa7925881cf89450febe436704bfdab3f0d.
Both are actual source-bound x64 static ELF outputs with no PT_INTERP or
DT_NEEDED. GNU static NSS/linker warnings remain in the original 9870 B log,
SHA256 08941a049e5625642853d285cb21a079110d38dd498adbbb01e0da8eddaad021.
No target execution or successful guest is inferred from compilation.

The task adapter admitted the exact existing native hook only, verified its
immutable Rust image and created/inspected the child before start. Actual
cgroups were 3 CPU/5 GiB/swap0 on 0-3 beside the unchanged 1 CPU/5 GiB
owned daemon. Raw fresh CPU/capacity/memory/disk observations were retained
before threshold decisions. No daemon resize/recreation, shared state change,
network crate acquisition, tool/pin change or successful producer replay occurred.

The final producer-inputs-final.json corrects only the previously recorded
pre-final-test GPT after-hash; the original stale GptMedia attribution record
is preserved. Exact final 49 native/59 deploy/19 boot-tool entries confirm
only native/deploy consume the changed GPT module and all boot-tool inputs
remain equal. The next affected producer is deploy under the same serial
resource slot. New deploy/output witnesses and strict final joined-source
admission remain required before affected component/image/guest successors.
Original J packages,438 tool/kernel identities, ed723 image production and
its failed first guest/API attempt remain immutable; none is relabeled.
