# RFCT-929 Build a complete s905x5m eMMC USB-burning package

- **status**: completed
- **priority**: P1
- **owner**: plan-910-m3-complete-package
- **createdAt**: 2026-08-31 11:31 UTC
- **completedAt**: 2026-08-31 11:54 UTC
- **plan**: PLAN-910 M3 follow-up

## Description

Build and verify a complete Amlogic v2 USB-burning package for s905x5m by
extending RFCT-928's committed packaging consumer. The package must carry the
mos-owned GPT and the payloads needed to initialize its A/B layout, not the
Alpine or stock Android layout. It is a reinstallation/recovery artifact: its
GPT replaces the existing eMMC user-area partition table, so the stock Android
layout will be destroyed when an owner later burns it.

The task ends at an artifact and offline verification. It must not connect a
burning tool to a board, invoke `sdc_burn`, or write any eMMC user-area,
hardware-boot-area, or `bootloader_a` bytes.

## ActiveForm

Deriving and packaging the complete s905x5m eMMC USB-burning payload from the
existing mos image assembly path.

## Dependencies

- **blocked by**: (none; the owner directed the complete-package scope on 2026-08-31)
- **blocks**: the separately owner-gated first eMMC write

## Investigation

- RFCT-928 is committed at `d323541`; the working tree was clean before this
  task was claimed. Its package consumer and static Amlogic flow assets are the
  baseline to extend, not parallel work to recommit.
- `os/build/src/mkimage-s905x5m-sd.ts` already uses the typed geometry derived
  from `os/boards/s905x5m/board.env` to generate the twelve-entry mos GPT and
  the A/B boot/rootfs payloads. Its SD-only p1 cfgload bridge is explicitly
  unsuitable for eMMC and must not become package content.
- Direct inspection of the pinned Amlogic v2 burn code confirms that
  `_aml_dtb` is a special destination: it is classified as `IMG_TYPE_DTB` and
  handled through the reserved-DTB storage path, while ordinary payload names
  use `store_part_size()` and GPT lookup. It must stay in the manifest but is
  not a mos GPT partition.
- The same pinned code classifies `gpt` as `IMG_TYPE_GPT` and writes it with
  `store_gpt_write()`. Its eMMC backend reads the primary GPT payload and
  regenerates the backup header for the actual device capacity. The package can
  therefore derive the vendor-format 34+33-sector `gpt.bin` from the assembled
  SD image without inventing a second partition-table producer.
- `board.env` deliberately has no `bootloader_a` partition: that name would be
  a normal GPT lookup and would fail against the required twelve-entry mos
  layout. The complete package must retain the special hardware-boot-area
  `bootloader` target instead of adding an incompatible Alpine user-area
  staging target.
- `ROOTFS-B` is intentionally all zero in the factory SD image until the first
  update fills it. A recovery package must carry that zero range explicitly so
  an old user-area does not leave stale bytes in the inactive slot after the
  GPT is replaced.

## Proposal

Add an eMMC-package mode to RFCT-928's existing Amlogic package consumer, not
a second packer implementation. A host-side extractor will read an already
assembled `-sd-` image, verify its twelve-entry GPT against the typed
`board.env` geometry, and export the exact package payloads. It will copy the
vendor-format GPT bytes and every mos-owned user-area range from `uenv-a`
through `data`; it will reject a non-zero `rootfs-b` and will never export the
SD-only p1 bridge or the vendor `env` range at p2.

The complete manifest will retain RFCT-928's USB bootstrap, hardware bootloader
and reserved-DTB entries, then add `gpt` plus normal GPT destinations for
`uenv-a`, `uenv-b`, `boot-a`, `boot-b`, `rootfs-a`, `rootfs-b`, `meta`, `state`,
`ephemeral`, and `data`. This is the board's whole twelve-entry layout with
only the two explicitly vendor-owned ranges unwritten. The later owner-gated
burn will replace the current eMMC user-area GPT; it consequently removes the
stock Android partition layout.

The package build will check the manifest, validate every input, run the
vendor format check, unpack the container, and compare every payload byte for
byte. The owner direction dated 2026-08-31 approves this scoped proposal.

## Risks

- The package intentionally repartitions the eMMC user area. It destroys the
  stock Android partition table and its data when an owner later burns it.
- Format validation and an unpack comparison prove only that the package is
  well formed and preserves its input bytes. They do not establish hardware
  acceptance, successful writes, bootability, or recovery behavior.
- The current SD assembler's p1 cfgload bridge is an SD-only compatibility
  device. Copying it into the eMMC reserved range would overwrite vendor-owned
  storage, so the extractor must refuse that tempting but invalid shortcut.

## Scope

- The typed payload extractor and its tests, the existing RFCT-928 package
  consumer and manifest test, BSP/top-level package targets, documentation,
  and PLAN-910/RFCT-929 records.
