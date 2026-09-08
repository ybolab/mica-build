# RFCT-934 Prove the s905x5m A/B watchdog and rollback on hardware

- **status**: blocked
- **priority**: P1
- **owner**: plan-910-m5-hardware
- **createdAt**: 2026-08-31 20:54 UTC
- **plan**: [PLAN-910](../plan/PLAN-910.md) M5

## Description

Establish hardware evidence for the s905x5m production RAUC/U-Boot A/B
watchdog: a pre-boot credit decrement must persist, repeated unconfirmed boots
must fail over to the other slot, and a successful `mos-health` run must refill
the booted slot's credits. Record the recovery position before any deliberate
failure, do not write an eMMC boot area or `bootloader_a`, and do not interfere
with the parallel production HDMI work.

The M5 power-cut acceptance remains separate from a simulated test. The owner
has confirmed that the required controllable-power hardware is unavailable, so
this task must record that acceptance as open and must not simulate or
substitute for a rig run.

## Acceptance

- A bootable recovery position for slot B is verified and recorded before any
  deliberate failure consumes slot A credits.
- Hardware observations show the scenario-1 sequence A: `3 -> 2 -> 1 -> 0`,
  then B: `3 -> 2`, with a reboot boundary between every observation and no
  health-gate refill during the failing cycles.
- A healthy boot that completes `mos-health` refills its active slot to `3`.
- Any attempted scenario-2 or scenario-3 test is documented with its exact
  containment and result; unattempted cases state why they were unsafe.
- The power-cut acceptance remains explicitly open and records the unavailable
  equipment and the required future rig; no simulation is described as a rig
  run or counted as evidence.

## ActiveForm

The approved current-eMMC watchdog proof, B failover/refill, and scenario 2
are complete. This task is blocked only on the unrun M5 power-cut rig: the
owner has no controllable-power hardware, and no substitute is authorized.

## Dependencies

- **completed hardware scope**: current-eMMC p7-to-p8 recovery construction,
  reversible p5/p6 health-gate inhibition, controlled SSH reboots, scenario
  1, B refill, recovery to A=3/B=3, and scenario 2
- **blocked for M5 completion**: a power-cut rig: no remotely controllable DC
  relay/PDU is available; USB recovery availability is also unconfirmed
- **blocks**: PLAN-910 M5 hardware acceptance

## Investigation

- The 20:51 UTC foundation observations supplied with this task are accepted as
  the starting point and were not repeated. A read-only board inspection was
  limited to the four slot partitions. `BOOT-A` and `BOOT-B` are 64 MiB VFAT
  partitions at p5 and p6; `ROOTFS-A` and `ROOTFS-B` are 256 MiB partitions at
  p7 and p8.
- `ROOTFS-B` is entirely zero-filled. It is therefore not a recovery slot,
  regardless of the slot-status metadata. `BOOT-B` contains the required
  kernel, DTB, `boot.scr`, and `mos-verity-b.env`; its verity declaration
  points at p8 and carries the same root hash as A. Copying the raw p7 payload
  to p8 can consequently create a B boot path without writing an eMMC boot
  area, `bootloader_a`, or a full package.
- The current p5/p6 `boot.scr` files are byte-identical (SHA-256
  `89e4d345a808ddc31dc959e92d031d9b60d25fb49fbbdb409eafd8406f0898f5`).
  The two verity environment files differ only in their slot binding: p5
  references PARTUUID `...0005`, p6 references `...0006`.
- On the build host,
  `/backup/mos-artifacts/rfct-290-a5919d3/update.img` exists, is
  1,369,400,096 bytes, and its checked sidecar verifies SHA-256
  `c2955b05d8d85e04bd6109ec042c0755685992923c085c388b20b0aa8c538bec`.
  It is a full USB-burning recovery artifact, not a permitted way for this
  task to populate B because it also writes the bootloader.
- The running root and `/etc/systemd/system` are read-only, so a persistent
  `systemctl mask` cannot safely survive a reboot. A reversible test-only
  kernel argument can instead be appended to each slot's own
  `mos-verity-<slot>.env`: `systemd.mask=mos-health.service`. The production
  script imports that value into `bootargs`; restoring the exact saved VFAT
  file removes the inhibition.

## Owner decision: power-cut rig blocked

