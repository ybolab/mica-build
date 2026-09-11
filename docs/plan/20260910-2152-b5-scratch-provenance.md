# 20260910-2152-b5-scratch-provenance Wire scratch runtime composition and shipped provenance

- **status**: implementing
- **createdAt**: 2026-09-10 21:52
- **approvedAt**: 2026-09-10 21:52 (prior user approval)
- **relatedTask**: 20260910-2152-b5-scratch-provenance

## Context

Approved integrated L2 source is `733708c0cec6d4137fb4dfabbf8a6719dcd4a2a8`.
Use [B0](20260910-1013-b0-lifecycle-rootfs-audit.md) S3/S6 and
[B4](20260910-2100-b4-runtime-selection.md) interfaces and residual ownership.
The existing selector is not yet connected to the packaging destination.

## Proposal

1. Capture native package ownership and original file identities alongside the
   existing installed inventory before destructive transforms. Verify with missing
   and ambiguous capture refusals and actual fixture package metadata.
2. Finish precise producer declarations, then select into scratch after offline
   transforms; connect final packaging/export consumers and verify every transfer.
   Verify RED/GREEN for the actual packing chain, metadata and forbidden residues.
3. Join existing archive identities, post-transform file hashes and debug mappings;
   distinguish build inputs from shipped contributors and quantify available
   artifacts honestly. Verify deterministic joins and hardlink-aware fixture sizes.
4. Run required cheap gates and applicable stack/review checks. Record exact
   source/commands/logs/results and B7 grant-dependent acceptance recipes.

## Risks

Missing dynamic resources, generated state, runtime links or ownership must refuse
selection. Container transfers can lose hardlinks/capabilities. Small fixtures do
not prove OCI/SquashFS/guest metadata, runtime allocation or physical behavior.

## Scope

Only rootfs/runtime, compose, packing/selection/provenance scripts, required package
selection declarations, narrowly relevant build/verify contracts and tests,
rootfs-runtime/package fixtures, measurement tooling if necessary, and own records.
No C reserved implementation, UI/native lifecycle/service-policy edit, main sync,
push, global records, extra issues or resource grant expansion.

## Alternatives

Reuse selected.pkgs, manifest.tsv, native dpkg lists and archive locks; do not
create another package solver or infer generated origins from arbitrary files.

## Annotations

- 2026-09-11: L1 approved continuation after both C handoffs, not corrective
  round 2; corrective count remains 1. Preserve the existing claim and approval.
  Reviewed C.D2 source `e30aebf2086c41f4b3c255de95f74ffb52fa2c62` was transferred
  separately in `23a3414a8c82f86edbae4434cbf7dd0bd0066b7e` using the approved
  20551-byte patch, SHA256
  `4a71b0a527b6d2f1bea2b5d1d7796521cb6b701fd1e5f41beafd0971912566a8`.
  Only rootfs/build.sh public-meta staging, rootfs/scripts/validate-public-meta.sh
  and build/src/public-meta.test.ts were imported. The validator runs before
  staging; sourceIdentity, Toolbox and verifier reservations remain unchanged.
- Additional approved S6 interface: build/src/release-manifest.ts FILES,
  ReleaseInputs, derived, assembleRelease and necessary typed validation join a
  mandatory rootfs-report.runtime.json to native package/archive/source/debug
  records. release-cli.ts USAGE/main options/assembleRelease arguments require
  `--runtime-report FILE`; its sourceIdentity function/imports are untouched.
  release-manifest.test.ts shared fixtures, tamper cases and shipped CLI argument
  lists may change, preserving all Git/read-only/host-route assertions.
- Existing rootfs/runtime declarations/composition and focused Python fixtures
  may retain precisely the current public manifest and optional nonempty GENERATED
  output with named staging/install producers. Unknown metadata, missing captured
  outputs and provenance mismatches remain refusals. No compatibility fallback
  or new package authority. RED/GREEN covers absent/malformed runtime reports,
  inventory/archive/file/debug discrepancies, signed root identity mismatch,
  public metadata retention and tampering. Actual tree/image/runtime evidence
  stays with B6/B7 under future grants; this continuation has heavy=0.

- Prior full-tier user approval recorded at dispatch; plan activation follows claim.
- Preserve declined S5 tools, signed file deployment, boot/debug/support boundaries,
  bounded writable var, unlimited application quotas and private container storage.
- L2 B coordinates historical residuals; B5 retains composition; B7 proves fresh
  first-boot unit/Quadlet, SSH refusal/key and volatile accounting runtime rows;
  D3 updates old records using the final handoff.

## Implemented packing interface

