# PLAN-916 Build and prove a reference MQTT application package

- **status**: rejected
- **createdAt**: 2026-08-31 19:52 UTC
- **approvedAt**: 2026-08-31
- **relatedTask**: [RFCT-932](../task/RFCT-932.md)

## Context

This old combined-package/raw-slot hardware plan is superseded by the current
S905X5M signed-file integration. Its historical MQTT implementation and offline
artifact evidence remain valid history, but no partition write, RAUC path or old
package in this record is a current execution instruction. Any current hardware
MQTT acceptance needs a fresh newest-image owner assigned through the campaign.

The delivered bridge is enabled on the s905x5m board, but the immutable
enrollment directory is empty. No application has therefore exercised the
application-to-MQTT path on hardware.

`docs/design/bus.md` defines `com.mos.<class>[.<suffix>]`, with the third
segment used as the MQTT class. `mos-mqttd` admits only exact regular-file
enrollments under `/usr/lib/mos/mqtt-applications.d`, independently rejects
`com.mos.mosd`, reads and watches an admitted application's root Item1 tree,
and invokes `SetValue` only at the addressed item object path. The existing
policy verifier already rejects wildcard ownership, unpaired enrollment,
non-Item1 bridge grants, and every bridge-to-mosd policy grant.

The s905x5m board packaging path is a root-shaped artifact built from
`os/boards/s905x5m/bsp/userland/`; `BOARD_USERLAND_FILES` is an exact,
regular-file allowlist consumed by the rootfs builder. This is the correct
package insertion path. It avoids a runtime bind mount and preserves the
immutable image admission model.

The current board is `imos` at `192.168.27.56`, not the historical `.55`
address. At 2026-09-01 01:56 UTC it was running slot A for 5h15m, with
`/dev/dm-0` rooted on eMMC `/dev/mmcblk0p7`, `BOOT_ORDER=A B`, and both credits
at 3. The only storage medium is MMC `AT3SFA`, CID
`ec290041543353464130229911cf2c00`; its p5/p6 boot and p7/p8 rootfs slot
partitions are present, and its hardware boot areas `mmcblk0boot0` and
`mmcblk0boot1` are forbidden. No SD card is installed. Direct device paths,
never PARTUUID selection, are mandatory for any later slot-content operation.

RFCT-934 established that inactive `mmcblk0p8` is all zeroes, so B is not a
recovery position yet. It owns the plan to establish B with a byte-verified
operation. That ownership is a safety interlock: MQTT work cannot independently
write p8, and no two plans may race on the same fallback rootfs.

The local broker is intentionally loopback-only and the board ships no MQTT
client. The reproducible client will run on `192.168.27.200` through an SSH
loopback forward, using a containerized Mosquitto client whose resolved image
digest is recorded with the evidence. No client software will be installed on
the board.

The bridge preserves an initial Item1 snapshot but does not emit item
notifications until a keepalive opens the liveness window. It logs the actual
subscription filters: read-only starts with only `R/<deviceId>/#`, while full
adds `W/<deviceId>/#`. It additionally puts bridge uptime seconds in heartbeat
payloads and an item count in the completion-marker payload. On approval these
three observations were classified as intended bridge behavior that the design
document omitted, rather than a divergence. `docs/design/bus.md` sections 3
and 4 now make all three contractual before this reference package depends on
them.

## Proposal

1. Add the reference package as a Rust workspace member at
   `os/pkgs/mosd/mqtt-reference` and build the executable
   `mos-mqtt-reference` with the existing arm64 cross-build script. No new
   dependency is required. Give it the exact bus name
   `com.mos.mqttsample.reference`: `mqttsample` is visibly sample-only rather
   than a future product domain, and `reference` permits a future sample
   variant without changing the MQTT class.

