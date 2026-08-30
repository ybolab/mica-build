#!/bin/sh
# Fail the build on CJK text in a mos-owned image file.
#
# Called from os/rootfs/stages/90-pack.Dockerfile (pack stage), where the reasoning lives.

set -e
    mos_paths=""
    for f in /rootfs/usr/lib/mos /rootfs/etc/mos \
             /rootfs/usr/lib/udev/rules.d/60-mos-*.rules \
             /rootfs/usr/lib/systemd/system/mos-*.service \
             /rootfs/usr/lib/systemd/system/mosd.service \
             /rootfs/usr/lib/systemd/system/apid.service \
             /rootfs/usr/share/dbus-1/system.d/com.mos.mosd.conf \
             /rootfs/etc/systemd/network/*.network \
             /rootfs/etc/systemd/system/mos-*.service \
             /rootfs/etc/systemd/system/etc-ssh.mount \
             /rootfs/etc/systemd/system/etc-hostname.mount \
             /rootfs/etc/systemd/system/etc-wpa_supplicant.mount \
             /rootfs/etc/systemd/system/etc-hostapd.mount \
             /rootfs/etc/systemd/system/var-lib-mos.mount \
             /rootfs/etc/repart.d /rootfs/etc/fstab \
             /rootfs/etc/fw_env.config; do
        if [ -e "$f" ]; then mos_paths="$mos_paths $f"; fi
    done
    test -n "$mos_paths"
    hits=$(grep -rlP '[\x{3400}-\x{4dbf}\x{4e00}-\x{9fff}\x{f900}-\x{faff}]' \
        $mos_paths 2>/dev/null || true)
    if [ -n "$hits" ]; then
        echo 'CJK text found in mos-owned image files:' >&2
        echo "$hits" >&2
        exit 1
    fi
