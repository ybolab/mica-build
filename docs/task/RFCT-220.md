# RFCT-220 PLAN-011 bus v2 audited milestone by milestone, and its closeout recommended

- **status**: completed — seven milestone-level verdicts and seven decision verdicts measured against the tree; six of seven milestones implemented, M6 genuinely open, the carried-twice image verification partly discharged
- **priority**: P1
- **owner**: bkd/q22mfbhb
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-024 (M1)

## 1. What was audited, and against what tree

`docs/plan/PLAN-011.md` — its `relatedTask` and `milestones` fields, its
milestone table, and decisions D1–D7 — measured against this worktree at
`a86ab46`, the commit PLAN-024 was approved on. Nothing was implemented and no
plan file, design file or source file was edited: the two files written are
this record and one index row.

Every verdict below was reached by opening the artifact. Where the plan names a
path, the path was resolved; where it names a behaviour, the code or the
verifier check that carries it was read. A `relatedTask` entry saying
*"complete"* was treated as a claim and is reported as verified, moved, or
downgraded.

**The single fact that shapes this whole audit: the plan's paths no longer
exist.** PLAN-011 was written when the daemon workspace lived at `mosd/` in the
repository root. It was moved wholesale — `refactor(os): move mosd/ to
os/pkgs/mosd/ and rewrite gated citations` (`ec202f1`) — and the plan file was
not rewritten with it, because `docs/verify-citations.sh` scans
`docs/design`, `docs/task`, `docs/research` and `docs/architecture.md` and
**not** `docs/plan`: *"The documents scanned are"* (`docs/verify-citations.sh:10`).
Twenty-two distinct repository paths cited in PLAN-011 resolve to nothing today. In every
case measured below the *artifact* is present and the *path* is what rotted, so
the verdicts are `implemented`, not `open` — but the plan file as it stands
cites a tree that has not existed since `ec202f1`.

## 2. Milestone verdicts

| Milestone | Verdict | Evidence |
|---|---|---|
| M1 — the D1/D2 contract in `bus.md`, read-only item façade | **implemented** | see 2.1 |
| M2 — writable items and `/Actions/*` | **implemented** | see 2.2 |
| M3 — the `mos-mqttd` bridge | **implemented** | see 2.3 |
| M3's deferred image wiring (RFCT-097) | **implemented** | see 2.4 |
| M4 | **withdrawn, and the withdrawal holds** | see 2.5 |
| M5 — extension enablement | **implemented**, its verifier half **superseded** | see 2.6 |
| M6 — device attach | **genuinely open** | see 2.7 |
| M7 — the MQTT master switch and the broker | **implemented** | see 2.8 |

### 2.1 M1 — implemented

The contract document exists and carries per-section status markers. §1.1 is
headed *"Interface definition [implemented]"* (`docs/design/bus.md:68`), and the
document's own convention is stated at *"**[proposed]** — no code; this document
is asking for it."* (`docs/design/bus.md:43`), so the marker is a measurement
rather than a mood.

The read-only façade ships. `os/pkgs/mosd/mosd/src/tree.rs` opens
*"The `com.mos.Item1` item-tree façade."* (`os/pkgs/mosd/mosd/src/tree.rs:1`),
and the redaction M1 required is one funnel, not a scatter of call sites —
*"The ONE redaction point of the façade"* (`os/pkgs/mosd/mosd/src/tree.rs:135`),
reached by every projection at
*"Project both trees into one redacted flat item map, then the action items"*
(`os/pkgs/mosd/mosd/src/tree.rs:200`).

The D6 Sparkplug B evaluation M1 was told to record is present as two sections,
*"Sparkplug B, compared"* (`docs/design/bus.md:641`) and
*"Decision"* (`docs/design/bus.md:662`).

### 2.2 M2 — implemented

The five writable platform subtrees are a fixed list in the façade —
`const WRITABLE_SUBTREES: [&str; 5] = [` (`os/pkgs/mosd/mosd/src/tree.rs:51`) —
and the two action items are where D3 put them:
`Self::Reboot => "/Actions/reboot",` (`os/pkgs/mosd/mosd/src/actions.rs:46`).
apid drives them as items, not as methods:
`const REBOOT_ACTION: &str = "/Actions/reboot";`
(`os/pkgs/mosd/apid/src/bus_client.rs:55`).

