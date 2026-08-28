# RFCT-243 PLAN-023 M7: the reboot, poweroff and transient-root-password actions

- **status**: completed — the three action verbs ship (202 on the power pair, 204 on the transient password), no `GET` is declared for any of them, the transient-password bounds are the form path's own function and its rejection never echoes the password; the auth gate's declared-route list is fixed and `GET /api/v1/state/{path}` is reconciled to carry both main's 404 and the campaign's 405; 823/823, 1559/1559 citations, 784/784 index, oasdiff RC=0 against main's tip and both other bases
- **priority**: P1
- **owner**: bkd/08bzo6cs
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-023 (M7)

Three verbs with no state to `GET` and no idempotency to promise.
`docs/task/RFCT-210.md` is the design of record and its M7 acceptance criteria
bind this task; every fact below was measured at this branch's HEAD rather than
relayed.

## 1. What ships

| Route | Method | Success | Body in |
|---|---|---|---|
| `/api/v1/actions/reboot` | `POST` only | **202** | none |
| `/api/v1/actions/poweroff` | `POST` only | **202** | none |
| `/api/v1/actions/transient-root-password` | `POST` only | **204** | `{"password": "..."}` |

`change-password` and `wireguard/{iface}/rotate-key` already shipped under this
namespace; these are the three that did not.

## 2. The four acceptance criteria, and how each is discharged

### 2.1 202 and not 204 on the two power verbs

The bus call is spawned on a detached task, so the response is built and
returned without awaiting it. 202 is the honest code: the request was accepted,
and whether it completed is not knowable over the connection that asked — on a
real appliance that connection is about to stop existing.

The form path was **measured, not assumed**: `power_submit` answers
`StatusCode::ACCEPTED`, and `the_power_routes_answer_202_like_the_form_path`
asserts both surfaces in one test so a change to either fails there.

The detachment is asserted rather than described. `await_power_calls` polls for
the entry after the response has already arrived; a handler that awaited the bus
call would have the entry before responding, and would have no reason to answer
202 at all.

### 2.2 No `GET` handler on any of the three

The HTML router refuses the same thing deliberately and says so in its own
source: no `GET` exists for either power action or for any SSH mutation, so a
browser prefetch, a crawler or a mis-clicked link cannot power the appliance
off. The `actions` namespace is named `actions` precisely so no reader expects a
`GET` to work there.

The assertion is **three rows added to the existing table-driven 405 test**,
`a_wrong_method_on_a_declared_api_route_answers_the_envelope`, rather than a
test of its own. That test already covers `GET` on `change-password` and on
`rotate-key`, and it names the `Allow` value per route rather than deriving it,
so the three new rows get the same per-route check every declared route gets. A
separate test would have been a second copy of an assertion that already had a
home. `the_openapi_document_covers_the_three_actions` asserts the other half:
the published document declares no `get`, `head`, `put`, `delete` or `patch` on
any of the three, because a documented `GET` here would be a contract to power
the appliance off by following a link.

### 2.3 The same byte bounds, and no echo of the password

**Where the rule lives was checked before it was called.** At this HEAD
`validate_transient_password` is a free function in `routes.rs` — the same
module the new route is written in — so the route calls it directly. Nothing was
lifted and nothing was copied: there is one rule, one set of bounds, and a
change to either surface's limits cannot land on only one of them. This is the
pattern the workstream has now met five times; it is the one instance where the
rule was already in a callable place, so the answer was simply to call it.

`the_transient_password_route_enforces_the_form_paths_byte_bounds` drives 7, 8,
72 and 73 bytes and the three forbidden bytes through **both** surfaces in the
same loop and asserts they draw the boundary in the same place. Two copies could
disagree; one cannot, and that test is what would fail if a second copy ever
appeared.

The no-echo property is **inherited rather than re-established**: none of the
validator's three messages interpolates the password — each states the bound,
the reason for the bound, or the forbidden bytes — so the message is passed
through verbatim and cannot leak it. mosd carries the same contract for its own
method and apid does not weaken it.
`a_rejected_transient_password_is_never_echoed` asserts the property and not the
mechanism: the whole response, headers and body, is searched for the value that
was sent, using distinctive strings rather than runs of one character so a
substring match cannot pass by accident. It also asserts a distinctive fragment
is absent, because a truncated echo is still an echo.

### 2.4 The constant confirmation token is not carried over

