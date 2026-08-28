# RFCT-227 PLAN-024 M2: the ratified closeout of PLAN-011, PLAN-012 and PLAN-013, and four residues filed

- **status**: completed — three plans amended and closed, four plan status lines and index markers reconciled, four residues filed pending
- **priority**: P1
- **owner**: bkd/fx15tzre
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-024 (M2)

PLAN-024 M1 measured three legacy plans against the tree and proposed a verdict
for each: RFCT-220 for PLAN-011, RFCT-221 for PLAN-012, RFCT-222 for PLAN-013.
Those three records deliberately appended nothing — each drafted its amendment
text and left it for the gate. The gate returned with six ratified decisions.
This record executes them.

## 1. What was written

Three dated amendments, each additive, none of them touching the historical
prose above it:

- **PLAN-011 Amendment 1** — closes the plan. M1, M2, M3 with its deferred
  image wiring, M5 and M7 are in the tree; M4 stays withdrawn from 2026-08-22
  and **M6 is withdrawn 2026-08-28** on the same pattern, its number not
  reused. The pre-`ec202f1` paths in the plan body are recorded as deliberately
  not rewritten, and the one narrowed outstanding verification — no device has
  ever had `mqtt.enabled` set true, and no arm64 image has been built — is
  routed to PLAN-025 with a named destination.
- **PLAN-012 Amendment 1** — closes the plan on M1-M4, records the six ways the
  build diverged from what was decided, and names both residues: M5's upstream
  pin watch as RFCT-223, and the D3 writability divergence as RFCT-224.
- **PLAN-013 Amendment 1** — closes all three milestones as superseded, records
  M3's rebuild-and-diff as **transferred into PLAN-025 M2's already-approved
  scope** (under RFCT-231) rather than dropped, and names the two residues it
  leaves as RFCT-225 and RFCT-226.

Four plan status lines and four `docs/plan/index.md` markers were moved so file
and row agree: PLAN-011 to `completed` / `[x]`, PLAN-012 to `completed` / `[x]`,
PLAN-013 to `closed` / `[~]`, PLAN-024 to `completed` / `[x]` with
`completedAt: 2026-08-28`.

Four residues were filed as pending records with no owner claimed — RFCT-223,
RFCT-224, RFCT-225, RFCT-226 — plus this record, and six rows were appended to
`docs/task/index.md`.

## 2. The decisions that drove it

**D1 — PLAN-011 M6 withdrawn, not tasked.** RFCT-220 section 8b had drafted M6
as a task and stated withdrawal as its own alternative, on the grounds that no
`com.mos.ext.*` producer exists and D5's posture is that mos does not own
extension lifecycle. The gate took the alternative. That draft is not taken up,
no record was created for it, and the number it proposed was not carried; the
amendment records the milestone as revivable when a real extension arrives.

**D2 — PLAN-012 closes with no retroactive approval stamp.** RFCT-221 section
6a had drafted `approvedAt: 2026-08-28 (retroactive)`. That part of the draft is
superseded: `approvedAt` is left empty, because no approval happened on any date
and writing one in would invent a record. The amendment states the honest
version instead — delivered without its own approval step, ratified at close on
2026-08-28.

**D3 — PLAN-013 closes in full as superseded**, with M3's remaining half stated
as a transfer into PLAN-025 M2 so the work is traceable out rather than lost.

**D4 and D5 — four numbers from PLAN-024's own pool**, all `pending`, all
unclaimed, all routed toward PLAN-025-class work. RFCT-225 is filed as a *silent
loss of coverage* rather than as a generalisation, which is what RFCT-222
measured; RFCT-226 carries its constraint — `dpkg.log` is now load-bearing for
the stage-order gate — because a record that omits it is not the task that was
ratified.

**D6 — the two Chinese directive quotes in PLAN-011 are untouched.** They are
historical quotations of the user's own words, each already glossed in English
beside it. No line of them was read as a defect or repaired.

## 3. The RFCT-101..104 correction

The ratified text named PLAN-012's delivering records as RFCT-101..104. That
range is off by one, and writing it into the plan file would have put a false
attribution into the tree: RFCT-104 is PLAN-011 M7 work, titled
"A master switch for MQTT, and a broker for the bridge that has only ever
retried" (`docs/task/RFCT-104.md:1`), and it contains no container-engine work
at all. The records that delivered PLAN-012 are RFCT-101, RFCT-102 and
RFCT-103 — the last of them titled
"PLAN-012 M1–M4: build the engine from source, replace the distribution's
configuration, and give the switch something to switch"
(`docs/task/RFCT-103.md:1`). That is what RFCT-221 measured and what the
records' own titles say.

