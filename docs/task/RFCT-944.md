# RFCT-944 Resolve runtime defects observed on the mainline S905X5M SD image

- **status**: closed
- **priority**: P1
- **owner**: miehq
- **createdAt**: 2026-09-08 08:18 UTC

## Description

RFCT-943 inspected the newly composed SD image on hardware. Initialization,
management, networking, MQTT and container execution work, but the device is
degraded because the optional front-panel scripts cannot execute.

## Confirmed blocker

- `/usr/sbin/bm201-front-panel` and
  `/usr/lib/mos/bm201-front-panel-stop` both have mode 0644 in the running root.
- Their source files are tracked as 100644. The board's Debian producer
  `boards/s905x5m/deb/bm201-front-panel/Dockerfile` uses `COPY` without setting
  executable modes, so the non-executable files reach the package/image.
- systemd reports 203/EXEC for both entry points. `mos-health` then refuses
  the failed unit and leaves the boot unconfirmed. Existing source tests use
  `sh` to interpret the files and did not assert installed executable modes.

## Additional observations to classify

- `systemd-gpt-auto-generator` creates an EFI automount that fails because
  `/efi` is absent. This is not one of the two final failed units.
- The system-info API cannot identify the board model because the running DT
  exports no `/sys/firmware/devicetree/base/model` property.
- The inherited runtime verifier assumes eMMC `mmcblk0` and `/boot/Image`.
  The new SD root uses `mmcblk1`, while current mainline leaves only the kernel
  config in `/boot`. RFCT-943 used direct boot-partition hash comparisons and
  observed mounts instead of reporting those stale assumptions as device bugs.
- SD and eMMC have identical fixed partition UUIDs when both carry this
  layout. This run resolved the storage UUIDs to SD, but update/reboot safety
  with both media present has not been qualified.

## Acceptance

- Set explicit executable modes in the package producer and assert them on
  the actual Debian payload and composed root.
- Rebuild the affected package and image; verify the front-panel unit starts
  and the normal health gate can confirm the intended boot medium/slot.
- Classify the additional observations before changing EFI, DT or verifier
  behavior; keep board policy and actual media identities explicit.
- Preserve the reported SD/eMMC state until an implementation and device
  validation scope are approved.

## ActiveForm

Closed as superseded by the current S905X5M signed-file integration.

## Dependencies

- **blocked by**: (none; historical image qualification superseded)
- **blocks**: (none; current physical qualification is tracked by the campaign)

## Notes

The original inspection evidence is recorded in [RFCT-943](RFCT-943.md).
That inspection made no service or slot changes; the approved repair probe
below is a subsequent operation. No health allowlist or slot write was applied.

## Investigation update

The user approved the reported packaging repair and image rebuild on
2026-09-08. PLAN-924 records the implementation and device validation scope.
A fresh device read found that the two UENV PARTUUID links currently resolve
to different physical media: UENV-A is mmcblk0p3 and UENV-B is mmcblk1p4.
This blocks a trustworthy slot-confirmation or update experiment until the
bootloader environment medium is resolved. The front-panel repair can be
verified independently without invoking a boot-state writer.

## Implementation and current hardware result

The Debian producer now sets both entry points to mode 0755. The packed-root
check requires executable optional application files and the front-panel stop
helper, and rejects a leftover helper when the component is declined.

The actual rebuilt archive is
`mos-bm201-front-panel_0.1.0+git4c6d7733e1cb.dirty-1_all.deb`.
Both extracted files are mode 0755. Type checking, 13 focused verifier tests
and both existing front-panel test suites passed.

At 2026-09-08 08:46 UTC the extracted package files were copied to
`/run/mos-panel-repair-20260908` on `mos-490fab24` (`192.168.27.72`).
Their contents were first checked byte-identical to the shipped scripts,
and existing mounts were refused. Read-only bind mounts over the two
immutable paths expose the corrected modes for this boot only.

