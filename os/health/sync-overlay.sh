#!/usr/bin/env bash
# Stage os/health into the v2 rootfs overlay (os/rootfs/overlay-v2), which is a
# plain mirror of the target filesystem copied into the image by the v2 rootfs
# build. The sources here are the single point of edit; run this after changing
# any of them. `os/health/test.sh` fails if the two ever drift.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OVERLAY=$HERE/../rootfs/overlay-v2

mkdir -p "$OVERLAY/usr/lib/mos" "$OVERLAY/usr/lib/systemd/system" \
    "$OVERLAY/etc/mos" "$OVERLAY/etc/systemd/system/multi-user.target.wants"

install -m 0755 "$HERE/mos-health" "$HERE/mos-machine-id" "$OVERLAY/usr/lib/mos/"
install -m 0644 "$HERE/mos-health.service" "$HERE/mos-machine-id.service" \
    "$OVERLAY/usr/lib/systemd/system/"
install -m 0644 "$HERE/health.conf" "$OVERLAY/etc/mos/health.conf"

# Enablement: the same static [Install] symlinks `systemctl enable` would make.
for unit in mos-health.service mos-machine-id.service; do
    ln -sfn "/usr/lib/systemd/system/$unit" \
        "$OVERLAY/etc/systemd/system/multi-user.target.wants/$unit"
done
echo "staged os/health -> $(cd "$OVERLAY" && pwd)"