On 2026-09-01 the owner confirmed that no remotely controllable relay or PDU
is available. The power-cut rig will not be run, and neither a simulated cut
nor an ordinary SSH reboot substitutes for it. PLAN-910 M5 acceptance criterion
6 remains **open**, and the board is **not supported** under PLAN-910 §7 step
6.

The redundant `uenv-a`/`uenv-b` pair is designed to survive interruption of
the pre-boot `saveenv` which persists the attempt decrement. That claim remains
asserted by the boot design and sandbox harness but unproven on this hardware.
If revisited, the rig needs a suitably rated remotely controlled DC relay or
PDU, continuous USB-UART capture, a control host which timestamps and restores
power, and at least 50 randomized cuts landing in the `saveenv` window. The
run also needs a physical recovery host, cable, and operator.

## Approved coordinated execution

The 2026-09-01 owner instruction replaces independent package/flash attempts
with one artifact and one board flash. The PLAN-910 M3 handoff assigns
`RFCT-932` (the MQTT owner) as the sole combined-package builder: after
`8yaodbbi` lands the HDMI `boot.cmd` change and its three
post-`olddefconfig` built-`.config` assertions, RFCT-932 will build exactly
one package on `192.168.27.200` from the commit that also contains
`com.mos.mqttsample.reference`. No other worker builds a package for this
hardware pass. The final artifact path and SHA-256 must be recorded here
before it is flashed. The owner has separately approved this task's watchdog
test against the current eMMC image; it does not wait for that later flash.

`ccql8vgp` will pass that exact combined package, rather than a separately
built image, to the parameterized eMMC card builder. The owner will flash the
board once from the combined package. `zut3l32o` will collect the MQTT
end-to-end evidence from the flashed active A slot and will not write p6 or
p8. HDMI and MQTT evidence are collected while A is healthy, before this task
inhibits the health gate.

This task owns the current B recovery construction: inspect p6's B boot payload
and copy the active p7 A rootfs to p8, followed by `sync` and a full
byte-for-byte comparison. The RFCT-932 B-slot interlock was re-read before this
approval: it will not write p8 or prepare a competing raw payload. No operation
in this task targets `/dev/mmcblk1*`: the board endpoint is `192.168.27.56` and
it has no SD card installed.

The owner selected the current p7 clone as the one B source for this hardware
test. The combined package's `rootfs-b.PARTITION` is zero-filled and is not a
candidate; RFCT-934 will not apply it or the package-derived rootfs-A payload
to p8 during this run.

Every future execution log entry will state the board endpoint, the absence of
an SD target, the combined artifact identity, and the planned reboot or slot
change before it occurs. This task continues to exclude eMMC boot areas and
`bootloader_a`.

## Proposal

1. Before the first deliberate failure, record that USB recovery availability
   is unconfirmed and B will be the only fallback. Re-read the current active
   rootfs and p6 B verity declaration, then copy p7 to p8, `sync`, and compare
   all bytes. The copy changes only inactive rootfs-slot contents; it does not
   write an eMMC boot area or `bootloader_a`.
2. Save each original slot verity environment as a temporary file in its own
   otherwise-unused boot VFAT, append the one test-only `systemd.mask` argument
   to both active filenames, sync, and verify the saved and modified hashes.
   No boot script, bootloader, environment partition, or SD medium is changed.
3. Starting from the supplied `A=3, B=3` state, perform and log four ordinary
   reboots, waiting for SSH and reading `fw_printenv` after each: A `2/3`, A
   `1/3`, A `0/3`, then B `0/2`. The mask keeps the health gate from refilling
   either counter while the watchdog sequence is observed.
4. While running B, restore its original verity environment and reboot. The
   boot decrement must briefly make B `1`, after which a completed
   `mos-health`/`rauc status mark-good` run must leave B at `3`. Restore A's
   original file, reset its test-depleted credit only after recording it, and
   make one final healthy A boot so both slots end at `3`.
5. Attempt scenario 2 only after that recovery position is proven: temporarily
   hide A's suffixed verity environment while retaining an exact backup. The
   script should persist A's first decrement, zero A when the file is missing,
   reset, and select B. Restore the file and return to a healthy A boot.
