# RFCT-159 PLAN-017: the five task records, the five index rows and the plan's status

- **status**: completed
- **priority**: P2
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-26 22:05
- **claimedAt**: 2026-08-27 08:49
- **completedAt**: 2026-08-27
- **plan**: PLAN-017

The finishing subtask of PLAN-017. The four content subtasks (RFCT-155, 156,
157, 158) are merged; this one writes all five task records, appends all five
index rows, marks the plan, and records what the workstream did **not** settle.

## Scope

| file | change |
| --- | --- |
| `docs/task/RFCT-155.md` .. `RFCT-159.md` | new, five records |
| `docs/task/index.md` | five rows appended, `> Updated:` bumped |
| `docs/plan/PLAN-017.md` | status and milestone markers |
| `docs/README.md` | one design-document description line (see below) |
| `docs/design/bus.md` | one sentence, the dead `§10.3` cross-reference (see below) |

No other file outside `docs/task/` and `docs/plan/` is touched by this
subtask; everything else in `git diff main...HEAD` belongs to the four content
subtasks.

`claimedAt` for RFCT-155 .. RFCT-158 is each subtask's **first commit
timestamp**, taken from `git log --format=%ci`. The real claim times were not
recorded in the tree, and this record does not invent them.

## Why the four content subtasks wrote no task files

`docs/verify-index.sh` asserts in **both directions** that every
`docs/task/RFCT-*.md` file has a row in `docs/task/index.md` and every row has
a file, and it **gates** `make` and CI. So a task file merged without its index
row — or a row merged without its file — turns the gate red for every
subsequent merge in the workstream, not just its own.

Every point at which a branch was accepted into `bkd/eikxntif` therefore had to
be verify-index green. That is why all five task records and all five index
rows are written here, at once, on a branch that already contains the work they
describe.

**This replaces the pattern PLAN-015's finisher used.** In `RFCT-154`, the
content subtasks (RFCT-150 .. 153) each committed their own task file and the
finisher appended the index rows afterwards, which left the tree **red between
merges**. That was tolerable while the checker was advisory. It is not
tolerable now that it gates `make` and CI.

## Deviation: reset over revert on the failed merge

The three-tier merge rule says a failed merge is backed out with
`git revert -m 1 HEAD`. This workstream used `git reset --hard` to the recorded
merge base instead, when M1's merge failed the citation gate (the failure is
recorded in `docs/task/RFCT-155.md`). **L1 ratified the deviation.** The
reasoning:

- **Revert is the trap here.** Reverting a merge commit and later re-merging
  the same branch is the git behaviour where the reverted changes count as
  already applied and are silently dropped. In this case that would have been
  1,132 lines of `api.md`.
- **Reset is correct specifically when the bad merge is the unpushed tip with
  no consumer.** It leaves the subtask branch intact and ordinarily
  re-mergeable, which is exactly what was needed: RFCT-155 repaired its branch
  and it was merged again.
- **The precondition that makes it safe is recording the merge base BEFORE
  every merge.** Without that recorded SHA there is nothing to reset to.

**Scope of the ratification, stated honestly:** it covers this case and cases
with the same preconditions — an unpushed merge commit at the tip, with no
consumer, and a merge base recorded in advance. It does **not** cover a merge
that has been pushed or consumed. For those the original `git revert -m 1`
rule stands, trap and all.

## `docs/README.md` description lines

`docs/verify-index.sh` matches on **filename only** (its own header, sections 1
and 2), so a one-line description in `docs/README.md` can be completely wrong
while the gate stays green. One was, and this workstream made it so:

```
-  - `remote-management.md` — `apid` (product) vs Talos `apid`, SideroLink fleet path
+  - `remote-management.md` — what reaches the device today (apid on the LAN over HTTPS), the NAT/fleet channel as a requirement with no design, update control flow
```

RFCT-156 deleted both Talos `apid` and SideroLink from that document;
`grep -rn SideroLink docs/design/` now returns nothing.

The other five documents this workstream rewrote were re-read as merged and
their descriptions **left alone**, each for a measured reason:

| bullet | verdict |
| --- | --- |
| `access.md` — *channels, auth phases, lockdown layers* | still accurate: §2 Channels, §4 Authentication, §5 Layered disablement |
| `boards.md` — *artifacts, kernel assertions, new-board checklist* | still accurate: §3, §4, §7. Not touched by the sibling PLAN-018 workstream either — `git log -- docs/README.md` shows no PLAN-018 commit |
| `provisioning.md` — *three-layer model* | still accurate: §2 Layer 1, §4 Layer 2, §5 Layer 3 |
| `api.md` — *current HTTP/bus surface, proposed API, static hosting, replaceable UI* | still accurate: §1, §2-3, §4, §5 |
| `connd.md` — *unified connectivity service: WiFi STA/AP, Bluetooth, CAN* | **wrong, but not made wrong here** — see below |

