# RFCT-109 PLAN-014 M3: the bun+TS foundation, proven on the board-definition lint

- **status**: in progress
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-25 10:50
- **claimedAt**: 2026-08-25 20:00
- **plan**: PLAN-014 (M3)

Bootstrap `os/verify/` as a bun+TypeScript package in the `test/apid-api`
shape (bun.lock, tsconfig, `run.sh` entry) and prove the toolchain end to
end by porting the smallest real check: the board-definition schema lint
(`layout/lint.sh` + `lint-test.sh`, post-M1 `boards/` paths).

## Scope

- `os/verify/` package skeleton; typed model for `board.env` (plain
  KEY=value parse — never `source`).
- Port the lint and its negative test; retire the shell pair.
- The tool-less-host fallback: a pinned-bun container path replacing the
  Alpine tool container for TS-based verification (digest recorded in
  `os/build-env/images.env`).
- Makefile + CI wiring (`os-layout-lint`, `os-layout-lint-test` keep their
  names or gain successors registered in the Makefile help).

## Acceptance

- The ported lint rejects a deliberately broken board definition
  (lint-test's fixtures) and accepts both real boards.
- A host without bun still runs the lint via the pinned container.
- `bun test` (or the repo-defined runner entry) is the single entry point.

## Dependencies

- After RFCT-107; the container pin lands in RFCT-108's `images.env` (can
  proceed in parallel with a temporary local pin if M2 is unfinished).
