# RFCT-941 The installer reinstalls on every boot because its receipt never persists

- **status**: fixed and proven on hardware — the receipt survives the post-burn defenv and the card no longer reinstalls
- **priority**: P1
- **owner**: investigation/rfct-941-env-persistence-20260901
- **plan**: PLAN-910
- **exposedBy**: RFCT-940

## Reconciliation

This defect is fixed and proven on historical hardware. The record remains only
because the current S905X5M board dossier links to its evidence; RFCT-940 is a
bare historical ID whose full record remains in Git. No installer-card, RAUC,
raw-slot or compatibility operation below is a current instruction.

The PMA serializer rejected completion because the legacy free-text status is
not `in_progress`. Owner and status remain unchanged; D3 must not hand-edit
them. Current S905X5M acceptance begins from a fresh complete signed-file image.

## Description

A board with the installer card inserted burns the whole eMMC, reboots, and
burns again, indefinitely. Each cycle rewrites STATE, so the board takes a new
deviceId, a new hostname and a new DHCP lease every time, and SSH returns to off.

This is the defect RFCT-940 was hiding. Before that fix the board stopped at the
gate and never reached the code that writes the receipt, so the loop could not
appear.

The file-backed receipt that RFCT-940 replaced would NOT have had this defect.
`defenv_reserv` rewrites the U-Boot environment and does not touch files on a
FAT, so a receipt kept as a file survives it. s905x5m-alpine is the working
proof: it runs the same installer with `BM201_INSTALLER_RECEIPT_FILE` on
`mmc 1:1`, which on its layout is the real eMMC boot FAT, and it does not loop.

That constant was therefore correct for the layout it was written against. What
broke it here is that the mos layout puts `reserved` at partition 1 -- the
Amlogic calibration scratch mos never writes -- and moves the boot FATs to
partitions 5 and 6.

This does not reopen the fix. Moving the receipt out of any FAT is still the
right call for this layout, because the two FATs that do exist here are the A/B
boot slots, and a RAUC update rewrites the inactive one. It does mean the
environment brings a dependency the file did not: the vendor's post-burn
`defenv_reserv`, which is what this task adds the board-local reserve array
for.

## What is established

**The read and compare path is correct.** Writing the card's own package digest
into the variable by hand and rebooting with the card inserted produced:

    eMMC installer: bm201_installed_package matches update.img.sha256;
    skipping installation

The board booted Linux, and the previously installed SSH key still
authenticated, so STATE had not been rewritten. Setting the receipt is therefore
a complete workaround, and the loop stops immediately.

**The receipt is absent after a burn, not empty.** An earlier reading of
`fw_printenv bm201_installed_package` printing `bm201_installed_package=` was
taken to mean the variable existed with an empty value. It does not:
`fw_printenv` prints `name=` for an undefined variable as well, which a control
against a deliberately nonexistent name confirmed. So `env_save()` did not
persist it, rather than persisting an empty string.

**The environment itself survives the burn.** `BOOT_ORDER` and `BOOT_A_LEFT`
read back correctly on the same boot, so this is not general environment loss.

## What is ruled out

The vendor burner does not fail to return. `bm201upd.ini` sets `reboot = 3`,
which is `OPTIMUS_BURN_COMPLETE__POWEROFF_AFTER_DISCONNECT` (0x3), not a reboot;
that branch sets a flag, breaks, and returns normally. The hypothesis that
`ops->burn()` never returns, leaving the receipt write unreachable, is wrong.

## Source result

The receipt is saved after the burn and then deliberately removed during the
new bootloader's first boot. The remover is Amlogic's `defenv_reserv` path, not
the MMC environment writer and not `_update_env_list`.

The result was traced in the CoreELEC tree at `5f7ac2b1`, with patches
0001--0016 from this repository applied at baseline commit `6163d9dc` and
patch 0017 applied on top. The repository's current `s7d_bm201_defconfig` was
then used to generate the final config. The positive control
`CONFIG_AML_DEFENV=y` matched once; so did `CONFIG_AML_UPDATE_ENV=y`, the
redundant MMC backend, both approved offsets, and `CONFIG_CMD_SAVEENV=y`.

### The burn destroys and reconstructs the environment pair

`bm201upd.ini` sets `erase_flash = 1`. The parsed value reaches
`optimus_burn_with_cfg_file()`, which calls `optimus_storage_init(1)`. That
calls `store_erase(NULL, 0, 0, 0)`. For eMMC, a device-level erase becomes
`storage_mmc_erase(ERASE_ALL)`: it walks the GPT and skips only the partition
literally named `reserved` or a partition carrying `PART_PROTECT_FLAG`.

