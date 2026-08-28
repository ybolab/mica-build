# RFCT-227 PLAN-024 M2: the ratified closeout of PLAN-011, PLAN-012 and PLAN-013, and four residues filed

- **status**: completed — four plans amended and closed, four plan status lines and index markers reconciled, four residues filed pending, the RFCT-101..104 range corrected at its origin
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
- **PLAN-013 Amendment 1** — closes all three milestones as superseded, states
  the index-marker choice in its opening parenthetical, records
  M3's rebuild-and-diff as **transferred into PLAN-025 M2's already-approved
  scope** (under RFCT-231) rather than dropped, and names the two residues it
  leaves as RFCT-225 and RFCT-226.

Four plan status lines and four `docs/plan/index.md` markers were moved so file
and row agree: PLAN-011 to `completed` / `[x]`, PLAN-012 to `completed` / `[x]`,
PLAN-013 to `completed by supersession` / `[x]`, PLAN-024 to `completed` /
`[x]` with `completedAt: 2026-08-28`. PLAN-024 also gains an Amendment 1 of its
own, carrying the closeout summary and the correction in section 3.

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
The index marker the spec delegated is `[x]`; section 4 records the choice.

**D4 and D5 — four numbers from PLAN-024's own pool**, all `pending`, all
unclaimed, all routed toward PLAN-025-class work. RFCT-225 is filed as a *silent
loss of coverage* rather than as a generalisation, which is what RFCT-222
measured; RFCT-226 carries its constraint — `dpkg.log` is now load-bearing for
the stage-order gate — because a record that omits it is not the task that was
ratified.

**D6 — the two Chinese directive quotes in PLAN-011 are untouched.** They are
historical quotations of the user's own words, each already glossed in English
beside it. No line of them was read as a defect or repaired.

## 3. The RFCT-101..104 correction, and where it started

The ratified text named PLAN-012's delivering records as RFCT-101..104. That
range is off by one, and writing it into the plan file would have put a false
attribution into the tree: RFCT-104 is PLAN-011 M7 work, titled
"A master switch for MQTT, and a broker for the bridge that has only ever
retried" (`docs/task/RFCT-104.md:1`), and it contains no container-engine work
at all. The records that delivered PLAN-012 are RFCT-101 —
"PLAN-012 M2: the container engine in the image, installed and inert"
(`docs/task/RFCT-101.md:1`) — RFCT-102, and RFCT-103, titled
"PLAN-012 M1–M4: build the engine from source, replace the distribution's
configuration, and give the switch something to switch"
(`docs/task/RFCT-103.md:1`). That is what RFCT-221 measured and what the
records' own titles say.

**The slip did not start at the ratification.** PLAN-024's own Context
paragraph carries it — "RFCT-101..104 shipped much of it"
(`docs/plan/PLAN-024.md:14`) — and the M1 ratification repeated the range
because it read it there. Naming the origin matters more than fixing the
symptom: a reader who meets RFCT-101..104 in the Context paragraph and finds no
correction beside it will propagate it a fourth time.

So the correction is recorded in **PLAN-024's own Amendment 1**, not by editing
the Context sentence. That prose is dated history and the convention here is
additive amendment; striking it would hide that the error was ever made, which
is the opposite of what naming an origin is for. The amendment states the
corrected range, quotes the three titles that establish it, and says plainly
that the Context paragraph is where the range came from. Both facts the
correction needs — what the range should be, and that it was corrected — are
visible in `docs/plan/PLAN-024.md`.

**The plan files therefore say RFCT-101..RFCT-103**: PLAN-012's status line, its
`relatedTask` line and its Amendment 1. The same correction is reported upward
by the workstream.

## 4. The PLAN-013 marker: `[x]`, and why the first answer was wrong

The plan index offers four markers and none of them is "closed". `[x]` means
Completed and `[~]` means Rejected / Abandoned. PLAN-013 was never approved and
never executed under its own number — RFCT-222's central measurement — so
neither marker is a clean fit, and the closeout spec delegated the choice.

**This record first chose `[~]` and then changed it, on the ratifying
authority's input.** The reasoning that moved it:

The question is not which marker is imprecise — both are — but which one is
false to a reader who sees only the row. `[x]` says the plan's goals are in the
tree. That is true: os/verify, test/apid-api and the two-boot e2e all exist and
are gated. `[~]` says Rejected / Abandoned, which a reader takes as "won't do".
That is false, and it is false about the most visible thing this plan produced.
An imprecise marker beside an amendment that supplies the nuance is a smaller
error than a marker that actively denies the work happened.

**The PLAN-005 precedent turned out to argue the other way.** This record cited
it first as support for `[~]`, on the surface reading that PLAN-005 is a plan
whose work was done under another number. The tree says otherwise in its own
words: PLAN-006's front matter records that
"approving this plan rejects PLAN-005" (`docs/plan/PLAN-006.md:9`), calling
PLAN-005 an alternative *design* that approving PLAN-006 rejects. PLAN-005's
mechanism — a U-Boot dual-slot FIT with Uptane-secured updates — was not built
under another number; it was not built. What shipped is RAUC, and even the
signing tool records the Uptane structure as deliberately not adopted:
"the Uptane director/image repository split — this is a single image"
(`os/pkgs/rauc-sign/README.md:43`).

So PLAN-005 is `[~]` in the legend's literal sense: rejected. PLAN-013 is not.
"Superseded by a rejected alternative" and "superseded by delivery" are
different states, and `[~]` fits only the first. The precedent distinguishes the
two cases rather than joining them.

**Two further things weigh against `[~]`, both inside the audit this closeout
executes.** RFCT-222's verdict on M2 is "M2 — implemented."
(`docs/task/RFCT-222.md:427`) — a plan with a milestone its own audit calls
implemented cannot honestly carry a marker legended Rejected / Abandoned. And
RFCT-222's recommendation for the row is explicit: it moves from
"an unchecked marker to a checked one" (`docs/task/RFCT-222.md:395`).

So the row is `[x]`, and the file agrees: PLAN-013's head reads **completed by
supersession**, with `completedAt: 2026-08-28 (by supersession, not by execution
under this number)`, and Amendment 1 opens with a parenthetical stating the
marker choice and why `[~]` would mislead. Everything the marker cannot carry —
never approved, never run under this number, M3's remaining half transferred to
PLAN-025 M2 — is in the status line and the amendment, one click away from the
row.

RFCT-222 section 5 had suggested the row move "to a checked one". That
suggestion is now followed.

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
index including PLAN-024's own Amendment 1, five new task records, the task
index, and one dated-record marker line
appended to each of RFCT-220, RFCT-221 and RFCT-222 as recorded in section 5.
