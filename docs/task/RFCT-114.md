# RFCT-114 PLAN-015 M1: function-oriented comments in os/, Makefile and board/

- **status**: completed
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-26 14:30
- **claimedAt**: 2026-08-26 14:30
- **completedAt**: 2026-08-26 16:20
- **plan**: PLAN-015 (M1)

Apply PLAN-015's triage rule to `os/` (excluding `os/tests/` and every
`*.test.ts`, which M3 owns), the top-level `Makefile`, and `board/`: delete the
C1-C4 classes outright, rewrite the C5-C7 survivors into short present-tense
statements, and leave every MUST-KEEP item standing.

## Scope

- **In**: `Makefile`, `board/**`, `os/**` except `os/tests/**` and `*.test.ts`.
- **Out**: `os/**/README.md` and `os/**/HARNESS.md` (M5), `mosd/`, `test/`,
  `update/`, `extensions/`, `talos/`, `docs/design/`, `docs/plan/`.
- Comment and blank-line changes only. No executable line changes.

## Acceptance

- `git diff main...HEAD` over the area is comment/whitespace-only plus the two
  `docs/task/` files.
- Every MUST-KEEP item that lives in this area survives; anything reworded is
  quoted before and after below.
- All gates green.

## What changed, in numbers

115 files, **+1,536 / -2,421** lines: a net reduction of 885 comment lines over
the area, in 21 commits.

## Files treated

**The ten worst files PLAN-015 names, in the order it names them** — each
rewritten rather than swept:

| file | before | after |
|---|---|---|
| `os/build-env/images.env` | 538 lines, 484 comment | 287 lines |
| `Makefile` | 449 | 327 |
| `os/rootfs/stages/40-board.Dockerfile` | 253 | 168 |
| `os/rootfs/stages/31-feature-containers.Dockerfile` | 232 | 172 |
| `os/verify/src/smoke-register.ts` | 475 | 425 |
| `os/verify/src/smoke.ts` | 984 | 951 |
| `os/podman/versions.env` | 77 | 58 |
| `os/update/rauc/versions.env` | 36 | 28 |
| `os/verify/run.sh` | 601 | 554 |
| `os/rootfs/stages/10-base.Dockerfile` | 269 | 253 |

**The rest of the area**, grep-driven per the plan's list (`RFCT-`, `PLAN-`,
`WAS HERE`, `used to`, `no longer`, `previously`, `═══`):

- `os/rootfs/stages/` — all nine stage Dockerfiles.
- `os/rootfs/` — `build-v2.sh`, `scripts/{firmware,hwinit,mosd,podman}-install.sh`,
  `overlay-v2/` (containers.conf, storage.conf, registries.conf, fw_env.config.in,
  mos-var.conf, four systemd units, mos-health, mos-seed-state, mos-seed-var,
  mos-shadow-reconcile).
- `os/build-env/` — `images.env`, `build.sh`, `from.sh`, the four Dockerfiles.
- `os/build/` — `run.sh` and 14 `src/*.ts` (bundle, bundle-cli, grub-x64,
  layout-cx3576, layout-x64, mkimage-v2, mkimage-v2-cli, mkimage-x64,
  mkimage-x64-cli, paths, pin-seeded-times, stages, stages-cli, verify-package).
- `os/verify/` — `run.sh`, `Dockerfile`, and 30 `src/*.ts` (every check module,
  board/board-env/board-scope, boot-slots, image, image-layout, layout, parity,
  paths, probe, script-commands, smoke*, tools, verdict, verify-cli).
- `os/podman/` — `Dockerfile`, `build.sh`, `versions.env`.
- `os/update/rauc/` — `Dockerfile`, `build.sh`, `render-config.sh`,
  `system.conf.in`, `manifest.raucm.in`, `versions.env`.
- `os/boards/` — `cx3576/board.env`, `cx3576/boot.cmd`, the two repart.d uenv
  confs, `cx3576/overlay/usr/lib/mos/mos-status-led`, `x64/board.env`,
  `x64/grub.cfg`, `x64/overlay/.../boot.mount.in`.
- `os/tools/` — `qemu-run.sh`, `qemu-seed-state.sh`.
- `board/` — `cx3576/{Makefile,board.yaml,containers.env,Dockerfile.alpine}`,
  `cx3576/kernel/Dockerfile`, `cx3576/uboot/Dockerfile`,
  `cx3576/rootfs/alpine/Dockerfile`.

**What was deleted outright (C1-C4)**

