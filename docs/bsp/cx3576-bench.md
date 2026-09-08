# cx3576 bench qualification: the run order and the collector

The bench session that fills [cx3576-example.md](cx3576-example.md)'s
Qualification results table. Thirteen rows are `not tested` with `needs bench
hardware`, and `docs/plan/PLAN-037.md` Gate D names four further
measurements by hand. This page is the order they are taken in, what each step
assumes about the one before it, which half of each row a script can collect
and which half needs a person, and what a `pass` looks like — written before
the board arrives so that the session is executed rather than explored.

The collector is [cx3576-bench-collect.sh](cx3576-bench-collect.sh). It is
copied to the device and run there; it needs nothing from this repository.

**This page does not fill any row.** Every result cell is the bench session's
output. Nothing here may be transcribed into the dossier as evidence: a
procedure is not a measurement, and the dossier's own rule is that off-hardware
gates are noted as evidence about their own surface, never as a hardware
`pass`.

> status: proposed — evidence: `docs/plan/PLAN-037.md`

## 1. What the session has to produce

Two artefacts, and the second is the point:

1. **A run directory on the device**, holding one capture file per probe: the
   raw output of everything that was read, with its command line and its exit
   status beside it. This is what an evidence note points at.
2. **A markdown table**, printed by `cx3576-bench-collect.sh report`, whose
   rows are exactly the dossier's — `| Row | Result | Date | Evidence /
   reason |` — so the session's output is pasted into
   [cx3576-example.md](cx3576-example.md) rather than translated into it.

The collector enforces [qualification.md](qualification.md) §2's row grammar on
its own output: a result cell is exactly `pass`, `fail`, `N/A` or `not tested`,
and `pass`/`fail` carry an ISO date. A row it could not run records `not
tested` **with the reason it could not** — a missing tool, an absent operator,
an unmet assumption from an earlier stage. It has no code path that writes
`pass` from anything other than an observation it made or an answer a person
gave it.

### The binding, filled first

[qualification.md](qualification.md) §1 binds results to one combination, and
two of its four elements are unrecorded in this tree: the concrete eMMC part
and the RTC. The collector's first stage reads the eMMC CID, manufacturer and
name out of `/sys/block/mmcblk0/device/` and writes them into the run
directory. **A run whose binding block is incomplete is not a qualification
run**, because a result that names no storage part cannot be carried forward or
retired by §5's triggers.

## 2. The bench, and what is missing from it

| Need | For rows | Note |
|---|---|---|
| CX3576-Z unit, AIC8800D80 SKU | all | the AP6275S SKU is out of the dossier's scope |
| Serial console on `ttyFIQ0`, 1500000 baud | all | the assumed interface; the network is a measurement, not a given |
| Host with `rkdeveloptool` and USB to the OTG port | 13, 12 | the flash and the last-resort recovery path |
| A switched power feed the operator can cut | 4 | see §5 |
| Ethernet with a DHCPv4 server, on both ports | 6 | `eth0` and `eth1` are separately measured |
| A 2.4/5 GHz AP with known credentials | 6 | |
| A second CAN node (250 kbit/s, classic, FD off) | 7 | `can.conf` ships those values |
| A host PC for the USB gadget console | 7 | `mos-gadget` binds a CDC ACM getty |
| A USB keyboard, and a display on HDMI | measurement M3/M4 | |
| An update bundle that installs, and one that boots and fails | 3, 4 | §6 |

**The power-cut rig does not exist.** No rig is on file in this tree, and §5
specifies the cut in terms of what an operator observes on the console rather
than of an instrument, so that row 4 is runnable with a switched outlet.

> status: unsupported

## 3. The order, and what each stage assumes

Some rows are one-way. `Recovery` and the factory reset destroy the state the
earlier rows established; `A/B switch and update` has to leave the device on a
known slot before `Power-cut during update` means anything; and first-boot
evidence — repart growth, the minted credential, the provisioning document, the
`machine_id` write — exists exactly once and cannot be recovered by looking
harder later.

Run the stages in this order. Each names what it assumes, in the shape
`pkgs/mosd/tests/apid-api`'s phases use: **a stage whose assumption is unmet is
not run**, and the collector refuses it rather than producing a row.

| # | Stage | Dossier rows | Assumes |
|---|---|---|---|
| 0 | `install` | 13 | a blank or erased unit, and a chosen image profile |
| 1 | `firstboot` | 1, 5 (growth), 11 | stage 0's flash, and **no network cable attached** |
| 2 | `inventory` | M1–M4, 8 and 10 readouts | stage 1 reached a healthy system |
| 3 | `warmboot` | 2, 8 | stage 2 banked the pre-reboot clock and the RTC readout |
| 4 | `network` | 6 | stage 3 completed; cable and AP now attached |
| 5 | `fieldbus` | 7 | stage 4 completed; CAN peer and gadget host now attached |
| 6 | `thermal` | 9 | stage 5 completed; nothing else running on the unit |
| 7 | `watchdog` | 10 | stage 6 left the unit cool and idle |
| 8 | `update` | 3 | stage 7's reset was absorbed: **both boot counters back at full credit** |
| 9 | `powercut` | 4 | stage 8 left the device on a **named** slot, healthy, counters full |
| 10 | `storagefill` | 5 (fill) | stage 9 completed, and the run directory has been copied off |
| 11 | `recovery` | 12 | everything above is copied off the device; this stage destroys |

### Why that order and not another

- **13 is first because it is the only row that starts from nothing.** The
  flash is what puts the unit into the state every other row assumes, so
  running it later would mean re-running all of them. It also binds a profile
  (§3 of [qualification.md](qualification.md)), and the profile is written
  immutably into the image being written.
- **1 comes with 5's growth half and 11, because first boot happens once.**
  `systemd-repart` grows DATA on that boot; the credential and the provisioning
  document are minted on that boot; `mos-machine-id` writes `machine_id` into
  the U-Boot environment on that boot. `Offline service` is banked here for the
  same reason — it is the only moment the device is honestly offline without
  someone unplugging a cable to simulate it. Plug the cable in **after** stage 1
  reports, not before.
- **2 before everything that changes state.** The four Gate D measurements are
  read-only; taking them first means every later row is interpreted against a
  recorded starting state rather than against a remembered one.
- **3 pairs the warm boot with the RTC**, because the RTC row needs a power-off
  interval and the warm-boot row needs a reboot: two reboots, one stage,
  distinct assertions.
- **6 and 7 before the update rows.** Thermal load and a deliberate watchdog
  reset must not land on a device with an install in flight.
- **7 before 8, with an explicit gate.** A watchdog reset re-enters `boot.scr`,
  which decrements `BOOT_<slot>_LEFT` before booting; the health gate refills it
  at `mark-good`. Stage 8 refuses to start until `fw_printenv` shows both
  counters at the configured `boot-attempts`, because an A/B test begun on a
  partly-spent counter measures a different thing than the one row 3 claims.
- **9 after 8, on a named slot.** Row 4's claim is that an interrupted install
  leaves *the previous slot* bootable and the order unflipped. "The previous
  slot" is only a fact if the current one was recorded first.
- **10 late, because the fill test fills the filesystem the run directory lives
  on.** The collector reserves headroom and stops short, but the copy-off is
  the real protection.
- **11 last, and irreversible.** Row 12 walks
  [../user/recovery.md](../user/recovery.md)'s ordering: read-only diagnosis,
  guarded rollback, configuration reset, application-data reset, then the two
  rungs this board **refuses** — credential recovery and the full factory reset,
  because `BOARD_RECOVERY_ACTIONS` is empty — and finally the reflash. Each rung
  destroys more than the last, so the order inside the stage is the order in
  that document and nothing may be run out of it.

## 4. The stages, row by row

Each row below states what the collector does unattended, what it stops and
asks a person to do, and the criterion. **The human steps are not optional and
the collector does not skip them silently**: it prints the instruction, waits,
and records the operator's verdict and free-text observation. With no terminal
on stdin it records `not tested — no operator present`, never a pass.

### Stage 0 — `install` (row 13, Installation and first boot)

- **Human.** Erase the eMMC and flash over rockusb per
  [../user/install.md](../user/install.md) §5, from the host, at a named
  profile (`dev` or `prod`). Record which profile: the row binds one, and a
  board claiming both runs the row twice or says which is unproven.
- **Scriptable.** Nothing on the device — there is no device yet. The collector
  is run **after** first boot, in stage 1, and back-fills row 13 from what
  stage 1 observed plus the operator's answers about the flash itself.
- **Pass.** `rkdeveloptool` completed without error against a blank unit; the
  unit powered on unattended and reached the state the procedure claims — not
  merely that it powered on. Stage 1's own evidence is what proves the second
  half.

### Stage 1 — `firstboot` (rows 1, 5-growth, 11)

- **Human.** Power on cold, from fully unpowered, with **no Ethernet cable
  attached**. Watch the console. Answer the collector's questions about the
  boot: did the console reach a login prompt, did the status LED go blue.
- **Scriptable.** `systemctl is-system-running`; `systemctl
  list-units --failed`; `journalctl -b -p warning`; `rauc status
  --output-format=shell`; `fw_printenv` (`BOOT_ORDER`, both counters,
  `machine_id`); `findmnt /` and `/mnt/data`; `df` on every tier; the DATA
  partition's size against the disk's; `/sys/block/mmcblk0/device/{cid,name,
  manfid,life_time,pre_eol_info}`; the provisioning record and the claim state.
- **Pass — row 1 (Cold boot).** The health gate green — `mos-health` ran and
  reached `rauc status mark-good` — with no failed units, **repeatably**:
  §4 of [qualification.md](qualification.md) requires the cycle count, and the
  collector runs the cold cycle **five** times, asking for a power cycle
  between each and re-reading the same probe set. Five identical greens is the
  row; four greens and one degraded boot is a `fail` with the failing boot's
  journal as the evidence.
- **Pass — row 5, growth half.** DATA grew to fill the medium on the first
  boot and the loader partition is intact (`sgdisk`-visible entry at sector 64,
  and the unit still boots). The rest of row 5 completes at stage 10.
- **Pass — row 11 (Offline service).** With no cable: the device has a
  hostname derived from its identity, a minted credential, a provisioning
  document on the medium, apid listening, and a configuration change made and
  read back through the API — all without a network. Per
  [../design/provisioning.md](../design/provisioning.md) §2 this is Layer 1's
  whole claim, and this is the only stage that can test it honestly.

### Stage 2 — `inventory` (the Gate D measurements; rows 8 and 10 readouts)

Entirely scriptable, entirely read-only. Four measurements Gate D names by
hand, plus the two readouts that later stages act on.

**M1 — the `eth1` DHCPv4 lease defect.** `networkctl list`; `networkctl status`
for every interface; `ip -d link show` per interface (driver, `addr_assign_type`,
MAC); `journalctl -u systemd-networkd -b`; the shipped `80-dhcp.network`
(`[Match] Name=eth*`, `[Network] DHCP=yes`) and anything mosd rendered into
`/run/systemd/network`. The defect is *characterised here and fixed nowhere*:
the output the session needs is which interface got a lease, which did not,
what networkd said about the one that did not, and what MAC `mos-mac` gave it.
With no cable attached this stage records the interface set and the driver
binding only; the lease half is taken at stage 4 and the row is not closed
until then.

**M2 — whether a watchdog device exists at all.** `ls /dev/watchdog*`;
`ls /sys/class/watchdog/`; the contents of every attribute under each
`watchdogN/`; `dmesg | grep -iE 'watchdog|wdt|dw_wdt'`.

The board DTS sets `/watchdog@2ace0000` to `okay` and the kernel config carries
`CONFIG_DW_WATCHDOG=y`, `CONFIG_WATCHDOG_CORE=y` and
`CONFIG_WATCHDOG_HANDLE_BOOT_ENABLED=y`, so a `/dev/watchdog0` is *expected*.
Two things about that expectation are worth taking to the bench rather than
assuming:

- `# CONFIG_WATCHDOG_SYSFS is not set`. The watchdog core creates the class
  directory either way, but the attribute files — `bootstatus`, `state`,
  `timeout`, `identity`, `nowayout` — are gated on that symbol. If they are
  absent, **row 10's "the reset cause is readable afterwards" half has no sysfs
  source on this kernel**, and the session records that as the finding it is
  rather than as a failed read. The collector reads them when present and
  records their absence explicitly.
