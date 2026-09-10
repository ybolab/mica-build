# 20260910-1014-a4-cx3576-integrated-acceptance CX3576 integrated artifact and board acceptance

- **status**: completed
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

Completed collector and coherent kernel evidence; the separately authorized composition phase below is in progress. Physical qualification remains blocked.

## Dependencies

- **blocked by**: Physical acceptance requires an identified bench, current flashed image, console/API route, target medium and power rig.
- **blocks**: Workstream A integration review and workstream D final reconciliation.

## Notes

### Authorized composition continuation — 2026-09-10

Phase state: in progress, owned by `bkd/1zjiu5h5`. The completed task/index
status above preserves the earlier collector/kernel delivery; it does not claim
that this new candidate exists or passes. The PMA serializer has no reopen
operation, so this continuation is a content update under the explicit L1/L2
handoff, not an invented status transition or a second task. Recovery retries
remain 1.

The exact L1 source/input handoff delivered through L2 authorizes a new CX3576
development root and signed-file composition using existing recipes read-only.
The clean branch was fast-forwarded to local L2 commit
`9d1218e2689eb5e3fce99ad1736f3a1fdc8c8801`, tree
`0a1c2b4ddd86945961da16cc6d4d268e636f2273`, identical to the previous A4 final
tree. No main, sibling or remote branch was imported. The earlier root/native-init
input blocker is resolved by this authorization to build the current root and
reuse the explicitly selected source-equivalent native init; the two rejected
old roots remain rejected and their historical audit below remains unchanged.

Immutable, self-contained checkout and staging:
`/srv/station/work/tmp/mos/1zjiu5h5/composition-20260910-2026-z2Ljld/`.
`source/` has its own Git object database, no alternates, exact HEAD/tree above
and a clean tracked/untracked state. `evidence/source-files-before.txt` records
all tracked modes/blob identities (SHA-256
`79f1af52e60640a0fa772ea6a0d632e4a61cf39f5c8ab9b08f78b817040d8b33`).
The only public defaults input is `inputs/meta/updates/manifest.json`, copied
byte-identically from this commit, SHA-256
`a30e535b37d8ab32d62d21f118dd610d102584c214375cf229353e0ab474ce00`.
There is no GENERATED marker, endpoint override or signing key in that input.

Existing pools report stamps `git5c61f7fbb558.dirty-1` (approved S905 snapshot),
`git97bb466792ca-1` (original main output), and `gitd64b23a7d92a.dirty-1`
(CX storage-display snapshot). `rootfs/build.sh` requires the pool's one stamp
to equal this checkout's `git9d1218e2689e-1`; these archives cannot be copied or
renamed into a passing current pool. Only the selected producers will be
rebuilt, serially, without weakening stale-source/index/ownership checks.

First package gate: the five selected architecture-independent producers
`system`, `profile`, `ca-trust`, `wifi`, `bluetooth`, then `board-cx3576` for
ARM64. Existing `build-env/deb/preflight.sh --producer NAME` and
`build-env/deb/build.sh --producer NAME --arch all|arm64` remain unchanged.
Their `all` outputs also populate the private amd64 pool by recipe; that is one
archive exported twice, not an x64 build matrix. The remaining selected native
producers, new root, support/FIT/records/image and exact-candidate gates follow
serially after result collection. No full-image or hardware pass is implied by
this first partial pool.

The passed kernel remains bound to `38a362cd`, not the documentation/source
sync commit. The selected native init remains the original development binary
`33e66fbc63ee8353f0ddcee33cd53fdc504ec146824f9ad02d3d3d9329fffd5d`
with approved #313 source-content equivalence. Firmware and signing input
admission follow the exact handoff; no key generation or firmware rebuild is
authorized. A-baseline composition does not include pending B/C product changes.

PMA Bun/Rust acceptance baselines apply to package provenance, pinned tools,
compiled dependencies and artifact checks; unchanged product code is not being
refactored or declared production-ready. New executable product behavior is
absent in this phase, so new product RED/GREEN is not applicable; the earlier
collector RED/GREEN is retained. All 38 mandatory CX physical rows, S905 physical
obligations and original-device reboot remain unqualified. A coordinates and A4
integrates; device/operator/endpoint/current-image/power inputs are unconfirmed.
Historical D5 remains optional and nonblocking. D owns global reconciliation.

