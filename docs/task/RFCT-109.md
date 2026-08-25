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

## M3a — the package skeleton and the typed board model (landed)

M3 is being taken in three parts. This is the first: `os/verify/` becomes a
bun+TypeScript package and `board.env` becomes data. **The shell lint is
untouched** — `make os-layout-lint` (2/2) and `make os-layout-lint-test`
(17/17) are green on this tree, because M3b retires them and a milestone that
deleted its predecessor before its successor existed would have no oracle to
compare against.

### The package, in the `test/apid-api` shape

```
os/verify/package.json  tsconfig.json  bun.lock  .gitignore  run.sh
os/verify/README.md     HARNESS.md
os/verify/src/board-env.ts   the parser
os/verify/src/board.ts       the typed model
os/verify/src/paths.ts       where the package sits, anchored rather than counted
os/verify/src/*.test.ts      66 tests
```

`tsconfig.json` is `test/apid-api`'s, unchanged: `strict`,
`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noEmit`. `make
os-verify-test` runs `bash os/verify/run.sh`, registered in the Makefile help
beside the two lint targets.

### Never `source`, and what that costs

The board definitions are not plain `KEY=value`. Between them the shipped files
use bare values, double- and single-quoted values, `${NAME}` references,
interpolation mixed with literal text, and `$((A * B / C))` integer arithmetic
— cx3576 has 5 expansions, x64 has 8. So the parser implements the **dialect**
and refuses everything outside it by name: command substitution in both
spellings, every parameter-expansion operator, the shell special parameters, a
reference the file does not define, unquoted whitespace, metacharacters, globs,
line continuations, unterminated quotes, command prefixes, DOS line endings,
and anything in `$(( ))` that is not integer arithmetic. Every refusal names
the file, line, column and the offending line.

**Refusing `${X:-}` is deliberate and is the substantive gain.** It is how
every shell consumer reads these files, and it is precisely what makes a shell
reader unable to distinguish *declared empty* from *not declared*. x64 declares
`BOARD_FIRMWARE_FILES=""` and `BOARD_HWINIT_CONFS=""` on purpose. The model
keeps the two apart: declared-empty is `[]`, absent is `undefined`.

Arithmetic evaluates in BigInt. These are byte offsets; past 2⁵³ a double is no
longer exact.

### Verified against the oracle it replaces

`bash` sourcing each board definition, compared key for key against the parser:

| board | keys | result |
|-------|------|--------|
| cx3576 | 141 | identical on all 141 |
| x64 | 115 | identical on all 115 |

That comparison found a real bug on its first run: precedence climbing threw on
the lower-precedence operator instead of returning, so every `$((A * B / C))`
in the x64 layout was refused. It is **not** shipped as a test — it would mean
sourcing a board definition to check the thing whose purpose is not to. The
recipe to re-run it is in `os/verify/HARNESS.md`.

### The line between the parser and the lint

The **parser throws**: a file it cannot read faithfully is not a board
definition. The **model does not**: a definition it can read and disagrees with
is what a lint exists to report, and a model that threw on the first fault
could only ever report one. Numeric keys whose values are not numbers become
`Board.faults`. M3b's ported lint is a consumer of the model, and owns every
schema message.

### Zero tests is a failure, and bun does not agree

Measured, bun 1.4.0, 2026-08-25: `bun test` exits **1** when no test file
matches its glob, but exits **0** when a file matches and declares no tests —
`Ran 0 tests across 1 file`, green. That is the shape of the failure
`os/verify/lint.sh`'s own header records about its counters. `run.sh` reads the
`Ran N tests` count out of the run and turns zero red.

### For M3b and M3c

- **The bun seam is one function.** `run_bun()` in `run.sh`; every caller
  passes an argv and reads an exit status. Replacing its body with a
  `docker run … "${BUN_IMAGE}" bun "$@"` is the whole container path.
- **There is no floating tag to override.** `os/verify` has one variable,
  `MOS_VERIFY_BUN`, naming a *binary*. Adding an image pin from
  `os/build-env/images.env` adds a name rather than overriding one — unlike
  `test/apid-api/run.sh:122`, whose `BUN_IMAGE="${MOS_APID_BUN_IMAGE:-oven/bun:1}"`
  is the floating default this task wants replaced on the mos side.
- **CI is not wired, deliberately.** `.gitea/workflows/check.yml`'s
  `offline-suites` job runs `docs-verify`, `os-health-test`, `os-shadow-test`
  and `os-ui-location-test`; its runner has no bun. Which bun CI installs *is*
  the pin decision, so the step belongs with M3c rather than ahead of it.
  Worth knowing: **`os-layout-lint` and `os-layout-lint-test` are not in CI
  today either** — nor is `os-shell-pipefail-lint` — so wiring `os-verify-test`
  is a coverage increase, not a like-for-like replacement.
- `os-shell-pipefail-lint` moves from 35/35 to **36/36**: `os/verify/run.sh` is
  the 36th file, and it is scanned and clean. `shellcheck` (koalaman/shellcheck
  :stable) reports nothing on it.
