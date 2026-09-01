# PLAN-059 Embed isolated UI asset trees

- **status**: completed
- **createdAt**: 2026-09-01 23:18
- **approvedAt**: 2026-09-01 23:29
- **completedAt**: 2026-09-01 23:54
- **relatedTask**: [UI-005](../task/UI-005.md)

## Context

APID currently has three UI/API ownership domains. `/` serves an active
custom bundle from `/srv/ui` and otherwise redirects to `/ui`; `/ui` is the
always-available built-in SPA; `/api` owns the management API and its JSON
not-found response. This is already the correct product model, but the
built-in implementation is artificially limited to three files:
`index.html`, `assets/app.js` and `assets/app.css` are named individually by
three `include_bytes!` calls and three Axum routes. Vite consequently disables
TanStack route code splitting, fixes those output names and compiles both
locales into one 556,002-byte JavaScript entry. The current build emits Vite's
500 kB chunk warning.

There is no matching three-file restriction in the delivery gate. The UI
`run.sh` already builds into a temporary directory and recursively compares
the complete output tree with committed `dist`. Rust and image builds consume
that committed tree; they do not need to run Bun or Vite. The fixed list is
therefore an implementation accident, not a packaging or verity requirement.

The custom root already has strong filesystem traversal protection: request
paths are decoded once, parent components, residual escapes, NUL, backslashes
and symlinks are rejected, and the canonical result must stay below the active
bundle root. One documented gap remains: the resolver strips all leading
slashes. A request such as `//api/versions` misses Axum's `/api` namespace and
can resolve to a custom bundle's `api/versions` file. Encoded spellings of a
reserved first segment have the same ownership ambiguity. This does not
replace the real API route, but it exposes another spelling of a reserved name
through the wrong resource tree and violates the required no-crossing rule.

The built-in fallback has a second asymmetry: it decides only from the final
segment's dot and does not run the shared hostile-path checks. A guarded miss
such as `/ui/%252e%252e` can therefore return the built-in index rather than a
404. A recursive embedded tree must not inherit that behavior.

The existing unauthenticated `/healthz` listener-liveness probe is not an
asset tree. This plan leaves that operational endpoint explicitly declared and
outside every asset resolver; the three domains below refer to UI/API request
ownership and do not migrate or remove the boot probe.

## Proposal

### Three ownership domains

Keep the existing public ownership model and make it explicit in the router:

| Domain | Owned requests | Resolver and miss behavior |
|---|---|---|
| `/api` | Exactly `/api` and descendants beginning `/api/` | API router only; declared operations answer normally and every miss uses the JSON API 404. It never invokes either UI resolver. |
| `/ui` | Exactly `/ui` and descendants beginning `/ui/` | Built-in embedded tree only; exact assets are served, a safe extensionless GET/HEAD may fall back to the built-in `index.html`, and all other misses are 404. It never consults `/srv/ui`. |
| `/` | Every remaining UI path, including names such as `/apiary` and `/uikit` | Active custom tree only; the existing file/SPA rules remain. Exact `/` serves its index or redirects to `/ui` when no usable custom UI is active. It never consults built-in assets directly. |

Use Axum nesting and domain-local fallbacks so ownership is structural. Keep
the measured explicit `/api/` and `/ui/` edge declarations where Axum nesting
does not claim a trailing-root spelling. An asset miss is terminal inside its
owner: no handler may try another root after lookup fails.

The existing `/healthz` route stays a direct liveness handler before the root
fallback. It is neither a fourth resource tree nor eligible for asset lookup.

### One safe logical asset path

Refactor the pure portion of `assets::path` into a `LogicalAssetPath` (exact
name may vary during implementation) shared by built-in and custom assets.
It receives a prefix-stripped relative string and performs exactly one strict
percent-decode before any lookup. It rejects:

- a leading slash or any empty, `.` or `..` component;
- malformed escapes, invalid UTF-8 and any `%` left after the one decode;
- encoded or literal slash ambiguity at the boundary, backslashes, NUL and
  other ASCII control bytes;
- an absolute/root/prefix component by construction.

The custom resolver will join only the validated components to its canonical
bundle root and retain the current symlink, regular-file, size and
canonical-containment checks. The built-in resolver will use the same logical
key for an in-memory lookup and perform no filesystem access.

At the root-domain boundary, reject a decoded first component equal to `api`
or `ui`. Literal forms have already been captured by their Axum domains; this
additional refusal closes encoded aliases such as `/%61pi/...` and
`/%75i/...`. Requiring a prefix-stripped relative key also closes leading-
separator aliases such as `//api/...`. These ambiguous spellings return 404;
they are not normalized or silently rerouted. Segment-aware matching keeps
`/apiary` and `/uikit` available to a custom UI.

