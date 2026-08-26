# The os/verify harness

`os/verify/run.sh` is the single entry point.

    make os-verify-test                 # the whole thing
    make os-layout-lint                 # the schema lint over every shipped board
    make os-layout-lint-test            # the lint's own cases
    bash os/verify/run.sh --help
    bash os/verify/run.sh -t "arith"    # extra arguments go to `bun test`
    bash os/verify/run.sh --lint FILE   # the lint instead of the suite
    make os-verify-cx3576-v2            # verify an assembled image
    bash os/verify/run.sh --verify --board x64 --probe

It finds bun — on the host, or failing that in the container pinned as
`IMAGE_BUN_1` — installs the dev dependencies if `node_modules/` is absent,
typechecks `src/`, runs the suite, and then checks the suite actually ran.

`--lint` and `--verify` are MODES and are recognised only in first position, so
neither can be mistaken for a `bun test` filter. Both share the install, the
typecheck and the `run_bun` seam; only the last step differs, which is what
keeps ONE place deciding how bun is invoked. `--lint`'s file arguments are made
absolute before they are handed on, because `run_bun` cds into the package
first. `--verify` is the one mode that cannot take the container route — see
"The hole, measured — and then closed by a decision" below.

## The oracle is deleted — what that FREEZES, and who owns each one now

`os/verify-image-v2.sh` is gone. It was the OS image contract for the whole of
this repository's v2 life, and while it existed "the port reproduces the shell"
was a complete answer to any question about a defect in the port. **It is not an
answer any more.** Every defect below was reproduced deliberately, on that
reasoning, and the reasoning died with the file — so each one is recorded here
with what it concludes, why that is wrong, and, crucially, **whether it still
ships**.

Three outcomes, and they are not interchangeable. Nothing below was *fixed*.

| | outcome | meaning |
|---|---|---|
| **SHIPS** | the defect is in `os/verify/src/`, today | a plain defect in this package, owned by whoever reads this |
| **GONE** | the defect was in the deleted file and nowhere else | it left with its container; that is not the same as repaired |
| **RECORD** | a property of the deleted file worth keeping | evidence, not a live defect |

Every `:NNNN` below is a line number in the file **as it stood at `dabc9e8`**,
the revision these were derived from and the last one before the deletion
commit. Read it with

    git show dabc9e8:os/verify-image-v2.sh

or find the deletion itself with
`git log --diff-filter=D -- os/verify-image-v2.sh`.

**Line numbers were re-derived against that revision, not copied.** Three of the
numbers previously recorded in this document were wrong, and one of them named
the wrong construct entirely — see item 7. A citation into a deleted file cannot
be checked by eye, so it was checked before the file went.

### 1. `e2fsck -fn` exits 0 on a TRUNCATED filesystem — SHIPS

`:2342` is `if e2fsck -fn "${img}" >/dev/null 2>&1`. Both streams go to
`/dev/null` and the status alone decides, so the conclusion is
`e2fsck -fn on data is clean` about a filesystem `e2fsck` has just described as
`Either the superblock or the partition table is likely to be corrupt!` — it
prints that and exits **0**. The branch is REACHABLE by `check_ext4`'s own
extract: it takes `count=${size_mib}` MiB at the layout's offset, so an image
whose tail is short produces exactly that file.

Reproduced and asserted in `src/image.test.ts` (the `e2fsck` binding, driven
against a truncated filesystem) and `src/checks-ext4.test.ts`. The port carries
the same read, so **this is now a defect in `src/image.ts`**, not a fidelity
decision.

### 2. `debugfs -R "ls -p /"` exits 0 on a file it never opened — SHIPS

`:2359`'s pipeline ends `|| true`, which drops `Filesystem not open` from
stderr, and stdout is empty. An empty listing is the **passing** direction for
META, STATE and DATA, so the oracle concluded `factory: meta is empty at build
(nothing but lost+found)` about a partition holding no filesystem at all. The
same transcript on EPHEMERAL FAILS, which is what shows the pass is vacuous.

