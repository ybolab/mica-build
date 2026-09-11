# 20260910-1012-c-config-update-obligations Classify configuration and update policy obligations

- **status**: completed
- **priority**: P1
- **owner**: worker-c/kpuc7zcb
- **createdAt**: 2026-09-10 10:12
- **relatedPlan**: [20260910-1012-c-config-update-obligations](../plan/20260910-1012-c-config-update-obligations.md)

## Description

Classify every PLAN-070 F1-F12 obligation, including the F6 subrows, every
PLAN-071 implementation obligation, and RFCT-315 F7/F8/F9 acceptance item
against the committed current design, API, implementation, and test evidence.
Each obligation must resolve to exactly one of: already delivered, superseded,
valid implementation work, or unresolved product decision. This unit produces
documentation only and does not implement production behavior.

Acceptance requires an evidence-backed obligation matrix, bounded dependency
slices for executable gaps, explicit shared-path and product-decision handoffs,
and successful `make docs-verify` and `git diff --check` gates.

## ActiveForm

Classifying current configuration and update policy obligations.

## Dependencies

- **blocked by**: (none)
- **blocks**: L2 issue 58sdocnk campaign decomposition for workstream C

## Notes

- Baseline commit: `5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`.
- Scope is classification only; production code and historical record statuses
  are read-only.

## Classification Result

- 33 assigned identifiers classified exactly once: 18 already delivered, 6
  superseded, 8 valid implementation work, and 1 unresolved product decision.
- The 8 implementation identifiers reduce to five bounded slices: refresh the
  stale public-defaults README; enforce source-side public-meta validation;
  complete the independent packed-meta check; restore the check over current
  native binaries for compiled endpoints; and add provisioning route content
  assertions through a test path seam.
- Build and verify slices require an explicit shared-path handoff before edit.
  The route-test and README slices are local. None of the focused tests requires
  a kernel, root, QEMU, full-image, or physical-board grant.
- The sole unresolved choice is PLAN-071 U10. Its release-only trigger is false
  during development; before a release offers `auto`, L1 must name the shipping
  board/backend, exact signed build, serial capture, safe power-cut points, and
  pass/fail rule.
- PLAN-070 F9's fleet half is not triggered because no fleet operator document
  or outbound fleet plane exists. It remains baked off/null and its historical
  PLAN-072 rows stay with C2.

## Handoff

- Detailed matrix and executable specifications:
  `docs/plan/20260910-1012-c-config-update-obligations.md`.
- Shared paths needing handoff: `rootfs/build.sh`, a validator under
  `rootfs/scripts/`, `build/src/`, and `verify/src/checks-file-root{,.test}.ts`.
- Local paths for later slices: `meta.example/README.md` and the apid
  provisioning route/state/test files named in D5.
- L2 D changelog text is recorded verbatim in the plan's Evidence Limits. This
  unit does not edit the campaign changelog or campaign-wide records.
- Future source L3s must first merge local `bkd/58sdocnk` into their clean
  branches; no unpushed origin reference is a valid source.

## Verification

- [x] `make docs-verify` — all 195 index, 506 link, 718 status, 249 Chinese-text, and 118 BSP checks passed.
- [x] `git diff --check` — clean.
- [x] Changed-file inspection confirmed only this task, its plan, and their scoped index rows changed.

- complete: Classified 33 obligations into five executable slices and one bounded release decision.
