#!/usr/bin/env bash
# Renders the RAUC system configuration from the A/B-layout constants, and
# asserts that the U-Boot environment access file agrees with the GPT.
#
#   bash pkgs/rauc/render-config.sh          render the overlay file
#   bash pkgs/rauc/render-config.sh --check  verify the rendered file is current

# Output: rootfs/overlay/etc/rauc/system.conf, which the overlay
# mechanism copies into the image at /etc/rauc/system.conf. The rendered file
# is gitignored, never committed: the template plus boards/cx3576/board.env
# are the single source of truth, and a committed rendering could drift from
# them with nothing to notice until after the fact. rootfs/build.sh runs
# this renderer before staging the overlay; --check (run by the bundle builder,
# build/src/bundle.ts) guards the narrower case of the rendered file being
# edited by hand after the last build.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MOS_BOARD="${MOS_BOARD:-cx3576}"
LAYOUT_ENV="${REPO_ROOT}/boards/${MOS_BOARD}/board.env"
OVERLAY="${REPO_ROOT}/rootfs/overlay"
SYSTEM_CONF_IN="${SCRIPT_DIR}/system.conf.in"
SYSTEM_CONF_OUT="${SYSTEM_CONF_OUT:-${OVERLAY}/etc/rauc/system.conf}"
FSTAB_IN="${OVERLAY}/etc/fstab.in"
FW_ENV_IN="${OVERLAY}/etc/fw_env.config.in"

MODE="render"
case "${1:-}" in
    "") ;;
    --check) MODE="check" ;;
    *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac

if [ ! -f "${LAYOUT_ENV}" ]; then
    echo "error: ${LAYOUT_ENV} not found (MOS_BOARD=${MOS_BOARD})" >&2
    exit 1
fi
# shellcheck source=../../boards/cx3576/board.env
# Sourced BEFORE the input list is decided, because what is required depends on
# RAUC_BOOTLOADER, which the layout defines. Reading it first would have taken
# the `:-uboot` default on every board and demanded fw_env.config from a grub
# one -- silently, since a defaulted variable looks exactly like a set one.
. "${LAYOUT_ENV}"

if [ -z "${RAUC_BOOTLOADER:-}" ]; then
    echo "error: ${LAYOUT_ENV} sets no RAUC_BOOTLOADER. RAUC would be configured for a bootloader nobody chose, and the A/B handshake it drives is the mechanism that makes a bad update recoverable" >&2
    exit 1
fi

REQUIRED_INPUTS=("${SYSTEM_CONF_IN}" "${FSTAB_IN}")
# fw_env.config is U-Boot's environment access file. A grub board has none.
if [ "${RAUC_BOOTLOADER}" = "uboot" ]; then
    REQUIRED_INPUTS+=("${FW_ENV_IN}")
fi
for input in "${REQUIRED_INPUTS[@]}"; do
    if [ ! -f "${input}" ]; then
        echo "error: ${input} not found" >&2
        exit 1
    fi
done

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

# Values.

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

