# RFCT-911 Establish whether vendor U-Boot can automatically roll back

- **status**: completed
- **priority**: P1
- **owner**: investigation/uboot-rollback-20260830
- **createdAt**: 2026-08-30 13:40
- **plan**: PLAN-910 M3 prerequisite

## Description

Determine from the pinned vendor U-Boot source and the captured factory
environment whether this board counts and persists boot attempts, handles a
kernel-start failure by abandoning the current slot, uses `rollback_flag`,
enables `CONFIG_BOOTCOUNT_LIMIT`, and can consume RAUC's `BOOT_ORDER` /
`BOOT_<slot>_LEFT` contract without an adapter.

This is an offline investigation only. It performs no hardware, environment,
bootloader, or partition write.

## ActiveForm

Establishing the vendor U-Boot automatic-rollback contract.

## Dependencies

- **blocked by**: (none)
- **blocks**: PLAN-910 M3 bootloader ownership decision

## Notes

- Every negative source search must carry a positive control and a pinned-tree
  identity check before it is accepted as evidence.
- Completed as an offline, read-only investigation at 2026-08-30 13:58 UTC.
  No board, bootloader, environment, or partition was written.

## Result

The factory Android path does have a Virtual A/B retry-and-rollback state
machine for a returned `bootm` or a subsequent reset, but the current mos
`cfgload` path does not preserve the complete failure path. No bootloader
watchdog timer for a kernel hang was established. In particular, RAUC's
`uboot` backend cannot drive the vendor mechanism as-is.

There are two distinct BL33 images in the evidence and they must not be
conflated:

- The captured factory BL33 identifies itself as
  `U-Boot 2023.01-g61544dc3b9a-dirty bl-3.5.15`, says `boot in VAB mode`,
  contains both `update_tries` and `check_ab`, contains no `cfgload`, and has
  SHA-256
  `7dc141e55a5ad32597e59f970b5b86cedc3a65434ef5d281f82c719a7198d617`.
- The current downstream artifact built from the CoreELEC pin plus local
  patches says `boot in AVB mode`, contains `update_tries` and `cfgload` but
  not the `check_ab` command, and has SHA-256
  `ba0fbe2c5ebe96db20396822420348450bd1534f438c99be7c0a5aa3472b6c16`.

The source audit used CoreELEC commit
`5f7ac2b1dc4df2f466ed88c3958a8675873f8a1a`. The factory binary names a
different source revision, so the matching VAB source behavior below is strong
corroboration, not proof from the exact factory source tree.

The read-only factory captures were `env.img`
(`2cb1f49ee3411aa3a9371a4445541f3b1d7770b83b0258fac7e54a8acdd95599`),
`misc.img`
(`cbe8829f46b9267068e8504be47dc7c999285417e9bf0d64302ab6888b0b1cd4`),
and `pack/bootloader.PARTITION` under
`/backup/workspaces/x88_pro_x5m_stock_20260829/` on the backup host.

### 1. Does it count boot attempts?

**Yes, through Android A/B metadata in `misc`, not generic U-Boot
`bootcount`.** The captured `misc.img` has `BCAB` metadata at offset `0x800`.
Its slot bytes decode under the pinned VAB structure as:

- slot A: priority 15, `tries_remaining=4`, `successful_boot=1`;
- slot B: priority 7, `tries_remaining=0`, `successful_boot=0`;
- global `boot_tries_remaining=3`.

The pinned VAB implementation in
`bl33/v2023/cmd/amlogic/cmd_bootctl_vab.c` calls `update_tries` from
`aml_board_late_init_tail()` in `board/amlogic/common/board.c`, before
`run_main_loop()` executes the boot command. For an unsuccessful active slot
it decrements `tries_remaining`, recomputes the CRC, and persists the whole
control block with `store_logic_write("misc", ...)`. The factory environment has
`reboot_mode=cold_boot`, so the VAB decrement guard is true. Its `preboot`
runs `get_valid_slot`, which changes slot after the current slot reaches zero.

The current downstream AVB build has the same important ordering: its
`update_tries` decrements an unsuccessful active slot and writes the AVB block
to `misc` during board late init. Neither mechanism uses the saved
`active_slot` variable as its attempt counter.

### 2. What happens when the kernel fails to start?

**The stock path retries and eventually changes slot; the mos `cfgload` path
does not handle a returned `booti` automatically.** The captured environment
actually carries `bootcmd=run storeboot`, not `cfgload`. Its `storeboot`
continues after a returned `bootm` with `check_ab`; for an unsuccessful slot
that still has credit, the VAB implementation reboots. Each new U-Boot entry
spends another persisted credit, and `get_valid_slot` selects the other slot
after exhaustion. This is eventual rollback, but unlike the cx3576 contract it
does not immediately zero all remaining credits when `bootm` returns. If both
VAB slots are unusable, it resets the metadata and enters fastboot rather than
refilling both counters and resetting.

