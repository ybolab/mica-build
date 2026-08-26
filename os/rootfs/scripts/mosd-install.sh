#!/bin/sh
# Install mosd, apid and the two MQTT units; enable the first two, leave MQTT off.
#
# Called from os/rootfs/stages/30-40-unsplit.Dockerfile, where the reasoning lives.
# Build arguments read from the environment: WITH_MOSD.

if [ "$WITH_MOSD" = "1" ] && [ -f /tmp/mosd/mosd ]; then
    install -m 0755 /tmp/mosd/mosd /usr/bin/mosd &&
    install -m 0644 /tmp/mosd/mosd.service /usr/lib/systemd/system/mosd.service &&
    install -m 0644 /tmp/mosd/com.mos.mosd.conf /usr/share/dbus-1/system.d/com.mos.mosd.conf &&
    install -m 0644 /tmp/mosd/com.mos.ext.conf /usr/share/dbus-1/system.d/com.mos.ext.conf &&
    mkdir -p /var/lib/mos /etc/systemd/system/multi-user.target.wants &&
    ln -sf /usr/lib/systemd/system/mosd.service \
           /etc/systemd/system/multi-user.target.wants/mosd.service &&
    test -L /etc/systemd/system/multi-user.target.wants/mosd.service
fi &&
if [ "$WITH_MOSD" = "1" ] && [ -f /tmp/mosd/apid ]; then
    install -m 0755 /tmp/mosd/apid /usr/bin/apid &&
    install -m 0644 /tmp/mosd/apid.service /usr/lib/systemd/system/apid.service &&
    mkdir -p /etc/systemd/system/multi-user.target.wants &&
    ln -sf /usr/lib/systemd/system/apid.service \
           /etc/systemd/system/multi-user.target.wants/apid.service &&
    test -L /etc/systemd/system/multi-user.target.wants/apid.service
fi &&
if [ "$WITH_MOSD" = "1" ] && [ -f /tmp/mosd/mos-mqttd ]; then
    install -m 0755 /tmp/mosd/mos-mqttd /usr/bin/mos-mqttd &&
    install -m 0644 /tmp/mosd/mos-mqttd.service \
            /usr/lib/systemd/system/mos-mqttd.service &&
    install -m 0644 /tmp/mosd/mos-mqttd.conf \
            /usr/share/dbus-1/system.d/mos-mqttd.conf &&
    mkdir -p /etc/systemd/system/multi-user.target.wants &&
    rm -f /etc/systemd/system/multi-user.target.wants/mos-mqttd.service &&
    test ! -e /etc/systemd/system/multi-user.target.wants/mos-mqttd.service &&
    echo "mos-mqttd.service left DISABLED in the image (mosd owns the lifecycle; mqtt.enabled starts it)"
fi &&
if [ "$WITH_MOSD" = "1" ] && [ -f /tmp/mosd/mos-mqtt-broker ]; then
    install -m 0755 /tmp/mosd/mos-mqtt-broker /usr/bin/mos-mqtt-broker &&
    install -m 0644 /tmp/mosd/mos-mqtt-broker.service \
            /usr/lib/systemd/system/mos-mqtt-broker.service &&
    mkdir -p /etc/systemd/system/multi-user.target.wants &&
    rm -f /etc/systemd/system/multi-user.target.wants/mos-mqtt-broker.service &&
    test ! -e /etc/systemd/system/multi-user.target.wants/mos-mqtt-broker.service &&
    echo "mos-mqtt-broker.service left DISABLED in the image (mosd owns the lifecycle; no D-Bus policy, it speaks none)"
fi && rm -rf /tmp/mosd
