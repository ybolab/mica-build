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
- [x] [**RFCT-032 Settings schema v4: access.ssh.authorizedKeys and the key parser**](RFCT-032.md) `P1`
- [x] [**RFCT-033 Transient root password: marker, bus method, shadow reconcile**](RFCT-033.md) `P1`
- [x] [**RFCT-034 sshd reconciler: authorized keys, AuthorizedKeysFile, password gating**](RFCT-034.md) `P1`
- [x] [**RFCT-035 webd SSH pane: keys, transient password, effective state**](RFCT-035.md) `P1`
- [x] [**RFCT-036 Image and verifier integration: profile default flip, static-enable removal, seven assertions**](RFCT-036.md) `P1`
- [x] [**RFCT-037 Access-model documentation, implementation-status markers, and the dead-control demotion**](RFCT-037.md) `P1`
- [x] [**RFCT-038 mos-shadow-reconcile: newline-safe append**](RFCT-038.md) `P2`
- [x] [**RFCT-039 A persistent /home on DATA, and the mos account that owns it**](RFCT-039.md) `P1`
- [x] [**RFCT-040 Venus OS web UI and information architecture study**](RFCT-040.md) `P2`
- [x] [**RFCT-041 Venus OS access and firmware-update UX study**](RFCT-041.md) `P2`
- [x] [**RFCT-042 mos web/UI current-state inventory, measured**](RFCT-042.md) `P1`
- [x] [**RFCT-043 Dashboard landing screen and information architecture**](RFCT-043.md) `P1`
- [x] [**RFCT-044 Dashboard technology posture and live-value transport**](RFCT-044.md) `P1`
- [x] [**RFCT-045 Consolidation, PMA records, and a build-enforced index check**](RFCT-045.md) `P1`
- [x] [**RFCT-046 Dashboard process architecture, external contract, rename, and phasing**](RFCT-046.md) `P1`
- [x] [**RFCT-047 sshd reconciler: reload on config change, not restart**](RFCT-047.md) `P1`
- [x] [**RFCT-048 D-Bus policy: com.mos.mosd is root-only, and a live-bus test that proves it**](RFCT-048.md) `P1`
- [x] [**RFCT-053 sshd reconciler: render authorized keys for every managed login account**](RFCT-053.md) `P1`
- [x] [**RFCT-054 A persistent /root on DATA**](RFCT-054.md) `P1`
- [x] [**RFCT-055 Rename webd to apid: crate, binary, unit, StateDirectory, image, verifiers, health gate**](RFCT-055.md) `P1`
- [x] [**RFCT-056 Documentation for the apid rename and the keep-two-processes decision**](RFCT-056.md) `P1`
- [x] [**RFCT-057 Closing audit of the apid rename: repo-wide completeness, consistency chain, assertion accounting**](RFCT-057.md) `P1`
- [x] [**RFCT-058 Re-anchor dashboard.md D-Bus policy claims to RFCT-048, state the citation rule, correct the README talos entry**](RFCT-058.md) `P1`
- [x] [**RFCT-059 Direction-2 audit of the apid rename: every new apid occurrence is a place that should have been renamed**](RFCT-059.md) `P1`
- [x] [**RFCT-063 Current API/UI surface inventory and the api.md skeleton**](RFCT-063.md) `P1`
- [x] [**RFCT-064 The API surface and authentication for a programmatic client**](RFCT-064.md) `P1`
- [x] [**RFCT-065 Static hosting, the custom-UI lifecycle, and the safety fallback**](RFCT-065.md) `P1`
- [x] [**RFCT-066 Trust, migration and phasing, and what API-first forecloses**](RFCT-066.md) `P1`
- [x] [**RFCT-067 PMA records, the task index, and the final consistency pass**](RFCT-067.md) `P1`
- [x] [**RFCT-068 Anchor mos-ui-inventory.md as a measurement at a time**](RFCT-068.md) `P1`
- [x] [**RFCT-069 Resolve the auth/CSRF and version-set contradictions**](RFCT-069.md) `P1`
- [x] [**RFCT-071 The /srv/ui bundle store: layout, validation, atomic activation, deactivate, status read**](RFCT-071.md) `P1`
- [x] [**RFCT-072 Asset path resolution and content classification: traversal, MIME allowlist, caching posture**](RFCT-072.md) `P1`
- [x] [**RFCT-073 Assert the custom-UI location as an on-image fact, and negative-test every assertion**](RFCT-073.md) `P1`
- [x] [**RFCT-074 The asset router: routing precedence, the reserved /api/ subtree, SPA fallback**](RFCT-074.md) `P1`
- [x] [**RFCT-075 The built-in UI at a reserved prefix, and the escape**](RFCT-075.md) `P1`
- [x] [**RFCT-080 Close the duplicate-row hole in the index verifier, and sweep the `sort -u` shape**](RFCT-080.md) `P1`
