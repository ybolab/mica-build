# RFCT-252 PLAN-026 M6: the import unsplits, measured and refused

- **status**: completed — the fold was applied as a throwaway, measured against the citation gate, and reverted; M6 closes on that measurement and ships no code change
- **priority**: P2
- **owner**: bkd/e1tsi569
- **createdAt**: 2026-08-29
- **completedAt**: 2026-08-29
- **plan**: PLAN-026 (M6)

M6 as written was a cosmetic edit: fold `use axum::routing::delete;` and
`use axum::routing::put;` into the grouped routing import and delete the
five-line comment that explains why they are split. It was ruled closed without
that edit: the plan's own dated correction rules that *"the imports are not
folded; RFCT-252 closes with the dated measurement"*
(`docs/plan/PLAN-026.md:101-111`). This document is the milestone's deliverable
and it is the whole of it. Section 11 states in as many words that the code is
deliberately unchanged, so nobody later reads M6 as unfinished rather than as
decided.

Every number below was measured in this task's own worktree,
`/srv/bkd/worktrees/u51kzjlk/e1tsi569`, at branch `bkd/e1tsi569` /
`ffa65cad0662db7fc10705304c382540eafbbe60`, after the required upstream sync
(`git merge --no-ff bkd/5q6am5rw` reported `Already up to date.`; `c5f7e96` is
already an ancestor of this HEAD). Nothing here is relayed: the dispatch brief
carried a prediction of each result, and where mine differ, section 10 says so.

## 1. The item still reproduces

The comment and the two split imports are present and unmoved at this HEAD.

    $ cat -n os/pkgs/mosd/apid/src/routes.rs | sed -n '25,32p'
        25	// `delete` and `put` are imported on their own lines rather than folded into
        26	// the routing import below. `docs/task/RFCT-210.md` quotes that line verbatim
        27	// as the measurement behind its central negative -- apid had never served a
        28	// write verb -- and a record of what was true is not edited by the change that
        29	// makes it untrue.
        30	use axum::routing::delete;
        31	use axum::routing::put;
        32	use axum::routing::{any, get, post};

So the keep-verbatim comment occupies lines 25 through 29 of
`os/pkgs/mosd/apid/src/routes.rs`, the two single-verb imports lines 30 and 31,
and the grouped import line 32. The file is 6870 lines long.

## 2. The clean baseline, taken before any probe

    $ bash docs/verify-citations.sh | tail -1
    docs/verify-citations.sh: 2170/2170 PASS
    $ bash docs/verify-index.sh | tail -1
    docs/verify-index.sh: 863/863 PASS

Both exited 0. Every failure counted in section 3 is therefore caused by the
probe and by nothing that was already broken.

## 3. The probe: the fold applied, measured, reverted

Lines 25-32 — the five comment lines, the two split imports and the grouped
import — were replaced by the single line
`use axum::routing::{any, delete, get, post, put};`, which is exactly the edit
M6 specified.

    $ git diff --stat
     os/pkgs/mosd/apid/src/routes.rs | 9 +--------
     1 file changed, 1 insertion(+), 8 deletions(-)

One insertion, eight deletions, one file: the probe is the milestone's edit and
nothing else. Against that tree:

    $ bash docs/verify-citations.sh; echo "exit=$?"
    ...
      resolution failures:    5
      content failures:       549
      census failures:        0
      ratchet failures:       0
    docs/verify-citations.sh: 554 FAILED (5 resolution, 549 content, 0 census, 0 ratchet), 1616 citations passed
    exit=1

The probe was then reverted with `git checkout --` on the one file, and the
tree was confirmed clean and green again:

    $ git status --short
    (empty)
    $ bash docs/verify-citations.sh | tail -1
    docs/verify-citations.sh: 2170/2170 PASS

The working tree carries no part of the probe. Nothing in this milestone's
commit touches `os/pkgs/mosd/apid/src/routes.rs`.

## 4. What the 554 failures are, classified

The fold removes eight lines and adds one, so the file goes from 6870 lines to
6863 and every line below the import block moves up by seven. Most of the
breakage is therefore bookkeeping. It was classified mechanically against the
probe's own failure list rather than by eye: for each content failure, the
quoted fragment was compared against the cited range moved up by seven lines,
under the gate's own normalisation (collapse whitespace runs, strip the comment
marker that opens each line).

