# PLAN-060 Move the built-in UI to `/_ui/`

- **status**: completed
- **createdAt**: 2026-09-01 23:58
- **approvedAt**: 2026-09-02 00:03
- **completedAt**: 2026-09-02 00:19
- **relatedTask**: [UI-006](../task/UI-006.md)

## Context

PLAN-059 made `/`, `/ui` and `/api` terminal ownership domains. That protects
the verity-covered recovery UI from a custom bundle, but it also permanently
claims the ordinary `/ui` name. A custom UI that uses `/ui` for its own route
or asset is intercepted by the built-in router instead of being served from
the active bundle.

The namespace is encoded at several layers. Axum nests the embedded VFS at
`/ui`; the built-in handler strips `/ui/`; the site root redirects to `/ui`;
and the custom asset resolver rejects `ui` as a reserved first segment. Vite
generates absolute `/ui/assets/...` URLs, TanStack Router uses `/ui` as its
basepath, active-navigation logic and both locale catalogs mention the same
path, and Rust/e2e tests plus current design, user and UI-development documents
assert that contract. The storage root `/srv/ui` and management operations
under `/api/v1/ui` are unrelated names and must not move.

## Proposal

### Public ownership contract

Replace the built-in ownership prefix with `/_ui` at every runtime layer:

| Domain | Behavior after migration |
|---|---|
| `/api` | Unchanged terminal JSON API domain. |
| `/_ui` | Terminal built-in embedded-VFS domain. Both `/_ui` and `/_ui/` reach the entry, while generated URLs and the root redirect use canonical `/_ui/`. Safe extensionless descendants use only the built-in SPA fallback. |
| `/` | Custom UI domain for every remaining path. In particular, `/ui` and `/ui/...` become ordinary custom routes/assets and may use the custom SPA fallback. |

Do not install a compatibility route, redirect or conditional fallback at
`/ui`. Such an alias would keep stealing the external namespace when a custom
bundle wants it and would make `/ui` behavior depend on activation state. Old
bookmarks must move to `/_ui/`; this is an intentional public-route break.

Keep structural Axum ownership and domain-local misses. Rename the nested
built-in router and its prefix stripping to `/_ui`. Change the custom logical
path guard from reserved first segment `ui` to `_ui`, including its one-decode
encoded-alias protection. Requests such as `/%5fui/...` must fail closed rather
than reach custom bytes, while literal `/ui/...` must be eligible for normal
custom resolution. `/apiary`, `/_uikit` and other prefix lookalikes remain
ordinary custom paths.

When no usable custom UI is active, `GET /` redirects to `/_ui/`. The existing
`/healthz` route remains a direct operational endpoint. The API selection
routes `/api/v1/ui` and `/api/v1/ui/active`, and the bundle store at `/srv/ui`,
retain their current names and semantics.

### Frontend and generated tree

Change Vite's public base to `/_ui/` and TanStack Router's basepath to `/_ui`.
Update sidebar active-route detection and all English/Simplified Chinese
recovery-address copy. No screen, component, dependency, theme or locale
behavior changes; the existing shadcn `base-nova` + Base UI + Spectrum token
boundary stays intact.

Rebuild the committed production tree so `dist/index.html`, dynamic-import
preload URLs and hashed chunks all refer to `/_ui/`. APID continues embedding
the whole generated tree at compile time; the VFS manifest format, MIME/cache
policy, lazy route/locale splitting and deterministic clean-build comparison
do not change.

### Tests and delivery sequence

1. Add a failing router test with a valid custom bundle containing a `/ui`
   asset or route. It must prove that `/ui` is served by the custom owner while
   the same bundle cannot shadow `/_ui`.
2. Add or migrate logical-path tests proving `_ui` and its encoded aliases are
   reserved, `ui` is allowed, guarded misses stay terminal, and prefix
   lookalikes remain custom-owned.
