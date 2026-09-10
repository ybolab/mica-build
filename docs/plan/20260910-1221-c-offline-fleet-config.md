# 20260910-1221-c-offline-fleet-config Project offline fleet desired configuration

- **status**: implementing
- **createdAt**: 2026-09-10 12:21
- **approvedAt**: 2026-09-10 12:14
- **relatedTask**: 20260910-1221-c-offline-fleet-config

## Context

The existing linked `mosd-settings` library resolves the baked update manifest
and `/mos/config/updates.json`, while the authenticated provisioning-status
handler projects that resolver's `operator` and `effective` objects. Fleet is
currently reported from baked manifest values only. The established offline
pour stores strict subsystem documents under `/mos/config/`, and the approved
fleet slice assigns `/mos/config/fleet.json` to desired fleet configuration.
The route already has isolated manifest and updates path seams from C.D5.

The implementation branch merged reviewed local L2 commit
`31d7c109f983a3b41664104d21568e92783c81c0` before edits. That upstream retains
the approved `#313` source, C2 classification, and D5 route evidence.

## Proposal

1. Add a strict current-schema fleet document reader and fleet resolution to
   the existing configuration module. Missing input preserves baked defaults;
   every present invalid input fails closed.
2. Extend the existing provisioning projection with only raw present fleet
   keys and exact effective `enabled`, `reporting`, and `url` values.
3. Add the fixed production fleet path and one test-only isolated-path seam to
   `AppState`, then pass it into the existing resolver call.
4. Establish route-level RED first, implement the minimum GREEN, add focused
   resolver branches, and run the scoped Rust, API pin, documentation, and
   diff gates.

## Risks

- Collapsing absent and explicit-null URLs would lose operator intent.
- Parsing through a generic JSON value could hide duplicate keys; the strict
  document parse must reject them.
- Returning the document wholesale could expose rejected or future fields;
  projection stays an explicit allowlist.
- A production-configurable path would create an unintended trust redirect;
  only test builds may override the fixed path.

## Scope

Only `pkgs/mosd/mosd-settings/src/configuration.rs`, the minimal fleet-path
state and resolver call in `pkgs/mosd/apid/src/routes.rs` and
`pkgs/mosd/apid/src/provisioning_api.rs`, authenticated fixtures in
`pkgs/mosd/apid/src/tests/provisioning_api.rs`, and this task/plan with their
index rows may change. Repair 1's exact L1 handoff additionally permits only
the `mosd-settings/Cargo.toml` direct `url` dependency and that member's
existing-package edge in `pkgs/mosd/Cargo.lock`.

## Alternatives

- A second fleet resolver is rejected because all consumers must share one
  precedence implementation.
- Runtime writers, path configuration, endpoint probes, credentials, activity
  state, and compatibility readers are rejected as outside this offline slice.

## Annotations

- The campaign's approved bounded contract satisfies the proposal gate.
- Fleet protocol design is independent and grants no client or plane
  implementation in this slice.
- L2 D owns global changelog and reconciliation updates.
- The authenticated-route RED and focused GREEN are recorded in the related
  task. The initial scoped PMA-CR Rust review passed without findings.
- Repair 1 adds strict null-boolean and complete HTTPS URL contract evidence.
  The null-boolean finding was resolved first; the later exact handoff permits
  the existing workspace `url` crate to close the malformed-host finding
  without changing update-origin semantics or normalizing projected values.
- The final scoped PMA-CR Rust review passed without findings.
