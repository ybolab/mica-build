# PLAN-921 Integrate the BM201 front-panel userland

- **status**: completed
- **createdAt**: 2026-09-01 07:05 UTC
- **approvedAt**: 2026-09-01 07:19 UTC
- **completedAt**: 2026-09-01 07:39 UTC
- **relatedTask**: RFCT-939

## Context

The BM201 kernel half is already complete and out of scope. On the board, the
`skykirin_ht1628` driver binds to the `skykirin_led` platform device and
exports `text`, `symbols`, `brightness`, and `enabled`. The current gap is
userland: the module has reference count zero because no process writes those
attributes.

The working s905x5m-alpine implementation supplies a portable POSIX-shell
`bm201-front-panel` daemon and an OpenRC wrapper. The daemon defaults
`BM201_PANEL_ROOT` to `/sys/bus/platform/devices/skykirin_led`, validates all
four attributes before writing, emits a warning and exits zero when they are
missing, initializes brightness/enabled, displays local `HHMM`, blinks the
colon, and reflects `eth0` and `p2p0` carrier. It also retains
`BM201_NET_ROOT` and `_BM201_TEST_ITERATIONS` as fixture hooks. Its OpenRC
`stop_post` writes `0` to `enabled` without making stop fail.

`PLAN-910` Q4 already classifies the s905x5m hwinit boundary: Wi-Fi has a
power/module sequence, audio has module/mixer setup, and Bluetooth has a vHCI
bridge. HDMI, USB, and Ethernet need no hwinit. The panel was left
unclassified there, and this plan closes that gap deliberately. The panel has
no mutable board fact, power rail, ordered module sequence, or initialization
state to apply: the kernel's platform-device discovery owns binding the driver.
Its userland process instead renders changing time and carrier state for the
lifetime of the system. It is therefore an ordinary board service, not a new
`BOARD_HWINIT_CONFS` member. The existing value stays `wireless audio
bluetooth`; treating a lifetime renderer as hwinit would invent a configuration
fact and conflate observing an already-initialized device with initializing it.

`BOARD_USERLAND_FILES` is an exact, board-required regular-file allowlist.
`RFCT-936` / `PLAN-918` deliberately moved the development MQTT reference out
of that list and introduced default-off `MOS_ROOTFS_COMPONENTS`. On approval,
the owner clarified that the BM201's optional-panel decision applies to the
packaging boundary as well: selecting a front-panel payload must be explicit,
and `BOARD_USERLAND_FILES` must remain the six Bluetooth runtime files. The
component is therefore `MOS_ROOTFS_COMPONENTS=bm201-front-panel`, available
only to s905x5m and absent unless named. Its selected package still has the
same fail-open daemon behavior, so a selected image with a missing driver
boots healthy; an unselected image has no panel service at all. A standard
systemd target drop-in is the right enablement form because the component is
an exact regular-file package; `os/verify` already recognizes a
`multi-user.target.d` `Wants=` entry as equivalent to an enablement symlink.

The current s905x5m image was read without contacting the board. Its rootfs A
contains both required barriers:

- `systemd-time-wait-sync.service` is enabled through
  `sysinit.target.wants`, declares `Before=time-sync.target shutdown.target`,
  and wants `time-sync.target`.
- `systemd-networkd-wait-online.service` is enabled through
  `network-online.target.wants`, declares
  `Before=network-online.target shutdown.target`, and is enabled when
  `systemd-networkd.service` is enabled through its `Also=` relationship.

Consequently `time-sync.target` and `network-online.target` are actual image
targets with active wait providers, rather than guessed names. The new service
must both pull them in and order after them.

The branch record renumbering is current: `PLAN-034` became `PLAN-910`, and
`RFCT-270` through `RFCT-294` became `RFCT-910` through `RFCT-934`, as recorded
by `RFCT-935`. This work uses new branch-reserved records `PLAN-921` and
`RFCT-939`.

No connection has been made to `192.168.27.62`; its runtime acceptance suite
is active under RFCT-938. No reboot, slot change, eMMC boot-area write, or
`bootloader_a` write is proposed.

## Proposal

1. Copy the Alpine daemon unchanged in behavior into the s905x5m front-panel
   component source. Keep the default `BM201_PANEL_ROOT`, `BM201_NET_ROOT`,
   `--once`, deterministic test iteration hook, all-four-attribute probe, and
   exit-zero optional-panel behavior.

