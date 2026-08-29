# RFCT-244 PLAN-023 M8: POST /api/v1/setup

- **status**: completed — `POST /api/v1/setup` ships unauthenticated, 201 with a token minted through M2's own routine, 409 on the wizard's own condition, and 422 on every rule with **nothing written**; the wizard's CIDR bound was found to be reachable from no `/api/v1/` route and is called here and recorded for the rest; the password floor is lifted to one constant; 836/836 (823 + 13), 1708/1708 citations, 851/851 index, oasdiff RC=0 against both bases; section 11 records the addendum merge of RFCT-246, after which the figures are 836/836, 1714/1714 and 855/855
- **priority**: P1
- **owner**: bkd/ncq7hlys
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-023 (M8)

The last write surface, and the only milestone `docs/task/RFCT-210.md` allows to
fix a behaviour rather than document it. Every fact below was measured on this
branch's HEAD; nothing is relayed.

## 1. What ships

| Route | Method | Credential | Success |
|---|---|---|---|
| `/api/v1/setup` | `POST` only | **none** | **201** with `{"token": "..."}` |

The body is `{"password": "...", "hostname": "...", "network": {...}}`, which is
the shape section 2.3's conversion row spells, `201` with
`{"token": "..."}` (`docs/design/api.md:1559`). `hostname` and `network` are
both optional; only
`password` is required.

Three things it is not. It is not under `/v1/actions/`, because section 2.3 item
(ii) classifies it as fitting none of the three shapes — it writes three
subtrees, it is not a collection, and *"calling it an action understates that it
is the device's one unauthenticated write"* (`docs/task/RFCT-210.md:281-282`).
It declares no `GET`, for the reason M7's three verbs declare none. And it is
the one handler under the prefix whose signature names no credential extractor:
`pub(crate) async fn api_v1_setup(` takes `State(state): State<AppState>,` and
`Source(source): Source,` (`os/pkgs/mosd/apid/src/routes.rs:4106-4108`).

## 2. The acceptance criteria, and how each is discharged

RFCT-210 section 2.5's M8 paragraph is the binding text: *"201 carrying the
credential; 409 when `access.webAdmin` already has a hash; 422 on a hostname or
interface the wizard's own validators reject, with **nothing written**"*
(`docs/task/RFCT-210.md:524-526`).

### 2.1 201 carrying the credential, minted through M2's own routine

The route calls `token::mint` (`os/pkgs/mosd/apid/src/routes.rs:4228`), pushes an
`ApiToken` and writes it through `write_tokens`
(`os/pkgs/mosd/apid/src/routes.rs:4301`) — the same three steps
`api_v1_tokens_mint` takes. There is no second minting routine, which was the
instruction and is also what keeps the two credentials one shape.

Section 3.2 is why a token is minted here where the browser wizard mints none:
*"a caller who drove first-run setup over the API demonstrably wants API access
— but the browser wizard does not"* (`docs/design/api.md:2313-2315`). The token
is labelled `const SETUP_TOKEN_NAME: &str = "first-run setup";`
(`os/pkgs/mosd/apid/src/routes.rs:4049`) rather than
from a request field, because the body has no name member and inventing one
would make the first credential's label the one thing about first-run setup a
client has to get right.

The response body carries `token` and nothing else, which is what section 2.3's
row describes. The id is not a separate member because it is the token's own
second segment, so a caller holding the string can address it for a later
`DELETE` without being told it twice.
`the_api_setup_route_configures_the_device_and_returns_a_token`
(`os/pkgs/mosd/apid/src/tests.rs:10039`) asserts the member set exactly, and then
asserts the token by *using* it against `GET /api/v1/meta` — a token that
authenticated nothing would satisfy the letter of section 3.2 and none of it.

### 2.2 409 on the form path's own condition

Measured, not inferred. `setup_submit` refuses with
`password_hash(&access).is_some()`, and `password_hash` is
`.and_then(|admin| admin.get("password_hash"))`
(`os/pkgs/mosd/apid/src/routes.rs:3255-3260`).
The API route runs that same predicate on the same subtree. It is not "a session
exists" and not "the tree is non-empty", which is why the criterion was
re-measured rather than copied from the rendering.

