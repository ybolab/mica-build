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

## Cross-workstream notes (recorded 2026-08-21, L1)

**For RFCT-084.** The M1 facade projects the item tree off a change marker on
`MosdService`: any *new* mutation path added there must call
`self.mark_changed()` after its write, or the tree will not project it and
`ItemsChanged` will not fire. RFCT-084 is adding update-orchestration members
to the same service, so its new mutating methods need that call.

**Pre-existing failure surfaced, not caused, by this milestone.**
`mosd/apid/tests/e2e.rs::web_flow_end_to_end` posts a wrong password and then
immediately the correct one, expecting 303; RFCT-081's login curve
(`1b5d796`) deliberately answers 429 to *any* attempt inside the armed
window, which `mosd/apid/src/tests.rs:217-224` asserts on purpose. The e2e
was last touched at `4c3afc0`, before that curve existed, and stayed
invisible because it returns `Ok(())` early when `dbus-daemon` is absent
(`e2e.rs:108-111`) — CI never ran it. Fixed under this campaign by a
test-only L3; the backoff itself is correct and must not be weakened.

**Deeper finding, deliberately NOT fixed here.** A test that silently skips
reports green while testing nothing — the same failure mode the repo's own
discipline names ("a retired path that reports success is the failure mode
every check here exists to prevent"). Whether `e2e.rs` should fail loudly, or
CI should provision `dbus-daemon` and assert the suite actually ran, is a
separate decision; recorded here as a roadmap item rather than folded into
PLAN-011.
