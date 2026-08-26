# RFCT-116 PLAN-015 M3: function-oriented comments in the test scripts

- **status**: in-progress
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-26 16:40
- **claimedAt**: 2026-08-26 16:40
- **plan**: PLAN-015 (M3)

Apply PLAN-015's triage rule to the test scripts: `test/**`, `mosd/hack/**`,
`os/tests/**` and every `*.test.ts` in the tree. Delete the C1-C4 classes
outright, rewrite the C5-C7 survivors into short present-tense statements, and
leave every MUST-KEEP item standing. Task IDs also leave test names and runtime
strings - the one permitted non-comment edit class, each change tabulated below.

## Scope

- **In**: `test/**`, `mosd/hack/**`, `os/tests/**` except `README.md`, every
  `*.test.ts` under `os/verify/src/`, `os/build/src/` and `os/build/src/tools/`.
- **String-only (scope extension approved by L1)**: `os/verify/run.sh`,
  `os/build/run.sh`, `os/verify/src/checks-*.ts` (non-test) and the four
  `os/build-env/*/Dockerfile` LABEL values - task IDs leave user-visible
  strings there, and nothing else in those files is touched.
- **Out**: `mosd/apid/**` (PLAN-016), every non-test file under `os/` and
  `mosd/` that M1 and M2 already treated, `os/tests/**/README.md`, `Makefile`,
  `board/**`, `docs/design/**`, `docs/plan/**`, `*.zh.md`, `.gitea/**`.
- Comment and blank-line changes only, plus the string table below.

## Acceptance

- `git diff bkd/fxykktxe...HEAD` over the area is comment/whitespace-only plus
  the tabulated string changes and the two `docs/task/` files.
- Every MUST-KEEP item that lives in this area survives; anything reworded is
  quoted before and after below.
- All gates green.