**The fork-resolution citation is superseded, the resolution is not.** M2 claims
the D3 fork was resolved in `docs/design/api.md` §10.3. That section no longer
exists: PLAN-015 M5 deleted it — *"api.md §10 and resolved-question annotations
deleted"* (`docs/plan/PLAN-015.md:167`) — as 751 lines of defect register,
*"`docs/design/api.md` §10 (751 lines) is a defect register"*
(`docs/plan/PLAN-015.md:81`). The decision itself was restated in place, in §2's
own register: *"reaches the same two actions through the item tree instead: the
shipped path is"* (`docs/design/api.md:357`). So the substance survives at a new
anchor and only PLAN-011's pointer is dead.

### 2.3 M3 — implemented

The bridge crate is at `os/pkgs/mosd/mqttd/`, its protocol still the pure state
machine M3 promised — *"The protocol, as a state machine."*
(`os/pkgs/mosd/mqttd/src/bridge.rs:1`). `bus.md` §10.1 is flipped and carries
paths: *"The mos-native grammar, as shipped in"* (`docs/design/bus.md:468`).

**Two of RFCT-091's four recorded limits are still open, and were never
milestones.** Multi-service publication remains a single name —
`pub const SERVICE: &str = "com.mos.mosd";`
(`os/pkgs/mosd/mqttd/src/config.rs:66`) — with the change point named in place,
*"One service today. mosd's service registry is what turns this into a set,"*
(`os/pkgs/mosd/mqttd/src/config.rs:62`). TLS to the broker is likewise absent, as
RFCT-091 recorded: *"TLS to the broker is not implemented."*
(`docs/task/RFCT-091.md:140`). Both are decisions the plan deliberately deferred
rather than milestones it left unfinished, and both are named in the tree at the
point a future change would touch.

### 2.4 M3's deferred image wiring (RFCT-097) — implemented

The unit ships in the crate's own `dist/` rather than the workspace's, and takes
its broker from STATE exactly as claimed:
`EnvironmentFile=-/var/lib/mos/mqttd.env`
(`os/pkgs/mosd/mqttd/dist/mos-mqttd.service:31`). The per-member D-Bus grant on
`com.mos.mosd` is its own file, which owns no name of its own —
*"This file OWNS NO BUS NAME. mos-mqttd never calls RequestName"*
(`os/pkgs/mosd/dist/mos-mqttd.conf:5-6`). The static account is created by the
image build — *"Create the pinned mos-mqttd service account"*
(`os/rootfs/scripts/account-mos-mqttd.sh:2`).

One behaviour named by RFCT-097 was **deliberately reversed by M7** and the
verifier records the reversal rather than the original: RFCT-097 enabled the
bridge unconditionally, and today the assertion is
`id: 'mqttd-not-enabled',` (`os/verify/src/checks-mqtt.ts:184`). That is M7
working as designed, not a regression.

### 2.5 M4 — withdrawn, and the withdrawal holds

The plan withdrew D4 and said the number is not reused. Measured: the string
`com.mos.Settings1` appears nowhere in the tree except PLAN-011's own two
mentions of it, one of them the withdrawal heading
*"WITHDRAWN 2026-08-22 (user direction): no"* (`docs/plan/PLAN-011.md:168`). No `RegisterSettings` member, no `/ext/`
projection and no `extensions.*` subtree exists. The settings schema did move —
`pub const SCHEMA_VERSION: u32 = 7;`
(`os/pkgs/mosd/mosd-settings/src/model.rs:11`) — but by D7's v6 and PLAN-022's
v7, not by anything D4 asked for, so the claim *"no settings schema change
anywhere in PLAN-011"* is now false of the plan as amended by D7 and remains
true of D4.

### 2.6 M5 — implemented; its verifier half superseded

