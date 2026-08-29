# RFCT-248 PLAN-026 M2: the gate asymmetry on undeclared /api/ paths

- **status**: completed — an undeclared path under `/api` answers section 2.4's 404 envelope for **every** credential and for none, where it previously answered a 303 to `/login` (or to `/setup`) for every client that was not a browser; two pinning tests asserted the old answer and both are flipped, one of them found by the gate rather than by the brief; the cookie arm's answer is measured byte-identical before and after; 845/845 (843 baseline + 2 added), 2153/2153 citations with near-miss 335, 887/887 index, oasdiff RC=0
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
(`os/pkgs/mosd/apid/src/routes.rs:3372`) in normal mode, or at
`return Redirect::to("/setup").into_response();`
(`os/pkgs/mosd/apid/src/routes.rs:3365`) in setup mode. The gate's entire
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
(`docs/design/api.md:2805-2814`), and the fix as
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
(`os/pkgs/mosd/apid/src/routes.rs:3324-3329`).

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
(`os/pkgs/mosd/apid/src/routes.rs:3295`) no longer decides whether anything is
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
(`os/pkgs/mosd/apid/src/tests.rs:6618`) walks five undeclared spellings against
four credentials — none, a stored bearer, an unstored bearer, a session cookie
— and asserts the four envelopes are equal **to each other** as well as to the
literal, so the symmetry itself is what is pinned; it also holds `/apibogus` to
its redirect and `/healthz` to its 200, because an assertion has to distinguish
the rule from its absence.
`an_undeclared_api_path_is_a_404_in_setup_mode_too`
(`os/pkgs/mosd/apid/src/tests.rs:6683`) closes the gate's other redirect exit,
which is a second exit and not the same one twice.

## 6. Two pinning tests, not one

The brief named one test to flip. The gate found a second.

**Named in the brief.** The final arm of
`an_absent_token_id_is_404_and_a_malformed_one_is_422`
(`os/pkgs/mosd/apid/src/tests.rs:6540`) asserted the 303 to `/login` and said in
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
(`os/pkgs/mosd/apid/src/tests.rs:1879`) and its three arms are folded into one
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

Done three times, because `bkd/5q6am5rw` moved twice under this branch. The
method hardened at each step, and the last form is the one to copy.

### 8.1 The first pass was reverted rather than merged

`fb33b31` re-anchored against this branch's own tree. Then the sync branch
moved and the merge conflicted in **sixteen documents**, every conflict of this
shape and nothing else:

    <<<<<<< HEAD
    (`routes.rs:3330`), and only *declared* routes are handed
    =======
    (`routes.rs:3338`), and only *declared* routes are handed
    >>>>>>> bkd/5q6am5rw

The conflicted line is from `docs/task/RFCT-245.md` and its citation names
`os/pkgs/mosd/apid/src/routes.rs` in full; the path is abbreviated here so this
illustration of two dead line numbers is not itself read as two citations.

Both sides had shifted the same citation by different offsets, and neither
number is right for the merged tree. `docs/task/RFCT-215.md` section 5 decides
it: *the side holding content re-derivations wins, because they cannot be
recovered mechanically; the side holding shifts loses, because they can*. Only
one of the two sides is this branch's to withdraw, so the merge was aborted,
`fb33b31` reverted, the merge retaken — one conflict left, in
`docs/design/api.md`, where this branch holds new prose and the incoming side
held only shifts — and the pass re-derived against the merged tree. 468
citations moved, 518 were already correct, 0 refused.

### 8.2 Resolving the conflicts is not the job

When two branches insert into one source file, the citations that **conflict**
are the safe ones: git asks about those. The dangerous ones auto-merge in
silence — each side anchored correctly against its own tree, the merged file
holds both sets of insertions, and the true line is displaced by the sum and
matches neither side. A clean conflict list is evidence about nothing else.

Measured at the second merge, after all eight conflicts were resolved: **40
further citations were wrong**. Thirty were `tests.rs` citations standing on
this branch's lines and needing the incoming side's `+105`; five were
`routes.rs` citations standing on incoming lines and needing this branch's
`+36`. The trap runs in both directions and neither direction announces itself.

### 8.3 The final method: frame each citation by the commit that wrote its line

A document is not in one frame. After a conflict resolution it holds values
from both sides, line by line, so a per-document frame is a guess. The third
pass reads `git blame` on the merged document, classifies each citation by
whether the commit that last wrote its line is on this branch, on the incoming
branch, or older than the merge base, and maps it from **that** tree.

| frame | citations |
|---|---|
| this branch | 517 |
| the incoming side | 45 |
| older than the merge base | 554 |

Every accepted mapping had to clear a content check first: the **longest
byte-identical run** starting at the cited line, up to seven lines, present at
the destination and **unique** in the merged file. One line is not enough — a
lone `}` matches everywhere, and this campaign has already measured a bare `}`
mapping 44 lines past its target with every gate green.

| | first merge | second merge |
|---|---|---|
| citations rewritten | 468 | 40 |
| already correct, left alone | 518 | 1070 |
| **refused rather than guessed at** | **0** | **6** |

### 8.4 Three ways this pass was wrong before it was right

**Scope.** The first attempt at the second merge targeted only `.rs` files and
left two content failures behind — `docs/task/RFCT-216.md` and
`docs/task/RFCT-226.md`, both citing lines the incoming side had moved inside
`docs/design/api.md`. A citation into a *document* shifts exactly as a citation
into a source file does. That attempt was reset rather than patched, because a
frame-relative pass re-run over its own output shifts everything twice.

