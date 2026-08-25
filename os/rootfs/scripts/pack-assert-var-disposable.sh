#!/bin/sh
# Assert nothing precious is left on the disposable /var.
#
# Called from os/rootfs/Dockerfile.v2 (pack stage), where the reasoning lives.
# Build arguments read from the environment: BOARD_RADIOS.

set -eu
# /var/lib/bluetooth only on a board that HAS Bluetooth: the pairing
# database is precious state there and does not exist at all on a board
# with no radio, where demanding its mount unit would fail a correct image.
precious="/var/lib/mos"
case " ${BOARD_RADIOS} " in *" bluetooth "*) precious="${precious} /var/lib/bluetooth" ;; esac
for w in ${precious}; do
    unit="$(echo "${w#/}" | tr / -).mount"
    f="/rootfs/etc/systemd/system/${unit}"
    if [ ! -f "$f" ]; then
        echo "error: ${w} holds precious state but ${unit} does not exist" >&2; exit 1
    fi
    if [ ! -L "/rootfs/etc/systemd/system/local-fs.target.wants/${unit}" ]; then
        echo "error: ${unit} exists but is not enabled; ${w} would stay on the disposable /var" >&2; exit 1
    fi
    grep -q "^Where=${w}\$" "$f" || { echo "error: ${unit} does not mount ${w}" >&2; exit 1; }
    grep -qE "^What=/mnt/state/" "$f" || { echo "error: ${unit} is not backed by STATE" >&2; exit 1; }
    if [ ! -d "/rootfs/usr/share/factory${w}" ]; then
        echo "error: ${w} is missing from the factory /var, so the bind would have no mountpoint" >&2; exit 1
    fi
    echo "precious: ${w} -> STATE via ${unit}"
done
grep -q '^Storage=volatile$' /rootfs/etc/systemd/journald.conf.d/00-volatile.conf ||
    { echo "error: journald is not Storage=volatile; the journal would fill the fixed-size /var" >&2; exit 1; }
echo "precious: journald Storage=volatile (journal never lands on /var)"
test -L /rootfs/usr/share/factory/var/lib/dbus/machine-id ||
    { echo "error: /var/lib/dbus/machine-id is not a symlink; a baked D-Bus id is per-image identity on a disposable filesystem" >&2; exit 1; }