`compose-install.sh` runs `compose-capture.sh` before discarding /mos-compose.
The inventoried stage copies manifest.tsv into /mos-build-inputs; captured reads
that stage offline and records configured.json. Existing hwdb, preset and purge
transformations remain in disposable closed state. Pack transfers that state via
GNU tar with numeric ownership and all xattrs, then compares its complete native
metadata and hardlink snapshot. Build inputs move outside the installation root.

After existing residue, tree, shadow, boot-boundary and debug transformations,
`rootfs/runtime/compose.py compose` consumes those native captures and the B4
rules. It resolves exact alternative/enablement outputs, records named producers,
reconciles the shipped manifest, normalizes the same SquashFS epoch, and selects
into empty /runtime with no network or target execution. Missing roots/captures,
wrong link types/targets, unknown operators, build-state roots and unknown public
metadata are refusals. The source stays quiescent during each selection/copy.

Every retained non-directory contributor has native package/version/architecture,
source package/version, archive SHA256 and retained copyright resources. Per-path
records include configured and final hashes/metadata, reasons and named generated
origins; stripped files additionally name the existing checked build-id debug
counterpart and digest. Configured digests describe the installed/configured
files, not unmodified archive members; archive digests are recorded separately.
The original input manifest is retained externally and never replaced by a new
package authority. Transform source hashes and actual pack-tool package versions
are external build inputs. Release-level joining now requires the exported rootfs report and authenticates
its root image/geometry association through the existing signed deployment gate.

SquashFS and privilege inventory read /runtime. An actual unsquashfs roundtrip
and a factory candidate COPY check compare the complete selection report.
The artifact target depends on that factory check. Final OCI export/extraction
still requires the B7 check below; small tar fixtures prove only their own path.

## Measurement boundaries

| Output | Implemented measurement / remaining evidence |
| --- | --- |
| Selected unpacked root | Actual destination apparent bytes, once-per-hardlink-group data bytes, allocated file blocks, file inodes, directories and symlinks. Sparse-file fixture proves source allocation cannot substitute for destination allocation. |
| Compressed root and complete verity image | After packing, hash exactly SQUASHFS_BYTES from the complete image and hash the whole image, retaining the current geometry/env record. Byte fixtures verify prefix/full-image identity and changed-tree refusal; no real current image was built. |
| Debug | Existing strip manifest and checked GNU build-id counterparts remain external. Per-selected-file report joins final hash, before/after sizes and debug-file SHA256. |
| Boot/support | Root retains mountpoint directories only; existing pack-export-boot still refuses payloads here. Matching signed kernel/support, module indexes, startup archive and retained payload measurements need actual independent component inputs at B7. |
| Runtime allocation/RSS | Explicitly pending B7 guest evidence, including retained tmpfs allocation and process-tree scope. No fixture byte count or tmpfs capacity is labeled memory usage. |
| OCI/newest images/cold builds | No actual artifacts exist in this worktree. B7 owns actual exports/fresh images; B6 owns granted equal-input cold comparison. No size gate was relaxed. |

## Historical residual classification

Exact policy source is approved L2 `733708c0cec6d4137fb4dfabbf8a6719dcd4a2a8`.
The three historical task blobs remain untouched. L2 B owns coordination, B5
owns composition retention, B7 owns fresh runtime proof, and D3 owns old-record
reconciliation. Current implementation and fixture evidence are separate from
first-boot, disabled-feature and authentication runtime results.

| Obligation | Current evidence and classification | Remaining runtime row |
| --- | --- | --- |
| First-boot system extensions | Old STATE pathname superseded by DATA. Current mos-load-extensions.service orders after the bind, reloads and starts multi-user without blocking. Existing runtime-build seeds extension.service and runtime.sh:122 asserts its marker. B5's composition fixture preserves actual loader/bind bytes. Valid and covered by B4/B5 packaging. | B7 first boot of a newest complete image must produce /run/mos/persistent-unit-ran; source/fixture is not a runtime pass. |
| First-boot Quadlet and disabled policy | Separately valid. Current etc-containers-systemd.mount and conditional mos-podman resources remain selected; composition fixture preserves the actual bind unit. | B7 first-boot selected Quadlet and declined/disabled policy cases. The system-unit marker is insufficient. Service-policy defects require exact out-of-scope hunks through L2. |
| SSH command-line listen conflict | Existing system package mask to /dev/null is intentional policy. Selection and final composition preserve the actual symlink type and exact target. | B7 boot with systemd.ssh_listen= and refuse a conflicting generated socket/listener. No runtime pass inferred from mask source. |
| Image-only SSH keys | Current 05-mos-authorized-keys.conf is retained byte-for-byte with native metadata; no outbound SSH/S5 tool reduction. | B7 accept the image-policy-only key and refuse the disallowed alternate path independently. Reconciler/policy repair is outside B5. |
| Login accounting bound | Old unbounded var/log symptom superseded by implemented /run/mos links and mos-var.conf targets. Actual tmpfiles bytes and exact links survive composition; whole-var policy and unlimited application/private-container storage remain unchanged. | B7 verify effective /run bound, target/parent permissions and repeated-login writes for wtmp/btmp/lastlog; runtime allocation and first-boot proof remain open. |

