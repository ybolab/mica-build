#!/usr/bin/env bash
# Renders the RAUC system configuration from the layout-v2 constants, and
# asserts that the U-Boot environment access file agrees with the GPT.
#
#   bash os/rauc/render-config.sh            render (writes the overlay file)
#   bash os/rauc/render-config.sh --check    verify the committed file is current
#
# Output: os/rootfs/overlay-v2/etc/rauc/system.conf, which RFCT-013's overlay
# mechanism copies into the image at /etc/rauc/system.conf. The rendered file is
# committed so the image build needs no extra step; --check (run by
# os/bundle.sh) is what stops it from drifting away from the template or from
# os/layout/cx3576-v2.env.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
REPO_ROOT="$(dirname "${REPO_ROOT}")"
LAYOUT_ENV="${REPO_ROOT}/os/layout/cx3576-v2.env"
OVERLAY="${REPO_ROOT}/os/rootfs/overlay-v2"
# Overridable only so os/mkimage-v2-selftest.sh can drive the renderer against a
# deliberately-broken template; every real invocation uses the tree's own files.
SYSTEM_CONF_IN="${SYSTEM_CONF_IN:-${SCRIPT_DIR}/system.conf.in}"
SYSTEM_CONF_OUT="${SYSTEM_CONF_OUT:-${OVERLAY}/etc/rauc/system.conf}"
FSTAB_IN="${OVERLAY}/etc/fstab.in"
FW_ENV_IN="${OVERLAY}/etc/fw_env.config.in"

MODE="render"
case "${1:-}" in
    "") ;;
    --check) MODE="check" ;;
    *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac

for input in "${LAYOUT_ENV}" "${SYSTEM_CONF_IN}" "${FSTAB_IN}" "${FW_ENV_IN}"; do
    if [ ! -f "${input}" ]; then
        echo "error: ${input} not found" >&2
        exit 1
    fi
done
# shellcheck source=../layout/cx3576-v2.env
. "${LAYOUT_ENV}"

lower() { echo "$1" | tr 'A-Z' 'a-z'; }

# Substitutes @KEY@ placeholders and refuses to emit a file that still has one.
render() {
    local src="$1" dst="$2"
    shift 2
    local expr=()
    while [ "$#" -gt 0 ]; do
        expr+=(-e "s|@$1@|$2|g")
        shift 2
    done
    sed "${expr[@]}" "${src}" > "${dst}"
    if grep -q '@[A-Z_]\+@' "${dst}"; then
        echo "error: unrendered placeholder left in ${dst}:" >&2
        grep -n '@[A-Z_]\+@' "${dst}" >&2
        exit 1
    fi
}

# --- values ----------------------------------------------------------------

# The board family string RAUC matches a bundle against. Derived from the
# layout rather than spelled out, so one board file defines one compatible.
COMPATIBLE="mos-${LAYOUT_BOARD}"

# Where RAUC records slot status: on META, never on /var. /var is discardable
# by design, and slot status is update state — see the rationale in
# system.conf.in. The mount point is read out of the fstab template by matching
# the META partition GUID, so remounting META moves the status file with it
# instead of silently writing onto the read-only root.
META_MOUNT="$(awk -v guid="@META_GUID@" '$1 == "PARTUUID=" guid { print $2 }' "${FSTAB_IN}")"
if [ -z "${META_MOUNT}" ]; then
    echo "error: no META mount point found in ${FSTAB_IN}" >&2
    exit 1
