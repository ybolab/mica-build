# 20260912-2049-docs-restructure Restructure the documentation system

- **status**: completed
- **createdAt**: 2026-09-12 20:49
- **approvedAt**: 2026-09-12 20:57
- **relatedTask**: 20260912-2049-docs-restructure

## Context

Audit snapshot: `e630c76f` plus the uncommitted `README.md` rename to Mica OS.
`docs/` holds 151 files (about 35,000 Markdown lines). `make docs-verify`
passes (index 195, links 520, status 721, zh coverage 249, board 131), but
those gates check structure and path existence only; they exclude
`docs/plan/` and `docs/task/` and never check whether a claim is still true.

### A. Tracking layer (plan, task, changelog, decisions, reports)

1. **Index rules contradict `/pma`.** Both indexes say completed records and
   their index lines are deleted, while `/pma` keeps index lines permanently
   and marks deleted details `[d]`. `CLAUDE.md` makes `/pma` authoritative,
   and no `docs/decisions/` record covers the divergence. The index headers
   also carry long historical narrative (drift counts, prune commit hashes).
2. **The indexes violate their own rule.** `[x]` rows remain
   (`20260912-1329-arm64-board-builds`, `20260912-1341-prune-settled-records`,
   `20260910-1910-fleet-device-plane-protocol`).
3. **Non-canonical status values.** Tasks: `implementing` (RFCT-310),
   `in-progress (…)` (RFCT-315), `fixed and proven on hardware …` (RFCT-941).
   Plans: `approved` under a `[ ]` marker (PLAN-054/069/070/071/072/076),
   `proposed` (PLAN-077), `in_progress` (boot-artifact-size), and an `owner`
   field on PLAN-912.
4. **Stale in-progress owners.** RFCT-305/310/315/336 are owned by old
   `bkd/…` campaign sessions that no longer exist.
5. **Records written against the removed RAUC/TUF/raw-slot system.**
   PLAN-037, PLAN-054, PLAN-070, PLAN-071, PLAN-072, PLAN-076, PLAN-077,
   PLAN-086, RFCT-305, RFCT-315 and RFCT-941 cite `pkgs/rauc-sign`,
   `rauc-update`, `/etc/rauc/keyring.pem`, TUF metadata or slot updates;
   none of those exist. The 2026-09-12 audit report already classifies
   PLAN-070/071 and RFCT-310/UI-011 as delivered or replaced, but the
   records stay open.
6. **`docs/reports/` is outside `/pma` layout** and already stale (72 plans,
   116 tasks, RFCT-334 and the fixed `-j2` limits are no longer current).
7. **Changelog format is mixed and unordered.** Top entries are not
   chronological (20:43, 14:31, 14:24, 20:35); from line 219 entries switch
   to `## Title (date)` headings.
8. **`decisions/README.md` says "Recorded so far: none"** although
   `2026-09-10-bounded-lifecycle-ioctl.md` exists, and it defines decisions
   only as skill divergences, while that record is an engineering decision
   carrying campaign metadata (`L1`, `L2 B`, campaign ID).

### B. Entry points and naming

1. **Brand split.** `README.md` now says Mica OS (`mica`, micaos.dev); every
   document under `docs/` (including website copy) still says `mos`. The split
   plan renames repositories to `mica-*` while package, binary and bus names
   stay `mos-*`/`com.mos.*`; no document states that naming rule.
2. **`docs/README.md` cites a deleted delivery record**
   (`20260908-2229-file-ab-delivery-x64-first`) as the acceptance source, and
   its catalog descriptions are stale (`remote-management.md` "no design"
   although the fleet protocol plan is completed).
3. **Board status is stated in at least six places with different answers.**
   `README.md`: targets are x64, virt-arm64, cx3576. `architecture.md` §7:
   four boards including s905x5m with signed FIT. `design/build.md` §4:
   s905x5m "not a current MOS system-image release target". `board.env`:
   `BOARD_RELEASE_TARGET` is 1 only for x64 and cx3576. `bsp/support-tiers.md`,
   `bsp/qualification.md`, `website/embedded.md` and `website/support.md`:
   "the one dossier on file", while three dossiers exist.
4. **`architecture.md` repository map is incomplete**: no `shared/`, `meta/`,
   `meta.example/`, `update-server/`; `rootfs/` omits `debian/`, `overlay/`,
   `runtime/`, `scripts/`; no repository-split section.

