#!/usr/bin/env bash
# Read the journal out of the disk the last QEMU run left behind.
#
#   bash os/qemu-journal.sh [journalctl args...]
#   bash os/qemu-journal.sh -u systemd-resolved -p err
#
# WHY THIS INSTEAD OF A LOGIN. The console shows systemd's status lines and
# nothing else: a unit that fails prints "[FAILED] ... See 'systemctl status'
# for details" and the details are exactly what a headless capture does not
# have. Logging in is not available either -- root ships with no password and
# sshd is off in both profiles, by design.
#
# The journal is on the EPHEMERAL partition, which is a real partition in the
# disk file, so it survives the guest being killed. Reading it needs no change
# to the image and no test-only unit: what is examined is what the device
# actually wrote.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
OUT_DIR="${REPO_ROOT}/_out/x64"
. "${REPO_ROOT}/os/layout/x64-v2.env"
DISK="${OUT_DIR}/.qemu/disk.img"

if [ ! -f "${DISK}" ]; then
    echo "error: ${DISK} not found. Run 'bash os/qemu-run.sh' first; this reads the disk that run left behind." >&2
    exit 1
fi

WORK="${OUT_DIR}/.journal"
rm -rf "${WORK}"
mkdir -p "${WORK}"
trap 'rm -rf "${WORK}"' EXIT
cp "${DISK}" "${WORK}/disk.img"
printf '%s\n' "$@" >"${WORK}/args"

docker run --rm -v "${WORK}:/w" -e EPHEMERAL_FS_UUID debian:trixie-slim bash -c '
    set -eu
    apt-get update -qq >/dev/null 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
        gdisk e2fsprogs systemd >/dev/null 2>&1
    cd /w
    # The partition offset comes from the GPT in the image, not from the layout
    # file: reading it back is what proves the two agree.
    start=$(sgdisk -i "'"${EPHEMERAL_PARTNUM}"'" disk.img | sed -n "s/^First sector: \([0-9]*\).*/\1/p")
    [ -n "${start}" ] || { echo "error: no partition '"${EPHEMERAL_PARTNUM}"' in the GPT" >&2; exit 1; }
    dd if=disk.img of=eph.img bs=512 skip="${start}" count='"$(( MOS_VAR_MIB * 2048 ))"' status=none
    mkdir -p /mnt/eph
    # debugfs, not mount: a loop mount needs privileges this container does not
    # have, and the journal is only being read.
    # rdump writes INTO an existing directory. Without the mkdir it fails, and
    # the check below then reports "no /var/log/journal in the EPHEMERAL
    # partition" -- a statement about the guest, for a mistake in the reader.
    mkdir -p /w/journal
    debugfs -R "rdump /log/journal /w/journal" eph.img >/dev/null 2>&1 || true
    if [ -z "$(ls -A /w/journal 2>/dev/null)" ]; then
        echo "error: no /var/log/journal in the EPHEMERAL partition. Either the guest never got that far, or journald was configured to keep logs in memory only" >&2
        exit 1
    fi
    args="$(cat /w/args | tr "\n" " ")"
    # shellcheck disable=SC2086
    journalctl -D /w/journal/journal --no-pager ${args}
'
