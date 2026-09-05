# RFCT-330 Resolve the September repository audit findings

- **status**: completed
- **priority**: P1
- **owner**: maintainer/audit-20260905
- **createdAt**: 2026-09-05 17:30

## Description

Resolve A01-A08 and D01-D09 from the [repository audit](../audit/2026-09-05-repository-audit.md), add missing regression coverage and CI checks, and align the compatibility policy with development-stage requirements. Track implementation in [PLAN-081](../plan/PLAN-081.md).

## ActiveForm

Repairing and verifying the audited component boundaries and documentation.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- The user explicitly requested implementation of the reviewed report on 2026-09-05. That approval covers the report's corrective scope; no commit or push was requested.
- Hardware and power-cut acceptance remain distinct from the repository fixes. No update-server protocol adapter is in scope.

## Acceptance

- A01-A08 have implementation and regression or sandbox evidence; D01-D09 current-state claims are synchronized or confirmed already corrected.
- Rust: 1,047 tests and complete workspace gate passed. UI: 149 tests, lint/typecheck/coverage and production build passed. Build/verify: 920 and 1,279 tests passed. Preflight: 25 tests passed. Update server: 36 tests and the clean-container CI gate passed.
- The report records the deliberately unexecuted board/power-cut acceptance and the preserved unrelated `verify/src/checks-update.ts` edit.
- Final documentation gates and their negative fixtures passed; the task is complete.

- complete: A01-A08 resolved and D01-D09 reconciled. Regression, workspace, CI-container, sandbox and final documentation gates passed; evidence is recorded in the audit and PLAN-081.
