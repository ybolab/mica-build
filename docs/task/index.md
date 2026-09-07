# NAS Appliance Refactor - Task List

> Updated: 2026-09-07

## Usage

Each task is a single line linking to its detail file. All detailed information lives in `docs/task/PREFIX-NNN.md`.

### Format

- [ ] [**PREFIX-001 Short imperative title**](PREFIX-001.md) `P1`

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
free text. Nothing in this tree enforces that the record and its marker agree:
there is no `scripts/` directory, and the `task-state.sh` serializer this
paragraph used to describe does not exist. They had drifted apart five times
by 2026-09-07 (RFCT-305, 310, 315, 335 and UI-011 were all marked `[x]` while
their own records said in progress or pending). Read the record, not the row.

### Priority: P0 (blocking) > P1 (high) > P2 (medium) > P3 (low)

### Rules

- New tasks append to the end.
- See each `PREFIX-NNN.md` for full details.
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

- [-] [**RFCT-273 Coordinate the embedded delivery roadmap**](RFCT-273.md) `P1`
- [ ] [**RFCT-290 Design conditional fleet management**](RFCT-290.md) `P2`
- [-] [**RFCT-305 Gate A mechanisms: the trust grade, the device surface and the publication refusal**](RFCT-305.md) `P1`
- [-] [**RFCT-310 The host toolchain lint and the container-only build policy**](RFCT-310.md) `P1`
- [-] [**RFCT-315 PLAN-070 F7/F8/F9: the client reads the baked anchor**](RFCT-315.md) `P1`
- [ ] [**UI-011 Stabilize Bun V8 coverage aggregation**](UI-011.md) `P1`
- [-] [**RFCT-335 Add a generic virtual arm64 board, bootable in QEMU**](RFCT-335.md) `P1`
- [-] [**RFCT-336 Compose a minimal MOS runtime from explicit payloads**](RFCT-336.md) `P1`
