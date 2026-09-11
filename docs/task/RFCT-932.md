# RFCT-932 Build and prove a reference MQTT application on s905x5m

- **status**: closed
- **priority**: P1
- **owner**: l2-mqtt-reference
- **createdAt**: 2026-08-31 19:52 UTC
- **plan**: [PLAN-916](../plan/PLAN-916.md)

## Description

Add a minimal, image-built reference application that owns a non-colliding
`com.mos.<class>` D-Bus name, exposes a deliberately MQTT-safe
`com.mos.Item1` tree, ships exact MQTT enrollment and D-Bus policy fragments,
and is installed through the s905x5m board userland mechanism. Build an image
containing the package and demonstrate the documented MQTT bridge behavior on
the board through the single combined campaign package. Any board operation is
limited to the coordinated eMMC slot contents; eMMC boot areas and
`bootloader_a` remain out of scope.

## Acceptance

- The package owns a sample-only `com.mos.<class>` name, exposes
  `/DeviceInstance`, implements `GetValue`, `SetValue`, `GetItems`, and
  `ItemsChanged`, and includes a bounded writable item.
- Its exact service name is enrolled under
  `/usr/lib/mos/mqtt-applications.d/`, and its package-owned D-Bus policy
  grants `mos-mqttd` only the required `com.mos.Item1` surface.
- One combined s905x5m package carries both this reference application and the
  HDMI correction. It is the sole package input to the parameterized installer
  card builder; RFCT-932 does not produce a second image or package.
- Any hardware deployment uses the verified inactive eMMC B slot only, after
  its p8 ownership has been coordinated with RFCT-934.
- Hardware evidence covers publication, known and unknown reads, keepalive,
  heartbeat, device-wide completion, read-only and full write behavior, and
  structural isolation of `com.mos.mosd`.
- The reproducible MQTT subscription/publication method is recorded along
  with any bridge behavior absent from `docs/design/bus.md`.

## ActiveForm

Closed as superseded by the current S905X5M signed-file system. Historical
package evidence remains in Git; no old raw-slot procedure is executable.

## Dependencies

- **blocked by**: (none; historical deployment path superseded)
- **blocks**: (none)

## Investigation

- `docs/design/bus.md` requires an exact enrolled
  `com.mos.<class>[.<suffix>]` name. The bridge derives the MQTT class from
  the third name segment, rejects `com.mos.mosd` after enrollment loading, and
  only calls root `GetItems`, receives root `ItemsChanged`, and calls
  path-addressed `SetValue` on an admitted application.
- The selected name is `com.mos.mqttsample.reference`. Its MQTT class is
  `mqttsample`, a deliberately non-product, sample-only class; `reference` is
  only the D-Bus suffix. No existing source or documentation uses that class.
- The bridge initially mirrors an admitted tree but emits no item notification
  until `R/<deviceId>/keepalive` opens its liveness window. During that
  60-second window it publishes retained item notifications, emits one
  non-retained completion marker per full device publish, and emits a
  non-retained heartbeat every three seconds. Reads outside that window are
  also ignored.
- The bridge logs each subscription filter. In `read-only` mode it subscribes
  only to `R/<deviceId>/#`; in `full` mode it additionally subscribes to
  `W/<deviceId>/#`. Successful and refused application writes have distinct
  journal records, which gives the hardware proof an observable boundary
  without adding a diagnostic control plane.
- The s905x5m rootfs copies only regular files listed in
  `BOARD_USERLAND_FILES`. The reference package can therefore be an arm64
  binary and four static package files emitted by the existing board userland
  Docker artifact, with no mutable enrollment or policy mount.
- The current board facts supersede the earlier SD-card observations. At
  2026-09-01 01:56 UTC, `192.168.27.56` (`imos`) was up for 5h15m, running
  `rauc.slot=A` with `/dev/dm-0` rooted on eMMC `mmcblk0p7`. The sole block
  medium is `/dev/mmcblk0`, MMC `AT3SFA`, CID
  `ec290041543353464130229911cf2c00`; its hardware boot areas
  `mmcblk0boot0` and `mmcblk0boot1` exist and are forbidden targets. The
  slot-content partitions are p5/p6 (64 MiB boot) and p7/p8 (256 MiB rootfs),
  with `BOOT_ORDER=A B`, `BOOT_A_LEFT=3`, and `BOOT_B_LEFT=3`. No SD device is
  present. Direct device paths, never PARTUUID selection, remain mandatory.
- The board has an active local-only broker at `127.0.0.1:1883`, has no MQTT
  client binary, and has an empty immutable enrollment directory. A build-host
  SSH loopback forward plus a digest-recorded containerized Mosquitto client
  is the reproducible external client path.
