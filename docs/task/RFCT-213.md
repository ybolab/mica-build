# RFCT-213 PLAN-023 M2 part 2: apid bearer auth, the token routes, the builtin mint

- **status**: in progress
- **priority**: P1
- **owner**: bkd/5omj5rrm
- **createdAt**: 2026-08-28
- **plan**: PLAN-023 (M2 part 2)

Everything above the storage tier RFCT-211 landed: bearer verification against
`access.apiTokens`, the three `/api/v1/tokens` routes, the `/builtin` mint and
revoke form posts, the mint pane, and the password pane's ratified sentence.
RFCT-211 deliberately reads no token; this reads one.

## 1. The auth split, and why it is not a contradiction of Amendment 1

PLAN-023 Amendment 1 settled option 1, **dual-credential**: `/api/v1/` accepts a
bearer token OR the existing session cookie. That ruling is additive and it
breaks no shipped client, which is the whole of its argument. `docs/design/api.md`
section 3.2's *"It is the **only** accepted credential on `/api/v1/` routes"*
(`docs/design/api.md:1892-1893`) is therefore false for a bounded, in-plan
window, by decision. It is not corrected here, and the dated note that records
the cutover is not written here: a later named milestone removes the cookie and
writes it, and a note claiming the cutover before the cutover would be worse
than the sentence it replaced.

The boundary L2 drew inside that ruling, implemented as stated:

| Routes | Credential |
| --- | --- |
| the four guarded `GET`s, `POST /api/v1/actions/change-password`, `POST /api/v1/actions/wireguard/{iface}/rotate-key` | bearer **or** cookie |
| `GET`/`POST /api/v1/tokens`, `DELETE /api/v1/tokens/{id}` | **bearer only**; a cookie is a 401 |

**The reasoning, so it is reviewable rather than assumed.** The amendment's
purpose is to preserve the credentials of routes that **already shipped** — a
client that authenticates with a cookie today keeps working. That purpose says
nothing about a route that does not exist yet, because no client can be relying
on it. Section 3.2 rejects the cookie-accepting mint explicitly and by name:
*"It is rejected because it puts a permanent-credential factory inside the one
surface §3.3 can make its strongest statement about, and that statement is worth
more than the saved route."* (`docs/design/api.md:2035-2038`) Both can hold at
once, and they do: the amendment is served in full on every route it was written
about, and section 3.2's rejection is honoured on the three it was written
about. `GET /api/v1/tokens` follows the mint rather than the reads, because a
listing of a device's credential inventory belongs behind the credential and not
behind a browser tab that was left open.

The bootstrap is a path and not an exception. An operator holding only a browser
mints at `POST /builtin/tokens` and revokes at `POST /builtin/tokens/revoke`,
neither of which is an `/api/v1/` route.

`ApiSession` keeps its name through that change of meaning. It is quoted by name
in `docs/design/api.md` sections 1.2, 2.4 and 3.1, which the cutover milestone
rewrites as one piece; renaming it here would leave the design document quoting a
symbol that no longer exists while still describing cookie-only authentication.
The stricter sibling is a new type, `ApiBearer`, which no document names yet.

## 2. The id width, decided

Section 3.2 disagrees with itself: its prose says *"an 8-byte hex `id`"*
(`docs/design/api.md:1910`) while the worked example beside it —
`Authorization: Bearer mos_3f2a9c41_9d4e...c7` (`docs/design/api.md:1902`) —
shows eight hex CHARACTERS, which is four bytes. RFCT-211 left it open on
purpose: the model bounds an id to lowercase hex of 1..64 characters rather than
fixing a width, so both readings validate.

**This picks the example: four bytes, eight lowercase hex characters.** The
width is not carrying uniqueness, which is the property that would otherwise
argue for the wider reading — `token::mint` draws against the stored list and
redraws on a collision, so no id is ever issued twice whatever the width, and the
redraw has its own test rather than being an untested branch. The id is a lookup
key and not a secret, so guessing one buys nothing. What is left is the cost an
operator pays: the id is the part of the token a human copies into a `DELETE`
path, and the document's own example is the spelling a client implementer will
copy first.

## 3. What the route tier owes that the storage tier could not

