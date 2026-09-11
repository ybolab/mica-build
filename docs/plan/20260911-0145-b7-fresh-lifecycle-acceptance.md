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
No production, board, UI, compatibility, main, push or publication changes.

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

### Existing source conflicts reported to L2

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
   `build-inputs/manifest.tsv`. Resolve the arm64 release-policy blocker first.
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
