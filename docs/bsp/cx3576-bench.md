# CX3576 current-image bench qualification

This is the reusable operator procedure for the thirteen qualification rows in
[cx3576-example.md](cx3576-example.md) and the finer current obligations in the
[live acceptance matrix](../task/20260910-1014-a2-cx3576-acceptance-matrix.md).
It defines the order, admission gates, human observations and evidence boundary
for a fresh complete image using signed file deployments.

The collector is [cx3576-bench-collect.sh](cx3576-bench-collect.sh). It is
copied to the device and run there; it needs nothing from this repository.

**This page does not fill any row.** A procedure is not a measurement. Only a
dated run bound to the exact image, source, board, storage part and radio SKU
may update the live matrix or dossier, and off-hardware gates remain evidence
about their own surface rather than a hardware `pass`.

> status: board-dependent — evidence: `docs/task/20260910-1014-a2-cx3576-acceptance-matrix.md`

## 1. What the session has to produce

Three artifacts, all required:

1. **An identity record outside the device**, holding the clean source commit,
   complete-image path and SHA-256, verification inputs/results, signed
   release/component IDs, image profile, host/flash-tool identity, board
   revision, radio SKU, actual system medium and full flash readback result.
2. **A run directory copied off the device**, holding one capture file per
   probe: the raw output, command line, UTC time and exit status. Device-local
   evidence alone is insufficient for reboot, reset and power-cut rows.
