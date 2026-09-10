# 20260910-1014-a4-cx3576-integrated-acceptance CX3576 integrated artifact and board acceptance

- **status**: in_progress
- **priority**: P1
- **owner**: bkd/1zjiu5h5
- **createdAt**: 2026-09-10 11:38

## Description

Verify the reviewed A1/A2/A3 CX3576 changes as one coherent compiled kernel and
artifact candidate, correct the bounded board evidence collector for the current
signed-file contract, and record software results separately from unavailable
physical bench qualification. Absorb the approved S905X5M artifact evidence
without relabelling its dirty-stamped build or duplicating implementation.

## ActiveForm

Verifying the coherent CX3576 artifacts and preparing exact-image board evidence collection.

## Dependencies

- **blocked by**: Physical acceptance requires an identified bench, current flashed image, console/API route, target medium and power rig.
- **blocks**: Workstream A integration review and workstream D final reconciliation.

## Notes

- Campaign: `mos-open-plans-20260910-100408`; issue: `1zjiu5h5`; coordinator: `6064wf7l`.
- Full-tier approval and scoped local commits were supplied by the campaign dispatch. Compatibility, migrations, RAUC, raw-slot and old-package support are excluded.
- Required upstream `bkd/6064wf7l` at `a39807d8392f0838e6e5438e3e57518f9b1bdd81` was merged before investigation; the exact upstream is an ancestor of this branch.
- Write scope is this task/plan pair and index entries, `docs/bsp/cx3576-bench.md`, `docs/bsp/cx3576-bench-collect.sh`, and focused tests under `tests/cx3576-bench/`.
- Product, shared verifier, lifecycle, packaging, sibling records, global indexes and changelog remain read-only. Failed product gates are reported to L2 rather than repaired here.
- Hardware rows cannot pass without a confirmed current-image bench. Historical, simulated and other-board evidence remains separately classified; historical display row D5 is optional and superseded by current serial-only console policy.

## Collector correction

Collector v3 binds every operational stage to a canonical public identity file
containing the exact source commit/tree, image name/hash, verification record,
profile, board/radio revision and operator-identified system block device. It
refuses missing or changed run bindings and has no API or block-device default.
API URL and dry-run mode are also immutable within a run; each invocation keeps
a new capture directory. The same run retains optional failed-unit names while evaluating only the
current required-health set over a 180-second window, captures the current quota
and container-isolation contract, uses RockUSB/maskrom recovery rather than a
rescue image, and reports all 39 logical rows. Historical D5 remains optional,
superseded and unable to block later stages.

Reviewed A3 commit `209982d98f83ef149d2c3850adc63debc42f4c5a`
replaces A2's earlier init-only/no-redraw software baseline. Its host fixtures
remain source-level evidence until the coherent ARM64 build below completes;
D1-D4 still require exact-image physical observations.

## Software evidence before coherent kernel build

| Check | Result | Evidence |
|---|---|---|
| Collector RED | expected failure, exit 1 | `timeout 30 bash tests/cx3576-bench/collector-test.sh`, 2026-09-10T11:49:03Z; 11 assertions exposed guessed identity/API/media, obsolete health/storage/recovery behavior and missing 39-row coverage; `/srv/station/work/tmp/mos/1zjiu5h5/collector-red.log` SHA-256 `60505cc0ed2a1d49bb6d0f0ec3a268533aff5f11e2ef35258470d4c35245083c` |
| Collector GREEN before interruption | passed, exit 0 | Syntax plus focused explicit-binding, immutable-run-binding, required-health, optional-failure, 180-second call, recovery/storage and exact 39-row checks; 2026-09-10T12:21:31Z..12:21:32Z; `/srv/station/work/tmp/mos/1zjiu5h5/collector-green.log` SHA-256 `ee19f8e5dc9a9415c4b777e1503f1004bd0626489606a5fe040ff8a7fae858b1`. |
| U-Boot watchdog guard | passed, exit 0 | Pinned `ece349ade2973e220f524ce59e59711cc919263f` source with the applicable committed patch effects; driver probe, both clock gates, arm/feed/refusal and RockUSB servicing passed. Log `/srv/station/work/tmp/mos/1zjiu5h5/uboot-watchdog.log`, SHA-256 `822efc78421aba2776aa4081255c909c567bb56086bced2a1652645dcea765dc`. |
| Netavark kernel policy | passed, exit 0 | `make os-netavark-kernel-test`, 155/155 assertions; `/srv/station/work/tmp/mos/1zjiu5h5/os-netavark-kernel-test.log` SHA-256 `482b49db7b7e7a9c5fe818e9af939c0a822994d6340ac0a3e7ed1706531612b3`. |
| Documentation before interruption | passed, exit 0 | `make docs-verify`, 2026-09-10T12:21:32Z..12:21:34Z; `/srv/station/work/tmp/mos/1zjiu5h5/docs-verify-precommit.log` SHA-256 `567fab99a3d4b4529298d6701e16adfe8060a6b68747bec265d0ed151facda62`. |

