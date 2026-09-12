# 20260912-2253-rockchip-update-image Produce a Rockchip update.img for CX3576

- **status**: draft
- **createdAt**: 2026-09-12 22:53
- **approvedAt**: (pending)
- **relatedTask**: 20260912-2251-rockchip-update-image

## Context

### Current delivery

`make os-image-cx3576` writes `mos-cx3576-<ts>.img` (1299 MiB). The BSP
Makefile flashes it with `rkdeveloptool wl 0`, reads the whole image back
(`boards/cx3576/bsp/scripts/verify-flash.py`) and then resets. Maskrom
recovery first pushes the pinned vendor `uboot/MiniLoaderAll.bin` with `db`.
`boards/cx3576/bsp/README.md` and the RFCT-007 changelog entry record that no
`update.img` is built.

On-disk layout (`boards/cx3576/board.env`, `LAYOUT_VERSION=3`):

| Range (sectors) | Content | GPT |
|---|---|---|
| 0-33 | protective MBR, primary GPT | - |
| 64 | mainline idbloader: `RKNS` header, TPL (DDR v1.12) + SPL, no boost | `firmware` p1 starts here |
| 16384 | `u-boot.itb` (BL31 + U-Boot) | p1 |
| 32768 / 34816 | boot record copies A / B, 64 KiB each | p1 ends 36863 |
| 36864 | `system`, 1 GiB | p2 |
| 2134016 | `data`, 256 MiB, grows on first boot | p3 |

The signed firmware artifact is the whole `u-boot-rockchip.bin`
(`build/src/firmware.ts`: `rockchip-loader`, disk offset 32768, max 16744448
bytes). `build/src/firmware-maintenance.ts` reads sectors 64-36863 back and
requires the installed artifact bytes to match exactly.

Layout consumers that encode the geometry or GPT identity:

- `boards/cx3576/bsp/uboot/mos-file-boot.c` `valid_layout`: partition count,
  numbers, starts, names, sizes (DATA may be larger). No GUID check.
- `build/src/file-layout.ts` (+ test): LAYOUT_VERSION 3, start sector 64,
  FIRMWARE type GUID `8da63339-...`, loader range.
- `build/src/file-image.ts`, `build/src/fit-environment.ts`: firmware region
  and raw image assembly.
- `boards/cx3576/deb/board-cx3576/render.sh`: repart definitions matched by
  partition **type GUID**; fstab mounts DATA by **PARTUUID**.
- `rootfs/overlay/usr/lib/mos/mos-grow-data`: requires the SYSTEM PARTUUID,
  SYSTEM to be **partition 2**, and the disk **PTUUID** to equal `DISK_GUID`.
- `boards/cx3576/bsp/scripts/verify-flash.py`,
  `tests/cx3576-flash-verify-test.sh`, `tests/repart-loader-test.sh`,
  `verify/src/file-image.ts`.
- Runtime `mosd` resolves partitions by partlabel.

### Rockchip update.img format

Source: Rockchip RK3576 Linux 6.1 SDK
(`device/rockchip/.chips/rk3576/parameter.txt`,
`common/scripts/mk-updateimg.sh`, mirrored at `radxa/device-rockchip`
branch `rk3576-linux-6.1`) and `rockchip-linux/rkdeveloptool`
(`RKImage.h`, `main.cpp`).

```
update.img = RKFW header (0x66 bytes: chip tag, time, loader offset/size, RKAF offset/size)
           + loader (LDR "MiniLoaderAll.bin")
           + RKAF (afptool): header + items {name, file, flash offset, size}
               package-file, parameter.txt, bootloader, <partition>.img ...
           + MD5 trailer
```

- `afptool -pack ./ update.raw.img` then
  `rkImageMaker -RK3576 MiniLoaderAll.bin update.raw.img update.img -os_type:androidos`.
  The chip tag comes from loader bytes 21-24; the pinned vendor loader reads
  `RK3576`. Neither tool is in rkbin; both are closed SDK binaries.
- SDK `parameter.txt`: `TYPE: GPT`, `CMDLINE: mtdparts=:size@offset(name),...,-@offset(userdata:grow)`,
  sector units, first partition at `0x4000`, `uuid:<part>=<guid>` sets a
  partition unique GUID. No disk GUID or type GUID syntax is documented.
- SDK `package-file` is generated: `package-file`, `parameter`, `bootloader`,
  one `<part>.img` per named partition that has an image, `backup RESERVED`.