The code is `already_configured`, new and additive to section 2.4's open set. It
is apid-source and names `access.webAdmin`, because that is the dot-path whose
state refuses the request. 409 and not 422 for the reason
`token_limit_reached` is 409: the body is well formed and nothing about it is
wrong; what refuses it is the collection's — here the device's — current state.

`the_api_setup_route_answers_409_on_the_form_paths_own_condition`
(`os/pkgs/mosd/apid/src/tests.rs:10270`) drives both surfaces against **one**
tree, so neither can drift into answering about a different one.

### 2.3 422 on any validation failure, with nothing written

The order in the handler is: parse the body, read `access` once, answer 409 if
configured, then check every rule, then hash, then write. Each rule is *called*
and not copied:

| Rule | Where it lives | How this route reaches it |
|---|---|---|
| password floor | `const MIN_PASSWORD_BYTES: usize = 8;` (`os/pkgs/mosd/apid/src/routes.rs:3435`), read by `fn password_under_floor(password: &str) -> bool {` (`os/pkgs/mosd/apid/src/routes.rs:3443`) | lifted from two inline `len() < 8` copies; see section 3 |
| hostname | `fn valid_hostname(name: &str) -> bool {` (`os/pkgs/mosd/apid/src/routes.rs:3479`) with `const HOSTNAME_RULES: &str =` (`os/pkgs/mosd/apid/src/routes.rs:3420`) | `&& !valid_hostname(hostname)` (`os/pkgs/mosd/apid/src/routes.rs:4156`) |
| interface name | `fn check_iface_name(iface: &str, path: &str) -> Result<(), Box<Response>> {` (`os/pkgs/mosd/apid/src/routes.rs:2462`) | `if let Err(response) = check_iface_name(iface, NETWORK_SETTINGS_PATH) {` (`os/pkgs/mosd/apid/src/routes.rs:4172`), the same helper M6's four routes use |
| static address CIDR | `fn validate_iface(iface: &str, dhcp: bool, address: &str) -> Result<(), &'static str> {` (`os/pkgs/mosd/apid/src/routes.rs:3498`) calling `fn valid_cidr(cidr: &str) -> bool {` (`os/pkgs/mosd/apid/src/routes.rs:3467`) | `if let Err(message) = validate_iface(iface, cfg.dhcp, address) {` (`os/pkgs/mosd/apid/src/routes.rs:4190`); see section 4 |
| the four relational rules | `fn relational_refusal(entries: &NetworkEntries, path: &str) -> Result<(), Box<Response>> {` (`os/pkgs/mosd/apid/src/routes.rs:2482`) calling `fn validate_entries(entries: &NetworkEntries) -> Result<(), String> {` (`os/pkgs/mosd/apid/src/routes.rs:3762`) | `if let Err(response) = relational_refusal(&candidate, NETWORK_SETTINGS_PATH) {` (`os/pkgs/mosd/apid/src/routes.rs:4205`) on the **candidate** tree |

The relational rules are checked against the stored map merged with the
submission rather than against the submission alone, for the reason the pane's
own comment gives: *"The candidate tree, not the one entry: every relational
rule below is about two entries at once."*
(`os/pkgs/mosd/apid/src/routes.rs:5573-5574`) A bridge port may legitimately name
an interface the device already declares, and
`the_setup_network_tree_is_merged_with_the_stored_one_before_it_is_judged`
(`os/pkgs/mosd/apid/src/tests.rs:10235`) is the case that would be refused by a
route that judged the submission on its own.

Merging is also why the whole map is written in one `SetSettings` at `network`
and not one call per entry: N submitted interfaces are one write, not N chances
to half-apply. It is additive — an entry already declared is replaced whole, one
that is not is added — which is what the wizard's single-interface write does,
generalised. A route that replaced the map could unmake the entry a
factory-fresh device is reachable over, which is the harm this milestone exists
to prevent rather than to introduce.

`every_setup_validation_failure_is_422_and_writes_nothing`
(`os/pkgs/mosd/apid/src/tests.rs:10301`) drives four rejections and asserts, for
each, the 422, the code, the message, `assert_nothing_written`, and that the
device is still in setup mode.

