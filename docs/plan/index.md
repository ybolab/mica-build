# NAS Appliance Refactor - Plan Index

> Updated: 2026-08-25

## Usage

Each plan is a single line linking to its detail file. All detailed information lives in `docs/plan/PLAN-NNN.md`.

### Format

- [ ] [**PLAN-001 Short plan title**](PLAN-001.md) `YYYY-MM-DD`

### Status Markers

| Marker | Meaning | Plan status heads |
|--------|---------|-------------------|
| `[ ]`  | Draft / Pending review | `draft` |
| `[-]`  | Approved / Implementing | `approved`, `implementing`, `in progress`, `partially implemented` |
| `[x]`  | Completed | `completed`, `completed by supersession` |
| `[~]`  | Rejected / Abandoned | `rejected` |

### Rules

- Only update the checkbox marker; never delete the line.
- New plans append to the end.
- See each `PLAN-NNN.md` for full details.

---

## Plans

> **Name collision, deliberate.** The `apid` in PLAN-003's title is the **Talos** machine API daemon, retired by that plan. It is not mos's `apid`, the product HTTPS daemon that was named `webd` until campaign `apid` (RFCT-055/056/057). Plan titles are history and are never rewritten.

- [x] [**PLAN-006 Stage 2.0 (alt) - Embedded ARM A/B upgrade via RAUC dual-partition rootfs (disk-backed, zero RAM residency)**](PLAN-006.md) `2026-08-17`
- [~] [**PLAN-007 Derivation strategy switch - rebase onto upstream v1.14.0-rc.1 with k8s-less gating instead of deletions**](PLAN-007.md) `2026-08-17`
- [x] [**PLAN-010 Plan B migration - systemd base + mosd management plane**](PLAN-010.md) `2026-08-17`
- [x] [**PLAN-008 Unified connectivity service (connd) - WiFi STA/AP, Bluetooth, CAN**](PLAN-008.md) `2026-08-17`
- [x] [**PLAN-029 Documentation system rebuild - decouple docs from code, prune settled records, re-anchor on the current version**](PLAN-029.md) `2026-08-29`