`PowerAction::confirm_token` and `TRANSIENT_CONFIRM_TOKEN` guard the three form
posts today. They are compile-time constants, not secrets and not per-session;
they exist to stop a mis-click on a rendered page, and there is no mis-click on
a `POST` a script constructed. The bearer token is the authorisation. This is a
deliberate reduction in friction, ratified in the M1 design, and it was not
reintroduced.

`the_action_routes_require_no_confirmation_token` records both halves of the
asymmetry — the API takes none, and the form path is unchanged and still refuses
a post without one — so that a later reading cannot "harmonise" either half into
the other without failing a test.

## 3. Two findings the route-level tests caught

### 3.1 The auth gate keeps a second list, and it did not know these routes

`is_declared_api_route` is a path predicate beside the router, and a path
missing from it never reaches its route at all. Both new-route auth tests failed
on the first run with a **303 redirect to `/login`** where section 2.4's **401**
envelope was expected, and a bearer token was refused outright rather than
accepted.

This was a real defect in the milestone's own diff, found by running the tests
rather than by reading the router. The fix adds the three constants to the
predicate. `an_unauthenticated_action_post_is_refused_and_does_not_act` and
`the_action_routes_take_a_bearer_token` are what hold it.

**Named as a finding and deliberately not fixed here:** nothing asserts that the
gate's list and the router's registrations agree in general. Each milestone that
adds a route has to remember both, and only a route-level test catches the
omission. A structural test would need the router's own table, which axum does
not expose; it is a real gap and it is larger than this milestone.

### 3.2 `FailingSettings` panicked on all three action calls

The fixture's `reboot`, `power_off` and `set_transient_root_password` arms were
`unreachable!("the resource routes are read-only")` — a message already stale,
since M4 made the settings root writable and the fixture's own `set_settings`
arm says so. All three now answer the failure, on the precedent
`rotate_wireguard_key` already set in the same fixture.

For the two power arms this also removes a latent hazard rather than only
enabling a test: they are called from a detached task whose result reaches
nothing but a log, so an `unreachable!` there would abort that task — a panic
inside a fixture rather than a failed assertion in a test.

## 4. The error contract, and the one shared change

Section 2.4's three ruled clauses are absent 404, malformed 422 and duplicate
409 with a per-collection code. Actions have no collection and no identifier, so
none of the three applies and no fourth answer was invented. The route reaches
for the table's existing rows only: `request_invalid` at 400 for a body that is
not this shape, `validation_failed` at 422 for a password outside the bounds,
and the bus classifier for everything mosd answers.

**`bus_api_error` now takes `Option<&str>`.** Section 2.4 states `path` is
*"OPTIONAL: the settings dot-path at fault"*, and an action that writes no
setting has none. The alternatives were both wrong: passing a plausible-looking
dot-path such as `access.ssh` would name something that was not at fault, and
passing the empty string would put `"path": ""` on the wire, which the member's
`skip_serializing_if` exists to prevent. Threading the `Option` keeps **one**
classifier rather than adding a second pathless copy of it; all fourteen
existing call sites pass `Some(...)` and none changed line count.
`a_failed_transient_password_names_no_dot_path` asserts both directions in one
test — the action's envelope has no `path` member, and a settings write through
the same fixture and the same classifier still names `hostname`.

## 5. Gate results

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | `1559/1559 PASS`, RC=0 |
| `bash docs/verify-index.sh` | `784/784 PASS`, RC=0 |
| `bash os/pkgs/mosd/hack/check.sh`, unmodified, in the amd64 builder | `Summary [  96.021s] 823 tests run: 823 passed, 0 skipped`; `advisories ok, bans ok, licenses ok`; `ALL CHECKS PASSED` |
| `oasdiff breaking … --fail-on ERR --severity-levels …` vs the pre-M7 spec | `No breaking changes to report`, RC=0 |
| the same, vs `main` tip `77a3278` and vs `fd7fbb0` | `No breaking changes to report`, RC=0 — see section 7 |

The gate script ran unmodified. Two things sit around it and neither touches it:
`dbus` is installed in the container first, without which the bus round-trip
test exits 100, and the builder image was confirmed to report `amd64` before any
result from it was believed.

## 5b. Test arithmetic

Counting both `#[tokio::test]` and `#[tokio::test(flavor = "multi_thread")]`,
plus plain `#[test]`, with `target/` excluded:

| | `#[tokio::test]` | `multi_thread` | `#[test]` | total |
|---|---|---|---|---|
| starting tree | 396 | 18 | 398 | **812** |
| final tree | 406 | 18 | 399 | **823** |

**812 + 10 + 1 = 823.** Ten are this milestone's own; the eleventh,
`a_state_dot_path_that_does_not_resolve_is_404_not_422`, is `main`'s test for
its own fix, carried across with the section 7 reconciliation rather than
written here.

