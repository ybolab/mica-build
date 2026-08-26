# RFCT-117 PLAN-016 M1: the utoipa scaffold, the two discovery endpoints and a committed spec

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-26 14:20
- **claimedAt**: 2026-08-26 14:25
- **completedAt**: 2026-08-26 15:05
- **plan**: PLAN-016 (M1)

Turn the reserved `/api` prefix into a served surface with two routes, and make
the OpenAPI document a build product of the handlers rather than a file anyone
maintains: generated from the code, printed by the binary, committed, and
asserted identical by a test.

## Scope

- `utoipa` at the workspace level; both response bodies and the error envelope
  are named types deriving `serde::Serialize` + `utoipa::ToSchema`.
- `GET /api/versions`, unauthenticated: `{"versions":["v1"],"current":"v1"}`.
- `GET /api/v1/meta`, session-authenticated:
  `{"api":"v1","settingsSchemaVersion":<SCHEMA_VERSION>,"daemon":"apid"}`,
  with the schema version read from `mosd_settings` and never copied.
- `apid --openapi` prints the document; `mosd/apid/openapi.json` holds those
  exact bytes.
- Everything else under `/api` keeps the answer it already gave, in both
  authentication states.

## Resolved dependency versions

From `mosd/Cargo.lock`: **utoipa 5.5.0**, **utoipa-gen 5.5.0**. The `axum_extras`
feature is off — it teaches the `path` macro to read axum's `Path`/`Query`
extractors, and no documented route takes a path or query parameter.

**`utoipa-axum` was added and then removed.** It is the idiomatic way to collect
routes straight out of the router (`utoipa-axum 0.2.0`, resolving alongside the
workspace's axum 0.8), but it depends on `paste 1.0.15`, which carries
RUSTSEC-2024-0436 (unmaintained). `mosd/deny.toml` sets `unmaintained = "all"`,
so `cargo deny check advisories` fails on it:

```
error[unmaintained]: paste - no longer maintained
    ├ ID: RUSTSEC-2024-0436
    ├ paste v1.0.15
      └── utoipa-axum v0.2.0
          └── apid v0.1.0
advisories FAILED, bans ok, licenses ok
```

Editing `deny.toml` to allow it was out of scope, so the crate went instead.
`utoipa`'s own `context_path` composes the prefix into the documented path and
gives the same result with one fewer dependency.

## Authentication: 401, not a redirect

An unauthenticated `GET /api/v1/meta` answers **401** with the error envelope of
`docs/design/api.md` §2.4, not the gate's redirect. The reason is §3.1: a client
that follows the redirect lands on `GET /login`, which answers 200 with an HTML
page, so a naive script reads the whole exchange as success — and publishing a
spec whose only authenticated route behaves that way would bake that into the
contract. `path` is omitted from the envelope: §2.4 defines it as the settings
dot-path at fault, and a request that failed to authenticate names none.

**Mechanism.** An `ApiSession` extractor (`FromRequestParts<AppState>`) whose
rejection is the envelope, rather than middleware attached with `route_layer`.
Both hold the invariants; the extractor was chosen because it needs no state at
router-construction time, which is what lets a process with no bus connection
and no key material build the same router to print the document, and because it
guards exactly the handlers that name it — the subtree's not-found handler and
`/api/versions` are untouched by it, with no path test deciding who is guarded.

The gate keeps one early hand-off, `is_declared_api_route`, which names the
paths this campaign declares and nothing else. It is composed from the same
`API` prefix and leaf constants the router and the `utoipa::path` attributes
use. Any path it does not name reaches the gate's existing logic unchanged, in
both gate modes; `MatchedPath` is not available inside `gate` because the
middleware is installed with `Router::layer`, which wraps the routing step, so
the predicate cannot be replaced by asking which route matched.

**M2 inherits the envelope type.** `ApiError`/`ApiErrorDetail` are the one shape
every failure under `/api/` takes, and the read-only routes reuse them. They
carry no `path` field yet; adding one is additive under §2.1's rules.

## Regenerating the spec

From `mosd/`:

```
cargo run -p apid -- --openapi > apid/openapi.json
```

`the_committed_openapi_document_is_the_generated_one` compares the generated
string against `include_str!("../openapi.json")` and prints that command when it
fails, so drift is a local `cargo test` failure and not only a CI one.

## Acceptance

- `GET /api/versions` answers 200 with the exact body, with no session cookie,
  in setup mode, and when the gate's own settings call fails.
- `GET /api/v1/meta` answers 200 with the exact body for a valid session, and
  401 with the envelope without one, in both gate modes.
- Every other path under `/api` answers the pre-existing not-found envelope
  byte for byte with a session, and the gate's redirect without one.
- `mosd/apid/openapi.json` is byte-identical to what `apid --openapi` prints,
  and documents both routes including the 401.
- `bash docs/verify-index.sh` exits 0.

## Known gaps

- `cargo fmt --all --check` reports two diffs in `mosd/mosd/src/main.rs:404`
  and `:446`. They predate this task — the file is untouched here, and the copy
  at the base commit fails `rustfmt --check` on its own — and `mosd/mosd/**` is
  outside PLAN-016's Scope, so they were left alone.
- The pinned `localhost/mos-build-rust` image ships no rustfmt, clippy,
  cargo-deny or dbus-daemon; CI installs all four. They were provisioned into
  the container to run the gate (rustfmt/rustc components matching the image's
  pinned 1.98.0, cargo-deny 0.19.5 at the sha256 `.gitea/workflows/check.yml`
  pins).

## Dependencies

- Follows PLAN-016's Context; M2 (RFCT-118) builds the read-only slice on the
  error envelope and the schema derives landed here.
