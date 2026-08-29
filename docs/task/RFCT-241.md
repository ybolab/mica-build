# RFCT-241 PLAN-023 M5: the SSH authorized-keys and WiFi-networks collections

- **status**: completed — both collections serve GET/POST/DELETE, the 404-vs-422 contract is inherited from the shared helper with the paired cross-surface tests, the redaction sentinel is refused before the shape check, and every gate is green: 784/784, 1539/1539 citations, 776/776 index, oasdiff RC=0 against both bases
- **completedAt**: 2026-08-28
- **priority**: P1
- **owner**: bkd/jw8lxe0t
- **createdAt**: 2026-08-28
- **plan**: PLAN-023 (M5)

The two array collections that already exist in the settings tree, given API
routes. `docs/task/RFCT-210.md` section 2.5 is the design of record and its M5
acceptance is what this discharges; section 2.4's collection error contract is
inherited here rather than restated, which is the point of it having been stated
once.

Nothing else moves. The network cluster and the WireGuard peers are M6, the
actions M7, `POST /api/v1/setup` M8, the cookie cutover M9.

## 1. What ships

Six operations, on two collections:

| Route | Answers |
|---|---|
| `GET /api/v1/ssh/authorized-keys` | 200 the stored keys, each with its fingerprint, plus `notice` |
| `POST /api/v1/ssh/authorized-keys` | 201 the parsed entry and `notice`; 422 a line the parser refuses |
| `DELETE /api/v1/ssh/authorized-keys/{fingerprint}` | 204; **404** unmatched; 422 not a fingerprint |
| `GET /api/v1/wifi/client/networks` | 200 the stored networks, every `psk` redacted |
| `POST /api/v1/wifi/client/networks` | 201 the entry, redacted; 422 sentinel or bad shape; 409 SSID taken |
| `DELETE /api/v1/wifi/client/networks/{ssid}` | 204; **404** unmatched |

Both take `ApiSession` — bearer **or** cookie. PLAN-023 Amendment 1's bearer-only
ruling is about the token routes specifically, the credential factory, and not
about new routes in general, so these are dual-credential exactly as the shipped
reads are.

`WRITABLE_SETTINGS` was not widened to reach either tree, deliberately. These are
collections precisely because their identity is not a path position, and the
dot-path syntax cannot index an array.

## 2. The collection error contract, inherited

Section 2.4's rule — *"an identifier that matches no item is 404"*, with
**422 reserved for a malformed identifier** — is discharged through
`item_not_found`, the shared helper M2 landed and M4 reused. Neither new item
route writes a not-found envelope of its own. That is the whole mechanism the
design asked for: a later collection route gets the rule by reaching for the
function, not by remembering a decision.

**The 422 half is real on the SSH item route and vacant on the WiFi one, and
both are the rule applied rather than one being an exception.** A fingerprint has
a grammar — `SHA256:` and 43 base64 characters, which is what `ssh-keygen -lf`
prints and what `ssh_fingerprint` computes — so a string outside it could never
name a key and is 422. An SSID has no grammar at all: it is an operator-chosen
name and every non-empty single path segment spells a possible one. There is
therefore no malformed identifier for that route to answer 422 about, and
everything absent is 404. Inventing a length bound to manufacture a 422 would
have been a second opinion about a model that has none, and it would have
answered 422 for a network a hand-edited settings file really holds.

### The paired tests, and the one asymmetry that has no pair

The SSH pane answers **422** where the API answers **404**, on the same
condition, and that split stays: the pane's identifier is a submitted string
that may be a fingerprint *or* the exact canonical key text, so a value matching
nothing is as likely mistyped as absent — the re-submit condition 422 means on a
form — and its body is a re-rendered page no consumer reads a status from. Two
tests name each other:

- `an_absent_key_fingerprint_is_404_where_the_pane_is_422`
- `the_ssh_pane_answers_422_where_the_api_answers_404`

**The WiFi collection has no pane at all, so it has no paired test, and the
absence is stated rather than left to be noticed.** The list exists in the
settings model and was reachable until now only by editing the settings file on
STATE; this API is its first management surface. There is no form-path behaviour
for it to agree or disagree with. `an_absent_ssid_is_404_and_this_collection_has_no_pane_to_disagree_with`
says so in its name and asserts it out of the router's own source, so the day a
pane is added the test fails and the paired-test obligation is owed again.

## 3. The redaction sentinel, on the collection that has a redacted field

M4 landed the rule that a body carrying `<redacted>` is refused at 422 rather
than written, and checked it **before** the allowlist so a later milestone would
inherit it. This is the milestone that case was checked for: `psk` is one of the
five field names section 2.2's structural redactor covers, so the WiFi listing
substitutes the sentinel, and a client that read an entry, changed a field and
posted the whole thing back hands `<redacted>` straight back.

The check therefore runs before the body is read as a network at all.
`posting_a_redacted_psk_back_is_refused_and_the_stored_key_survives` drives the
whole round trip — read the collection, edit `ssid` and `hidden`, post it back —
and asserts the real key is still stored afterwards.

