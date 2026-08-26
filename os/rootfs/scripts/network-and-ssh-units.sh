#!/bin/sh
# Write the image's default DHCP network, enable networkd/resolved, leave sshd off.
#
# Called from os/rootfs/stages/20-install.Dockerfile, where the reasoning lives.

printf '%s\n' \
    '[Match]' \
    'Name=eth*' \
    '' \
    '[Network]' \
    'DHCP=yes' \
    > /etc/systemd/network/80-dhcp.network &&
{ systemctl enable systemd-networkd systemd-resolved || true; } &&
mkdir -p /etc/systemd/system/multi-user.target.wants &&
for u in systemd-networkd systemd-resolved; do
    [ -L "/etc/systemd/system/multi-user.target.wants/$u.service" ] ||
        ln -s "/lib/systemd/system/$u.service" \
              "/etc/systemd/system/multi-user.target.wants/$u.service"
done &&
test -L /etc/systemd/system/multi-user.target.wants/systemd-networkd.service &&
test -L /etc/systemd/system/multi-user.target.wants/systemd-resolved.service &&
rm -f /etc/systemd/system/multi-user.target.wants/ssh.service &&
test ! -e /etc/systemd/system/multi-user.target.wants/ssh.service &&
echo "ssh.service left DISABLED in the image (both profiles; mosd owns the lifecycle)"
