#!/bin/sh
# The tree edits that cannot happen in the rootfs stage: resolv.conf, identity
# files, and /var moved aside to become an empty mountpoint.
#
# Called from os/rootfs/stages/90-pack.Dockerfile (pack stage), where the reasoning lives.

mkdir -p /out &&
mv /rootfs/rootfs-report.txt /out/rootfs-report-v2.txt &&
ln -sf ../run/systemd/resolve/stub-resolv.conf /rootfs/etc/resolv.conf &&
echo 'mos' > /rootfs/etc/hostname &&
echo '127.0.1.1 mos' >> /rootfs/etc/hosts &&
: > /rootfs/etc/machine-id &&
mkdir -p /rootfs/usr/share/factory &&
mv /rootfs/var /rootfs/usr/share/factory/var &&
mkdir -m 0755 /rootfs/var &&
mkdir -m 1777 /rootfs/var/tmp &&
ln -sf ../../../etc/machine-id \
    /rootfs/usr/share/factory/var/lib/dbus/machine-id
