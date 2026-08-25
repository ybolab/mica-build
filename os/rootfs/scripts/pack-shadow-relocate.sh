#!/bin/sh
# Move /etc/shadow onto a tmpfs symlink and retain the factory copy.
#
# Called from os/rootfs/Dockerfile.v2 (pack stage), where the reasoning lives.

set -eu
test -f /rootfs/etc/shadow && test ! -L /rootfs/etc/shadow
mkdir -p /rootfs/usr/share/factory/etc
cp -a /rootfs/etc/shadow /rootfs/usr/share/factory/etc/shadow
chmod 0640 /rootfs/usr/share/factory/etc/shadow
ln -sfn /run/mos/shadow /rootfs/etc/shadow
echo "shadow: /etc/shadow -> /run/mos/shadow (tmpfs), factory copy retained"
