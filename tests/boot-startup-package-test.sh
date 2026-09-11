#!/bin/bash
# mos-build-side: container -- real static x64 inputs; no target execution.
set -euo pipefail
REPO=${1:?repository root}
WORK=$(mktemp -d)
trap 'rm -r "$WORK"' EXIT
bash "$REPO/pkgs/mos-boot/initramfs.sh" "$WORK/first" x64
test "$(cat "$WORK/first/startup.files")" = init
test "$(cat "$WORK/first/exitrd.files")" = shutdown
cmp /input/mos-init "$WORK/first/init"
cmp /input/mos-shutdown "$WORK/first/exitrd/shutdown"
test "$(readlink "$WORK/first/sbin/mos-shutdown")" = /exitrd/shutdown
test "$(find "$WORK/first" -type f | wc -l)" = 5
for path in bin/busybox sbin/blkid sbin/veritysetup sbin/dmsetup lib usr/lib; do test ! -e "$WORK/first/$path"; done
cp /output/initramfs.cpio "$WORK/first.cpio"
mv /output/initramfs.cpio.zst "$WORK/first.zst"
bash "$REPO/pkgs/mos-boot/initramfs.sh" "$WORK/repeat" x64
cmp "$WORK/first.cpio" /output/initramfs.cpio
cmp "$WORK/first.zst" /output/initramfs.cpio.zst
printf 'STARTUP_SINGLE_STATIC_MANIFEST_PASS\n'
