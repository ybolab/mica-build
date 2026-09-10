# 20260910-1013-open-plans-campaign Establish open plans campaign tracking

- **status**: in_progress
- **priority**: P1
- **owner**: bkd/z36xbrtu
- **createdAt**: 2026-09-10 10:13

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

Coordinating the open plans campaign and its documentation lifecycle.

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

- **blocked by**: (none)
- **blocks**: D2 historical-record reconciliation and D3 final global
  lifecycle reconciliation

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
