# RFCT-245 PLAN-023 M9: the cookie cutover on /api/v1/

- **status**: in progress
- **priority**: P1
- **owner**: bkd/2oeudab8
- **createdAt**: 2026-08-28
- **plan**: PLAN-023 (M9)

The last implementation milestone of PLAN-023, and the one that makes
`docs/design/api.md` §3.2 true. Amendment 1 ruled option 1 — dual-credential
with an in-plan cutover — and scheduled the cutover for a named milestone so
that §3.2's bearer-only sentence would be false only for a bounded window. This
is that milestone.

## 1. What the cutover is

`ApiSession` accepted a bearer **or** the browser session cookie. `ApiBearer`
accepted a bearer. After the cutover the two prove the same thing, so there is
one extractor and it keeps the accurate name: the 21 handlers that named
`ApiSession` name `ApiBearer`, and the type and its impl are gone.

The type's own doc comment scheduled this. It said the name was kept through
the change of meaning *deliberately*, because `docs/design/api.md` §1.2, §2.4
and §3.1 quote it and "the cutover milestone rewrites as one piece". Renaming
at M2 would have left the document quoting a symbol that was gone; renaming
here is the piece that comment deferred.

Three things did not change, each for a reason already on the record:

| Route | Credential after M9 | Why |
|---|---|---|
| `POST /api/v1/setup` | none | M8 made it the device's one unauthenticated write. It names no extractor, and that is what makes it unauthenticated — not an exception in the gate. |
| `POST /builtin/tokens` | session cookie | The bootstrap. Not an `/api/v1/` route. §3.2 designs it this way on purpose: without it no first token can exist. |
| `POST /builtin/tokens/revoke` | session cookie | The same, for §8.1's capability (iii). |
| the HTML panes | session cookie | The browser surface is untouched. |

Neither `/builtin/` handler names a credential extractor — the gate guards them
— so neither needed an edit for the cookie to survive there.

A cookie presented to an `/api/v1/` route is **401 with §2.4's envelope**, not
a 303 to `/login`. That is §3.1's trap: the redirect lands on `GET /login`,
which answers 200 with HTML, so a script reads the whole exchange as success.
The refusal is asserted with its envelope in the unit tests and against a live
apid, a live mosd and a real bus in `apid`'s end-to-end test.

The 22 OpenAPI 401 descriptions that promised "neither a bearer API token this
device holds nor a session cookie that verifies" said something no longer true.
They carry the token routes' wording now, so all 25 read alike.

## 2. The tests, and which assertions were amended

69 call sites presented a cookie to an `/api/v1/` route. They present a bearer
now; the routes, bodies and assertions are otherwise unchanged.

The credential is **seeded, not minted**, and that is a decision. `POST
/builtin/tokens` is itself a write to `access.apiTokens`, and twenty of these
tests assert `set_paths()` exactly — several assert it is EMPTY, which is the
entire content of a refusal test. A minted credential would put a second path
in every one of them. So `with_token(tree)` seeds one usable token into the
starting tree and 29 fixtures take it. Four tests keep the pane mint because
they assert nothing about writes. `failing_app` seeds too, and could not have
done otherwise: its premise is that a settings write FAILS.

Four assertions changed, and every one is a **tightening**. Named here so that
an amended assertion cannot be mistaken for a weakened one:

| Was | Is | What moved |
|---|---|---|
| `every_shipped_api_route_takes_a_bearer_or_the_cookie` | `every_api_v1_route_takes_a_bearer_and_refuses_the_cookie` | Bearer arm untouched — still 200 on all four paths. Cookie arm 200 → 401, and now asserts `code`, `source` and the absence of `Location`. A bare no-credential request is asserted beside it, which makes the cookie arm a statement about refusal rather than absence. |
| `the_write_route_takes_a_bearer_and_a_cookie_and_refuses_neither_silently` | `the_write_route_takes_a_bearer_refuses_the_cookie_and_refuses_neither_silently` | The old name promised a cookie arm the body never had. It has one now: 401 with the envelope, and the refusal wrote nothing. |
| `the_two_collections_take_a_cookie_or_a_bearer_and_401_without_either` | `the_two_collections_take_a_bearer_and_401_without_one` | Cookie arm 200 → 401 with the envelope. No path or method lost. |
| `the_network_cluster_takes_a_cookie_or_a_bearer_and_401_without_either` | `the_network_cluster_takes_a_bearer_and_401_without_one` | The same. |