fi
case "${META_MOUNT}" in
    /var|/var/*)
        echo "error: ${FSTAB_IN} mounts META at ${META_MOUNT}; RAUC's status file is update state and /var is discardable, so it must not live there" >&2
        exit 1
        ;;
esac
STATUSFILE="${META_MOUNT}/rauc.status"

# The radix trap (docs/design/uboot-ab-handshake.md section 4.1): assert rather
# than trust, because an out-of-range value breaks rollback silently.
for attempts in "${BOOT_ATTEMPTS_DEFAULT}"; do
    if ! [[ "${attempts}" =~ ^[0-9]+$ ]] ||
        [ "${attempts}" -lt "${BOOT_ATTEMPTS_MIN}" ] ||
        [ "${attempts}" -gt "${BOOT_ATTEMPTS_MAX}" ]; then
        echo "error: boot-attempts value '${attempts}' is outside ${BOOT_ATTEMPTS_MIN}..${BOOT_ATTEMPTS_MAX}; RAUC writes this counter in hex and U-Boot compares it in decimal, so only single digits are safe" >&2
        exit 1
    fi
done

# --- /etc/fw_env.config assertions -----------------------------------------
#
# The file itself is RFCT-013's overlay template, rendered into the image by
# os/rootfs/build-v2.sh. This task owns its contract, so it is asserted here
# rather than duplicated into a second competing file: two device lines (which
# is what marks the environment redundant to libubootenv — configure only one
# side and every read from the other fails its CRC check), addressed by
# partition GUID at offset 0, each UENV_SIZE_BYTES long.
UENV_SIZE_HEX="$(printf '0x%x' "${UENV_SIZE_BYTES}")"
fw_env_rendered="$(mktemp)"
trap 'rm -f "${fw_env_rendered}"' EXIT
render "${FW_ENV_IN}" "${fw_env_rendered}" \
    UENV_A_GUID "$(lower "${UENV_A_GUID}")" \
    UENV_B_GUID "$(lower "${UENV_B_GUID}")" \
    UENV_SIZE_HEX "${UENV_SIZE_HEX}"

fw_env_lines="$(grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' "${fw_env_rendered}")"
if [ "$(echo "${fw_env_lines}" | wc -l)" -ne 2 ]; then
    echo "error: ${FW_ENV_IN} renders to $(echo "${fw_env_lines}" | wc -l) device lines; the redundant U-Boot environment needs exactly 2" >&2
    exit 1
fi
assert_fw_env_line() {
    local want_dev="$1" line="$2"
    # shellcheck disable=SC2086 # deliberate word splitting into the three fields
    set -- ${line}
    if [ "$(lower "$1")" != "$(lower "${want_dev}")" ]; then
        echo "error: ${FW_ENV_IN} addresses '$1', expected '${want_dev}'" >&2
        exit 1
    fi
    if [ "$((${2}))" -ne 0 ]; then
        echo "error: ${FW_ENV_IN} uses offset '$2' for ${want_dev}; the pair is addressed per partition, so the offset must be 0" >&2
        exit 1
    fi
    if [ "$((${3}))" -ne "${UENV_SIZE_BYTES}" ]; then
        echo "error: ${FW_ENV_IN} declares env size '$3' for ${want_dev}, expected ${UENV_SIZE_HEX}" >&2
        exit 1
    fi
}
assert_fw_env_line "/dev/disk/by-partuuid/$(lower "${UENV_A_GUID}")" "$(echo "${fw_env_lines}" | sed -n 1p)"
assert_fw_env_line "/dev/disk/by-partuuid/$(lower "${UENV_B_GUID}")" "$(echo "${fw_env_lines}" | sed -n 2p)"

# Offset-0-per-partition is only the same bytes as U-Boot's absolute
# ENV_OFFSET/ENV_OFFSET_REDUND while the GPT starts p1/p2 exactly there. That
# is the drift this cross-check exists to catch.
for side in A B; do
    eval "start_sector=\${UENV_${side}_START_SECTOR}"
    eval "start_mib=\${UENV_${side}_START_MIB}"
    eval "offset=\${UENV_${side}_OFFSET_BYTES}"
    if [ "$((start_sector * SECTOR_SIZE))" -ne "${offset}" ] ||
        [ "$((start_mib * MIB_BYTES))" -ne "${offset}" ]; then
        echo "error: uenv-${side} starts at sector ${start_sector} (${start_mib} MiB) but UENV_${side}_OFFSET_BYTES is ${offset}; U-Boot's ENV_OFFSET would not point at the partition" >&2
        exit 1
    fi
done

# --- system.conf -----------------------------------------------------------
rendered="$(mktemp)"
trap 'rm -f "${fw_env_rendered}" "${rendered}"' EXIT
render "${SYSTEM_CONF_IN}" "${rendered}" \
    COMPATIBLE "${COMPATIBLE}" \
    STATUSFILE "${STATUSFILE}" \
    BOOT_ATTEMPTS "${BOOT_ATTEMPTS_DEFAULT}" \
    BOOT_ATTEMPTS_PRIMARY "${BOOT_ATTEMPTS_DEFAULT}" \
    BOOT_ATTEMPTS_MIN "${BOOT_ATTEMPTS_MIN}" \
    BOOT_ATTEMPTS_MAX "${BOOT_ATTEMPTS_MAX}" \
    ROOTFS_A_PARTUUID "$(lower "${ROOTFS_A_GUID}")" \
    ROOTFS_B_PARTUUID "$(lower "${ROOTFS_B_GUID}")" \
    BOOT_A_PARTUUID "$(lower "${BOOT_A_GUID}")" \
    BOOT_B_PARTUUID "$(lower "${BOOT_B_GUID}")"

# RENUMBERING SAFETY. Every slot device must be addressed by PARTUUID. A
# /dev/mmcblk0pN path would encode a partition NUMBER, and the numbers shift
# whenever a partition is inserted ahead of the slots — as the loader partition
# just did. RAUC would then install an update over the running rootfs, with no
# error anywhere. The GUIDs cannot drift this way, so the shape is enforced here
# rather than left to review.
bad_devs="$(grep '^device=' "${rendered}" | grep -v '^device=/dev/disk/by-partuuid/' || true)"
if [ -n "${bad_devs}" ]; then
    echo "error: ${SYSTEM_CONF_IN} addresses a slot by something other than a PARTUUID:" >&2
    echo "${bad_devs}" >&2
    echo "Slot devices must be /dev/disk/by-partuuid/<guid>. A /dev/mmcblk0pN path encodes a partition number, and inserting a partition ahead of the slots renumbers it silently — RAUC would install over the running slot." >&2
    exit 1
fi

# The loader partition must abut uenv-a. If it did not, the region between them
# would be covered by no partition entry, and systemd-repart discards exactly
# those regions — which is the failure the loader entry exists to prevent.
if [ $((LOADER_START_SECTOR + LOADER_SIZE_SECTORS)) -ne "${UENV_A_START_SECTOR}" ]; then
    echo "error: the loader partition ends at sector $((LOADER_START_SECTOR + LOADER_SIZE_SECTORS)) but ${UENV_A_LABEL} starts at ${UENV_A_START_SECTOR}; the gap between them would be discarded on first boot" >&2
    exit 1
fi

if [ "${MODE}" = "check" ]; then
    if ! diff -u "${SYSTEM_CONF_OUT}" "${rendered}"; then
        echo "error: ${SYSTEM_CONF_OUT} is stale; re-run 'bash os/rauc/render-config.sh'" >&2
        exit 1
    fi
    echo "rauc config current: ${SYSTEM_CONF_OUT}"
    exit 0
fi

mkdir -p "$(dirname "${SYSTEM_CONF_OUT}")"
cp "${rendered}" "${SYSTEM_CONF_OUT}"
chmod 0644 "${SYSTEM_CONF_OUT}"
echo "rendered ${SYSTEM_CONF_OUT} (compatible=${COMPATIBLE}, statusfile=${STATUSFILE}, boot-attempts=${BOOT_ATTEMPTS_DEFAULT})"