6. Do not attempt scenario 3. A deliberately malformed A kernel may make
   `booti` return, hang, or reset before the script can burn the credit. Serial
   capture is available, but no switched-power rig or confirmed USB recovery
   exists; it is explicitly out of scope.

## Risks

- The only presently bootable rootfs is A. A p7/p8 copy or VFAT edit must be
  addressed by exact partition path and read back before a reboot.
- USB recovery is unconfirmed. After the p7-to-p8 comparison, B is the sole
  fallback; any preflight mismatch or unexpected reboot result stops the test.
- This task will not modify source `boot.cmd` or flash any package. RFCT-932's
  recorded p8 interlock prevents a competing B write during the test.
- No controllable relay/PDU exists. A power cut can strand an intentionally bad
  `booti` experiment, so scenario 3 remains out of scope and M5's rig criterion
  remains open.

## Scope

- Board reads, p5/p6/p7/p8 slot-content operations after approval, U-Boot
  counter observations through the existing Linux tools, reboot logs, and
  PLAN-910/RFCT-934 records.
- Excludes eMMC boot areas, `bootloader_a`, the full USB package write,
  bootloader changes, SD-card writes, source `boot.cmd` changes, and pushes.

## Alternatives

- A normal RAUC install would be preferable to a raw p7-to-p8 clone, but the
  current generic U-Boot bundle producer hard-codes the cx3576 DTB name and is
  not a safe s905x5m B-slot producer. Extending it is separate implementation
  work, not a prerequisite to this bounded proof.
- A runtime stop or `--runtime` mask of `mos-health` is rejected because it is
  lost on reboot. Editing the read-only root is rejected because it is not a
  slot-content operation and cannot be cleanly reversed.
- The owner explicitly accepted B as the only fallback for the bounded
  scenario-1 test after it is copied and compared. If that construction does
  not verify exactly, no deliberate counter-exhaustion test will run.

## Result — hardware watchdog proof (2026-09-01)

All authorized non-power-cut hardware work passed on `192.168.27.56`; no eMMC
boot area or `bootloader_a` was written.

- Before any deliberate failure, exactly 268,435,456 bytes were copied from
  p7 to p8, synced, and fully compared. Both raw rootfs partitions SHA-256 to
  `959e55a84de76173060b406ec49e45dd1624aed50aab8c67ac99534b1f541c14`.
  During B failover, dm-0's only slave was `mmcblk0p8`, proving that the clone
  was an actual B boot rather than only a byte comparison.
- With the reversible health mask in both slot verity environments, the real
  board followed scenario 1 exactly: A=2/B=3, A=1/B=3, A=0/B=3, then B=0/B=2.
  The serial record contains `Saving Environment to MMC` before each boot
  decision and the corresponding U-Boot slot messages. Independent 02:30 UTC
  confirmation recorded `BOOT_A_LEFT=0`, `rauc.slot=B`, dm-0 over
  `mmcblk0p8`, `rootfs.0` (A) with boot status `bad`, and `rootfs.1` (B) with
  boot status `good`, booted. The failover therefore marked A bad rather than
  merely skipping it.
- B's final value of 3 is explicitly a post-health refill, not evidence that
  B was never decremented. On the restored healthy B path after A failed,
  U-Boot recorded B=2 before Linux completed the health gate; `mos-health`
  then logged `PENDING_CONFIRM -> CONFIRMED` and `booted slot B marked good`,
  while RAUC logged `Marked slot rootfs.1 as good`; only after that transition
  did the persisted counter read A=0/B=3. The independently confirmed
  B=2-to-B=3 sequence therefore proves decrement followed by mark-good refill.
  The separate restored-B reboot after scenario 1 also consumed B=1 before
  the same refill, providing a second per-reboot confirmation.
- Scenario 2 was safely attempted after that fallback was restored. Hiding
  only A's suffixed verity environment produced A=2/B=3, the U-Boot
  missing-env diagnostic, a persisted A=0 burn and reset, then B=0/B=2. B
  subsequently marked good and refilled to 3. The exact A file was restored.
- Scenario 3 was intentionally not attempted. A malformed-kernel/returning
  `booti` experiment requires switched power to advance a hung board, and USB
  recovery remains unconfirmed.
