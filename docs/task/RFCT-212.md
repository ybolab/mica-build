# RFCT-212 PLAN-023 M3: GET /api/v1/health and the §2.4 envelope on 405

- **status**: completed — `GET /api/v1/health` and §2.4's envelope on a wrong method both ship, additively; openapi.json grew 136 lines and lost none; every gate green on the tree merged with `bkd/vu5b6kk0`
- **priority**: P1
- **owner**: bkd/mkk6scy2
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-023 (M3)

Both halves are additive under `docs/design/api.md` §2.1: no shipped route
changes its path, its method, its success status code or its response fields.
The regenerated `os/pkgs/mosd/apid/openapi.json` is **136 inserted lines and
zero deleted**, which is that claim measured rather than asserted.

## 1. What the router looked like before this task

Re-read at `8f080dc`, because every requirement below is stated against it.

- Six routes are declared under the reserved `/api` prefix, in `api_router`:
  `/api/versions` and `/api/v1/meta` (GET), the two resource roots
  `/api/v1/settings/{*path}` and `/api/v1/state/{*path}` (GET), and two POST
  actions, `/api/v1/actions/change-password` and
  `/api/v1/actions/wireguard/{iface}/rotate-key`. Everything else under the
  prefix reaches `api_not_found`.
- The auth gate hands a request off above its own `GetSettings("access")` call
  when *"`path == "/healthz" || is_declared_api_route(path)`"*, and
  `is_declared_api_route` is a **path** test over the same constants
  `api_router` declares. It does not look at the method.
- `/healthz` is `.route("/healthz", get(healthz))` and its handler is
  `async fn healthz() -> &'static str { "ok" }`.

## 2. The 405 baseline, measured

The measurement was made by a throwaway test module driving the shipped router
through `tower::ServiceExt::oneshot` at `8f080dc` and printing status, every
response header and the body verbatim. The module was deleted afterwards; it
asserted nothing, so it was a measurement instrument and not coverage. The run
is kept as evidence in the report to L2.

| Request | Status | Headers | Body |
|---|---|---|---|
| `POST /api/versions` | 405 | `allow: GET,HEAD` | empty |
| `POST /api/v1/meta` | 405 | `allow: GET,HEAD` | empty |
| `PUT /api/v1/meta` | 405 | `allow: GET,HEAD` | empty |
| `POST /api/v1/settings/hostname` | 405 | `allow: GET,HEAD` | empty |
| `DELETE /api/v1/settings/hostname` | 405 | `allow: GET,HEAD` | empty |
| `POST /api/v1/state/uptime` | 405 | `allow: GET,HEAD` | empty |
| `GET /api/v1/actions/change-password` | 405 | `allow: POST` | empty |
| `DELETE /api/v1/actions/change-password` | 405 | `allow: POST` | empty |
| `GET /api/v1/actions/wireguard/wg0/rotate-key` | 405 | `allow: POST` | empty |

Four things in that table are the baseline the change is against.

1. **There is no `Content-Type` and no body at all.** Not an empty envelope, not
   `{}` — `content-length: 0`. §2.4 promises one shape for every failure on
   every `/api/v1/` route, and this was the one failure that had no shape.
2. **`Allow` is already correct**, and axum computes it from the very
   `get`/`post` calls that declare each route. It is spelled without a space
   after the comma (`GET,HEAD`), which is a valid `#rule` and is left alone
   below for a reason given in §5.
3. **A wrong method is answered without an authentication check.** The same
   three requests unauthenticated produced byte-identical answers, because
   `is_declared_api_route` tests the path and not the method, so the gate hands
   a wrong-method request on a declared path off exactly as it hands off a right
   one. This task does not change that; it changes what is in the body.
4. `GET /api/v1/health` was a 404 carrying `{"error":{"code":"not_found",
   "message":"no API route at /api/v1/health","source":"apid"}}`, so the route
   this task adds was previously indistinguishable from a typo.

Two controls were measured in the same run and must not move: `GET /healthz`
answered `200 text/plain; charset=utf-8` with the literal body `ok`, and the
asset router answered `POST /some/asset` with `405`, `allow: GET, HEAD` **with
the space**, `cache-control: no-cache`, `x-content-type-options: nosniff`, no
`Content-Type` and an empty body.

