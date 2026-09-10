# Current board.env contract

`boards/<name>/board.env` declares the board's target architecture, current disk
geometry and hardware capabilities. The active system-image targets are x64,
virt-arm64, cx3576 and the s905x5m development port. `build/src/file-layout.ts` parses the current layout;
`make os-layout-lint` exercises it.

> status: shipped — evidence: `build/src/file-layout.ts`, `make os-layout-lint`

## Format and consumers

Use plain `KEY=value` assignments with the literal aliases already used by the
board definitions. Build orchestration parses these as data. Do not add command
substitution or executable policy. Boot firmware never imports this source file
from persistent device storage.

| Consumer | Contract |
|---|---|
| `build/src/file-layout.ts` | Current partition order, sizes, identities and protected firmware ranges |
| `build/src/file-image.ts` | Signed deployment assembly and factory filesystem creation |
| `rootfs/build.sh` | Architecture, root pack settings, hardware capabilities and current bind/repart configuration |
| `boards/*/deb/board-*/render.sh` | Board service and hardware initialization files |
| `verify/src/file-image.ts` | Exact assembled GPT, firmware, component and filesystem checks |

## Identity

| Key | Meaning |
|---|---|
| `LAYOUT_VERSION` | Exactly `3` for current signed file deployments |
| `LAYOUT_BOARD` | Exact target board identity |
| `MOS_ARCH` | `amd64` or `arm64` userspace architecture |
| `BOOT_BACKEND` | `systemd-boot` or `uboot-fit` |
| `BOARD_RELEASE_TARGET` | Whether the board is a qualified release target |
| `DISK_GUID` | Factory disk identity, checked before DATA growth |

No version dispatch or old-layout reader is provided. s905x5m supports current
development images with `BOARD_RELEASE_TARGET=0` pending physical qualification.

## Three partitions

UEFI uses `LAYOUT_PARTITIONS="ESP SYSTEM DATA"`; FIT boards use
`LAYOUT_PARTITIONS="FIRMWARE SYSTEM DATA"`. Partition numbers are exactly 1–3,
with distinct GUIDs and contiguous declared ranges. Sector size is 512 bytes.
The last partition is the only one grown after factory assembly.

Each partition declares `_PARTNUM`, `_LABEL`, `_GUID`, `_TYPECODE` and `_ROLE`.
ESP, SYSTEM and DATA use `_START_MIB` and `_SIZE_MIB`. The raw FIT FIRMWARE
range uses `_START_SECTOR` and `_SIZE_SECTORS`. SYSTEM and DATA additionally name
their filesystem UUID/label. ESP declares its FAT volume identity and required
fixed firmware path.

SYSTEM contains signed deployment records and immutable root/support/FIT files.
UEFI boot executables are immutable UKI files on ESP. DATA holds state, metadata
and application/user namespaces. No state, metadata or writable-var partitions
exist. `/var` is an immutable skeleton with only audited writable leaves.

## Capacity and reproducibility

`SYSTEM_SIZE_MIB` and `ESP_SIZE_MIB` must cover current, fallback and staged
components plus explicit reserve. `checkCapacity` refuses insufficient geometry
before image creation. Actual installation checks reusable object bytes and
available capacity before publishing a candidate.

`EXT4_BLOCK_SIZE`, `EXT4_FEATURES`, `E2FSPROGS_FAKE_TIME`, `FILE_MTIME` and
`VERITY_SALT` are reproducible root/filesystem build inputs. They do not grant a
runtime override of authenticated verity geometry. The signed component contract
carries the exact geometry used by native init and the installer.

## cx3576 protected firmware ranges

The FIRMWARE GPT entry covers the loader starting at sector 64 and both 64 KiB
record copies at absolute offsets 16 MiB and 17 MiB. SYSTEM starts at 18 MiB.
`UBOOT_MAX_BYTES` stops the loader at the first record copy. The layout parser,
firmware maintenance writer and complete-image flash verifier enforce their
respective boundaries. No generic environment command interface is installed.

The native C boot policy validates these fixed ranges, persists and reads back a
trial decrement, and only then loads a required signed FIT. DATA growth compares
protected firmware/SYSTEM bytes and preserves their identities.

> status: shipped — evidence: `boards/cx3576/bsp/uboot/mos-file-boot.c`, `build/src/firmware-maintenance.ts`, `tests/repart-loader-test.sh`

## s905x5m protected firmware ranges

FIRMWARE starts at sector 64 and ends at 128 MiB. Its 64 KiB native records are
at absolute 120 and 124 MiB; SYSTEM starts at 128 MiB. Unlike the CX3576 loader,
the Amlogic loader is external to the SD GPT and has no `UBOOT_SEEK` or
`UBOOT_MAX_BYTES` declaration. Its signed receipt specifies eMMC boot0 framing
and size independently. Offline image verification checks the paired exported
firmware; native boot0 readback checks installation.

> status: shipped — evidence: `boards/s905x5m/board.env`, `pkgs/mos-deploy/src/firmware.rs`

## Hardware and product capabilities

`BOARD_CMDLINE_ARGS` records board console/platform settings for the authenticated
kernel package. `BOARD_FIRMWARE_FILES` names kernel-support firmware requirements;
they are not root-owned executable payloads. `BOARD_HWINIT_CONFS`, `BOARD_RADIOS`,
`BOARD_HAS_STATUS_LED` and `BOARD_HAS_DISPLAY` select board services.
`BOARD_SIZE_BUDGET_MB` bounds userspace composition; it is separate from SYSTEM
storage capacity.

`BOARD_RECOVERY_ACTIONS` lists implemented physical OS recovery actions. An empty
value means no OS presence assertion exists. cx3576's local rockusb loader button
does not implicitly authorize credential recovery or factory reset through apid.

> status: shipped — evidence: `boards/cx3576/board.env`, `boards/x64/board.env`, `boards/virt-arm64/board.env`