Every D5 artifact is present. The policy is the single rule the decision
specified: `<allow own_prefix="com.mos.ext"/>`
(`os/pkgs/mosd/dist/com.mos.ext.conf:56`). The STATE bind targets the directory
M5's measurement chose: `Where=/usr/local/lib/systemd/system`
(`os/rootfs/overlay-v2/etc/systemd/system/usr-local-lib-systemd-system.mount:38`),
seeded with a bare `mkdir` and a comment saying why —
*"There is deliberately NO"*
(`os/rootfs/overlay-v2/usr/lib/mos/mos-seed-state:70`). The one class rule is a
crate, `pub const EXTENSION_PREFIX: &str = "com.mos.ext.";`
(`os/pkgs/mosd/busname/src/lib.rs:36`), consumed by the bridge at
*"the two halves of the namespace put it in different places"*
(`os/pkgs/mosd/mqttd/src/topic.rs:33`). The registry publishes into live state
under the key the plan names: `pub const STATE_KEY: &str = "services";`
(`os/pkgs/mosd/mosd/src/scan.rs:53`), with the conformance field at
`self.conformance.to_json(),`
(`os/pkgs/mosd/mosd/src/scan.rs:189`). The live-bus policy harness survives:
*"own_prefix semantics against a real dbus-daemon"*
(`os/pkgs/mosd/hack/dbus-policy-test.sh:497`).

**Superseded: the verifier the milestone's Verify column names.** M5 put its D5
assertions in `check_ext_unit_dir` inside `os/verify-image-v2.sh`, driven by
`os/ui-location-test.sh`. Neither file exists. PLAN-014 M4 ported the verifier
under measured per-check parity — *"Full per-check parity with the TS port"*
(`docs/plan/PLAN-014.md:572`) — and `os/verify/run.sh` says so in its own help:
*"os/verify-image-v2.sh printed before this package replaced it."*
(`os/verify/run.sh:57`). The assertions themselves came across intact: the
mountpoint is still a packed mountpoint —
`'/usr/local/lib/systemd/system', '/etc/containers/systemd',`
(`os/verify/src/checks-fstab.ts:40`), transcribed a second time at
`'/usr/local/lib/systemd/system', '/etc/containers/systemd',`
(`os/verify/src/checks-root.ts:364`) — and the negative guard M5 built against its own rejected option is still there —
*"no unit in the image mounts anything over /etc/systemd/system;"*
(`os/verify/src/checks-home.ts:781`).

### 2.7 M6 — genuinely open

Nothing in the tree delivers *"Device attach: udev rule → systemd template
instance for serial/CAN-attached extensions (the serial-starter analog)"*
(`docs/plan/PLAN-011.md:499`). Searched: the repository contains exactly one
udev rule file, and no unit template of any kind ships in any `dist/` or
overlay. There is no rendering step, no verifier check for one, and no naming
convention written down for what a template instance for a `com.mos.ext.*`
service would even be called.

**What does exist is the mechanism, proven on this image for a different
purpose.** The gadget console is started by exactly the shape M6 describes:
`SUBSYSTEM=="tty", KERNEL=="ttyGS0", TAG+="systemd", ENV{SYSTEMD_WANTS}+="serial-getty@ttyGS0.service"`
(`os/boards/cx3576/hwinit/60-mos-gadget-getty.rules:4`), installed into the
image and asserted by the verifier at
*"'/usr/lib/udev/rules.d/60-mos-gadget-getty.rules',"*
(`os/verify/src/checks-board.ts:698`). So M6 is not blocked on an unknown: it is
one rule file, one template unit and one verifier check away, and the pattern it
would copy is already green in this tree.

**What is missing, precisely:** a `dist/`-shipped systemd template unit for
extension device services; a udev rule that maps a matched serial or CAN device
to an instance of it; the naming rule that turns a device node into the
instance name; a `os/verify` check asserting both are in the packed root; and a
line in `docs/design/bus.md` §5 saying which of the class registry's entries the
rule matches on. Every one of those files is under `os/**`.

### 2.8 M7 — implemented