2. Export a full Item1 application tree. Root `/` will provide `GetItems` and
   emit `ItemsChanged`; each published item object will provide `GetValue` and
   path-addressed `SetValue`, matching the service contract. Include the seven
   registry-conformance paths plus safe sample data:

   ```text
   /Mgmt/ProcessName       "mos-mqtt-reference"
   /Mgmt/ProcessVersion    "0.1.0"
   /Mgmt/Connection        "connected"
   /DeviceInstance         1
   /ProductId              "mos-mqtt-reference"
   /ProductName            "mos MQTT reference"
   /Connected              true
   /Example/ReadOnly       "ready"
   /Example/Setpoint       42, writable, min 0, max 100
   ```

   `SetValue` will accept only integral `0..=100` values at
   `/Example/Setpoint`, return `0` for an accepted update, and emit
   `ItemsChanged` after the state transition. Unsupported paths and malformed
   or out-of-range values will return non-zero application-defined refusal
   codes and emit no change. The process will log accepted and refused sample
   writes, without logging arbitrary values.

3. Package the service through the existing s905x5m board userland artifact.
   Add these five declared regular files to `BOARD_USERLAND_FILES` and make
   the userland Docker artifact install them:

   ```text
   /usr/bin/mos-mqtt-reference
   /usr/lib/systemd/system/mos-mqtt-reference.service
   /usr/lib/systemd/system/multi-user.target.d/mos-mqtt-reference.conf
   /usr/lib/mos/mqtt-applications.d/com.mos.mqttsample.reference
   /usr/share/dbus-1/system.d/com.mos.mqttsample.reference.conf
   ```

   The regular target drop-in starts the service without a mutable wants
   symlink. The unit will run as the existing unprivileged `mos` account, own
   only its exact well-known name, require only `AF_UNIX`, and use the same
   filesystem and privilege hardening style as the other local services.

4. Make the package-owned D-Bus policy fail closed. Its default context will
   deny sends to and receives from the exact sample name; the `mos` account
   receives only `own`; `mos-mqttd` receives only Item1 `GetItems`, Item1
   `SetValue`, and Item1 `ItemsChanged` for that exact name; root receives only
   Item1 `GetItems` for the registry. It will grant neither an `own_prefix`, a
   wildcard, `GetValue`, nor any `com.mos.mosd` access.

5. Add focused tests and image assertions: Item1 unit/integration coverage
   for snapshot shape, value reads, accepted bounded writes, rejected writes,
   and `ItemsChanged`; cross-build and ELF checks for the new binary; a factory
   root `--version` smoke entry; and image checks that the exact binary, unit,
   drop-in, enrollment, and policy are present and paired. Extend the existing
   negative MQTT policy tests so removing or widening this package's admission
   fails.

6. The approved campaign uses one combined package, not a separate MQTT image.
   HDMI source landed as `eae91169f5d4eea0e98f3aeecc6e9bd076379e5d`, whose
   RFCT-930 handoff assigns RFCT-932 as the sole combined-package builder. In
   named snapshot `0c9deaf6c75b43beb47c0d335757a7f42bb55dbb` on
   `192.168.27.200`, RFCT-932 proved that both that HDMI commit and
   `28f7845a4df7da5395d0c3b7446aeb44f0b29912` are present. RFCT-930 records
   the three required post-`olddefconfig` built-`.config` assertions and their
   positive control. RFCT-932 ran exactly:

   ```text
   make os-emmc-package-s905x5m-v2
   ```

   The target may internally assemble its required SD-format producer input,
   but that intermediate is neither published nor deployed. Its only campaign
   output is the completed `update.img` containing both changes, SHA-256
   `1c09ad372ee33e2c2c5efc1bc4f1634481894c846ff493df19e363d10fd594e7`.
   RFCT-932 does not run another image/package build.

7. Verify that one complete package before handoff: its unpacked
   `boot-b.PARTITION` carries the HDMI script and its `rootfs-a.PARTITION`
   carries the verified factory root, including the five exact MQTT
   application files. The factory assembler deliberately makes
   `rootfs-b.PARTITION` all zeroes, so it is explicitly rejected as a B
   source. The arm64 binary, policy/enrollment pairing, factory-root smoke,
   focused Rust tests, built-config assertions, package manifest, and package
   checksum must all pass. The completed package passed 13/13 rootfs smoke,
   18/18 package round-trips, and 380/380 final verifier checks with nine
   named expected U-Boot skips. Preserve the exact source commits, package
   hash, extracted payload hashes, and verification transcript in RFCT-932
   and RFCT-930. This is the sole source of deployment bytes.