## 3. The behaviour this milestone fixes, and the one it does not

### 3.1 What RFCT-210 measured

Section 2.3 item (ii): *"the password is written and the audit event recorded
before the hostname and network writes are attempted"*
(`docs/task/RFCT-210.md:283-284`), so a failure halfway leaves the device out of
setup mode with no hostname.

Re-measured here rather than relayed, and the measurement refines the claim in
one way worth stating: **the wizard already validates its optional sections up
front** — its own comment says *"Validate the optional sections up front so
nothing is written on error."* (`os/pkgs/mosd/apid/src/routes.rs:3915`). So what
is left on the form path is not a *validation* partial failure but a **bus**
partial failure: the wizard's
`if let Err(err) = state.api.set_settings("access.webAdmin", &value).await {`
(`os/pkgs/mosd/apid/src/routes.rs:3950`) succeeds and the `hostname` write after
it does not.

### 3.2 What this route does instead

Two things, and only the first is the mandated fix.

**Everything is validated before anything is written.** Every rule in section
2.3's table runs, and the password is hashed, before the first `SetSettings`.
So no validation failure can write anything, which is the criterion.

**The writes then run in the order that fails safe.** First
`.set_settings("hostname", &Value::String(hostname.to_string()))`
(`os/pkgs/mosd/apid/src/routes.rs:4270`), then
`&& let Err(response) = write_network_map(&state, candidate).await`
(`os/pkgs/mosd/apid/src/routes.rs:4276`), then
`if let Err(err) = state.api.set_settings("access.webAdmin", &value).await {`
(`os/pkgs/mosd/apid/src/routes.rs:4283`), and last
`if let Err(response) = write_tokens(&state, &tokens).await {`
(`os/pkgs/mosd/apid/src/routes.rs:4301`). The password
write is third because it is the write that takes the device out of setup mode.
That ordering is not a change to a shipped behaviour — there was no route here
to change — but it is a decision, so it is asserted as an order and not as a set
by `the_api_setup_route_writes_the_password_after_the_settings_it_may_fail_on`
(`os/pkgs/mosd/apid/src/tests.rs:10089`), which also asserts the wizard's opposite
order in the same test.

What survives, named: a bus failure on the **last** write leaves a configured
device with no token. The caller gets a 500 and signs in with the password it
just set. Every earlier failure leaves the device in setup mode. There is no
ordering in which nothing survives, because there is no transaction.

### 3.3 The divergence, with a paired test naming its opposite

The HTML form path is **not** fixed. Doing so needs a transactional multi-path
write on the bus, which is a mosd change and outside PLAN-023's scope — the
scope boundary RFCT-210 item (ii) already drew.

`the_api_setup_route_validates_before_writing_where_the_form_path_does_not`
(`os/pkgs/mosd/apid/src/tests.rs:10131`) drives **one** partial failure through
both surfaces and asserts both outcomes:

| | write log | after the failure |
|---|---|---|
| `POST /api/v1/setup` | empty | still in setup mode |
| `POST /setup` | `["access.webAdmin"]` | out of setup mode, hostname still `mos` |

The fixture is `RefusesOnePath` (`os/pkgs/mosd/apid/src/tests.rs:9964`), added
because no existing one can make this assertion. `FailingSettings` fails *every*
write, and a route that writes nothing is then indistinguishable from one that
writes the password first: both come back 5xx with an empty tree. A partial
failure needs exactly one path to fail and the others to succeed.

One further difference the same test records, and it is about rendering rather
than about what was written: the wizard answers **503** on any failed mosd call,
because `fn bus_error(err: &anyhow::Error) -> Response {`
(`os/pkgs/mosd/apid/src/routes.rs:3266`) answers
`StatusCode::SERVICE_UNAVAILABLE,` (`os/pkgs/mosd/apid/src/routes.rs:3269`)
whatever mosd said, where the API carries the classification through as 500
`settings_io`.

## 4. A finding: the CIDR bound was reachable from no API route

Section 2.3's instruction is to check where each rule lives before calling it.
One of them was in the pattern this workstream has hit repeatedly.

