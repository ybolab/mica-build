#!/usr/bin/env bash
# mos-build-side: container -- assemble startup fixtures in the B1 component image.
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -r "$WORK"' EXIT
mkdir -p /input /output /usr/lib/mos/boot-busybox
cp -a /busybox-out/. /usr/lib/mos/boot-busybox/
printf '{}\n' > /input/boot.json

for arch in x64 aa64; do
    # Same-architecture ELFs stand in for the two Rust programs; assembly must
    # copy their bytes unchanged. Production still receives the Rust binaries.
    cp "/busybox-out/$arch/busybox" /input/mos-init
    cp "/busybox-out/$arch/busybox" /input/mos-shutdown
    dest="$WORK/$arch"
    bash "$REPO/pkgs/mos-boot/initramfs.sh" "$dest" "$arch"
    cmp /input/mos-init "$dest/init"
    cmp "/busybox-out/$arch/busybox" "$dest/bin/busybox"
    for name in blkid veritysetup dmsetup; do test -x "$dest/sbin/$name"; done
    for name in bin/mount sbin/losetup sbin/switch_root bin/sh; do test ! -e "$dest/$name"; done
    test -x "$dest/exitrd/shutdown"
    test -x "$dest/exitrd/bin/busybox"
    find "$dest/exitrd" -type f -printf '%P\n' | LC_ALL=C sort > "$WORK/exitrd.files"
    cmp "$WORK/exitrd.files" "$dest/exitrd.files"
    for path in bin/busybox init etc/mos/boot.json exitrd/shutdown; do
        test "$(grep -Fxc "$path" /output/initramfs.files)" -eq 1
    done
    cp /output/initramfs.cpio "$WORK/$arch-first.cpio"
    cp /output/initramfs.files "$WORK/$arch-first.files"
    touch -h -d @1700000000 /input/mos-init /input/mos-shutdown /input/boot.json \
        "/usr/lib/mos/boot-busybox/$arch/busybox"
    repeat="$WORK/$arch-repeat"
    bash "$REPO/pkgs/mos-boot/initramfs.sh" "$repeat" "$arch"
    cmp "$WORK/$arch-first.cpio" /output/initramfs.cpio
    cmp "$WORK/$arch-first.files" /output/initramfs.files
    printf '{"fixture":"changed-input"}\n' > /input/boot.json
    changed="$WORK/$arch-changed"
    bash "$REPO/pkgs/mos-boot/initramfs.sh" "$changed" "$arch"
    if cmp -s "$WORK/$arch-first.cpio" /output/initramfs.cpio; then
        echo "FAIL: changed initramfs input retained identical archive for $arch" >&2
        exit 1
    fi
    printf '{}\n' > /input/boot.json
    printf 'STARTUP_PACKAGE_PASS arch=%s\n' "$arch"
done

# Packaging must refuse absent or wrong-architecture startup payloads.
cp /busybox-out/x64/busybox /input/mos-init
cp /busybox-out/x64/busybox /input/mos-shutdown
mv /usr/lib/mos/boot-busybox/x64/busybox "$WORK/busybox"
if bash "$REPO/pkgs/mos-boot/initramfs.sh" "$WORK/missing" x64 > "$WORK/refusal" 2>&1; then
    echo 'FAIL: missing BusyBox accepted' >&2; exit 1
fi
test "$(grep -Fc '/usr/lib/mos/boot-busybox/x64/busybox' "$WORK/refusal")" -gt 0
cp /busybox-out/aa64/busybox /usr/lib/mos/boot-busybox/x64/busybox
if bash "$REPO/pkgs/mos-boot/initramfs.sh" "$WORK/wrong" x64 > "$WORK/refusal" 2>&1; then
    echo 'FAIL: wrong BusyBox architecture accepted' >&2; exit 1
fi
test "$(grep -Fc 'Wrong ELF architecture' "$WORK/refusal")" -gt 0
printf 'STARTUP_PACKAGE_REFUSALS_PASS\n'