8. `ccql8vgp` then runs the existing parameterized card builder with that exact
   checked `update.img`; it builds a delivery artifact and does not create a
   second package. Its current `bm201upd.ini` has `erase_bootloader = 1` and
   the complete package contains the special `bootloader.PARTITION` destination.
   Consequently the generated card must not be used to invoke its automatic
   burn path in this campaign: that path reaches the eMMC hardware boot area,
   contrary to the owner constraint. Building and verifying the card remains
   useful delivery evidence, but it is not authorization to burn it.

9. RFCT-934 owns `mmcblk0p8`; RFCT-932 will not copy p7 or write p8. For the
   currently approved watchdog run, the owner selected RFCT-934's active
   p7-to-p8 clone as the one B construction. The all-zero
   `rootfs-b.PARTITION` is excluded, and RFCT-934 will not write either package
   rootfs payload to p8 in that run. The package inspection remains useful for
   a later, separately approved source decision: a package-derived pairing
   would need `boot-b.PARTITION` plus `rootfs-a.PARTITION`, never rootfs B.
   Any coordinated slot-only procedure may target only explicit eMMC B paths
   (`/dev/mmcblk0p6` and `/dev/mmcblk0p8`) and must read back their hashes. It
   must not target `mmcblk0boot0`, `mmcblk0boot1`, `bootloader_a`, or any
   PARTUUID-selected path. Immediately before any reboot or slot change, the
   owner log must say:

   ```text
   COMBINED CAMPAIGN: eMMC inactive slot B contents only; no eMMC boot area or bootloader_a will be written.
   ```

   The prior prepared SD p1/p6/p8 payloads are retired and must not be used.

10. On the coordinated new B slot, use a named tmux SSH forward from the build
    host:

   ```text
   ssh -N -L 127.0.0.1:18883:127.0.0.1:1883 root@192.168.27.56
   ```

   Run `mosquitto_sub` and `mosquitto_pub` in a digest-recorded
   `eclipse-mosquitto` container against `127.0.0.1:18883`. Capture timestamped
   subscriptions and publications, then prove the following with both MQTT
   evidence and relevant system/bus journal evidence:

   - a keepalive exposes retained
     `N/<deviceId>/mqttsample/1/Example/Setpoint` with
     `{"value":42,"min":0,"max":100}`; a known `R` republishes it, while an
     unknown `R` creates no response or retained topic;
   - `R/<deviceId>/keepalive` opens the 60-second window, produces heartbeats
     at approximately three-second cadence, and gives exactly one completion
     marker for a single full device publication; the payload count and any
     coalescing behavior are recorded separately from the documented contract;
   - in default read-only mode, the post-start journal shows only the `R`
     subscription, a sample `W` produces neither a `SetValue` call nor an item
     change, and the value remains unchanged;
   - after a temporary, backed-up `MOS_MQTT_MODE=full` change in the
     STATE-backed `/var/lib/mos/mqttd.env` and a bridge restart, the journal
     shows the `W` subscription, a bounded `W` reaches `SetValue`, and the
     later `ItemsChanged` is observed as the changed retained `N` value. An
     out-of-range write will demonstrate the non-zero refusal path and no
     notification. The original mode file will be checksum-restored and the
     bridge restarted in read-only mode before hand-off;
   - in both modes, a `W` addressed to `mosd` has no effect. In full mode,
     capture the bridge's no-unique-application-target warning and a temporary
     `busctl monitor` trace with no call to `com.mos.mosd`; this demonstrates
     structural rejection and the absence of a D-Bus call rather than merely
     relying on policy prose.

11. Record the delivered package/card hashes, B-slot prewrite and readback
    evidence, command transcript, test outcomes, restoration of the read-only
    setting, and every behavior observed beyond `docs/design/bus.md`. Do not
    push the repository.

## Contract decision

The approval requested a disposition for three code-observed bridge behaviors
before a reference application could copy them. All three are intentional
behavior rather than a divergence: the bridge protocol tests already assert
them, and `docs/design/bus.md` now makes them part of the application contract.

1. **Initial snapshot and closed-window changes.** Intended: the snapshot and
   later `ItemsChanged` batches update the mirror, but the bridge publishes no
   MQTT item notification before a keepalive opens the liveness window. This
   is asserted by `keepalive_republishes_fully_and_is_rate_limited` and is now
   specified in section 3. The reference service emits no synthetic startup
   `ItemsChanged` signal.
