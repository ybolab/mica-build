# PLAN-910 s905x5m board intake (Amlogic S7D)

- **status**: rejected
- **createdAt**: 2026-08-30
- **approvedAt**: 2026-08-30 13:42 UTC
- **completedAt**: -
- **relatedTask**: RFCT-910 (M1; later milestones create their own task on dispatch)

## Context

### Superseded current disposition — 2026-09-10

This plan is retained as historical S905X5M intake evidence and is no longer an
executable plan. The current implementation is
[20260910-0559-s905x5m-current-system](20260910-0559-s905x5m-current-system.md),
with source delivery recorded by
[20260910-0554-s905x5m-current-system](../task/20260910-0554-s905x5m-current-system.md).
Development acceptance starts from a fresh complete newest-image flash. The
RAUC/U-Boot slot, raw-partition, legacy package and compatibility instructions
below are superseded and must not be executed or restored.

The old board evidence remains historical evidence only. Current physical
paired-firmware installation, boot, peripheral, watchdog, recovery, power-cut,
shutdown and native-container gaps remain open in the campaign record until a
current-image owner and bench dependency are assigned; they are not converted
to completion by this plan's closure.

`miehq/s905x5m-alpine` is a working Alpine bring-up for the X88 Pro X5M
(Amlogic S905X5M / S7D, board BM201/M100). It builds its own U-Boot from the
CoreELEC fork pinned at `5f7ac2b1`, runs Hardkernel's 6.12.38 kernel, and has
HDMI, USB, Ethernet, Wi-Fi, Bluetooth and audio verified on hardware. This plan
brings that board into mos under the `docs/design/boards.md` contract.

**This supersedes an earlier draft.** PLAN-011 was written on 2026-08-23 on a
`dev` branch that has since been deleted: the branch's other work targeted
`os/verify-lib.sh` and the shell verifier, which the TypeScript port replaced,
so the branch was stale as a whole. Its findings are carried forward here and
its restore point is recorded at
`backups/mos-dev-deleted-20260830-131125.txt` outside this repository.

## What is already settled

These were open in the earlier draft and are not open now. Each is recorded
with what settled it, because "we checked" without the check is how a
conclusion outlives its evidence.

**The GPT path boots.** An SD card partitioned GPT, with no bootloader at
LBA 1, came up on 2026-08-23: the vendor U-Boot in the eMMC boot area found
`boot.ini`, the board mounted its rootfs by partition GUID, every service
started, and `resize-rootfs` grew the data partition from 595 MiB to 14.3 GiB.

**The SoC is not fused.** `forUpgrade_secureBoot=false` in U-Boot's
environment. A replacement bootloader therefore does not have to satisfy the
Amlogic signing chain, which removes this plan's largest risk.

**Which bootloader copy executes: `boot0`.** The earlier draft left this open
and made M3 conditional on resolving it. Settled 2026-08-30 from two
directions. The pinned U-Boot source states the numbering in a comment on
`store_boot_copy_start()` (`bl33/v2023/include/amlogic/storage.h`): for eMMC,
`0` is the user partition, `1` is `boot0`, `2` is `boot1`. And
`forUpgrade_bootloaderIndex` reads `1` on both a factory Android unit and this
project's board.

`forUpgrade_1stBootIndex` must not be read as answering this. It is an
eFuse-derived candidate start, reads `0`, and would point at the user area.

**The three copies are not interchangeable byte-for-byte.** `boot0` and `boot1`
carry a 512-byte `struct storage_emmc_boot_info` ahead of the payload,
generated on the target by `amlmmc_write_info_sector()` from the live partition
layout; `bootloader_a` does not. A `dd` written for one cannot be reused for
another, and this build ships no image that is safe to write to a boot area.

**The vendor U-Boot already runs A/B slot logic.** Its environment carries
`active_slot`, `boot_part` and a `boot_order`/`cfgload` flow. M3 may be able to
attach to that rather than implement a handshake from scratch.

**USB burning is the recovery path**, and it has been used to flash complete
Android images including the bootloader. It is the only mechanism that survives
a bad bootloader. A factory image was captured and packed on 2026-08-29
(`s905x5m-alpine`, `docs/factory-android-image.md`); **it passes a format check
and round-trips, but has never been written to a board**, so the proven rescue
is still the third-party package that repository pins.

## Milestones

### M0 — Board definition — **done**

`os/boards/s905x5m/board.env` exists and passes the schema lint 13/13, with
cx3576 and x64 unaffected at 26/26.

It needed a role the model did not have. Two ranges on this eMMC are written by
the vendor's firmware at hardcoded absolute offsets whether or not a partition
covers them: the MMC driver's calibration scratch, whose 36 MiB base is a
literal in `drivers/mmc/host/mmc_dtb.c`, and U-Boot's environment at the stock
offset. `vendor-reserved` claims them and forbids every filesystem key.

The definition also declares **no loader partition**, deliberately. cx3576
needs a `raw-blob` entry because the RK3576 BootROM reads U-Boot from sector 64
of the user area and systemd-repart would otherwise discard it. The Amlogic
BootROM reads the eMMC hardware boot area, which is outside the GPT entirely.

### M1 — Kernel meets the shared floor — **done**

Five options in `s905x5m-alpine`'s kernel baseline do not satisfy
`os/boards/common/mos-required.fragment`, measured 2026-08-30 against the
config baseline rather than a built `.config`:

| option | baseline | required |
|---|---|---|
| `CONFIG_SQUASHFS` | `=m` | `=y` |
| `CONFIG_HUGETLBFS` | not set | `=y` |
| `CONFIG_HUGETLB_PAGE` | absent | `=y` |
| `CONFIG_VLAN_8021Q` | `=m` | `=y` |
| `CONFIG_LSM` | carries `smack,tomoyo,apparmor` | the pinned list |

`SQUASHFS=m` is disqualifying on its own: dm-verity no-initramfs boot cannot
load a module before the root is mounted. Missing hugetlbfs put a cx3576 board
in a reboot loop on 2026-08-17.

**The comparison was against the config baseline, not a built kernel**, and
this tree's own rule is that `CONFIG_FOO=y` in a config does not mean built-in.
M1 starts by building and asserting the real `.config`.

The first clean build completed on `debian13` on 2026-08-30. It used the
committed kernel build inputs from `s905x5m-alpine` at `49618bed`, fetched the
Hardkernel tree at `9ea2aa831a585955dcb0e38a0bc3c63d2c690adc`, compiled the
kernel and all vendor and out-of-tree modules, and exported both the final
`.config` and `include/config/auto.conf` for inspection. The baseline
hypothesis compared with that built result is:

| option | baseline hypothesis | built `.config` | result |
|---|---|---|---|
| `CONFIG_SQUASHFS` | `=m` | `=y` | false alarm |
| `CONFIG_HUGETLBFS` | not set | `=y` | false alarm |
| `CONFIG_HUGETLB_PAGE` | absent | `=y` | false alarm |
| `CONFIG_VLAN_8021Q` | `=m` | `=m` | real gap |
| `CONFIG_LSM` | carries `smack,tomoyo,apparmor` | exact pinned list | false alarm |

All other lines in the shared fragment matched, so the baseline comparison
missed no additional config gap. The four false alarms are explained by the
source build's own `alpine-required.fragment`, which is merged after the
baseline and already pins those values. `auto.conf` confirmed the same state:
the LSM list was exact and VLAN remained a module.

The clean build also exposed an artifact-interface difference. Its
`modules.tar` contains the vendor, Skykirin front-panel, and Seekwave modules,
but contains zero `modules.dep`, `modules.alias`, `modules.softdep`, or
`modules.symbols` index files. The Alpine rootfs build runs `depmod` after
extraction; mos's board stage deliberately does not, because the §3 interface
requires those files to be inside the tar. The mos producer therefore has to
run `depmod` after adding the two out-of-tree module sets and before packing.

**M1 completed 2026-08-30.** The mos BSP build finished on `debian13`. Its
final `.config` matched all 18 shared `=y` lines and the exact `CONFIG_LSM`
list; `CONFIG_VLAN_8021Q`, the one real baseline-build gap, is now `=y`. A
temporary unknown `CONFIG_MOS_REQUIRED_SENTINEL=y` requirement failed at the
post-`olddefconfig` assertion with no artifacts exported, proving the missing
option path is live.

The artifact stage exported exactly the §3 kernel set:

| artifact | bytes | SHA-256 |
|---|---:|---|
| `Image` | 32,135,680 | `a69a4812ce3e16a9bc0c132c11dafc716d49cf32ef3b0c0725cd633e41e86567` |
| `modules.tar` | 63,559,680 | `d05e942308151576a88b82ff788904b051c9532394c921e012670cda8e8c240d` |
| `s7d_s905x5m_m100.dtb` | 82,175 | `37b72349e4c6945d6b0792578bc339fb9cce2890caf9d93b08857eecf5c08dd3` |

The module tree is for `6.12.38-m100-arm64`, carries dependency, alias,
soft-dependency, and symbol indexes, and contains one each of the Skykirin,
Seekwave SDIO, and Seekwave Wi-Fi modules. The DTB reports the expected
`s7d_s905x5m_bm201` compatible string.

### M2 — U-Boot build and fail-closed §5 contract — **done**

M1 lands the kernel component and its `make kernel` entry point. M2 relocates
the U-Boot inputs behind the §2 layout and adds its §3 artifact interface.
Mostly movement: `s905x5m-alpine`'s Makefile already has the right shape. §5's
U-Boot requirements are asserted here —
`CONFIG_BOOTCOUNT_LIMIT`, redundant environment, `CONFIG_FIT` +
`CONFIG_FIT_SIGNATURE`, `CONFIG_SYS_BOOTM_LEN >= 0x8000000`.

Note that `CONFIG_FIT_SIGNATURE` is configured nowhere in this tree today, cx3576
included (`docs/design/boards.md` §8). M2 either satisfies it for this board or
records why the gap is shared.

#### M2 investigation — 2026-08-30

A clean build completed on `debian13` from the committed U-Boot inputs in
`s905x5m-alpine` commit `49618bed07508b77bb8e8e640e0faafc5c95ea9a`.
The carrier checkout contains unrelated uncommitted U-Boot work, so the build
context came from `git archive` at that commit rather than from its working
tree. The build fetched CoreELEC U-Boot commit
`5f7ac2b1dc4df2f466ed88c3958a8675873f8a1a`; the fetched-tree identity check
and the final-config path check both passed.

`CONFIG_CMD_CFGLOAD=y` occurred exactly once in the produced
`bl33/v2023/build/.config`, providing the positive search control. Only then
were the section 5 options counted. A missing pattern was converted to a zero
count rather than allowed to terminate the audit:

| requirement | produced `.config` | result |
|---|---|---|
| `CONFIG_BOOTCOUNT_LIMIT` | `# CONFIG_BOOTCOUNT_LIMIT is not set` | missing |
| `CONFIG_ENV_OFFSET_REDUND` | zero matching lines | missing |
| `CONFIG_FIT` | `# CONFIG_FIT is not set` | missing |
| `CONFIG_FIT_SIGNATURE` | zero matching lines | missing; shared tree-wide gap |
| `CONFIG_SYS_BOOTM_LEN >= 0x8000000` | `CONFIG_SYS_BOOTM_LEN=0x4000000` | too small |