**The dated-record marker.** `docs/verify-citations.sh` anchors it at line
start — `if grep -q '^<!-- dated-record:' "$doc"; then`
(`docs/verify-citations.sh:451`) — and an early pass matched it anywhere in a
file. That is not a conservative difference: it silently exempted documents the
gate does scan, this record among them, because section 8 quotes the marker in
prose.

**Self-shifting.** The citations this branch authored already carry
post-change numbers. A trial run moved a correct line 3277 to line 3313 and it
content-verified clean, because a one-line check compares the pre-image line to
the destination line and those two *are* the same line. Both numbers are prose
here for the reason section 1 gives. The blame framing in 8.3 removes the need
for a hand-maintained exclusion list: an authored citation blames to this
branch and is framed against this branch's tree, which is what it was written
for.

### 8.5 The six refusals, none of them this branch's

A refusal is the method working. Each was read rather than re-pointed:

- `docs/design/bus.md` cites `tree.rs` at line 43 for `tree::redact`. That function is
  `fn redact(value: &mut Json) {` (`os/pkgs/mosd/mosd/src/tree.rs:140`), and
  line 43 is a doc comment at the merge base and on the incoming branch alike.
  **Pre-existing, and unarmed, so `docs/verify-citations.sh` never checks it** —
  it resolves, so the gate is green over a citation that has been wrong for
  longer than this branch has existed.
- `docs/task/RFCT-170.md` cites a `docs/design/bus.md` region the incoming side
  replaced. Content-deleted, so there is nothing to map to.
- Four are table rows in `docs/task/RFCT-155.md`, `docs/task/RFCT-159.md` and
  `docs/task/RFCT-172.md` that record where a citation **used to** point.
  Re-pointing them at today's tree would falsify the record they exist to keep.

**No constant offset was used, and none would have worked.** Across the two
merges the same three files moved by nine distinct offsets, and the two
`tests.rs` shifts this branch had to compose — its own `+7/+10/+14/+89/+92/+113`
and the incoming side's `+105`, then `+218` — are why a document's citations
cannot be corrected by adding a number to them.

## 9. Gates

`hack/check.sh` and `oasdiff` were run at `a0d9512`; every commit after it
touches `docs/` and nothing under `os/`. The two documentation gates were re-run
at this file's final state.

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | `docs/verify-citations.sh: 2153/2153 PASS`, `near-miss: no quote armed, but a quoted span sits 1-3 words away: 335` |
| `bash docs/verify-index.sh` | `docs/verify-index.sh: 887/887 PASS` |
| `bash hack/check.sh` (container, `localhost/mos-build-rust:amd64`) | `ALL CHECKS PASSED`; `845 tests run: 845 passed, 0 skipped` |
| `oasdiff breaking` 1.29.1 vs `main` at `498f0e4` | `No breaking changes to report, but the specs are different.`, `RC=0` |

**Every number is a delta against the sync branch's tip, measured there rather
than assumed.** The reference figures handed to this branch were 2196/2196 and
871/871, then 2221/2221 and 879/879, both taken before the sync branch moved
again. Rather than compare against a stale total, the gates were run on
`bkd/5q6am5rw` at `d87abb4` itself, in a throwaway worktree, and read
**2134/2134 PASS with near-miss 335, and 883/883**. Against that:

| | incoming tip `d87abb4` | this branch | delta |
|---|---|---|---|
| citations | 2134 | 2153 | **+19**, this record's own 18 and one added to `docs/design/api.md` section 2.3 |
| near-miss | 335 | 335 | **0** |
| index | 883 | 887 | **+4**, one added task file and its index row |
| tests | 843 | 845 | **+2**, section 5's two |

**The near-miss figure is 335 and not the 354 this branch was given.** The
change is not drift and not this branch's: `d87abb4` reads 335 on its own, from
its own re-anchor-by-provenance commit. 354 is a figure from before that
landed. What matters is that this branch moved 508 citations across two merges
and the count is **identical** to the tree it merged from — a re-anchor that
disturbs a quote's adjacency shows up there and nowhere else.

**Test-count arithmetic: 843 baseline + 2 added = 845.** The rename in section 6
is net zero. Corroborated mechanically rather than asserted: counting `#[test]`
and `#[tokio::test]` attributes across `os/pkgs/mosd` gives 824 at `d87abb4` and
826 here, a difference of exactly two.

**Both ratchet checks on this record read zero.** `docs/verify-citations.sh`
enforces a per-document ceiling on unquoted citations, and a document with no
row in `docs/verify-citations-unquoted-baseline.txt` has a ceiling of **0**. This
record has no row and needs none: its census line reads
*"no quote, by document: docs/task/RFCT-248.md 0"*, and it carries **no bare
`:NNN` form at all**, which matters because the gate skips that form entirely —
a bare citation is not failed, not counted and not checked, so a document can be
green and wholly unverified. The ceiling was hit twice while this record was
drafted and both times the citation was **armed**, never ceilinged: once for
five citations that named a file without quoting it, once for a quote separated
from its citation by three interposed words. A raised ceiling is an override
with nothing behind it; an armed citation gets its fragment checked against the
cited line, so the next rename is caught.

**oasdiff.** The binary is 1.29.1 at
`541f7c66c933495fceef24eaf5c48aa66c19069f366f7bd0a60a6a4820c5e533`, the base is
`main`'s tip re-read at the moment of the run (`498f0e4`), and the severity file
raises `response-optional-property-removed` and
`response-non-success-status-removed` to `err`.

The design constraint predicted **no change at all** to the document, and before
the merges that is exactly what was measured: `No changes detected`. The specs
differ now, and the difference is not this branch's: `git diff` between the
sync branch's tip and this tip touches `os/pkgs/mosd/apid/openapi.json` not at
all. The prediction itself is measured and holds — undeclared paths appear in no
OpenAPI document, so a change to what the gate does with them cannot move the
schema.