# Boot credits are a U-BOOT/BAREBOX concept, and RAUC enforces that: a
# configuration carrying boot-attempts with bootloader=grub is REJECTED, the
# daemon exits 1, and on the x64 image that took mos-health.service and
# mos-status-led.service down with it. grub's equivalent is a one-shot try
# (ORDER/<slot>_OK/<slot>_TRY in grubenv), which has no count to configure.
#
# So the two keys are rendered only for the backends that accept them, and a
# board that cannot honour a count must not declare one -- a layout constant
# nobody reads is how the wrong claim got in here in the first place.
case "${RAUC_BOOTLOADER}" in
uboot | barebox)
    if [ -z "${BOOT_ATTEMPTS_DEFAULT:-}" ]; then
        echo "error: ${LAYOUT_ENV} sets no BOOT_ATTEMPTS_DEFAULT, but bootloader=${RAUC_BOOTLOADER} counts boot attempts. Without it a slot would be handed control with no credit to lose and rollback would never fire" >&2
        exit 1
    fi
    # The radix trap (docs/design/uboot-ab-handshake.md section 4.1): assert
    # rather than trust, because an out-of-range value breaks rollback
    # silently.
    attempts="${BOOT_ATTEMPTS_DEFAULT}"
    if ! [[ "${attempts}" =~ ^[0-9]+$ ]] ||
        [ "${attempts}" -lt "${BOOT_ATTEMPTS_MIN}" ] ||
        [ "${attempts}" -gt "${BOOT_ATTEMPTS_MAX}" ]; then
        echo "error: boot-attempts value '${attempts}' is outside ${BOOT_ATTEMPTS_MIN}..${BOOT_ATTEMPTS_MAX}; RAUC writes this counter in hex and U-Boot compares it in decimal, so only single digits are safe" >&2
        exit 1
    fi
    BOOT_ATTEMPTS_LINE="boot-attempts=${attempts}"
    BOOT_ATTEMPTS_PRIMARY_LINE="boot-attempts-primary=${attempts}"
    ;;
*)
    if [ -n "${BOOT_ATTEMPTS_DEFAULT:-}" ]; then
        echo "error: ${LAYOUT_ENV} sets BOOT_ATTEMPTS_DEFAULT=${BOOT_ATTEMPTS_DEFAULT}, but bootloader=${RAUC_BOOTLOADER} does not count boot attempts. RAUC would refuse the rendered configuration outright ('Configuring boot attempts is valid for uboot or barebox only'), so remove the key rather than leave a number that reads as a policy nobody honours" >&2
        exit 1
    fi
    BOOT_ATTEMPTS_LINE=""
    BOOT_ATTEMPTS_PRIMARY_LINE=""
    ;;
esac

# /etc/fw_env.config assertions.
#
# The file itself is the overlay template, rendered into the image by
# rootfs/build.sh. This task owns its contract, so it is asserted here
# rather than duplicated into a second competing file: two device lines (which
# is what marks the environment redundant to libubootenv — configure only one
# side and every read from the other fails its CRC check), addressed by
# partition GUID at offset 0, each UENV_SIZE_BYTES long.
if [ "${RAUC_BOOTLOADER}" = "uboot" ]; then
    UENV_SIZE_HEX="$(printf '0x%x' "${UENV_SIZE_BYTES}")"
    fw_env_rendered="$(mktemp)"
    trap 'rm -f "${fw_env_rendered}"' EXIT
    render "${FW_ENV_IN}" "${fw_env_rendered}" \
        UENV_A_GUID "$(lower "${UENV_A_GUID}")" \
        UENV_B_GUID "$(lower "${UENV_B_GUID}")" \
        UENV_SIZE_HEX "${UENV_SIZE_HEX}"

    # `|| true` because a template rendering to NO device line at all must reach
    # the diagnostic below: a bare grep -v with zero surviving lines exits 1, and
    # under set -e that killed the run before the "needs exactly 2" message could
    # say what was wrong. The count is derived separately so an empty result reads
    # as 0 device lines rather than the 1 that `echo "" | wc -l` reports.
    fw_env_lines="$(grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' "${fw_env_rendered}" || true)"
    fw_env_count=0
    if [ -n "${fw_env_lines}" ]; then
        fw_env_count="$(echo "${fw_env_lines}" | wc -l)"
    fi
    if [ "${fw_env_count}" -ne 2 ]; then
        echo "error: ${FW_ENV_IN} renders to ${fw_env_count} device lines; the redundant U-Boot environment needs exactly 2" >&2
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
fi

