# 20260910-1046-c-provisioning-resolution-tests Verify provisioning resolution through the API route

- **status**: completed
- **createdAt**: 2026-09-10 10:46
- **approvedAt**: 2026-09-10 10:46
- **completedAt**: 2026-09-10 11:27
- **relatedTask**: 20260910-1046-c-provisioning-resolution-tests

## Context

The authenticated provisioning status handler already projects baked metadata
and calls `mosd_settings::configuration::provisioning_status_at`, but its
operator updates path is fixed to the host location. Existing route tests can
verify response shape only; they cannot supply isolated operator documents or
prove the resolver's content, refusal, and redaction behavior through the real
router. The existing manifest-path field in `AppState` provides the local
test-seam pattern.

## Proposal

1. Add the smallest private updates-path field and test-only constructor/setter
   behavior to `AppState`, initialized from `DEFAULT_UPDATES_PATH` in production.
2. Pass that field to the existing `provisioning_status_at` resolver without
   changing resolver, route, authentication, or OpenAPI contracts.
3. Add deterministic authenticated router tests backed by temporary baked and
   operator documents for projection, precedence, absent-versus-null, explicit
   source clearing, fail-closed invalid input, and secret-safe responses.
4. Run the focused and relevant apid checks plus formatting, clippy,
   documentation verification, and scoped diff checks.

## Risks

- A seam exposed beyond existing test visibility could become an unintended
  production redirect for trusted configuration input.
- Route fixtures could accidentally read or modify `/mos/config`; all tests
  therefore use isolated temporary paths without process-global state.
- Error assertions must confirm both fail-closed status/code and absence of
  rejected secret or unprojected content.

## Scope

Only `pkgs/mosd/apid/src/routes.rs`,
`pkgs/mosd/apid/src/provisioning_api.rs`,
`pkgs/mosd/apid/src/tests/provisioning_api.rs`, this task and plan, and their
own index rows may change. Resolver, OpenAPI, UI, dependencies, historical
records, and changelog remain unchanged.

## Alternatives

- Adding a second reader or resolver is rejected because the current shared
  resolver is the contract under test.
- A CLI, environment, request, or public settings override is rejected because
  the path is only an isolated route-test seam.
- Host `/mos/config` fixtures are rejected because they would share state and
  violate deterministic test isolation.

## Annotations

- The campaign request pre-approved this exact C.D5 implementation slice.
- `AppState` now defaults its private operator-document path to
  `DEFAULT_UPDATES_PATH`; only test builds expose the isolated-path builder.
- The handler still uses `configuration::provisioning_status_at`; resolver,
  authentication, route, OpenAPI, UI, dependency, fleet, and trust behavior
  are unchanged.
- Route-level tests prove the current baked/operator/effective contract and
  fail closed on present unreadable, malformed, unknown-anchor, or invalid
  operator input without serving rejected sentinel values.
- Focused tests, the complete apid suite, formatting, clippy, documentation,
  and scoped diff checks passed in the pinned project toolchain. No physical
  hardware, kernel, root, QEMU, or full-image evidence was attempted.
