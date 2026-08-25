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

### A hole in the shell lint, measured 2026-08-25

The typed model's declared-vs-absent distinction is not academic. `lint.sh`'s
forbidden-key check is `eval "val=\${${name}_${key}:-}"` followed by
`[ -z "${val}" ] && continue`, so an empty declaration is indistinguishable
from an absent one. On a copy of the real x64 layout:

```
ROOTFS_A_FS_UUID=00000000-0000-4000-8000-000000000000  -> rc=1, rejected
ROOTFS_A_FS_UUID=""                                    -> RESULT: PASS (1/1 checks), rc=0
```

The same forbidden key, on the same forbidden role, passes when declared empty.
`lint-test.sh`'s `forbidden-role-key` case only ever appends a non-empty value,
so nothing has been looking. The required direction is wrong in a smaller way:
`ESP_FAT_VOLUME_ID=""` fails as *"declares no ESP_FAT_VOLUME_ID"* — it does
declare it, as empty, and the message sends a reader to the wrong edit.

**Consequence for M3b's parity gate.** The ported lint can close this, because
`Partition.declared(suffix)` answers presence without consulting the value. It
will therefore be **stricter than the shell on this axis, deliberately**, and a
verdict-for-verdict parity requirement against the shell lint would be
unsatisfiable because of it. The empty-declaration case belongs in the negative
fixtures rather than in the parity baseline.

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

## M3b — the ported lint, and the shell pair retired (landed)

The second of three parts. `os/verify/src/lint.ts` + `src/lint.test.ts` replace
`os/verify/lint.sh` + `lint-test.sh`, which are **deleted**. `os-layout-lint`
and `os-layout-lint-test` **keep their names** and both now go through
`run.sh`, so there is still exactly one place deciding how bun is invoked.

M3 stays **in progress**: M3c owns the tool-less-host container path and the CI
wiring, and closes the task.

### The parity check, run before the oracle was deleted

Thirty mutated copies of the real layouts through both lints — lint-test.sh's
fourteen cases, eleven empty-declaration spellings, three that are not data at
all, and both boards unmutated:

| | cases |
|---|---|
| both reject | 24 |
| both accept | 2 (`cx3576`, `x64`, unmutated) |
| **shell accepted, port rejects** | **4** |
| shell rejected, port accepts | 0 |

Every divergence is in one direction. The recipe to redo the comparison from
`d33e929` — the last commit that still had `lint.sh` — is in
`os/verify/HARNESS.md`, because one of its two sides no longer exists in the
working tree.

### The four divergences, each a measured hole

| mutation of a real layout | `lint.sh` | `src/lint.ts` |
|---|---|---|
| `ROOTFS_A_FS_UUID=""` on a `verity-slot` | **PASS** | reject |
| `BOOT_ATTEMPTS_DEFAULT=""` on the grub board | **PASS** | reject |
| `LAYOUT_PARTITIONS=" "` | **PASS**, "0 partitions, numbered 1..0" | reject |
| `MOS_ARCH=$(uname -m)` | **PASS** — the shell *ran* it | reject |

The first two are one hole seen twice, and the second is the check this linter
was written for. The third emitted a `PASS` line, so the vacuity guard was
satisfied by a board that declared no partitions at all. A fifth, closed one
layer down by the parser rather than here: a board declaring **no** `MOS_ARCH`
passed `lint.sh` when the caller exported `MOS_ARCH`, because `source` reads the
process environment.

**Strictness that is not indiscriminate.** An empty declaration the schema does
not forbid stays a statement: `BOARD_RADIOS=""` means this board has none, and
x64 keeps passing with all three of its empty lists. A test exists solely to
hold that line — mutation M5 below shows that a port failing every empty
declaration would reject the board it exists to accept.

**Messages diverge where verdicts do not.** `lint.sh` said "declares no
ESP_FAT_VOLUME_ID" about a file containing `ESP_FAT_VOLUME_ID=""`; absent and
empty get different sentences now. A non-numeric `STATE_PARTNUM=seven` was
reported only as the downstream "partition number 7 is absent", naming a
partition that is declared correctly; it is now named at its own key. An
unresolvable reference was reported as "made no assertions at all", naming
neither key nor line; the parser names both.

### Defects found in the retired script, recorded rather than fixed

- **`lint.sh:211` made its own read-to-the-end check dead code.** `lint_one`'s
  body is `( … ) || true`, so the function always returned 0 and the
  `if ! lint_one` branch at :232 — with its "could not be read to the end"
  message — never ran. Measured: a layout that dies while being sourced is
  caught only by the per-file counter at :236, which says "made no assertions
  at all" instead. Both are in the port, and the parser refusal now names the
  key and the line, so the message that never printed is not needed.
- **A missing role cascaded into a spurious numbering failure.** `STATE_ROLE=""`
  produced two FAIL lines from `lint.sh`: the role, and "these numbers are
  absent: 7" — because the `continue` past the role also skipped that
  partition's number. The port reports one.

### Proved able to go red — eleven mutations

Each turns exactly one check off and is restored; `git diff` clean after.

```
baseline                                              42 pass   0 fail
M1  forbidden keys test the value, not presence       40 pass   2 fail
M2  grub stops forbidding boot attempts               40 pass   2 fail
M3  empty is treated as absent again (the shell's)    31 pass  11 fail
M4  the partition set is judged by its string         41 pass   1 fail
M5  EVERY empty declaration becomes a fault           38 pass   4 fail
M6  the three-units check compares MiB to MiB         41 pass   1 fail
M7  numbering stops looking for gaps                  41 pass   1 fail
M8  an unknown role is accepted                       41 pass   1 fail
M9  the per-file vacuity guard is removed             41 pass   1 fail
M10 a duplicate partition number is not noticed       41 pass   1 fail
M11 a parser refusal becomes a pass                   39 pass   3 fail
restored                                              42 pass   0 fail
```

**M9 was green on its first run**, and that is the one worth recording: the
guard was unreachable, because `lintBoard` always contributes at least one
check. It is now extracted as `requireAssertions`, tested directly as the
backstop it is, and the invariant it backstops — every file produces at least
one check, however degenerate — is asserted over five degenerate inputs.

### Makefile: the names are kept

RFCT-109's Scope allows keeping `os-layout-lint` / `os-layout-lint-test` or
registering successors. Keeping them is the smaller change: they are what
`help:` lists, what both `board.env` files cite and what a person types, and
what moved is the implementation, not the question. `os-layout-lint` runs
`run.sh --lint`; `os-layout-lint-test` runs `run.sh src/lint.test.ts`, which is
`os-verify-test` filtered to the lint's own cases and still passes through
run.sh's `Ran N tests` vacuity guard.

`--lint` is a MODE, recognised only in first position so it can never be
mistaken for a `bun test` filter. It shares the install, the typecheck and the
`run_bun` seam — M3c's container path still has exactly one body to replace.

### Counts after M3b

```
make os-layout-lint          RESULT: PASS (26/26 checks)   was 2/2
make os-layout-lint-test     RESULT: PASS (42/42 tests)    was 17/17
make os-verify-test          RESULT: PASS (108/108 tests)  was 66/66
make os-shell-pipefail-lint  RESULT: PASS (34/34 files)    was 36/36, minus the two deleted
```
