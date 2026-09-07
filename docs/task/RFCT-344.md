# RFCT-344 Prune the settled plans out of docs/plan/

- **status**: completed
- **priority**: P2
- **owner**: bkd/t6ot9l4f
- **createdAt**: 2026-09-07 00:00

> The index line in `docs/task/index.md` is written by L1, not by this task.
> `scripts/task-state.sh claim` was deliberately not used: it edits the index
> under a lock, and this branch must not touch it.

## Description

`docs/plan/` held 44 plan files, 34 of them marked `[x]` in `docs/plan/index.md`.
The index had stopped being a view of live work and become an archive nobody
reads, which is what the request names.

Three things were said to block a plain delete: `docs/verify-links.sh` gating
inbound links, the index's own rule "Only update the checkbox marker; never
delete the line", and ~147 inbound `PLAN-NNN.md` citations across `docs/`.
Re-measured, the first is nearly vacuous, the second is contradicted by five
commits of this repository's own history, and the third counts something that
is not a link.

## ActiveForm

Pruning the settled plan records and rewriting the rule that forbade it

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- The prunable set derived from measurement, not from the brief's numbers.
- One recommendation, argued against the alternatives.
- No gated reference broken, and no live document left pointing at a deleted
  file.
- `make docs-verify` green -- all five gates -- from a `git archive` of this
  branch into an empty directory.
- The contradicted rule rewritten where it lives, with its reason.

## Notes

- **The blocking count is 5, not 147.** Across `docs/`, 119 Markdown links
  target a `PLAN-NNN.md`. 114 of them originate inside `docs/plan/` and
  `docs/task/`, which `verify-links.sh` does not scan -- and its header says
  why, in its own words: those trees are "PMA process tracking, records are
  deleted when they close". `verify-index.sh` excludes them with the same
  reasoning. Only **5** links reach a plan from a gated file: four in
  `docs/CHANGELOG.md` (PLAN-079, 081, 083, 084) and one in
  `docs/design/native-applications.md` (PLAN-069, open anyway). The exclusion
  in those two gates is not an oversight the prune has to work around; it is
  the seam that exists so pruning works.

- **A second gate nobody named.** `docs/verify-status.sh` requires every
  `> status: proposed` line to cite an *existing* `docs/plan/PLAN-NNN.md`.
  Three status lines cite plans; `docs/user/doc-contract.md:85` cites
  PLAN-051, which is completed. Deleting it fails that gate twice -- dead
  evidence ref, and `proposed` with no live plan. PLAN-051 is retained rather
  than repaired: the repair is rewriting a `proposed` claim about the product,
  which is a truth claim this task has no standing to make.

- **The prose citations were never links.** The shipped trees contain 239
  `PLAN-NNN` tokens and 5 links. 234 mentions -- "PLAN-070 §5.3 made
  `source.url` overridable" -- are already bare names that resolve to nothing
  and always did. Deleting the file does not degrade them; the convention that
  a plan citation in a design document is a name, not a hyperlink, is already
  in force in 98% of cases. This is the strongest argument for pruning over
  archiving: archiving would rewrite 119 link targets to preserve a property
  the tree does not have.

- **"Never delete the line" is inherited boilerplate, not a local decision.**
  It is verbatim from the PMA skill's `plan-format.md:135` (`task-format.md:144`
  carries the twin). This repository has contradicted it five times --
  `ab0e650c`, `32f6a453`, `7c78a89a`, `1b31a6c0`, `3a5e52c3` -- deleting the
  file *and* the index line each time. `1b31a6c0` states the actual norm:
  "Completed records leave the tree, as PLAN-001..029 did before them." The
  rule in `docs/plan/index.md` now says that, with the history that establishes
  it. The skill's own copy is upstream and was left alone.

- **The index lied about two live plans, which is the finding that changed the
  work.** Cross-checking every `[x]` against the file's own `status` head:
  **PLAN-080 says `implementing`** and **PLAN-085 says `draft`**. Both were
  marked `[x]`. Pruning on the marker alone -- the obvious implementation, and
  the one the brief's framing invites -- would have deleted two live designs,
  including the container-build design that is currently in flight. Markers
  corrected to `[-]` and `[ ]`. Two more heads are non-canonical synonyms
  (PLAN-045 `done`, PLAN-074 `implemented`) and were read as settled.

- **What was pruned: 25 of 44.** The rule is mechanical -- prunable iff the
  marker says `[x]` *and* the file's status head agrees *and* nothing outside
  `docs/plan/` links to it, then closed under linking so no retained plan is
  left dangling. That closure pulled in PLAN-074 (cited by the live PLAN-080)
  and PLAN-045 (cited by the open roadmap PLAN-037). 19 files remain: 10 open,
  9 settled-but-still-cited. `docs/plan/` is now a view of live work plus a
  named, shrinking tail.

- **"Delete only the plans nothing cites" covers zero plans** -- measured, not
  assumed. Every completed plan carries at least one inbound link, because
  `index.md` links to all of them. Discounting the index, the maximum inbound
  count is 4, not the 18 the brief attributed to PLAN-049, which has 2. That
  option was costed and discarded on its own numbers.

- **`docs/task/` measured, deliberately unchanged**: 79 records, 75 marked
  `[x]`. Its exposure is *lower* than `docs/plan/`'s -- **zero** gated files
  link to a task record, and no status line cites one, so the same prune would
  break nothing at all. It is left alone because the request named plans, and
  because a 75-record prune deserves its own decision rather than being carried
  in on the back of this one. The rule now in `docs/plan/index.md` transfers
  unchanged if that decision is taken.

- **Not done, and named rather than silently skipped**: the four
  `docs/CHANGELOG.md` links pin PLAN-079, 081, 083 and 084 in the tree. L1 owns
  that file. Converting those four to plain text -- the form 234 other
  citations already use -- releases all four in a one-line change per link.
  `docs/user/doc-contract.md:85` pins PLAN-051 behind a stale `proposed` claim.

- **Verification.** `make docs-verify` green from a `git archive` of this
  branch into an empty directory: `verify-index.sh` 60/60, `verify-links.sh`
  478/478, `verify-status.sh` 224/224, `zh/verify-coverage.sh` 40/40,
  `bsp/verify-board.sh` 84/84. Run from the archive, not the worktree, so the
  deleted files could not satisfy a link from disk.
