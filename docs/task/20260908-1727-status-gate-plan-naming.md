# 20260908-1727-status-gate-plan-naming Accept both plan-record namings in the truth-status gate

- **status**: completed
- **priority**: P1
- **owner**: l1/6rjx4wrt
- **createdAt**: 2026-09-08 17:27

## Description

`docs/verify-status.sh` required a `proposed` status line to cite a plan
named `docs/plan/PLAN-NNN.md`. Since the PMA naming rule of 2026-09-08 new
records are `docs/plan/<timestamp>-<feature-slug>.md`, so the first user-doc
page that labels a capability `proposed` against such a plan would fail the
gate. The user asked for the erroring check to be cleaned up and fixed.

Acceptance: the criterion becomes "an existing record under `docs/plan/`,
any `<name>.md` except `index.md`", so both namings satisfy it and the
index alone does not; `docs/verify-status-test.sh` carries both record
shapes in its positive control and a case for the index-only citation;
`docs/user/doc-contract.md` and its zh mirror state the same rule;
`make docs-verify` and `make docs-verify-test` green.

## ActiveForm

Relaxing the proposed-status plan-reference criterion to any plan record.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Standard tier: four files, all under `docs/`, no plan file. Approved by
  the user on 2026-09-08 17:xx after the hazard had been flagged four times.
- RED first: the test fixture gained a `20260101-0000-fixture-plan.md`
  record and cited it; the unmodified verifier then failed the positive
  control (and every case after it, by one extra assertion). GREEN after the
  one-line criterion change: 12/12 cases, all five docs gates green.
- The `TODO(PLAN-0xx)` marker form in the contract is prose only; no gate
  reads it. Reworded to name the plan record generically.
