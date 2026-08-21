# RFCT-089 PLAN-011 M1: bus contract design doc and the read-only com.mos.Item1 tree facade

- **status**: complete — the bus contract and the read-only `com.mos.Item1` façade both landed; M2 owns the write path
- **priority**: P1
- **owner**: ai-agent (BKD campaign, dispatched by L1 0yncfnol)
- **createdAt**: 2026-08-21 14:58
- **claimedAt**: 2026-08-21 14:58
- **completedAt**: 2026-08-21 19:49

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

M1 is complete. Two commits carry it — `9b3e5cc` (the contract) and `a996545`
(the façade) — merged onto the campaign branch as `5daee26` and `86aabd8`.

**`docs/design/bus.md`, the contract.** D1's `com.mos.Item1` with its
interface XML (`GetValue`/`SetValue` on every item path;
`GetItems`/`ItemsChanged` on the service root, coalesced per event-loop
turn), the deliberate absence of `GetText` with Venus's own gui-v2 declining
it as the evidence, the invalid-value convention stated once for the whole
contract (absent key in `GetItems`, empty-`av` sentinel on the wire), the
dot-path ↔ slash-path mapping and the VLAN-dot limit it inherits unchanged,
D2's naming rule plus the six-class registry (`io`, `serial`, `can`,
`sensor`, `meter`, `gps`) with energy classes fenced out until a product
need exists, the mandatory `/Mgmt/*` paths and the `/Alarms/<name>`
encoding, D3's actions-as-items semantics including the forced `0 -> 0`
re-zero edge that makes a trigger observable, structural redaction as a
bus-level contract, and the five recorded deviations from Venus. Indexed in
both READMEs.

**The D6 Sparkplug B evaluation (§10), recorded here so M3 starts
unblocked.** The two protocols differ mainly in envelope, and the item tree
supports either. OUTCOME: the bridge implements the mos-native
`N|R|W/<deviceId>/<class>/<instance>/<path>` grammar only; Sparkplug B is
adopted, if ever, as an *additional* mapper beside it, on the recorded
revisit trigger — a named integration that requires `spBv1.0`.

**`mosd/mosd/src/tree.rs`, the read-only façade.** `GetItems` and the
coalesced `ItemsChanged` served on the root object path `/`, projecting the
settings tree and the live-state tree as one flat map of absolute slash
paths. Redaction is one function every projection passes through before
anything else looks at the tree, matching `password_hash`, `passwordHash`,
`psk` and `hash` structurally at any depth including inside arrays. JSON
`null` projects as an absent key and a vanished path signals the empty-`av`
sentinel — §3 in code. The watcher diffs successive redacted projections and
emits one signal per accumulated batch, the watch channel collapsing marks
that arrive mid-projection into one wake. `writable` is `false` on every
item: per-item `GetValue`/`SetValue` objects are M2 and deliberately absent.

**The façade only observes.** `MosdService` stays the single writer and
gained only a change marker, a `trees()` snapshot accessor, and
`mark_changed()` at the end of its mutating methods — the smallest `bus.rs`
diff that works, chosen for the RFCT-084 collision recorded at dispatch. The
contract that falls out of it is in the cross-workstream note below.

**Contract markers.** `bus.md` was written entirely `[proposed]`; this task
flips to `[implemented]`, by path, only what M1 shipped: the root-only
`GetItems`/`ItemsChanged` pair and its coalescing guarantee (§1.1), the
absent `GetText` (§2), the invalid-value convention's absent-key and
empty-`av` halves (§3), the canonical dot-path and the slash-form keys (§4),
and structural redaction with the test that holds it (§8). Everything the
write path needs — `GetValue`/`SetValue`, per-item object paths, `SetValue`
error codes — stays `[proposed]` for M2, as do the class registry, the
mandatory paths and the action items, which need services that do not exist
yet.

**Verification.** `make docs-verify` green (303/303) on the contract commit
and again at this close-out. The façade landed with live-bus tests
(`mosd/mosd/tests/tree.rs`) covering the three M1 groups against a real
`dbus-daemon` — `GetItems` shape (both trees, slash paths, `a{sa{sv}}` on
the wire, `writable=false`, no M2 members), coalescing (four leaves from one
mutation arrive in exactly one signal), and redaction (seeded secrets in no
`GetItems` result and no `ItemsChanged` payload) — plus unit tests for
redaction at depth, flattening, the diff and the sentinel. Those suites and
`mosd/hack/check.sh` are the implementing subtask's to run and report; this
docs-only close-out ran `make docs-verify` and claims nothing beyond it.

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
