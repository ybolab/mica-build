# RFCT-074 The asset router: routing precedence, the reserved /api/ subtree, SPA fallback

- **status**: completed — the asset router is mounted as the HTTPS router's fallback, `/api/` is reserved with §2.4's envelope, §4.2's five conditions each have a test, and `assets/mod.rs` no longer carries `#![allow(dead_code)]`
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-20 15:20
- **claimedAt**: 2026-08-20 15:20
- **completedAt**: 2026-08-20 17:05

Campaign `l1-o7ee8v0o-20260820142702-ui`, phase 4 of `docs/design/api.md` §8.2.
Branch `bkd/kiz8hnu1`. Base `16dd382`, the campaign head carrying RFCT-071,
RFCT-072 and RFCT-073.

```
$ git rev-parse HEAD
16dd382a478bfc5f05da5231b0d96ccf52f28743
$ git merge-base --is-ancestor 16dd382 HEAD && echo BASE-OK
BASE-OK
$ test -f mosd/apid/src/bundle.rs && test -f mosd/apid/src/assets/path.rs && echo DEPS-OK
DEPS-OK
```

## Description

RFCT-071 landed the `/srv/ui` bundle store and RFCT-072 landed path resolution
and content classification. Both arrived **unused**: `mosd/apid/src/assets/mod.rs`
carried `#![allow(dead_code)]` with the comment *"Remove this attribute with the
route that consumes them"*. This task is that route.

What it makes true, in one sentence: **a bundle installed under `/srv/ui` is
served, and it cannot capture a path the daemon declared** — not because a
handler checks a prefix, but because axum matches declared routes before it
consults a fallback and the asset router *is* the fallback.

## Deliverable