The `mqtt` subtree and its migration survive two later schema bumps —
*"v5 -> v6: adds the `mqtt` subtree carrying the broker/bridge master switch."*
(`os/pkgs/mosd/mosd-settings/src/migration.rs:331`), seeding false as D7(e)
required: *"stamps `schema_version = 6` and adds `mqtt.enabled = false` when"*
(`os/pkgs/mosd/mosd-settings/src/migration.rs:333`). The broker is a workspace
crate, `name = "mos-mqtt-broker"` (`os/pkgs/mosd/broker/Cargo.toml:2`), wrapping
`rumqttd = { workspace = true }` (`os/pkgs/mosd/broker/Cargo.toml:14`). The
reconciler drives both units and renders the config D7 specified —
`const DEFAULT_CONFIG_PATH: &str = "/run/mos/mqtt-broker.toml";`
(`os/pkgs/mosd/mosd/src/reconciler/mqtt.rs:38`). apid serves the pane:
`.route("/mqtt", get(mqtt_form))` (`os/pkgs/mosd/apid/src/routes.rs:193`).
`bus.md` grew the section it was told to: *"The broker the bridge connects to [implemented]"*
(`docs/design/bus.md:583`).

The inert install survives the Dockerfile split. M7 cites `os/rootfs/Dockerfile.v2`,
which no longer exists — the build is staged now — and the account is created in
`os/rootfs/stages/34-feature-mqtt.Dockerfile`, which runs
`sh /mos-scripts/account-mos-mqtt-broker.sh`
(`os/rootfs/stages/34-feature-mqtt.Dockerfile:92`) with the pinned id explained
where it is chosen: *"The number is 969 because it is the next free number below the 970 mos-mqttd"*
(`os/rootfs/stages/34-feature-mqtt.Dockerfile:79`).

## 3. Decision verdicts, D1–D7

None of the seven decisions has been superseded by a later campaign; all seven
still describe the shipped system. Two carry stated remainders.

- **D1, one item interface — implemented.** §2.1.
- **D2, naming, mandatory paths, class registry — implemented in its naming
  half, genuinely open in its mandatory-paths half, and the design document
  already says so.** The grammar and class rule ship (§2.6). The seven mandatory
  paths do not: `docs/design/bus.md` §6 is still headed *"Mandatory paths and the
  alarm convention [proposed]"* (`docs/design/bus.md:301`), mosd publishes none
  of them, and the bridge carries the consequence as a documented fallback —
  *"instance` is the service's `/DeviceInstance` (§6), `0` until a service"*
  (`os/pkgs/mosd/mqttd/src/topic.rs:38`). This is a producer-side obligation with
  no producer in the tree, so it is open by construction rather than by neglect.
- **D3, actions are writable items — implemented.** §2.2.
- **D4 — withdrawn, verified absent.** §2.5.
- **D5, extension services — implemented.** §2.6.
- **D6, the MQTT bridge — implemented, with two recorded gaps.** §2.3.
- **D7, the master switch and the broker — implemented.** §2.8. Its (d) clause
  still holds: `mqtt` is absent from the five-entry writable set
  `const WRITABLE_SUBTREES: [&str; 5] = [`
  (`os/pkgs/mosd/mosd/src/tree.rs:51-56`), so the switch is reachable from apid
  and not over the bus, as designed.

## 4. Discrepancies between the plan's own claims and the tree

1. **The status field is wrong.** The plan reads `- **status**: implementing`
   (`docs/plan/PLAN-011.md:3`) and the index row carries `[-]`. Six of seven
   milestones are landed and nothing is in flight; the honest head is
   `completed` with M6 routed out, or `closed` if M6 is withdrawn. This is the
   checkbox-vs-reality gap PLAN-024 exists to close.
2. **Twenty-two cited repository paths do not resolve** (§1), including every
   `mosd/...` path in the `milestones` field and in the M5 and M7 rows, plus
   `os/verify-image-v2.sh`, `os/ui-location-test.sh` and
   `os/rootfs/Dockerfile.v2`. No gate catches this because `docs/plan` is out of
   `docs/verify-citations.sh`'s scope.
3. **`api.md` §10.3 is cited and no longer exists** (§2.2).
4. **The M5 and M7 Verify columns describe a verifier that was replaced**
   (§2.6). Their assertions live, their harness does not.
