# RFCT-261 docs/plan/ is half-read: its index is asserted, its citations are not

- **status**: closed — obsoleted by PLAN-029 M2. The gap this recorded was that `docs/plan/` citations went unasserted; PLAN-029 removed citations from the documents instead of extending the gate to reach them.
- **priority**: P2
- **owner**: unassigned
- **createdAt**: 2026-08-29
- **plan**: none yet — found by PLAN-028 M1 out of its scope, measured by the
  campaign coordinator, filed here so the scope decision is made deliberately
  rather than by default

## What was measured (2026-08-29, at 0f27eb0)

`docs/verify-citations.sh` scans four document sets and `docs/plan/` is not one
of them: `docs/verify-citations.sh:563` *"for doc in docs/design/*.md"* builds the
design set, `:347` *"for doc in docs/task/*.md docs/research/*.md"* adds the
rest, and the run announces its own scope at `:467`
*"docs/design/*.md, docs/task/*.md and docs/research/*.md excluding *.zh.md"*.

PLAN-028's M3 then taught the other gate to read that directory. On the
gate-backlog branch, `docs/verify-index.sh` declares a fourth section,
*"docs/plan/PLAN-*.md   <-> docs/plan/index.md"*, and reads it at
`PLAN_INDEX=docs/plan/index.md`. That milestone is correct and lands with
PLAN-028.

The result is a directory the tooling half-reads: **every plan's checkbox is
now asserted against its status field, and every citation those same files make
is unchecked.** A reader has no way to know that the two halves are governed
differently, because both live in the same directory and both look checked.

## The entry cost, measured with the gate's own extractor

`extract_citations` was sourced out of `docs/verify-citations.sh` unmodified and
run over `docs/plan/*.md`, applying the same scope rule the gate applies:

| | |
| --- | --- |
| tokens found | 76 |
| in scope (path has a directory, first segment is a repo-root directory) | **27** |
| armed (a quote the content check could use) | **0** |
| unquoted | **27** |
| resolve by range | 24 |
| do not resolve at all | **3** |

Zero of twenty-seven are armed. So if the directory entered scope today, every
one of its citations would be resolution-only — the class this campaign measured
as the one the gate cannot catch (33 of 33 armed citations caught against 0 of
23 unarmed, in one workstream's own edit).

The three that do not resolve, and what happened to them:

- PLAN-015 cites `os/podman/versions.env` at line 26, and
  `os/update/rauc/versions.env` at line 27. Both paths moved under `os/pkgs/`
  in PLAN-019, so they name files this tree does not have. The citations are
  written here without their line suffixes on purpose: reproduced as written
  they would be assertions this record makes, and the gate cannot tell a
  citation quoted as data from one being made.
- PLAN-015 cites `os/tests/health-test.sh` at lines 340-363, and that file is
  349 lines long.

Two more resolve and are stale on content rather than range:
PLAN-015 cites the `Makefile` at lines 180-197 and 199-210 for a tombstone
list, and PLAN-018 names it at line 321 in prose. Both predate the Makefile's
current shape.

## The decision this task exists to force

Half-read is worse than either whole, so the choice is scope in or scope out,
stated:

1. **In.** 27 citations is a small entry cost, and the arming work is bounded
   and known. A completed plan records intent and measurement at a past commit,
   so many of them belong under the `<!-- dated-record:` marker rather than
   under a live re-anchor — the same reasoning that keeps frozen task records
   out of re-anchoring, and the reason this is not a mechanical sweep.
2. **Out.** Then say so where the gate declares its scope, and say why, so the
   next reader does not take the index gate's coverage of `docs/plan/` as
   evidence that the citations there are checked too.

## Not measured, and it sizes the task

Whether the completed plans should be frozen wholesale or read case by case.
PLAN-015's citations are the only ones proven stale here; the other 24 resolve,
and resolving is not the same as being right — nothing in this measurement
checked what those lines say.