**The plan file therefore says RFCT-101..RFCT-103**, in PLAN-012's status line,
its `relatedTask` line and its Amendment 1. The same correction is reported
upward by the workstream; it is recorded here so the divergence between the
ratified wording and the committed file is not read later as a transcription
slip.

PLAN-024's own Context paragraph carries the same "RFCT-101..104" phrasing.
It was left as written: it is dated historical prose in a plan body, and the
closeout convention here is additive amendment, not retroactive repair of the
sentence that motivated the plan.

## 4. The PLAN-013 marker: `[~]`, and why

The plan index offers four markers and none of them is "closed". `[x]` means
Completed and `[~]` means Rejected / Abandoned. PLAN-013 was **never approved
and never executed under its own number** — RFCT-222's central measurement.
Its purpose was served, but it was served by four other campaigns under other
numbers; nothing was ever delivered as PLAN-013 work.

`[x]` would read as "this plan completed", which is the one claim the audit
disproves. `[~]` reads as "this plan did not run", which is true, and the
status line beside it carries the rest — `closed 2026-08-28 — superseded` —
so the row and the file say the same thing and neither overstates it. The
tree already holds this precedent: PLAN-005 sits at `[~]` with
`status: rejected (superseded by PLAN-006)`, a plan whose work was likewise
done under a different number.

RFCT-222 section 5 had suggested the row move "to a checked one". That
suggestion is not followed, on the authority the closeout spec gave for this
choice; the reasoning is recorded here rather than left to the diff.

## 5. Two things this record decided that the spec did not settle

**The upstream sync conflicted, and was resolved rather than reported as
blocked.** `git merge bkd/f8sr8jbx` hit one conflict, in `docs/task/index.md`,
and it was purely additive: this branch had appended RFCT-216's row and the
audit branch had appended RFCT-220, RFCT-221 and RFCT-222's rows, at the same
end of the same list. Both sides were kept, in number order. No audit content
conflicted and all three audit records landed intact, so nothing was
improvised in place of them — the substitute the blocked-on-conflict rule
exists to prevent. `docs/task/index.md` is in scope for this task regardless.

**Three out-of-scope files were edited, one comment line each: the audit
records were marked as dated records.** Moving the plan status lines broke the
citation gate in a way that cannot be repaired by re-anchoring. RFCT-220,
RFCT-221 and RFCT-222 each quote the plan heads they measured — "- **status**:
proposal", "- **status**: implementing", "- **relatedTask**: -" — and this
commit is what makes those quotes untrue. There is no line to re-point them at:
the text is gone by design, and rewriting the quotes would erase the very
finding each audit made, that the plan file and the tree disagreed.

The tree has a mechanism for exactly this, and all three records are textbook
cases of it: each states it measured "this worktree at `a86ab46`". Each now
carries the `<!-- dated-record: ... -->` marker, in the wording RFCT-172
established and RFCT-065, RFCT-067, RFCT-080, RFCT-116 and RFCT-163 already
use. The exemption is not silent — the gate's census names each exempted file
on its own line in every run, so the three appear there permanently.

The merge also arrived with the gate already red: three citations in RFCT-222
quoted PLAN-025's Proposal section at lines two later amendment commits had
moved. Those were re-anchored first and then **reverted**, because the
dated-record classification makes the original anchors correct — they name
where PLAN-025's text was when RFCT-222 measured it. `docs/task/RFCT-222.md`
therefore differs from the merged upstream by one appended comment line and
nothing else, as do RFCT-220 and RFCT-221. No prose, no quote and no verdict of
any audit was changed.

## 6. One count worth stating plainly

The closeout brief describes PLAN-011 as "six milestones landed". Five
*numbered* milestones are in the tree — M1, M2, M3, M5, M7 — and the sixth
delivery is M3's deferred image wiring, which shipped separately under
RFCT-097 and which RFCT-220 counts as its own item. The amendment and the
status line name each delivery individually rather than carrying a bare count,
so no reader has to guess which six.

## 7. Checks

Both documentation gates were run after every edit; their verdict lines are
quoted in this task's report. No source file, design document or script was
touched: the diff is three plan amendments, four plan status blocks, the plan
index, five new task records, the task index, and one dated-record marker line
appended to each of RFCT-220, RFCT-221 and RFCT-222 as recorded in section 5.
