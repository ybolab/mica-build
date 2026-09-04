# BSP porting manual: blank board to supported board

This is the procedure companion to the BSP contract in
[docs/design/boards.md](../design/boards.md). The contract says what a board
must provide; this manual says in what order to provide it, what each stage
consumes, and what proves the stage is done. Where the two disagree, the
design record wins.

Two boards run through this manual as references:

- **cx3576** (CX3576-Z, RK3576) — the full-effort case: the board builds its
  own boot chain under `boards/cx3576/bsp/`, so every stage below applies.
- **x64** (generic UEFI) — the contrast case: the firmware provides the boot
  chain, so stages 2 and 7 largely collapse to "declare the absence" and the
  board directory holds a `board.env`, a `grub.cfg` and an overlay, nothing
  that compiles.

Every stage ends with an exit criterion a reviewer can check. Do not start a
stage whose predecessor has no passing exit criterion; the stages are ordered
so that each one's inputs are the previous one's outputs.

The tiering of the finished board — what mos may claim about it — is defined
in [support-tiers.md](support-tiers.md). The evidence the claims rest on is
collected per [qualification.md](qualification.md) into a dossier following
[board-template.md](board-template.md).

## Stage 1 — SoC/vendor intake, redistribution rights and provenance

**Goal.** Decide whether the vendor's deliverables can carry a mos port at
all, and record where every input comes from before any of it enters the tree.

**Inputs.** Vendor BSP (source tree, Yocto layers, or binaries), SoC
documentation, license terms for every blob, the kernel version the vendor
ships.

**Procedure.** Run the intake rubric in [intake.md](intake.md) to completion:
classify every input as source, source-plus-blobs, or binary-only; check the
kernel version against the support tiers in the BSP contract (5.10 LTS or
newer is full support, 5.4 is per-board evaluation, 4.x is out of support);
confirm redistribution rights for every artifact that will ship in an image;
open the board's provenance record. For a vendored upstream tree, the record
follows the sync-record practice of
[docs/design/bsp-cx3576-sync.md](../design/bsp-cx3576-sync.md): upstream
repository, synced-to commit, per-commit disposition, and a deviation
register for every deliberate difference.

**Exit criteria.** The intake rubric has no open row; the kernel tier
decision is written down; binary-only inputs meet the acceptance conditions in
[intake.md](intake.md) or the port stops here.

**Contract artifact.** The board's provenance record (for cx3576:
`docs/design/bsp-cx3576-sync.md`) and the Provenance section of the board
dossier.

## Stage 2 — boot ROM, SPL, TF-A and U-Boot

**Goal.** A bootloader the SoC's boot ROM will load, satisfying the A/B
requirements of the BSP contract: `CONFIG_BOOTCOUNT_LIMIT`, redundant
environment, FIT support, the RAUC `BOOT_ORDER` handshake script, and a
rescue path.

**Inputs.** The intake decision from stage 1; the SoC's boot ROM load
address/medium facts; vendor blobs where unavoidable (cx3576: Rockchip DDR
init and TF-A binaries from `rkbin`).

