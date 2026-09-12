# RFCT-273 Coordinate the embedded delivery roadmap

- **status**: in_progress
- **priority**: P1
- **owner**: bkd/z36xbrtu
- **createdAt**: 2026-08-31 03:08
- **plan**: [PLAN-037](../plan/PLAN-037.md)

## Description

Maintain the shared embedded-product principles, dependency graph, priorities
and capacity schedule for the independently approved delivery plans. This task
coordinates the programme; it does not implement any child capability.

Campaign D now owns only this umbrella coordination. The roadmap's dated
RAUC/TUF and raw-slot wording is historical; current execution follows the
strict signed-file system and never restores old update packages or compatibility
paths. Reviewed A/B/C campaign handoffs block D3's final reconciliation, not the
independent child implementations.

## Acceptance

- PLAN-037 is a concise roadmap rather than a second implementation plan.
- PLAN-042 through PLAN-054 each own one deliverable and one approval gate.
- RFCT-278 through RFCT-290 each map one-to-one to those plans and remain
  pending/unassigned until their plan is approved and work is claimed.
- Existing decisions about CoreOS, RAUC, applications, BSP ownership, boot
  assurance, storage, time and BusyBox remain traceable after the split.
- The roadmap records cross-plan dependencies and a capacity-based schedule
  without treating dates as approval.

## ActiveForm

Coordinating independently approved embedded delivery plans.

## Dependencies

- **blocked by**: (none)
- **blocks**: approval sequencing and scheduling for RFCT-278 through RFCT-290

## Notes

- The original investigation is retained in git history at commit `267bbb1`.
- User annotations and settled principles were migrated into PLAN-037 and the
  relevant child plans rather than discarded.
- User annotation at 2026-09-01 13:18 UTC: replace the single large plan with
  multiple independent small plans.
- Child-plan implementation is not authorised by this documentation split.
- 2026-09-10: Ownership transferred through the PMA serializer to
  `bkd/z36xbrtu`; no child task or implementation ownership moved.

- unclaim: Transferred umbrella coordination to campaign D; no child implementation moved.