The `vendor-reserved` role in `board.env` is not visible to this code. The GPT
entries named `env`, `uenv-a`, and `uenv-b` are therefore erased. The complete
package subsequently writes the two intentionally zero-filled uenv payloads;
the running U-Boot reconstructs the active environment afterward.

There is no SDC-path environment reload after that erase. The only
`env_relocate()` under `v2_burning` is guarded by
`OPTIMUS_WORK_MODE_USB_PRODUCE`; `do_sdc_burn()` selects
`OPTIMUS_WORK_MODE_SDC_UPDATE`. There is no `env_reload()` in the v2 burning
tree. The in-memory environment from the running eMMC U-Boot therefore remains
the source for the post-burn saves.

### The receipt is the second successful redundant save

The package contains the special `bootloader` destination, so after writing it
the burn calls `optimus_set_burn_complete_flag()`. The U-Boot executing this
installer came from eMMC `boot0`, not SD or USB. Consequently
`aml_burn_check_uboot_loaded_for_burn()` returns false and the function sets
`upgrade_step=1`, then saves the in-memory environment into one newly blank
MMC copy.

Patch 0017 then sets `bm201_installed_package` and calls `env_save()`. The MMC
backend exports the complete hash table, increments the redundant serial, and
writes the other copy. Its validity toggle makes this second, receipt-bearing
copy the newest one. This rules out alternating-copy selection as the loss:
on the next load, the receipt-bearing copy wins.

The installer's readback is only an `env_get()` from that same in-memory hash
table, so `installation complete; receipt verified; resetting` is not by
itself a disk reload. It does, however, mean that `env_set()` succeeded and
that the MMC driver's `env_save()` returned zero.

### The first boot removes it before the installer gate

On the reset, `s7d_bm201` sets `defenv_para=-c` and immediately enters
`aml_board_late_init_front()`. Its first command is `aml_update_env`. With the
default `write_boot=0`, no `update_dts_gpt`, and the persisted
`upgrade_step=1`, `do_update_uboot_env()` runs:

    defenv_reserv; setenv upgrade_step 2; saveenv

`defenv_reserv` is the unique command abbreviation for `defenv_reserve`. With
no explicit arguments its wrapper expands `${defenv_para}`, so this board
actually invokes `_aml_defenv_reserve -c`. `_do_defenv_reserv()` consequently
selects only the common `_aml_env_reserv_array`. The receipt occurs zero times
in that array and zero times in the compiled default environment.

`_reserve_env_list_after_defenv()` copies only the selected variables, calls
`env_set_default()`, and restores the copies. That removes
`bm201_installed_package`; the following `saveenv` writes the receipt-less
defaults with a still newer redundant serial. Only after this sequence does
the BM201 boot menu run `bm201_boot_source auto`, whose first action is the
installer gate. It therefore sees an absent receipt and burns again.

The surviving `BOOT_ORDER` and `BOOT_A_LEFT` observation does not contradict
this sequence. The mos boot script creates either variable when absent and
persists the pre-boot credit update, so they can be present again by the time
Linux reads the environment. They are not evidence that the earlier
`defenv_reserv` retained an unrelated variable.

`_update_env_list` is unrelated. It is a temporary list assembled only inside
`update_env_part`; that function copies stored variables not named by the
caller. Neither `aml_update_env` nor the SDC completion path calls it for this
receipt.

## Proposed fix

Use the board-local new-mode reserve hook already implemented by
`defenv_without.c`:

1. Declare `_board_env_reserv_array0[]` in `s7d_bm201.c`, containing
   `BM201_INSTALLER_RECEIPT_ENV` and the terminating `NULL`.
2. Select it by setting `defenv_para` to `-c -b0`, and to `-c0 -b0` in the
   existing `default_env` branch. Declaring the legacy `_env_args_reserve_[]`
   alone would not work: the board's `-c` argument makes that no-argument list
   unreachable.
3. Add a build-time source contract and a focused next-boot test that start
   with `upgrade_step=1` plus a receipt, perform the selected default-and-save
   transition, reload the redundant environment, and require the exact receipt
   to remain.

Do not add the board-specific variable to the shared
`_aml_env_reserv_array`, and do not force `upgrade_step=2` in the installer.
The former changes every Amlogic board; the latter skips the vendor's intended
first-boot default migration after a bootloader replacement. The board-local
array preserves that migration while retaining only the one additional value
this board owns.

