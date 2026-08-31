#!/bin/sh
# The tree edits that cannot happen in the rootfs stage: resolv.conf, identity
# files, and /var moved aside to become an empty mountpoint.
#
# Called from os/rootfs/stages/90-pack.Dockerfile (pack stage), where the reasoning lives.

mkdir -p /out &&
mv /rootfs/rootfs-report.txt /out/rootfs-report-v2.txt &&
mv /rootfs/rootfs-report.pkglogs /out/pkg-logs &&
ln -sf ../run/systemd/resolve/stub-resolv.conf /rootfs/etc/resolv.conf &&
echo 'mos' > /rootfs/etc/hostname &&
echo '127.0.1.1 mos' >> /rootfs/etc/hosts &&
: > /rootfs/etc/machine-id &&
mkdir -p /rootfs/usr/share/factory &&
mv /rootfs/var /rootfs/usr/share/factory/var &&
# glibc's ldconfig aux-cache does not go with it. It is a REGENERABLE lookup
# cache keyed on the {dev, ino, ctime} of every shared library as seen on the
# BUILD HOST, so every entry in it is already wrong for the device the moment
# the image ships, and ldconfig rebuilds it from the real filesystem anyway.
# What it costs while it is here is build-host fingerprints inside signed image
# content: those inode numbers and ctimes move between two builds of one tree,
# so the packed root moves with them and the dm-verity root hash over it moves
# too -- which is the property SQUASHFS_TIME and VERITY_SALT are pinned to
# give. This is not a determinism workaround; it is removing a file that should
# never have shipped.
#
# `rm`, not `rm -f`, and scoped to the one file rather than to the directory:
# a forced removal of a path that stopped existing would go on reporting
# success forever, and the empty /var/cache/ldconfig it leaves is the directory
# ldconfig writes into on the device.
rm /rootfs/usr/share/factory/var/cache/ldconfig/aux-cache &&
mkdir -m 0755 /rootfs/var &&
mkdir -m 1777 /rootfs/var/tmp &&
ln -sf ../../../etc/machine-id \
    /rootfs/usr/share/factory/var/lib/dbus/machine-id
