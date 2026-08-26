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
each returns 1. **The `108/108` in this table is M3's measurement, not the
suite's current size**: M4a took it to 214, and the number is kept as the record
of that run rather than silently updated — a count in prose is a count nobody
re-runs, which is why the CI step name no longer carries one.

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

The route is announced, as bun's is, and the announce line is the only thing
that says which tools produced a verdict:

    os/verify: image tools in alpine:3.21@sha256:48b0309c… (no sgdisk, mdir, mcopy, mlabel, unsquashfs, veritysetup on this host)

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

### Driven from the failing side

| driven | what it did |
|---|---|
| `MOS_VERIFY_TOOLS=hsot` | refused, before the ~30 s oracle run — the route is decided once, up front |
| `MOS_VERIFY_TOOLS=host` on this tool-less host | refused, naming `sgdisk, mdir, mcopy, mlabel, unsquashfs, veritysetup` |
| `IMAGE_ALPINE_3_21` = a well-formed digest naming no image | refused **by the key**, at the pull, before any tool ran |
| `IMAGE_ALPINE_3_21` = a tag | `from.sh`'s refusal, naming the key and the file |
| no image tools **and** no docker | refused, naming both and `IMAGE_ALPINE_3_21` |
| `--work` under `/tmp` | refused, naming the sentinel and the mount |
| no bun on the host, `--parity` | refused — see below. The suite on the same host, re-run at the final commit: **214/214** in the pinned bun container, exit 0 |
| `--board x86` | `'x86' is not a board this tree ships … os/boards/ holds cx3576, x64` |
| `--image` with two boards | refused; one image cannot be both boards' |
| `--image` naming a file that is not there | refused |
| `--board` with no value | refused; an option taking the next flag as its value verifies something nobody asked for |
| `--parity` in a non-first position | refused, as `--lint` is |
| M4b: a real cx3576 image with `sgdisk -c 9:stat` and BOOT-B's FAT label set to `BOOT` | the oracle went `RESULT FAIL (392/394, 3 skipped)`, the two FAIL lines were both CLAIMED (`not-ported … FAIL 0`), and the port answered FAIL to both: `agree 84, diverge 0` |

`extractRange` is TypeScript rather than `dd`, and the substitution was
measured rather than argued: against ROOTFS-A of the real cx3576 image both
produce `sha256:565af2a3…142b777`.

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

## Where the matcher runs out, measured

`ShellMatcher` identifies a conclusion by a **substring** of the oracle's line,
and M4b found two conclusions that have no substring which is both unique and
board-independent. Counted against both boards' real output rather than argued:

| conclusion | candidate | cx3576 | x64 |
|---|---|---|---|
| `exactly ${EXPECT_PARTS} partitions` | ` partitions` | 3 | 3 |
| | `exactly ` | 13 | 8 |
| `${slot} contains ${f}` | ` contains ` | 12 — four of them `contains no …` | 6 |

For the first, the only token left is the partition COUNT, which is the literal
`os/verify-image-v2.sh:1408` deliberately stopped writing down. For the second,
the four extra lines on cx3576 belong to U-Boot-only checks that are M4d's, so
whichever batch registers ` contains ` first makes the other's lines
`ambiguous` — the collision is symmetric and cannot be resolved by ordering.

Both are separable by an ANCHOR: `^exactly \d+ partitions$` and
`^BOOT-[AB] contains \S+$`. Adding a regex alternative to `ShellMatcher` is a
change to the instrument, so M4b measured it and left it, the way M4a left the
"beyond the oracle" flag. Until then the two families stay `not-ported` — which
is the state this harness exists to describe rather than round off.

**The second of the two is resolved, and it needed no instrument change.** M4d
registers ONE `one` check per (board, slot, required file), generated at module
load from each board's `BOOT_SLOT_REQUIRED_FILES` with `@SLOT@` substituted the
way `os/verify-image-v2.sh:1838` substitutes it. The matcher is then
`BOOT-A contains Image` — one line, on one board — and the four
`contains no …` conclusions are separate checks with their own prose. A regex
would have worked; a longer substring works too, and it does not widen what a
matcher may be. The FIRST is still open: the only token left really is the
partition count.

### What M4d did change, and why

Two widenings, both to `ShellMatcher`, both forced by a shape the register
could not otherwise express:

* **`pass` became OPTIONAL.** Several families print N conclusions on the board
  that has the hardware and ONE `skip` on the board that does not — five
  firmware paths against one `the board radio-firmware set (…)`. A shell line
  can have exactly one owner, so that skip needs a register entry of its own,
  and such an entry genuinely has no PASS line on any board it applies to.
  `assertRegisterWellFormed` gained the other half: a check registering **no**
  matcher at all is refused, because it would report `unfired` forever and read
  exactly like a matcher that had gone stale.
* **`fail` may be a LIST.** The oracle's PASS branches say one thing; its FAIL
  branches FORK. `check_status_led`'s three failure sentences, and the
  reconciler-ordering check's three, share no substring that is not also in
  some other check's line — `mos-status-led.service ` is in the overlay
  family's failures too. One loose matcher covering all three is how a check
  claims a neighbour's conclusion; three exact ones cannot. Each element is
  still a plain substring, and the claim is still "exactly one registered check
  matches this line": a list widens what ONE check answers for, never what two
  may share.

### Where the matcher still runs out

One shape remains unexpressible and is recorded rather than worked around: a
matcher list makes a check able to claim several DIFFERENT sentences, but every
sentence must still be a contiguous substring. A failure branch whose only
commonality with its siblings is a word that also appears in a neighbouring
check's line cannot be claimed at all without making that neighbour
`ambiguous`. M4d hit this once, in the shadow family, and resolved it with a
three-element list rather than a looser matcher.

## The parity harness, and why it is not a count

`src/parity.ts` diffs `os/verify-image-v2.sh`'s conclusions against the check
register's, **per check**. The register was empty at M4a; M4b filled in batch 1
and M4c–M4d fill the rest.

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

## What batch 4b claimed, and what is left — the M4g measurement

Measured 2026-08-26 against both boards' real images, at batch 4b's tip. `make
os-verify-parity` reports **zero** diverging, ambiguous, orphaned, ts-silent or
unfired rows on either board.

|  | cx3576 | x64 |
|---|---|---|
| oracle conclusions | 398 | 312 |
| compared, and agreeing | **398** | **312** |
| **UNCLAIMED** | **0** | **0** |

M4f left 74 and 50 in thirteen families, every one of them reading image BYTES.
Batch 4b ported all of them, in four modules and 75 register entries:

| family | cx3576 | x64 | module |
|---|---|---|---|
| the four ext4 storage tiers | 25 | 25 | `checks-ext4.ts` |
| boot slot: the status-LED device tree | 12 | 2 (2s) | `checks-bootchain.ts` |
| dm-verity and the kernel cmdline | 8 | 8 | `checks-cmdline.ts` |
| boot.scr: the compiled boot script | 7 | 2 (2s) | `checks-bootchain.ts` |
| boot slot: the BSP artifact byte-compare | 6 | 0 | `checks-bootchain.ts` |
| the ESP and the GRUB boot chain | 2 (2s) | 5 | `checks-cmdline.ts` |
| the U-Boot verity env pair | 3 | 0 | `checks-bootchain.ts` |
| factory: the zero-filled regions | 3 | 1 (1s) | `checks-bootchain.ts` |
| the raw pre-GPT U-Boot blob | 2 | 1 (1s) | `checks-bootchain.ts` |
| RAUC's `rauc.slot=` on the boot path | 2 | 2 | `checks-cmdline.ts` |
| file capabilities | 2 | 2 | `checks-shape.ts` |
| GPT: the partition count | 1 | 1 | `checks-shape.ts` |
| image-shape: the `-latest` symlink | 1 | 1 | `checks-shape.ts` |
| | **74** | **50** | |

### The three tool bindings, and what each does on a malformed input

Driven against malformed inputs in the pinned alpine:3.21 before they were
written, as M4a's five were. They are in `src/image.ts` and `--probe` drives all
three against a real image.

