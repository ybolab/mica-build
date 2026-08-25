#!/usr/bin/env bash
# Check a board layout against the board-definition schema.
#
#   bash os/layout/lint.sh                 every os/layout/*-v2.env
#   bash os/layout/lint.sh <file> [...]    the named ones
#
# WHY THIS EXISTS. A board is defined by its layout file, and the shared build
# and verification scripts read that definition rather than knowing any board's
# shape. That only holds if the definition is complete and honest, and neither
# is self-evident: a missing key makes a shared script fail somewhere far from
# the omission, and a key a board CANNOT honour reads as a policy nobody
# implements.
#
# The second failure is the one that has actually happened. os/layout/x64-v2.env
# declared BOOT_ATTEMPTS_DEFAULT=3, BOOT_ATTEMPTS_MIN and BOOT_ATTEMPTS_MAX
# under a comment asserting that grub keeps attempt counters "where U-Boot keeps
# them in its redundant environment; the CONTRACT is identical". It is not:
# RAUC's grub backend has no attempt counter and REFUSES a configuration that
# sets one. Nothing in the tree objected. The image built, shipped, booted, and
# rauc.service exited 1 with "Configuring boot attempts is valid for uboot or
# barebox only", taking the health gate and the status indicator down with it.
#
# So this checks BOTH directions: every key a role requires is present, and no
# key a role does not use is present. Only the second one would have caught it.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The counters live in a FILE, not in shell variables.
#
# Each layout is linted in a subshell so that sourcing two of them cannot let
# the first board's keys satisfy the second board's checks. A subshell also
# discards every variable it sets -- so the first version of this script
# printed FAIL lines and then reported "RESULT: PASS (0/0 checks)", which is
# the exact failure mode the linter exists to catch, in the linter. Counting
# through a file is what makes the summary a function of what was observed
# rather than of where it was observed.
COUNT_FILE="$(mktemp)"
trap 'rm -f "${COUNT_FILE}"' EXIT
printf '0 0\n' >"${COUNT_FILE}"

bump() {
    local p f
    read -r p f <"${COUNT_FILE}"
    case "$1" in
    pass) p=$((p + 1)) ;;
    fail) f=$((f + 1)) ;;
    esac
    printf '%s %s\n' "${p}" "${f}" >"${COUNT_FILE}"
}
pass() { bump pass; echo "PASS: $*"; }
fail() { bump fail; echo "FAIL: $*" >&2; }

# Keys every partition carries, whatever its role.
COMMON_KEYS="PARTNUM LABEL GUID TYPECODE"

# Per role: the keys it REQUIRES, and the keys it FORBIDS. A key in neither
# list is unconstrained -- placement keys (_START_MIB, _START_SECTOR,
# _SIZE_MIB, _OFFSET_BYTES) differ legitimately between a fixed-start
# partition and one whose offset is derived, and pinning them here would
# encode the arrangement this file exists to stop encoding.
role_required() {
    case "$1" in
    raw-blob) echo "START_SECTOR SIZE_SECTORS MAGIC_HEX" ;;
    uboot-env) echo "OFFSET_BYTES" ;;
    esp) echo "FAT_LABEL FAT_VOLUME_ID" ;;
    verity-slot) echo "" ;;
    ext4) echo "FS_LABEL FS_UUID" ;;
    *) return 1 ;;
    esac
}

# What a role must NOT declare, because it cannot honour it. Asserting the
# absence is the half that catches a board claiming a capability it lacks.
role_forbidden() {
    case "$1" in
    raw-blob | uboot-env) echo "FS_LABEL FS_UUID FAT_LABEL FAT_VOLUME_ID" ;;
    esp) echo "FS_LABEL FS_UUID MAGIC_HEX" ;;
    verity-slot) echo "FS_LABEL FS_UUID FAT_LABEL FAT_VOLUME_ID MAGIC_HEX" ;;
    ext4) echo "FAT_LABEL FAT_VOLUME_ID MAGIC_HEX" ;;
    *) return 1 ;;
    esac
}

KNOWN_ROLES="raw-blob uboot-env esp verity-slot ext4"

