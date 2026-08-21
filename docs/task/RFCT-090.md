# RFCT-090 PLAN-011 M2: writable items and /Actions/*, apid power pane on action items

- **status**: in progress
- **priority**: P1
- **owner**: ai-agent (BKD campaign, dispatched by L1 0yncfnol)
- **createdAt**: 2026-08-21 14:58
- **claimedAt**: 2026-08-21 14:58

PLAN-011 milestone M2, depends on M1 (RFCT-089). Deliverables: every
platform-config subtree (`hostname`, `network`, `wifi.client`, `wifi.ap`,
`access.ssh`) writable through `com.mos.Item1` (the tree is a facade over
the same store; reconcilers unchanged); `/Actions/*` items with
VeQItemAction semantics (value always 0, write triggers, forced re-zero,
log-before-power-call preserved); apid power pane consumes the action
items; `docs/design/api.md` §10.3 fork entry resolved with citation.
Verify: route tests behaviorally unchanged; live-bus tests per PLAN-011 M2.

## Outcome

Filled in at completion.
