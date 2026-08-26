#!/bin/sh
# Mask the packaged non-templated radio units, whose lifecycles mosd owns.
#
# Called from os/rootfs/stages/30-feature-radios.Dockerfile, where the reasoning lives.
# Build arguments read from the environment: BOARD_RADIOS.

set -eu
if [ -z "${BOARD_RADIOS}" ]; then
    echo "radios: none declared; no packaged radio units to mask"
    exit 0
fi
mkdir -p /etc/systemd/system
for u in hostapd.service wpa_supplicant.service \
         dbus-fi.w1.wpa_supplicant1.service; do
    rm -f "/etc/systemd/system/${u}"
    ln -s /dev/null "/etc/systemd/system/${u}"
    [ "$(readlink "/etc/systemd/system/${u}")" = /dev/null ]
done
rm -f /etc/systemd/system/multi-user.target.wants/hostapd.service \
      /etc/systemd/system/multi-user.target.wants/wpa_supplicant.service
for u in hostapd@.service wpa_supplicant@.service; do
    test -f "/usr/lib/systemd/system/${u}"
    if find /etc/systemd/system /usr/lib/systemd/system -path '*.wants/*' \
            -name "${u}" | grep -q .; then
        echo "error: ${u} is statically enabled; mosd owns that lifecycle" >&2; exit 1
    fi
done
echo "connd: hostapd.service and wpa_supplicant.service masked, templates present and unenabled"