- **`MAX_TOKENS = 32` needs an answer at the route.** RFCT-211 made a full list
  a hard refusal in `validate_api_tokens`, and without a check here the caller
  meets that refusal as a failed `set` — a 500 about mosd — rather than as an
  answer about the request they made. The mint answers **409
  `token_limit_reached`**, naming the cap. 409 and not 422: the body is well
  formed and nothing about it is wrong, and what refuses it is the collection's
  current state, which is the condition section 2.4 already spends 409 on
  (`settings_read_only`). The HTML pane refuses it too, at its own 422, and says
  so where the operator is looking.
- **404 for an absent id, 422 for a malformed one**, through the one shared
  helper `item_not_found` the M1 design requires -- *"a single shared function
  taking the resource path and the identifier, used by every item route"*
  (`docs/task/RFCT-210.md:412-414`) -- so the next collection route inherits the
  rule by reaching for the function rather than by remembering a decision. The
  grammar behind the 422 is `mosd_settings::is_api_token_id`, published by this
  task so the route does not carry a second copy of a rule the store enforces.
  The HTML pane answers 422 for the same condition, deliberately and on the
  record; the two tests name each other.
- **Mint and revoke are read-modify-write of the whole array**, because the
  dot-path syntax has no array indexing. **Two concurrent mints lose one token,
  silently.** It is recorded in the source and here, and not fixed: section 3.2
  names it as a cost inherited from the tree, and the alternative is a locking
  scheme this codebase does not have.
- **Bearer verification is not rate limited and must not be.** 256 bits of
  `OsRng` is not guessable online, and `auth::GuardStore`'s counter is global, so
  a shared counter on the token path would let anyone holding a bad token lock
  out every script *and* every login. The test asserts both halves: a valid token
  still answers after fifty failed presentations, and a password login still
  succeeds immediately afterwards.
- **The compare is constant-time.** The digests are MACed under a key drawn fresh
  per call and compared with `Mac::verify_slice`, the primitive the crate already
  contains; a `String` `==` on hex digests is what section 3.2 says must not be
  written. The size of the requirement is not overstated in the source comment: a
  timing leak on a *stored digest* yields no preimage, and it is constant-time
  anyway because deciding this site by site is how the one site where it matters
  gets missed.

## 4. The password pane's ratified sentence

`docs/task/RFCT-210.md` section 3 ratified keeping section 3.2's semantics — a
password change revokes no token — and assigned this milestone the sentence that
is the whole obligation section 3.2 states and never gives to anyone. It ships
verbatim on the pane and a test asserts it byte for byte, because a paraphrase
would quietly drop the containment advice, which is the part of it that matters.

## 5. Claims this change makes false, for the milestone that owns them

Recorded rather than fixed, because each belongs to a document section this task
is not the assignee for. Numbers were re-anchored; prose was not touched.

1. `docs/design/api.md` section 3.2's *"only accepted credential"* sentence, and
   its *"a session cookie presented to this route is a `401`"* — the second is
   now true of the token routes and false of every other `/api/v1/` route. The
   cutover milestone owns both.
2. Section 1.4's *"There is no `POST /api/v1/tokens` and no
   `DELETE /api/v1/tokens/{id}`"* and its statement that the `access`
   `GetSettings` is *"now paid only by an **unauthenticated** request"* — a
   bearer request pays it too. Section 1 is RFCT-215's.
3. Section 2.4's row describing the 401 as raised by *"the session-cookie
   extractor"*. The extractor's message still begins with the string that row
   quotes, so the citation stands; the row's reading of it does not.
4. `docs/task/RFCT-210.md`'s central negative — *"There is no `put(`, no
   `delete(` and no `patch(` anywhere in the router"* — is a dated measurement
   this milestone supersedes. The record is not edited. `delete` is imported on
   its own line in `os/pkgs/mosd/apid/src/routes.rs` so the line that record
   quotes survives verbatim, and the source says why.

## 6. Deferred, with the reason

- **No audit trail entry for a mint or a revoke.** `Audit` records password
  changes and custom-UI activation and records nothing for the SSH key list,
  which is the nearest precedent for a credential collection edited through a
  pane. Adding one here would be a new behaviour no section specifies, and
  picking the event vocabulary is a decision for whoever specifies it.
- **No `security` scheme in `openapi.json`.** The document declares no security
  requirement on any operation today, and adding one for three routes while six
  others stay silent would describe the surface less accurately than saying
  nothing. The 401 descriptions carry the credential rule in prose instead.