5. **The plan quotes two user directives in Chinese.** They sit in the
   open-questions list, against the reserved-namespace answer
   *"ANSWERED 2026-08-22 (user): option C"* (`docs/plan/PLAN-011.md:588-589`)
   and the D4 answer *"D4 is withdrawn above."*
   (`docs/plan/PLAN-011.md:594-595`). Repository policy is English for
   documentation, and these are the only such lines the audit found in the
   file; the English gloss beside each carries the same decision, so removing
   the quoted originals loses nothing. Flagged, not edited — this record has no
   licence over a plan file.
6. **Twelve source doc-comments still spell the pre-`ec202f1` paths**, e.g.
   *"`mosd/mosd/src/reconciler/mqtt.rs`; the reconciler's"*
   (`os/pkgs/mosd/apid/src/routes.rs:3344`). Not a PLAN-011 defect and not this
   record's to fix; routed in §6.

## 5. The outstanding verification carried twice — partly discharged

RFCT-097 and RFCT-104 hand on the same debt: no assembled image built or booted,
so the broker had never started and `MqttReconciler` had never driven real
systemd. Measured against today's tree, that debt is **partly discharged, and
the remaining half is precise**.

**Discharged.** PLAN-022 M7 built and booted an assembled x64 image, twice:
*"| `make os-apid-api-test` | `RESULT: PASS (329/329 checks)` — boot 1 `PASS (299/299)`, boot 2 `PASS (17/17)`, 9 skipped |"*
(`docs/task/RFCT-206.md:415`), alongside
*"| `bash os/verify/run.sh --verify --board x64` | `RESULT: PASS (292/292 checks, 22 skipped)`"*
(`docs/task/RFCT-206.md:410`) — and `--verify` reads an assembled image, not a
fixture: *"It runs the os/verify check register against one assembled image"*
(`os/verify/run.sh:55`). The eleven MQTT image checks were in that run and could
not have been skipped for board reasons, because the register asserts they carry
no board gate:
`for (const c of MQTT_CHECKS) expect(`
(`os/verify/src/checks-mqtt.test.ts:76`). That answers RFCT-104's own stated
boundary — that its image assertions proved only that the verifier could fail.
The apid half is answered too: the `/mqtt` skew guard was deleted and replaced
with real coverage on a matching image — *"The `/mqtt` image-skew guard is
deleted and its own stated remedy applied"* (`docs/task/RFCT-206.md:345`).

**Still open, and narrower than it was.** Nothing has ever set `mqtt.enabled` to
true on a booted device. The over-the-wire suite exercises `/mqtt/enable` only
as a method-shape probe — it appears in the POST-only list,
`"/mqtt/enable",` (`test/apid-api/src/phases/04-readonly.ts:261`) — and no phase
turns the switch on. So `mos-mqtt-broker` has still never started, and
`MqttReconciler` has still never driven a real systemd transition; every
unit-control assertion remains against `MockUnitControl`. RFCT-091's second
recorded limit is the same gap seen from the bridge side:
*"`runtime::run` is not covered by the double"* (`docs/task/RFCT-091.md:132`).
Separately, **no arm64 image was built at all** — *"| cx3576 image build |
**blocked** — no host arm64 binfmt; section 7 |"* (`docs/task/RFCT-206.md:414`).

Closing it is one more phase in the booted-image harness plus a rebuilt image,
i.e. `test/apid-api/**` and `os/**` work. **Routed to PLAN-025**, per PLAN-024's
routing rule; it is not proposed here.

## 6. The RFCT-104 number collision

**PLAN-011 M7 and PLAN-013 M1 both name RFCT-104, and the record carries
PLAN-011's work.** The record's own title is
*"A master switch for MQTT, and a broker for the bridge that has only
ever retried"* (`docs/task/RFCT-104.md:1`) — D7's switch and broker, i.e.
PLAN-011 M7. PLAN-013's milestone heading claims the same number for different
work: *"M1 — the x64 image verified, statically and at runtime (RFCT-104)"*
(`docs/plan/PLAN-013.md:150`).