3. Rename built-in VFS, root redirect, asset-header, SPA-fallback and broken-
   bundle tests to the new namespace. Update the APID e2e discovery and HTTP-
   to-HTTPS path-preservation checks.
4. Change the Vite/TanStack base, active navigation and localized copy; run
   frontend tests and regenerate the committed `dist` tree.
5. Update current English and Chinese API/dashboard/remote-management/user
   documentation and the Chinese built-in UI development guide. Add a
   changelog entry. Historical research and completed PMA records remain as
   point-in-time evidence; this plan supersedes their old route contract.
6. Run focused RED-to-GREEN tests, Rust format/lint and APID tests/e2e, frontend
   lint/typecheck/tests/coverage/build determinism, and documentation gates.
   Deliver the approved work as one conventional commit.

## Risks

- Existing bookmarks, integrations and already-open tabs using `/ui` will no
  longer reach the built-in SPA. An old tab may also request immutable assets
  under the old prefix and receive 404. The no-store entry and a reload at
  `/_ui/` provide the intended recovery path; adding an alias would re-create
  the collision this migration fixes.
- Releasing `ui` in only the Axum router but not the custom logical-path guard
  would leave `/ui` unusable or make encoded aliases inconsistent. Route and
  pure-path tests therefore cover both layers.
- Changing only Vite's base or only TanStack Router's basepath would load the
  entry while breaking chunks or client navigation. The build artifact and
  direct-navigation tests must verify the complete prefix.
- Broad text replacement could incorrectly rename `/api/v1/ui`, `/srv/ui`,
  source folders such as `components/ui`, or historical records. Updates will
  be semantic and limited to the public built-in route contract.
- The public route change crosses operator and developer documentation in two
  languages. Documentation search gates must distinguish live guidance from
  historical research and completed PMA evidence.

## Scope

In scope: Axum built-in namespace and root redirect; built-in prefix parsing;
custom-root reserved-segment rules; strict ownership tests; Vite and TanStack
base paths; navigation state; English and Simplified Chinese recovery copy;
committed built assets; APID unit/e2e coverage; current API, dashboard, remote-
management, application, container, user and built-in UI development docs;
changelog and PMA records.

Out of scope: renaming `/api/v1/ui` or `/srv/ui`; changing the custom bundle
layout, validation, activation or upload mechanism; changing `/api` or
`/healthz`; adding an old-path compatibility mode; changing authentication,
screens, application features, i18n behavior, visual design, shadcn/Base UI,
Spectrum themes, VFS generation, caching or lazy-loading strategy.

## Alternatives

1. **Keep `/ui`.** This preserves compatibility but continues to make the
   path unavailable to external custom UIs; rejected because it does not solve
   the reported collision.
2. **Redirect `/ui` to `/_ui/`.** This helps old bookmarks but still captures
   `/ui` and prevents a custom UI from owning it; rejected.
3. **Redirect `/ui` only when no custom UI is active.** This creates state-
   dependent URL ownership and makes the same URL change meaning after
   activation; rejected.
4. **Use `/builtin` or another ordinary word.** It remains more collision-prone
   than an underscore-prefixed internal namespace and revives a previously
   removed name; not selected.
5. **Use `/_ui/` as the only accepted spelling and redirect bare `/_ui`.** A
   strict canonical redirect is possible, but serving both entry spellings
   matches the existing edge behavior and costs no namespace; generated links
   and the root redirect still use `/_ui/`.

## Annotations

- 2026-09-01: Created after the user requested that the built-in `/ui`
  namespace move to `/_ui/` so external custom UIs can safely use `/ui`.
- 2026-09-02: User approved the default migration, including releasing `/ui`
  without a compatibility alias and delivering the change as one commit.
- 2026-09-02: Implemented terminal `/_ui` ownership, released `/ui` to custom
  bundles, rebuilt the Vite tree, updated localized copy and synchronized all
  current route guidance. Rust, frontend, deterministic-build, e2e and docs
  gates passed; the submission review found no high-confidence issues.