`valid_cidr` (`os/pkgs/mosd/apid/src/routes.rs:3467`) has exactly **one** caller,
`validate_iface` (`:3505`), whose own two callers are both HTML form handlers —
the network pane's entry builder (`:3600`) and `setup_submit` (`:3914`). So at
the pre-image, **no route under `/api/v1/` ran it**, M6's typed network cluster
included.

It is reachable, so by the stated rule this route **calls** it:
`if let Err(message) = validate_iface(iface, cfg.dhcp, address) {`
(`os/pkgs/mosd/apid/src/routes.rs:4190`), rather than lifting it or copying it.
The name branch of `validate_iface` cannot fire there, because
`check_iface_name` tests the same predicate immediately above, so the only
message it can produce on this route is the CIDR one.

Calling it makes this route stricter than `PUT /api/v1/network/{iface}`, and
that gap is **recorded, not closed**: harmonising M4-M7's shipped routes is
outside this task. It is measured rather than read —
`the_setup_route_and_the_network_routes_run_one_shared_cidr_bound`
(`os/pkgs/mosd/apid/src/tests.rs:10552`) sends the same entry three ways and,
when this task ran, asserted 422 from this route, 422 from the wizard, and
**204** from M6's route. It ran then under the name
the_setup_route_runs_the_wizards_cidr_bound_where_the_network_routes_do_not;
PLAN-026 M1 closed the gap, flipped the third assertion to 422 and renamed the
test, so the pointer above is re-derived from the renamed content.

The reason this route does not wait for the cluster-wide fix is that the harm is
different at first run: a factory-fresh device configured with an address the
kernel cannot parse has no other way in, which is the unreachable box section
2.3 item (ii) is about.

**Left for the campaign**: the same call belongs on `PUT /api/v1/network`,
`PUT /api/v1/network/{iface}` and the wizard-equivalent bodies M6 ships. One
route, one milestone; this record is the place a reader of the cluster will find
it named.

## 5. Two shared edits, both mechanical

### 5.1 The password floor, lifted

It was spelled `len() < 8` inline at two call sites — `setup_submit` and
`change_password`. M8 is a third enforcer, and a third copy is what this file's
rotate-key route argues against in the general case: copies of one rule can
disagree, and here disagreeing would mean one surface accepting a credential
another refuses. So `MIN_PASSWORD_BYTES` (`os/pkgs/mosd/apid/src/routes.rs:3435`)
and `password_under_floor` (`:3446`) hold the bound once and the three call
sites read it. No message changed and no behaviour changed: the wizard still
answers 400 with *"Password must be at least 8 characters."* and
`change_password` still returns `TooShort`.

Not lifted, deliberately: the `minlength="8"` attribute on the wizard's two
password inputs and the *"at least 8 characters"* label beside them. Those are a
browser hint and prose, not the enforcement, and interpolating a constant into
rendered markup would be a change to the pane this task has no reason to make.

### 5.2 `json_body`'s dot-path widened to `Option`

M6's helper hard-coded `path: &str` because all three of its callers write one
subtree and name it. This route writes three, and a malformed body is not about
any one of them, so the parameter is now `path: Option<&str>,`
(`os/pkgs/mosd/apid/src/routes.rs:2552`) — which is what section 2.4 already says
the member is: *"present only when the failure names a dot-path"*
(`docs/design/api.md:1713`). The three M6 call sites pass `Some(...)` and their
behaviour is unchanged.

## 6. The error contract, against section 2.4's table

| Condition | Status | `code` | `source` | `path` |
|---|---|---|---|---|
| success | 201 | — | — | — |
| body is not JSON | 400 | `request_invalid` | apid | **absent** |
| body is JSON but not this shape | 422 | `validation_failed` | apid | **absent** |
| already configured | 409 | `already_configured` | apid | `access.webAdmin` |
| password under the floor | 422 | `validation_failed` | apid | `access.webAdmin` |
| hostname rejected | 422 | `validation_failed` | apid | `hostname` |
| interface name, CIDR or relational rule | 422 | `validation_failed` | apid | `network` |
| stored token list unreadable | 500 | `settings_invalid` | apid | `access.apiTokens` |
| no free token id | 500 | `mint_failed` | apid | `access.apiTokens` |
| hashing failed | 500 | `hash_failed` | apid | `access.webAdmin` |
| mosd refused or failed a write | mosd's own | from `bus_api_error` | mosd | the path written |
| wrong method | 405 | `method_not_allowed` | apid | absent |

