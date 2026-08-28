# PLAN-028 Gate backlog: the citation forms the gate cannot see, and two misses the campaign measured

- **status**: approved
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
