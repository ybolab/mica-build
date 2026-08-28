# RFCT-240 PLAN-023 M4: the scalar settings writes and the redaction-sentinel refusal

- **status**: completed — the four scalar writes land at 204, the redaction sentinel is refused at 422 before the allowlist is consulted, every other dot-path is refused 422/404/409 by apid before a bus call, and the citation re-anchor is measured against a green pre-image; every gate green and oasdiff reports no breaking change
- **completedAt**: 2026-08-28
- **priority**: P1
- **owner**: bkd/zu1bdr5l
- **createdAt**: 2026-08-28
- **plan**: PLAN-023 (M4)

The first milestone of the ratified write surface. `PUT /api/v1/settings/{path}`
for the four dot-paths `docs/task/RFCT-210.md` section 2.2 admits, plus the two
rules that travel with them: a body carrying the redaction sentinel is refused
rather than written, and every dot-path outside the four is refused by this
route rather than passed through to mosd.

Nothing else moves. Collections are M5, the network cluster M6, the actions M7,
`POST /api/v1/setup` M8, and the cookie cutover M9. That split exists so each
milestone is independently revertible, and a write route that reached into a
neighbouring cluster would spend that property on nothing.

## 1. What ships

`PUT /api/v1/settings/{path}`, declared on the shipped read's own route as
`get(api_v1_settings).put(api_v1_settings_write),`
(`os/pkgs/mosd/apid/src/routes.rs:404`) and authenticated by `ApiSession` —
bearer **or** cookie.

| Dot-path | Body | Success |
|---|---|---|
| `hostname` | a JSON string accepted by `fn valid_hostname(name: &str) -> bool {` (`os/pkgs/mosd/apid/src/routes.rs:3394`) | `204` |
| `access.ssh.enabled` | `true` or `false` | `204` |
| `container.enabled` | `true` or `false` | `204` |
| `mqtt.enabled` | `true` or `false` | `204` |

`204 No Content` and no body, per the M1 design: the value the caller sent is
the value that was written, and echoing it back only invites a client to
believe the echo over its own `GET`.

These four and no others because they share the property section 2.2 names —
*"the value being written is a scalar whose validity depends on nothing else
in the tree"* (`docs/task/RFCT-210.md:212-213`). A hostname is decided by
`valid_hostname` alone; the three switches, in section 2.2's words, *"cannot be invalid at all"* (`docs/task/RFCT-210.md:215`). The first
path that needs a second entry to decide it is a later milestone by
construction.

**The hostname is not trimmed, and the form path trims.** `hostname_submit`
trims -- `let hostname = form.hostname.trim();`
(`os/pkgs/mosd/apid/src/routes.rs:5448`) -- because a browser sends whatever
was typed into a text input; a client that built a JSON string
chose its bytes, and writing something other than what it sent is the worse
answer. `" mos "` is a 422 here and a successful `mos` there. Recorded as a
deliberate difference rather than left to be found.

**No `access_cache` invalidation, and that is not an omission.** mosd emits
`SettingsChanged` for the path it wrote and apid's subscription drops the cache
for anything under `access`: *"the whole tree, `access` itself, or anything
under it"* (`os/pkgs/mosd/apid/src/access_cache.rs:35-37`). That is what the
`access.ssh` form path already relies on, whose whole write is
`.set_settings("access.ssh.enabled", &Value::Bool(enabled))`
(`os/pkgs/mosd/apid/src/routes.rs:5754`). The token routes invalidate by
hand because a revocation has to bite on the very next request; nothing this
route writes is a credential.

## 2. The redaction-sentinel refusal

**A `PUT` whose body carries `"<redacted>"` anywhere inside it is refused at
422 `validation_failed`, and nothing is written.**

### 2.1 What the sentinel actually is, measured here

`REDACTED` is the string `<redacted>`
(`os/pkgs/mosd/apid/src/redact.rs:19-20`), and `redact::walk` substitutes it
for the value of any field named `psk`, `passwordHash`, `password_hash`, `hash`
or `privateKey` -- `["psk", "passwordHash", "password_hash", "hash", "privateKey"]`
(`os/pkgs/mosd/apid/src/redact.rs:40`) -- at any depth and inside arrays. The refusal scans for it the same way,
in `redact::carries_sentinel`, so the two halves of the rule cannot disagree
about its spelling: they read one constant in one file.

