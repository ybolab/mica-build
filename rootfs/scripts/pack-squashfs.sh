#!/bin/sh
# Squash the root, with every knob that would otherwise vary between builds pinned.
#
# Called from rootfs/compose/90-pack.Dockerfile (pack stage), where the reasoning lives.
# Build arguments read from the environment: SQUASHFS_TIME.
#
# mos-build-side: container -- run by 90-pack.Dockerfile's pack stage, never on a host.

set -eu
test -n "${SQUASHFS_TIME}"
mksquashfs /rootfs /out/rootfs.squashfs \
    -comp zstd -Xcompression-level 19 \
    -noappend -no-exports \
    -mkfs-time "${SQUASHFS_TIME}" -all-time "${SQUASHFS_TIME}" \
    -processors 1
