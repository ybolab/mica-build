# 20260910-1013-open-plans-campaign Establish open plans campaign tracking

- **status**: in_progress
- **priority**: P1
- **owner**: bkd/z36xbrtu
- **createdAt**: 2026-09-10 10:13


## Current development integration decision (2026-09-12)

The user authorized the remaining reviewed source integration and continuation
on a new development machine. Main `4a451011` includes reviewed B `3a5127d5`
and all other committed local branches. The current `ae40a791` root has passed
12/12 packed-binary smoke checks and independent root-signature verification.
Its kernel/support, firmware and complete image remain unfinished. The earlier
`ed7231cd` complete image failed GPT discovery in the guest and is historical
evidence, not the corrected candidate. Guest, ARM cold-root and physical
acceptance remain open.

The [development handoff](../development-handoff.md) is the current restart
point, with remaining work, source identities and transfer requirements. At
10:19 UTC the L1 watchdog was paused and its turn stopped; B/B7 had no live
build. Earlier automatic-continuation instructions below are superseded by
this pause. Resume on the new machine after restoring and verifying inputs;
keep x64 first and reuse unaffected stages. No push, publication or unfinished
task completion is implied.

## Description

Establish the ownership and lifecycle registry for campaign
`mos-open-plans-20260910-100408`, coordinated by L1 issue `#314` / `10nksom6`
against integration branch `main` from committed source base
`5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`.

The approved authorization covers parallel dispatch and handling of the four
bounded workstreams, scoped local L3 commits, and L3-to-L2 merges. It does not
authorize an L2-to-`main` merge, remote push or publication, or a `done`
transition.

Compatibility is outside the campaign scope. Development uses fresh, complete
flashing of the newest image; work must not add historical compatibility
readers, migrations, RAUC restoration, old raw-slot paths, or old
update-package support merely to satisfy historical records.

## ActiveForm

Paused for development-machine transfer; remaining acceptance is recorded in
the development handoff.

## Ownership Registry

L1 observed all four unique 15-minute L2 crons enabled and nondeleted at
2026-09-10 10:14–10:15 UTC. Execution states below are evidence at that time,
not timeless completion claims.

| Workstream | Coordinator | Cron | L3 grant/use | Expensive grant/use | Scope |
|------------|-------------|------|---------------|---------------------|-------|
| A | `#315` / `6064wf7l` | `gf4aphxr` | 2/2 | 1/0 | Board repairs and current hardware acceptance |
| B | `#316` / `8t4ghqi6` | `nkglvdlt` | 1/1 | 0/0 | Minimal boot/shutdown and explicit rootfs |
| C | `#317` / `58sdocnk` | `w8lj5nbz` | 2/2 | 0/0 | Current management feature backlog |
| D | `#318` / `z36xbrtu` | `v2kr5k8p` | 1/D1 | 0/0 | Task/plan reconciliation and global documentation |

### Workstream C

- C1 `#320` / `kpuc7zcb` (`codex/gpt-5.6-sol`) was isolated and running at
  the snapshot. It classifies PLAN-070/071 and RFCT-315 and owns
  `docs/task/20260910-1012-c-config-update-obligations.md`,
  `docs/plan/20260910-1012-c-config-update-obligations.md`, and only its own
  index rows.
- C2 `#321` / `3nblyzz4` (`codex/gpt-5.6-sol`) was isolated and running at
  the snapshot. It classifies PLAN-054/069/072/076/077 and RFCT-305 and owns
  `docs/task/20260910-1012-c-fleet-app-trust-obligations.md`,
  `docs/plan/20260910-1012-c-fleet-app-trust-obligations.md`, and only its own
  index rows.
- Both run `make docs-verify` and `git diff --check`, preserve delivered,
  superseded, valid-implementation, and product-decision distinctions, and do
  not authorize cloud connections or a complete applications platform.

### Workstream A

- A1 `#322` / `954v14y1`, resource/kernel/DT repairs, was running at the
  snapshot. It owns `docs/task/20260910-1014-a1-cx3576-resource-repairs.md`,
  `docs/plan/20260910-1014-a1-cx3576-resource-repairs.md`, and only its own
  index rows.
- A2 `#323` / `hgla3lpl`, the current acceptance matrix, was running at the
  snapshot. It owns `docs/task/20260910-1014-a2-cx3576-acceptance-matrix.md`,
  `docs/plan/20260910-1014-a2-cx3576-acceptance-matrix.md`,
  `docs/bsp/cx3576-bench.md`, and only its own index rows.
- A3 `#324` / `9qso5s2t`, late HDMI/return-to-logo repair, was todo and blocked
  by A1 at the snapshot. It owns
  `docs/task/20260910-1014-a3-cx3576-late-hdmi-logo.md`,
  `docs/plan/20260910-1014-a3-cx3576-late-hdmi-logo.md`, and only its own index
  rows.
- A4 `#325` / `1zjiu5h5`, integrated artifacts/current hardware acceptance,
  was todo and blocked by A1/A2/A3 at the snapshot. It owns
  `docs/task/20260910-1014-a4-cx3576-integrated-acceptance.md`,
  `docs/plan/20260910-1014-a4-cx3576-integrated-acceptance.md`, and only its own
  index rows. A4 owns the coherent final kernel/artifact build; per-fix builds
  are avoided.

