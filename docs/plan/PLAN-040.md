# PLAN-040 Select a retained custom UI from the built-in SPA

- **status**: completed
- **createdAt**: 2026-09-01 12:03
- **approvedAt**: 2026-09-01 12:47
- **relatedTask**: [RFCT-276](../task/RFCT-276.md)

## Context

PLAN-039 established the required boundary: `/ui` always serves the embedded
built-in SPA, `/` serves a valid active custom UI or redirects to `/ui`, and
all selection operations live under `/api`.

The current selector is one-way. `GET /api/v1/ui` calls `Store::status`, which
resolves only `/srv/ui/current`; when no pointer exists it returns `builtIn`
and does not inspect retained generations. `DELETE /api/v1/ui/active` removes
that pointer but deliberately keeps the bundle directory. `Store::generations`
can enumerate retained trees, while `Store::activate` only accepts a new
`.staging-N` tree and refuses an already-installed generation. There is no safe
method or API route that re-points `current` to an installed tree.

Consequently, testing only whether `/srv/ui` or `bundles/` exists would be
wrong. Those paths may contain an incomplete, corrupt, unreadable or
API-incompatible tree. Availability must mean that a specific installed
generation is safe to serve now.

The built-in System page already reads `GET /api/v1/ui` and offers the one-way
deactivation button. It uses TanStack Query and the shared root-relative API
client, so the UI change belongs there and needs no new state store or URL.

## Proposal

### 1. Inspect retained generations without changing the active pointer

Add a bundle-store inspection method for one installed generation and a helper
that chooses the newest usable retained generation. A candidate is usable only
when all of these hold:

- the generation is an installed directory under `bundles/`;
- the tree contains only the entry types accepted at installation;
- `index.html` is a readable regular file;
- an activation record exists and the current tree digest matches it;
- the manifest, when present, intersects the API versions this apid serves.

Inspection is read-only and never repairs or rewrites a bundle. Failed checks
are returned as a named unavailable reason for status display.

### 2. Extend the API as one resource

Keep `GET /api/v1/ui` backward compatible and add an optional
`availableCustom` member describing the selected retained candidate, including
generation, name/version when declared, and whether it is usable. Active mode
continues to be reported separately as `mode: builtIn | custom`.

Extend `/api/v1/ui/active` with `PUT` alongside the existing `DELETE`:

- `PUT` re-inspects the advertised generation, then atomically points
  `current` at it and returns the refreshed `UiStatus`;
- `DELETE` keeps its current behavior and returns status that still exposes the
  retained candidate;
- no usable candidate returns `409 custom_ui_unavailable` without changing
  the pointer;
- cookie-authenticated requests require the existing CSRF token, bearer
  requests follow the existing API credential policy;
- successful activation and no-op activation are written to the existing
  custom-UI audit event family.

The method takes no client-supplied path. The server chooses and validates the
candidate, so the route cannot be used to point outside the managed store.

### 3. Replace the one-way button with a labelled selector in `/ui`

Use the shadcn/Base UI switch primitive in the System page:

- checked means `/` currently selects custom;
- switching off calls `DELETE /api/v1/ui/active`;
- switching on calls `PUT /api/v1/ui/active`;
- the custom choice is disabled when no usable candidate exists;
- loading, mutation, unavailable and error states have visible text and status
  semantics;
- after selecting custom, the operator is offered an explicit link to `/`
  rather than being navigated away from the recovery UI automatically.

The switch changes only `/`; `/ui` itself always remains on the built-in SPA.

### 4. Pin the contract

Write failing Rust tests first for retained-candidate detection, successful
reactivation, corrupt/incompatible refusal, CSRF protection and preservation of
the `/ui` boundary. Add focused Vitest coverage for disabled/enabled switch
states and both mutations. Regenerate OpenAPI and extend the black-box/spec-pin
coverage for `PUT /api/v1/ui/active`.

## Risks

- A bundle may change between status and activation. The mutation therefore
  repeats every safety check immediately before changing the pointer; the GET
  result is informative, not authorization.
- Multiple retained generations make an implicit toggle ambiguous. Selecting
  the newest usable generation is deterministic and matches the existing
  pruning policy, but the response must name the generation so the choice is
  visible.
- A bundle deactivated automatically for corruption or incompatibility must
  not become selectable again. Requiring a matching activation record, current
  digest and current compatibility closes that loop.
- The existing design documents contain stale historical passages from the
  pre-SPA `/builtin` implementation. This task updates only the live contract
  summary needed for the new API and avoids broad historical rewrites.

## Scope

- `os/pkgs/mosd/apid/src/bundle.rs`: retained-generation inspection and atomic selection.
- `os/pkgs/mosd/apid/src/routes.rs`, `openapi.rs`, `openapi.json`: status shape and
  `PUT /api/v1/ui/active`.
- `os/pkgs/mosd/apid/src/tests.rs`: backend and boundary tests.
- `os/pkgs/mosd/apid/ui/src/app/routes/system.tsx`, UI types/components/tests and committed
  `ui/dist`: accessible selector and production assets.
- `os/pkgs/mosd/tests/apid-api`: route and contract pins.
- Focused API/dashboard design summaries and task/plan tracking.

No upload, delete, bundle editor, generation picker, automatic redirect or new
dependency is included.

## Alternatives

1. Check only whether `/srv/ui` exists. Rejected: the directory can exist with
   no valid installed bundle and says nothing about current safety.
2. Let the browser choose a filesystem generation. Rejected: it exposes storage
   layout through the API and makes the client responsible for a trust-boundary
   decision.
3. Store a separate `last-custom` pointer on deactivation. Not required for the
   initial selector; newest usable generation is deterministic and avoids a new
   piece of persistent state. Reconsider only if operators later need explicit
   rollback among several retained versions.
4. Keep the current one-way deactivation button. Safe but incomplete: it cannot
   answer the user's existence question or restore the retained UI.

## Annotations

- 2026-09-01: Initial proposal prepared after the user requested existence
  detection and a switch inside `/ui`.
- 2026-09-01: Approved by the user; implementation started.
- 2026-09-01: Completed with 238 Rust unit tests plus the process E2E test,
  8 SPA tests, zero-warning Clippy, OpenAPI spec pins (26/26), and a fresh x64
  QEMU image run (117/117). The guest run covered three parallel settings
  mutations, terminal task-list retention, live interface details, and the
  factory custom-UI selector conflict path.