- `# CONFIG_WATCHDOG_NOWAYOUT is not set`, so closing `/dev/watchdog` with a
  magic `V` disarms it. That is what makes stage 7 safe to arm and safe to
  abort.

**M3 — which UART drives the display.** The dossier records the display as
HDMI, and no UART drives an HDMI output; the phrasing in Gate D therefore
resolves, on this board, to a question about the serial port map. The DTS
enables seven UARTs and names only three of them — `uart1` and `uart6` are
RS-485, `uart4` is the Bluetooth HCI — leaving `uart3`, `uart8`, `uart9` and
`uart11` unaccounted for, on a board whose console is `ttyFIQ0`.

- **Scriptable.** For every `/sys/class/tty/ttyS*`: the `of_node` symlink
  (which resolves to the device-tree node and therefore to the register
  address and the UART index), `device/driver`, and the port's `type`;
  plus `/proc/tty/driver/serial` where it exists. That is the complete
  `ttySn` ↔ `uartN` ↔ register-address map, taken from the running kernel.
- **Human.** Say what each mapped port is physically wired to, port by port,
  and name the one that drives a display or HMI module if the board has one.
  If it does not — if the display is HDMI only — **the session records that**,
  and Gate D's four-item list loses a member by measurement rather than by
  assumption. Either answer closes the measurement; a blank does not.