The SSH collection has no redacted field and no sentinel check; a key line
spelled `<redacted>` is refused by `parse_authorized_key` with a message about
what is actually wrong with it.

## 4. Validators: what each `POST` runs, measured

**SSH runs the shared one.** `parse_authorized_key` on the way in and
`validate_authorized_keys` on the whole rewritten list — the same two calls the
pane makes, and `validate_authorized_keys` is what mosd's sshd reconciler runs
before it renders the file. So a list either surface accepts is a list the
reconciler accepts. The duplicate and the 32-key cap are refused by that
validator, at 422 with its own message, which is what the pane already answers
for the same list.

That is deliberately **not** the 409 the token mint gives for its own full-list
case. The mint could answer 409 because `mosd_settings::MAX_TOKENS` is public and
checkable before the validator runs; here the equivalent would mean either
exporting a private constant or string-matching a validator message, and 422 with
the shared validator's words is the smaller and more honest answer.

**WiFi runs the model's own deserializer, because that is the whole of what mosd
validates on a write to this subtree.** Measured, not assumed: mosd's one
settings-write path is `MosdService::write_setting`, which calls
`Settings::set`, which validates by deserializing the whole candidate tree --
`serde_json::from_value(root)`
(`os/pkgs/mosd/mosd-settings/src/model.rs:771-775`). There is no
`validate_wifi_networks` anywhere in `mosd-settings`. So the typed `WifiNetwork`
this route deserializes into — `deny_unknown_fields`, `ssid` required, the rest
defaulted — is the validator mosd runs.

### What that leaves undone, named

The pre-shared key's own bounds are **not** checked by either surface at write
time. They live inside the station reconciler's renderer, in
`fn encode_psk`
(`os/pkgs/mosd/mosd/src/reconciler/wifi_client.rs:221-256`), which is a private
function of the `mosd` binary crate; apid depends on `mosd-settings` and not on
`mosd`, so it cannot reach them. A `psk` outside IEEE 802.11i's 8..63 characters
(or a 64-digit hex PMK) is therefore accepted by this route, stored, and refused
later by the renderer — the reconcile fails and records the error in live state
rather than writing a configuration file wpa_supplicant would reject wholesale.

**Deferred rather than fixed, and the reason is scope.** Closing it means lifting
those bounds out of a rendering function in `mosd` into `mosd-settings` and
having the reconciler call the lifted copy — a refactor of a crate this milestone
otherwise does not touch, with golden-file tests attached to it. Writing a second
copy of the rule in apid was refused outright: this file already argues, at the
rotate-key route, that *"A second copy of that rule here could disagree with the
first."*

## 5. Read-modify-write, recorded and not fixed

Both collections are a read-modify-write of a whole array, because the dot-path
syntax has no array indexing — the same shape `write_tokens` and the SSH pane
already have, and the reason `redact`'s field list is names rather than
dot-paths. **Two concurrent writes lose one entry, silently**: both read the
list, both edit their own copy, and the second write wins. No locking was
invented; this codebase has no scheme for it, and section 3.2 already records the
same cost on the token list.

## 6. Two measurements worth keeping

**A fingerprint carrying a `/` is addressable, percent-encoded.** The base64
alphabet a fingerprint uses is the standard one, not the URL-safe variant, so a
real RSA key's fingerprint contains `/` — `SHA256:zv0xTYuVTo5pFpcl/svzzz/vJFvoguWxKlghlXQS1bE`
is one of the committed test fixtures. Sent as `%2F` it is three characters at
match time, so the router still matches one segment and axum decodes it back
before the handler sees it; the gate's predicate reads the same raw path, sees no
separator, and hands the request off. Sent unencoded it is three segments and
reaches the reserved subtree's own `not_found`, which is a different answer from
this collection's 404. Both halves are asserted by
`a_fingerprint_carrying_a_slash_is_addressable_percent_encoded`.

**`/api/v1/ssh/authorized-keys` left the `UNDECLARED` list.** It was one of the
six paths `every_other_api_path_keeps_both_of_its_answers` held to the reserved
subtree's not-found envelope. It is now a served collection, so the entry was
removed and the array is five. That is the one existing test this milestone
changes, and it changed because the route it asserted the absence of now exists.

## 7. Tests

Sixteen, all asserted by name against the run log rather than inferred from a
matching total.

