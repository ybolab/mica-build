#!/bin/sh
# Install one hardware-init oneshot per board fact, and assert the two sets match.
#
# Called from os/rootfs/stages/40-board.Dockerfile, where the reasoning lives.
# Build arguments read from the environment: MOS_BOARD.
#
# MOS_BOARD reaches this script for its DIAGNOSTICS ONLY -- nothing below
# branches on it. The content arrives staged in /tmp/hwinit from the board's
# own tree, and the messages name the tree it came from, so a build that trips
# one is told to add a file under ITS board's directory.

set -eu
mkdir -p /etc/mos /usr/lib/mos /etc/systemd/system/multi-user.target.wants \
    /usr/lib/udev/rules.d
cp -a /tmp/board-init/. /etc/mos/
enabled=0; declared=0
for c in /tmp/board-init/*.conf; do
    [ -e "$c" ] || continue
    n="$(basename "$c" .conf)"
    declared=$((declared + 1))
    script="/tmp/hwinit/hwinit-$n"; unit="/tmp/hwinit/mos-$n.service"
    [ -f "$script" ] || { echo "error: /etc/mos/$n.conf is a board fact that no hwinit script reads (there is no os/boards/$MOS_BOARD/hwinit/hwinit-$n); a fact nothing consumes is a silent no-op on the device" >&2; exit 1; }
    [ -f "$unit" ] || { echo "error: os/boards/$MOS_BOARD/hwinit/hwinit-$n has no unit to run it (there is no os/boards/$MOS_BOARD/hwinit/mos-$n.service)" >&2; exit 1; }
    install -m 0755 "$script" /usr/lib/mos/
    install -m 0644 "$unit" /usr/lib/systemd/system/
    ln -sf "/usr/lib/systemd/system/mos-$n.service" \
           "/etc/systemd/system/multi-user.target.wants/mos-$n.service"
    test -L "/etc/systemd/system/multi-user.target.wants/mos-$n.service"
    for r in /tmp/hwinit/*-mos-"$n"-*.rules; do
        [ -e "$r" ] || continue
        install -m 0644 "$r" /usr/lib/udev/rules.d/
    done
    enabled=$((enabled + 1))
done
test "$enabled" = "$declared"
for f in /usr/lib/mos/hwinit-*; do
    [ -e "$f" ] || continue
    n="$(basename "$f" | sed 's/^hwinit-//')"
    [ -f "/etc/mos/$n.conf" ] || { echo "error: /usr/lib/mos/hwinit-$n shipped without /etc/mos/$n.conf; it can never run, and it drags its command dependencies into the image for nothing" >&2; exit 1; }
done
echo "hwinit: $declared board fact(s) declared, $enabled unit(s) installed and enabled"
rm -rf /tmp/hwinit /tmp/board-init