3. **A markdown table**, printed by `cx3576-bench-collect.sh report`, whose
   rows are exactly the dossier's — `| Row | Result | Date | Evidence /
   reason |`. It is a legacy thirteen-row summary; the operator must separately
   reconcile the finer obligations in the live acceptance matrix.

The collector enforces [qualification.md](qualification.md) §2's row grammar on
its own output: a result cell is exactly `pass`, `fail`, `N/A` or `not tested`,
and `pass`/`fail` carry an ISO date. A row it could not run records `not
tested` **with the reason it could not** — a missing tool, an absent operator,
an unmet assumption from an earlier stage. It has no code path that writes
`pass` from anything other than an observation it made or an answer a person
gave it.

### The binding, filled first

[qualification.md](qualification.md) §1 binds results to one combination. The
concrete storage part, actual system block device and RTC are unrecorded in this
workspace. The collector assumes `/sys/block/mmcblk0`; that path is not device
discovery. Before copying or running it, the operator must identify the system
medium from the authorized bench unit and record the mapping. If the path is not
`/sys/block/mmcblk0`, the collector cannot produce an admissible binding without
a scoped follow-up. **A run with an inferred or incomplete binding is not a
qualification run.**

## 2. The bench, and what is missing from it

| Need | For rows | Note |
|---|---|---|
| Clean-source handoff, complete newest image, public verification inputs and exact SHA-256 | all | the archived dirty-stamp candidate is reference material, not an automatic flash choice |
| CX3576-Z unit, AIC8800D80 SKU | all | the AP6275S SKU is out of the dossier's scope |
| Serial console on `ttyFIQ0`, 1500000 baud | all | the assumed interface; the network is a measurement, not a given |
| Host with `rkdeveloptool` and USB to the OTG port | 13, 12 | the flash and the last-resort recovery path |
| A switched power feed the operator can cut | 4 | see §5 |
| Explicitly confirmed local API route and test credential/token | power, update, reset, offline | do not use the collector's loopback default as discovery |
| Ethernet with a DHCPv4 server, on both ports | 6 | `eth0` and `eth1` are separately measured |
| A 2.4/5 GHz AP with known credentials | 6 | |
| A controlled Bluetooth peer and named profile | current row N3 | controller enumeration alone is insufficient |
| A second CAN node (250 kbit/s, classic, FD off) | 7 | `can.conf` ships those values |
| A host PC for the USB gadget console | 7 | `mos-gadget` binds a CDC ACM getty |
| A USB keyboard and named HDMI sink/capture | current rows D1-D4; historical D5 observation is optional | records connected boot, tty2, VT return and late attach separately |
| Versioned NPU, encoder and decoder fixtures with expected outputs | current rows A1-A3 | the repository currently names no accepted workload fixture |
| Signed component archives, including a deliberate failed-health candidate | 3, 4 | §6 |

No current bench endpoint, flashed-image identity, authorized target medium or
power rig is confirmed. Stop before flash or device mutation until all four are
recorded. A switched supply can satisfy the power-control requirement only when
its cut timing is externally correlated with the serial trace and the actual
storage-write boundary.

> status: unsupported

## 3. The order, and what each stage assumes

Some rows are one-way. `Recovery` and the factory reset destroy the state the
earlier rows established; `A/B switch and update` has to leave the device on a
known deployment before `Power-cut during update` means anything; and first-boot
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
| 8 | `update` | 3 | stage 7's reset was absorbed: native state and the preceding reset are recorded |
| 9 | `powercut` | 4 | stage 8 left the device on a named confirmed deployment with a usable retained fallback |
| 10 | `storagefill` | 5 (fill) | stage 9 completed, and the run directory has been copied off |
| 11 | display (manual) | D1-D4; historical D5 is optional | stage 10 completed; the named sink, USB keyboard and visual recorder are attached for D1-D4; D5 adds no pass gate or independent destructive run |
| 12 | accelerators (manual) | A1-A3 | stage 11's mandatory D1-D4 observations completed; accepted fixtures and expected outputs are named before execution |
| 13 | `recovery` | 12, R1-R2 | all required preceding evidence and any optional evidence actually captured are copied off the device; this stage destroys |

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
- **7 before 8.** Record the watchdog reset and native state before installing
  another candidate. A spent attempt remains spent. Start a new full-image
  series when a new baseline is needed.
- **9 after 8.** Record a named confirmed deployment and retained fallback before
  testing interruption, so post-reset identity has a concrete baseline.
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

### Stage 0 — `install` (row 13, installation and first boot)

Flash the complete current image using [the installation procedure](../user/install.md).
Bind the evidence to the exact board, eMMC CID, image hash, boot keys, kernel/root
IDs and image profile. Full readback must match before reset. Begin each new
acceptance series from a fresh complete image; do not restore old partitions
or replenish attempts. Record all signing domains as development or externally
managed public trust inputs. Do not infer fuse enrollment from a signed FIT.

Use an explicit `MOS_IMAGE`; never allow the make target's newest-file fallback
to select an acceptance artifact. Before writing, record the clean source/release
handoff, run the complete-image verifier, identify the one authorized RockUSB
unit and independently identify its system medium. The current workspace has no
admissible image/target pair, so the procedure is presently blocked here.

### Stage 1 — `firstboot` (rows 1, 5-growth, 11)

Power on cold with external serial capture and no network time available.
Collect `mos-deploy status`, `mos-deploy firmware-readback`, `/run/mos/boot.json`,
`/proc/cmdline`, required health-service results, mount identities, DATA geometry
and eMMC health attributes. No private credential or key contents belong in the
capture. The firmware partition, SYSTEM and DATA must match current board policy.

Five cold starts must reach signed root/support, native health confirmation and
usable management services. Record failed optional units separately. DATA alone
grows; firmware and SYSTEM bytes and partition boundaries stay unchanged.
Machine identity is persisted on DATA before systemd and remains stable across
reboots. Provisioning uses current DATA namespaces and the declared medium.
No boot variable is the machine-identity source.

For every cold start, begin the stability window only after the named required
health set and authenticated deployment confirmation succeed. Keep serial and
service observation running for at least 180 seconds, then capture the required
members, optional failed-unit list, deployment state, uptime and boot ID again.
The collector's current `health_verdict` requires zero failed units and has no
180-second window, so its automated verdict cannot close B2 without this manual
evidence.

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
The current image also enables `CONFIG_WATCHDOG_SYSFS=y` and
`CONFIG_WATCHDOG_NOWAYOUT=y`. Record `state`, `timeout`, `identity`, `nowayout`
and `bootstatus` from the running device. A missing attribute is a finding to
investigate against the exact flashed image and driver; it must not be explained
using an older disabled configuration. Attribute presence alone does not prove
that the driver reports a watchdog reset cause.

PID 1 owns the active watchdog. Closing a descriptor or writing magic `V` does
not disarm a watchdog with NOWAYOUT enabled. Stage 7 uses the deliberate kernel
hang and captures the subsequent reset; it does not open a second watchdog owner.

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
  again, and DATA/state's saved clock floor.
- **Human.** Reboot warm (`systemctl reboot`) — three cycles for row 2 — then,
  for row 8, remove power entirely for **ten minutes** and power on again.
- **Scriptable, after.** The same probe set, plus `journalctl --list-boots` and
  whether the clock moved backwards.
- **Pass — row 2 (Warm boot).** Three reboots from a running system, each
  reaching the health gate green, with the failed-unit list recorded beside the
  verdict rather than folded into it (see row 1).
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

Reboot and power-off are separate current obligations. For each of three
authenticated reboots, preserve the accepted dispatch result, complete exitrd
serial teardown, new boot ID and a fresh 180-second health window. Separately
issue authenticated power-off, observe complete teardown and actual loss of
power, then reapply bench power and capture a new cold-start window. A software
disconnect is not proof that either action completed, and power-off followed by
manual power-on is not a power-cut test.

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

For Ethernet, retain physical-port mapping, topology-derived MAC, lease, DNS and
link-bound application traffic for each port across at least three boots. For
Wi-Fi, retain the AIC8800D80 identity, firmware load, `iw reg get`, per-phy
regulatory state, association, addressing, DNS and link-bound traffic. Test
Bluetooth separately against a named peer/profile and prove a bidirectional
operation; controller enumeration alone does not pass the radio obligation.

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

Capture the active watchdog, configured timeout and current deployment first.
PID 1 already owns the watchdog; opening it a second time is not a valid test.
The collector disables panic's software restart and triggers a kernel crash,
so the hardware timer must reset the board without further pets. Preserve the
external serial/power trace and read back the reset cause on the next boot.
This proves the interval after watchdog activation; separately inject an early
boot hang to qualify firmware-to-kernel coverage. If the reset cause cannot be
established, record that limitation rather than counting an elapsed timeout as
proof of watchdog action.

The current collector implements only the post-PID-1 kernel crash. It has no
supported early-handoff injection point, so it cannot close watchdog handoff.
Before accepting that row, an implementation owner must supply a bounded
U-Boot-to-Linux hang method. Capture one uninterrupted trace showing U-Boot
arming before eMMC access, Linux driver takeover, PID 1 ownership and configured
timeouts; then run the early expiry and post-PID-1 expiry as separate cases.

Under L1's 2026-09-10 ruling, the inherited
[PLAN-088](../plan/PLAN-088.md) D5 HDMI-panic requirement is superseded by the
current console policy and is not a campaign pass criterion. The existing
watchdog/crash tests still require authoritative serial diagnostics, reset
cause and their independent watchdog/recovery results. If the operator elects
to capture the optional HDMI state at the same time, connect the named sink
before the already-approved post-PID-1 crash. Do not repeat the crash solely for
display evidence.

### Stage 8 — `update` (row 3)

Begin with a complete current image and record both native deployment records.
Import a signed `MOSUPD01` archive, then install its verified descriptor and
objects with `mos-deploy`. Reboot and confirm the resulting authenticated ID.
Repeat for root-only, kernel-only and combined updates, measuring object bytes
and proving that unchanged components and firmware ranges are identical.

Install a deliberately failed-health candidate and observe exactly three
persisted failed attempts, followed by the retained confirmed deployment.
Native service/API state must agree with the boot trace. No test step refills
counters or installs an earlier layout. Leave a named confirmed deployment and
usable fallback for the interruption series.

### Stage 9 — `powercut` (row 4)

Run section 5's boundary matrix using external power control and serial capture.
The collector records before/after native state; it cannot identify a physical
cut instant from a post-boot status response. An unobserved boundary remains
inconclusive.

### Stage 10 — `storagefill` (row 5, fill half)

Copy evidence off the device first. Fill bulk and disposable DATA namespaces
only through fixture-owned paths and production writer privileges. The current
contract is:

- all of `/var` is writable and assigned a bounded project;
- `/mos`, `/srv` and `/mos/containers` have zero byte and inode quota limits;
- container bind, storage and temporary paths are independent and private, so
  reset traversal does not cross their mounts;
- DATA as a whole is finite. State/meta remain separate, but no aggregate
  quota-backed reserve protects them from an unlimited writer that fills DATA.

Record mount sources/propagation, project IDs and byte/inode limits before any
fill. Exercise representative writes under each namespace. Exhaust only the
bounded `/var` fixture quota and prove state/meta plus management remain
writable; confirm zero limits rather than expecting quota refusal for the three
unbounded namespaces. Remove only fixture files and verify accounting recovers.
Do not fill the entire DATA filesystem merely to prove that it is finite.
Record eMMC health as unsupported with a reason when the part has no surface.

The collector's `storagefill` prompt still expects `/mos` and `/srv` quota
refusal and rejects unlisted `/var` writes. That prompt is stale and must not be
used for a current pass until a scoped collector follow-up corrects it.

### Stage 11 — display (manual rows D1-D4; historical D5 is optional)

Run D1-D4 independently and bind each state to the exact sink,
cable/connector, image and boot ID. D5 is not a prerequisite for this or any
following stage; handle it only as the optional review in step 5:

1. Boot with HDMI connected. Capture the connector status, EDID modes and fb0
   state, and visually record one centered **YBO - Hub OS** logo with its
   approved gradient through the 180-second window. No normal login prompt may
   replace it.
2. With a USB keyboard, use Alt+F2 and Ctrl+Alt+F2 in separate attempts. tty2
   must start an ordinary getty, accept a test credential and permit logout;
   tty1 must have no getty and tty2 must not autologin.
3. Return from tty2 and record the resulting presentation. The current display
   design names no owner that redraws the kernel logo, so this is a known
   software gap and cannot pass by procedure wording.
4. Boot headless, bank connector/fb0 state, attach the named sink after the
   180-second window, and record hotplug, modes, fb0 and the visual result. The
   current artwork is init-only; the existing late-HDMI task owns the software
   gap.
5. Review any visual state captured during the approved stage 7 watchdog crash
   as `not qualified / optional observation` beside the authoritative serial
   trace. If no sink was connected then, record no D5 observation and do not
   repeat the crash. L1's 2026-09-10 ruling supersedes the inherited
   [PLAN-088](../plan/PLAN-088.md) HDMI-panic requirement for this campaign; the
   screen observation neither passes nor blocks this or any following stage and
   proves neither support nor impossibility.

### Stage 12 — accelerators (manual current rows A1-A3)

Do not substitute probe success or device-node presence for functionality.
Before running, name versioned NPU, encoder and decoder fixtures, exact inputs,
runner/tool versions, settings and expected output checks. None is defined by
the current repository, so these rows remain blocked until A4 or the operator
supplies them.

For each fixture, capture driver/device binding, clocks, resets, power domain,
IOMMU/MMIO ownership and relevant errors before and after. Run repeated NPU
inference with checked output, a representative hardware encode with a decoded
output check, and a representative hardware decode with checked frames/output.
The evidence must establish use of the intended hardware engine rather than a
software fallback.

### Stage 13 — `recovery` (row 12)

Destroys. Last. In [../user/recovery.md](../user/recovery.md)'s order, one rung
at a time, re-reading the system state after each:

1. **Read-only diagnosis** — the diagnostics snapshot, taken and read back.
2. **Guarded rollback** — to the retained deployment, then back.
3. **Configuration reset** — settings return to defaults; identity survives.
4. **Application-data reset** — application state gone; identity survives.
5. **Credential recovery and full factory reset** — both must be **refused**,
   saying that the board declares no physical recovery action. A refusal is the
   expected result here and a success would be a `fail`.
6. **Exhausted/invalid native records** — firmware must enter RockUSB rather
   than selecting unsigned content or refilling attempts.
7. **Loader unavailable** — enter maskrom, then reflash the explicit complete
   current image with verified full readback. No rescue-SD behavior is claimed.

- **Pass — row 12.** Every path in the dossier's Recovery method section
  restores a unit from the state it claims to handle, and the two refused rungs
  refuse. A path that cannot be exercised at all records `not tested` naming
  what was missing.

### Historical first-boot probes to rerun (RFCT-355)

The 2026-09-08 hardware boot produced four useful probe shapes. Its image and
source predate the current acceptance baseline, so none of its observations is
a current pass or proof of a current regression. Rerun these probes inside the
current stages and bind every result to I1.

Each is stated as a claim with a `pass` and the shape of its `fail`, in the
same grammar §4's stages use. None of them changes a dossier row: they are
evidence *within* the rows named in the Stage column.

| Probe | Stage | Claim |
|---|---|---|
| `pstore-region` | 2 `inventory` | ramoops occupies memory the kernel was given |
| `pstore-survives` | 3 `warmboot` | the previous boot's console is readable after a warm reset |
| `regdb-loaded` | 4 `network` | cfg80211 is running on the packaged regulatory database |
| `gadget-bound` | 5 `fieldbus` | the CDC ACM gadget binds its UDC and enumerates |
| `no-implicit-firmware-mount` | 2 `inventory` | only the explicitly declared firmware mount exists |

**`pstore-region` (stage 2).** Read `dmesg | grep -i ramoops`, the
`/proc/iomem` line for it, and the `node 0: [mem ...]` range from the same
boot. **Pass:** the `ramoops: using 0x…@0x…` base lies inside that range —
`0xe0000@0x40400000` against a bank starting at `0x40200000` in the repair's
static evidence. **Fail:** a base below the bank, which is what the 2026-09-08 boot
had (`0xe0000@0x40110000`, entirely inside the 2 MiB TF-A/BL31 keeps) and which
means every console line is being written into firmware memory. This is the
half the image contract already asserts off the device tree; what the bench
adds is that the RUNNING kernel agrees with the tree it was handed.

**`pstore-survives` (stage 3).** Before the warm reboot, write a marker into
the kernel log (`echo mos-pstore-<date> > /dev/kmsg`). After it, list
`/sys/fs/pstore/` and grep the marker out of `console-ramoops-0`. **Pass:** the
marker from the previous boot is there. **Fail, and it is the one that matters:**
an empty `/sys/fs/pstore/` after a warm reset means the region does not survive
the boot chain — the loader writes over it — and the address needs to move
again. The `.dts` states plainly that 0x40400000 is *chosen* to sit below every
address U-Boot loads to and is not a measured-free address; **this probe is the
measurement**, and it is the only one that can be made. Note also that the
first boot after this change starts with an empty pstore whatever the outcome,
because the region moved: run this probe over **two** warm reboots and read the
second.

**`regdb-loaded` (stage 4), and read this before flashing.** The unit's
`ExecStart` carries no `-`, so a failure is a failed unit and the gate names it
in the journal and reports it at live-state `health.units`. It is **no longer a
health-gate failure and no longer a rollback**: PLAN-089 inverted the gate to a
required set, and this unit is not in it. It was, and that is why this
paragraph exists — on 2026-09-08 this exact unit failed on hardware and cost
the candidate a trial on every boot, on an SKU whose phy is self-managed and
never consults what the unit loads. The dash is still absent deliberately, so
that the failure is visible rather than swallowed; what changed is what a
visible failure costs. If it fails here, the finding is still the image's, not
the board's. The probes: `systemctl status mos-regdb-reload.service`,
`iw reg get`, and `dmesg | grep -iE 'regulatory|regdb'`. **Pass:** the unit
succeeded, and `iw reg get` reports a domain the database supplied rather than
`country 00: DFS-UNSET`. **Expected and NOT a fail:** one
`Direct firmware load for regulatory.db failed with error -2` early in the log.
That request is issued by a late_initcall before the root is mounted and cannot
succeed on a board with a built-in cfg80211 and no initramfs; the unit is what
loads the database afterwards, and a *second* failure after the unit ran is the
`fail`. **Second observation, and it is a separate line in the notes:** this
board's AIC8800D80 registers `phy0` as `REGULATORY_WIPHY_SELF_MANAGED` with the
driver's own table (`custregd` defaults true in `rwnx_mod_params.c`), which is
what the `CAUTION: USING PERMISSIVE CUSTOM REGULATORY RULES` banner reports on
success. A self-managed wiphy does not take the core regulatory domain, so
`iw phy phy0 reg get` may differ from `iw reg get` — record **both**, because
which of them a `country_code` in a rendered hostapd configuration actually
reaches is the open question this database was packaged for.

### The health gate's required set (PLAN-089)

Three probes that only a booted device can settle, added for the same reason
the block above exists: the gate's criterion changed on 2026-09-08 and the
change is about what a device DOES when something is wrong, which no offline
test can observe.

| Probe | Stage | Claim |
|---|---|---|
| `health-required-set` | 1 `firstboot` | every member of the shipped required set passes on a real boot |
| `health-tolerates-failed-unit` | 4 `network` | a failed unit outside the set does not cost a boot credit |
| `health-rejects-broken-deployment` | 8 `update` | a deployment missing a required member still rolls back |

**`health-required-set` (stage 1).** Read `journalctl -u mos-health` and
`systemctl show -p Result --value mos-health.service`. **Pass:** the log carries
`required set: boot-settled mosd apid`, one `required member <m>: OK` line for
each, and the authenticated deployment confirmation. **Fail, and this is the run that can
only happen here:** a member that is required but not PROVABLE on this board —
`required member apid: apid.service is not installed`, or `neither curl nor
wget` — which is a refusal by design and would loop the device. The offline
suite fakes both daemons; nothing before this stage has ever asked the shipped
image to satisfy its own conf.

**`health-tolerates-failed-unit` (stage 4).** Preserve an optional failed unit
and record its name in diagnostics. Required services still pass and the native
backend confirms the authenticated running deployment. Confirmation retires the
trial entry; it does not refill counters.

**`health-rejects-broken-deployment` (stage 8).** Stage 8 already needs *"one that
installs and boots, one that installs and fails its health gate"*, and under
the new criterion the second bundle has to break a **required member** —
masking `apid.service`, or `mosd.service`, in the bundle's root is the smallest
one that is not also a broken kernel. **Pass:** the bad deployment boots, the gate
logs `required member apid` (or `mosd`) with no confirmation, and the deployment rolls
back after its credits. **Fail, and it is the one worth naming:** a bundle that
merely breaks *some* unit now boots, confirms and measures nothing — a green
that means the bundle was wrong, not that rollback works.

**`gadget-bound` (stage 5).** Beyond row 7's existing probe set, read
`ls -l /sys/kernel/config/usb_gadget/cx3576_serial/configs/c.1/`, `cat
.../UDC`, and `journalctl -u mos-gadget.service`. **Pass:** `acm.usb0` is a
symlink in `configs/c.1`, `UDC` names `23000000.usb`, and the host PC
enumerates a CDC ACM device. **Fail:** an empty `UDC` with
`Config c/1 of cx3576_serial needs at least one function` in `dmesg`, which is
exactly the 2026-09-08 state and whose cause — a relative configfs symlink
target resolved against the service's `/` working directory — is closed in the
image with a test that drives it (`make os-gadget-test`). If it still fails
*with the function symlink present*, the cause is elsewhere and the
`rockchip-usb2phy … IRQ index 0 not found` line becomes worth pursuing.

**`no-implicit-firmware-mount` (stage 2).** Inspect all automount units,
generator output and mounted firmware paths. The current policy must use only
the declared firmware mount and exact partition identity; an automatically
selected writable firmware mount is a failure. The whole-image verifier checks
the generator mask, while this board test checks its runtime result.

### Additions from RFCT-359 (the stable-MAC assignment)

RFCT-359 changed what this board's Ethernet MAC addresses are derived from —
the port's path through the bus topology instead of its interface name — and
added the two files that make the assignment reach both ports at all. Every
mechanism was read out of the pinned systemd 257.13 and kernel sources and the
derivation is driven offline by `make os-mac-test`, but **no current I1 image has
been observed carrying an address it produced**. Three probes, inside stages
that already set up the state they need.

| Probe | Stage | Claim |
|---|---|---|
| `mac-derived` | 2 `inventory` | both ports carry the address the topology derivation produces, and systemd assigned neither |
| `mac-survives-reboot` | 3 `warmboot` | the same two addresses come back, on the same two ports |
| `mac-before-lease` | 4 `network` | the late port's DHCP request goes out from its derived address |

**What is plugged in, for all three:** the CX3576-Z unit on the serial console
as always, **with a cable in BOTH Ethernet ports** — the on-board GMAC
(`2a220000.ethernet`) and the PCIe RTL8168 (`0000:01:00.0`) — into a switch
carrying the DHCPv4 server §2 already requires. `mac-derived` and
`mac-survives-reboot` do not need the DHCP server, but they do need both ports
populated: the whole point is that there are two of them and that they must not
exchange addresses. No host PC, no USB and no second CAN node.

**`mac-derived` (stage 2).** For each of `eth0` and `eth1`: `ip -d link show`
(address and `addr_assign_type`), `readlink -f /sys/class/net/<i>/device`, and
`udevadm info /sys/class/net/<i>` for `ID_NET_LINK_FILE` and `ID_PATH`. Then
`journalctl -b -u systemd-udevd | grep -i "MAC address"`. Recompute both
addresses from the current implementation's `MD5(CID + "-" + topology)` rule,
using the CID of the operator-identified system medium and the recorded
topology. Do not substitute the collector's `mmcblk0` default for that
identification.

**Pass:** each port's address is `02:` followed by the first five bytes of that
md5, `ID_NET_LINK_FILE` names `60-mos-mac-stable.link`, and udevd logged no
`Applying persistent MAC address` for either port. **Fail, and the two failures
are different things:** an address that is not `02:`-prefixed at all means
`hwinit-mac` never ran on that port; an `Applying persistent MAC address` line
means the `.link` file did not displace `99-default.link` and systemd got there
first, in which case `addr_assign_type` reads 3 and `hwinit-mac` stood down
exactly as designed — on an address mos did not choose.

**`mac-survives-reboot` (stage 3).** Bank both addresses and both topology
paths before the warm reboot; read both again after it. **Pass:** each topology
path carries the same address it carried before, whichever interface name it now
has. **Fail:** an address that moved. Record the interface names on both sides
even when they did not swap — the defect this replaces was invisible until they
did, and a run where the order happened to repeat is evidence about that boot
rather than about the derivation. The two NICs registered 4.5 ms apart on the
2026-09-08 boot log, so a few reboots is a cheap way to try to observe a swap;
several reboots without one is a `pass` with that stated, not a stronger claim.

**`mac-before-lease` (stage 4), and this is the ordering one.** With both cables
in: `journalctl -b -u systemd-networkd`, the lease each port got
(`networkctl status eth0 eth1`), and the client MAC the DHCP server recorded for
each. **Pass:** both ports hold a lease and the server saw each one's derived
address, not a `be:`/`06:`-style invented one. **Fail:** a lease requested from
an address that is not the derived one, which means networkd configured the link
before `hwinit-mac` reached it. The source says it cannot — udev writes the
device database and broadcasts the event to libudev listeners only after a
`RUN+=` program has returned (`udev-worker.c`: `udev_event_execute_rules()`,
then `udev_event_execute_run()`, then `device_update_db()`, then
`device_monitor_send()`) — and this probe is the only thing that observes it.
Row 6's `eth1` lease defect is measured in this same stage; if `eth1` still gets
no lease, note its MAC anyway, because "no lease" and "a lease from the wrong
address" are different findings with the same symptom at the switch.

## 5. The power-cut matrix

Capture exact image/component IDs, storage identity and the external serial and
power trace for every iteration. Test these boundaries independently:

| Boundary | Required observation after power restoration |
|---|---|
| Download or offline import | No boot-visible incomplete candidate |
| Destination object write and file sync | Current/fallback references remain complete |
| Object directory publication | Published objects match authenticated lengths and hashes |
| Candidate activation | Previous committed state or the fully staged candidate is selected |
| Attempt decrement | An unpersisted trial is never launched; spent credit stays spent |
| Health confirmation and GC | Running and retained fallback objects survive |
| Redundant record write | Torn or unreadable records are refused; a valid retained record remains usable |

Run at least ten cuts per installation/activation boundary and fifty randomized
redundant-record writes. Record which side of publication each cut actually hit.
A cut whose boundary is unknown is inconclusive. Exhausting all usable records
must stop for explicit recovery; shared SYSTEM/DATA corruption must not refill
attempts or select unsigned content. Physical power loss must interrupt the
storage device's supply, not only its CPU or software process.

No cut result is inferred from the software fault matrix. Its syscall kills,
short writes and ENOSPC tests cover native transaction behavior; they do not
establish eMMC flush or power-loss behavior.

## 6. Software and hardware evidence boundaries

The native updater and firmware policy have automated authentication,
persist-before-load, failure-injection and update/fallback tests. Current x64
and virt-arm64 images execute complete runtime sequences in QEMU. cx3576's
produced loader and FIT have sandbox/host policy tests, required signature
negatives, whole-image verification and DATA-only growth evidence.

The archived 2026-09-10 CX3576 image predates the final zero-quota correction
for `/mos`, `/srv` and `/mos/containers`; no complete image bound to the current
clean source is recorded. The live matrix therefore blocks the flash admission
gate instead of composing those separate software results into an image claim.

Physical cx3576 boot, reset cause, watchdog handoff and power-cut acceptance
remain open until measured on the named board. The collector records those
observations; passing its own syntax or refusal tests cannot close a hardware
row. Keep the exact evidence in the live matrix and board dossier.

## 7. Running the collector

Transfer the collector only through the operator-confirmed local bench route.
Run it over the serial console one stage at a time with an explicit persistent
output directory and, where used, an explicitly confirmed API URL. Do not use
its default loopback URL or `mmcblk0` probes as endpoint/media discovery.

```sh
bash /root/cx3576-bench-collect.sh --out /operator/confirmed/data/path \
  --api https://operator-confirmed-local-endpoint firstboot