# system.conf
rendered="$(mktemp)"
# ${fw_env_rendered:-} because the grub path never creates it, and an unset
# variable in a trap fails under `set -u` at exit -- after the render has
# already succeeded, so the script would report an error about a temp file
# while its actual output was correct.
trap 'rm -f "${fw_env_rendered:-}" "${rendered}"' EXIT
# grub keeps its A/B state in a grubenv file that RAUC rewrites with
# grub-editenv, the way the U-Boot backend rewrites the redundant environment.
# The path is where the ESP is mounted on the running system, not where it sits
# in the image: RAUC runs on the device.
case "${RAUC_BOOTLOADER}" in
uboot) BOOTLOADER_EXTRA="" ;;
grub)  BOOTLOADER_EXTRA="grubenv=${RAUC_GRUBENV:?RAUC_GRUBENV must be set for a grub board}" ;;
*)
    echo "error: RAUC_BOOTLOADER is '${RAUC_BOOTLOADER}'; this renderer knows uboot and grub. An unknown value would reach RAUC as a backend it does not implement, and the A/B handshake would not run at all" >&2
    exit 1
    ;;
esac

# The slot sections, built for THIS board's bootloader. See the comment at
# @SLOTS@ in the template for why the two shapes differ.
rootfs_slots() {
    cat <<SLOTS
[slot.rootfs.0]
device=/dev/disk/by-partuuid/$(lower "${ROOTFS_A_GUID}")
type=raw
bootname=A
# adaptive=block-hash-index — DEFERRED, see pkgs/rauc/manifest.raucm.in.

[slot.rootfs.1]
device=/dev/disk/by-partuuid/$(lower "${ROOTFS_B_GUID}")
type=raw
bootname=B
# adaptive=block-hash-index — DEFERRED, see pkgs/rauc/manifest.raucm.in.
SLOTS
}

# Both bootloaders have the same slot model: a rootfs pair and a
# boot-partition pair, each boot slot parented to its rootfs slot. The
# difference between the boards is which component selects the boot partition
# -- U-Boot from its own environment, the first-stage GRUB on the ESP from
# grubenv -- and that is not visible here.
#
# x64's boot pair is NOT its two ESPs: RAUC would install into the inactive
# one, which nothing mounts and the firmware never boots.
SLOTS_TEXT="$(
    rootfs_slots
    cat <<SLOTS

[slot.boot.0]
device=/dev/disk/by-partuuid/$(lower "${BOOT_A_GUID}")
type=vfat
parent=rootfs.0

[slot.boot.1]
device=/dev/disk/by-partuuid/$(lower "${BOOT_B_GUID}")
type=vfat
parent=rootfs.1
SLOTS
)"

# @SLOTS@ is a BLOCK, not a scalar, and render() substitutes with
# `sed s|@X@|value|`: a replacement containing newlines is a sed syntax error,
# not a multi-line substitution. So the block is spliced in by line first, and
# the scalar pass runs over the result -- which also keeps render()'s
# no-placeholder-left assertion meaningful for every other key.
slots_file="$(mktemp)"
templ_file="$(mktemp)"
trap 'rm -f "${slots_file}" "${templ_file}"' EXIT
printf '%s\n' "${SLOTS_TEXT}" >"${slots_file}"
awk -v f="${slots_file}" '
    $0 == "@SLOTS@" { while ((getline line < f) > 0) print line; next }
    { print }
' "${SYSTEM_CONF_IN}" >"${templ_file}"
if grep -q '^@SLOTS@$' "${templ_file}"; then
    echo "error: the @SLOTS@ line survived the block splice; the slot model would be missing from ${rendered}" >&2
    exit 1
fi

render "${templ_file}" "${rendered}" \
    COMPATIBLE "${COMPATIBLE}" \
    BOOTLOADER "${RAUC_BOOTLOADER}" \
    BOOTLOADER_EXTRA "${BOOTLOADER_EXTRA}" \
    STATUSFILE "${STATUSFILE}" \
    BOOT_ATTEMPTS_LINE "${BOOT_ATTEMPTS_LINE}" \
    BOOT_ATTEMPTS_PRIMARY_LINE "${BOOT_ATTEMPTS_PRIMARY_LINE}"

