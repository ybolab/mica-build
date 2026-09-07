# RFCT-344 Delete the completed plan and task records, and remove the rule that forbade it

- **status**: completed
- **priority**: P2
- **owner**: bkd/t6ot9l4f
- **createdAt**: 2026-09-07 00:00

> The index line in `docs/task/index.md` is written by L1, not by this task.
> The `scripts/task-state.sh claim` step that recent records cite does not
> exist in this tree -- there is no `scripts/` directory. Seven records and
> `docs/task/index.md` describe it as if it did; see the note below.

## Description

`docs/plan/` held 44 plan files and `docs/task/` 79 records; 34 and 75 of them
respectively were marked `[x]`. Both indexes had stopped being a view of live
work. The user ruled: delete the completed records in both directories, delete
their index lines, and remove the rule in each index that said records could
not go -- it misleads now that they do.

This record was opened for the plans alone and extended to the tasks. An
earlier revision recommended retaining nine settled plans that were still
cited; the ruling withdrew that, and they are deleted here with their citations
converted to plain text.

## ActiveForm

Deleting the completed plan and task records and rewriting the rule that
forbade it

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- Every completed plan and task record deleted, with its index line.
- The "never delete the line" rule removed from both indexes and replaced with
  what is now true.
- Every surviving citation to a deleted record kept as text, never as a link,
  and no sentence removed.
- Records still in flight kept, whatever the index marker said.
- `make docs-verify` green -- all five gates -- from a `git archive` of this
  branch into an empty directory.
- Reasons that became unreachable named in this record as a handover.

## Notes

- **What was deleted: 32 plans and 70 task records.** `docs/plan/` 44 -> 12,
  `docs/task/` 80 -> 10. Index rows went with the files, in both directories.
  The deletion set is mechanical: the index row says `[x]` **and** the record's
  own `status` head agrees. That second condition is not redundant -- see below.

- **The indexes were lying about seven live records, which is the finding that
  most changed the work.** Cross-checking every `[x]` against the record's own
  `status` head: PLAN-080 said `implementing`, PLAN-085 said `draft`, and
  RFCT-305 (`in_progress`), RFCT-310 (`implementing`), RFCT-315 (`in-progress`),
  RFCT-335 (`in_progress`) and UI-011 (`pending`) were all marked `[x]` too.
  Deleting on the marker alone -- the obvious implementation -- would have
  destroyed seven records of unfinished work, including the in-flight
  container-build design. All seven are retained and their markers corrected
  to `[-]` or `[ ]`. Both indexes now say the record wins.

- **Why nothing enforced that.** `docs/task/index.md` described a
  `scripts/task-state.sh` serializer that "updates the record and index under
  one lock and rejects a transition when their current states do not match".
  There is no `scripts/` directory in this tree; the script does not exist.
  Neither does any gate cover the agreement -- `verify-index.sh` and
  `verify-links.sh` both exclude `docs/plan/` and `docs/task/` by design. The
  paragraph now says so instead of describing a serializer nobody runs.

- **The rule, in both indexes.** `docs/plan/index.md:24` and
  `docs/task/index.md:32` both carried "Only update the checkbox marker; never
  delete the line", inherited verbatim from the PMA skill's `plan-format.md`
  and `task-format.md`. Five prune commits (`ab0e650c`, `32f6a453`, `7c78a89a`,
  `1b31a6c0`, `3a5e52c3`) had already contradicted it; `1b31a6c0` states the
  norm outright -- "Completed records leave the tree, as PLAN-001..029 did
  before them". Removed rather than reworded, and replaced with what is true:
  the record is deleted, its line goes with it, git history is the archive, and
  `git log --diff-filter=D` plus `git show <commit>^:<path>` gets one back.