Historical `/srv/mos/_out/tio.log` is 95,919 bytes with SHA-256
`f614fb0c15e5263a2f3262b65cefcd3d6305d2544dcacc0b684c452e73adab8f` and
predates final acceptance. The bench endpoint and flashed-image identity are
unconfirmed. Exact-image startup, reboot, watchdog, recovery, HDMI hotplug,
and physical power-cut rows remain blocked. `#313` offline checks are neither
a committed handoff nor real-board evidence.

A excludes `#313`-owned `boards/cx3576/bsp/Makefile`,
`boards/cx3576/bsp/kernel/Dockerfile`,
`boards/cx3576/bsp/kernel/Dockerfile.dockerignore`,
`boards/cx3576/bsp/kernel/export-regdb-certs.py`,
`boards/cx3576/bsp/uboot/Dockerfile`,
`boards/cx3576/bsp/uboot/embed-trust.sh`, and
`boards/cx3576/bsp/uboot/mos-records.h`. Shared lifecycle or packaging changes
require L1 coordination with B.

### Workstream B

B is serial because its packaging paths overlap:

| Node | Issue | Model | Snapshot state and dependency |
|------|-------|-------|-------------------------------|
| B0 | `#319` / `e06h4k7c` | `gpt-6-astra` | Running; lifecycle/rootfs audit and closure-test design; no task/plan paths supplied |
| B1 | `#326` / `627utly7` | `gpt-5.6-sol` | Todo; static BusyBox package; waits for B0 and the exact L1-approved `#313` commit |
| B2 | `#327` / `js1slhab` | `gpt-6-astra` | Todo; startup adaptation; waits for B1 |
| B3 | `#328` / `8ezwxfy2` | `gpt-6-astra` | Todo; safe exitrd; waits for B2 |
| B4 | `#329` / `a7z5l68m` | `gpt-6-astra` | Todo; runtime selector/closure; waits for B3 |
| B5 | `#330` / `ekh6zunh` | `gpt-6-astra` | Todo; scratch assembly/manifests; waits for B4 |
| B6 | `#331` / `dmu2xs16` | `gpt-5.6-sol` | Todo; remaining current cold-build variance; waits for B5 |
| B7 | `#332` / `75btxdqb` | `gpt-6-astra` | Todo; fresh x64 plus virt-arm64 final acceptance; waits for B6 |

The order is B0 → B1 → B2 → B3 → B4 → B5 → B6 → B7. Heavy builds require
a specific L1 grant. After handoff, B owns bounded `pkgs/mos-boot`, startup and
exitrd paths in `pkgs/mos-deploy`, rootfs/runtime/compose scripts, and focused
test/verify/build inventory. It preserves PLAN-086 S5's rejection,
authentication, watchdog behavior, complete filesystem/DM/loop teardown, and
graceful reboot/poweroff. `aux-cache` is already absent from current
pack-tree-surgery; B0/B6 measure current variance rather than repeat old
build-v2 assumptions. CX bench acceptance remains A-owned.

After that snapshot, L1 reviewed B0 record commit
`488b8d68b240ae818dc4b763c46ed7b7f9904129`, task
`docs/task/20260910-1013-b0-lifecycle-rootfs-audit.md`, and plan
`docs/plan/20260910-1013-b0-lifecycle-rootfs-audit.md`. L1 accepted the
recovered-stream-stall yellow after verifying the completed session and every
final gate exit code in `/tmp/mos-b0-gates.NG7mgE/final/metadata.json` (SHA-256
`279997ad59dea9f0ee99600ef9bf7fe2cfeefe5c4e5c0ca9bc6692c69ff7bbbc`). This
does not claim B0 is merged into B; only B's integrated HEAD can establish
that state.

### External S905X5M evidence

Current source status supersedes the earlier no-commit snapshot. L1 confirms
that the latest `#313` / `4ay6q72f` completion handoff carried user
authorization to commit only `#313`-owned changes; no repeat approval is
needed. The exact approved local source is commit
`5d0dca577a782aa707d9530779c4b23f2a7eda31`, tree
`a8b079edc67010b6662b2243a5647950eb7176ef`, parent
`5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`, subject
`feat: integrate s905x5m with signed-file boot and SD images`. `main` was
verified clean, no push occurred, and `#313` reports no remaining
implementation, build, cleanup, or source lock.

The 2026-09-10 10:31 UTC entry preserves the preceding chronology: at that
time the same 108 delivery paths were still dirty and unstaged and no approved
commit existed. That statement is historical, not the current dependency
state.

The committed scope contains the original 108 changed paths, 105 after rename
detection, and is recorded read-only at
`/tmp/mos-open-plans-20260910-100408/s905-committed-scope.json`.