- Every `// PLAN-014 M4x (RFCT-110)` file header under `os/verify/src/` and
  `os/build/src/` — 30 files, stripped and the opening paragraph re-wrapped.
- ~180 further `RFCT-nnn` / `PLAN-nnn` provenance stamps in comments, both
  parenthetical (`(RFCT-106)`, `(PLAN-012 D5)`) and sentence-embedded.
- The three `Makefile` tombstones the plan names: `:180-197`
  (`os-ui-location-test WAS HERE`), `:199-239` (`os-mkimage-v2-test AND
  os-mkimage-x64-test WERE HERE`) and `:300-311` (`os-verify-parity WAS HERE`).
- 56 `═══` box headings, de-decorated to plain sentences.
- Process narrative: `THE USER LIFTED THAT EXCLUSION ON 2026-08-26` in
  `smoke-register.ts` and `smoke.ts`, the two `M2c`-removed-the-knob essays in
  `os/podman/Dockerfile` and `os/update/rauc/Dockerfile`, and the R6/M2a/M2b/M2c
  sweep account in `images.env`.
- Self-referential meta-commentary: `THIS COMMENT USED TO READ "and NOTHING
  ELSE"` (`images.env`), `THE PARENTHESIS THAT USED TO STAND HERE`
  (`os/update/rauc/versions.env`), `THE PREVIOUS VERSION OF THIS COMMENT COVERED
  A REAL GAP` and its duplicate paragraph (`31-feature-containers.Dockerfile`),
  `THAT SENTENCE WAS FALSE UNTIL RFCT-108 M2c` (`os/podman/versions.env`).
- Dead-path citations into `os/verify-image-v2.sh` where they were a clean
  parenthetical or a trailing `-- path:line` marker (26 sites). The path is
  really gone — verified with `ls`, along with `os/mkimage-v2.sh`,
  `os/mkimage-x64.sh`, `os/mkimage-common.sh`, `os/update/bundle.sh` and
  `os/qemu`, all five of which were also named in comments and are all absent.

## MUST-KEEP items, verified file by file

Every item on PLAN-015's binding list that lives in this area is still present.
Checked by grepping for the load-bearing phrase in each, after the sweep:

| item | where | status |
|---|---|---|
| single-processor mksquashfs, why no `-all-root` | `90-pack.Dockerfile` "Step 1"/"Step 2" | present, one wording change (below) |
| FILE_MTIME/@epoch quirks | `os/rootfs/build-v2.sh`, `os/build/src/geometry.ts` | untouched |
| verity UUID/salt pinning | `90-pack.Dockerfile` "Step 3" | untouched |
| `os/build/src/pin-seeded-times.ts` header | that file | one paragraph reworded (below) |
| board geometry/determinism blocks | `os/boards/cx3576/board.env` | untouched |
| debugfs fails on stderr, not exit status | `os/build/src/tools/e2fsprogs.ts` | untouched (file not in the diff) |
| sgdisk silent relocation | `os/build/src/layout-x64.ts` | present, surrounding paragraph reworded (below) |
| replaceAll `$&` expansion rule | `os/build/src/grub-x64.ts` | rule kept verbatim; see below |
| mkimage wall-clock fallback | `os/tests/handshake-test/harness.sh` | out of scope (M3 owns `os/tests/`) |
| rauc block-size refusal | `os/build/src/tools/rauc.ts` | untouched (file not in the diff) |
| `.PHONY` no-patterns note | `Makefile` | reworded (below) |
| pipefail/SIGPIPE inversion note | `Makefile` | reworded and MOVED (below) |
| ordering + SOURCE_DATE_EPOCH notes | `os/build/src/stages.ts` | present |
| the five "PLAN-014's Scope section" quotes | `checks-bootchain.ts:31`, `:376`, `checks-connd.ts`, `checks-system.ts`, `checks-ext4.ts` | **all five untouched** |
| design-doc contract references | `os/update/rauc/{system.conf.in,render-config.sh}`, `board/cx3576/uboot/Dockerfile`, `os/build/src/mkimage-v2.ts` | all `docs/design/uboot-ab-handshake.md` refs untouched |
| output-format contract note | `os/verify/src/verify-cli.ts` | reworded (below) |

### The MUST-KEEP items that were reworded, quoted before and after

**1. `Makefile` — the `.PHONY` no-patterns note.**

