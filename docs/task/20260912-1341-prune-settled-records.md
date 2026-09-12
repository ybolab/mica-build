# 20260912-1341-prune-settled-records Prune the settled plan and task records

- **status**: completed
- **priority**: P2
- **owner**: maintainer/prune-20260912
- **createdAt**: 2026-09-12 13:41

## Description

Apply the plan and task audit (`docs/reports/20260912-plan-task-audit.md`)
to the tracking tree: delete every plan and task record whose own status head
reads completed, closed or rejected, drop their index rows per the index rule,
reject the superseded BusyBox plan, convert links to deleted records in
retained files into bare names, keep the documentation gates green, and record
the deletions in `docs/changelog.md`. Open records are neither closed nor
reclassified; the audit's remaining obligations stay with them.

Acceptance: `make docs-verify` passes; no retained file links to a deleted
record; both indexes list only records that exist.

## ActiveForm

Pruning settled plan and task records

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Investigation record: the audit report itself; no separate plan file.