L1 validated 1,730 source-record entries, including contents, modes, symlinks,
and deletions. The canonical `sourceSha256` is
`5eab1647263866e310b98999e9d5df063aa6bbe3248fc8a0bd7ee7a907c75b42`.
The historical 108-path inventory remains at
`/tmp/mos-open-plans-20260910-100408/s905-handoff-scope.json`.
`/srv/mos/_out/s905x5m-current/source-record.json` has SHA-256
`cacf0f2b2b2054b0b3227055aa298c33b785eaaec3ef42e80a46b12c2a00cd53`, and
`SHA256SUMS` has SHA-256
`98d6b7c5f6041d8339cded9f6faeae46295b1b662e61db29817bfd63cba831f7`, with
all 56 entries reverified. Immutable mapping
`/srv/mos/_out/s905x5m-current/committed-source.json` has SHA-256
`ce4330ed3845acf77e5e7f061d62255761eed80d21172211139ca7dc6180cd7c`
and proves equivalence of 1,727 committed file/link entries plus three
deletions to the complete tree. The mapping is separately checksummed and is
not one of the original 56 entries; the original source record and
`SHA256SUMS` remain byte-for-byte unchanged. These are read-only evidence;
preserve
`/srv/mos/_out/s905x5m-current/`, `/srv/mos/tmp/s905x5m-current/source/`, raw
exports under `/srv/mos/_out/boards/s905x5m/`, and the original ownership
records.

Current dirty-build artifacts are evidence only:

- `image/mos-s905x5m-20260910-100627.img`:
  `f7f3c7076b3ef345dc07ba5203029bca9695fccdaa3cbb9a0df9b685c745b30a`
- `image/firmware.bin` (kept with `image/firmware.json`):
  `1cb9f846112a2ae0e6fbec98426d754bb98ddee002e2c23667bec69fe8d8fbc8`
- `recovery/update.img`:
  `09486dc6d8453e621ac8efda05148887c0018b6b6fb47ccb4a84fd403bda431d`
- `s905x5m-dev-3.mosupd`:
  `93436da3f8cf67d836379aeef7119914983c9a0c4d4fbedc2f86c139eea391b5`

All paths above are under `/srv/mos/_out/s905x5m-current/`. They use
development signing and dirty identities `0.1.0+git5c61f7fbb558.dirty-1` and
`5c61f7fbb558-dirty`; source-content equivalence does not make them newly
rebuilt clean artifacts, and they must not be relabeled as such. Preserve
`BOARD_RELEASE_TARGET=0` and their hardware-unqualified status.

The reported delivery is SD-first newest signed-file V3 paired with new MOS
firmware in unique eMMC boot0; it is not a standalone stock-firmware SD image.
A complete eMMC OS installer is separate. SYSTEM is 1 GiB, FIRMWARE spans
sector 64 through 128 MiB, native records are at absolute 120/124 MiB, and
only DATA grows. Generic firmware maintenance refuses S905X5M. Shared
trust/regdb/native-record helpers moved to `boards/common` with CX consumers
updated. No compatibility, RAUC, or raw-slot fallback exists.

`#313` reports focused build/verify and Rust gates, native policy sanitizers,
FIP/FIT key checks, root/package checks, transaction-fault simulation, and 104
offline SD checks passed. L1 verified the 104-check log and source/evidence
hashes but did not rerun expensive suites. A loop-device DATA-growth check did
not modify FIRMWARE/SYSTEM. QEMU factory-root evidence is 11 passes and one
crun executor limitation. All are automated/offline evidence: no hardware was
flashed and `releaseTarget=false`.

Paired firmware install/recovery/boot0 selection; cold/warm boot; serial at
921600; HDMI/USB keyboard; watchdog; Ethernet/USB/Wi-Fi/Bluetooth/audio/panel/
RTC; quota and `/var` persistence; power-interrupted update/fallback;
shutdown; and native crun remain pending physical-board rows. The unrelated
early-exiting grep at `pkgs/mosd/apid/ui/verify-ui-policy.sh:82` is outside this
delivery and does not reopen completed UI work.

`#313` retains ownership of completed dirty-delivery records
`docs/task/20260910-0554-s905x5m-current-system.md` and
`docs/plan/20260910-0559-s905x5m-current-system.md`, including its index and
changelog edits. The task Git blob is
`d42ee0af0fdcaefa0d4f734ed72f95187c1e0227`; the plan Git blob is
`baaf7fe62b2076da4ec6f44ef0ef7fa43ea11fbe`. Both remain completed / `[x]`,
and the immutable mapping contains their SHA-256 and both index identities.
These paths are absent from this D1 base and remain code literals. Eventual
integration preserves their completed state while distinguishing
implementation completion, committed source integration, pre-commit artifact
identity, and unqualified hardware; D never edits their status directly.

At D's next safe boundary, L2 may synchronize only commit
`5d0dca577a782aa707d9530779c4b23f2a7eda31` into its clean branch; active D1
does not perform that sync. D2 must subsequently use the exact integrated
local `bkd/z36xbrtu` HEAD before implementation. The approved identity
satisfies D3's `#313` source dependency, but D3 still waits for reviewed A/B/C
handoffs and final ordered reconciliation. Synchronization requires no full
image rebuild.

### Source evidence limitations

- The final raw staged `git diff --check` for `#313` flagged literal
  unified-patch context in three new `.patch` files: space-prefixed tabs and
  blank context lines. Non-patch files and all 177 actual added code lines
  passed scoped whitespace checks; patch application and actual BSP builds
  passed. The verified patch bytes must be preserved, and no unqualified
  whole-staged-diff whitespace pass is claimed.
- The unrelated UI pipefail failure and the unrun two-architecture package-pool
  gate remain separate limitations and do not reopen completed UI work or
  create an aggregate pass claim.
- The existing `.tmp` producer-discovery collision was bypassed with an
  isolated source snapshot; it was not fixed.
