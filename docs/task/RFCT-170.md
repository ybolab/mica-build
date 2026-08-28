# RFCT-170 PLAN-020 M1: the citation checker arms both orders, counts its demotions, and holds a census

- **status**: completed — all four M1 behaviours landed, both checkers and both self-tests green
- **priority**: P2
- **owner**: bkd/qw0msnp2
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-020 (M1)

PLAN-020 M1. Four upgrades to `docs/verify-citations.sh`, closing the plan's
measured silent spaces 6, 4, 7 and part of 8, each with a worked example behind
it: the citation-before-quote ordering that never armed (RFCT-163), the one
interposed word that silently demoted a content check (RFCT-155), the vanishing
first path segment that dropped six citations from scope under a green run
(RFCT-167), and the count-is-not-sufficient lesson (RFCT-169).

## What changed

| file | change |
| --- | --- |
| `docs/verify-citations.sh` | forward quote arming, near-miss counter, per-segment census with committed floors, per-document no-quote census |
| `docs/verify-citations-baseline.txt` | new, committed: the census floors, `docs 92` and `os 810` |
| `docs/verify-citations-test.sh` | fixture gains a quote-after-citation pair and a census baseline; five new cases; two rewritten controls |
| `docs/task/RFCT-170.md`, `docs/task/index.md` | this record and its row |

`Makefile` and `.github/workflows/check.yml` are untouched: the baseline file
is read by the checker itself, relative to the repo root it already resolves,
so the existing `docs-verify-citations` target and CI step run the new
behaviour with no wiring.

## 1. Order-independent content check (space 6)

A quoted fragment now arms check 2 when it directly FOLLOWS the citation as
well as when it precedes it, under the mirrored adjacency: whitespace, `*` and
`_`, an optional closing parenthesis, no blank line, same paragraph. A chained
`path:line` token is still not a quote in either direction, and the backward
case is byte-for-byte the original code and wins when both sides carry a
fragment, so every pairing the old rule made is preserved.

Measured effect on the corpus: exactly ONE citation moves from unquoted to
quoted (355 -> 356), and it is precisely RFCT-163's worked example —
`docs/design/uboot-ab-handshake.md:210` quoting `console=ttyFIQ0,1500000`
directly after citing `os/boards/cx3576/board.env:349`. RFCT-163 fixed that
fragment by hand and recorded that the gate could not see it; the gate now
checks it on every run, and it passes.

## 2. Interposed words: N stays 0, and the demotion is counted (space 4)

Decided with evidence, as the plan requires. The corpus was probed with a
throwaway script before the rule was chosen: for every in-scope citation with
no strictly-adjacent quote, a quoted span 1, 2 or 3 whitespace-delimited words
away (either direction, same paragraph) was collected — **281 candidate
pairs**, 136/64/28 of them at one, two and three words of prose plus 53
separated by punctuation runs alone (the committed awk near-miss counter,
which counts citations rather than pairs and counts a punctuation run as a
word, reads 234).

The candidates are irreducibly mixed at every N, including N=1, and the
single-token class is itself dominated by coincidence: the commonest
separators are a bare comma (52 pairs) and a table `|` (14) against 12 for
the genuinely quoting "at".

- genuine quote-citation pairs: `` `axum = "0.8"` at `os/pkgs/mosd/Cargo.toml:54` ``,
  RFCT-155's own `` "/api/v1/settings/" around `api.md:1251` `` at
  `docs/design/bus.md:409`;
- prose coincidences: adjacent table cells separated by `|` (the reconciler
  dispatch table in `api.md:624-630` alone contributes over a dozen),
  appositions across a comma where the span NAMES the cited thing rather
  than quotes it (`` the `ApiSession` extractor (`routes.rs:586-608`) ``).

Separating those classes needs a word allowlist ("at", "->", ...), which would
rot silently — the exact failure mode this plan exists to close. So **N=0
stands**: one interposed word still demotes the pair to resolution-only. The
demoted class is no longer silent: the summary counts it as
`near-miss: no quote armed, but a quoted span sits 1-3 words away: 234`, and
the self-test proves the boundary — a wrong quote one word from its citation
keeps the run green but is counted, at one and at three words, while four
words no longer count.

