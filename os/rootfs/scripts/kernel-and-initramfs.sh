#!/bin/sh
# Install the kernel: Debian's own on amd64 (with a verity initramfs), the BSP's
# modules.tar elsewhere.
#
# Called from os/rootfs/stages/40-board.Dockerfile, where the reasoning lives.
# Build arguments read from the environment: MOS_ARCH, SOURCE_DATE_EPOCH.

set -eu
if [ "$MOS_ARCH" = "amd64" ]; then
    apt-get update
    apt-get install -y --no-install-recommends linux-image-amd64 cryptsetup-bin
    ls /boot/vmlinuz-* >/dev/null 2>&1 ||
        { echo "error: linux-image-amd64 installed no kernel under /boot; the x64 image has nothing to boot" >&2; exit 1; }
    install -m0755 /tmp/initramfs/hooks/mos-verity /etc/initramfs-tools/hooks/mos-verity
    install -m0755 /tmp/initramfs/scripts/mos-verity /etc/initramfs-tools/scripts/local-top/mos-verity
    # SOURCE_DATE_EPOCH is what makes the initrd a function of its inputs
    # rather than of this host and this minute. initramfs-tools reads the name
    # from the environment and takes three separate steps on it: it clamps
    # every staged file's mtime down to the epoch, it passes cpio
    # --reproducible so entry inode numbers are renumbered from 1 instead of
    # being whatever the build host's filesystem handed out, and it compresses
    # with `gzip -n` so no name or timestamp reaches the segment header.
    # Without it the initrd carries the build clock and this host's inode
    # table, the packed root's bytes move between two builds of one tree, and
    # the dm-verity root hash moves with them -- while SQUASHFS_TIME and
    # VERITY_SALT go on being pinned for a property they no longer deliver.
    #
    # Checked, not assumed, because losing it is invisible: the value arrives
    # as the SOURCE_DATE_EPOCH build argument stages/40-board declares, and an
    # unset one still produces a perfectly bootable initrd. Nothing downstream
    # would notice until someone compared two builds. The echo is the other
    # half of the same point -- it puts the value the initrd was actually built
    # under into the build log, where the two-build comparison can read it back
    # instead of trusting that the argument was wired up.
    [ -n "${SOURCE_DATE_EPOCH:-}" ] ||
        { echo "error: SOURCE_DATE_EPOCH is empty or unset in this build step, so update-initramfs would stamp the wall clock and this build host's inode numbers into /boot/initrd.img-*, which ships inside the verity-covered root. stages/40-board declares the build argument and os/rootfs/build-v2.sh passes it the same instant it pins the squashfs to" >&2; exit 1; }
    echo "kernel-and-initramfs: update-initramfs runs with SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}"
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