- Final recovery is healthy A with `BOOT_ORDER=A B`, A=3, B=3, zero failed
  units, byte-identical p7/p8, and both active verity environments restored to
  their original hashes with no health mask. The raw continuous UART capture
  is archived at
  `/backup/mos-artifacts/rfct-294-watchdog-20260901T0220Z/serial.log` on the
  build host (1,135,798 bytes; SHA-256
  `f03851a304fedfd12c1b82065c12d15b3f460efdb38404a7643a2397d5ad451e`).

M5 criterion 6 remains **open / blocked**, not passed or waived. The redundant
uenv pair's survival across a cut during `saveenv` is still asserted only by
the design and sandbox harness, not proven on this board. PLAN-910 must
therefore continue to call the board **not supported** until the owner supplies
the required physical power-cut rig.

## Notes

- Claimed for Phase 1 investigation on 2026-08-31. No reboot, slot-content
  change, eMMC boot-area write, `bootloader_a` write, or board flash has been
  performed by this task.
- The user-established 20:51 UTC handshake-foundation observations are input
  facts for this task and will not be redundantly re-established.
- Read-only hardware and build-host recovery-artifact investigation completed
  on 2026-08-31. The owner approved the coordinated implementation sequence on
  2026-09-01; no deliberate failure or slot-content write has been performed.
- 2026-09-01 coordination record: under the PLAN-910 M3 handoff, RFCT-932 is
  the sole combined-package builder after `8yaodbbi` lands the HDMI source and
  built-config checks; `ccql8vgp` consumes that artifact for the card image,
  and this task alone performs the post-flash p7-to-p8 recovery clone. No
  build, flash, reboot, or slot change has been performed by this task under
  that sequence.
- 2026-09-01: HDMI source commit
  `eae91169c4f5efea3ddd709dbed167b48a1f0b3b` completed its isolated build-host
  U-Boot verification, including the three required final-built-config HDMI
  assertions. The combined package and owner flash remain pending; this task
  has not rebooted the board or changed a slot.
- 2026-09-01 02:16 UTC pre-write log: owner approved the current-eMMC watchdog
  test. Target `192.168.27.56` has no SD target. Planned first slot change is
  only `/dev/mmcblk0p7` to `/dev/mmcblk0p8`, followed by `sync` and a complete
  byte comparison; eMMC boot areas and `bootloader_a` are excluded. USB
  recovery availability is unconfirmed. The current RFCT-932 interlock assigns
  p8 construction exclusively to this task.
- 2026-09-01 02:16 UTC source-selection log: the owner selected the active
  p7-to-p8 clone as the single B construction. The sealed combined package's
  `rootfs-b.PARTITION` is zero-filled, and neither it nor a competing
  package-derived rootfs payload will be written to p8 in this test.
- 2026-09-01 02:18 UTC preflight completed before the first slot change:
  `imos` root is `/dev/dm-0` with only `mmcblk0p7` as its DM slave; p5/p6/p7/p8
  are the expected 64/64/256/256 MiB paths; p8 is unmounted and all zeroes;
  p7/p8 sizes match; and the start counters are `BOOT_ORDER=A B`, A=3, B=3.
  p5/p6 `boot.scr` hashes match, while B's verity env addresses p8 and shares
  A's root hash. Serial host `192.168.27.50` reports `/dev/ttyUSB0` free and
  configured for 921600 8N1. The next operation is only
  `/dev/mmcblk0p7` to `/dev/mmcblk0p8`, then `sync` and a full `cmp`; it does
  not target an eMMC boot area or `bootloader_a`.
- 2026-09-01 02:20 UTC slot-B construction completed: copied exactly
  268,435,456 bytes from `/dev/mmcblk0p7` to `/dev/mmcblk0p8` with
  `conv=fsync`, ran `sync`, and completed a full byte-for-byte `cmp`. Both raw
  devices SHA-256 to
  `959e55a84de76173060b406ec49e45dd1624aed50aab8c67ac99534b1f541c14`.
  No eMMC boot area or `bootloader_a` was targeted. The next planned slot
  change is a reversible p5/p6 verity-env backup and
  `systemd.mask=mos-health.service` injection; no reboot has occurred yet.
