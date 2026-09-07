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
- **A settled plan is pruned: the file and its line both leave the tree.** This
  index holds work that is still live, and git history is the archive --
  `git log --diff-filter=D -- docs/plan/` finds any record that has left.
  `docs/verify-index.sh` and `docs/verify-links.sh` both exclude this directory
  for exactly this reason, and say so in their own headers.
- **A plan is prunable only when the `[x]` marker and the file's own `status`
  head agree.** They have disagreed: PLAN-080 (`implementing`) and PLAN-085
  (`draft`) were both marked `[x]` here, and pruning on the marker alone would
  have deleted two live designs. The file wins; the marker is a summary of it.
- **A settled plan is retained while a document outside this directory still
  links to it**, because those links are gated and a prune would break them:
  `docs/verify-links.sh` for Markdown links, `docs/verify-status.sh` for
  `> status: proposed` evidence refs, which must name an existing plan. A
  retained `[x]` row is waiting for its last citation to go, not for work.
  Plain-text `PLAN-NNN` mentions in prose are not links and do not retain
  anything -- 234 of the 239 mentions in the shipped trees are already bare
  names, which is the convention this rule follows.

Until 2026-09-07 this section read "Only update the checkbox marker; never
delete the line". That sentence is inherited verbatim from the PMA skill's
`plan-format.md`, and five prune commits (`ab0e650c`, `32f6a453`, `7c78a89a`,
`1b31a6c0`, `3a5e52c3`) had already contradicted it -- `1b31a6c0` states the
real norm outright: "Completed records leave the tree, as PLAN-001..029 did
before them". The rule above is what this repository actually does.

---

## Plans

- [ ] [**PLAN-037 Coordinate the embedded delivery roadmap**](PLAN-037.md) `2026-08-31`
- [x] [**PLAN-045 Add the unexpanded BusyBox emergency binary**](PLAN-045.md) `2026-09-01`
- [x] [**PLAN-051 Document native and container application delivery**](PLAN-051.md) `2026-09-01`
- [ ] [**PLAN-054 Design conditional fleet management**](PLAN-054.md) `2026-09-01`
- [ ] [**PLAN-069 Design managed and untrusted application controls**](PLAN-069.md) `2026-09-03`
- [ ] [**PLAN-070 Design the meta/ seam and the /mos/config/ system-configuration namespace**](PLAN-070.md) `2026-09-03`
- [ ] [**PLAN-071 Design the update module: off/check/auto with automatic install in a window**](PLAN-071.md) `2026-09-03`
- [ ] [**PLAN-072 Design cloud registration: outbound-only, off by default**](PLAN-072.md) `2026-09-03`
- [x] [**PLAN-074 Build the x64 kernel in tree, with its own config**](PLAN-074.md) `2026-09-04`
- [ ] [**PLAN-076 Design device state reporting to the fleet plane**](PLAN-076.md) `2026-09-03`
- [ ] [**PLAN-077 Gate A: trust is real -- the anchor, the grade and the rotation decision**](PLAN-077.md) `2026-09-04`
- [ ] [**PLAN-078 Short-lived signer certificates under the existing CA**](PLAN-078.md) `2026-09-04`
- [-] [**PLAN-080 Every build and assembly runs in a container, none on the host**](PLAN-080.md) `2026-09-04`
- [x] [**PLAN-079 Build the update server and release console**](PLAN-079.md) `2026-09-04`
- [x] [**PLAN-081 Resolve the September repository audit findings**](PLAN-081.md) `2026-09-05`
- [x] [**PLAN-083 Lock and layer Debian packages and validate the composed system**](PLAN-083.md) `2026-09-06`
- [x] [**PLAN-084 Store Debian pins in per-package JSON manifests**](PLAN-084.md) `2026-09-06`
- [ ] [**PLAN-085 A generic virtual arm64 board, bootable in QEMU**](PLAN-085.md) `2026-09-06`
- [ ] [**PLAN-086 Compose a minimal MOS runtime from explicit payloads**](PLAN-086.md) `2026-09-06`

- [ ] [**cx3576-reproducible-bsp-20260907T1400Z Make CX3576 BSP builds reproducible and extract Dockerfile logic**](cx3576-reproducible-bsp-20260907T1400Z.md) `2026-09-07`
