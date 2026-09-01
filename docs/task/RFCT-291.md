# RFCT-291 Flatten os/ into the repository root

- **priority**: P2
- **status**: completed
- **completedAt**: 2026-09-02 00:55
- **owner**: roy
- **plan**: [PLAN-055](../plan/PLAN-055.md)

## Goal

`os/boards`, `os/build`, `os/build-env`, `os/pkgs`, `os/rootfs`, `os/tests`,
`os/tools` and `os/verify` move to the repository root; every path
reference, self-locating script and CI workflow follows; historical records
keep their original paths; the `os-*` make target names stay.

## Acceptance

- `git grep -c 'os/'` outside `docs/CHANGELOG.md`, `docs/plan/`,
  `docs/task/` returns only deliberate residues (each named in the plan's
  completion note), and `os/` itself is gone.
- The full battery is green at the new layout: producers.sh discovers 11,
  `make os-debs` + `deb-package-gate` pass, `deb-preflight-test` /
  `rootfs-manifest-test` pass, a composed x64 image verifies with the QEMU
  smoke, and both bun suites pass.
- Precondition, confirmed by the operator before the move: the concurrent
  session in this checkout is idle with its work committed.

## Completion

`os/` is gone; the eight trees live at the root. Residual `os/` outside the
historical records is exactly the deliberate set PLAN-055's completion note
names. Full battery green at the new layout (gate 234/234, verify 293/293,
smoke 12/12, both bun suites, docs-verify). The `os-*` make target names
stayed, as decided.