2. **Mode-specific subscriptions.** Intended: read-only has exactly
   `R/<deviceId>/#`; full additionally has `W/<deviceId>/#`. This is asserted
   by `read_only_mode_refuses_writes` and is now specified in section 4. The
   package does not treat reception of a write as an application guarantee.
3. **Device-wide payloads.** Intended: heartbeat carries bridge uptime seconds
   and the completion marker carries the full-publish item count. This is
   asserted by `keepalive_republishes_fully_and_is_rate_limited` and
   `verbs_map_to_notify_read_and_write`, and is now specified in section 4.
   The reference proof will measure its nine published items but will not make
   protocol correctness depend on that count staying a fixed schema constant.

## Risks

- The earlier SD-card deployment premise is false: the current board has no SD
  card, so every retained `mmcblk1` artifact is a non-deployable historical
  record. eMMC slot targeting must use explicit `/dev/mmcblk0pN` paths after a
  fresh physical identity check, never PARTUUID.
- `mmcblk0p8` is all zeroes, and the combined package's factory
  `rootfs-b.PARTITION` is also all zeroes. The owner selected RFCT-934's
  current p7-to-p8 clone as the only B construction for the current watchdog
  run; RFCT-932 must not overlap it. Package inspection establishes that a
  later, separately selected package-derived pairing would be
  `boot-b.PARTITION` plus verity-validated `rootfs-a.PARTITION`, but it is not
  an approved write source now. A p7 clone followed by a different combined
  rootfs write is not acceptable evidence or containment.
- The parameterized installer card is safe to build but unsafe to invoke under
  this campaign's storage constraint: its configuration erases the bootloader
  and the input package carries a hardware-boot-area destination. No card
  insertion/burn action is authorized until an owner-approved slot-only path
  is available.
- The board lacks a production RAUC keyring, so a normal signed RAUC install
  fails closed. The only candidate proof path is an owner-approved,
  readback-verified inactive-eMMC-B slot-content operation, not a policy or
  enrollment overlay and not the bootloader-erasing installer burn path.
- MQTT broker exposure remains loopback-only. The forwarding client must use a
  fixed local loopback address and a checked container image digest; it must
  not expose port 1883 or install a board-side client.
- Temporarily enabling full mode changes persistent STATE. The procedure must
  preserve the preexisting file, verify its restoration, and leave the device
  read-only even on a failed proof run.
- The HDMI and MQTT changes must be built once from the same clean snapshot on
  the dedicated host. A separately built MQTT image would create a different
  set of rootfs bytes and is prohibited.
- This reference service is intentionally always packaged for s905x5m. It is a
  testable reference artifact, not a general application framework or a
  production telemetry schema.

## Scope

- Included: one s905x5m-only reference application binary, its Item1 contract,
  exact policy/enrollment/unit/drop-in, board-userland packaging, focused
  tests, one combined-package verification and card handoff, a coordinated
  inactive-eMMC-B slot-content operation, and the listed hardware MQTT
  evidence.
- Excluded: bridge protocol changes, mosd management API changes, broker ACL or
  TLS work, new global D-Bus policy, global `com.mos` ownership grants, eMMC
  boot-area/`bootloader_a` writes, uncoordinated p8 writes, GUID changes,
  remote pushes, runtime enrollment mounts, and a general application SDK.

## Alternatives

- Use `com.mos.sensor.example`: rejected because `sensor` is a plausible
  product class and the sample could later collide with a real application.
  `com.mos.mqttsample.reference` makes its non-production role explicit while
  still exercising the real name grammar.
- Grant the service to root: rejected because root already holds management
  authority and would not demonstrate a minimally privileged application.
  The existing unprivileged `mos` account plus an exact ownership policy is
  sufficient and adds no global account-management change.
- Add the files through a rootfs stage or bind mount: rejected because the
  requested product path is board userland packaging and the latter would
  evaporate at reboot without proving immutable enrollment.
- Add a new central mqttd policy or an `own_prefix` rule: rejected because it
  would undermine package-owned, exact-name admission and violate the bus
  design.
