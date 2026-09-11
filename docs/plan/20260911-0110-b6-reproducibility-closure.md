# 20260911-0110-b6-reproducibility-closure B6 reproducibility closure

- **status**: implementing
- **createdAt**: 2026-09-11 01:10
- **approvedAt**: 2026-09-11 01:10
- **relatedTask**: 20260911-0110-b6-reproducibility-closure

## Context

The reviewed B5 integration is present at the required source handoff. B6 is
bounded to the current rootfs packing and deterministic-artifact call chain,
with PLAN-913/RFCT-921 lifecycle reconciliation reserved for the later D node.
The current implementation already removes the optimizer auxiliary cache, so
historical build-v2 or duplicate purge designs are explicitly out of scope.

## Proposal

1. Trace the integrated rootfs build, tree-surgery, package-purge, initramfs,
   SquashFS, and existing regression-fixture paths from the committed B0/B4/B5
   findings.
2. Add a focused RED fixture only for a concrete residual nondeterminism or
   cache-regression defect, then make the smallest scoped implementation change
   needed for GREEN. If no defect remains, change no product code and record
   the confirming evidence.
3. Run the required bounded gates, review the complete local diff, and record
   exact results plus the minimum independently cached cold-build proof request.

## Risks

- A broad cleanup could overlap C-owned public-metadata or source-identity
  blocks; those areas will remain untouched.
- Fixture-only evidence cannot establish byte-for-byte cold-build equality;
  that proof remains explicitly pending until L2 schedules the approved heavy
  slot.
- Upstream package or tool drift can masquerade as build nondeterminism and
  must be frozen and compared separately.

## Scope

Only the B6-authorized reproducibility portions of rootfs packing scripts,
deterministic compose stages, initramfs packing, focused verify/test fixtures,
and this task/plan tracking pair. No verifier public-metadata source, UI,
compatibility, migration, kernel, board, QEMU, or hardware changes.

## Alternatives

- Rebuild the historical build-v2 purge design: rejected because current
  pack-tree surgery already removes the auxiliary cache.
- Claim reproducibility from fixture tests alone: rejected because independent
  equal-input cold builds are a distinct artifact-level proof.

## Annotations

- Prior approval: the B6 dispatch explicitly authorizes this full-tier proposal
  and local scoped commits without another approval stop.
- Compatibility with historical images or update formats is not required.
- Audit result: current initramfs sorting/fixed timestamps, SquashFS fixed
  mkfs/file timestamps and single-threaded compression, verity salt/geometry,
  selected-tree metadata normalization, and packed round-trip verification are
  already sufficient at source/fixture level. No change to `initramfs.sh`,
  compose stages, the verifier, package-manager purge, or C-owned source was
  justified.
- Proven residuals: the existing aux-cache removal was not idempotent, the final
  pack boundary did not reject cache reinjection or missing loader state, and
  the rootfs wrapper did not expose the existing stages no-cache control. The
  implementation and RED/GREEN evidence are recorded in the related task.
- Artifact equality remains a distinct milestone. The minimum request is two
  serial `virt-arm64` root builds from one immutable source and package/tool
  input bundle with `MOS_ROOTFS_NO_CACHE=1`, disjoint timestamped archives, and
  zero-sanction comparisons of full SquashFS bytes, full verity bytes/root hash,
  selected reports and unpacked content/metadata. It may share B7's first root
  build only through an explicit L2 schedule.
