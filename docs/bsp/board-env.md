# board.env key reference

`boards/<name>/board.env` is the board definition — the single source of
truth for the partition layout, the architecture, the console, and the
hardware the image must carry. This page is the key reference, derived from
the two shipped definitions ([cx3576](../../boards/cx3576/board.env) and
[x64](../../boards/x64/board.env)) and from what their consumers read. It
documents no key those files do not carry.

The authoritative contract around the file is
[docs/design/boards.md](../design/boards.md); the schema itself is enforced
by the board-definition lint.

> status: shipped — evidence: `make os-layout-lint`

## File format and consumers

Plain `KEY=value` lines: no logic, no command substitution beyond simple
`$((...))` arithmetic and `"${VAR}"` aliasing of another key in the same
file. Safe to `source` from bash and to parse with grep/sed — and consumers
read it as data, never hand it to a shell.

Who reads it:

| Consumer | What it reads |
|---|---|
| `build/src/mkimage-cx3576.ts`, `build/src/mkimage-uefi.ts` | the whole layout: partitions, offsets, boot-slot content, naming |
| `rootfs/build.sh` | `MOS_ARCH`, `BOARD_CMDLINE_ARGS`, `BOARD_RADIOS`, `VERITY_SALT`, `FILE_MTIME`, partition GUIDs, `BOARD_SIZE_BUDGET_MB` |
| `pkgs/rauc/render-config.sh` + `pkgs/rauc/system.conf.in` | slot devices, `RAUC_BOOTLOADER`, boot-attempt limits |
| `rootfs/overlay/etc/fw_env.config.in` | `UENV_*_OFFSET_BYTES`, `UENV_SIZE_BYTES` (U-Boot env access from Linux) |
| `boards/<name>/deb/board-<name>/render.sh` | `BOARD_FIRMWARE_FILES`, `BOARD_HWINIT_CONFS` |
| `verify/` (lint and image verification) | everything — both the schema and the assembled image are asserted against this file |

## Identity keys

| Key | Meaning | Legal values | Read by |
|---|---|---|---|
| `LAYOUT_VERSION` | layout generation; bumps when geometry changes incompatibly | integer (both boards: `2`) | assemblers, verify |
| `LAYOUT_BOARD` | the board's own name, equal to its directory name | directory basename | verify |
| `MOS_ARCH` | target Debian architecture; declared, never derived from the name | `arm64`, `amd64` | `rootfs/build.sh`, verify |

## Geometry primitives

| Key | Meaning | Legal values | Read by |
|---|---|---|---|
| `SECTOR_SIZE` | disk sector size | `512` | assemblers, verify |
| `MIB_BYTES` | MiB constant for derived arithmetic | `1048576` | assemblers |
| `GPT_ALIGN_SECTORS` | sgdisk alignment multiple. cx3576 needs `1` because its loader starts at the non-2048-aligned sector 64; without it sgdisk silently moves the start | positive integer | assemblers |
| `DISK_GUID` | fixed disk GUID (reproducible images) | uppercase GUID | assemblers, verify |
| `TYPECODE_ESP`, `TYPECODE_LINUX` | the partition type GUIDs the layout uses by name | GUID constants | assemblers, verify |
| `IMAGE_HEAD_MIB` | fixed head area before the first MiB-aligned partition | MiB integer | assemblers |
| `IMAGE_TAIL_SLACK_MIB` | tail slack for the backup GPT | MiB integer | assemblers |

GUID case: producers write uppercase, udev/libblkid emit lowercase; both
denote the same GUID and consumers must compare case-insensitively.

## The partition set

`LAYOUT_PARTITIONS` is the ordered partition list, and it is what every
shared script iterates — a board is defined by this file, and nothing shared
knows any board's shape. Each entry `<NAME>` carries a `<NAME>_ROLE` that
says which assertions apply; checkers dispatch on the role, never the name.