Two codes are new and additive to section 2.4's open set: `already_configured`
and `hash_failed`. Both are decided by the route from the condition it is in,
never by string-matching a validator's message.

The 400/422 split on the body is `json_body`'s, inherited rather than
re-authored: not-JSON-at-all is 400 and JSON-of-the-wrong-shape is 422, which is
also what section 2.3's row asks of this route (*"422 on any validation
failure"*). The cost is named: because one body carries three subtrees, a shape
error inside `network` reports no dot-path where M6's `PUT /api/v1/network`
would report `network`.

`a_malformed_setup_body_is_refused_at_400_and_names_no_dot_path`
(`os/pkgs/mosd/apid/src/tests.rs:10388`) holds the absent member, and
`a_rejected_setup_password_is_never_echoed`
(`os/pkgs/mosd/apid/src/tests.rs:10363`) holds that no refusal repeats the
password, in body or headers, not even as a fragment.

## 7. Unauthenticated, and how narrowly

The gate does not make an exception for this route. It lets **every** declared
`/api/` route through — `path == "/healthz" || is_declared_api_route(path)` — and
each answers for itself in section 2.4's envelope rather than in HTML. So the
extension is one line in that predicate, `|| leaf == V1_SETUP_PATH`
(`os/pkgs/mosd/apid/src/routes.rs:560`), and what makes this route open is that
its signature names no `ApiSession` and no `ApiBearer`.

`the_setup_route_is_the_one_api_route_that_takes_no_credential`
(`os/pkgs/mosd/apid/src/tests.rs:10409`) asserts both halves in setup mode, which
is the only mode where the question is live: five other write routes answer 401
with section 2.4's envelope and **no** `Location` header — a redirect is what a
script reads as success — and the setup route answers 201 with nothing
presented at all.

The audit event is the wizard's own —
`state.audit.record("setup", "completed", &source);`
(`os/pkgs/mosd/apid/src/routes.rs:4293`) — because it is the same event: section
6's trail says what happened to the device, not which surface asked.
`the_api_setup_route_records_the_wizards_own_audit_event`
(`os/pkgs/mosd/apid/src/tests.rs:10458`) checks the event and that neither the
password nor the minted token reaches any line of the log.

## 8. Gate results

All four re-run on the merged tree, after the citation pass and not before it.

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | `1708/1708 PASS`, RC=0 |
| `bash docs/verify-index.sh` | `851/851 PASS`, RC=0 |
| `bash os/pkgs/mosd/hack/check.sh`, unmodified, in the amd64 builder | `Summary [  69.272s] 836 tests run: 836 passed, 0 skipped`; `advisories ok, bans ok, licenses ok`; `ALL CHECKS PASSED` |
| `oasdiff breaking … --fail-on ERR --severity-levels …` vs `main` tip `77a3278` | `No breaking changes to report`, **RC=0** |
| the same, vs `bkd/vu5b6kk0` at `2d6e558` | `No breaking changes to report`, **RC=0** |

`851/851` is the L2 tree's `847/847` plus the four assertions this record's index
row adds. `1708/1708` is L2's `1657/1657` plus the 51 citations this record
carries; the 1657 was re-measured on the merged tree before any citation was
classified, which is what makes it a base.

**RC=0 against `main`'s tip is the check that matters**: it proves nothing in
this milestone removed a response `main` added. The change is one new path plus
two new schemas, which oasdiff rates additive.

The gate script ran unmodified. Two things sat around it and neither touched it:
`dbus` was installed in the container first, without which the bus round-trip
test exits 100, and `docker image inspect --format '{{.Architecture}}'` was
confirmed to print `amd64` before any result from that image was believed.
oasdiff is the 1.29.1 release the workflow pins, sha256-checked against the
pinned digest, run with the same two severity promotions the workflow writes.

## 8b. Test arithmetic

Counted the three ways the brief asks: `#[test]`, `#[tokio::test]` and
`#[tokio::test(flavor = "multi_thread")]`, over `os/pkgs/mosd/**/*.rs`,
`target/` excluded. Both bases measured here rather than relayed.