| Class | Count | Re-anchorable |
|---|---|---|
| Content failures whose quote is at the cited range minus 7 | 547 | yes, by the standing mechanical method |
| Resolution failures: citations past the new end of file | 5 | yes, same shift |
| Content failures with no line to move to — **class B** | 2 | **no** |

The five resolution failures are the shift reaching the end of the file: the
citations name lines 6864 through 6868 of a file the fold leaves 6863 lines
long. Three are in `docs/task/RFCT-210.md`, two in `docs/design/api.md`.

## 5. The two class-B failures, which are the whole finding

    FAIL docs/task/RFCT-210.md:62 quotes "use axum::routing::{any, get, post};", and that text is not at `os/pkgs/mosd/apid/src/routes.rs:32`
    FAIL docs/task/RFCT-240.md:251 quotes "use axum::routing::{any, get, post};", and that text is not at `os/pkgs/mosd/apid/src/routes.rs:32`

These two are not shifts. A shift means the quoted text still exists somewhere
in the file and the citation names the wrong line for it. Here the fold deletes
the text itself: after the probe, a repository-wide search for that exact string
in Rust sources returns nothing.

    $ grep -rn --include='*.rs' 'use axum::routing::{any, get, post};' . | wc -l
    0

At the time of the probe the only surviving occurrences were three, all in prose
— `docs/plan/PLAN-026.md`, `docs/task/RFCT-240.md` and `docs/task/RFCT-242.md` —
which are the citing records themselves, not a line to re-anchor to. This
document is a fourth such occurrence, for the same reason and with the same
standing: prose about the line, not the line. There is no correct new value for
those two citations, so the mechanical method refuses them rather than guessing,
which is exactly what it is built to do.

What each of them is quoting matters. `docs/task/RFCT-210.md` arms the quote as
the evidence for the central negative of its part 2: *"There is no `put(`, no
`delete(` and no `patch(` anywhere in the router."*
(`docs/task/RFCT-210.md:63`). `docs/task/RFCT-240.md` then records, in the
milestone that made half of that negative false, the deliberate decision not to
edit it. It says so in the plainest terms — *"The record is not edited, and the
line it quotes,"* (`docs/task/RFCT-240.md:248-251`) — and that sentence finishes
by recording that the quoted line survives verbatim and unmoved. Both documents
are frozen measurement records. The line is load-bearing for both.

## 6. Neither document is exempt from the content check

`docs/verify-citations.sh` exempts a whole document from both checks when the
document carries a marker line beginning `<!-- dated-record:` — the gate reads
it with `grep -q '^<!-- dated-record:'` (`docs/verify-citations.sh:451`).
Thirty-four documents in this corpus carry one; these two do not.

    $ grep -c 'dated-record' docs/task/RFCT-210.md docs/task/RFCT-240.md
    docs/task/RFCT-210.md:0
    docs/task/RFCT-240.md:0

So the two class-B failures are real gate failures, not noise, and the fold as
specified cannot be committed green.

## 7. The premise M6 rested on is false

PLAN-026's M6 justified the fold with *"RFCT-215 §1.2 re-stated the quoted
negative as its own measurement, so nothing depends on those lines surviving"*
(`docs/plan/PLAN-026.md:74-76`), and RFCT-215's own residue item repeats it:
*"Section 1.2 now re-states that negative as a measurement of its own, so the
record no longer depends on that line surviving verbatim"*
(`docs/task/RFCT-215.md:296-298`). Measured here, on both readings of what
"Section 1.2" names:

- **RFCT-215 has no section 1.2.** Its section 1, *"What section 1 said, and
  what the tree says"* (`docs/task/RFCT-215.md:21`), is a flat two-column
  ledger of api.md section 1's claims against the tree. It has no subsections.
  It contains no row about the routing import: the only occurrence of the string
  `routing` anywhere in the file is inside the residue item quoted above, the
  one headed *"The import unsplits are now unblocked."*
  (`docs/task/RFCT-215.md:292-293`). A search for the negative it is said to
  restate — `write verb`, `write-verb`, `never served` — matches nothing in the
  file at all. The ledger's business is recording which old claims are now
  false, which is the opposite of preserving one as a standing measurement.
