# 20260910-1046-c-provisioning-resolution-tests Verify provisioning resolution through the API route

- **status**: completed
- **priority**: P1
- **owner**: worker-c/g4if0wrb
- **createdAt**: 2026-09-10 10:46

## Description

Close the PLAN-070 F9 and RFCT-315 F9 acceptance gap by exercising the current
provisioning resolver through the authenticated `GET /api/v1/provisioning/status`
route. Add only a private updates-document path seam matching the existing
manifest seam, keep `DEFAULT_UPDATES_PATH` as the production source, and prove
current projection, precedence, fail-closed, and secret-redaction behavior.

## ActiveForm

Verifying provisioning resolution through the authenticated API route.

## Dependencies

- **blocked by**: 20260910-1012-c-config-update-obligations (completed)
- **blocks**: (none)

## Notes

- Campaign: `mos-open-plans-20260910-100408`, slice C.D5.
- Approved classification: `docs/plan/20260910-1012-c-config-update-obligations.md` D5.
- Hardware, kernel, root, QEMU, and full-image builds are outside this task.
- The branch merged local L2 handoff `fa51970ca32c2a7d16f809134e78d249c0a1f897`,
  retaining approved source `5d0dca577a782aa707d9530779c4b23f2a7eda31`,
  reviewed classification `0f9b4e7e0e25c0ffad151db793a72479f55f96a0`,
  and the original `5c61f7fb` evidence baseline.
- TDD RED: the authenticated operator-override route assertion failed with an
  empty `operator` projection before the updates-path seam. GREEN: the final
  focused suite passed 10 tests, including isolated precedence, absent/null,
  read/parse/anchor/validation refusals, projection, and redaction cases.
- The complete apid gate passed 336 unit tests and 2 E2E tests after building
  the required `mosd` test binary in the pinned Rust container. Formatting,
  clippy with warnings denied, documentation verification, and scoped diff
  checks passed.
- Review verdict: PASS after tightening the complete baked-digest assertion,
  exact projection key sets, and an adjacent stale fixture comment.

- complete: Verified authenticated provisioning resolution, fail-closed operator input, projection, and redaction through the real API route.
