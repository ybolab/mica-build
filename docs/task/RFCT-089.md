# RFCT-089 PLAN-011 M1: bus contract design doc and the read-only com.mos.Item1 tree facade

- **status**: in progress
- **priority**: P1
- **owner**: ai-agent (BKD campaign, dispatched by L1 0yncfnol)
- **createdAt**: 2026-08-21 14:58
- **claimedAt**: 2026-08-21 14:58

PLAN-011 milestone M1. Deliverables: `docs/design/bus.md` (the D1/D2
contract — interface XML, class registry, mandatory paths, alarm and
invalid-value conventions, deviations from Venus recorded, plus the D6
Sparkplug B evaluation), and the read-only `com.mos.Item1` item-tree facade
in mosd (`GetItems`/`ItemsChanged` over settings + live state, redaction
applied). Verify: live-bus test for GetItems shape, signal coalescing and
redaction; `mosd/hack/check.sh` green.

Constraint recorded at dispatch: RFCT-084 is concurrently extending
`com.mos.mosd1` on another workstream with uncommitted changes on main —
the facade lands in a new module with a minimal `bus.rs` diff so the
eventual integration stays cheap.

## Outcome

Filled in at completion.