Strings at any depth and inside arrays, because that is where a read puts it.
Field *names* are not examined — a read substitutes values and never renames a
field, so a key that happens to spell the sentinel did not come from one.

### 2.2 Why it is a refusal and not a write

The failure it prevents is concrete and it is silent. A client does
`GET /api/v1/settings/access`, edits one field, and `PUT`s the result back.
Without the check that write succeeds and `access.webAdmin.password_hash`
becomes the literal string `<redacted>` — a value no password verifies against,
with no read-back to notice it and no undo.
`a_write_carrying_the_redaction_sentinel_is_refused_and_writes_nothing` drives
exactly that round trip: it reads the subtree through the shipped route, hands
the bytes back verbatim, asserts the 422, asserts the bus saw no write, and
asserts the admin password still logs in.

### 2.3 The code and the status, against section 2.4's vocabulary

**422**, because `docs/design/api.md` section 2.2 states it:
*"a `PUT` whose body contains `"<redacted>"` is rejected at 422 rather than
written, because writing the sentinel would silently destroy the credential"*
(`docs/design/api.md:1292-1295`).

**`validation_failed`**, from the existing set rather than a new token.
Section 2.4's `code` is an open set whose contract is that an unrecognised
value falls back to the status class, so a new token is not free: every client
that wants to branch on it has to learn it. `validation_failed` is already the
code apid raises when it refuses a body at 422 — for the token name,
`ApiError::apid("validation_failed", key_error_message(&err))`
(`os/pkgs/mosd/apid/src/routes.rs:1606`), and for the token id,
*"a token id is 1 to 64 lowercase hex characters"*
(`os/pkgs/mosd/apid/src/routes.rs:1509`) — and that is what this is: apid
inspected the body and refused it. `source` is `apid`, because no bus call was
made. The message names the sentinel, so a client that reads only the message
still learns which value was the problem.

**Checked before the allowlist, not after.** This is a rule about the body and
not about the path. Placing it after the allowlist would make it dead code
today — none of the four writable paths reaches a redacted field — and would
silently un-guard it the day M5 or M6 widens the allowlist to a subtree that
does. It also gives the better answer: a client that handed back a redacted
`access` subtree is told what it got wrong, not that it used the wrong route.

**The cost, named.** An operator who genuinely wants a setting whose value is
the ten characters `<redacted>` cannot write it through this route. No such
setting exists in the schema — every field the allowlist reaches is a hostname
or a boolean — and the alternative is a rule that cannot tell the destructive
case from the deliberate one.

## 3. The write-refusal list

**An allowlist, and every dot-path outside it is refused by this route.**

### 3.1 Why not a passthrough

The alternative — pass the path to mosd and let its validators answer — is
wrong here, and the reason is measured rather than stylistic. `Settings::set`'s
documented contract is *"Missing intermediate map entries are created (e.g.
setting `network.eth1.dhcp` creates `eth1`)"*
(`os/pkgs/mosd/mosd-settings/src/model.rs:710-711`), proved by the committed
test `set_scalar_and_create_intermediate_entries`
(`os/pkgs/mosd/mosd-settings/tests/settings.rs:128-141`). So a `PUT` to a
mistyped path does not fail under a passthrough — it grows a new subtree of
whatever kind the schema defaults to, and the reconciler is the first thing to
notice. `docs/task/RFCT-210.md` section 2.4 walks that exact failure on
`POST /network/peers/add`, where adding a peer to an undeclared `wg9` writes a
physical-kind `network.wg9` carrying a WireGuard block. An allowlist makes the
class impossible instead of arguing about each member of it.

### 3.2 The three answers, and why they are not interchangeable

`fn settings_write_refusal(path: &str) -> Response {`
(`os/pkgs/mosd/apid/src/routes.rs:1031`) gives one of three, in this order:

1. **422 `validation_failed`** — the path is not a dot-path: an empty segment,
   an unterminated quote, text after a closing quote. This is the *malformed*
   half of section 2.4's rule.
2. **404 `settings_not_found`** — the path is well formed and names nothing.
   Answered by the shared helper M2 landed,
   `fn item_not_found(collection: &str, identifier: &str) -> Response {`
   (`os/pkgs/mosd/apid/src/routes.rs:1544`), so the rule is inherited by
   reaching for the function rather than by remembering a decision.
