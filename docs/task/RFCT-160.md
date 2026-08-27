# RFCT-160 PLAN-018 M1: board/ moves under os/boards/, every consumer repointed

- **status**: completed
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-018 (M1)

The first subtask of the board-consolidation workstream. `board/cx3576` becomes
`os/boards/cx3576/bsp` and `board/common` becomes `os/boards/common`, so a board
has one definition directory instead of two. Both moves are `git mv`, so history
follows. `board/x64/` is untouched and is now the only thing left under
`board/`; RFCT-162 deletes it.

Mechanical throughout: no build logic, no FROM line, no ARG name, no pin and no
`board.env` value changed. Every edit is a path string or the comment sentence
that names a path.

## Scope

| file | change |
| --- | --- |
| `.gitignore` | `board/*/out/` -> `os/boards/*/bsp/out/` |
| `Makefile` | `:49` help text, `:318` delegation target. `:321` (`x64-%`) left to RFCT-162 |
| `os/boards/cx3576/bsp/Makefile` | relative-path arithmetic, depth 2 -> 4 |
| `os/boards/cx3576/bsp/{Dockerfile.alpine,kernel,rootfs,uboot,board.yaml}` | path-naming comments |
| `os/boards/common/mos-required.fragment` | `:2` path comment |
| `os/rootfs/build-v2.sh` | `BOARD_DIR` default, the `init/` fallback, four message strings |
| `os/rootfs/{README.md,overlay-v2/.../storage.conf}` | path references |
| `os/build/src/{mkimage-v2-cli,bundle-cli,mkimage-v2}.ts` | constructed defaults and the `uboot-mos` messages |
| `os/build/src/*.test.ts`, `os/build/HARNESS.md` | the assertions and the doc row that quote those strings |
| `os/verify/src/{checks-bootchain,checks-board,verify-cli}.ts`, `HARNESS.md` | derived `BOARD_DIR`, the `make -C` message, comments |
| `os/build-env/{from.sh,images.env}`, `os/podman/*`, `os/tests/handshake-test/Dockerfile` | path comments |
| `os/boards/cx3576/board.env`, `overlay/.../mos-status-led` | comment text only |
| `README.md` | `:30` `make -C` fragment |
| `docs/design/uboot-ab-handshake.md` | eight `path:line` citation tokens |
| `docs/task/RFCT-160.md`, `docs/task/index.md` | this file, one index row |

### The relative-path arithmetic

`os/boards/cx3576/bsp/Makefile` sits four levels below the repository root
instead of two, so both of its relative paths moved with it. Resolved rather
than assumed:

```
$ cd os/boards/cx3576/bsp && realpath ../../../../os/build-env/from.sh
/srv/bkd/worktrees/u51kzjlk/f6zgcxd6/os/build-env/from.sh
$ cd os/boards/cx3576/bsp && realpath ../../common
/srv/bkd/worktrees/u51kzjlk/f6zgcxd6/os/boards/common
```

`os/build-env/from.sh` did not move, so its own `REPO_ROOT` arithmetic and the
error message at `:57` are unchanged. Its comment at `:49` said the caller's cwd
is "two directories further down"; that count is now four, and the path and the
count are one sentence, so both moved together.

## Found outside the stated file list, and changed anyway

Three edits were required that the task's file list did not name. Each is a
direct consequence of an edit the list *did* name, and without it a stated
acceptance criterion is red.

1. **`os/build/src/mkimage-v2.ts:137` and `:270`.** The spec attributes the
   `build it with 'make -C board/cx3576 uboot-mos'` message to
   `os/verify/src/checks-bootchain.ts:161`. It is not produced there.
   `checks-bootchain.ts:161` produces a *different* message with the same
   `make -C` shape; the string that `os/build/src/mkimage-v2.test.ts:199` and
   `os/build/HARNESS.md:480` quote is produced by `mkimage-v2.ts:137`
   (`ubootMissingError`), with a second occurrence at `:270`. The spec requires
   the test and the producer to stay byte-identical, so the producer moved too.
2. **`os/build/src/bundle-cli.test.ts:296` and `:318`.** These assert the
   default that `bundle-cli.ts:256` constructs, which the spec did direct. They
   were not in the list and failed `os-build-test` until updated.
3. **`os/build/src/mkimage-v2-cli.test.ts:92`.** A second assertion in a file
   the list named only at `:24`; it matches the `mkimage-v2.ts:137` message as a
   regex.

`README.md:30` is a fourth case of a different kind: the task lists the root
`README.md` as out of scope, but acceptance criterion 1 greps the whole tree
except `docs/` and `board/`, so a stale `make -C board/cx3576` there keeps that
criterion red. One `make -C` fragment was changed and nothing else in the file.

## Found and deliberately left alone

`os/verify/src/checks-bootchain.ts:19-20` name `` `board/` `` twice, once as
prose and once inside a verbatim quotation of PLAN-014's Scope sentence
("No change to ... `board/` BSP builds (digest pins only)"). The same quotation
recurs at `:349-350`. These are bare `board/`, so they do not match acceptance
criterion 1's grep, and rewriting a quotation of a plan document would make the
quotation false. They are left as the historical record they are.

Two related lines *were* rewritten, because they carry the literal
`board/cx3576` and criterion 1's grep is absolute:

- `os/verify/src/checks-bootchain.ts:25` quotes
  `BOARD_DIR="${BOARD_DIR:-${REPO_ROOT}/board/cx3576}"` from
  `os/verify-image-v2.sh:28`, and
- `os/verify/src/verify-cli.ts:64` describes that same default.