The downstream `miehq/s905x5m-alpine:boot/boot.ini` ends at `booti` and
contains no `check_ab`, counter update, `saveenv`, or `reset`. Its patch 0011
reports a returned or failed `cfgload` as "returned to recovery" and returns
failure. The downstream defconfig also has `CONFIG_WATCHDOG_AUTOSTART`
disabled. Therefore a failed `booti` remains in U-Boot until something
external resets the board; only then can the already-persisted AVB credit lead
to another attempt or a slot change. A kernel hang that neither returns nor
resets is outside both state machines established here.

### 3. What drives `rollback_flag`?

**It reports that rollback happened; it does not cause rollback.** Slot
selection operates on the persistent `roll_flag` inside the A/B control block.
`get_valid_slot` sets that flag when it abandons one slot, and the
`set_roll_flag` command can set or clear it. On a later board init,
`update_tries` mirrors a persistent value of 1 into the runtime environment as
`rollback_flag=1`.

The only consumer found in the selected Android OTT environment appends
`androidboot.rollback=${rollback_flag}` to the kernel boot configuration. No
slot-selection or attempt-counting path reads the environment variable, and
the mos `boot.ini` does not read it. The relevant implementation is in
`bl33/v2023/cmd/amlogic/cmd_bootctl_vab.c` and the selected environment is
`bl33/v2023/board/amlogic/env/android_ott.env`. A controlled tree search found
eight `set_roll_flag 1` call sites and no `set_roll_flag 0` caller; who clears
the persistent flag in the factory software remains a follow-up.

### 4. Is `CONFIG_BOOTCOUNT_LIMIT` set?

**No.** Both the pinned BM201 defconfig and the current downstream BM201
defconfig contain the positive control `CONFIG_CMD_BOOTCTOL_AVB=y` and contain
zero `CONFIG_BOOTCOUNT_LIMIT=y` lines. The symbol exists in
`bl33/v2023/drivers/bootcount/Kconfig` with no default, so omission resolves to
disabled. The two audited defconfigs are the pinned
`bl33/v2023/configs/amlogic/s7d_bm201_defconfig` and downstream
`miehq/s905x5m-alpine:uboot/config/s7d_bm201_defconfig`.

The decoded factory BL33 supplied an independent positive control (`boot in
VAB mode`) but contained neither the compiled `Warning: Bootlimit` nor `Using
altbootcmd` strings. The factory environment likewise contains no
`bootcount`, `bootlimit`, or `altbootcmd`. The separate Android A/B counter in
`misc` therefore does not satisfy the literal requirement in
`docs/design/boards.md` section 5.

### 5. Can RAUC's `uboot` backend drive it as-is?

**No.** Controlled searches found `active_slot=_a` twice in the two captured
environment records, but zero `BOOT_ORDER`, `BOOT_A_LEFT`, or `BOOT_B_LEFT`
variables. Both decoded BL33 images also contain zero strings for those three
RAUC variables while their respective VAB/AVB controls are present. The
vendor code reads and writes A/B metadata in `misc`; RAUC's `uboot` backend
writes a U-Boot environment instead. The current mos renderer additionally
assumes a two-partition redundant environment for that backend, which this
board definition does not have.

An adapter would need to:

1. implement RAUC activate, mark-good, and mark-bad operations against the
   vendor-compatible AVB/VAB control block in `misc`, including its CRC;
2. arm an installed slot with priority and non-zero tries while explicitly
   clearing `successful_boot` -- the vendor `set_active_slot` implementation
   deliberately leaves that bit unchanged, so that command alone does not arm
   rollback for a previously successful slot;
3. make mark-good set `successful_boot` while retaining non-zero tries -- the
   VAB `slot_is_bootable()` tests tries only -- and make mark-bad exhaust the
   slot while keeping the known-good slot bootable;
4. map `_a`/`_b` to the mos boot and root partitions, and pass `rauc.slot=A`
   or `rauc.slot=B` to Linux;
5. persistently mark or exhaust a slot and reset when `booti` returns, and
   define the both-slots-exhausted recovery policy.

The alternative is to patch U-Boot to implement the RAUC
`BOOT_ORDER`/`BOOT_<slot>_LEFT` contract directly, including persistent
storage and the same returned-`booti` failure path.

## Owner action

Do not treat vendor attachment as preserving automatic rollback as-is: choose
it only together with a RAUC-to-Android-boot-control adapter and a
returned-`booti` bad-slot/reset hook; without both, it is A/B switching without
a mos rollback watchdog.

## Follow-up

- Obtain the exact source and build configuration for factory revision
  `61544dc3b9a`, or verify its transitions through read-only serial observation,
  before relying on implementation details not independently visible in the
  factory binary and captured metadata.
- Establish which factory component clears persistent `roll_flag`; the pinned
  tree exposes a clear command but contains no caller.
- Establish the board-level reset source for a kernel hang. The pinned and
  downstream defconfigs disable `CONFIG_WATCHDOG_AUTOSTART`, while the exact
  factory build configuration is not available.
