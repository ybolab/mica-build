# 20260908-1423-file-ab-signed-components Design and implement file-based A/B with independently signed components

- **status**: in_progress
- **priority**: P1
- **owner**: l1/6rjx4wrt
- **createdAt**: 2026-09-08 14:23
- **relatedPlan**: [20260908-1428-file-ab-signed-components](../plan/20260908-1428-file-ab-signed-components.md)

## Description

Prepare a complete proposal for a smaller partition layout, independently updatable boot firmware, kernel packages and rootfs images, and kernel verification of signed dm-verity root hashes. The user requests a plan before implementation and does not require backward compatibility during development.

Acceptance for this phase: a reviewable plan covering current evidence, trust boundaries, component ownership, disk layout, boot and update transactions, rollback, key lifecycle, implementation steps, tests, and explicit unresolved hardware evidence. Implementation remains pending approval.

## ActiveForm

Awaiting implementation approval for the completed file-based A/B proposal.

## Dependencies

- **blocked by**: (none for design; implementation requires approval)
- **blocks**: (none)

## Notes

- Coordinate at implementation time with the active runtime composition and trust-provisioning work. This task does not change their records or implementation.
- Investigation and the complete draft proposal are delivered. The original five-partition draft has been revised to three partitions following the user's writable-DATA consolidation request. It covers independent component updates, signed root/support images, key lifecycle, trial/rollback transactions, RAUC replacement, UEFI bootloader selection, ten implementation phases, and a fault-acceptance matrix.
- Only planning records and their indexes changed. The user authorized a local commit of these records; implementation remains pending approval. No boot experiment, device write, key provisioning, or push is included.
- Validation passed: `make docs-verify`, `git diff --check`, and explicit plan/task structure, local-link and index/state checks. The implementation task is pending; the related plan is a completed draft awaiting approval.

- unclaim: Investigation and proposal are complete. Release the implementation claim while the draft awaits explicit approval.

- Plan amendment: move state/meta/var into DATA directories; use bind mounts for system paths, add project-quota and writer-ordering requirements, and replace partition-based cleanup assumptions with explicit directory scopes. Runtime implementation remains unapproved and unchanged.

- Plan correction: keep the var parent skeleton read-only and expose only required writable leaves. Remove the whole-var DATA bind/seeding/budget, record known persistent writers and existing volatile/container storage, and add remaining-writer audit, narrow cleanup and negative-write acceptance criteria. Only the proposal changed.

- unclaim: Unified DATA plan amendment is complete; implementation remains pending approval.

- unclaim: Selective writable-path plan correction is complete; implementation remains pending approval.

- 2026-09-08 17:14: P1 dispatched as two L3 tasks with disjoint files. P1-A
  (boot/trust primitives: signed verity on x64 and cx3576 kernels, cx3576
  signed FIT, UEFI shared-UKI Type #1 entries) is BKD `ew42ee3o`, record
  `20260908-1712-p1-signed-verity-boot`. P1-B (writable-path writer audit,
  random-seed resolution, container-network destination) is BKD `iku9ubdw`,
  record `20260908-1712-p1-writable-path-audit`. Both branch from
  `a1bcd5bd` (cx3576 contract 454). P2+ wait on P1's evidence.

- 2026-09-08 17:19: user direction — parallel confirmed, x64 first under
  QEMU, then the same layout on cx3576 and the other boards. Both P1 tasks
  re-prioritised by follow-up; P1-A reports its x64 stage on its own so P2
  for x64 can open before the cx3576/virt-arm64 stage finishes.

- 2026-09-08 19:31: P1-A (`ew42ee3o`) reported all five proofs feasible as drafted on
  x64, virt-arm64 and the cx3576 kernel under QEMU; nothing weakened. L1
  acceptance by content passed (raw logs match the report; contracts 455/325,
  unit suite, docs gates re-run by L1; a byte flipped in the valid signature
  is refused with -EKEYREJECTED). Merge waits on the proof harness being
  committed to the branch and on the x64 image contract. P1-B (`iku9ubdw`)
  stalled with its turn ended during a three-boot QEMU run whose second boot
  failed on SSH; resumed by follow-up with the measured outcome.

- 2026-09-08 20:22: P1-B (`iku9ubdw`) merged. Deliverables: the 14-row writer contract
  and 25-row negative list for x64 (each row observed/declared/inferred), the
  random-seed resolution as a file bind (start, shutdown save and reboot
  survival measured; systemd-random-seed writes through the inode), the
  container-network destination `/mos/containers/networks` with the reset
  tiers read off `reset.rs`, `/var/tmp`/`PrivateTmp=` guidance, the P5 change
  list and board differences. L1 re-ran the static half and one candidate
  boot: the bind, save/load and the seed's change on DATA after power-down
  all reproduce. Four findings outside the contract became three pending
  tasks (`state-units-never-load`, `ssh-generator-vs-image-policy`,
  `wtmp-unbounded-append`). Harness: `tests/p1-writable-path-audit/`.

- 2026-09-08 21:04: P1-A (`ew42ee3o`) merged. All five boot/trust proofs feasible as
  drafted, nothing weakened: signed dm-verity accepted/refused with one errno
  set on x64, virt-arm64 and the cx3576 vendor kernel; one kernel boots two
  signed roots (switch_root on all three); cx3576 FIT enforcement in the
  U-Boot sandbox and the board's control FDT taking a required key; systemd-boot
  shared-UKI Type #1 entries with boot counting and `LoaderEntrySelected` on
  x64 and virt-arm64. Tree: verity symbols in the shared kernel floor, the
  `verity` dev-key domain, the `kernel-verity-trust-anchor` contract check
  (cx3576 455, virt-arm64 325, x64 326), and the lab under
  `tests/signed-boot-lab/`. L1 re-ran the contracts, refused a byte-flipped
  signature, and required the lab on the branch and a reproducible x64 verdict
  before merging. P1 is complete; P2 opens on x64. Carried into P2: the anchor
  as a distributed build input, and kernel certificate expiry/revocation.
  The shipped cx3576 path still boots an unsigned legacy `boot.scr` (P6).