**M4 — the input device set.** `cat /proc/bus/input/devices`;
`ls -l /dev/input/`; `dmesg | grep -i input`. `adc-keys` is `status =
"disabled"` in the board DTS while `CONFIG_KEYBOARD_ADC=y` is built, so the
prediction is that no adc-keys device appears; `CONFIG_INPUT_RK805_PWRKEY=y`
suggests a PMIC power key does. The **human** half is plugging a USB keyboard
in and re-reading the set, because the recorded question is what the device
*can* be driven by, and `BOARD_RECOVERY_ACTIONS` being empty rests partly on
"U-Boot on this board cannot take a USB keyboard today".

**Row 8 readout (RTC).** `ls /dev/rtc*`; `/sys/class/rtc/`; `timedatectl`;
`dmesg | grep -iE 'rtc|hym8563|at8563'`; and the `i2cdetect`-free equivalent,
`ls /sys/bus/i2c/devices/` with each `name`. **`hwclock` is not on the shipped
root** — measured, not assumed, by listing the image's `bin` directories — so
the collector's `hwclock -r` probe records `TOOL-ABSENT` and the reading comes
from `timedatectl` and sysfs.

**The driver is built, and the expectation is that this works.** The board's
own configuration step enables the AT8563's driver and then asserts it —
`scripts/config --enable RTC_DRV_HYM8563` followed by `require
'^CONFIG_RTC_DRV_HYM8563=y'` — so the kernel cannot build without it, and
`haoyu,hym8563` is the second compatible on the DTS node that binds it. With
`CONFIG_RTC_CLASS=y`, `CONFIG_RTC_HCTOSYS=y` and
`CONFIG_RTC_HCTOSYS_DEVICE="rtc0"`, **an `rtc0` should be present and should be
the AT8563.** A stage that finds otherwise has found a defect, and that is the
useful sentence — not a prediction of absence.