lint_one() {
    local env_file="$1" board
    board="$(basename "${env_file}")"

    # Each file in its own subshell: sourcing two layouts into one process
    # would let the first board's keys satisfy the second board's checks, and
    # every one of them would pass for the wrong reason.
    (
        # shellcheck disable=SC1090
        . "${env_file}"

        if [ -z "${LAYOUT_PARTITIONS:-}" ]; then
            fail "${board}: declares no LAYOUT_PARTITIONS. Shared scripts would have to enumerate the partitions themselves, which is what this key exists to stop"
            exit 1
        fi

        local n=0 seen_nums="" name role val key
        for name in ${LAYOUT_PARTITIONS}; do
            n=$((n + 1))

            for key in ${COMMON_KEYS}; do
                eval "val=\${${name}_${key}:-}"
                [ -n "${val}" ] ||
                    fail "${board}: ${name} declares no ${name}_${key}; every partition carries the common core whatever its role"
            done

            eval "role=\${${name}_ROLE:-}"
            if [ -z "${role}" ]; then
                fail "${board}: ${name} declares no ${name}_ROLE, so nothing can decide which assertions apply to it"
                continue
            fi
            if ! role_required "${role}" >/dev/null 2>&1; then
                fail "${board}: ${name}_ROLE is '${role}', which is not one of: ${KNOWN_ROLES}"
                continue
            fi

            for key in $(role_required "${role}"); do
                eval "val=\${${name}_${key}:-}"
                [ -n "${val}" ] ||
                    fail "${board}: ${name} is role ${role} and declares no ${name}_${key}"
            done
            for key in $(role_forbidden "${role}"); do
                eval "val=\${${name}_${key}:-}"
                [ -z "${val}" ] &&
                    continue
                fail "${board}: ${name} is role ${role} and declares ${name}_${key}=${val}, which that role cannot honour. A constant nobody reads is how a board comes to claim a capability it does not have"
            done

            # One fact, three units. A board may spell a start as MiB, as a
            # sector and as a byte offset; cx3576 does, as three independent
            # literals, and three literals can disagree. Checked rather than
            # trusted -- and only when both forms are present, so a board that
            # declares one is not forced to declare the others.
            local mib sect off
            eval "mib=\${${name}_START_MIB:-}"
            eval "sect=\${${name}_START_SECTOR:-}"
            eval "off=\${${name}_OFFSET_BYTES:-}"
            if [ -n "${mib}" ] && [ -n "${sect}" ] &&
                [ "${sect}" -ne $((mib * MIB_BYTES / SECTOR_SIZE)) ]; then
                fail "${board}: ${name}_START_MIB=${mib} and ${name}_START_SECTOR=${sect} disagree; ${mib} MiB is $((mib * MIB_BYTES / SECTOR_SIZE)) sectors"
            fi
            if [ -n "${mib}" ] && [ -n "${off}" ] &&
                [ "${off}" -ne $((mib * MIB_BYTES)) ]; then
                fail "${board}: ${name}_START_MIB=${mib} and ${name}_OFFSET_BYTES=${off} disagree; ${mib} MiB is $((mib * MIB_BYTES)) bytes"
            fi

            eval "val=\${${name}_PARTNUM:-}"
            case " ${seen_nums} " in
            *" ${val} "*) fail "${board}: partition number ${val} is declared twice (${name})" ;;
            esac
            seen_nums="${seen_nums} ${val}"
        done

        # 1..N with no gaps. systemd-repart pairs definitions with partitions
        # IN ORDER, so a hole does not fail, it shifts every definition onto
        # the wrong partition -- see the comment in os/rootfs/build-v2.sh.
        local want=1 missing=""
        while [ "${want}" -le "${n}" ]; do
            case " ${seen_nums} " in
            *" ${want} "*) ;;
            *) missing="${missing} ${want}" ;;
            esac
            want=$((want + 1))
        done
        if [ -n "${missing}" ]; then
            fail "${board}: ${n} partitions declared but these numbers are absent:${missing}. Numbering must be 1..${n} with no gaps"
        else
            pass "${board}: ${n} partitions, numbered 1..${n}, no gaps and no duplicates"
        fi

        # The bootloader backend decides whether boot-attempts may be
        # declared at all. This is the check that would have caught the x64
        # layout before it reached a device.
        case "${RAUC_BOOTLOADER:-}" in
        uboot | barebox)
            [ -n "${BOOT_ATTEMPTS_DEFAULT:-}" ] ||
                fail "${board}: bootloader=${RAUC_BOOTLOADER} counts boot attempts but no BOOT_ATTEMPTS_DEFAULT is declared; a slot would be handed control with no credit to lose and rollback would never fire"
            ;;
        grub)
            [ -n "${RAUC_GRUBENV:-}" ] ||
                fail "${board}: bootloader=grub but no RAUC_GRUBENV; RAUC would have nowhere to read or write the A/B order"
            [ -z "${BOOT_ATTEMPTS_DEFAULT:-}" ] ||
                fail "${board}: bootloader=grub and BOOT_ATTEMPTS_DEFAULT=${BOOT_ATTEMPTS_DEFAULT}. RAUC refuses a grub configuration that sets boot attempts -- 'Configuring boot attempts is valid for uboot or barebox only' -- and the daemon exits 1"
            ;;
        "") fail "${board}: declares no RAUC_BOOTLOADER" ;;
        *) fail "${board}: RAUC_BOOTLOADER is '${RAUC_BOOTLOADER}'; this schema knows uboot, barebox and grub" ;;
        esac

        for key in BOARD_CMDLINE_ARGS BOARD_SIZE_BUDGET_MB BOARD_HAS_STATUS_LED MOS_ARCH; do
            eval "val=\${${key}:-}"
            [ -n "${val}" ] || fail "${board}: declares no ${key}"
        done
        case "${BOARD_HAS_STATUS_LED:-}" in
        0 | 1 | "") ;;
        *) fail "${board}: BOARD_HAS_STATUS_LED is '${BOARD_HAS_STATUS_LED}'; it must be 0 or 1" ;;
        esac

        exit 0
    ) || true
}

if [ "$#" -gt 0 ]; then
    FILES=("$@")
else
    FILES=("${HERE}"/*-v2.env)
fi

for f in "${FILES[@]}"; do
    [ -f "${f}" ] || { echo "error: ${f} not found" >&2; exit 1; }
    lint_one "${f}"
done

read -r PASS_N FAIL_N <"${COUNT_FILE}"
TOTAL=$((PASS_N + FAIL_N))
if [ "${TOTAL}" -eq 0 ]; then
    echo "error: the linter ran and made no assertions at all. A layout that is checked by nothing reports the same green as one that passes" >&2
    exit 1
fi
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${TOTAL} checks)"
    exit 0
fi
echo "RESULT: FAIL (${PASS_N}/${TOTAL} checks)" >&2
exit 1
