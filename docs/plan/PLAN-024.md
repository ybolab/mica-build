# PLAN-024 Legacy plan closeout: PLAN-011, PLAN-012, PLAN-013 measured and closed

- **status**: completed — M1 audited the three plans (RFCT-220, RFCT-221, RFCT-222) and was user-gated; M2 executed the ratified closeout (RFCT-227), amending PLAN-011, PLAN-012 and PLAN-013 and filing RFCT-223, RFCT-224, RFCT-225 and RFCT-226 as pending
- **createdAt**: 2026-08-28 07:30
- **approvedAt**: 2026-08-28 07:30
- **completedAt**: 2026-08-28
- **relatedTask**: RFCT-220..229 reserved; used: RFCT-220, RFCT-221, RFCT-222 (M1 audits), RFCT-227 (M2 closeout), RFCT-223..226 (residues filed pending)
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

## Amendment 1 — closeout and one measured correction, 2026-08-28 (executed by RFCT-227)

M1's three audits (RFCT-220, RFCT-221, RFCT-222) were ratified at the user
gate. M2 executed them: PLAN-011, PLAN-012 and PLAN-013 each carry a dated
Amendment 1, their status lines and index markers now agree with their files,
and the four routed residues are filed as RFCT-223, RFCT-224, RFCT-225 and
RFCT-226 — all pending, all unclaimed. This plan completes.

**Correction to this plan's Context, and to the M1 ratification that inherited
it.** The Context paragraph above reads "RFCT-101..104 shipped much of it" of
PLAN-012. That range is off by one and the Context prose is left as written,
because it is dated history; the corrected range is recorded here instead.

The records that delivered PLAN-012 are **RFCT-101, RFCT-102 and RFCT-103**.
RFCT-101 is "PLAN-012 M2: the container engine in the image, installed and
inert" and RFCT-103 is "PLAN-012 M1–M4: build the engine from source, replace
the distribution's configuration, and give the switch something to switch".
RFCT-104 is not container-engine work at all: it is "A master switch for MQTT,
and a broker for the bridge that has only ever retried", PLAN-011 M7.

The M1 ratification repeated "RFCT-101..104" because it read it here. That is
the origin of the slip, and it is named so that a reader who meets the false
range in the Context paragraph finds the correction beside it rather than
propagating it a third time. PLAN-012's own status line, `relatedTask` field
and Amendment 1 all carry RFCT-101..RFCT-103.