2. Add a small POSIX stop helper beside the daemon. It uses the same overridable
   `BM201_PANEL_ROOT`, attempts `printf '0\\n' > "$panel_root/enabled"`, writes a
   diagnostic on failure, and always exits zero. This is the direct systemd
   equivalent of OpenRC `stop_post` without fragile shell quoting in an
   `ExecStopPost=` line.

3. Ship a normal systemd service and a regular-file `multi-user.target` drop-in
   as one exact optional component package:

   ```ini
   # bm201-front-panel.service
   [Unit]
   Wants=time-sync.target network-online.target
   After=time-sync.target network-online.target

   [Service]
   Type=simple
   ExecStart=/usr/sbin/bm201-front-panel
   ExecStopPost=/usr/lib/mos/bm201-front-panel-stop

   [Install]
   WantedBy=multi-user.target

   # multi-user.target.d/bm201-front-panel.conf
   [Unit]
   Wants=bm201-front-panel.service
   ```

   The unit intentionally has no restart policy: an absent optional panel is a
   successful no-op, not a crash loop. It intentionally does not hard-code an
   `Environment=BM201_PANEL_ROOT` assignment, so a systemd drop-in or direct
   fixture invocation can override the daemon/helper default.

4. Add a `36-component-bm201-front-panel` stage and a strict component installer.
   `build-v2.sh` will stage the four regular files from the s905x5m component
   source only when `MOS_ROOTFS_COMPONENTS` names `bm201-front-panel`; the
   installer will refuse a missing, extra, or symlinked member before writing
   any target path. It will refuse every board except s905x5m. Do not change
   `BOARD_USERLAND_FILES`, add a `front-panel.conf`, hwinit script, or
   `BOARD_HWINIT_CONFS` value.

5. Port the Alpine daemon test to the component directory and replace its
   OpenRC-only test with a systemd service test. The latter will validate the
   target drop-in, `Wants=`/`After=` ordering, `ExecStart`, `ExecStopPost`, no
   restart loop, and fixture-backed stop behavior. Add component-installer and
   stage-selection tests. Together they prove all sysfs writes, selected-package
   membership, and unit semantics without hardware.

6. Run the focused shell and component-installer tests locally. On
   `192.168.27.200`, build a rootfs with
   `MOS_ROOTFS_COMPONENTS=bm201-front-panel` and run its image contract so the
   selected package and target drop-in are checked in the packed image. Also
   verify an unselected image has no component stage or files. Report that as
   software/packaging verification only. Physical segments, colon, and LEDs
   require the owner to look at the board and will be reported separately as
   unverified.

## Risks

- `After=` alone does not pull in a target; omitting `Wants=` would allow the
  service to start before either barrier. The unit will carry both directives.
- A restart policy would convert a missing optional panel into a journal and
  CPU loop. The service will retain systemd's default no-restart behavior.
- An `ExecStopPost` shell one-liner can accidentally expand the wrong
  environment or fail service teardown. The dedicated helper is simpler to
  test and is explicitly best-effort.
- `network-online.target` may delay the panel until networkd completes its
  configured-link wait. That is deliberate: it is the requested translation
  of the OpenRC networking ordering, and the image already enables the
  networkd wait provider.
- A successful fixture or rootfs test cannot establish that physical segments
  are wired correctly. It proves userland writes only; visual acceptance stays
  with the board owner.

## Scope

Expected implementation files:

- `os/rootfs/build-v2.sh`, a component stage, and a strict component installer
- new BM201 daemon, stop helper, systemd service, and target drop-in under the
  s905x5m component source
- focused POSIX daemon/systemd tests and component/stage-selection tests
- applicable rootfs component documentation
- `docs/task/RFCT-939.md`, `docs/task/index.md`, `docs/plan/PLAN-921.md`, and
  `docs/plan/index.md`

No kernel, DTS, bootloader, partition, generic hwinit, eMMC, slot, or
board-state change is in scope.

## Alternatives

1. **Add `front-panel` to `BOARD_HWINIT_CONFS`.** Rejected. It would invent a
   board configuration fact and place a lifetime display loop inside a
   mechanism intended to power/initialize hardware. The driver is already
   bound by device discovery; the renderer has no initialization work to own.