3. **409 `settings_read_only`** — the path names something real that this route
   does not write. 409 for the condition section 2.4 already spends it on and
   the mint route already uses: the body is well formed and nothing about it is
   wrong, and what refuses it is the state of the surface.

`mosd-settings` cannot make the 404/422 split for a caller: `split_path`
reports a malformed path as `SettingsError::NotFound` and so does a path that
resolves nowhere, and `json_path_get` collapses both to `None`. This milestone
therefore exports `pub fn path_segments(path: &str) -> Option<Vec<String>> {`
(`os/pkgs/mosd/mosd-settings/src/path.rs:65`), the public half of `split_path`,
which is the same shape `is_api_token_id` already has for the token route's
identical split.

### 3.3 "Names nothing" is decided on the first segment, and that is about writes

A *read* that does not resolve is absent at its leaf. A *write* is not: its job
may be to create the leaf it names, because `Settings::set` creates missing
intermediates. So a missing leaf cannot be what "absent" means here. The one
thing a write can never create is a top-level key the typed schema has no field
for — such a tree does not deserialize, so `Settings::set` refuses it whatever
the value. That is the line: `network.eth9.dhcp` is a write that may
legitimately create `eth9`, while `netwrok.eth0.dhcp` can never be anything but
a typo.

The root set is derived from `Settings::default()` rather than listed in apid.
Every field of that struct serialises unconditionally, so the default tree's key
set *is* the schema's top level, and a key added to the struct is covered with
no edit here. `the_settings_schema_has_the_eight_roots_the_write_route_knows`
pins the derivation to v8's eight keys, so a
`#[serde(skip_serializing_if)]` added to a top-level field — which would drop a
real root out of the default tree and silently turn its 409 into a 404 — fails
as a test rather than in the field.

### 3.4 Two refusals say why, not only that

- **`schema_version`** is read-only in the settings tree itself and not merely
  here: `Settings::set` answers `SettingsError::ReadOnly` for it and no later
  milestone widens this route to cover it. Its message says that, so a reader
  is not left expecting M5 to add it.
- **`network`** names the route that does own it,
  `PUT /api/v1/network/{iface}`, and says this build does not serve it yet.
  Named rather than folded into the general sentence because it is the one
  subtree where a passthrough is actively destructive rather than merely wrong.

Everything else gets one sentence naming the four paths this route writes.

## 4. Auth

Bearer **or** cookie, matching `pub(crate) struct ApiSession;`
(`os/pkgs/mosd/apid/src/routes.rs:3061`) after M2. PLAN-023 Amendment 1's
bearer-only rule is about the token routes specifically — a permanent-credential
factory must not sit behind a browser session — not about new routes in
general. A write route that took only a bearer would make the shipped panes'
credential unusable on a surface the panes' own operations are being moved to.

`is_declared_api_route` needed no change: it tests the path and not the
method, ending at `|| resource_dot_path(leaf).is_some()`
(`os/pkgs/mosd/apid/src/routes.rs:517`), so the gate already handed a `PUT`
under `/api/v1/settings/` to the route that now serves it. The 401 is the
envelope and never the gate's redirect, in both gate modes, and that is
asserted rather than inherited.

## 5. What this change makes false elsewhere

Recorded and not rewritten, because each belongs to a section this task is not
the assignee for. Only the one sentence whose armed quote this change deleted
was restated; see section 7.

1. `docs/design/remote-management.md`'s *"The JSON API under `/api` is
   read-only"* and *"every route inside is a GET"*. The quoted fragment
   `get(api_v1_settings)` is still literally at the line cited, because the
   declaration now reads `get(api_v1_settings).put(api_v1_settings_write)`, so
   the citation stands and the paragraph's reading of it does not.
2. `docs/design/api.md` section 3.2's *"the four served paths are `GET` only"*.
   Three of the four still are; the settings root now takes a `PUT`.
3. `docs/design/api.md` section 2.2's heading and its *"Two of the three roots
   below exist, read-only"*, and section 2.3's *"None of the three verbs §2.3
   proposes ... is served: the published document lists five operations"*. Both
   are status prose about the whole write surface, which M4 through M9 change
   one milestone at a time; rewriting either here would state a completeness
   this milestone does not have. The one sentence in that paragraph whose armed
   quote this change *deleted* had to be restated and was; see section 7.
