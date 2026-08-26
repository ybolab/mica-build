# RFCT-114 PLAN-015 M1: function-oriented comments in os/, Makefile and board/

- **status**: in-progress
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-26 14:30
- **claimedAt**: 2026-08-26 14:30
- **plan**: PLAN-015 (M1)

Apply PLAN-015's triage rule to `os/` (excluding `os/tests/` and every
`*.test.ts`, which M3 owns), the top-level `Makefile`, and `board/`: delete the
C1-C4 classes outright, rewrite the C5-C7 survivors into short present-tense
statements, and leave every MUST-KEEP item standing.

## Scope

- **In**: `Makefile`, `board/**`, `os/**` except `os/tests/**` and `*.test.ts`.
- **Out**: `os/**/README.md` and `os/**/HARNESS.md` (M5), `mosd/`, `test/`,
  `update/`, `extensions/`, `talos/`, `docs/design/`, `docs/plan/`.
- Comment and blank-line changes only. No executable line changes at all.

## Acceptance

- `git diff main...HEAD` over the area is comment/whitespace-only plus the two
  `docs/task/` files.
- Every MUST-KEEP item that lives in this area survives; anything reworded is
  quoted before and after below.
- All gates green.

## Files treated

(filled in as the sweep proceeds)

## MUST-KEEP items, verified

(filled in as the sweep proceeds)

## Gate results

(filled in at close)
