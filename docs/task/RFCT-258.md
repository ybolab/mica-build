# RFCT-258 PLAN-028 M3: the plan-index status assertion

- **status**: completed — `docs/verify-index.sh` grew a fourth section asserting `docs/plan/index.md` against the 28 plan files in both directions; the index gate went 863/863 → 979/979 (987/987 re-measured on the merged tree at 41ae539) with ZERO index edits, because the corpus was already consistent under a mapping wider than the one PLAN-028 proposed; the self-test was RED at the base commit for an unrelated reason and was repaired first
- **priority**: P1
- **owner**: bkd/z2jshmso
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-028 (M3)

`docs/verify-index.sh` asserted three index↔tree pairs and did not read
`docs/plan` at all. The defect on record: `docs/plan/index.md` held `[-]`
against a plan file whose status line said `completed`, and the gate was green
over it until someone caught it by hand (fixed at 77a3278). A plan's checkbox
and its file's status line are two independent records of one fact, and
nothing compared them.

Every number below was measured at this branch's HEAD. Where PLAN-028 or the
dispatch stated a number, the number was taken again, and two of them differ.

## 1. What PLAN-028 predicted, and what the tree says

PLAN-028's Proposal for M3 says the assertion uses "the same mapping it
already enforces for task files (`[x]` completed/withdrawn-closed, `[-]`
approved/implementing, `[ ]` draft)", and that "the legacy rows
(PLAN-006/007/008/010) are asserted as they stand … if any row is inconsistent
today the fix is a one-character index edit with the plan file untouched".

**Both halves of that are wrong, and in opposite directions.**

The mapping does not cover the corpus. It names three markers; the index
declares four, and the fourth (`[~]` Rejected / Abandoned) is in live use by
PLAN-005. It names four heads; the tree uses eight, two of which
(`partially implemented`, `completed by supersession`) sit outside the
proposed vocabulary entirely. Had the proposed mapping been implemented
literally, it would have failed closed on three of the four rows PLAN-028
singled out as the ones to watch.

And there were no inconsistent rows to fix. 28 plan files, 28 rows, no
missing row, no duplicate row, and under a mapping that covers the heads
actually present, **every row already agreed with its file**. The milestone's
deliverable was never "find and fix inconsistent rows"; it was to build the
assertion and derive its vocabulary honestly. `docs/plan/index.md`'s row lines
are byte-identical before and after this task.

One further correction to the dispatch's measurement: it recorded
`completed` as the head of 21 files. It is **19**. The other nine are the
eight non-`completed` heads plus PLAN-013's `completed by supersession`, which
is a distinct head and is counted as such below.

## 2. The 28 rows, re-measured

Head is the status line's `- **status**: ` value with the free detail, any
trailing parenthetical and any trailing date stripped (section 4). "Want" is
the marker the mapping in section 3 derives from that head.

| Plan | Index marker | Status head | Want | |
|---|---|---|---|---|
| PLAN-001 | `[x]` | `completed` | `[x]` | OK |
| PLAN-002 | `[x]` | `completed` | `[x]` | OK |
| PLAN-003 | `[x]` | `completed` | `[x]` | OK |
| PLAN-004 | `[x]` | `completed` | `[x]` | OK |
| PLAN-005 | `[~]` | `rejected` | `[~]` | OK |
| PLAN-006 | `[-]` | `partially implemented` | `[-]` | OK |
| PLAN-007 | `[-]` | `implementing` | `[-]` | OK |
| PLAN-010 | `[-]` | `in progress` | `[-]` | OK |
| PLAN-008 | `[ ]` | `draft` | `[ ]` | OK |
| PLAN-009 | `[x]` | `completed` | `[x]` | OK |
| PLAN-011 | `[x]` | `completed` | `[x]` | OK |
| PLAN-012 | `[x]` | `completed` | `[x]` | OK |
| PLAN-013 | `[x]` | `completed by supersession` | `[x]` | OK |
| PLAN-014 | `[x]` | `completed` | `[x]` | OK |
| PLAN-015 | `[x]` | `completed` | `[x]` | OK |
| PLAN-016 | `[x]` | `completed` | `[x]` | OK |
| PLAN-017 | `[x]` | `completed` | `[x]` | OK |
| PLAN-018 | `[x]` | `completed` | `[x]` | OK |
| PLAN-019 | `[x]` | `completed` | `[x]` | OK |
| PLAN-020 | `[x]` | `completed` | `[x]` | OK |
| PLAN-021 | `[x]` | `completed` | `[x]` | OK |
| PLAN-022 | `[x]` | `completed` | `[x]` | OK |
| PLAN-023 | `[x]` | `completed` | `[x]` | OK |
| PLAN-024 | `[x]` | `completed` | `[x]` | OK |
| PLAN-025 | `[x]` | `completed` | `[x]` | OK |
| PLAN-026 | `[-]` | `approved` | `[-]` | OK |
| PLAN-027 | `[-]` | `approved` | `[-]` | OK |
| PLAN-028 | `[-]` | `approved` | `[-]` | OK |