Preserving the receipt through the `default_env` branch means a factory reset
does not silently turn an inserted card into a same-package reinstall. If a
future recovery workflow needs that behaviour, it should explicitly clear
`bm201_installed_package` rather than depend on an unrelated environment
default operation.

## Implementation

Patch `0018-s7d-preserve-installer-receipt-across-defenv.patch` implements the
approved board-local hook. `s7d_bm201.c` now includes the installer contract,
declares `_board_env_reserv_array0[]` with exactly
`BM201_INSTALLER_RECEIPT_ENV` and `NULL`, and selects it with `-c -b0` during a
normal boot or `-c0 -b0` in the existing `default_env` branch.

The U-Boot build now requires exactly 18 patches. Its source contract first
proves that the installer receipt macro, the board hook, and the shared common
array are all present. It then requires the exact two-element board array and
both `defenv_para` values. The two explicit refusals are gates: the receipt has
zero occurrences in `board/amlogic/common/board.c`, and `upgrade_step` has zero
occurrences in `emmc_installer.c`. A missing negative pattern is counted as
zero rather than allowed to terminate the search.

The focused host test starts with two valid redundant copies, as the completed
burn leaves them: serial 1 has `upgrade_step=1`, and the newer serial 2 also has
the exact 64-character receipt. Its negative control proves that the old `-c`
selection drops the receipt. It then runs the approved `-c -b0` default,
applies the vendor's `upgrade_step=2`, saves serial 3 to the other copy, clears
the in-memory environment, reloads the newer redundant copy, and requires the
exact receipt and step 2 to survive.

The shared `_aml_env_reserv_array` and the installer's upgrade-step handling
were not changed. The installer configuration header was not changed either,
so its two consumers did not need parallel edits; both scripts still pass
`bash -n`, and the private installer configuration contract was rerun.

## Build evidence

Two consecutive `make s905x5m-uboot` runs completed with status 0 on
`debian13` at `192.168.27.200`. The first forced the new patch layer and the
second reran the tightened count-reporting contract. These are the exact
relevant lines emitted across those runs:

```text
>> applying 0018-s7d-preserve-installer-receipt-across-defenv.patch
Applied patch bl33/v2023/board/amlogic/s7d_bm201/s7d_bm201.c cleanly.
ok: BM201 board-local defenv reserve contract board-receipt=1 shared-receipt=0 installer-upgrade-step=0 normal=1 default=1 legacy-normal=0 legacy-default=0
BM201 reusable eMMC installer state tests passed
ok: BM201 next-boot defenv preserves the exact installer receipt after redundant reload
BM201 production installer FAT context test passed
section 5: board-owned U-Boot requirements pass; tree-wide FIT security debt remains
```

The separate private installer contract printed exactly:

```text
ok: private installer contract uses 1792 MiB FAT, 1536 MiB package bound, and 18 complete-package entries
```

The section 3 artifact export contains:

| artifact | bytes | SHA-256 |
|---|---:|---|
| `u-boot.bin.signed` | 3,321,856 | `0bddedf217bbaaabc423eba62cf059c68f265c764001924ae1ffb0e4d9634c69` |
| `u-boot.bin.sd.bin.signed` | 3,322,368 | `0a508aa1f40cacee8472a721aee3651a50717246b7440474a8fc41cea2edf0a1` |
| `DDR.USB` | 3,321,856 | `c0809bf8cb74194224ca95abf19f2b04014b4efcabf34770423361a38127afa0` |

## Proven on hardware

The card was written and the board taken through the cycle. Patch 0018 is on the
board and the receipt survives:

    defenv_para             = -c -b0
    bm201_installed_package = 604fdd33733c7b438b2d89b0f23a453a0d1e115a7c5514599847e64d6dad4e9d
    upgrade_step            = 2
    mosd 0.1.0 (866ac18b309d)

`defenv_para` carrying `-b0` is the fixed U-Boot running, and the receipt is the
card package's exact digest, so it was written before the reset and was still
there after `aml_update_env` ran the post-burn `defenv_reserv`. That is the step
that used to remove it.

The final criterion this task set -- that identity survives another reboot with
the card inserted -- also holds. After a further reboot the hostname is still
`mos-7477a087`, the web interface redirects to `/login` rather than `/setup`, and
the previously installed SSH key still authenticates. A reinstall would have
rewritten STATE and reversed all three. The card is still in the slot, the board
boots to Linux, and the front-panel renderer is active.

