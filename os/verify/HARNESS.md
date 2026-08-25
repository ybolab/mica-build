# The os/verify harness

`os/verify/run.sh` is the single entry point.

    make os-verify-test                 # the whole thing
    make os-layout-lint                 # the schema lint over every shipped board
    make os-layout-lint-test            # the lint's own cases
    bash os/verify/run.sh --help
    bash os/verify/run.sh -t "arith"    # extra arguments go to `bun test`
    bash os/verify/run.sh --lint FILE   # the lint instead of the suite
    make os-verify-parity               # the image-contract parity harness
    bash os/verify/run.sh --parity --board x64 --probe

It finds bun — on the host, or failing that in the container pinned as
`IMAGE_BUN_1` — installs the dev dependencies if `node_modules/` is absent,
typechecks `src/`, runs the suite, and then checks the suite actually ran.

`--lint` and `--parity` are MODES and are recognised only in first position, so
neither can be mistaken for a `bun test` filter. Both share the install, the
typecheck and the `run_bun` seam; only the last step differs, which is what
keeps ONE place deciding how bun is invoked. `--lint`'s file arguments are made
absolute before they are handed on, because `run_bun` cds into the package
first. `--parity` is the one mode that cannot take the container route — see
"The hole, measured rather than assumed" below.

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
| bash present, no bun on `PATH`, no `~/.bun` | runs the pinned container — `26/26`, `42/42`, `108/108`, from a stock `PATH=/usr/bin:/bin` under `env -i` |
| the same, and no docker either | refuses, naming bun, `MOS_VERIFY_BUN` and `IMAGE_BUN_1` |
| `IMAGE_BUN_1` set to a well-formed digest naming no image | refuses by the key, before any run — `docker run` would have returned 125, which is indistinguishable from bun exiting 125 |
| `IMAGE_BUN_1` set to a tag, or removed | `from.sh`'s own refusal, naming the key and the file |
| `MOS_VERIFY_BUN` and `MOS_VERIFY_CONTAINER` both set | refused; they are two different buns |
| `--lint` on a board file under `/tmp`, container route | refuses, naming the path and the empty mount rather than the file |
| a copy whose `REPO_ROOT` has no `Makefile` | the computed `HERE` and `REPO_ROOT`, and that one of them is stale |
| a suite whose only test file declares no tests | the vacuity refusal above |
| a suite with one deliberately red test | `RESULT: FAIL (bun test exited 1; 0 passed of 1 run)` |
| `--lint` on a file that is not there | `error: <abs path> not found`, and the path is the one it actually looked at |
| `--lint` on a relative path, from three different cwds | the same verdict each time -- the absolutising works |
| `--lint` in a NON-first position | refused. It used to be forwarded to `bun test`, which ignores the unknown flag and reports a green suite in answer to a request for the lint |

The path anchors are checked the same way in `src/paths.test.ts`: each ascent
is asserted at the count it uses **and at the counts on either side**, and the
neighbours must fail. An anchor satisfied by more than one answer is not an
anchor — and PLAN-014 has moved most of `os/` once already, with M5 and M6
still to come.

## The seam for a host without bun

Exactly one function decides how bun is invoked, and it has two routes:

```sh
run_bun() {
    if [ "${ROUTE}" = container ]; then
        docker run --rm "${MOUNTS[@]}" -w "${HERE}" "${BUN_IMAGE}" bun "$@"
    else
        ( cd "${HERE}" && "${BUN}" "$@" )
    fi
}
```

Every caller passes an argv and reads an exit status, and none can tell which
route answered. The image is `IMAGE_BUN_1` in `os/build-env/images.env`,
resolved through `os/build-env/from.sh --ref` — the one resolver; nothing here
re-pins or re-validates it.

The route is chosen once and **announced on the first line of output**, so a run
is never ambiguous about which bun produced it:

    os/verify: 1.4.0 at /srv/bkd/runtime/bun
    os/verify: 1.4.0 in oven/bun:1@sha256:5ff6… (no bun on this host)

| condition | route |
|---|---|
| `MOS_VERIFY_BUN` set | that binary |
| `MOS_VERIFY_CONTAINER=1` | the pinned container, even where a host bun exists |
| both set | **refused** — they are two different buns |
| `bun` on `PATH`, else `~/.bun/bin/bun` | that binary |
| none of the above | the pinned container |
| none of the above, and no docker | **refused**, naming both |

