# 20260912-0614-development-workflow Simplify development integration and acceptance workflow

- **status**: completed
- **priority**: P1
- **owner**: worker/main-workflow-20260912
- **createdAt**: 2026-09-12 06:14
- **relatedPlan**: [20260912-0614-development-workflow](../plan/20260912-0614-development-workflow.md)

## Description

Apply the user's 2026-09-12 ordering: merge reviewed development source, then
simplify coordination and acceptance. Full tier; approval covers the local
integration and workflow changes. Keep actual guest and hardware status open.
This task changes the runbook and existing campaign scheduling; it does not
implement a new build driver or the separate package-repository proposal.

## ActiveForm

Delivered the runbook and scheduler refactor; runtime qualification remains open in B7.

## Verification

Check the merged product tree against reviewed B, preserve unrelated main work,
run affected integration/documentation checks, and verify actual scheduling and
handoff state. Do not rebuild accepted components for documentation changes.

## Delivery evidence

- Reviewed B and D source integrated into main at `bcdcb04f`; all 1,551
  non-documentation file blobs/modes match reviewed B. Current main research and
  the unrelated unstaged package-repository proposal are preserved.
- Main integration checks and their original environment failures are recorded
  in `/tmp/mos-main-workflow-bAtAZu/checks-disposition.json`. The missing scratch
  directory was created and only the failed capacity test rerun. An empty
  Python invocation was replaced by actual unittest discovery. Prior exact-input
  proofs cover unchanged cases skipped by generic fixtures; no guest pass claimed.
- L1 watchdog `gb4a328c` is enabled at `0 */30 * * * *` with the
  new prompt verified byte-for-byte. Old L1 `c9ea0np3` and B `nkglvdlt` are both
  verified deleted. No product runtime or build producer changed for this policy.
- The same B7 issue/execution continues current-image guest preparation. All
  unperformed lifecycle, final ARM and physical tests remain pending.

- complete: Operational workflow and existing scheduler refactor delivered; source integration and documentation checks passed. Runtime acceptance remains with original B7.
