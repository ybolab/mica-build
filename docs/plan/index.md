# NAS Appliance Refactor - Plan Index

> Updated: 2026-09-07

## Usage

Each plan is a single line linking to its detail file. All detailed information lives in `docs/plan/PLAN-NNN.md`.

### Format

- [ ] [**PLAN-001 Short plan title**](PLAN-001.md) `YYYY-MM-DD`

### Status Markers

| Marker | Meaning | Plan status heads |
|--------|---------|-------------------|
| `[ ]`  | Draft / Pending review | `draft` |
| `[-]`  | Approved / Implementing | `implementing` |
| `[x]`  | Completed | `completed` |
| `[~]`  | Rejected / Abandoned | `rejected` |

### Rules

- New plans append to the end.
- See each `PLAN-NNN.md` for full details.
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

- [ ] [**PLAN-037 Coordinate the embedded delivery roadmap**](PLAN-037.md) `2026-08-31`
- [ ] [**PLAN-054 Design conditional fleet management**](PLAN-054.md) `2026-09-01`
- [ ] [**PLAN-069 Design managed and untrusted application controls**](PLAN-069.md) `2026-09-03`
- [ ] [**PLAN-070 Design the meta/ seam and the /mos/config/ system-configuration namespace**](PLAN-070.md) `2026-09-03`
- [ ] [**PLAN-071 Design the update module: off/check/auto with automatic install in a window**](PLAN-071.md) `2026-09-03`
- [ ] [**PLAN-072 Design cloud registration: outbound-only, off by default**](PLAN-072.md) `2026-09-03`
- [ ] [**PLAN-076 Design device state reporting to the fleet plane**](PLAN-076.md) `2026-09-03`
- [ ] [**PLAN-077 Gate A: trust is real -- the anchor, the grade and the rotation decision**](PLAN-077.md) `2026-09-04`
- [ ] [**PLAN-078 Short-lived signer certificates under the existing CA**](PLAN-078.md) `2026-09-04`
- [ ] [**PLAN-087 Make the cx3576 BSP build reproducible**](PLAN-087.md) `2026-09-07`
- [-] [**PLAN-080 Every build and assembly runs in a container, none on the host**](PLAN-080.md) `2026-09-04`
- [ ] [**PLAN-085 A generic virtual arm64 board, bootable in QEMU**](PLAN-085.md) `2026-09-06`
- [-] [**PLAN-086 Compose a minimal MOS runtime from explicit payloads**](PLAN-086.md) `2026-09-06`

- [ ] [**cx3576-reproducible-bsp-20260907T1400Z Make CX3576 BSP builds reproducible and extract Dockerfile logic**](cx3576-reproducible-bsp-20260907T1400Z.md) `2026-09-07`
