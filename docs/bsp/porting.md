# BSP porting manual: blank board to supported board

This is the procedure companion to the BSP contract in
[docs/design/boards.md](../design/boards.md). The contract says what a board
must provide; this manual says in what order to provide it, what each stage
consumes, and what proves the stage is done. Where the two disagree, the
design record wins.

Two boards run through this manual as references:

- **cx3576** (CX3576-Z, RK3576) — the full-effort case: the board builds its
  own boot chain under `boards/cx3576/bsp/`, so every stage below applies.
- **x64** and **virt-arm64** use the platform's UEFI firmware plus the
  independently built signed systemd-boot manager and UKI. Each has a BSP kernel
  and current board definition; no boot script or raw-slot backend is used.

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

**Goal.** An authenticated boot-executable path with bounded, persistent trials.
Record every first mutable stage and vendor blob from intake. For cx3576, build
the fixed MOS firmware with the required public FIT keys and protected record
ranges. Assert required configuration verification, disabled persistent command
import, watchdog start before storage, and decrement/flush/readback before FIT
load. Debug BSP firmware is not a MOS installation substitute.

UEFI boards build the pinned systemd-boot manager and matching UKI stub and use
explicit Secure Boot enrollment. Test refusal when attempt persistence fails.
Each firmware result is a separate signed component maintenance input.

**Exit criteria.** Pinned builds and signature/persistence negatives pass;
physical boot/watchdog/recovery observations are recorded separately. Use
`make os-fit-records-test` for the cx3576 native C policy and the UEFI QEMU
harness for actual boot-manager selection.

> status: board-dependent — evidence: `boards/cx3576/bsp/uboot/build-mos.sh`, `pkgs/mos-boot`, `tests/file-ab-fit`

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
`bsp/kernel/patches/`, listed in that directory's `series` file.

> status: board-dependent — evidence: `boards/cx3576/bsp/kernel/configure.sh`, `boards/cx3576/bsp/kernel/patches/series`

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

**Exit criteria.** The current layout tests and explicit image verification pass.
`make os-layout-lint` is the existing contract gate.

**Contract artifact.** `boards/<name>/board.env` — the definition itself.

## Stage 6 — image layout

**Goal.** A complete current factory image with two authenticated deployments.
Use the exact three-partition layout from `board.env`; there is no old-layout
reader, frozen historical geometry or in-place migration requirement.

Package independent root, kernel/support and firmware inputs, sign two deployment
records, then run the component `image` command. Its capacity gate reserves
current, fallback and candidate space. Verify the explicit image and metadata
public-key files. DATA is last and is the only partition grown after assembly;
firmware and SYSTEM ranges/identities must remain unchanged.

**Exit criteria.** `make os-image` with its explicit inputs and `make os-verify`
pass, then the complete image reaches actual firmware boot and clean shutdown.
The DATA growth test validates the actual packed policy against a disposable disk.

> status: shipped — evidence: `make os-image`, `make os-verify`, `tests/repart-loader-test.sh`

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
where per-unit identity lands — DATA/state, or hardware fuses/OTP
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

**Goal.** Independent component updates, retained fallback and explicit recovery.
Exercise signed root-only, kernel-only and combined deployments on complete
current images. Verify unchanged object reuse, three failed trials, health-owned
confirmation, manual rollback refusal cases, reset retention and missing/shared
storage failure. Firmware writes belong only to its separate signed maintenance
flow.

Inject interrupted publication, confirmation and GC, and insufficient space.
For cx3576, add physical power cuts at object writes/sync, record activation,
trial decrement and health confirmation. No counter refill or boot-variable
editing may conceal a failure. Record the actual watchdog reset and cause.

**Exit criteria.** Applicable automated gates pass, and every claimed physical
path has dated board/image-bound evidence. Unrun physical cases remain pending.

> status: shipped — evidence: `tests/file-ab-x64/updates.sh`, `make os-fit-records-test`, `make os-file-transaction-faults`

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
