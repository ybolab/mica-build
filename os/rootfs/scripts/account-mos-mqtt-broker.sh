#!/bin/sh
# Create the pinned mos-mqtt-broker service account (uid/gid 969).
#
# Called from os/rootfs/stages/30-40-unsplit.Dockerfile, where the reasoning lives.

set -eu
if awk -F: '$3 == 969 || $1 == "mos-mqtt-broker"' /etc/passwd | grep -q .; then
    echo "error: uid 969 or the name mos-mqtt-broker is already taken in the base image: $(awk -F: '$3 == 969 || $1 == "mos-mqtt-broker"' /etc/passwd)" >&2; exit 1
fi
groupadd --system --gid 969 mos-mqtt-broker
useradd --system --uid 969 --gid 969 --no-create-home \
        --home-dir /nonexistent --shell /usr/sbin/nologin \
        --comment "mos MQTT broker" mos-mqtt-broker
chage -d 2020-01-01 mos-mqtt-broker
ent="$(awk -F: '$1 == "mos-mqtt-broker"' /etc/passwd)"
case "${ent}" in
mos-mqtt-broker:x:969:969:*:/nonexistent:/usr/sbin/nologin) ;;
*) echo "error: mos-mqtt-broker passwd entry is not the pinned one: ${ent}" >&2; exit 1 ;;
esac
echo "mos-mqtt-broker system account created: ${ent}"