The same build produced the expected artifact set before the contract audit:

| artifact | bytes | SHA-256 |
|---|---:|---|
| `u-boot.bin.signed` | 3,321,856 | `2f755d2e538d8219341e3085736be0b4e703401d22422b93daa112c9f5122e35` |
| `u-boot.bin.sd.bin.signed` | 3,322,368 | `ea731245ef1121d5710a5b6c3cf1ee0dc09a6559d96eb9fc11dfcc4768cf3258` |
| `DDR.USB` | 3,321,856 | `c0809bf8cb74194224ca95abf19f2b04014b4efcabf34770423361a38127afa0` |

The owner decision at `09873f7` removes the bootloader-ownership ambiguity but
does not make the stock `env` range available. The 108–116 MiB partition stays
`vendor-reserved`: vendor firmware writes there at its hardcoded address, so a
mos environment placed anywhere inside it would not be redundant storage; it
would be data deliberately exposed to another writer.

The exact stock GPT at carrier commit `49618bed` has SHA-256
`7b4856fab90f326ee82da0924133833e5b3d9c9b5e162b32481bfd5871b2b669`.
Parsing its entries shows `reserved` at 36–100 MiB, `env` at 108–116 MiB, and
the next partition (`frp`) at 132 MiB. Therefore 116–132 MiB is a real hole in
the stock table, not space obtained by shortening a vendor partition. mos
already fixes `boot-a` at 128 MiB, leaving 116–128 MiB available without
moving any existing partition offset. The carrier's hardware-accepted eMMC
layout previously started its boot partition at 116 MiB, independently showing
that the current firmware does not rewrite that stock-table hole across boot.

The proposed redundant pair uses two 64 KiB partitions inside that hole:
`uenv-a` at 120 MiB (sector 245760, byte offset `0x07800000`) and `uenv-b` at
124 MiB (sector 253952, byte offset `0x07c00000`). Both starts are 4 MiB
aligned. The pair leaves 4 MiB after the vendor `env` range, just under 4 MiB
between copies after accounting for the first 64 KiB partition, and just under
4 MiB before `boot-a`. Those are conservative guard spaces, not a claim about
the eMMC erase-group size, which has not been measured. Only the two 64 KiB
partition extents need to be claimed; systemd-repart may discard the guards
without touching either environment copy.

The current U-Boot cannot use that pair unchanged. Its final config has
`CONFIG_ENV_IS_IN_STORAGE=y`, and the Amlogic storage backend reads and writes
only offset zero of the named stock `env` partition. In this source tree,
`CONFIG_ENV_OFFSET_REDUND` is available under the standard MMC backend plus
`CONFIG_SYS_REDUNDAND_ENVIRONMENT`. A disposable configuration run against the
produced tree proved that `olddefconfig` retains the required backend values:

| option | proposed produced value |
|---|---|
| environment backend | `CONFIG_ENV_IS_IN_MMC=y`; `CONFIG_ENV_IS_IN_STORAGE` absent |
| redundancy | `CONFIG_SYS_REDUNDAND_ENVIRONMENT=y` |
| primary offset | `CONFIG_ENV_OFFSET=0x7800000` |
| redundant offset | `CONFIG_ENV_OFFSET_REDUND=0x7c00000` |
| copy size | `CONFIG_ENV_SIZE=0x10000` |
| eMMC target | `CONFIG_SYS_MMC_ENV_DEV=1`, `CONFIG_SYS_MMC_ENV_PART=0` |

The device selection is load-bearing: the measured U-Boot numbering is SD as
`mmc 0` and eMMC as `mmc 1`, while the standard backend defaults to device 0.
Hardware partition 0 means the eMMC user area; it does not confuse the
environment with the executing `boot0` hardware area. The built DT contains
none of `u-boot,mmc-env-partition`, `u-boot,mmc-env-offset`, or
`u-boot,mmc-env-offset-redundant`, which would override the Kconfig offsets;
the eventual build must positively control the DT and reassert all three
absences.

The approved implementation preserves every existing partition GUID and byte
offset, allocates new GUIDs, inserts the pair as partition numbers 3 and 4, and
shifts only the later partition numbers by two. Four board-specific
systemd-repart placeholders claim the linux-generic `reserved`, `env`,
`uenv-a`, and `uenv-b` entries before the six shared definitions. The RAUC
renderer and verifier now select GPT loader assertions from the presence of a
`raw-blob` role rather than from `RAUC_BOOTLOADER=uboot`, because this board's
executing `boot0` is outside the GPT and has no loader partition.

#### M2 implementation — 2026-08-30

The committed U-Boot input set from carrier commit `49618bed` now lives under
`os/boards/s905x5m/bsp/uboot/`, still fetching the CoreELEC tree at
`5f7ac2b1dc4df2f466ed88c3958a8675873f8a1a`. The build uses the repository's
pinned container frontend and Ubuntu image, requires exactly 15 imported
patches, keeps the host tests and BL33-content check, and is routed through
`make s905x5m-uboot`.

A diagnostic `--target build` run on `debian13` produced the expected three
files before the contract gate:

| artifact | bytes | SHA-256 in the implementation run |
|---|---:|---|
| `u-boot.bin.signed` | 3,321,856 | `2b247d63948adcaf639260d07690125764bf2f60ac13cbb0853fc2e15ebb878c` |
| `u-boot.bin.sd.bin.signed` | 3,322,368 | `9ed128d3386feb81b78ce471c12c9035fd546840dfce399269ad6e8b2bddc610` |
| `DDR.USB` | 3,321,856 | `c0809bf8cb74194224ca95abf19f2b04014b4efcabf34770423361a38127afa0` |

The two signed-image hashes differ from the investigation run because this
upstream build embeds its wall-clock build time before compression and signing:
the investigation and implementation images contain `2026-08-30 14:44:23` and
`2026-08-30 16:14:57` respectively. The produced `.config` is byte-identical
between the runs
(`27c8f575638d456d913affb7a6864fc3222f8d8d05ba7813246f4ed70411a1b4`),
and the unchanged `DDR.USB` hash provides the other stable input control.

The default artifact path then ran the gate against that produced config. Its
positive control matched exactly once and the four requirement groups reported
the expected evidence: bootcount match 0, redundant-offset match 0, FIT and
FIT-signature matches 0, and `SYS_BOOTM_LEN=0x4000000` against a required
`0x8000000`. The build exited non-zero with “failed in 4 requirement groups;
refusing artifact export”, and `out/uboot` contained zero files. The FIT
signature error explicitly names the shared tree-wide gap.

No config gap was closed, no boot-area package was created, and no device was
written. Selecting the bootcount backend, switching the environment backend,
enabling signed FIT, and raising the bootm limit remain separate decisions.

#### M2 built-config remeasurement — 2026-08-31

RFCT-918 remeasured the four section-5 groups only from final built
`.config` files. The mos source was unchanged after the M2 implementation; its
preserved diagnostic config came from
`/uboot/bl33/v2023/build/.config` in the successful `--target build` image. A
fresh, isolated `docker buildx build --target build --load -f uboot/Dockerfile
uboot` of the current `miehq/s905x5m-alpine` U-Boot context also completed.

The two configs are byte-identical (50,016 bytes, SHA-256
`27c8f575638d456d913affb7a6864fc3222f8d8d05ba7813246f4ed70411a1b4`), and each
has exactly one `CONFIG_CMD_CFGLOAD=y` positive control. Therefore no group is
a migration loss or a false alarm:

| requirement group | both built configs |
|---|---|
| bootcount | `# CONFIG_BOOTCOUNT_LIMIT is not set` |
| redundant environment | `CONFIG_ENV_OFFSET_REDUND` absent |
| FIT and FIT signature | FIT disabled; signature absent |
| bootm length | `CONFIG_SYS_BOOTM_LEN=0x4000000` (64 MiB) |

All four are genuine gaps against the current section-5 contract; the last is
a numeric gap rather than a missing symbol. The config-file hypothesis that
three values were already enabled in Alpine is not borne out by its built
config. This also rules out a mos-specific `olddefconfig` dependency loss.

The `0x8000000` minimum originates in historical PLAN-005: its Talos initramfs
was 100 MiB or larger and the 8 MiB default failed with `Image too large`.
That same plan says bootm capacity, RAM headroom, and decompression peak are
board-specific and must be measured. PLAN-910 has no s905x5m-specific
measurement that independently derives 128 MiB, so the value remains an
owner-level requirement decision rather than a gap to close in this task.

#### M2 section-5 bootcount and redundant-environment closure — 2026-08-31

RFCT-920 closed exactly the bootcount and redundant-environment groups under
the owner-approved scope. The board defconfig selects
`CONFIG_BOOTCOUNT_LIMIT=y` with the `CONFIG_BOOTCOUNT_ENV=y` backend. That
backend persists through `env_save()` in the same pre-Linux-readable redundant
MMC pair, rather than a RAM or generic-address store that would be lost on a
power cut.

The Amlogic storage environment backend was replaced by the standard MMC
backend, with `CONFIG_SYS_REDUNDAND_ENVIRONMENT=y`, eMMC device 1, hardware
partition 0, `CONFIG_ENV_SIZE=0x10000`, and exact absolute offsets
`CONFIG_ENV_OFFSET=0x7800000` / `CONFIG_ENV_OFFSET_REDUND=0x7C00000`. The
arithmetic is 120 MiB = 125829120 bytes and 124 MiB = 130023424 bytes, matching
the approved `uenv-a` / `uenv-b` starts. The produced DTB is also checked to
contain none of the three `/config` MMC-environment override properties.

The clean diagnostic build's final config has SHA-256
`6aa91b562a35fbfdf0d8acea1038f5d2ffb84e858abb199a8f82bfd564476c4c`; its
`CONFIG_CMD_CFGLOAD=y` positive control and every new exact assertion match
once. The normal artifact target still fails, correctly, in exactly two
requirement groups: FIT/signature and the unchanged 64 MiB bootm limit. It
exports no artifact. The first renderer fixture showed that a wrong defconfig
offset alone could pass, so RFCT-920 added a s905x5m source-layout check before
the renderer proceeds: it compares the defconfig's MMC backend, redundant
environment settings, exact offsets, size, device, and hardware partition with
the selected board layout. Correct isolated inputs render and check cleanly;
wrong primary, redundant, or board-layout offsets each exit non-zero with an
expected/observed defconfig diagnostic. The Dockerfile gate remains the
authoritative post-`olddefconfig` check.

### M3 — U-Boot A/B

**Decision, taken by the owner 2026-08-30: mos replaces the eMMC bootloader.**

The alternative was to keep the vendor's and attach to it. RFCT-911 costed
both, and what settled it was not the one-off risk but the standing one. The
vendor U-Boot keeps its slot state in the `misc` partition as an Android VAB
control block — RFCT-911 decoded it: slot A `priority 15, tries_remaining=4,
successful_boot=1`, slot B `priority 7, tries_remaining=0`. RAUC writes
`BOOT_ORDER` and `BOOT_<slot>_LEFT` in the U-Boot environment. The two never
look at the same place.