> status: board-dependent — evidence: `boards/cx3576/bsp/kernel/configure.sh`, `boards/cx3576/bsp/kernel/dts/rk3576-cx3576z.dts`

**Read the resolved configuration, never the committed one.** The vendor config
at `boards/cx3576/bsp/kernel/config/kernel-cx3576z.config` carries
`# CONFIG_RTC_DRV_HYM8563 is not set`; `configure.sh` flips it before
`olddefconfig`, and the file's own header says the assertions are "on the
RESOLVED config and not on the committed input". The resolved config is what
ships as `/boot/config-<release>` and what `verify/src/checks-kernel.ts` reads
back out of the packed root — **so that is the file a claim about this kernel is
made against.** An earlier draft of this page predicted the opposite of the
truth here by reading the input, and the two files differ in exactly this one
symbol out of every one this page cites.

**What is genuinely open, and it is not the driver.** Two things a config
cannot answer:

- **Index, not identity.** `RTC_HCTOSYS_DEVICE="rtc0"` binds by index. Exactly
  one RTC driver is built in the resolved config and exactly one RTC node is
  enabled — the SoC reference design's `hym8563@51` on `i2c@2ac50000` is
  explicitly `status = "disabled"` by the board DTS — so `rtc0` being the
  AT8563 is near-certain rather than doubtful. It is still one command to
  confirm rather than assume: `cat /sys/class/rtc/rtc0/name`.
- **The backup cell.** Whether the chip keeps time across a power-off depends
  on a battery or supercap being fitted and charged, which no symbol and no
  device-tree node states. The dossier already records that neither the driver
  nor the backup cell has been exercised on a unit; **the cell is the half this
  session actually settles**, in stage 3's ten unpowered minutes.

**The SDIO chain, now that its first link holds.** The DTS gives
`/sdio-pwrseq` a `clocks = <&at8563>`, `CONFIG_PWRSEQ_SIMPLE=y` is built, and
the SDIO host the AIC8800D80 sits behind is `mmc@2a320000`. A driver that binds
registers the clock, so the power sequence **should** resolve and the radio
**should** come up. The chain is worth knowing anyway, because it is the first
thing to check if the radio does not: a deferring `mmc-pwrseq-simple` would
name itself in `dmesg | grep -iE 'pwrseq|deferred|mmc[0-9]'`. Stage 2 captures
that while it is still in the journal; stage 4 is where the radio is judged.

**Row 10 readout (reset cause).** Whatever M2 found, plus
`journalctl --list-boots`, `/proc/uptime`, and the console's own record of the
previous shutdown. This is the *baseline*: stage 7 compares against it.

### Stage 3 — `warmboot` (rows 2, 8)

- **Scriptable, before.** Record `date -u`, `timedatectl`, the RTC readout
  again, and `/mnt/state`'s saved clock floor.
- **Human.** Reboot warm (`systemctl reboot`) — three cycles for row 2 — then,
  for row 8, remove power entirely for **ten minutes** and power on again.
- **Scriptable, after.** The same probe set, plus `journalctl --list-boots` and
  whether the clock moved backwards.
- **Pass — row 2 (Warm boot).** Three reboots from a running system, each
  reaching the health gate green with no failed units.
- **Pass — row 8 (RTC).** The driver is built and the node is enabled, so the
  chip should be there; **what this stage settles is the backup cell.** One of
  two honest outcomes, and the row records which:
  - the cell is fitted and charged → after ten unpowered minutes the wall clock
    is within a minute of true time before any network sync; or
  - it is not, or the chip is not keeping time → the clock comes back at the
    saved floor (`max(RTC, saved clock)` per
    [../design/time.md](../design/time.md) §3), monotonically, and the
    documented resync behaviour is what carried it. Per
    [qualification.md](qualification.md) row 8 this second outcome is a `pass`,
    because the row's claim is "time survives power-off **or** the absence is
    handled". It is a `fail` only if the clock goes backwards or the device
    comes up believing a time it should not.

  Record which, and record `cat /sys/class/rtc/rtc0/name` beside it: "the
  clock survived" and "the AT8563 survived" are the same sentence only once
  something has confirmed what `rtc0` is.

### Stage 4 — `network` (row 6)

- **Human.** Attach Ethernet to `eth0`, confirm a lease, then move to `eth1`
  and confirm again, then both. Configure the Wi-Fi client against the known
  AP. Say which physical port is which interface name.
- **Scriptable.** M1's whole probe set again, now with carrier; `ip -4 addr`;
  the default route; a `curl` to a host on that segment; for the radio,
  `rfkill list`, `ip link show wlan0`, the wpa_supplicant unit state, and the
  `dmesg` firmware-load lines for the AIC8800D80 firmware set named in
  `BOARD_FIRMWARE_FILES`.
- **Pass — row 6.** Ethernet and each named radio module associate and transfer
  under the shipped stack. **`eth1` failing to take a DHCPv4 lease is a `fail`
  for this row, not a footnote**, and M1's evidence is what the defect report
  is written from. The radio is **expected to work** — the driver behind
  `/sdio-pwrseq`'s clock is built and asserted at build time — so a Wi-Fi
  failure is a `fail`, and the SDIO power sequence is the first place to look
  for its cause rather than the predicted one. A `fail` with a named cause is
  worth more than a `not tested` either way.