| | `#[tokio::test]` | `multi_thread` | `#[test]` | total |
|---|---|---|---|---|
| `bkd/vu5b6kk0` at `2d6e558` | 406 | 18 | 399 | **823** |
| this branch's pre-image `56a2bc4` | 406 | 18 | 399 | **823** |
| this tree | 418 | 18 | 400 | **836** |

**823 + 13 = 836**, and nextest reports 836. The merge added no test — the
pre-image and the L2 tip measure the same 823, because this branch was cut from
`main` with no work of its own, so the merge was clean and brought L2's suite
across whole.

The thirteen, each confirmed PASS **by name** in the merged-tree run log:

| Test | What it holds |
|---|---|
| `the_api_setup_route_configures_the_device_and_returns_a_token` | 201, a one-member body, the writes landed, and the token authenticates `GET /api/v1/meta` |
| `the_api_setup_route_writes_the_password_after_the_settings_it_may_fail_on` | the write order as an order, and the wizard's opposite order beside it |
| `the_api_setup_route_validates_before_writing_where_the_form_path_does_not` | one partial failure through both surfaces, opposite outcomes |
| `an_invalid_network_entry_leaves_the_device_in_setup_mode` | M8's stated acceptance: 422, nothing written, still in setup mode |
| `the_setup_network_tree_is_merged_with_the_stored_one_before_it_is_judged` | a bridge port naming a stored entry is legal, and the stored entry survives |
| `the_api_setup_route_answers_409_on_the_form_paths_own_condition` | both surfaces refuse one tree; nothing written |
| `every_setup_validation_failure_is_422_and_writes_nothing` | four rejections, each 422 with nothing written, plus the wizard's 400 on the floor |
| `a_rejected_setup_password_is_never_echoed` | no echo in body or headers, not even a fragment |
| `a_malformed_setup_body_is_refused_at_400_and_names_no_dot_path` | §2.4's optional member absent when nothing is at fault |
| `the_setup_route_is_the_one_api_route_that_takes_no_credential` | five sibling writes are 401 with no `Location`; this one is 201 |
| `the_api_setup_route_records_the_wizards_own_audit_event` | the same §6 event, and neither secret in the log |
| `the_openapi_document_covers_the_setup_route` | `POST` only, every status, both bodies member for member, and **no** documented 401 |
| `the_setup_route_runs_the_wizards_cidr_bound_where_the_network_routes_do_not` | 422 here, 422 at the wizard, **204** from M6's route |

**No test was renamed.** One existing test changed its data and neither its name
nor an assertion: `a_wrong_method_on_a_declared_api_route_answers_the_envelope`
gained the `("GET", "/api/v1/setup", "POST")` row, which is where this route's
"no `GET` handler" property is asserted, by the same per-route expectation every
other declared route is checked by.

## 9. Citations

Own commit, numbers only, one derivation from one base.

**The base.** This branch was cut from `main` and had no work of its own when it
merged `bkd/vu5b6kk0`, so the merge was clean: **no conflicts at all**, in
citation documents or in code. That removes the whole asymmetry M7 had to
reason about — there is no "L2's numbers versus mine", because every citation
document in this tree held exactly L2's text. The pre-image is `56a2bc4`, this
branch's own claim commit, and it was verified gate-green first — 1657/1657 and
851/851 — so every old line was right before any of it was classified.

**The derivation.** One map from `56a2bc4` to this tree, applied in one
simultaneous pass per document by character offset rather than by string
replacement, so a citation rewritten to a value could not be rescanned by the
rule whose old value is that same number.

**The M7 trap, avoided by construction and then checked anyway.** The failure
mode M7 recorded — a document whose numbers get mapped twice, producing a
plausible number pointing at the wrong line — cannot arise from a clean merge,
but the code changed twice here (the route, then the CIDR call), so the pass was
run twice against different trees. The second run did not touch the output of
the first: every citation-bearing document was `git checkout`ed back to
`56a2bc4`'s exact text and the map re-derived from that single base. The check
that this worked is mechanical — re-deriving from the reset base reproduces the
committed tree byte for byte, `git diff HEAD -- docs/` empty — and the citation
total coming back to 1657 for the corpus that existed before this record is the
second half of it.