| file | what |
| --- | --- |
| `mosd/apid/src/assets/serve.rs` | new. `root` (§4.1's `/` exception) and `fallback` (§4.1 rule 4), §4.2's five conditions, §4.3's headers applied |
| `mosd/apid/src/assets/mod.rs` | `#![allow(dead_code)]` removed, `pub mod serve` added, module doc re-pointed |
| `mosd/apid/src/routes.rs` | `/` made conditional, `/api/` reserved with §2.4's envelope, the asset router mounted as the fallback, `AppState` grew the bundle store |
| `mosd/apid/src/tests.rs` | twelve router-level tests, one per §4.2 condition plus the shadowing pair |
| `docs/task/RFCT-074.md`, `docs/task/index.md` | this record and its row |

Nothing else was touched. `mosd/apid/src/bundle.rs`, `assets/path.rs` and
`assets/mime.rs` are consumed exactly as merged; `main.rs`, `Cargo.toml`,
`Cargo.lock`, `os/**`, `Makefile` and `docs/design/api.md` are unchanged, and no
dependency was added — §4.4 settled hand-rolling over `tower-http` and
`ServeDir` is still not compiled into this crate.

## §4.1's precedence is the router's declaration order

```rust
Router::new()
    .route("/", get(serve::root))          // rule 3's single exception
    .route("/setup", ...)                  // rule 3: the legacy panes
    ...
    .route("/healthz", get(healthz))       // rule 2
    .nest("/api", Router::new().fallback(api_not_found))   // rule 1
    .route("/api/", any(api_not_found))    // rule 1, and see F1
    .fallback(serve::fallback)             // rule 4
    .layer(middleware::from_fn_with_state(state.clone(), gate))
    .with_state(state)
```

No handler below this function inspects a path prefix. The asset router is
never *called* for a path the router matched, which is the difference §4.1
insists on: *"a rule enforced by the dispatch mechanism is worth more than a
rule enforced by a check somebody can forget to write."*

**`/` is conditional and §6.3's prefix is not created.** `GET /` serves the
active bundle's `index.html` when a bundle is active and its index is readable,
and today's `home` pane otherwise. `/builtin/` does not exist here; making the
built-in UI reachable unconditionally is a later task's, and until it lands `/`
is the only path that reaches `home`.

## The `/api/` reservation, and the test that distinguishes it from an absence

The reservation 404s **everything** under the prefix, `/api/versions` included —
that route is held for phase 2 and is not added here. The body is §2.4's
envelope with `code: "not_found"`, `source: "apid"`, `Content-Type:
application/json` and `Cache-Control: no-store` (§4.3's second row).

A test that asks for `/api/foo` and asserts 404 proves nothing: no file was ever
placed there, so the 404 is indistinguishable from an unhandled path. The test
here is bidirectional in the shadowing sense:

1. A bundle is installed **through `Store::activate`** containing real files at
   `api/versions` and `api/v1/settings`, and the test **lists the installed
   tree** and asserts both are in it — so the files exist in the served tree,
   not merely in the staged one.
2. The same router serves `/decoy.txt` from that bundle with a 200 and the
   file's bytes, so the bundle is demonstrably reachable through this router.
3. `/api/versions` and `/api/v1/settings` return §2.4's envelope, and the
   assertion that the file's bytes appear nowhere in the answer is made
   **first**, on the body rather than on the status — so deleting the
   reservation fails the test *with the bundle's bytes printed*, not with a bare
   `200 != 404`.
4. `without_the_reservation_the_bundle_does_shadow_the_api` runs the same
   bundle through the same asset handler with rule 1 removed and asserts the
   file **is** served — the failure the reservation exists to prevent, stated as
   a passing assertion.

Both observations, run:

```
$ cargo nextest run -E 'test(a_bundle_cannot_shadow)'
PASS [1.265s] (1/1) apid::bin/apid tests::a_bundle_cannot_shadow_the_reserved_api_subtree
```

```
# with `.nest("/api", ...)` and `.route("/api/", ...)` deleted from routes.rs
$ cargo nextest run -E 'test(a_bundle_cannot_shadow)'
FAIL [1.312s] (1/1) apid::bin/apid tests::a_bundle_cannot_shadow_the_reserved_api_subtree
thread 'tests::a_bundle_cannot_shadow_the_reserved_api_subtree' panicked at apid/src/tests.rs:1409:9:
/api/versions: the reserved subtree answered with the bundle's own bytes: BUNDLE-SHADOWS-API-VERSIONS
```

`routes.rs` was restored immediately; the deletion exists only in this record.

## §4.2, one test per condition

| condition | test | what it asserts |
| --- | --- | --- |
| 1 — path not reserved | `a_bundle_cannot_shadow_the_reserved_api_subtree`, `declared_routes_win_over_bundle_files_of_the_same_name` | a bundle carrying `api/versions`, `api/v1/settings`, `healthz`, `login` and `network` captures none of them; `/healthz` still answers `ok`, `/network` and `/login` still render built-in panes |
| 2 — `GET` or `HEAD` | `a_write_method_reaching_the_asset_router_is_405_and_never_html`, `head_is_admitted_and_carries_the_same_headers_as_get` | `POST`/`PUT`/`PATCH`/`DELETE` → 405 with `Allow: GET, HEAD`, no content type and an empty body; `HEAD` → the headers its `GET` would carry |
| 3 — the client asked for HTML | `a_json_client_never_gets_the_spa_fallback` | `Accept: application/json`, `Accept: */*` and **no `Accept`** all → 404 with an empty body; `text/html` and a real browser `Accept` → 200 with the index |
| 4 — no `.` in the final segment | `a_dotted_final_segment_misses_with_an_empty_body` | `/assets/app.deadbeef.js` → 404 empty even on a navigation; `/settings/network` → 200; `/assets/app.a1b2c3.js`, which exists, → 200, so the 404 is a miss and not the extension being refused |
| 5 — a bundle is active and its index is readable | `without_a_readable_index_the_fallback_is_the_built_in_ui` | no bundle at all, and a bundle whose `index.html` was replaced by a symlink outside the install path, both → **the built-in UI with 200**, not a 404 and not a 500 |

Plus `the_site_root_is_the_bundle_index_when_one_is_active` for §4.1's `/`
exception in both directions including a live `deactivate`,
`a_hostile_path_is_404_and_never_the_spa_fallback` for §4.4's suite at the
router, and `every_asset_response_carries_nosniff_and_its_cache_class` for §4.3.

**§4.2's property, in its own words** — *"a request that a developer expected to
be JSON never returns HTML with a 200"* — is what condition 3's test is written
against, and it is why `*/*` is **not** read as an offer of HTML. See F7.

## §4.3 as applied

`nosniff` goes on every response the module builds, refusals included. The
content type comes from RFCT-072's allowlist; the cache class from
`mime::cache_class`, with the manifest's `immutableDir` read from the served
tree (F5). Asserted:

| path | `Content-Type` | `Cache-Control` |
| --- | --- | --- |
| `/index.html` | `text/html; charset=utf-8` | `no-store` |
| `/assets/app.a1b2c3.js` (manifest declares `assets` immutable) | `text/javascript; charset=utf-8` | `public, max-age=31536000, immutable` |
| `/robots.txt` | `text/plain; charset=utf-8` | `no-cache` |
| `/data.bin` | `application/octet-stream` | `no-cache` |
| the SPA fallback | `text/html; charset=utf-8` | `no-store` |
| the built-in UI, at `/` or as a fallback | `text/html; charset=utf-8` | `no-store` |
| every `/api/` response | `application/json` | `no-store` |

The built-in status pane picks up `no-store` and `nosniff` at `/` as a result,
where it previously carried neither. That is §4.3's first row applied — it is an
HTML document — and it is right on its own terms: the pane renders live device
state.

## Checks run

| command | result |
| --- | --- |
| `bash mosd/hack/check.sh` | `ALL CHECKS PASSED` — `361 tests run: 361 passed, 0 skipped`; `cargo fmt --check`, `clippy -D warnings` and `cargo deny` all clean |
| `bash docs/verify-index.sh` | `164/164 PASS` — `162/162` without this task's two files, `+2` for the record and its row |
| `make os-image-cx3576-v2` | image assembled, `BOARD_DIR=/srv/ai/mos/board/cx3576` |
| `make os-verify-cx3576-v2` | `RESULT: PASS (323/323 checks)` — unchanged, as it must be: this task adds no verifier assertion |

The image pair is not skippable: this task compiles into `apid`, and
`/usr/bin/apid` is packed into the verity squashfs, so an aarch64 cross-build
failure is exactly what the host-side checks cannot see. `BOARD_DIR` points at
the main checkout's prebuilt BSP artifacts because a BKD worktree has none;
that shortcut is valid **only** because this task changes nothing under
`board/`, and it changes nothing under `board/`.

## Findings — reported, not designed around

**F1. `nest("/api", …)` does not claim `/api/`, and §4.1 rule 1 assumes it
does.** §4.1 argues rule 1 *"is the shape axum's router already has"*. Measured
against axum 0.8.9:

| request | `nest("/api", r)` alone | with `.route("/api/", …)` added |
| --- | --- | --- |
| `/api` | reserved | reserved |
| `/api/` | **falls through to the asset router** | reserved |
| `/api/x`, `/api/x/y` | reserved | reserved |
| `/apix` | asset router (correct) | asset router (correct) |

With a bundle installed, `/api/` falling through is answered by §4.2's SPA
fallback with **200 and HTML** — a request whose path begins `/api/` reaching
the asset router, which rule 1 forbids in as many words. Closed here by the
explicit second declaration, which is why it is there and why it is not
redundant.

**F2. `//api/versions` reaches the asset router and is served from the bundle.**
Rule 1 is written about paths that *begin* `/api/`. `//api/versions` does not,
so it is dispatched to the fallback, where §4.4 rule 3 strips **all** leading
separators and resolves it to the bundle's `api/versions`. Measured on the
shipped router with a bundle containing that file:

```
//api/versions      -> 200 "SHADOW"                       (the bundle's file)
/api//versions      -> 404 {"error":{"code":"not_found",…}} (the reservation)
//api/v1/settings   -> 200 "<!doctype html>…"  with Accept: text/html,…
//api/v1/settings   -> 404 ""                  with Accept: */*
//api/v1/settings   -> 404 ""                  with no Accept header
```

**Nothing is shadowed** — the API's own paths are unaffected and phase 2's
routes will answer at `/api/v1/...` regardless — so this is not the failure rule
1 exists to prevent. What it is: the reserved subtree's *names* remain reachable
from a bundle by adding one slash. **Not closed here.** Closing it needs either
the path-prefix check inside the asset handler that §4.1 explicitly rejects, or
a normalise-the-request-path middleware, which is a design decision §4 does not
make. The last three rows are condition 3's strict reading (F7) doing its work:
the common `fetch(base + "/api/v1/settings")` with a trailing-slash base is a
404, not HTML.

**F3. §2.4's `path` is the settings dot-path, not the request path, so it is
omitted.** §2.4 defines it as *"OPTIONAL: the settings dot-path at fault"* and
its worked example carries it on a `settings_rejected`. A 404 for a route that
matched nothing has no settings dot-path, so filling the field with the URL
would misuse it. The requested path is in `message`, which §2.4 makes
human-readable and explicitly not for matching:
`{"error":{"code":"not_found","message":"no API route at /api/v1/settings","source":"apid"}}`.

**F4. §1.6 evidence 2 is now false, by construction, and that is this task.**
§1.6 measured the absence of static hosting four ways at `86cd669`. Evidence 1
(no `tower-http` dependency), 3 (no `include_str!`/`include_bytes!`) and 4 (no
non-Rust file but `Cargo.toml`) still hold — re-measured. Evidence 2 —
*"the HTTPS router declares no `nest_service`, no `fallback_service` and no
`fallback` at all"* — is what this task removes. Its citations resolved exactly
at this task's base and have now shifted:

| citation | at `16dd382` | now |
| --- | --- | --- |
| §1.6 `routes.rs:44-68` — the router body | resolves exactly (`:44` `Router::new()`, `:68` `}`) | `:80-121` |
| §4.1 `routes.rs:45-65` — the fifteen `.route()` declarations | resolves exactly, fifteen of them | `:87-106`, still fifteen |
| §4.1 `routes.rs:74` — the redirect router's fallback | resolves exactly | `:155` |
| §4.1/§1.6 `routes.rs:149` — the gate's `/login` redirect | resolves exactly | `:230` |

`docs/design/api.md` was not edited; documentation reconciliation is a later
task's.

**F5. The bundle store does not expose `immutableDir` after install.**
`bundle::Manifest::immutable_dir` carries the comment *"Serving it is §4's work,
not this module's; the store only carries the declaration"* — but the only
post-install read, `Store::status`, returns `ManifestSummary { name, version }`,
and `read_manifest` is private. §4.3's third cache class therefore cannot be
applied from the store's public API. Worked around by reading `mos-ui.json` from
the served tree and deserialising it into `bundle::Manifest` — the merged type,
not a copy of it. `bundle.rs` was not touched. A public accessor is the clean
fix and belongs to whoever next owns §5.3.

**F6. `Store::status()` hashes the whole tree and must not be called per
request.** It computes `digest_matches` through `digest_of(&dir)`, a full-tree
SHA-256, and §6.1 states that re-hashing a whole tree on every request is not
affordable and that the digest is checked at activation and start-up only. Not a
defect — `status()` is §5.3's *"what is installed right now?"* read and is
correct for that — but it is the obvious-looking call for a request handler and
it is the wrong one. The asset router uses `active_generation()` plus
`bundle_dir()` instead, and rebuilds the root from the generation number rather
than canonicalising `current` and serving wherever it points, so a `current`
repointed outside the store over a root shell reads as "no bundle" and the
device serves the built-in UI.

**F7. Condition 3: `*/*` is not read as an offer of HTML, and the cost is
stated.** §4.2 says the `Accept` header *"must offer `text/html`"*. Read
permissively, `*/*` offers it — and then a `fetch()` that sets no `Accept` at
all (the default is `*/*`) receives **200 and HTML**, which is precisely the
failure §4.2's acceptance property names: *"a request that a developer expected
to be JSON never returns HTML with a 200."* The strict reading is the one that
makes the property true, so it is the one implemented: `text/html` or `text/*`
explicitly, and nothing else. The cost, stated rather than hidden:
`curl https://<device>/settings/network` gets a 404 where a browser at the same
URL gets the application. No browser navigation is affected — browsers always
send an explicit `text/html` — and `GET /` is a declared route with no `Accept`
condition at all, so a bare `curl` of the device root still gets the bundle's
index.

**F8. The auth gate covers the asset router and the reservation, deliberately.**
§4 states no authentication posture for assets. Because `.layer` is applied
after `.fallback`, the gate wraps both, so a custom UI is served only to a
logged-in operator and an unauthenticated `/api/foo` is answered by the gate's
303 to `/login` rather than by §2.4's envelope. That is the same posture every
path in the crate has had since before this task, and it was kept rather than
narrowed: exempting `/api/` from the gate to make the envelope unconditional
would leave phase 2's real routes inheriting an **unauthenticated subtree**, a
hole held open by a comment — the "check somebody can forget to write" failure
§4.1 argues against. §3.2's bearer token is what makes `/api/` authenticate as
an API rather than as a browser session, and it is phase 2's.

**F9. §6.1 class 4's `EACCES` half is not exercised.** An unreadable
`index.html` falling back to the built-in UI, and an unreadable inner asset
404ing, are both implemented — `fs::read` failing is the trigger in each case —
but the tests run as root, where a mode of `000` does not prevent an open. The
class-2 half (an `index.html` that is not a regular file) **is** exercised, by
replacing the installed index with a symlink outside the install path. Named
rather than claimed.

## Deliberately out of scope

- **`GET /api/versions`** and everything else under `/api/v1` — phase 2. The
  reservation 404s them today, which is the point: it holds the prefix until
  they land.
- **The served-set constant and §6.1's start-up compatibility re-check** —
  `Store::activate` and `Store::recheck_active` take a served set as a
  parameter and neither is called from `main`. Nothing here hardcodes one; the
  tests pass `["v1"]` in as a test input.
- **`/builtin/` and the escape control** — §6.3's reserved prefix does not
  exist and was not stubbed.
- **Start-up wiring of bundle discovery.** `main.rs` is unchanged. `AppState`
  constructs the store, which is a `PathBuf` and no syscall; §6.1 forbids
  discovery before the listeners bind, and nothing here does any. Every request
  reads the store fresh, so a bundle activated while apid is running is served
  without a restart — asserted by `the_site_root_is_the_bundle_index_when_one_is_active`,
  which deactivates mid-test and watches `/` revert.

## What is NOT claimed — hardware

**This work was not exercised on hardware.** Both overstatements are wrong and
both are avoided:

- Hardware **has** booted. A **v1** image reached the `mos login:` prompt on a
  real CX3576-Z, and the repart/maskrom and SPL-hash investigations ran against
  a real board. "Never booted" would be false.
- What has **never been exercised on hardware** is the **v2** stack — verity
  root, A/B, `rauc install`, and apid itself. "Verified on device" would be
  equally false.

What this task did: ran the router in-process against a bundle store in a
temporary directory, and cross-built `apid` into a v2 image checked on the host.
**A packed image verified on a host is not a booted device.** No assertion here
observes `/srv/ui` on a mounted DATA partition, a bundle surviving a reboot, or
a browser fetching an asset over TLS.
