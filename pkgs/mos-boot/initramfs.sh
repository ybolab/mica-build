#!/bin/bash
# mos-build-side: container -- copy the explicit early userspace ELF closure.
set -euo pipefail
DEST="$1"
EFI_ARCH=${2:?EFI architecture required}
RUNTIME=/
if [ "$EFI_ARCH" = aa64 ]; then RUNTIME=/arm64; fi
mkdir -p "$DEST"/{bin,sbin,dev,proc,sys,run,system,support,newroot,etc/mos}
copy_elf() {
    python3 /tools/elf-closure.py "$RUNTIME" "$DEST" "$EFI_ARCH" "$1" "$2"
}
copy_elf /input/mos-init /init
copy_elf "/usr/lib/mos/boot-busybox/$EFI_ARCH/busybox" /bin/busybox
for name in blkid veritysetup dmsetup; do
    source=
    for directory in usr/sbin usr/bin sbin bin; do
        if [ -f "$RUNTIME/$directory/$name" ]; then source="$RUNTIME/$directory/$name"; break; fi
    done
    test -n "$source"
    copy_elf "$source" "/sbin/$name"
done
install -m 0644 /input/boot.json "$DEST/etc/mos/boot.json"
# systemd pivots into this memory-only closure to release the file-backed root.
python3 /tools/elf-closure.py "$RUNTIME" "$DEST/exitrd" "$EFI_ARCH" \
    "$RUNTIME/usr/lib/systemd/systemd-shutdown" /shutdown
find "$DEST/exitrd" -type f -printf '%P\n' | LC_ALL=C sort > "$DEST/exitrd.files"
(
    cd "$DEST"
    find . -exec touch -h -d @1577836800 {} +
    find . -print0 | LC_ALL=C sort -z | cpio --null --reproducible --owner=0:0 -o -H newc --quiet
) > /output/initramfs.cpio
find "$DEST" -type f -printf '%P\n' | LC_ALL=C sort > /output/initramfs.files
test ! -e "$DEST/bin/sh"
test -x "$DEST/bin/busybox"
test ! -e "$DEST/bin/mount"
test ! -e "$DEST/sbin/losetup"
test ! -e "$DEST/sbin/switch_root"
test ! -d "$DEST/usr/lib/modules"