The mechanism is visible: PLAN-013 is still unapproved — `- **status**: proposal`
(`docs/plan/PLAN-013.md:3`) — and pre-allocated 104, 105 and 106 in its file list,
*"`docs/`: PLAN-013, RFCT-104/105/106, index rows"* (`docs/plan/PLAN-013.md:299`).
Two of the three landed as PLAN-013-shaped work — RFCT-105 is the over-the-wire
suite and RFCT-106 the x64 A/B fix — while 104 was taken on 2026-08-24 by
PLAN-011's out-of-band D7 amendment. PLAN-013 M1's identifier is therefore
orphaned.

**Recorded as a finding and stopped there.** PLAN-013 is another auditor's
record under PLAN-024 M1; renumbering, or deciding whether M1's substance was
delivered elsewhere, is that audit's call and not this one's.

## 7. Routed to siblings

- **To PLAN-025 (`os/**`, `test/apid-api/**`):** the remaining half of the
  carried-twice verification (§5) — a boot that turns `mqtt.enabled` on and
  observes the broker start under real systemd, and an arm64 image build.
- **To PLAN-025 (`os/**`):** M6 in its entirety, if it is kept (§2.7, §8b) —
  every file it would touch is under `os/`.
- **To PLAN-025 (`os/pkgs/mosd/**`) and PLAN-023 (apid):** the twelve stale
  `mosd/...` doc-comment paths (§4 item 6), of which the apid ones sit in
  `os/pkgs/mosd/apid/src/routes.rs`. Cosmetic, ratchet-free, and named only so
  the next sweep has a count.

## 8. Recommendation

**Mixed: close PLAN-011 with a dated amendment (shape a) for M1, M2, M3, M4,
M5 and M7; carry M6 as one named task (shape b), routed out of PLAN-011.**

### 8a. The amendment to append, and the status line to carry

The plan's status line should become:

    - **status**: completed — M1, M2, M3, M5, M7 landed; M4 withdrawn 2026-08-22; M6 routed to PLAN-025 unbuilt (see Amendment 1)

and the `docs/plan/index.md` row marker moves from `[-]` to `[x]`.

The literal text to append to `docs/plan/PLAN-011.md` — **drafted here, not
appended**:

```
## Amendment 1 — closeout, 2026-08-28 (PLAN-024 M1, RFCT-220)

PLAN-011 closes. Six of its seven milestones are in the tree and were verified
artifact by artifact by RFCT-220; the seventh is withdrawn from this plan
rather than left open under it.

**Landed.** M1 (the D1/D2 contract in docs/design/bus.md and the read-only
com.mos.Item1 façade), M2 (writable items and the /Actions/* verbs), M3 (the
mos-mqttd bridge) with its deferred image wiring, M5 (extension enablement:
the com.mos.ext policy, the STATE unit bind, the one class rule and the
NameOwnerChanged registry) and M7 (the mqtt master switch and the in-image
broker). M4 was withdrawn on 2026-08-22 and its number is not reused; RFCT-220
confirmed no com.mos.Settings1, no RegisterSettings and no extensions.* subtree
exists anywhere in the tree.

**Paths in this file are pre-ec202f1 and are not rewritten.** The daemon
workspace moved from mosd/ to os/pkgs/mosd/ and the image verifier was replaced
by the os/verify package (PLAN-014 M4); os/rootfs/Dockerfile.v2 became the
staged builds under os/rootfs/stages/; docs/design/api.md section 10 was deleted
by PLAN-015 M5 and the D3 fork resolution now lives in that document's section 2
register. Twenty-two distinct paths cited above therefore resolve to nothing. They are
left as written, because this is a dated decision record and re-pointing it at a
later tree would falsify what was measured when. docs/design/bus.md is the
current, gate-checked description of the shipped contract and is where a reader
should go for live paths.

**M6 is not delivered and does not stay here.** Device attach — a udev rule
driving a systemd template instance, the serial-starter analog — has no artifact
in the tree. Every file it would touch is under os/**, and it has no consumer
today: no com.mos.ext.* service ships or is known to be in development. It moves
to PLAN-025 as an unbuilt item rather than remaining an open milestone of a
closed plan.

**Two deliberate gaps recorded by D6, both still open and both still decisions
rather than debts.** The bridge publishes one bus name; mosd's D5 registry is
what turns that into a set, and the single point of change is named in
os/pkgs/mosd/mqttd/src/config.rs. TLS to the broker is unimplemented, awaiting a
deployment that needs it.

**One outstanding verification, narrowed.** RFCT-097 and RFCT-104 both handed on
"no assembled image was built or booted". PLAN-022 M7 (RFCT-206) discharged most
of it: an x64 image was built, booted twice, and the MQTT image checks and the
apid /mqtt pane were verified on it. What remains is that nothing has ever set
mqtt.enabled to true on a booted device, so mos-mqtt-broker has never started
and MqttReconciler has never driven real systemd; and no arm64 image has been
built at all. Both are os/** and harness work and are routed to PLAN-025.
```