- Tool flow: download 471 (DDR) and 472 (usbplug); build the IDB from the
  loader's FlashHead/FlashData/FlashBoot entries and write it to the IDB area;
  write GPT from `parameter.txt`; write each packaged image at its named
  partition.
- rkbin `ecb4fcbe` (already pinned) ships `RKBOOT/RK3576MINIALL.ini`
  (471 DDR v1.12, 472 usbplug v1.04, loaders boost v1.03 + DDR v1.12 +
  SPL v1.08, `NEWIDB=true`, `IDB_PATH` output), `tools/boot_merger` and
  `tools/upgrade_tool` (x86_64).

### Conflicts with the current design

1. **Loader identity.** The vendor MiniLoaderAll carries the vendor SPL; an
   update.img built with it replaces the Mica OS SPL on disk. Even with our
   SPL, the tool-built IDB is not the mkimage idbloader, so firmware
   maintenance's byte-exact check fails on a tool-flashed board.
2. **IDB overlap.** p1 starts at sector 64, inside the area the tool writes
   the IDB to. Which bytes win depends on the tool's write order.
3. **GPT identity.** The tool creates the GPT. Unless measured otherwise, the
   disk GUID and type GUIDs are not ours: `mos-grow-data` refuses the disk
   and repart cannot pair its definitions.
4. **Transport.** Mainline U-Boot rockusb implements a subset of the vendor
   protocol; the full upgrade likely needs Maskrom (usbplug).

## Proposal

One layout serves both artifacts: the raw image and `update.img` put the
same bytes on the same sectors. Milestones run in order; M0 fixes the facts
the layout depends on.

### M0 - Bench measurement (hardware, blocks M2)

On the local cx3576 bench board, flash the vendor factory update.img with
RKDevTool (Maskrom) and read back sectors 0-0x9000 plus both GPTs. Record in
`docs/boards/cx3576-bench.md`:

- disk GUID and per-partition type/unique GUIDs; whether `uuid:` is honored;
- IDB location and copies, and whether the written bytes equal boot_merger's
  `IDB_PATH` output for the same ini;
- whether the tool erases or writes sectors outside listed partitions;
- behavior when the board is in Mica OS U-Boot rockusb (Loader mode).

Then repeat with a hand-built update.img whose first partition starts at
`0x40` to decide layout option A' versus A (M2).

### M1 - Mica OS loader (U-Boot builder)

- Add a repo-owned ini derived from `RK3576MINIALL.ini`: 471 DDR v1.12,
  472 usbplug v1.04, FlashData DDR v1.12, FlashBoot = our `u-boot-spl.bin`.
  Boost is omitted to keep today's proven TPL+SPL chain unless M0 shows the
  tool requires it.
- Run rkbin `tools/boot_merger` in `boards/cx3576/bsp/uboot/Dockerfile`;
  export `rk3576-mos-loader.bin` and its `idblock.img`.
- Build `u-boot-rockchip.bin` as `idblock.img` padded to sector 16384 plus
  `u-boot.itb`, so the signed firmware artifact is exactly what the tool
  writes. Keep the RKNS and size checks in `kernel-package.ts` and
  `fit-environment.ts`.
- The pinned vendor `MiniLoaderAll.bin` stays as the Maskrom recovery loader.

### M2 - Layout v4

Preferred **A'** (if M0 shows the tool writes the packaged image at 0x40
and the IDB bytes equal `idblock.img`): keep three partitions and today's
sectors; only GPT identity changes.

```
CMDLINE: mtdparts=:0x00008fc0@0x00000040(firmware),0x00200000@0x00009000(system),-@0x00209000(data:grow)
```

Otherwise **A**: a separate unpackaged `idbloader` partition keeps the
loader inside the GPT (the invariant `tests/repart-loader-test.sh` protects),
and `firmware.img` starts at `0x4000`.

```
CMDLINE: mtdparts=:0x00003fc0@0x00000040(idbloader),0x00005000@0x00004000(firmware),0x00200000@0x00009000(system),-@0x00209000(data:grow)
```

Both options:

- Set `LAYOUT_VERSION=4`. Take GUIDs from M0: partition unique GUIDs through
  `uuid:`; type GUIDs in `board.env` become the values the tool writes, so
  repart pairs on both flash paths.
- `mos-grow-data`: drop the PTUUID equality and the literal partition number;
  authenticate the disk through the SYSTEM PARTUUID it already checks and the
  `board.env` partition number.