Paths already owned by `/api` remain in that domain even when their suffix is
hostile, for example `/api/%2e%2e/ui`; their answer is the API's JSON 404,
never UI content. Paths already owned by `/ui` remain in the built-in domain
and a guard failure is a terminal empty 404, never an SPA fallback.

### Compile-time embedded virtual tree

Add an APID build script using only the Rust standard library. It recursively
walks `ui/dist`, rejects symlinks, non-files, non-UTF-8 or unsafe relative
names, requires a root `index.html`, sorts paths byte-for-byte and generates a
Rust asset table in `OUT_DIR`. Each table row contains the logical path and an
`include_bytes!` reference to its source file. Cargo rerun directives cover the
directory and every discovered asset.

`assets::builtin` will `include!` that generated table and use a binary search
for exact lookup. This embeds the whole output tree into the APID binary under
verity while adding no runtime filesystem and no new crate dependency. Adding,
removing or renaming a Vite chunk becomes a build-time manifest change rather
than a Rust source edit.

Preserve the fixed MIME allowlist, `nosniff`, CSP and referrer policy. Serve
`index.html` and every SPA fallback with `no-store`. Configure every Vite-
generated file below `assets/` with a content hash in its name and serve those
files as `public, max-age=31536000, immutable`; any embedded file outside that
generated hashed directory remains `no-cache` unless it is the index. Unknown
extensions keep the existing `application/octet-stream` behavior.

The generated table is a compile-time VFS, not a runtime archive: lookup is
bounded and random-access, individual assets remain independently cacheable,
and one corrupt/missing source file fails the build rather than becoming an
incomplete running UI.

### Lazy frontend delivery

- Keep Vite's public base at `/ui/` and enable TanStack Router
  `autoCodeSplitting` so page route components become dynamic chunks.
- Remove the fixed `app.js`/`app.css` output contract. Use deterministic Vite
  patterns with content-hashed entry, route chunk and imported asset names
  under `assets/`; keep `index.html` as the sole stable bootstrap name.
- Split translations into typed English and Simplified Chinese modules.
  English remains the built-in fallback catalog; Chinese is loaded by a
  static dynamic-import map only when browser/stored detection selects it or
  the operator changes languages. When Chinese is the initial preference,
  finish that import before mounting React so the first rendered frame is not
  English. A failed locale chunk falls back to English and leaves controls
  usable.
- Preserve compile-time key parity using `satisfies`/type-only imports so
  moving Chinese to its own runtime chunk does not weaken catalog checking.
- Keep the global Spectrum theme stylesheet shared. Do not add a service
  worker, external CDN, runtime locale endpoint or another frontend runtime.

The existing recursive clean-build comparison in `ui/run.sh` stays as the
determinism gate; it no longer asserts a file count. Rust consumes the same
committed `dist` tree during native and cross compilation, preserving the
current separation between the Bun build environment and the Rust/image build.

### Test and delivery sequence

1. Add failing pure-path tests for leading separators, encoded reserved names,
   encoded separators, dot components, residual escapes, controls and the
   segment-aware `/apiary`/`uikit` non-cases.
2. Add failing Axum `oneshot` tests with real custom shadow files proving that
   `/api`, `/ui` and root cannot serve one another's bytes, including misses,
   encoded aliases and SPA fallbacks.
3. Add build-manifest and built-in-serving tests that discover generated asset
   names rather than hard-code a chunk filename, and verify MIME/cache/security
   headers plus file-like and hostile misses.
4. Enable frontend route/locale splitting, update catalog/provider tests and
   regenerate `routeTree.gen.ts` and the committed `dist` tree.
5. Update the APID e2e test to read referenced assets from built-in
   `index.html` instead of requesting `assets/app.js` by name.
6. Run Rust formatting, lint, focused tests and the full APID suite; run UI
   lint, typecheck, tests, coverage and the recursive clean-build gate. Record
   the entry/initial-transfer and total raw/gzip deltas rather than comparing
   only one monolithic JavaScript file.

## Risks

- Cargo builds consume committed `ui/dist`; they do not run Vite. A developer
  can still compile a stale but internally valid tree if they skip `ui/run.sh`.
  This is the existing source/artifact model, made visible in the guide and
  enforced in the normal UI/release gates rather than by adding Node to Rust
  cross-builds.
- URL parsing differs across clients and proxies. Decoding once, rejecting
  ambiguous spellings instead of normalizing them, and testing `OriginalUri`
  through the real Axum router keeps ownership deterministic.
