# The os/verify harness

`os/verify/run.sh` is the single entry point.

    make os-verify-test                 # the whole thing
    make os-layout-lint                 # the schema lint over every shipped board
    make os-layout-lint-test            # the lint's own cases
    bash os/verify/run.sh --help
    bash os/verify/run.sh -t "arith"    # extra arguments go to `bun test`
    bash os/verify/run.sh --lint FILE   # the lint instead of the suite

It finds bun, installs the dev dependencies if `node_modules/` is absent,
typechecks `src/`, runs the suite, and then checks the suite actually ran.

`--lint` is a MODE and is recognised only in first position, so it can never be
mistaken for a `bun test` filter. It shares the install, the typecheck and the
`run_bun` seam; only the last step differs, which is what keeps ONE place
deciding how bun is invoked. Its file arguments are made absolute before they
are handed on, because `run_bun` cds into the package first.

## Zero tests is a failure, and bun does not agree

Measured with bun 1.4.0 on 2026-08-25:

| situation | `bun test` exit status |
|-----------|------------------------|
| no test **file** matches the glob | 1 |
| a file matches and declares **no tests** | **0** — "Ran 0 tests across 1 file" |

The second row is the failure shape this tree keeps finding in its own
checkers. The shell lint this package replaced recorded its own version of it:
the linter printed `FAIL` lines and then reported `RESULT: PASS (0/0 checks)`,
because its counters lived in a subshell that discarded them. It was green
while being wrong.

So `run.sh` reads the count out of the run — the `Ran N tests` line — and turns
`N = 0` red with an exit status and a sentence. It also refuses a run that
exits 0 without printing that line at all, because the exit status alone cannot
tell a green suite from one that never executed.

The count pattern accepts `Ran 1 test` as well as `Ran 66 tests`. A pattern
that insisted on the plural would read a single-test filter as vacuous and fail
it; that was a real defect here, caught by running the failing side.

## Driven from the failing side

Every guard in `run.sh` was run against the condition it exists to catch, and
each returns 1:

| driven | what it printed |
|--------|-----------------|
| bash present, no bun on `PATH`, no `~/.bun` | the container command to run instead |
| a copy whose `REPO_ROOT` has no `Makefile` | the computed `HERE` and `REPO_ROOT`, and that one of them is stale |
| a suite whose only test file declares no tests | the vacuity refusal above |
| a suite with one deliberately red test | `RESULT: FAIL (bun test exited 1; 0 passed of 1 run)` |

The path anchors are checked the same way in `src/paths.test.ts`: each ascent
is asserted at the count it uses **and at the counts on either side**, and the
neighbours must fail. An anchor satisfied by more than one answer is not an
anchor — and PLAN-014 has moved most of `os/` once already, with M5 and M6
still to come.

## The seam for a host without bun

Exactly one function decides how bun is invoked:

```sh
run_bun() {
    ( cd "${HERE}" && "${BUN}" "$@" )
}
```

Every caller passes an argv and reads an exit status. RFCT-109's remaining half
replaces that body with a `docker run … "${BUN_IMAGE}" bun "$@"`, with the
digest recorded in `os/build-env/images.env` — nothing outside `run_bun` needs
to change for it.

`MOS_VERIFY_BUN` names a bun binary explicitly; otherwise `PATH` is searched,
then `~/.bun/bin/bun`. With none of the three, the run **refuses and prints the
container command**, rather than dying as `bun: command not found`.

Note for whoever wires the container: `test/apid-api/run.sh:122` uses
`BUN_IMAGE="${MOS_APID_BUN_IMAGE:-oven/bun:1}"` — a **floating tag**, which is
what RFCT-109 wants replaced on the mos side by a recorded pin. `os/verify` has
no such default: there is one variable, `MOS_VERIFY_BUN`, and it names a
binary, so adding an image pin adds a name rather than overriding one.

## Re-checking the parser against the shell

The parser was verified against `bash` sourcing the same board definitions, key
for key. That check is **deliberately not in the suite** — it would mean
`source`-ing a board definition to test the thing whose entire purpose is not
to, and pointed at an untrusted file it would execute it.

Run it by hand when `src/board-env.ts` changes. From the repository root:

