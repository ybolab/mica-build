# RFCT-163 PLAN-018 M4: documentation path citations follow the move

- **status**: completed
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-018 (M4)

The closing subtask of the board-consolidation workstream. RFCT-160 moved the
tree, RFCT-161 retired `board.yaml`, RFCT-162 deleted the last of the old
directory. This one makes the documentation's path citations name where things
now live, under `docs/verify-citations.sh`, and closes PLAN-018.

A sibling workstream owns the *content* of `docs/design/**` and was editing it
concurrently. So the rule here was narrow: change a path, change a citation's
line number, or correct a quoted fragment that must still match its source --
nothing else. Every sentence that is wrong in a way a path edit cannot fix is
reported below rather than rewritten. Three files fall outside that ban and
were corrected in prose, each named for it by the plan: `README.md`, the moved
BSP `README.md`, and two `os/verify` comments.

## Scope

| file | change |
| --- | --- |
| `docs/architecture.md` | 2 paths |
| `docs/design/boards.md` | 3 paths |
| `docs/design/bsp-cx3576-sync.md` | 6 paths |
| `docs/design/display.md` | 1 path |
| `docs/design/ro-root.md` | 2 paths |
| `docs/design/uboot-ab-handshake.md` | 5 paths, 1 quoted fragment |
| `docs/research/os-comparison.md` | 1 path |
| `README.md` | the `board.yaml` sentence, now false |
| `os/boards/cx3576/bsp/README.md` | framing rewritten; the Talos attribution is gone |
| `os/verify/src/checks-bootchain.ts` | stale attribution to a deleted script |
| `os/verify/src/verify-cli.ts` | same |
| `docs/plan/PLAN-018.md` | status, completedAt, milestones |
| `docs/plan/index.md` | PLAN-018 row flipped |
| `docs/task/RFCT-163.md`, `docs/task/index.md` | this record and its row |

The 20 path edits are mechanical and were checked as such: every removed line
differs from its added line in the path alone, verified by reading all 40 of
them rather than trusting the count.

```
$ git diff --stat 45141b8..HEAD -- docs/design/
 docs/design/boards.md             |  6 +++---
 docs/design/bsp-cx3576-sync.md    | 12 ++++++------
 docs/design/display.md            |  2 +-
 docs/design/ro-root.md            |  4 ++--
 docs/design/uboot-ab-handshake.md | 12 ++++++------
 5 files changed, 18 insertions(+), 18 deletions(-)
```

Eighteen changed lines in `docs/design/`: 3 + 6 + 1 + 2 + 6 by file, the last
six being `uboot-ab-handshake.md`'s five paths and the one quoted fragment
below. The other three of the twenty path edits are outside `docs/design/` --
two in `architecture.md`, one in `research/os-comparison.md`.

## Measurements

### The gates

```
$ bash docs/verify-citations.sh
  documents scanned:      16
  citations found:        828
  in scope:               642
  resolution failures:    0
  content failures:       0
docs/verify-citations.sh: 642/642 PASS          rc=0

$ bash docs/verify-index.sh
docs/verify-index.sh: 495/495 PASS              rc=0

$ MOS_VERIFY_CONTAINER=1 make os-verify-test
RESULT: PASS (1066/1066 tests)                  rc=0
```

### The old-path grep

Empty outside history and outside the Chinese translations:

`$OLD` below is the old-path alternates. PLAN-018 M1 writes two of them out at
`docs/plan/PLAN-018.md:42`; this milestone's acceptance adds `x64`, which M3
retired. The pattern is deliberately not repeated in this file -- a task record
that copies the plan's grep is one more copy to drift.

```
$ git grep -n "$OLD" -- . ':!docs/task' ':!docs/plan' ':!*.zh.md'
(no output)
```

PLAN-018's M1 acceptance asked for that grep to be empty outside `docs/task`
history. Amendment 1 narrowed it: the translations are excluded, and their
references are to be counted here rather than silently exempted. Counted, and
left untouched:

```
$ git grep -c "$OLD" -- '*.zh.md'
docs/architecture.zh.md:2
docs/design/boards.zh.md:3
docs/design/display.zh.md:1
docs/research/os-comparison.zh.md:1
```

