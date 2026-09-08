# RFCT-928 Implement Amlogic bootloader packaging for s905x5m

- **status**: completed
- **priority**: P1
- **owner**: plan-910-m3-packaging
- **createdAt**: 2026-08-31 UTC
- **completedAt**: 2026-08-31 10:55 UTC
- **plan**: PLAN-910 M3

## Description

Implement mos-owned packaging of the s905x5m U-Boot artifacts through the BSP
artifact interface. The result must be an Amlogic v2 bootloader-only package
for host USB burning and a clearly documented manual `sdc_burn` card path.
It must preserve the target-generated hardware-boot framing path, verify the
container and its round trip, and make no device, eMMC, boot-area, or
`bootloader_a` write.

## Acceptance

- `make s905x5m-uboot-package` consumes only the three exported
  `out/uboot/` artifacts and writes a bootloader-only `update.img`, manual
  `sdc_burn` configuration, and package checksum under `out/uboot-package/`.
- The Amlogic v2 manifest supplies `DDR.USB` as both `USB/DDR` and
  `USB/UBOOT`, targets the special `bootloader` destination, and contains
  neither a GPT payload nor a `bootloader_a` target.
- The packer binary, static vendor blobs, and every package input are checked;
  the built container passes the packer format check and unpacks to seven
  byte-identical inputs.
- Documentation states the USB and manual card paths, excludes automatic
  `bm201upd.ini` media, and states that no package check establishes hardware
  bootability or authorizes a write.

## ActiveForm

Completed mos-owned Amlogic bootloader package construction and offline validation.

## Dependencies

- **blocked by**: (none; the owner approved mos-owned packaging on 2026-08-31)
- **blocks**: PLAN-910 M3 package availability before the separately gated first write

## Investigation

- The completed section-5 export is the only producer interface: its durable,
  read-only hand-off on `192.168.27.200` contains `u-boot.bin.signed`
  (3,321,856 bytes), `u-boot.bin.sd.bin.signed` (3,322,368 bytes), and
  `DDR.USB` (3,321,856 bytes). The BSP has no package target or package assets.
- The working Alpine implementation proved that the `bootloader` and
  `bootloader_a` manifest destinations are not aliases. The former makes the
  target generate the 512-byte `storage_emmc_boot_info` prefix for the hardware
  boot area; the latter is a GPT user-area partition. A bootloader-only package
  with no `gpt.bin` must omit `bootloader_a`, otherwise its verification cannot
  locate that partition.
- The S7D USB path needs one `DDR.USB` file under both `USB/DDR` and
  `USB/UBOOT`: BootROM needs the first identity for DRAM training before it can
  load the second to execute the burn protocol.
- The current vendor path is established for the manual command
  `sdc_burn aml_sdc_burn.ini`: Alpine's recorded `s7d_bm201#` prompt reports
  `sdc_burn [sdc_burn_cfg_file]` and `sdcburncfg=aml_sdc_burn.ini`. That is a
  command path, not automatic-media detection. `bm201upd.ini` is the private,
  fixed name selected by the newer BM201 installer code that mos builds
  (`BM201_INSTALLER_CONFIG` and its `bm201_emmc_update` patch); its request and
  receipt wrapper is not present in the currently running vendor U-Boot. This
  task therefore does not make an automatic installer card.
- The compatible packer is the 32-bit static `aml_image_v2_packer` from
  `khadas/utils` commit `09fd7ae034f340462cab1daf332a012924a1efa9`, SHA-256
  `7511fb8d1a483d606d67bcb87ae20ab0821fbaff797ad6da958903e46fb4ed9a`.
  The build host's BuildKit advertises `linux/386`, so the isolated pack stage
  can run without a host-installed packer.

## Proposal

Add a package consumer below `bsp/uboot/package/` and expose it as
`make s905x5m-uboot-package`. It will require the existing `out/uboot/`
interface rather than rebuilding or reading a sibling repository. The output
directory will contain `update.img`, its `update.img.sha256`, and the external
`aml_sdc_burn.ini` required for the manual card command.

The manifest will retain the USB bootstrap entries and the special target only:

```text
file="DDR.USB"              main_type="USB"       sub_type="DDR"
file="DDR.USB"              main_type="USB"       sub_type="UBOOT"
file="bootloader.PARTITION" main_type="PARTITION" sub_type="bootloader"
```

