#!/bin/sh
# Wire the radio state mount points that arrived with the board overlay.
#
# Called from os/rootfs/Dockerfile.v2 (rootfs stage), where the reasoning lives.
# Build arguments read from the environment: BOARD_RADIOS.

set -eu
if [ -z "${BOARD_RADIOS}" ]; then
    echo "radios: none declared; no radio mount points to wire"
    exit 0
fi
for u in var-lib-bluetooth.mount etc-wpa_supplicant.mount etc-hostapd.mount; do
    test -f "/etc/systemd/system/$u" ||
        { echo "error: ${BOARD_RADIOS} declared but /etc/systemd/system/$u is not in the overlay" >&2; exit 1; }
    chmod 0644 "/etc/systemd/system/$u"
    ln -sf "/etc/systemd/system/$u" "/etc/systemd/system/local-fs.target.wants/$u"
    test -L "/etc/systemd/system/local-fs.target.wants/$u"
done
echo "radios: mount points wired for ${BOARD_RADIOS}"
