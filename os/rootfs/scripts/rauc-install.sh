#!/bin/sh
# Install the five staged rauc files and record the version the image will run.
#
# Called from os/rootfs/stages/30-40-unsplit.Dockerfile, where the reasoning lives.

set -eu
for f in rauc rauc.service rauc-service.sh de.pengutronix.rauc.conf de.pengutronix.rauc.service; do
    [ -f "/tmp/rauc/${f}" ] || { echo "error: ${f} is not in the staged os/update/rauc output; run 'make os-rauc' first. An image without it boots, reports itself healthy, and cannot install an update" >&2; exit 1; }
done
install -m0755 /tmp/rauc/rauc            /usr/bin/rauc
install -d -m0755 /usr/libexec
install -m0755 /tmp/rauc/rauc-service.sh /usr/libexec/rauc-service.sh
install -d -m0755 /usr/lib/systemd/system /usr/share/dbus-1/system.d /usr/share/dbus-1/system-services
install -m0644 /tmp/rauc/rauc.service    /usr/lib/systemd/system/rauc.service
install -m0644 /tmp/rauc/de.pengutronix.rauc.conf    /usr/share/dbus-1/system.d/de.pengutronix.rauc.conf
install -m0644 /tmp/rauc/de.pengutronix.rauc.service /usr/share/dbus-1/system-services/de.pengutronix.rauc.service
sed -n 's/^RAUC_VERSION=//p' /tmp/rauc/RAUC_VERSION.env >/rootfs-report.rauc
[ -s /rootfs-report.rauc ] || { echo "error: the staged rauc carries no RAUC_VERSION; os/update/bundle.sh compares that against its own rauc before it writes a bundle, and an empty value would make the comparison pass by finding nothing" >&2; exit 1; }
echo "rauc: installed $(cat /rootfs-report.rauc), $(stat -c%s /usr/bin/rauc) bytes"
rm -rf /tmp/rauc