**`connd.md`'s bullet is wrong and was deliberately not fixed.** The document
says there is no `connd` process and that CAN and Bluetooth are the board
layer's, not mosd's — but it already said both on `main`, before RFCT-158
touched it (`git show main:docs/design/connd.md`, lines 17 and 37). This
subtask's scope extension covers only descriptions **this workstream's own
edits made wrong**, so it is reported rather than edited. It is a real defect
and no gate reaches it.

## `docs/design/bus.md` — the dead `§10.3` cross-reference

`docs/design/bus.md:402` read:

```
`docs/design/api.md` §10.3 records the same resolution from the API side.
```

`docs/design/api.md` has ten top-level sections numbered 0 through 9
(`grep -n '^## ' docs/design/api.md`); there is no §10.3. This predates
PLAN-017 — RFCT-155 renumbered nothing. No gate reaches it: it is a
section-anchor reference, not a `path:line` citation, so
`docs/verify-citations.sh` never sees it.

**What §10.3 was.** api.md's old section 10 was *"Routed follow-ups"*, and
§10.3 was *"From trust and phasing"* (`git show 63413db^:docs/design/api.md`,
`:4029`). Its **item 16** is the entry bus.md points at: *"Resolved — the
actions-as-items-versus-methods fork is closed in favour of writable action
items, and `/api/v1/actions/<verb>` survives it with no HTTP-visible change"*,
including the sentence bus.md's own paragraph restates — that the
`com.mos.mosd1` `Reboot` and `PowerOff` methods are still served and neither
deprecated nor removed.

**Where the resolution lives now.** Not in a task file created by the removal
campaign: `docs/task/RFCT-122.md` records that *"§10, 751 lines of defect
register, is deleted rather than relocated: git history is the archive"*, and
RFCT-129 .. RFCT-141 are the **open defects** that campaign routed out, none of
which is this. Item 16 was a *resolved* entry, so it was routed nowhere. It
does have a surviving home, and it is the record that produced it:
`docs/task/RFCT-090.md` §*"The D3 fork, resolved in writing"*, which restates
the resolution inline — the fork closed in favour of items, `POST
/api/v1/actions/<verb>` surviving as a thin mapping with no HTTP-visible
change, and the two methods still served.

**What was done:** the clause was re-pointed at `docs/task/RFCT-090.md`, naming
the section. bus.md already cites task records this way twice in the same file
(`:263`, `:272`, both `docs/task/RFCT-093.md` §*"Investigation — ..."*), so the
form is the file's own.

**One wrinkle a later reader should know:** `docs/task/RFCT-090.md`'s own text
still says *"`docs/design/api.md` §10.3 item 16 records the resolution from the
API side"* — a pointer that is now dead in the same way. RFCT-090 restates the
substance, so a reader arriving from bus.md gets the resolution without
following further, but `docs/task/**` is outside this workstream's scope and
that sentence was left as it is.

**Also noted, not touched:** `docs/design/bus.md:389` says the fork was *"left
open in `docs/design/api.md`'s research appendix"*. api.md has no research
appendix either — it went with section 10. The scope extension was one
sentence, so this second dead reference in the same paragraph is reported here
rather than edited.

## Stale citations this workstream invalidated, outside every gate

`docs/task/**` and `docs/research/**` are **outside**
`docs/verify-citations.sh`'s scope, and they hold line citations into all six
documents this workstream rewrote. Those line numbers are now wrong and no
gate will ever say so. Reproduce with:

```
grep -rn 'remote-management\.md:[0-9]\|access\.md:[0-9]\|connd\.md:[0-9]\|provisioning\.md:[0-9]\|api\.md:[0-9]\|boards\.md:[0-9]' docs/task docs/research
```

That reports **81 lines**, of which 4 match `venus.wiki/dbus-api.md` and are
false positives of the `api.md:` token, leaving **77 real citations across 21
files**:

| document cited | citing lines |
| --- | --- |
| `api.md` | 38 |
| `access.md` | 16 |
| `boards.md` | 10 |
| `remote-management.md` | 5 |
| `connd.md` | 4 |
| `provisioning.md` | 4 |

Four of them were added by RFCT-156's rewrite and point into the **old**
`remote-management.md` text: `docs/research/venus-os-access.md:359` (quotes
*"on the device"* at `:68`), `:667` (`:36-39`),
`docs/research/venus-os-ui.md:660` (`:24-34`), `:713` (`:13`).

