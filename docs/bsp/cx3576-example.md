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

Power-on to mounted root, in order:

1. **RK3576 BootROM** (silicon) reads eMMC sector 64. On the recovery key,
   or when no bootable loader is found, it falls to rockusb/maskrom.
2. **idbloader** — Rockchip TPL/SPL with the `rkbin` DDR-init blob (input
   class: source + blobs), written raw at sector 64 inside the GPT `loader`
   partition.
3. **TF-A** — `rk3576_bl31_v1.24.elf` (blob), packaged into the U-Boot
   image.
4. **U-Boot** — the `uboot-mos` A/B variant: redundant environment pair at
   the layout's `uenv-a`/`uenv-b` offsets, bootmeth order pinned to script.
   The assemblers refuse the debug variant.
5. **boot.scr** — compiled from
   [boards/cx3576/boot.cmd](../../boards/cx3576/boot.cmd), identical in
   both boot slots: runs the RAUC `BOOT_ORDER`/`BOOT_x_LEFT` handshake,
   loads the slot's `mos-verity-<slot>.env`, and boots `Image` +
   `rk3576-src.dtb` with the `dm-mod.create=` verity table on the command
   line.
6. **Kernel dm-init** assembles the verity device from the table (no
   initramfs; every boot-path option is `=y`) and mounts the squashfs root.

A/B mechanism: RAUC `uboot` backend over the redundant environment;
contract in
[docs/design/uboot-ab-handshake.md](../design/uboot-ab-handshake.md).

Verification between stages: BootROM→idbloader and idbloader→U-Boot follow
Rockchip's unsigned load path (no verification configured); U-Boot does
**not** verify the kernel/DTB/verity parameters (`CONFIG_FIT_SIGNATURE` is
configured nowhere in the tree); the kernel verifies the root via dm-verity
(I1). See Assurance level.

> status: board-dependent — evidence: `boards/cx3576/boot.cmd`

## Storage media and layout

- **Device:** eMMC, `/dev/mmcblk0` — the whole layout lands on one device
  node; there is no second medium to select between. The concrete eMMC part
  (vendor/model) is not recorded in the repository; qualification binds to
  it once a rig run names it.
- **Layout:** `LAYOUT_VERSION=2`, GPT, 11 partitions (loader, uenv-a/b,
  boot-a/b, rootfs-a/b, meta, state, ephemeral, data). The authoritative
  layout is [boards/cx3576/board.env](../../boards/cx3576/board.env) —
  offsets are deliberately not restated here.

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
  facts staged from `bsp/init/`.