**306 full-form citations rewritten**, across 21 documents, in **eight distinct
bands** — no constant offset, which is why a single offset was never applied:

| File | Bands (lines added before the citation) | Count |
|---|---|---|
| `os/pkgs/mosd/apid/src/routes.rs` | +9 | 23 |
| | +17 | 4 |
| | +18 | 33 |
| | +28 | 114 |
| | +52 | 24 |
| | +366 | 85 |
| `os/pkgs/mosd/apid/openapi.json` | +0 (a range whose start is before the insert and whose end is after) | 3 |
| | +92 | 20 |

Every one was accepted only where **both** endpoints of the cited range map into
an unchanged block and the text at each endpoint is byte-identical before and
after. **Zero needed hand resolution**, and zero were refused — which is what a
purely additive change to two files should produce, and is stated because a pass
that reports no hand cases without saying it checked is indistinguishable from
one that did not check.

**Bare `` `:NNN` `` continuations: measured, and left in place.** They are
RFCT-214's census and PLAN-023 gives it to that task, so nothing here rewrites
one. The rule used to attribute a file to a bare token is stated because it
changes the number: the antecedent is **the nearest preceding full-form citation
anywhere in the same document**, which is RFCT-212's rule and the one M7
reported under.

| | Population | Moved by this delta |
|---|---|---|
| bare with an `os/pkgs/mosd/apid/src/routes.rs` antecedent | 209 | **146** |
| bare with an `os/pkgs/mosd/apid/openapi.json` antecedent | 1 | 0 |

The population is 209 at the pre-image **and** at this HEAD, which is the check
that this task neither added nor removed one. It does not reproduce M7's figure
of 184, and the difference is in the rule rather than in the corpus: the two
other antecedent scopings the brief's own vocabulary suggests give 18
(same-line) and 138 (same-paragraph) at this HEAD, so no scoping recovers 184
and M7's rule is not reconstructible from its record. **209 / 146 is the figure
measured here**; it is not a correction of M7's, and the two are not comparable.

## 10. Out of scope, untouched

- M9's cookie cutover and section 3.2's dated note.
- `docs/design/api.md` section 1 (RFCT-215), `docs/plan/**`,
  `docs/task/RFCT-216.md`, `test/apid-api/**` (RFCT-246 is live there).
- M4-M7's shipped routes, neither harmonised nor revisited. The one thing found
  about them — that no `/api/v1/` route ran the CIDR bound — is recorded in
  section 4 with a test that pins M6's current answer, and is **not** changed.
- The HTML form path's bus-level partial failure, for the reason section 3.3
  gives.
- `POST /builtin/deactivate` (section 2.3 item iii), still deferred.

## 11. Addendum: carrying RFCT-246 across the merge

Added after this record was first closed, at L2's instruction. RFCT-246
(`bkd/x4agijkt`) had become unstartable in BKD and could not perform its own
final merge, so this task carried its finished branch across. **Nothing under
`test/apid-api/**` was authored, edited or re-run here**; the suite was not
rebuilt, which is owed to M9.

### 11.1 The merges

`git merge bkd/vu5b6kk0` **fast-forwarded** — L2 had already merged this task's
M8 work as `6d94d72`, so the base for everything below is L2's tip *including*
M8, and there were no shifts of this task's own left to re-apply.

`git merge bkd/x4agijkt` then conflicted in five files. `test/apid-api/**` did
**not** conflict, and its result is byte-identical to RFCT-246's branch —
`git diff bkd/x4agijkt HEAD -- test/apid-api/` is empty.

| Conflict | Resolution |
|---|---|
| `docs/task/index.md` | all rows kept, one per line, ascending: 240, 241, 242, 243, 244, 246 |
| `docs/design/api.md`, `docs/task/RFCT-200.md`, `docs/task/RFCT-210.md`, `docs/task/RFCT-242.md` | L2's text as the base, then section 11.2 |

### 11.2 A finding: the asymmetry rule points the other way here

