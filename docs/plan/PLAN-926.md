# PLAN-926 Merge the S905X5M adaptation into updated local main

- **status**: completed
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

- Resolved all four textual conflicts, preserving upstream's slot-specific
  CX3576 digest names and S905X5M's independent DTB/boot contract.
- S905X5M declares HDMI present and a DRAM floor of zero from its existing
  DTS. Its configuration and package-inventory readers now resolve absolute
  directory links inside the extracted root, with a positive/negative test.
- The first verifier run found 14 display-test failures: upstream's fixtures
  relied on a cached boot script, while the adaptation deliberately requires
  a fresh slot read. The fixtures now supply bytes through a checked mcopy
  transport. A stale-export regression preserves fresh reads rather than
  restoring the cache bypass.
- Final verifier typecheck and suite: 1,468 tests passed, zero failures,
  22,028 assertions across 50 files.
- Build-driver typecheck and boot/bundle/geometry unit tests: 171 passed,
  zero failures, 619 assertions. Seven real-bundle cases were explicitly
  filtered out to honor the packaging stop.
- The apid and settings-model source trees match the tested adaptation tip;
  their previous 325-test API result still describes those unchanged files.

- Package selection: 49 checks passed; all 25 producer packages are reachable
  across 514 legal resolutions, with six distinct refusal cases. The S905X5M
  radio/component preflight passed.
- Container-network kernel configuration: 155 assertions passed. The API UI
  build-contract check passed without compiling Rust or the UI.
- Documentation: 195 index checks, 491 links, 763 status assertions, 249
  translation-coverage checks and 150 board-dossier assertions passed.
- Review of the merge resolutions and automatically merged package/root
  changes found no introduced correctness issues. The integration diff against
  the adaptation tip passes whitespace checks. The full first-parent diff
  reports whitespace in 49 inherited files; all 49 are byte-for-byte unchanged
  from the adaptation tip, including patch context that must be preserved.

The verified integration is committed on local main. Both source histories
are retained; remote main remains at 3c5374f3 and the adaptation branch remains
at 2e276018. No image/package/installer build or device update was performed.
