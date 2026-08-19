# NAS Appliance Refactor - Task List

> Updated: 2026-08-19

## Usage

Each task is a single line linking to its detail file. All detailed information lives in `docs/task/PREFIX-NNN.md`.

### Format

- [ ] [**PREFIX-001 Short imperative title**](PREFIX-001.md) `P1`

### Status Markers

| Marker | Meaning |
|--------|---------|
| `[ ]`  | Pending |
| `[-]`  | In progress |
| `[x]`  | Completed |
| `[~]`  | Closed / Won't do |

### Priority: P0 (blocking) > P1 (high) > P2 (medium) > P3 (low)

### Rules

- Only update the checkbox marker; never delete the line.
- New tasks append to the end.
- See each `PREFIX-NNN.md` for full details.

---

## Tasks

- [x] [**RFCT-001 Stage 1.0 - Introduce TypeAppliance and gate K8s in sequencer**](RFCT-001.md) `P1`
- [x] [**RFCT-002 Stage 1.1 - Delete K8s/etcd/cluster/provision/integration code**](RFCT-002.md) `P1`
- [x] [**RFCT-003 Stage 1.2 - Retire apid/trustd/talosctl/dashboard, bring up webd skeleton and rescue shell**](RFCT-003.md) `P1`
- [x] [**RFCT-004 Stage 1.3 - Repair build pipeline so a bootable appliance image can be produced and tested in QEMU/KVM**](RFCT-004.md) `P1`
- [-] [**RFCT-005 Port appliance feature set onto upstream v1.14.0-rc.1 base (rebase derivation)**](RFCT-005.md) `P1`
- [x] [**RFCT-006 cx3576 board bring-up (B1: BSP readiness)**](RFCT-006.md) `P1`
- [-] [**RFCT-007 cx3576 flashing: rockusb loader-mode descriptor + RK update.img packaging**](RFCT-007.md) `P2`
- [-] [**RFCT-008 PLAN-010 M1 - systemd rootfs prototype image for cx3576**](RFCT-008.md) `P1`
- [-] [**RFCT-009 mosd skeleton (Rust management plane, PLAN-010 M2)**](RFCT-009.md) `P1`
- [-] [**RFCT-010 webd v1 on the mosd bus (PLAN-010 M3)**](RFCT-010.md) `P1`
- [-] [**RFCT-011 Minimal image sizing + board hardware init (cx3576)**](RFCT-011.md) `P1`
- [-] [**RFCT-012 Adopt the verified Alpine board rootfs and port its hardware facts to os/rootfs**](RFCT-012.md) `P1`
- [-] [**RFCT-013 squashfs+dm-verity rootfs pack + RO root wiring (cx3576 layout v2)**](RFCT-013.md) `P1`
- [-] [**RFCT-014 RAUC integration: system.conf, bundle build, dev signing keys**](RFCT-014.md) `P1`
- [-] [**RFCT-015 Health gate + machine-id oneshot (PLAN-010 M4)**](RFCT-015.md) `P1`
- [x] [**RFCT-016 update/sign: TUF (tough) signing skeleton**](RFCT-016.md) `P1`
- [x] [**RFCT-017 Image contract verification for layout v2 (cx3576)**](RFCT-017.md) `P1`
- [x] [**RFCT-018 U-Boot A/B handshake contract for a custom mainline U-Boot**](RFCT-018.md) `P0`
- [x] [**RFCT-019 PMA documentation finalize for PLAN-010 M4**](RFCT-019.md) `P1`
- [-] [**RFCT-020 Partition layout v2 constants + mkimage v2 mode (cx3576)**](RFCT-020.md) `P1`
- [x] [**RFCT-021 Settings schema v3 - access, provisioning and wifi subtrees**](RFCT-021.md) `P1`
- [x] [**RFCT-022 On-device identity and per-device credential generation**](RFCT-022.md) `P1`
- [x] [**RFCT-023 sshd gating reconciler - drop-in render, unit state and root password**](RFCT-023.md) `P1`
- [x] [**RFCT-024 First-boot self-provisioning in mosd (provisioning Layer 1)**](RFCT-024.md) `P1`
- [x] [**RFCT-025 WiFi station reconciler in mosd (wpa_supplicant, uplink only)**](RFCT-025.md) `P1`
- [x] [**RFCT-026 WiFi access-point reconciler in mosd (hostapd, provisioning AP)**](RFCT-026.md) `P1`
- [x] [**RFCT-027 Image + verifier integration for the M5 access, provisioning and connd features**](RFCT-027.md) `P1`
- [x] [**RFCT-028 PMA documentation finalize for PLAN-010 M5**](RFCT-028.md) `P1`
- [x] [**RFCT-029 /etc/shadow on STATE (symlink, factory copy, boot reconcile, verifier proof)**](RFCT-029.md) `P1`
- [x] [**RFCT-030 Power actions: mosd Reboot/PowerOff + webd POST routes**](RFCT-030.md) `P1`
- [x] [**RFCT-031 The Rockchip loader area becomes a real GPT partition**](RFCT-031.md) `P1`
- [x] [**RFCT-040 Venus OS web UI and information architecture study**](RFCT-040.md) `P2`
- [x] [**RFCT-041 Venus OS access and firmware-update UX study**](RFCT-041.md) `P2`
- [x] [**RFCT-042 mos web/UI current-state inventory, measured**](RFCT-042.md) `P1`
- [x] [**RFCT-043 Dashboard landing screen and information architecture**](RFCT-043.md) `P1`
- [x] [**RFCT-044 Dashboard technology posture and live-value transport**](RFCT-044.md) `P1`
- [x] [**RFCT-045 Consolidation, PMA records, and a build-enforced index check**](RFCT-045.md) `P1`
- [x] [**RFCT-046 Dashboard process architecture, external contract, rename, and phasing**](RFCT-046.md) `P1`
