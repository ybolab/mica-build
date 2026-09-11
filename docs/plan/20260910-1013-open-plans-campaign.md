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

External owner `#313` / `4ay6q72f` retains its completed S905X5M delivery
records at `docs/task/20260910-0554-s905x5m-current-system.md` and
`docs/plan/20260910-0559-s905x5m-current-system.md`. These paths are absent
from the D1 base, so they remain code literals. User-authorized handoff commit
`5d0dca577a782aa707d9530779c4b23f2a7eda31` (tree
`a8b079edc67010b6662b2243a5647950eb7176ef`, parent
`5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`) now supplies the exact approved
source. No repeat approval or full image rebuild is required; no push occurred
or is authorized.

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
   after D1 and D2. Its `#313` source dependency is satisfied by the approved
   identity; reviewed A/B/C handoffs and final ordered evidence remain pending.
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

The same registry records the approved `#313` commit/tree, immutable source
mapping, PMA blob identities, B0 review evidence, and artifact hashes. The
earlier dirty/no-commit state remains timestamped chronology, not current
source status. At D's next safe boundary, L2 may synchronize only the exact
approved commit into its clean branch; active D1 does not sync it. D2 must use
the resulting integrated local `bkd/z36xbrtu` HEAD before implementation.
Automated/offline passes do not satisfy physical-board rows, and pre-commit
dirty-stamped artifacts must not be relabeled as clean-commit outputs.

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
- Treating the earlier dirty-tree snapshot or pre-commit artifact hashes as the
  approved source can contaminate dependent branches; only the exact approved
  commit may be synchronized, and artifacts remain read-only evidence.
- Historical records can accidentally restore unsupported compatibility work
  or imply hardware proof; explicit scope and evidence gates prevent both.

## Scope

D1 changes only the campaign task, plan, their index rows, and the changelog.
It records coordination state; it does not complete product implementation,
build an image, claim hardware proof, reconcile the identified historical
records, synchronize the approved `#313` commit during D1, merge to `main`,
publish remotely, or close the campaign.

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
- At 2026-09-10 10:39 UTC, L1's authorized `#313` commit identity superseded
  the earlier no-commit state for current dependency decisions while retaining
  that prior state as changelog chronology.

## Notes

### D2 reconciliation — 2026-09-10 11:11 UTC

| Record set | Evidence-backed disposition | Remaining dependency |
|------------|-----------------------------|----------------------|
| Two dangling CX3576 rows | Removed: commit `dfe16aca` added index rows only; no detail blob exists, while PLAN-087/RFCT-343/RFCT-345 represent and complete the work. | None; D3 only rechecks global links. |
| PLAN-037 / RFCT-273 | Retained as an implementing, non-executable umbrella owned by `bkd/z36xbrtu`; dated RAUC/TUF wording is historical. | Reviewed A/B/C handoffs before D3. |
| PLAN-086 / RFCT-336 | Retained implementing under B `8t4ghqi6` for S3/S6. S5 remains declined, not deferred or owed. | Ordered B1-B7 execution and handoff. |
| Historical S905X5M RAUC/raw-slot records | Completed, closed, or removed according to recorded evidence; current signed-file task/plan are the replacement pointers. | Fresh newest-image physical ownership and bench inputs remain unresolved. |
| CX3576 current physical records | Retained open; no offline or other-board evidence was promoted to physical proof. | A1/A2/A3, then A4 and D3. |
| C-owned management/trust plans | Retained without racing their reviewed C1/C2 classifications. | C1/C2 reviewed merges, then D3 marker/status normalization. |
| B-owned rootfs findings | Retained pending; current variance belongs to B6, not the obsolete aux-cache premise. | B4/B5 classification and B6/B7 acceptance. |

The full 31-task/21-plan audit, unresolved owner decisions and exact PMA
serializer rejections are recorded in the related campaign task. This plan and
task remain implementing; D3 owns their final lifecycle closure.

### D3 Stage A acceptance-wave tracking — 2026-09-11 UTC