- Physical S905X5M acceptance remains unqualified, and the complete eMMC OS
  installer remains a separate milestone.

Each code L3 owns its unique task/detail notes in its isolated branch and uses
the PMA serializer there. Workstream D owns this campaign record and the later
global task/plan index and changelog reconciliation. D must preserve later
committed edits from `#313` and sibling branches and must never reset another
owner's status directly.

## Dependencies

- **blocked by**: final D3 reconciliation waits for reviewed joint freeze `J`,
  the B7 final acceptance handoff, and formal B-final evidence; the bounded D3
  tracking stage below is authorized before those dependencies are satisfied
- **blocks**: D3 final global lifecycle reconciliation

## Execution Budget

- Initial active L3 grants: A=2, B=1, C=2, D=1; campaign total at most 6.
- Initial expensive-build grants: A=1, B=0, C=0, D=0; campaign maximum 2,
  with one position reserved while `#313` builds.
- After `#313` reported no remaining heavy work, its reserved expensive slot
  returned to L1's unallocated pool. Grants remain A=1 and B/C/D=0 until L1
  explicitly reassigns one.
- Workstream D performs no full image build.

## Notes

- D1 establishes tracking first. D2 may start only after D1 is merged into
  `bkd/z36xbrtu`, then must use the L2-integrated HEAD carrying the exact
  approved `#313` source. D3 follows D1 and D2; its `#313` source dependency
  is satisfied, while reviewed A/B/C handoffs and final ordered evidence remain
  pending.
- Cross-workstream synchronization uses shared local refs only after an L1
  handoff. Unpushed `origin/bkd/*` refs must never be assumed.
- PLAN-037 remains a non-executable umbrella. PLAN-086 section S5 was rejected
  by the user on 2026-09-08 and must not be revived as general shell/network
  tool reduction; the separate BusyBox startup/shutdown plan remains allowed
  without superseding that rejection.
- D2/D3 must investigate the absent indexed
  `cx3576-reproducible-bsp-20260907T1356Z` task and
  `cx3576-reproducible-bsp-20260907T1400Z` plan before restoring or removing
  either record. They must also review open references to removed RAUC/TUF
  paths and reconcile the divergent PLAN-086 task/plan lifecycle while
  preserving its S5 rejection.
- Per-node focused checks and `git diff --check` are required. Final
  reconciliation also requires `make docs-verify`, focused task/plan
  marker-detail lifecycle and link-existence checks, preservation of completed
  recent UI/storage tasks, and explicit pending status for hardware claims
  lacking actual hardware evidence.
- This tracking node does not complete product implementation, image builds,
  hardware proof, or historical reconciliation.

### D2 reconciliation audit — 2026-09-10 11:11 UTC

The tables are bounded to the 31 task rows and 21 plan rows that were not
marked completed when D2 began. `Pair` records the index marker and detail
status at that point; format examples are excluded.