- One combined package was built on `192.168.27.200` from named snapshot
  `0c9deaf6c75b43beb47c0d335757a7f42bb55dbb`, which contains both HDMI commit
  `eae91169f5d4eea0e98f3aeecc6e9bd076379e5d` and MQTT commit
  `28f7845a4df7da5395d0c3b7446aeb44f0b29912`. The HDMI handoff records the
  required post-`olddefconfig` built-config assertions and their positive
  control. `make os-emmc-package-s905x5m-v2` produced the one campaign
  `update.img`; rootfs smoke passed 13/13, package round-trips passed 18/18,
  and the final image verifier passed 380/380 checks with nine named expected
  U-Boot skips.
- The package artifact's `rootfs-b.PARTITION` is deliberately all zeroes, as
  the factory assembler expects, and is not a bootable B source. Inspection
  found `boot-b.PARTITION` carries the HDMI boot script and B environment;
  `rootfs-a.PARTITION` verifies against that environment's dm-verity root
  hash. A future package-derived B pairing would therefore be
  `boot-b.PARTITION` to p6 with `rootfs-a.PARTITION` to p8, never
  `rootfs-b.PARTITION`. The owner has instead selected RFCT-934's current
  p7-to-p8 clone for the current watchdog run, and explicitly excludes both
  package rootfs payloads from that p8 write. This evidence is not
  authorization for RFCT-932 to write p8.

## Notes

- Claimed for investigation on 2026-08-31. No implementation, image build,
  slot change, or storage write has been performed.
- Phase 1 investigation and Phase 2 proposal were recorded on 2026-08-31.
  Explicit approval of PLAN-916 is required before any implementation or
  hardware mutation.
- PLAN-916 was approved on 2026-08-31. Implementation begins with the three
  bridge-contract classifications requested at approval; no image build or
  storage write has occurred yet.
- The three implementation observations were classified on 2026-08-31 as
  intended bridge behavior previously omitted from the design contract, not
  divergences: (1) the initial snapshot and closed-window changes update only
  the mirror; (2) read-only subscribes only to `R/<deviceId>/#`, while full
  also subscribes to `W/<deviceId>/#`; and (3) heartbeat and completion
  payloads carry bridge uptime seconds and a full-publish item count. They are
  now explicitly documented in `docs/design/bus.md` sections 3 and 4. The
  reference package relies only on that documented contract; there is no open
  behavior finding.
- Local static verification on 2026-08-31 passed `cargo fmt --check` for
  `mos-mqtt-reference` and the board-selection smoke-register tests. Direct
  `bun test src/checks-mqtt.test.ts` was blocked by its documented fixture
  requirement to `chown` as root (`EPERM` in this unprivileged workspace), not
  by an assertion failure; it will be run in the pinned root-capable test
  environment on the build host before image work.
- In the isolated build-host snapshot, pinned `mos-build-rust` (rustc 1.98.0)
  compiled `cargo test --no-run -p mos-mqtt-reference`. The resulting test
  executables ran against a real private host `dbus-daemon`: two value-shape
  unit tests and the Item1 tree/signal/accepted-and-refused-write integration
  test passed. The lock-file update was compared byte-for-byte with that run;
  it adds only the `mos-mqtt-reference` package record and no dependency
  resolution changes.
- Implementation is committed locally and has not been pushed:
  `28f7845a4df7da5395d0c3b7446aeb44f0b29912` adds the package, image
  integration, policy/enrollment, tests, and contract documentation;
  `7ab7eff08aef933a6249fd0146190d80a715ba62` teaches the image verifier that
  the package's regular `multi-user.target.d` `Wants=` drop-in is a valid
  service enablement. The second commit changes verification semantics only;
  it does not alter the sealed image payload.
- A clean committed-source SD image build on `192.168.27.200` completed for
  source commit `28f7845a4df7da5395d0c3b7446aeb44f0b29912`.
  `s905x5m-mos-v2-sd-1788210612.img` is 1,494,220,800 bytes with SHA-256
  `d1c4e21973beaa05373f3aa1c44908abf14c80e25827730649371ff39e544d61`.
  Factory-root smoke passed 13/13, the root-capable board-verifier test suite
  passed 60/60, and a clean final `make os-verify-s905x5m-sd-v2` passed
  380/380 checks with 9 named s905x5m/uboot skips. The sealed artifact is
  `/backup/mos-artifacts/rfct-292-28f7845a/`, with build and verifier
  provenance recorded there.
