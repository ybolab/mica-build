# Mica OS - Plan Index

> Updated: 2026-09-12

## Usage

Each plan is a single line linking to its detail file. All detailed information lives in `docs/plan/<timestamp>-<feature-slug>.md`.

### Format

- [ ] [**20260907-1440-add-endpoint Add endpoint**](20260907-1440-add-endpoint.md) `YYYY-MM-DD`

### Status Markers

| Marker | Meaning |
|--------|---------|
| `[ ]`  | Draft / Pending review |
| `[-]`  | Approved / Implementing |
| `[x]`  | Completed |
| `[~]`  | Rejected / Abandoned |
| `[d]`  | Deleted detail file; index entry retained |

### Rules

- Only update the checkbox marker; never delete the line or change its other content. If the detail file is deleted, mark the entry `[d]`.
- Record change history and deletion reasons in `docs/changelog.md`; update affected task and plan references.
- New plans append to the end.
- See each `<timestamp>-<feature-slug>.md` for full details, except `[d]` entries whose files have been deleted; consult `docs/changelog.md` for their history.

---

## Plans

- [d] [**PLAN-037 Coordinate the embedded delivery roadmap**](PLAN-037.md) `2026-08-31`
- [d] [**PLAN-054 Design conditional fleet management**](PLAN-054.md) `2026-09-01`
- [d] [**PLAN-069 Design managed and untrusted application controls**](PLAN-069.md) `2026-09-03`
- [d] [**PLAN-070 Design the meta/ seam and the /mos/config/ system-configuration namespace**](PLAN-070.md) `2026-09-03`
- [d] [**PLAN-071 Design the update module: off/check/auto with automatic install in a window**](PLAN-071.md) `2026-09-03`
- [d] [**PLAN-072 Design cloud registration: outbound-only, off by default**](PLAN-072.md) `2026-09-03`
- [d] [**PLAN-076 Design device state reporting to the fleet plane**](PLAN-076.md) `2026-09-03`
- [d] [**PLAN-077 Gate A: trust is real -- the anchor, the grade and the rotation decision**](PLAN-077.md) `2026-09-04`
- [d] [**PLAN-086 Compose a minimal MOS runtime from explicit payloads**](PLAN-086.md) `2026-09-06`
- [ ] [**PLAN-912 Validate s905x5m Bluetooth peer interaction**](PLAN-912.md) `2026-08-31`
- [ ] [**20260910-0029-cx3576-boot-log-cleanup Repair cx3576 boot configuration and qualify the current image**](20260910-0029-cx3576-boot-log-cleanup.md) `2026-09-10`
- [-] [**20260910-1206-b3-bounded-exitrd-teardown B3 bounded exitrd teardown**](20260910-1206-b3-bounded-exitrd-teardown.md) `2026-09-10`
- [x] [**20260910-1910-fleet-device-plane-protocol Fleet device-to-plane protocol**](20260910-1910-fleet-device-plane-protocol.md) `2026-09-10`
- [-] [**20260911-1927-boot-artifact-size Shrink the signed boot artifact: compression and early-userspace closure**](20260911-1927-boot-artifact-size.md) `2026-09-11`
- [-] [**20260911-2006-split-package-repositories Split the tree into an assembly repository and independently released package repositories**](20260911-2006-split-package-repositories.md) `2026-09-11`
- [x] [**20260912-1329-arm64-board-builds ARM64, CX3576 and S905X5M builds**](20260912-1329-arm64-board-builds.md) `2026-09-12`
- [ ] [**20260912-1347-root-closure-reduction Reduce the read-only root closure**](20260912-1347-root-closure-reduction.md) `2026-09-12`
- [ ] [**20260912-2043-unify-board-behavior Unify board build, compression and acceptance behavior**](20260912-2043-unify-board-behavior.md) `2026-09-12`
- [x] [**20260912-2049-docs-restructure Restructure the documentation system**](20260912-2049-docs-restructure.md) `2026-09-12`