## 3. `GET /api/v1/health`

Authenticated by `ApiSession` like every other `/api/v1/` route, and **200 in
both states**. A dead mosd is a body, never a status code: a 503 here would be
indistinguishable from the endpoint itself being down, which is the confusion
§2.4 case 3 says the route exists to remove.

### 3.1 `checkedAt` is a JSON number of whole seconds since boot

The sketch in §2.4 draws it as `"<uptime seconds>"`, quoted. It ships as a bare
number, and the type was settled by asking what apid can actually read.

- There is no trusted wall clock anywhere in the crate. §3.2's expiry paragraph
  is the argument and `session.rs` is the evidence: `Instant` throughout,
  monotonic, unable to express a deadline that survives a reboot. An RFC 3339
  `checkedAt` would therefore be either a fabrication or a number that resets.
- The one clock this appliance does publish is §2.2 item 3's `uptime`, *"whole
  seconds since boot, a bare JSON number"*, served by `GET /api/v1/state/uptime`
  and computed by mosd from `/proc/uptime` at read time. Quoting the same fact
  as a string on this route would have given one appliance two spellings of one
  number, and a client would have to know which route it asked to know how to
  parse the answer.

So `checkedAt` is `Option<u64>`, whole seconds, present on the reachable answer
and **omitted** on the unreachable one — with `detail` omitted in the other
direction. Omitted rather than nulled, which is the rule the envelope's own
optional `path` member already follows and defends: a member present with a
meaningless value is worse than an absent one.

### 3.2 The probe is one live bus call, and it is not the one §2.4 named

§2.4 asks for *"one real call ... not by inspecting a cached flag"* and names
`GetSettings("")` as the cheapest that proves the round trip. What ships is one
call, `GetState("uptime")`. The deviation is deliberate:

- It is still **one** call, which is the requirement. The named call was an
  example offered for a reason — cheapness — and this one serves that reason
  better: mosd answers with a single integer, where `GetSettings("")`
  serialises the entire settings tree, `access.webAdmin.password_hash`
  included, across the bus for what is a liveness ping a monitor may run every
  few seconds.
- It is the only call that also produces `checkedAt`. Taking §2.4's example
  literally would have meant two round trips to answer one question, and a
  second failure mode nobody had specified: what a health answer means when the
  liveness probe succeeded and the uptime read did not.
- It cannot be absent on a mosd that ships with this apid. `GetState` special-
  cases the key before it consults the stored tree and computes it at read time,
  so a reachable mosd always answers it, and the value can never be a stale
  cached counter.

**Why `access_cache` may not stand in for the call.** `os/pkgs/mosd/apid/src/access_cache.rs`
(PLAN-021) exists so the auth gate can skip a per-request `GetSettings("access")`;
it is filled from a `SettingsChanged` subscription and answers from apid's own
memory. A health route reading it would report `mosd: "ok"` for as long as the
last fill survived — which is exactly the failure §2.4 case 3 was written to
prevent, *a monitor polling a dead appliance and seeing a healthy device*,
moved from `/healthz` to the route that exists to fix `/healthz`. The cache is
also, by its own lockout rule, only consulted while the subscription is live,
so a health route built on it would be reporting on a subscription rather than
on mosd. `health_reports_an_unreachable_mosd_and_still_answers_200` is the test
that pins this: its fixture answers `GetSettings("access")` — so the gate is
satisfied, a session mints and the cache is warm — and fails every state read,
so a cached-flag implementation would answer `ok` there and fail.

Any outcome that is not a usable count of seconds is classified with the
failures rather than reported as health, `detail` carrying whatever refused it.
`mosd` has two values and no third, because §2.4 defines exactly two shapes and
a health answer that needs a taxonomy is not one a monitor can act on.

### 3.3 The gate exemption: the claim holds, and nothing was added

§2.4's closing paragraph claims the shipped gate *"resolves it more broadly than
asked"* — every declared `/api/` route is handed off above the bus call, so a
health route inherits the exemption rather than needing one written for it.