Attaching therefore meant writing a RAUC-to-Android-boot-control adapter and a
returned-`booti` bad-slot hook, and then maintaining both against an
undocumented Amlogic structure — **a permanent dependency on an Android ABI, in
a system whose root filesystem contains no Android at all**. Replacing trades
that for a single high-risk write, which `secureBoot=false` makes technically
possible: the SoC is not fused, so a replacement bootloader need not satisfy
the Amlogic signing chain.

What the decision does not remove:

**The first write is still the most dangerous operation on this board, but the
rescue path is proven and a known-good package is on hand.**

**Corrected 2026-08-31.** This paragraph previously read "the rescue is not
proven" and made proving one a prerequisite of M3's first write. That conflated
two different things and left the gate closed on a condition already met.

What is genuinely unproven is the **factory Android package** built on
2026-08-29: it passes a format check and round-trips but has never been written
to a board. Rescue does not require that package.

What is proven, on this hardware, is the path itself. `s905x5m-alpine`'s
`docs/emmc-image.md` records that its system package "has been flashed,
repeatedly, through USB burning mode with the vendor tool on a host", that the
board boots from it with no card inserted, and specifically that "the bootloader
path is exercised. USB burning replaces the bootloader, and the board came back,
which is the case that makes eMMC writes recoverable." Two facts there go beyond
"it boots": the board's live GPT carries `env` at 108-116 MiB, a partition that
exists only in the layout that repository introduced and so could not have
survived from the stock table, which shows `gpt.bin` took; and the bootloader
path was traversed rather than inferred.

The package is present at `s905x5m-alpine`'s `out/emmc-system/update.img`
(551 MB, built 2026-08-31 02:54) with a recorded `update.img.sha256`. Recovering
with it returns the board to a working Alpine system rather than to Android —
not the original state, but a live, re-flashable board.

Two constraints on how the rescue is used, both from the same source:

- **Rescue is host USB burning with a full package.** The in-device `sdc_burn`
  path requires a working U-Boot, so it cannot recover a replacement that fails
  before the prompt. "Recovery restores a whole package; a bootloader-only image
  is not a way back."
- **Confirm the package is on hand and its checksum matches before the write**,
  not after. `s905x5m-alpine`'s own rule is to keep a known-good full USB-burning
  package before every bootloader-only update.

`flash/README.md` in that repository additionally pins the identity of a 2.0 GB
stock recovery firmware — not in git, but its checksum is, "because this is the
file a bricked board is restored from". That is a second layer, not the primary
one.

**What the gate now waits on is the owner, not a missing verification.** The
remaining decision is whether to spend a board's uptime on the first write, with
a recovery that costs a full reflash if it fails.

**Copy `boot0` is what executes**, and writing a boot area needs the
target-generated `storage_emmc_boot_info` sector, so the package path does it
and a raw `dd` does not.

**Q2 — ANSWERED, approved by the owner 2026-08-30.** The single stock `env`
partition stays `vendor-reserved`; replacing the bootloader does not stop the
vendor firmware's hardcoded writer. 64 KiB `uenv-a`/`uenv-b` entries go at
120/124 MiB, inside the 116–132 MiB hole in the exact stock GPT. That placement
moves no existing byte offset: `boot-a` stays at 128 MiB and later entries keep
their starts and GUIDs. Only partition numbers shift.

The renumbering is free **now and only now**. cx3576's definition records why:
identity numbers are what the dm-verity cmdline, `/etc/fstab`,
`/etc/fw_env.config` and the RAUC slot devices pin to, and resyncing them to
positions rewrites all of it. No s905x5m device has been flashed, so nothing is
pinned yet; after the first flash the same change is a fleet-wide break.

Why redundancy is required at all, since §5 states it without the reason: the
A/B watchdog rests on `saveenv` persisting the attempt decrement *before*
booting. A single copy has a window where a power cut during that write leaves
no valid copy, and the board loses its A/B state. Two copies with a sequence
counter, written one after the other, close it. Measured on this board today,
`CONFIG_ENV_OFFSET_REDUND` has zero matches.

The roughly 4 MiB isolation on each side is conservative and is **not** a
measured eMMC erase-group size.

Approved together with it: M2's implementation approach — migrate the existing
build behind the §3 interface, assert §5 against the produced config, and
**refuse to export an artifact while any of the four gaps stands**. Making the
gaps visible and blocking comes first; how each is closed is decided
separately, and `CONFIG_FIT_SIGNATURE` is a tree-wide gap that this board does
not get to solve on its own.

#### M3 packaging investigation — 2026-08-31

RFCT-927's durable hand-off is the package input interface: the three
read-only files on the build host are `u-boot.bin.signed` (3,321,856 bytes),
`u-boot.bin.sd.bin.signed` (3,322,368 bytes), and `DDR.USB` (3,321,856 bytes).
The board BSP had no Amlogic package step, config, packer or `update.img`.

The full Alpine system manifest correctly lists the same staged
`bootloader.PARTITION` twice, once as special `bootloader` and once as GPT
`bootloader_a`. That shape is not suitable here. The special destination has
the target create the 512-byte `storage_emmc_boot_info` framing for the
hardware boot area; `bootloader_a` is an ordinary user-area GPT partition. A
bootloader-only package intentionally has no `gpt.bin`, so it cannot safely
address or verify the latter. Its manifest must contain `bootloader` only.

`DDR.USB` must appear as both `USB/DDR` and `USB/UBOOT`: BootROM uses the first
identity to establish DRAM and then loads the second identity to execute the
burn protocol. The package also needs the board's checked stock-flow
`usb_flow.aml`, `_aml_dtb.PARTITION`, and S7D platform description. The two
static blobs are imported with their Alpine baseline SHA-256 values
`97c5b289db21c087540f74c9661e6d300f3d582f2e1204e31a7dbfdf30c0bef6` and
`2513dbdf9c0d9e1ccc0da52ced73ee5a85e0c9c2495f487f712f900abff6a9fa`.

The current board's vendor route is the manually invoked
`sdc_burn aml_sdc_burn.ini`: the recorded `s7d_bm201#` prompt reports
`sdc_burn [sdc_burn_cfg_file]` and `sdcburncfg=aml_sdc_burn.ini`. That is a
measured command path, not automatic-card detection. `/bm201upd.ini` instead
belongs to the newer private installer that mos's replacement U-Boot builds;
its request/receipt wrapper is not present in the current vendor U-Boot. This
work therefore supports a manually selected `sdc_burn` card path, not a
reusable automatic installer card.

#### M3 packaging proposal — approved 2026-08-31

Add `make s905x5m-uboot-package` as a consumer of `out/uboot/`, exporting
`out/uboot-package/update.img`, its checksum, and the external
`aml_sdc_burn.ini` manual-card configuration. Use a pinned,
checksum-verified `linux/386` `aml_image_v2_packer`; package format validation
and unpack/compare checks must happen inside the build. The seven inputs are
the two U-Boot forms, `DDR.USB`, the external configuration, two board blobs,
and `platform.conf`.

The manifest includes the special `bootloader` target but neither a GPT payload
nor `bootloader_a`. A focused source test asserts that topology before any
container build. The package format check and seven-file byte-for-byte round
trip establish container integrity and payload preservation only; they do not
establish hardware bootability, a successful burn, or authorization for the
first write. No device is touched in this task.

#### M3 packaging implementation and verification — 2026-08-31

RFCT-928 added the mos-owned `make s905x5m-uboot-package` consumer below the
BSP. It accepts only the existing `out/uboot/` interface and emits
`out/uboot-package/update.img`, its SHA-256 sidecar, and the external manual
`aml_sdc_burn.ini`; it does not rebuild U-Boot or read a sibling repository.
The container stage pins and verifies the 32-bit packer and the two stock-flow
blobs, checks every manifest input, and fails if the canonical FIP no longer
contains substantial BL33 data.

The manifest keeps the two necessary `DDR.USB` USB identities and the special
`bootloader` target. It intentionally does not carry `gpt.bin`,
`bootloader_a`, or automatic `/bm201upd.ini` media: the first is what allows a
full system package to address a GPT user-area copy, while this bootloader-only
package leaves the target to generate its hardware-boot framing. The supported
card route is only a manually selected `sdc_burn aml_sdc_burn.ini` command on a
currently running U-Boot known to provide it.

An isolated remote build consumed the RFCT-927 durable artifact hashes and
created `/backup/mos-artifacts/rfct-288-ec0c70c/update.img` (10,267,648 bytes,
SHA-256 `c30145a261fa14bfae5aefb17d3786268e3af8a64280c1ac40304459a2304a05`).
The packer format check passed and its unpacker returned 7/7 named inputs
byte-identically. A separate no-cache rebuild repeated the checks and matched
the published output byte-for-byte. This establishes package format and
payload preservation, not hardware bootability, flash success, or permission
to perform M3's separately owner-gated first write. No device was touched.

#### M3 complete eMMC USB package — completed 2026-08-31

The owner subsequently directed a complete package rather than relying on the
bootloader-only RFCT-928 output. RFCT-929 extends that same package consumer:
it consumes the normal SD assembler's finished bytes, verifies the twelve-entry
mos GPT from `board.env`, and extracts the vendor-format `gpt.bin` plus all
mos-owned p3..p12 ranges. This keeps one producer for the layout and avoids a
parallel GPT/filesystem builder. p1 remains the SD-only cfgload bridge and p2
remains vendor-owned, so neither is a package destination.

The complete manifest retains the dual `DDR.USB` bootstrap entries and the
special `bootloader`, `_aml_dtb`, and `gpt` destinations. It writes normal GPT
targets for `uenv-a`, `uenv-b`, both boot slots, both root slots, `meta`,
`state`, `ephemeral`, and `data`; `ROOTFS-B` and the environment ranges are
explicit zero-filled factory state. `bootloader_a` is deliberately absent: the
mos GPT has no such partition and the vendor normal-partition lookup would fail
if it were fabricated.

The isolated build at commit `acd48f85d46a` used the standard SD image input
with SHA-256 `a21e95238791e06b62d4dc74bb8ce813c13249a8cf52ae67651c8d2b8d416c08`.
The no-cache rebuild passed the vendor format check and returned 18/18 manifest
inputs byte-for-byte after unpack; its `update.img` compared byte-identically
with the normal package result. The durable artifact is
`/backup/mos-artifacts/rfct-289-acd48f8/update.img` (1,369,400,096 bytes,
SHA-256 `2fc78e069545d3638a0325129bbad9ed54e17aad801b8f0cbef0eee3553c18b6`).

An owner later burning that package will replace the eMMC user-area GPT and
therefore erase the stock Android partition layout and its data. These checks
prove package format and payload fidelity only, not protocol acceptance,
successful flashing, or hardware bootability. RFCT-929 invoked no burner and
wrote no board, eMMC user area, boot area, or `bootloader_a` byte.