> status: board-dependent — evidence: `boards/cx3576/board.env`

### Stage 5 — `fieldbus` (row 7)

- **Human.** Connect the second CAN node; plug a host PC into the OTG port;
  plug a USB device into a host port.
- **Scriptable.** `ip -details link show can0` (bitrate 250000, `fd off`,
  `restart-ms 100`, state `ERROR-ACTIVE`), a frame sent and a frame received if
  `cansend`/`candump` are present and a recorded absence if they are not;
  `/sys/class/udc/`, the configfs gadget tree, `systemctl status
  serial-getty@ttyGS0`; `lsusb`-free enumeration from `/sys/bus/usb/devices/*/
  {idVendor,idProduct,product}`; the `mos-otg`, `mos-can`, `mos-gadget` and
  `mos-modules` unit states.
- **Pass — row 7.** CAN traffic passes both ways at the shipped configuration;
  the gadget enumerates on the host PC and its console logs in; a USB device on
  a host port enumerates. **The bench interface here is `can0` on the bench
  unit** — it must be the bench harness's own bus, never one attached to a live
  machine.

### Stage 6 — `thermal` (row 9)

- **Scriptable.** Baseline every `/sys/class/thermal/thermal_zone*/temp` and
  its trip points; record `cpufreq` scaling limits; run a sustained all-core
  load for **thirty minutes**, sampling temperature, frequency and
  `throttle_count`-equivalents every ten seconds; then a five-minute cooldown
  sample.
- **Human.** State the enclosure and airflow the run was done in — an open
  board on a bench and a sealed enclosure are different measurements and the
  evidence note must say which.
- **Pass — row 9.** The unit stays inside its thermal envelope; where it
  reaches a trip point, frequency drops and the system stays up and responsive.
  A reset, a hang, or an emergency poweroff during the load is a `fail`.
  `CONFIG_THERMAL_EMERGENCY_POWEROFF_DELAY_MS=0` means a critical trip powers
  the board off immediately, so that outcome is visible as a dead unit rather
  than as a log line.

### Stage 7 — `watchdog` (row 10)

- **Scriptable.** Open `/dev/watchdog0`, set the timeout, pet it a few times to
  prove the ioctl path works, then **stop petting and close without the magic
  `V`** so the device stays armed. Record the moment.
- **Human.** Watch the console; record the wall-clock interval between the last
  pet and the reset, and what the console printed on the way down (if
  anything).
- **Scriptable, after the reset.** Re-read M2's attribute set — `bootstatus`
  above all — plus `journalctl --list-boots` and `dmesg | grep -iE
  'watchdog|reboot|reset'`, and compare against stage 2's baseline. Then
  confirm both boot counters are back at full credit, which is what stage 8
  requires.
- **Pass — row 10.** A hung system is reset by the watchdog within the
  configured timeout, **and** the reset cause is readable afterwards. If M2
  found no `bootstatus` attribute and no other source names the cause, the row
  is a `fail` on its second half with the first half stated — not a `pass`,
  because the row claims both.

### Stage 8 — `update` (row 3, and U10's bench half)

See §6 for what the software half already proves and what is left.

- **Human.** Put two bundles on the device: one that installs and boots, one
  that installs and **fails its health gate**. Both must be signed against the
  keyring in the running root, or RAUC refuses them and the row measures
  nothing.
- **Scriptable.** Record the starting slot, `BOOT_ORDER` and both counters;
  install the good bundle; re-read all three; reboot; confirm the new slot
  booted (`rauc.slot=` on `/proc/cmdline`, `rauc status`), that the health gate
  ran, and that `mark-good` refilled the counter. Then install the bad bundle,
  reboot, and let it fall back **without intervening** — counting the reboots
  and reading the counters at each one.
- **Pass — row 3.** The bundle installs to the inactive slot; the order flips;
  the health gate confirms; and the bad slot rolls back after its attempt
  credits, arriving back on the good slot with the device healthy. The console
  line `mos: booting slot <X> (A=<n> B=<m> left)` at each boot is the primary
  evidence and the collector captures it from the journal where it can and from
  the operator's console log where it cannot.
- **Leaves behind, for stage 9:** a named slot, both counters full, and a
  recorded `BOOT_ORDER`. The collector writes these into the run directory and
  stage 9 refuses to start if it cannot read them.

### Stage 9 — `powercut` (row 4)

§5 is this stage. The collector's part is: record the pre-cut state, drive the
install, print the cut marker, and — after each power-up — read back what
actually happened rather than what was intended.

### Stage 10 — `storagefill` (row 5, fill half)

- **Scriptable.** Fill DATA to the `warning` band (≥ 80% used) and confirm the
  status surface reports it; continue to the `critical` band (≥ 90%) and
  confirm again; check the system is still up, apid still answers, and the
  256 MiB update workspace reserve is still honoured — then delete the filler
  and confirm the bands clear at their hysteresis points (75% / 85%). Separately
  fill `/var` past `var-threshold-pct` and confirm `mos-health` reports
  `health.var` as `degraded` **and does not fail the boot**.
