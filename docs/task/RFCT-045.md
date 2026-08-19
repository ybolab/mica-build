# RFCT-045 Consolidation, PMA records, and a build-enforced index check

- **status**: implementation complete — `make docs-verify` green, six negative tests demonstrated
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 10:17
- **claimedAt**: 2026-08-19 14:00
- **completedAt**: 2026-08-19 15:20

Campaign `l1-o7ee8v0o-20260819101756-venus` (research/design-proposal, documents
only). Branch `bkd/ill9sdis`, merged by L2 into `bkd/sqexk7je`.

## Description

The last task of the campaign. Six analysis deliverables were already merged;
this task turns them into records, indexes both, cross-links the two Venus
documents, and converts *"an index line belongs with the record that creates
it"* from a convention people forget into something `make` enforces.

## What shipped

1. Companion cross-link lines at the top of `docs/research/venus-os-ui.md` and
   `docs/research/venus-os-access.md`, each naming the other and what it covers.
2. Seven records, `docs/task/RFCT-040.md` … `RFCT-046.md`.
3. Seven rows appended to `docs/task/index.md`.
4. Seven index lines in `docs/README.md` — four for this campaign's documents,
   three for pre-existing documents the list had drifted past — plus one policy
   line recording why this campaign's documents ship English-only.
5. `docs/verify-index.sh` and the `docs-verify` Makefile target.

## The dropped fold, with its evidence

The campaign originally specified a **fold**: merge `venus-os-access.md` into
`venus-os-ui.md` and delete the former. It was measured before dispatch and
**dropped**. This is recorded here because the acceptance criterion it came from
is now permanently unmet, and a future reader must find a decision rather than a
criterion silently abandoned.

**The measurement.** `docs/design/dashboard.md` cites `venus-os-access.md`
**11** times and `venus-os-ui.md` **37** times — 48 cross-references, all in
that one file. The fold would have required retargeting or re-checking every one
of them by hand.

**Why that is disqualifying, and it is not the count.** *Nothing can catch a
wrong one.* A citation pointed at the wrong section number resolves to a real
file and a real heading; it is silently wrong. Every other class of error in
this campaign fails loudly — a missing file fails `test -e`, a missing index row
now fails `make docs-verify`. A mis-retargeted section reference fails nothing,
ever, and is discovered only by a reader who follows it and is confused. Forty-
eight hand edits with no possible verification is a worse trade than two files
that each say what the other covers.

**Why the criterion existed at all.** It named one file because one file was
assumed, written before the research split in two. The criterion was amended,
not quietly skipped. What replaced it is section 1 of this task's work: one
companion line at the top of each document. Both documents remain
self-contained; nothing was renumbered and nothing was deleted.

## Why the two indexes diverged, stated as bluntly as it was measured

`docs/task/index.md` has been maintained **perfectly** across roughly ten
campaigns: 31 records, 31 rows, both directions clean, measured before this task
added anything. The `docs/README.md` document list drifted **three separate
times** — `connd.md`, `ro-root.md` and `uboot-ab-handshake.md` all exist in the
tree and none appeared in the list.

**The difference is not care.** The M5 documentation task that missed
`connd.md` was RFCT-028, and it was careful about everything else it touched.
Attributing the drift to inattention would be both unkind and useless, because
it predicts nothing about the next document.

