# MOS tasks

> Updated: 2026-09-12

## Usage

Each task is a single line linking to its detail file. All detailed information lives in `docs/task/<timestamp>-<feature-slug>.md`.

### Format

- [ ] [**20260907-1428-add-endpoint Add endpoint**](20260907-1428-add-endpoint.md) `P1`

### Status Markers

| Marker | Meaning | Record status head |
|--------|---------|--------------------|
| `[ ]`  | Pending | `pending` |
| `[-]`  | In progress | `in_progress` |
| `[x]`  | Completed | `completed` |
| `[~]`  | Closed / Won't do | `closed` |

Each record's front matter carries a status line of the shape
`- **status**: <head>` or `- **status**: <head> — <free detail>`, where
`<head>` is exactly one of the four heads above and the detail after ` — ` is
free text. Nothing in this tree enforces that the record and its marker agree: the
repository has no `scripts/` directory, and the `task-state.sh` serializer
that keeps them in step ships with the PMA skill, not here, so a hand edit
can still move one without the other. They had drifted apart five times
by 2026-09-07 (RFCT-305, 310, 315, 335 and UI-011 were all marked `[x]` while
their own records said in progress or pending). Read the record, not the row.

### Priority: P0 (blocking) > P1 (high) > P2 (medium) > P3 (low)

### Rules

- Update or delete task entries and their detail files as needed; keep them
  consistent.
- Record change history and deletion reasons in `docs/changelog.md`; update
  affected task and plan references.
- New tasks append to the end.
- **New records are named `<timestamp>-<feature-slug>.md`** — the creation
  time in UTC at minute precision as `YYYYMMDD-HHmm` (no `T`, no `Z`), then a
  lowercase kebab-case slug. No sequence number is allocated. Existing
  numbered `RFCT-NNN` files remain valid and are not renamed.
- See each detail file for full details.
- **A completed task's record is deleted, and its line goes with it.** This
  index is a list of what is left, not a history of what was done. A finished
  task lives in git history: `git log --diff-filter=D -- docs/task/` lists
  every record that has left, and `git show <commit>^:docs/task/RFCT-NNN.md`
  prints one back. `docs/verify-index.sh` and `docs/verify-links.sh` both
  exclude this directory, and say so in their own headers, so a deleted record
  breaks no gate.
- **The record's own `status` head is authoritative; the marker summarises it.**
  Where the two disagreed, the record won -- see the note above; five rows were
  marked `[x]` over records that said otherwise, and deleting on the marker
  alone would have destroyed work still in flight.
- **A citation to a deleted task stays as text, not as a link** --
  `RFCT-281`, not `[RFCT-281](RFCT-281.md)`. The name survives so the reason
  can be found in history; the link does not, because it would point at
  nothing.

Until 2026-09-07 this section read "Only update the checkbox marker; never
delete the line", inherited verbatim from the PMA skill's `task-format.md`.
It was removed rather than reworded, for the reason given in
`docs/plan/index.md`: completed records have been leaving this tree since
PLAN-001, and a rule the tree disobeys on sight teaches a reader the wrong
thing about the tree. Both indexes now say the same thing.

---

## Tasks

- [ ] [**RFCT-290 Design conditional fleet management**](RFCT-290.md) `P2`
- [-] [**RFCT-305 Gate A mechanisms: the trust grade, the device surface and the publication refusal**](RFCT-305.md) `P1`
- [-] [**RFCT-310 The host toolchain lint and the container-only build policy**](RFCT-310.md) `P1`
- [-] [**RFCT-315 PLAN-070 F7/F8/F9: the client reads the baked anchor**](RFCT-315.md) `P1`
- [ ] [**UI-011 Stabilize Bun V8 coverage aggregation**](UI-011.md) `P1`
- [-] [**RFCT-336 Compose a minimal MOS runtime from explicit payloads**](RFCT-336.md) `P1`
- [ ] [**RFCT-922 Exercise s905x5m Bluetooth pairing and a profile with a controlled peer**](RFCT-922.md) `P1`
- [-] [**RFCT-941 The installer reinstalls on every boot because its receipt never persists**](RFCT-941.md) `P1`
- [ ] [**20260908-2011-state-units-never-load STATE-seeded systemd units never load on first boot**](20260908-2011-state-units-never-load.md) `P2`
- [ ] [**20260908-2011-ssh-generator-vs-image-policy systemd-ssh-generator overrides the image's SSH policy and port**](20260908-2011-ssh-generator-vs-image-policy.md) `P2`
- [ ] [**20260908-2011-wtmp-unbounded-append Login accounting appends to /var/log/wtmp without a bound**](20260908-2011-wtmp-unbounded-append.md) `P2`
- [-] [**20260910-0025-cx3576-boot-log-cleanup Resolve cx3576 boot configuration mismatches and verify runtime handoff**](20260910-0025-cx3576-boot-log-cleanup.md) `P1`
- [ ] [**20260910-0117-cx3576-late-hdmi-logo Restore the CX3576 boot logo after late HDMI attachment**](20260910-0117-cx3576-late-hdmi-logo.md) `P2`
- [-] [**20260910-1206-b3-bounded-exitrd-teardown B3 bounded exitrd teardown**](20260910-1206-b3-bounded-exitrd-teardown.md) `P1`
- [-] [**20260911-1925-boot-artifact-size Shrink the signed boot artifact: compression and early-userspace closure**](20260911-1925-boot-artifact-size.md) `P1`
- [-] [**20260911-2003-split-package-repositories Split the tree into an assembly repository and independently released package repositories**](20260911-2003-split-package-repositories.md) `P1`
- [x] [**20260912-1329-arm64-board-builds ARM64, CX3576 and S905X5M builds**](20260912-1329-arm64-board-builds.md) `P1`
- [x] [**20260912-1341-prune-settled-records Prune the settled plan and task records**](20260912-1341-prune-settled-records.md) `P2`
- [-] [**20260912-1347-root-closure-reduction Reduce the read-only root closure**](20260912-1347-root-closure-reduction.md) `P2`
- [-] [**20260912-2043-unify-board-behavior Unify board build, compression and acceptance behavior**](20260912-2043-unify-board-behavior.md) `P1`