- **RTC:** the board device tree declares an `AT8563`/`hym8563` at `0x51` on
  `i2c7` (and disables the SoC reference design's node on another bus), and
  `board.env` records no RTC fact of its own. Neither the driver nor the
  backup cell has been exercised on a unit — qualification row 8 is `not
  tested` below. Time management itself does not depend on it: always-on NTP,
  the STATE-backed clock floor and the timezone setting ship and are the same
  on a board with no RTC at all.

> status: board-dependent — evidence: `boards/cx3576/bsp/kernel/dts/rk3576-cx3576z.dts`, `docs/design/time.md`

## Recovery method

- **Recovery key → rockusb:** the adc-keys recovery button (saradc ch1,
  appended to the U-Boot device tree in the BSP build) drops the board into
  rockusb loader mode. Needs a working loader; survives a corrupt
  environment and a dead rootfs.
- **Boot failure → rockusb fallback:** when no boot target succeeds, U-Boot
  falls back to rockusb rather than hanging.
- **Maskrom:** with the loader area unbootable, the BootROM presents
  maskrom over USB; `rkdeveloptool` (driven by the BSP Makefile's flash
  targets) reflashes from a blank device. This is the path of last resort
  and the factory flash path.
- **Rescue SD:** boot device order is eMMC first, SD second (deviation D-1)
  — a rescue SD boots when the eMMC is unbootable but cannot override an
  eMMC that boots.
- **Power-cut during update:** by the A/B design, an interrupted install
  leaves the previous slot bootable and the order unflipped — claimed by
  the handshake contract, and proven only by qualification row 4, which is
  `not tested` below.

> status: board-dependent — evidence: `boards/cx3576/bsp/Makefile`

**Install entry.** The same rockusb transport is the installation path:
[../user/install.md](../user/install.md) section 5 is the operator
procedure, and section 3 of that page states what the write destroys. No
row below records an installation performed on a unit.

**Software recovery, above the loader.** The operator ordering — read-only
diagnosis, guarded rollback, configuration reset, application-data reset,
credential recovery, full factory reset, reflash — is
[../user/recovery.md](../user/recovery.md). Two of those steps do not reach
this board:

- **Physical-presence entry: none on this board.** The board answers the
  `recovery.presence` capability with `console-attach`, and **nothing in the
  tree writes a presence assertion**, so credential recovery and the full
  factory reset are refused on a fielded unit. Whether a mos-owned unit can
  own `ttyFIQ0` without displacing the generated `serial-getty@ttyFIQ0` is
  the bench question that blocks it.
- **The recovery button is not a presence assertion.** It is a *loader*
  entry (`PREBOOT` → rockusb) and no software recovery flow reads it.

**Secure wipe: not available.** No device-level erase primitive has been
evidenced on this board's eMMC, so a unit leaving the operator's control
needs the medium destroyed rather than reflashed.

> status: unsupported

The rungs that do reach this board — read-only diagnosis, the guarded
rollback, and the configuration and application-data resets — are implemented
and reachable with an authenticated session; none of them has been run on a
unit, which is what the Recovery row below records.

> status: shipped — evidence: `docs/design/recovery.md`, `pkgs/mosd/mosd/src/reset.rs`

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
bundle digests live in the release's own signed metadata, not in this
dossier.

## Known limitations

- **No verified boot above the root** — `CONFIG_FIT_SIGNATURE` is
  configured nowhere in the tree; kernel, DTB and verity parameters are
  unauthenticated at boot (caps the ladder at I1/I2; see Assurance level).
- **Reduced auditability, pre-U-Boot** — DDR init and TF-A are vendor
  blobs; the boot chain's first mutable stages are not source-auditable,
  and any future I3/I4 claim must name them.
- **Blob digests not pinned in this dossier** — see Artifact digests.
- **Dual Wi-Fi SKU not distinguished at build** — an AP6275S board flashed
  with this image has no working Wi-Fi firmware; claims apply to the
  AIC8800D80 SKU only.
- **Boot-attempt values must stay in 1..9** — RAUC writes the counters in
  hex and U-Boot parses decimal; the radices agree only there.
- **`boot_targets` can override the pinned boot order** on the A/B variant
  (persistent environment); mitigated per boot by the `BOOTCOMMAND` clear,
  which the U-Boot build asserts in both stages — recorded in the sync
  record's D-1 mechanism note.
- **Concrete eMMC part and RTC presence unrecorded** — both must be named
  by the first qualification run.

## Assurance level

Per [assurance.md](assurance.md), for CX3576-Z as shipped from this tree:

- **I1 — verity-protected root: met.** Squashfs + dm-verity root, verity
  table composed by the boot script, boot-path kernel options asserted
  `=y` at build.

> status: shipped — evidence: `rootfs/build.sh`

- **I2 — authenticated normal system update: mechanism in place, not a
  production claim.** RAUC verifies bundle signatures against the keyring
  in the signed root, TUF metadata pins releases, and the device-side client
  that walks that metadata ships in the image.

> status: shipped — evidence: `build/src/bundle.ts`, `docs/design/updates.md`

  What is missing on this board is operational, not mechanical: production
  key custody is a runbook nobody has performed, and no image provisions the
  pinned root anchor the client would start from, so with development keys
  this is a tested mechanism only.

> status: unsupported

- **I3 — authenticated kernel/FIT, DTB and verity parameters: not met.**
  No FIT signature configuration exists in the tree, and no board boot key
  lifecycle exists to sign one with.

> status: unsupported

- **I4 — hardware-rooted boot plus production debug policy: not met.** No
  fusing performed or configured; rockusb/maskrom debug paths are open (a
  bring-up feature, a production decision not yet made).

> status: unsupported

## Qualification results

**Binding** (named-revision rule): board revision CX3576-Z; storage: eMMC
at `/dev/mmcblk0`, concrete part not yet named; radio module: AIC8800D80;
BSP version: upstream sync `5e2b1c3` plus this repository's tree.

No hardware run is on file: this dossier was filled from the repository by
a documentation change that cannot flash hardware, so every
hardware-dependent row is `not tested`. Off-hardware gates that do exist
are noted as evidence about their own surface, never as a hardware `pass`.

| Row | Result | Date | Evidence / reason |
|---|---|---|---|
| Cold boot | not tested | — | needs bench hardware |
| Warm boot | not tested | — | needs bench hardware |
| A/B switch and update | not tested | — | needs bench hardware; the handshake script logic has an off-hardware suite (`make os-uboot-handshake-test`), which is evidence about the script, not about this row |
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