`os/verify-image-v2.sh` no longer exists in this tree. Both lines now attribute
a post-move path to a deleted script that predates the move. The grep is
satisfied and the sentences are wrong in a small way; re-wording them is prose
work this subtask does not own. **Flagged for RFCT-163.**

Comment lines that gained the longer path now run 81-84 columns in files whose
prose otherwise holds a hard 80. Refilling those paragraphs was measured and
rejected: it reflows text that `docs/verify-citations.sh` may quote, for a
cosmetic gain. Left at the wider width.

## Verification

Each gate was run to a file and the file read; no gate was piped into `tail`,
because the pipeline's exit status would be `tail`'s.

| gate | result |
| --- | --- |
| `bash docs/verify-index.sh` | rc=0 |
| `bash docs/verify-citations.sh` | rc=0, 642/642 PASS |
| `MOS_VERIFY_CONTAINER=1 make os-verify-test` | rc=0, 1066/1066 tests |
| `MOS_BUILD_CONTAINER=1 make os-build-test` | rc=0, 689/689 tests |
| `make os-rootfs-cx3576-v2` | **rc=2, blocked on a host gap** -- see below |

Acceptance criterion 1, the whole point of the milestone:

```
$ git grep -n 'board/cx3576\|board/common' -- . ':!docs' ':!board'
$ echo $?
1
```

Criterion 2, the moves are renames and history follows:

```
$ git status --porcelain | grep -c '^R'
96
$ git log --follow --oneline -3 -- os/boards/cx3576/bsp/uboot/Dockerfile
d40a90a refactor(boards): move BSP tree under os/boards/
f944e2a refactor(RFCT-153): compress comment form in board/ and mosd/hack; ...
4735f20 board(cx3576): drop task-ID stamps from the BSP build comments
```

Citations: the eight failures the move caused were all resolution failures in
`docs/design/uboot-ab-handshake.md`, and content failures stayed at 0 throughout
-- the moved files are byte-identical, so every quoted fragment still matches at
the line it cites. Only the `path:line` tokens were touched.

### The rootfs gate is blocked, and it is not this change

`make os-rootfs-cx3576-v2` cannot reach rc=0 on this host. It requires
`os/update/rauc/out-arm64/rauc`, which is not prebuilt anywhere and cannot be
built here:

```
$ MOS_BOARD=cx3576 make os-rauc
error: the 'default' buildx builder does not offer linux/arm64 on this host, and
it is the only builder that can be used here: every stage of
os/update/rauc/Dockerfile is FROM a localhost/mos-build-* tag ...
```

`os/update/rauc/build.sh:63` pins `--builder default` and `:72` refuses when that
builder cannot reach `linux/${MOS_ARCH}`. The host cannot:

```
$ docker run --rm --platform linux/arm64 alpine:3.21 uname -m
exec /bin/uname: exec format error
$ mount | grep binfmt_misc
(no output)
```

Neither `os/update/rauc/**` nor the `os-rauc` recipe appears in this branch's
diff, so the gap is pre-existing and independent of the move.

### What criterion 7 actually gates was proved anyway

Criterion 7 exists to prove BOARD_DIR resolves both ways. `build-v2.sh` resolves
`BOARD_DIR` at `:65` and checks `modules.tar` at `:178`, both *before* the rauc
check at `:209`, so the resolution is observable from which error the run
reaches.

- **7a, explicit override.** With `BOARD_DIR=/srv/ai/mos/board/cx3576` the run
  passes `:178` and stops at the rauc error -- the override still resolves.
- **7b, the new default, positive case.** With
  `os/boards/cx3576/bsp/out` symlinked to the prebuilt tree and no `BOARD_DIR`
  set, the run again passes `:178` and stops at the same rauc error.
- **7b, negative control.** With the symlink removed and no `BOARD_DIR` set, the
  run stops earlier, at `:180`, naming the new default explicitly:

  ```
  error: /srv/bkd/worktrees/u51kzjlk/f6zgcxd6/os/boards/cx3576/bsp/out/kernel/modules.tar not found.
  ```

  The default resolves to the new location, and the positive case above was not
  a vacuous pass.

The symlink was removed afterwards; the worktree is clean.

### One correction to criterion 7b's own procedure

Criterion 7b expects `git status --porcelain os/boards/cx3576/bsp/out` to print
nothing for the symlink. It prints `?? os/boards/cx3576/bsp/out`. A gitignore
pattern with a trailing `/` matches a directory and not a symlink, and the rule
this task specifies keeps that trailing slash. The old rule behaved identically,
measured in a throwaway repository:

```
old rule board/*/out/         vs symlink:   ?? board/cx3576/out
new rule os/boards/*/bsp/out/ vs symlink:   ?? os/boards/cx3576/bsp/out
new rule os/boards/*/bsp/out/ vs directory: (ignored)
```

So the developer `out/` tree -- a real directory -- is ignored exactly as before,
and no behaviour changed. The expectation in the criterion was written for a
directory.

## Remaining issues

- `os/verify/src/checks-bootchain.ts:25` and `os/verify/src/verify-cli.ts:64`
  now describe the deleted `os/verify-image-v2.sh` using post-move paths. For
  RFCT-163.
- Comment lines at 81-84 columns in the BSP Dockerfiles, `board.env`,
  `images.env`, `from.sh` and `build-v2.sh`, in files whose prose otherwise
  holds 80.
- `make os-rootfs-cx3576-v2` and every arm64 container build remain unrunnable
  on this host until arm64 binfmt exists for the `default` buildx builder.
