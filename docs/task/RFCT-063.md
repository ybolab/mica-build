# RFCT-063 Current API/UI surface inventory and the api.md skeleton

- **status**: complete — section 1 is measured and settled; sections 2-9 were left as stubs for sibling tasks
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 15:27
- **claimedAt**: 2026-08-19 15:28
- **completedAt**: 2026-08-19 15:50

Campaign `l1-o7ee8v0o-20260819152142-api` (design proposal, documents only).
Branch `bkd/b1053tnv`, merged by L2 into `bkd/ml2dtd5k` at `074a7d8`.

## Description

The campaign proposes that the management daemon become API-first. Every later
task in it argues about a surface that does not exist yet, which is exactly the
condition under which a design document invents capabilities the product does
not have. This task existed to remove that failure mode **before** the argument
started: measure what `apid` actually is today, cite every claim to `path:line`,
and hand the siblings a skeleton they may fill but not re-decide.

The measurement commit is the campaign base
`86cd669fa71889577f7e1ab1fab0e0e09a463dcf` — *"Merge webd SSH management:
default-off SSH, transient password, persistent keys, /home and /root on
DATA"* — named in `docs/design/api.md:33-35` so that `git show 86cd669:<path>`
settles any later disagreement about a line number.

## Deliverable

`docs/design/api.md`, created. Section 0 and section 1 written in full; sections
2-9 and the `10.x` regions laid down as **30 stub lines** owned by named sibling
tasks. `docs/README.md` indexed the new document and extended the recorded
English-only exception to cover it.

| section | line | subject |
| --- | --- | --- |
| 0 | `docs/design/api.md:12` | How to read the document: status markers, the measurement commit, the `apid`/`webd` path note |
| 1.1 | `:81` | What apid is, and the two constraints that bound every option |
| 1.2 | `:129` | The route table as shipped — two routers, nineteen method+path pairs |
| 1.3 | `:189` | How apid reaches mosd — the zbus proxy and its seven methods |
| 1.4 | `:247` | Authentication as shipped — argon2id, the signed session cookie, the gate |
| 1.5 | `:313` | The settings and state model the API must be derived from |
| 1.6 | `:411` | Static assets today — evidenced four independent ways |
| 1.7 | `:449` | What `dashboard.md` already settled, and where the earlier inventory has gone stale |

## The decision that shaped everything downstream

**Section 1 is not a proposal and is not editable by the tasks that follow.**
`docs/design/api.md:8-10` says so in the document's own status block: *"sections
2-9 are the proposal and are written by sibling tasks; section 1 is not a
proposal at all — it is the measured surface those sections must be derived
from."*

That fence was load-bearing rather than decorative. Sections 0 and 1 —
lines 1-517 — are **byte-identical across all six subsequent merges**, verified
by hash at both ends rather than asserted:

```
$ sed -n '1,517p' docs/design/api.md | sha256sum
d59478d90d7a244e37783686828e9c4ccd98daa1d52336d63af91731e989b70d  -
$ git show 074a7d8:docs/design/api.md | sed -n '1,517p' | sha256sum
d59478d90d7a244e37783686828e9c4ccd98daa1d52336d63af91731e989b70d  -
```

RFCT-067 re-ran that comparison at campaign head `8f1a957` and it still holds.
A future reader deciding whether the inventory can be trusted has the proof,
not the assurance.

## The status-marker convention, adopted rather than invented

The markers come from `docs/design/access.md` §0 (`docs/design/access.md:23-30`)
and are reused in the same bold form, with one substitution: access.md's
**[partial]** is replaced by **[proposed]**, because this document is mostly
asking for code rather than describing code that half-exists
(`docs/design/api.md:14-20`).

access.md's justification is quoted rather than paraphrased, because it is the
reason the discipline is worth its cost: *"dead code has a compiler, a test run
and a grep-for-callers that can surface it; a security control that exists only
as prose has no mechanism that will ever notice it is absent"*
(`docs/design/access.md:33-36`).

Sections 0 and 10 deliberately carry **no** marker — they describe no mechanism,
which is the same exemption access.md states at `docs/design/access.md:40-41`.
That exemption is stated in the document (`docs/design/api.md:26-29`) rather
than left to a reader to infer, which is what let RFCT-067 check marker coverage
mechanically instead of by judgement.

## What section 1 established that later sections could not have invented

- **Two routers, not one.** `app()` at `mosd/webd/src/routes.rs:43-68` and
  `redirect_app()` at `:72-76`. **No route in either matches `/api`**, so the
  API path is unclaimed and `/api/v1` can be introduced without colliding with
  anything (§1.2, and §2.1 depends on it).
- **No CSRF token exists anywhere in the crate.** `grep -ni csrf
  mosd/webd/src/*.rs` returns nothing at `86cd669`; the only mitigations are
  `SameSite=Lax` and a confirmation token on two flows
  (`mosd/webd/src/routes.rs:870`, `:948`). §3.3 and §9 item 8 are both built on
  this measurement.
- **The bus is the only way to mosd, and it declares seven methods and no
  signal** (`mosd/webd/src/bus_client.rs:14-21`). apid therefore has **no push
  notification** of a state change — the constraint that forces §2's polling
  shape and that `dashboard.md` §5.8 had already reasoned from.
- **The built-in UI is not a directory of files.** It is `maud` `html!`
  expansions compiled into the binary, with one inline stylesheet constant and
  **no non-Rust file in the crate other than its manifest** — evidenced four
  independent ways in §1.6. §6.2 and §8.1 both rest on this, and §8.1's option
  A is rejected because of it.

## What this task did NOT settle, and said so

- **`dashboard.md`'s section 9 contradiction table was not re-verified.** §1.7
  closes by recording that explicitly (`docs/design/api.md:515-516`): the table
  is cited, not carried forward. RFCT-068 later relied on that sentence.
- **The six ways `docs/research/mos-ui-inventory.md` has gone stale** were
  named (§1.7, `docs/design/api.md:488-510`) but **not corrected in that file** —
  it belongs to no task here. RFCT-068 was created mid-campaign to close it.
- **No hardware claim.** Nothing in the document has been run on a device; every
  statement about current behaviour is a reading of source
  (`docs/design/api.md:71-74`).

## Scope fence

`docs/design/dashboard.md` belongs to the parallel rename campaign
`l1-o7ee8v0o-20260819152009-apid` and is cited throughout §1.7 and never edited.
Prose says `apid`; path citations say `mosd/webd/...` because that is what
exists at `86cd669`. §0 carries the note and — importantly — the **mechanical
check** that tells a reader which world they are in (`test -d mosd/apid`,
`docs/design/api.md:41-58`), rather than an open-ended promise that a rename is
coming.

No product code changed.