- **Pass — row 5.** Growth (stage 1) plus: fill-up of DATA and of `/var` does
  not take the system down, the bands enter and clear where
  [../design/storage.md](../design/storage.md) §5 says they do, and the media
  health readout works — meaning the eMMC `life_time` / `pre_eol_info` bucket
  pair is reported, or `undefined` is reported honestly where the part declines
  to answer.
- **Copy the run directory off the device before starting this stage.**

### Stage 11 — `recovery` (row 12)

Destroys. Last. In [../user/recovery.md](../user/recovery.md)'s order, one rung
at a time, re-reading the system state after each:

1. **Read-only diagnosis** — the diagnostics snapshot, taken and read back.
2. **Guarded rollback** — to the other slot, then back.
3. **Configuration reset** — settings return to defaults; identity survives.
4. **Application-data reset** — application state gone; identity survives.
5. **Credential recovery and full factory reset** — both must be **refused**,
   saying that the board declares no physical recovery action. A refusal is the
   expected result here and a success would be a `fail`.
6. **Rescue SD** — boots only when the eMMC is unbootable (deviation D-1:
   eMMC first, SD second), so this is tested by making the eMMC unbootable,
   which means:
7. **Reflash from maskrom** — the path of last resort, and the one that returns
   the unit to a usable state afterwards.

- **Pass — row 12.** Every path in the dossier's Recovery method section
  restores a unit from the state it claims to handle, and the two refused rungs
  refuse. A path that cannot be exercised at all records `not tested` naming
  what was missing.

## 5. The power-cut window

Pulling power at an arbitrary moment tests nothing. Row 4's claim is specific:
*an interrupted install leaves the previous slot bootable and the order
unflipped*. That is a claim about one interval.

**The interval.** `rauc install` writes the bundle into the inactive slot, and
only when the write has completed does it call `set_primary`, which is
`fw_setenv` moving that slot to the front of `BOOT_ORDER` and setting its
counter. Everything before that `fw_setenv` is reversible by doing nothing;
everything after it has committed the next boot. So there are three cuts worth
taking, not one, and each has a different expected outcome:

**Cut A — mid-write.** During the copy, while the console shows install
progress between roughly 30% and 90% and before the line that reports the
install finished. This window is seconds to minutes wide and is easy to hit by
hand.

- **Pass looks like:** on power-up the console prints `mos: booting slot A
  (...)` — the *old* slot; `fw_printenv BOOT_ORDER` reads exactly what it read
  before the install; the torn image in the inactive slot is never selected
  because the order was never flipped; and a repeated install afterwards
  succeeds.
- **Fail looks like:** the device boots the half-written slot, or does not boot
  at all, or `BOOT_ORDER` moved.

**Cut B — the commit itself.** Between the last byte written and the
`fw_setenv`. The collector polls `fw_printenv BOOT_ORDER` while the install
runs and prints `>>> CUT NOW <<<` on the console the moment the write reports
complete; the operator cuts on that marker. The window is short, so the cut
lands on one side of the flip or the other and **the session reads back which
side it hit rather than assuming**:

- landed **before** the flip → Cut A's pass criteria apply;
- landed **after** the flip → the device boots the new slot with a full
  attempt counter and the health gate confirms it, which is a normal successful
  update and not a defect.

Both outcomes are recorded. Repeat until at least one of each has landed; the
row's evidence note states how many attempts produced which. **A cut whose side
cannot be determined afterwards is discarded, not guessed.**

**Cut C — first boot of the new slot, before `mark-good`.** After the order has
flipped, between the console's `mos: booting slot B (A=3 B=2 left)` and
`mos-health` reaching `rauc status mark-good`.

- **Pass looks like:** the credit was spent and stays spent — `fw_printenv
  BOOT_B_LEFT` reads one lower after each such cut — and after the credits are
  exhausted the bootloader falls back to slot A on its own, with `rauc status`
  and mosd's update state naming the failed slot. This is the counter behaving
  as a watchdog rather than as a hint, which is the whole reason `boot.cmd`
  saves the decrement *before* booting.

**And the environment write itself.** [../design/uboot-ab-handshake.md](../design/uboot-ab-handshake.md)
§8.1 step 3 already specifies the mid-`saveenv` cut — at least 50 iterations,
no `*** Warning - bad CRC, using default environment` on any power-up. That
procedure is not restated here; run it as written, and record its result as
part of row 4's evidence note. It is the row's hardest half: cuts A, B and C
are about slots, and that one is about the redundant environment pair the slot
decision is stored in.

**Repeat count.** Row 4 says "repeated cuts do not brick". Ten cuts of type A,
ten of type B, five of type C, plus the handshake document's fifty `saveenv`
iterations. A single successful cut is an anecdote.

## 6. U10 is narrower than it was, and this is what is left

`docs/plan/PLAN-071.md` U10 — bad bundle, automatic install, fallback,
suppression — was entirely a bench item until RFCT-341 landed the clock seam on
`AutoDriver`. **The automatic path now carries fifteen tests**, including the
full bad-bundle cycle through the real suppression store, and re-running that
half by hand on the bench would be waste. What the software already proves,
recorded so nobody repeats it:

- the automatic path meets **the same gate set** as the manual one, refused by
  the same rule in the same words, driven against a real daemon;
- **the loop closes**: a bad bundle installs once, rolls back, the version is
  suppressed, and the second automatic pass selects nothing — through the real
  store, with both consultation sites exercised;
- the **suppression store** itself: record, clear, idempotence, and an
  unparseable store refusing rather than reading as empty;
- automation **never arms the reboot override**, measured against a real gate
  rather than against an empty tree;
- every deferral reason the driver can mint is reachable and is checked against
  the closed vocabulary itself, so a code nothing produces fails the test.

> status: shipped — evidence: `docs/design/updates.md`, `pkgs/mosd/mosd/src/update_auto.rs`

**What no seam retires**, and what stage 8 and stage 9 exist for: *a real
bootloader spending real boot credits and a real slot falling back.* Everything
above runs on a host where `BOOT_A_LEFT` is a value in a test fixture. The bench
half of U10 is exactly:

- the counters in the redundant U-Boot environment decrementing once per
  attempt, persisted before the kernel is loaded;
- exhaustion selecting the other slot without operator action;
- `rauc status` and mosd's derived state agreeing with the bootloader
  afterwards.

Scope the row to that. It is stage 8's bad-bundle half plus stage 9's Cut C,
and nothing else about `auto` needs a person on a bench.

## 7. Running the collector

```sh
# on the bench host, with the run directory mounted or the file pasted in
scp cx3576-bench-collect.sh root@<device>:/root/

# on the device, over the serial console, one stage at a time
bash /root/cx3576-bench-collect.sh firstboot
bash /root/cx3576-bench-collect.sh inventory
...
bash /root/cx3576-bench-collect.sh report > /root/qualification-rows.md
```

- **Output.** `--out DIR`, defaulting to `/srv/bench` — the user-owned
  namespace on DATA, which survives a reboot and a power cut. The collector
  falls back to `/mnt/data/bench`, then to `/var/lib/mos-bench` and finally
  `/tmp`, saying so loudly each time, because `/var` is EPHEMERAL and `/tmp` is
  a tmpfs: a run recorded there does not survive the power cuts the run is
  about. It `sync`s after every append for the same reason.
- **The API.** `GET /api/v1/update` and the other reads are authenticated.
  Pass a bearer token with `--token` or `MOS_BENCH_TOKEN`; without one the
  collector records `not collected: no API token` and falls back to the
  unauthenticated sources (`rauc`, `fw_printenv`, `systemctl`, the bus) for
  everything they cover. It does not log in for you: minting a session on the
  device writes to apid's audit ring and its login-backoff counters, and a test
  harness must not be the thing that locks the operator out.
- **`--dry-run`** runs every read-only probe and refuses every mutation,
  reboot, install and power-cut prompt. This is how the script is exercised
  somewhere other than the bench.
- **No `jq`, no `python3`, no `wget`, no `perl`, and no package manager.** The
  image ships none of them and that is a property under test, not an obstacle;
  the collector parses apid's JSON with `sed`/`awk` and keeps the raw body
  beside every extraction. Nothing is installed on the device.

Every probe is guarded by a `command -v` check. **A missing tool produces a
`not tested` row naming the tool**, never a silent skip and never a pass — the
same rule the dossier already applies to itself.

### The tool inventory, measured on the shipped cx3576 root

Read off the composed arm64 root itself (`_out/cx3576/factory-root.oci`, its
filesystem listed rather than executed), so the collector's guards are written
against what is there rather than against what ought to be:

- **Present:** `bash`, `sh`, `curl`, `networkctl`, `journalctl`, `systemctl`,
  `rauc`, `podman`, `udevadm`, `dmesg`, `lsblk`, `date`, `stat`, `awk`, `sed`,
  `grep`, and also `fw_printenv`/`fw_setenv`, `busctl`, `ip`, `rfkill`,
  `timedatectl`, `hostnamectl`, `nproc`, `sleep`, `timeout`, `find`, `tar`,
  `tee`, `tr`, `sync`.
- **Absent:** `jq`, `python3`, `wget`, `perl` — none of the four appears
  anywhere in the root, not merely off `PATH`. Also absent: **`hwclock`**,
  and **`cansend`/`candump`**, which is why row 7's CAN traffic is driven from
  the peer node and observed here through `ip -details -statistics link show
  can0`.
- **BusyBox ships with no applet links**: the root contains `/usr/bin/busybox`
  and its copyright file, and nothing else — so `busybox` covers no absence.

> status: board-dependent — evidence: `rootfs/build.sh`, `boards/cx3576/board.env`

## 8. Filling the dossier

`cx3576-bench-collect.sh report` prints the thirteen rows in the dossier's own
column order. Paste them over
[cx3576-example.md](cx3576-example.md)'s table, then, in the same commit:

- fill the **Binding** paragraph above the table with the eMMC part and the RTC
  finding from stage 2 — the two elements
  [qualification.md](qualification.md) §1 requires and this tree does not have;
- update **Known limitations**, which currently says both are unrecorded;
- update the **Console** and **Peripherals** sections with M3's port map and
  M4's input set;
- and re-run `make docs-verify`, which asserts the row grammar the collector
  already enforced.

