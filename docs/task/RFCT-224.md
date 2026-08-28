# RFCT-224 Decide and settle container.enabled's bus writability, for the class and not one key

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
- **createdAt**: 2026-08-28
- **plan**: PLAN-012 (D3 divergence, filed by PLAN-024 M2; routed to PLAN-025-class work)

PLAN-012 D3 states that the container switch is a writable bus item and an
MQTT-addressable path "for free". RFCT-221 measured the tree and found it is
not: `container` is absent from mosd's fixed writable-subtree list, so
`/container/enabled` projects read-only and is written only through the
daemon's settings method, which is the path apid uses.
`docs/design/containers.md` states the untrue version to integrators.

This is a decision before it is an edit, which is why PLAN-012's closeout
amendment files it instead of patching it in either direction by default.

## Scope when claimed

Choose one of two, and make the tree say only that:

- **Widen the writable subtrees** to include `container` — with the same care
  the list's own comment demands, since writing that key grants root-capable
  containers to anything that can reach the bus.
- **Correct the documents** — PLAN-012 D3 and `docs/design/containers.md` — to
  say the switch is written through the settings method only, and is not bus-
  writable or MQTT-addressable.

`mqtt` sits in exactly the same position. Whichever way this goes, state the
answer for the class of platform switches rather than for one key, so the next
switch does not re-open the question.

## Acceptance criteria

1. The design document and the daemon agree, proven by a test — not by
   inspection.
2. If the subtree is widened: the live-bus writability test lists
   `/container/enabled` among the writable paths, and the item round-trips.
3. If the document is corrected instead: its claim about bus and MQTT
   reachability matches what the daemon exposes, and a test pins the
   read-only projection.
4. The answer is written down for the class, `mqtt` named alongside
   `container`.

## Files it is expected to touch

`os/pkgs/mosd/mosd/src/tree.rs`, `os/pkgs/mosd/mosd/tests/tree.rs`,
`docs/design/containers.md`, `docs/design/bus.md` if it carries the same
claim. PLAN-012 needs no further edit: its Amendment 1 already records the
divergence and routes it here.

## Dependencies

- **blocked by**: (none — claimable any time)
- **blocks**: any integrator documentation that promises MQTT control of the
  container switch.