| tool | driven with | what it did |
|---|---|---|
| `fdtget` | 64 MiB of zeros | `Error at '/leds/status-red': FDT_ERR_BADMAGIC` on **stderr**, exit 1, EMPTY stdout — where sgdisk, given the same file, invents a disk GUID and exits 0 |
| | an empty file | the same |
| | a path that is not there | `Couldn't open blob from '...': No such file or directory`, exit 1 |
| | a node or property that is not in the tree | `FDT_ERR_NOTFOUND`, exit 1 |
| | **`-t x` on a STRING property** | **exit 0**, printing the string's BYTES as cells — `73 74 61 74 75 73 2d 72 65 64 0` for `status-red` |
| | `-t x` vs the default radix | `6b 1d 1` against `107 29 1`: `-t x` is hexadecimal and the default is DECIMAL |
| `e2fsck -fn` | zeros, an empty file, a squashfs, a directory, a missing file | exit **8** each time, naming the superblock |
| | errors left uncorrected | exit 4 |
| | **a TRUNCATED filesystem** | **exit 0** — after printing "The filesystem size (according to the superblock) is 8192 blocks / The physical size of the device is 4096 blocks / Either the superblock or the partition table is likely to be corrupt!" |
| the uImage header | a file that is not there, or shorter than four bytes | `''` rather than a throw, because `od -An -tx1 -N4 2>/dev/null \| tr -d` is what the oracle compares |
| | a file shorter than 64 bytes | `undefined`, not a struct of zeros — `imageType` 0 means "invalid", not "absent" |

`fdtget` is the first tool in this package that refuses honestly on every input
it cannot read. The `-t x` row is the exception and it is REPRODUCED rather than
refused: a `gpios` property that had become a string hands
`os/verify-image-v2.sh:1942` the third BYTE of that string as the GPIO flags
cell, and a helper that threw would turn a check the oracle FAILS into a run
that died.

`getcap` was measured in the same session and is not a new binding: it exits
**0** on a path that is not there and puts `<path> (No such file or directory)`
on stderr.

### Four vacuous passes in the code under test, reproduced and asserted

None is repaired. A port that hardened its oracle would diverge from it and the
divergence would be the port's; each is asserted as its own case, so removing
the reproduction has to remove the record of it too.

1. **`e2fsck -fn` exits 0 on a truncated filesystem.** `:2342` is
   `if e2fsck -fn "${img}" >/dev/null 2>&1`, so both streams are discarded and
   the status alone decides — and the conclusion is `e2fsck -fn on data is
   clean` about a filesystem e2fsck has just called likely corrupt. The branch
   is REACHABLE: `check_ext4` extracts `count=${size_mib}` MiB at the layout's
   offset, so an image whose tail is short produces exactly that file.
2. **`debugfs -R "ls -p /"` exits 0 on a file it never opened**, with empty
   stdout and `Filesystem not open` on stderr. `:2358`'s `|| true` drops the
   stderr, and an empty listing is the PASSING direction for META, STATE and
   DATA — so the oracle concludes `factory: meta is empty at build (nothing but
   lost+found)` about a partition that holds no filesystem at all. The SAME
   transcript on EPHEMERAL fails, which is what shows the pass is vacuous.
3. **`tune2fs -l ... || true`** makes a partition it could not open arrive at
   four checks as the empty string — four FAILs describing values rather than
   one refusal naming the tool. Reproduced by `ext4SuperOrNone`, which returns
   `undefined` only for a tune2fs that EXITED NON-ZERO; an exit-0 output whose
   magic is not `0xEF53` still throws.
4. **`getcap -r DIR` on a directory that is not there exits 0** and puts its
   complaint on stderr, which `:4283` discards. The packed inventory then comes
   out EMPTY — and on both shipped images the source inventory is empty too, so
   the comparison passes about a root nothing read. Both trees genuinely carry
   no file capabilities, which the oracle's own message says out loud.

### `exactly ${EXPECT_PARTS} partitions` — claimed, and how

