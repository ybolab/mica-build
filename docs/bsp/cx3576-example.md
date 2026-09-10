# Board dossier: cx3576 (CX3576-Z)

The filled dossier instance for the cx3576 board, following
[board-template.md](board-template.md) — same section list, same order.
Populated from the board tree and its sync record; qualification rows that
need bench hardware are honestly `not tested`, because this dossier was
filled from the repository, not from a rig.

## Identity

- **Board:** CX3576-Z.
- **SoC:** Rockchip RK3576.
- **MOS_ARCH:** `arm64`.
- **Board directory:** [boards/cx3576/](../../boards/cx3576/board.env).

## Provenance

Input trees and their relationships:

- **Board BSP tree** (`boards/cx3576/bsp/`): drifted derivative of
  `ssh://git@git.ds.cc/miehq/cx3576-alpine.git`, synced to upstream commit
  `5e2b1c31fd0c203f55f5e1df5408676d3e6fedf3` with per-commit dispositions
  and a deviation register (one entry, D-1: eMMC-before-SD boot order) in
  the sync record
  [docs/design/bsp-cx3576-sync.md](../design/bsp-cx3576-sync.md). Not a
  subtree or submodule — the record is the only thing carrying the
  relationship.
- **U-Boot:** mainline `u-boot/u-boot`, pinned at commit
  `ece349ade2973e220f524ce59e59711cc919263f` (v2026.07) in the BSP's uboot
  Dockerfile. Input class: source. Local additions: one rockusb
  loader-mode/maskrom-reboot patch and a device-tree append for the
  recovery button.
- **Kernel:** `armbian/linux-rockchip`, branch `rk-6.1-rkr5.1`, version
  6.1.115, pinned by commit in the BSP's kernel Dockerfile (the build
  asserts the release string). Input class: source. Local patches: YT8531
  PHY init sequence, AIC8800 build gating.
- **Vendor blobs in the boot chain** (input class: source + blobs, from
  Rockchip `rkbin`): DDR init
  `rk3576_ddr_lp4_2112MHz_lp5_2736MHz_v1.12.bin` and TF-A
  `rk3576_bl31_v1.24.elf`.
- **Radio firmware:** AIC8800D80 firmware set from the BSP firmware tree,
  declared as installed paths in `BOARD_FIRMWARE_FILES`. Input class:
  source + blobs.
- **Vendor MiniLoader** (`MiniLoaderAll.bin`): binary-only, used on the
  host-side flash path only — it does not ship in the image.

> status: board-dependent — evidence: `boards/cx3576/bsp/uboot/Dockerfile`

## Supported revisions

- **CX3576-Z** — the only revision this dossier covers. No other revision
  marking is recorded in the board tree.
- **Radio SKU variants:** the board ships a dual Wi-Fi SKU — AP6275S
  (bcmdhd, SDIO) or AIC8800D80 — and the two are not distinguished at build
  time. Only the AIC8800D80 firmware set is declared and shipped; the
  AP6275S SKU is **not covered** by this dossier's claims.
- Qualification results below bind to the combination named there and do
  not generalize (named-revision rule,
  [qualification.md](qualification.md)).

## Owners

- **Lifecycle owner (BSP sync, CVE response, requalification):** mos core —
  the board is the in-tree porting reference; no integrator of record.
- **Qualification owner:** mos core; no matrix run is on file yet.
- **Escalation contact:** the mos project (no per-board contact recorded).

## Boot chain

BootROM → vendor DDR/SPL/TF-A stages → pinned MOS U-Boot → required signed FIT
configuration → kernel and authenticated native init → SYSTEM ext4 → signed
root/support verity mappings → systemd. The MOS firmware embeds the public boot
anchor set and fixed C policy; persistent records contain only bounded deployment
IDs, kernel IDs, generations and attempts. No persistent command import runs.

The watchdog is started before eMMC access. U-Boot validates current GPT geometry,
chooses a record, writes, flushes and reads back a decremented trial, then loads its
FIT. Failure to persist refuses launch. Both records exhausted or invalid enters
local rockusb recovery. Confirmed FIT load failure retires that record before
restart. Physical reset coverage still requires the bench matrix.

