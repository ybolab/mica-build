# PLAN-079 Build the update server and release console

- **status**: completed
- **createdAt**: 2026-09-04 21:02
- **approvedAt**: 2026-09-04 21:02
- **relatedTask**: FEAT-001

## Context

The user requested a TypeScript + Bun update server and simple control platform in `update-server/`, and waived development-stage backward compatibility. PLAN-070 and PLAN-071 choose package signatures, baked immutable public keys, device version floors and expiring metadata. The current `rauc-update` still consumes TUF; the new reader is outside this task. No existing remote format implements the approved replacement.

## Proposal

Build one Bun service with Hono, Zod, Drizzle and `bun:sqlite`, plus a small TypeScript browser console. Bun's SQLite driver keeps the executable self-contained; database encryption is out of scope. Plain Hono avoids a separate API documentation application for this small service. Reuse MOS console colors and restrained surfaces.

An environment-supplied administrator token authenticates console sessions and automation. Browser sessions use hashed opaque tokens in SQLite, HttpOnly/SameSite cookies, origin validation and bounded login attempts. Generate the development token locally without printing it. Secrets and runtime data stay ignored.

Releases start as drafts with board, channel, version label, integer epoch and notes. Upload one immutable `.raucb` through a bounded stream; calculate SHA-256, flush and rename before committing its record. Publication and withdrawal atomically update the audit trail and catalog. Published epochs cannot decrease within a board/channel or be reused. Devices enforce their own floor independently. Withdrawal changes discovery; it cannot revoke a downloaded package.

`GET /v1/manifest.json` returns an Ed25519 envelope containing base64 UTF-8 JSON payload bytes and their signature. Payload includes schema, revision, issue/expiry times, board/channel pointers and published releases with artifact SHA-256, size and URL. Exact payload bytes are signed to avoid cross-language JSON reserialization. Persist the envelope; reads never renew expiry. Explicit refresh or publication changes renew it. Expose raw 32-byte public keys and SHA-256 identifiers for provisioning, never automatic device adoption. This key is distinct from RAUC signing keys; the server does not mint or claim to validate RAUC signatures.

Downloads support GET/HEAD, ETag and a single byte range. Draft and withdrawn artifacts are not public. Console functions: filtering, create/upload, publish/withdraw confirmation, refresh, connection/trust details and audit history. No fleet management, remote command execution, arbitrary URL imports, legacy adapter or OS-client changes.

## Risks

- The current device client cannot consume the new envelope until its reader is implemented.
- Metadata uses an online Ed25519 key, supplied as PKCS#8 or generated locally for development. It is not a RAUC signer.
- Uploaded bundles are publisher-approved bytes; devices retain independent RAUC CMS/keyring verification.
- Single-instance filesystem/SQLite service. Deploy behind HTTPS and back up the complete data directory, including signing material, with restrictive access.
- Metadata needs explicit renewal before expiry; show expiry and a renewal action in the console.

## Scope

Only `update-server/` and required task/plan/changelog records. No existing build, trust or OS-runtime changes.

## Verification

1. RED tests for authentication and draft/upload/publish/discovery/download; implement with real SQLite and temporary files.
2. Verify signatures/tampering, expiry persistence, ranges, invalid input, ordering, upload races, CSRF and session persistence.
3. Run lint, typecheck, coverage and standalone build; smoke the executable from another directory.
4. Browser-test login, upload, publication, withdrawal and responsive layout with isolated data.

## Alternatives

A React SPA adds unnecessary dependencies to this small form/table console. TUF preserves a protocol the project has decided to replace. Object storage and a shared database can follow actual deployment needs.

## Annotations

- 2026-09-04: Implementation was directly requested in this session. The server proceeds under that request; no device-runtime or trust-anchor changes are authorized by this record.
- TypeScript is pinned to 6.0.3 (latest stable 6.x verified at npm). The latest 7.0.2 compiler passes type checking, but typescript-eslint explicitly aborts on TypeScript 7 and supports `<6.1.0`. Revisit when its compiler-API support is released. All other direct versions were verified against npm stable tags.
- Override transitive esbuild to npm stable 0.28.2: drizzle-kit's legacy loader pulls vulnerable 0.18.20 (GHSA-67mh-4wv8-2f99). Verify migration generation after the override; this dependency is used by development tooling only.

## Delivery

The service is implemented in `update-server/`. On a fresh checkout, run `bun install --frozen-lockfile`, `bun run init`, and `bun run dev` there. Initialization writes a random administrator token to the ignored, mode-0600 `.env` and refuses to overwrite an existing file. Development uses the origin injected by nsl unless `PUBLIC_URL` explicitly selects an external origin. `bun run start` runs directly; configure `PUBLIC_URL` to match the browser address. `bun run build` creates `dist/mos-update-server`, with the console and initial database migration embedded. `DATA_DIR` is resolved once at startup; use an absolute path for deployment.

| Method | Route | Access and behavior |
| --- | --- | --- |
| GET | `/healthz` | Public database/catalog health |
| GET / POST / DELETE | `/api/session` | Read login state, exchange administrator token for a cookie, log out |
| GET / POST | `/api/releases` | Administrator: list records or create a draft |
| PUT | `/api/releases/:id/artifact` | Administrator: raw `application/octet-stream` upload |
| POST | `/api/releases/:id/publish` | Administrator: publish a complete draft |
| POST | `/api/releases/:id/withdraw` | Administrator: withdraw a published release |
| POST | `/api/metadata/refresh` | Administrator: issue a new catalog revision and expiry |
| GET | `/api/status`, `/api/audit` | Administrator: connection/trust details and latest 100 events |
| GET | `/v1/manifest.json` | Public signed catalog; exact payload bytes are base64 encoded |
| GET / HEAD | `/v1/artifacts/:id` | Public published artifacts, with ETag and single byte ranges |

Automation uses `Authorization: Bearer <ADMIN_TOKEN>`. Cookie mutations require the configured origin. Release input is `{ board, channel, version, epoch, notes? }`; boards are `cx3576`/`x64`, channels are `stable`/`beta`/`dev`. The service hashes uploaded bytes but does not certify RAUC bundle validity. The device reader must verify the envelope against its preinstalled public keys, validate its payload schema and expiry, select its board/channel, enforce its local epoch floor, verify the artifact size/digest, and then invoke RAUC's independent verification/install path. That reader remains outside this delivery.

## Verification results

- `bun run check`: lint, strict typecheck, 36 tests (257 assertions), coverage and standalone compilation passed. Backend line coverage is 98.89%; function coverage is 99.39%. Browser code and bootstrap are not included in that coverage figure.
- `bun audit`: no reported vulnerabilities. Frozen installation and `bun run db:generate` passed; no schema drift.
- A real HTTP regression test reproduces Bun 1.4 losing file-slice offsets in optimized responses. The range path now streams through a bounded transform; GET ranges and HEAD lengths pass over an actual listener.
- Browser verification ran against the compiled executable launched from a different working directory: login, empty state, create/upload, publish, normal/range downloads, filtering, metadata renewal, audit history, mobile layout, withdrawal and logout passed with no browser errors. Release notes containing HTML remained inert text. A mobile overflow caused by an absolutely positioned accessible table heading was reproduced and fixed by containing it in the table scroller.
- Test releases and keys stayed in isolated `_out/update-server-checks/browser-data*` directories. The delivered development service uses a fresh `update-server/.data/` directory. No OS trust files were modified.
- `make docs-verify` and `git diff --check` passed. Local review found no remaining blocking issue in the delivered scope.
