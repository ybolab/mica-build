# RFCT-258 PLAN-028 M3: the plan-index status assertion

- **status**: completed — `docs/verify-index.sh` grew a fourth section asserting `docs/plan/index.md` against the 28 plan files in both directions; the index gate went 863/863 → 979/979 with ZERO index edits, because the corpus was already consistent under a mapping wider than the one PLAN-028 proposed; the self-test was RED at the base commit for an unrelated reason and was repaired first
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

exit 1, with no case reporting a verdict — including the positive control. The
three checkbox-vs-status cases were written against RFCT-094 by name;
RFCT-094 was completed at e33ef7b and its row went `[ ]` → `[x]`, and from
that commit the guard fired and `exit 1` ran before anything else. So the
self-test could not have caught a regression in any assertion it covers, and
the campaign's third gate had been reporting nothing for as long as that.

Naming a record couples a test of the **assertion** to the lifecycle of one
task, and every open task eventually closes. The exemplar is now discovered
from the fixture — the property the cases need is "some row is still `[ ]`",
read the same way case 4 already reads its research entry. Each mutation still
verifies that it landed, and a tree with no pending row at all is still
reported loudly rather than skipped. This landed in its own commit, ahead of
the milestone, so that the M3 commit's green is a real before/after.

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

| Gate | At c5f7e96 (base) | At this HEAD |
|---|---|---|
| `bash docs/verify-index.sh` | `863/863 PASS` | `979/979 PASS` |
| `bash docs/verify-citations.sh` | `2170/2170 PASS` | `2173/2173 PASS` |
| `bash docs/verify-index-test.sh` | **red** — `error: no pending RFCT-094 row…`, exit 1, 0 cases | `RESULT: PASS (18/18 cases)` |

The index gate rises by 116, in two parts. **+112** is the new section:
28 plans × 4 assertions (forward membership, reverse membership, once-each,
checkbox↔status). **+4** is this record itself — a new `RFCT-*.md` and its row
add the same four assertions to the task section, which is what adding any
task record has always cost. The plan section alone, measured before this
record existed, took the gate to `975/975`.

The self-test rises from 11 cases (its count once repaired, section 7) to 18.

The citation gate rises by 3: one new citation in `docs/design/build-harness.md`
for the fourth pairing, and two in this record. **No baseline was touched.**
The census segments measured on this branch are `docs/` 306 (floor 303),
`.github/` 2 (floor 2), `os/` 1847 (floor 1847), `test/` 18 (floor 18) — the
last three sit exactly on their floors and this milestone moved none of them,
because it removes no citation from scope. `docs/` gains 3 of headroom; the
floor is deliberately left at 303 for re-measurement on the merged tree rather
than raised on a branch, since `docs/verify-citations-baseline.txt` and
`docs/verify-citations-unquoted-baseline.txt` are moving concurrently in
sibling workstreams. This record needed no row in the unquoted baseline: a new
document's ceiling is 0 and both of its citations are quoted (section 4).

All three gate runs above were taken in this worktree
(`/srv/bkd/worktrees/u51kzjlk/z2jshmso`), never in `/srv/ai/mos`.

Changed files:

- `docs/verify-index.sh` — section 4
- `docs/verify-index-test.sh` — the exemplar de-hardcoding, `docs/plan` in the
  fixture, seven plan cases
- `docs/plan/index.md` — the Status Markers table's third column; **no row
  changed**
- `docs/design/build-harness.md`, `docs/task/RFCT-058.md` — citations
  re-anchored
- `docs/task/RFCT-258.md`, `docs/task/index.md` — this record