### 8b. M6 as a named task — proposed, not allocated

**The number below is proposed from the RFCT-223..229 pool and is not
allocated; no file was created for it. Its write scope is `os/**`, so it is
marked route to PLAN-025 and is deliberately not reserved in PLAN-024's own
milestone set.**

**RFCT-223 — Device attach: a udev rule and a systemd template instance for
extension device services** *(proposed; route to PLAN-025)*

*Scope.* Ship the serial-starter analog PLAN-011 M6 specified: one systemd
template unit under a crate `dist/` (or the v2 overlay) that an extension
service instantiates per attached device, one udev rule that matches serial and
CAN device nodes and pulls in the corresponding instance via `SYSTEMD_WANTS`,
and the naming rule that maps a device node to an instance name. The pattern to
copy is already in the image and already asserted — the cx3576 gadget console
rule — so this is a generalisation of a working mechanism, not a new one. The
rule must not start anything by itself: it names an instance, and whether a unit
by that name exists is the integrator's business, which is the same posture D5
takes on lifecycle. Before writing it, settle in `docs/design/bus.md` §5 which
class-registry entries the rule matches on, because a rule that matches every
`tty` is a rule that fights `serial-getty@`.

*Acceptance criteria.* (1) The rule and the template unit are in the packed root
and a new `os/verify` check asserts both, with a negative fixture proving the
check can fail — the standard this tree holds every image assertion to. (2) The
instance-name derivation is unit-tested against at least one serial and one CAN
device path. (3) No hardware claim is made: the milestone's own Verify column
says *"hardware claims explicitly **not** made (repo discipline)"*
(`docs/plan/PLAN-011.md:499`), and an offline verifier assertion is the whole
deliverable. (4) `bash os/verify/run.sh` and `bash docs/verify-citations.sh`
green.

*Files it would touch.* `os/boards/*/hwinit/` or `os/rootfs/overlay-v2/usr/lib/udev/rules.d/`
(new rule), a new template unit under `os/rootfs/overlay-v2/` or a crate `dist/`,
`os/rootfs/stages/` (install), `os/verify/src/` (check plus fixture and test),
`docs/design/bus.md` §5, and this task's record and index row.

*Alternative worth stating.* Withdraw M6 outright, the way M4 was withdrawn.
There is no `com.mos.ext.*` producer in the tree and no fielded integrator
waiting on it, and D5's whole posture is that mos does not own extension
lifecycle — a template instance mos ships is a small step back toward owning it.
If the user prefers withdrawal, the amendment's M6 paragraph becomes a
withdrawal paragraph and no task is created. RFCT-220 does not pick between
these; the gate does.

## 9. Verification

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | see the Outcome line below |
| `bash docs/verify-index.sh` | see the Outcome line below |

No source, design or plan file was edited by this task. The two files written
are `docs/task/RFCT-220.md` and one appended row in `docs/task/index.md`.

<!-- dated-record: the PLAN-024 M1 audit, frozen at `a86ab46`; its citations name the plan heads and the sibling plans as they stood before the PLAN-024 M2 closeout (RFCT-227) amended them, and re-pointing them would falsify what was measured when; exempt from docs/verify-citations.sh (RFCT-172) -->
