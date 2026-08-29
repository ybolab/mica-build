# NAS Appliance Refactor - Task List

> Updated: 2026-08-27

## Usage

Each task is a single line linking to its detail file. All detailed information lives in `docs/task/PREFIX-NNN.md`.

### Format

- [ ] [**PREFIX-001 Short imperative title**](PREFIX-001.md) `P1`

### Status Markers

| Marker | Meaning | Record status head |
|--------|---------|--------------------|
| `[ ]`  | Pending | `pending` |
| `[-]`  | In progress | `in progress` |
| `[x]`  | Completed | `completed` |
| `[~]`  | Closed / Won't do | `closed` |

Each record's front matter carries a status line of the shape
`- **status**: <head>` or `- **status**: <head> — <free detail>`, where
`<head>` is exactly one of the four heads above and the detail after ` — ` is
free text. `docs/verify-index.sh` enforces the pair: a record with no such
line or a non-canonical head fails, and a row whose checkbox does not match
its record's head fails naming both sides (RFCT-171).

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
- [x] [**RFCT-009 mosd skeleton (Rust management plane, PLAN-010 M2)**](RFCT-009.md) `P1`
- [x] [**RFCT-010 webd v1 on the mosd bus (PLAN-010 M3)**](RFCT-010.md) `P1`
- [x] [**RFCT-011 Minimal image sizing + board hardware init (cx3576)**](RFCT-011.md) `P1`
- [x] [**RFCT-012 Adopt the verified Alpine board rootfs and port its hardware facts to os/rootfs**](RFCT-012.md) `P1`
- [x] [**RFCT-013 squashfs+dm-verity rootfs pack + RO root wiring (cx3576 layout v2)**](RFCT-013.md) `P1`
- [x] [**RFCT-014 RAUC integration: system.conf, bundle build, dev signing keys**](RFCT-014.md) `P1`
- [x] [**RFCT-015 Health gate + machine-id oneshot (PLAN-010 M4)**](RFCT-015.md) `P1`
- [x] [**RFCT-016 update/sign: TUF (tough) signing skeleton**](RFCT-016.md) `P1`
- [x] [**RFCT-017 Image contract verification for layout v2 (cx3576)**](RFCT-017.md) `P1`
- [x] [**RFCT-018 U-Boot A/B handshake contract for a custom mainline U-Boot**](RFCT-018.md) `P0`
- [x] [**RFCT-019 PMA documentation finalize for PLAN-010 M4**](RFCT-019.md) `P1`
- [x] [**RFCT-020 Partition layout v2 constants + mkimage v2 mode (cx3576)**](RFCT-020.md) `P1`
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
- [x] [**RFCT-092 A mechanism that checks docs citations, because five of them rotted in two merges**](RFCT-092.md) `P2`
- [x] [**RFCT-093 PLAN-011 M5: extension enablement — writable unit directory, the com.mos.ext namespace, and the bus scan**](RFCT-093.md) `P1`
- [x] [**RFCT-094 Dotted keys have no item object, and M5 makes that certain rather than theoretical**](RFCT-094.md) `P2`
- [x] [**RFCT-095 The com.mos.ext policy assertions cannot fail, and hoisting them needs a different shape**](RFCT-095.md) `P2`
- [x] [**RFCT-096 "0 skipped" does not mean nothing was skipped, and three test files still exploit that**](RFCT-096.md) `P1`
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
- [x] [**RFCT-111 PLAN-014 M5: the rootfs build split into one Dockerfile per stage, driven from TS**](RFCT-111.md) `P1`
- [x] [**RFCT-112 PLAN-014 M6: the assemblers ported to TS under the byte-identity gate**](RFCT-112.md) `P1`
- [x] [**RFCT-113 PLAN-014 M7: built artifacts smoke-run on the base rootfs**](RFCT-113.md) `P1`
- [x] [**RFCT-114 PLAN-015 M1: function-oriented comments in os/, Makefile and board/**](RFCT-114.md) `P2`
- [x] [**RFCT-115 PLAN-015 M2: function-oriented comments in mosd/, excluding apid**](RFCT-115.md) `P2`
- [x] [**RFCT-116 PLAN-015 M3: function-oriented comments in the test scripts**](RFCT-116.md) `P2`
- [x] [**RFCT-117 PLAN-016 M1: the utoipa scaffold, the two discovery endpoints and a committed spec**](RFCT-117.md) `P1`
- [x] [**RFCT-118 PLAN-016 M2: the read-only settings and state roots, redacted, under one error envelope**](RFCT-118.md) `P1`
- [x] [**RFCT-119 PLAN-016 M3: the spec-identity check and the oasdiff breaking-change gate**](RFCT-119.md) `P1`
- [x] [**RFCT-120 PLAN-016 M4: comment simplification inside mosd/apid**](RFCT-120.md) `P1`
- [x] [**RFCT-121 PLAN-015 M4: the docs citation checker, resolution and content**](RFCT-121.md) `P2`
- [x] [**RFCT-122 PLAN-015 M5: api.md loses its citation banner, its defect register, and its rotted citations**](RFCT-122.md) `P2`
- [x] [**RFCT-123 PLAN-015 M5: dashboard.md loses its citation banner and the rejected-option analysis**](RFCT-123.md) `P2`
- [x] [**RFCT-124 PLAN-015 M5: the remaining design-doc banners, and architecture.md rewritten to the system that ships**](RFCT-124.md) `P2`
- [x] [**RFCT-125 PLAN-015 M5: the two HARNESS files become manuals instead of campaign journals**](RFCT-125.md) `P2`
- [x] [**RFCT-126 PLAN-015 M5: README sweep, root and extensions and the two TS suites**](RFCT-126.md) `P2`
- [x] [**RFCT-127 PLAN-015 M5: README sweep, the rootfs tree and the container engine**](RFCT-127.md) `P2`
- [x] [**RFCT-128 PLAN-015 M5: citations repaired against the checker, and the check made to gate**](RFCT-128.md) `P2`
- [x] [**RFCT-129 apid reads /proc/uptime itself, against its own rule that mosd owns every system fact**](RFCT-129.md) `P2`
- [x] [**RFCT-130 Three distinct settings failures reach the API as one error code, so a missing path and a bad value are indistinguishable**](RFCT-130.md) `P2`
- [x] [**RFCT-131 /healthz answers ok before checking anything, and two documents read it as a statement about the appliance**](RFCT-131.md) `P2`
- [x] [**RFCT-132 Every unauthenticated request costs a D-Bus round trip against the one lock mosd holds over both trees**](RFCT-132.md) `P2`
- [x] [**RFCT-133 mosd emits SettingsChanged and apid's proxy cannot receive it**](RFCT-133.md) `P2`
- [x] [**RFCT-134 The admin password can be set exactly once and no operation anywhere changes it**](RFCT-134.md) `P1`
- [x] [**RFCT-135 The network form accepts a VLAN interface name that the settings path syntax then rejects**](RFCT-135.md) `P1`
- [x] [**RFCT-136 The custom-UI bundle store is complete and no HTTP route reaches it**](RFCT-136.md) `P2`
- [x] [**RFCT-137 apid's unit sandboxes almost everything except the filesystem it serves files out of**](RFCT-137.md) `P2`
- [x] [**RFCT-138 The workspace's no-C-dependency posture is a comment, and cargo-deny is configured to enforce nothing**](RFCT-138.md) `P2`
- [x] [**RFCT-139 No production RAUC keyring is provisioned, so rauc install fails closed on every shipped device**](RFCT-139.md) `P2`
- [x] [**RFCT-140 One outage is reported two ways: the API answers 503 and the HTML pages answer 502**](RFCT-140.md) `P2`
- [x] [**RFCT-141 The static-asset traversal guards have no over-the-wire coverage, because no device under test has a bundle**](RFCT-141.md) `P2`
- [x] [**RFCT-142 Reading the U-Boot boot credits races a writer that no lock orders**](RFCT-142.md) `P1`
- [x] [**RFCT-143 PLAN-015 M5: boards.md and display.md lose the claims that describe a build that does not exist**](RFCT-143.md) `P2`
- [x] [**RFCT-144 PLAN-015 M5: the task index and the task files disagree about what is finished**](RFCT-144.md) `P2`
- [x] [**RFCT-150 PLAN-015 M6: form compression in os/verify**](RFCT-150.md) `P2`
- [x] [**RFCT-151 PLAN-015 M6: form compression in os/build**](RFCT-151.md) `P2`
- [x] [**RFCT-152 PLAN-015 M6: form compression in os/rootfs, build-env, podman, boards, tests, update and tools**](RFCT-152.md) `P2`
- [x] [**RFCT-153 PLAN-015 M6: form compression in test/, mosd/ and board/**](RFCT-153.md) `P2`
- [x] [**RFCT-154 PLAN-015 M6: the index rows, the metric re-run and the aggregate survivor record**](RFCT-154.md) `P2`
- [x] [**RFCT-160 PLAN-018 M1: board/ moves under os/boards/, every consumer repointed**](RFCT-160.md) `P2`
- [x] [**RFCT-161 PLAN-018 M2: board.yaml retired into board.env comments**](RFCT-161.md) `P2`
- [x] [**RFCT-162 PLAN-018 M3: board/x64 deleted, the stale x64 Makefile line corrected, board/ gone**](RFCT-162.md) `P2`
- [x] [**RFCT-163 PLAN-018 M4: documentation path citations follow the move**](RFCT-163.md) `P2`
- [x] [**RFCT-155 PLAN-017 M1: api.md reconciled against openapi.json and HEAD**](RFCT-155.md) `P2`
- [x] [**RFCT-156 PLAN-017 M2: remote-management.md rewritten present-tense for the mos daemon set**](RFCT-156.md) `P2`
- [x] [**RFCT-157 PLAN-017 M3: boards.md and display.md re-measured against os/build and os/boards**](RFCT-157.md) `P2`
- [x] [**RFCT-158 PLAN-017 M4: the provenance lines in access.md, connd.md and provisioning.md**](RFCT-158.md) `P2`
- [x] [**RFCT-159 PLAN-017: the five task records, the five index rows and the plan's status**](RFCT-159.md) `P2`
- [x] [**RFCT-165 PLAN-019 M1: the os/pkgs target layout, designed before it is executed**](RFCT-165.md) `P2`
- [x] [**RFCT-166 PLAN-019 M2: podman and rauc move under os/pkgs/**](RFCT-166.md) `P2`
- [x] [**RFCT-167 PLAN-019 M3: update/sign becomes os/pkgs/rauc-sign, its own workspace**](RFCT-167.md) `P2`
- [x] [**RFCT-168 PLAN-019 M4: mosd/ moves to os/pkgs/mosd/, every consumer repointed**](RFCT-168.md) `P2`
- [x] [**RFCT-169 PLAN-019 M5: the tree-wide reference sweep and the campaign closeout**](RFCT-169.md) `P2`
- [x] [**RFCT-170 PLAN-020 M1: the citation checker arms both orders, counts its demotions, and holds a census**](RFCT-170.md) `P2`
- [x] [**RFCT-171 PLAN-020 M2: the index checkbox is compared with the record's status head, after the vocabulary is unified**](RFCT-171.md) `P2`
- [x] [**RFCT-172 PLAN-020 M3: citation scanning widened to docs/task and docs/research, with the dated-record exemption**](RFCT-172.md) `P2`
- [x] [**RFCT-173 PLAN-020 M4: the self-test fixture repoints to os/pkgs, and the unquoted count becomes a ratchet**](RFCT-173.md) `P2`
- [x] [**RFCT-180 PLAN-021 M1: the quick-fix batch**](RFCT-180.md) `P2`
- [x] [**RFCT-190 PLAN-021 M3a: the os tree ghost-reference sweep — provenance and board tokens**](RFCT-190.md) `P2`
- [x] [**RFCT-191 PLAN-021 M3b: docs ghost sweep, recorded residuals, owner sweep and gate repairs**](RFCT-191.md) `P2`
- [x] [**RFCT-200 PLAN-022 M1: native networking design - VLAN, bridge, WireGuard**](RFCT-200.md) `P1`
- [x] [**RFCT-201 PLAN-022 M2: quoted-segment path syntax**](RFCT-201.md) `P1`
- [x] [**RFCT-202 PLAN-022 M3: schema v7 - interface kinds**](RFCT-202.md) `P1`
- [x] [**RFCT-203 PLAN-022 M4: VLAN and bridge reconcile**](RFCT-203.md) `P1`
- [x] [**RFCT-204 PLAN-022 M5: WireGuard keystore and tunnel reconcile**](RFCT-204.md) `P1`
- [x] [**RFCT-205 PLAN-022 M6: the apid surface - panes, rotate route, redaction, OpenAPI**](RFCT-205.md) `P1`
- [x] [**RFCT-206 PLAN-022 M7: kernel fragment and on-image proof**](RFCT-206.md) `P1`
- [x] [**RFCT-207 PLAN-022 M8: the design documents, made true**](RFCT-207.md) `P1`
- [x] [**RFCT-208 PLAN-022 records brought green under PLAN-020's hardened docs gates**](RFCT-208.md) `P2`
- [x] [**RFCT-209 Reconciling PLAN-021 with PLAN-022: fourteen conflicted files, one tree**](RFCT-209.md) `P1`
- [x] [**RFCT-210 PLAN-023 M1: the write-surface design (USER-GATED)**](RFCT-210.md) `P1`
- [x] [**RFCT-211 PLAN-023 M2 part 1: access.apiTokens in the settings model**](RFCT-211.md) `P1`
- [x] [**RFCT-212 PLAN-023 M3: GET /api/v1/health and the §2.4 envelope on 405**](RFCT-212.md) `P1`
- [x] [**RFCT-213 PLAN-023 M2 part 2: apid bearer auth, the token routes, the builtin mint**](RFCT-213.md) `P1`
- [x] [**RFCT-214 PLAN-023 closeout: the api.md citation re-anchor, all three forms**](RFCT-214.md) `P1`
- [x] [**RFCT-216 rauc-sign root-rotation tooling, before the first ceremony's one-year expiry**](RFCT-216.md) `P1`
- [x] [**RFCT-220 PLAN-011 bus v2 audited milestone by milestone, and its closeout recommended**](RFCT-220.md) `P1`
- [x] [**RFCT-221 PLAN-012 container-engine audit: milestone verdicts and closeout recommendation**](RFCT-221.md) `P1`
- [x] [**RFCT-222 PLAN-013 audited: the x64/QEMU vehicle measured against the tree it asked for**](RFCT-222.md) `P1`
- [x] [**RFCT-223 A scheduled upstream-tag check for the container engine's six pins**](RFCT-223.md) `P2`
- [ ] [**RFCT-224 Decide and settle container.enabled's bus writability, for the class and not one key**](RFCT-224.md) `P2`
- [x] [**RFCT-225 The image-freshness guard did not survive the verifier port, and exists in no module today**](RFCT-225.md) `P2`
- [x] [**RFCT-226 The /var/log package-manager residue, now load-bearing for the stage-order gate**](RFCT-226.md) `P2`
- [x] [**RFCT-227 PLAN-024 M2: the ratified closeout of PLAN-011, PLAN-012 and PLAN-013, and four residues filed**](RFCT-227.md) `P1`
- [x] [**RFCT-230 PLAN-025 M1: the QEMU boot engine ported into the harness that is its only caller**](RFCT-230.md) `P1`
- [x] [**RFCT-231 PLAN-025 M2a: cx3576 builder unpin and mos-build-* reachability**](RFCT-231.md) `P1`
- [x] [**RFCT-232 PLAN-025 M3a: /state 404 and the two mosd.md dated notes**](RFCT-232.md) `P2`
- [x] [**RFCT-233 PLAN-025 M4: the harness facts, committed as one citation-gated page**](RFCT-233.md) `P2`
- [x] [**RFCT-234 PLAN-025 M2b: the arm64 builder family, cx3576 rauc, and the RFCT-206 section 7 pass**](RFCT-234.md) `P1`
- [x] [**RFCT-235 The podman base at two architectures in one build: MOS_BUILD_BASE_NATIVE**](RFCT-235.md) `P2`
- [ ] [**RFCT-260 The AP reconciler's third copy of the WPA byte rule, and a refusal that names the secret's length**](RFCT-260.md) `P2`
- [x] [**RFCT-240 PLAN-023 M4: the scalar settings writes and the redaction-sentinel refusal**](RFCT-240.md) `P1`
- [x] [**RFCT-241 PLAN-023 M5: the SSH authorized-keys and WiFi-networks collections**](RFCT-241.md) `P1`
- [x] [**RFCT-242 PLAN-023 M6: the network cluster typed, WireGuard peers, rotate-key 404**](RFCT-242.md) `P1`
- [x] [**RFCT-243 PLAN-023 M7: the reboot, poweroff and transient-root-password actions**](RFCT-243.md) `P1`
- [x] [**RFCT-244 PLAN-023 M8: POST /api/v1/setup**](RFCT-244.md) `P1`
- [x] [**RFCT-245 PLAN-023 M9: the cookie cutover on /api/v1/**](RFCT-245.md) `P1`
- [x] [**RFCT-246 PLAN-023 M9 prerequisite: test/apid-api drives bearer end to end**](RFCT-246.md) `P1`
- [x] [**RFCT-215 PLAN-023 closeout: api.md section 1 re-measured against the final surface**](RFCT-215.md) `P1`
