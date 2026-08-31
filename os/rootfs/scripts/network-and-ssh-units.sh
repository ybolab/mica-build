#!/bin/sh
# Write the image's default DHCP network and the ssh preset, enable
# networkd/resolved, leave sshd off.
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
# WHY THE PRESET IS WRITTEN HERE TOO, AND WHY THE `rm` ABOVE STAYS.
# The mos-system package expresses "sshd is off in this image" as a preset it
# owns, because a package cannot express it as an absence: openssh-server's
# postinst writes the link, and declining to ship it changes nothing. The two
# build paths must produce the same root, so the preset is a file the chain
# writes as well -- without it the composed root would carry a path this one
# does not, and the dual-build comparison would have to sanction a difference
# that is really just two spellings of one decision.
#
# The `rm` is still needed on THIS path and cannot be replaced by the preset:
# openssh-server is installed by stages/10-base, which runs before this script,
# so the link already exists by the time the preset lands and a preset does not
# retract a link that is already there. On the package path the ordering is the
# other way round -- dpkg unpacks mos-system's payload before it configures
# openssh-server -- which is why the preset is enough there and the package's
# postinst only asserts the result.
mkdir -p /usr/lib/systemd/system-preset &&
printf '%s\n' 'disable ssh.service' \
    > /usr/lib/systemd/system-preset/50-mos-ssh.preset &&
chmod 0644 /usr/lib/systemd/system-preset/50-mos-ssh.preset &&
rm -f /etc/systemd/system/multi-user.target.wants/ssh.service &&
test ! -e /etc/systemd/system/multi-user.target.wants/ssh.service &&
echo "ssh.service left DISABLED in the image (both profiles; mosd owns the lifecycle)"