M4b measured that no shared substring works and that has not changed:
` partitions` claims three conclusions on each board, `exactly ` claims thirteen
and eight, and the only token left is the COUNT, which `:1408` deliberately
stopped writing down. M4f's ELF entries solved the identical problem: **one
entry per board, generated from that board's own declaration.** `exactly 11
partitions` and `exactly 9 partitions` come from `LAYOUT_PARTITIONS`' own length
— the same list the oracle counts — so a board that changes its layout changes
both sides at once, and a third board in `os/boards/` gets its own entry with no
register entry edited.

### The BSP byte-compare, and the decision it needed

`board/cx3576/out/` is NOT POPULATED in a checkout, so cx3576's ORACLE run is
`RESULT FAIL (387/395)`: eight conclusions read `... compare source not found:
/board/out/...` and `u-boot is 0 bytes`.

**The port EXPRESSES that absence rather than populating the tree.**
PLAN-014:220-223 puts `board/` BSP builds outside this campaign, and populating
it would turn eight of the oracle's own FAILs into passes — changing the
measurement rather than porting it. So the port reads the same paths and fails
with the same sentence when the source is not there, and BOTH directions have
fixtures, so the byte-compare's passing side is driven even though no shipped
tree takes it. Parity is unaffected either way: the two sides agree on all eight.

### Two cx3576 literals in the oracle, recorded rather than copied

`BOARD_DIR="${BOARD_DIR:-${REPO_ROOT}/board/cx3576}"` (`:28`) and
`DTB_SRC="${BOARD_DIR}/out/kernel/rk3576-src.dtb"` (`:1758`) are board names
written into a script that is otherwise entirely board-derived. On the one
U-Boot board this tree ships the two agree, so the port derives both — the
directory from the board's own name (with `BOARD_DIR` still honoured, because
the oracle's container re-exec supplies it), the artefact names from that
board's own `BOOT_SLOT_REQUIRED_FILES`. A SECOND U-Boot board would be compared
against its own BSP here and against cx3576's there. That divergence would be
the oracle's, and it is recorded for M4e rather than reproduced.

### One dead branch in the oracle

`os/verify-image-v2.sh:2054` opens `if is_uboot_board` INSIDE a block already
guarded by `if is_uboot_board` (`:2014`). Its `else` at `:2091` prints
`the per-slot verity environment files (bootloader=...)`, and **no board can
ever reach it**: a grub board takes the outer `else` at `:2096` instead. Neither
shipped board prints that line, no register entry claims it, and nothing is
unclaimed as a result. Recorded for M4e.

### The status-LED contract is TRANSCRIBED, and its scope is derived

`status-red:on:1:active-low` and `status-blue:off:0:active-high` (`:1922`) have
nowhere board-side to be derived from: `os/boards/cx3576/board.env` declares
`BOARD_HAS_STATUS_LED=1` and nothing about polarity. The same three facts per
LED are asserted in three places in this tree — the oracle, the dts the kernel
build compiles, and `board/cx3576/kernel/Dockerfile:134-139` — and the last two
are `board/` BSP files PLAN-014:220-223 puts outside this campaign, so reading
them would be a dependency on a tree this port must not require. The SCOPE is
derived (`boardsWhere(hasLed)`), and the device tree's own file name comes from
that board's `BOOT_SLOT_REQUIRED_FILES`.

## What batch 4a claimed, and the two shapes it could not express

M4f ported all 88 group-A conclusions on cx3576 and all 69 on x64, in six
modules: `checks-dbus.ts`, `checks-engine.ts`, `checks-home.ts`,
`checks-connd.ts`, `checks-system.ts` and `script-commands.ts`. Two things it
had to write down rather than work around:

**`check_container_engine`'s early return cannot be expressed.** On a
WITH_CONTAINERS=0 image it prints ONE conclusion where a normal image prints
ten, and the oracle's own words for the other nine are "skipped BY IDENTITY".
The register has no way to say "this check does not exist on this image": an
entry owning that one line would report `unfired` on both shipped boards, and
the nine suppressed checks have no shell line to be compared against whatever
they answer. So `container-engine-installed` owns BOTH sentences and the other
nine answer `skipped()`; on such an image the run would report nine `orphan`
rows. Neither shipped board produces that shape.

**One defect in the code under test, reproduced and asserted rather than fixed.**
`os/verify-image-v2.sh:3331` reads

    fwenv_lines="$(grep -cE '^/dev/' "${fwenv}" 2>/dev/null || echo 0)"

and on a file that EXISTS with no `^/dev/` line, `grep -c` prints `0` **and**
exits 1 — so the `|| echo 0` fires as well and the value is the two-line string
`"0\n0"`, which the oracle interpolates into a FAIL message. The second half of
that message is a stdout line with no PASS/FAIL/SKIP prefix, so
`parseShellRun`'s self-consistency guard would refuse the whole run. Neither
shipped image reaches it (both have two device lines), and the port reproduces
it exactly: a port that emitted `0` would agree with the oracle on every image
where the branch is not taken and diverge on the one image where the difference
is the point. It is a decision for whoever owns the oracle, beside the
`:3765`/`:3899` disagreement M4d recorded.

## What the suite covers

| file | what it proves |
|------|----------------|
| `src/board-env.test.ts` | every shape a real `board.env` contains, and every refusal — each with a positive control beside it, so a parser that rejected everything would not satisfy it |
| `src/board.test.ts` | the model against **both** shipped boards: cx3576's 11 partitions, raw loader, redundant U-Boot environment, radios and hwinit confs; x64's 9, no loader, GRUB with no attempt counters, and the lists it declares **empty on purpose**. Plus a real board definition with a `$(...)` injected, which must be refused by name |
| `src/lint.test.ts` | the board-definition schema lint: lint-test.sh's fourteen cases ported, eleven empty-declaration cases it never had, three that are not data, both shipped layouts accepted — and the positive control that x64's three deliberately empty lists are still a statement rather than a fault |
| `src/paths.test.ts` | the ascents, at the count used and at the counts on either side |
| `src/checks-board.test.ts` | batch 3's board-conditional families, each driven three ways — green on the board with the hardware, RED on a mutation of it, and SKIPPED on the board that declares it absent. Includes the first run ever made of `check_status_led`'s `BOARD_HAS_STATUS_LED=0` branch in its FAILING direction |
| `src/checks-mqtt.test.ts` | the MQTT bridge and broker: present, startable, and INERT — plus the D-Bus policy read with its attributes wrapped across lines and a rule commented out, which is how the oracle first mis-read the real file |
| `src/checks-shadow.test.ts` | the transient-password contract end to end, and the recorded disagreement between the oracle's two locked-field checks about an EMPTY password field |
| `src/image.test.ts` | every tool, driven against a malformed input first: sgdisk inventing a GPT, debugfs opening nothing at exit 0, unsquashfs extracting nothing at exit 0, veritysetup using one status for an answer and a failure, `fdtget -t x` reading a string as cells, `e2fsck -fn` exiting 0 on a truncated filesystem, mcopy exiting 0 having written nothing |
| `src/checks-ext4.test.ts` | the four storage tiers, and the three vacuous passes their tools produce -- each asserted as its own case, with the SAME transcript failing on the tier where the direction is inverted |
| `src/checks-bootchain.test.ts` | the U-Boot chain, including the BSP byte-compare's PASSING direction, which no shipped tree reaches; and a `mutate()` helper that refuses an edit which changed nothing |
| `src/checks-cmdline.test.ts` | one set of conclusions over TWO readers -- a U-Boot verity env and a GRUB command line composed from grub.cfg and the slot's own fragment -- with nearly every case run against both |
| `src/checks-shape.test.ts` | the partition count as a per-board derivation, and the capability pair including the environment probe that keeps it from passing for the wrong reason |

A model exercised only on fixtures its author wrote is a model of its author's
expectations. Anything that passes on cx3576 alone is half tested.

## What M4e inherits

Batch 4b is the last porting batch and the register is complete: **0 unclaimed
on both boards, 0 diverging, 0 ambiguous, 0 orphan, 0 ts-silent, 0 unfired.**
`make os-verify-parity` exits 0. What M4e still has to decide, all of it about
the ORACLE rather than the port:

1. **Four vacuous passes and two live contradictions**, listed above and in
   "What batch 4a claimed" below: `e2fsck` on a truncated filesystem, `debugfs`
   on a file it never opened, `tune2fs`'s `|| true`, `getcap -r` on a directory
   that is not there, `:3331`'s two-line device count, and the `:3765`/`:3899`
   disagreement M4d recorded. Every one is reproduced and asserted; none is
   repaired, because a port that hardened its oracle would diverge from it.
2. **`board/cx3576` and `rk3576-src.dtb` are literals in an otherwise
   board-derived script** (`:28`, `:1758`). A second U-Boot board would be
   compared against cx3576's BSP.
3. **A dead `else` branch** at `:2091`, unreachable from either board.
4. **`check_container_engine`'s early return** has no register expression (M4f).
5. The register is 333 entries across 17 modules; `board-scope.ts`,
   `boot-slots.ts` and `image-layout.ts` hold everything more than one module
   derives, so a third board in `os/boards/` is covered by whatever its own
   definition selects with no entry edited.
