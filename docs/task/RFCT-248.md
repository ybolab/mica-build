# RFCT-248 PLAN-026 M2: the gate asymmetry on undeclared /api/ paths

- **status**: completed — an undeclared path under `/api` answers section 2.4's 404 envelope for **every** credential and for none, where it previously answered a 303 to `/login` (or to `/setup`) for every client that was not a browser; two pinning tests asserted the old answer and both are flipped, one of them found by the gate rather than by the brief; the cookie arm's answer is measured byte-identical before and after; 838/838 (836 baseline + 2 added), 2213/2213 citations with near-miss 354, 875/875 index, oasdiff RC=0
- **priority**: P1
- **owner**: bkd/qzb6dsh2
- **createdAt**: 2026-08-29
- **completedAt**: 2026-08-29
- **plan**: PLAN-026 (M2)

Every fact below was measured on this branch, at the commit each measurement
names. Nothing is relayed from the brief; where the brief and the measurement
differ, the measurement is what is recorded.

## 1. The defect, re-verified

The gate handed off exactly two things and then read a cookie:

    if path == "/healthz" || is_declared_api_route(path) {
        return next.run(request).await;
    }
    ...
    if session::cookie_from_headers(request.headers())
        .is_some_and(|value| state.sessions.verify(&value))

A path under `/api` that no route declares matched neither, so it fell through
to the HTML branches and ended at `Redirect::to("/login").into_response()`
(`os/pkgs/mosd/apid/src/routes.rs:3398`) in normal mode, or at
`return Redirect::to("/setup").into_response();`
(`os/pkgs/mosd/apid/src/routes.rs:3391`) in setup mode. The gate's entire
credential test is the session cookie, and a bearer does not satisfy it, so
**the answer depended on which credential the client carried** — a browser saw
the API's envelope, and everything else saw an HTML redirect it cannot read.

The brief's line references were taken at `a06e9dd` and this branch stands on a
later merge, so they were re-verified rather than trusted: at the pre-image the
gate spanned lines 3271-3318 of `os/pkgs/mosd/apid/src/routes.rs`, the hand-off
was at line 3273 and the cookie test at lines 3294-3298. All three reproduced
exactly. Those three are written out rather than as citation tokens on purpose:
they are dated statements about a commit this branch no longer stands on, and a
mechanical re-anchor pass would move them to lines that say the same thing
today, which is exactly the claim they are not making. The defect is real, and
this record is a fix and not a refutation.

## 2. What decides the medium, and what does not

The rule this milestone implements is one sentence: **a request addressed to
the JSON surface is answered in JSON, and which credential it happened to carry
is not part of that decision.** Section 4.2 already stated the consequence —
*"a request that a developer expected to be JSON never returns HTML with a
200"* — and the gate contradicted it, because a 303 to `/login` is followed to
a 200 HTML page. That contradiction is recorded as
*"The gate contradicted this rule until PLAN-026 M2"*
(`docs/design/api.md:2804-2813`), and the fix as
*"The rest of the reserved `/api` subtree passes too"*
(`docs/design/api.md:594-609`).

## 3. The fix, and why it is a release rather than a synthesised 404

The gate gained one branch, placed immediately after the existing hand-off and
above everything else:

    if path
        .strip_prefix(API)
        .is_some_and(|leaf| leaf.is_empty() || leaf.starts_with('/'))
    {
        return next.run(request).await;
    }

The test is `.is_some_and(|leaf| leaf.is_empty() || leaf.starts_with('/'))`
(`os/pkgs/mosd/apid/src/routes.rs:3350-3355`).

**It releases the path; it does not answer it.** That choice is the whole of
why section 4 below comes out clean. The reserved subtree already has a
not-found handler — `async fn api_not_found(OriginalUri(uri): OriginalUri) -> Response {`
(`os/pkgs/mosd/apid/src/routes.rs:237`), which answers
`ApiError::apid("not_found", format!("no API route at {}", uri.path())),`
(`os/pkgs/mosd/apid/src/routes.rs:240`) — and it is reached by everything the
router claims under the prefix but declares no route for. A gate that
synthesised its own 404 would have introduced a second producer of the same
answer and changed the body a cookie-authenticated caller already receives. A
gate that releases produces no answer at all: the same handler answers, by the
same code path, and the only thing that changed is which branch of the gate let
the request reach it.

**The predicate is spelled from `API`,** the constant the router mounts under,
so it cannot drift from `.nest(API, api_router())`
(`os/pkgs/mosd/apid/src/routes.rs:224`) and `.route("/api/", any(api_not_found))`
(`os/pkgs/mosd/apid/src/routes.rs:225`). It accepts `/api` itself and everything
below `/api/`, and nothing else; `/apibogus` is outside it and remains an HTML
path, which is asserted rather than assumed.

