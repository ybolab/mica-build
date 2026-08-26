# NAS Appliance Refactor - Task List

> Updated: 2026-08-25

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
- [x] [**RFCT-076 Start-up bundle discovery and the compatibility re-check**](RFCT-076.md) `P1`
- [x] [**RFCT-077 Verifier assertions for the built-in prefix, fixture-mode widening, and the SIGPIPE sweep**](RFCT-077.md) `P1`
- [x] [**RFCT-078 The five broken-classes behavioural suite, with coverage asserted**](RFCT-078.md) `P1`
- [x] [**RFCT-079 Status markers per subsection, the §10.3 register entry, and the final consistency pass**](RFCT-079.md) `P1`
- [x] [**RFCT-080 Close the duplicate-row hole in the index verifier, and sweep the `sort -u` shape**](RFCT-080.md) `P1`
- [x] [**RFCT-081 Close the repository audit: a CI gate, a no-op build target, an unreferenced 12 MB asset, two stale suppressions, and the apid login curve**](RFCT-081.md) `P1`
- [x] [**RFCT-082 Reach the unreachable rollback path, and stop the stale documentation lying quietly**](RFCT-082.md) `P0`
- [x] [**RFCT-083 Close the second repository audit: trust-chain gaps, inverted crash-safety ordering, and the half-fixed patch-loop bug**](RFCT-083.md) `P1`
- [x] [**RFCT-084 mosd update orchestration: RAUC install and confirm over the bus, update state, and a Reboot that knows about an unconfirmed slot**](RFCT-084.md) `P1`
- [x] [**RFCT-085 access.md §6 made real in apid: persistent backoff counters and a bounded audit trail**](RFCT-085.md) `P1`
- [x] [**RFCT-086 The privileged CI lane, and the production key ceremony runbook**](RFCT-086.md) `P1`
- [x] [**RFCT-087 An offline U-Boot A/B handshake harness on the sandbox build (spike)**](RFCT-087.md) `P1`
- [x] [**RFCT-088 Uptane phase 2, first half: the device-side metadata verifier and the trust anchor provisioning story**](RFCT-088.md) `P1`
- [x] [**RFCT-089 PLAN-011 M1: bus contract design doc and the read-only com.mos.Item1 tree facade**](RFCT-089.md) `P1`
- [x] [**RFCT-090 PLAN-011 M2: writable items and /Actions/*, apid power pane on action items**](RFCT-090.md) `P1`
- [x] [**RFCT-091 PLAN-011 M3: mos-mqttd, the MQTT data-publishing bridge**](RFCT-091.md) `P1`
- [ ] [**RFCT-092 A mechanism that checks docs citations, because five of them rotted in two merges**](RFCT-092.md) `P2`
- [x] [**RFCT-093 PLAN-011 M5: extension enablement — writable unit directory, the com.mos.ext namespace, and the bus scan**](RFCT-093.md) `P1`
- [ ] [**RFCT-094 Dotted keys have no item object, and M5 makes that certain rather than theoretical**](RFCT-094.md) `P2`
- [x] [**RFCT-095 The com.mos.ext policy assertions cannot fail, and hoisting them needs a different shape**](RFCT-095.md) `P2`
- [ ] [**RFCT-096 "0 skipped" does not mean nothing was skipped, and three test files still exploit that**](RFCT-096.md) `P1`
- [x] [**RFCT-097 Wire mos-mqttd into the image, which is where three of its defects were**](RFCT-097.md) `P1`
- [x] [**RFCT-098 The connd contract read rotted, and nineteen assertions went green on the fallback**](RFCT-098.md) `P1`
- [x] [**RFCT-099 Remove package management from the packed root, and keep the licence texts**](RFCT-099.md) `P2`
- [x] [**RFCT-100 Move the packed root from Debian 12 to Debian 13, and unpin the checks that were pinned to 12**](RFCT-100.md) `P1`
- [x] [**RFCT-101 PLAN-012 M2: the container engine in the image, installed and inert**](RFCT-101.md) `P1`
- [x] [**RFCT-102 Make the container engine actually usable: storage off the wipeable partition, a board switch, and a build that runs it**](RFCT-102.md) `P1`
- [x] [**RFCT-103 PLAN-012 M1–M4: build the engine from source, replace the distribution's configuration, and give the switch something to switch**](RFCT-103.md) `P1`
- [x] [**RFCT-104 A master switch for MQTT, and a broker for the bridge that has only ever retried**](RFCT-104.md) `P1`
- [x] [**RFCT-105 An over-the-wire suite for apid: nine phases against one boot, and effects observed on the device**](RFCT-105.md) `P1`
- [x] [**RFCT-106 x64 A/B: the update has to land where the firmware actually looks**](RFCT-106.md) `P0`
- [x] [**RFCT-107 PLAN-014 M1: delete v1 and restructure the os/ tree without changing a byte of the image**](RFCT-107.md) `P1`
- [x] [**RFCT-108 PLAN-014 M2: the pinned build-environment image family**](RFCT-108.md) `P1`
- [x] [**RFCT-109 PLAN-014 M3: the bun+TS foundation, proven on the board-definition lint**](RFCT-109.md) `P1`
- [x] [**RFCT-110 PLAN-014 M4: the image-contract verifier ported to TS under a per-check parity gate**](RFCT-110.md) `P1`
- [ ] [**RFCT-111 PLAN-014 M5: the rootfs build split into one Dockerfile per stage, driven from TS**](RFCT-111.md) `P1`
- [ ] [**RFCT-112 PLAN-014 M6: the assemblers ported to TS under the byte-identity gate**](RFCT-112.md) `P1`
- [ ] [**RFCT-113 PLAN-014 M7: built artifacts smoke-run on the base rootfs**](RFCT-113.md) `P1`
