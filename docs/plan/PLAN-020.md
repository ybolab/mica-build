# PLAN-020 Gate hardening: close the eight measured silent spaces

- **status**: completed
- **createdAt**: 2026-08-27 17:05
- **approvedAt**: 2026-08-27 17:05
- **completedAt**: 2026-08-27
- **relatedTask**: RFCT-170..179 reserved
- **milestones**: M1 citation-checker upgrades; M2 index-checker upgrades; M3 scope widening; M4 self-test repoint (P4) and closeout

## Context

Three campaigns measured eight ways the two documentation gates read green
over defects. Each has a worked example in a task record:

1. Resolves-but-wrong: an unquoted citation landing on the wrong line
   (RFCT-128; api.md:3864 -> boards.md:91 case).
2. Checkbox-vs-status: docs/task/index.md markers are never compared with the
   files' status fields; vocabulary is split (done/completed/Completed)
   (RFCT-144).
3. Filename-only index: docs/README.md descriptions and index row titles can
   lie (the connd bullet, RFCT-159 finding d).
4. One interposed word between citation and quote demotes content checking
   ("around", RFCT-155's bus.md case).
5. docs/task and docs/research path:line citations are scanned by no gate
   (77 stale, RFCT-159 finding a; needs the live-vs-dated split first —
   13 dated records must never be "fixed").
6. Citation-before-quote ordering never arms the content check
   (uboot-ab-handshake.md:210 misquote, RFCT-163).
7. A vanishing top-level first segment silently drops citations from scope;
   only the in-scope count catches it (RFCT-167's six).
8. The count is necessary, not sufficient: unquoted citations into a file
   whose interior shifted pass while naming the wrong lines (RFCT-169's
   902/0/4/11 experiment).

## Proposal

- **M1 (RFCT-170)** verify-citations.sh: arm content checks regardless of
  quote/citation order (6); tolerate up to N interposed words or document the
  limit precisely (4); report a per-first-segment census and fail on any
  segment count dropping without an explicit allowlist entry (7, 8 partial);
  new negative-test cases for each.
- **M2 (RFCT-171)** verify-index.sh: compare each index checkbox with its
  file's status field after first unifying the status vocabulary tree-wide
  (2); assert docs/README.md description bullets against a front-matter or
  first-heading contract, or document why not (3).
- **M3 (RFCT-172)** scope: extend citation scanning to docs/task and
  docs/research with a dated-record exemption mechanism (front-matter flag or
  path list) so the 13 historical worklists stay untouched (5); classify the
  ~64 live ones and repair them under the new gate.
- **M4 (RFCT-173)** the checker self-test fixture repoint (deferred P4, now
  safe: gates trusted and the tree stable), plus closeout. Class 1 (unquoted
  resolves-but-wrong) is recorded as NOT mechanisable without quotes — the
  fix is policy: M1 adds a lint counting unquoted citations per document and
  the closeout records the number as a ratchet.

## Scope

- **In**: docs/verify-citations.sh, docs/verify-index.sh, both self-tests,
  Makefile docs-* targets, .github/workflows check steps for them, the
  status-vocabulary sweep across docs/task front matter, the live docs/task
  citation repairs under M3.
- **Out**: mosd/apid source, os/** builds, docs/design content beyond what
  M3's repairs require, dated records per the exemption.

## Risks

- The gates gate themselves: every milestone must keep both checkers green on
  the merged tree, running old and new binaries side by side during
  transition.
- M3's live-vs-dated split is judgement; the exemption mechanism must make
  "left alone" evidenced, not silent (the PLAN-018 Amendment-1 pattern).