**These are not fixed here, and 13 of them must not be fixed at all.**
RFCT-157 left the `boards.md` / `display.md` citations deliberately, and the
reasoning is the useful part: they are **dated records of what was measured at
a past commit**, not live cross-references. The clearest case is the sibling
PLAN-018 workstream's own `docs/task/RFCT-163.md:224-230` — a worklist headed
"sites left for RFCT-157", every entry of which RFCT-157 has now fixed, which
is precisely what makes those line numbers stale. Re-pointing a dated worklist
would falsify the record of what was measured. The same applies to
`docs/task/RFCT-128.md:55`, `RFCT-131.md:26`, `RFCT-059.md:103` and the rest of
that class.

Deciding which of the remaining 64 are live cross-references and which are
dated records is a task somebody can pick up. It is written down here because
an unfixed consequence that is recorded is a task, and one that is not is a
defect the next reader discovers by being misled.

## `board/` path tokens no gate reaches

RFCT-157 found path tokens still naming the pre-PLAN-018 `board/` prefix that
PLAN-018's sweep did not reach. They are out of this workstream's scope and out
of PLAN-018's, and **no gate reaches them** — `docs/verify-citations.sh` checks
`path:line` citations in a defined document set, not path tokens in prose or
source comments. All 17 were re-verified on the merged tree:

- inside the design set: `docs/architecture.md:23` — *"`board/`,
  `docs/design/boards.md`"* in the BSP-artifacts row
- `os/rootfs/README.md:121`; `os/rootfs/build-v2.sh:627`;
  `os/rootfs/stages/31-feature-containers.Dockerfile:16`;
  `os/rootfs/stages/40-board.Dockerfile:21`, `:100`, `:126`, `:146`;
  `os/rootfs/stages/README.md:249`, `:331`
- `os/verify/HARNESS.md:200`, `:513`;
  `os/verify/src/checks-bootchain.ts:5`, `:19`, `:20`, `:346`, `:347`
- `os/build/src/bundle-cli.ts:42`

**The sharpest case is `os/rootfs/stages/40-board.Dockerfile`**, which names the
old prefix at `:21` (`board/<b>/rootfs/firmware`) and `:98` while comments in
the *same file* at `:14`, `:22`, `:101`, `:123` and `:139` already say
`os/boards/<board>/...`. A reader has both prefixes in one screen and no way to
tell which is current.

## `.zh.md` residue — untouched by policy, not by oversight

`*.zh.md` is excluded from both gates deliberately (`docs/verify-index.sh`
header) and from PLAN-017's scope. The Chinese siblings therefore still
describe the retired layout, and this is recorded so it is not mistaken for
a sweep that missed them:

- `docs/architecture.zh.md:108`, `:118`, `:120` still describe `board/<name>/`
  with `board.yaml`
- `docs/design/boards.zh.md` still carries the `board.yaml` prose removed from
  its English original (`:24`, `:36`, `:44`, `:45`, `:88`), and `:73` still
  names `GenerateAssets`
- `docs/design/display.zh.md:69`, `:75` still describe `board.yaml features`
  and a `display:` section

`access.md`, `remote-management.md` and `provisioning.md` now each carry a
one-line header statement that the `.zh.md` sibling is stale, which is the
narrowest honest thing the English documents can say while the translation
decision stays parked with the user.

## Gates

Both exit 0 on this branch, and neither count fell. Progression across the
workstream, all rc=0:

| point | `verify-citations.sh` | quote-carrying | `verify-index.sh` |
| --- | --- | --- | --- |
| campaign baseline | 642/642 | 164 | 483/483 |
| after M2 (`00ab52a`) | 675/675 | — | 483/483 |
| after M1 (`646d43e`) | 886/886 | 341 | — |
| after `main` merged (`ad2f008`) | 886/886 | — | 495/495 (PLAN-018 added RFCT-160..163) |
| after M4 (`fa337ee`) | 886/886 | — | — |
| after M3 (`a8f13c9`) | 902/902 | 355 | 495/495 |
| this subtask | 902/902 | 355 | **510/510** |

**The index count rises by 15, not by 5, and that is correct.** The dispatch
predicted 5 — one per task file. `docs/verify-index.sh` section 3 runs **three**
loops over the task set, not one: forward (every record has a row), reverse
(every row resolves to a record) and once-each (no record has two rows). Five
new files and five new rows therefore add 3 x 5 = 15 checks. The decomposition,
measured:

```
$ git ls-tree --name-only main docs/task/ | grep -c 'RFCT-.*\.md'   ->  145
$ ls docs/task/RFCT-*.md | wc -l                                   ->  150
```

3 x 145 = 435 and 3 x 150 = 450, a delta of exactly 15; 495 - 435 = 60 is the
`design/` + `research/` half of the checker, which this subtask did not change
(the `docs/README.md` edit changed description text, not a filename, and
sections 1 and 2 match on filename only). No number was adjusted to fit: the
prediction was arithmetically wrong, the run is right.

**The headline for PLAN-017 is the quote column: 164 -> 355.** The citation
gate now content-checks what these documents assert, instead of merely
confirming that their line numbers resolve.