### Why the repository is mounted at its own path

`-v "${REPO_ROOT}:${REPO_ROOT}"`, not `/w` or `/work` like the two image
assemblers. Those containers **run a script** and build their paths inside; this
one is a **tool handed paths from outside**. `--lint`'s file arguments are
absolutised against the caller's cwd before `run_bun` sees them, and `paths.ts`
resolves the shipped boards by climbing from `import.meta.dir` — both produce
*host* absolute paths. Under a `/w` mount they would name nothing inside the
container, and the fix would be a prefix rewrite: a second path arithmetic, on
the one input whose identity the verdict is about.

An identity mount has no rewrite to get wrong. `os/tests/mkimage-v2-selftest.sh`
and `mkimage-x64-selftest.sh` mount `${WORK}` at `${WORK}` for their tool
containers for this reason, and say so in the same terms.

A board file **outside** the repository gets its directory mounted at its own
path too, read-only.

### The mount that succeeds and carries nothing

On this host a bind mount of anything under `/tmp` propagates as an **empty
directory** rather than failing. So every path a run depends on is asserted
visible *inside the container* before any of them is used — one extra container,
~260 ms, which also carries the version.

That guard buys the **cause, not the verdict**, and the difference was measured
rather than assumed. With the refusal disabled, all three ways in still fail and
all three exit 1: the lint's own `existsSync` says `<path> not found`, `bun test`
over a vanished package says `No tests found!` (exit 1 — not the 0 it gives a
file that declares no tests), and `bun run src/lint-cli.ts` says `Module not
found`. Nothing reports a false green. But each of those sentences describes a
*missing file*, and on this route the file is exactly where the caller said it
was — it is the mount that is empty. Sending a reader to look for a path they
can `cat` is the same defect `lint.sh` had when it said "declares no X" about a
file containing `X=""`.

### The two routes agree

Ten cases, each run both ways, comparing **stdout and stderr separately** and
the exit status: both shipped boards, each alone and together, four negative
fixtures, a copy outside the repository, and a mixed in-repo/out-of-repo run.
All ten identical.

Compared as a single interleaved stream they appear to differ, and that is an
artefact worth knowing: docker delivers stderr ahead of stdout where a native
process writing to one redirected file does not. The lines are the same lines.

### Where the container pin is exercised

`.gitea/workflows/check.yml`'s `os-verify` job installs **no bun**, so the
runner takes this route on every push. The job asserts that it did — it greps
the announce line for the reference `from.sh` resolves — because the suite's
exit status proves the tests ran, not which bun ran them. Forced onto a host bun
the suite still reports 108/108 and the step exits 1.

`test/apid-api/run.sh:122` still uses `BUN_IMAGE="${MOS_APID_BUN_IMAGE:-oven/bun:1}"`
— a **floating tag**. PLAN-014 names `test/apid-api` out of scope, so it is
recorded in `images.env` beside the pin rather than changed here.

## The image tools: a second seam, with the same shape and one hole

`src/tools.ts` decides where `sgdisk`, `mtools`, `tune2fs`/`debugfs`,
`unsquashfs` and `veritysetup` come from, exactly as `run_bun` decides where bun
comes from: two routes, one function, a caller that passes an argv and reads a
status and cannot tell which answered.

| condition | route |
|---|---|
| `MOS_VERIFY_TOOLS=host` | this host — **refused**, naming them, if any are missing |
| `MOS_VERIFY_TOOLS=container` | the pinned `IMAGE_ALPINE_3_21`, even where the host has them |
| every tool on `PATH` | this host |
| any tool missing | the pinned container |
| any tool missing, and no docker | **refused**, naming both |

The container is created **once** per run and each call is a `docker exec` into
it. `docker run` costs ~200 ms and `apk add` costs seconds; the shell verifier
pays both once because it re-execs its whole self inside, and a port that made
one container per tool call would pay them per call — M4b–M4d will make
hundreds. The image is obtained up front for the reason `run_bun` obtains the
bun image up front: a well-formed digest naming no image arrives as `docker run`
exit 125, which is indistinguishable at the seam from the tool exiting 125.

Mounts are **identity mounts**, and every path the run depends on is asserted
visible *inside* the container before any tool runs — same reasoning, same
words, as the bun seam above, and the same `/tmp` quirk behind it.

### The hole, measured rather than assumed