- Install a board-side MQTT client: rejected because the production image has
  none and modifying it would not be an image-proof path. The SSH-forwarded,
  digest-recorded client is reproducible without altering the board.
- Build a separate MQTT SD image: rejected because the campaign uses one
  HDMI+MQTT package and the board has no SD card.
- Invoke the generated installer card's automatic full burn: rejected for this
  campaign because `erase_bootloader = 1` reaches the eMMC boot area. The card
  is a parameterized package consumer and verification artifact, not authority
  to override the bootloader-write prohibition.

## Annotations

- 2026-09-10: Superseded by
  `20260910-0559-s905x5m-current-system`; current-image physical ownership is
  unresolved in the campaign record and no historical raw-slot procedure may run.
- Created for Phase 1 investigation on 2026-08-31.
- Phase 1 findings and this Phase 2 proposal were completed on 2026-08-31.
  Awaiting explicit approval before implementation.
- Approved on 2026-08-31. The implementation must classify the three observed
  bridge behaviors before the reference service relies on them: initial
  snapshots without notifications, mode-specific subscription filters, and
  heartbeat/completion payloads. Each must be documented as intended behavior
  or retained as an explicit finding rather than being absorbed silently.
- Classification completed on 2026-08-31: all three are intended behavior and
  were documentation omissions, not divergences. `bus.md` now specifies the
  snapshot/closed-window mirror semantics, exact read-only/full subscription
  filters, and heartbeat/completion JSON payloads. No reference behavior
  relies on an undocumented observation and no separate finding remains.
- Implementation was committed locally as
  `28f7845a4df7da5395d0c3b7446aeb44f0b29912`, followed by verifier-only
  correction `7ab7eff08aef933a6249fd0146190d80a715ba62`. A clean immutable
  source snapshot built the SD image with SHA-256
  `d1c4e21973beaa05373f3aa1c44908abf14c80e25827730649371ff39e544d61`;
  final image verification passed 380/380 checks with 9 named expected
  skips. The artifacts and the precomputed SD-B slice hashes are recorded in
  RFCT-932.
- The final hardware phase is waiting for renewed board connectivity. No
  partition, cfgload bridge, bootloader, eMMC area, slot state, broker state,
  or persistent MQTT-mode state has been modified. A new device-identity and
  active-slot preflight is mandatory when access returns; prior SD identity
  observations must not be reused as a write selector.
- Campaign coordination was revised by the owner on 2026-09-01. The board is
  reachable at `192.168.27.56` and is eMMC-only, so all prior SD deployment
  instructions are superseded. HDMI commit `eae91169` assigns RFCT-932 as the
  sole HDMI+MQTT complete-package builder; `ccql8vgp` consumes that package in
  the parameterized card builder; RFCT-934 retains exclusive ownership of p8
  until the single B-slot source and write order are agreed. RFCT-932 will not
  build a second artifact or write p8. The existing card's bootloader-erasing
  burn path is recorded as a constraint conflict rather than silently used.
- The single combined package completed on 2026-09-01 from source snapshot
  `0c9deaf6c75b43beb47c0d335757a7f42bb55dbb`. Its sealed artifact is
  `/backup/mos-artifacts/rfct-292-combined-0c9deaf6/update.img` (1,369,400,096
  bytes; SHA-256
  `1c09ad372ee33e2c2c5efc1bc4f1634481894c846ff493df19e363d10fd594e7`).
  Rootfs smoke passed 13/13, package round-trips passed 18/18, and final
  `make os-verify-s905x5m-sd-v2` passed 380/380 checks with nine named expected
  U-Boot skips. Artifact and image checksums verified. Extraction proved the
  factory `rootfs-b.PARTITION` is all zeroes; project-pinned dm-verity
  verification proved `rootfs-a.PARTITION` matches the B boot environment.
  No card burn or board mutation occurred. RFCT-934 and the owner must select
  the one B source before any slot-content operation.
- The owner then selected RFCT-934's current active-p7 clone as the one B
  source for its separately approved current-image watchdog run. It explicitly
  excludes the combined package's all-zero rootfs B and its rootfs A payload
  from that p8 operation. RFCT-932 remains a non-writer for p8; this does not
  constitute a combined-image deployment or MQTT hardware proof.