| Test | What it holds |
|---|---|
| `the_ssh_key_collection_lists_adds_and_removes` | the collection end to end, the fingerprint checked against `ssh-keygen`'s own output |
| `the_root_key_notice_is_on_the_listing_and_on_the_add` | section 2.5's `notice` requirement, on both answers |
| `the_key_add_runs_the_same_parser_the_pane_runs` | four rejected lines refused by both surfaces, nothing written |
| `a_duplicate_key_is_refused_by_the_shared_validator` | a key relabelled and re-posted is one key |
| `an_absent_key_fingerprint_is_404_where_the_pane_is_422` | the API half of the split |
| `the_ssh_pane_answers_422_where_the_api_answers_404` | the HTML half, on the same condition |
| `a_fingerprint_carrying_a_slash_is_addressable_percent_encoded` | `%2F` round-trips; unencoded reaches the reservation |
| `the_wifi_network_collection_lists_adds_and_removes` | the collection end to end, open networks included |
| `a_posted_psk_is_redacted_on_the_next_read` | and through the settings root too, so it is one rule |
| `posting_a_redacted_psk_back_is_refused_and_the_stored_key_survives` | the destructive round trip |
| `a_second_network_under_one_ssid_is_refused` | 409 `ssid_exists`, nothing written |
| `a_body_that_is_not_a_network_is_422` | five bad shapes at 422, unreadable JSON at 400 |
| `an_absent_ssid_is_404_and_this_collection_has_no_pane_to_disagree_with` | the 404, and the absence of a pane, read out of the router's source |
| `the_two_collections_take_a_cookie_or_a_bearer_and_401_without_either` | Amendment 1's reading, and 401 rather than a redirect |
| `the_openapi_document_covers_the_two_collections` | every operation and every documented status |
| `the_wifi_schema_matches_the_settings_model` | the documented entry against `mosd_settings::WifiNetwork`'s own field set |

**The arithmetic: 768 + 16 = 784.** Sixteen added, none removed —
`git diff` over `apid/src/tests.rs` counts 14 added `#[tokio::test]` and 2 added
`#[test]`, and zero removed. Note that a naive `#[tokio::test]` census
under-counts this tree by the 18 tests written
`#[tokio::test(flavor = "multi_thread")]`; both spellings were counted.

Two existing tests changed, both because a path they asserted was *absent* is
now served: `every_other_api_path_keeps_both_of_its_answers` lost
`/api/v1/ssh/authorized-keys` from its `UNDECLARED` array, and
`the_api_reservation_answers_every_shape_with_the_envelope` traded
`/api/v1/wifi/client/networks` for that route's prefix and its trailing-slash
spelling — neither of which this router serves, so both still hold the
reservation.

## 8. Citations

`routes.rs`, `tests.rs`, `openapi.rs` and `openapi.json` all moved, so the
citations into them were re-anchored mechanically, in a commit of its own that
changes numbers and nothing else.

**Both forms, with counts per form.**

- **Full form** (`` `path:line` ``), the form the gate checks: **371** in scope.
  **280** rewritten, **82** already correct because they sat above every
  insertion, and **9** refused by the mechanical rule and resolved by hand.
- **Bare continuation form** (`` `:NNN` ``): **1142** in the scanned documents,
  of which **171** have `os/pkgs/mosd/apid/src/routes.rs` as their antecedent.
  **All 171 were left alone.** They are RFCT-214's by census, the gate does not
  check them at all, and none of them was correct before this change either —
  re-pointing them here would be inventing an anchor rather than moving one.

**No constant offset was assumed.** The map is built per hunk from
`git diff -U0`; the insertions land in five separate places in `routes.rs`
alone, so a single offset would be wrong for every band but the last.

**The alignment trap was refused, not worked around.** Nine citations named
ranges that straddle an insertion — `api_router()` (four), `is_declared_api_route`
and its helpers (two), and the whole `paths` object of `openapi.json` (three).
The mechanical rule declines those, and each was resolved by hand and then
checked: the new range begins and ends on the byte-identical line the old one
did, and contains every line the old range did with nothing removed.

**The pre-image was verified right before anything was rewritten.**
`bash docs/verify-citations.sh` was run at the merge commit, before any code
edit, and reported `1537/1537 PASS`; only then was each citation classified
against that pre-image. Every rewritten citation additionally had its pre-image
text compared byte for byte against the text at its mapped lines, and a mismatch
would have been refused rather than rewritten. None was.

## 9. Gates

All four, at `HEAD` of `bkd/jw8lxe0t`.

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | `1539/1539 PASS` |
| `bash docs/verify-index.sh` | `776/776 PASS` |
| `bash os/pkgs/mosd/hack/check.sh`, unmodified, in the amd64 builder | `Summary [61.863s] 784 tests run: 784 passed, 0 skipped`; `advisories ok, bans ok, licenses ok`; `ALL CHECKS PASSED` |
| `oasdiff breaking … --fail-on ERR --severity-levels …` | `No breaking changes to report`, `RC=0`, against **both** the pre-M5 spec on this branch and `main`'s |

The gate script ran unmodified. Two things sit around it and neither touches it:
`dbus` is installed in the container first, without which the bus round-trip
test exits 100, and the builder image was confirmed to report `amd64` before any
result from it was believed. oasdiff is the 1.29.1 release the workflow pins,
sha256-checked against the pinned digest, run with the same two severity
promotions the workflow writes.

Two citations in this document are quoted rather than bare, because the
unquoted-citation ratchet gives a new document a ceiling of zero; quoting them
was the better of the two ways out, since it puts them under the content check
as well as the resolution one.
