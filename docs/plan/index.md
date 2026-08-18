# NAS Appliance Refactor - Plan Index

> Updated: 2026-08-17

## Usage

Each plan is a single line linking to its detail file. All detailed information lives in `docs/plan/PLAN-NNN.md`.

### Format

- [ ] [**PLAN-001 Short plan title**](PLAN-001.md) `YYYY-MM-DD`

### Status Markers

| Marker | Meaning |
|--------|---------|
| `[ ]`  | Draft / Pending review |
| `[-]`  | Approved / Implementing |
| `[x]`  | Completed |
| `[~]`  | Rejected / Abandoned |

### Rules

- Only update the checkbox marker; never delete the line.
- New plans append to the end.
- See each `PLAN-NNN.md` for full details.

---

## Plans

- [x] [**PLAN-001 Stage 1.0 - Introduce TypeAppliance and gate K8s in sequencer**](PLAN-001.md) `2026-05-09`
- [x] [**PLAN-002 Stage 1.1 - Delete K8s/etcd/cluster/provision/integration code**](PLAN-002.md) `2026-05-09`
- [x] [**PLAN-003 Stage 1.2 - Retire apid/trustd/talosctl/dashboard, bring up webd skeleton and rescue shell**](PLAN-003.md) `2026-05-09`
- [x] [**PLAN-004 Stage 1.3 - Repair build pipeline; produce a QEMU-bootable appliance image**](PLAN-004.md) `2026-05-09`
- [~] [**PLAN-005 Stage 2.0 - Embedded ARM A/B upgrade system (U-Boot dual-slot FIT + Uptane-secured updates)**](PLAN-005.md) `2026-08-16`
- [ ] [**PLAN-006 Stage 2.0 (alt) - Embedded ARM A/B upgrade via RAUC dual-partition rootfs (disk-backed, zero RAM residency)**](PLAN-006.md) `2026-08-17`
- [-] [**PLAN-007 Derivation strategy switch - rebase onto upstream v1.14.0-rc.1 with k8s-less gating instead of deletions**](PLAN-007.md) `2026-08-17`
- [-] [**PLAN-010 Plan B migration - systemd base + mosd management plane**](PLAN-010.md) `2026-08-17`
- [ ] [**PLAN-008 Unified connectivity service (connd) - WiFi STA/AP, Bluetooth, CAN**](PLAN-008.md) `2026-08-17`
- [x] [**PLAN-009 cx3576 board bring-up (B1: BSP readiness)**](PLAN-009.md) `2026-08-17`
