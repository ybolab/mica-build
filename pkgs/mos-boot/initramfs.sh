#!/bin/bash
# mos-build-side: container -- assemble static startup and retained shutdown.
set -euo pipefail
DEST="$1"
EFI_ARCH=${2:?EFI architecture required}
mkdir -p "$DEST"/{sbin,dev,proc,sys,run,system,support,newroot,etc/mos}
# Preserve the existing architecture/ELF validation. Any discovered interpreter
# or library violates the one-file startup contract.
python3 /tools/elf-closure.py / "$DEST" "$EFI_ARCH" /input/mos-init /init
find "$DEST" -type f -printf '%P\n' | LC_ALL=C sort > /output/startup.files
test "$(cat /output/startup.files)" = init
test -x "$DEST/init"
install -m 0644 /output/startup.files "$DEST/startup.files"
install -m 0644 /input/boot.json "$DEST/etc/mos/boot.json"
# B3's retained static shutdown and manifest remain separate from startup.
python3 /tools/elf-closure.py / "$DEST/exitrd" "$EFI_ARCH" /input/mos-shutdown /shutdown
find "$DEST/exitrd" -type f -printf '%P\n' | LC_ALL=C sort > "$DEST/exitrd.files"
test "$(cat "$DEST/exitrd.files")" = shutdown
test -x "$DEST/exitrd/shutdown"
# Startup observation uses the same unchanged shutdown executable, without
# storing its bytes twice. copy_exitrd still receives the regular /shutdown.
ln -s /exitrd/shutdown "$DEST/sbin/mos-shutdown"
find "$DEST" -type f -printf '%P\n' | LC_ALL=C sort > /output/initramfs.files
printf '%s\n' etc/mos/boot.json exitrd.files exitrd/shutdown init startup.files > /output/expected.files
cmp /output/expected.files /output/initramfs.files
rm /output/expected.files
(
    cd "$DEST"
    find . -exec touch -h -d @1577836800 {} +
    find . -print0 | LC_ALL=C sort -z | cpio --null --reproducible --owner=0:0 -o -H newc --quiet
) > /output/initramfs.cpio
source /tools/compression.sh
# Expanded cpio AND transported bytes retain the existing 64 MiB safety bound.
# Compression saves artifact bytes, not boot RAM.
compress_payload /output/initramfs.cpio /output/initramfs.cpio.zst 67108864
stat -c '%n %s' /output/initramfs.cpio /output/initramfs.cpio.zst > /output/initramfs.sizes
sha256sum /output/initramfs.cpio /output/initramfs.cpio.zst > /output/initramfs.sha256
