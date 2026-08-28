# PLAN-026 API residue fixes: the six defects PLAN-023 measured and left open

- **status**: approved
- **createdAt**: 2026-08-28 19:45
- **approvedAt**: 2026-08-28 19:45
- **relatedTask**: RFCT-247..252 reserved (M1..M6); task files created by the executing workstream as each milestone starts
- **milestones**: M1 the CIDR gap; M2 the gate asymmetry on undeclared `/api/` paths; M3 the psk quotable gap; M4 the gate-list/router agreement; M5 the mosd-side NotFound convergence; M6 the import unsplits

## Context

PLAN-023's closeout re-measured six code defects at its final HEAD and
deliberately left them unfixed — a documentation closeout is the wrong
instrument for code. Each is pinned with its call chain, line and test in
`docs/task/RFCT-215.md` section 6; that record is this plan's evidence base,
and every milestone starts by re-verifying its item still holds at the
milestone's own HEAD before changing anything.

All six live in `os/pkgs/mosd/` (apid, mosd, mosd-settings). The API error
contract is `docs/design/api.md` §2.4 (absent identifier 404, malformed 422,
one error schema); the breaking-change gate is oasdiff at ERR with the two
promoted check ids, base = main's current tip at each run.

## Proposal

- **M1 (RFCT-247) The CIDR gap.** `PUT /api/v1/network/{iface}` accepts an
  invalid CIDR and answers 204: `validate_iface` (which runs `valid_cidr`)
  is called by both HTML paths and `api_v1_setup`, but by no route of M6's
  typed network cluster. Fix: the typed network write path runs the same
  validation and answers 422 with the §2.4 envelope on failure. Flip the
  pinning test
  (`the_setup_route_runs_the_wizards_cidr_bound_where_the_network_routes_do_not`)
  into the assertion of the closed gap; add invalid-CIDR route tests
  (RED first). Adding a documented 422 response is additive under §2.1.
- **M2 (RFCT-248) The gate asymmetry.** A bearer-only client requesting an
  *undeclared* path under `/api/` is 303-redirected to `/login` — the gate
  hands off only declared routes and its credential test is the cookie.
  Fix: any request under `/api/` that misses the declared set answers the
  API 404 envelope, never the HTML redirect, regardless of credential.
  Undeclared paths are absent from openapi.json, so oasdiff is unaffected;
  the bearer arm of `an_absent_token_id_is_404_and_a_malformed_one_is_422`
  currently asserting the 303 flips to 404.
- **M3 (RFCT-249) The psk quotable gap.** `validate_wifi_psk` accepts a psk
  containing `"` or `\` that `encode_psk`'s `is_quotable` then refuses at
  render time — accepted at the route, dead on the reconciler. Fix at the
  validation boundary: `validate_wifi_psk` rejects the two characters the
  renderer cannot quote, 422 with the envelope, HTML form and API route
  inheriting the same rule from the one shared function. Document the bound
  in api.md where the psk constraint is already stated. If the executing
  task finds legitimate WPA passphrases require those characters, it stops
  and reports instead of widening the renderer silently.
- **M4 (RFCT-250) The gate-list/router agreement.** `is_declared_api_route`
  is a second, hand-maintained list of eighteen clauses and nothing asserts
  it against the router's registrations. Fix by construction, not by test
  alone: derive both the router registrations under `/api` and the gate's
  membership test from one declaration table, so divergence becomes
  impossible rather than detected. If that refactor proves larger than the
  milestone (axum's builder may resist table-driven registration), the
  bounded fallback is an exhaustive test: every declared method+path pair
  probed against the router and asserted handed-off, every neighbour
  asserted enveloped — with the residue recorded.
- **M5 (RFCT-251) The mosd-side NotFound convergence.** `api_v1_state`
  rewrites `FDO_INVALID_ARGS` by reading the fdo error name apid-side; the
  code's own comment names the cleaner fix, and M6 already shipped exactly
  that split for the rotate-key path (`SettingsFault::NotFound` raised in
  mosd's bus layer). Fix: `GetState` with an unresolvable dot-path raises
  `NotFound` mosd-side; apid's name-reading branch is removed; `GetState`'s
  `InvalidArgs` stops carrying two meanings. Wire behaviour of
  `GET /api/v1/state/{path}` is unchanged (404 before, 404 after) — the
  bus-visible error name changes, so mosd bus tests and the e2e phase
  assert the new name.
- **M6 (RFCT-252) The import unsplits.** `use axum::routing::delete;` and
  `use axum::routing::put;` fold into the grouped import and the
  keep-verbatim comment above them goes — RFCT-215 §1.2 re-stated the
  quoted negative as its own measurement, so nothing depends on those lines
  surviving. Citation re-anchor for the shifted lines in its own commit,
  per the standing method rules.

## Risks

- M1/M2/M3 change answers on served routes; each is a tightening (invalid
  input that previously half-succeeded or misrouted now refuses cleanly),
  asserted additive by the oasdiff run against main's tip in every task.
- M4's by-construction form touches route registration wholesale; the
  fallback bound is stated in the milestone so the task cannot silently
  expand.
- M5 crosses the apid/mosd boundary (two crates, one workspace); the e2e
  suite is the arbiter that the wire contract held.
- Every `routes.rs` edit shifts documentation citations; the re-anchor
  commits follow the measured method rules (no constant offset, no
  alignment maps on repeated content, refuse rather than guess).

## Scope

- **In**: `os/pkgs/mosd/**` (apid, mosd, mosd-settings), their tests,
  `os/pkgs/mosd/apid/openapi.json` regeneration, `test/apid-api/**` phase
  amendments where a fixed behaviour is asserted, `docs/design/api.md`
  where a changed bound must be documented, citation re-anchors.
- **Out**: any new API surface, the HTML pane redesign, PLAN-027/028
  scopes, the six items' neighbours not named here.

## Correction (2026-08-28, at dispatch)

M6's premise is false, measured by the executing workstream with a throwaway
application of the exact edit: the fold deletes the verbatim text
`use axum::routing::{any, get, post};` that two armed quotes in frozen task
records (RFCT-210 and RFCT-240) cite and content-check — class B, no line to
re-anchor to — and RFCT-215 section 1 contains no restatement of the write-verb
negative, contrary to what this plan (and RFCT-215 section 6 item 6) claimed.
Ruled option (c): the imports are not folded; RFCT-252 closes with the dated
measurement, recording that the fold becomes gate-legal only if those two
records are ever marked as dated records for their own reasons.

