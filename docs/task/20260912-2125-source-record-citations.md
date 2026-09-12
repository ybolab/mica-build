# 20260912-2125-source-record-citations Replace deleted record citations in source comments

- **status**: pending
- **priority**: P3
- **owner**: (unassigned)
- **createdAt**: 2026-09-12 21:25

## Description

Source, test and build comments cite numbered tracking records (about 426
`PLAN-NNN`/`RFCT-NNN` citations in 112 files under `pkgs/`, `rootfs/`,
`build/`, `verify/`, `tests/`, `boards/common/` and the `Makefile`), most of
them deleted — for example `PLAN-070 §5.2.6` throughout `mosd-settings`.
The rationale behind those references is no longer reachable from the tree.

Acceptance: each citation is replaced by the rule it stands for or by a
reference to the design section that owns it (`docs/design/mosd.md` §2.x,
`docs/design/provisioning.md`, ...); no comment cites a record that is absent
from `docs/plan/` or `docs/task/`; the Rust, TypeScript and shell gates pass.

## ActiveForm

Replacing deleted record citations in source comments.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Found by 20260912-2049-docs-restructure; outside its documentation-only scope.