## 3. Per-first-segment census with committed floors (spaces 7, 8-partial)

The summary now reports the in-scope count per first path segment
(`in scope, first segment docs/: 92`, `... os/: 810`), and
`docs/verify-citations-baseline.txt` commits a floor per segment. A segment
named there FAILS the run — a new `census` failure class, distinct from
resolution and content in both the FAIL line and the exit summary — when its
count reaches zero or drops below its floor. Growth never fails. This is the
mechanical catch for RFCT-167's class: deleting the cited tree's root
directory reclassifies its citations as skipped-outside, and the old checker
printed a smaller `N/N PASS` with rc=0. Floors are set to the measured counts
(exact, not slack), so any drop forces a baseline edit in the same commit —
the diff shows the decision, per the update procedure documented in the
checker header and in the baseline file itself. A missing baseline file is a
hard error, not an empty set of floors.

## 4. Unquoted-citation lint (class 1 policy, census only)

One stable line per scanned document:
`no quote, by document: <doc> <count>`, printed for every document including
zeros. No threshold in M1; RFCT-173/M4 records the numbers as a ratchet. The
figures at this commit, total 546 of 902 in scope:

| document | unquoted |
| --- | --- |
| `docs/design/api.md` | 439 |
| `docs/design/dashboard.md` | 83 |
| `docs/design/uboot-ab-handshake.md` | 12 |
| `docs/design/bus.md` | 5 |
| `docs/design/remote-management.md` | 5 |
| `docs/design/boards.md` | 2 |
| the other ten documents | 0 |

## 5. Negative tests

`docs/verify-citations-test.sh` goes 16 -> 21 cases. Per the file's
discipline, every failing case must fail with its own message and an extra
assertion firing is itself a failure.

- **(a)** a misquote that FOLLOWS its citation fails with the content message
  (case 16), and the chained-citation exclusion holds in the forward direction
  (case 17: `` `a:5` `a:6` `` stays a chain, 6/6 green);
- **(b)** the boundary of the N=0 decision: one interposed word leaves a WRONG
  quote green — the demotion is real — while the near-miss counter reads
  exactly 2 across paragraphs at one, three and four words (case 18);
- **(c)** deleting the fixture's `mosd/` root fails the census with the
  zero-count message; removing one citation while the floor stands fails with
  the below-floor message (cases 19, 20);
- **(d)** the per-document no-quote lines are asserted exactly, count
  included, in the report case and again at 3 in the chained case.

The positive controls were extended rather than duplicated: the baseline
fixture now carries a quote-after-citation pair that must PASS, and the
reflow control rewraps and bolds that forward quote too, proving the
normalisation applies in both orders.

## Measurements

| gate | before | after |
| --- | --- | --- |
| `docs/verify-citations.sh` | 902/902 | 902/902 |
| — carrying a quote | 355 | 356 |
| — resolution checked only | 547 | 546 |
| — skipped (outside / bare / host-port) | 50 / 168 / 4 | 50 / 168 / 4 |
| — near-miss | not measured | 234 |
| — census failures | no such class | 0 |
| `docs/verify-index.sh` | 525/525 | 528/528 |
| `docs/verify-citations-test.sh` | 16/16 | 21/21 |
| `docs/verify-index-test.sh` | 8/8 | 8/8 |

The index gate rises by 3: the three loops (forward, reverse, duplicate-row)
over this record. All four commands run green in sequence on this branch:
`bash docs/verify-citations.sh && bash docs/verify-index.sh &&
bash docs/verify-citations-test.sh && bash docs/verify-index-test.sh` -> rc 0.

## Out of scope, deliberately

Scope stays `docs/design/*.md` plus `docs/architecture.md`; widening to
`docs/task` and `docs/research` is RFCT-172. The 234 near-misses and the 546
unquoted citations are surfaced, not repaired — repairing them is content work
for the documents' own workstreams, and the ratchet that will hold the
unquoted number down is RFCT-173's.