#### M3 production `boot.scr` implementation and offline verification — completed 2026-08-31

RFCT-930 established that the expected production source named by
`os/boards/s905x5m/board.env` does not exist, and the normal s905x5m assembler
does not compile or copy a script into either p5 or p6. The shared boot-command
checker already has the required literal partition-number guard, but this
assembler never invokes it. The correct s905x5m values are boot A/B p5/p6,
rootfs A/B p7/p8, and the redundant environment resides on eMMC `mmc 1`,
hardware partition 0.

The intended script follows the working cx3576 RAUC state machine while using
s905x5m's kernel address `0x3000000`, DTB address `0x1000000`,
`s7d_s905x5m_m100.dtb`, and serial console arguments. In particular, it must
load `mos-verity-${slotsuffix}.env` before the unsuffixed fallback and pass
`rauc.slot=${bootslot}`; the latter is required because `/dev/dm-0` cannot
identify a RAUC slot. It must use hexadecimal `setexpr` credits limited to
`1..9` and persist the decrement before boot.

The investigation also found two integration blockers. Current replacement
U-Boot eMMC selection uses `cfgload emmc` at `mmc 1:1` and reads `boot.ini`,
so it never loads p5/p6 `boot.scr`; its defconfig disables
`CONFIG_CMD_SETEXPR`. In addition, the bundle builder hard-codes the cx3576
DTB destination name, which would omit the DTB the s905x5m script loads. A
script-and-assembler-only patch would therefore create an unreachable artifact
and would not remove the eMMC p1 bridge dependency.

The proposed approval scope is consequently: add the board script; compile it
once and put identical bytes into both boot filesystems; guard its literal
partition numbers; add the smallest U-Boot p5/p6 sourcing route and
`setexpr` configuration assertion while retaining the SD bridge only for SD;
and derive bundle boot-payload names from the selected board. Offline checks
will compile the script, prove guard failures, inspect both boot filesystems,
and test the U-Boot and bundle contracts. They cannot prove a board boot, a
RAUC mark-good transition, or rollback; no hardware action is authorized by
this proposal. RFCT-929's existing package predates this source and the
proposed U-Boot routing change, so any later hardware use requires a newly
built, separately owner-authorized package.

Approval covers the board script, dual-slot assembler wiring, the smallest
replacement-U-Boot p5/p6 boot route, and `CONFIG_CMD_SETEXPR`. Each new config
promise must be asserted against the final post-`olddefconfig` `.config` with
a positive control; the existing section-5 checks and their FIT-debt warning
must not be weakened. The previously proposed bundle-payload naming work is
deferred and will not be changed by RFCT-930.

The implementation adds the identical compiled `boot.scr` to both p5 and p6.
It follows the cx3576 state machine while using eMMC `mmc 1`, the shifted
p5/p6/p7/p8 literals, the measured `0x3000000` kernel and `0x1000000` DTB
addresses, and `s7d_s905x5m_m100.dtb`. The script preserves both documented
RAUC fixes: load `mos-verity-${slotsuffix}.env` before the unsuffixed fallback,
and pass `rauc.slot=${bootslot}` because the verity root is `/dev/dm-0`.

The eMMC route now loads p5's `boot.scr` and tries p6 only if that file cannot
be loaded; it does not rerun a script that has already started, because that
would risk a second persisted credit decrement. SD continues to use `cfgload
sd`. The section-5 contract gained an exact `CONFIG_CMD_SETEXPR=y` positive
control and final-config requirements for the script's source, legacy-image,
verity-import, FAT/FS, booti, FDT/libfdt, and hush dependencies. The existing
bootcount, redundant-environment, and FIT-debt checks are unchanged. The
contract also rejects Amlogic's `CONFIG_AML_DISABLE_DEV_CMDS=y`, which would
otherwise remove `fatload` while leaving `CONFIG_CMD_FAT=y` visible.

An isolated 2026-08-31 build on `192.168.27.200` compiled U-Boot, applied the
route patch, passed its p5/p6 fallback host test, and reported every new symbol
in the final built `.config`; its `AML_DISABLE_DEV_CMDS` negative assertion
also matched once. It retained the expected FIT-signature warning.
The pinned Bun test route passed 7/7 boot-command tests and 10/10 s905x5m
assembler tests, including all four partition-number drift cases, `boot.scr`
legacy magic, and byte equality between p5 and p6. No package was built or
written, and no eMMC area, boot area, bootloader, or board was touched.

This is not hardware handshake verification. A board must first run the
replacement U-Boot after the separate owner-gated write before this plan can
claim an executed handshake, a RAUC `mark-good`, or rollback. RFCT-929's
already-built package predates these bytes, and bundle payload naming remains
deferred.

#### M3 dm-verity DT merge correction — approved 2026-08-31

Hardware testing of the RFCT-931 package corrected the preceding offline
assumption. The replacement U-Boot loads and sources p5's `boot.scr`, the
script loads the kernel from eMMC, and manual prompt checks show the full
quoted dm-verity table survives `env import`, `setenv bootargs`, and an
immediate `fdt print`. The kernel nevertheless rejects a truncated table.

The board's known-good SD bridge explains the boundary: Amlogic's
`add_kernel_bootargs()` treats `/chosen/bootargs` as merge input, splits its
entire value on spaces without quote awareness, and removes repeated words.
Those repeated PARTUUID, block-size, and block-count fields are required by
the verity target. The standard bootm FDT fixup copies the environment value
intact only when that merge-input property is absent. RFCT-930 mistakenly
copied cx3576's safe RK behavior of removing and then restoring the property.

The approved correction is deliberately narrow: after the resize, remove
`/chosen/bootargs` and leave it absent, exactly as the working SD bridge does;
the `else` warning is removed because a failed deletion can mean the desired
already-absent property. A source regression test must prove that nothing
reinstates it. Then rebuild the complete eMMC USB package on `192.168.27.200`
and publish only a verified artifact at
`/backup/mos-artifacts/rfct-290-<commit>/`. No flash, eMMC write, boot-area
write, `bootloader_a` write, deployment, or bootability claim is authorized.
The artifact will prove that the merge input is no longer reinstated; only a
later owner flash and observed boot can prove the board reaches userspace.

The correction completed at `a5919d39005022fed94e89b8b5a40aab2b832398`. Its
focused pinned test passed 8/8. An isolated non-Git snapshot on
`192.168.27.200` built the existing complete package chain, including the
12/12 rootfs smoke register, Amlogic format check, and 18/18 package round
trip. A separately checksum-verified package unpack found BOOT-A and BOOT-B
`boot.scr` byte-identical to each other and to a fresh reproducible compile of
the corrected source; both contain the deletion-only handoff and neither
reinstates `/chosen/bootargs`. The durable handoff is
`/backup/mos-artifacts/rfct-290-a5919d3/update.img` (1,369,400,096 bytes,
SHA-256 `c2955b05d8d85e04bd6109ec042c0755685992923c085c388b20b0aa8c538bec`).
This is evidence that the merge input is absent in the artifact, not evidence
that the corrected package boots; flashing and board observation remain
owner-controlled.

#### M3 HDMI handoff correction — completed 2026-09-01

The corrected RFCT-930 package has now booted from eMMC to the `mos` login and
reported a healthy `apid /healthz`, proving the dm-verity correction in the
previous section. HDMI is nevertheless blank. The production `boot.cmd` has no
Amlogic display environment, no `vout output`, no framebuffer/kernel display
arguments, and no `console=tty1`; the hardware-proven SD bridge has all of
them.

The required pair is exact: set the U-Boot display values, call `vout output
${outputmode}` before `booti`, and pass
`aml_media.vout=${outputmode},disable` along with `logo`, connector, HDMI
attribute, and mode arguments. The `,disable` suffix forces Linux to reprogram
the path; a seamless handoff has already produced a duplicated half-width
console on this board. `console=tty1` must precede, not follow,
`console=ttyS0,921600`, leaving serial as the final kernel console for the
bench.

**Configuration decision.** The display values remain documented literals in
the production script, rather than new `board.env` keys. They are fixed
pre-Linux BM201 handoff values, hush cannot source that file, and adding keys
without converting both the working SD bridge and production script into a new
shared renderer would create a third mutable copy. A focused source contract
will instead pin their exact values, required pair, and console order. The
existing `board.env` Q4 statement becomes true for the production route once
the script establishes the same U-Boot display state as the bridge.

The approved implementation adds that production stanza and its focused
regression checks, then makes the existing final built-`.config` contract require
`CONFIG_AML_VOUT=y`, `CONFIG_AML_HDMITX=y`, and `CONFIG_AML_HDMITX21=y`. Those
symbols are already in the board defconfig; this is an assertion of the
prerequisite after dependency resolution, not a config relaxation or a hidden
enablement. The U-Boot contract documentation will name them.

**Owner-approved coordination.** RFCT-930 lands source and focused verification
only; it must not build a standalone image. RFCT-932 owns the one combined
eMMC-package build on `192.168.27.200` after this HDMI commit is present and
must include `com.mos.mqttsample.reference`. RFCT-933's parameterized card
producer then consumes that exact combined package. The board is at
`192.168.27.56` and has no SD card; RFCT-930 performs no reboot or slot-content
change. A single later owner flash and viewed display can establish HDMI output;
source and package inspection cannot.

**Implementation evidence.** `eae91169c4f5efea3ddd709dbed167b48a1f0b3b`
adds the production display handoff and the final-config assertions without
enabling any new symbol or weakening an existing gate. Its isolated
`192.168.27.200` source snapshot passed the focused boot-command test (9/9,
41 expectations), a fresh reproducible `mkimage` compile, and
`make s905x5m-uboot`. The generated post-`olddefconfig` `.config` reported the
new VOUT positive control once and each of `CONFIG_AML_VOUT=y`,
`CONFIG_AML_HDMITX=y`, and `CONFIG_AML_HDMITX21=y` once; the existing FIT debt
remained a warning. No package, reboot, slot-content change, or hardware write
occurred. RFCT-932 now owns the only combined-package build and its dual-slot
inspection.

**Hardware confirmation.** The owner flashed the sole combined package,
`/backup/mos-artifacts/rfct-292-combined-0c9deaf6/update.img` (SHA-256
`1c09ad372ee33e2c2c5efc1bc4f1634481894c846ff493df19e363d10fd594e7`), built
from `0c9deaf6c75b43beb47c0d335757a7f42bb55dbb` and carrying
`eae91169c4f5efea3ddd709dbed167b48a1f0b3b`. It booted as `mos-7f600267` at
`192.168.27.61`; `apid /healthz` returned HTTP 200 and the owner saw a picture
on a connected HDMI display. This is observed hardware evidence, not a source
or package inference. The prior owner-flashed correction had already booted
from eMMC to a login prompt instead of stopping at `Waiting for root device`,
so both dm-verity and display handoffs are now observed.

The three final built-`.config` assertions and their VOUT positive control were
introduced in `eae91169` before the display observation. They now protect an
observed board property rather than being retrospective assertions written to
fit a successful result. The common root cause for both regressions was copying
cx3576 beyond its generic RAUC state machine: RK3576 has neither Amlogic's
quoted-bootargs merge behavior nor its `vout`/`aml_media`/`hdmitx` path.
`boot-sd.ini.in`, not cx3576's `boot.cmd`, is therefore the Amlogic-specific
reference, and the production script states that boundary at its top.

