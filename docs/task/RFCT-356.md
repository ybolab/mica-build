# RFCT-356 Two gates that report without checking: factory-root-gate on arm64, and the smoke build-commit assertion

- **status**: in-progress
- **priority**: P1
- **owner**: bkd/njizj3fm
- **createdAt**: 2026-09-08 04:00
- **relatedPlans**: (none)

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

Two checks in this tree report a result without having checked. One is loud and
wrong on every arm64 run; the other has been silently off since the path that
builds the shipped binaries changed.

**`make os-factory-root-gate` cannot pass on any arm64 root.**
`tests/factory-root-gate/inner.sh` compared the two trees with
`diff -r --no-dereference`, and `diff` cannot read a device node: for each of
the eight character devices under `/dev` it printed `File .../dev/null is a
character special file while file .../dev/null is a character special file`.
Eight lines that say only that diff declined to look, counted as eight
differences, turned into

```
FIDELITY: 1 of 4 comparisons differ. The image the smoke run
          executes in is NOT the image the device ships, so nothing the smoke run
          reports is about the shipped artifact.
```

The damage is not the red exit; it is that the message asserts every smoke
result is meaningless, on every arm64 run, for a reason that has nothing to do
with the artifact. RFCT-350 measured the same failure against the untouched
pre-S2 cx3576 pair, so it predates that task.

**The smoke suite's build-commit assertion has never run.**
`pkgs/mosd/hack/build-target.sh` wrote `_out/mosd-build.txt`;
`rootfs/build.sh` removed `$OUT_DIR/mosd-build.txt` on every build and nothing
wrote it back, because the binaries in a composed root come out of packages
built by `pkgs/mosd/hack/build-deb.sh`, which wrote no record. That choice was
right — a visible gap beats a false assertion — but the consequence is that
every run printed `build commit NOT ASSERTED`, while `verify/src/smoke.ts`'s own
documentation still said *"A root built by rootfs/build.sh always has it"*.

## ActiveForm

Comparing device nodes by type and major:minor, driving the new comparison from
the failing side, and moving the build-commit record onto the path that compiles
the binaries the image ships

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- `make os-factory-root-gate` passes on cx3576 and on virt-arm64, with device
  node identity actually compared.
- `mutate.sh` extended with the three device-node mutations, each shown red.
- The build-commit record written by the path that builds the shipped binaries,
  the assertion running, and its independence (or lack of it) stated.
- `verify/run.sh --smoke` on both arm64 boards no longer prints `NOT ASSERTED`.
- `verify/run.sh --verify` at its count or the change explained.
- `make docs-verify` green from a `git archive` into an empty directory.
