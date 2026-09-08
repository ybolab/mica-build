# RFCT-921 Make the shared rootfs cold-build reproducible

- **status**: in_progress
- **priority**: P1
- **owner**: reproducibility/ldconfig-aux-cache
- **createdAt**: 2026-08-31 07:17 UTC
- **plan**: PLAN-913

## Description

Investigate and eliminate the cold-build variance recorded by RFCT-913:
`/usr/share/factory/var/cache/ldconfig/aux-cache` changes between otherwise
identical arm64 rootfs builds, changing the squashfs and dm-verity root hash.
Establish its producer, runtime consumers, and measured absence cost; choose
removal or normalization on that evidence; then prove two cold builds from the
same inputs yield byte-identical squashfs images and identical verity root
hashes. Check for a further source of variance after the first one is fixed.

The change is shared rootfs scope. It therefore applies to s905x5m, cx3576,
and x64. No board, eMMC partition, boot area, or `bootloader_a` write is in
scope, and the repository must not be pushed.

## Acceptance

- [ ] Identify the exact build stage and package/post-install action that
  produces the aux-cache.
- [ ] Measure whether the cache is consumed at runtime and the cost of its
  absence on the shipped system.
- [ ] Record a reasoned removal-versus-normalization decision and its board
  blast radius.
- [ ] Produce two independent cold builds on `192.168.27.200` from the same
  inputs and record matching squashfs checksums and matching dm-verity root
  hashes.
- [ ] Record any additional observed variance separately rather than including
  it in this fix.

## ActiveForm

Investigating the shared ldconfig aux-cache reproducibility defect.

## Dependencies

- **blocked by**: (none)
- **blocks**: reproducible rootfs provenance claims

## Notes

- RFCT-913 recorded the initial full-unpack diff as exactly this cache file;
  that observation is the starting hypothesis, not evidence that it is the
  only possible source of variance in a later environment.
- Heavy builds are restricted to `192.168.27.200`, which has a reclaimed Docker
  cache and sufficient free space for the required cold-build measurements.

## Investigation

- The final s905x5m apt transaction is `40-board`'s `alsa-utils` install;
  captured dpkg evidence ends with `trigproc libc-bin:arm64`. libc-bin's
  ldconfig trigger and post-install script generate the cache before pack
  moves `/var` into the factory tree.
- The dynamic loader consumes `/etc/ld.so.cache`, not aux-cache. The enabled
  `ldconfig.service` is the runtime consumer of the auxiliary optimization;
  it can regenerate the file on EPHEMERAL storage.
- Four alternating arm64-emulation samples measured 52.76 ms with a valid
  aux-cache and 59.79 ms while forcing `--ignore-aux-cache`: 7.03 ms of
  one-shot ldconfig work, with the same resulting main loader cache.
- PLAN-913 records the removal decision, test guard, cold-build method, known
  x64 initramfs limitation, and external apt-input check.
