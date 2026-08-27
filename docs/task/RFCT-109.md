# RFCT-109 PLAN-014 M3: the bun+TS foundation, proven on the board-definition lint

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-25 10:50
- **claimedAt**: 2026-08-25 20:00
- **completedAt**: 2026-08-25 21:28
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

## M3c — the tool-less host, and M3 closed (landed)

The third of three parts, and the gate. `os/verify/run.sh` grows a second route
inside `run_bun` — the bun pinned as `IMAGE_BUN_1` in `os/build-env/images.env`
— and CI is wired to take it. RFCT-109's third acceptance clause was the only
one outstanding; it is met, and M3 is **completed**.

Since M3b this clause is a **regression-closer rather than a nicety**.
`os-layout-lint` used to run on bare bash; the port made it bun-dependent, along
with `os-verify-test` and `os-layout-lint-test`. Before M3c a host with only
docker could not check a board definition at all.

### The seam took a second route, not a second entry point

```sh
run_bun() {
    if [ "${ROUTE}" = container ]; then
        docker run --rm "${MOUNTS[@]}" -w "${HERE}" "${BUN_IMAGE}" bun "$@"
    else
        ( cd "${HERE}" && "${BUN}" "$@" )
    fi
}
```

Both callers — `run_bun run src/lint-cli.ts` and `run_bun test` — are unchanged,
as is the install. The route is chosen once and **announced on the first line**,
because a run that cannot say which bun produced it is a run whose pin is
decorative.

| condition | route |
|---|---|
| `MOS_VERIFY_BUN` | that binary |
| `MOS_VERIFY_CONTAINER=1` | the pinned container, even where a host bun exists |
| both | **refused** — two different buns |
| `bun` on `PATH`, else `~/.bun/bin/bun` | that binary |
| neither | the pinned container |
| neither, and no docker | **refused**, naming both |

`IMAGE_BUN_1` is consumed through `os/build-env/from.sh --ref` — the one
resolver. Nothing here re-pins it or re-validates it, and its comment, which
said nothing read the key yet, now says what does.

### The mount is an identity mount, and that is the whole of the path problem