#### M3 reusable eMMC installer card — completed 2026-08-31

RFCT-933 addresses the gap between a complete Amlogic eMMC package and a
reusable card that can present that package to `sdc_burn`. It is deliberately
not a request to write a card or any board storage.

**This is not a protocol port.** mos already contains the Alpine-equivalent
private request/receipt implementation; this task changes only its payload-size
constants and adds the file-only installer-card producer and verification.

**Current input.** The owner selected
`/backup/mos-artifacts/rfct-290-a5919d3/update.img`, 1,369,400,096 bytes,
SHA-256 `c2955b05d8d85e04bd6109ec042c0755685992923c085c388b20b0aa8c538bec`,
because it carries the dm-verity bootargs correction. The producer takes it as
an input and does not pin it, so a later corrected package can be used without
changing the installer-card logic.
The existing external `aml_sdc_burn.ini` is deliberately bootloader-only:
`erase_bootloader = 1`, `erase_flash = 0`, and its own comment excludes GPT,
boot and rootfs replacement. It must not accompany the complete package.

mos already carries the Alpine-equivalent private BM201 installer source: the
header and patches `0009`, `0010`, `0012`, `0014`, and `0015` are
byte-identical to the reference. Its host tests prove the request/receipt
state machine: no inserted card continues normal boot; a present but unreadable
FAT card stops normal boot; loss of the source after a valid request stops;
an exact eMMC receipt skips; only zero `sdc_burn` may write and byte-read-back
the 65-byte receipt before reset. At investigation, its 768 MiB FAT / 640 MiB
package limit rejected the 1,305.961700 MiB package before a burn began. The
implementation changes only those two header constants and their corresponding
host-test expectations; no installer state-machine or protocol patch changes.

**Decision.** Use the private request/receipt protocol, which invokes
`sdc_burn bm201upd.ini` only after U-Boot validates an exact request and a
different-or-absent receipt. Do not use the vendor magic
`aml_sdc_burn.ini` name on the card: that unattended vendor path could bypass
the request and receipt gate. `bm201upd.ini` remains 8.3-compatible for the
vendor parser but is a different name. It configures the complete package
with `erase_bootloader = 1`, `erase_flash = 1`, `reboot = 3`, and
`package = update.img`; `reboot = 3` leaves the wrapper able to record and
verify the receipt before its own reset.

**Capacity.** The shared constants are 1,792 MiB FAT and 1,536 MiB maximum
package:

| quantity | bytes | MiB |
|---|---:|---:|
| current complete package | 1,369,400,096 | 1,305.961700 |
| maximum accepted package | 1,610,612,736 | 1,536 |
| growth before the limit | 241,212,640 | 230.038300 |
| FAT filesystem | 1,879,048,192 | 1,792 |
| raw space after the current package | 509,648,096 | 486.038300 |
| raw reserve at the package maximum | 268,435,456 | 256 |

The physical image reserves 4 MiB before the FAT partition and 16 MiB
after it: `4 + 1792 + 16 = 1812 MiB` (1,900,019,712 bytes). FAT starts at
sector 8192 and occupies 3,670,016 sectors. The 256 MiB reserve is before FAT
metadata and the four small control files; the final-image check will measure
actual free space and require at least 240 MiB.

**Approved implementation.** The implementation adds
`make os-emmc-installer-s905x5m-v2 EMMC_INSTALLER_PACKAGE=/path/to/update.img`.
It consumes that explicitly supplied, conventional `update.img` and the
existing `out/uboot/u-boot.bin.sd.bin.signed`, not a pinned RFCT artifact. A
container first rejects any input that is not the 18-payload complete Amlogic
package, so a bootloader-only image cannot combine with the full-flash sidecar.
It creates `out/emmc-installer/disk.img` with an MBR, LBA-1 U-Boot and one
FAT32 partition containing exactly `update.img`, `bm201upd.ini`,
`emmc-system-install.request`, and `update.img.sha256`.

The container reads the LBA-1 bootloader and all four FAT files back from
the final disk image; compare package and configuration bytes; require the
exact request; recompute and compare the 65-byte lowercase SHA-256 identity;
check the MBR geometry and actual FAT free space; and rejects `boot.ini`,
`boot.scr`, `Image`, `s7d_s905x5m_m100.dtb`, `aml_sdc_burn.ini`, or a receipt.
The target generates `disk.img.sha256` and prints the image path, size, digest,
geometry, and free bytes. No write target will be added.

**Bootstrap boundary.** An installed vendor U-Boot has no private protocol;
an older mos U-Boot has the protocol but its 640 MiB guard still rejects this
card. Before either can use the reusable card, host USB burning must install a
new complete mos package that includes the enlarged constants. That package
must be rebuilt after the parallel boot-script correction and this change; the
installer image remains parameterized so it can use that resulting package
without changing card logic. The card's LBA-1 U-Boot cannot bootstrap an
eMMC-first BootROM path.

**Scope and alternatives.** The approved implementation touches only the
s905x5m U-Boot installer constants/test, private configuration, containerized
card producer, Makefile wiring, U-Boot documentation, and this task record.
It excludes a block-device writer, any USB burner or `sdc_burn` invocation,
and every eMMC, boot-area, `bootloader_a`, or SD-card write. Reusing the
existing SD card is rejected because its only large partition is ext4 while
the vendor reader is FAT-only, and it would make an installer into a boot card.
Keeping Alpine's 768 MiB / 640 MiB values is rejected by the arithmetic above.

**Implementation and verification.** The public
`make os-emmc-installer-s905x5m-v2 EMMC_INSTALLER_PACKAGE=...` target completed
on `192.168.27.200` with the selected current input. Its source-level static
contract and existing U-Boot installer host test passed before artifact export.
The card producer unpacked the Amlogic container, checked its 18 payloads and
its generated `image.cfg` manifest, then verified the final LBA-1 loader and
all four FAT files by readback. The durable regular-file artifact is
`/backup/mos-artifacts/rfct-293-ff357295/disk.img`, 1,900,019,712 bytes,
SHA-256 `ff357295136ad454c8698bf45a14bc3342e9d69f5faf2c0eb42f4745a47b0661`.
Its FAT starts at sector 8192, has 3,670,016 sectors, and retained 505,933,824
bytes free after the package and three controls (above the 240 MiB gate). Its
checksum sidecar passed `sha256sum -c` after publication.

A separate run with RFCT-928's 10,267,648-byte bootloader-only package was
rejected at the 18-payload check, leaving the accepted artifact unchanged.
This establishes the full-package refusal path as well as the positive build.
It remains offline construction evidence only: no burner, eMMC, boot area,
`bootloader_a`, or SD card was written. The selected RFCT-930 package proves
that the producer remains parameterized; a complete package rebuilt with the
enlarged constants and the current boot-script correction is still the
one-time host-USB bootstrap for an older board.

**Combined-package refresh (2026-09-01).** The hardware-proven combined input
at `/backup/mos-artifacts/rfct-292-combined-0c9deaf6/update.img` is
1,369,400,096 bytes with SHA-256
`1c09ad372ee33e2c2c5efc1bc4f1634481894c846ff493df19e363d10fd594e7`.
An isolated `0c9deaf6c75b43beb47c0d335757a7f42bb55dbb` source archive rebuilt
the U-Boot input and ran the parameterized card producer without rebuilding a
package. The capacity constants still hold: the package is 241,212,640 bytes
below the 1,536 MiB limit; the final 1,792 MiB FAT has 505,933,824 bytes free.
The refreshed ordinary file is
`/backup/mos-artifacts/rfct-293-0c9deaf6/disk.img`, 1,900,019,712 bytes,
SHA-256 `04da31efd8ef6734eafa09ad3c58c0ea3ac2ab7197fdb59b0b104e8b1d18c111`,
with FAT start sector 8192 and 3,670,016 sectors. The normal producer readback
and a separate exported-image readback both verified the LBA-1 loader, all four
FAT files, identity, geometry, free space, and boot-file refusal. This is
offline artifact evidence only: no physical card was written, no `sdc_burn`
operation was exercised, and the combined-image board at `192.168.27.61` was
not accessed.

**Front-panel component build (2026-09-01).** The first artifact set carrying
`bm201-front-panel`, built at `fd42f54283c8` with
`MOS_ROOTFS_COMPONENTS='mqtt-reference bm201-front-panel'`. Both components are
opt-in, so the selection is the whole difference from the combined set: the
front-panel renderer is added and the MQTT reference, which the separation moved
out of board userland, is kept. The SD image is
`s905x5m-mos-v2-sd-1788251377.img`, 1,494,220,800 bytes, SHA-256
`ea05367bc02666448beafe3a70fd902fe96280e55fe6e976cd7c7cafbc2bcc3d`, and it
verifies at 375/375 with 9 skipped and no failure. The package is
1,369,400,096 bytes, SHA-256
`34ea50c701d8599d260cd34e963f462a6506f611fb637fac8cff6895167a9d9a`; the
installer card is 1,900,019,712 bytes, SHA-256
`a11d40501a82f3642d0ecf4766ec746fb007c829be6fc396c58d0c391442c95f`. The card was
read back byte for byte rather than inferred from a build status: the package is
embedded at offset `0x785000` and hashes to the package's own digest. Both sizes
match the previous set exactly, which is expected -- the Amlogic package regions
and the 1,792 MiB FAT are fixed, so selecting a component changes content and not
length.

That set was written to a card and booted, and the board stopped at the U-Boot
prompt: the installer gate refused, which RFCT-940 traces to a receipt kept on
the eMMC partition mos never writes. The "Bootstrap boundary" above already
governs this set -- the card cannot bootstrap an eMMC-first BootROM path, so
neither this set nor the one carrying RFCT-940's fix can install itself over the
pre-fix U-Boot that a board already holds.

**The kernel is not reproducible across build directories.** Rebuilding
`s905x5m-kernel` from identical sources in a second directory produced an `Image`
of the same 32,135,680 bytes differing in exactly 64 bytes, all of them inside
the version string's build date (`#1 SMP PREEMPT Tue Sep  1 ...` against
`Mon ...`); compiler, linker and release string are identical. The kernel build
does not pin `KBUILD_BUILD_TIMESTAMP`. The images are functionally equivalent but
hash differently, so an SD image built beside one kernel fails the runtime
register's boot-Image comparison against a board flashed from the other. This is
a second and independent reproducibility source from the rootfs `ldconfig`
aux-cache that PLAN-913 owns, and PLAN-913's scope does not reach it.

### MS — The SD path, and why most of the plan does not need eMMC — **done**

Added 2026-08-30. The milestones below were ordered as if every one of them
waited on M3, and they do not.

