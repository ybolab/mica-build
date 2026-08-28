# PLAN-024 Legacy plan closeout: PLAN-011, PLAN-012, PLAN-013 measured and closed

- **status**: approved (investigation-first)
- **createdAt**: 2026-08-28 07:30
- **approvedAt**: 2026-08-28 07:30
- **relatedTask**: RFCT-220..229 reserved
- **milestones**: M1 the three-plan audit, USER-GATED; M2+ per the ratified audit

## Context

Three plans predate the last four campaigns and their true remainder is
unmeasured: PLAN-011 (bus v2) sits at `[-]` with its M4 fate unclear;
PLAN-012 (container engine) at `[ ]` though RFCT-101..104 shipped much of it;
PLAN-013 (x64/QEMU vehicle) at `[ ]` though test/apid-api, the on-image
verify and the two-boot e2e now exist and PLAN-022 M7 hardened them. The
campaigns since also touched their subject matter (quadlets, network panes,
e2e harness) without updating the plan files — the checkbox-vs-reality gap
the tree's own doctrine forbids.

## Proposal

- **M1 (RFCT-220)** per plan: milestone-by-milestone audit against the tree
  (implemented / superseded / genuinely open, each with a citation), then a
  proposal per plan — close with a dated amendment, or name the remaining
  milestones as concrete tasks. USER GATE on the three verdicts.
- **M2+** execute the ratified verdicts (closing amendments and/or the
  remaining work as tasks in this plan's reservation).

## Scope

- **In (M1)**: reading everything; docs/plan status corrections at the gate's
  direction. **Out**: implementation before the gate.