The standing rule is *take the L2 side for every citation document, then
re-apply only the shifts your own changes introduce*, and its stated reason is
that L2 carries **content re-derivations** that no pre-image map can recover.

On this merge the polarity is reversed, and it is measurable. RFCT-246's branch
carries **no `os/` change at all** — `os/pkgs/mosd/apid/src/routes.rs` is
byte-identical between its base `823476a` and its tip — so **every** citation
number it changed is a content re-derivation and **none** is a shift. There was
nothing for a map to recover. Applied literally, the rule would have discarded
all 41 of them.

The clearest instance, and the reason this is a finding rather than a
preference. Stated as a measurement of past trees, so the numbers below are
deliberately not written as resolvable citations. At `823476a`
`docs/design/api.md` named `redirect_app()` and cited lines 3140-3144 of
`routes.rs`, while `pub fn redirect_app` sat at line 3168 of that same tree: the
citation named one construct and pointed at another. RFCT-246 corrected it to
3168-3172. L2's own pass, being mechanical, faithfully carried the wrong number
forward to 3204-3208, which at L2's tip `6d94d72` is the middle of the bearer
check — `return false;` and the comment above
`token::verify(&parse_tokens(&access).unwrap_or_default(), presented)`
(`os/pkgs/mosd/apid/src/routes.rs:3208`). Both numbers are gate-green, because
the interposed word in *"`redirect_app()` at …"* demotes the pair to
resolution-only; only one is right. In this tree the citation reads 3232-3236
and points at the function.

So the four documents were resolved as **L2's text, plus RFCT-246's 41
re-derivations carried across the same mechanical map**. That is not authoring:
each anchor is RFCT-246's own measurement, transposed from the tree it was
measured on to this one.

### 11.3 The citation pass

One commit, numbers only, and **two bases** — because two different documents'
text came from two different branches, and mapping either from the other's base
is the double-application M7 recorded:

| Set | Base | Result |
|---|---|---|
| (A) `docs/task/RFCT-246.md`, every citation | `bkd/x4agijkt` | 3 remapped, 3 unmoved |
| (B) the 41 re-derivations in the four documents | `bkd/x4agijkt` | 41 carried |
| (C) every other document's citations into `test/apid-api/**` | `6d94d72` | 14 checked, **0 moved** |

The two bases cite disjoint file sets — (A) and (B) rewrite citations into
`os/`, (C) into `test/` — so no citation is mapped twice. **Zero hand
resolutions and zero refusals**; every rewrite had both endpoints inside an
unchanged block with byte-identical text at each. Nine distinct bands, no
constant offset: `routes.rs` +41, +57, +64, +88, +402, +415, +484, +569 and
`tests.rs` +34.

(C) is stated as a measurement rather than assumed: RFCT-246 edits
`test/apid-api/run.sh`, `README.md`, `src/main.ts` and `05b-wireguard.ts`, and
fourteen citations across the corpus point into those files. None of them moved.

**Bare `` `:NNN` `` continuations: RFCT-246 changed none** — its 41 rewrites are
all full-form — so RFCT-214's census is untouched by this merge, and the figures
in section 9 stand.

Re-deriving both passes from the merge commit reproduces this tree byte for
byte, which is the check that nothing was mapped twice.

### 11.4 Gates after the addendum

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | `1714/1714 PASS`, RC=0 |
| `bash docs/verify-index.sh` | `855/855 PASS`, RC=0 |
| `bash os/pkgs/mosd/hack/check.sh`, unmodified, amd64 | `836 tests run: 836 passed`; `ALL CHECKS PASSED` |
| `oasdiff` vs `main` `77a3278` / vs L2 `6d94d72` / vs `bkd/x4agijkt` | RC=0, RC=0, RC=0; **"No changes detected"** against L2 |

The Rust count is unchanged at **836** because RFCT-246's deliverable is
TypeScript. `bkd/x4agijkt` measures 813 on its own, which is its stale base
(`823476a`, pre-M7/M8) and not a regression.

**Not done, deliberately**: the `test/apid-api` suite was not rebuilt or re-run.
RFCT-246's 37/37 and 376/376 were measured against an image built before
`POST /api/v1/setup` existed; the re-run against the completed write surface is
M9's, and L2 is tracking it there.