- **The citation sweep: 12 links converted, and the sequencing mattered.**
  L1's ordering was right -- the deletions removed most of the work. 91 links
  dangled after the two deletions, but 79 of them were index rows deleted in
  the same pass. The 12 real ones became plain text, name kept, link gone:
  `docs/CHANGELOG.md` 4 (PLAN-079/081/083/084 in `See PLAN-084.` sentences),
  `docs/plan/PLAN-037.md` 4 distinct targets across 6 occurrences (the open
  roadmap's rows for PLAN-045 and PLAN-051), `docs/plan/PLAN-078.md` 1
  (RFCT-308), `docs/plan/PLAN-080.md` 1 (PLAN-074). No sentence was removed.
  The two format specimens -- `PLAN-001.md` and `PREFIX-001.md` -- are
  deliberately absent targets teaching the row format and were left alone.

- **A gate asserted a teaching example, and had to be fixed rather than fed.**
  `docs/verify-status.sh` requires `> status: proposed` to cite an existing
  plan. Four such lines live inside a fenced block in
  `docs/user/doc-contract.md` -- the GRAMMAR SPECIMEN showing what the four
  statuses look like -- and one of them illustrated `proposed` with PLAN-051.
  Deleting PLAN-051 turned the gate red on an example, not on a claim. Feeding
  it a live plan only re-arms the trap at the next prune, so the gate now
  tracks fences and skips status lines inside them. This is the principle
  `verify-links.sh` already states in its own header for the two index
  specimens: "a gate that fails on an example teaching the format would be
  reporting prose as a defect." Measured first: exactly 4 of 207 status lines
  are inside fences, all four in that one block, so 203 real claims are
  unaffected. The specimen itself now names PLAN-054, which is open.

- **The patched gate still bites**, proved by three mutations, each red with
  its own message: a real `shipped` line citing a dead path (1 FAILED, 724
  passed); an unparseable status head (1 FAILED, 723); and `proposed` citing
  evidence that is not a plan -- the exact rule that broke -- (1 FAILED, 725).
  `make docs-verify-test` stays 9/9.

- **What is now unreachable, named as a handover rather than an objection.**
  33 distinct record names are still cited in the shipped trees with no record
  behind them. The heaviest are **PLAN-063** (13 mentions), **PLAN-049** (13),
  **PLAN-061** (11) and **PLAN-048** (5) -- storage, the `/mos` namespace and
  the DATA layout, which are cited in `docs/design/storage.md` as the reason a
  contract has its shape ("the quota behind `maxBytes` stays PLAN-049's"). The
  sentences remain and still name the decision; what is gone is the argument
  behind it, recoverable only from git. If any of those reasons deserve to live
  in the design documents themselves, that is a follow-up worth doing while the
  history is still fresh -- the design doc is where a reason belongs anyway,
  and a plan was never a durable home for one.

- **Two dead bare paths remain, both deliberate**: `docs/CHANGELOG.md:762`
  narrates a past bug in which the wrong document was shown and quotes
  `docs/task/RFCT-210.md` as part of that history (RFCT-210 was pruned long
  before this task), and `docs/task/RFCT-344.md` quotes a gate failure message
  verbatim as evidence. Both are quotations of a past state, not pointers.

- **`docs/CHANGELOG.md`, normally L1's, was edited** under the ruling's explicit
  permission, and only to de-link: four `[PLAN-NNN](plan/PLAN-NNN.md)` became
  `PLAN-NNN`. No entry, heading, date or claim was touched.

- **Consequence, stated rather than discovered.** Between the two directories
  102 records left the tree. `docs/plan/` and `docs/task/` now hold only open
  work -- which is the point -- but they have stopped being a history of what
  was done and are now a list of what is left. Both indexes say so in the rule
  that replaced the old one, and both name git history as the archive.

- **Verification.** `make docs-verify` green from a `git archive` of this
  branch into an empty directory: `verify-index.sh` 189/189, `verify-links.sh`
  469/469, `verify-status.sh` 723/723, `zh/verify-coverage.sh` 237/237,
  `bsp/verify-board.sh` 97/97. Run from the archive, not the worktree, so a
  deleted record could not satisfy a link from disk. `make docs-verify-test`
  9/9.