The ten, each asserted by name against the run log:

| Test | What it holds |
|---|---|
| `the_power_routes_answer_202_like_the_form_path` | 202 on both verbs, the bus call arriving after the response, and the form path answering the same code |
| `the_action_routes_require_no_confirmation_token` | the API takes none and the form path still demands one |
| `the_transient_password_route_sets_it_and_writes_no_setting` | 204, one bus call, nothing in the settings tree |
| `the_transient_password_route_enforces_the_form_paths_byte_bounds` | 7/8/72/73 bytes and the three forbidden bytes, through **both** surfaces |
| `a_rejected_transient_password_is_never_echoed` | no echo in body or headers, and not a fragment either |
| `a_malformed_transient_password_body_is_refused_at_400` | `request_invalid`, nothing written |
| `the_action_routes_take_a_bearer_token` | Amendment 1's dual-credential reading |
| `an_unauthenticated_action_post_is_refused_and_does_not_act` | 401 envelope, and the machine stays up |
| `a_failed_transient_password_names_no_dot_path` | section 4's `Option`, both directions |
| `the_openapi_document_covers_the_three_actions` | `POST` only; no `get`/`head`/`put`/`delete`/`patch` declared |

**No test was renamed.** Three existing tests changed their data and none
changed its name or weakened an assertion:
`a_wrong_method_on_a_declared_api_route_answers_the_envelope` gained the three
`GET` rows that are section 2.2's assertion;
`every_other_api_path_keeps_both_of_its_answers` and
`the_api_reservation_answers_every_shape_with_the_envelope` each dropped
`/api/v1/actions/reboot` from a list of paths the API does **not** declare, on
the precedent each already recorded for the collection that left it at M5; and
`each_fdo_error_name_gets_its_own_envelope` took `main`'s route-dependent branch
for `InvalidArgs`.

## 6. Citations

Re-anchored in their own commits, numbers only. The pre-image was verified
gate-green **first** — 1559/1559 and 780/780 at the merge base — so every old
line was right before any of them was classified.

**No constant offset.** Measured net from the pre-image to the final tree, the
code edits produced **twelve distinct shift bands** in `routes.rs` (+8, +20,
+23, +24, +50, +51, +57, +64, +77, +129, +146, +231), three in `openapi.json`
(+0, +153, +163) and one in `tests.rs` (+12). A single offset would have been
wrong for every citation outside one band.

| Form | Count | Treatment |
|---|---|---|
| Full `path:line` and `path:line-line` into the four changed files | 379 | 73 unchanged, **306 rewritten** |
| Bare `` `:NNN` `` continuations with a `routes.rs` antecedent | 155 | left in place — RFCT-214's by census |

Every mechanical mapping was verified **byte-identical at both endpoints**
against the pre-image, and accepted only where the cited endpoints sat in
unchanged blocks. Five citations could not be mapped mechanically and were
resolved by hand:

| Citation | Why it could not be mapped | Resolved to |
|---|---|---|
| `docs/design/api.md` `routes.rs:5382-5395` | The range straddled a split: the spawn block moved into `dispatch_power_action` while the response construction stayed behind | `power_accepted` — the API route's own dispatch-then-202, which is what the sentence describes |
| `docs/design/api.md` `routes.rs:2952-2994` | The cited start line is `bus_api_error`'s signature, whose text this task changed | the function's new bounds |
| `docs/task/RFCT-130.md` `routes.rs:2952-2975` | Same start line | the same arms, re-bounded |
| `docs/design/api.md` `routes.rs:1226` (twice) | Both **quoted** the old one-line state handler, `resource_response(state.api.get_state(&path).await, &path)`. Section 7's reconciliation replaced that line, and the quoted text now exists nowhere | the `get_state` read at `:1227` and the terminal `None` arm at `:1253`, each quoted as it now reads |

The last two are the only places this task changed a **quotation** rather than a
number, and it changed them because the quoted source line ceased to exist. A
citation whose quote is false is worse than one whose number is stale: the
number can be checked mechanically and the quote reads as evidence.

Rewrites were applied in **one simultaneous pass per document**, by character
offset rather than by string replacement, so a citation rewritten to a value
could not be rescanned by the rule whose old value is that same number. The map
was widened to `.md` files as well as `.rs` and `.json`; no document gained or
lost a section, so no `.md`-into-`.md` citation moved.