- No alternative GPT producer, Android layout, Alpine `bootloader_a` target,
  automatic installer media, USB burn, `sdc_burn` invocation, device access,
  eMMC write, hardware-boot-area write, or remote push.

## Alternatives

- Recreate the GPT and partition images in the package build: rejected because
  it would create a second producer for the same layout and drift from the SD
  assembler.
- Package only bootloader and rootfs payloads: rejected because recovery after
  repartitioning must also initialize the A/B environment, inactive root slot,
  and writable mos filesystems rather than retaining arbitrary old user-area
  bytes.
- Add Alpine's `bootloader_a` entry: rejected because it is absent from the
  mos GPT and the vendor's normal-partition path would not find it.

## Notes

- Claimed for investigation and implementation under the owner-directed scope.

## Implementation

- Extended RFCT-928's one package Dockerfile with explicit
  `bootloader-artifact` and `emmc-artifact` targets. The old `artifact` target
  remains a compatible alias for the bootloader-only output; the complete path
  shares the pinned packer, static blob checks, BL33 check, pack, format check,
  unpack, and comparison helper.
- Added `config/emmc.cfg` with the existing dual `DDR.USB` USB identities,
  special `gpt`, `bootloader`, and `_aml_dtb` entries, plus normal targets for
  all mos-owned p3..p12 ranges. Its 18 distinct files intentionally contain no
  `reserved.PARTITION`, `env.PARTITION`, or `bootloader_a`.
- Added the typed `s905x5m-emmc-payloads` extractor and
  `make s905x5m-emmc-package` / `make os-emmc-package-s905x5m-v2` entry
  points. The extractor consumes a completed `-sd-` image, verifies all twelve
  GPT entries against `board.env`, exports the vendor 34+33-sector `gpt.bin`,
  and copies the exact p3..p12 bytes without recreating GPTs or filesystems.
  It rejects a dirty inactive root slot and publishes a BuildKit-readable
  temporary hand-off directory.

## Verification

- The final package source is commit `acd48f85d46a`. Its isolated remote build
  used the existing standard-assembler SD artifact
  `s905x5m-mos-v2-sd-latest.img`, SHA-256
  `a21e95238791e06b62d4dc74bb8ce813c13249a8cf52ae67651c8d2b8d416c08`,
  rather than create another image producer. Its copied RFCT-927 hand-off
  inputs matched source hashes: `DDR.USB`
  `c0809bf8cb74194224ca95abf19f2b04014b4efcabf34770423361a38127afa0`,
  `u-boot.bin.signed`
  `f963bbc98024a4f8f6e4a84b6c1cde0b1fd0bc30b9a9335fc7902d37f7a60277`,
  and `u-boot.bin.sd.bin.signed`
  `1e34b438d7c7e6f071d61aff8c818888265fdc35b32d5f68dce12eec5ddb00e0`.
- `tsc --noEmit` passed. The real SD assembler plus extractor suite passed
  9/9 tests (45 expectations), including the twelve-entry GPT readback,
  p1/p2 exclusion, p3..p12 extraction, zero `ROOTFS-B`, and the cross-container
  hand-off permission. The focused CLI suite passed 2/2. Local manifest
  checks, documentation index, shell pipefail lint, Make dry runs, and
  whitespace checks passed.
- The explicit `docker buildx build --no-cache` rebuild passed
  `aml_image_v2_packer -c`, unpacked with the same pinned packer, and compared
  all 18/18 manifest inputs byte-for-byte:
  `DDR.USB`, `_aml_dtb.PARTITION`, `aml_sdc_burn.UBOOT`,
  `aml_sdc_burn.ini`, `boot-a.PARTITION`, `boot-b.PARTITION`,
  `bootloader.PARTITION`, `data.PARTITION`, `ephemeral.PARTITION`, `gpt.bin`,
  `meta.PARTITION`, `platform.conf`, `rootfs-a.PARTITION`,
  `rootfs-b.PARTITION`, `state.PARTITION`, `uenv-a.PARTITION`,
  `uenv-b.PARTITION`, and `usb_flow.aml`.
- The no-cache `update.img` was byte-for-byte equal to the normal package
  result. The durable output is `/backup/mos-artifacts/rfct-289-acd48f8/update.img`
  (1,369,400,096 bytes, SHA-256
  `2fc78e069545d3638a0325129bbad9ed54e17aad801b8f0cbef0eee3553c18b6`),
  accompanied by its 77-byte `update.img.sha256`; the published directory
  passed `sha256sum -c` after copying.

## Result

This task establishes a well-formed complete Amlogic USB package whose GPT and
mos-owned payload bytes are faithfully derived from the existing SD assembler,
and establishes reproducible package construction for the same inputs. It does
not establish that a board accepts the protocol, writes any byte successfully,
boots the result, or recovers from a failed boot. No USB burner, `sdc_burn`,
board, eMMC user area, eMMC hardware boot area, or `bootloader_a` was written
or invoked. A future owner-gated burn will deliberately replace the stock
Android eMMC user-area layout and its data.
