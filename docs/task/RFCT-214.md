# RFCT-214 PLAN-023 closeout: the api.md citation re-anchor, all three forms

- **status**: completed — 124 full-form citations re-anchored from a verified
  pre-image and 130 shorthand/continuation ones re-derived from content, with 25
  listed unresolvable and RFCT-210's 17 records deliberately left; all gates green
- **priority**: P1
- **owner**: bkd/5n3a7yq1
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-023 (closeout, the citation census)

The citation census this task closes covers three syntactic forms, and only
the first of them has ever been held by a gate:

1. **Full** — a path and a line together, quoting what is there:
   *"fn api_router() -> Router<AppState> {"* (`os/pkgs/mosd/apid/src/routes.rs:414`).
   `docs/verify-citations.sh` resolves this form, and only this form.
2. **Shorthand** — a bare `` `:120` `` whose file is named by the table header
   or the surrounding prose rather than by the token itself.
3. **Continuation** — a bare `` `:358-359` `` inheriting its file from a full
   citation earlier on the same line.

Forms 2 and 3 are counted against the unquoted ratchet and never resolved, so
a green gate says nothing about them. Every defect this task exists to repair
lives in exactly the forms no gate has held.

## 1. The merge-down, and what it cost

This branch was cut from `main` after PLAN-024 (`448e225`) and PLAN-025
(`4959179`) landed there, and `bkd/vu5b6kk0` did not yet carry either. Merging
main down produced fifteen conflicted files, not the one the brief predicted.
Fourteen of them are documents, and the reason is that both sides had run their
own citation re-anchor pass over the same corpus: main's `de84b75` for the
`/state` 404 fix, this workstream's six passes for M4, M5, M6 and the
duplicate-409 edits.

Every conflicted document took this branch's prose, which is the newer one, and
main's side was checked mechanically for anything that was not a number: masking
every `:N` and `:N-M` token and comparing, eleven of the thirteen documents main
touched were numbers-only, and the two that were not carried three real prose
changes, all re-applied by hand. `routes.rs` conflicted once, in the `/state`
route's response annotation, and is resolved as a union — PLAN-025's 404 clause
and this workstream's token-aware 401 description both stand, because the
handler body they describe merged cleanly and carries the 404.

That resolution changed the generated OpenAPI document: with the 404 declared
ahead of the 405, the two response objects swap position. `openapi.json` was
regenerated with the command the failing test names. No schema, status or body
changed.

## 2. The three forms, and which gate holds them

