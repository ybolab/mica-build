# RFCT-068 Anchor mos-ui-inventory.md as a measurement at a time

- **status**: completed — the document is anchored, not re-measured and not superseded; the decision between those three is the substance of this record
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 15:54
- **claimedAt**: 2026-08-19 15:55
- **completedAt**: 2026-08-19 16:04

Campaign `l1-o7ee8v0o-20260819152142-api` (design proposal, documents only).
Branch `bkd/40qriio4`, merged by L2 into `bkd/ml2dtd5k` at `f7fffbd`.
Added **mid-campaign**, running in parallel with RFCT-064 and RFCT-065.

## Description

RFCT-063's §1.7 established that `docs/research/mos-ui-inventory.md` measured
the tree at `d0bcae92656257021bb67bf7db72b8ac5bfb4651` and has since gone stale
in six named ways — but §1.7 could only *record* that, because the research
document belonged to no task in the campaign. Read on its own, that document
still presents itself as a description of the current system, in the present
tense, with line numbers that no longer resolve.

This task was created to close that gap. **It is the only task in the campaign
that edits a file other than `docs/design/api.md`.**

## Deliverable

`docs/research/mos-ui-inventory.md` — a new section 0,
*"Status of this document — a snapshot at `d0bcae9`, not maintained"*
(`docs/research/mos-ui-inventory.md:5`). **The body is otherwise unchanged and
no drift is corrected in it**, deliberately.

The header carries four things:

1. The commit measured, and that the document is a snapshot and **is not
   maintained** — stated as a decision, with its reason, not as neglect.
2. A forward pointer: the current surface lives in `docs/design/api.md` §1 as
   measured at `86cd669`, and a reader who needs the routes, the bus surface or
   the settings model *as they now are* **goes there, not here**.
3. The six drifts, named individually, carried across from `api.md` §1.7 with
   the fact at `86cd669` beside each — plus the one further item §1.7 records
   outside the six (the navigation-bar count, off by one).
4. The `apid` rename, with the mechanical check that settles it
   (`test -d mosd/apid`); body occurrences of `webd` are left as measured.

## The decision, which is the point of this record

Three options existed and the record must carry why the chosen one won, because
"added a staleness header" describes the diff and loses the decision.

**Re-measure it.** Rejected. Re-measuring on every merge is **unbounded work
with no completion condition** — the tree moves again the following week and the
same drifts reappear. It is a treadmill, not maintenance. The header says so in
the document itself (`docs/research/mos-ui-inventory.md:12-16`).

**Declare it superseded.** Rejected, and this is the less obvious half. The
document's value was never only the inventory. Its §9 recorded **six
doc-versus-code contradictions**, they were routed onward, and the design
documents now carry dated corrections that trace back to them:

| §9 row | correction now in the tree |
| --- | --- |
| row 5 — `webd` is not a WebSocket bridge | `docs/design/mosd.md:41-46` |
| row 6 — the settings path | `docs/design/mosd.md:58-62` |
| row 1 — the `SshdReconciler` subtree | `docs/design/mosd.md:183-195` |
| rows 2 and 3 — the device password authenticates nothing | `docs/design/provisioning.md:141` |

**It is the traceable record of why `access.md` and its siblings changed.**
Superseding it would delete the answer to "why does this document say that?"
while saving nothing. The header states the principle directly: *"An anchor is
not a retraction."*

**Anchor it.** Chosen. The measurement was correct when taken and remains valid
as history; what was wrong was only the implied present tense. Anchoring fixes
exactly that and costs one section.

## Its own section 8 request, answered in place

`docs/research/mos-ui-inventory.md` §8 asked to be **re-measured after the
`sshweb` merge** (`:536-560`). That merge is precisely this campaign's base
commit `86cd669`, so the request was live and addressed to nobody.

It is answered in the document, **by anchoring rather than by re-measuring**,
with the reason given. Leaving a standing request that the project has decided
not to honour is how a document acquires a second, quieter kind of staleness —
one that no drift list would catch.

## What it did NOT do

- **No drift in the body is corrected.** The body stays as measured at
  `d0bcae9`; correcting it in place would destroy the property the header
  asserts.
- **No re-verification of §9's contradiction table.** The header is explicit
  that those citations are *"the current text of those documents, not a
  re-verification of the code beneath them"*, and points at `api.md` §1.7's
  matching statement (`docs/design/api.md:515-516`).
- **§10's list of what the measurement never verified** is left standing as
  still true of that measurement.

## The coupling this created, and the check it needs

The header's six drifts are **carried across from `api.md` §1.7**
(`docs/design/api.md:488-510`), so the two lists must agree or the campaign has
reproduced the exact failure it was guarding against. RFCT-067's consistency
pass compares them item for item; at campaign head `8f1a957` they agree, and
§1.7 has been byte-identical since `074a7d8`, which is what makes the citation
stable.

## Scope fence

`docs/design/api.md` was **not** edited by this task — it is cited. Files owned
by campaign `l1-o7ee8v0o-20260819152009-apid` were not touched.

No product code changed.
