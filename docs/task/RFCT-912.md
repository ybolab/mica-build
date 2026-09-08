# RFCT-912 Build the s905x5m U-Boot and assert the shared contract

- **status**: completed
- **priority**: P1
- **owner**: implementation/plan-910-m2-20260830
- **createdAt**: 2026-08-30 14:37
- **plan**: PLAN-910 M2

## Description

Relocate the pinned CoreELEC U-Boot build from `miehq/s905x5m-alpine` behind
the s905x5m BSP artifact interface, assert the section 5 configuration against
the produced `.config`, add the approved redundant-environment partitions and
their repart protection, and remove the shared assumption that every U-Boot
board stores its loader in the GPT. Do not write a bootloader to hardware.

## ActiveForm

Implemented and verified the approved s905x5m U-Boot artifact contract.

## Dependencies

- **blocked by**: (none)
- **blocks**: PLAN-910 M3

## Notes

- Heavy builds run on `debian13` (`192.168.27.200`); this repository is not
  pushed to that host.
- Investigation completed at 2026-08-30 14:50 UTC from the committed carrier
  inputs at `49618bed` and CoreELEC U-Boot at `5f7ac2b1`; unrelated changes in
  the carrier working tree were excluded.
- The clean build produced all three expected artifacts. Its final `.config`
  passed the `CONFIG_CMD_CFGLOAD=y` positive control, then failed all four
  section 5 requirement groups: bootcount disabled, redundant offset absent,
  FIT disabled and FIT signature absent, and bootm length 64 MiB rather than
  128 MiB.
- The owner decision at local branch commit `09873f7` is now an M2 input: mos
  replaces the bootloader, but the stock 108–116 MiB `env` range remains
  vendor-reserved and unavailable to mos.
- The exact stock GPT leaves 116–132 MiB unpartitioned. The approved Q2 answer
  uses two 64 KiB partitions at 120 MiB (`0x07800000`) and 124 MiB
  (`0x07c00000`), preserving `boot-a` at 128 MiB and every existing byte
  offset.
- A disposable final-config run proved that the standard MMC backend retains
  the proposed redundant offsets, size, eMMC device 1, and user hardware
  partition 0 through `olddefconfig`. The current production config remains on
  the single-copy vendor storage backend.
- The owner approved the 120/124 MiB layout and the fail-closed build approach
  at `d1aef12`. M2 now includes the layout entries, repart placeholders, and
  role-driven loader checks; selecting config fixes and writing hardware remain
  outside this milestone.
- Completed at 2026-08-30 after a clean diagnostic U-Boot build and default
  export-refusal run on `debian13`. No hardware or remote repository was
  written.

## Result

The exact committed carrier inputs now build under
`os/boards/s905x5m/bsp/uboot/`. The diagnostic build produced the expected
3,321,856-byte eMMC payload, 3,322,368-byte SD payload, and 3,321,856-byte DDR
input copy. The produced config was byte-identical to the investigation build.
The default BSP interface matched `CONFIG_CMD_CFGLOAD=y` once, named all four
section 5 failures, exited non-zero, and exported zero files.

Q2 costs exactly 128 KiB of newly claimed storage in the stock 116–132 MiB
hole; the fixed starts leave conservative unclaimed guard gaps around the two
copies. It is possible without shortening or moving a vendor range: `uenv-a`
starts at 120 MiB and `uenv-b` at 124 MiB, while the vendor `env` remains
108–116 MiB and `boot-a` remains at 128 MiB. Only later partition numbers
shift. That renumbering is free only before the first device ships; afterwards
it is fleet ABI.

Final validation passed all three board lints, the RAUC render for all three
boards, `os/verify` (1065/1065), and `os/build` (699/699). The latter now
discovers s905x5m and reads back all six of its statically pinned GPT entries.
