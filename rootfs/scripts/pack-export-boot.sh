#!/bin/sh
# Export the kernel and initramfs for a bootloader that cannot read squashfs.
#
# Called from rootfs/compose/90-pack.Dockerfile (pack stage), where the reasoning lives.

set -eu; mkdir -p /out/boot
if ls /rootfs/boot/vmlinuz-* >/dev/null 2>&1; then
    cp /rootfs/boot/vmlinuz-* /out/boot/vmlinuz
    cp /rootfs/boot/initrd.img-* /out/boot/initrd.img
    contents="$(lsinitramfs /out/boot/initrd.img 2>/dev/null)"
    [ -n "${contents}" ] ||
        { echo "error: could not read the exported initramfs at all. A Debian initrd is a CONCATENATION -- an uncompressed early cpio for microcode, then the compressed main archive -- so zcat reads the first and stops, and any check built on it reports every file as missing whatever the archive holds" >&2; exit 1; }
    for want in usr/sbin/veritysetup scripts/local-top/mos-verity; do
        printf '%s\n' "${contents}" | grep -qx "${want}" ||
            { echo "error: the EXPORTED initramfs does not contain ${want}. The rootfs stage asserted it was there; if that passed and this did not, something rebuilt the initramfs afterwards -- a dpkg trigger is the usual cause. Without veritysetup the boot stops at 'ALERT! /dev/dm-0 does not exist'" >&2; exit 1; }
    done
    echo "boot: the exported initramfs carries veritysetup and the mos-verity script"
    echo "boot: staged $(ls /rootfs/boot/vmlinuz-* | wc -l) kernel(s) for a bootloader that cannot read squashfs"
else
    echo "boot: no /boot/vmlinuz-* in the root; this board's bootloader is given its kernel by the BSP build"
    : > /out/boot/.no-kernel-in-root
fi