Every partition, whatever its role, declares the common keys:
`<NAME>_PARTNUM`, `<NAME>_LABEL`, `<NAME>_GUID`, `<NAME>_TYPECODE`.

Role schema (enforced in both directions — required keys present, and no key
a role does not use; declaring a forbidden key empty is still declaring it):

| Role | Meaning | Requires | Forbids |
|---|---|---|---|
| `raw-blob` | bootloader image written at a fixed sector, no filesystem | `_START_SECTOR`, `_SIZE_SECTORS`, `_MAGIC_HEX` | `_FS_LABEL`, `_FS_UUID`, `_FAT_LABEL`, `_FAT_VOLUME_ID` |
| `uboot-env` | one half of U-Boot's redundant environment | `_OFFSET_BYTES` (plus shared `UENV_SIZE_BYTES`) | `_FS_LABEL`, `_FS_UUID`, `_FAT_LABEL`, `_FAT_VOLUME_ID` |
| `esp` | FAT32 boot slot or ESP | `_FAT_LABEL`, `_FAT_VOLUME_ID` | `_FS_LABEL`, `_FS_UUID`, `_MAGIC_HEX` |
| `verity-slot` | squashfs + dm-verity rootfs slot; size is content-derived and read back from the image, never declared | — | `_FS_LABEL`, `_FS_UUID`, `_FAT_LABEL`, `_FAT_VOLUME_ID`, `_MAGIC_HEX` |
| `ext4` | mounted read-write filesystem | `_FS_LABEL`, `_FS_UUID` | `_FAT_LABEL`, `_FAT_VOLUME_ID`, `_MAGIC_HEX` |

Placement keys (`_START_MIB`, `_START_SECTOR`, `_SIZE_MIB`,
`_OFFSET_BYTES`) are deliberately unconstrained by the schema: a fixed-start
partition and a derived-offset one legitimately differ. A board may declare
the MiB/sector/byte spellings of one offset independently (cx3576 does, as
historical literals) or derive them (`x64` computes sector and byte forms
from `_START_MIB`); a board declaring both forms must have them agree, and
the lint asserts it.

Both shipped boards share the tail of the set — `META`, `STATE`,
`EPHEMERAL`, `DATA`, all `ext4` — the storage-tier split: `state` is small
and precious configuration/identity, `data` grows under `/srv` and is the
only growth target (it must stay last for systemd-repart), `ephemeral` is
wipeable runtime residue under `/var`.

## U-Boot chain keys (present only on uboot-chain boards)

| Key | Meaning | Legal values | Read by |
|---|---|---|---|
| `LOADER_MAGIC_HEX` | first bytes of the raw loader (`524b4e53`, `RKNS`), asserted against the assembled image | hex string | assembler, verify |
| `UBOOT_SEEK_SECTOR` | raw write position of SPL+U-Boot (where the BootROM looks) | sector number | assembler |
| `UBOOT_MAX_BYTES` | ceiling for the raw loader area; must end before `uenv-a` | bytes | assembler, verify |
| `UBOOT_VARIANT_DIR` | BSP output dir of the A/B bootloader variant — the only variant a mos image may carry | directory name (`uboot-mos`) | assembler |
| `UBOOT_DEBUG_VARIANT_DIR` | the debug variant's dir; the assembler refuses a blob byte-identical to it | directory name | assembler, verify |
| `UBOOT_BIN_NAME` | bootloader binary filename | filename | assembler |
| `UENV_SIZE_BYTES`, `UENV_SIZE_SECTORS` | one environment copy's size; pinned to U-Boot's `ENV_SIZE` and `/etc/fw_env.config`, must never change once devices are flashed | bytes / sectors | assembler, `fw_env.config.in`, verify |
| `UENV_A_SIZE_SECTORS`, `UENV_B_SIZE_SECTORS` | per-slot aliases of the shared size | `"${UENV_SIZE_SECTORS}"` | verify |
| `BOOT_SCRIPT_NAME` | compiled boot script name in each boot slot | `boot.scr` | assembler, verify |
| `BOOT_CMD_SOURCE` | source the script is compiled from | repo path | assembler |
| `BOOT_VERITY_ENV_NAME` | unsuffixed verity-parameter base name (legacy fallback only) | `mos-verity.env` | assembler |
| `BOOT_VERITY_ENV_A_NAME`, `BOOT_VERITY_ENV_B_NAME` | the slot-suffixed names actually written; the suffix identifies which rootfs partition the verity table describes | `mos-verity-<slot>.env` | assembler, bundle builder, verify |
| `BOOT_DIGEST_ENV_NAME` | the byte count and CRC-32 of this boot partition's own kernel and dtb, which the boot script checks before `booti`; slot-NEUTRAL, because it describes files in the partition it sits in rather than the rootfs slot that partition is paired with | `mos-boot-digest.env` | assembler, bundle builder, verify |
| `BOOT_ATTEMPTS_DEFAULT`, `BOOT_ATTEMPTS_MIN`, `BOOT_ATTEMPTS_MAX` | boot-attempt credits. RAUC writes hex, U-Boot's `test -gt` parses decimal; the radices agree only for 0–9, so values stay in 1..9 | integers within 1..9 | boot script defaults, RAUC config renderer |