bash /root/cx3576-bench-collect.sh --out /operator/confirmed/data/path inventory
# Continue in section 3 order; run manual stages 11 and 12 separately.
bash /root/cx3576-bench-collect.sh --out /operator/confirmed/data/path report \
  > /operator/confirmed/data/path/qualification-rows.md
```

- **Output.** `--out DIR`, defaulting to `/srv/bench` — the user-owned
  namespace on DATA, which survives a reboot and a power cut. The collector may fall back to `/tmp/mos-bench`, which is volatile and
  cannot retain evidence across a reboot. Copy such evidence to the external
  bench recorder before continuing. It `sync`s after every append for the same reason.
- **The API.** `GET /api/v1/update` and the other reads are authenticated.
  Pass a bearer token with `--token` or `MOS_BENCH_TOKEN`; without one the
  collector records `not collected: no API token` and falls back to the
  unauthenticated sources (`mos-deploy`, `systemctl`, the bus) for
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

The current collector is not sufficient by itself for this run. It hard-codes
the system medium, uses the obsolete zero-failed-unit health criterion, has no
180-second first-boot window, describes old storage quota semantics and a rescue
SD, exercises only the post-PID-1 watchdog case, and has no HDMI/tty2,
accelerator or Bluetooth-peer rows. The complete gap list and ownership handoff
are in the [live matrix](../task/20260910-1014-a2-cx3576-acceptance-matrix.md).
Until those gaps are corrected, its raw captures are inputs to a manually
reviewed verdict, never an automatic current pass.

### The tool inventory must be measured on the accepted image

The historical collector was written against an earlier composed ARM64 root.
Its inventory below is useful for guard behavior but cannot qualify the newest
image. Repeat the inventory from the exact I1 root and record any delta before
the bench run:

- **Present:** `bash`, `sh`, `curl`, `networkctl`, `journalctl`, `systemctl`,
  `mos-deploy`, `podman`, `udevadm`, `dmesg`, `lsblk`, `date`, `stat`, `awk`, `sed`,
  `grep`, `busctl`, `ip`, `rfkill`,
  `timedatectl`, `hostnamectl`, `nproc`, `sleep`, `timeout`, `find`, `tar`,
  `tee`, `tr`, `sync`.
- **Absent:** `jq`, `python3`, `wget`, `perl` — none of the four appears
  anywhere in the root, not merely off `PATH`. Also absent: **`hwclock`**,
  and **`cansend`/`candump`**, which is why row 7's CAN traffic is driven from
  the peer node and observed here through `ip -details -statistics link show
  can0`.
- **BusyBox ships with no applet links**: the root contains `/usr/bin/busybox`
  and its copyright file, and nothing else — so `busybox` covers no absence.

> status: board-dependent — evidence: `rootfs/build.sh`, `boards/cx3576/board.env`, `docs/task/20260910-1014-a2-cx3576-acceptance-matrix.md`

## 8. Filling the dossier

`cx3576-bench-collect.sh report` prints the thirteen rows in the dossier's own
column order. Review every cell against the raw evidence and the collector gaps;
then update both the
[live matrix](../task/20260910-1014-a2-cx3576-acceptance-matrix.md) and
[cx3576-example.md](cx3576-example.md) in the owning reconciliation change:

- fill the **Binding** paragraph above the table with the board revision,
  concrete eMMC part, radio SKU, BSP/source revision, exact image identity and
  profile required by [qualification.md](qualification.md) §1 and row 13;
- update the RTC section/result from stage 2 and **Known limitations**, which
  currently records the eMMC part and RTC as unmeasured;
- update the **Console** and **Peripherals** sections with M3's port map and
  M4's input set;
- and re-run `make docs-verify`, which asserts the row grammar the collector
  already enforced.

Rows that came back `fail` stay as `fail` with their date. A `fail` is not
superseded by deleting it; [qualification.md](qualification.md) §2 requires a
later dated `pass` to supersede it, and the failing row stays on file for the
units that shipped under it.

> status: board-dependent — evidence: `docs/bsp/cx3576-example.md`, `docs/bsp/qualification.md`

## 9. Current verification status

The current collector is syntax-checked and its dry-run/refusal paths must be
checked before bench use. The active file-deployment task records reusable
software results; earlier collector runs apply only to their dated source. The
live matrix records the exact current blockers. No current same-image physical
CX3576 acceptance result has been captured.

journald is volatile. Capture each boot's journal and serial trace before
rebooting; a later collector invocation cannot recover the previous journal.
Only observed hardware outcomes belong in physical qualification rows.

## 10. Current display evidence boundary and historical D5 ruling

The shipped software contract is one centered **YBO - Hub OS** logo with the
approved gradient, an idle tty1, and an authenticated tty2 selected by
Alt+F2/Ctrl+Alt+F2 with no autologin. Static artwork, cmdline and QEMU tty2
checks support that contract, but do not show the board's pixels or complete a
password authentication.

Record connector status, EDID modes, fb0 presence and the named physical sink
for every visual result. A historical disconnected-display log cannot decide a
connected-display row. Stage 11 defines the current D1-D4 observations for
connected boot, tty2, return from tty2 and late HDMI attachment. The
[display design](../design/display.md) and
[late-HDMI task](../task/20260910-0117-cx3576-late-hdmi-logo.md) already record
that current init-only artwork has no redraw owner after VT use or late attach;
those two rows remain known software gaps plus unobserved hardware rows, not
new regressions inferred from old evidence.

D5 retains historical [PLAN-088](../plan/PLAN-088.md) section 2.2 and its
`console=tty1` reasoning only for chronology. L1 ruled on 2026-09-10 that it is
superseded by the current console policy and is not mandatory campaign
acceptance. That policy was completed at
`3579a2cdac58160779cfa3f02860f15104c5dc96` and retained in approved source
`5d0dca577a782aa707d9530779c4b23f2a7eda31`: the
[display design](../design/display.md) section 4,
[board environment](../../boards/cx3576/board.env) line 55 and
[forced kernel configuration](../../boards/cx3576/bsp/kernel/config/kernel-cx3576z.config)
line 491 route kernel and service output only to `ttyFIQ0` and omit
`console=tty1`. Authenticated tty2 remains the recovery path.

Serial is the guaranteed diagnostic path for the required watchdog/crash and
recovery results. A simultaneous screen observation is `not qualified /
optional observation`; it neither blocks later stages nor proves that HDMI can
or cannot show panic pixels. Do not introduce another crash test. A future
dedicated panic screen or diagnostic request needs a separate concrete
implementation and acceptance boundary; this procedure does not claim delivery
of such a feature.

> status: board-dependent — evidence: `docs/design/display.md`, `docs/task/20260910-0616-cx3576-storage-display-cleanup.md`