| Task | Pair | Actual obligation, owner and dependency | D2 disposition |
|------|------|-----------------------------------------|----------------|
| RFCT-273 | `[-]` / `in_progress` | Non-executable roadmap coordination; D owns it and waits for reviewed A/B/C handoffs. | Owner transferred with the serializer to `bkd/z36xbrtu`; retained open. |
| RFCT-290 | `[ ]` / `pending` | Fleet architecture decision; C2 `3nblyzz4`, then D3 after reviewed handoff. | Retained; no product decision invented. |
| RFCT-305 | `[-]` / `in_progress` | Gate-A residual classification; old issue `hw1jo2un` is done, C2 owns current classification. | Retained unchanged pending C2 review. |
| RFCT-310 | `[-]` / `implementing` | Full Docker/git-host image proof remains to be classified against B7; old issue `e81lsy1j` is done. | Retained; noncanonical serializer blocker recorded below. |
| RFCT-315 | `[-]` / legacy free text | Operator/effective assertions and obsolete TUF wording; C1 `kpuc7zcb`, then D3. | Retained; noncanonical serializer blocker recorded below. |
| UI-011 | `[ ]` / `pending` | Reliable Bun V8 coverage aggregation; unassigned, no dependency. | Retained pending. |
| RFCT-335 | `[-]` / `in_progress` | Virtual ARM64 board delivery; old issue `y6gfy207` and PLAN-085 are done. | Completed with the serializer. |
| RFCT-336 | `[-]` / `in_progress` | PLAN-086 S3/S6; B `8t4ghqi6`, ordered B1-B7. S5 is rejected. | Ownership transferred with the serializer; retained open. |
| `cx3576-reproducible-bsp-20260907T1356Z` | `[-]` / missing | No detail blob ever existed; PLAN-087 reconciles the untracked draft into RFCT-343 and RFCT-345. | Dangling row removed; no file fabricated. |
| `20260908-1423-file-ab-signed-components` | `[-]` / `in_progress` | P10 physical CX3576 acceptance; A4 after A1/A2/A3. | Retained unchanged for A/D3 handoff. |
| RFCT-915 | `[-]` / `in_progress` | Historical logind/SSH repair; PLAN-911 later records passing hardware smoke. | Completed with the serializer; current-image hardware is separate. |
| RFCT-916 | `[-]` / legacy free text | Historical kernel-floor/M2 proof; old RAUC deployment is obsolete, current S905X5M physical networking is unassigned. | Obsolete detail and row removed after changelog preservation. |
| RFCT-922 | `[-]` / `in_progress` | Controlled BLE GATT peer on a fresh current S905X5M image; owner and peer both unresolved. | Unclaimed with the serializer; retained pending and unassigned. |
| RFCT-921 | `[-]` / `in_progress` | Old aux-cache diagnosis; current variance belongs to B6 after B5. | Closed with the serializer as superseded. |
| RFCT-925 | `[ ]` / `pending` | Former FIT design debt; current signed-FIT contract supersedes it. | Obsolete detail and row removed after exact serializer rejection. |
| RFCT-926 | `[-]` / `in_progress` | Old per-board bootm derivation; current fixed signed-FIT contract supersedes it. | Closed with the serializer. |
| RFCT-932 | `[-]` / `in_progress` | Old combined MQTT/raw-slot deployment; current-image MQTT hardware ownership is unresolved. | Closed with the serializer as superseded. |
| RFCT-934 | `[-]` / `blocked` | Historical RAUC/raw-slot watchdog proof; current signed-file watchdog/power-cut hardware is unassigned and needs a rig. | Obsolete detail and row removed; current gap stays open here. |
| RFCT-940 | `[ ]` / `fixed and proven` | Installer-gate defect already fixed and proven; no remaining obligation. | Detail and row removed; Git/changelog retain history. |
| RFCT-941 | `[-]` / `fixed and proven` | Installer-receipt defect already fixed and proven; current board dossier retains its evidence link. | Retained with owner/status unchanged after serializer rejection; old operations are historical only. |
| RFCT-944 | `[-]` / `in_progress` | Old SD-image runtime qualification; current signed-file source is complete, fresh hardware remains unassigned. | Closed with the serializer as superseded. |
| RFCT-945 | `[-]` / `in_progress` | Old-image Wi-Fi evidence; current-image Wi-Fi qualification remains unassigned. | Closed with the serializer as superseded. |
| `20260908-2011-state-units-never-load` | `[ ]` / `pending` | STATE-unit reload remains real; B4/B5 classification/assignment is required. | Retained unassigned; D3 waits for B handoff. |
| `20260908-2011-ssh-generator-vs-image-policy` | `[ ]` / `pending` | SSH-generator policy remains real; B4/B5 classification/assignment is required. | Retained unassigned; D3 waits for B handoff. |
| `20260908-2011-wtmp-unbounded-append` | `[ ]` / `pending` | Bounded wtmp disposition remains real; B4/B5 classification/assignment is required. | Retained unassigned; D3 waits for B handoff. |
| `20260908-2229-file-ab-delivery-x64-first` | `[-]` / `in_progress` | P10 physical CX3576 acceptance; A4 after A1/A2/A3. | Retained unchanged. |
| `20260909-1421-apid-reboot` | `[-]` / `in_progress` | Original-device refusal/boot evidence; physical device/endpoint and owner are unresolved. | Retained; campaign names the ownership decision. |
| `20260909-2331-cx3576-boot-watchdog` | `[-]` / `in_progress` | Current physical startup/watchdog/recovery proof; A4 after repairs and matrix. | Retained unchanged. |
| `20260910-0025-cx3576-boot-log-cleanup` | `[-]` / `in_progress` | Resource repairs plus current-image handoff; A1/A4 dependency. | Retained unchanged for A handoff. |
| `20260910-0117-cx3576-late-hdmi-logo` | `[ ]` / `pending` | Current late-attach logo behavior; A3 after A1. | Retained pending; A3 owns its campaign successor. |
| `20260910-1013-open-plans-campaign` | `[-]` / `in_progress` | D coordination and D3 final reconciliation. | Retained open as required. |