- Update `valid_layout`, `file-layout.ts`, `file-image.ts`,
  `fit-environment.ts`, `render.sh`, `verify-flash.py`, `verify/src`, and the
  repart and flash tests to the new geometry. The shared parser keeps the
  other boards at LAYOUT_VERSION 3.

### M3 - Packer (`build/src`, TypeScript)

- `rockchip-update.ts`: render `parameter.txt` and `package-file` from
  `FileLayout`; write RKAF and RKFW with CRC and MD5; stream partition images
  and refuse anything past the format's 32-bit size fields.
- Wire it into the CX3576 image stage: publish `mos-cx3576-<ts>.update.img`
  with a `SHA256SUMS` entry.
- Tests first: header fields, item offsets and checksums; parameter geometry
  derived from `board.env`; oversize and missing-item refusals.
- Cross-check: a test target unpacks the output with an independent
  open-source unpacker (`soundtrackyourbrand/rk-tools`, pinned commit, test
  container only) and compares every item.

### M4 - Static verification and docs

- `verify/src`: unpack `update.img`, then require that the loader's IDB
  equals the raw image's IDB range, the parameter geometry equals the raw
  GPT, and each packaged image equals its raw partition range.
- Docs: rewrite the bsp README flashing section (RKDevTool upgrade path next
  to `flash-mos`), `docs/user/install.md` and `docs/zh/user/install.md`, the
  cx3576 dossier and storage geometry; add a `[decision]` changelog entry that
  supersedes RFCT-007 item 2.

### M5 - Physical acceptance (hardware)

RKDevTool Upgrade Firmware from Maskrom and from Loader mode on the bench
board; then `rl` readback compared against the raw image, signed boot, DATA
growth, a boot record transaction, and `maintainFirmware` on the
tool-flashed board. Results go to `docs/boards/cx3576-bench.md`; anything not
run stays marked not run.

## Risks

- **Mainline SPL through boot_merger:** unproven on RK3576; M0/M5 on bench.
  Fallback: ship the vendor SPL in the loader and accept an on-disk SPL that
  differs from the raw image. This is a separate decision, not a default.
- **boot_merger is x86_64-only:** the U-Boot builder must run on amd64.
  Fallback: build `tools/boot_merger.c` from Rockchip's U-Boot tree.
- **Tool-generated GPT:** if `uuid:` is ignored, fstab and repart need
  label- or type-based matching instead of PARTUUID; M0 decides.
- **IDB copies:** extra IDB copies inside 64-16383 would break the
  byte-exact firmware check; M0 measures them and M1 folds them into
  `idblock.img` padding.
- **Size:** RKAF/RKFW use 32-bit sizes; about 1.3 GiB today. The packer
  refuses more than 4 GiB.
- **Verification gap:** RKDevTool has no whole-disk readback. `flash-mos`
  stays the developer path with readback; M5 proves the tool path once per
  layout.
- **Active work:** 20260912-2043-unify-board-behavior changes delivery
  compression (update.img must be delivered uncompressed or decompressed
  before use); 20260911-2003-split-package-repositories touches `build/`.

## Scope

- Hardware-free (M1-M4): roughly 20 files across `boards/cx3576`, `build/src`,
  `rootfs/overlay`, `verify/src`, `tests/` and docs; one new TS module plus
  tests.
- Hardware (M0, M5): bench time on one cx3576 with USB and serial console.
- Out of scope: Rockchip A/B OTA packages, SPI NOR, SD upgrade cards, secure
  boot signing (`rk_sign_tool`), replacing the vendor recovery loader, and
  other boards.

## Alternatives

- **RKDevTool "Download Image" with the raw image at 0x0.** Works today with
  no build change, but FactoryTool, SDDiskTool and "Upgrade Firmware" cannot
  use it. Documenting it is a cheap interim step, not a replacement.
- **SDK `afptool` / `rkImageMaker` binaries.** Less code, but vendoring
  closed x86_64 tools was the reason RFCT-007 was closed; the format is small
  enough to own.
- **Layout option B** (three partitions, firmware from 0x4000, IDB outside
  GPT): smaller than A, but it reopens the repart discard hazard.

## Annotations

- 2026-09-12: The user requested this plan after reviewing the SDK
  `parameter.txt` / `package-file` findings. Compatibility with layout v3 is
  not required.
- Open: path to the vendor factory update.img
  (`rk3576_linux6.1_20260727.171210.img`) and bench availability for M0.