> status: board-dependent — evidence: `boards/cx3576/bsp/uboot/mos-file-boot.c`, `tests/file-ab-fit/firmware-io.sh`, `tests/file-ab-fit/signatures.sh`

## Storage media and layout

eMMC `/dev/mmcblk0`; the concrete part remains a required bench measurement.
Current `LAYOUT_VERSION=3` has FIRMWARE, SYSTEM and DATA. The authoritative
geometry is [board.env](../../boards/cx3576/board.env). FIRMWARE covers the loader
and two bounded record copies. Firmware maintenance preserves both copies.
SYSTEM occupies 1 GiB from 18 MiB and holds immutable component files and signed
deployments. The 256 MiB factory DATA partition starts at 1042 MiB; the complete
factory image is 1299 MiB including the GPT tail. DATA is last,
grows alone, and backs selected persistent leaves while `/var` stays read-only.
The current image growth test compares every FIRMWARE and SYSTEM byte.

## Console

- **Serial:** `ttyFIQ0` at 1500000 baud, with
  `earlycon=uart8250,mmio32,0x2ad40000` (from `BOARD_CMDLINE_ARGS`).
- `net.ifnames=0` — interfaces are addressed as `eth0`/`wlan0`.
- **Display:** HDMI; output and rotation defaults are recorded in the board
  definition's prose, and nothing in the image pipeline reads a display
  setting yet.

## Peripherals

- **Radios** (`BOARD_RADIOS="wifi bluetooth"`): Wi-Fi + Bluetooth; dual SKU
  as recorded under Supported revisions, firmware shipped for AIC8800D80
  only.
- **Ethernet:** Motorcomm YT8531 PHY (kernel patch carries its init
  sequence).
- **Fieldbus / I/O:** CAN; USB OTG and USB gadget (gadget getty rule
  shipped); status LED (`BOARD_HAS_STATUS_LED=1`).
- **hwinit concerns** (`BOARD_HWINIT_CONFS="otg can bt mac gadget
  modules"`): USB OTG role, CAN bring-up, Bluetooth attach, MAC address
  provisioning, USB gadget, and module loading — one unit plus one script
  per concern under
  [boards/cx3576/hwinit/](../../boards/cx3576/hwinit/hwinit-can), reading
  facts staged from `bsp/init/`. Two concerns carry udev payload as well: the
  gadget getty rule, and the MAC assignment's `add`-event rule together with
  the `.link` file that takes `MACAddressPolicy` off systemd's default, so that
  this board's Ethernet addresses are derived from its eMMC CID and the port's
  place in the bus topology rather than from the machine id and the interface
  name (RFCT-359).
