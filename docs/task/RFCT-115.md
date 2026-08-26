# RFCT-115 PLAN-015 M2: function-oriented comments in mosd/, excluding apid

- **status**: in-progress
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-26 16:40
- **claimedAt**: 2026-08-26 16:40
- **plan**: PLAN-015 (M2)

Apply PLAN-015's triage rule to `mosd/` excluding `mosd/apid/` (PLAN-016) and
`mosd/hack/` (M3): delete the C1-C4 classes outright, rewrite the C5-C7
survivors into short present-tense statements, and leave every MUST-KEEP item
standing. Module doc comments shrink to what the module does and its
invariants.

## Scope

- **In**: `mosd/mosd/`, `mosd/broker/`, `mosd/busname/`, `mosd/mqttd/`,
  `mosd/mosd-settings/`, including their `tests/*.rs` and `dist/` unit files.
- **Out**: `mosd/apid/**` (PLAN-016 M4), `mosd/hack/**` (PLAN-015 M3),
  every `Cargo.toml` and `Cargo.lock`.
- Comment and blank-line changes only. No executable Rust line changes.

## Acceptance

- `git diff bkd/fxykktxe...HEAD` over the area is comment/whitespace-only plus
  the two `docs/task/` files.
- Every MUST-KEEP item that lives in this area survives; anything reworded is
  quoted before and after below.
- All gates green.

(Filled in at close.)