**This board's bootloader is in the eMMC hardware boot area regardless of where
the system lives.** The vendor U-Boot's `bootcmd` is `run storeboot`.
`s905x5m-alpine`'s `boot.ini` ships unchanged on both an SD card and in the
eMMC package and picks its device by testing which one actually carries a
kernel:

    if test -e mmc 0:1 /Image; then setenv devnum 0; else setenv devnum 1; fi

There is a gate before that script runs. The vendor `cfgload` SD arm validates
`mmc 0:1`, requires a non-empty `/Image` on that filesystem, and only then
executes `/boot.ini` or `/boot/boot.ini`. The carrier image meets the gate
because its kernel and script are both in p1. The mos `boot-a` slot is p5, so a
normal mos layout is invisible to that gate even though the slot itself is
valid.

The SD-only assembler therefore formats p1 as a compatibility bridge containing
exactly a real `/Image` and `/boot.ini`. The script loads the real `Image` and
DTB from p5 and supplies the slot-A dm-verity command line. It does not move,
renumber or redefine p5/p6, and it does not add SD-only files to either boot
slot. This use of p1 is legal only on SD: the same range is vendor-owned on
eMMC. The dedicated output name contains `-sd-`, carries no bootloader, and must
never be written to eMMC.

The canonical build is `make os-image-s905x5m-sd-v2`. Its assembler arm is
`bash os/build/run.sh --mkimage-s905x5m-sd`, not `--mkimage-v2`, because the
cx3576 arm embeds a Rockchip loader while this one embeds no bootloader and
creates the SD-only p1 bridge. PLAN-011 verified a GPT card booting through the
vendor path on 2026-08-23; MS proved the mos image on a confirmed SD card on
2026-08-30.

The final clean build produced
`_out/s905x5m/s905x5m-mos-v2-sd-1788124881.img`, 1,494,220,800 bytes, with
SHA-256 `82f922650b3c7141fa9a10441c7a82030d7e667f3541bb62aad9bb5713c12205`.
Its ROOTFS-A payload is 116,391,936 bytes with SHA-256
`8dd7d1df2c0dcbf58103b98d70d2dcc0c967e4a5c2a4a5e49a5ac8001c76c52a`
and verity root hash
`eff883635614f237f9faf0231a1e94692eb6f10e19c4b6cbccaa190037747c8b`.
The dm table uses 28,122 data blocks and starts the hash tree at block 28,123,
after the one-block verity superblock.

Before the first card write, Linux identified the target as `/dev/mmcblk1`,
type `SD`, name `SR64G`, CID
`03534453523634478664e2c850019500`; it exposes no hardware boot devices. The
board's eMMC was separately identified as `/dev/mmcblk0`, type `MMC`, name
`AT3SFA`, CID `ec290041543353464130229911cf2c00`, with `boot0` and `boot1`.
Vendor U-Boot numbers those devices differently: `mmc list` named `sd: 0` and
`emmc: 1 (eMMC)`, and `mmc dev 0; mmc info` repeated the `SR64G` identity. The
whole image and the final p1/p5/p6/p7 boot payload updates were written only to
that SD device; each final payload write was read back from `mmc 0` and matched
its source CRC before reset. No command selected `mmc 1`, and no eMMC partition
or boot area was written.

After a normal reset with no RAM patch, serial output recorded `cfgload: strict
SD source selected (mmc 0:1)`, the p1 bridge loaded `Image` and the DTB from p5,
and Linux preserved the quoted dm-verity table. `dm-0 (rootfs) is ready` was
followed by a read-only squashfs root mount and the multi-user and graphical
targets. Every mounted MMC filesystem came from `/dev/mmcblk1`; apid returned
`ok` from `/healthz`.

The exact required verifier command,
`bash os/verify/run.sh --verify --board s905x5m`, reported `FAIL (360/371
checks, 9 skipped)`. The 360 passing checks include the GPT and filesystem
geometry, both boot-slot kernel/DTB artifacts, slot-specific verity metadata,
and a complete ROOTFS-A verification against the hash above. The eleven
failures all ask for the production mos `boot.scr` path that vendor `cfgload`
does not execute: two missing-file checks, four A/B boot/root partition
extractions, three script identity/magic/root-argument checks, and two RAUC
slot-source checks. MS leaves the declared boot-slot contract unchanged and
records those failures as out of scope instead of fabricating an unused
script. The same boundary appears on hardware as the sole failed unit:
`mos-health` reaches slot A, mosd and apid, then fails when vendor U-Boot cannot
complete `rauc status mark-good`.

**What the SD path gets, at zero risk to the boot area:** the kernel booting on
real hardware, the squashfs + dm-verity root, both A/B rootfs slots present,
the peripherals of M4, and most of M5's power-cut work.

**What it cannot get: the RAUC handshake.** That logic lives in our own
`boot.cmd` — credit accounting, `saveenv` persisted before booting, the bad-slot
mark when `booti` returns. Booting from SD runs the *vendor* U-Boot, which
`cfgload`s a `boot.ini` and neither reads `BOOT_ORDER`/`BOOT_<slot>_LEFT` nor
marks a slot bad on failure. RFCT-911 established that.

So the order changes: **M4 and M5 run on SD before M3, not after it.** When the
first eMMC boot-area write finally happens, everything except the handshake has
already been proven on this hardware, and a failure has one candidate cause
instead of five.

The `uenv-a`/`uenv-b` pair at 120/124 MiB is present but unused during the SD
phase: the vendor U-Boot keeps its environment in the eMMC `env` partition. The
two do not conflict and do not interoperate.

### M4 — Peripherals as systemd units — **done for the SD phase**

The carrier implementation and the built kernel split the peripherals as
follows. A DT modalias exists for `aml_drm`, `amlogic_usb`, and the Meson DWMAC
drivers, so udev coldplug loads the kernel pieces for HDMI, USB, and Ethernet.
HDMI additionally needs the vendor U-Boot mode setup carried by the SD
`boot.ini`; Ethernet is then configured by networkd. None of those three needs
a board hwinit unit.

Wi-Fi, Bluetooth, and audio do need ordered board initialization:

| fact | image input | hwinit responsibility |
|---|---|---|
| Wi-Fi | `SWT6621_IRAM_SDIO.bin`, `SWT6621_DRAM_SDIO.bin`, `EA6521QF_SEEKWAVE_R00005.bin`; `amlogic-wireless`, `skw_sdio`, `skw` | load the platform driver, power `/sys/class/aml_wifi/power`, load the SDIO stack in order, and wait for `p2p0` (the measured station interface) |
| Bluetooth | the same powered combo module; `hci_vhci`; `libskwbt.so`, the vHCI bridge and three NV config files | wait for `/dev/BTDATA` and `/dev/vhci`, derive a stable locally administered address in STATE, then supervise the bridge before BlueZ |
| Audio | `amlogic-snd-codec-dummy`, `amlogic-snd-codec-t9015`, `amlogic-snd-soc`; `alsa-utils` | wait for card 0 and route Tdm_B stereo PCM to HDMI with the four measured mixer controls |

Accordingly `BOARD_HWINIT_CONFS="wireless audio bluetooth"` is now a statement,
not the old placeholder. The 2026-08-30 SD boot established the runtime split:

| endpoint | hardware result | board hwinit |
|---|---|---|
| HDMI | connector connected and enabled at 1080p60; DRM took over the mode vendor U-Boot established | none; U-Boot display setup plus kernel/DT |
| USB | the `05e3:0610` hub, `3434:d030` keyboard, and `1ea7:0064` mouse enumerated and produced input devices | none; kernel/DT |
| Ethernet | RTL8211F link at 1 Gbit/s full duplex, DHCP and default route; apid `/healthz` returned `ok` | none; kernel/DT plus generic networkd |
| Wi-Fi | firmware and calibration loaded, the efuse MAC was accepted, and an actual `p2p0` scan returned 38 access points across both bands | `mos-wireless.service` |
| Bluetooth | the SDIO service, vHCI bridge and BlueZ started; controller `02:AD:47:01:36:D8` was powered and exposed central/peripheral roles | `mos-wireless.service` then `mos-bluetooth.service` |
| audio | the Amlogic card registered, Tdm_B stereo PCM was routed to HDMI, and a two-second `aplay -D hw:0,1` stream completed | `mos-audio.service` |

All three board hwinit units and `systemd-networkd`, `bluetooth`, mosd, and apid
were active after boot. A ten-second Bluetooth discovery window found no
discoverable peer, so the controller and transport are proven but pairing and
a profile exchange with a controlled peer remain a follow-up rather than an
inferred result.

### M5 — Acceptance

Image assembled, `os/verify/run.sh --verify --board s905x5m` green, apid
liveness on hardware, and a power-cut rig run. Per §7 step 6 the board is not
called supported before the rig run. MS supplied the assembled image and apid
liveness. RFCT-934 now proves the production watchdog path on hardware, but
the complete end-to-end image verifier and the power-cut run remain. The owner
confirmed on 2026-09-01 that no relay or PDU is available: acceptance criterion
6 is therefore **open**, not waived or met, and the board is **not yet
supported**.

#### M5 watchdog hardware investigation and proposal — 2026-08-31

RFCT-934 accepts the user's 20:51 UTC handshake-foundation observations as
input and does not repeat them. Its read-only board inspection instead asked
the unresolved safety question: whether B can actually recover A before A's
credits are deliberately spent. `BOOT-A`/`BOOT-B` are 64 MiB VFAT p5/p6 and
`ROOTFS-A`/`ROOTFS-B` are 256 MiB p7/p8. p8 is all zeroes, so B is not currently
bootable even though its slot-status metadata says good. p6 is nevertheless a
complete B boot payload: it carries the kernel, DTB, `boot.scr`, and a
370-byte `mos-verity-b.env` that addresses p8 (`...0006`) with the same verity
root hash A uses. The p5/p6 scripts are byte-identical
(`89e4d345a808ddc31dc959e92d031d9b60d25fb49fbbdb409eafd8406f0898f5`).

The safe recovery construction is therefore narrow: copy the active raw p7
payload to inactive p8, sync it, and compare all 256 MiB byte-for-byte. That
changes only rootfs-slot contents; it neither writes an eMMC boot area nor
`bootloader_a`, and p6's already-correct B verity declaration then makes the
copy bootable as B. This copy must be completed and logged before the first
deliberate failed boot.

The full USB-burning recovery artifact is also present on the approved build
host at `/backup/mos-artifacts/rfct-290-a5919d3/update.img`. It is
1,369,400,096 bytes; its sidecar verifies SHA-256
`c2955b05d8d85e04bd6109ec042c0755685992923c085c388b20b0aa8c538bec`.
It is a recovery artifact only: invoking it would write a bootloader and is
outside this task. A checksum alone is not a recovery position; before a
failure test, the owner must also confirm a physically reachable USB-burning
host, cable, and operator.

`/` and `/etc/systemd/system` are read-only, so a persistent systemd mask
cannot be staged there. The proposed reversible inhibition writes neither
rootfs nor U-Boot: save each exact `mos-verity-<slot>.env` in its own boot VFAT,
append `systemd.mask=mos-health.service` to the active env line in p5 and p6,
and verify the before/after hashes. The production script imports that value
into kernel `bootargs`; with both gates masked, the four reboot observations
must be A `2/3`, A `1/3`, A `0/3`, then B `0/2`. Restore B's original env while
running B and reboot it: the pre-boot decrement to B=1 followed by a completed
`mos-health` run must refill B to 3. Restore A's original env and make one final
healthy A boot, leaving the board A=3/B=3.