### C. Engineering records (`design/`)

1. **Broken language switches.** `boards/contract.md`, `design/mosd.md` and
   `design/remote-management.md` link "中文" to themselves.
2. **Stale translations.** `zh/design/` holds seven translations older than
   their English sources (connd zh 2026-08-29 vs en 2026-09-08) although
   `docs/README.md` and `zh/README.md` say superseded engineering translations
   were removed. `zh/design/built-in-ui-design.md` has no English source and
   is linked from `design/dashboard.md`.
3. **Permanent documents cite deleted records by ID** (PLAN-070 ×7 in
   `mosd.md`, PLAN-044/RFCT-280 in `time.md`, PLAN-088/089 and RFCT-359 in
   `bsp/cx3576-bench.md`, RFCT-941/942/945 in `bsp/s905x5m.md`, PLAN-042/054
   in website briefs). The rationale behind the ID is unreachable from the tree.
4. **Misnamed or overlapping records.** `connd.md` documents a process that
   does not exist; `boards.md` and `bsp-cx3576-sync.md` belong to the board set
   in `bsp/`; `remote-management.md` and `access.md` overlap on channels;
   `build-harness.md` overlaps `build/HARNESS.md` and `verify/HARNESS.md`.
5. **Citation noise and chronology.** `remote-management.md` appends
   `(docs/design/access.md)` after almost every clause; several records keep
   test transcripts and campaign chronology that the README says belong in
   delivery records (e.g. `bsp/cx3576-bench.md`, 1,048 lines).

### D. User and website copy

1. **Old storage vocabulary.** `user/configuration.md`, `user/applications.md`,
   `user/manufacturing.md` and `boards/cx3576.md` use STATE and
   "system slots"; `architecture.md` and `design/storage.md` use
   ESP/SYSTEM/DATA with `DATA/state`.
2. **`website/embedded.md` "Bounded flash" and "Field recovery"** describe
   two system slots, update-metadata and configuration partitions, and boot
   credits, all marked `status: shipped`. The gate passes because the cited
   evidence paths exist.
3. **`status: proposed` requires a file under `docs/plan/`**, coupling
   permanent user copy to transient tracking records.

### E. Tooling inside `docs/`

Gate scripts and tests live in `docs/`, `docs/zh/` and `docs/boards/`
(`verify-*.sh`, `verify-board*.sh`, `verify-coverage*.sh`), and a bench
collector (`bsp/cx3576-bench-collect.sh`) sits in docs while its test lives in
`tests/cx3576-bench/`.

## Proposal

Principles: one owner per fact; permanent documents describe only the current
system, with no chronology or deleted-record IDs; tracking records follow
`/pma` exactly; no compatibility shims, redirects or old-name aliases.

### Target layout

```text
docs/
├── README.md          reading paths and the gated catalog; no status narrative
├── architecture.md    system map, naming rule, repositories, board matrix pointer
├── changelog.md       /pma entries only, newest first
├── decisions/         dated decisions; README distinguishes skill divergences from engineering decisions
├── design/            engineering contracts (connd.md renamed wifi.md; boards content moved out)
├── boards/            was bsp/ + boards/contract.md + boards/cx3576-bsp-sync.md; owns the single board status matrix
├── user/              operator and integrator guides
├── website/           publication copy for micaos.dev
├── research/          measurements and external references
├── plan/  task/       /pma tracking
└── zh/user/           Chinese user guides only (plus explicitly requested Chinese briefs)
tools/docs/            all docs gate scripts and their tests
```

`docs/reports/` is removed after its open findings become tasks.

### Phases

1. **Tracking** — rewrite both index headers to the `/pma` templates;
   normalize every status value; mark `[x]` rows per `/pma` (keep lines);
   triage stale records as below; move the report's open findings into tasks
   and delete `reports/`; normalize and reorder the changelog; rewrite
   `decisions/README.md` and strip campaign metadata from the ioctl record.
   Verify: new tracking gate passes; `task-state.sh` accepts every record.
2. **Structure** — move files to the target layout, move gate scripts to
   `tools/docs/` and the bench collector to `tests/cx3576-bench/`, update the
   `Makefile`, CI workflow and all links. Verify: `make docs-verify`,
   `make docs-verify-test`.