**The difference is that one of the two lines was required and the other was
not,** and the git history says so in a single commit. `ef97735` (*"docs:
PLAN-010 M5 record, connd design, and three design-doc/code contradictions
resolved"*) added `docs/design/connd.md`, added `docs/task/RFCT-028.md`, and
updated `docs/task/index.md` — and did not touch `docs/README.md`. The same
author, in the same commit, maintained one index and not the other.

The PMA workflow makes the task-index row a REQUIRED step of writing a record;
the project even has a recurring task type for it — *"PMA documentation
finalize"*, RFCT-019 and RFCT-028 — and `6fa7d5d` is one of those tasks
back-filling the index rows for RFCT-013 and RFCT-018 that their own commits had
not added. Nothing ever made the README line required. That is the whole of it.

The generalisation, stated here because the next person deciding whether a check
is worth writing will read this record and not the script:

> **Every convention in this project that depends on someone remembering will
> eventually be forgotten by someone careful.**

And the corollary, which says where to look next:

> **The section that has never failed is the section with a process behind it.**

So the residual risk is not in `docs/task/index.md`. It is in every other
convention this repository holds by habit rather than by gate. The three
sections of `docs/verify-index.sh` close the two document indexes; they say
nothing about the rest.

## The three pre-existing index entries added here

Added deliberately, each named with the campaign that created the document, so
this is an auditable act with a reason rather than a silent sweep:

| document | created by | in commit | campaign |
| --- | --- | --- | --- |
| `docs/design/connd.md` | RFCT-028 | `ef97735` | PLAN-010 M5 |
| `docs/design/ro-root.md` | RFCT-013 | `32bf063` | the earlier A/B work |
| `docs/design/uboot-ab-handshake.md` | RFCT-018 | `12204f7` | the earlier A/B work |

Each commit was located with `git log --diff-filter=A -- <path>`, not recalled.

None of the three documents is edited. Only the `docs/README.md` line that
should have accompanied each is added.

## The branch-base defect

Recorded here because it is a defect in the **dispatch process**, not in any
deliverable, and both campaigns running against this tree hit it.

**The defect.** BKD cuts L3 branches from `main`, not from the campaign branch.

**The mild symptom, which is the one everybody sees.** An L3 cannot READ a
sibling's deliverable, because the sibling's file does not exist on `main`. This
fails immediately and loudly. Both campaigns hit it and repaired it by merging
the campaign branch.

**The severe symptom, which the mild one hides.** An L3 whose job is to EDIT or
DELETE a sibling's file does not get an error. It gets an absent file, produces
what looks like a correct tree, and **merges cleanly** — silently discarding or
never applying the sibling's work. The mild symptom is self-announcing; the
severe one is not. Being *used* to repairing the mild symptom is precisely what
makes the severe one invisible.

**The fix, both halves.** Pre-create the L3 branch at the campaign head at
dispatch time — this task's branch was pre-corrected that way and its first
action verified it. And instruct the L3 to report `blocked` rather than
improvise: an L3 that recreates a missing file from scratch destroys merged work
through an add/add conflict, so `blocked` is the correct outcome, not a failure.

## The check: `docs/verify-index.sh` + `make docs-verify`

**House style, and it is explicit.** The Makefile says of itself *"Heavy lifting
stays in each component; this file only routes"* (`Makefile:1-2`) and all ten of
its pre-existing targets are a one-line `bash <script>`. So the logic is in the
script and the Makefile gets a routing target, registered in `.PHONY` and
described in `help` alongside the others.

Three sections, each asserted in **both directions**, each failure naming the
offending file:

| # | forward | reverse |
| --- | --- | --- |
| 1 | every `docs/design/*.md` appears in `docs/README.md` | every design document named in `docs/README.md` resolves to a file that exists |
| 2 | every `docs/research/*.md` appears in `docs/README.md` | every research document named in `docs/README.md` resolves to a file that exists |
| 3 | every `docs/task/RFCT-*.md` has a row in `docs/task/index.md` | every RFCT row in that index resolves to a file that exists |

The reverse direction is the half that is easy to omit and the half that catches
a rename: a forward-only check passes happily on an index full of dangling
entries.

`*.zh.md` is excluded **deliberately**, with the reason carried in a comment in
the script: the bilingual decision is parked with the user, so translated
siblings are not required to be indexed and must not fail the check.

### Proving the check

A check nobody has seen fail is not a check — and that applies six times here,
not once. Six negative tests were run, one per section per direction: removing
an index line must fail naming the now-unindexed document, and pointing an index
line at a non-existent file must fail naming the dangling entry. Each was
performed by temporarily editing the file and then restoring it with
`git checkout -- <path>`. All six failed as required and each named the
offending file. **The committed tree is the passing state.**

## Scope

This is the only task of the campaign permitted to touch a non-`docs/` path, and
the only path it touches is `Makefile` — a new target, nothing else.
`docs/design/dashboard.md` is byte-identical to the base. `docs/design/access.md`,
`docs/design/provisioning.md` and `docs/design/mosd.md` belong to the parallel
`sshweb` campaign and were never edited. Nothing was renumbered; nothing was
deleted.

## Numbering note

`RFCT-040`-`046` is this campaign's allocation. `047`/`048` and `053`+ belong to
the parallel `sshweb` campaign; `049`-`052` are this campaign's unused reserve.
**The non-sequential relationship between the campaign's task letter and its
record number is intentional and not an error** — task F is RFCT-045 and task G
is RFCT-046 because numbers were allocated by subject and letters by dispatch
order.