- **api.md section 1.2 is a table of today's surface, not a restatement of the
  historical negative.** Its heading is *"1.2 The route table as shipped"*
  (`docs/design/api.md:176`), and the subsection opens *"Re-measured for
  PLAN-023's closeout"* (`docs/design/api.md:178`). Its route table carries the
  write rows the negative denied — `PUT /api/v1/settings/{*path}`,
  `PUT /api/v1/network`, `DELETE /api/v1/tokens/{id}` and five more. A document
  that lists the write verbs apid serves today does not restate, and cannot
  preserve, the measurement that apid had once served none.

The premise is false on either reading. Nothing in the corpus restates the
negative, so the record still depends on the quoted line surviving verbatim,
exactly as the comment in the code says it does.

## 8. The three options, and why the fold is refused

**(a) De-arm the two quotes.** Rewrite `docs/task/RFCT-210.md` and
`docs/task/RFCT-240.md` so the quote no longer sits against its citation, or so
it quotes something else. This edits two frozen records to accommodate the
change that made them untrue, which is precisely what the comment being deleted
exists to forbid — *"a record of what was true is not edited by the change that
makes it untrue"*, at `os/pkgs/mosd/apid/src/routes.rs:28-29`. It also cuts
against this repository's own decided precedent: *"One code line was written to
keep a record true."* (`docs/task/RFCT-242.md:511`). RFCT-242 chose to shape the
code around the record when the same question was put to it; reversing that for
a cosmetic tidy would be the campaign contradicting itself within one plan set.

**(b) Mark both documents as dated records.** A `<!-- dated-record: -->` marker
would exempt each file and the two failures would disappear. But the exemption
is document-scoped, not citation-scoped: the marker exempts the file from *both*
checks entirely. Measured with the gate's own citation extractor, run read-only
over the two files at this HEAD, the coverage that would buy silence is:

| Document | In-scope citations | Of which carry an armed quote | Cited into `routes.rs` |
|---|---|---|---|
| `docs/task/RFCT-210.md` | 114 | 58 | 43 |
| `docs/task/RFCT-240.md` | 24 | 24 | 11 |

That is 138 citations, 82 of them content-checked, dropped out of a 2170-strong
gate to permit an edit that changes no behaviour. The extractor was validated
against the gate's own per-document output before these numbers were used: it
reports 56 unquoted citations for RFCT-210 and 0 for RFCT-240, which is what
`docs/verify-citations.sh` prints in its summary for the same two files.

Marking a document dated is also not a free bookkeeping act. It is an assertion
that the document's citations name a tree that has moved on and should never be
re-anchored. Neither of these two is in that state today: all 138 of their
in-scope citations resolve, and all 82 armed ones content-check, green against
this HEAD -- that is what the 2170/2170 baseline in section 2 means for these
two files -- which is why they sit inside the gate rather than outside it.

**(c) Do not fold.** Costs nothing, falsifies nothing, and leaves the gate at
its measured 2170/2170. The comment already carries its own reason, so the two
split lines are self-documenting rather than mysterious.

**Ruled: (c).** Two lines of import formatting are not worth either falsifying a
record or spending 138 citations of gate coverage.

## 9. The unblock condition

Stated as a condition, and deliberately not as a plan.

> If `docs/task/RFCT-210.md` and `docs/task/RFCT-240.md` are ever marked as
> document-scoped dated records **for their own reasons** — because their
> citations have come to name a tree that has moved on, judged on those
> documents' own merits and not on this milestone's convenience — then the two
> class-B failures become exempt, and the fold becomes gate-legal as a side
> effect. A later cosmetic pass could then revisit it, re-measuring rather than
> trusting this record.

Nothing schedules that. A sweep of `docs/plan/*.md` at this HEAD finds no
milestone anywhere that proposes marking either document, and PLAN-028 — the
plan that owns the citation-gate backlog — puts *"retroactive edits to dated
records"* (`docs/plan/PLAN-028.md:84`) out of scope. This condition creates no
dependency on PLAN-028 or on anything else, and must not be read as queued work.
If it never becomes true, M6 stays closed as it is.

## 10. Where this record differs from the dispatch brief

The brief predicted each measurement so they could be reproduced rather than
relayed. Three results differ, and this section records them because the brief
asked for what was measured rather than for agreement.

