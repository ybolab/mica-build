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

    # RFCT-281: BusyBox is not an initramfs dependency, asserted over the
    # archive that SHIPS rather than over the package list that produced it.
    #
    # mos-busybox puts /usr/bin/busybox in the root and nothing else -- in
    # particular NOT Debian's /usr/share/initramfs-tools/hooks/zz-busybox, which
    # copies busybox into the initrd and hard-links every applet name beside it,
    # and NOT the conf-hooks.d fragment that sets BUSYBOXDIR and turns the hook
    # on. Without that fragment mkinitramfs leaves BUSYBOXDIR empty, the
    # klibc-utils hook takes its klibc branch, and the initrd is the same one
    # this image built before the package existed.
    #
    # That is a chain of three facts about somebody else's packaging, so it is
    # asserted rather than trusted: if any link of it changes -- a dependency
    # added, a hook shipped, initramfs-tools learning to autodetect the binary
    # -- busybox appears in this listing and the build stops here. An emergency
    # tool that early boot has come to depend on is no longer an emergency tool,
    # and the failure it would otherwise cause is a device that does not boot.
    #
    # The listing is known to be readable and populated: the two greps above
    # found their entries in it, so a `grep -c` returning zero here is a
    # statement about busybox and not about an archive nothing could read.
    hits="$(printf '%s\n' "${contents}" | grep -i busybox || true)"
    [ -z "${hits}" ] ||
        { echo "error: the EXPORTED initramfs contains busybox: ${hits}. mos-busybox ships one binary at /usr/bin/busybox and no initramfs hook, so nothing in this image is supposed to put it in the initrd -- something now depends on it during early boot, which is the one thing RFCT-281 forbids" >&2; exit 1; }
    echo "boot: the exported initramfs carries no busybox, so early boot depends on none ($(printf '%s\n' "${contents}" | grep -c .) entries read)"
    echo "boot: staged $(ls /rootfs/boot/vmlinuz-* | wc -l) kernel(s) for a bootloader that cannot read squashfs"
else
    echo "boot: no /boot/vmlinuz-* in the root; this board's bootloader is given its kernel by the BSP build"
    : > /out/boot/.no-kernel-in-root
fi