No outside-scope service-policy defect was demonstrated. No repair ownership is
left unassigned: exact runtime failures go through L2 B to L1 scheduling.

## Remaining acceptance recipe and grants

Corrective round 1 is approved within the existing B5 scope. The collected
`75b77f3b` full build gate exposed two stale assembly expectations. Replace the
four-target list with the exact capture/selection/validation stage sequence and
assert that factory-root contains only pack's selected /runtime, that its
candidate is verified against the selection report offline, and that every
artifact export depends on factory-checked. Mutated Dockerfile fixtures must
reject disposable roots, alternate COPY sources, missing verification and
bypassed artifact validation. Use the existing stages runner and one full build
suite, with exact source/log/exit metadata; retain the original RED and accepted
UI baseline. The existing task claim and plan status do not change. No production
or reserved C file is part of this correction.

That independent correction is delivered in
`e07aac23913cc4c162e4de1a5af934d0c2e5ec3d`: focused stages passed 104 tests and
13 negative controls; the single full build run passed 412 tests and 1206
assertions. Clean-source docs and diff checks passed. Exact results and original
RED are in the related task and `/tmp/mos-b5-r1-614v4f9m/`; final run metadata
SHA256 is `65575758523bce1da13084bccce6b7e9609907116cf0c340ff86293f6f32bded`.
Shared/TypeScript backend review passed with zero findings. Only the task/plan
evidence changes after the tested implementation commit. The two C handoffs and
grant-dependent B7 rows below remain open; the plan remains implementing.

The approved public-meta source and release-fixture boundary are now delivered.
The declarations/report join and focused tests are implemented; collect final
committed-source gates before software completion. No other C or main branch may be imported
without that exact handoff.

B7 grant request: one named board/job at a time, exact approved integrated commit,
frozen package/tool/trust inputs and an owned output directory. Required commands
include `make os-deb-package-gate` (requires existing pools and rebuild resources),
`make os-rootfs-x64` and `make os-rootfs-virt-arm64` for the corresponding approved
board grants, then the existing actual image verifier/smoke commands against
those outputs. These commands were not started by B5.

On the actual extracted factory OCI root, run:

```bash
python3 rootfs/runtime/select.py verify --root "$EXTRACTED_FACTORY" --report "$BOARD_OUT/rootfs-report.runtime.json"
```

Use the identical report after extracting the SquashFS prefix; preserve numeric
owners, hardlinks, modes, all xattrs and normalized times. Require byte/hash and
component identity agreement with the signed newest image, update bundle and
debug exports. A missing actual artifact or mismatched report is a refusal.

The existing runtime command interface is
`tests/file-ab-x64/runtime-build.sh ROOT_IMAGE KERNEL_DIR CERTIFICATE PRIVATE_KEY MOS_INIT BOARD`,
then `tests/file-ab-x64/boot.sh` inside the granted acceptance runner. L1 must
supply actual paths/job details; no key contents belong in logs. B7 additionally
owns the separate Quadlet/disabled, SSH-listen/key refusal and repeated-login
rows above, current system/storage/reset invariants and safe lifecycle teardown.
Physical board/power-cut evidence remains separate. The B5 worktree received no
heavy build/guest grant, and no such job was run.


## S6 release interface and evidence boundary

`build/run.sh --release assemble` requires `--runtime-report FILE` in addition to
its existing arguments. Use the root build's rootfs-report.runtime.json and the
selected `/usr/share/mos/manifest.tsv`; the external build-inputs/manifest.tsv is
not the shipped package inventory. Baked metadata must match selected manifest
and optional marker bytes exactly. The raw report is a checksummed release
artifact; provenance joins its per-file owners, native source/archive identities,
configured/final metadata and debug counterparts. Licenses name actual retained
copyright resources and hashes. SBOM components remain the shipped contributors;
provenance separately records all build packages. Measured verity bytes/digest
and geometry must match the authenticated update root component.

The current public producer is rootfs/build.sh public-meta staging followed by
compose-install.sh meta_install. Required manifest, conditional nonempty marker
and their regular parent directories are retained from configured capture; lost,
changed, uncaptured or unknown public paths refuse. Original marker bytes are
preserved by release assembly while the existing domain/channel checks remain.

The join validates report consistency and its signed root association, not actual
filesystem extraction or physical/runtime behavior. Per-file report/provenance
records are bounded at 128 MiB; all filesystem/image size gates are unchanged.
Allocation/RSS/fresh-image/boot-payload evidence stays explicitly pending B6/B7.
No actual root/image/kernel/QEMU/cold build was authorized or run by B5.
