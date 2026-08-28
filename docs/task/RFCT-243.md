# RFCT-243 PLAN-023 M7: the reboot, poweroff and transient-root-password actions

- **status**: completed — the three action verbs ship (202 on the power pair, 204 on the transient password), no `GET` is declared for any of them, the transient-password bounds are the form path's own function and its rejection never echoes the password; the auth gate's declared-route list is fixed, and `GET /api/v1/state/{path}` carries both main's 404 and the campaign's 405 by adopting RFCT-214's resolution rather than authoring a second one; re-synced onto `bkd/vu5b6kk0` at `823476a` with all fifteen conflicts in citation documents and none in code; 823/823 (813 + 10), 1657/1657 citations, 847/847 index, oasdiff RC=0 against main's tip
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

All four re-run on the **merged** tree (section 7b), not before it.

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | `1657/1657 PASS`, RC=0 |
| `bash docs/verify-index.sh` | `847/847 PASS`, RC=0 |
| `bash os/pkgs/mosd/hack/check.sh`, unmodified, in the amd64 builder | `Summary [  68.188s] 823 tests run: 823 passed, 0 skipped`; `advisories ok, bans ok, licenses ok`; `ALL CHECKS PASSED` |
| `oasdiff breaking … --fail-on ERR --severity-levels …` vs `main` tip `77a3278` | `No breaking changes to report`, **RC=0** |
| the same, vs `bkd/vu5b6kk0` at `823476a` | `No breaking changes to report`, **RC=0** |

`1657/1657` is L2's own citation figure, which is the check that the re-sync
neither lost nor invented a citation. `847/847` is L2's `843/843` plus the four
index entries this record adds.

**RC=0 against `main`'s tip is the check that matters**, because it is what
proves `GET /api/v1/state/{path}` still carries `main`'s 404 after the merge. It
reported RC=1 with `[response-non-success-status-removed]` on that exact route
before section 7's reconciliation, and does not now.

The gate script ran unmodified. Two things sit around it and neither touches it:
`dbus` is installed in the container first, without which the bus round-trip
test exits 100, and the builder image was confirmed to report `amd64` before any
result from it was believed.

## 5b. Test arithmetic

Restated against the **merged** tree. The re-sync brought the campaign's
merge-down down onto this branch, which moved the baseline: `d606deb` measured
**812** and `bkd/vu5b6kk0` at `823476a` measures **813**. Both numbers are
measured here, not relayed.

| | `#[tokio::test]` | `multi_thread` | `#[test]` | total |
|---|---|---|---|---|
| `d606deb`, the original base | 396 | 18 | 398 | **812** |
| `bkd/vu5b6kk0` at `823476a` | 397 | 18 | 398 | **813** |
| this merged tree | 406 | 18 | 399 | **823** |

**813 + 10 = 823.** The ten are this milestone's own.

**A correction to the attribution of the +1.** The merge-down's extra test is
`a_state_dot_path_that_does_not_resolve_is_404_not_422` — `main`'s own test from
`20d4d3d`. It is **not**
`a_dot_path_that_does_not_exist_is_404_and_a_rejection_stays_422`, which was
already present at `d606deb` and is therefore inside the 812. Measured both
ways: that name greps 1 at `d606deb`, and the state-route name greps 0 there.

This also confirms the reconciliation composed rather than duplicated. Section 7
carried `a_state_dot_path_that_does_not_resolve_is_404_not_422` across by hand
before the merge-down landed; the merge then brought the same test from the
other direction, and the merged tree has **one** copy, not two — `grep -oE
"^async fn ..." | sort | uniq -d` over the merged `tests.rs` reports no
duplicates at all.

The ten, each confirmed PASS by name in the merged-tree run log:

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

**No test was renamed.** Four existing tests changed their data and none changed
its name or weakened an assertion:
`a_wrong_method_on_a_declared_api_route_answers_the_envelope` gained the three
`GET` rows that are section 2.2's assertion;
`every_other_api_path_keeps_both_of_its_answers` and
`the_api_reservation_answers_every_shape_with_the_envelope` each dropped
`/api/v1/actions/reboot` from a list of paths the API does **not** declare, on
the precedent each already recorded for the collection that left it at M5; and
`each_fdo_error_name_gets_its_own_envelope` took `main`'s route-dependent branch
for `InvalidArgs`.

## 6. Citations

Numbers only, in their own commits. This task ran citation passes against **two
different bases**, and the distinction is the whole content of this section.

### Before the re-sync: mapped from `d606deb`

The pre-image was verified gate-green first — 1559/1559 and 780/780 — so every
old line was right before any of them was classified. Nine to twelve distinct
shift bands in `routes.rs`; no constant offset. Five were resolved by hand,
including two that changed a **quotation** rather than a number, because
section 7's reconciliation deleted the one-line state handler they quoted.

### After the re-sync: mapped from `bkd/vu5b6kk0`, deliberately