Before:

    # The <board>-% delegation rules are NOT listed here: .PHONY does not accept
    # patterns, so an entry like `cx3576-%` matches nothing and silently declares
    # nothing -- the delegated targets stayed shadowable by a file of the same
    # name the whole time it was listed. They stay pattern rules (unlisted) because
    # the delegated names are open-ended; a stray file named e.g. `cx3576-kernel`
    # in this directory would shadow the delegation, which is a visible "Nothing to
    # be done" rather than a wrong build.

After:

    # The <board>-% delegation rules are NOT listed here: .PHONY does not accept
    # patterns, so an entry like `cx3576-%` matches nothing and silently declares
    # nothing. They stay pattern rules (unlisted) because the delegated names are
    # open-ended; a stray file named e.g. `cx3576-kernel` in this directory shadows
    # the delegation, which is a visible "Nothing to be done" rather than a wrong
    # build.

Only the past-tense clause about what "stayed shadowable while it was listed"
went; the rule and both of its consequences are unchanged.

**2. `Makefile` — the pipefail/SIGPIPE inversion note.** Reworded AND moved: it
sat above `os-rauc` and now sits directly above `os-shell-pipefail-lint`, the
target it describes. No target line moved.

Before:

    # Every shell script that enables pipefail, checked for an early-exiting reader
    # on the right of a pipe. `producer | grep -q PATTERN` inverts its own answer
    # there: -q exits at the first match, the producer dies of SIGPIPE, and pipefail
    # hands back that failure -- so the pipeline reports "not found" BECAUSE the
    # pattern was found. It cost this tree a false PASS on the assertion that only
    # one D-Bus policy names com.mos.mosd, and another on the members the MQTT
    # bridge is forbidden to be granted. The rationale is at the top of the script.

After:

    # Every shell script that enables pipefail, checked for an early-exiting reader
    # on the right of a pipe. `producer | grep -q PATTERN` inverts its own answer
    # there: -q exits at the first match, the producer dies of SIGPIPE, and pipefail
    # hands back that failure -- so the pipeline reports "not found" BECAUSE the
    # pattern was found. The rationale is at the top of the script.

The mechanism is verbatim; the two historical false PASSes went.

**3. `os/rootfs/stages/90-pack.Dockerfile` — Step 2, the ownership/mode gate.**
Step 1 (`-processors 1`, `-mkfs-time/-all-time`, `-noappend`, `-no-exports`, and
the whole "There is deliberately NO `-all-root`" paragraph) is **byte-identical**
apart from an em-dash normalised to `--` in its opening line. Step 2's first
sentence changed:

Before:

    # Step 2 — ownership/mode gate. mksquashfs is supposed to carry the source
    # tree's uid/gid through untouched, and -all-root used to break exactly that.

After:

    # Step 2 -- ownership/mode gate. mksquashfs must carry the source tree's
    # uid/gid through untouched, and -all-root is exactly what breaks that.

Past tense to present; the invariant is stronger, not weaker.