- 2026-09-01 02:20 UTC health-gate inhibition completed before the first test
  reboot. On p5, exact original backup
  `rfct294-mos-verity-a.env.orig` SHA-256 is
  `c3297296510deaccb7884a9805ee47e5265ca670b5a4774978f7b03e7730c4b4`;
  masked `mos-verity-a.env` is
  `721de618cc1a593fe728c2d043f4b2bca34a78946da6047f34849f5e7a09576c`.
  On p6, exact original backup
  `rfct294-mos-verity-b.env.orig` SHA-256 is
  `4b8731333be410c6cb4a2ce53b6f73103e3db1c107fe219b8d2bec936ca2be60`;
  masked `mos-verity-b.env` is
  `8bbc4191021743a965dfdcd649aed6f6a06081ae681fccc6936451bf7a2ce79c`.
  Both masked values contain exactly one `systemd.mask=mos-health.service`.
  The next planned reboot is cycle 1 on `192.168.27.56`, expecting A=2/B=3;
  no eMMC boot area or `bootloader_a` operation is planned.
- 2026-09-01 02:21 UTC pre-reboot verification: remounted both boot filesystems
  read-only and rechecked every original and masked SHA-256 above, one mask per
  active env, and unchanged start counters A=3/B=3. Continuous serial capture
  is running from `192.168.27.50:/dev/ttyUSB0` at 921600 8N1 into local
  `/tmp/rfct294-serial-20260901T0220Z.log`. **Next operation: cycle 1 SSH
  reboot of `192.168.27.56`; expected post-boot counters A=2/B=3. No eMMC boot
  area or `bootloader_a` operation is planned.**
- 2026-09-01 02:22 UTC cycle 1 observed: the board returned over SSH with
  `rauc.slot=A`, `systemd.mask=mos-health.service` on its command line, and
  `mos-health.service` `LoadState=masked`, `ActiveState=inactive`. Persisted
  counters are A=2/B=3, exactly as expected. Serial capture checkpoint
  `/tmp/rfct294-serial-20260901T0220Z.log` is 140,246 bytes with SHA-256
  `8a488b01d87b58d589a6eb3bfcef7c060c506a9a4b426441f567f59e1d4b0b96`.
  **Next operation: cycle 2 SSH reboot of `192.168.27.56`; expected post-boot
  counters A=1/B=3. No eMMC boot area or `bootloader_a` operation is planned.**
- 2026-09-01 02:23 UTC cycle 2 observed: the board returned with uptime 28.62
  seconds, `rauc.slot=A`, the mask on its command line, and `mos-health`
  masked/inactive. Persisted counters are A=1/B=3, exactly as expected. The
  continuous serial log records `Saving Environment to MMC` followed by
  `mos: booting slot A (A=1 B=3 left)`, showing the pre-boot persisted
  decrement. Its checkpoint is 279,790 bytes with SHA-256
  `4bc8a23b3f5a5f33521c42c7aea0cf08e42f9e078ad75fb9857bfdd37ac14fd3`.
  **Next operation: cycle 3 SSH reboot of `192.168.27.56`; expected post-boot
  counters A=0/B=3. No eMMC boot area or `bootloader_a` operation is planned.**
- 2026-09-01 02:26 UTC cycle 3 observed: the board returned with uptime 44.34
  seconds, `rauc.slot=A`, the health mask on its command line, and `mos-health`
  masked/inactive. Persisted counters are A=0/B=3, exactly as expected. Serial
  records `Saving Environment to MMC` then
  `mos: booting slot A (A=0 B=3 left)`; its checkpoint is 419,799 bytes with
  SHA-256 `abfd64db60a635206e3cf1e3922523bad452ce75c6e59af1e3e4640d5b877049`.
- 2026-09-01 02:26 UTC B pre-boot check passed before the failover reboot:
  another complete p7/p8 comparison matched; p6 retains its exact B original
  backup and the single masked B env (SHA-256
  `4b8731333be410c6cb4a2ce53b6f73103e3db1c107fe219b8d2bec936ca2be60` and
  `8bbc4191021743a965dfdcd649aed6f6a06081ae681fccc6936451bf7a2ce79c`),
  which points only at p8. **Next operation: cycle 4 SSH reboot of
  `192.168.27.56`; expected post-boot slot B and counters A=0/B=2. No eMMC
  boot area or `bootloader_a` operation is planned.**
