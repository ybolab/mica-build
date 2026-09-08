# RFCT-940 The installer card blocks Linux boot on a board it already installed

- **status**: fixed and proven on hardware — the gate now clears; it exposed a second defect, [RFCT-941](RFCT-941.md)
- **priority**: P1
- **owner**: unassigned
- **createdAt**: 2026-09-01 UTC
- **plan**: [PLAN-910](../plan/PLAN-910.md)

## Description

An installer card inserted into a board that already runs mos stops it from
booting Linux at all. The board sits at the U-Boot prompt with no Linux
attempted, and it stays that way across resets while the card is present.

Observed on the board at `192.168.27.62` after writing the front-panel
installer card recorded in PLAN-910:

    eMMC installer: failed to select eMMC boot FAT mmc 1:1
    BM201 boot source: installer gate failed (1); Linux boot stopped

## Root cause

`bm201_boot_source_run()` runs the installer gate before it picks any Linux
source, and treats a non-zero installer result as fatal:

    outcome->installer_status = ops->run_installer(context);
    if (outcome->installer_status)
            return BM201_BOOT_SOURCE_INSTALLER_FAILED;

The gate fails at the receipt step. The installer keeps its
`emmc-system-installed.sha256` receipt on a FAT it addresses as a compile-time
constant:

    #define BM201_INSTALLER_EMMC_DEVICE "1:1"

On the vendor eMMC layout that partition is a FAT the installer can open. The
mos layout that this same installer writes puts `reserved` at partition 1 --
type `0fc63daf-8483-4772-8e79-3d69d8477de4`, not FAT -- and the two boot FATs at
partitions 5 and 6. So a successful install destroys the store its own receipt
lives in, and the next boot with the card inserted cannot select it.

This is self-defeating rather than a card or package defect. The card was
verified correct on the spot: `fatls` showed all four files, the marker read back
as the exact `BM201_INSTALL_V2` request, and `update.img.sha256` matched the
package byte for byte.

## Evidence

The eMMC was intact and bootable the whole time. Its GPT carried all twelve mos
partitions with the expected GUIDs, and both boot slots were fully populated --
`Image` at 32,135,680 bytes, `boot.scr`, the slot's verity env, and the DTB. The
board was recovered from the U-Boot prompt without touching any storage by
running the eMMC path directly, which is what the gate would have run had it
passed:

    mmc dev 1
    fatload mmc 1:5 ${loadaddr} boot.scr
    source ${loadaddr}

It booted slot A to a login prompt with the network up.

## Why the failure is worse than it looks

`BM201_INSTALLER_NO_REQUEST` is 0 and maps to `CMD_RET_SUCCESS`, so a board with
no card boots normally. The failure needs the card to be present, which is
exactly the state an owner leaves the board in after installing. Removing the
card is a complete workaround and needs physical access.

## Why partition 1 cannot simply be made a FAT

The obvious repair -- format the eMMC `reserved` partition so `1:1` opens -- is
the one repair that must not be made. `board.env` states the constraint:

    # p1 -- RESERVED, 36..100 MiB. Vendor-owned and never written by mos on
    # eMMC. This is the range the stock GPT calls `reserved`; it holds the
    # Amlogic multi-DTB payload at +4 MiB and the MMC calibration scratch the
    # driver addresses absolutely.

So `1:1` is not accidentally not-a-FAT. It is the region mos deliberately never
writes, and a receipt written there would land in the calibration scratch that
has corrupted this board before. The failing select is protecting the board.

The constant was most likely carried over from `BM201_INSTALLER_SD_DEVICE
"0:1"`, which is correct: the `-sd-` assembler does format that same offset as a
FAT, but only inside the SD image, as the vendor cfgload bridge.

## Proposal

Keep the receipt on the eMMC, since a per-card receipt would regress RFCT-928's
reusable installer to one-shot, and store it in the U-Boot environment rather
than in a file on any FAT.

| receipt location | first install on stock eMMC | after an install | after a RAUC update |
|---|---|---|---|
| `1:1`, today | opens | fails: calibration scratch | -- |
| p1 formatted FAT | opens | opens | opens, but writes the scratch |
| the card's own FAT | opens | opens | opens, but one card installs one board |
| `1:5`, the boot FAT | absent | opens | lost when RAUC rewrites slot A |
| the U-Boot environment | present | present | present |

Only the environment is available under both layouts. It also removes the
failure mode rather than relocating it: there is no store to select, so
`RECEIPT_SELECT_FAILED` and `RECEIPT_FINAL_SELECT_FAILED` stop existing. An
environment whose CRC does not verify reads as absent, which is the same
"no receipt, install" path as a missing file, so the fail-open direction is
unchanged. The seam is already present -- `env.h` is among the host stubs the
installer tests compile against.

