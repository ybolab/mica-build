# PLAN-926 Merge the S905X5M adaptation into updated local main

- **status**: implementing
- **createdAt**: 2026-09-08 10:00 UTC
- **approvedAt**: 2026-09-08 10:00 UTC
- **relatedTask**: RFCT-947

## Investigation

Local main was at `09c384cd22de`; origin/main is now
`3c5374f3f951c2436312b39eb11abf9ed5969807`, 37 commits ahead.
The adaptation branch ends at `2e276018c1c7f623ebf3d6ec7e075da5203d35de`.
A merge-tree preview found conflicts in the bundle builder, board predicates,
boot-chain imports and plan index. Upstream also introduces required display
and DRAM declarations, slot-specific CX3576 boot digests, root-confined path
resolution, generator masking and producer-owned build-commit records.

## Proposal and authorization

The user explicitly requested updating local main and merging the adaptation
branch into it. Fast-forward local main to the fetched upstream, then merge
the adaptation branch while preserving both sets of functionality. Resolve
semantic integration issues as well as textual conflicts. Keep the original
board checkout and its edits intact. This request does not include a remote
main push, packaging or device deployment.

1. Track the local integration before editing merge results.
2. Preserve upstream slot-specific digests on boards that declare that
   protocol; preserve S905X5M's independent boot payload contract.
3. Keep the union of board predicates and update S905X5M's explicit board
   declarations from its existing source facts.
4. Inspect automatically merged package/root and verifier changes for
   interactions, especially paths within an extracted root.
5. Run build-driver and verifier typechecks/tests plus relevant shell and
   documentation checks, using existing containers without packaging.
6. Commit the verified merge on local main and confirm both input heads are
   ancestors. Preserve unresolved hardware qualification findings.

## Risks and verification boundary

Textual conflict resolution alone would make S905X5M inherit CX3576-specific
boot digests or omit newly required board metadata. Source tests cover these
integration contracts, but do not qualify a rebuilt image or hardware boot.
Existing artifacts retain their original provenance and will not be rebuilt.

## Verification

Pending merge resolution and the scoped source checks.
