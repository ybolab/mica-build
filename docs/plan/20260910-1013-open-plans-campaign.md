# 20260910-1013-open-plans-campaign Coordinate the open plans campaign

- **status**: implementing
- **createdAt**: 2026-09-10 10:13
- **approvedAt**: 2026-09-10 10:13 UTC
- **relatedTask**: 20260910-1013-open-plans-campaign

## Context

Campaign `mos-open-plans-20260910-100408` is coordinated by L1 issue `#314` /
`10nksom6`. Its integration branch is `main`, and every workstream starts from
committed source base `5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`.

The user authorized dispatch and parallel handling of all four bounded
workstreams, scoped local L3 commits, and L3-to-L2 merges. That authorization
does not cover an L2-to-`main` merge, remote push or publication, or a `done`
transition.

Compatibility is deliberately out of scope during development. Acceptance is
against a fresh, complete flash of the newest image; no historical
compatibility reader, migration, RAUC restoration, old raw-slot path, or old
update-package support may be introduced to satisfy an obsolete record.

PLAN-037 remains a non-executable umbrella rather than duplicate executable
work. The user rejected PLAN-086 section S5 on 2026-09-08, so this campaign must
not revive general shell/network-tool reduction. A separate BusyBox
startup/shutdown plan is allowed and does not supersede that rejection.

## Proposal

### Ownership

| Workstream | Coordinator | Bounded responsibility |
|------------|-------------|------------------------|
| A | `#315` / `6064wf7l` | Board repairs and current hardware acceptance |
| B | `#316` / `8t4ghqi6` | Minimal boot/shutdown and explicit rootfs |
| C | `#317` / `58sdocnk` | Current management feature backlog |
| D | `#318` / `z36xbrtu` | Task/plan reconciliation and global documentation |

External owner `#313` / `4ay6q72f` retains its completed S905X5M dirty-delivery
records at `docs/task/20260910-0554-s905x5m-current-system.md` and
`docs/plan/20260910-0559-s905x5m-current-system.md`. These paths are absent
from the committed base, so they remain code literals. Implementation and
offline acceptance were reported complete, but 108 delivery changes remain
dirty and unstaged on `main`; no approved commit/tree handoff exists.

Each code L3 owns unique task/detail notes in its isolated branch and performs
its lifecycle changes with the PMA serializer. D owns the campaign record and
eventual global task/plan index and changelog reconciliation. D preserves
later committed edits from `#313` and sibling branches and never resets another
owner's status directly.

### Execution and dependencies

1. D1 establishes this task, plan, stable L2 ownership, and changelog record.
2. D2 investigates and reconciles stale or dangling historical records only
   after D1 is merged into `bkd/z36xbrtu`.
3. D3 performs final global index, changelog, and lifecycle reconciliation
   after D1 and D2, and only after L1 supplies exact approved sibling/`#313`
   commits and task/plan evidence.
4. Cross-workstream synchronization uses shared local refs only after an L1
   handoff; unpushed `origin/bkd/*` refs are never assumed.

Initial active campaign L3 grants are A=2, B=1, C=2, and D=1, with at most six
in total. Initial expensive-build grants are A=1, B=0, C=0, and D=0, with a
campaign maximum of two and one position reserved while `#313` builds. D does
not perform a full image build.

After `#313` reported no remaining heavy work, the reserved expensive position
returned to L1's unallocated pool. Expensive grants remain A=1 and B/C/D=0
until specifically reassigned; active L3 grants remain A/B/C/D=2/1/2/1.

### Coordination evidence

The [campaign task registry](../task/20260910-1013-open-plans-campaign.md)
records the exact A/B/C node ownership, models, dependencies, owned record
paths, capacity use, and evidence boundaries supplied during D1. At the
2026-09-10 10:14–10:15 UTC snapshot, all four unique L2 15-minute crons were
enabled and nondeleted: A `gf4aphxr`, B `nkglvdlt`, C `w8lj5nbz`, and D
`v2kr5k8p`. Running and todo labels are observations at that timestamp, not
completion claims.

The same registry records `#313` source and artifact hashes as read-only dirty
build evidence. D3 and B1 remain blocked on the exact L1-approved committed
identity; A may use the evidence only in its existing bounded acceptance work.
Automated/offline passes do not satisfy physical-board rows, and dirty artifacts
must not be relabeled as clean-commit outputs.

D2/D3 obligations, not D1 changes, include investigating the missing indexed
`cx3576-reproducible-bsp-20260907T1356Z` task and
`cx3576-reproducible-bsp-20260907T1400Z` plan before either row is restored or
removed; reviewing open records that may cite removed RAUC/TUF paths; and
reconciling the divergent PLAN-086 task/plan state without reviving S5.

### Verification

- Every node runs focused checks and `git diff --check`.
- D1 runs `make docs-verify` and checks both new links and both marker/detail
  status pairs.
- D3 runs final `make docs-verify` plus focused task/plan marker-detail
  lifecycle and link-existence checks.
- Recent completed UI/storage tasks remain completed.
- Hardware claims require actual hardware evidence and remain explicitly
  pending when that evidence is absent.

## Risks

- Parallel merges can overwrite later task ownership or completion evidence;
  the handoff and preserve-not-reset rules prevent that loss.
- Treating remote-tracking refs as local handoffs can consume stale or absent
  commits; only L1-approved shared local refs are admissible.
- Treating dirty `main` or `#313` artifact hashes as a committed source handoff
  can contaminate dependent branches; both remain read-only evidence.
- Historical records can accidentally restore unsupported compatibility work
  or imply hardware proof; explicit scope and evidence gates prevent both.

## Scope

D1 changes only the campaign task, plan, their index rows, and the changelog.
It records coordination state; it does not complete product implementation,
build an image, claim hardware proof, reconcile the identified historical
records, merge to `main`, publish remotely, or close the campaign.

## Alternatives

- Reusing PLAN-037 as executable work was rejected because it remains an
  umbrella and would duplicate ownership.
- Directly editing another worker's lifecycle state was rejected in favor of
  isolated branch ownership and PMA serializer transitions.
- Restoring compatibility paths to make historical records read cleanly was
  rejected because current fresh-image development is the acceptance target.

## Annotations

- The full-tier proposal and parallel dispatch charter were approved at
  `2026-09-10 10:13 UTC` before D1 implementation began.
- The user's compatibility direction is controlling for this campaign: no
  compatibility guarantee is required unless explicitly requested later.
