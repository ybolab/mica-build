# PLAN-018 Board consolidation: board/ moves under os/boards/, one definition per board

- **status**: approved
- **approvedAt**: 2026-08-26 22:05
- **createdAt**: 2026-08-26 21:55
- **relatedTask**: RFCT-160..169 reserved
- **milestones**: M1 the move and the path rewrites, byte-identical artifacts; M2 board.yaml retired into board.env and boards.md; M3 x64 cleanup and the stale Makefile line; M4 docs path sweep under the gating checker

## Context

Board definition exists twice (user decision 2026-08-26: consolidate, full
migration — option B):

- `os/boards/<board>/board.env` — machine-consumed single source of truth,
  lint-checked, consumed by os/build and os/verify.
- `board/<board>/board.yaml` — consumed by nothing (its own header says so),
  duplicating console/cmdline/storage/artifact facts, already drifted
  (cmdlineExtra vs BOARD_CMDLINE_ARGS disagree).

`board/` otherwise holds the cx3576 BSP builds (uboot/kernel Dockerfiles on
IMAGE_UBUNTU_2404, alpine debug rootfs, third/rkdeveloptool,
common/mos-required.fragment consumed via the buildx context `mos-common`),
plus `board/x64/` which is definition-only (board.yaml + README) and wholly
redundant, and a root Makefile delegate whose x64 line still says "use the
talos image pipeline" (Makefile:321).

Measured consumers of board/ paths: os/rootfs/build-v2.sh (BOARD_DIR default
:65, containers.env :92-94, modules.tar :178, firmware :324-334, init/ :373),
root Makefile :49/:318/:321, board/cx3576/Makefile's buildx contexts,
os/build/src mkimage tests' usage strings, ~9 docs/design files citing
board/ paths, docs/design/bsp-cx3576-sync.md. No .gitea reference.

## Proposal

- **M1 (RFCT-160)** `git mv board/cx3576 os/boards/cx3576/bsp` and
  `board/common -> os/boards/common`; every consumer path updated (BOARD_DIR
  default, Makefile delegate, buildx context paths, usage strings, dockerignore
  files). Acceptance: `make os-rootfs-cx3576-v2`-chain builds green with
  prebuilt artifacts at the new path; byte-identity of any rebuilt artifact is
  NOT required (BSP builds are not reproducible) — instead the tree carries no
  reference to the old path (`git grep 'board/cx3576\|board/common'` empty
  outside docs/task history).
- **M2 (RFCT-161)** board.yaml retired: still-true human facts (kernel
  source/dtb, wifi SKUs, display defaults) fold into board.env comments or
  docs/design/boards.md; both board.yaml files deleted.
- **M3 (RFCT-162)** board/x64 deleted; Makefile:321 x64 line states the real
  path (os/build x64 pipeline); `board/` directory removed entirely.
- **M4 (RFCT-163)** docs/design path citations updated;
  docs/verify-citations.sh green (it gates); bsp-cx3576-sync.md paths and
  os/verify comment references updated.

## Risks

- The BSP out/ artifacts are gitignored prebuilds; movers must not lose
  developer worktrees' out/ trees — M1 documents that `out/` moves with the
  directory or is rebuilt.
- checks-bootchain.ts and HARNESS text reference board/cx3576/out for the
  smoke-run recipe; those strings must move in the same commit as the path.
- The citation gate turns any missed doc path into a red CI, which is the
  safety net, not a risk.

## Scope

- **In**: board/** (moving), os/boards/**, Makefile, os/rootfs/build-v2.sh,
  os/build/src usage strings and tests, dockerignore files, docs/design path
  references, board README rewrite (Talos framing dies with the move).
- **Out**: BSP Dockerfile content changes beyond paths, os/boards/*/board.env
  values, mosd/**, *.zh.md.