Seven references, four files, matching what Amendment 1 records. No `*.zh.md`
file was opened for edit in this subtask.

### The quoted fragment the gate cannot catch

`docs/design/uboot-ab-handshake.md:210` cited `board.env:349` but quoted
`console: ttyFIQ0,1500000` -- YAML syntax inherited from the deleted
`board.yaml`. The source reads:

```
$ sed -n '349p' os/boards/cx3576/board.env
BOARD_CMDLINE_ARGS="console=ttyFIQ0,1500000 earlycon=uart8250,mmio32,0x2ad40000 net.ifnames=0"
```

The fragment now reads `console=ttyFIQ0,1500000`. The checker pairs a quote
with a citation only when the quote comes first; here the citation precedes it,
so this line is resolution-checked only and the gate was green either way. It
was verified by hand, against the source, not by the gate.

### The six board.env citations, re-measured

RFCT-161 inserted 22 comment lines into `os/boards/cx3576/board.env`, shifting
content below its first hunk by +5. Three citations in
`docs/research/mos-ui-inventory.md` were carried forward here as needing that
shift applied. **They were measured, and they do not need it.** Each range
already lands on the block its prose describes:

| citation | resolves to today |
| --- | --- |
| `board.env:155-172` | `BOOT_A_PARTNUM` .. `BOOT_B_FAT_VOLUME_ID` -- the boot-slot GUID block |
| `board.env:198-205` | the boot-attempt radix comment and `BOOT_ATTEMPTS_DEFAULT/MIN/MAX` |
| `board.env:209-219` | `ROOTFS_A_PARTNUM` .. `ROOTFS_B_TYPECODE` -- the rootfs-slot GUID block |

Applying +5 would break all three: `160-177` starts mid-block at
`BOOT_A_GUID` and ends inside a comment paragraph. The +5 transform is not the
right one because these citations were never aligned to `c0de291^` in the
first place -- the document declares itself a snapshot measured at `d0bcae9`
(`docs/research/mos-ui-inventory.md:5-9`), explicitly unmaintained, and its
line numbers belong to that commit.

The established handling for this file agrees: `97b1076` and `f0d84aa` both
repointed its path *prefixes* while leaving every line number alone. This
subtask did the same -- the paths were already current, so nothing was changed.

`docs/research/mos-ui-inventory.md:591` cites `board.env:251-310` for the
storage tiers' sizes. That range spans META, STATE and EPHEMERAL and stops at
`DATA_PARTNUM=11`, two lines short of `DATA_SIZE_MIB=64` at `:312`. Left as
found, for the same snapshot reason.

No gate covers `path:line` citations in `docs/task/**` or `docs/research/**`;
`docs/verify-citations.sh` scans `docs/design/*.md` and `docs/architecture.md`
only. Everything in this section is hand-checked and stays hand-checked.

### The two os/verify comments

`os/verify-image-v2.sh` does not exist in this tree:

```
$ git ls-files | grep -c 'verify-image'
0
```

Both named comments described it using post-move paths, so they attributed a
path to a script that never contained one. `checks-bootchain.ts` quoted two of
its shell literals; the quotes are gone and the comment now states what this
module does -- it carries no cx3576 literal, deriving the BSP directory from
the board's name and the artefact names from `BOOT_SLOT_REQUIRED_FILES`.
`verify-cli.ts` kept the reason there is no default board and dropped the
`file:line` pointer into the deleted script.

### The BSP README

It opened "Board support artifacts for the Talos-based appliance ROM" and
pointed at "the talos repo" three times. This repository retired the Talos base
under PLAN-010. The file now states what the directory is and what builds it:
`os/boards/cx3576/bsp/Makefile`, reached from the root as `make cx3576-<target>`
(`Makefile:318`).

Its "Known gaps" section was deleted rather than rewritten. All three entries
were false, and its tracking pointer was to the retired repo:

| claim | measured |
| --- | --- |
| kernel config lacks `CONFIG_DM_INIT` / `CONFIG_DM_VERITY` / `CONFIG_BLK_DEV_DM` | all three pinned, `os/boards/common/mos-required.fragment:7-9` |
| U-Boot has no RAUC handshake and no redundant env | `make uboot-mos` builds exactly that; `UBOOT_VARIANT_DIR=uboot-mos` at `os/boards/cx3576/board.env:110` |
| the `make` targets have no Makefile yet | `os/boards/cx3576/bsp/Makefile:33-120` defines all of them |

Rewriting them into truth would have been inventing content; the facts they
were tracking are now stated positively in the body above.

### README.md

`README.md:33` claimed "Each board directory carries a `board.yaml` metadata
file describing the board; no build step consumes it yet". Both halves are now
false -- `board.yaml` is deleted, and `board.env` is read by the image, rootfs,
RAUC and verify steps. The sentence names `board.env` and its consumers
instead. This is the smallest edit that makes it true; the surrounding section
is unchanged.

## Left for the sibling workstream

Each is a false or stale sentence in a document this subtask may not rewrite.

| location | what is wrong |
| --- | --- |
| `docs/design/boards.md:20` | the layout tree lists `board.yaml` as a board-directory member |
| `docs/design/boards.md:33` | "carry only `board.yaml` + README" |
| `docs/design/boards.md:42` | a whole table row for `board.yaml` as an artifact |
| `docs/design/boards.md:91` | the add-a-board recipe says "Create `board/<name>/` with board.yaml" |
| `docs/design/display.md:69` | "Boards advertising `display` in `board.yaml features`" |
| `docs/design/display.md:76` | "`board.yaml` gains a `display:` section" |
| `docs/design/boards.md:26,40,41` | generic placeholders `board/<name>/`, `board/<n>/kernel`, `board/<n>/uboot` still use the old prefix |

The placeholders are path-shaped and would have been in scope on their own, but
each sits inside a sentence or table whose `board.yaml` claim is false. Editing
the path alone would leave a half-corrected section and collide with the
rewrite the sibling owes. They are reported together.

The `*.zh.md` siblings carry the same `board.yaml` claims in Chinese
(`docs/architecture.zh.md:108`, `docs/design/boards.zh.md:24,36,44,45,88`,
`docs/design/display.zh.md:69,75`). Untouched by ruling.

## Reported, not acted on

- **`docs/task/RFCT-152.md:131`, `:138`, `:140`** cite `board.env` line ranges.
  RFCT-152 is a completed historical record and this workstream does not
  rewrite those.
- **Comment lines that now run past 80 columns**, having gained the longer
  path. RFCT-160 measured a refill and rejected it: reflowing text the citation
  checker may quote, for cosmetic gain, is a bad trade. Not refilled here
  either. Eleven lines:
  `os/boards/cx3576/bsp/uboot/Dockerfile:12` (82),
  `os/boards/cx3576/bsp/kernel/Dockerfile:5` (82) and `:49` (81),
  `os/boards/cx3576/board.env:94` (86),
  `os/build-env/images.env:65` (84) and `:71` (83),
  `os/build-env/from.sh:29` (87) and `:49` (86),
  `os/rootfs/build-v2.sh:181` (96), `:182` (90) and `:301` (84).
- **About 60 references to `os/verify-image-v2.sh` across `os/**`**, in
  `os/verify/src/*` and the board.env comment headers. These are deliberate
  port-provenance comments -- `os/verify/run.sh:57` frames it correctly as the
  script "this package replaced" -- but many read in the present tense about a
  file the tree no longer contains. Two were named for this subtask and fixed;
  the rest is a separate sweep, outside PLAN-018.
- **`docs/plan/PLAN-009.md`** Part C describes a `board.yaml` contract. Plans
  are history and record what was true when written. Not edited.

## Host constraint

No image or rootfs build was attempted; none of this subtask's gates need one.
The `mos-arm64` buildx builder does build `linux/arm64` on this host, and
`docker buildx inspect` under-reports it. The rootfs/rauc chain is separately
unrunnable because `os/update/rauc/build.sh:63` pins `--builder default` while
its `FROM localhost/mos-build-*` stages need that image family reachable from
whichever builder runs them. Both facts are recorded as pointers; neither was
acted on.