- 2026-09-01 02:27 UTC cycle 4 observed: the board returned with uptime 18.69
  seconds, `rauc.slot=B`, the health mask on its command line, and `mos-health`
  masked/inactive. Persisted counters are A=0/B=2, exactly as expected. The
  active dm-0 now has only `mmcblk0p8` as its slave, proving that the cloned B
  rootfs actually booted. Serial records `Saving Environment to MMC` then
  `mos: booting slot B (A=0 B=2 left)`; its checkpoint is 560,036 bytes with
  SHA-256 `20ce284a1615d5cc71e35179c18a3c4b41994c5bd8631c8ac4993d94ba96036a`.
  This completes scenario 1's required A `2/3 -> 1/3 -> 0/3`, then B `0/2`
  hardware trajectory.
- 2026-09-01 02:27 UTC B restore preflight: p6 retains exact original B env
  backup SHA-256 `4b8731333be410c6cb4a2ce53b6f73103e3db1c107fe219b8d2bec936ca2be60`
  and masked active SHA-256
  `8bbc4191021743a965dfdcd649aed6f6a06081ae681fccc6936451bf7a2ce79c`.
  **Next slot change: replace p6's active B env with that exact backup, `sync`,
  and read back its hash; no eMMC boot area or `bootloader_a` operation is
  planned. The following reboot is expected to pre-decrement B to 1 and let
  `mos-health` refill B to 3.**
- 2026-09-01 02:28 UTC B env restore completed: p6's active
  `mos-verity-b.env` now byte-matches its retained exact backup, both SHA-256
  `4b8731333be410c6cb4a2ce53b6f73103e3db1c107fe219b8d2bec936ca2be60`, and
  no longer contains the health mask. **Next operation: SSH reboot of the B
  slot on `192.168.27.56`; the pre-boot decrement should be B=1, after which a
  successful `mos-health` run must refill B=3. No eMMC boot area or
  `bootloader_a` operation is planned.**
- 2026-09-01 02:30 UTC B refill observed: after the B pre-boot decrement to
  1, `mos-health.service` ran successfully (PID 701, exit status 0), probed
  systemd/mosd/apid, and invoked RAUC, which logged `Marked slot rootfs.1 as
  good`. Its own log records `booted slot B marked good`, and persisted
  counters are A=0/B=3. This proves healthy B refill.
- 2026-09-01 02:30 UTC recovery plan before further changes: restore p5's
  exact A env from retained backup, verify its original SHA-256, then set only
  `BOOT_A_LEFT=3` while preserving `BOOT_ORDER=A B`. **Next reboot will be a
  healthy A boot: pre-boot A becomes 2 and `mos-health` must refill A=3, leaving
  A=3/B=3. No eMMC boot area or `bootloader_a` operation is planned.**
- 2026-09-01 02:31 UTC A env restore completed: p5's active
  `mos-verity-a.env` now byte-matches its retained exact backup, both SHA-256
  `c3297296510deaccb7884a9805ee47e5265ca670b5a4774978f7b03e7730c4b4`, and
  no longer contains the health mask. **Next operation: update only
  `BOOT_A_LEFT` from 0 to 3 through the existing redundant U-Boot environment,
  retaining `BOOT_ORDER=A B`; no eMMC boot area or `bootloader_a` operation is
  planned.**
- 2026-09-01 02:31 UTC environment recovery completed: the existing redundant
  U-Boot environment writer changed only `BOOT_A_LEFT` 0 to 3; it read back
  `BOOT_ORDER=A B`, A=3, B=3. **Next operation: healthy A SSH reboot of
  `192.168.27.56`; U-Boot should pre-decrement A to 2 and the restored
  `mos-health` gate must refill A=3. No eMMC boot area or `bootloader_a`
  operation is planned.**
- 2026-09-01 02:32 UTC healthy A recovery observed: the serial log records
  U-Boot `mos: booting slot A (A=2 B=3 left)` with no health mask in the kernel
  command line. At 02:32:44 `mos-health` probed systemd/mosd/apid, marked A
  good, and persisted A=3/B=3. This leaves both proven slots healthy after
  scenario 1 and B refill.
