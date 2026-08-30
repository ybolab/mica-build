# RFCT-271 Write the build guide: x64 and cx3576, cross-compile versus emulation

- **status**: completed
- **priority**: P2
- **owner**: roy/mqtt-review-fixes-20260830
- **createdAt**: 2026-08-30 12:10

## Description

There is no single document that says how to build an image for each board.
The facts are spread across `os/rootfs/README.md`, `os/rootfs/stages/README.md`,
`build-harness.md` section 5, the BSP README and the comments in five build
scripts, and the one that matters most for cx3576 -- that every step except
the rootfs chain and its smoke run cross-compiles or emulates inside buildkit
without any host-level registration, and why the chain is the exception -- is
recorded only as scattered script comments.

Write `docs/design/build.md` and its Chinese counterpart: the artifacts, the
one-time setup per architecture, the x64 sequence, the cx3576 sequence with a
per-step route table (cross-compile, buildkit emulation, daemon emulation),
how to test each arm64 capability by execution rather than inspection, how to
register emulation on the host, and a table of the build's refusal messages.

## Acceptance

- `docs/design/build.md` and `docs/zh/design/build.md` exist and are indexed
  in both READMEs; `make docs-verify` passes.
- Every command in the guide is one that exists in the tree with the defaults
  it states.
- The guide states which of its claims were measured on the writing host and
  which are taken from records.

## ActiveForm

Writing the per-board build guide.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Documentation only.

- complete: docs/design/build.md and docs/zh/design/build.md written and indexed; docs-verify 51/51.