## UEFI keys (present only on UEFI boards)

| Key | Meaning | Legal values | Read by |
|---|---|---|---|
| `ESP_MOUNT` | where the static ESP mounts | absolute path (`/boot`) | overlay mount unit, RAUC grub backend |
| `SLOT_KERNEL_NAME`, `SLOT_CMDLINE_NAME` | filenames a slot's boot partition carries and GRUB reads | filenames | assembler, bundle builder, verify |
| `ESP_REQUIRED_FILES` | the ESP's complete content list — a per-slot file here would be one no install could replace | space-separated paths | verify |
| `RAUC_GRUBENV` | the grubenv file RAUC edits in place | absolute path | RAUC config renderer |

## Slot sizing and budgets

| Key | Meaning | Legal values | Read by |
|---|---|---|---|
| `MOS_ROOTFS_SLOT_MIB` | rootfs slot size. Supplied from the environment ⇒ pinned/frozen geometry (release path: build fails if the verity image does not fit); not supplied ⇒ this value is a floor and the slot grows with headroom (dev path) | MiB integer | assemblers |
| `ROOTFS_SLOT_HEADROOM_PCT` | growth headroom in floor mode | percent (`125`) | assemblers |
| `ROOTFS_SLOT_ALIGN_MIB` | slot size alignment | MiB integer | assemblers |
| `MOS_VAR_MIB` | `/var`'s whole budget (the `EPHEMERAL` partition). Frozen for a flashed fleet: changing it moves `DATA`'s start | MiB integer | assembler, fill-up checks |
| `EPHEMERAL_SIZE_MIB` | the same number seen from the partition's side; aliased, never duplicated | `"${MOS_VAR_MIB}"` | layout walkers |
| `BOOT_SIZE_MIB` + `BOOT_A_SIZE_MIB`, `BOOT_B_SIZE_MIB` | boot-pair size, declared once and aliased per slot | MiB integer / aliases | assemblers, verify |
| `BOARD_SIZE_BUDGET_MB` | installed-size budget at which unnoticed rootfs growth becomes a build failure | MB integer | `rootfs/build.sh` |

## Reproducibility keys

| Key | Meaning | Legal values | Read by |
|---|---|---|---|
| `EXT4_BLOCK_SIZE` | ext4 block size | `4096` | assemblers |
| `EXT4_FEATURES` | feature mask; `^orphan_file` is mandatory (kernel 6.1 cannot mount it) | mke2fs feature string | assemblers |
| `E2FSPROGS_FAKE_TIME` | pinned mke2fs clock for byte-stable filesystems | epoch seconds | assemblers |
| `FILE_MTIME` | mtime every staged file is touched to (2020-01-01: FAT cannot store pre-1980) | `@<epoch>` | assemblers, boot-script compile |
| `VERITY_SALT` | pinned dm-verity salt so identical content yields an identical root hash | 64 hex chars | `rootfs/build.sh`, assembler |