- 2026-09-01 02:34 UTC scenario-2 preflight: A is active with A=3/B=3;
  `/boot` is the existing rw p5 automount (underlying `/dev/mmcblk0p5`), so it
  will not be remounted. Its active suffixed A env and retained backup both
  SHA-256 to
  `c3297296510deaccb7884a9805ee47e5265ca670b5a4774978f7b03e7730c4b4`.
  There is no unsuffixed `mos-verity.env` fallback and no prior scenario-2
  hidden file. **Next slot change: rename only `/boot/mos-verity-a.env` to
  `/boot/rfct294-mos-verity-a.env.s2-hidden`, retain the exact backup, `sync`,
  and verify both verity load names are absent. The following reboot should
  burn A to zero, reset, and boot healthy B. No eMMC boot area or
  `bootloader_a` operation is planned.**
- 2026-09-01 02:34 UTC scenario-2 setup completed: only
  `/boot/mos-verity-a.env` was renamed to
  `/boot/rfct294-mos-verity-a.env.s2-hidden`; `sync` completed and hidden file
  byte-matches the retained original backup at SHA-256
  `c3297296510deaccb7884a9805ee47e5265ca670b5a4774978f7b03e7730c4b4`.
  Both `mos-verity-a.env` and `mos-verity.env` are absent. **Next operation:
  one SSH reboot of `192.168.27.56`; expected U-Boot behavior is A 3->2,
  missing-env burn A=0 and reset, then B 3->2 boot. No eMMC boot area or
  `bootloader_a` operation is planned.**
- 2026-09-01 02:36 UTC scenario 2 observed: serial records U-Boot booting A
  with A=2/B=3, then `mos: slot A has no mos-verity-a.env`, a persisted burn
  to A=0 and reset, followed by B boot with A=0/B=2. B returned over SSH and
  its restored health gate marked it good at 02:36:49, returning B to 3.
  Current counters are A=0/B=3. Serial checkpoint is 995,613 bytes with
  SHA-256 `2dc90a07765f098ea737531116a71441dc3bb5116acb8bb54ae13f8797fc6a84`.
  This proves the missing suffixed-verification-file burn and B failover on
  hardware.
- 2026-09-01 02:37 UTC scenario-2 restore preflight: p5's active filename is
  absent, while the hidden file and independent original backup byte-match at
  SHA-256 `c3297296510deaccb7884a9805ee47e5265ca670b5a4774978f7b03e7730c4b4`.
  **Next slot change: restore only the suffixed A filename on p5, `sync`, and
  verify it. Then reset only A's counter to 3 and make one healthy A reboot to
  return both slots to A=3/B=3. Scenario 3 remains unattempted because there
  is no switched-power rig or confirmed USB recovery. No eMMC boot area or
  `bootloader_a` operation is planned.**
- 2026-09-01 02:37 UTC scenario-2 A env restore completed: p5's active
  `mos-verity-a.env` is restored, the temporary hidden filename is absent, and
  the active file byte-matches the retained original backup at SHA-256
  `c3297296510deaccb7884a9805ee47e5265ca670b5a4774978f7b03e7730c4b4`.
  **Next operation: update only `BOOT_A_LEFT` from 0 to 3 through the existing
  redundant U-Boot environment, retaining `BOOT_ORDER=A B`; no eMMC boot area
  or `bootloader_a` operation is planned.**
- 2026-09-01 02:38 UTC post-scenario-2 environment recovery completed: the
  existing redundant environment writer changed only `BOOT_A_LEFT` 0 to 3 and
  read back `BOOT_ORDER=A B`, A=3, B=3. **Next operation: final healthy A SSH
  reboot of `192.168.27.56`; U-Boot should pre-decrement A to 2 and the
  restored `mos-health` gate must refill A=3, leaving A=3/B=3. No eMMC boot
  area or `bootloader_a` operation is planned.**
- 2026-09-01 02:38 UTC final A pre-boot check passed: A=3/B=3, p5's restored
  A env SHA-256 is
  `c3297296510deaccb7884a9805ee47e5265ca670b5a4774978f7b03e7730c4b4`, p6's
  restored B env SHA-256 is
  `4b8731333be410c6cb4a2ce53b6f73103e3db1c107fe219b8d2bec936ca2be60`, and
  neither carries the health mask. **Next operation remains the final healthy A
  SSH reboot of `192.168.27.56`; no eMMC boot area or `bootloader_a` operation
  is planned.**