- **RTC:** the board device tree declares an `AT8563`/`hym8563` at `0x51` on
  `i2c7` (and disables the SoC reference design's node on another bus), and
  `board.env` records no RTC fact of its own. Neither the driver nor the
  backup cell has been exercised on a unit — qualification row 8 is `not
  tested` below. Time management itself does not depend on it: always-on NTP,
  the STATE-backed clock floor and the timezone setting ship and are the same
  on a board with no RTC at all.

> status: board-dependent — evidence: `boards/cx3576/bsp/kernel/dts/rk3576-cx3576z.dts`, `docs/design/time.md`

## Recovery method

The local recovery button enters rockusb before loading SYSTEM. Invalid or
exhausted deployment records also enter rockusb. Maskrom is the BootROM recovery
transport when the loader cannot run. Use the BSP's complete-image flash target;
it checks current GPT/loader geometry before USB writes and verifies all written
image bytes before device reset. Physical execution remains pending.

`BOARD_RECOVERY_ACTIONS` is empty: the loader button does not create an OS
physical-presence assertion. Credential recovery and full-factory reset remain
refused through that gate. Authenticated diagnostics, guarded deployment rollback,
configuration reset and application reset exist above the loader. They preserve
the current directory-scoped retention contract, not separate state partitions.

A complete reflash replaces device identity and user data. Secure erase has no
qualified eMMC primitive. An SD rescue boot override is not claimed by the fixed
MOS eMMC policy. See [installation](../user/install.md) and
[recovery](../user/recovery.md).

> status: board-dependent — evidence: `boards/cx3576/bsp/Makefile`, `boards/cx3576/bsp/scripts/verify-flash.py`, `pkgs/mosd/mosd/src/reset.rs`

## Artifact digests

Provenance digests (pinned commits — asserted by the builds that consume
them):

- U-Boot: commit `ece349ade2973e220f524ce59e59711cc919263f` (v2026.07).
- Upstream BSP tree: synced to `5e2b1c31fd0c203f55f5e1df5408676d3e6fedf3`.
- Kernel: pinned by commit in the BSP kernel Dockerfile; release string
  6.1.115 asserted at build.

Blob versions: DDR init v1.12, TF-A bl31 v1.24 (filenames under
Provenance carry the versions).

**Not on file:** standalone sha256 digests of the accepted `rkbin` blobs
and of the vendor MiniLoader, as [intake.md](intake.md) section 5 requires
for binary inputs — recorded as a Known limitation. Per-release image and
component digests live in the release's own signed metadata, not in this
dossier.

## Known limitations

- Physical boot, eMMC power cuts, watchdog handoff/reset cause, full USB flash,
  RTC and peripheral qualification require a named local bench device.
- DDR init and TF-A are vendor blobs. Software FIT enforcement does not prove
  hardware authentication of the first mutable boot stages or a closed debug path.
- The accepted radio package targets AIC8800D80; the AP6275S SKU is not qualified.
- The exact eMMC part and board revision must be recorded with physical evidence.
- Development boot/content/metadata keys are separate test inputs. No OTP/fuse
  change or production key ceremony is claimed.

## Assurance level

The current implementation authenticates FIT configuration and enforces
kernel-verified root/support hash signatures. Native installation authenticates
release metadata and content before publication. Firmware maintenance is a
separate signed/read-back workflow. These mechanisms have software and sandbox
proof, including missing/wrong/tampered key refusal, dirty SYSTEM reads and
write/flush/readback failures before FIT load.

This is development-grade software evidence. Physical cx3576 enforcement,
power-loss recovery and watchdog coverage are pending. Hardware-rooted boot,
closed debug interfaces and production enrollment are not claimed.

> status: board-dependent — evidence: `boards/cx3576/evidence.json`, `tests/file-ab-fit`, `docs/task/20260908-2229-file-ab-delivery-x64-first.md`

## Qualification results

**Binding** (named-revision rule): board revision CX3576-Z; storage: eMMC
at `/dev/mmcblk0`, concrete part not yet named; radio module: AIC8800D80;
BSP version: upstream sync `5e2b1c3` plus this repository's tree.

No hardware run is on file: this dossier was filled from the repository by
the current software acceptance run without an attached bench interface, so every
hardware-dependent row is `not tested`. Off-hardware gates that do exist
are noted as evidence about their own surface, never as a hardware `pass`.

| Row | Result | Date | Evidence / reason |
|---|---|---|---|
| Cold boot | not tested | — | needs bench hardware |
| Warm boot | not tested | — | needs bench hardware |
| A/B switch and update | not tested | — | needs bench hardware; native record parsing and firmware IO have an off-hardware suite (`make os-fit-records-test`), not a physical result |
| Power-cut during update | not tested | — | needs the power-cut rig |
| Storage growth/health | not tested | — | needs bench hardware; repart growth logic has a host-side test (`make os-repart-test`), same caveat |
| Network/radio | not tested | — | needs bench hardware with the AIC8800D80 SKU |
| USB/fieldbus (CAN, OTG/gadget) | not tested | — | needs bench hardware |
| RTC | not tested | — | RTC presence itself unrecorded; see Known limitations |
| Thermal/throttling | not tested | — | needs bench hardware under sustained load |
| Watchdog/reset cause | not tested | — | needs bench hardware |
| Offline service | not tested | — | needs bench hardware (QEMU offline runs exercise x64, not this board) |
| Recovery | not tested | — | needs bench hardware; every listed path is design-claimed, none rig-proven |
| Installation and first boot | not tested | — | needs bench hardware; the rockusb flash and first boot are documented for both profiles and neither has been run on a unit |
