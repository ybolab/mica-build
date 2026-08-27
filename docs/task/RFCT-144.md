# RFCT-144 PLAN-015 M5: the task index and the task files disagree about what is finished

- **status**: completed
- **priority**: P2
- **owner**: PLAN-015 M5
- **createdAt**: 2026-08-26

A checkbox in `docs/task/index.md` and the `status:` field in the file that row
links to are two independent records of the same fact, and nothing compares
them. `docs/verify-index.sh` checks membership in both directions — every task
file is listed, every listing resolves — and by design says nothing about
status, so a row and its file can disagree indefinitely.

The failure is silent in the direction that matters: a row ticked `[x]` over a
file that reads `status: pending` presents an open defect as finished work, and
a finished-looking row is one nobody opens again.

This task reconciles the two records: `RFCT-129`..`RFCT-141` return to `[ ]`,
and `RFCT-122`..`RFCT-127` take `status: done` and `owner: PLAN-015 M5`.

A third assertion in `docs/verify-index.sh`, comparing each row's checkbox
against the `status:` field of the file it links to, would make the agreement
mechanical. That is a scoped change to a gating script; it is recommended, not
made here.