Four passes were needed, each after a real line shift: the M7 routes, then
`cargo fmt` (the gate runs `rustfmt --check`, so the formatting is the gate's
and not a preference), then the two path-census test edits, then section 7's
state-route reconciliation. The counts above are the **net** result, measured
pre-image to final tree, not the sum of the passes.

**The bare continuations were left alone, per PLAN-023's ruling that RFCT-214
owns that census.** Of the 155 with a full `os/pkgs/mosd/apid/src/routes.rs`
antecedent, **103 point at lines this task moved**, plus **one** with an
`openapi.json` antecedent — 104 in total. They are recorded here rather than
silently left, because the count is what RFCT-214 needs to size its work. The
docs gate does not check the continuation form, so it stays green either way,
which is precisely why the number is stated rather than assumed to be zero.

## 7. The state route: base drift, and the resolution this tree carries

`main` advanced under the campaign. It gained
`20d4d3d fix(apid): a live-state dot-path that does not resolve is 404, not 422`,
a PLAN-025 fix the campaign branch predates. The two sides then disagreed about
one route:

- **main**: `GET /api/v1/state/{path}` answers **404 `settings_not_found`** for a
  dot-path that does not resolve, and its 422 description was rewritten to say
  so.
- **the campaign**: that route carries M3's **405** method-not-allowed envelope,
  and its `utoipa::path` block still documented the old reading — *"mosd
  rejected the dot-path (`settings_rejected`), which is also the answer for a
  dot-path that does not exist"*.

**Both are needed. They answer different questions and neither displaces the
other**, so the resolution is not "take one side": 404 is what an unresolvable
dot-path gets, 405 is what a wrong method gets.

### What this tree carries, and where it came from

RFCT-214 (`bkd/5n3a7yq1`) is the campaign's merge-down carrier and had already
resolved this conflict, keeping both. **That resolution is authoritative and
this tree adopts it rather than authoring a second one**: the handler body here
is byte-identical to both `main`'s and the carrier's, and the response set is
the carrier's — 200, 401, **404**, 422 with the corrected wording, 500, 503 and
**405**. `main`'s test for the behaviour,
`a_state_dot_path_that_does_not_resolve_is_404_not_422`, is carried across with
it, so the 404 is asserted here and not merely documented.

Taking the resolution rather than writing one is deliberate. Two branches
resolving one conflict is a seam; three would be worse, and the difference
between a mechanical adoption and an independent re-derivation is exactly the
kind of divergence a later merge cannot tell apart from an intended change.

The stale 422 prose is deleted from the route's documentation, and
`openapi.json` was **regenerated**, never hand-edited. Two citations in
`docs/design/api.md` quoted the old one-line handler body verbatim
(`resource_response(state.api.get_state(&path).await, &path)`); that line no
longer exists in any form, so both were re-anchored onto lines that do — the
`get_state` read at `:1227` and the terminal `None` arm at `:1253`.

`docs/task/RFCT-118.md` and `docs/task/RFCT-130.md` still record the old
behaviour. They are left alone: they are history, they were true when written,
and `main`'s own fix did not rewrite them either.

### The measurement that proves it

`oasdiff`, pinned 1.29.1, with the workflow's two severity promotions:

| Base | Result |
|---|---|
| `main` tip `77a3278` | `No breaking changes to report`, **RC=0** |
| `fd7fbb0` | `No breaking changes to report`, **RC=0** |
| the pre-M7 campaign spec | `No breaking changes to report`, **RC=0** |

Before the resolution the first of those reported
`[response-non-success-status-removed] in API GET /api/v1/state/{path}` at RC=1.
It does not now, which is the proof the merged route still carries `main`'s 404.

### Recorded for closeout, deliberately not done here

`20d4d3d`'s own message says the cleaner fix is a `NotFound` error name raised
mosd-side, and that PLAN-025's scope excluded `os/pkgs/mosd/mosd` so the reading
was done in apid instead. **M6 shipped exactly that cleaner mechanism for the
rotate-key route.** So on this tree the state route's apid-side name-reading
could be replaced by the same mosd-side split. It is not done here: a route
reconciliation is not the place to also redesign the mechanism, and doing it
inside a conflict resolution would make the resolution unreviewable.

## 8. Out of scope, untouched

`POST /api/v1/setup` (M8), the cookie cutover and section 3.2's dated note (M9),
RFCT-214's continuation census, `docs/design/api.md` section 1 (RFCT-215),
`docs/plan/**`, `docs/task/RFCT-216.md`. M4-M6's shipped routes were not
harmonised or revisited; the `bus_api_error` signature thread in section 4
changes no behaviour on any of them and no line count on any of their call
sites.
