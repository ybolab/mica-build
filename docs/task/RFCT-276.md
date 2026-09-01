# RFCT-276 Add a recoverable built-in/custom UI selector

- **status**: completed
- **priority**: P1
- **owner**: codex/ui-selector-20260901
- **createdAt**: 2026-09-01 12:03
- **plan**: [PLAN-040](../plan/PLAN-040.md)

## Description

The built-in SPA can report and deactivate an active custom UI, but after
deactivation `GET /api/v1/ui` reports only `builtIn`. The installed bundle is
still retained under `/srv/ui/bundles/`, yet neither the API nor `/ui` can say
that a reusable custom UI exists or select it again.

Expose one validated custom-UI candidate through the management API and add a
built-in/custom selector to the always-reachable `/ui` SPA. A bundle must not
be selectable merely because a directory exists: its tree, recorded digest,
current API compatibility and readable `index.html` must all pass before the
API advertises it as available or points `current` at it.

## Acceptance

- `GET /api/v1/ui` distinguishes the active selection from the existence and
  health of a retained custom UI candidate.
- With no installed usable custom bundle, `/ui` shows the built-in selection
  and disables the custom choice with a clear explanation.
- With a usable retained bundle, `/ui` can switch between built-in and custom
  without uploading, deleting or modifying the bundle tree.
- Selecting custom uses a CSRF-protected `/api` mutation, validates the bundle
  immediately before atomically changing the `current` pointer, and records an
  audit event.
- A missing, unreadable, corrupt or API-incompatible bundle cannot become
  active; the previously selected UI remains unchanged and the API returns its
  standard JSON error envelope.
- `/ui` remains the unconditional built-in recovery path after either
  selection, and custom assets cannot shadow `/ui` or `/api`.
- Rust tests, SPA tests/build, OpenAPI and black-box contract pins agree with
  the selector behavior.

## ActiveForm

Adding a validated built-in/custom UI selector.

## Dependencies

- **blocked by**: (none)
- **blocks**: UI flows that need to return to an installed custom bundle after using the built-in escape

## Notes

- Raised from the user's request to detect whether a custom UI exists and put
  a built-in/custom switch inside `/ui`.
- Investigation and proposal are tracked in `docs/plan/PLAN-040.md`.
- Verification: `cargo test` passed 238 unit tests and the process E2E test;
  the SPA passed 8 tests, build, lint and typecheck; Clippy and rustfmt passed;
  OpenAPI pins passed 26/26; the fresh x64 QEMU run passed 117/117 checks.