### Recovery checkpoint and scoped review

Recovery retry 1 preserves the original owned delta and claimed records. The
previous execution exited 137 / SIGKILL at 2026-09-10T12:52:08.215Z; its cause is
unknown. No coherent kernel gate had launched, and that process exit is neither
a kernel failure nor a hardware result.

Actual local-diff review used the shared pma-cr policy for shell/documentation;
no language-specific pack applies to the changed files. Four introduced
evidence-integrity defects were reproduced before correction: stale health logs
hid a currently unavailable API; a run could change API; dry-run mode was not
bound; repeated captures overwrote previous snapshots. The corrections add
live GetState and healthz probes before/after the 180-second window, immutable
API/mode binding and unique capture directories. An additional fixture checks
API loss after the window. Host stubs do not constitute elapsed board health.
The resulting scoped review has no remaining findings; full kernel and physical
verification are still pending, not covered by this collector review.

Recovery evidence root: `/srv/station/work/tmp/mos/1zjiu5h5/recovery-1/`.

| Check | Result and exact evidence |
|---|---|
| Recovery RED | `timeout 30 bash tests/cx3576-bench/collector-test.sh`, expected exit 1 with four assertions at 2026-09-10T19:04:33Z; `collector-red.log` SHA-256 `c2193b7af20e04adced1eaa411d85bb5c9bbb95f14850f5ccc17db0edd8694e6`; `.started` / `.exit` preserve available metadata. |
| Recovery GREEN | `timeout 45 bash tests/cx3576-bench/collector-test.sh`, exit 0, 2026-09-10T19:10:39Z..19:10:43Z; `collector-green.log` SHA-256 `ee19f8e5dc9a9415c4b777e1503f1004bd0626489606a5fe040ff8a7fae858b1`; `collector-green.json` records command/time/base identity and the owned uncommitted delta. |
| Current cheap guards | Collector syntax, `make os-netavark-kernel-test` (155/155), `bash boards/cx3576/bsp/uboot/tests/watchdog.sh /srv/station/work/tmp/mos/1zjiu5h5/uboot-watchdog-fixture`, and `make -C boards/cx3576/bsp source-check` all exit 0 at 19:10:39Z..19:10:43Z. Individual logs and JSON metadata use `syntax`, `netavark`, `watchdog`, `source-check` stems. The watchdog fixture contains only the four applicable pinned source files, not a full U-Boot build. |
| Final documentation and scope | `timeout 45 make docs-verify`, exit 0; `docs-final.log` SHA-256 `8a05e614b6a6f3057988dc2ab915a7d38c1dca9b9fb13c021799786872185216`, exact UTC times in `docs-final.json`. Test-script `bash -n` and the owned non-patch delta whitespace check also pass. This does not assert whole inherited patch-file whitespace. |

## Inherited S905X5M artifact evidence

The following read-only identities were re-hashed locally. They are inherited
from #313/L1, not tests executed by A4:

| Item | SHA-256 / identity |
|---|---|
| Approved committed source | commit `5d0dca577a782aa707d9530779c4b23f2a7eda31`, tree `a8b079edc67010b6662b2243a5647950eb7176ef`, mapped source SHA-256 `5eab1647263866e310b98999e9d5df063aa6bbe3248fc8a0bd7ee7a907c75b42` |
| `source-record.json` | `cacf0f2b2b2054b0b3227055aa298c33b785eaaec3ef42e80a46b12c2a00cd53` |
| `committed-source.json` | `ce4330ed3845acf77e5e7f061d62255761eed80d21172211139ca7dc6180cd7c` |
| `SHA256SUMS` | `98d6b7c5f6041d8339cded9f6faeae46295b1b662e61db29817bfd63cba831f7` (the inherited 56 entries were verified by L1) |
| SD image | `image/mos-s905x5m-20260910-100627.img` = `f7f3c7076b3ef345dc07ba5203029bca9695fccdaa3cbb9a0df9b685c745b30a` |
| Paired boot0 firmware | `image/firmware.bin` = `1cb9f846112a2ae0e6fbec98426d754bb98ddee002e2c23667bec69fe8d8fbc8`; paired `image/firmware.json` must remain beside the image |
| Recovery image | `recovery/update.img` = `09486dc6d8453e621ac8efda05148887c0018b6b6fb47ccb4a84fd403bda431d` |
| Signed update | `s905x5m-dev-3.mosupd` = `93436da3f8cf67d836379aeef7119914983c9a0c4d4fbedc2f86c139eea391b5` |

These are development artifacts stamped
`0.1.0+git5c61f7fbb558.dirty-1` / `5c61f7fbb558-dirty`. The immutable mapping
proves source-content equivalence to the approved commit; it is not a clean
rebuild. `BOARD_RELEASE_TARGET=0`, the SD image requires its paired firmware in
unique eMMC boot0, and no physical board was flashed.

## Exact-image physical acceptance state

No confirmed bench endpoint, current flashed image, storage identity or power
rig exists. Consequently no mandatory physical row is complete:

Coordination is assigned to L2 A #315 (`6064wf7l`); A4 #325 (`1zjiu5h5`)
integrates execution/evidence. Issue assignment does not identify a physical
operator. For S905X5M, valid obligations from PLAN-910/911/912/915/916 and
RFCT-932/934/944/945 use only the approved #313 signed-file contract and immutable
identities above. No old card installer, raw slots, full eMMC OS installer or new
application/fleet platform is included.