`--parity` is the one mode that **cannot** take the pinned bun container, and
`run.sh` refuses it there by name. The harness drives docker itself — to re-run
`os/verify-image-v2.sh`, which re-execs into alpine on a tool-less host, and to
read the image with the tools above. Inside the bun container that is
docker-in-docker, and the pinned bun image has no docker client:

```
$ docker run --rm oven/bun:1@sha256:5ff6… sh -c 'command -v docker || echo NO-DOCKER-CLI'
NO-DOCKER-CLI
```

— no `curl` in it either, so the daemon socket cannot be reached by hand. So a
host with **neither** bun **nor** the image tools cannot yet run the full
verifier, and RFCT-110's "tool-less-host container path verified for the full
verifier, not just the lint" is **not satisfied by M4a**. Closing it is a
decision M4a does not own: a bun image that also carries the
gptfdisk/mtools/e2fsprogs/squashfs-tools/cryptsetup set (one image, two
decisions), a docker client added to the bun pin, or the harness speaking the
daemon's HTTP API over the socket from bun. Whichever it is, it is a new pin in
`os/build-env/images.env`.

The suite and the lint are unaffected: both still run in the pinned bun
container on a host with nothing but docker, and CI still takes that route.

## The parity harness, and why it is not a count

`src/parity.ts` diffs `os/verify-image-v2.sh`'s conclusions against the check
register's, **per check**. The register is empty at M4a; M4b–M4d fill it.

The oracle prints `PASS: <prose>`, `FAIL: <prose>`, `SKIP: <prose>` and a final
`RESULT:` line, and nothing else — measured on both boards' real images: every
one of 398 and 312 stdout lines is one of those. The prose is not an identifier,
so identity is **assigned**, by a matcher carried on each ported check. That is
`os/tests/ui-location-test.sh`'s `ASSERTIONS` table at a larger scale, and it is
a field on the check rather than a table beside it so that the two cannot drift.

Three guards make the comparison mean something:

| guard | the failure it catches |
|---|---|
| the parsed PASS/FAIL/SKIP counts must equal the oracle's **own** `PASS_N`/`FAIL_N`/`SKIP_N` | a parser that missed conclusions reports agreement about the part it read |
| a run with no conclusions at all is an error | M3a's oracle reported agreement "on all 0 keys" — diff of two empty files is green |
| `not-ported` is a first-class outcome and forces `INCOMPLETE` | "0 divergences" about a comparison that compared nothing is the most misleading true sentence available |

A check that fires per instance (eleven `p<n> PARTLABEL is …` conclusions from
one call site) is compared as a **set of (id, instance) pairs**, never as a
count: R4 measured one defect as 465, 467, 562 and 925 differing bytes purely
from the clock gap between runs, so anything compared here is compared as
identity.

### It has been driven red

`src/parity.test.ts` produces every outcome the harness can report, including
the ones a healthy run never sees — an ambiguous register, an orphaned result, a
check that fired on neither side, and two firings whose **count** matches while
their identities do not.

And end to end, against the real images. A temporary register of five checks —
one that agrees, one that answers FAIL where the oracle says PASS, one that
answers where the oracle SKIPs, one `many` check that answers only its first
firing, and one claiming a line nothing prints — was run on both boards and
then reverted (`git diff` clean). Every outcome was named by id:

| | cx3576 | x64 |
|---|---|---|
| `agree` | 2 | 2 |
| `diverge` | 2 — `gpt-partition-count` PASS/FAIL, `esp-skip-cx` **SKIP/PASS** | 2 — `gpt-partition-count` PASS/FAIL, `loader-skip-x64` **SKIP/FAIL** |
| `ts-silent` | 10 — `gpt-partlabel[2]` … `[11]` | 8 — `gpt-partlabel[2]` … `[9]` |
| `orphan` | 1 — `ghost-check` | 1 — `ghost-check` |
| `ambiguous` | 2 | 1 |
| `not-ported` | 382 | 299 |
| exit | **1** (FAIL, not 2) | **1** |

The `ambiguous` rows were not planned. The temporary check registered
`partitions` as its matcher, which is a substring of three other conclusions on
cx3576 and two on x64, and the harness refused to attribute any of them —
naming the line numbers it found (`4 and 77`, `4 and 261`). A matcher too loose
to identify one check is the first mistake M4b can make, and it is caught by the
instrument rather than by a reviewer.

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