Scenario 2 is safe to attempt only after that construction succeeds: hide
only A's suffixed verity env while keeping the exact file as a VFAT backup;
the script should burn A and reset to B, after which the file is restored.
Scenario 3 is not safe with SSH alone. An invalid kernel may make `booti`
return, hang, or reset, and a hung board cannot be advanced to B without a
physical power control. It is deferred until the rig is present.

**Power-cut rig proposal.** The owner must supply a suitably rated, remotely
controlled relay/PDU on the board's DC input (not a USB-data disconnect), a
USB-UART serial capture connected through every power cycle, and a control host
that timestamps relay commands and can restore power. With B already bootable,
the controller must exercise at least 50 randomized cuts spanning the U-Boot
`saveenv` interval, restore power after each, retain the serial log, and verify
on every recovery that U-Boot does not report a bad/default CRC and that Linux
can read a coherent `BOOT_ORDER`/credit pair. A serial-triggered random delay
after U-Boot's save message is preferred to blind wall-clock delays. The run
also needs the verified USB recovery package and a human able to attach the
burning cable if both slots fail. A sandbox, an ordinary reboot, or a simulated
relay is not a rig run.

**Owner decision — rig blocked.** On 2026-09-01 the owner confirmed that no
remotely controllable DC relay or PDU is available, so this rig run is not
authorized and no substitute is permitted. The redundant `uenv-a`/`uenv-b`
pair is intended to survive a power loss while `saveenv` persists the pre-boot
attempt decrement; that property is asserted by the design and sandbox harness
but remains unproven on this board. Reopening the acceptance needs the relay or
PDU, continuous USB-UART capture, a control host with timestamped power
control, at least 50 randomized cuts in the `saveenv` window, and a physical
recovery host/cable/operator. Until then, PLAN-910 must not call this board
supported.

The approved implementation scope would be only p5/p6/p7/p8 slot contents,
existing `fw_printenv`/`fw_setenv` observations, controlled reboots, and the
tracking records. It excludes source `boot.cmd`, SD media, eMMC boot areas,
`bootloader_a`, full-package flashing, and pushes. If the physical recovery
position is not confirmed, RFCT-934 stops before any deliberate exhaustion.

#### M5 one-artifact coordination — 2026-09-01

The owner approved one combined HDMI/MQTT artifact and one owner flash for the
entire hardware pass. The M3 handoff assigns RFCT-932 as the sole package
builder: only after `8yaodbbi` lands the HDMI `boot.cmd` work and its required
three post-`olddefconfig` built-config assertions, RFCT-932 will build one
package on `192.168.27.200` from the commit that also contains
`com.mos.mqttsample.reference`. Its artifact path and SHA-256 must be logged
before flash. No independent HDMI, MQTT, or watchdog package is permitted.

`ccql8vgp` will feed that exact package to the parameterized card builder. The
owner then flashes the board once. HDMI output and MQTT bridge evidence run on
the healthy flashed A slot first. RFCT-934 alone next establishes the fallback
by inspecting the flashed B boot payload and copying p7 to p8 with `sync` and
a complete byte-for-byte comparison; this must occur after the owner flash so
the final combined payload, rather than an obsolete image, is what B boots.
The board is `192.168.27.56`, has no SD card, and no M5 operation targets
`/dev/mmcblk1*`.

Only then may RFCT-934 inhibit `mos-health` and perform the reboot sequence.
The hardware sequence remains bounded to p5/p6/p7/p8 slot contents and excludes
eMMC boot areas and `bootloader_a`; no source change, package flash, or second
image build is part of this M5 work.

#### M5 current watchdog execution authorization — 2026-09-01

The owner separately approved RFCT-934 to run the bounded watchdog proof on
the current eMMC image without waiting for the later combined-package flash.
Before spending A credits, RFCT-934 will validate the active rootfs and B boot
payload, copy p7 to p8, `sync`, and compare all bytes. USB recovery is
unconfirmed, so that verified B copy is the sole fallback; any mismatch stops
the test. The owner selected the active p7 clone as the one B source; the
combined package's zero-filled `rootfs-b.PARTITION` is excluded. RFCT-932's
recorded interlock leaves p8 exclusively to RFCT-934.

RFCT-934 will then use the reversible `systemd.mask=mos-health.service` kernel
argument in each slot's verity env and observe A `2/3`, A `1/3`, A `0/3`, then
B `0/2`, restoring B's exact env and proving B refills to 3. Scenario 2 may
follow only after that recovery is restored. Scenario 3 remains out of scope:
serial capture exists, but the missing switched-power rig and unconfirmed USB
recovery make a malformed-kernel experiment unsafe. Each slot change and
reboot is logged in RFCT-934 before it occurs.

#### M5 hardware watchdog result — 2026-09-01

RFCT-934 completed the approved current-eMMC hardware proof without flashing a
package or writing an eMMC boot area or `bootloader_a`. Before consuming A
credits, it copied all 268,435,456 bytes of p7 to p8, synced the write, and
completed a full byte comparison; both partitions SHA-256 to
`959e55a84de76173060b406ec49e45dd1624aed50aab8c67ac99534b1f541c14`. B then
booted the cloned p8 rootfs for real.

With the health gate reversibly masked in both slot verity environments, the
board followed the required persisted-credit trajectory exactly: A=2/B=3,
A=1/B=3, A=0/B=3, then B=0/B=2. Continuous USB-UART capture records `Saving
Environment to MMC` before the boot decisions. Independent 02:30 UTC status
confirmation recorded `BOOT_A_LEFT=0`, `rauc.slot=B`, dm-0 over `mmcblk0p8`,
`rootfs.0` (A) with boot status `bad`, and `rootfs.1` (B) with boot status
`good`, booted. This proves that A was marked bad, not merely skipped.

**Proved on hardware.** B's final counter of 3 is a mark-good refill, not a
non-decrement. On the restored healthy B path after A failed, U-Boot recorded
B=2 before Linux completed the health gate. `mos-health` then logged
`PENDING_CONFIRM -> CONFIRMED` and `booted slot B marked good`, while RAUC
logged `Marked slot rootfs.1 as good`; only after that did the persisted
counter read B=3. The independently confirmed B=2-to-B=3 observation
establishes decrement followed by refill. The separate restored-B reboot after
scenario 1 also consumed B=1 before the same refill, providing a second
per-reboot confirmation. Scenario 2 also passed on hardware: a hidden A
suffixed verity env burned A to zero and reset into B; the exact file was
restored afterward. The final healthy state is active A, `BOOT_ORDER=A B`,
A=3, B=3, zero failed units, byte-identical p7/p8, and both original unmasked
verity environments restored. The raw serial evidence is archived at
`/backup/mos-artifacts/rfct-294-watchdog-20260901T0220Z/serial.log` (SHA-256
`f03851a304fedfd12c1b82065c12d15b3f460efdb38404a7643a2397d5ad451e`).

**Not proved on hardware.** Scenario 3 was not attempted: a returning or hung
`booti` needs switched power to advance safely, and USB recovery is still
unconfirmed. More importantly, this proof does not satisfy criterion 6. No
physical power-cut rig exists, so the redundant uenv pair's ability to survive
an interruption in the `saveenv` window remains design- and sandbox-asserted
but unproven on this hardware. Criterion 6 is **open / blocked** and the board
is **not supported** until the owner can provide the specified rig: a remotely
controllable DC relay or PDU, continuous USB-UART capture, a control host, and
at least 50 randomized cycles landing in the `saveenv` window.

## Acceptance criteria

1. `board.env` lints clean and the other boards are unaffected. **Met at M0.**
2. A kernel built here asserts the shared fragment against its own `.config`.
   **Met at M1.**
3. The BSP produces `Image`, `modules.tar`, `*.dtb` and a bootloader through
   the §3 interface. **The kernel set is met; M2 adds the bootloader build but
   deliberately refuses its §3 export until all four §5 gaps close.**
4. The bootloader-ownership decision is written into `docs/design/boards.md` §8.
   **Met at owner decision `09873f7`.**
5. An assembled image passes `--verify --board s905x5m`. **The offline
   boot-script portion is met by RFCT-930: a regenerated assembly test proves
   the compiled script, partition guard, and both boot-slot copies. The
   board-executed RAUC watchdog handshake is met by RFCT-934's persisted
   decrement, A-to-B failover, and healthy-slot refill proof. The complete
   end-to-end run is now met: `--verify --board s905x5m` reports 380/380 with
   9 skipped and no failure against `s905x5m-mos-v2-sd-1788228521.img`
   (sha256 `398675ef96aa2fb1...`), the image the board is running, and
   PLAN-920's booted-board register reports 15/15 against that same image.
   The verifier must be run on the build host: off it, `_out/` and the BSP
   kernel artifacts are absent and the environment cannot round-trip a
   `security.capability` xattr, which fails six checks for reasons that are
   the checkout's, not the image's. Criterion 6 remains separate and open.**
6. A power-cut rig run completes. **Open / blocked:** the owner has no remotely
   controllable DC relay or PDU. The redundant-environment survival property is
   unproven on this hardware, so this board is not yet supported.

## Proposal

For M1, add a minimal `os/boards/s905x5m/bsp/Makefile` with a `kernel` target
that follows the cx3576 buildx interface: the pinned Ubuntu image comes from
`os/build-env/images.env`, `os/boards/common` is passed as the `mos-common`
named context, and the scratch-stage artifacts export to `out/kernel`.

Import the working kernel baseline, DTS, 13-patch series, front-panel module,
and Seekwave module sources under `bsp/kernel/`. Split the source build's
Alpine fragment so it retains only board-specific container options; the
shared mos fragment remains the only copy of the common floor. Merge the board
fragments and `mos-required.fragment` before `olddefconfig`.

After `olddefconfig`, positively control the final `.config`, assert every
shared `=y` line with an exact fixed-string match, and assert the one
`CONFIG_LSM` line separately. Keep the existing board-specific assertions,
pin the observed release `6.12.38-m100-arm64`, build all modules, run `depmod`
after the out-of-tree modules are installed, and export only `Image`,
`modules.tar`, and `s7d_s905x5m_m100.dtb` from the artifact stage.

Verify the implementation with a clean build on `debian13`, inspect the final
config again, require the module indexes and the three board-specific modules,
validate the DTB compatible string, and copy the resulting artifact directory
back to the board BSP output path. Run the documentation index locally and the
board lint through the pinned Bun container on `debian13` before committing;
the workstation's Bun 1.3.12 cannot read this tree's lockfile v2, and its Docker
daemon cannot mount the client's `/workspace` path.

### M2 — approved and implemented