Checkpoint review: pma-cr local review of the actual two-document delta and
external gate/resource wrapper found zero reportable issues (PASS). Product
source is unchanged. `bash -n` passed for both external scripts; all six existing
producer preflights passed (23 examined inputs total); `make docs-verify` and
scoped `git diff --check` passed. The documentation log is
`evidence/docs-composition-checkpoint.log`, SHA-256
`8a05e614b6a6f3057988dc2ab915a7d38c1dca9b9fb13c021799786872185216`.

Prepared command: `bash /srv/station/work/tmp/mos/1zjiu5h5/composition-20260910-2026-z2Ljld/package-policy-gate.sh`.
Script SHA-256: `6ad5386d2a3cf895db6d982c40dad99f85692671402479aa9b52513a0a9bc108`;
invocation-only Docker wrapper SHA-256:
`e9625db5b77d4d9d4cf59c784261c9605e301cdd0a2e6396b8f942126b8937d8`.
The persistent-shell session is `1zjiu5h5-a3c184`; authoritative live/final
metadata will be `evidence/package-policy-gate.json`, with PID, UTC times,
source/tree, command, script hash and exitCode. Full output is
`evidence/package-policy-gate.log` plus per-producer logs. This is prepared-gate
metadata, not a claim that the package build has already passed. No old resource
was deleted; the prior kernel evidence and build image remain preserved.

### Original collector/kernel tracking

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
were source-level evidence before the coherent ARM64 build recorded below;
that build has now passed, while D1-D4 still require exact-image observations.

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
The resulting scoped review had no remaining findings. At that checkpoint,
full kernel and physical verification were pending and not covered by the
collector review; the completed kernel result is recorded separately below.

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

## Coherent compiled milestone

The kernel gate passed on clean source commit
`38a362cd3ce46bab6d1f04489503dca9b92b664c`, tree
`b3bb2b0e3fe90bba5f93fe346589ba627af4fd33`. Subsequent documentation commits
are not kernel rebuild identities. The complete six-patch series was applied to
vendor commit `c6157104418d012823413c02f9222f3fe123dd25`; release is `6.1.115`.
The labeled equivalent of the recorded `make cx3576-kernel` recipe used the
existing digest-pinned Ubuntu builder and retained target `build` for objects.
The explicit public verity certificate was
`/srv/mos/_out/boards/cx3576/verity-trust/101209c31085b09853c688d64c374d899ab904d508a4f69f0ae9b676c4ea0212/signer.cert.pem`,
SHA-256 `101209c31085b09853c688d64c374d899ab904d508a4f69f0ae9b676c4ea0212`.
No private key was used for this build.

Evidence base `E` below is
`/srv/station/work/tmp/mos/1zjiu5h5/recovery-1/`.

| Gate record | Actual result |
|---|---|
| Command / lifecycle | `bash /srv/station/work/tmp/mos/1zjiu5h5/recovery-1/kernel-gate.sh`; 2026-09-10T19:16:56Z..19:31:44Z, exit 0; gate PID 1358217; persistent-shell tmux `1zjiu5h5-a3c184`, shell PID 1358207. Final `kernel-gate.json` and `GATE_EXIT_CODE=0` agree. |
| Complete gate log | `kernel-gate.log`, 378252 bytes, SHA-256 `5573248d7d764a89a182c4f9bf950b0b0aaea774bab4e35e46de3fa6b0a5cef1` |
| Complete build log | `kernel-build.log`, 372502 bytes, SHA-256 `8518b988ee65b1ab182901e9e68f4fbba96cd7cf89227bc4ae83e42f8d6fce5e`; actual kernel/module MODPOST and final vmlinux link completed. |
| Immutable output manifest | `compiled/SHA256SUMS`, SHA-256 `9aab7b62df43ed349728e4f24d4041b557392d28c16a20fd7ef001eee349af0e`; all 42 artifact/object/ELF/source entries revalidated. |
| Collection audit | `timeout 60 bash E/collect-final.sh`, 2026-09-10T19:52:56Z..19:53:01Z, exit 0; `collection.log` SHA-256 `a4dd91a084d9274dc1b729be34433936cfc737b1e0c271f3a3fb198cc92db3fc`; `collection.json` records command/source/time/exit. |
| Retained builder | `ai-agent/mos-cx-a4-kernel:38a362cd`, identity `sha256:2da9f07e885f4ddff2f0a66493782a6f62cc241cf11de170ad0c27f5ca78d3cb`; labels bind task and source. Contains complete patched `/ksrc` for review. |