No assertion was deleted and no route lost coverage.

`apid`'s end-to-end test gained the one thing nothing in the tree exercised:
the bootstrap itself. It logs in, mints at `POST /builtin/tokens` with the
cookie, parses the plaintext out of the pane's single `<pre>`, and presents
that bearer on the `/api/v1/` calls that follow. It also asserts that the
authenticated browser is refused there — 401, envelope, no `Location` — beside
the anonymous request that was already asserted, because the anonymous case
never distinguished "cookie refused" from "no credential sent".

## 3. Citations

Re-anchored in their own commit, numbers only, from the pre-image at the merge
that closed RFCT-246 — gate-green there at 1714/1714 before any code in this
task ran, which is what makes it usable as a base.

310 citations across 24 documents: **170 single** `path:N` and **140 range**
`path:N-M`. By cited path: routes.rs 297, tests.rs 19, assets/serve.rs 2,
access.md 2, openapi.json 1, model.rs 1, bus.rs 1.

The map is difflib's equal-block opcodes over pre-image and tree, so a citation
moves only when its line survives in an unchanged block and the destination
text is byte-identical to the source. Both endpoints of a range are mapped
independently and both must satisfy it. Nothing was mapped by adding a
constant, and there is no constant to add: M8 measured eight distinct bands and
this delta spans more, because the cutover deleted a type in the middle of the
file and rewrote 22 attribute strings above and below it.

**Antecedent rule for the bare continuation form: nearest preceding full-form
citation anywhere in the document.** Stated because M8 reported 209/146 under
it and could not reproduce M7's 184 under any scoping, so it is not optional
context. This task moves none of them — they are RFCT-214's census, they carry
no path to re-resolve, and their count and text are unchanged (api.md 26,
RFCT-210.md 5).

Four citations could not be mapped and were re-derived by content instead, in a
separate commit, because a line map cannot recover a symbol that no longer
exists. All four named code this task deleted: `pub(crate) struct ApiSession;`
twice, its rejection message, and its cookie branch.

- `docs/design/api.md` §1.4 and §2.4 now describe `ApiBearer`. §1.4 is
  RFCT-215's section and was edited only in the clause this task falsified.
- `docs/task/RFCT-240.md` §4 records an M4-era decision and is left exactly as
  written; only its dangling citation is re-pointed, with a parenthesis saying
  the type was later collapsed.

## 4. The merge RFCT-246 could not make

RFCT-246's task became unstartable in BKD, so M9 carried its branch in. Five
files conflicted, all citation/index, none in code.

The four citation-bearing documents were resolved against **RFCT-246's** side
rather than the L2 side, which is the opposite of the instruction, and the
measurement is why. `redirect_app()` is at `routes.rs:3232` in the merged tree.
The L2 side cited `3204-3208`, which lands on a `tracing::warn!` inside a
bearer check; RFCT-246 cited `3168-3172`, exact at its own base. At the shared
base api.md read `3140`; RFCT-246 re-derived it to the correct `3168`, while L2
applied a correct +64 map to the uncorrected `3140` and got `3204`. So the L2
numbers are a right map over a wrong input and RFCT-246's are the
content-re-derived ones. Taking RFCT-246's side and mapping once through the
base→tree delta reproduces the L2 number wherever L2 was right — the fdo error
constants, `377/378/379` → `394/395/396` — and corrects it where it was not.
47 citations, every endpoint byte-identical at both ends, 0 unmapped.