The merge brought RFCT-214's corpus-wide census down. **RFCT-214's numbers are
the base and mine are the delta, not the other way round**, and the asymmetry is
the reason: RFCT-214 **content-re-derived** its bare-form citations from the
construct each piece of prose actually names, because those were never valid and
no pre-image map can recover them. A mechanical pass of mine, mapped from
`d606deb`, would have silently overwritten exactly that work. My own shifts are
recoverable by mapping; its re-derivations are not. So the resolution is not
symmetric, and taking the L2 side first is what preserves the irrecoverable
half.

Concretely: every one of the fifteen conflicted documents was resolved to the
L2 side, and then the map from `bkd/vu5b6kk0` to this merged tree — which **is**
the M7 delta and nothing else — was applied once over the whole corpus.

**317 full-form citations rewritten**, in eleven distinct bands: `routes.rs`
+8, +20, +23, +29, +36, +118, +203; `openapi.json` +0, +153; `tests.rs` +12,
+18. Three needed hand resolution, all in `bus_api_error`, whose signature
section 4 changed: `api.md`'s `settings_read_only` and `mosd_failed` rows and
`RFCT-130.md`'s rejection row. Each was resolved by mapping the endpoints that
are byte-identical and placing the two that are not — the signature line and the
`tracing::warn!` beside it — on the same statements in their new position.

### The trap this pass hit, and how it was caught

Fifteen documents conflicted; **eight more auto-merged**. Those eight came out
of the merge holding **my** pre-merge numbers, and a pass that treats the whole
corpus as "L2's numbers" will map an already-mine number a second time. That is
a double application, and it is invisible: the result is a plausible number
pointing at the wrong line.

The docs gate caught exactly one instance — `RFCT-209.md` quoting *"is stale;
from mosd/, regenerate it with"* against a line that no longer held it — and one
instance is enough to condemn the method rather than the instance. The fix was
not to patch that citation: all twenty-three citation-bearing documents, the
fifteen conflicted **and** the eight auto-merged, were reset to
`bkd/vu5b6kk0`'s exact text and the map applied once. A citation rewritten
twice cannot be distinguished from one rewritten correctly by reading it, so
the only safe form is one derivation from one base.

That the count came back to **1657/1657 — L2's own figure — is the check that
nothing was lost or gained** in the reset.

### Counts

| Form | Count | Treatment |
|---|---|---|
| Full form, rewritten in the re-sync pass | 317 | mapped from `bkd/vu5b6kk0`, byte-identical at both endpoints |
| Full form, hand-resolved in the re-sync pass | 3 | `bus_api_error`'s changed signature |
| Bare `` `:NNN` `` with a full `routes.rs` antecedent | 184 | left in place — RFCT-214's by census |
| Bare `` `:NNN` `` with a full `openapi.json` antecedent | 1 | same |

**Bare continuations, re-measured on the merged tree as asked.** The population
grew from 155 to **184** with a `routes.rs` antecedent, because RFCT-214
corrected and added to it. Of those, **125 point at lines this task's M7 delta
moves**, plus **1** with an `openapi.json` antecedent — **126 in total**, where
the pre-merge figure was 104. The old number is superseded; this is the one to
carry forward. They are left in place because PLAN-023 gives that census to
RFCT-214, and the docs gate does not check the continuation form, which is
precisely why the number is stated rather than assumed to be zero.

Rewrites were applied in **one simultaneous pass per document, by character
offset** rather than by string replacement, so a citation rewritten to a value
could not be rescanned by the rule whose old value is that same number.

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

## 7b. The re-sync merge

`bkd/vu5b6kk0` moved from `d606deb` to `823476a` while this task ran, carrying
RFCT-214's census and the whole main merge-down (PLAN-024 and PLAN-025).
`git merge bkd/vu5b6kk0` produced **fifteen conflicts, and all fifteen are
citation documents** — `api.md`, `bus.md`, `dashboard.md`,
`remote-management.md` and eleven task records.

**`routes.rs`, `openapi.json`, `tests.rs` and `docs/task/index.md` auto-merged
with no conflict at all.** That is the direct consequence of section 7's
decision to *adopt* RFCT-214's `/state` resolution rather than author a second
one: both branches carried byte-identical text for that route, so git had
nothing to arbitrate. An independent re-derivation of the same behaviour would
have conflicted here, and a conflict in a handler body is materially harder to
resolve correctly than a conflict in a line number.

The merged `/state` route was checked against L2's byte for byte after the merge
and is identical; its response set is the union — 200, 401, **404**, 422, 500,
503, **405**. `openapi.json` was **regenerated** on the merged tree rather than
trusted from the auto-merge, and the regeneration produced no diff, which is the
evidence the auto-merge was already right.

## 8. Out of scope, untouched

`POST /api/v1/setup` (M8), the cookie cutover and section 3.2's dated note (M9),
RFCT-214's continuation census, `docs/design/api.md` section 1 (RFCT-215),
`docs/plan/**`, `docs/task/RFCT-216.md`. M4-M6's shipped routes were not
harmonised or revisited; the `bus_api_error` signature thread in section 4
changes no behaviour on any of them and no line count on any of their call
sites.