### Final kernel and support inputs

Paths are relative to `E/compiled/artifact/`. `modules.tar` is the compiled
support input, not a signed support component or a complete root.

| Artifact | SHA-256 |
|---|---|
| `Image` (44687872 bytes) | `f0380b3ca03d61943a4aa6ace2c0378cd057ee82ff408a764dc0b19f4976519c` |
| `rk3576-src.dtb` (284944 bytes) | `912d6091cf22c6ce110eefa53b39fd8e53e64ddfb3c1a0a382559ecf1d3de39c` |
| `.config` | `b558db2876d9eacf14c547597913fd552bc923ca372053684dc15570949edf8b` |
| `modules.tar` (5529600 bytes) | `d2a760ef015217e8ab2b6fb75bf65891862025eb1f18faee2e72a311e4e3e479` |
| `regdb-certs.pem` | `a6a84c88b61d65e275549627c36d52d6ff78f57466ec1dd3ec8d6319cbaf8d2e` |
| `kernel.release` | `157ec590c0eeaa193c9f22b60379c343d9b60e12adf52db15932995c4001444e` |
| `System.map` | `f3d0352854b6eae213763a3d67719245f1406a176008e7298fe2092f31e71200` |
| `vmlinux` | `8225f314a3c8c3c386d02ae42b70d370045adacd0d7ad6a082d35892e1da7325` |

The resolved config has built-in LOGO/CLUT224, DRM/ROCKCHIP/fbdev/fbcon and
disabled deferred takeover. Forced command line retains serial-only ttyFIQ0,
required verity signatures, centered single logo and disabled cursor. These
compiled settings are not a newly signed FIT command-line verification. Current
source still reserves authenticated tty2, without tty1 getty or autologin.

### Actual objects and semantics

Objects are under `E/compiled/objects/` at their original kernel-relative paths;
full symbol/relocation/readelf reports are under `compiled/elf/`.

| Kernel-relative object | SHA-256 |
|---|---|
| `drivers/video/rockchip/mpp/mpp_rkvenc2.o` | `1f2e616c620898e5a59df48ccda38ed08f3afe3d7c8fd3ca3c42e0d121a0e625` |
| `drivers/video/logo/pnmtologo` (x86-64 host generator) | `5a8a0473a33b8613870c7d053530e4de60915cf2852217e900d8482585a970e7` |
| `drivers/video/logo/logo.o` | `4fa8fc0f0f47bd88aadcceb825c9289f8f1f814146ae72f78e6c6505b8675dc4` |
| `drivers/video/logo/logo_linux_clut224.o` | `0e095412751af8f729f4aab607cb9cdfbf2b718305237de9de4f0f4b0d29a28a` |
| `drivers/video/fbdev/core/fbmem.o` | `097af50d064a1c8a72010e00d942de1e071bf8e92cb9780016a73553bd46a2c0` |
| `drivers/video/fbdev/core/fbcon.o` | `f84fe9c94b76a07c4a0b415495af8e776694aac55c2c05247b174fd33d6a3d44` |
| `drivers/gpu/drm/rockchip/rockchip_drm_fb.o` | `6e9adbe8773ae5b15e391992c9c6fdf179deed7422ba4ea8da8e2909e3254108` |

All six target objects and vmlinux identify as AArch64. `fb_find_logo` is in
ordinary `.text`; descriptor/data/CLUT occupy permanent `.rodata`, with symbol
sizes 32/291600/669 bytes (292301 total before alignment), without init-section
references in the two logo objects. `fbcon_show_idle_logo` was inlined into
`fbcon_switch`: actual CALL26 relocations at 0x3e68 and 0x3e94 reach
`fb_prepare_logo` and `fb_show_logo`. `rockchip_drm_output_poll_changed` has a
CALL26 at 0x1c0 to `fbcon_update_vcs` with the visible-update argument set.
The encoder object retains the fixed-rate diagnostic and the guarded OPP call
chain; its integrated source hash remains A1's expected
`4ca030244b13f6355c802ecc7f941142565650cac85be93a7a74d8c3d5c9fe8f`.