**Verified at HEAD, and it holds.** No exemption was written for the health
route and none was needed. The gate's condition is
`path == "/healthz" || is_declared_api_route(path)`; the second half is a
membership test over what the API declares, not an enumeration of special cases,
so registering the health path in that list — the same one-line arm
`/api/versions`, `/api/v1/meta` and the change-password action each have — is
what "declared" means and is the whole of the change. There is no new branch in
the gate, no new predicate and no path-prefix test.

The arm is not optional, and that is worth stating because "inherits the
exemption" can be misread as "needs nothing at all". `is_declared_api_route`
carries an obligation in both directions: it must hand off exactly what the
router serves and nothing else. A route the router serves but the list omits is
answered, for an unauthenticated caller, with the gate's HTML redirect to
`/login` — or, with mosd down, with the gate's own 503 HTML page from the read
the route exists to make unnecessary.

### 3.4 `/healthz` is untouched

Not its path, not its unauthenticated handoff, not its literal `ok` body, not
its `text/plain` content type. The boot health gate probes exactly it and treats
any non-2xx as a failed boot, and its own comment says why it can:
*"/healthz is apid's existing endpoint and bypasses its auth gate"*
(`os/rootfs/overlay-v2/usr/lib/mos/mos-health:218`).
`healthz_is_untouched_by_the_health_route` pins all four properties, and pins
the one that looks like a defect and is not: `/healthz` still answers `ok` with
mosd dead. That is the trap §2.4 case 3 names, and the resolution is a second
endpoint rather than a change to this one — `/healthz` answers "is apid's
listener up", `/api/v1/health` answers "is this appliance manageable".

## 4. The 405 envelope

A wrong method on a declared route now answers §2.4's envelope with
`code: "method_not_allowed"`, `source: "apid"`, no `path` member, and the
`Allow` header the baseline already had.

`method_not_allowed` is the token, and §2.1's open-set rule is what makes adding
it additive: a v1 client *"must treat an unrecognised `error.code` as its HTTP
status class"*, and a client that does so reads this exactly as it read the bare
405 before. `source` is `"apid"` because the router decided this with no bus
call made; there is nothing mosd could be asked about it. There is no `path`
member for the reason the not-found envelope has none — a wrong method names no
settings dot-path — and it is absent rather than empty.

## 5. Three decisions inside the 405, and why

**The wiring is one declaration for the subtree, not a wrapper per route.**
axum 0.8's `Router::method_not_allowed_fallback` rewrites the method-not-allowed
fallback of every `MethodRouter` already registered on the router it is called
on. Called on `api_router()` it therefore reaches exactly the routes declared
above it and nothing else — the twenty-six HTML paths and the asset router are
declared on a different router. The first implementation wrapped each route
individually; it worked and was replaced, because it rewrote the six `.route(...)`
lines that `docs/task/RFCT-205.md` and `docs/task/RFCT-206.md` quote as the
record of what those milestones shipped, and those records are history. One
declaration leaves every route line byte-identical. Its position is load-bearing
and is commented in the source: a route declared after it would not be covered,
which is what the per-route test below detects.

**`Allow` is left to axum rather than written by hand.** axum accumulates the
header from the `get`/`post` calls that declare each route and attaches it to
whatever the fallback returns unless that response already carries one, so it
cannot name a method a route does not serve or omit one it does. A hand-written
`Allow` would be a second opinion about the route table, and the baseline shows
the framework's opinion is already right. The consequence is the spelling:
`GET,HEAD` under `/api/`, `GET, HEAD` from the asset router, which is the next
decision.

**The asset router's 405 is not unified with this one, deliberately.** It is
outside `/api/`, §4.2 condition 2 gives it a bare body, its own
`Allow: GET, HEAD` and no `Content-Type` at all, and §2.4's envelope is a
promise about `/api/v1/` routes. `the_asset_router_405_is_not_the_api_envelope`
asserts both answers in one test, to the same wrong method, so a later attempt
to give the whole server one 405 fails with the distinction printed rather than
quietly widening a promise.

## 6. What the OpenAPI document gained

The document is generated from the handlers and a test asserts the committed
copy is byte-identical to what the code produces, so it was regenerated, not
edited: `cargo run -p apid -- --openapi > apid/openapi.json`. It gained the
`/api/v1/health` path, the `ApiHealth` schema, and a `405` response on all seven
declared operations. 136 lines inserted, none deleted.

