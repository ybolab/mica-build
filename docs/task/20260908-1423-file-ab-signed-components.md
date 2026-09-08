# 20260908-1423-file-ab-signed-components Design and implement file-based A/B with independently signed components

- **status**: pending
- **priority**: P1
- **owner**: (unassigned)
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