The full patched-source A1 fixture passed, A3 passed 30 behavioral plus three
host ELF section assertions, and the new DTB fixture passed both encoders and
the decoder's fixed clock/reset contracts. Logs and SHA-256:

- `compiled/encoder-fixture.log`: `4fb23638dd200dd636a66de2feebe1aefc070f6ea4d212070cbd3dde31845abc`.
- `compiled/display-fixture.log`: `a651e5f2619a6678d0c5747750e3ba5c4714f6503c3e941f1b0b4e5aaa68d8e1`.
- `compiled/resource-dt.log`: `57eec2662605420d574febb5afcf98dfe2a6840e024440e008cf297af636d88b`.

NPU overlapping IOMMU/MMIO ownership remains OPEN. Neither these fixtures nor
whole-kernel compilation establishes scheduling/lock behavior, login execution,
physical display, accelerator workloads or support for framebuffer growth beyond
the original allocation. MODPOST found no section mismatch or unresolved symbol.
Preserved warning limits: 12 package-install missing-manpage warnings, vendor
`drivers/gpu/drm/rockchip/dw-dp.c:3199` `%d`/`size_t` format warning, and Docker's
`InvalidDefaultArgInFrom` advisory for the deliberately explicit base-image arg.
This is not a warning-free build and no product repair was attempted.

## Current A-baseline composition input audit

This audit does not wait for future B/C implementation. It found an actual
missing current-contract CX root, so no new complete image was composed and
candidate-only FIT negatives, image offline checks and flash readback were not
run against an old image. Two known packed roots were read with a narrow,
read-only, labeled container; `packed-root-audit.log` SHA-256
`5712ad5511caffea23f58aa301b5f113472c1475a75ce462ac52d2567c3b541e`,
with exact times/exit 0 in `packed-root-audit.json`.

| Input | Availability / exact boundary |
|---|---|
| Current CX root | **Missing admissible artifact.** `/srv/mos/.tmp/cx-storage-display/source/_out/cx-storage-display/components/root/rootfs.img` SHA-256 `2a4eb3d442592bb36c32586ff38576b9e7710b6689bc3f091e4a99b9eae62147`, component `4d8f0bb540d4e4f7a32c362c198e84c2303e3a83268ee3d0deada5eac469c776`, still has bounded projects 100/102. Its packed layout script hash is `be1d586be333f8dede0c7e7f3d3f262e59fdb3ac681ac9d8da2c0021618ea193`; current source is `683ce0839962ae2cf8f016e05f7d6fcde27bc6ffe39dda58b42bdbd676ae3414` with zero limits. The prior unlimited-data task explicitly did not rebuild the image. |
| Other known CX root | `/srv/mos/_out/cx3576/rootfs-verity.img`, SHA-256 `c7acdbb0f7eaabb7ad0293ba000024dcc6b2907f60489ea537beafc049ea2165`, is older `git97bb466792ca-1` package output; its packed script still bounds project 100 and lacks the separate container project. It is also inadmissible. |
| Native init | The old CX input at the storage-display snapshot's `_out/cx-storage-display/inputs/mos-init` has SHA-256 `92ef814981a692274bd8b1263d943ef87c338a051c47a0f872e2473c798b67f2`, attributed to `0209c4bf...`; six relevant deployment source files differ from the accepted A baseline. Do not silently reuse it. Approved #313 evidence has the newer `/srv/mos/tmp/s905x5m-current/init/mos-init` hash `33e66fbc63ee8353f0ddcee33cd53fdc504ec146824f9ad02d3d3d9329fffd5d` and build log; its original source equivalence is retained, not relabelled a clean A rebuild or used to substitute an S905 root. |
| Firmware candidate | Storage-display snapshot `_out/cx-storage-display/firmware/u-boot-rockchip.bin` SHA-256 `1386f1ce5263fa66b04ee3cab2f40d19802dac923f477f4691968b31c6a1af05`; signed `firmware.json` hash `46f83d67458ffc78d7b2889209685e428fe655bdb5ec0e3cd7cc7b553164866a`. The three core recorded CX boot source hashes match current source. This remains the inherited development firmware candidate, not a new firmware build or newly paired FIT acceptance. |
| Support | New modules and exported regdb trust are available above; the five board radio files were hashed from the committed source in `collection.log`. No new signed `support.img`/descriptor was published. Reusing old support would discard the current kernel modules and is not allowed. |
| Signing/public trust | Existing storage-display snapshot `.tmp/content-signing/signer.cert.pem` matches the compiled verity anchor. Its content private key, `.tmp/signing/boot/signer.key.pem` and `.tmp/signing/updates/signer.key.pem` exist; only existence was checked, with no private-key reads, generation or signing. Public boot certificate SHA-256 `c9cd2241cc47266b302aceae71a280c4892f9bcaf32026c96f361cde42aad74b`; metadata public-key-file hash `0eb4c0e03777d6f416660023e74457b888c71bd246956b3b53caaaa80e856ff6`. Therefore “signing keys absent” is not the composition blocker. |
| Packaging tooling | Read-only audit pinned existing FIT tools image `sha256:d75165f107b50d2c1cc0e9d07b49802ed78cc6b066f6b63595f7b38290145380`; its fit/initramfs/regdb script hashes match the accepted A source. This is tool/input inspection, not consumption of a new B3/C payload. |
| FIT / deployment records | No FIT, kernel/support component ID or fresh factory deployment envelopes exist for this new Image. Old generations 11/12 reference the old root/kernel and cannot be relabelled. New records and candidate-specific offline/signature/readback gates require an admissible current CX root and the explicitly selected source-bound init/trust/firmware combination. |