**Bare `/api` is included deliberately, and the brief's wording was "under
`/api/`".** The nest claims `/api` too and answers it from the same not-found
handler — measured, not inferred (section 4's probe covers it). Releasing
`/api/` while leaving `/api` redirecting would have replaced one asymmetry with
a smaller one on a path the same reservation rule owns.

**The declaredness test is now redundant and is left standing anyway.** Every
leaf `is_declared_api_route` accepts begins with `/`, so every path it accepts
this predicate accepts as well, so
`if path == "/healthz" || is_declared_api_route(path) {`
(`os/pkgs/mosd/apid/src/routes.rs:3321`) no longer decides whether anything is
released. It was not folded in because PLAN-026 M4 (RFCT-250) owns that
predicate and is rewriting it, and deleting its only caller would take the
mechanism out from under that milestone. The source says so at the site, and
the design record says *"It is retained rather than folded in"*
(`docs/design/api.md:590-593`).

## 4. The trap: the cookie arm, measured before and after

`an_absent_token_id_is_404_and_a_malformed_one_is_422` already asserted that a
**cookie**-authenticated `DELETE /api/v1/tokens/` answers 404 with code
`not_found`, reaching the reserved subtree's own not-found handler rather than
the gate. This change makes the gate release that path earlier, so the question
is whether that arm still sees the same answer — and it was settled by
measurement, not by argument, before the assertion was touched.

A throwaway probe was added to the suite, run at the pre-image, run again after
the fix, and then removed. It printed the status, content type, `Location` and
raw body for four undeclared spellings under a session cookie. The two runs are
identical, line for line:

    PROBE cookie /api/v1/tokens/ -> 404 Not Found ct=application/json loc= body={"error":{"code":"not_found","message":"no API route at /api/v1/tokens/","source":"apid"}}
    PROBE cookie /api/v1/nope -> 404 Not Found ct=application/json loc= body={"error":{"code":"not_found","message":"no API route at /api/v1/nope","source":"apid"}}
    PROBE cookie /api/ -> 404 Not Found ct=application/json loc= body={"error":{"code":"not_found","message":"no API route at /api/","source":"apid"}}
    PROBE cookie /api -> 404 Not Found ct=application/json loc= body={"error":{"code":"not_found","message":"no API route at /api","source":"apid"}}

Status, error code, `source`, `message` and the envelope shape are unchanged,
and there is no `Location` header on either side. The independent corroboration
is that the cookie assertion in that test **passed unmodified** through the fix
run: the only arm of it that failed was the bearer one, at the line asserting
the 303. No documented answer on the cookie path was altered, so nothing here
had to be stopped and reported instead of fixed.

## 5. RED first, and the tests that ship

The failing tests were written and run before the fix existed. At `d1fa11e`,
with no change to `routes.rs`:

    thread 'tests::an_undeclared_api_path_answers_the_404_envelope_whatever_the_credential'
    panicked at apid/src/tests.rs:6529:13:
    assertion `left == right` failed: /api with no credential
      left: 303
     right: 404

    thread 'tests::an_undeclared_api_path_is_a_404_in_setup_mode_too'
    panicked at apid/src/tests.rs:6567:5:
    assertion `left == right` failed
      left: 303
     right: 404

Two tests are added.
`an_undeclared_api_path_answers_the_404_envelope_whatever_the_credential`
(`os/pkgs/mosd/apid/src/tests.rs:6512`) walks five undeclared spellings against
four credentials — none, a stored bearer, an unstored bearer, a session cookie
— and asserts the four envelopes are equal **to each other** as well as to the
literal, so the symmetry itself is what is pinned; it also holds `/apibogus` to
its redirect and `/healthz` to its 200, because an assertion has to distinguish
the rule from its absence.
`an_undeclared_api_path_is_a_404_in_setup_mode_too`
(`os/pkgs/mosd/apid/src/tests.rs:6577`) closes the gate's other redirect exit,
which is a second exit and not the same one twice.

## 6. Two pinning tests, not one

The brief named one test to flip. The gate found a second.

**Named in the brief.** The final arm of
`an_absent_token_id_is_404_and_a_malformed_one_is_422`
(`os/pkgs/mosd/apid/src/tests.rs:6434`) asserted the 303 to `/login` and said in
its comment that it was *left exactly as it was: a bearer does not satisfy the
gate*. It now asserts the 404 and `not_found`, and the comment states the new
rule and names what changed it. The comment on the arm above it was corrected in
the same edit: it justified `token_id`'s refusal of the empty spelling by saying
that a released path would answer 404 *"where an unauthenticated caller is
supposed to be redirected"*, which stopped being true here. The measurement it
records — that `/api/v1/tokens/` reaches the not-found handler and not the item
route — is kept; the consequence it drew is removed.

**Found by the gate.** `every_other_api_path_keeps_both_of_its_answers` asserted,
for `/api/v1/settings`, `/api/v1/settings/`, `/api/v1/state` and
`/api/v1/state/`, that each keeps *both* answers: the subtree's 404 with a
session and the gate's redirect without one, in either gate mode. That is a
direct statement of the defect, and its **name** states it too, so the test is
renamed `every_other_api_path_has_one_answer_in_every_mode`
(`os/pkgs/mosd/apid/src/tests.rs:1774`) and its three arms are folded into one
byte-for-byte envelope assertion run three times. The session arm's assertion is
unchanged. Its old name is left standing in `docs/task/RFCT-241.md` and
`docs/task/RFCT-243.md`, which record what it was called when they were written;
this section is the bridge between the two names.

The old comment's stated reason for the redirect — that the gate's predicate has
to agree with the router *"or an unauthenticated request for one of them would
be handed to a route that does not exist instead of being redirected"* — is the
same reasoning the `token_id` comment gave, and it stops applying for the same
reason: being handed to a route that does not exist is now the intended outcome,
because the not-found handler is a route and it answers in section 2.4's
envelope.

## 7. Residue handed on, not fixed here

`is_network_route`'s doc comment still argues that refusing a shape in
`is_declared_api_route` *"would answer an unauthenticated caller with a redirect
where the route answers an envelope"* (`os/pkgs/mosd/apid/src/routes.rs:577-581`).
No refusal in that predicate can produce a redirect any more, so the reason is
spent. It is **not** corrected here: the brief forbids touching
`is_declared_api_route` and its helpers, PLAN-026 M4 (RFCT-250) owns them, and
several documents quote those lines. Recorded for M4.

Citations under `docs/plan/` were **not** re-anchored. That tree is outside
`docs/verify-citations.sh`'s scanned scope and outside this task's file scope,
and its files are being edited by sibling milestones of the same campaign.

## 8. Citation re-anchor

Its own commit, `fb33b31`, after the code commits, no prose changed. The method
is `docs/task/RFCT-215.md` section 5's: mechanical remap from the pre-image,
both endpoints of a range mapped independently, and a citation moved only when
the pre-image line and the destination line are byte-identical.

| | count |
|---|---|
| full-form citations rewritten | 424 |
| bare `:NNN` continuations rewritten | 48 |
| already correct, left alone | 494 |
| authored by this branch, excluded | 7 |
| **refused as unresolvable** | **0** |

Documents carrying a `<!-- dated-record: -->` marker were left alone. The seven
exclusions are the citations this branch wrote into `docs/design/api.md`
section 2.3 with the post-change line numbers already in them; without the
exclusion the pass would have shifted them a second time, which is the one way
a content-verified remap can still be wrong.

**No constant offset was used, and none would have worked.** Three files moved,
by nine different offsets across eleven regions:

| file | regions | offsets |
|---|---|---|
| `os/pkgs/mosd/apid/src/routes.rs` | 2 | +4, +36 |
| `os/pkgs/mosd/apid/src/tests.rs` | 6 | +7, +10, +14, +89, +92, +113 |
| `docs/design/api.md` | 2 | +22, +32 |

## 9. Gates

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | `docs/verify-citations.sh: 2213/2213 PASS`, `near-miss: no quote armed, but a quoted span sits 1-3 words away: 354` |
| `bash docs/verify-index.sh` | `docs/verify-index.sh: 875/875 PASS` |
| `bash hack/check.sh` (container, `localhost/mos-build-rust:amd64`) | `ALL CHECKS PASSED`; `838 tests run: 838 passed (2 slow), 0 skipped` — run at `42752f3`, the last commit that touches code |
| `oasdiff breaking` 1.29.1 vs `main` at `7566210` | `No changes detected`, `RC=0` |

The reference figures this branch was given were 2196/2196 with near-miss 354,
and 871/871. Both totals are higher and both deltas are arithmetic, not drift.
**Citations, 2196 + 17 = 2213.** One comes from `docs/design/api.md` section
2.3, whose gate list gained a decision and with it one more full-form citation,
from seven code citations in the old block to eight in the new; the other
sixteen are this file's own. **Index, 871 + 4 = 875**, which is what one added
task file and its row cost `docs/task/RFCT-246.md` too, recorded in
`docs/task/RFCT-244.md` section 11 as 851 going to 855.

The near-miss count is **unchanged at 354**. That is the figure to read: a
citation whose quote drifted one to three interposed words registers there and
nowhere else, and a re-anchor pass is exactly what causes that. 354 before and
354 after means the pass moved line numbers and disturbed no quote's adjacency.
The one adjacency this branch did have to repair was in this file, not in the
re-anchored corpus: a first draft put three words between a quote and its
citation, the ratchet on unquoted citations in a new document caught it, and it
was fixed rather than ceilinged.

**Test-count arithmetic.** 836 baseline + 2 added = 838. The rename in section 6
is net zero. Measured per crate as well: `-p apid` reported 353 tests before
this branch and 355 after.

**oasdiff.** The binary is 1.29.1 at
`541f7c66c933495fceef24eaf5c48aa66c19069f366f7bd0a60a6a4820c5e533`, the base is
`main`'s tip re-read at the moment of the run (`7566210`), and the severity file
raises `response-optional-property-removed` and
`response-non-success-status-removed` to `err`. `No changes detected` is the
expected result and now a measured one: undeclared paths appear in no OpenAPI
document, so a change to what the gate does with them cannot move the schema.
`os/pkgs/mosd/apid/openapi.json` is byte-identical to `main`'s.