1. **The cost of option (b) is much larger than stated.** The brief put it at
   "15 and 11 other live citations". Those two numbers are reproducible, but
   they are something else: 15 and 11 are the counts of failures each document
   produces *under the probe* — RFCT-210 twelve content plus three resolution,
   RFCT-240 eleven content. The coverage a dated-record marker actually spends
   is the document's whole in-scope citation count, 114 and 24. The correction
   strengthens the ruling rather than weakening it.
2. **PLAN-028's M2 is not deciding dated-record markers for a frozen-audit
   class.** The brief described it that way and named RFCT-210 as a candidate.
   Measured: M2 is *"The bare-continuation resolver."*
   (`docs/plan/PLAN-028.md:37-38`), and its only mention of the exemption is
   that it stays as it is — *"Dated-record exemptions keep their existing
   carve-out"* (`docs/plan/PLAN-028.md:43-44`). There is no candidate list of
   documents to mark; the phrase "candidate list" in that plan belongs to M1's
   ambiguity error, *"and FAILS with the candidate list"*
   (`docs/plan/PLAN-028.md:34`). So the condition in
   section 9 is a condition on a decision nobody has scheduled, which is how it
   is written there.
3. **The count of shift-class content failures.** The brief's split was 549
   ordinary shifts and 2 class B, which totals 551 against 549 measured content
   failures. The measured split is 547 shifts and 2 class B, summing to the 549
   the gate reports; the five resolution failures are a separate line in the
   gate's own summary and are also shift-caused.

Everything else the brief predicted reproduced exactly: the item at lines 25-32,
the 2170/2170 and 863/863 baselines, the 1 insertion / 8 deletions probe diff,
the 554 FAILED (5 resolution, 549 content, 0 census, 0 ratchet) with 1616
passing, the identity of the two class-B failures, the absence of a marker in
either file, and the falsity of the section 1.2 premise.

## 11. The code is deliberately unchanged, and this record arms no new quote

`os/pkgs/mosd/apid/src/routes.rs` is byte-identical to what this branch was cut
from: `git diff --stat c5f7e96 HEAD -- os/` is empty. M6 is closed, not deferred
and not partly done: the milestone's question was whether to fold, it was
measured, and the answer is no.

This record also deliberately declines to arm a quote of its own against the
line at issue. Its five citations into `os/pkgs/mosd/apid/src/routes.rs:25-32`
are for location only, and none of them has a quoted fragment placed directly
against it, so this document adds no third constraint on those lines. Section 12
records the ratchet row that decision costs. The unblock condition in
section 9 therefore names exactly two documents, and will still name exactly two
after this file is committed.

## 12. Gates

This milestone adds one document, one index line and one ratchet-baseline row,
and changes no Rust and no API surface. The Rust gate and the `oasdiff` run are
therefore not implicated — stated rather than omitted, so their absence is a
recorded judgement and not a gap. `os/pkgs/mosd/**` and
`os/pkgs/mosd/apid/openapi.json` are untouched by the committed diff, so neither
gate has an input that changed.

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | `2191/2191 PASS`, exit 0 |
| `bash docs/verify-index.sh` | `867/867 PASS`, exit 0 |

The citation count is the clean baseline of 2170 in section 2 plus the
twenty-one in-scope citations this document adds. All twenty-one resolve; the
sixteen that carry an armed quote were content-checked and passed. The index
count moves from 863 to 867 for the one new task file and its index line.

**The unquoted ratchet needed a row, and that is the second file this milestone
touches.** A new document has a ceiling of zero unquoted citations, so the first
run of this record failed the ratchet with twelve. Eight were armed with quotes
rather than waived -- they are the eight this document could quote without
consequence. The five that remain are all citations into
`os/pkgs/mosd/apid/src/routes.rs:25-32`, and arming any of them is exactly the
third constraint section 11 refuses to create: a quote armed against a line the
fold deletes is one more class-B failure standing in the fold's way. So the row
`docs/task/RFCT-252.md 5` was added to
`docs/verify-citations-unquoted-baseline.txt`, which is the override the gate
documents for this case -- *"when a new unquoted citation is genuinely wanted,
raising the row in the same commit is the explicit, reviewable override"*
(`docs/verify-citations.sh:149-151`). Two of the five are inside the verbatim
gate output quoted in section 5 and could not be armed in any case without
altering quoted output.
