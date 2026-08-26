# RFCT-128 PLAN-015 M5: citations repaired against the checker, and the check made to gate

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
- **createdAt**: 2026-08-26
- **plan**: PLAN-015 (M5)

Run `bash docs/verify-citations.sh` over the documents the sibling subtasks
have rewritten, and repair what it reports: citations into files that are not
in the tree, one line past the end of its file, and quotations no longer at the
lines they cite.

A citation that no longer has anything to point at is deleted with the sentence
that needed it, not re-pointed at the nearest surviving line.

When a run over the tree is green, drop `--advisory` from the `make` target and
from the CI step. That flag is the only thing that changes.

Provenance claims are not repaired by the checker and are not repaired by this
task's mechanism either; they are read and judged by hand.