3. **Content** — apply the Mica OS naming rule to prose; make
   `boards/` the only board status source and replace other statements with
   links; replace STATE/slot vocabulary with ESP|FIRMWARE/SYSTEM/DATA and
   `DATA/state`; rewrite `website/embedded.md` storage and recovery sections;
   update `docs/README.md` intro and catalog; remove deleted-record IDs from
   permanent documents (inline the rationale or drop it); fix language
   switches; complete the `architecture.md` repository map; trim citation
   noise and chronology. Verify: term lint below, `make docs-verify`.
4. **Gates** — add a tracking check (index row ↔ detail file, canonical
   status values, marker ↔ status agreement, plan `relatedTask` exists);
   add a stale-term lint for permanent docs (`RAUC`, `TUF`, `raw-slot`,
   `STATE` as a partition, `boot credits`, deleted-record IDs); replace the
   `proposed` rule with "names an open plan or task". Verify: each check has a
   negative fixture in `make docs-verify-test`.

### Stale record triage (Phase 1)

| Record | Disposition |
|---|---|
| PLAN-037 roadmap umbrella | close (`[~]`); superseded by current plans |
| PLAN-054, PLAN-072, PLAN-076, RFCT-290 fleet | close; one new fleet-runtime task based on `20260910-1910-fleet-device-plane-protocol` |
| PLAN-069 managed applications | close; `design/applications.md` owns the design; new task when scheduled |
| PLAN-070 meta seam, PLAN-071 automatic updates, RFCT-310 build policy, UI-011 coverage | complete; residual acceptance (auto-update scenarios, fixed `-j` limits) becomes new tasks |
| PLAN-077, RFCT-305, RFCT-315 RAUC/TUF trust | close; production key custody becomes one new task against current signing |
| PLAN-086, RFCT-336 runtime composition | close; covered by root-closure-reduction and boot-artifact-size |
| RFCT-941 installer receipt | close; installer path removed |
| three 20260908-2011 tasks | keep; rewrite as "implemented, specific acceptance outstanding" |
| PLAN-912, RFCT-922, cx3576 records, active 2026-09-11/12 records | keep; normalize status only |

Every closure gets one changelog entry naming the record and its replacement.

## Risks

- Moves touch paths cited by the `Makefile`, `.github/workflows/check.yml`,
  code comments and READMEs outside `docs/`; missed references break CI or
  leave dead prose. Mitigation: repository-wide `rg` for every moved path.
- Closing records other sessions still own. The owners are stale campaign
  sessions; closing needs the user's confirmation per `/pma` staleness rules.
- Active plans (`split-package-repositories`, `unify-board-behavior`,
  `root-closure-reduction`) edit the same documents; restructure first or
  rebase their text after.
- Rewriting board and storage claims can introduce new false claims; each
  rewritten `status: shipped` line must be checked against source.

## Scope

About 120 files: all of `docs/`, gate scripts, `Makefile`, `check.yml`,
`AGENTS.md` documentation entry points, and a few READMEs and comments outside
`docs/` that cite moved paths. No product code or behavior changes.

## Alternatives

- **Content fixes only, keep the layout.** Less churn, but tooling stays in
  `docs/`, board facts stay split between `design/` and `bsp/`, and the gates
  still cannot see tracking drift.
- **Record a divergence and keep delete-on-complete tracking.** Keeps indexes
  short, but contradicts the `/pma` authority `CLAUDE.md` names and loses the
  index as a history pointer.
- **Move `website/` to its own repository now.** Cleaner ownership, but it
  depends on the micaos.dev site repository, which does not exist yet.

## Annotations

Approved 2026-09-12 20:57 with all five decisions accepted:

1. Prose uses "Mica OS"; `mos-*` packages, `com.mos.*` bus names and paths
   stay unchanged until the split plan decides otherwise.
2. Tracking follows `/pma` as written (permanent index lines, `[d]`).
3. Delete the seven `zh/design/` translations and `zh/research/`; keep
   `zh/design/built-in-ui-design.md` as a requested Chinese brief.
4. Close and clean up the stale records in the triage table: deleted details
   are marked `[d]` and summarized in the changelog.
5. `website/` stays at `docs/website/`.

Delivered as proposed. Additional findings fixed in scope: `virt-arm64.md`
claimed `BOARD_RELEASE_TARGET=1` against `board.env`'s `0`; `diagnostics.md`
described slot-era snapshot fields and old schema versions; the root README
linked a deleted delivery task. Out of scope and tracked:
20260912-2125-source-record-citations and 20260912-2125-api-slot-vocabulary.