Asserted in `src/image.test.ts` and `src/checks-ext4.test.ts`, both directions.
**Ships in `src/image.ts`.**

### 3. `tune2fs -l … || true` — SHIPS, and the previous record of it was wrong twice

`:2312` is `info="$(tune2fs -l "${img}" 2>/dev/null || true)"`. Re-measured in
the pinned `alpine:3.21` on 2026-08-26, against a file `tune2fs` cannot open:

    tune2fs raw exit = 1
    info             = "tune2fs 1.47.1 (20-May-2024)"     <-- NOT the empty string

Two corrections to what this document said before, and both matter to anyone
writing the guard:

* **It is not the empty string.** `tune2fs` prints its VERSION BANNER on stdout
  before failing, so `info` is non-empty. A guard written as `if [ -z "$info" ]`
  — the obvious repair — would never fire.
* **It feeds three checks, not four.** `${info}` is read exactly three times:
  the label (FAIL), the UUID (FAIL), and the feature list. The fourth
  value-describing check in that function belongs to a *different* tool with the
  same `|| true` shape — `dumpe2fs -h` at `:2331`, whose empty output makes
  `fs_bytes` 0 and FAILs.

The vacuous one is the same either way: `sed -n 's/^Filesystem features://p'`
finds nothing in the banner, `grep -w orphan_file` matches nothing, and the
oracle concludes **`no orphan_file feature`** about a filesystem it never
opened. Driven, both branches, in `src/checks-ext4.test.ts`.

`ext4SuperOrNone` reproduces the shape: it returns `undefined` only for a
`tune2fs` that EXITED NON-ZERO, and an exit-0 output whose magic is not `0xEF53`
still throws. **Ships in `src/image.ts` / `src/checks-ext4.ts`.**

### 4. `getcap -r DIR` on a directory that is not there exits 0 — SHIPS

`:4283` sends `getcap`'s complaint to `/dev/null`. `getcap` exits **0** and
writes `<path> (No such file or directory)` to stderr, so the packed inventory
comes out EMPTY — and on both shipped images the SOURCE inventory is empty too,
so the comparison passes with `both EMPTY` about a root nothing read. Both trees
genuinely carry no file capabilities, which the oracle's own message says out
loud; that is what makes this survivable rather than urgent.

Asserted in `src/checks-shape.test.ts`. **Ships in `src/checks-shape.ts`.**

### 5. `:3332`'s two-line device count — SHIPS (the reproduction did not leave with the oracle)

`:3332` is

    fwenv_lines="$(grep -cE '^/dev/' "${fwenv}" 2>/dev/null || echo 0)"

On a file that EXISTS with no `^/dev/` line, `grep -c` prints `0` **and** exits
1 — so `|| echo 0` fires as well and the value is the two-line string `"0\n0"`,
which the oracle interpolates into a FAIL message, putting a raw newline in the
middle of a conclusion.

**This one was listed as vanishing with the file. It does not.** The oracle's
line is gone, but `devLineCount` in `src/checks-system.ts` returns the literal
`'0\n0'` — an exact reproduction, written so that a port quietly emitting `0`
could not agree with the oracle everywhere except the one image where the
difference is the point. That reason is now void, and what is left is a
verifier that will emit a conclusion with a newline inside it. Neither shipped
image reaches the branch — both have two device lines. **Not repaired here**
(RFCT-110 M4e is instructed not to repair behaviour), and asserted as its own
case.

### 6. `:3765` vs `:3899` disagree about an EMPTY shadow field — SHIPS, both halves

`:3765` (`factory-shadow-locked`) treats an empty password field as **locked**;
its awk is `$2 !~ /^[!*]/ && $2 != ""`. `:3899`
(`factory-shadow-accounts-locked`) treats the same field as the **worst** case
and says so: an empty field is passwordless login, `pam_unix` accepts any
password including none. The second is right; the first would PASS an image the
second FAILS.

**Also listed as vanishing, and also does not.** Both are ported, both are in
`src/checks-shadow.ts`, and after the deletion they are two checks in one
shipping verifier that contradict each other about the same field. Driven in
`src/checks-shadow.test.ts`.