`-v "${REPO_ROOT}:${REPO_ROOT}"`, not `/w` (x64's assembler) or `/work`
(cx3576's). Those containers **run a script** and construct their paths inside.
This one is a **tool handed paths from outside**: `--lint` absolutises its file
arguments against the caller's cwd before `run_bun` sees them, and `paths.ts`
resolves the shipped boards by climbing from `import.meta.dir`. Both produce
*host* absolute paths, which under a `/w` mount name nothing inside the
container.

The alternative was a prefix rewrite — a second path arithmetic, on the one
input whose identity the verdict is about, and the exact mechanism by which a
container could lint a *different file* and report a green about it. An identity
mount has no rewrite to get wrong: the same bytes answer to the same name on
both routes. `os/tests/mkimage-v2-selftest.sh:292` and
`mkimage-x64-selftest.sh:220` mount `${WORK}` at `${WORK}` for their tool
containers and state the reason in the same terms — "so every file argument
resolves identically". A board file outside the repository gets its directory
mounted at its own path too, read-only.

### The no-bun demonstration

A stock system `PATH` under `env -i`, with a `HOME` that has no `.bun`. This
host keeps bun at `/srv/bkd/runtime/bun` and `/root/.bun/bin/bun`; neither
`/usr/bin` nor `/bin` contains one, so the environment genuinely cannot find
bun — `command -v bun` fails and `bun --version` is "command not found".

```
env -i PATH=/usr/bin:/bin HOME=<no .bun> make os-layout-lint       26/26   rc=0
env -i PATH=/usr/bin:/bin HOME=<no .bun> make os-layout-lint-test  42/42   rc=0
env -i PATH=/usr/bin:/bin HOME=<no .bun> make os-verify-test     108/108   rc=0
```

Each announced `1.4.0 in oven/bun:1@sha256:5ff6… (no bun on this host)`. Also
run with `node_modules/` moved aside, so `bun install --frozen-lockfile` ran
**inside the container** too: install, typecheck, 108/108, rc=0.

### The two routes agree, on ten cases

Both shipped boards (each alone and together), four negative fixtures built from
the real x64 layout, a copy outside the repository, and a mixed in-repo /
out-of-repo run. Every one: **identical exit status, identical stdout,
identical stderr.**

The streams were compared **separately**, and that is not pedantry. Compared as
one interleaved capture, two of the ten appear to differ — docker delivers
stderr ahead of stdout where a native process writing to a single redirected
file does not. The lines are the same lines in a different order, and a
comparison that had stopped at the interleaved diff would have reported a
divergence that does not exist.

### Driven from the failing side

| driven | result |
|---|---|
| `IMAGE_BUN_1` = well-formed digest naming no image | refused **by the key**, before any run |
| `IMAGE_BUN_1` = a tag | `from.sh`'s refusal, naming key and file |
| `IMAGE_BUN_1` removed | `from.sh`'s refusal, naming key and file |
| board file under `/tmp`, container route | refused, naming the path **and the empty mount** |
| no bun **and** no docker | refused, naming bun, `MOS_VERIFY_BUN` and `IMAGE_BUN_1` |
| `MOS_VERIFY_BUN` + `MOS_VERIFY_CONTAINER` | refused as contradictory |
| CI precondition step, on a host that has bun | red — the route would not have been taken |
| CI suite step, forced onto a host bun | **108/108 and rc=1** — passed on the wrong bun |

All `images.env` mutations were reverted and `git diff` is clean.

The wrong-digest case is the one the seam has to catch itself. `from.sh`
validates the *shape* of a reference, not that a registry has it; left to
`docker run`, a bad digest arrives as exit 125, which at this seam is
indistinguishable from bun exiting 125. So the image is obtained once, up front,
where the failure can still be attributed to the key that carries it.

### What the visibility guard actually buys — measured, not assumed

A bind mount of `/tmp` on this host **succeeds and delivers an empty directory**.
So every path a run depends on is asserted visible inside the container first.

The first draft of that guard's comment claimed it was what stood between an
empty mount and a green run. Driven with the refusal disabled, **that is false**
and the comment was corrected before it shipped: all three ways in fail and all
three exit 1 — the lint's `existsSync` says `<path> not found`, `bun test` over
a vanished package says `No tests found!` (exit 1, not the 0 it gives a file
declaring no tests), and `bun run src/lint-cli.ts` says `Module not found`.

What it buys is the **cause**. Each of those sentences describes a missing file,
and on this route the file is exactly where the caller said it was — it is the
mount that is empty. That is the same defect M3b recorded in `lint.sh`, which
said "declares no X" about a file containing `X=""`. Worth 260 ms; not worth a
false claim.

### CI: the decision is that CI installs no bun

Which bun CI installs *is* the pin decision. It installs none. The runner has no
bun of its own, so `run.sh` takes the container route and runs the digest —
the same bun a developer without one gets, on every push. Installing one instead
meant either a floating `curl bun.sh/install`, the loosest kind of reference R6
spent a sweep removing, or a second pin in a second place free to disagree with
the first. This way the tool-less-host path is not a claim tested once by hand:
it is the path CI takes, so it goes red the day it stops working.

A **separate `os-verify` job**, not a step in `offline-suites`, whose first
sentence is that its suites need neither root nor docker. This one needs docker,
and a scope statement that quietly stopped being true would cost more than a job.

Two preconditions, because a green tick has to be about the route it claims. A
runner that *had* bun would pass the suite on that bun and never touch the pin,
so that is asserted before the suite; and because the exit status proves the
tests ran but not which bun ran them, the announce line is grepped for the
reference `from.sh` resolves. Both were driven: forced onto a host bun the suite
still reports 108/108 and the step exits 1.

**The bun precondition was too strict on its first draft**, and driving it is
what found that. It tested `[ -e "$HOME/.bun" ]`, where `run.sh` tests for an
executable at `$HOME/.bun/bin/bun`; `bun install` creates `$HOME/.bun/install/
cache` as a side effect even when the binary lives elsewhere, so the looser test
rejects a runner that is genuinely bun-less. A precondition stricter than the
rule it guards fails honest runs. Fixed to test exactly what `run.sh` tests.

**Coverage, stated honestly.** This is an increase, not a like-for-like
replacement: neither `os-layout-lint` nor `os-layout-lint-test` ran in CI
before, so the board-definition schema is checked on push for the first time,
and since M3b the lint's 42 cases ride along inside `os-verify-test`.
`os-shell-pipefail-lint` is still **not** wired — it needs neither bun nor
docker, and is named in the job summary rather than left to be rediscovered.

**Not executed here.** The workflow itself was not run — there is no runner in
this environment. What was run is each step's script, verbatim from the YAML,
in the environment it targets: the precondition passes on a bun-less host and
fails on this one, and the suite step passes bun-less and fails when forced onto
a host bun. Whether the Gitea `ubuntu-latest` runner provides a usable docker is
the one thing that could not be checked from here; if it does not, the job fails
loudly on its first step naming what is missing, rather than skipping.

### The floor

```
make docs-verify              375/375
make docs-verify-test         8/8
make os-shell-pipefail-lint   34/34
make os-layout-lint           26/26
make os-layout-lint-test      42/42
make os-verify-test           108/108
make os-mkimage-v2-test       166 PASS
make os-mkimage-x64-test      PASS=196
make build-env                12 Dockerfile(s) agree
```

`shellcheck` (koalaman/shellcheck:stable) is clean on the rewritten `run.sh`.

### The parity table was not re-derived

One of its two sides is deleted, so it cannot be re-run from the working tree,
and reading it is not checking it. The recipe from `d33e929` is in
`os/verify/HARNESS.md`. M3c did not resurrect the shell pair to compare against.

### Nothing was amended

No acceptance clause turned out unsatisfiable, and this gate amended no part of
its own task record. Two defects found in code under test — the CI precondition
and the visibility-guard comment — were in code this change itself introduced,
and were fixed here rather than recorded, which is the opposite case to M3b's
findings in `lint.sh`.

<!-- dated-record: a measurement record frozen at its commit; its citations name the tree as it was then (pre-PLAN-019 layout, pre-rewrite design documents); exempt from docs/verify-citations.sh (RFCT-172) -->
