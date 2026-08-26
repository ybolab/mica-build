#!/bin/sh
# Install mosd, apid and the two MQTT units; enable the first two, leave MQTT off.
#
# Called from os/rootfs/stages/33-feature-mosd.Dockerfile, where the reasoning lives.
# Build arguments read from the environment: none.
#
# EVERY FILE IS REQUIRED.
# Each of the four blocks below used to open with
#
#   if [ "$WITH_MOSD" = "1" ] && [ -f /tmp/mosd/<binary> ]; then
#
# and both halves are gone, for different reasons. WITH_MOSD is now the presence
# of the stage: a build that does not want mosd does not build the file that
# calls this, so reaching this line means mosd was asked for. The `[ -f ]` half
# was a SILENT SKIP -- it was there because build-v2.sh staged an empty
# directory when WITH_MOSD=0, and it also swallowed a MOSD_DIR pointing at the
# wrong place and a cross-build that produced three binaries out of four,
# yielding an image that builds green, boots, and has no management daemon at
# all. The list below is what the stage asks for, and a missing member is a
# build failure naming the file, the way podman-install.sh already refused.

set -eu
for f in mosd mosd.service com.mos.mosd.conf com.mos.ext.conf \
         apid apid.service \
         mos-mqttd mos-mqttd.service mos-mqttd.conf \
         mos-mqtt-broker mos-mqtt-broker.service; do
    [ -f "/tmp/mosd/${f}" ] ||
        { echo "error: ${f} is not in the staged mosd output at MOSD_DIR. This chain includes stages/33-feature-mosd, which asks for the management daemon; leave the stage out with --without mosd for a board that declines it. Continuing would produce an image that boots, reports itself healthy, and has no way to be managed" >&2; exit 1; }
done

install -m 0755 /tmp/mosd/mosd /usr/bin/mosd
install -m 0644 /tmp/mosd/mosd.service /usr/lib/systemd/system/mosd.service
install -m 0644 /tmp/mosd/com.mos.mosd.conf /usr/share/dbus-1/system.d/com.mos.mosd.conf
install -m 0644 /tmp/mosd/com.mos.ext.conf /usr/share/dbus-1/system.d/com.mos.ext.conf
mkdir -p /var/lib/mos /etc/systemd/system/multi-user.target.wants
ln -sf /usr/lib/systemd/system/mosd.service \
       /etc/systemd/system/multi-user.target.wants/mosd.service
test -L /etc/systemd/system/multi-user.target.wants/mosd.service

install -m 0755 /tmp/mosd/apid /usr/bin/apid
install -m 0644 /tmp/mosd/apid.service /usr/lib/systemd/system/apid.service
ln -sf /usr/lib/systemd/system/apid.service \
       /etc/systemd/system/multi-user.target.wants/apid.service
test -L /etc/systemd/system/multi-user.target.wants/apid.service

install -m 0755 /tmp/mosd/mos-mqttd /usr/bin/mos-mqttd
install -m 0644 /tmp/mosd/mos-mqttd.service \
        /usr/lib/systemd/system/mos-mqttd.service
install -m 0644 /tmp/mosd/mos-mqttd.conf \
        /usr/share/dbus-1/system.d/mos-mqttd.conf
rm -f /etc/systemd/system/multi-user.target.wants/mos-mqttd.service
test ! -e /etc/systemd/system/multi-user.target.wants/mos-mqttd.service
echo "mos-mqttd.service left DISABLED in the image (mosd owns the lifecycle; mqtt.enabled starts it)"

install -m 0755 /tmp/mosd/mos-mqtt-broker /usr/bin/mos-mqtt-broker
install -m 0644 /tmp/mosd/mos-mqtt-broker.service \
        /usr/lib/systemd/system/mos-mqtt-broker.service
rm -f /etc/systemd/system/multi-user.target.wants/mos-mqtt-broker.service
test ! -e /etc/systemd/system/multi-user.target.wants/mos-mqtt-broker.service
echo "mos-mqtt-broker.service left DISABLED in the image (mosd owns the lifecycle; no D-Bus policy, it speaks none)"

rm -rf /tmp/mosd
