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
- Review amendment 1 is preapproved on the same completed classification; no
  lifecycle transition or new task/plan record is required.
- L1 accepted the recovered 10:24:08 and 10:34:08 stalls after normal
  completion was confirmed at 10:55:17. The 10:57:22 code-137/SIGKILL was the
  deliberate release of an already verified idle process; none of these
  diagnostics invalidates the original result.

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

## Original Result

This completed milestone and its baseline-specific evidence are preserved. The
complete matrix and original dependency candidates are in
[`20260910-1012-c-fleet-app-trust-obligations.md`](../plan/20260910-1012-c-fleet-app-trust-obligations.md).

- Classification: 20 already delivered, 10 superseded, 20 valid
  implementation obligations and 15 unresolved product decisions, across 65
  atomic obligations.
- Fleet: the approved local product is outbound registration plus narrow state
  reporting, off by default. The historical local config/report/thermal/buffer
  obligations remain valid; the amendment below determines whether any are
  dispatchable in this campaign. The outbound client is blocked by missing
  registration/report endpoint, credential and external-service contracts.
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
- Original candidate labels: `APP-INVENTORY`, `APP-TRUST`, `APP-ADMIT`,
  `APP-SECRETS`, `APP-AUDIT`, `APP-ROLLBACK`, `FLEET-CONFIG`, `FLEET-REPORT`,
  `FLEET-THERMAL`, `FLEET-SCHEDULE`, `FLEET-BUFFER`, `FLEET-STATUS`,
  `FLEET-CLIENT-SAFETY`, `FLEET-CONSOLE`, `FLEET-AUTONOMY` and `FLEET-DOC`.
- Shared path needs: obtain L1 handoff before future edits to `rootfs/`, build
  producers, `build/`, `verify/`, release publication/signing,
  `pkgs/mos-boot/`, `pkgs/mos-deploy/` or board paths. Issue #313 currently
  overlaps `build/`, `verify/`, `pkgs/mos-deploy/` and boards. The amendment
  adds the required C.D5 dependency for the only bounded backend proposal.
- Grant needs: future QEMU autonomy and runtime rollback proofs require an
  expensive grant. Physical cx3576 watchdog/USB/power-cut proof remains a
  separate board obligation.
- The amendment consolidates the original open-choice list into two reviewable
  briefs without reopening established answers.

## Original Verification

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

## Review Amendment 1

### Upstream synchronization and targeted refresh

- Began clean on branch `bkd/3nblyzz4` at original documentation commit
  `012c1902967728fc2e542e09c77860f314fdc4f4`; the original evidence baseline
  is an ancestor.
- Resolved local `bkd/58sdocnk` exactly at
  `fa51970ca32c2a7d16f809134e78d249c0a1f897`, verified it contains approved
  source `5d0dca577a782aa707d9530779c4b23f2a7eda31`, and merged it noninteractively
  as `0f81c0ce5d501dec41b2a3170ad6b6f9f6b99c52`. Conflicts were limited to the
  anticipated append blocks in `docs/task/index.md` and `docs/plan/index.md`;
  both upstream and C2 rows were retained without changing another owner's
  status.
- Targeted reads at the synchronized HEAD confirmed the existing chain:
  offline `/mos/config/` pour → `configuration::provisioning_status_at` →
  authenticated `GET /api/v1/provisioning/status`. The current resolver still
  states that `fleet.json` is absent and returns baked `fleet.enabled`/`url`
  only. No registration client, activity projection, app manager or fleet
  manager was inferred.

### Disposition

- Historical totals remain 65 unique IDs: 20 already delivered, 10
  superseded, 20 valid historical implementation obligations and 15 unresolved
  product decisions. Delivered rows split into eight design approvals, ten
  software mechanism/test acceptances and two documentation outcomes.
- Presently dispatchable application/fleet slices: **zero**. `FLEET-CONSOLE`
  remains historically valid but is campaign-excluded UI work. Consumerless
  crates, registries, daemons, buffers, routes and libraries are deferred.
- `FLEET-CONFIG` is the only bounded conditional backend proposal. It reuses
  the existing offline pour and provisioning-status projection, reports desired
  operator/effective settings only, creates no connection state and opens no
  network. It depends on C.D5 (`g4if0wrb`) being reviewed and merged into local
  `bkd/58sdocnk`, followed by a fresh scoped approval and upstream sync.
- The two decision briefs now ask only: (A) integrate the user-specified
  existing plane with complete wire/credential/retry contracts or defer the
  client; (B) approve the proposed pure-local curated OCI catalog and
  independent baked Ed25519 application-publisher trust contract or defer
  managed activation. Neither brief authorizes a service, tool, caller,
  endpoint, credential, network connection or shared signing/build edit.
- New shared overlap before implementation: any baked application anchor,
  catalog producer, app/fleet package/unit, rootfs/build/verify/signing or
  release-publication edit requires an exact new L1 handoff. Current
  C.D2/C.D3/C.D4 grants do not cover it.

### Amendment Verification

- `make docs-verify` — PASS (log:
  `/tmp/mos-c2-amend-docs-verify.log`): index 195/195, links 509/509,
  truth-status 724/724, Chinese coverage 249/249 and board dossier 131/131.
- `git diff --check` — PASS (log:
  `/tmp/mos-c2-amend-diff-check.log`, empty on success).
- Obligation recount and uniqueness — PASS: 65/65 unique, split 20 already
  delivered, 10 superseded, 20 valid historical implementation and 15
  unresolved product decisions. The candidate table maps all 20 valid rows,
  and exactly two decision briefs remain.
- Scoped path/link inspection — PASS: the amendment changes only this task and
  its related plan; the upstream merge changes the two anticipated indexes and
  preserves both parents' rows.
- PMA-CR documentation self-review — PASS with no blocking, high or medium
  findings: claims are evidence-scoped, proposed formats/callers are labeled
  absent and unauthorized, no secret/key material is present, and zero
  dispatchable slices is stated consistently.
- No Rust/Bun, image, QEMU, board or power-cut matrix is required or claimed.