| Plan | Pair | Actual obligation, owner and dependency | D2 disposition |
|------|------|-----------------------------------------|----------------|
| PLAN-037 | `[ ]` / `approved` | Umbrella coordination only; D owns it and D3 waits for reviewed handoffs. | Canonicalized to `[-]` / `implementing`; no duplicate subtask. |
| PLAN-054 | `[ ]` / `approved` | Fleet boundary/cost classification; C2 then D3. | Retained for reviewed C2 handoff. |
| PLAN-069 | `[ ]` / `approved` | Conditional managed-application controls; C2 then D3. | Retained; no trigger invented. |
| PLAN-070 | `[ ]` / `approved` | Current configuration obligations and obsolete TUF language; C1 then D3. | Retained for reviewed C1 handoff. |
| PLAN-071 | `[ ]` / `approved` | Current native update-policy obligations; C1 then D3. | Retained for reviewed C1 handoff. |
| PLAN-072 | `[ ]` / `approved` | Fleet registration scope; C2 then D3. | Retained for reviewed C2 handoff. |
| PLAN-076 | `[ ]` / `approved` | Device-state reporting scope; C2 then D3. | Retained for reviewed C2 handoff. |
| PLAN-077 | `[ ]` / `proposed` | Gate-A classification; C2 then D3. | Retained for reviewed C2 handoff. |
| PLAN-086 | `[-]` / `approved` | S3/S6 runtime work; B1-B7. S5 stays rejected. | Canonicalized to `[-]` / `implementing`; B ownership explicit. |
| `cx3576-reproducible-bsp-20260907T1400Z` | `[ ]` / missing | Untracked draft reconciled and completed by PLAN-087, RFCT-343 and RFCT-345. | Dangling row removed; no file fabricated. |
| `20260908-1428-file-ab-signed-components` | `[-]` / `implementing` | P10 current CX3576 physical acceptance; A4. | Retained unchanged. |
| PLAN-910 | `[-]` / `implementing` | Historical S905X5M RAUC/raw-slot intake; current signed-file system supersedes it. | Closed as `[~]` / `rejected`; current hardware stays open here. |
| PLAN-911 | `[-]` / `implementing` | Four historical runtime repairs and smoke proof are recorded complete. | Completed as `[x]` / `completed`; current-image proof separate. |
| PLAN-912 | `[ ]` / `draft` | Controlled BLE GATT peer on a fresh current image; owner/peer unresolved. | Retained draft and made unassigned. |
| PLAN-913 | `[ ]` / `draft` | Obsolete aux-cache proposal; B6 owns current variance after B5. | Closed as `[~]` / `rejected`. |
| PLAN-915 | `[-]` / `implementing` | Old bootm derivation superseded by current fixed FIT policy. | Closed as `[~]` / `rejected`. |
| PLAN-916 | `[-]` / `implementing` | Old combined MQTT/raw-slot plan superseded by current S905X5M system. | Closed as `[~]` / `rejected`; fresh-image hardware unassigned. |
| `20260909-2331-cx3576-boot-watchdog` | `[-]` / `implementing` | Current physical watchdog/recovery proof; A4. | Retained unchanged. |
| `20260910-0029-cx3576-boot-log-cleanup` | `[ ]` / `draft` | Current resource repair/qualification; A1/A4. | Retained pending A handoff. |
| `20260910-0341-minimal-boot-shutdown` | `[ ]` / `draft` | Separate BusyBox startup/exitrd work; B1-B7. | Retained draft; explicitly does not revive PLAN-086 S5. |
| `20260910-1013-open-plans-campaign` | `[-]` / `implementing` | D coordination through D3. | Retained open as required. |

Current unresolved ownership decisions are explicit: S905X5M fresh-image
physical installation/peripheral/watchdog/recovery/power-cut/shutdown/MQTT/
native-container acceptance; the original-device reboot report; and the three
`20260908-2011-*` tasks after B4/B5 classification. No historical board result
is treated as current proof.

Serializer calls succeeded for RFCT-273, RFCT-335, RFCT-336, RFCT-915,
RFCT-921, RFCT-922, RFCT-926, RFCT-932, RFCT-944 and RFCT-945. These exact
legacy-format rejections were observed before the affected status/owner was
left unchanged or the obsolete record was removed:

```text
task-state: complete requires in_progress status, found in_progress — hardware acceptance awaits an M2-bearing deployed payload
task-state: pending task has unexpected owner: mainline
task-state: close requires pending or in_progress status, found blocked
task-state: complete requires in_progress status, found fixed and proven on hardware — the gate now clears; it exposed a second defect, [RFCT-941](RFCT-941.md)
task-state: complete requires in_progress status, found fixed and proven on hardware — the receipt survives the post-burn defenv and the card no longer reinstalls
task-state: complete requires in_progress status, found implementing
task-state: complete requires in_progress status, found in-progress (F7/F8/F9 delivered; Rust, verify and build suites green; operator/effective content assertions owed)
```

The last two rejections belong to retained RFCT-310 and RFCT-315. Their old BKD
issues are done, but B7 and the reviewed C1 handoff respectively still control
the truthful next disposition; D2 did not normalize them by hand. C-owned
approved/proposed plan heads likewise wait for reviewed C handoffs and D3's
global lifecycle pass.

### D3 acceptance-wave tracking stage — 2026-09-11 UTC

This bounded documentation-only stage began after merging exact L2 D source
commit `5c0015d136c5c8a2a56c7b7c98798359a363cf34`, tree
`beafd207e2334482b6556f143efa902fe81d1049`. It does not begin final global
reconciliation. This task remains `in_progress`, index marker `[-]`, and owned
by `bkd/z36xbrtu`; the related plan remains `implementing` / `[-]`.

The sole joint acceptance executor is the existing B7 issue `#332` /
`75btxdqb` on `bkd/75btxdqb`, coordinated by L2 B `8t4ghqi6`. It is the same
campaign node, not a new hierarchy or L3 allocation. The exact reviewed inputs
are:

| Input | Commit | Tree | Current handoff state |
|-------|--------|------|-----------------------|
| A-final | `e4154126b7e38eb90db210adfb412b19535637a8` | `04de9264c7eb0d190e13852955789ceea7439a71` | Satisfied and reviewed. |
| C-final | `48acef7f1a3683b1f3bb6261911b1a5123197da2` | `553c1e7af96203315f79e7ea61e862f7a753e3a5` | Satisfied and reviewed. |
| B0-B6 | `ebdd7208f3c026c96e08d003d9d4f383c22f1eb9` | `4c1e47337dc6e9787864a31dfbcd570aef21e4f5` | Reviewed; B7 remains in progress. |

B7 is implementing the acceptance caller, geometry, provenance, and joint
acceptance work. Caller checkpoint `64387f20` is reviewed. Geometry checkpoint
`5ead205523bdeb6a8cf0cb8dc9c35b2c9f47d56d` is observed but is not a final
reviewed B7 handoff.