### 7. A dead `else` — GONE with the file, and its recorded line was WRONG

`:2057` opens `if is_uboot_board; then` **inside** a block already guarded by
`if is_uboot_board; then` at `:2014`. Its `else` — at **`:2076`** — sets
`verity_env_ok=1` and prints `the per-slot verity environment files
(bootloader=…)`, and **no board can reach it**: a grub board takes the OUTER
`else` at `:2095` instead. Dead code wearing a live-looking message.

This document previously named that `else` as `:2091`. **`:2091` is a different
`else` entirely** — it belongs to `if [ "${verity_env_ok}" -eq 1 ]` at `:2084`
and is perfectly reachable. The inner-`if`/outer-`else` numbers were off by
three and one respectively. Corrected here from the file itself, before it went.

The port has no such branch: `boardsWhere(isUBoot)` selects the scope once,
so there is no inner re-test to have an unreachable arm. **GONE — deleted along
with its container, not fixed.**

### 8. Two cx3576 LITERALS in an otherwise board-derived script — GONE with the file

`BOARD_DIR="${BOARD_DIR:-${REPO_ROOT}/board/cx3576}"` (`:28`) and
`DTB_SRC="${BOARD_DIR}/out/kernel/rk3576-src.dtb"` (`:1758`). On the one U-Boot
board this tree ships the literal and the derivation agree, so nothing was ever
observed wrong; a SECOND U-Boot board would have been compared against
cx3576's BSP and against its own, in the same run.

The port derives both — the directory from the board's own name, the artefact
names from that board's `BOOT_SLOT_REQUIRED_FILES` — so the divergence would
have been the ORACLE's. **GONE.** `src/verify-cli.ts` also declines to default
the board at all, which is the same defect one level up: `MOS_BOARD` unset once
checked an x64 image against cx3576's eleven-partition GPT and reported 191
failures that were all the harness's.

### 9. `check_container_engine`'s early return has no register expression — SHIPS, with its consequence changed

`:1191`'s early return at `:1196`–`:1199` prints ONE conclusion on a
`WITH_CONTAINERS=0` image where a normal image prints ten, and calls the other
nine "skipped BY IDENTITY". The register cannot say "this check does not exist
on this image": an entry owning that one line reports `unfired` on both shipped
boards. So `container-engine-installed` owns BOTH sentences and the other nine
answer `skipped()`.

The INABILITY still ships, in `src/checks-engine.ts`. Its recorded consequence
does not: "nine `orphan` rows, and `orphan` forces exit 1" was a **parity**
verdict, and parity is exactly what this deletion removes. On such an image
`--verify` now prints one PASS and nine SKIP lines — which is defensible
output, and which no longer forces a non-zero exit. **The defect is smaller
than it was, and it is smaller for a reason that has nothing to do with anyone
fixing it.** No shipped board produces the shape.

### What the deletion also took, and what it did not

**`os/tests/ui-location-test.sh` is GONE.** It drove `os/verify-image-v2.sh`
against mutated fixtures and cannot outlive it; its assertions are ported and
its `make os-ui-location-test` target is removed. That is one of the "now-ported
fixture suites" RFCT-110's scope names.

**`src/parity-cli.ts` and `make os-verify-parity` are GONE.** The harness's one
input was the oracle; with the oracle deleted the target could only refuse or
pass vacuously, and a target that passes because there is nothing left to
compare is the worst available outcome. The last green run is recorded below
rather than re-runnable.

**`src/parity.ts` STAYS, and it is not dead by accident.** `CheckResult` and
`Verdict` are imported by 36 modules, and `matcherAlternatives` /
`RegisteredCheck` back the `shell:` matcher on every one of the 333 register
entries. Removing the diff would mean rewriting all of them, which is a far
larger change than the deletion this milestone authorises. `parseShellRun`,
`diffParity` and `formatReport` now have **no production caller**; they remain
driven by `src/parity.test.ts` against synthetic transcripts, which needs no
oracle. Said plainly here because unreachable code with a passing test is the
kind of thing that reads as live.

