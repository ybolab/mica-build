# NAS Appliance Refactor - Plan Index

> Updated: 2026-08-25

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

> **Name collision, deliberate.** The `apid` in PLAN-003's title is the **Talos** machine API daemon, retired by that plan. It is not mos's `apid`, the product HTTPS daemon that was named `webd` until campaign `apid` (RFCT-055/056/057). Plan titles are history and are never rewritten.

- [x] [**PLAN-001 Stage 1.0 - Introduce TypeAppliance and gate K8s in sequencer**](PLAN-001.md) `2026-05-09`
- [x] [**PLAN-002 Stage 1.1 - Delete K8s/etcd/cluster/provision/integration code**](PLAN-002.md) `2026-05-09`
- [x] [**PLAN-003 Stage 1.2 - Retire apid/trustd/talosctl/dashboard, bring up webd skeleton and rescue shell**](PLAN-003.md) `2026-05-09`
- [x] [**PLAN-004 Stage 1.3 - Repair build pipeline; produce a QEMU-bootable appliance image**](PLAN-004.md) `2026-05-09`
- [~] [**PLAN-005 Stage 2.0 - Embedded ARM A/B upgrade system (U-Boot dual-slot FIT + Uptane-secured updates)**](PLAN-005.md) `2026-08-16`
- [-] [**PLAN-006 Stage 2.0 (alt) - Embedded ARM A/B upgrade via RAUC dual-partition rootfs (disk-backed, zero RAM residency)**](PLAN-006.md) `2026-08-17`
- [-] [**PLAN-007 Derivation strategy switch - rebase onto upstream v1.14.0-rc.1 with k8s-less gating instead of deletions**](PLAN-007.md) `2026-08-17`
- [-] [**PLAN-010 Plan B migration - systemd base + mosd management plane**](PLAN-010.md) `2026-08-17`
- [ ] [**PLAN-008 Unified connectivity service (connd) - WiFi STA/AP, Bluetooth, CAN**](PLAN-008.md) `2026-08-17`
- [x] [**PLAN-009 cx3576 board bring-up (B1: BSP readiness)**](PLAN-009.md) `2026-08-17`
- [-] [**PLAN-011 Device bus v2 - com.mos.* item tree, actions as items, and extension service lifecycle**](PLAN-011.md) `2026-08-21`
- [ ] [**PLAN-012 Container engine - a self-built static Podman, off by default, switched from apid**](PLAN-012.md) `2026-08-23`
- [ ] [**PLAN-013 The x64/QEMU verification vehicle - a whole-system check, an apid API suite, and the cx3576 back-port**](PLAN-013.md) `2026-08-24`
- [x] [**PLAN-014 os/ restructure - board isolation, per-stage rootfs Dockerfiles, pinned build environments, and the TS build/verify toolchain**](PLAN-014.md) `2026-08-25`
- [x] [**PLAN-015 Function-oriented comments - strip history from code, tests, and docs**](PLAN-015.md) `2026-08-26`
- [x] [**PLAN-016 apid OpenAPI phase 1 - utoipa spec, discovery endpoints, read-only slice, breaking-change gate**](PLAN-016.md) `2026-08-26`
- [x] [**PLAN-017 Docs reconciliation - api.md measured against the served OpenAPI surface, Talos framing retired**](PLAN-017.md) `2026-08-26`
- [x] [**PLAN-018 Board consolidation - board/ moves under os/boards/, one definition per board**](PLAN-018.md) `2026-08-26`
- [x] [**PLAN-019 os/pkgs consolidation and a directory-structure pass**](PLAN-019.md) `2026-08-27`
- [x] [**PLAN-020 Gate hardening - close the eight measured silent spaces**](PLAN-020.md) `2026-08-27`
- [-] [**PLAN-021 The defect and debt batch - filed tasks, quick fixes, ghost sweeps**](PLAN-021.md) `2026-08-27`
- [-] [**PLAN-022 Native networking - VLAN, bridge, WireGuard (design-first)**](PLAN-022.md) `2026-08-27`