Rows are listed in index order, which is not numeric order: PLAN-010's row
precedes PLAN-008's, as it has since they were added. That ordering is not
asserted (section 6).

Head census: `completed` 19, `approved` 3, and one each of `rejected`,
`partially implemented`, `implementing`, `in progress`, `draft`,
`completed by supersession`. 28 total, 0 mismatches, 0 duplicates, 0 rows
without a file, 0 files without a row.

## 3. The mapping, and where each entry's authority comes from

| Head | Marker | Authority |
|---|---|---|
| `draft` | `[ ]` | the index's own table: "Draft / Pending review" |
| `approved` | `[-]` | the table: "Approved / Implementing" |
| `implementing` | `[-]` | the table: "Approved / Implementing" |
| `in progress` | `[-]` | PLAN-010's wording for Implementing; no separate marker exists |
| `partially implemented` | `[-]` | PLAN-006: work begun and not finished — Implementing, and emphatically not Completed |
| `completed` | `[x]` | the table: "Completed" |
| `completed by supersession` | `[x]` | PLAN-013: goals delivered by later campaigns; Completed, reached by a different route |
| `rejected` | `[~]` | the table: "Rejected / Abandoned" |

Five heads are the table's own words. Three are not, so their reading is
stated rather than assumed — that is the whole of the judgement in this
milestone, and it is written down here and in the script's header rather than
left implicit in a `case` arm.

The four markers are exactly the four `docs/plan/index.md` declares in its own
Status Markers table. Nothing was added to that set; `[~]`, which PLAN-028's
proposed mapping omitted, is asserted because the index declares it and
PLAN-005 uses it.

**The mapping was also written back into the index.** The Status Markers table
now carries a third "Plan status heads" column, exactly as
`docs/task/index.md`'s table has carried a "Record status head" column since
RFCT-171. A plan author should be able to read the legal heads where they read
the markers, not by opening a shell script. The column adds no lines, so the
row line numbers that `docs/task/RFCT-221.md`, `docs/task/RFCT-222.md` and
`docs/plan/PLAN-014.md` cite into the plan index are undisturbed.

## 4. The two parsing traps

**The format example is row-shaped.** Inside the Usage section the plan index
carries `- [ ] [**PLAN-001 Short plan title**](PLAN-001.md)`
(`docs/plan/index.md:11`), followed by a backticked `YYYY-MM-DD`. That is a
real `[ ]` marker and a real `(PLAN-001.md)` link. The idiom section 3 of the
script uses for task rows — `grep -oE '\(RFCT-[^)]+\.md\)'` over the whole file
— reads it as a row, and the cost is two false failures: PLAN-001 counted
twice, and `[ ]` compared against PLAN-001.md's `completed`.

Rows are therefore read from the `## Plans` section only, and **by section,
not by string-matching the placeholder title or the literal `YYYY-MM-DD`**.
The example is documentation and is free to be rewritten; an editor who dates
it `2026-01-01` for realism must not thereby turn it into a row. That is a
self-test case rather than an assertion of good intent: `plan-format-example-is-not-a-row`
dates the example and requires a clean pass. Deleting the `## Plans` anchor
from the row parser and re-running that case was measured to produce exactly
the two failures named above and drop the self-test to 17/18, so the anchor is
load-bearing and demonstrably so.

The line that opens the Plans section, `**Name collision, deliberate.**`
(`docs/plan/index.md:32`), is a prose note mentioning PLAN-003. It is excluded
by the same section boundary and, carrying no link, by the row shape too.

**The head is buried in a tail.** Three decorations appear on plan status
lines, each of which a naive read gets wrong, and all three are stripped in
this order before the remainder is compared:

1. ` — <free detail>` (U+2014, the same separator `docs/task/index.md`
   documents). Five plan files carry one; PLAN-011's runs to several clauses.
2. a trailing parenthetical — PLAN-005 is `rejected (superseded by PLAN-006)`.
3. a trailing date — PLAN-013 is
   `completed by supersession 2026-08-28 — never approved and never executed…`,
   whose head is a **phrase followed by a date**, not one word.

A single "strip after the em dash" rule, which is all the task section needs,
gets PLAN-005 and PLAN-013 wrong.