`docs/verify-citations.sh` extracts on the regex `` `[^` ]+:-?[0-9]+(--?[0-9]+)?` ``.
The character class before the colon requires at least one character, so a bare
`` `:120` `` **does not match it at all** — the form is not checked, not
resolved, and not even counted as skipped. The no-slash form `` `routes.rs:95` ``
does match, and is then skipped by the documented scope rule as shorthand with
no base to resolve against.

So of the four forms in the corpus, exactly one is held by a gate:

| form | example | extracted? | resolved? | content-checked? |
|---|---|---|---|---|
| full | *"fn api_router() -> Router<AppState> {"* (`os/pkgs/mosd/apid/src/routes.rs:414`) | yes | yes | when armed with a quote |
| no-slash | `` `routes.rs:172` `` | yes | no — skipped by scope | no |
| shorthand | `` `:120` ``, file from the prose | **no** | no | no |
| continuation | `` `:358-359` ``, file from earlier on the line | **no** | no | no |

A green run says nothing about the bottom three rows. Every defect this task
exists to repair lives there.

## 3. Classifying before touching: (A) shifted, (B) never valid

Re-anchoring maps an old line to a new one and is only valid if the old line was
right. Each citation was therefore tested against a pre-image BEFORE being
touched, using the gate's own adjacency rule for the armed quote.

Two pre-images are in play, because the merge brought together two documents
sets with different provenance: `bkd/vu5b6kk0` for this workstream's documents,
`fd7fbb0` (main) for PLAN-025's records. The 124 content failures partition
cleanly and with no overlap — 113 resolve at `bkd/vu5b6kk0` and not at main, 9
resolve at main and not at `bkd/vu5b6kk0`, 2 resolve at neither.

The instrument was controlled the same way RFCT-212 controlled its census, at
this base commit rather than at `8f080dc`:

| set | armed with a quote | resolved in the pre-image |
|---|---|---|
| full-form citations into `routes.rs` from `api.md` | 30 | **30** |
| bare citations into `routes.rs` from `api.md` | 56 | **0** |

Same extractor, same test, same target file, opposite results. The full form was
valid and moved; the bare form was never valid. Of the 91 bare ones carrying no
armed quote, the loose name test RFCT-212 used hits 1 of 66 testable — a
coincidence of the kind that task already measured three of.

## 4. Method for (A): asymmetric windows, and no offset anywhere

A range's start is defined by what follows it and its end by what precedes it,
so `a` is mapped on a forward window `[a, a+k)` and `b` on a backward window
`(b-k, b]`, growing `k` until the window occurs exactly once in the post-image.
A single line is mapped in both directions and the two must agree. Where no `k`
resolves uniquely the mapper refuses. Every mapped citation was then re-tested
against the quote it carries, and only written if the quote resolved there.

**113 of 113 mapped and verified; 0 refused.** The shifts measured were:

| file | citations | shift |
|---|---|---|
| `os/pkgs/mosd/apid/src/routes.rs` | 96 | +28 |
| `os/pkgs/mosd/apid/openapi.json` | 14 | +10 |
| `test/apid-api/HARNESS.md` | 1 | +24 |
| `docs/design/mosd.md` | 2 | +45 |

Four files, four different shifts, so a single constant would have been wrong
for 17 of the 113 even in a merge whose `routes.rs` insertion was one band. The
nine anchored at main ranged from +14 to +2287.

The mapper refused exactly two, and both are the same case: a citation naming a
**value** rather than a location. `SCHEMA_VERSION` is 8 since PLAN-023's
`05bec3c`, and no window containing `pub const SCHEMA_VERSION: u32 = 7;` can
match anywhere in the post-image, in either direction. A line map cannot repair
that, and did not pretend to.

- `docs/design/mosd.md` is a live design document whose dated note asserts what
  is true *today*, so the value is corrected to 8 and the note records that
  PLAN-023 made the bump. The line, `:11`, was already right.
- `docs/task/RFCT-232.md` is a completed record. Its claim and its quote are
  what that task measured and stay verbatim; only the anchor is retired, naming
  the commit — the device main itself used in this same merge for RFCT-206's
  replaced refusal.

## 5. Method for (B): re-derived from content, never mapped

For the bare set there is no true earlier number, so nothing was shifted. Each
citation was resolved to the construct its prose names, in the tree as it
stands:

- the route-line column of both route tables read straight out of `app()` and
  `api_router()`, every target line read back before it was written;
- handler citations to the function's declaration;
- a mosd call such as `GetSettings("hostname")` to the `get_settings("hostname")`
  call inside the handler's own body, following the delegation where there is
  one — `GET /builtin`'s two calls live in `status_body`, reached through
  `builtin_page`, and `network_form`'s read lives in `load_network_view`;
- behaviour citations by reading the handler: `setup_submit`'s five status
  branches, `login_submit`'s 429/401/success arms, `power_submit`'s confirm
  check and its detached `tokio::spawn`.

Two guards refuse rather than guess, and both fired on real cases: a **range**
that resolves to a one-line declaration is a shape mismatch (20 of them), and a
resolution landing on a doc comment is not the construct (7). `builtin_not_found`'s
404 is the `StatusCode::NOT_FOUND` line and not the function declaration an
earlier automated pass matched.

## 6. Counts, per form and per class

Measured across the whole scanned corpus between `d136eb3` (the merge, before
any citation work) and this commit.

| form | present | corrected | left as written |
|---|---|---|---|
| full | 1268 | 124 | 1144 |
| shorthand | 370 | 119 | 251 |
| continuation | 100 | 11 | 89 |
| no-slash | 173 | 0 | 173 |

Split by class: all 124 full-form corrections are class (A) except the 2 that
resolved at neither pre-image, which were content-re-derived; all 130 shorthand
and continuation corrections are class (B), content-re-derived without exception.
Nothing in the bare set was mapped from a pre-image.

Per document, for the six the census names:

| document | bare into `routes.rs` | corrected | left |
|---|---|---|---|
| `docs/design/api.md` | 147 | 122 | 25 |
| `docs/task/RFCT-210.md` | 17 | 0 | 17 |
| `docs/task/RFCT-140.md` | 2 | 2 | 0 |
| `docs/task/RFCT-200.md` | 2 | 2 | 0 |
| `docs/design/bus.md` | 1 | 1 | 0 |
| `docs/design/dashboard.md` | 1 | 1 | 0 |

The census re-derived at this base is 147 / 17 / 2 / 2 / 1 / 1. RFCT-212 counted
705 continuations corpus-wide against this pass's 100 because it resolved a bare
token's file to the nearest preceding full citation anywhere in the document,
where this pass separates the two cases the brief distinguishes: a token whose
file comes from earlier on the SAME line is a continuation, and one whose file
comes from further back is shorthand. Under RFCT-212's single rule the corpus
total is 1136, which is the number the two methods have in common.

## 7. RFCT-210's seventeen, deliberately not rewritten

RFCT-210's inventory table is a dated audit at `f7cb5ba`, and its bare citations
are not citations into code. `| 9 | POST /login | 167 | 1528 | yes (cited
`:1560`) |` records **what section 2.3's table cited when the audit ran**. The
number is the measurement. Re-anchoring it to today's tree would destroy the
finding the record exists to hold, so all seventeen stay as written.

## 8. Unresolvable, for a human

Twenty-five bare citations in `docs/design/api.md` are not repaired here, in
four groups. None was given a plausible-looking nearby line.

**(a) A quote of code that no longer exists — 1.** Section 2.1's table row for
`GET /api/v1/state/{*path}` quotes
`resource_response(state.api.get_state(&path).await, &path)` at `:506`. PLAN-025's
404 fix rewrote that expression to `resource_response(value, &path)`, now at
`None => resource_response(value, &path),`
(`os/pkgs/mosd/apid/src/routes.rs:1271`). Main corrected the same quote in two
other places in this document and missed this one. Correcting a quotation is a
content edit, not a citation edit, so it is recorded rather than made.

**(b) A paragraph whose counts are falsified — 10.** Section 1.2's *"Kinds,
counted, at this commit"* paragraph (`:161-167`, `:188-190`, `:181-189`, `:201`,
`:148`, `:152`, `:280-283`, `:153`, `:203`, `:284`) groups its citations under
counts — *"twenty-one"*, *"two"*, *"four"*, *"twenty-seven"*, *"thirty"* — that
the merged router falsifies: the nested `/builtin` router now declares four
routes, not two, and `api_router()` declares far more than four. Each token
could be pointed at a real line, and doing so would put correct numbers under a
false count and make the rot look repaired. The counts need rewriting first.

**(c) An explicitly dated sentence — 3.** *"As of `0d4f3c6` the fifteen
declarations are at ..."* (`:211`, `:286`, `:165`) binds its numbers to a named
commit. Re-anchoring them to HEAD would contradict the sentence that carries
them.

**(d) Citations naming no findable construct — 11.**

| where | tokens | why |
|---|---|---|
| §2.4, the error box | `:1737`, `:1757` | *"the pane already shows mosd's message text in an error box"* — `error_box` has many call sites and the prose picks none |
| §6.2, the built-in pane | `:658` | *"(`home`, at `…:58` and `:658`)"* gives two anchors for one function; `home` is at `:4361` and what the second was meant to be cannot be recovered |
| §6.2, the image assertion | `:341`, `:248` | the sentence cites `os/verify-image-v2.sh`, which no longer exists in the tree — the checks were ported to `os/verify/src/`, which the same sentence already names |
| §6.3, the navigation | `:341` | *"the navigation on every built-in pane"* names no function that exists under that description |
| §8.1, items (iv) and (v) | `:2245`, `:1975`, `:1985`, `:2501`, `:3270` | five anchors in a bare list with no adjacent name and no prose that says which shipped pane each one is |

## 9. Content defects recorded, not fixed

Out of scope by the task's own terms, and none of them a citation defect:

- Section 1.2's *"Four declared routes"* claim for the `/api` subtree is
  falsified by PLAN-021 and PLAN-022, and now by M4, M5 and M6 as well.
- Section 1.2's route table has no row for `/password`, `/network/peers/add`,
  `/network/peers/remove`, `/builtin/tokens` or `/builtin/tokens/revoke`, all of
  which `app()` declares.
- Section 2.1's table has four rows against the fourteen-odd routes
  `api_router()` now declares.
- The three groups in section 8 above.

## 10. A fourth form, measured and left in scope for someone

The brief names three forms and this task repaired those three. There is a
fourth, and leaving it unmeasured would repeat the silence this task exists to
end: the no-slash shorthand `` `routes.rs:2545` ``. That form DOES match the
gate's token regex and is then skipped by the documented scope rule — *"is
shorthand for a path named earlier in the prose and has no base to resolve
against"* — so like the bare forms it is never resolved.

Counted at this commit: 173 no-slash tokens corpus-wide, 42 of them in
`docs/design/api.md` naming `routes.rs`. Tested the same loose way RFCT-212
tested the continuations — the nearest backticked name on the line against the
cited line — **39 of 42 do not resolve**, 1 does, and 2 carry no name to test
with. Section 2.3's conversion table is where most of them live, and its rows
read `` `POST /ssh/keys/add` (`routes.rs:2545`) `` where `ssh_key_add` is now
*"async fn ssh_key_add(State(app): State<AppState>, Form(form): Form<SshKeyAddForm>) -> Response {"*
(`os/pkgs/mosd/apid/src/routes.rs:6837`).

None was rewritten here, because the task's stated scope is the three forms and
widening it silently is the wrong way to grow a remit. It is the same rot, in
the same document, by the same mechanism, and it wants the same treatment: no
pre-image map, content re-derivation, and a listed residue for what cannot be
derived.

## 11. Gates

`bash docs/verify-index.sh` — **843/843 PASS**.

`bash docs/verify-citations.sh` — **1654/1654 PASS**, from a post-merge baseline
of 125 FAILED (124 content, 1 ratchet). The ratchet failure was this document's
own unquoted example citation, armed with a quotation rather than waived.

The Rust gate ran unmodified from `os/pkgs/mosd/hack/check.sh` in
`localhost/mos-build-rust:amd64`: **813 tests run, 813 passed, 0 skipped**,
`ALL CHECKS PASSED`. The baseline is 812; the extra test is PLAN-025's
`a_dot_path_that_does_not_exist_is_404_…`, brought in by the merge-down. No Rust
behaviour was changed by this task.