Required handoff through L2/L1 to the shared root/packaging owner: a newly
composed CX3576 root on the accepted A baseline (or a separately approved exact
source), including package/source manifest, rootfs-verity image/parameters and
digests, with zero quotas on `/mos`, `/srv`, `/mos/containers`, bounded writable
whole `/var`, private container paths and current authenticated tty2. Confirm the
native init artifact's source/content identity alongside that root. This is a
specific artifact dependency, not a request for speculative product changes or
a blanket dependency on later B3/C work. The one passed kernel needs no rebuild.

A later combined milestone requires L1's exact reviewed B/C handoff: B3 owns
native shutdown and bounded kernel-payload plumbing; C owns public-meta/verifier
and release/sourceIdentity/Toolbox changes. None is imported here. Board flashing
also independently requires confirmed hardware admission.

## Final review and disposition

Final local review covers the entire owned collector/test delta from the
authorized L2 base, plus this artifact/input documentation update. No product
source or sibling records were edited. Stale logs cannot replace the live
required-health probes; optional-unit failures remain diagnostics; dry-run
results are downgraded in both report tables; API/image/media/mode rebinding is
refused; repeated boot IDs are not extra cycles. Operator reports still require
raw external evidence review and do not turn simulated data into hardware proof.

| Review severity | Remaining findings |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

Verdict: PASS for the bounded local change. Final cheap-gate commands, UTC times,
exit identities and hashes are retained in `E/final-delivery.log` and
`E/final-delivery.json`. Original RED and all intermediate logs remain intact.
No fresh executable behavior was changed in this result-collection turn.
The completed task is the collector/kernel/input evidence deliverable; signed
image composition and every mandatory physical obligation above remain blocked.

The completed gate uses no active heavy token. Retain the labeled builder image,
full patched source, compiled artifacts, source snapshot and logs for L2 review;
no existing owner artifact or shared cache is removed. The idle task tmux shell
was removed after confirming it had no child process. The short input
audit container was read-only and used `--rm`; no bench interface was touched.

Change-history handoff for D through L2: this task/plan pair and the scoped bench
delta supersede only the collector gaps, distinguish reviewed A3 software from
the older A2 investigation baseline, retain historical optional D5, and map A/A4
coordination separately from missing physical inputs. No sibling, historical
task status, global index history or changelog is reconciled here.

- complete: Completed bounded collector, coherent kernel and input-provenance evidence; current CX root composition and all mandatory physical rows remain explicitly blocked. No hardware completion is claimed.