- Rejecting repeated slashes, dot components, controls and encoded reserved
  first segments intentionally makes a few exotic custom-bundle filenames
  unreachable. Those names have no portable URL meaning and retaining them
  would preserve the cross-domain alias.
- Code splitting reduces the initial JavaScript payload but adds requests on
  first navigation and first Chinese use. Content hashes plus immutable cache
  headers make this a one-time cost per APID build; exact before/after request
  and byte counts must be reported.
- An APID restart during an update can make an already-open old tab request an
  old hash that the new binary does not contain. The request correctly 404s
  and a reload obtains the new no-store index; no service-worker compatibility
  layer is added.
- A generated table can hide nondeterministic traversal if it is not sorted.
  The build script sorts and rejects duplicate logical paths, while `run.sh`
  compares the complete clean output tree.
- Routing and path code overlap an extensively documented security contract.
  Existing custom-bundle canonicalization, API JSON errors, authentication,
  custom activation and `/healthz` behavior must remain unchanged outside the
  explicitly tightened path spellings.
- PLAN-058 localization, theme, guide and generated-asset work landed before
  implementation at `c51d37f9`. PLAN-059 builds on that baseline and preserves
  its shadcn/Base UI/Spectrum boundaries.

## Scope

In scope: APID build-time generation for all committed built-in assets;
embedded VFS lookup; shared safe logical path parsing; strict ownership for
the `/`, `/ui` and `/api` domains; closure of repeated-slash and encoded-prefix
aliases; built-in/custom SPA fallback isolation; MIME, security and cache
headers; Vite route and Chinese-catalog lazy loading; hashed output;
deterministic committed `dist`; Rust/frontend/e2e tests; the relevant static-
hosting contract, Chinese built-in UI development guide, changelog and PMA
records.

Out of scope: changing API operations or authentication; moving or removing
the existing `/healthz` boot probe; changing custom UI installation,
activation or bundle layout; serving the built-in UI from a writable runtime
directory; adding a service worker, CDN, HTTP locale backend, precompressed
variants or runtime archive decompression; changing shadcn/Base UI/Spectrum
boundaries; adding screens or application features; touching unrelated
PLAN-058 or research-document changes.

## Alternatives

1. **Keep a manually maintained `include_bytes!` list.** It can support more
   than three files but makes every hash rename a Rust edit and lets the list
   drift from `dist`; rejected.
2. **Add `include_dir` or `rust-embed`.** Both can provide recursive embedding,
   but a small standard-library build script gives this repository the exact
   path validation and deterministic manifest it needs without another supply-
   chain dependency; not selected.
3. **Embed a tar/ZIP/filesystem image.** This produces one source blob but
   needs a runtime index or decompressor and weakens per-asset random access
   and caching. The binary is already the containing artifact; an archive
   inside it adds no integrity boundary; rejected.
4. **Serve `ui/dist` from disk.** It simplifies lookup but moves the recovery
   UI out of the verity-covered binary and makes its availability depend on a
   runtime directory; rejected.
5. **Embed the tree but keep one JavaScript bundle.** This removes the filename
   restriction but leaves the current initial-load warning and does not use the
   requested resource/lazy-load benefit; rejected.
6. **Normalize or reroute ambiguous encodings.** Sending `//api` or
   `/%61pi` to another owner makes routing depend on an extra normalization
   pass and can disagree with proxies. A terminal 404 is simpler and cannot
   cross a resource root; selected instead.
7. **Put all three domains behind one catch-all classifier.** It could enforce
   ownership centrally, but it would replace Axum's structural API precedence
   with hand-written dispatch. Domain-local routers plus a shared validated
   asset key keep ownership visible and testable; selected instead.

## Annotations

- 2026-09-01: Created after the user rejected the fixed three-file constraint
  and selected an embedded virtual filesystem with resource optimization and
  lazy loading.
- 2026-09-01: Constrained to the `/`, `/ui` and `/api` ownership domains with
  an explicit prohibition on crossing between resource roots. The existing
  `/healthz` liveness endpoint is preserved as a non-asset operational route.
- 2026-09-01: User explicitly approved implementation and requested that the
  stale three-file delivery instructions in the UI development guide be
  updated in the same change.
- 2026-09-01: Implemented the standard-library build-time VFS, strict shared
  logical paths, terminal `/`/`/ui`/`/api` ownership, hashed route/vendor
  chunks and lazy Simplified Chinese catalog. Updated the static-hosting
  contract, Chinese development guide and changelog; all Rust, frontend,
  deterministic-build and documentation gates passed.