| Surface | Current result | Exact admission evidence still required |
|---|---|---|
| CX3576 install, first boot and 180-second health | blocked | A clean-source newest complete signed image and public verification record; authorized CX3576-Z/AIC8800D80 unit; explicit RockUSB target and system medium; full flash readback; serial from reset through five cold 180-second required-health windows. |
| CX3576 reboot and power-off | blocked | Authenticated admission plus complete serial exitrd teardown; three warm boots and a separate power-off/later physical power-on, each bound to new boot IDs and 180-second health. |
| CX3576 watchdog handoff | blocked | A supported pre-PID-1 hang point and uninterrupted U-Boot arming, Linux takeover, PID 1 ownership and expiry trace. The collector deliberately does not invent this mechanism. |
| CX3576 watchdog expiry | blocked | Confirmed local bench watchdog, external timing/serial/power trace, spent native attempt and readable reset cause after post-PID-1 hang. |
| CX3576 recovery | blocked | Authenticated recovery/reset survivor digests, refusal of unsupported destructive actions, induced invalid/exhausted native records, observed RockUSB selection and exact-image maskrom reflash/readback. |
| CX3576 HDMI/VT | blocked | Named sink/connector/mode and USB keyboard; connected boot, authenticated tty2, return-to-logo and headless late-attach observations on the exact image. A3 host fixtures do not establish board pixels or kernel lock scheduling. |
| Historical D5 panic screen | superseded / optional observation | No pass is required and it blocks no stage. A screen state may be recorded during the existing watchdog crash, but no additional crash or renderer is authorized. |
| CX3576 accelerators | blocked | Named versioned NPU model/runner/input/digest, encoder input/codec/output check and decoder bitstream/frame check; repeated hardware use with MMIO/IOMMU, binding, clocks, resets, power and error evidence. NPU MMIO ownership and both VENC cores remain explicit obligations. |
| CX3576 network, radio, USB/CAN, RTC and thermal | blocked | Both Ethernet mappings and traffic; controlled AIC8800D80 AP/regulatory evidence; named Bluetooth peer/profile; isolated local CAN peer plus USB host/gadget; ten-minute RTC loss; enclosure-bound sustained load/cooldown. |
| CX3576 storage/update/power cuts | blocked | Current namespace quota/write/isolation evidence; signed root-only, kernel-only, combined, failed-health and firmware cases; externally timed physical cuts at every publication/record boundary. |
| S905X5M paired install and boot0 selection | blocked | Named S905X5M unit and target, exact dirty-stamped image plus adjacent `firmware.json`, verified paired firmware install/readback to unique eMMC boot0 and real recovery selection. The SD image cannot boot with stock firmware alone. |
| S905X5M startup/display/input | blocked | Cold/warm boot on the named image, uninterrupted serial at 921600 baud, HDMI and USB-keyboard observations. |
| S905X5M watchdog and peripherals | blocked | Real watchdog handoff/expiry/cause plus Ethernet, USB, Wi-Fi, Bluetooth, audio, panel and RTC fixtures and checked operation. |
| S905X5M controlled peer and MQTT | blocked | Named controlled BLE peer, profile/workload and expected exchange; the existing MQTT path's confirmed broker/endpoint, credential admission, topics and payload/result fixture. Record networking, peer and workload inputs separately; offline suite results establish none of these physical rows. |
| S905X5M storage/runtime | blocked | Actual DATA growth, `/var` persistence and current quota/isolation measurements; native crun on capable hardware because the inherited QEMU case was executor-limited. |
| S905X5M update interruption and shutdown | blocked | Signed-file update/fallback on the paired image, real storage-power cuts with external boundary evidence, and authenticated shutdown/power return. Automated fault injection is not physical power-loss proof. |
| Original-device apid reboot | blocked | A coordinates this obligation, but the original device identity, current image, authenticated endpoint and operator/serial trace are missing. Another device or board cannot substitute for the original-device result. |

## Pending coherent build

One labeled, task-specific CX3576 kernel build will be launched from a clean
committed A4 milestone in a persistent tmux shell. It will use the existing
digest-pinned builder, the complete six-patch kernel series, the explicit
read-only CX3576 public verity certificate, and no private signing material.
The existing certificate is
`/srv/mos/_out/boards/cx3576/verity-trust/101209c31085b09853c688d64c374d899ab904d508a4f69f0ae9b676c4ea0212/signer.cert.pem`,
SHA-256 `101209c31085b09853c688d64c374d899ab904d508a4f69f0ae9b676c4ea0212`.
The labeled equivalent of `make cx3576-kernel` retains the Docker build stage
for actual ARM64 objects, vmlinux, complete patched source, DTB and modpost
inspection; the build-time pnmtologo generator is a host executable.

The current A-baseline kernel milestone does not depend on future B/C changes.
No newly assembled complete CX image or signed FIT candidate exists yet; after
kernel collection, assess the exact available firmware, root/support provenance,
signing inputs and fresh component-record requirements before composition.
Do not run candidate-specific FIT/readback/image checks against an old image.
A later combined milestone requires L1's exact reviewed B/C handoff: B3 owns
native shutdown and bounded kernel-payload plumbing; C owns public-meta/verifier
and release/sourceIdentity/Toolbox changes. None is imported here. Board flashing
also independently requires confirmed hardware admission.

Change-history handoff for D through L2: this task/plan pair and the scoped bench
delta supersede only the collector gaps, distinguish reviewed A3 software from
the older A2 investigation baseline, retain historical optional D5, and map A/A4
coordination separately from missing physical inputs. No sibling, historical
task status, global index history or changelog is reconciled here.