**Procedure.** Build the bootloader reproducibly inside the board directory —
cx3576 pins a mainline U-Boot commit and its blobs in a Dockerfile and
produces two variants: a debug variant with no persistent environment, and
the A/B variant (`uboot-mos`) with the redundant environment pair the layout
reserves. Only the A/B variant may enter a mos image; the assemblers refuse
the debug blob. Encode the boot script from the board's `boot.cmd`, following
the handshake contract in
[docs/design/uboot-ab-handshake.md](../design/uboot-ab-handshake.md). Assert
every load-bearing configuration fact inside the build itself (cx3576 asserts
its `bootdev-order` and both stages' `BOOTCOMMAND` strings in the Dockerfile),
so a regression fails at build time, not on a bench.

> status: board-dependent — evidence: `boards/cx3576/bsp/uboot/Dockerfile`

A UEFI board skips all of this: x64 ships a `grub.cfg` for one static ESP and
compiles nothing, "by design, not by omission".

**Exit criteria.** The bootloader builds from a pinned commit; the A/B
variant's environment offsets match the layout's `UENV_*_OFFSET_BYTES`; the
board boots to a bootloader prompt or script on the bench (hardware evidence
— goes into the qualification matrix, never assumed).

**Contract artifact.** `boards/<name>/bsp/uboot/` and `boards/<name>/boot.cmd`
(or `grub.cfg` on a UEFI board).

## Stage 3 — kernel, config and DTS

**Goal.** A kernel that can mount the verity-protected root with no
initramfs, which means every boot-path option built in, `=y`, never `=m`.

**Inputs.** The vendor or mainline kernel tree pinned by commit; the shared
baseline fragment `boards/common/mos-required.fragment`; the board's device
tree.

**Procedure.** Start from the vendor config, merge the shared fragment
*before* `olddefconfig`, then assert every `=y` line of the fragment against
the built `.config` — the cx3576 kernel build fails on a missing mos-required
option rather than producing a kernel that cannot boot the root. Maintain the
board DTS in-tree under `bsp/kernel/dts/` (open-source route, no overlay
stacking) and local fixes as an ordered patch series under
`bsp/kernel/patches/`.

> status: board-dependent — evidence: `boards/cx3576/bsp/kernel/Dockerfile`

x64 follows the same procedure over mainline rather than a vendor tree, with
no patch series and no DTS: `boards/x64/bsp/kernel/` pins the tag and the
sha256 of `git archive` over it, merges the shared fragment and its own on top
of `x86_64_defconfig`, and records the resolved `.config` in-tree so the build
can refuse one that drifted.

**Exit criteria.** The kernel build passes its config assertions; `Image`,
`modules.tar` and the `.dtb` land in the BSP output; the modules tree version
equals the kernel release (the image assembler asserts this coupling — it is
absolute).

**Contract artifact.** `boards/<name>/bsp/kernel/` and its three artifacts.

## Stage 4 — firmware and calibration

**Goal.** Exactly the runtime firmware set in the signed root — no more, no
less — and a plan for per-unit calibration data that cannot live in a signed
image.

**Inputs.** Radio/peripheral firmware blobs from the vendor BSP, with their
redistribution rights confirmed in stage 1.

**Procedure.** Declare every firmware file the board needs as an installed
path in `BOARD_FIRMWARE_FILES` in `board.env`. The board package build stages
each declared entry and refuses paths outside `/usr/lib/firmware/`; the
verification suite asserts the assembled image carries the same set. Per-unit
calibration (MAC addresses, radio calibration) is factory data, not image
content — route it to stage 8.

> status: board-dependent — evidence: `boards/cx3576/deb/board-cx3576/render.sh`

**Exit criteria.** `BOARD_FIRMWARE_FILES` names only confirmed runtime files;
the board package builds; nothing firmware-shaped hides in the overlay.

**Contract artifact.** The `BOARD_FIRMWARE_FILES` list and
`boards/<name>/bsp/rootfs/firmware/`.

## Stage 5 — board.env

**Goal.** The board definition: one file, plain `KEY=value`, the single
source of truth every consumer reads and none duplicates.

**Inputs.** The partition layout decided with the bootloader (stage 2) and
the storage medium; the board facts accumulated so far.

**Procedure.** Write `boards/<name>/board.env` against the key reference in
[board-env.md](board-env.md). Declare the ordered partition set in
`LAYOUT_PARTITIONS` with a `<NAME>_ROLE` per entry; the schema lint enforces
each role's required keys and rejects keys a role does not use, in both
directions. Declare hardware as lists (`BOARD_FIRMWARE_FILES`,
`BOARD_HWINIT_CONFS`, `BOARD_RADIOS`) where empty is a statement, not an
omission.

> status: shipped — evidence: `make os-layout-lint`

**Exit criteria.** `bash verify/run.sh --lint boards/<name>/board.env`
passes.

**Contract artifact.** `boards/<name>/board.env` — the definition itself.

## Stage 6 — image layout

**Goal.** An assembled A/B disk image whose geometry a flashed fleet can live
with forever: offsets that never move once devices ship.

**Inputs.** `board.env`; the BSP artifacts from stages 2–4; the composed
rootfs.

**Procedure.** Extend or reuse an image assembler (cx3576 and x64 each have
one under `build/src/`) driven entirely by `board.env` — nothing shared may
know a board's shape. Respect the frozen-geometry rules: release builds pin
`MOS_ROOTFS_SLOT_MIB`, and growing a slot or `MOS_VAR_MIB` moves every later
partition, yielding a GPT no flashed device can accept. Run the image
contract verification against the assembled image.

> status: shipped — evidence: `make os-image-cx3576`

> status: shipped — evidence: `make os-verify-cx3576`

**Exit criteria.** The image assembles; `bash verify/run.sh --verify --board
<name>` is green.

**Contract artifact.** The assembler's board layout module and the verified
image contract.

## Stage 7 — hwinit

**Goal.** Board hardware brought up by declarative units, with board facts
separated from shared logic.

**Inputs.** The board's hardware inventory: radios, CAN, USB OTG/gadget,
LEDs, MAC provisioning needs.

**Procedure.** Ship one systemd unit plus one script per concern under
`boards/<name>/hwinit/`, reading its facts from `/etc/mos/<concern>.conf`;
declare the conf set in `BOARD_HWINIT_CONFS`. The facts themselves come from
`bsp/init/` and are staged by the board package. A board with no such
hardware declares the list empty — x64 does.

> status: board-dependent — evidence: `boards/cx3576/hwinit`

**Exit criteria.** Every declared conf has a unit that reads it and vice
versa (the rootfs build refuses a fact no script reads); units are inert on
absent hardware rather than failing.

**Contract artifact.** `boards/<name>/hwinit/` and the `BOARD_HWINIT_CONFS`
list.

## Stage 8 — factory provisioning

**Goal.** A repeatable path from a blank board to a flashed, individualized
unit.

**Inputs.** The assembled image; per-unit data (MAC, serial, calibration);
the SoC's recovery/flash mechanism.

**Procedure.** Document and script the flash path (cx3576: `rkdeveloptool`
via maskrom or the rockusb loader mode, driven from the BSP Makefile). Define
where per-unit identity lands — the state partition, or hardware fuses/OTP
where the platform provides them — and how the factory writes it. The
three-layer configuration model in
[docs/design/provisioning.md](../design/provisioning.md) defines how a device
is configured without a network after flashing.

> status: board-dependent — evidence: `boards/cx3576/bsp/Makefile`

**Exit criteria.** A written factory procedure a technician can follow; a
blank board becomes a booting, individually identified unit using only
documented steps.

**Contract artifact.** The board's flash targets and the factory section of
the board dossier.

## Stage 9 — update and recovery integration

**Goal.** The board participates in A/B updates and can always be recovered.

**Inputs.** The bootloader handshake from stage 2; RAUC's backend choice in
`board.env` (`RAUC_BOOTLOADER`).

**Procedure.** The RAUC `system.conf` is rendered from `board.env` — the
template plus the board definition are the single source of truth, never
hand-edited. Build and install a bundle end to end; on U-Boot boards, the
handshake contract (boot order, attempt credits in 1..9, health-gate
confirmation) is testable off-hardware. Prove the recovery story: what a unit
with a dead A slot, a dead bootloader, or a corrupt environment does, and how
the field recovers it (cx3576: recovery key to rockusb, boot-failure fallback
to rockusb, rescue SD that cannot override a bootable eMMC).

> status: shipped — evidence: `make os-bundle-cx3576`

> status: shipped — evidence: `make os-uboot-handshake-test`

**Exit criteria.** A bundle installs into the inactive slot and the order
flips (bench evidence for the qualification matrix); the handshake test suite
passes; every recovery path is written down in the dossier's Recovery method
section.

**Contract artifact.** `pkgs/rauc/system.conf.in` rendered per board, and the
handshake test suite.

## Stage 10 — release registration

**Goal.** The board exists as a product fact: registered, tiered, and
qualified — or honestly not.

**Inputs.** Everything above, plus qualification runs on real hardware.

**Procedure.** Add the board's row to the current-boards table in the BSP
contract. Fill a dossier per [board-template.md](board-template.md) — the
cx3576 instance is [cx3576-example.md](cx3576-example.md). Run the
field-reliability matrix per [qualification.md](qualification.md) on a named
revision; rows without hardware evidence stay `not tested`. Assign the
support tier per [support-tiers.md](support-tiers.md) — the tier is earned by
the evidence, not by the port compiling. Release signing follows
[docs/design/release-signing.md](../design/release-signing.md).

**Exit criteria.** Dossier complete and validating against the template;
qualification matrix filled with dated rows; tier assigned; the power-cut rig
run done before the board is called supported.

**Contract artifact.** The board dossier and the BSP contract's board table.
