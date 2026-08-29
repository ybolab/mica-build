# RFCT-162 PLAN-018 M3: board/x64 deleted, the stale x64 Makefile line corrected, board/ gone

- **status**: completed
- **priority**: P2
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-018 (M3)

`board/x64/` was definition-only and wholly redundant. RFCT-160 moved the
cx3576 BSP under `os/boards/cx3576/bsp`, RFCT-161 deleted both `board.yaml`
files, and what remained under `board/` was a single 15-line README describing
a board that has no BSP build at all. The board definition x64 actually has is
`os/boards/x64/board.env`, and its image is assembled by
`bash os/build/run.sh --mkimage-x64`. Neither of those lives under `board/`, so
the directory is deleted and the top-level `board/` is gone.

The root `Makefile` carried the one remaining reference, and it was wrong twice
over: it named a pipeline this repository retired and it pointed at the README
being deleted. Verbatim, old and new:

```
-	@echo "x64 has no BSP build; use the talos image pipeline (board/x64/README.md)" && false
+	@echo "x64 has no BSP build; assemble its image with: bash os/build/run.sh --mkimage-x64 (board definition: os/boards/x64/board.env)" && false
```

The "talos image pipeline" has not existed since PLAN-010 replaced the Talos
base with systemd + mosd -- the retirement is stated in this same file, in the
`os:` recipe at `Makefile:60`. The replacement names the measured entry point:
`--mkimage-x64` is an arm of `os/build/run.sh`'s dispatch (`os/build/run.sh:106`,
documented in the usage text at `os/build/run.sh:45`).

The recipe's shape is unchanged on purpose -- still one `@echo` and still
`&& false`. The comment at `Makefile:55-59` exists because a retired build path
that exits 0 prints "Nothing to be done" and reads as success, which is the
failure mode every check here is built to prevent. Correcting the text must not
quietly correct the exit code with it.

`BOARDS := cx3576 x64` (`Makefile:4`) is untouched. x64 is still a shipped
board; it just has no BSP directory, which is the whole point of the message.

## Scope

| file | change |
| --- | --- |
| `board/x64/README.md` | deleted, 15 lines -- last tracked file under `board/` |
| `Makefile` | line 321 rewritten, one line, recipe shape unchanged |
| `docs/task/RFCT-162.md` | this file, new |
| `docs/task/index.md` | one row appended |

`Makefile:4` and every other line in the file are unchanged: line 321 was the
only remaining `board/` reference.

```
$ git grep -n 'board/' -- Makefile
$ echo $?
1
```

## board/ is gone

Not "empty" -- absent. Git does not track directories, so deleting the last
tracked file removes it:

```
$ git ls-files board/ | wc -l
0
$ test ! -d board && echo gone
gone
```

## The stale-pipeline claim, checked rather than asserted

After the rewrite the only Talos mention left in the Makefile is the PLAN-010
retirement note, and nothing in the `x64-%` recipe:

```
$ git grep -n 'talos\|Talos' -- Makefile
Makefile:57:	@echo "os: retired by PLAN-010 (Talos base -> systemd + mosd)." >&2
```

And the recipe still fails, with the real path in the message:

```
$ make x64-image
x64 has no BSP build; assemble its image with: bash os/build/run.sh --mkimage-x64 (board definition: os/boards/x64/board.env)
make: *** [Makefile:321: x64-image] Error 1
$ echo $?
2
```

## Citations

Deleting the README broke none. The citation checker counts the same 642
assertions before and after the deletion, both green, so the one `path:line`
token that names the file -- `board/x64/README.md:5` in `docs/task/RFCT-057.md:321`
-- is outside the checker's in-scope set and was never resolved against the
tree. It is left alone: it is a historical record of what RFCT-057 measured at
the time, and prose in `docs/` is not this subtask's to edit.

## Reported, not fixed

Prose outside this subtask still names the old paths -- `docs/design/boards.md:32`
and `docs/architecture.zh.md:120` describe `board/x64`, and
`docs/design/boards.zh.md:36` still asserts that such a board carries a
`board.yaml`, a file that no longer exists anywhere in the tree. RFCT-163 sweeps
documentation; a sibling workstream owns `docs/design/boards.md`. Reported here
rather than touched.

## Checks

| command | rc |
| --- | --- |
| `bash docs/verify-index.sh` | 0 |
| `bash docs/verify-citations.sh` | 0 |
| `MOS_VERIFY_CONTAINER=1 make os-verify-test` | 0 |
| `MOS_BUILD_CONTAINER=1 make os-build-test` | 0 |

`os-build-test` needed a second run. The first exited 1 on a hook, not on an
assertion: `(fail) (unnamed) [5001.38ms] ^ a beforeEach/afterEach hook timed out`
in `os/build/src/pin-seeded-times.test.ts`, whose `afterAll` tears down a
container (`os/build/src/pin-seeded-times.test.ts:41`) against bun's 5 s default.
Every one of that file's own assertions passed in both runs, and the second run
was `689 pass / 0 fail`. Nothing in this diff is reachable from it -- the diff is
one `@echo` string, a deleted README and two docs files, and no file under
`os/build/src/` names `board/`. Reported as a flaky teardown, not fixed:
`os/**` is out of scope.

No image or rootfs build was attempted: none of these gates needs one, and the
rootfs/rauc chain is unrunnable on this host for a narrow reason outside this
campaign (`os/pkgs/rauc/build.sh:63` pins `--builder default`, and its
`FROM localhost/mos-build-*` stages need that image family reachable from
whichever builder runs them). Note that arm64 image builds themselves do work
here, via the `mos-arm64` docker-container builder -- `docker buildx inspect`
under-reports its platforms on this host and must not be used to settle that
question.