**The last parity run, which can no longer be reproduced:**

    cx3576  PASS  compared 398, diverging 0, UNCLAIMED 0 of 398
    x64     PASS  compared 312, diverging 0, UNCLAIMED 0 of 312   rc=0

and, at the same tree, the replacement verifier reproduces the oracle's own
summary line on both boards:

    x64      RESULT: PASS (290/290 checks, 22 skipped (x64/grub))      rc=0
    cx3576   RESULT: FAIL (387/395 checks, 3 skipped (cx3576/uboot))   rc=1

cx3576's eight FAILs are the BSP byte-compares whose source tree a checkout does
not carry. **The oracle failed those too, identically** — `make
os-verify-cx3576-v2` was already red on a checkout without `board/`, and it
still is. PLAN-014:220-223 puts BSP builds out of scope, and populating `board/`
would turn eight of the oracle's own FAILs into passes: that changes the
measurement rather than porting it.

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

`test/apid-api/run.sh:122` used to default to `oven/bun:1` — a **floating
major-version tag**, and the last unpinned image reference in the repository.
PLAN-014 named `test/apid-api` out of scope, so R6 recorded it in `images.env`
rather than changing it. **The user lifted that exclusion for that one line on
2026-08-26** and it now defaults to `IMAGE_BUN_1`; the amendment is recorded in
PLAN-014's Scope section, and the rest of the exclusion stands.

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

### The hole, measured — and then closed by a decision, not by this milestone

`--verify` is the one mode that **cannot** take the plain pinned bun container.
It drives docker itself: `src/tools.ts` reads the image with sgdisk, mtools,
debugfs, unsquashfs and veritysetup out of `IMAGE_ALPINE_3_21`, which on a
tool-less host is always. Inside the bun container that is docker-in-docker, and
`IMAGE_BUN_1` has no docker client:

```
$ docker run --rm oven/bun:1@sha256:5ff6… sh -c 'command -v docker || echo NO-DOCKER-CLI'
NO-DOCKER-CLI
```

— no `curl`, `wget`, `nc`, `python3` or `socat` in it either. M4e measured both
sides of the seam in that container and both failed for that one cause:
`createToolRuntime` refused with *"no docker to run the pinned ones in"*, and the
shell verifier this package replaced died at its own `:185` with exit 127,
`docker: command not found`. **Mounting the daemon socket changed neither** —
what is missing is the CLIENT. So RFCT-110's "tool-less-host container path
verified for the full verifier, not just the lint" was **not satisfied**, and it
did not close itself when the oracle was deleted: the full verifier is now the
register, and the register drives docker just as much.

Three ways to close it were reported, each costed:

| | closure | new pin | measured |
|---|---|---|---|
| a | a docker client added to the bun pin | yes | **sufficient** — the full verifier ran to completion on a tool-less host |
| b | a bun image also carrying gptfdisk/mtools/e2fsprogs/squashfs-tools/cryptsetup | yes | one image, two decisions; also breaks "the tools that read an image come from the base that wrote it" |
| c | the tool seam speaking the daemon's HTTP API over the socket from bun | **no** | available — bun in the pinned image reaches `/_ping` over `fetch(…, { unix: … })` and reads daemon 29.7.2 — but a rewrite of `tools.ts`'s process seam |

**The user chose (a) on 2026-08-26.** `IMAGE_DOCKER_CLI_28` is recorded in
`os/build-env/images.env` with what it costs, and `os/verify/Dockerfile` is the
pinned bun image plus that client — a static binary, checked, which is what lets
an alpine-built client run on a debian base. `run.sh` builds it on demand for
`--verify` only, tagged with **both** input digests so a bumped pin cannot
silently reuse the old image, and mounts the daemon socket.

Re-measured on a genuinely bun-less host, through the pinned image rather than
the bind-mount that simulated it:

    env -i PATH=/usr/bin:/bin HOME=<empty>    (no bun, no image tools; docker only)
    run.sh --verify --board x64     RESULT: PASS (290/290 checks, 22 skipped)  rc=0
    make os-verify-cx3576-v2        RESULT: FAIL (387/395 checks, 3 skipped)   rc=1