```sh
cat > /tmp/dump.ts <<'EOF'
// Imported dynamically and by absolute path: this file lives in /tmp, so a
// relative specifier would resolve against /tmp rather than the repository.
const { parseBoardEnv } = await import(`${process.cwd()}/os/verify/src/board-env.ts`)
const { readFileSync } = await import('node:fs')
const path = process.argv[2]!
for (const [k, v] of parseBoardEnv(readFileSync(path, 'utf8'), path).values)
  console.log(`${k}=${v}`)
EOF

for b in cx3576 x64; do
  P="$PWD/os/boards/$b/board.env"
  bun run /tmp/dump.ts "$P" > "/tmp/ts-$b.txt"
  cut -d= -f1 "/tmp/ts-$b.txt" > "/tmp/keys-$b.txt"
  n=$(wc -l < "/tmp/keys-$b.txt")
  [ "$n" -gt 50 ] || { echo "refusing: only $n keys from $b"; continue; }
  bash -c 'set -euo pipefail; . "$1"
           while read -r k; do printf "%s=%s\n" "$k" "${!k}"; done < "$2"' \
      _ "$P" "/tmp/keys-$b.txt" > "/tmp/sh-$b.txt"
  diff -u "/tmp/sh-$b.txt" "/tmp/ts-$b.txt" && echo "$b: agrees on all $n keys"
done
```

The `[ "$n" -gt 50 ]` guard is not decoration: the first run of this comparison
was made from the wrong directory, both dumps were empty, and it reported that
the parser agreed with the shell **on all 0 keys**. A comparison of two empty
files is the same green as a comparison that passed.

Current result: cx3576 **141/141**, x64 **115/115**.

## The parity check against the shell lint, and why it cannot be re-run

`src/lint.ts` replaced `os/verify/lint.sh`, and before the shell pair was
deleted the two were run over the **same 30 mutated copies** of the real
layouts: lint-test.sh's fourteen cases, eleven empty-declaration spellings,
three that are not data at all, and both boards unmutated. Result, 2026-08-25:

| | cases |
|---|---|
| both reject | 24 |
| both accept | 2 (`cx3576`, `x64`, unmutated) |
| **shell accepted, port rejects** | **4** |
| shell rejected, port accepts | 0 |

The four are `forbidden-role-key-empty`, `boot-attempts-on-grub-empty`,
`partition-set-whitespace` and `command-substitution` — every divergence in one
direction, each a measured hole in the `${NAME:-}` idiom or in `source`ing a
file rather than reading it. They are in `src/lint.test.ts`, marked
`shellPassed: true`, and a test asserts that set by name: removing the
strictness that closes one would have to remove the record of it too.

**This check is not repeatable from the working tree**, because one of its two
sides has been deleted — which is the point of having run it first. To redo it,
check out the shell pair from before the retirement and run both over the same
copies:

```sh
git show d33e929:os/verify/lint.sh > /tmp/old-lint.sh   # the last commit that had it
W=$(mktemp -d)
cp os/boards/x64/board.env "$W/candidate.env"
printf 'ROOTFS_A_FS_UUID=""\n' >> "$W/candidate.env"
bash /tmp/old-lint.sh "$W/candidate.env";        echo "shell rc=$?"
bash os/verify/run.sh --lint "$W/candidate.env"; echo "port  rc=$?"
```

A verdict table alone is not enough, and the messages were compared too. Where
both reject, four of the port's sentences are deliberately different — see
"where it is stricter" in `README.md`.

## What the suite covers

| file | what it proves |
|------|----------------|
| `src/board-env.test.ts` | every shape a real `board.env` contains, and every refusal — each with a positive control beside it, so a parser that rejected everything would not satisfy it |
| `src/board.test.ts` | the model against **both** shipped boards: cx3576's 11 partitions, raw loader, redundant U-Boot environment, radios and hwinit confs; x64's 9, no loader, GRUB with no attempt counters, and the lists it declares **empty on purpose**. Plus a real board definition with a `$(...)` injected, which must be refused by name |
| `src/lint.test.ts` | the board-definition schema lint: lint-test.sh's fourteen cases ported, eleven empty-declaration cases it never had, three that are not data, both shipped layouts accepted — and the positive control that x64's three deliberately empty lists are still a statement rather than a fault |
| `src/paths.test.ts` | the ascents, at the count used and at the counts on either side |

A model exercised only on fixtures its author wrote is a model of its author's
expectations. Anything that passes on cx3576 alone is half tested.
