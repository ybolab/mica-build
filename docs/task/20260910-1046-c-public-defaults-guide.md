# 20260910-1046-c-public-defaults-guide Update the public defaults guide

- **status**: completed
- **priority**: P1
- **owner**: worker-c/u2kannpx
- **createdAt**: 2026-09-10 10:46

## Description

Replace the stale RAUC, TUF, and user-space signing-key guidance in
`meta.example/README.md` with a concise description of the current public
factory manifest, its code defaults, and the existing development generator.

Acceptance criteria:

- Document the exact current public manifest fields and no-source/fleet-off
  defaults without claiming pending validation work has shipped.
- Keep private signing inputs on signing hosts and distinguish them from the
  public-only root-build directory.
- Reference the canonical design documents and the existing fresh-directory
  generator flow.
- Pass the focused stale-content check, `make docs-verify`, and scoped
  `git diff --check`.

## ActiveForm

Updating the public defaults guide.

## Dependencies

- **blocked by**: 20260910-1012-c-config-update-obligations (satisfied by local upstream `e03686e0a1225c5bb1d4a2a082ced4574d160af8`)
- **blocks**: (none)

## Notes

- The campaign approval satisfies the proposal gate.
- The original stale-content check matched RAUC paths, `trust.signingKeys`,
  and `root.key`; no documentation gate had run before this task began.

- complete: Focused stale-content check, manual contract/link verification, scoped git diff --check, and make docs-verify passed.

- integration refresh: Merged reviewed local upstream
  `31d7c109f983a3b41664104d21568e92783c81c0` as merge commit
  `f0cc98f373a9007b7d87ded27a67928cfc0bdefd`. The completed task state and
  original acceptance history remain unchanged; this bounded refresh updates
  only the staging description for the delivered public-meta validator.
- The earlier interrupted execution remains execution history and is not
  reclassified as a documentation-gate failure.