`ApiHealth` requires `apid` and `mosd` and leaves `checkedAt` and `detail`
optional, which `the_openapi_document_covers_health_and_the_405` asserts member
by member. `checkedAt` is published as `["integer","null"]`: the same
schema-wider-than-the-wire artefact §2.4 already records for the envelope's
`path` member, from the same cause — `utoipa` renders an `Option<T>` as a
nullable type while `serde(skip_serializing_if)` means the wire never carries
the null. It is not a new defect and it is not fixed here; it is the existing
one, in one more place.

**oasdiff.** The repo runs it, in `.github/workflows/check.yml`, as a step that
diffs the committed spec against the **base branch's** copy with
`--fail-on ERR`. It is a CI step and not a script: it fetches the base ref and
downloads a pinned binary from GitHub, and this worktree has neither the base
ref fetched nor network access to that release, so it was not run here and no
output is invented. What can be said from the tree is the shape of the diff the
step would see: purely additive, 136 insertions and zero deletions, no path
removed, no response removed, no property removed, no field narrowed — none of
the rules that step rates ERR, nor either of the two it promotes to ERR
(`response-optional-property-removed`, `response-non-success-status-removed`),
has anything to bite on.

## 7. Coverage

Ten tests, all in `os/pkgs/mosd/apid/src/tests.rs` except the last:

| Test | What it pins |
|---|---|
| `health_reports_a_reachable_mosd_and_stamps_the_answer_with_uptime` | 200, both members, `checkedAt` as a number, `detail` absent |
| `health_reports_an_unreachable_mosd_and_still_answers_200` | 200 with a dead mosd, `detail` present, `checkedAt` absent, no `Retry-After`, and the cache-warm fixture that rules out a cached flag |
| `health_reads_the_bus_on_every_request` | the answer moves when the appliance's uptime moves, in one router and one session |
| `health_without_a_session_is_the_envelope_and_not_a_redirect` | 401 `not_authenticated`, no `Location` |
| `healthz_is_untouched_by_the_health_route` | `/healthz` path, status, content type and literal body, unauthenticated, and still `ok` with mosd dead |
| `a_wrong_method_on_a_declared_api_route_answers_the_envelope` | all seven declared routes: 405, the exact `Allow` per route, JSON, `no-store`, `method_not_allowed`, `source: apid`, no `path` |
| `the_405_envelope_does_not_depend_on_a_session` | the 405 is the router's answer, not an authenticated one — §2 baseline item 3, unchanged |
| `the_asset_router_405_is_not_the_api_envelope` | both 405s in one test, to the same method |
| `the_api_fallback_404_survives_the_405` | `not_found` still, on five undeclared paths including `/api/v1/health/extra`, with no `Allow` header |
| `the_openapi_document_covers_health_and_the_405` | the health path's three outcomes, `ApiHealth`'s required set, and a 405 on every declared operation |
| `os/pkgs/mosd/apid/tests/e2e.rs` | the same three answers against a real mosd on a private bus: health 200 with a live `checkedAt`, anonymous 401 envelope, `POST /api/v1/meta` 405 with `Allow` and the envelope |

## 8. What was deferred

