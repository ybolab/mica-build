# 20260910-1012-c-fleet-app-trust-obligations Classify fleet application and trust obligations

- **status**: completed
- **priority**: P1
- **owner**: worker-c/3nblyzz4
- **createdAt**: 2026-09-10 10:12
- **relatedPlan**: [20260910-1012-c-fleet-app-trust-obligations](../plan/20260910-1012-c-fleet-app-trust-obligations.md)

## Description

Classify the bounded PLAN-054, PLAN-069, PLAN-072, PLAN-076, PLAN-077, and
RFCT-305 obligations against the committed current design, API, code, and test
evidence. Produce implementation-ready dependency slices and isolate unresolved
product or external-service contracts without changing production code.

## ActiveForm

Classifying fleet application and trust obligations against the current tree.

## Dependencies

- **blocked by**: (none)
- **blocks**: L2 workstream C implementation dispatch decisions

## Notes

- The campaign proposal and this bounded classification were approved before
  dispatch.
- Evidence baseline: `5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`.

## Investigation

- Verified branch `bkd/3nblyzz4`, clean initial status, HEAD
  `5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`, and that the recorded baseline is
  an ancestor. Local `main` matched it during evidence collection, then advanced
  to `5d0dca577a782aa707d9530779c4b23f2a7eda31` during final verification. That
  S905X5M integration was not merged; it touches shared build, verify,
  `mos-deploy` and board paths, so L2 must refresh those current-delivery seams
  before dispatching dependent implementation.
- Read PLAN-054/069/072/076/077, RFCT-305 and their directly linked task
  records. RFCT-287 and RFCT-297 were pruned from the current tree, so their
  committed historical versions were read without restoring them.
- Compared those obligations only with the dispatched current design, API,
  Rust/Bun source and test paths. The OpenAPI path list contains no app catalog,
  application-management or fleet route, and focused source/package searches
  found no `mos-appd` or `fleetd` implementation.
- Inspected the current device trust-grade observer, diagnostics projection,
  signed-file release refusal, packed-root public-default check and executable
  release fixture. No existing software/image test was rerun: this unit is a
  documentation audit with no expensive grant.

## Result

The complete matrix and dependency details are in
[`20260910-1012-c-fleet-app-trust-obligations.md`](../plan/20260910-1012-c-fleet-app-trust-obligations.md).

- Classification: 20 already delivered, 10 superseded, 20 valid
  implementation obligations and 15 unresolved product decisions, across 65
  atomic obligations.
- Fleet: the approved local product is outbound registration plus narrow state
  reporting, off by default. Local config/report/thermal/buffer primitives are
  bounded work; the outbound client is blocked by missing registration/report
  endpoint, credential and external-service contracts. NAT support, targeting,
  rollout, command audit and break glass remain separate product decisions.
- Applications: PLAN-069's schedule trigger now holds. The selected production
  target is local vendor-curated signed OCI; the five OCI enforcement controls
  remain valid. Optional integrator enrollment is later and off by default;
  native admission is later and lacks its identity/sandbox choice; public
  marketplace and fleet rollout remain out of scope.
- Trust: G1, G3, current publication refusal, G5 and current documentation are
  delivered. Historical RAUC/TUF/lode, baked `trust.signingKeys`, the old
  source/image biconditional and mutable STATE rotation proposal are
  superseded by strict `mos-deploy` file deployments and authenticated-kernel
  anchors. Production custody ceremony remains an operational choice. The old
  unrun x64 image gate is an evidence limit, not a current blocker by itself.
- Proposed implementation slices: `APP-INVENTORY`, `APP-TRUST`, `APP-ADMIT`,
  `APP-SECRETS`, `APP-AUDIT`, `APP-ROLLBACK`, `FLEET-CONFIG`, `FLEET-REPORT`,
  `FLEET-THERMAL`, `FLEET-SCHEDULE`, `FLEET-BUFFER`, `FLEET-STATUS`,
  `FLEET-CLIENT-SAFETY`, `FLEET-CONSOLE`, `FLEET-AUTONOMY` and `FLEET-DOC`.
- Shared path needs: obtain L1 handoff before future edits to `rootfs/`, build
  producers, `build/`, `verify/`, release publication/signing,
  `pkgs/mos-boot/`, `pkgs/mos-deploy/` or board paths. Issue #313 currently
  overlaps `build/`, `verify/`, `pkgs/mos-deploy/` and boards. Library/API work
  wholly under `pkgs/mosd/` is otherwise independent.
- Grant needs: future QEMU autonomy and runtime rollback proofs require an
  expensive grant. Physical cx3576 watchdog/USB/power-cut proof remains a
  separate board obligation.
- L1 choices are bounded in the plan: fleet registration wire, report ingest,
  external plane operations, NAT support channel, curated application signing,
  optional integrator enrollment, managed-native identity/sandbox, production
  key ceremony and the conditional device-time rotation trigger.

## Verification

- `make docs-verify` — PASS: index 195/195, links 506/506, truth-status
  718/718, Chinese coverage 249/249 and board dossier 118/118.
- `git diff --cached --check` — PASS after staging the four scoped files.
- Changed-path inspection — PASS: only this task, its related plan and their
  two index rows changed.
- Classification recount — PASS: 65 atomic rows split into 20 already
  delivered, 10 superseded, 20 valid implementation work and 15 unresolved
  product decisions.
- No Rust/Bun, image, QEMU, board or power-cut gate was run; no expensive grant
  was available or required for this documentation classification.
