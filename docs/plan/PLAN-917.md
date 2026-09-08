# PLAN-917 Move branch-owned record IDs into a reserved range

- **status**: completed
- **createdAt**: 2026-09-01 02:03 UTC
- **approvedAt**: 2026-09-01 04:38 UTC
- **relatedTask**: [RFCT-935](../task/RFCT-935.md)

## Context

The common ancestor is `15e87d66`. `origin/main` has advanced 129 commits
from it and independently allocated overlapping plan and RFCT ranges with this
branch. The exact old-to-new mapping is retained in RFCT-935, because the
identifiers name unrelated work on the two sides.

This branch currently has active workers and a shared checkout. The plan and
task indexes are frequently edited, and selected active records have recent
updates. A history rewrite would disrupt those workers and is excluded. The
only required change is a forward documentation-and-reference renumbering.

The current `docs/verify-index.sh` verifies only `docs/design/` against
`docs/README.md`, not PMA process records. It remains a required repository
check, but a complete identifier audit is necessary to detect stale plan and
task references.

## Proposal

1. Re-audit the current branch-created plan/task file lists against
   `origin/main` immediately before editing, so records added while this plan
   awaited approval are either included or explicitly deferred with the user.
2. Rename the existing branch plan and task files exactly according to
   RFCT-935's mapping, into `PLAN-910` through `PLAN-916` and `RFCT-910`
   through `RFCT-934`.
3. Update every mutable exact reference to those identifiers and paths across
   the working tree, including both indexes, record headings, Markdown links,
   design text, source comments, and test names. Preserve physical artifact
   filenames containing historic IDs, while changing surrounding task prose to
   the mapped identifier and documenting those filenames as audit exceptions.
4. Keep RFCT-935's mapping table as the stable lookup for BKD issue titles and
   reports that cannot be changed. Reserve `910` through `999` for this
   branch's plan and RFCT records until integration.
5. Verify every renamed record has one matching index row and valid relative
   links; audit that no old identifier remains except the mapping table and
   immutable artifact filename allowlist; run `bash docs/verify-index.sh` and
   `git diff --check`.
6. Stage only explicit renamed and edited paths, inspect
   `git diff --cached --name-only`, and create an ordinary documentation
   commit. Do not merge, rebase, push, build, or access hardware.

## Risks

- A concurrent worker can modify a record or index during the rename. Re-read
  the worktree before each patch and preserve any unrelated edits.
- Broad replacement can corrupt an immutable artifact path or unrelated
  historic reference. Match complete identifiers, inspect each exception, and
  retain only explicitly justified old-ID literals.
- Renumbering only the current collisions leaves branch records in the next
  mainline allocation range and would merely defer the same conflict.

## Scope

- `docs/plan/`, `docs/task/`, indexes, and in-tree cross-references to the
  branch-owned records, plus the mapping table in RFCT-935.
- Excludes every `origin/main` record, BKD issue/report mutation, history
  rewriting, remote pushes, builds, and hardware.

## Alternatives

- Move only the currently overlapping identifiers: rejected because the
  remaining sequential branch IDs collide with the next upstream allocations.
- Rebase or merge first: rejected because it increases the active conflict
  surface and would disrupt the shared checkout.
- Use a four-or-more-digit branch prefix: rejected for now because the existing
  record convention is a three-digit sequence, while the documented `9xx`
  shard provides a large, explicit reserved namespace without changing tools.

## Annotations

- Approved for implementation on 2026-09-01 04:38 UTC.
- Completed on 2026-09-01 04:43 UTC after the mapped renames, cross-reference
  audit, PMA record-link audit, documentation index check, and whitespace check.