- The only prepared deployment inputs are explicit SD inactive-B slices in
  `/backup/mos-artifacts/rfct-292-28f7845a/deploy-inactive-b/`: the B cfgload
  bridge for `/dev/mmcblk1p1` SHA-256
  `53fc936ab49cf60faa8a4758582770a4a5275bcd87fcff66f6a994855b8b67bb`, B boot
  payload for `/dev/mmcblk1p6` SHA-256
  `27200cd819e7b472016fe6fdef57fa80cb8d6ea63f5a1ed5db1002d5922346e0`, and B
  root payload for `/dev/mmcblk1p8` SHA-256
  `44d9be4737818afbf583b334f4daea5a5c3b53ab722b4df91989e65934b2e873`.
  `PROVENANCE.txt` records the p1 bridge's slot-B boot.ini. No board storage
  has been read or written during preparation.
- Hardware work remains deliberately paused. The board's direct SSH endpoint
  timed out on a further read-only probe. At 21:24 UTC, the normal
  `alan@192.168.27.200` build-host path showed the board neighbour as `FAILED`,
  two ICMP probes had 100% packet loss, and SSH returned `No route to host`.
  Earlier build-host L2 probes likewise showed `FAILED`/`INCOMPLETE`; the
  initial failed `root@192.168.27.200` probe was an account-selection error,
  not a build-host availability issue. Consequently no prewrite identity
  check, partition write, cfgload change, reboot, slot change, MQTT action, or
  persistent mode change has been attempted. Once access is restored, the
  physical SD/eMMC identities and active slot must be rechecked immediately
  before any deployment; the historical preflight is not sufficient
  authorization to write.
- **Campaign revision, 2026-09-01.** The `.55` diagnosis and every prepared
  `/dev/mmcblk1p1`, `p6`, and `p8` slice are retired deployment inputs: the
  board moved to `.56` after its eMMC flash and has no SD card. The prior SD
  image remains valid offline package evidence only; it must not be flashed or
  used as a second campaign image.
- **Single-package coordination decision.** RFCT-932 is the one
  combined-package builder after `8yaodbbi` lands the approved HDMI/boot.cmd
  source and its three built post-`olddefconfig` assertions. It will build one
  clean-snapshot `make os-emmc-package-s905x5m-v2` artifact that contains both
  the HDMI commit and RFCT-932 commit `28f7845a`. `8yaodbbi` will not build a
  standalone package. `ccql8vgp` will then feed that exact checked `update.img`
  to the parameterized installer-card builder. This assignment prevents
  parallel image production and is the recorded cross-task handoff.
- **B-slot interlock.** RFCT-934 owns the first construction of bootable B:
  it found current `mmcblk0p8` zero-filled and plans the verified p7-to-p8
  recovery copy. RFCT-932 will neither write p8 nor prepare a competing raw
  payload. The combined package confirms that `rootfs-b.PARTITION` is also
  all zeroes, so it is excluded as a B source. The owner selected RFCT-934's
  current p7-to-p8 clone as the single construction for the current watchdog
  run and excluded either package rootfs payload from that p8 write. A future
  source selection after any owner flash needs a separate decision; two
  independent writes to p8 are prohibited.
- The normal installer-card configuration currently sets
  `erase_bootloader = 1`; its complete package also has a special
  `bootloader.PARTITION` destination that reaches the eMMC hardware boot area.
  Building and verifying the card is within the coordinated artifact sequence,
  but invoking that current automatic burn path would violate this campaign's
  prohibition on boot-area/bootloader writes. It is therefore not authorized
  as the board-write mechanism. A separate owner-approved, readback-verified
  slot-content-only procedure is required before the single hardware pass.
- **Combined-package result, 2026-09-01.** The sole deliverable is
  `/backup/mos-artifacts/rfct-292-combined-0c9deaf6/update.img`, 1,369,400,096
  bytes, SHA-256
  `1c09ad372ee33e2c2c5efc1bc4f1634481894c846ff493df19e363d10fd594e7`.
  `update.img.sha256` and the 17-file artifact `SHA256SUMS` both verified.
  A preliminary invocation with a mistyped provenance SHA was stopped before
  it produced an output image; it is not a package artifact. The clean final
  snapshot is the only completed campaign package.
- The sealed artifact includes build and verifier logs, package extraction,
  and these slot-payload hashes: `boot-b.PARTITION`
  `9ce7a0b924b840af788c1bc27900866124ae9d6023d8d00f1fe1c89a3b5e9c27`,
  `rootfs-a.PARTITION`
  `cafa334b777a222f7cf3060c225fb5b6c3ab8a87527af504398d3d1790e1cbb5`,
  and zero-filled `rootfs-b.PARTITION`
  `a6d72ac7690f53be6ae46ba88506bd97302a093f7108472bd9efc3cefda06484`.
  Project-pinned `veritysetup verify` passed for rootfs A against the root
  hash in the B boot environment. No card build, board write, boot-area
  access, reboot, slot change, or MQTT hardware test has been performed.

- close: Superseded by the current S905X5M signed-file system; historical raw-slot deployment instructions must not run.
