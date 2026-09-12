# MOS plans

> Updated: 2026-09-12

## Usage

Each plan is a single line linking to its detail file. All detailed information lives in `docs/plan/<timestamp>-<feature-slug>.md`.

### Format

- [ ] [**20260907-1440-add-endpoint Add endpoint**](20260907-1440-add-endpoint.md) `YYYY-MM-DD`

### Status Markers

| Marker | Meaning | Plan status heads |
|--------|---------|-------------------|
| `[ ]`  | Draft / Pending review | `draft` |
| `[-]`  | Approved / Implementing | `implementing` |
| `[x]`  | Completed | `completed` |
| `[~]`  | Rejected / Abandoned | `rejected` |

### Rules

- Update or delete plan entries and their detail files as needed; keep them
  consistent.
- Record change history and deletion reasons in `docs/changelog.md`; update
  affected task and plan references.
- New plans append to the end.
- **New records are named `<timestamp>-<feature-slug>.md`** — the creation
  time in UTC at minute precision as `YYYYMMDD-HHmm` (no `T`, no `Z`), then a
  lowercase kebab-case slug. No sequence number is allocated. Existing
  numbered `PLAN-NNN` files remain valid and are not renamed.
- See each detail file for full details.
- **A completed plan's record is deleted, and its line goes with it.** This
  index is a list of what is left, not a history of what was done. A finished
  plan lives in git history: `git log --diff-filter=D -- docs/plan/` lists
  every record that has left, and `git show <commit>^:docs/plan/PLAN-NNN.md`
  prints one back. `docs/verify-index.sh` and `docs/verify-links.sh` both
  exclude this directory, and say so in their own headers, so a deleted record
  breaks no gate.
- **The record's own `status` head is authoritative; the marker summarises it.**
  Where the two disagreed, the record won. Check both before deleting anything:
  PLAN-080 (`implementing`) and PLAN-085 (`draft`) were each marked `[x]` here,
  and deleting on the marker alone would have destroyed two live designs.
- **A citation to a deleted plan stays as text, not as a link** --
  `PLAN-049`, not `[PLAN-049](PLAN-049.md)`. The name survives so the reason
  can be found in history; the link does not, because it would point at
  nothing. This is already the house style: before this change 234 of the 239
  `PLAN-NNN` mentions in the shipped trees were bare names.

Until 2026-09-07 this section read "Only update the checkbox marker; never
delete the line". It was inherited verbatim from the PMA skill's
`plan-format.md` and had already been contradicted by five prune commits
(`ab0e650c`, `32f6a453`, `7c78a89a`, `1b31a6c0`, `3a5e52c3`); `1b31a6c0` put
the real norm plainly -- "Completed records leave the tree, as PLAN-001..029
did before them". It was removed rather than reworded because a rule the tree
disobeys on sight teaches a reader the wrong thing about the tree.

---

## Plans

- [-] [**PLAN-037 Coordinate the embedded delivery roadmap**](PLAN-037.md) `2026-08-31`
- [ ] [**PLAN-054 Design conditional fleet management**](PLAN-054.md) `2026-09-01`
- [ ] [**PLAN-069 Design managed and untrusted application controls**](PLAN-069.md) `2026-09-03`
- [ ] [**PLAN-070 Design the meta/ seam and the /mos/config/ system-configuration namespace**](PLAN-070.md) `2026-09-03`
- [ ] [**PLAN-071 Design the update module: off/check/auto with automatic install in a window**](PLAN-071.md) `2026-09-03`
- [ ] [**PLAN-072 Design cloud registration: outbound-only, off by default**](PLAN-072.md) `2026-09-03`
- [ ] [**PLAN-076 Design device state reporting to the fleet plane**](PLAN-076.md) `2026-09-03`
- [ ] [**PLAN-077 Gate A: trust is real -- the anchor, the grade and the rotation decision**](PLAN-077.md) `2026-09-04`
- [-] [**PLAN-086 Compose a minimal MOS runtime from explicit payloads**](PLAN-086.md) `2026-09-06`
- [ ] [**PLAN-912 Validate s905x5m Bluetooth peer interaction**](PLAN-912.md) `2026-08-31`
- [ ] [**20260910-0029-cx3576-boot-log-cleanup Repair cx3576 boot configuration and qualify the current image**](20260910-0029-cx3576-boot-log-cleanup.md) `2026-09-10`
- [-] [**20260910-1206-b3-bounded-exitrd-teardown B3 bounded exitrd teardown**](20260910-1206-b3-bounded-exitrd-teardown.md) `2026-09-10`
- [x] [**20260910-1910-fleet-device-plane-protocol Fleet device-to-plane protocol**](20260910-1910-fleet-device-plane-protocol.md) `2026-09-10`
- [-] [**20260911-1927-boot-artifact-size Shrink the signed boot artifact: compression and early-userspace closure**](20260911-1927-boot-artifact-size.md) `2026-09-11`
- [ ] [**20260911-2006-split-package-repositories Split the tree into an assembly repository and independently released package repositories**](20260911-2006-split-package-repositories.md) `2026-09-11`
- [x] [**20260912-1329-arm64-board-builds ARM64, CX3576 and S905X5M builds**](20260912-1329-arm64-board-builds.md) `2026-09-12`
- [ ] [**20260912-1347-root-closure-reduction Reduce the read-only root closure**](20260912-1347-root-closure-reduction.md) `2026-09-12`