4. `docs/task/RFCT-210.md`'s central negative — *"There is no `put(`, no
   `delete(` and no `patch(` anywhere in the router"* — was already superseded
   for `delete` by M2 and is now superseded for `put`. The record is not
   edited, and the line it quotes,
   `use axum::routing::{any, get, post};`
   (`os/pkgs/mosd/apid/src/routes.rs:32`), survives verbatim and unmoved: the
   route is declared with the `MethodRouter` method `.put(...)`, which needs no
   import at all.
5. `docs/design/api.md` section 2.3's *"There is no
   `POST` and no `PUT` anywhere under `/api`"*
   (`docs/design/api.md:1357-1358`). The `PUT` half is now false. Section 2.3
   is the M1 design's own input and its whole table is a dated measurement this
   campaign supersedes milestone by milestone; correcting one clause of it here
   would leave the twenty rows around it saying the opposite.

## 6. Coverage

Ten new tests, plus two assertions folded into the existing end-to-end run.

| Test | What it pins |
|---|---|
| `the_write_route_writes_the_four_scalar_settings` | all four paths: 204, `no-store`, empty body, read-back through `GET`, one bus write each at the dot-path the URL named |
| `a_write_carrying_the_redaction_sentinel_is_refused_and_writes_nothing` | the round trip that would have destroyed the credential: 422, `validation_failed`, no bus write, the admin password still logs in; and the bare-string case on an allowlisted path |
| `every_dot_path_outside_the_allowlist_is_refused_with_409` | fifteen paths including `.`: 409, `settings_read_only`, `source: apid`, the envelope's `path`, and no bus call at all |
| `the_two_named_refusals_say_why_rather_than_only_that` | `schema_version`'s read-only sentence and `network`'s naming of `PUT /api/v1/network/{iface}` |
| `an_absent_root_is_404_and_a_malformed_path_is_422` | section 2.4's split on the write route: four absent roots at 404 through the shared helper, four malformed paths at 422, nothing written |
| `the_settings_schema_has_the_eight_roots_the_write_route_knows` | the derivation from `Settings::default()`, so a schema change moves the route and this expectation together |
| `a_body_of_the_wrong_shape_is_refused_and_not_written` | nine wrong-shape bodies, `HOSTNAME_RULES` shared with the pane, plus 400 `request_invalid` for a non-JSON body and for a missing `Content-Type` |
| `the_write_route_takes_a_bearer_and_a_cookie_and_refuses_neither_silently` | a bearer writes; no credential is 401 with no `Location`, in both gate modes |
| `a_write_mosd_refuses_carries_mosds_classification` | three fdo names through section 2.4's table on the write path, with mosd's message verbatim |
| `the_openapi_document_covers_the_settings_write` | nine documented outcomes, the request body's `$ref`, and the `GET` unchanged beside it |
| `os/pkgs/mosd/apid/tests/e2e.rs` | against a real `mosd` on a real bus: the `PUT` answers 204 and the value is in mosd's own tree; a refused `network.eth9` write is 409 and created no entry |

**The state read the M1 acceptance names is asserted through `GetSettings`, not
`GetState`, and that is a deviation with a reason.** `state.hostname` is
published by the reconciler whose own first line is
*"Hostname reconciler: writes `/etc/hostname` and sets the running hostname."*
(`os/pkgs/mosd/mosd/src/reconciler/hostname.rs:1`), and neither that file nor
hostnamed is available to the end-to-end harness. The form path's own
end-to-end assertion reads back the same way for the same reason:
`assert_eq!(proxy.get_settings("hostname").await?, "\"e2e-host2\"");`
(`os/pkgs/mosd/apid/tests/e2e.rs:263`). What the acceptance is really asking —
that the write reached mosd and not just apid — is what the `GetSettings`
read-back proves.

## 7. Citations

`routes.rs` moved, so what this change invalidated was re-anchored: numbers
only, in its own commit, with the full form and the bare continuation form
counted separately.

**Full form** — 381 present into the files this change touches: **256
corrected**, **114 already correct**, **11 refused** to the mechanical map and
hand-resolved. Nothing was left alone.

The eleven refusals are the two cases rule 2 exists for: a cited range crossing
the insertion boundary (`routes.rs:357-385`, four occurrences, resolved to
`357-388` because `api_router`'s closing brace is the range's real end), and a
citation naming a line the change itself edited (`routes.rs:362`,
`:359-363`, `:750-752`, and `openapi.json:8-727` three times). Each was
resolved by opening both trees rather than by shifting a number.

