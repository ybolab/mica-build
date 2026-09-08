# PLAN-913 Restore shared rootfs cold-build reproducibility

- **status**: draft
- **owner**: reproducibility/ldconfig-aux-cache
- **createdAt**: 2026-08-31 07:28 UTC
- **approvedAt**: (pending)
- **relatedTask**: RFCT-921

## Context

RFCT-913 found that an otherwise identical cold arm64 rootfs differs at
`/usr/share/factory/var/cache/ldconfig/aux-cache`, changing both the squashfs
and its dm-verity root hash. The packed root moves `/var` wholesale to
`/usr/share/factory/var` in `pack-tree-surgery.sh`; therefore a cache created
before that move becomes signed rootfs content.

The producer is established. In the current s905x5m build, `40-board` runs
`board-packages-install.sh`, whose final `apt-get install alsa-utils`
transaction ends with `trigproc libc-bin:arm64` in the captured dpkg log.
Debian trixie `libc-bin` 2.41-12+deb13u3 has an `interest-await ldconfig`
trigger, and its post-install script invokes `ldconfig -r "$DPKG_ROOT/"` on
configure or trigger processing. That command writes the aux-cache;
`package-manager-purge.sh` currently retains it.

The cache is not the dynamic loader cache. A shipped arm64 factory root has
`/etc/ld.so.cache` (8,863 bytes) and the 8,844-byte aux-cache separately.
`LD_DEBUG=libs /usr/bin/env true` reports `search cache=/etc/ld.so.cache` and
never the aux-cache. The only shipped consumer of the latter is
`/sbin/ldconfig`: it exposes `--ignore-aux-cache`, and the enabled
`ldconfig.service` runs `/sbin/ldconfig -X` after `local-fs.target`.
`systemd-analyze condition ConditionNeedsUpdate=/etc` succeeds in the current
root. Package manager invocations cannot be a runtime consumer because the
pack stage removes apt and dpkg.

The runtime effect was measured on the actual s905x5m factory root under the
build host's arm64 emulation. Four alternating 20-run samples averaged
52.76 ms for `ldconfig -X` with a valid aux-cache and 59.79 ms with
`--ignore-aux-cache`: a 7.03 ms (13.3%) one-shot cost. Removing the file and
running `ldconfig -X` regenerates it, while both paths produce the identical
`/etc/ld.so.cache` SHA-256
`632f5b6972176efe4ae6e41dc326c2909d5dd5cb313f2db7b35c9af4815e55f3`.
Two consecutive `ldconfig -X` runs over an otherwise unchanged tree changed
the aux-cache SHA-256 while retaining that main-cache SHA-256, confirming that
the auxiliary metadata itself is not a stable image input.

The change is shared rootfs scope: s905x5m, cx3576, and x64 will all omit this
factory cache. It changes no loader lookup path or board-specific runtime
configuration. x64 has a separate, already documented cold-build variance in
its generated initramfs; removing the aux-cache cannot make that architecture
fully reproducible by itself.

## Proposal

1. Remove only `/var/cache/ldconfig/aux-cache` in the terminal package-manager
   purge, before `/var` moves into the factory tree. Retain
   `/etc/ld.so.cache`, `/sbin/ldconfig`, and the cache directory, so the
   enabled service and an explicit administrator invocation can regenerate the
   optimization on writable EPHEMERAL storage.
2. Add an image verifier assertion, with a failing-side fixture, that rejects
   the aux-cache in the packed root's factory `/var`. This prevents a later
   package or stage from silently restoring the reproducibility defect.
3. Add an opt-in `MOS_ROOTFS_NO_CACHE=1` bridge in `build-v2.sh` to forward the
   existing driver `--no-cache` flag. It preserves normal build behavior while
   allowing the standard wrapper to perform a true cold build without pruning
   Docker's shared cache.
4. Use one isolated source/artifact snapshot on `192.168.27.200` and run the
   standard s905x5m rootfs wrapper twice with that opt-in flag. Record the
   source and artifact checksums, package inventories, squashfs SHA-256,
   complete `rootfs-verity.img` SHA-256, and `VERITY_ROOT_HASH`. Extract the
   squashfs byte range named by `SQUASHFS_BYTES` and compare the two unpacked
   trees including metadata. Any new differing path or changed package
   inventory is recorded as a separate variance, not absorbed by this change.

## Risks

- The first runtime `ldconfig` after a fresh EPHEMERAL seed does about 7 ms
  more work in the measured arm64-emulation environment. It is a one-shot
  optimization cost, not a loader correctness change; the service recreates
  the cache on writable storage.
- `--no-cache` deliberately rebuilds every stage and is materially slower. The
  opt-in wrapper route avoids destructive daemon-cache pruning on the shared
  build host.
- The apt archive is not snapshot-pinned by this repository. Matching package
  inventories are therefore recorded as part of the two-build input check; a
  changed inventory is external input drift and must be reported separately.
- x64's generated initramfs is a known independent cold-build variance. It is
  outside this narrow aux-cache fix and will remain explicitly named.

## Scope

- `os/rootfs` purge and cold-build wrapper, image verification and its test,
  reproducibility documentation, and RFCT-921/this plan record.
- Two cold s905x5m rootfs builds on `192.168.27.200`, with no board access or
  storage writes.
- No deployment, board write, eMMC or boot-area write, bootloader change, or
  remote push.

## Alternatives

- Normalize the aux-cache: rejected. Its successive generated bytes differ
  even when the main loader cache remains unchanged, and its filesystem
  metadata is not a useful invariant after the factory tree is seeded into a
  different writable filesystem.
- Remove `/etc/ld.so.cache`, disable `ldconfig.service`, or remove ldconfig:
  rejected. Those change dynamic-linker or boot behavior instead of removing
  only an optional optimizer.
- Keep the cache and document hash drift: rejected because it leaves the
  verity root hash unable to identify a unique build from fixed inputs.

## Annotations

- 2026-08-31 07:28 UTC: investigation and proposal complete; explicit Phase 3
  approval is required before source changes or the two cold builds.