Rows that came back `fail` stay as `fail` with their date. A `fail` is not
superseded by deleting it; [qualification.md](qualification.md) §2 requires a
later dated `pass` to supersede it, and the failing row stays on file for the
units that shipped under it.

> status: board-dependent — evidence: `docs/bsp/cx3576-example.md`, `docs/bsp/qualification.md`

## 9. What has already been exercised, and what has not

A bench script whose first execution is on the bench is a bench session spent
debugging the script, so this one has been run — not on cx3576, which does not
exist here yet, but on what does. Stated exactly, because the difference
matters when a stage misbehaves on the day:

**Exercised, end to end.** Every stage ran, in order, inside a composed mos
root: the ordering gate (a stage whose assumption is unmet is refused by name
— `powercut` refused because `update` left no recorded slot, and
`storagefill` and `recovery` refused in turn), the read-only probe set of
stages `install`, `firstboot`, `inventory`, `warmboot`, `network` and
`fieldbus`, the capture files and their command/status headers, the run
directory fallbacks, the `--dry-run` downgrade, the `report` renderer, and all
three branches of the operator prompt driven over a real pty. The rendered
table was then spliced into a copy of [cx3576-example.md](cx3576-example.md)
and put through the real `verify-board.sh`, which accepted it — and, with one
row deliberately broken, rejected it. **The collector's output is pasteable
into the dossier, and that is a measurement rather than an intention.**

**Not exercised, and why.** No mos image is booted here, so nothing that needs
a running A/B system was reached: the good/bad bundle cycle, the boot-credit
arithmetic, the watchdog reset, the thermal load and the power cuts all ran
only as far as their refusals. The environment had no `rauc` slot, no
`/dev/watchdog` and no `/mnt/data`, and every affected row recorded that as its
reason — which is the behaviour under test, but it is not the same as having
seen the pass path on hardware. **Stages `thermal` through `recovery` are
syntax-checked and refusal-checked, not outcome-checked.**

**One image fact the collector leans on.** journald is `Storage=volatile` on
this image, so **a boot's journal is gone after the next reboot**. Every stage
captures `journalctl -b` eagerly for that reason, and a stage re-run after a
reboot cannot recover the evidence of the boot before it. That is also why the
reboot-spanning stages accumulate one cycle per run rather than trying to
observe several reboots from inside one invocation.

## 10. The display rows (PLAN-088), which nothing off-hardware can settle

PLAN-088 makes HDMI show a boot logo instead of a login prompt, and keeps the
display reachable as a console. Every mechanism it uses was read out of the
pinned kernel source and every resulting byte is asserted against the assembled
image by `verify/src/checks-display.ts` — but **no board has ever displayed
it**. The image contract can say that the kernel config carries `CONFIG_LOGO`,
that the console list puts `tty1` before the serial console, and that
`getty@tty1` resolves to disabled. It cannot say that a monitor lit up.

These five rows are that gap, and they are `not tested` until a bench session
with a real HDMI monitor attached fills them. They need no new collector stage:
four of them are things a person looks at, which is exactly the half
[qualification.md](qualification.md) reserves for an operator answer.

| Row | What a `pass` is | Why no gate can decide it |
|---|---|---|
| D1 — logo appears | The board splash is on the monitor before the login-less prompt-free console settles, at the negotiated mode | Nothing here renders. The 720x405 geometry was chosen from `fb_prepare_logo`'s height test and `fb_show_logo_line`'s width test, but which mode the monitor negotiates is an EDID fact of the attached panel |
| D2 — exactly one, centred | One logo, centred, not a row of them | `fbcon=logo-count:1` is asserted in the image; that the option took effect is a pixel fact. `fb_logo_count` otherwise defaults to one copy per online CPU |
| D3 — no login prompt | No `login:` on HDMI at any point in a normal boot, and none after several minutes | The preset resolution is asserted; that no other mechanism spawns a getty on tty1 is a claim about the running system. systemd 257's getty-generator skips virtual consoles by design, which is the reading this rests on |
| D4 — a panic reaches the screen | With `loglevel=5`, force a crash (`echo c > /proc/sysrq-trigger`) and read the trace **on the monitor** | This is the property that justifies letting a logo own the display, and it is the one most worth distrusting. It depends on `console_verbose()` raising the level on the oops path, which is source-verified and never observed on this board |
| D5 — the console comes back | `systemctl start getty@tty1` yields a usable login prompt on HDMI, and `systemctl stop` gives the screen back | A disabled unit being startable is systemd behaviour, not an image fact |

**D4 is the row to run first if time is short.** D1 through D3 failing leaves a
blank or ugly screen; D4 failing means a technician with no serial cable has no
way to see why a unit is dead, which is the regression this design was chosen
to avoid. It is also the only row whose failure would argue for reverting the
console policy rather than adjusting the artwork.

**A `fail` on D1 with a `pass` on D4 is a coherent outcome, not a contradiction**
— it is what a monitor negotiating a mode narrower than 720 pixels looks like,
and the fix is the logo geometry rather than the console design. Record the
negotiated mode (`/sys/class/drm/card*/modes` and the chosen one from
`dmesg | grep -i mode`) with either result, because without it neither row can
be acted on.

> status: proposed — evidence: `docs/plan/PLAN-088.md`