Import only the committed `s905x5m-alpine:uboot/` input set at `49618bed` into
`os/boards/s905x5m/bsp/uboot/`. Preserve the known-good CoreELEC pin, board
config, DTS, DDR input, 15-patch series, host tests, and BL33 non-zero-content
check. Adapt the Dockerfile to the repository's pinned frontend and
`MOS_IMAGE_UBUNTU_2404` injection, pin the patch count, and add `make uboot`
with the same buildx/output shape as the existing BSP targets.

Separate the completed build from its mandatory contract gate inside the
Dockerfile. The build stage may create the three measured artifacts, but the
default artifact stage must depend on a contract stage that reads the final
`bl33/v2023/build/.config`. It first requires the exact
`CONFIG_CMD_CFGLOAD=y` positive control, then reports an explicit zero or one
match count and the observed value for every section 5 symbol. It accumulates
all failures so one missing option does not hide another. Only a passing gate
may export `out/uboot`; the current baseline must therefore fail without
exporting an artifact, matching M1's missing-option discipline. The canonical
replacement input is `u-boot.bin.signed`, which a later Amlogic package stage
must frame for `boot0`; it is not a raw boot-area image.

Do not change the measured config values in this implementation step. A remote
`--target build` run will verify that the relocated recipe still produces the
expected artifacts; the default build will verify that the mandatory gate
fails and names every unsatisfied item. This records a blocked contract rather
than presenting a baseline artifact as section-5 compliant. The environment
layout below is approved for M2, but changing the U-Boot backend remains a
separate config decision together with the bootcount backend and shared
FIT-signature policy.

#### Q2 layout — approved for M2

Add two `uboot-env` partitions without moving an existing byte offset:

| field | `uenv-a` | `uenv-b` |
|---|---:|---:|
| partition number | 3 | 4 |
| start MiB | 120 | 124 |
| start sector | 245760 | 253952 |
| U-Boot byte offset | `0x07800000` | `0x07c00000` |
| size | 128 sectors / 64 KiB | 128 sectors / 64 KiB |
| proposed GUID | `5905A5A0-0002-4000-8000-000000000011` | `5905A5A0-0002-4000-8000-000000000012` |

Keep `reserved` p1 and vendor `env` p2 unchanged. Renumber current p3–p10 as
p5–p12 while preserving their labels, GUIDs, and starts; in particular,
`boot-a` remains at 128 MiB. Add the four leading repart placeholders described
in the investigation: `Weight=0` and `PaddingWeight=0` for all four, with
`SizeMinBytes=0` where the existing partition is below repart's 10 MiB default.
Generalize only the loader checks that incorrectly equate every U-Boot board
with a GPT `raw-blob`. The U-Boot side may switch to the exact MMC backend
values measured above only after that config change is separately approved;
the RAUC renderer can address each new PARTUUID at offset zero now.

## Scope

- One minimal BSP Makefile and one kernel Dockerfile plus its context allowlist.
- Existing kernel inputs imported from the clean carrier commit: one baseline,
  two board fragments, one DTS, 13 patches, the front-panel module, and the
  Seekwave driver sources. Firmware blobs remain M2 work.
- PLAN-910 and RFCT-910 records for the measured config result and verification.
- No vendor-kernel source change, shared-fragment change, bootloader work,
  rootfs/image-assembler change, remote push, or hardware claim.

### M2

- `os/boards/s905x5m/bsp/Makefile` plus the new committed U-Boot build context.
- The approved `uenv-a` / `uenv-b` entries and their board-specific repart
  placeholders.
- RAUC and verifier loader assertions selected by the `raw-blob` role rather
  than by the U-Boot backend.
- PLAN-910 and RFCT-912 records for the produced-config audit and Q2 answer.
- No boot script, image-assembler boot-area write, shared U-Boot policy,
  hardware, boot area, or remote repository change. The already-recorded
  replacement decision is an input, not a write authorization.

## Alternatives

- Keeping `alpine-required.fragment` unchanged would duplicate almost the
  entire shared floor and let the two copies drift; retain only its board
  additions instead.
- Fetching `s905x5m-alpine` during the container build would add a private
  repository and credentials to the build graph; import its small pinned input
  set while continuing to fetch the public Hardkernel tree directly.
- Omitting the front-panel and Seekwave modules would make a smaller M1 but
  regress the already booted kernel's module set. Preserve them and defer only
  firmware staging and service integration.

### M2

- Exporting the artifact despite a failed contract would make the interface
  consumable while known non-compliant. Keep the contract between build and
  export instead.
- Enabling the literal symbols only for s905x5m would hide the shared
  FIT-signature gap and choose bootcount/environment behavior without an A/B
  design. Record the failures instead.
- Reusing any bytes in the vendor `env` partition is rejected: ownership of the
  replacement bootloader does not stop vendor firmware from writing its
  hardcoded 108–116 MiB range.
- The minimum-alignment pair at 116/117 MiB also fits, but puts the primary
  against the vendor boundary and the copies only 1 MiB apart when there is no
  capacity pressure. The proposed 120/124 MiB starts spend none of the existing
  layout while leaving conservative guard space on both sides.
- Moving `boot-a` or any later partition would gain nothing: the existing
  12 MiB slack is sufficient. Preserve every byte offset and shift only GPT
  entry numbers when the separate layout change is reviewed.
- Stopping with documentation only would avoid landing a deliberately blocked
  build gate, but would also leave the already-proven build outside the §3
  producer shape. The proposed split preserves that evidence without exposing
  a contract-bypassing default artifact.

## Annotations

- 2026-09-10: Superseded by the current signed-file S905X5M task and plan above.
  Historical hardware results remain evidence, but no RAUC/raw-slot operation
  in this record is forward-looking. Current physical gaps remain explicitly
  open under `20260910-1013-open-plans-campaign` pending ownership.

- 2026-08-30 13:37 UTC: M1 investigation complete; implementation awaits
  explicit approval.
- 2026-08-30 13:42 UTC: M1 proposal approved with `proceed`; implementation
  started.
- 2026-08-30 14:09 UTC: M1 completed; the clean remote build, final config
  audit, negative assertion check, documentation index, and 39 board lint
  checks passed.
- 2026-08-30 14:50 UTC: M2 investigation completed. The clean U-Boot build
  succeeded, all four section 5 requirement groups failed against its final
  `.config`, Q2 was bounded without a layout change, and the blocked-result
  proposal awaits explicit approval.
- 2026-08-30 15:00 UTC: The owner decision at `09873f7` was accepted as the M2
  baseline. Q2 was revised to keep the stock vendor range untouched and propose
  a 120/124 MiB redundant pair in the stock-table hole; the layout change
  remains a separate review.
- 2026-08-31 13:59 UTC: RFCT-930 investigation found the missing production
  boot command, its absent assembler wiring, and the current U-Boot/bundle
  integration blockers. The end-to-end proposal awaits explicit approval; no
  hardware action was taken.
- 2026-08-31 14:03 UTC: The owner approved RFCT-930's script, dual-slot
  assembler, `CONFIG_CMD_SETEXPR`, and p5/p6 U-Boot-route work. New config
  promises require final-`.config` assertions with a positive control; the
  existing section-5 gate remains intact. Bundle naming is deferred.
- 2026-08-31: RFCT-930 completed its approved offline work. An isolated remote
  build compiled the U-Boot route and final-config contract, while the pinned
  tests proved the source guard and identical p5/p6 scripts. No hardware,
  package, deployment, or eMMC write occurred; live RAUC handshake evidence
  remains pending the owner-gated first write.
- 2026-08-31 19:21 UTC: RFCT-931 was claimed to rebuild the complete eMMC
  package at `4ee725d103ff42d7b635562974091daecfea1bb8`. The approved scope
  reuses RFCT-929's package chain, adds no packaging behavior, and requires
  container, BOOT-A/BOOT-B script, final-built-config, section-5, and no-cache
  reproducibility evidence before an artifact is handed off. No hardware
  action is authorized or implied.
- 2026-08-31: Owner serial evidence from the earlier `acd48f8` flash confirms
  that mos U-Boot, the twelve-entry GPT, and the expected three-file p5/p6
  payloads were written; both boot slots lacked only `boot.scr`. It also shows
  that the current SD and eMMC producers share the static `board.env` GUID
  set. With both media present, every PARTUUID consumer, including dm-verity,
  the redundant environment, and RAUC A/B slot devices, can resolve the wrong
  medium. RFCT-931 records this risk but does not change GUIDs: after the
  first flash, identity renumbering is an owner-level layout decision.
- 2026-08-31 19:50 UTC: RFCT-931 completed the isolated rebuild from
  `4ee725d103ff42d7b635562974091daecfea1bb8`. The normal and no-cache package
  builds passed format and 18/18 byte round trips and produced the same
  1,369,400,096-byte image, SHA-256
  `b5d8b4f8b91a017d12d21db6412c4f0167d2d5f9ab33133852e149c6671d636a`, at
  `/backup/mos-artifacts/rfct-291-4ee725d/update.img`. Both boot slots contain
  the identical compiled `boot.scr`; the final-built-config contract applied
  the eMMC-script patch and passed all board-owned requirements while retaining
  the non-blocking FIT warning. This is offline construction evidence only; no
  hardware write or boot claim was made.

- 2026-08-31 20:23 UTC: RFCT-933 was claimed for investigation of a reusable
  eMMC installer card. The private protocol, capacity derivation, complete
  package validation, no-boot-card rule, and host-USB bootstrap boundary are
  recorded above. Implementation awaits explicit approval and authorizes no
  media or board write.
- 2026-08-31: The owner approved RFCT-933 implementation. The approved scope
  is limited to the two shared capacity constants and the parameterized,
  file-only card producer; the existing five installer gate outcomes remain
  unchanged.
- 2026-08-31: RFCT-933 completed the file-only card producer and its remote
  readback verification. The 1,900,019,712-byte installer image at
  `/backup/mos-artifacts/rfct-293-ff357295/disk.img` has SHA-256
  `ff357295136ad454c8698bf45a14bc3342e9d69f5faf2c0eb42f4745a47b0661`.
  No physical media or board storage was written.
## Risks

**The rescue is not proven for a mos image.** USB burning restores what was
last flashed as a whole package; it does not patch one partition. The factory
package built on 2026-08-29 has never been written to a board, so the proven
rescue remains a third-party repack. Before M3's first write, one of the two
has to be exercised on hardware.

**Two vendor ranges are claimed but their completeness is not proven.**
`reserved` at 36–100 MiB and `env` at 108–116 MiB are declared because the
stock table declares them. `s905x5m-alpine` found a second such range only
after fixing the first, so the possibility of a third is open until the whole
stock table has been walked against the mos layout.

**Cold arm64 roots are not yet byte-reproducible.** Rebuilding from a cold
stage cache changed only
`/usr/share/factory/var/cache/ldconfig/aux-cache` in a full unpack comparison,
but that byte change also changes the squashfs and verity root hash. It did not
affect this hardware result; eliminating or normalizing that generated cache is
a separate reproducibility follow-up.

**Bluetooth pairing is not yet exercised with a controlled peer.** The SDIO
transport, vHCI controller, BlueZ state and discovery command all worked, but
the ten-second scan window contained no discoverable device. Do not infer a
pairing or profile result from an empty scan.