## 5. Fail closed, both sides

An unknown status head and an unknown checkbox marker are both errors naming
the file and the offending value. There is no default and no silent pass. A
head the list does not carry means the tree has grown a status nobody decided
how to index, and the resolution is to decide it in the open — in the script
and in the index's table together — not to let the gate guess. Both directions
are driven by self-test cases (`plan-unknown-head` mutates a head to
`withdrawn`; `plan-unknown-marker` rewrites `[x]` to `[X]`, which reads as a
tick to a human and is not one of the declared four).

When a row and a file disagree, **the index is what moves**. The fix is the
one-character marker edit. Editing a plan file's status to satisfy the gate
would be rewriting the record to please the check.

## 6. What the assertion deliberately does not check

- **Row title against the plan file's H1.** Independently written prose, the
  same class as the README description bullets the script's header already
  refuses for stated reasons.
- **The `PLAN-NNN` in a row's bold title against the `PLAN-NNN` in its link.**
  A row could read `[**PLAN-020 …**](PLAN-021.md)`; membership and status are
  both asserted through the link, so such a row is not silent, but the
  disagreement itself is not named.
- **The trailing date against anything in the plan file.** Plan files carry
  `createdAt` and `approvedAt`; which of them the index date is meant to be is
  not written down anywhere, so there is no contract to assert.
- **Row order.** PLAN-010 precedes PLAN-008 in the index and that is the
  committed history of when they were added; the index's own Rules say new
  plans append to the end, which numeric order would contradict.
- **Milestone checkboxes inside plan files.** Out of scope for an index gate.

## 7. A red gate at the base commit, unrelated to this milestone

`bash docs/verify-index-test.sh` was already failing at c5f7e96, before any
change here:

```
error: no pending RFCT-094 row in the fixture index to tick
```

exit 1, and NO `RESULT:` line. The three checkbox-vs-status cases were written
against RFCT-094 by name; RFCT-094 was completed at e33ef7b and its row went
`[ ]` → `[x]`, so from that commit the guard fired and `exit 1` ran.

It aborts PARTWAY, not before everything, and the distinction matters to
anyone reading this later. Measured by extracting the c5f7e96 tree and running
it: 8 of the 11 cases run and pass first — the positive control (`863/863`)
and cases 1 through 5c — and the run dies at the case-6 guard. What was dead
is the three checkbox-vs-status cases, which never executed, plus the verdict
line and the case count, which were never printed. So the assertions covered
by the first 8 cases were still being exercised; the RFCT-171 checkbox
assertions were not, and no automated reading of this gate's output could
report a total. The gate was not reporting *nothing* — it was reporting
partial results under a non-zero exit, which is a worse failure mode than
silence because the passing lines above the abort look like a healthy run.

Naming a record couples a test of the **assertion** to the lifecycle of one
task, and every open task eventually closes. The exemplar is now discovered
from the fixture — the property the cases need is "some row is still `[ ]`",
read the same way case 4 already reads its research entry. Each mutation still
verifies that it landed, and a tree with no pending row at all is still
reported loudly rather than skipped. This landed in its own commit, ahead of
the milestone, so that the M3 commit's green is a real before/after.

That commit's message (05f9a39) says the guard ran `exit 1` "before any case",
and this section said the same until it was measured properly. Both were
wrong in the same direction — 8 cases run first. The commit message is history
and is not rewritten; this paragraph is the correction of record, and the
error is worth keeping visible because it is the exact failure this campaign
exists to catch: a plausible claim about a gate, written from an abort message
rather than from the run.

## 7b. The consequence: CI was red by construction

The cause above had a consequence neither this record nor the campaign saw at
first. The check job's index step is `run: make docs-verify docs-verify-test`
(`.github/workflows/check.yml:307`), which runs on every push, so the aborting
self-test was not a latent defect in a script nobody runs — it was a RED check
job on `main`, on every merge, for about 24 hours (L1's measurement: the abort
dates from e33ef7b, 2026-08-27T23:15Z). L1 also found the exit code was being
eaten by a `tail` in the reporting path, which is the second reason the death
read as quiet.

That pairing is the finding, and neither half is much use alone: a gate that
aborts partway is a *cause*, and "the repository's check job is red on every
merge" is what it *cost*. My own fix (05f9a39) went to `main` as L1's
cherry-pick 7566210 with authorship preserved.

## 7c. The other live id: RFCT-073, and the rule

L1's sweep found this file was the only campaign self-test naming live record
ids. RFCT-094 was one; RFCT-073 was the other, named at seven points across
cases 1, 2 and 5.