**The bare-continuation citation form: measured, and deliberately not
rewritten.** A citation written `` (`path/to/file.rs:398-399`, `:358-359`) ``
has a second element that inherits its file from the first.
`docs/verify-citations.sh` never resolves that form — a token with no `/` is out
of scope by its own stated rule (*"`routes.rs:95` is shorthand for a path named
earlier in the prose and has no base to resolve against"*) — so a continuation
can point anywhere and the gate still reads green. `os/pkgs/mosd/apid/src/routes.rs`
is the most-cited file in `docs/design/api.md`, and this task inserts into it at
**twelve** points producing **thirteen** distinct shift bands from `+0` to
`+176`, so a single constant offset would be wrong everywhere but one band. The
per-line map used for the full form in `f955f81` handles that; the question is
whether the continuation form needed the same treatment.

**Counted.** 705 continuation tokens in the scanned corpus. Resolving each one's
inherited file as the nearest preceding full citation, **200** land on a file
this task edited: 174 on `routes.rs`, 24 on `docs/design/api.md`, 1 on
`openapi.json`, 1 on `apid/src/tests.rs`. Of the 174 `routes.rs` ones, 131 cite a
line at or below the first insertion and would therefore shift, 42 sit above
every insertion and correctly do not move, and 1 names a line this task edited.

**Then tested, and none of them was pointing at what it claims before this task
touched anything.** For each of the 174, every backticked name on its own line
was checked against the cited line range in the `8f080dc` tree — a deliberately
loose test, since a name anywhere on the line matching anywhere in the range
counts. **3 of 174 hit, and all three are coincidences**: `nest` and `/api`
matching inside comment prose, not the construct being cited. 143 fail outright
and 28 have no name to test with. Under the strict adjacency rule the gate
itself uses for quotes, 61 of the 200 carry an adjacent quoted fragment and
**60 resolve nowhere** in the pre-image tree. The same extractor run as a control
over the full-form citations into the same files — the ones the gate proves —
resolves **69 of 73**, so the extractor is sound and the result is the corpus,
not the instrument.

Three hand checks, against `8f080dc` directly, since a scripted census deserves
one: §1.2 puts `builtin_home` at `:1288`, where the pre-image line is a
bridge-port error string; it puts `api_router` at `:261`, where the pre-image
line is a bare `///` and the function actually opens at 307; §2.1 puts
`api_versions` at `:405`, where the pre-image line is a doc comment inside
`ApiErrorDetail`. The offset is visible in one subtraction: §1.2's own preamble
cites `pub fn app(state: AppState) -> Router {`
(`os/pkgs/mosd/apid/src/routes.rs:130`), and that is correct in *both* trees, while
the table's first row puts `.route("/", get(serve::root))` — seven lines below
`app` — at `:120`.

**So this task invalidated none of them, because none was valid.** They are
stale against an older tree, by the mechanism that produces exactly this: a
re-anchor pass that rewrites the full form and skips the continuation form goes
green while leaving the continuations pointing where they were. Rewriting them
here would map a wrong pre-image line onto a fresh number, committing rot that
now *looks* re-anchored — and would do it inside §1.2, §2.1, `dashboard.md`,
`bus.md` and three other tasks' records, all outside this task's write scope and
none of them mine to correct. The 42 that correctly do not move are the only
ones whose numbers are unchanged for a reason this task can vouch for.

The repair is real work and wants an owner and a base commit: 705 continuations
corpus-wide, 174 on `routes.rs` alone, and they cannot be re-anchored — there is
no true earlier number to map from — only re-derived from content. Raised to L2
rather than done here.

`test/apid-api/**` gained no phase. The on-image suite needs a rebuilt image and
a QEMU boot, which is outside this milestone's gate set, and the property a
phase would assert — that the route works against a real mosd over a real bus —
is already asserted by `apid`'s own `tests/e2e.rs`, which runs a real
`dbus-daemon`, a real `mosd` and a real `apid` and is inside the Rust gate. An
on-image phase written but never run would be a claim, not a measurement.

## 9. Gates

Run on the tree after `bkd/vu5b6kk0` was merged in.

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | `1493/1493 PASS` |
| `bash docs/verify-index.sh` | `756/756 PASS` |
| `bash os/pkgs/mosd/hack/check.sh` (in `localhost/mos-build-rust`) | `ALL CHECKS PASSED` — fmt, clippy `-D warnings`, `714 tests run: 714 passed, 0 skipped`, doctests, `cargo deny` |

714 where RFCT-209 measured 704: the ten route tests in §7, and the merge.

**One deviation in how the gate was invoked, and it is the wrapper, not the
gate.** `hack/check.sh` was run unmodified. The container was entered with
`bash -c` rather than `bash -lc`, because a login shell in this image sources
`/etc/profile`, which unconditionally assigns
`PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"` and
discards the `-e PATH` the invocation passes. `cargo` lives at
`/opt/rust/bin/cargo` in that image and `$HOME/.cargo/bin` does not exist, so
`bash -lc` reaches `hack/check.sh` with no `cargo` on `PATH` and the run dies at
its first line. Measured, both ways, before the substitution was made.
