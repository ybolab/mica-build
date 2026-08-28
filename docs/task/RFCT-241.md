# RFCT-241 PLAN-023 M5: the SSH authorized-keys and WiFi-networks collections

- **status**: in progress
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
`Settings::set`, which validates by deserializing the candidate tree
(`os/pkgs/mosd/mosd-settings/src/model.rs:678-682`). There is no
`validate_wifi_networks` anywhere in `mosd-settings`. So the typed `WifiNetwork`
this route deserializes into — `deny_unknown_fields`, `ssid` required, the rest
defaulted — is the validator mosd runs.

### What that leaves undone, named

The pre-shared key's own bounds are **not** checked by either surface at write
time. They live in `encode_psk` inside the station reconciler
(`os/pkgs/mosd/mosd/src/reconciler/wifi_client.rs:226-263`), which is a private
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