It was put to me that RFCT-073 is a weaker dependency than RFCT-094 — no
pre-flight `grep … || exit 1`, so it could not abort the run, and the
dependency is only "the record exists and is indexed once" rather than a
status. **Measured, that is not so.** There are three abort paths, not zero:

1. `duplicate_line` runs `exit 1` unless the pattern matches exactly once, and
   cases 1 and 2 pass it `(RFCT-073.md)`.
2. `set -euo pipefail` plus case 5's `rm "${FIX}/docs/task/RFCT-073.md"`.
3. The same, for case 5's `cp` of that file.

And it is positioned worse. Case 1 is the SECOND case, so an abort there
reports **one** case — the positive control — against the eight the RFCT-094
abort reached.

Demonstrated rather than argued. A scratch copy of the docs tree with RFCT-073
renamed out *consistently* (record deleted and its row deleted, so
`docs/verify-index.sh` stays green over the tree at `983/983`):

| self-test | result |
|---|---|
| the version naming RFCT-073 | aborts after 1 case, `rc=1`, no `RESULT:` line |
| the version discovering its exemplar | `task exemplar discovered: RFCT-001`, `RESULT: PASS (18/18 cases)` |

What IS true is that the trigger is rarer: a record deletion or rename, or its
row appearing twice, rather than a status transition that happens as a matter
of routine. But "rare" is what "an assertion nobody has ever seen fail" means,
and this file exists because that is not evidence. So it is closed the same way
the RFCT-094 exemplar was — `pick_task_exemplar` reads the first row in the
fixture index that links to an existing record exactly once — and the
campaign-standard rule is recorded here:

> **A self-test fixture names a SYNTHETIC id, or discovers its exemplar from
> the fixture. A live id is a scheduled silent death.**

`docs/verify-citations-test.sh` was measured safe by construction under this
rule: it uses the synthetic `RFCT-999` throughout. This file now uses `RFCT-999`
for the record it *creates* (case 5's unindexed record, which must not be
indexed and so cannot be a real one) and discovery for the record it *needs to
already exist*. Those are the two correct shapes; a live id is neither.

The helper's own `exit 1` is not the same hazard, and the distinction is worth
stating because it would otherwise look like the defect being re-introduced: it
fires only when NO row in the entire index is usable, which means the shipped
index is already broken and `docs/verify-index.sh` is already red. It cannot be
armed by one record moving on. That is the same footing case 4's research-entry
guard has always stood on.

Two mentions of RFCT-073 remain in the file deliberately, neither a dependency:
the header's account of what was measured when the duplicate assertions were
first written, and the comment explaining this history. Both are prose about
the past, which is what the RFCT-094 comment at the exemplar block is too.

## 8. Upgrade discipline

`new_fixture` copied `docs/README.md`, `docs/design`, `docs/research` and
`docs/task` and **not** `docs/plan`, so the new section broke the self-test on
its own upgrade — the baseline positive control went to
`awk: cannot open docs/plan/index.md`.

`docs/plan` is now copied into the fixture rather than the section being made
skippable when the index is absent. The skippable shape exists in
`docs/verify-citations.sh` for its widened scope, and it was the wrong choice
here: it would have left the whole plan section unexercised by the self-test,
including by the positive control, which is precisely the "an assertion nobody
has ever seen fail" state that file was written to end. `docs/verify-index.sh`
is the gate that *defines* what the real tree must contain, so a missing plan
index there is a failure and not a reason to fall silent.

Seven cases were added, each required to produce exactly one FAIL line with
its own message: the format-example immunity check, a duplicated plan row, the
`[-]`-over-`completed` defect on record, an unknown head, an unknown marker,
a plan file with no row, and a row whose file was deleted.

## 9. Citations re-anchored

The script edits moved and changed text that two documents quote. Both were
re-anchored in the same commit, because the gate must be green at every
commit:

- `docs/task/RFCT-058.md` cited the script's line 42 for the assignment
  `README=docs/README.md`; the new `PLAN_INDEX=` line pushed it down one, to
  line 43. A line-number re-anchor, no prose change.
- `docs/design/build-harness.md` quoted the script's line 2, "Asserts that the
  **two** document indexes…", which now says **three**, and described "three
  pairings". Its §7 now quotes the current line and names the fourth pairing.

`docs/task/RFCT-172.md` already records this exact citation as an instance of
the class: a script edit silently invalidates every line-numbered citation
below it. No line-numbered citation into `docs/verify-index.sh` is made from
this record, deliberately — a record about a script that will keep growing
should not add more of the very citations it is describing as fragile.

## 10. Gates

Every column is a run, not arithmetic over the previous one. Each merge is
re-measured on the merged tree.

