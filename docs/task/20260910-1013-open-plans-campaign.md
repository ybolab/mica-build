# 20260910-1013-open-plans-campaign Establish open plans campaign tracking

- **status**: in_progress
- **priority**: P1
- **owner**: bkd/z36xbrtu
- **createdAt**: 2026-09-10 10:13

## Description

Establish the ownership and lifecycle registry for campaign
`mos-open-plans-20260910-100408`, coordinated by L1 issue `#314` / `10nksom6`
against integration branch `main` from committed source base
`5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`.

The approved authorization covers parallel dispatch and handling of the four
bounded workstreams, scoped local L3 commits, and L3-to-L2 merges. It does not
authorize an L2-to-`main` merge, remote push or publication, or a `done`
transition.

Compatibility is outside the campaign scope. Development uses fresh, complete
flashing of the newest image; work must not add historical compatibility
readers, migrations, RAUC restoration, old raw-slot paths, or old
update-package support merely to satisfy historical records.

## ActiveForm

Coordinating the open plans campaign and its documentation lifecycle.

## Ownership Registry

| Workstream | Coordinator | Scope |
|------------|-------------|-------|
| A | `#315` / `6064wf7l` | Board repairs and current hardware acceptance |
| B | `#316` / `8t4ghqi6` | Minimal boot/shutdown and explicit rootfs |
| C | `#317` / `58sdocnk` | Current management feature backlog |
| D | `#318` / `z36xbrtu` | Task/plan reconciliation and global documentation |

External active owner `#313` / `4ay6q72f` retains S905X5M integration work and
the paths `docs/task/20260910-0554-s905x5m-current-system.md` and
`docs/plan/20260910-0559-s905x5m-current-system.md`. Those paths are absent from
this committed base and therefore remain literal references until an approved
handoff supplies their commits.

Each code L3 owns its unique task/detail notes in its isolated branch and uses
the PMA serializer there. Workstream D owns this campaign record and the later
global task/plan index and changelog reconciliation. D must preserve later
committed edits from `#313` and sibling branches and must never reset another
owner's status directly.

## Dependencies

- **blocked by**: (none)
- **blocks**: D2 historical-record reconciliation and D3 final global
  lifecycle reconciliation

## Execution Budget

- Initial active L3 grants: A=2, B=1, C=2, D=1; campaign total at most 6.
- Initial expensive-build grants: A=1, B=0, C=0, D=0; campaign maximum 2,
  with one position reserved while `#313` builds.
- Workstream D performs no full image build.

## Notes

- D1 establishes tracking first. D2 may start only after D1 is merged into
  `bkd/z36xbrtu`. D3 follows D1 and D2 and waits for L1 to supply exact
  approved sibling/`#313` commits plus task/plan evidence.
- Cross-workstream synchronization uses shared local refs only after an L1
  handoff. Unpushed `origin/bkd/*` refs must never be assumed.
- PLAN-037 remains a non-executable umbrella. PLAN-086 section S5 was rejected
  by the user on 2026-09-08 and must not be revived as general shell/network
  tool reduction; the separate BusyBox startup/shutdown plan remains allowed
  without superseding that rejection.
- D2/D3 must investigate the absent indexed
  `cx3576-reproducible-bsp-20260907T1356Z` task and
  `cx3576-reproducible-bsp-20260907T1400Z` plan before restoring or removing
  either record. They must also review open references to removed RAUC/TUF
  paths and reconcile the divergent PLAN-086 task/plan lifecycle while
  preserving its S5 rejection.
- Per-node focused checks and `git diff --check` are required. Final
  reconciliation also requires `make docs-verify`, focused task/plan
  marker-detail lifecycle and link-existence checks, preservation of completed
  recent UI/storage tasks, and explicit pending status for hardware claims
  lacking actual hardware evidence.
- This tracking node does not complete product implementation, image builds,
  hardware proof, or historical reconciliation.
