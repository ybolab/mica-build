# PLAN-081 Resolve the September repository audit findings

- **status**: completed
- **createdAt**: 2026-09-05 17:30
- **approvedAt**: 2026-09-05 17:30
- **completedAt**: 2026-09-05 18:16
- **relatedTask**: RFCT-330

## Context

The [audit](../audit/2026-09-05-repository-audit.md) reproduced stale-credential session issuance, partial provisioning persistence, and invalid UI installation requests. It also identified missing diagnostics write permission, asynchronous UI state and session recovery gaps, unauthenticated MQTT bridge connections, a stale preflight fixture, missing CI coverage, and nine documentation discrepancies. Existing baseline suites passed except the preflight fixture.

## Proposal

1. A01: coordinate session issuance with credential invalidation; verify concurrent password rotation rejects old-password sessions.
2. A02: make provisioning persistence recoverable as a whole; verify failure before and between writes preserves the prior committed configuration and restart recovery is deterministic.
3. A03-A06: send the installation body, grant only diagnostics directory write access, follow active update operations, and clear invalid browser sessions; verify actual request contracts and UI state transitions.
4. A07: add a secret-file-backed bridge credential input and verify it against the authenticated broker, without exposing passwords through settings, process arguments, or logs.
5. A08 and coverage: restore the preflight test's intended assertion and include package-preflight and update-server checks in CI; remove the obsolete mandatory API compatibility check while retaining specification correctness.
6. D01-D09: update current English and Chinese descriptions, retaining clearly historical records; verify documentation gates and update the audit with resolution evidence.

## Risks

Credential synchronization must not leave an issuance race or hold a synchronous lock across an await. Persistence spans DATA and STATE and needs explicit interrupted-operation handling. A diagnostics write exception must not broaden access to unrelated DATA paths. MQTT credentials must remain private and optional for anonymous deployments. UI polling must stop after operations settle and authentication failures must not be hidden as generic connectivity errors.

## Scope

Only the audited services, their tests and configuration, relevant CI gates, and affected documentation. No dependency upgrades, compatibility adapters, new update-server device protocol, firmware changes, commit, or push.

## Alternatives

Merely changing the atomicity documentation would retain the failed-import behavior. A UI-only installation mock would miss the actual API extractor contract. Disabling broker authentication would avoid its intended behavior. These alternatives do not meet the audit's acceptance criteria.

## Annotations

- The user approved implementation by explicitly requesting that the report's findings be fixed. Work proceeds under that instruction.
- Match the existing project gates and dependency stack; broad toolchain or architecture upgrades are outside this repair.

## Progress

- Investigation and audit evidence reviewed. Regression fixtures are available in the ignored audit output directory.
- A01-A08 implementations and regressions are in place. Focused credential, persistence, UI, MQTT, and preflight checks passed; the full UI gate passed 146 tests.
- Full Rust validation identified the expected generated OpenAPI description drift after documenting the installation body; regeneration is complete and the gate is being rerun.
- D01-D09 text has been reconciled. Several update-policy/trust details were already corrected at the repair baseline and were retained.
- A pre-existing concurrent edit in `verify/src/checks-update.ts` is preserved and is outside this task's implementation.

## Verification

- Credential rotation, failed persistence, UI installation/operation/session handling, MQTT authentication, and diagnostics sandbox regressions reproduced the original failures and passed after correction.
- The mosd workspace gate passed formatting, strict Clippy, 1,047 tests, doctests, and dependency checks. The generated OpenAPI document matches the binary.
- UI lint, type checking, 149 tests and coverage passed; the production build passed for the same implementation.
- Build tooling passed 920 tests; image verification passed 1,279 tests plus layout, API pins and UI build contracts. Offline policy/manifest gates, their negative fixtures, 25 package-preflight tests and DATA initialization passed.
- The clean-container update-server CI command passed 36 tests / 257 assertions, coverage, lint, type checking, standalone compilation and dependency audit. Its lint runtime is now explicitly Bun because Node and Bun classify built-in imports differently.
- The real systemd filesystem-policy probe denied diagnostics writes with the previous allowlist and allowed creation, reading and deletion with the fixed allowlist, while unrelated DATA remained read-only. It substitutes a probe for the daemon and tmpfs for device mounts; it is not a board API acceptance test.
- Documentation gates and their negative fixtures passed again after the report and tracking updates.
- Self-review with the shared, Rust and TypeScript frontend review criteria found no remaining actionable defect in the repair. Source changes, generated OpenAPI output and CI commands were reviewed together. All raw verification artifacts are under `_out/audit-fixes-20260905/`.

## Outcome

A01-A08 are resolved. D01-D09 are reconciled, including verification of corrections already present at the repair baseline. The updated audit retains original findings and failed evidence separately from repair results. Real-board/QEMU image acceptance, power cuts, physical provisioning and the deferred update-server device reader remain outside this repository repair. No commit or push was requested or performed.