**4. `os/build/src/layout-x64.ts` — sgdisk silent relocation.** The relocation
rule itself ("cx3576 needs one because its loader starts at sector 64 and sgdisk
silently relocates a non-2048-aligned start") is untouched. The paragraph above
it lost its comparison against the deleted shell:

Before:

    * THE ALIGNMENT. os/mkimage-x64.sh passes NO `-a` and takes sgdisk's default;
    * this passes the board's GPT_ALIGN_SECTORS, which x64 declares as 2048 -- the
    * same number sgdisk defaults to. That is a deliberate difference in SPELLING
    * and it was MEASURED rather than assumed to be a difference in nothing (see
    * mkimage-x64.test.ts, ...). The reason for spelling it is that a
    * board is the single source of truth for its board: GPT_ALIGN_SECTORS=2048 sits

After:

    * THE ALIGNMENT is passed explicitly -- the board's GPT_ALIGN_SECTORS, which
    * x64 declares as 2048 -- rather than left to sgdisk's default, which is the
    * same number. The two are byte-identical (mkimage-x64.test.ts writes both
    * tables with a real sgdisk over the real x64 geometry and compares the
    * bytes); spelling it out is what keeps the board the single source of truth
    * for its own geometry. GPT_ALIGN_SECTORS=2048 sits

**5. `os/build/src/grub-x64.ts` — the replaceAll `$&` rule.** PLAN-015 says to
keep the rule and drop the "earlier version of this comment" framing. On
inspection the `$&` rule at `:146-157` carries no such framing in the tree as it
stands; it is **untouched**. What changed in that file is one C4 paragraph
elsewhere (the "the x64 image previously had two ESPs" account, rewritten to the
present-tense constraint "ONE ESP AND A BOOT PAIR, not two ESPs: with two, RAUC
installs the payload into the inactive ESP...").

**6. `os/verify/src/verify-cli.ts` — the output-format contract note.**

Before:

    // THE OUTPUT FORMAT IS THE ORACLE'S, DELIBERATELY. One `PASS:`/`FAIL:`/`SKIP:`
    // line per conclusion and a final `RESULT:` line, because that format is not
    // private to the deleted script: test/apid-api/HARNESS.md and its report.ts
    // describe their own output as "the shape os/verify-image-v2.sh prints", and
    // docs/task/RFCT-039 and RFCT-054 quote `RESULT: PASS (n/n)` lines as evidence.
    // A port that replaced the verifier and also changed how a verdict READS would
    // have made every one of those records unreadable in the same commit.

After:

    // THE OUTPUT FORMAT IS A CONTRACT, not a presentation choice. One
    // `PASS:`/`FAIL:`/`SKIP:` line per conclusion and a final `RESULT:` line:
    // test/apid-api's own harness describes its output as "the shape os/verify
    // prints", and docs/task/RFCT-039 and RFCT-054 quote `RESULT: PASS (n/n)`
    // lines as evidence. Changing how a verdict READS makes every one of those
    // records unreadable.

The two named readers and the quoted `RESULT: PASS (n/n)` string are kept; the
dead path name and the past-tense framing went.

**7. `os/build/src/pin-seeded-times.ts` — the header.** The reproducibility
argument (`:1-53`) is untouched. Only its closing paragraph, which recorded which
milestone deleted `os/mkimage-common.sh`, changed:

Before:

    // that is the part os/mkimage-common.sh existed to keep in one place, and it
    // ported with its callers. M6c freed it and M6e deleted it, along with both
    // assemblers that sourced it; this file is now the only home that argument has.

After:

    // Both assemblers need it and it must not be written twice, so this file is
    // its only home.

**8. `os/boards/cx3576/board.env` — the geometry blocks.** `:95-175` and
`:320-338` are untouched. Three edits elsewhere in the file: two parenthetical
`(RFCT-nnn)` stamps deleted, one "See docs/task/RFCT-020.md for the analysis"
pointer deleted, and "EPHEMERAL used to be the growth target and no longer is"
rewritten to the present-tense "EPHEMERAL is a fixed MOS_VAR_MIB, which freezes
its geometry exactly like the rootfs slots".

## Decisions taken, and what they cost

**Runtime strings and heredoc usage text were NOT edited.** M1's rule is
comment-only. `os/verify/run.sh`'s `--help` heredoc still says "RFCT-113's smoke
runner" and names `os/verify-image-v2.sh`; `os/build/run.sh`'s says
"os/mkimage-v2.sh (PLAN-014 M6b)"; `os/build-env/*/Dockerfile`'s
`org.opencontainers.image.description` LABELs still carry `(PLAN-014 M2,
RFCT-108)`; a dozen `checks-*.ts` verdict strings still carry `(RFCT-047)`,
`(RFCT-106)`, `PLAN-011 D5`, `PLAN-012`. These are the string-change class
PLAN-015 assigns to **M3**, not to M1. They are listed here so the sweep does not
read as complete when it is not.

**One line that carries data was edited, and only its trailing comment.**
`board/cx3576/board.yaml:8`:

    -bootChain: uboot-rockchip        # SPL+U-Boot at eMMC sector 64, FIT boot (PLAN-006)
    +bootChain: uboot-rockchip        # SPL+U-Boot at eMMC sector 64, FIT boot

The value is byte-identical, and the file's own header says nothing consumes
board.yaml. Every other change in the diff is a whole-line comment change; that
was verified mechanically, per file, by stripping comment and blank lines from
`git show main:<file>` and from the working copy and requiring the two to be
equal. That check is green for all 113 non-`docs/` files.

**`docs/task/RFCT-nnn.md` pointers were treated as provenance and deleted, with
two exceptions.** `verify-cli.ts:22` keeps its two, because PLAN-015's MUST-KEEP
list names it. `docs/design/*.md` references were kept everywhere, because the
list names them as class-7 deliberate citations.

**`PLAN-nnn Dx` decision stamps were deleted along with the milestone stamps.**
`PLAN-011 D5`, `PLAN-012 D4`, `PLAN-006 Part E` and the rest read as
present-tense in the sentences they open, but PLAN-015's MUST-KEEP list
enumerates the ~30 deliberate citations and none of these is on it. The
constraint each one introduced is kept; the identifier is not.

## Left alone, deliberately, and named

- **~215 plain `# ---...---` separator lines.** PLAN-015 counts 54 dash banners
  under C6. They are structural section rules rather than dramatic typography,
  and the ten named worst files had theirs rewritten as part of the file. A
  tree-wide sweep of the rest would be churn without a reader-facing gain.
- **~54 remaining `os/verify-image-v2.sh:NNNN` line citations** in
  `os/verify/src/`, where the dead path is the grammatical subject of the
  sentence ("os/verify-image-v2.sh:1441 reads it", "...with the same reading
  os/verify-image-v2.sh:1394 gives it"). A mechanical substitution was attempted
  and reverted: it produced ungrammatical text in about a third of the sites. The
  clean parentheticals and trailing markers were removed; these need per-site
  rewriting, and they are the same `path:line` drift PLAN-015 M4 (RFCT-121)
  builds a checker for.
- **`os/verify/src/parity.ts` is dead code.** It compares the check register's
  conclusions against the shell verifier's output per check, and the shell
  verifier is deleted; `make os-verify-parity` went with it (the tombstone this
  milestone removed from the `Makefile` recorded exactly that). Reported, not
  deleted — M1 does not delete code.
- **`os/update/rauc/render-config.sh`'s `MOS_RAUC_TEMPLATE` override has no
  caller.** Its own comment now says so in present tense. Reported, not deleted.

## Load-bearing comments found, and kept

None. No test or build step in the area was found to grep a comment this
milestone deletes. The two mechanisms that read comment text were checked
explicitly:

- `os/build-env/build.sh` compares every Dockerfile's `# syntax=` directive
  against `IMAGE_DOCKERFILE_FRONTEND`. All twelve `# syntax=` lines are
  byte-identical to `main` (they are the first line of each Dockerfile and were
  never in the edit set; verified by `cmp` on line 1 of every stage file).
- `os/build-env/images.env` is read by `.` and by a comment-stripped derivative,
  so its comments reach nothing. Its 37 assignment lines are byte-identical to
  `main`.
- `os/verify/src/checks-shadow.ts`'s `seed-state-no-shadow-on-state` check reads
  `mos-seed-state` and filters out lines starting with `#` — so its verdict is
  unaffected by the rewording of that file's shadow paragraph. Its 1,066-test
  suite is green.

## Gate results

Run from the worktree root at `38a6a7c`.

| gate | command | result |
|---|---|---|
| os/verify suite | `MOS_VERIFY_CONTAINER=1 bash os/verify/run.sh` | `RESULT: PASS (1066/1066 tests)`, 31 files, rc=0 |
| os/build suite | `MOS_BUILD_CONTAINER=1 bash os/build/run.sh` | `689 pass, 0 fail, 25 files`, rc=0 |
| shell pipefail lint | `bash os/tests/shell-pipefail-lint.sh` | `RESULT: PASS (29/29 files clean, 29 scanned)`, rc=0 |
| docs index | `bash docs/verify-index.sh` | `378/378 PASS`, rc=0 |
| shellcheck | `docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:stable <14 touched .sh>` | rc=1, **finding set identical to `main`** |

**The bun route.** `bash os/verify/run.sh` with no environment fails on this host
*before* any of this milestone's changes: the host bun is 1.3.13 at
`/work/bin/bun` and `bun.lock` is `lockfileVersion: 2`, which that bun refuses
(`error: Unknown lockfile version`), so `bun install --frozen-lockfile` fails and
the script exits 1 saying so. That is a host fact, not a regression — it
reproduces identically at `main`. Both suites were therefore run through the
tree's own second route, the digest-pinned bun container (`MOS_VERIFY_CONTAINER=1`
/ `MOS_BUILD_CONTAINER=1`), which is the route CI takes.

**shellcheck.** `shellcheck` is not installed on this host; it was run in
`koalaman/shellcheck:stable`. It exits 1 on 14 findings across five files
(SC1091, SC2016, SC2018, SC2019, SC2043, SC2097, SC2098, SC2153, SC2154 — all
`info` and `warning`, none `error`). Every one is pre-existing: the same command
was run against a detached `git worktree` at `main` and the two runs produce the
**same findings on the same files with the same codes**, compared line by line.
This milestone neither introduced nor removed one.
