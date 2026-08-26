#!/bin/sh
# Install the kernel: Debian's own on amd64 (with a verity initramfs), the BSP's
# modules.tar elsewhere.
#
# Called from os/rootfs/stages/30-40-unsplit.Dockerfile, where the reasoning lives.
# Build arguments read from the environment: MOS_ARCH.

set -eu
if [ "$MOS_ARCH" = "amd64" ]; then
    apt-get update
    apt-get install -y --no-install-recommends linux-image-amd64 cryptsetup-bin
    ls /boot/vmlinuz-* >/dev/null 2>&1 ||
        { echo "error: linux-image-amd64 installed no kernel under /boot; the x64 image has nothing to boot" >&2; exit 1; }
    install -m0755 /tmp/initramfs/hooks/mos-verity /etc/initramfs-tools/hooks/mos-verity
    install -m0755 /tmp/initramfs/scripts/mos-verity /etc/initramfs-tools/scripts/local-top/mos-verity
    update-initramfs -u -k all
    lsinitramfs /boot/initrd.img-* | grep -q 'sbin/veritysetup' ||
        { echo "error: the rebuilt initramfs does not contain veritysetup. Without it nothing assembles /dev/dm-0 and the boot hangs waiting for a device that is never created" >&2; exit 1; }
    lsinitramfs /boot/initrd.img-* | grep -q 'scripts/local-top/mos-verity' ||
        { echo "error: the rebuilt initramfs does not contain the mos-verity local-top script" >&2; exit 1; }
    for cmd in tr sed awk grep cut head tail sort uniq expr basename dirname xargs find; do
        if grep -qE "(^|[ \t;|(&])${cmd}[ \t]" /etc/initramfs-tools/scripts/local-top/mos-verity; then
            echo "error: the mos-verity script calls '${cmd}', which a klibc initramfs does not have. Its whole command set is blkid cat chroot cpio dd dmesg false fstype gunzip halt insmod ipconfig kill kmod ln losetup ls minips mkdir mkfifo mknod modprobe mount mv nfsmount nuke pivot_root poweroff readlink reboot resume rmmod run-init sh sleep sync true udevadm umount uname, plus what a hook copies in. A missing command here fails AFTER the kernel has handed over, which on a headless machine is indistinguishable from a hang" >&2; exit 1
        fi
    done
    # NOTHING IS PURGED WITH dpkg AFTER THIS POINT, and that is the whole
    # reason cryptsetup-bin survives to the package-manager purge stage
    # instead of being removed here. An `apt-get purge` fires the kernel
    # package's triggers, update-initramfs runs a SECOND time with the
    # hook already gone, and the initrd that ships has no veritysetup in it
    # -- while the two assertions above, which ran before that, both passed.
    # A check whose subject is rebuilt after it runs is not a check.
    # package-manager-purge.sh removes the binary with rm, which fires nothing.
    rm -rf /var/lib/apt/lists/*
    rm -f /tmp/modules.tar
else
    mkdir -p /tmp/mods /usr/lib/modules
    tar -xf /tmp/modules.tar -C /tmp/mods
    cp -a /tmp/mods/lib/modules/. /usr/lib/modules/
    rm -rf /tmp/mods /tmp/modules.tar
fi
rm -rf /tmp/initramfs
ls /usr/lib/modules >/dev/null
