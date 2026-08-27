# RFCT-155 PLAN-017 M1: api.md reconciled against openapi.json and HEAD

- **status**: completed
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-26 22:05
- **claimedAt**: 2026-08-27 06:18
- **completedAt**: 2026-08-27 06:45
- **plan**: PLAN-017 (M1)

PLAN-017 M1. `docs/design/api.md` framed sections 2-9 as unimplementable
proposal — *"there is nothing to check yet"* — while `mosd/apid/openapi.json`
records a served surface, and section 1's route table described the
nineteen-path router measured at `86cd669`, whose citations still resolved
while pointing at unrelated code. Both are corrected here.

## What landed

Five commits, merged at `646d43e`. Measured from `git diff --shortstat`:

| commit | change | insertions/deletions |
| --- | --- | --- |
| `6147a50` | section 0: the marker rule stated per section, not per document | 40/21 |
| `5a19492` | section 1 re-measured against this branch's tree | 600/281 |
| `a4247ff` | sections 2 and 3 marked per subsection against the served surface | 488/206 |
| `6b16b53` | section 8's verbatim quotation of section 2.1 kept accurate | 3/2 |
| `c697b09` | the api.md line citations the section 0 rewrite moved, re-pointed | 2/2 |

**Section 0.** The per-document framing ("nothing to check yet") is replaced by
the per-section framing the headings already use: a section marked
**[implemented]** is checkable against the tree and a section marked
**[proposed]** is not, and sections 2 and 3 carry both. The provenance
paragraph no longer implies that one measurement covers the document — sections
1, 2 and 3 are re-measured at `f7cb5ba`, sections 4-9 are not, and the
paragraph says so.

**Section 1.2** is rebuilt from `app()` at `mosd/apid/src/routes.rs:113-188`.
The counts are recounted from source: **27** `.route()` calls across the HTTPS
tree and 30 declared method+path pairs, against the fifteen and nineteen the
document carried. The table gains the routes it was missing — the nested
`/builtin` subtree, `/containers`, `/mqtt`, their enable posts, the nested
`/api` router, the explicit `/api/` route and the asset fallback — each with
its real route and handler line, and the `/api` subtree gets its own table.
The claim that no route returns JSON is now half false and says so; the
surviving half, that nothing accepts a JSON request body, was re-checked
against every handler signature.

**Sections 1.4 - 1.7** follow the tree: the session check moved above the
`GetSettings` call, so only an unauthenticated request pays a bus round trip
(1.4); `SCHEMA_VERSION` is 6, not 4, and the container and mqtt subtrees are
added (1.5); 1.6's claim that apid serves no static asset from anywhere is
reversed and evidenced in the same four positions.

**Sections 2 and 3** are marked per subsection against `openapi.json`'s four
GET paths and five schemas. 2.2 records that the redactor ships **wider** than
proposed — it covers the live-state root too. 2.4 compares the error envelope
field by field with the committed schema and records four differences. 3.2
names what the four routes authenticate with instead of bearer tokens (the
browser session cookie through the `ApiSession` extractor) and records that
`access.apiTokens` does not exist in the settings model.

Factual claims now carry quoted fragments, so `docs/verify-citations.sh`
content-checks them rather than merely resolving them. The gate went
675/675 -> **886/886**, with quote-carrying citations 164 -> **341**.

## The sweep's stated method

This subtask's merge was **rejected on first attempt** and repaired. Recording
it, because "reported success" and "merged" came apart here.

The four content commits were verified correct before the merge: 27
`.route()` calls, `Json(` exactly once, `Form<` twelve times,
`grep -ni csrf mosd/apid/src/*.rs` empty with rc=1, and the diff confined to
`api.md`. All four still reproduce on the merged tree. The merged tree
nevertheless failed the citation gate:

```
FAIL docs/design/remote-management.md:48 quotes "The surface as it exists
today", and that text is not at `docs/design/api.md:67`
```

RFCT-156 cited api.md's section 1 heading by line; this subtask's section 0
rewrite moved that heading from `:67` to `:96`. **Each branch was green
alone.** The defect existed only where they met, so no check either subtask
could have run would have found it.

The repair (`c697b09`) is the stated rule this workstream now works to:

> A sweep reporting only its hits is indistinguishable from one that stopped
> early.

So the repair walked **every** document under `docs/design/` for citations of
`docs/design/api.md` by line, and reported the unchanged citations as well as
the changed ones. The walked result, reproducible with
`grep -rn 'api\.md:[0-9]' docs/design/*.md`:

| document | api.md line citation | disposition |
| --- | --- | --- |
| `docs/design/remote-management.md:48` | `api.md:67` -> `api.md:96` | **changed** — the section 1 heading moved; this is the failure above |
| `docs/design/bus.md:407` | `api.md:789` -> `api.md:1251` | **changed** — still resolved, so no gate caught it, but `:789` had come to land in section 1.7's dashboard paragraph instead of the redaction rule it adopts |
| every other document under `docs/design/` | none | **unchanged** — they reference api.md by name or by section, never by line, so nothing in them could have moved |

Line numbers only in both files; no prose, no quoted fragment and nothing else
was touched.

## What this subtask did not settle

`docs/task/**` and `docs/research/**` are outside `docs/verify-citations.sh`'s
scope and hold line citations into `docs/design/api.md` that this rewrite
invalidated. They are inventoried in `docs/task/RFCT-159.md`, not fixed here.
