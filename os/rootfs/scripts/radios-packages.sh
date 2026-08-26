#!/bin/sh
# Install the radio userland the board declares, and nothing for a board that
# declares none.
#
# Called from os/rootfs/stages/30-40-unsplit.Dockerfile, where the reasoning lives.
# Build arguments read from the environment: BOARD_RADIOS.

set -eu
if [ -z "${BOARD_RADIOS}" ]; then
    echo "radios: this board declares none; no bluez, wpasupplicant, hostapd or rfkill"
    exit 0
fi
apt-get update
pkgs=""
for r in ${BOARD_RADIOS}; do
    case "${r}" in
    wifi) pkgs="${pkgs} wpasupplicant hostapd rfkill" ;;
    bluetooth) pkgs="${pkgs} bluez rfkill" ;;
    *) echo "error: BOARD_RADIOS names '${r}'; this image knows wifi and bluetooth" >&2; exit 1 ;;
    esac
done
apt-get install -y --no-install-recommends ${pkgs}
rm -rf /var/lib/apt/lists/*
echo "radios: ${BOARD_RADIOS} ->${pkgs}"