cx3576's eight FAILs are the BSP byte-compares a checkout cannot carry — correct,
and the same eight the oracle failed. **The clause is satisfied, not amended.**

**What it costs, said plainly.** Mounting `/var/run/docker.sock` into a container
is a privilege grant, and no other target in this tree takes one. Nested
containers are SIBLINGS on the host daemon rather than children — which is
exactly why the identity mounts still resolve inside them, and equally why
anything in that container can do anything the daemon can. It is confined to
`--verify`, and a host with bun never takes the route.

The suite and the lint are unaffected and deliberately unchanged: both still run
in plain `IMAGE_BUN_1` on a host with nothing but docker, neither mounts the
socket, and CI still takes that route on every push.

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
   stdout and `Filesystem not open` on stderr. `:2359`'s `|| true` drops the
   stderr, and an empty listing is the PASSING direction for META, STATE and
   DATA — so the oracle concludes `factory: meta is empty at build (nothing but
   lost+found)` about a partition that holds no filesystem at all. The SAME
   transcript on EPHEMERAL fails, which is what shows the pass is vacuous.
3. **`tune2fs -l ... || true`** (`:2312`) makes a partition it could not open
   arrive at THREE checks as `tune2fs`'s version banner — not, as this line said
   until M4e measured it, at four checks as the empty string. The fourth
   value-describing check in that function is `dumpe2fs -h`'s (`:2331`), the
   same shape in a different tool. One of the three, `orphan_file`, passes
   VACUOUSLY. Reproduced by `ext4SuperOrNone`, which returns
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

`os/verify-image-v2.sh:2057` opens `if is_uboot_board` INSIDE a block already
guarded by `if is_uboot_board` (`:2014`). Its `else` at `:2076` prints
`the per-slot verity environment files (bootloader=...)`, and **no board can
ever reach it**: a grub board takes the outer `else` at `:2095` instead. Neither
shipped board prints that line, no register entry claims it, and nothing is
unclaimed as a result.

**These three numbers were `:2054`, `:2091` and `:2096` until M4e re-derived
them from the file, and `:2091` was not merely off — it is a DIFFERENT `else`,
belonging to `if [ "${verity_env_ok}" -eq 1 ]` at `:2084`, and reachable.** See
"The oracle is deleted" above; the file is gone and the citations are now
resolvable only through `dabc9e8`.

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
`os/verify-image-v2.sh:3332` (`:3331` until M4e re-derived it) reads

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

## What M4e inherited, and what it did with each

Batch 4b was the last porting batch and the register is complete: **0 unclaimed
on both boards, 0 diverging, 0 ambiguous, 0 orphan, 0 ts-silent, 0 unfired.**
`make os-verify-parity` exited 0 — the target is gone now, and the run is quoted
in "The oracle is deleted" above rather than re-runnable. Everything M4e
inherited was about the ORACLE rather than the port, and **every item below is
now settled in that section, with SHIPS / GONE against each**. It is the
authority; this list is the index into it.

1. **Four vacuous passes and two live contradictions**: `e2fsck` on a truncated
   filesystem, `debugfs` on a file it never opened, `tune2fs`'s `|| true`,
   `getcap -r` on a directory that is not there, `:3332`'s two-line device
   count, and the `:3765`/`:3899` disagreement M4d recorded. All six SHIP —
   including the last two, which were expected to leave with the file and did
   not, because the reproductions live in `checks-system.ts` and
   `checks-shadow.ts`. None is repaired.
2. **`board/cx3576` and `rk3576-src.dtb` are literals in an otherwise
   board-derived script** (`:28`, `:1758`). GONE with the file; the port derives
   both.
3. **A dead `else` branch** at `:2076` — not `:2091`, which is a reachable one.
   GONE with the file.