| Gate | c5f7e96 (base) | ced1658 (this milestone) | 6cccf5c (+ tcdocsrm@d855804) | 41ae539 (+ tcdocsrm@fd79f53) | after §7c (this commit) |
|---|---|---|---|---|---|
| `bash docs/verify-index.sh` | `863/863 PASS` | `979/979 PASS` | `983/983 PASS` | `987/987 PASS` | `987/987 PASS` |
| `bash docs/verify-citations.sh` | `2170/2170 PASS` | `2173/2173 PASS` | `2173/2173 PASS` | `2178/2178 PASS` | `2179/2179 PASS` |
| `bash docs/verify-index-test.sh` | **red** — `error: no pending RFCT-094 row…`, exit 1, aborts after 8 of 11 cases, no `RESULT:` line | `RESULT: PASS (18/18 cases)` | `RESULT: PASS (18/18 cases)` | `RESULT: PASS (18/18 cases)` | `RESULT: PASS (18/18 cases)` |

Both merges moved the totals for the same reason and neither touched this
milestone's logic. `d855804` brought M4's `docs/task/RFCT-259.md`; `fd79f53`
brought `docs/task/RFCT-260.md` (and, from main, PLAN-028's dated correction,
which is scoped to M2 and leaves M3's Proposal — the text section 1 corrects —
unchanged). A new task record costs the task section the same four assertions
each time: 979 → 983 → 987. RFCT-260 also brought five `os/` citations:
2173 → 2178.

The `6cccf5c` merge's one conflict was in `docs/task/index.md` — the two-row
append conflict, RFCT-258's row against RFCT-259's — resolved by keeping both,
which is correct here because they are different records. Resolving it by
keeping both sides of the *same* row is the mistake the "once each" assertion
exists to catch. The `fd79f53` merge was clean.

The index gate rises by 116, in two parts. **+112** is the new section:
28 plans × 4 assertions (forward membership, reverse membership, once-each,
checkbox↔status). **+4** is this record itself — a new `RFCT-*.md` and its row
add the same four assertions to the task section, which is what adding any
task record has always cost. The plan section alone, measured before this
record existed, took the gate to `975/975`.

The self-test rises from 11 cases (its count once repaired, section 7) to 18.

This milestone's own contribution to the citation gate is +3: one new citation
in `docs/design/build-harness.md` for the fourth pairing, and two in this
record. **No baseline was touched**, because the milestone removes no citation
from scope.

Census, re-measured at each merge — the segment margins are volatile and are
stated against the commit they were measured at, never carried forward:

| Segment | Floor | At 6cccf5c | At 41ae539 | After §7c |
|---|---|---|---|---|
| `docs/` | 303 | 306 (+3) | 306 (+3) | 306 (+3) |
| `.github/` | 2 | 2 (0) | 2 (0) | 3 (+1) |
| `os/` | 1847 | 1847 (0) | 1852 (+5) | 1852 (+5) |
| `test/` | 18 | 18 (0) | 18 (0) | 18 (0) |

0 census failures at all three. `.github/`'s +1 is section 7b's citation of
the check job's index step — the first thing in this campaign to give that
segment any margin at all; its floor is left at 2 for the same reason `docs/`'s
is left at 303. `os/` gained its five from RFCT-260 arriving on
main, not from anything here; a margin that appears from another workstream's
commit can disappear the same way, and none of it is spent by this milestone.
`docs/`'s three are this milestone's own, and its floor is deliberately left at
303 for re-measurement on the merged tree rather than raised on a branch, since
`docs/verify-citations-baseline.txt` and
`docs/verify-citations-unquoted-baseline.txt` are moving concurrently in
sibling workstreams. This record needed no row in the unquoted baseline: a new
document's ceiling is 0 and both of its citations are quoted (section 4).

All three gate runs above were taken in this worktree
(`/srv/bkd/worktrees/u51kzjlk/z2jshmso`), never in `/srv/ai/mos`.

Changed files:

- `docs/verify-index.sh` — section 4
- `docs/verify-index-test.sh` — the exemplar de-hardcoding, `docs/plan` in the
  fixture, seven plan cases, and the RFCT-073 discovery (section 7c)
- `.github/workflows/check.yml` — the index step's name said "Both document
  indexes" and this milestone made that three; a one-line consequence of
  section 4, in the same class as the `build-harness.md` re-anchor below
- `docs/plan/index.md` — the Status Markers table's third column; **no row
  changed**
- `docs/design/build-harness.md`, `docs/task/RFCT-058.md` — citations
  re-anchored
- `docs/task/RFCT-258.md`, `docs/task/index.md` — this record