The future joint freeze `J` does not exist. B7 must first finish and review its
existing source, synchronize reviewed local B, merge the exact local A and C
inputs above with explicit `--no-ff`, resolve only authorized mechanical
index/import/test unions, and obtain review for any minimal integration
correction. The resulting real clean commit and tree become `J` only when A,
C, and the reviewed B7 source are all ancestors. No placeholder identity is
valid.

One `J` controls the accepted build wave:

- build one fresh x64 image with a 1 GiB SYSTEM;
- build one final virt-arm64 image whose ordinary root is cold run 1, plus
  exactly one independent no-cache cold root run 2 from equal inputs;
- build one joint CX3576 image, reusing A kernel/firmware only after complete
  input equality is recorded and rebuilding every changed dependent root,
  boot, signature, record, and image phase; and
- build no new S905X5M image or eMMC installer.

Every reuse or rebuild decision requires a board- and architecture-specific
input/provenance record. B7 may use at most two independent expensive jobs when
resources permit. This replaces the former A1/B1 blanket heavy serialization,
creates no new L3, and leaves long jobs in persistent tmux sessions with
source-bound metadata and event-driven collection.

The remaining acceptance and decision boundaries are unchanged:

| Boundary | Owner | Exact missing input or decision |
|----------|-------|---------------------------------|
| B7 software acceptance | B7 `75btxdqb`, coordinated by B `8t4ghqi6` | Reviewed final caller/geometry/provenance source, real `J`, named bounded jobs, fresh x64/virt-arm64/CX3576 artifacts, complete guest/image gates, and the equal-input virt-arm64 cold comparison. |
| CX3576 install, lifecycle, watchdog, recovery, HDMI/VT, peripherals, storage, and power cuts | A, with joint-image inputs from B7 | Exact `J`-bound image and provenance; named CX3576-Z/AIC8800D80 bench, medium, RockUSB target, authenticated API/operator, serial and power rig; cold/warm boot and health, complete exitrd teardown, real watchdog cause, recovery selection/readback, named HDMI sink/keyboard, peripheral fixtures, and externally timed cuts at every publication/record boundary. Reviewed A3 commit `209982d98f83ef149d2c3850adc63debc42f4c5a`, integrated through A-final, delivers visible-logo restoration on real HPD/VT return while preserving authenticated tty2 and DRM/blank/suspend boundaries; exact-`J`-image physical HDMI/VT/USB-keyboard/visual acceptance remains pending. |
| CX3576 accelerators | A | Named versioned NPU model, runner, input and digest; encoder input/codec/output and decoder bitstream/frame fixtures; repeated hardware MMIO/IOMMU, binding, clock, reset, power, and error evidence. |
| S905X5M physical acceptance and native crun | A coordinates the physical rows; `#313` retains its completed delivery records | Named unit/target, the exact paired dirty-stamped image and adjacent firmware manifest, boot0 install/readback and recovery selection, serial at 921600, display/input/peripheral fixtures, real watchdog and storage-power cuts, authenticated shutdown, quota/persistence measurements, controlled BLE/MQTT inputs, and native crun on capable hardware. No new S905X5M image or complete eMMC installer is authorized. |
| Original-device apid reboot | A | Original device identity, current exact image, authenticated endpoint, operator, and serial trace; another board cannot substitute. |
| Historical current-A image | A | Preserve `PASS_WITH_EXECUTOR_LIMITATION` as historical software evidence only. It is not `J` and cannot qualify any hardware row. |
| Fleet/product activation | C inputs feed B7; no runtime executor is authorized | C's reviewed offline `FLEET-CONFIG` production inputs must be present in `J`. Client/server fleet runtime, cloud deployment, credentials/command channel, curated OCI activation, and publication remain unapproved; the delivered fleet protocol remains DESIGN only. |
| Integration/publication | L1 decision required | No `main` integration, remote push, publication, or campaign `done` transition is authorized. |

The exact physical power-cut matrix independently interrupts storage power at
download/offline import, destination object write and file sync, object
directory publication, candidate activation, attempt decrement, health
confirmation and garbage collection, and redundant record write. It requires
at least ten cuts per installation/activation boundary and fifty randomized
redundant-record writes, with the actual side of each boundary recorded; an
unknown boundary is inconclusive. Cutting only CPU or software execution does
not qualify.

No compatibility support is required. Automated or offline evidence cannot
replace any named board or physical power-cut result. Final D3 reconciliation
remains blocked on the real reviewed `J`, the B7 final handoff, and formal
B-final evidence; L2 D must wake this same issue for that later stage. No PMA
serializer lifecycle transition is made during this tracking stage.

### D3 Batch 1 tracking update — 2026-09-12 UTC

Batch 1 A+C is actually complete on local `main` at commit
`677d326f40834d192b38d3b8d1097334d02ea86a`, tree
`ea3b1218769dc1870680b3dc881a7e939006fcc5`. Merge
`133737e1754c2db6f7f9f043066e86a5ad9916f7` joins reviewed A-final
`e4154126b7e38eb90db210adfb412b19535637a8` to predecessor
`a3595587194a17c290272975e5a2e40be6ea15c2`; merge `677d326f` then joins
reviewed C-final `48acef7f1a3683b1f3bb6261911b1a5123197da2`. L1 independently
verified the main ref, tree, both parent pairs, all three required ancestors,
and 67 non-index mode/blob bindings against the reviewed sources.