Stage A is a bounded documentation-only continuation authorized before B7 and
the joint freeze are complete. It starts from merged L2 D commit
`5c0015d136c5c8a2a56c7b7c98798359a363cf34`, tree
`beafd207e2334482b6556f143efa902fe81d1049`. The task remains
`in_progress` / `[-]`, owned by `bkd/z36xbrtu`; this plan remains
`implementing` / `[-]`. No serializer transition occurs in this stage.

Existing B7 issue `#332` / `75btxdqb`, branch `bkd/75btxdqb`, is the sole joint
acceptance executor under L2 B `8t4ghqi6`; it is not a new node or hierarchy.
The reviewed inputs are A-final
`e4154126b7e38eb90db210adfb412b19535637a8` (tree
`04de9264c7eb0d190e13852955789ceea7439a71`), C-final
`48acef7f1a3683b1f3bb6261911b1a5123197da2` (tree
`553c1e7af96203315f79e7ea61e862f7a753e3a5`), and B0-B6
`ebdd7208f3c026c96e08d003d9d4f383c22f1eb9` (tree
`4c1e47337dc6e9787864a31dfbcd570aef21e4f5`). A-final and C-final are
satisfied, and B0-B6 is reviewed. B7 is still implementing caller, geometry,
provenance, and acceptance work: caller checkpoint `64387f20` is reviewed;
geometry checkpoint `5ead205523bdeb6a8cf0cb8dc9c35b2c9f47d56d` is observed
but not final reviewed evidence.

Joint freeze `J` does not yet exist. It must be the real clean commit/tree
created only after B7 finishes and reviews its source, synchronizes reviewed
local B, merges the exact local A and C inputs with explicit `--no-ff`, resolves
only authorized mechanical index/import/test unions, and obtains review for any
minimal integration correction. A, C, and reviewed B7 source must all be
ancestors of `J`; no placeholder is permitted.

The one-`J` acceptance wave is fixed: one fresh x64 image with a 1 GiB SYSTEM;
one final virt-arm64 image using ordinary cold root run 1 plus exactly one
independent equal-input no-cache cold root run 2; and one joint CX3576 image
that reuses A kernel/firmware only after complete input equality while
rebuilding changed dependent root, boot, signature, record, and image phases.
There is no new S905X5M image or eMMC installer. Every reuse/rebuild decision
needs board- and architecture-specific input and provenance records.

B7 may use at most two independent expensive jobs when resources permit. This
replaces the former A1/B1 blanket heavy serialization without creating a new
L3. Long jobs remain in persistent tmux with source-bound metadata and
event-driven collection.

Compatibility support remains out of scope. C's reviewed offline
`FLEET-CONFIG` production inputs are required in `J`, but the delivered fleet
protocol is DESIGN only. Client/server fleet runtime, cloud deployment,
credentials/command channel, curated OCI activation, publication, and `main`
integration are not authorized.

A's prior current-A image stays historical `PASS_WITH_EXECUTOR_LIMITATION` and
must not be relabeled as `J`. A retains physical CX3576 and S905X5M bench rows,
including exact-image install/boot, lifecycle, watchdog/recovery, externally
timed publication/record-boundary power cuts, HDMI/VT, named NPU/VENC/VDEC and
peripheral fixtures, native crun on capable S905X5M hardware, and the
original-device authenticated apid reboot. B7 supplies the joint software
image/provenance inputs. Late-HDMI restoration remains unimplemented, and no
automated evidence qualifies these physical rows.

The exact power-cut matrix independently cuts storage power at download/offline
import, destination object write and file sync, object directory publication,
candidate activation, attempt decrement, health confirmation and garbage
collection, and redundant record write. It requires at least ten cuts per
installation/activation boundary and fifty randomized redundant-record writes,
with the actual boundary side recorded; an unknown boundary is inconclusive.
CPU-only or process-only interruption does not qualify.

Final D3 reconciliation remains blocked on a reviewed real `J`, B7 final
evidence, and formal B-final evidence. L2 D will wake this same issue for the
original global reconciliation and result append after that exact handoff; the
campaign task and plan cannot complete during Stage A.