The cost is a U-Boot rebuild, and a package and card rebuilt on top of it. The
960-line `emmc_installer_test.c` covers the receipt in 111 lines and has to move
with the change.

## Implementation

`0017-s7d-keep-the-installer-receipt-in-the-environment.patch` moves the receipt
into `bm201_installed_package`. `select_emmc` leaves the ops struct, and with it
`RECEIPT_SELECT_FAILED`, `RECEIPT_STAT_FAILED` and
`RECEIPT_FINAL_SELECT_FAILED`. The environment stores the 64 hex characters
alone; the read op restores the trailing newline the identity file carries, so
the whole-identity comparison is unchanged.

An absent variable and a variable whose CRC does not verify both read as
missing, which is the same "no receipt, install" path a missing file took. The
fail-open direction is therefore unchanged, and a lost receipt costs one
reinstall rather than a board that will not boot.

The production seam test now asserts that a complete install writes **zero**
files to any FAT, down from one, and the FAT operation counts fall with it: 17
selects to 12, 13 closes to 10, 5 existence checks to 4, 3 reads to 2. Both test
variants pass inside the U-Boot build, which also re-ran the private installer
contract check.

## The artifact the fix produced

Rebuilt on the fixed U-Boot: package 1,369,400,096 bytes, SHA-256
`58baf9a1047250b0c9424b925ee6dd09f9a09c3bf6ac23fbbe36ae284d9acaf3`; card
1,900,019,712 bytes, SHA-256
`54ed8bcce976d1d8a233fb76b210b8cbb75a0c08a91af261921b22b087b34f3e`. Both sizes
match the pre-fix set, as expected for fixed-length package regions and a fixed
FAT. The card was read back byte for byte: the package sits at offset `0x785000`
and hashes to its own digest.

The card builder needed a second commit. It read the receipt file name from the
header only to refuse that file on the card, so removing the define broke the
build after the U-Boot side was already green. The refusal is kept as a literal:
a card carrying the old receipt would still be wrong, because the receipt
belongs to one eMMC and a card installs many.

## The fix cannot be delivered by the card it fixes

The rebuilt card was written and booted. It failed identically:

    eMMC installer: failed to select eMMC boot FAT mmc 1:1
    BM201 boot source: installer gate failed (1); Linux boot stopped

That is correct behaviour, not a second defect. The U-Boot that runs the
installer gate is the one on eMMC, because the BootROM reaches eMMC before SD.
The board reported `s_version: 01.01.260901.020008`, and the two binaries
separate cleanly: the pre-fix U-Boot carries `2026-09-01 02:00:18`
(`dc4b7060...`), the fixed one `2026-09-01 09:09:38` (`bcf7bd0d...`). The board
was running the pre-fix build, as it will after any number of card rewrites.

The fix ships inside `update.img`, which reaches eMMC only if the installer
runs, and the installer is the thing that is broken. **A card can never deliver
this fix.**

PLAN-910 already stated the constraint under "Bootstrap boundary": *"Before
either can use the reusable card, host USB burning must install a new complete
mos package... The card's LBA-1 U-Boot cannot bootstrap an eMMC-first BootROM
path."* The same section records why the device cannot rescue itself: the
in-device `sdc_burn` path needs a working U-Boot, so it cannot recover a
replacement that fails before the prompt.

Reading that before proposing a card rewrite would have saved the attempt. The
card was rebuilt and written on the assumption that the hardware assertion was
merely untested, when it was structurally unreachable.

## What delivers it

Host USB burning, the one entry that does not depend on what eMMC already
holds. The package to burn is 1,369,400,096 bytes, SHA-256
`58baf9a1047250b0c9424b925ee6dd09f9a09c3bf6ac23fbbe36ae284d9acaf3`; per
PLAN-910 the checksum is confirmed before the write, not after. Card
installation becomes available only after that, and mostly matters for the
second board onwards, which is what a reusable card is for.

## Proven on hardware

Host USB burning put the fixed U-Boot on the board's eMMC, which made the fix
reachable for the first time. With the card inserted and a receipt present, the
board printed:

    eMMC installer: bm201_installed_package matches update.img.sha256;
    skipping installation

and booted Linux. The installed SSH key still authenticated afterwards, so STATE
had not been rewritten: the install really was skipped rather than repeated.

That closes this defect. The environment-backed receipt is read, compared and
honoured, and the gate no longer refuses a board it has already installed.

## What it exposed

The board could not reach the receipt-writing code before, because it stopped at
the gate. With the gate open it gets there, and the receipt is not persisted: a
board with the card inserted reinstalls on every boot. That is a second defect on
the same path, recorded as [RFCT-941](RFCT-941.md), and the file-backed receipt
this task replaced would have had it too.