The transaction preserved the unrelated main working state byte-for-byte and
left the Git index equal to HEAD: package-split task and plan documents remain
untracked, while their task/plan index appends remain unstaged. Nothing from
those paths was staged, stashed, copied, removed, or committed by Batch 1.

The exact integrated candidate recorded six passing checks. L1 verified the
records and log bindings without rerunning them:

| Check | Recorded result | Retained log SHA-256 |
|-------|-----------------|----------------------|
| `make docs-verify` | Exit 0. | `b4084c242865ff925b09d41cbb37babe80edd8a652fa64ba9bbb7afdb19099e8` |
| `make docs-verify-test` | Exit 0. | `7f063b379cb5bda3a142ef036721e841c30111237a79e54ffba33106b7400168` |
| Public-meta validation | Exit 0; 61 tests. | `7e82d5a3183136d5a70420a358f55f1d209094139f507f023ab0cd58240f5aed` |
| Packed-root validation | Exit 0; 271 tests. | `53f1af369030513bbe803260a3e1ea54c6a41bc503f11973ea6390e5bdf8dc4b` |
| Fleet-protocol DESIGN cases | Exit 0. | `d570729555ce2bd1e1ede71fd52192551b4a095c4b0338bddf082d0f1c448ffa` |
| CX collector | Exit 0. | `ee19f8e5dc9a9415c4b777e1503f1004bd0626489606a5fe040ff8a7fae858b1` |

Host Bun 1.4.0 and Node 24.19.0 were test runtimes, not newly built product
toolchains. Batch 1 reused reviewed A/C source and artifact evidence; it did
not rerun Rust, kernel, full-image, or physical qualification and did not merge
B startup/rootfs, D, or `#347`-only source.

The evidence packet is bound by
`/tmp/mos-phased-merge-GNeIZ1/integration-review.json` (SHA-256
`f983beb18564ca24362252bda27e1e0348effa63995cf9c4181b2f21c95c6b48`),
`checks.json` (`d258b48cf517e10152ca324d787cf4c4e8fe65e6d353ae3d3eecb0874aced57d`),
`publication-result.json`
(`106b35f495900f8e703654d48065862ab47914703faee63f0025dfd264d10d4d`),
and L1's independent observation
`/tmp/mos-open-plans-20260910-100408/L1-batch1-main-ijqwqwbk/batch1-independent-observation.json`
(`d6fdfa790f9384d0c8b81511dc911a283944a9ec3aac355649f89872060141e3`).
These establish local main integration, not remote publication.

The user's ordered main policy is already approved and requires no repeated
generic approval:

1. Batch 1 A+C is complete as recorded above.
2. Batch 2 may integrate B plus independently reviewed `#347` and current
   root-composition fixes only after one exact complete combined x64 candidate
   passes all required signed-boot, startup, reboot, shutdown, update/fallback,
   storage, authenticated API, and existing acceptance scenarios. The candidate
   source/input and integration evidence must receive independent review.
3. Batch 3 is this D campaign's final reconciliation of the code actually
   merged, its evidence, and every remaining obligation. It remains conditional
   on the actual Batch 2 merge and concrete reviewed handoff.

L1 alone owns future ordered main transactions. No push or remote publication
is authorized. Main movement is neither campaign `done` nor hardware
qualification.

Broad ARM work begins only after the Batch 2 **COMPLETE STARTUP CHAIN** actually
enters main and its merged commit/tree is frozen. Batch 1 alone authorizes no
ARM package, root, or image work. The later consolidated wave still requires
virt-arm64 and CX acceptance, two independent equal-input virt-arm64 cold-root
samples, and affected-component rebuilds with exact relevant-input reuse.
Separately authorized focused ARM-specific work remains allowed within its
exact scope but does not start the broad wave. Physical CX, watchdog,
power-cut, and bench limitations remain separate and pending.

A/C delivered software and all historical evidence grades remain unchanged.
In particular, reviewed A3 software implements visible-logo restoration on
real HPD/VT return while preserving authenticated tty2 and DRM/blank/suspend
boundaries; exact-image physical HDMI/USB-keyboard/VT/visual rows remain
pending and have no hardware PASS.

The current B boundary is not acceptance:

- B7 source `f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd` failed `90-pack` at
  01:09:22 because `/usr/bin/docker` was omitted. B7 identified the existing
  owned `docker -> podman` link. L1 approved that exact docker declaration plus
  bounded reconciliation of 14 companion current-survivor declarations.
- Those declaration fixes, final B review, and the actual combined x64
  acceptance remain pending. There is no B7 root or image PASS.
- The `#347` standalone 33 startup-admission checkpoint is reviewed but is not
  full-system acceptance. Its final combined `70a7a408` source/two-copy handoff
  remains in B review.
- Original `J` / `fb6` / `4716` / `438` producer and failed-root identities
  remain bound to their original evidence. None is relabeled to main
  `677d326f`.

D does not interrupt, wake, merge, or message B7, `#347`, or B. Batch 3 and
campaign completion remain pending on their reviewed evidence. No compatibility
work is required, and this tracking update performs no serializer transition.