# RENUMBERING SAFETY. Every slot device must be addressed by PARTUUID. A
# /dev/mmcblk0pN path would encode a partition NUMBER, and the numbers shift
# whenever a partition is inserted ahead of the slots — as the loader partition
# just did. RAUC would then install an update over the running rootfs, with no
# error anywhere. The GUIDs cannot drift this way, so the shape is enforced here
# rather than left to review.
# Checked PER SLOT against its type, because a `file` slot's device IS a path
# and a blanket "everything must be a PARTUUID" rule would have to be deleted
# to let the grub boards through -- which would take the renumbering guard with
# it for the partition slots that still need it.
bad_devs="$(awk '
    /^\[slot\./ { type = ""; dev = ""; next }
    /^type=/     { type = substr($0, 6) }
    /^device=/   { dev  = substr($0, 8) }
    dev != "" && type != "" {
        if (type == "file") {
            if (dev !~ /^\//) print dev " (type=file, not an absolute path)"
        } else if (dev !~ /^\/dev\/disk\/by-partuuid\//) {
            print dev " (type=" type ", not addressed by PARTUUID)"
        }
        dev = ""
    }
' "${rendered}")"
if [ -n "${bad_devs}" ]; then
    echo "error: ${SYSTEM_CONF_IN} addresses a slot in a form its type does not allow:" >&2
    echo "${bad_devs}" >&2
    echo "A partition slot must be /dev/disk/by-partuuid/<guid>: a /dev/mmcblk0pN path encodes a partition NUMBER, and inserting a partition ahead of the slots renumbers it silently — RAUC would install over the running slot. A file slot must be an absolute path on a mounted filesystem." >&2
    exit 1
fi

# The loader partition must abut uenv-a. If it did not, the region between them
# would be covered by no partition entry, and systemd-repart discards exactly
# those regions — which is the failure the loader entry exists to prevent.
#
# U-Boot boards only: there is no loader partition on a UEFI board, because the
# firmware is in flash rather than at a fixed sector of the disk.
if [ "${RAUC_BOOTLOADER}" = "uboot" ] && \
   [ $((LOADER_START_SECTOR + LOADER_SIZE_SECTORS)) -ne "${UENV_A_START_SECTOR}" ]; then
    echo "error: the loader partition ends at sector $((LOADER_START_SECTOR + LOADER_SIZE_SECTORS)) but ${UENV_A_LABEL} starts at ${UENV_A_START_SECTOR}; the gap between them would be discarded on first boot" >&2
    exit 1
fi

if [ "${MODE}" = "check" ]; then
    # A fresh clone has no rendered file at all — the file is gitignored, not
    # committed. Diffing against a nonexistent path would report "stale", which
    # sends the reader hunting for drift that does not exist instead of at the
    # render step they have not run yet.
    if [ ! -f "${SYSTEM_CONF_OUT}" ]; then
        echo "error: ${SYSTEM_CONF_OUT} has not been rendered yet (it is generated, not committed)." >&2
        echo "Run 'bash pkgs/rauc/render-config.sh' — rootfs/build.sh does this automatically before staging the overlay." >&2
        exit 1
    fi
    if ! diff -u "${SYSTEM_CONF_OUT}" "${rendered}"; then
        echo "error: ${SYSTEM_CONF_OUT} is stale; re-run 'bash pkgs/rauc/render-config.sh'" >&2
        exit 1
    fi
    echo "rauc config current: ${SYSTEM_CONF_OUT}"
    exit 0
fi

mkdir -p "$(dirname "${SYSTEM_CONF_OUT}")"
cp "${rendered}" "${SYSTEM_CONF_OUT}"
chmod 0644 "${SYSTEM_CONF_OUT}"
echo "rendered ${SYSTEM_CONF_OUT} (compatible=${COMPATIBLE}, bootloader=${RAUC_BOOTLOADER}, statusfile=${STATUSFILE}, ${BOOT_ATTEMPTS_LINE:-boot-attempts: not applicable to ${RAUC_BOOTLOADER}})"