4. **`check_container_engine`'s early return** has no register expression (M4f).
   The inability SHIPS; its `orphan` consequence was a parity verdict and went
   with parity.
5. The register is 333 entries across 17 modules; `board-scope.ts`,
   `boot-slots.ts` and `image-layout.ts` hold everything more than one module
   derives, so a third board in `os/boards/` is covered by whatever its own
   definition selects with no entry edited.

## The smoke runner (RFCT-113 M7b), and what was measured to build it

The runner executes every self-built artifact inside the packed root and
compares what it reports against the pin this repository records. Everything
below is a measurement taken on **2026-08-26**, against the x64 factory root
built from this tree (`localhost/mos-factory-root:x64`, `linux/amd64`,
250 209 280 bytes, sha256 `6e036711ce306cd2…`).

**THE DOCKER LAYER CACHE WAS WARM.** The stage images were already in this
host's store from earlier worktrees, so `make build-env && MOS_ARCH=amd64 make
podman && MOS_BOARD=x64 make os-rauc && MOS_BOARD=x64 bash
os/rootfs/build-v2.sh` completed in about three minutes. Nothing below depends
on that — every measurement is of the *resulting image*, not of the build — but
it is stated because M7a's `rewrite-timestamp` finding is exactly the shape of
answer a warm cache can fake.

### The twelve, and what each one actually prints

Read off the real image, one `docker run` per line. **Five of the seven
container binaries are not in `/usr/bin`** — that was found by running the wrong
path and reading `rc=127` back, not by reading the install script, because
`podman-install.sh` writes them through a `${VAR}`-assembled destination and the
literal path appears nowhere in it.

| artifact | installed path | `--version`, line 1 of **stdout** | pin |
|----------|----------------|-----------------------------------|-----|
| rauc | `/usr/bin/rauc` | `rauc 1.13` | `RAUC_VERSION=v1.13` |
| podman | `/usr/bin/podman` | `podman version 5.8.6` | `PODMAN_VERSION=v5.8.6` |
| quadlet | `/usr/libexec/podman/quadlet` | `5.8.6` | `PODMAN_VERSION` |
| crun | `/usr/bin/crun` | `crun version 1.29.1` | `CRUN_VERSION=1.29.1` |
| conmon | `/usr/libexec/podman/conmon` | `conmon version 2.2.1` | `CONMON_VERSION=v2.2.1` |
| netavark | `/usr/libexec/podman/netavark` | `netavark 2.1.0` | `NETAVARK_VERSION=v2.1.0` |
| aardvark-dns | `/usr/libexec/podman/aardvark-dns` | `aardvark-dns 2.1.0` | `AARDVARK_VERSION=v2.1.0` |
| catatonit | `/usr/libexec/podman/catatonit` | `tini version 0.2.1_catatonit` | `CATATONIT_VERSION=v0.2.1` |
| mos-mqttd | `/usr/bin/mos-mqttd` | `mos-mqttd 0.1.0` | `mosd/mqttd/Cargo.toml` |
| mos-mqtt-broker | `/usr/bin/mos-mqtt-broker` | `mos-mqtt-broker 0.1.0` | `mosd/broker/Cargo.toml` |
| mosd | `/usr/bin/mosd` | **no version; starts the daemon** | `mosd/mosd/Cargo.toml` |
| apid | `/usr/bin/apid` | **no version; never returns** | `mosd/apid/Cargo.toml` |

Ten sentences, ten shapes. That is why there is one tokeniser and not twelve
parsers: a per-artifact regex fails **open** when upstream reflows a banner —
no match yields no version, and "no version" is easy to mistake for "no
mismatch".

### `mosd` and `apid` have no `--version`, and it is worse than absence

    $ docker run --rm --network none localhost/mos-factory-root:x64 /usr/bin/mosd --version
    rc=1
    INFO mosd::provisioning: first-boot provisioning complete hostname="mos-e9967fc0"
         ssh_enabled=false seeded_generation=1
    INFO mosd: provisioning checked outcome=Seeded state_dir=/var/lib/mos
    Caused by: 0: Failed to connect to address unix:path=/var/run/dbus/system_bus_socket

    $ docker run --rm --network none localhost/mos-factory-root:x64 /usr/bin/apid --version
    rc=124   (timed out at a 25s budget — it does not terminate)
    INFO apid::tls: generated self-signed certificate cert=/var/lib/mos/apid/cert.pem
    INFO apid::tls: generated session signing key key=/var/lib/mos/apid/session.key
    INFO apid: apid serving https_addr=0.0.0.0:443 http_addr=0.0.0.0:80

Both **ignore argv entirely and start the daemon**. Three failures at once: no
version is reported, neither exits 0, and the invocation is not minimal — it
mutates. Confirmed at the source and driven from the failing side:

    grep -rn 'args()|args_os|env::args|CARGO_PKG_VERSION|clap' mosd/mosd/src/ mosd/apid/src/
        -> 0 hits, across 21 and 19 .rs files
    positive control, same trees, same command shape: 'async fn' -> 17 and 10 files
    control the other way: grep -c clap mosd/mqttd/Cargo.toml mosd/broker/Cargo.toml -> 1, 1

The search space is populated, the grep works, and the absence is real. Closing
it means editing `mosd/mosd/src/main.rs` and `mosd/apid/src/main.rs` — `mosd/`
Rust sources, excluded by PLAN-014 Scope:243 and reaffirmed at :256. **Finding
is in scope, acting is not.** They are `unclaimed`, and they are not invoked:
producing a `fail` from them would trade a clear "nobody asked" for a 25-second
hang and a mutated `/var`.

### catatonit is version-checked although Scope says exec-only

The premise Scope gives — "catatonit (static, no `--version` contract)" — is
measurably false: it exits 0 and prints `tini version 0.2.1_catatonit` (it is a
fork of tini and keeps the banner). Leaving it exec-only would make the third
acceptance clause *false for `CATATONIT_VERSION`* — a pin with no reader. The
exec-only conjunct is **discharged rather than dropped**: a version contract
asserts exit 0 exactly as an exec one does, and asserts the output on top. Scope
says it "gets an exec-only check", not "gets only an exec-only check".

### The version loop, closed and driven RED end to end

The acceptance clause is *"bumping a `versions.env` pin without rebuilding the
artifact turns the smoke run red"*. Driven against the real image, with the
binary untouched:

    # os/podman/versions.env: CRUN_VERSION=1.29.1  ->  1.29.2   (nothing rebuilt)
    $ bash os/verify/run.sh --smoke --board x64
    FAIL  crun  /usr/bin/crun  exit 0 but reports 1.29.1, and os/podman/versions.env pins
                CRUN_VERSION=1.29.2 (expected 1.29.2). Its --version line was
                "crun version 1.29.1". Either the pin was bumped without rebuilding the
                artifact, or the artifact was built from something other than the pin.
    RESULT: FAIL (9 pass, 1 fail, 2 unclaimed, of 12)          exit 1

    # reverted
    RESULT: INCOMPLETE (10 pass, 0 fail, 2 unclaimed, of 12)   exit 1

It is driven in the suite as a **loop** too, not as a comparison: one fixture
`versions.env`, one binary output held constant, one edit, and the verdict flips
`pass -> fail -> pass`. Asserting `judge` on two literals would have tested the
comparison and said nothing about whether the pin is re-read from the file it
lives in.

### The arm64 wall — measured, and there are TWO of them

RFCT-113's second acceptance clause is "the full artifact list above passes on
both boards' base roots". On this host it is satisfiable for x64 and
**unsatisfiable for cx3576**, for two independent reasons.

**Wall 1 — the cx3576 factory root cannot be built here at all**, so there is
nothing to execute in:

    $ MOS_BOARD=cx3576 bash os/update/rauc/build.sh
    rc=1
    error: the 'default' buildx builder does not offer linux/arm64 on this host …
           docker run --privileged --rm tonistiigi/binfmt --install arm64

and `board/cx3576/rootfs/` carries `alpine`, `assets`, `firmware` and **no
`modules.tar`** — the only one in the tree is `_out/x64/modules.tar`, which is
the other board. This is M7a's own finding at the next milestone: its arm64 OCI
export was of a real aarch64 tree, but **not** of the cx3576 factory root.

**Wall 2 — even given the image, this host cannot execute it.** Measured
against a pulled upstream image rather than ours, so it is a statement about the
host:

    $ mount | grep binfmt        -> (binfmt_misc not mounted)
    $ docker run --rm --platform linux/arm64 arm64v8/busybox:latest /bin/true
    rc=255   exec /bin/true: exec format error
    $ docker image inspect arm64v8/busybox:latest --format 'ARCH/OS'
    arm64/linux

The runner catches wall 2 in `preflight`, before concluding anything about any
artifact, and says so naming the platform and the remedy — because without that
control all twelve come back `fail` and twelve failures about twelve binaries
are twelve wrong diagnoses of one condition. The refusal is reachable from the
suite **without an arm64 image**, driven with exactly the status and text above.

The cx3576 half is **not executed and therefore not verified**. What is
board-independent was driven: the register, the pins, both coverage directions,
every verdict, every refusal, and `--board cx3576` itself, which refuses naming
the build command. The cx3576 numbers are owed by a host with binfmt and the BSP
drop, not by a code change.

## Driven from the failing side — the smoke runner's own mutation sweep

`pinCoverageFaults() == []` and `RESULT: PASS` are both invariant under a check
that cannot fail, so the implementation was mutated and each mutation confirmed
to turn the suite red. Eleven of them:

| mutation | effect |
|----------|--------|
| `versionTokens` loses its LEFT guard | 1 fail — `11.29.1` would satisfy a pin of `1.29.1` |
| `unclaimed` folded into `pass` in `conclude` | 2 fails |
| the count vacuity guard disabled | 3 fails |
| the 127/126 diagnosis collapsed into one message | 2 fails |
| an unclaimed artifact gets invoked after all | 4 fails |
| the REVERSE coverage direction removed | 3 fails |
| the empty-pin-file guard removed | 1 fail |
| the forward direction swallows an unreadable pin | 1 fail |
| the Cargo `[package]` table scoping removed | 2 fails |
| the empty-pin refusal removed | 1 fail |
| the `v`-prefix strip becomes a blanket replace | 1 fail |

The helper that applies them **refuses a no-op match** and was observed refusing
two, so "the mutation changed nothing and the suite stayed green" is not a
result this sweep can produce.

### And one bug the sweep found, which review had not

`versionTokens` originally carried a right-hand guard `(?![.0-9])`, written to
stop `1.29.10` satisfying a pin of `1.29.1`. **Removing it changed no test** —
greed already gives that property, since after `[0-9]+(?:\.[0-9]+)+` has
matched, the next character cannot be a digit. What it *did* change was a
trailing dot: on `crun version 1.29.1.` the guard rejects the greedy match,
backtracking finds nothing shorter that satisfies it either, and the line yields
**no token at all** — reported as "reports NO version at all" and turned RED for
a binary that printed exactly the right version and ended its sentence with a
full stop. A guard that cannot fire on the case it was written for, and can fire
on a case nobody considered, is worse than no guard. It is gone; the case is
locked in; the left guard, which is load-bearing, stays.

### The refusals, each driven red with its control beside it

| refusal | driven by | control |
|---------|-----------|---------|
| no image | `readFactoryRoot` against an empty directory | a directory with both files is read |
| record present, archive absent | record written alone | as above |
| register vs pins disagree | the `crun` entry dropped | with it, the same counter moves |
| a feature stage declined | `# declined: containers` written into the real `rootfs-stages.txt` | the unmutated manifest runs |
| host cannot execute the image | fabricated `rc=255 exec format error` | `rc=0` is accepted |
| a manifest with no `# declined:` line | the line deleted | the parenthesised "none" form reads as `[]` |

The register-vs-pins case asserts that **nothing was executed** — the fake `Exec`
counts its calls and the count is 0 — rather than only that an error was thrown.
