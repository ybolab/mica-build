# RFCT-265 Consolidate mosd workspace-level tests under the workspace

- **status**: completed
- **priority**: P2
- **owner**: codex/root-test-consolidation-20260829
- **createdAt**: 2026-08-29
- **plan**: [PLAN-030](../plan/PLAN-030.md) — approved and implemented

## Description

The repository-root `test/apid-api` package is not a repository-generic test
suite. It is a Bun-based black-box harness for `os/pkgs/mosd/apid`: it boots
the OS image, calls the APID service, and pins the APID OpenAPI document. A
second workspace-level test, `os/pkgs/mosd/hack/dbus-policy-test.sh`, is also
stored outside a test-owned location.

Consolidate these workspace-level harnesses under `os/pkgs/mosd/tests/` while
leaving Rust unit tests and Cargo integration tests in their conventional
crate-local locations.

## Acceptance

- `test/apid-api` is moved intact to `os/pkgs/mosd/tests/apid-api`, and the
  repository-root `test/` directory no longer exists.
- `os/pkgs/mosd/hack/dbus-policy-test.sh` is moved to
  `os/pkgs/mosd/tests/dbus-policy-test.sh`.
- `os/pkgs/mosd/tests/README.md` explains the test layout and distinguishes
  workspace-level black-box harnesses from crate-local Rust tests.
- Make targets, CI-facing scripts, current documentation, code comments, and
  path-resolution logic point to the new locations.
- Historical changelog entries retain the paths that were true when those
  entries were written.
- Current documentation and code comments no longer cite deleted build or
  verification scripts as live authorities, and design documentation no
  longer depends on source-code line numbers.
- Broken prose fragments left by earlier record-reference cleanup are repaired
  without changing executable behavior.
- Rust unit tests under `src/`, Cargo integration tests under each crate's
  `tests/`, `os/tests/`, and non-test build/check helpers under
  `os/pkgs/mosd/hack/` remain in place.
- The APID harness typecheck, self-test, spec-pin checks, shell lint, index
  verification, and relevant Rust tests pass; any unavailable full QEMU run
  is reported explicitly.

## ActiveForm

Consolidating mosd workspace-level tests and repairing their path contracts.

## Dependencies

None.

## Notes

Investigation on 2026-08-29 found 33 tracked files in the APID harness and 57
non-historical references to `test/apid-api` across 18 tracked files. The
suite's repository-root calculations, container working directories, and
fixture paths are relocation-sensitive and must be updated together.

The documentation/comment audit also found 31 path-plus-line citations and 157
bare line continuations in current Markdown, plus references in 76 files to
four deleted shell implementations. Those references are not executable
contracts and must be replaced with current artifact/module names or direct
behavioral explanations.

Implementation on 2026-08-30 moved the two workspace-level harnesses, repaired
all relocation-sensitive paths, removed the root `test/` tree, and completed
the approved documentation/comment remediation. Historical changelog paths
were retained.

Verification passed for documentation indexing, shell pipefail lint, both Bun
packages' typechecks and suites, APID self-tests and specification pins, D-Bus
policy tests, Rust formatting, workspace tests, and clippy. The full APID QEMU
run was unavailable because `_out/x64` is absent; its dry-run reached the new
paths and reported only the missing image prerequisite.

- complete: All self-contained verification passed; full QEMU run unavailable because _out/x64 is absent, with dry-run path resolution confirmed.