## Image naming

| Key | Meaning | Read by |
|---|---|---|
| `IMAGE_NAME_PREFIX`, `IMAGE_NAME_SUFFIX` | image filename around the per-build epoch | assemblers |
| `IMAGE_LATEST_NAME` | the stable "latest" symlink/copy name | assemblers |

## Board-level required keys

Every board must declare these six with a value. The set is
`REQUIRED_BOARD_KEYS` in `verify/src/lint.ts`, and the lint refuses a definition
that omits one or declares it empty:

| Key | Meaning | Legal values | Read by |
|---|---|---|---|
| `BOARD_CMDLINE_ARGS` | board console and cmdline facts. **The console devices are ORDERED**: every `console=` receives printk, but `/dev/console` is the last one, so a board with both a display and a serial console puts the display first | kernel cmdline fragment | `rootfs/build.sh` |
| `BOARD_SIZE_BUDGET_MB` | see above | MB integer | `rootfs/build.sh` |
| `BOARD_HAS_STATUS_LED` | whether the image drives a status LED; decides which outcome the verifier asserts — present and enabled, or absent entirely | `0` or `1` | rootfs staging, verify |
| `BOARD_HAS_DISPLAY` | whether the board has a local display the image treats as an output. Gates the boot-logo and console-recoverability contract (`docs/design/display.md` §4): on `1` the verifier asserts the console order, the loglevel floor, the logo symbols and that `getty@tty1` resolves to disabled; on `0` it prints a skip naming the board | `0` or `1` | verify |
| `BOARD_RELEASE_TARGET` | whether the release path serves this board | `0` or `1` | release gate, verify |
| `MOS_ARCH` | see above | `arm64`, `amd64` | everywhere |

## Hardware lists

These are lists, not booleans, because a board with different hardware
declares different entries, not a different flag. Empty (`""`) is a
statement — "this board has none" — and is not read as a board that forgot
to say.

| Key | Meaning | Legal values | Read by |
|---|---|---|---|
| `BOARD_FIRMWARE_FILES` | the exact firmware set the image carries, as installed paths under `/usr/lib/firmware/` | space-separated absolute paths, or empty | board package render, verify |
| `BOARD_HWINIT_CONFS` | per-board hardware-init facts under `/etc/mos/` (each `<name>` pairs a `hwinit-<name>` script with `<name>.conf`) | space-separated names, or empty | board package render, verify |
| `BOARD_RADIOS` | radios the board carries; decides whether the radio userland (bluez, wpasupplicant, hostapd, rfkill) and its mount points ship at all | subset of `wifi bluetooth`, or empty | `rootfs/build.sh`, verify |
| `BOOT_SLOT_REQUIRED_FILES` | what every boot slot must contain; `@SLOT@` expands to the slot letter for per-slot files | space-separated filenames | verify |

## Update backend

| Key | Meaning | Legal values | Read by |
|---|---|---|---|
| `RAUC_BOOTLOADER` | RAUC's bootloader backend — a layout fact, because it drives the A/B handshake | `uboot`, `grub` | RAUC config renderer |

The backend choice changes the legal key set around it: with `grub`, RAUC
refuses a configuration that sets boot attempts at all, so `BOOT_ATTEMPTS_*`
are forbidden on a GRUB board and required on a U-Boot board — exactly the
kind of claim-without-capability the role schema's forbidden lists exist to
catch.

## Rules when adding a key

- Never duplicate a constant a consumer could read from here; alias
  (`X="${Y}"`) when the same number is one fact seen from two sides.
- A new key needs a reader. The lint and the board package refuse facts
  nothing reads, and this reference must gain the key's row in the same
  change. Only the first half is mechanical: the lint reads `board.env`, not
  this page, so the key's row here is held by review.

> status: shipped — evidence: `make os-layout-lint`