One of the eleven could not be re-anchored at all, because the text it quotes
no longer exists: `docs/design/api.md` section 2.2's *"phase 1 serves no write
route to write it with"*, which this milestone is precisely the falsification
of. Its sentence was restated against the source text that replaced it. That is
the only prose edit in the re-anchor commit, and the paragraph's line count was
held constant so no citation *into* `api.md` moved.

**Bare continuation form** — 174 present, of which 171 name `routes.rs`.
**Zero rewritten.** Measured here rather than relayed: the continuations were
expanded to the full form in a copy of the pre-image tree so
`docs/verify-citations.sh` could see them at all — it skips a form that *"is shorthand for a path named earlier
in the prose and has no base to resolve against"*
(`docs/verify-citations.sh:39-41`) — and the checker was then run
against the pre-image. Of the 171, **57 carry an armed quote and all 57 fail**;
the other 114 carry no quote and are unprovable either way. So not one
continuation into `routes.rs` was correct *before* this change, and re-anchoring
them would map a wrong pre-image line onto a fresh number, committing rot that
then looks re-anchored. They are RFCT-214's by census and are left alone.

The pre-image itself was verified green first — `1513/1513 PASS` at the commit
before this change — which is what makes "the old line was right" a measurement
rather than an assumption for every armed full-form citation that moved.

## 8. Deferred, with the reason

- **No `GET /api/v1/state/hostname` assertion after the write.** Section 6.
- **The four paths are not removed from the HTML panes.** Both surfaces write
  the same dot-paths, and the API route runs the same `valid_hostname` the pane
  runs, so the floor is identical. Removing a pane is a UI decision no section
  of the design asks for.
- **`mqtt.listen`, `mqtt.auth`, `access.device` and `provisioning` stay
  refused.** `docs/task/RFCT-210.md` section 2.5 puts them under "not planned,
  deliberately": the first two open a broker to a network and the second two are
  written by first-boot provisioning, not by an operator. They answer 409 like
  every other unlisted path.
- **No audit-trail entry for a settings write.** `Audit` records password
  changes and custom-UI activation and records nothing for the form paths that
  write these same four values. Adding one here would be a new behaviour no
  section specifies, and it would be asymmetric with the panes.
- **No `security` scheme in `openapi.json`.** Unchanged from M2's reasoning: the
  document declares no security requirement on any operation, and adding one for
  a single route would describe the surface less accurately than saying nothing.

## 9. Gates

Run on this branch with `bkd/vu5b6kk0` merged in.

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | `1537/1537 PASS` |
| `bash docs/verify-index.sh` | `772/772 PASS` |
| `bash os/pkgs/mosd/hack/check.sh`, unmodified, in the amd64 builder image | `ALL CHECKS PASSED` — fmt, clippy `-D warnings`, `768 tests run: 768 passed, 0 skipped`, doctests, `advisories ok, bans ok, licenses ok` |
| `oasdiff breaking ... --fail-on ERR --severity-levels ...` | `No breaking changes to report`, `RC=0`, against both the pre-M4 spec on this branch and `main`'s |

**The test arithmetic reconciles: 758 + 10 = 768.** The ten are section 6's
unit tests; the two end-to-end assertions were folded into the existing
`web_flow_end_to_end` rather than added as a test of their own, so they move no
count.

**oasdiff was run here rather than deferred**, unlike RFCT-212, which recorded
that this worktree had no network access to the pinned release. It does now, so
the pinned 1.29.1 binary was fetched, its sha256 checked against the one
`.github/workflows/check.yml` pins, and the same two severity promotions the
workflow writes were passed in. Both bases were diffed: the spec as it stood on
this branch before the change (M4's own diff) and `main`'s (what CI would see
for a pull request), because only the second is the workflow's actual input and
only the first isolates this milestone.

**One deviation in how the gate was invoked, and it is the wrapper, not the
gate.** `hack/check.sh` ran unmodified. The container image tag named in this
milestone's brief no longer exists in this host's image store — it was retagged
mid-run — so the amd64 builder was entered by the tag that does name it, after
confirming the image reports `amd64` and that `uname -m` inside it is `x86_64`.
`dbus` is installed in the container before the run, without which the bus
round-trip test exits 100. Neither touches the script.