One caution for anyone repeating this: the board took about three minutes to
become reachable after that reboot, and an SSH attempt at thirty seconds timed
out. A single failed connection is not evidence of a reinstall -- scan for the
web interface and read whether it offers `/login` or `/setup`.

## The procedure that was planned instead

No board or installer card was written while implementing this fix. A green
source contract and host model do not prove that the new U-Boot executes on
the board or that the redundant MMC pair reloads the same way on silicon.

Hardware confirmation needs one installer-card cycle. A USB burn is NOT required
first, and the claim that it is confused this defect with RFCT-940.

RFCT-940 was undeliverable by card because its gate failed closed before the
burn: no install ran, so no payload landed. This gate passes -- the board
already carries patch 0017 -- so the card's install does run. The old U-Boot
performs the burn, the new U-Boot lands on eMMC, and the boot that follows runs
it. Patch 0018 does not have to be executing to be installed; it only has to be
executing on the post-burn boot, which is exactly the boot where the receipt
must survive.

The precondition was checked against the live board: `defenv_para` reads `-c`
with no `-b0`, so the running U-Boot predates 0018, and the receipt holds
`58baf9a1...`, the previous package. The rebuilt card carries `604fdd33...`, so
the digests differ and the first boot installs rather than skipping.

The artifact to write is `disk.img`, 1,900,019,712 bytes, SHA-256
`84f80a91f692b404720306c2a426b5328c90e55d3546e8c8fbbc61baf7f57ee0`, carrying
package `604fdd33733c7b438b2d89b0f23a453a0d1e115a7c5514599847e64d6dad4e9d`. The
package embeds a U-Boot built `2026-09-01 15:01:25`, later than 0018's commit at
`14:54:56`, and the card was read back byte for byte: the package sits at offset
`0x785000` and hashes to its own digest. Seven `update.img` files of identical
length exist locally, so select by digest and not by name.

One full card install must be allowed under serial capture, and the capture must
stop the automatic path before any possible second burn.
The serial host currently has `minicom`, `/dev/ttyUSB0`, and the established
921600 8N1 connection. Start the capture with:

```sh
capture="/tmp/rfct941-install-$(date -u +%Y%m%dT%H%M%SZ).log"
ssh 192.168.27.50 'test -c /dev/ttyUSB0 && ! lsof /dev/ttyUSB0'
printf 'capture=%s\n' "$capture"
ssh -t 192.168.27.50 \
  "stty -F /dev/ttyUSB0 921600 cs8 -parenb -cstopb -ixon -ixoff -crtscts raw -echo &&
   exec minicom -o -8 -b 921600 -D /dev/ttyUSB0 -C '$capture'"
```

With the rebuilt installer card inserted, stop at the first BM201 boot menu
with Ctrl-C and issue exactly:

```text
printenv upgrade_step defenv_para bm201_installed_package
env exists bm201_installed_package
echo receipt-before-status=$?
bm201_boot_source auto
```

The last command authorizes the one full rewrite. After its automatic reset,
press Ctrl-C at the next three-second BM201 menu. `aml_update_env` has already
run by that point, but the automatic installer has not. Issue:

```text
printenv upgrade_step defenv_para bm201_installed_package
env exists bm201_installed_package
echo receipt-after-status=$?
if env exists bm201_installed_package; then
  bm201_boot_source auto
else
  echo receipt missing; refusing second install
fi
```

`env exists` returns zero when present and one when absent. The conditional
prevents a failed fix from authorizing a second full rewrite. When the receipt
exists, `bm201_boot_source auto` must skip the installer and boot Linux; it must
not start another burn. Inspect and seal the capture with the same shell
variable:

```sh
ssh 192.168.27.50 \
  "sha256sum '$capture';
   grep -nE 'Set upgrade_step to 1|Saving Environment to MMC|installation complete; receipt verified; resetting|after recovery update, need update uboot env|defenv_para -c -b0|bm201_installed_package matches update.img.sha256|starting sdc_burn|burn did not return zero|burn succeeded but bm201_installed_package could not be written' '$capture'"
```

Confirmation requires all of the following in one capture: the first burn
reaches `installation complete; receipt verified; resetting`; the new boot
enters the recovery-update path with `defenv_para -c -b0`; the final existence
status is zero and `printenv` shows the exact card digest; the installer prints
`bm201_installed_package matches update.img.sha256; skipping installation`;
and Linux boots without a second `starting sdc_burn`. After Linux is up, the
installed identity, hostname, SSH setting and key must remain unchanged across
another reboot with the card inserted. Anything less leaves the hardware
assertion open.