The actual systemd service started, stopped and started again successfully:
`Result=success`, `ExecMainStatus=0`, `NRestarts=0`, `active/running`.
Sysfs reported `text=0846`, `symbols=0x9d`, brightness 7 and enabled 1.
The stop helper set enabled to 0; restarting restored it to 1.
The current boot retains the temporary repair. It disappears at reboot and
does not change the old squashfs. HTTPS health, network and time reads
continued to return 200.

The failed-unit list now contains only `mos-health.service`. It has not been
restarted or cleared, because its successful path invokes RAUC mark-good.
That is separate from `/api/v1/health`, which checks management daemons.

## Remaining media blocker

The pinned U-Boot configuration and RFCT-920 identify the redundant environment
as eMMC device 1 in U-Boot numbering (Linux mmcblk0 on this unit). Reading
each physical pair independently through `fw_printenv -c` confirms a valid
eMMC environment (`BOOT_ORDER=A B`, `BOOT_A_LEFT=2`, `BOOT_B_LEFT=3`) and no
valid SD environment. No raw UENV access or environment write was used.

The default config nevertheless addresses the duplicated PARTUUID links:
UENV-A currently resolves to eMMC and UENV-B to SD. Root, STATE and DATA
currently resolve to SD. The SD cfgload bridge also boots its fixed selected
slot rather than the production eMMC A/B script; its `rauc.slot=A` argument
does not prove that SD consumed an A/B boot credit. A successful mark-good
against eMMC would therefore not qualify this SD boot's rollback behavior.

Full task acceptance remains open pending explicit media/boot-mode handling
and a boot into the replacement image. Packaging and a temporary service
probe alone must not be reported as completed runtime qualification.

## Verification progress

The complete verifier suite passed: 1,394 tests, zero failures, 20,984
assertions across 49 files. The live panel remained active without restarts
and advanced from 08:46 to 08:54. The source diff review found no introduced
correctness issues. The new SD image passed 392 image checks and 14 executable
smoke checks. Direct extraction from the final squashfs confirmed both panel
entry points are mode 0755. The new verity root hash is
`7c099c3d22ddf1c7bdc88741424cd4345744a4271d50b946cc8df968bf352aa1`.

The SD image is `_out/s905x5m/s905x5m-mos-sd-1788858075.img`; the verified
RAUC bundle is `_out/s905x5m/mos-s905x5m-1788858123.raucb`. Both latest links
were updated by their producers. The host subsequently encountered disk-space
and I/O failures. After recovery, the eMMC package export completed, including
the 18-input round-trip check. Its producer-recorded SHA-256 is
`62b4e2ae2511426da7b1e496792dfda49cf29baf70171b7d3d08a20a7dd8faa3`.

The user stopped further packaging because of disk space. The installer
helper and its parent build command were terminated; the installer disk still
has its previous 07:08 timestamp and is not a rebuilt artifact. No further
packaging or device rollout is authorized by this checkpoint. PLAN-924's
source repair and SD validation are complete, while this runtime qualification
task remains open for the media/boot-mode issues above.

RFCT-945 records actual managed Wi-Fi association, DHCP, DNS and HTTPS on
the SD system, plus a failed gateway ICMP probe. RFCT-946 tracks the separate
mos-apid allowlist mismatch discovered when operating the browser's switch.

## Updated mainline contracts

PLAN-926 integrates upstream's display and DRAM metadata requirements.
S905X5M declares a display, so the new shared logo/console checks apply rather
than being skipped. This declaration does not qualify the vendor display
path; the prior hardware inspection did not establish visible output, logo
policy or console recovery. The DRAM floor is zero, as declared by the board
DTS's linux,usable-memory tuple. No new image or hardware check accompanies
the source merge.

Upstream also masks systemd-gpt-auto-generator in future system packages.
That source change addresses the generated EFI mount identified above, but
the currently booted image predates it and has not been updated or retested.

- close: Superseded by the current S905X5M signed-file integration and its fresh-image physical acceptance gap.
