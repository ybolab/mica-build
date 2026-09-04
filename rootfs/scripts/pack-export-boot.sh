#!/bin/sh
# Export the kernel for a bootloader that cannot read squashfs.
#
# Called from rootfs/compose/90-pack.Dockerfile (pack stage), where the reasoning lives.

set -eu; mkdir -p /out/boot
if ls /rootfs/boot/vmlinuz-* >/dev/null 2>&1; then
    kernels="$(ls /rootfs/boot/vmlinuz-* | wc -l)"
    [ "${kernels}" = 1 ] ||
        { echo "error: the packed root carries ${kernels} kernels in /boot, so which one this exports -- and therefore which one the bootloader launches -- would be decided by sort order" >&2; exit 1; }
    cp /rootfs/boot/vmlinuz-* /out/boot/vmlinuz

    # NO INITRAMFS, and the assertion is the inverse of the one this script
    # used to make.
    #
    # Until PLAN-074 this board ran Debian's generic kernel, which has no
    # CONFIG_DM_INIT and so ignored the dm-mod.create= verity table on the
    # kernel command line. An initrd re-implemented it, this script exported
    # that initrd, and it checked the archive for veritysetup and the
    # mos-verity local-top script -- because without them the boot stopped at
    # "ALERT! /dev/dm-0 does not exist". mos-kernel-x64 carries the device
    # mapper, dm-verity and squashfs built in and reads the command line
    # itself, exactly as cx3576's kernel does, so there is no initrd to export
    # and no archive to inspect.
    #
    # RFCT-281 IS NOT DROPPED HERE, IT IS RESTATED STRONGER. That clause said
    # BusyBox must not be an initramfs dependency, and it was checked by
    # listing the exported initrd and refusing any entry named for busybox.
    # With no initrd that grep would search nothing and report green forever --
    # so what is asserted instead is the fact that makes the clause
    # unconditional: this board's early boot has no userspace at all, because
    # there is no initramfs for one to live in. verify/src/checks-busybox.ts
    # keeps the other half, over the /etc/initramfs-tools and
    # /usr/share/initramfs-tools trees that a reintroduced initramfs would have
    # to bring back with it.
    #
    # Checked in the ROOT rather than in /out, and both spellings of the name:
    # an initrd nothing exports is still an initrd something built, and the
    # question is whether this image grew an early userspace, not whether this
    # script copied one.
    initrds="$(ls /rootfs/boot/initrd.img-* /rootfs/boot/initrd-* 2>/dev/null | tr '\n' ' ')"
    [ -z "${initrds}" ] ||
        { echo "error: the packed root carries an initramfs: ${initrds}. This board's kernel assembles the dm-verity root from the kernel command line and the bootloader passes no initrd, so nothing here is supposed to build one -- something has reintroduced initramfs-tools and a kernel package whose postinst fires it, and early boot has grown a userspace that is neither verified nor covered by RFCT-281's BusyBox clause" >&2; exit 1; }

    # The floor the absent initrd is only safe WITHOUT. Read off the config the
    # image ships beside the kernel, so this is a statement about the artefact
    # rather than about the build that produced it.
    release="$(ls /rootfs/boot/vmlinuz-* | sed 's|.*/vmlinuz-||')"
    config="/rootfs/boot/config-${release}"
    [ -f "${config}" ] ||
        { echo "error: the packed root has /boot/vmlinuz-${release} and no /boot/config-${release} beside it, so nothing states how the kernel this image boots was configured and the check below has nothing to read" >&2; exit 1; }
    for option in DM_INIT BLK_DEV_DM DM_VERITY SQUASHFS; do
        grep -q "^CONFIG_${option}=y\$" "${config}" ||
            { echo "error: ${config} does not declare CONFIG_${option}=y. With no initramfs, everything between 'the disk exists' and 'the verity root is mounted' has to be in the kernel image; as a module it cannot be loaded, because there is nothing to load it from yet" >&2; exit 1; }
    done
    echo "boot: kernel ${release} carries the no-initramfs verity floor built in, and the root has no initrd"
    echo "boot: staged ${kernels} kernel(s) for a bootloader that cannot read squashfs"
else
    echo "boot: no /boot/vmlinuz-* in the root; this board's bootloader is given its kernel by the BSP build"
    : > /out/boot/.no-kernel-in-root
fi