It will deliberately omit `gpt.bin` and `bootloader_a`. The container build
will checksum the two board stock-flow blobs, assert that the FIP has a
substantial BL33 region, validate every filename named by the manifest, run
`aml_image_v2_packer -c`, unpack with the same pinned binary, and compare all
seven package inputs byte for byte. A focused manifest test will keep the
destination and card-path constraints falsifiable without rebuilding U-Boot.

The owner request of 2026-08-31 explicitly approves this scoped proposal.

## Risks

- The package format and seven-file round trip prove container construction and
  payload preservation, not that U-Boot boots on hardware or that a target will
  accept a write.
- The USB packer is a 32-bit vendor-format executable and needs BuildKit's
  `linux/386` emulation; its checksum is therefore checked before use.
- `_aml_dtb.PARTITION` and `usb_flow.aml` are board stock-flow blobs. Their
  provenance and hashes are recorded with the imported assets; they are not
  interchangeable Linux DTBs or generic Amlogic assets.

## Scope

- The s905x5m BSP Makefile, bootloader package assets, focused manifest test,
  U-Boot documentation, and PLAN-910/RFCT-928 records.
- No full system package, GPT generation, automatic installer card, device
  operation, deployment, eMMC write, boot-area write, `bootloader_a` write,
  or remote push.

## Alternatives

- Use the full-system manifest: rejected because it carries `gpt.bin` and only
  then has enough information to address `bootloader_a`.
- Raw-write `u-boot.bin.signed`: rejected because it cannot create the
  target-specific hardware-boot information sector.
- Reuse the Alpine packer as an external one-off: rejected because it bypasses
  mos's artifact interface and leaves the package contract outside this tree.
- Produce `/bm201upd.ini` automatic media: rejected because the running vendor
  U-Boot is not established to contain the private installer wrapper.

## Notes

- Created for the owner-dispatched PLAN-910 M3 packaging work.

## Implementation

- Added `make s905x5m-uboot-package` as an independent consumer of the three
  existing `out/uboot/` artifacts. It does not invoke the U-Boot build and
  atomically publishes only `update.img`, `update.img.sha256`, and the external
  `aml_sdc_burn.ini` under `out/uboot-package/`.
- Added a pinned and checksum-verified `linux/386`
  `aml_image_v2_packer` build stage, the board static-flow assets with recorded
  checksums, a seven-input manifest, and a focused manifest test.
- The manifest supplies `DDR.USB` as both `USB/DDR` and `USB/UBOOT`, retains
  the special `bootloader` destination, and deliberately contains no GPT
  payload or `bootloader_a` destination. It does not produce an automatic
  `/bm201upd.ini` card.
- The durable output is
  `/backup/mos-artifacts/rfct-288-ec0c70c/`: `update.img` (10,267,648 bytes,
  SHA-256 `c30145a261fa14bfae5aefb17d3786268e3af8a64280c1ac40304459a2304a05`),
  its 77-byte checksum sidecar, and the 536-byte manual-card configuration.

## Verification

- The three staged §3 input hashes matched RFCT-927's durable hand-off before
  packaging. The package build checked the pinned packer and both static-flow
  blobs, verified that the canonical bootloader has 829,341 non-zero BL33
  bytes, and required all seven manifest inputs to exist.
- `aml_image_v2_packer -c` accepted the built Amlogic v2 container. A packer
  unpack followed by `cmp` round-tripped 7/7 required inputs unchanged:
  `bootloader.PARTITION`, `aml_sdc_burn.UBOOT`, `DDR.USB`, `usb_flow.aml`,
  `_aml_dtb.PARTITION`, `platform.conf`, and `aml_sdc_burn.ini`.
- A separate no-cache BuildKit rebuild repeated those checks and exported an
  `update.img` and configuration byte-identical to the first build. The
  published directory then passed `sha256sum -c` and byte-for-byte comparisons
  against that verified output.
- Locally, `make s905x5m-uboot-package-test`,
  `bash os/tests/shell-pipefail-lint.sh`, `bash docs/verify-index.sh`, and
  `git diff --check` passed.

## Result

The package supports host USB burning through the BootROM/BL2 path and the
measured, manually selected `sdc_burn aml_sdc_burn.ini` card path on the
already-running vendor U-Boot. It does not create the replacement U-Boot's
automatic `bm201upd.ini` request/receipt flow and does not provide a GPT
`bootloader_a` update.

Format validation and the seven-file round trip establish a well-formed
container and byte preservation only. They do not prove hardware bootability,
burn success, recovery behavior, or authorize a bootloader write. No board,
eMMC boot area, eMMC user-area partition, `bootloader_a`, or `sdc_burn` command
was written or invoked.
