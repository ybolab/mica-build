# PLAN-924 Repair S905X5M front-panel package permissions

- **status**: completed
- **createdAt**: 2026-09-08 08:39 UTC
- **approvedAt**: 2026-09-08 08:39 UTC
- **relatedTask**: RFCT-944

## Investigation

RFCT-943 reproduced systemd 203/EXEC for both front-panel entry points.
The Debian producer copies mode-0644 source files without normalizing their
modes. The composed-root verifier checks regular-file presence only. Source
tests invoke the scripts through sh, so neither check detects this defect.

The EFI automount is generated for the board's ESP-typed boot partitions,
although this board uses the U-Boot cfgload path. The missing board model is
a missing DT root property. Neither caused the observed final failed units.
The inherited runtime verifier assumes eMMC and a mounted /boot/Image; those
assumptions do not apply to this SD/mainline image. These need separate
follow-up changes, not altered hardware acceptance results.

SD and eMMC share fixed layout PARTUUIDs. A fresh read found UENV-A pointing
to eMMC and UENV-B to SD. Consequently, automatic slot marking, installation
and reboot are not safe validation steps for this permission repair.

## Proposal and approval

The preceding runtime report proposed fixing package permissions and
rebuilding the image. The user's subsequent repair instruction approves
that concrete scope. No additional approval is required for these changes.

1. Set mode 0755 explicitly for both front-panel executables in the producer.
2. Extend the composed-root check to require executable optional entry points
   and the front-panel stop helper. Exercise lost-mode and missing-helper
   regressions, including the declined-component case.
3. Rebuild the selected package pool with one current source stamp, compose
   a replacement SD image and RAUC bundle, and inspect the real package and
   composed-root modes. Preserve the previous SD artifact.
4. On the currently booted SD system, test the corrected package scripts
   through temporary bind mounts over the immutable files. Start and stop
   the real panel service, inspect sysfs and logs, and keep the result clearly
   distinct from a reboot into the replacement image.
5. Record the media ambiguity before any health-gate restart or slot write.
   Leave installation/boot-state changes pending until the media mapping is
   resolved; do not bypass the health check or add its failure to an allowlist.

## Verification

- Focused verifier regression tests and existing panel behavior/systemd tests.
- Actual .deb payload and final squashfs executables must both be mode 0755.
- Complete image verification and executable smoke checks for the rebuilt SD.
- Hardware service lifecycle and display sysfs readback; management and
  networking remain reachable after the repair probe.

## Risks and alternatives

A runtime bind mount is a temporary validation repair and disappears at reboot.
The permanent repair is in the rebuilt image. Rewriting the mounted SD or
using RAUC against ambiguous device links risks modifying the wrong medium.
A raw chmod cannot repair the immutable squashfs; invoking sh in the unit
would hide the packaging defect instead of fixing the payload.

## Delivery checkpoint

The package repair, focused tests, 1,394 verifier tests, actual squashfs modes,
392 SD image checks, 14 executable smoke checks, RAUC bundle generation and
temporary device service probe passed. The replacement SD image is
`_out/s905x5m/s905x5m-mos-sd-1788858075.img`; its root hash is
`7c099c3d22ddf1c7bdc88741424cd4345744a4271d50b946cc8df968bf352aa1`.

The host ran out of working disk space during subsequent eMMC packaging.
After host recovery, the eMMC package export passed its 18-input round-trip
check. The user then explicitly stopped further packaging because of disk
space. The running installer helper and its command process were stopped;
the existing installer disk remains the older 07:08 artifact. No further
image or package generation is part of this delivery.

The scoped package-permission repair and SD validation are complete.
RFCT-944 remains open for the independent media/boot-mode blocker and for
cold-boot qualification, which a temporary service repair cannot establish.
