#!/bin/sh
# Create the pinned mos-mqttd service account (uid/gid 970).
#
# Called from os/rootfs/Dockerfile.v2 (rootfs stage), where the reasoning lives.

set -eu
if awk -F: '$3 == 970 || $1 == "mos-mqttd"' /etc/passwd | grep -q .; then
    echo "error: uid 970 or the name mos-mqttd is already taken in the base image: $(awk -F: '$3 == 970 || $1 == "mos-mqttd"' /etc/passwd)" >&2; exit 1
fi
groupadd --system --gid 970 mos-mqttd
useradd --system --uid 970 --gid 970 --no-create-home \
        --home-dir /nonexistent --shell /usr/sbin/nologin \
        --comment "mos MQTT bridge" mos-mqttd
chage -d 2020-01-01 mos-mqttd
ent="$(awk -F: '$1 == "mos-mqttd"' /etc/passwd)"
case "${ent}" in
mos-mqttd:x:970:970:*:/nonexistent:/usr/sbin/nologin) ;;
*) echo "error: mos-mqttd passwd entry is not the pinned one: ${ent}" >&2; exit 1 ;;
esac
echo "mos-mqttd system account created: ${ent}"