2. **Put the daemon in `BOARD_USERLAND_FILES`.** Rejected on approval. That
   list describes board-required runtime files and was just narrowed to the
   Bluetooth artifact by RFCT-936. The panel is optional by product decision,
   so `MOS_ROOTFS_COMPONENTS=bm201-front-panel` is the explicit selected
   package. Fail-open daemon behavior still protects a selected image when
   the hardware interface is missing.

3. **Put untracked files directly in the board overlay.** Rejected. It would
   bypass the exact `BOARD_USERLAND_FILES` artifact contract and make the
   board-specific executable/service invisible to the board userland checks.

## Annotations

- Approved on 2026-09-01 at 07:19 UTC. The owner explicitly selected the
  component boundary and required the PLAN-910 Q4 panel-classification
  reasoning above. No implementation or board access occurred before approval.
- The board at `192.168.27.62` remains reserved for RFCT-938 read-only runtime
  collection. This implementation will not touch it; no reboot, slot change,
  eMMC boot-area write, or `bootloader_a` write is authorized.

## Implementation

- Added the `s905x5m`-owned `bm201-front-panel` component assets: the Alpine
  POSIX daemon copied without behavioral change, a best-effort stop helper, a
  systemd unit, and a `multi-user.target` drop-in. The unit pulls in and orders
  after `time-sync.target` and `network-online.target`; its `ExecStopPost`
  invokes the helper that writes `0` to `enabled`.
- Added `36-component-bm201-front-panel`, source staging in `build-v2.sh`, and
  a four-member exact-package installer. Selection is restricted to s905x5m,
  but allowed for either rootfs profile because it is optional hardware rather
  than a development sample.
- Kept the board boundary intact: no `front-panel` hwinit entry, no hwinit
  configuration, and no change to the six Bluetooth-only
  `BOARD_USERLAND_FILES` paths. The component is selected only through
  `MOS_ROOTFS_COMPONENTS=bm201-front-panel`.
- Ported the Alpine daemon fixture and replaced its OpenRC fixture with a
  systemd fixture. Added installer and stage-selection coverage, rootfs-stage
  documentation, build examples, and the changelog entry.

## Verification

- The direct POSIX daemon fixture and systemd fixture pass. They prove all
  four panel attributes are required, missing controls warn and return zero,
  `BM201_PANEL_ROOT` drives a temporary fixture, all daemon writes occur, the
  unit ordering is exact, and stop writes `0` without making an unavailable
  panel fatal.
- Focused `os/verify` tests pass: 9 tests / 29 assertions for the daemon,
  systemd fixture, and exact installer. The installer succeeds only for all
  four regular files and fails before a target write for every missing member,
  an extra file, or a symlink. `os/build` stage tests pass: 92 tests / 208
  assertions. `docs/verify-index.sh` passes 48/48; shell syntax checks and
  `git diff --check` pass. The non-s905x5m component selection fails before
  any build work with its explicit board-scoping error.
- `os/build/run.sh --build-rootfs --plan` could not use its frozen dependency
  route locally because the installed Bun rejects this tree's lockfile format;
  the direct stage CLI was used instead. It proves the default chain omits
  BM201 and explicit selection inserts `36-component-bm201-front-panel`
  between `34-feature-mqtt` and `40-board`.
- On `192.168.27.200`, a full isolated rootfs attempt reused the existing
  `modules.tar` (SHA-256
  `d05e942308151576a88b82ff788904b051c9532394c921e012670cda8e8c240d`) and
  stopped before the new stage because the isolated source snapshot did not
  contain the unrelated prebuilt RAUC output. No kernel or RAUC rebuild was
  started. The host's existing standard `34-feature-mqtt` stage was then used
  as the real predecessor for a fresh `36-component-bm201-front-panel` arm64
  stage. Inside that generated root, all four installed paths were present;
  the fixture wrote `brightness=7`, `enabled=1`, clock text and symbols, then
  the installed stop helper changed `enabled` to `0`. The missing-panel run
  warned and returned zero. The same root showed both wait providers enabled:
  `systemd-time-wait-sync.service` before `time-sync.target` and
  `systemd-networkd-wait-online.service` before `network-online.target`.
- A focused local-diff review found no high-confidence correctness,
  security, lifecycle, or test-coverage defect introduced by this change.
  This is software and packaging evidence only. No connection was made to
  `192.168.27.62`; whether segments, colon, and LEDs physically display still
  requires the owner to look at the board.
