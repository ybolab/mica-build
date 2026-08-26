# PLAN-016 apid OpenAPI phase 1: utoipa-generated spec, discovery endpoints, a read-only resource slice, and a breaking-change gate

- **status**: approved
- **createdAt**: 2026-08-26 14:10
- **approvedAt**: 2026-08-26 14:20
- **relatedTask**: RFCT-117 (M1), RFCT-118 (M2), RFCT-119 (M3), RFCT-120 (M4) — task files created by the executing workstream as each milestone starts
- **milestones**: M1 utoipa scaffold + discovery endpoints; M2 read-only resource slice; M3 the oasdiff breaking-change CI gate; M4 apid comment simplification (PLAN-015 carve-out)

## Context

apid serves only server-rendered HTML forms. The `/api` subtree is reserved
and 404s everything (`mosd/apid/src/routes.rs:184-185`). `docs/design/api.md`
specifies the contract: version in the path (`/api/v1/...`), exhaustive
breaking-vs-additive lists (§2.1), one error schema (§2.4), discovery via
unauthenticated `GET /api/versions` and authenticated `GET /api/v1/meta`, and
a client obligation to ignore unknown fields. Today every one of those rules
is prose; no mechanism checks any of them.

Registry versions verified 2026-08-26 at crates.io: `utoipa` 5.5.0,
`utoipa-axum` 0.2.0 (binds to the workspace's axum 0.8). Spec diffing:
`oasdiff` (standalone Go binary) classifies OpenAPI changes as
breaking/non-breaking. *(Amendment 1, 2026-08-26: utoipa-axum was dropped at
implementation — see Decisions item 4.)*

## Decisions (user-set, 2026-08-26)

1. The utoipa approach is ratified: the OpenAPI document is generated from
   code at compile time, committed to the repo, and CI asserts the committed
   copy is identical to the regenerated one — spec and implementation cannot
   drift.
2. Phase 1 is the bounded first slice, not api.md §2/§3 in full. Bearer
   tokens (§3.2), write operations, collection resources, and actions are
   explicitly deferred. `/api/v1/*` authenticates with the existing session
   cookie for now.
3. Breaking-change policy is enforced by machine: oasdiff in CI compares the
   PR's committed spec against the base branch's; a breaking classification
   fails the check, which is api.md §2.1's rule made mechanical.
4. *(Amendment 1, ratified at integration, 2026-08-26.)* `utoipa-axum` is
   dropped. Its 0.2.0 release depends on `paste` 1.0.15 (RUSTSEC-2024-0436,
   unmaintained), which `mosd/deny.toml`'s `unmaintained = "all"` escalates
   to an error. The supply-chain gate outranks the composition convenience:
   routes are declared with utoipa's `context_path` instead, the generated
   document is identical at the wire, and the dependency delta shrinks to
   `utoipa` + `utoipa-gen`. Widening deny.toml was rejected — that would
   permanently loosen the appliance's advisory gate for a build-time
   convenience.

## Proposal

- **M1 (RFCT-117)** Dependency `utoipa` added at the workspace level
  (latest stable, pinned like siblings); route/document composition uses
  utoipa's `context_path`, not utoipa-axum (Decisions item 4). `GET /api/versions`
  (unauthenticated, `{"versions":["v1"],"current":"v1"}`) and
  `GET /api/v1/meta` (session-authenticated,
  `{"api":"v1","settingsSchemaVersion":<SCHEMA_VERSION>,"daemon":"apid"}`)
  per api.md §2.1, replacing the 404 fallback only for these routes. A
  `mos-apid-openapi` bin target (or `--openapi` flag) prints the spec;
  `mosd/apid/openapi.json` committed. Tests first (RED-GREEN): route tests
  for both endpoints and a spec-regeneration identity test.
- **M2 (RFCT-118)** Read-only slice: `GET /api/v1/state/<dot-path>` and
  `GET /api/v1/settings/<dot-path>` mapped onto the existing bus client, with
  the structural redaction rule (field-name keyed: `psk`, `passwordHash`,
  `password_hash`, `hash` at any depth) and the single error schema of
  api.md §2.4 (translated classification, `source` named, mosd message passed
  through). Every route and schema derives `utoipa::ToSchema`/`#[utoipa::path]`
  so the committed spec covers the full served surface.
- **M3 (RFCT-119)** CI: a check job regenerates the spec and diffs it against
  the committed file (fail on drift), then runs oasdiff against the base
  branch's spec (fail on breaking). Gitea workflow only; no new host tooling
  outside the pinned build images.
- **M4 (RFCT-120)** `mosd/apid/` comment simplification under PLAN-015's
  taxonomy, triage rule, and MUST-KEEP list (notably
  `apid/src/persist.rs:17-22` durability, `tls.rs`/`auth.rs` mode bits,
  `routes.rs:1839-1846` nested MQTT shape, bcrypt-72 and fingerprint-format
  facts, `startup.rs` "never returns an error" rule kept at ~4 lines).
  Worst files measured: `routes.rs` (534 comment lines, ~45% narrative),
  `startup.rs`, `assets/serve.rs`, `tests/broken_classes.rs`, `tests.rs`,
  `main.rs:57-79`. Estimated net reduction ~50%.

## Risks

- The gate currently 404s `/api` wholesale and its middleware calls
  `GetSettings("access")` per request; new routes must thread the existing
  auth layer, not bypass it. Mitigation: route tests assert 401/redirect
  behaviour for unauthenticated `/api/v1/meta` and success for `/api/versions`.
- First spec commit has no base to diff against; the oasdiff step must
  no-op when the base branch lacks `openapi.json`.
- Workspace dependency addition must pass `mosd/hack/check.sh`
  (advisories/bans/licenses).
- Concurrent with PLAN-015 M1-M3: write scopes are disjoint
  (`mosd/apid/` + workspace manifest vs everything else); the workspace
  `Cargo.toml`/`Cargo.lock` is the one shared file — PLAN-015 does not touch
  manifests, so conflicts are not expected.

## Scope

- **In**: `mosd/apid/**`, `mosd/Cargo.toml` + `mosd/Cargo.lock` (dependency
  addition only; utoipa without utoipa-axum per Decisions item 4), `.gitea/workflows/check.yml` (spec-identity + oasdiff
  steps), `mosd/apid/openapi.json` (new, committed).
- **Out**: bearer tokens and §3.2 token storage, write/action routes,
  collection resources, `test/apid-api/` phases (later phase), `mosd/mosd`
  and `mosd/mosd-settings` sources, docs/design/api.md rewrites (PLAN-015
  M5 owns docs), any change to the HTML form surface.
