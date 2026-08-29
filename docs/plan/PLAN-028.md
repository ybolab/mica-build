# PLAN-028 Gate backlog: the citation forms the gate cannot see, and two misses the campaign measured

- **status**: completed
- **completedAt**: 2026-08-29 15:40
- **createdAt**: 2026-08-28 19:45
- **approvedAt**: 2026-08-28 19:45
- **relatedTask**: RFCT-256..259 reserved (M1..M4)
- **milestones**: M1 the no-slash citation form; M2 the bare-continuation resolver; M3 the plan-index status assertion; M4 the status-outruns-pinned-phase class (bounded investigation)

## Context

The campaign's citation and index gates were built by PLAN-020 and
tightened since, and their measured blind spots are on record rather than
suspected. Three are mechanical and closable; one is a class that only a
booted run can see and gets a bounded investigation, not a promise.

The measurements of record: the no-slash form (`routes.rs:2545` — matches
the token regex, dropped by the scope rule, silently unresolved; 393
corpus-wide after RFCT-215's structural fix took section 1's share to
zero). The bare form (`` `:NNN` `` — does not match the extractor at all;
RFCT-214 measured 56 of 56 such citations into routes.rs never-valid at
their pre-image). The plan-index miss: `docs/plan/index.md` held `[-]`
against a `completed` plan file with the index gate green (fixed by hand at
77a3278; the assertion gap remains). The phase class: a milestone that
changes a shipped status outruns any `test/apid-api` phase pinning the old
one, and only a booted run finds it.

## Proposal

- **M1 (RFCT-256) The no-slash form.** `verify-citations.sh` resolves
  citations whose path lacks a `/` by the same unique-basename rule people
  read them with: if exactly one in-scope file matches the basename, resolve
  and content-check against it; if several match, the citation is ambiguous
  and FAILS with the candidate list — ambiguity is an error to fix in the
  document, not a waiver. Existing violations are corrected or made
  full-form rather than baselined, section by section, with per-segment
  counts; the census floors move to the measured result.
- **M2 (RFCT-257) The bare-continuation resolver.** Bare `` `:NNN` ``
  citations inherit the nearest preceding full citation's path on the same
  line (the same-line inheritance rule RFCT-214 reconciled), resolve and
  content-check under it. Earlier-line inheritance stays out — RFCT-214
  measured that class as shorthand, not continuation, and M1's basename
  rule is the reader-faithful resolution for those. Dated-record exemptions
  keep their existing carve-out: a frozen audit's numbers are the
  measurement, never re-anchored (the RFCT-210 lesson).
- **M3 (RFCT-258) The plan-index assertion.** `verify-index.sh` asserts
  `docs/plan/index.md` checkboxes against each plan file's `status:` line
  with the same mapping it already enforces for task files (`[x]`
  completed/withdrawn-closed, `[-]` approved/implementing, `[ ]` draft).
  The legacy rows (PLAN-006/007/008/010) are asserted as they stand —
  the gate encodes consistency, not history rewriting; if any row is
  inconsistent today the fix is a one-character index edit with the plan
  file untouched.
- **M4 (RFCT-259) The status-outruns-pinned-phase class, bounded.**
  Investigate, then implement only what is mechanical without a boot: an
  inventory of `test/apid-api` phase assertions that pin wire-visible
  values also stated in `openapi.json` or the settings schema, and a check
  that those pinned values agree with the committed spec at build time.
  What cannot be checked without a boot is written down as the class's
  residue with one worked example, and the milestone closes bounded — the
  deliverable is the mechanical slice plus an honest boundary, not a
  simulation of coverage.

## Risks

- M1 turns silence into failures across 393 sites; the milestone fixes or
  full-forms them section by section and must not land a red gate on its
  own branch — the ratchet only tightens on green.
- M2's inheritance rule can mis-bind on pathological lines; the resolver
  fails closed (unresolvable is an error listing the line) rather than
  guessing a path.
- M3 may surface legacy inconsistencies beyond the known four rows; each
  is a one-character index fix, never a plan-file rewrite.
- The self-test fixtures (`docs/verify-citations-selftest/`, if present)
  and baselines must move in the same commit as the extractor change, or
  the gate breaks on its own upgrade.

## Scope

- **In**: `docs/verify-citations.sh`, `docs/verify-index.sh`, their
  baselines and self-tests, the documents whose no-slash/bare citations
  get corrected, `test/apid-api` only for M4's build-time check.
- **Out**: PLAN-026/027 scopes, any relaxation of an existing assertion,
  retroactive edits to dated records, booted-run tooling.

## Correction (2026-08-28, at dispatch)

M2's rule as written — "unresolvable inheritance [is an] ERROR" — was measured
against the corpus by the executing workstream and found to force dated-record
markers onto all six frozen audit documents at once (~222 os/ citations leaving
live coverage to freeze 149 historical bare tokens), defeating the lazy-marking
rule entirely. Ruled: a bare token with NO same-line antecedent is a COUNTED
SKIP UNDER A NO-GROW RATCHET — baselined per document like the existing
unquoted ratchet, so any NEW no-antecedent bare token fails while the
historical ones stay visible, counted and reasoned, and the frozen audits'
still-valid citations remain under live coverage. Ambiguity under M1's basename
rule stays an error. Net effect: three markers campaign-wide (RFCT-215 and
RFCT-169 forced by M1's ambiguity rule; RFCT-210 forced independently in
PLAN-027 by a content deletion, marker arriving from that branch) instead of
six. RFCT-257 records both readings, their measured costs, and this ruling.

## Close (2026-08-29)

Three of four milestones landed and merged (bkd/tcdocsrm). M1 RFCT-256 resolved
the no-slash citation form against the tracked file set and armed ambiguity as
an error, moving 226 bare filenames from skipped into scope. M3 RFCT-258 taught
`docs/verify-index.sh` to assert `docs/plan/index.md` checkboxes against plan
status. M4 RFCT-259 bounded the status-outruns-pinned-phase class.

M2 (RFCT-257, the bare-continuation resolver) is designed, argued and recorded
but NOT implemented; its row stays `[-]`. The record carries the antecedent
rules, the counted-skip ruling under a no-grow ratchet, and the worked cases.

What the plan measured along the way, kept because it outlives the milestones:
the arming argument now has a denominator - of 56 moved citations in one
single-sided edit the gate caught 33, every one armed, and 0 of the other 23,
every one unarmed, with the run green throughout. The near-miss counter was
found to BE the intended-arming-that-failed set rather than an approximation of
it, complete and printed on every run: 333 in-scope citations on main before
this plan, 495 on the merged tree once M1's rule brought bare filenames into
scope. Both numbers are worklists, not defects introduced here.

Filed onward: RFCT-261, `docs/plan/` is half-read - M3 made its index assertable
while its citations remain outside `docs/verify-citations.sh`'s scope entirely,
with the entry cost measured at 27 in-scope citations of which zero are armed.