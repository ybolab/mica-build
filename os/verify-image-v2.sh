#!/usr/bin/env bash
set -euo pipefail

# Verifies a cx3576 mos disk image against the layout-v2 image contract:
# the ten-partition A/B GPT, the raw uboot-mos blob, both FAT32 boot slots,
# the squashfs+dm-verity rootfs payload and the packed root filesystem's
# contents (mosd/webd, hwinit, RAUC, health gate, storage tiers).
# Emits one PASS:/FAIL: line per check and a final
# "RESULT: PASS|FAIL (n/m checks)" summary; exits non-zero if any check fails.
# Totals are dynamic (PASS_N/total); nothing to hand-bump when checks change.
#
# v1 (os/verify-image.sh) is untouched and keeps verifying the single-slot
# image; this is a sibling, not a rewrite.
#
# Every layout constant is read from os/layout/cx3576-v2.env. Nothing here
# restates a GUID, an offset or a size, and nothing here enumerates a unit list
# that the image itself can be asked for: the hwinit set grows, and a hardcoded
# list is how a newly added unit silently falls outside coverage.
#
# NO host mutation: no loop mounts, no losetup, no device-mapper, no mount(8).
# GPT is read with sgdisk, the FAT slots with mtools at an offset, the ext4
# partitions by dd-extracting them and reading them with debugfs/tune2fs, and
# the rootfs by dd-extracting the slot and running unsquashfs + `veritysetup
# verify` (a userspace hash-tree walk — it never opens a dm device). When the
# host lacks a required tool the whole verification re-executes inside an
# Alpine container, exactly as v1 and the assembler do.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
BOARD_DIR="${BOARD_DIR:-${REPO_ROOT}/board/cx3576}"
LAYOUT_ENV="${SCRIPT_DIR}/layout/cx3576-v2.env"

if [ ! -f "${LAYOUT_ENV}" ]; then
    echo "error: ${LAYOUT_ENV} not found" >&2
    exit 1
fi
# shellcheck source=layout/cx3576-v2.env
. "${LAYOUT_ENV}"

KERNEL_VERSION="6.1.115"

INNER=0
EXPECT_SYMLINK=0
IMG=""
while [ $# -gt 0 ]; do
    case "$1" in
    --inner) INNER=1 ;;
    --expect-symlink) EXPECT_SYMLINK=1 ;;
    *) IMG="$1" ;;
    esac
    shift
done
if [ -z "${IMG}" ]; then
    IMG="${REPO_ROOT}/_out/cx3576/${IMAGE_LATEST_NAME}"
    EXPECT_SYMLINK=1
fi

if [ ! -e "${IMG}" ]; then
    echo "error: image not found: ${IMG}" >&2
    exit 1
fi

# Re-exec in a container when the host lacks any required tool. unsquashfs,
# veritysetup and setcap/getcap are the v2 additions over v1's set.
REQUIRED_TOOLS=(sgdisk mdir mcopy mlabel debugfs tune2fs dumpe2fs e2fsck cmp
    unsquashfs veritysetup getcap setcap)
if [ "${INNER}" -eq 0 ]; then
    missing=0
    for tool in "${REQUIRED_TOOLS[@]}"; do
        command -v "${tool}" >/dev/null 2>&1 || missing=1
    done
    if [ "${missing}" -eq 1 ]; then
        echo "required tools not all available on the host; verifying in a container" >&2
        img_dir="$(cd "$(dirname "${IMG}")" && pwd)"
        img_base="$(basename "${IMG}")"
        mounts=(-v "${REPO_ROOT}:/work:ro")
        # Never let docker create BOARD_DIR on the host; mount an empty dir
        # instead so the compare checks fail cleanly.
        tmp_board=""
        if [ -d "${BOARD_DIR}" ]; then
            mounts+=(-v "${BOARD_DIR}:/board:ro")
        else
            tmp_board="$(mktemp -d)"
            mounts+=(-v "${tmp_board}:/board:ro")
        fi
        case "${img_dir}/" in
        "${REPO_ROOT}/"*)
            img_in="/work${img_dir#"${REPO_ROOT}"}/${img_base}"
            ;;
        *)
            mounts+=(-v "${img_dir}:/img:ro")
            img_in="/img/${img_base}"
            ;;
        esac
        inner_args=(--inner)
        if [ "${EXPECT_SYMLINK}" -eq 1 ]; then
            inner_args+=(--expect-symlink)
        fi
        inner_args+=("${img_in}")
        rc=0
        docker run --rm "${mounts[@]}" -e BOARD_DIR=/board alpine:3.21 \
            sh -c 'apk add --no-cache -q bash coreutils diffutils gptfdisk sgdisk dosfstools mtools e2fsprogs e2fsprogs-extra squashfs-tools cryptsetup libcap libcap-setcap && exec bash /work/os/verify-image-v2.sh "$@"' \
            _ "${inner_args[@]}" || rc=$?
        if [ -n "${tmp_board}" ]; then
            rmdir "${tmp_board}" 2>/dev/null || true
        fi
        exit "${rc}"
    fi
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
export MTOOLS_SKIP_CHECK=1

PASS_N=0
FAIL_N=0
pass() {
    PASS_N=$((PASS_N + 1))
    echo "PASS: $*"
}
fail() {
    FAIL_N=$((FAIL_N + 1))
    echo "FAIL: $*"
}

# GPT tooling prints GUIDs uppercase; udev/libblkid print the same GUIDs
# lowercase, and that is the spelling a kernel cmdline, an fstab entry and a
# RAUC device path must use. Both denote the same GUID, so every comparison in
# this script folds case first (the same rule os/mkimage-v2.sh states).
lc() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# Reads one KEY=value out of a plain env-style file without executing it.
env_file_get() {
    sed -n "s/^$2=//p" "$1" | tail -n1
}

# Compares two values case-insensitively and emits one PASS/FAIL line.
eq_ci() {
    local what="$1" got="$2" want="$3"
    if [ "$(lc "${got}")" = "$(lc "${want}")" ]; then
        pass "${what} is ${want}"
    else
        fail "${what} is '${got}', expected ${want}"
    fi
}

BYTES_PER_SECTOR="${SECTOR_SIZE}"
SECTORS_PER_MIB=$((MIB_BYTES / SECTOR_SIZE))

# --- check 0: default path must be the -latest symlink ---
if [ "${EXPECT_SYMLINK}" -eq 1 ]; then
    link_target="$(readlink "${IMG}" 2>/dev/null || true)"
    link_target="${link_target#./}"
    if [ -L "${IMG}" ] && [[ "${link_target}" =~ ^${IMAGE_NAME_PREFIX}[0-9]+\.img$ ]]; then
        pass "default path is a symlink to ${link_target}"
    else
        fail "default path must be a symlink to ${IMAGE_NAME_PREFIX}<epoch>${IMAGE_NAME_SUFFIX} in the same directory (got: ${link_target:-not a symlink})"
    fi
fi

# ===========================================================================
# 1. GPT
# ===========================================================================

verify_out="$(sgdisk --verify "${IMG}" 2>&1 || true)"
complaints="$(echo "${verify_out}" | grep -E "Caution|Warning" | grep -Ev "doesn't (begin|end) on a|degraded performance" || true)"
if echo "${verify_out}" | grep -q "No problems found" &&
    ! echo "${verify_out}" | grep -Eq "problems!|Problem:|Creating new GPT entries|invalid GPT|damaged GPT" &&
    [ -z "${complaints}" ]; then
    pass "sgdisk --verify reports no problems"
else
    fail "sgdisk --verify reported problems: $(echo "${verify_out}" | tr '\n' ' ')"
fi

ptable="$(sgdisk -p "${IMG}" 2>/dev/null || true)"
disk_guid="$(echo "${ptable}" | sed -n 's/^Disk identifier (GUID): //p')"
eq_ci "disk GUID" "${disk_guid}" "${DISK_GUID}"

EXPECT_PARTS=10
part_count="$(echo "${ptable}" | grep -cE '^[[:space:]]+[0-9]+[[:space:]]' || true)"
if [ "${part_count}" = "${EXPECT_PARTS}" ]; then
    pass "exactly ${EXPECT_PARTS} partitions"
else
    fail "found ${part_count} partitions, expected ${EXPECT_PARTS}"
fi

# Extract one field from sgdisk -i output.
sg_field() {
    echo "$1" | sed -n "s/^$2: //p" | head -n1
}

# Cache each partition's sgdisk -i output once; every check below reads it.
declare -a P_INFO
for n in $(seq 1 "${EXPECT_PARTS}"); do
    P_INFO[n]="$(sgdisk -i "${n}" "${IMG}" 2>&1 || true)"
done
p_field() {
    sg_field "${P_INFO[$1]}" "$2"
}

# The rootfs slot size is content-derived (see MOS_ROOTFS_SLOT_MIB in the layout
# env), so it is read out of the image rather than pinned here. Everything
# downstream of rootfs-b then follows from it.
slot_sectors="$(p_field "${ROOTFS_A_PARTNUM}" "Partition size" | awk '{print $1}')"
if [[ "${slot_sectors}" =~ ^[0-9]+$ ]] && [ "${slot_sectors}" -gt 0 ] &&
    [ $((slot_sectors % SECTORS_PER_MIB)) -eq 0 ]; then
    SLOT_MIB=$((slot_sectors / SECTORS_PER_MIB))
else
    SLOT_MIB=0
    slot_sectors=0
fi

rootfs_b_start_mib=$((ROOTFS_A_START_MIB + SLOT_MIB))
meta_start_mib=$((rootfs_b_start_mib + SLOT_MIB))
state_start_mib=$((meta_start_mib + META_SIZE_MIB))
ephemeral_start_mib=$((state_start_mib + STATE_SIZE_MIB))
data_start_mib=$((ephemeral_start_mib + MOS_VAR_MIB))
total_size_mib=$((data_start_mib + DATA_SIZE_MIB + IMAGE_TAIL_SLACK_MIB))

# num|label|typecode|guid|size-sectors|start-sector
part_rows=(
    "${UENV_A_PARTNUM}|${UENV_A_LABEL}|${UENV_A_TYPECODE}|${UENV_A_GUID}|${UENV_SIZE_SECTORS}|${UENV_A_START_SECTOR}"
    "${UENV_B_PARTNUM}|${UENV_B_LABEL}|${UENV_B_TYPECODE}|${UENV_B_GUID}|${UENV_SIZE_SECTORS}|${UENV_B_START_SECTOR}"
    "${BOOT_A_PARTNUM}|${BOOT_A_LABEL}|${BOOT_A_TYPECODE}|${BOOT_A_GUID}|$((BOOT_SIZE_MIB * SECTORS_PER_MIB))|${BOOT_A_START_SECTOR}"
    "${BOOT_B_PARTNUM}|${BOOT_B_LABEL}|${BOOT_B_TYPECODE}|${BOOT_B_GUID}|$((BOOT_SIZE_MIB * SECTORS_PER_MIB))|${BOOT_B_START_SECTOR}"
    "${ROOTFS_A_PARTNUM}|${ROOTFS_A_LABEL}|${ROOTFS_A_TYPECODE}|${ROOTFS_A_GUID}|${slot_sectors}|${ROOTFS_A_START_SECTOR}"
    "${ROOTFS_B_PARTNUM}|${ROOTFS_B_LABEL}|${ROOTFS_B_TYPECODE}|${ROOTFS_B_GUID}|${slot_sectors}|$((rootfs_b_start_mib * SECTORS_PER_MIB))"
    "${META_PARTNUM}|${META_LABEL}|${META_TYPECODE}|${META_GUID}|$((META_SIZE_MIB * SECTORS_PER_MIB))|$((meta_start_mib * SECTORS_PER_MIB))"
    "${STATE_PARTNUM}|${STATE_LABEL}|${STATE_TYPECODE}|${STATE_GUID}|$((STATE_SIZE_MIB * SECTORS_PER_MIB))|$((state_start_mib * SECTORS_PER_MIB))"
    "${EPHEMERAL_PARTNUM}|${EPHEMERAL_LABEL}|${EPHEMERAL_TYPECODE}|${EPHEMERAL_GUID}|$((MOS_VAR_MIB * SECTORS_PER_MIB))|$((ephemeral_start_mib * SECTORS_PER_MIB))"
    "${DATA_PARTNUM}|${DATA_LABEL}|${DATA_TYPECODE}|${DATA_GUID}|$((DATA_SIZE_MIB * SECTORS_PER_MIB))|$((data_start_mib * SECTORS_PER_MIB))"
)

for row in "${part_rows[@]}"; do
    IFS='|' read -r n label typecode guid want_size want_start <<<"${row}"

    got_label="$(p_field "${n}" "Partition name")"
    if [ "${got_label}" = "'${label}'" ]; then
        pass "p${n} PARTLABEL is '${label}'"
    else
        fail "p${n} PARTLABEL is ${got_label:-unreadable}, expected '${label}'"
    fi

    got_type="$(p_field "${n}" "Partition GUID code" | awk '{print $1}')"
    eq_ci "p${n} typecode" "${got_type}" "${typecode}"

    got_guid="$(p_field "${n}" "Partition unique GUID")"
    eq_ci "p${n} partition GUID" "${got_guid}" "${guid}"

    got_size="$(p_field "${n}" "Partition size" | awk '{print $1}')"
    if [ "${want_size}" -gt 0 ] && [ "${got_size}" = "${want_size}" ]; then
        pass "p${n} (${label}) size is ${want_size} sectors"
    else
        fail "p${n} (${label}) size is '${got_size}' sectors, expected ${want_size}"
    fi

    got_start="$(p_field "${n}" "First sector" | awk '{print $1}')"
    if [ "${want_start}" -gt 0 ] && [ "${got_start}" = "${want_start}" ]; then
        pass "p${n} (${label}) starts at sector ${want_start}"
    else
        fail "p${n} (${label}) starts at sector '${got_start}', expected ${want_start}"
    fi

    # v2 sets NO GPT attribute bits anywhere: the ESP typecode alone makes the
    # boot slots bootable to U-Boot, and the slot choice comes from the RAUC
    # BOOT_ORDER environment, never from a GPT flag.
    got_attrs="$(p_field "${n}" "Attribute flags")"
    if [[ "${got_attrs}" =~ ^0+$ ]]; then
        pass "p${n} (${label}) attribute flags are clear (${got_attrs})"
    else
        fail "p${n} (${label}) attribute flags are '${got_attrs}', expected all bits clear"
    fi
done

if [ "${SLOT_MIB}" -gt 0 ]; then
    pass "rootfs-a and rootfs-b are the same size (${SLOT_MIB} MiB each)"
else
    fail "rootfs-a size is not a positive whole-MiB multiple, so the A/B slots cannot be compared"
fi
if [ "${SLOT_MIB}" -ge "${MOS_ROOTFS_SLOT_MIB}" ]; then
    pass "rootfs slot ${SLOT_MIB} MiB is at or above the ${MOS_ROOTFS_SLOT_MIB} MiB layout floor"
else
    fail "rootfs slot ${SLOT_MIB} MiB is below the ${MOS_ROOTFS_SLOT_MIB} MiB layout floor"
fi

size_terms="${ROOTFS_A_START_MIB} + 2*${SLOT_MIB} + ${META_SIZE_MIB} + ${STATE_SIZE_MIB} + ${MOS_VAR_MIB} + ${DATA_SIZE_MIB} + ${IMAGE_TAIL_SLACK_MIB} MiB"
expected_size=$((total_size_mib * MIB_BYTES))
actual_size="$(stat -Lc %s "${IMG}" 2>/dev/null || echo 0)"
if [ "${SLOT_MIB}" -gt 0 ] && [ "${actual_size}" = "${expected_size}" ]; then
    pass "image size is ${expected_size} bytes / ${total_size_mib} MiB (${size_terms})"
else
    fail "image size is ${actual_size} bytes, expected ${expected_size} (${size_terms})"
fi

# DATA must be the LAST partition and must end exactly IMAGE_TAIL_SLACK_MIB
# short of the end of the image. That pairing is what systemd-repart needs in
# order to extend it to the end of the real medium on first boot.
data_last_sector="$(p_field "${DATA_PARTNUM}" "Last sector" | awk '{print $1}')"
want_data_last=$(((total_size_mib - IMAGE_TAIL_SLACK_MIB) * SECTORS_PER_MIB - 1))
last_part_start=0
for row in "${part_rows[@]}"; do
    IFS='|' read -r n _ _ _ _ start <<<"${row}"
    if [ "${start}" -gt "${last_part_start}" ]; then
        last_part_start="${start}"
        last_part_num="${n}"
    fi
done
if [ "${last_part_num}" = "${DATA_PARTNUM}" ] && [ "${data_last_sector}" = "${want_data_last}" ]; then
    pass "data is the last partition (p${DATA_PARTNUM}) and ends at sector ${want_data_last}, leaving the ${IMAGE_TAIL_SLACK_MIB} MiB repart tail"
else
    fail "data must be the last partition and end at sector ${want_data_last} (${IMAGE_TAIL_SLACK_MIB} MiB tail slack); it is p${last_part_num} ending at '${data_last_sector}'"
fi

# ===========================================================================
# 2. Raw pre-GPT area: the uboot-mos blob at sector 64
# ===========================================================================

UBOOT_SRC="${BOARD_DIR}/out/${UBOOT_VARIANT_DIR}/${UBOOT_BIN_NAME}"
UBOOT_DEBUG_SRC="${BOARD_DIR}/out/${UBOOT_DEBUG_VARIANT_DIR}/${UBOOT_BIN_NAME}"
UBOOT_OFFSET_BYTES=$((UBOOT_SEEK_SECTOR * BYTES_PER_SECTOR))

if [ ! -f "${UBOOT_SRC}" ]; then
    fail "u-boot compare source not found: ${UBOOT_SRC} (build it with 'make -C board/cx3576 uboot-mos')"
    uboot_size=0
else
    uboot_size="$(stat -c %s "${UBOOT_SRC}")"
    if dd if="${IMG}" skip="${UBOOT_OFFSET_BYTES}" count="${uboot_size}" iflag=skip_bytes,count_bytes status=none 2>/dev/null |
        cmp -s - "${UBOOT_SRC}"; then
        pass "u-boot at sector ${UBOOT_SEEK_SECTOR} matches the ${UBOOT_VARIANT_DIR} variant (${UBOOT_SRC})"
    else
        fail "u-boot at sector ${UBOOT_SEEK_SECTOR} differs from ${UBOOT_SRC}; a v2 image may only carry the ${UBOOT_VARIANT_DIR} variant"
    fi
fi

# Pairing guard. The debug variant boots and looks healthy but has
# CONFIG_ENV_IS_NOWHERE and no pinned bootmeth order, so the A/B handshake
# would silently never run. Asserting the image DIFFERS from it is what catches
# a debug blob copied into the uboot-mos directory.
if [ ! -f "${UBOOT_DEBUG_SRC}" ]; then
    fail "u-boot debug-variant compare source not found: ${UBOOT_DEBUG_SRC}; the ${UBOOT_VARIANT_DIR}/${UBOOT_DEBUG_VARIANT_DIR} pairing guard cannot be evaluated"
else
    debug_size="$(stat -c %s "${UBOOT_DEBUG_SRC}")"
    if dd if="${IMG}" skip="${UBOOT_OFFSET_BYTES}" count="${debug_size}" iflag=skip_bytes,count_bytes status=none 2>/dev/null |
        cmp -s - "${UBOOT_DEBUG_SRC}"; then
        fail "the blob at sector ${UBOOT_SEEK_SECTOR} is byte-identical to the DEBUG u-boot (${UBOOT_DEBUG_SRC}). A v2 image carrying it would boot, look healthy and never run the RAUC A/B handshake: no BOOT_ORDER, no attempt counters, no rollback. Rebuild with 'make -C board/cx3576 uboot-mos'"
    else
        pass "u-boot at sector ${UBOOT_SEEK_SECTOR} differs from the debug variant (${UBOOT_DEBUG_VARIANT_DIR}), so the A/B variant is paired correctly"
    fi
fi

if [ "${uboot_size}" -gt 0 ] && [ $((UBOOT_OFFSET_BYTES + uboot_size)) -le "${UENV_A_OFFSET_BYTES}" ] &&
    [ "${uboot_size}" -le "${UBOOT_MAX_BYTES}" ]; then
    pass "u-boot ends at $((UBOOT_OFFSET_BYTES + uboot_size)) bytes, below ${UENV_A_LABEL} at ${UENV_A_START_MIB} MiB"
else
    fail "u-boot (${uboot_size} bytes at offset ${UBOOT_OFFSET_BYTES}) reaches into ${UENV_A_LABEL} at ${UENV_A_OFFSET_BYTES} bytes / ${UENV_A_START_MIB} MiB"
fi

# ===========================================================================
# 3. Boot slots
# ===========================================================================

KERNEL_SRC="${BOARD_DIR}/out/kernel/Image"
DTB_SRC="${BOARD_DIR}/out/kernel/rk3576-src.dtb"

BOOT_A_IMG="${IMG}@@${BOOT_A_OFFSET_BYTES}"
BOOT_B_IMG="${IMG}@@${BOOT_B_OFFSET_BYTES}"

# Args: slot-letter fat-image offset-bytes fat-label volume-id verity-env-name
check_boot_slot() {
    local slot="$1" fatimg="$2" offset="$3" want_label="$4" want_volid="$5" verity_env="$6"

    local sig
    sig="$(dd if="${IMG}" skip=$((offset + 82)) count=5 iflag=skip_bytes,count_bytes status=none 2>/dev/null || true)"
    if [ "${sig}" = "FAT32" ]; then
        pass "BOOT-${slot} has a FAT32 boot sector signature at $((offset / MIB_BYTES)) MiB"
    else
        fail "BOOT-${slot} FAT32 signature not found at offset $((offset / MIB_BYTES)) MiB + 82"
    fi

    local volid
    volid="$(minfo -i "${fatimg}" 2>/dev/null | sed -n 's/^serial number: //p' | tr -d ' ' || true)"
    # FACTORY ONLY. mkfs.vfat --invariant gives a bundle's boot.vfat the default
    # volume id 1234ABCD, so an updated slot legitimately differs. Nothing
    # resolves a boot slot by volume id, and RAUC writes partition CONTENTS
    # without touching the GPT, so the PARTLABEL and partition GUID (asserted
    # above) survive an install and remain the real identity.
    eq_ci "factory: BOOT-${slot} FAT volume id" "${volid}" "${want_volid}"

    # FACTORY ONLY, same reason as the volume id: a RAUC-installed boot slot
    # gets the neutral label "BOOT". Nothing addresses a boot slot by label
    # (boot.scr uses "mmc 0:${bootpart}"), so this is a factory-assembly
    # assertion, not a runtime contract. Relaxing it belongs in a future
    # --post-update mode, not here.
    local label
    label="$(mlabel -s -i "${fatimg}" :: 2>/dev/null | sed -n 's/^ *Volume label is //p' | sed 's/ *$//' || true)"
    if [ "${label}" = "${want_label}" ]; then
        pass "factory: BOOT-${slot} FAT volume label is '${want_label}' (an updated slot legitimately reads 'BOOT')"
    else
        fail "factory: BOOT-${slot} FAT volume label is '${label}', expected '${want_label}' on a factory image"
    fi

    local listing
    listing="$(mdir -/ -b -i "${fatimg}" ::/ 2>/dev/null || true)"
    if [ -z "${listing}" ]; then
        fail "BOOT-${slot} FAT filesystem unreadable (cannot list files)"
    fi
    local f
    for f in Image rk3576-src.dtb "${BOOT_SCRIPT_NAME}" "${verity_env}"; do
        if echo "${listing}" | grep -qxF "::/${f}"; then
            pass "BOOT-${slot} contains ${f}"
        else
            fail "BOOT-${slot} is missing ${f}"
        fi
    done

    # THE assertion that keeps the A/B handshake reachable. Both U-Boot boot
    # frameworks try extlinux BEFORE boot.scr, so an extlinux config in a v2
    # boot slot silently bypasses the entire handshake: BOOT_ORDER is never
    # consulted, the attempt counters are never decremented and rollback never
    # happens. There is no error on the console — just a device that boots one
    # slot forever and cannot roll back.
    if echo "${listing}" | grep -qi "extlinux"; then
        fail "BOOT-${slot} contains extlinux ($(echo "${listing}" | grep -i extlinux | tr '\n' ' ')). Both U-Boot boot frameworks try extlinux BEFORE boot.scr, so this silently bypasses the whole RAUC A/B handshake: BOOT_ORDER is never honoured, boot attempts are never counted and rollback never happens, with no error anywhere. Remove it."
    else
        pass "BOOT-${slot} contains no extlinux/ directory and no extlinux.conf (a v2 slot must boot via ${BOOT_SCRIPT_NAME})"
    fi

    if echo "${listing}" | grep -qi "initr"; then
        fail "BOOT-${slot} contains an initramfs/initrd file: $(echo "${listing}" | grep -i initr | tr '\n' ' ')"
    else
        pass "BOOT-${slot} contains no initramfs file"
    fi

    local out
    for f in Image rk3576-src.dtb; do
        out="${TMP}/boot-${slot}-${f}"
        local src
        if [ "${f}" = "Image" ]; then src="${KERNEL_SRC}"; else src="${DTB_SRC}"; fi
        if ! mcopy -n -i "${fatimg}" "::/${f}" "${out}" 2>/dev/null; then
            fail "BOOT-${slot} ${f} missing or unreadable"
        elif [ ! -f "${src}" ]; then
            fail "BOOT-${slot} ${f} compare source not found: ${src}"
        elif cmp -s "${out}" "${src}"; then
            pass "factory: BOOT-${slot} ${f} matches the local BSP artifact ${src}"
        else
            fail "factory: BOOT-${slot} ${f} differs from the local BSP artifact ${src}"
        fi
    done

    mcopy -n -i "${fatimg}" "::/${BOOT_SCRIPT_NAME}" "${TMP}/scr-${slot}" 2>/dev/null || true
    mcopy -n -i "${fatimg}" "::/${verity_env}" "${TMP}/verity-${slot}.env" 2>/dev/null || true
}

check_boot_slot A "${BOOT_A_IMG}" "${BOOT_A_OFFSET_BYTES}" "${BOOT_A_FAT_LABEL}" "${BOOT_A_FAT_VOLUME_ID}" "${BOOT_VERITY_ENV_A_NAME}"
check_boot_slot B "${BOOT_B_IMG}" "${BOOT_B_OFFSET_BYTES}" "${BOOT_B_FAT_LABEL}" "${BOOT_B_FAT_VOLUME_ID}" "${BOOT_VERITY_ENV_B_NAME}"

# boot.scr is deliberately identical in both slots: whichever copy U-Boot runs
# may boot either slot, so they must not diverge.
if [ -f "${TMP}/scr-A" ] && [ -f "${TMP}/scr-B" ] && cmp -s "${TMP}/scr-A" "${TMP}/scr-B"; then
    pass "factory: ${BOOT_SCRIPT_NAME} is byte-identical in BOOT-A and BOOT-B"
else
    fail "factory: ${BOOT_SCRIPT_NAME} differs between BOOT-A and BOOT-B (or is missing); the same script must be able to boot either slot"
fi

scr_magic="$(od -An -tx1 -N4 "${TMP}/scr-A" 2>/dev/null | tr -d ' \n' || true)"
if [ "${scr_magic}" = "27051956" ]; then
    pass "${BOOT_SCRIPT_NAME} carries the legacy uImage magic 27051956"
else
    fail "${BOOT_SCRIPT_NAME} magic is '${scr_magic}', expected 27051956 (mkimage -T script output)"
fi

# Each slot's verity env must point dm-verity at its OWN rootfs partition;
# swapping them would make an update verify the slot it just replaced.
verity_env_ok=1
for pair in "A:${ROOTFS_A_GUID}:${ROOTFS_B_GUID}" "B:${ROOTFS_B_GUID}:${ROOTFS_A_GUID}"; do
    IFS=':' read -r slot own other <<<"${pair}"
    body="$(cat "${TMP}/verity-${slot}.env" 2>/dev/null || true)"
    body_lc="$(lc "${body}")"
    if [ -z "${body}" ]; then
        fail "BOOT-${slot} ${BOOT_VERITY_ENV_NAME%.env}-$(lc "${slot}").env is missing or empty"
        verity_env_ok=0
    elif [ "${body_lc#*"$(lc "${own}")"}" != "${body_lc}" ] &&
        [ "${body_lc#*"$(lc "${other}")"}" = "${body_lc}" ]; then
        pass "BOOT-${slot} verity env references its own rootfs PARTUUID ${own} and not the other slot's"
    else
        fail "BOOT-${slot} verity env must reference PARTUUID ${own} (its own rootfs slot) and must not mention ${other}"
        verity_env_ok=0
    fi
done

# The two files are the same table over different partitions: rewriting A's
# PARTUUID to B's must reproduce B's file exactly. Anything else means the
# slots' verity parameters have drifted apart.
if [ "${verity_env_ok}" -eq 1 ]; then
    sed "s/$(lc "${ROOTFS_A_GUID}")/$(lc "${ROOTFS_B_GUID}")/g" "${TMP}/verity-A.env" >"${TMP}/verity-A-as-B.env"
    if cmp -s "${TMP}/verity-A-as-B.env" "${TMP}/verity-B.env"; then
        pass "the A and B verity env files differ only in the rootfs PARTUUID"
    else
        fail "the A and B verity env files differ by more than the rootfs PARTUUID: $(diff "${TMP}/verity-A-as-B.env" "${TMP}/verity-B.env" | tr '\n' ' ')"
    fi
else
    fail "the A/B verity env comparison could not be made (a slot's verity env is missing or wrong)"
fi

# ===========================================================================
# 4. Verity / read-only invariants
# ===========================================================================

# Everything needed to verify the payload is taken from the image itself: the
# verity table the bootloader will hand the kernel. Verifying against that
# table (rather than against the build-time env file) is what makes this an
# end-to-end assertion — it proves the cmdline the device will actually boot
# with describes the bytes actually in the slot.
CREATE="$(sed -n 's/.*dm-mod\.create="\([^"]*\)".*/\1/p' "${TMP}/verity-A.env" 2>/dev/null || true)"
WAITFOR="$(sed -n 's/.*\(dm-mod\.waitfor=[^ ]*\).*/\1/p' "${TMP}/verity-A.env" 2>/dev/null || true)"

cmdline_hash=""
cmdline_salt=""
hash_offset=0
data_blocks=0
if [ -n "${CREATE}" ]; then
    # rootfs,,,ro,0 <sectors> verity 1 <data> <hash> <dbs> <hbs> <blocks> <hash_start> <algo> <root_hash> <salt>
    cmdline_hash="$(echo "${CREATE}" | awk '{print $(NF-1)}')"
    cmdline_salt="$(echo "${CREATE}" | awk '{print $NF}')"
    hash_block_size="$(echo "${CREATE}" | awk '{print $8}')"
    data_blocks="$(echo "${CREATE}" | awk '{print $9}')"
    hash_start_block="$(echo "${CREATE}" | awk '{print $10}')"
    if [[ "${hash_start_block}" =~ ^[0-9]+$ ]] && [[ "${hash_block_size}" =~ ^[0-9]+$ ]]; then
        hash_offset=$((hash_start_block * hash_block_size))
    fi
fi

ROOTFS_A_IMG="${TMP}/rootfs-a.img"
if [ "${SLOT_MIB}" -gt 0 ]; then
    dd if="${IMG}" of="${ROOTFS_A_IMG}" bs=1M skip="${ROOTFS_A_START_MIB}" count="${SLOT_MIB}" \
        conv=sparse status=none 2>/dev/null || true
else
    : >"${ROOTFS_A_IMG}"
fi

# `veritysetup verify` walks the hash tree in USERSPACE. It never creates a
# device-mapper target, never calls losetup and never mounts anything, which is
# what makes this safe to run against the host.
if [ -z "${cmdline_hash}" ] || [ "${hash_offset}" -eq 0 ]; then
    fail "could not read a dm-mod.create= verity table out of BOOT-A, so the ROOTFS-A payload cannot be verified"
elif veritysetup verify "${ROOTFS_A_IMG}" "${ROOTFS_A_IMG}" "${cmdline_hash}" \
    --hash-offset="${hash_offset}" >"${TMP}/verity-verify.log" 2>&1; then
    pass "ROOTFS-A payload verifies against the root hash in BOOT-A's cmdline (${cmdline_hash})"
else
    fail "ROOTFS-A payload FAILED dm-verity verification against BOOT-A's root hash ${cmdline_hash}: $(tr '\n' ' ' <"${TMP}/verity-verify.log")"
fi

ROOTFS_VERITY_ENV="${REPO_ROOT}/_out/cx3576/rootfs-verity.env"
if [ ! -f "${ROOTFS_VERITY_ENV}" ]; then
    fail "verity parameter file not found: ${ROOTFS_VERITY_ENV} (produce it with os/rootfs/build-v2.sh)"
else
    # FACTORY ONLY: after an update, ROOTFS-A may hold a different release than
    # the rootfs-verity.env sitting in the local _out/ tree.
    eq_ci "factory: root hash in BOOT-A's cmdline vs the locally built rootfs-verity.env" "${cmdline_hash}" "$(env_file_get "${ROOTFS_VERITY_ENV}" VERITY_ROOT_HASH)"
fi

eq_ci "verity salt on the cmdline" "${cmdline_salt}" "${VERITY_SALT}"

# dm_init_init() runs at late_initcall and its wait_for_device_probe() does not
# cover eMMC card discovery, so without this the verity table is assembled
# before the partitions exist. The boot then fails INTERMITTENTLY rather than
# cleanly, which is the hardest class of bug to find later.
if [ -n "${WAITFOR}" ]; then
    pass "the kernel cmdline carries ${WAITFOR} (required on ${KERNEL_VERSION}: dm-init runs at late_initcall and does not wait for eMMC discovery)"
else
    fail "the kernel cmdline carries NO dm-mod.waitfor=. It is REQUIRED on kernel ${KERNEL_VERSION}, not optional: dm_init_init() runs at late_initcall and wait_for_device_probe() does not cover eMMC card discovery, so verity assembly races the eMMC probe and boot becomes flaky rather than broken"
fi

# squashfs superblock: magic 'hsqs', compression id at offset 20 (6 == zstd).
sq_magic="$(dd if="${ROOTFS_A_IMG}" bs=1 count=4 status=none 2>/dev/null | tr -d '\0' || true)"
if [ "${sq_magic}" = "hsqs" ]; then
    pass "ROOTFS-A starts with the squashfs magic 'hsqs'"
else
    fail "ROOTFS-A does not start with the squashfs magic 'hsqs' (got '${sq_magic}')"
fi
sq_comp="$(od -An -tu2 -j20 -N2 "${ROOTFS_A_IMG}" 2>/dev/null | tr -d ' \n' || true)"
if [ "${sq_comp}" = "6" ]; then
    pass "ROOTFS-A squashfs compressor id is 6 (zstd)"
else
    fail "ROOTFS-A squashfs compressor id is '${sq_comp}', expected 6 (zstd)"
fi

# An ext4 superblock here would mean a writable root got packed into the slot.
ext4_magic="$(od -An -tx2 -j$((1024 + 56)) -N2 "${ROOTFS_A_IMG}" 2>/dev/null | tr -d ' \n' || true)"
if [ "${ext4_magic}" != "ef53" ]; then
    pass "ROOTFS-A carries no ext4 superblock (magic at 1024+56 is 0x${ext4_magic:-????}, not 0xef53)"
else
    fail "ROOTFS-A carries an ext4 superblock; the v2 root must be a read-only squashfs, not a writable filesystem"
fi

# Read-only by design, asserted in two independent places: the dm table's own
# read-only flag, and the root arguments boot.scr builds around it.
if [ -n "${CREATE}" ] && echo "${CREATE}" | grep -q '^rootfs,,,ro,'; then
    pass "the dm-verity table is created read-only (rootfs,,,ro,...), so the root cannot be written by design"
else
    fail "the dm-verity table is not marked read-only; expected a table beginning 'rootfs,,,ro,' (got '${CREATE}')"
fi
# boot.scr is a uImage-wrapped text script, so the root arguments it assembles
# are readable straight out of it.
if [ -f "${TMP}/scr-A" ] &&
    grep -aq 'root=/dev/dm-0' "${TMP}/scr-A" &&
    grep -aq 'rootfstype=squashfs' "${TMP}/scr-A" &&
    grep -aqE 'rootfstype=squashfs ro( |$)' "${TMP}/scr-A"; then
    pass "${BOOT_SCRIPT_NAME} boots root=/dev/dm-0 rootfstype=squashfs ro (read-only squashfs root)"
else
    fail "${BOOT_SCRIPT_NAME} does not set 'root=/dev/dm-0 rootfstype=squashfs ro'; the v2 root must be mounted read-only from the verity device"
fi

# ROOTFS-B is zero-filled at build: the first update is what fills it.
rootfs_b_nonzero="$(dd if="${IMG}" bs=1M skip="${rootfs_b_start_mib}" count="${SLOT_MIB}" status=none 2>/dev/null | tr -d '\0' | wc -c || echo -1)"
if [ "${SLOT_MIB}" -gt 0 ] && [ "${rootfs_b_nonzero}" = "0" ]; then
    pass "factory: ROOTFS-B is entirely zero (${SLOT_MIB} MiB; the first update fills it)"
else
    fail "factory: ROOTFS-B contains ${rootfs_b_nonzero} non-zero bytes, expected none"
fi

# ===========================================================================
# 5. The U-Boot environment pair is zero-filled at build
# ===========================================================================

for pair in "A:${UENV_A_OFFSET_BYTES}" "B:${UENV_B_OFFSET_BYTES}"; do
    IFS=':' read -r slot offset <<<"${pair}"
    nonzero="$(dd if="${IMG}" skip="${offset}" count="${UENV_SIZE_BYTES}" iflag=skip_bytes,count_bytes status=none 2>/dev/null | tr -d '\0' | wc -c || echo -1)"
    if [ "${nonzero}" = "0" ]; then
        pass "factory: UENV-${slot} is entirely zero ($((UENV_SIZE_BYTES / 1024)) KiB at ${offset} bytes; U-Boot populates it on first boot)"
    else
        fail "factory: UENV-${slot} contains ${nonzero} non-zero bytes, expected none"
    fi
done

# ===========================================================================
# 6. META / STATE / EPHEMERAL / DATA
# ===========================================================================

# Args: name start-mib size-mib fs-label fs-uuid
check_ext4() {
    local name="$1" start_mib="$2" size_mib="$3" want_label="$4" want_uuid="$5"
    local img="${TMP}/${name}.img"
    dd if="${IMG}" of="${img}" bs=1M skip="${start_mib}" count="${size_mib}" conv=sparse status=none 2>/dev/null || true

    local info label uuid
    info="$(tune2fs -l "${img}" 2>/dev/null || true)"
    label="$(echo "${info}" | sed -n 's/^Filesystem volume name:[[:space:]]*//p')"
    if [ "${label}" = "${want_label}" ]; then
        pass "${name} ext4 label is '${want_label}'"
    else
        fail "${name} ext4 label is '${label}', expected '${want_label}'"
    fi
    uuid="$(echo "${info}" | sed -n 's/^Filesystem UUID:[[:space:]]*//p')"
    eq_ci "${name} ext4 UUID" "${uuid}" "${want_uuid}"

    # orphan_file cannot be mounted by kernel 6.1, so its presence would make
    # the partition unusable on the device this image is built for.
    if echo "${info}" | sed -n 's/^Filesystem features:[[:space:]]*//p' | grep -qw "orphan_file"; then
        fail "${name} ext4 has the orphan_file feature; kernel ${KERNEL_VERSION} cannot mount it"
    else
        pass "${name} ext4 has no orphan_file feature"
    fi

    local header block_count block_size fs_bytes want_bytes
    header="$(dumpe2fs -h "${img}" 2>/dev/null || true)"
    block_count="$(echo "${header}" | sed -n 's/^Block count:[[:space:]]*//p')"
    block_size="$(echo "${header}" | sed -n 's/^Block size:[[:space:]]*//p')"
    fs_bytes=$((${block_count:-0} * ${block_size:-0}))
    want_bytes=$((size_mib * MIB_BYTES))
    if [ "${fs_bytes}" -gt 0 ] && [ "${fs_bytes}" -eq "${want_bytes}" ]; then
        pass "${name} ext4 fills its partition (${block_count} blocks x ${block_size} bytes = ${size_mib} MiB)"
    else
        fail "${name} ext4 is ${fs_bytes} bytes, expected ${want_bytes} (the partition size)"
    fi

    if e2fsck -fn "${img}" >/dev/null 2>&1; then
        pass "e2fsck -fn on ${name} is clean"
    else
        fail "e2fsck -fn on ${name} reported errors"
    fi

    # Created empty at build: the seed oneshots populate them on first boot.
    local entries
    entries="$(debugfs -R "ls -p /" "${img}" 2>/dev/null |
        awk -F/ 'NF >= 7 && $6 != "." && $6 != ".." && $6 != "lost+found" {print $6}' || true)"
    if [ -z "${entries}" ]; then
        pass "factory: ${name} is empty at build (nothing but lost+found)"
    else
        fail "factory: ${name} is not empty at build; it contains: $(echo "${entries}" | tr '\n' ' ')"
    fi
}

check_ext4 meta "${meta_start_mib}" "${META_SIZE_MIB}" "${META_FS_LABEL}" "${META_FS_UUID}"
check_ext4 state "${state_start_mib}" "${STATE_SIZE_MIB}" "${STATE_FS_LABEL}" "${STATE_FS_UUID}"
check_ext4 ephemeral "${ephemeral_start_mib}" "${MOS_VAR_MIB}" "${EPHEMERAL_FS_LABEL}" "${EPHEMERAL_FS_UUID}"
check_ext4 data "${data_start_mib}" "${DATA_SIZE_MIB}" "${DATA_FS_LABEL}" "${DATA_FS_UUID}"

# ===========================================================================
# 7. Packed root filesystem contents
# ===========================================================================

# Extract once; every content check below is then a plain read of the extracted
# tree. -xattrs is required for the file-capability assertion further down.
ROOT="${TMP}/root"
if unsquashfs -n -xattrs -d "${ROOT}" "${ROOTFS_A_IMG}" >"${TMP}/unsquashfs.log" 2>&1; then
    pass "ROOTFS-A squashfs unpacks cleanly"
else
    fail "ROOTFS-A squashfs failed to unpack: $(tail -n 3 "${TMP}/unsquashfs.log" | tr '\n' ' ')"
fi

# Assert a path in the packed root is a regular file.
sq_regular() {
    if [ -f "${ROOT}$1" ] && [ ! -L "${ROOT}$1" ]; then
        pass "${1} is a regular file"
    else
        fail "${1} missing or not a regular file"
    fi
}

# Assert a path is a symlink whose target ends in the given basename.
sq_symlink() {
    local path="$1" target="$2" dest
    if [ -L "${ROOT}${path}" ]; then
        dest="$(readlink "${ROOT}${path}")"
        case "${dest}" in
        "${target}" | */"${target}")
            pass "${path} is a symlink to ${dest}"
            return
            ;;
        esac
        fail "${path} is a symlink to '${dest}', expected ${target}"
    else
        fail "${path} missing or not a symlink"
    fi
}

# Assert a unit is enabled, i.e. some *.wants directory links to it. The wants
# directory is not named by the caller: units land in multi-user.target.wants,
# local-fs.target.wants or timers.target.wants depending on what they do.
sq_enabled() {
    local unit="$1" found
    found="$(find "${ROOT}/etc/systemd/system" -name "${unit}" -path '*.wants/*' 2>/dev/null | head -n1)"
    if [ -n "${found}" ]; then
        pass "${unit} is enabled (${found#"${ROOT}"})"
    else
        fail "${unit} enablement symlink missing (no *.wants entry under /etc/systemd/system)"
    fi
}

# Assert a file in the packed root matches an extended regex.
sq_grep() {
    local path="$1" pattern="$2" what="$3"
    if [ -f "${ROOT}${path}" ] && grep -Eq "${pattern}" "${ROOT}${path}"; then
        pass "${what}"
    else
        fail "${what} — ${path} missing or does not match /${pattern}/"
    fi
}

# --- kernel modules and firmware (carried over from v1) ---
modules_entries="$(ls "${ROOT}/usr/lib/modules" 2>/dev/null || true)"
if [ "${modules_entries}" = "${KERNEL_VERSION}" ]; then
    pass "/usr/lib/modules contains exactly ${KERNEL_VERSION}"
else
    fail "/usr/lib/modules entries: '$(echo "${modules_entries}" | tr '\n' ' ')', expected exactly ${KERNEL_VERSION}"
fi
sq_regular /usr/lib/firmware/fw_bcm43752a2_ag.bin
sq_regular /usr/lib/firmware/nvram_ap6275s.txt
sq_regular /usr/lib/firmware/clm_bcm43752a2_ag.blob
sq_regular /usr/lib/systemd/systemd
sq_symlink /usr/lib/firmware/fw_bcmdhd.bin fw_bcm43752a2_ag.bin
sq_symlink /usr/lib/firmware/nvram.txt nvram_ap6275s.txt
sq_symlink /usr/lib/firmware/clm_bcmdhd.blob clm_bcm43752a2_ag.blob

# --- base services (carried over from v1) ---
sq_enabled ssh.service
if [ -n "$(find "${ROOT}/etc/systemd/system" -name 'systemd-networkd.service' -path '*.wants/*' 2>/dev/null)" ] ||
    [ -e "${ROOT}/etc/systemd/system/dbus-org.freedesktop.network1.service" ]; then
    pass "systemd-networkd is enabled"
else
    fail "systemd-networkd enablement symlink missing"
fi
sq_grep /etc/systemd/network/80-dhcp.network 'DHCP=yes' "/etc/systemd/network/80-dhcp.network has DHCP=yes"
sq_grep /etc/systemd/journald.conf.d/00-volatile.conf '^Storage=volatile$' \
    "journald is Storage=volatile (the journal never lands on the fixed-size /var)"

# --- mosd (carried over from v1) ---
elf_is_aarch64() {
    local head
    head="$(od -An -tx1 -N20 "${ROOT}$1" 2>/dev/null | tr -d ' \n' || true)"
    # ELF magic 7f454c46; e_machine at offset 18 is 0xB7 (aarch64, LE).
    if [ "${head:0:8}" = "7f454c46" ] && [ "${head:36:4}" = "b700" ]; then
        pass "$1 is an aarch64 ELF"
    else
        fail "$1 is not an aarch64 ELF (header: '${head:0:40}')"
    fi
}
sq_regular /usr/bin/mosd
elf_is_aarch64 /usr/bin/mosd
sq_grep /usr/lib/systemd/system/mosd.service 'BusName=com.mos.mosd' \
    "/usr/lib/systemd/system/mosd.service has BusName=com.mos.mosd"
sq_enabled mosd.service
sq_regular /usr/share/dbus-1/system.d/com.mos.mosd.conf

# --- webd (carried over from v1) ---
sq_regular /usr/bin/webd
elf_is_aarch64 /usr/bin/webd
sq_grep /usr/lib/systemd/system/webd.service 'After=.*mosd\.service' \
    "/usr/lib/systemd/system/webd.service orders After= mosd.service"
sq_grep /usr/lib/systemd/system/webd.service 'StateDirectory=mos/webd' \
    "/usr/lib/systemd/system/webd.service has StateDirectory=mos/webd"
sq_enabled webd.service

# --- board hardware init (carried over from v1; the unit set is ENUMERATED) ---
sq_grep /etc/mos/modules.conf 'bcmdhd' "/etc/mos/modules.conf lists bcmdhd"
sq_grep /etc/mos/modules.conf 'aic8800_fdrv' "/etc/mos/modules.conf lists aic8800_fdrv"
sq_grep /etc/mos/modules.conf '^aic8800_btlpm$' "/etc/mos/modules.conf lists aic8800_btlpm (BT core of the combo chip)"
for c in otg can bt mac gadget health; do
    sq_regular "/etc/mos/${c}.conf"
done

# The board facts are READ, never restated: os/verify-image.sh already asserts
# their values against board/cx3576/init, which is the user's area. Here we
# only assert that each unit that exists is also enabled.
hw_units="$(cd "${ROOT}/usr/lib/systemd/system" 2>/dev/null && ls mos-*.service 2>/dev/null || true)"
if [ -z "${hw_units}" ]; then
    fail "no mos-*.service units found in /usr/lib/systemd/system"
else
    pass "found $(echo "${hw_units}" | wc -w) mos-*.service unit(s) in the image: $(echo "${hw_units}" | tr '\n' ' ')"
    # ENUMERATED, never hardcoded: the hwinit set grows (mos-mac and mos-gadget
    # were added and silently shipped disabled once already), and a hardcoded
    # list is exactly how the next added unit falls outside coverage.
    not_enabled=""
    for u in ${hw_units}; do
        if [ -z "$(find "${ROOT}/etc/systemd/system" -name "${u}" -path '*.wants/*' 2>/dev/null | head -n1)" ]; then
            not_enabled="${not_enabled} ${u}"
        fi
    done
    if [ -z "${not_enabled}" ]; then
        pass "every mos-*.service present in the image is also enabled"
    else
        fail "these mos-*.service units are installed but NOT enabled:${not_enabled}"
    fi
fi
# The hwinit helper scripts are enumerated the same way, from os/hwinit/.
hw_helpers="$(cd "${ROOT}/usr/lib/mos" 2>/dev/null && ls hwinit-* 2>/dev/null || true)"
if [ -n "${hw_helpers}" ]; then
    pass "hwinit helpers present in /usr/lib/mos: $(echo "${hw_helpers}" | tr '\n' ' ')"
else
    fail "no hwinit-* helpers found in /usr/lib/mos"
fi
sq_regular /usr/lib/udev/rules.d/60-mos-gadget-getty.rules
sq_grep /usr/lib/udev/rules.d/60-mos-gadget-getty.rules 'serial-getty@ttyGS0\.service' \
    "the udev rule pulls in serial-getty@ttyGS0 when the gadget enumerates"
sq_regular /usr/bin/btattach
sq_symlink /usr/lib/firmware/brcm/BCM4362A2.hcd SYN43756B0.hcd
if [ -f "${ROOT}/etc/bluetooth/main.conf" ] && grep -qE "^[[:space:]]*Name[[:space:]]*=" "${ROOT}/etc/bluetooth/main.conf"; then
    fail "/etc/bluetooth/main.conf pins Name (blocks the hostname plugin)"
else
    pass "/etc/bluetooth/main.conf leaves Name to the hostname plugin"
fi
sq_enabled bluetooth.service
if [ -e "${ROOT}/etc/modules-load.d/wifi.conf" ]; then
    fail "/etc/modules-load.d/wifi.conf still present (superseded by mos-modules)"
else
    pass "/etc/modules-load.d/wifi.conf is gone (superseded by mos-modules)"
fi

# --- M4: RAUC ---
sq_regular /usr/bin/rauc
sq_regular /usr/bin/fw_setenv
sq_regular /usr/bin/fw_printenv
sq_regular /etc/rauc/system.conf

RAUC_CONF="${ROOT}/etc/rauc/system.conf"
# The slot devices must be the layout's rootfs and boot partitions, addressed
# by PARTUUID. A wrong GUID here installs an update over the running slot.
rauc_slots_ok=1
for pair in "rootfs.0:${ROOTFS_A_GUID}" "rootfs.1:${ROOTFS_B_GUID}" "boot.0:${BOOT_A_GUID}" "boot.1:${BOOT_B_GUID}"; do
    IFS=':' read -r slot guid <<<"${pair}"
    got="$(awk -v s="[slot.${slot}]" '$0 == s {f = 1; next} /^\[/ {f = 0} f && /^device=/ {sub(/^device=/, ""); print; exit}' "${RAUC_CONF}" 2>/dev/null || true)"
    if [ "$(lc "${got}")" != "/dev/disk/by-partuuid/$(lc "${guid}")" ]; then
        rauc_slots_ok=0
        bad_slot="${slot} -> '${got}' (expected /dev/disk/by-partuuid/$(lc "${guid}"))"
    fi
done
if [ "${rauc_slots_ok}" -eq 1 ]; then
    pass "RAUC system.conf addresses all four slots by the layout's partition GUIDs"
else
    fail "RAUC system.conf slot device mismatch: ${bad_slot}"
fi

# WIPE-SAFETY CONTRACT. RAUC's status file is update state — which slot was
# installed and whether it was marked good. /var is DISCARDABLE by design, so
# putting it there would make "wipe /var" quietly destroy update bookkeeping.
statusfile="$(sed -n 's/^statusfile=//p' "${RAUC_CONF}" 2>/dev/null | tail -n1 || true)"
status_mount=""
case "${statusfile}" in
/mnt/meta/*) status_mount="META" ;;
/mnt/state/*) status_mount="STATE" ;;
esac
if [ -n "${status_mount}" ]; then
    pass "RAUC statusfile '${statusfile}' resolves onto ${status_mount}, not /var (wipe-safety contract)"
else
    fail "RAUC statusfile is '${statusfile}'; update state must live on META or STATE, never on the discardable /var"
fi
# The keyring is deliberately NOT shipped and NOT committed: a development
# keyring would be a trusted signer on every device. Only the path is asserted;
# its absence is correct, and `rauc install` fails closed until one is added.
sq_grep /etc/rauc/system.conf '^path=/etc/rauc/keyring\.pem$' \
    "RAUC keyring path is /etc/rauc/keyring.pem (the keyring itself is deliberately not shipped)"

# --- M4 integration: RAUC must be able to identify the BOOTED slot ---
#
# os/health/mos-health reads RAUC_SYSTEM_BOOTED_SLOT out of
# `rauc status --output-format=shell` and exits 0 early when it is empty. If
# rauc can never identify the booted slot the gate silently no-ops forever:
# `rauc status mark-good` is never reached, the installed slot is never
# confirmed, and U-Boot rolls back once the boot credits are spent. A health
# gate that always passes is worse than none, so the preconditions are checked
# here rather than assumed.
#
# rauc 1.8 get_cmdline_bootname() (src/context.c) reads /proc/cmdline and takes
# the FIRST of: `rauc.external`, `rauc.slot=<x>`, barebox bootstate (n/a for
# bootloader=uboot), then `root=<x>`. determine_slot_states() (src/install.c)
# then matches that string against each slot's bootname, its slot name, or
# realpath(device) -- and errors with "Did not find booted slot" if none match.
#
# A v2 image boots `root=/dev/dm-0`, the verity device. That is not a bootname
# ("A"/"B"), not a slot name ("rootfs.0"/"rootfs.1"), and not the realpath of
# any slot device (/dev/mmcblk0pN), so the root= fallback CANNOT work here and
# `rauc.slot=` is required. This is a property of the boot path, not of RAUC.
sq_grep /etc/rauc/system.conf '^bootloader=uboot$' \
    "RAUC system.conf selects the uboot bootloader backend"
if [ "$(grep -c '^bootname=[AB]$' "${RAUC_CONF}" 2>/dev/null || true)" = "2" ]; then
    pass "RAUC system.conf gives both rootfs slots a bootname (A and B), so a booted slot can be named at all"
else
    fail "RAUC system.conf must give both rootfs slots a bootname=A / bootname=B; without one, rauc has no bootable slot group"
fi

# The effective cmdline is assembled by boot.scr from its own rootargs plus the
# per-slot verity env, so either may legitimately carry rauc.slot=.
for pair in "A:${ROOTFS_A_GUID}" "B:${ROOTFS_B_GUID}"; do
    IFS=':' read -r slot guid <<<"${pair}"
    cmdline_src="$(cat "${TMP}/scr-A" "${TMP}/verity-${slot}.env" 2>/dev/null | tr -d '\0' || true)"
    root_arg="$(printf '%s' "${cmdline_src}" | grep -ao 'root=[^ "]*' | head -n1 || true)"
    if printf '%s' "${cmdline_src}" | grep -aqE "rauc\.slot=(\\\$\{bootslot\}|${slot})"; then
        pass "slot ${slot}: the boot path sets rauc.slot=, so rauc can identify the booted slot"
    elif [ "$(lc "${root_arg}")" = "root=partuuid=$(lc "${guid}")" ]; then
        pass "slot ${slot}: root= names the slot's own PARTUUID, so rauc's root= fallback identifies the booted slot"
    else
        fail "slot ${slot}: the boot path sets neither rauc.slot= nor a root= naming the slot device (found '${root_arg:-none}'). rauc 1.8 derives the booted slot from rauc.slot= or root= and matches it against bootname / slot name / realpath(device); '${root_arg:-none}' matches none of those, so \`rauc status\` fails with \"Did not find booted slot\", RAUC_SYSTEM_BOOTED_SLOT is never emitted, mos-health exits 0 without ever running \`rauc status mark-good\`, and every update rolls back when the boot credits run out. Fix belongs in the boot path (os/boot/cx3576-boot.cmd), NOT here"
    fi
done

# The variable the shipped health gate parses must be one rauc actually emits.
# Verified empirically against rauc 1.8 (the version the Debian bookworm
# allowlist installs) driving THIS system.conf: with a slot matching the booted
# root device, `rauc status --output-format=shell` emits
#
#   RAUC_SYSTEM_COMPATIBLE, RAUC_SYSTEM_VARIANT,
#   RAUC_SYSTEM_BOOTED_BOOTNAME, RAUC_SYSTEM_SLOTS
#
# and per-slot RAUC_SLOT_STATE_n (the booted one reads 'booted'). There is NO
# RAUC_SYSTEM_BOOTED_SLOT in the output under any configuration, so a gate that
# greps for it always reads empty and always exits 0 without reaching
# `rauc status mark-good` -- independently of the rauc.slot= problem above.
if [ ! -f "${ROOT}/usr/lib/mos/mos-health" ]; then
    fail "/usr/lib/mos/mos-health missing, so its RAUC status parsing cannot be checked"
elif grep -q 'RAUC_SYSTEM_BOOTED_SLOT' "${ROOT}/usr/lib/mos/mos-health"; then
    fail "mos-health parses RAUC_SYSTEM_BOOTED_SLOT, which rauc 1.8 NEVER emits. \`rauc status --output-format=shell\` emits RAUC_SYSTEM_BOOTED_BOOTNAME (plus per-slot RAUC_SLOT_STATE_n='booted'); verified against rauc 1.8 driving this exact system.conf. The gate therefore always reads an empty slot, always exits 0 and never reaches \`rauc status mark-good\`, so every update rolls back. Fix belongs in os/health/mos-health, NOT here"
else
    pass "mos-health does not depend on the non-existent RAUC_SYSTEM_BOOTED_SLOT variable"
fi

# --- M4 integration: webd's health probe needs an HTTP client ---
# mos-health probe c calls curl (or wget) against https://127.0.0.1/healthz and
# logs "SKIP (no curl or wget in the image)" when neither exists -- a silent
# hole in the gate. curl was added to the rootfs allowlist deliberately (commit
# 4c1180c, "ship curl in the v2 rootfs so the webd health probe stops
# skipping"), so its absence is now a regression, not a neutral fact.
http_client=""
for c in /usr/bin/curl /usr/bin/wget /bin/curl /bin/wget; do
    if [ -f "${ROOT}${c}" ]; then
        http_client="${c}"
        break
    fi
done
if [ -n "${http_client}" ]; then
    pass "webd health probe is LIVE: ${http_client} is in the image (mos-health probe c would SKIP without an HTTP client)"
else
    fail "no curl or wget in the image, so mos-health probe c degrades to 'SKIP (no curl or wget in the image)' and webd is never actually probed by the health gate"
fi

# --- M4: U-Boot environment access from Linux ---
sq_regular /etc/fw_env.config
fwenv="${ROOT}/etc/fw_env.config"
fwenv_lines="$(grep -cE '^/dev/' "${fwenv}" 2>/dev/null || echo 0)"
if [ "${fwenv_lines}" = "2" ]; then
    pass "/etc/fw_env.config has exactly two device lines (this is what marks the environment redundant to libubootenv)"
else
    fail "/etc/fw_env.config has ${fwenv_lines} device lines, expected 2; with only one side configured, every read from the other fails its CRC check"
fi
uenv_hex="$(printf '0x%x' "${UENV_SIZE_BYTES}")"
fwenv_ok=1
for guid in "${UENV_A_GUID}" "${UENV_B_GUID}"; do
    if ! grep -qiE "^/dev/disk/by-partuuid/$(lc "${guid}")[[:space:]]+0x0[[:space:]]+${uenv_hex}[[:space:]]*$" "${fwenv}" 2>/dev/null; then
        fwenv_ok=0
        bad_uenv="${guid}"
    fi
done
if [ "${fwenv_ok}" -eq 1 ]; then
    pass "/etc/fw_env.config addresses both UENV partitions at offset 0x0 with size ${uenv_hex}"
else
    fail "/etc/fw_env.config has no '/dev/disk/by-partuuid/$(lc "${bad_uenv}") 0x0 ${uenv_hex}' line"
fi

# --- M4: health gate and first-boot machine id ---
sq_regular /usr/lib/mos/mos-health
sq_regular /usr/lib/mos/mos-machine-id
sq_regular /usr/lib/systemd/system/mos-health.service
sq_regular /usr/lib/systemd/system/mos-machine-id.service
sq_enabled mos-health.service
sq_enabled mos-machine-id.service

# --- M4: storage tiers in /etc/fstab ---
FSTAB="${ROOT}/etc/fstab"
# Args: description partuuid mountpoint required-opts forbidden-opt
check_fstab() {
    local what="$1" guid="$2" mnt="$3" want="$4" forbid="${5:-}"
    local line
    line="$(awk -v d="PARTUUID=$(lc "${guid}")" -v m="${mnt}" '$1 == d && $2 == m {print; exit}' "${FSTAB}" 2>/dev/null || true)"
    if [ -z "${line}" ]; then
        fail "/etc/fstab has no ${mnt} entry for PARTUUID=$(lc "${guid}") (${what})"
        return
    fi
    local opts
    opts="$(echo "${line}" | awk '{print $4}')"
    local o
    for o in ${want//,/ }; do
        if [[ ",${opts}," != *",${o},"* ]]; then
            fail "/etc/fstab ${mnt} lacks the '${o}' option (${what}); options are '${opts}'"
            return
        fi
    done
    if [ -n "${forbid}" ] && [[ ",${opts}," == *",${forbid},"* ]]; then
        fail "/etc/fstab ${mnt} carries '${forbid}' but must not (${what}); options are '${opts}'"
        return
    fi
    pass "/etc/fstab mounts ${mnt} from PARTUUID=$(lc "${guid}") with ${opts} (${what})"
}
check_fstab "DATA is the growth target" "${DATA_GUID}" /srv "noatime,x-systemd.growfs"
check_fstab "STATE: configuration + identity, precious" "${STATE_GUID}" /mnt/state "noatime"
check_fstab "META: update metadata, precious" "${META_GUID}" /mnt/meta "noatime"
check_fstab "/var is fixed-size disposable residue, NOT a growth target" \
    "${EPHEMERAL_GUID}" /var "noatime" "x-systemd.growfs"
if awk '$1 == "tmpfs" && $2 == "/tmp" && $3 == "tmpfs"' "${FSTAB}" 2>/dev/null | grep -q .; then
    pass "/etc/fstab mounts /tmp as tmpfs"
else
    fail "/etc/fstab has no tmpfs /tmp entry"
fi
# The root is deliberately absent from fstab: the kernel assembles /dev/dm-0
# from the cmdline and mounts it read-only, so no entry could ever rewrite it.
if awk '$2 == "/" {found = 1} END {exit !found}' "${FSTAB}" 2>/dev/null; then
    fail "/etc/fstab has a / entry; the verity root is assembled from the cmdline and must not be remountable via fstab"
else
    pass "/etc/fstab has no / entry (the read-only verity root is assembled from the cmdline)"
fi
sq_enabled fstrim.timer

# --- M4: systemd-repart definitions ---
# repart pairs definitions with partitions by type UUID in DISK ORDER, so the
# count must match the number of linux-generic partitions exactly: one too few
# and the grow flag attaches to the wrong partition, one too many and repart
# CREATES a partition nobody asked for.
WANT_DEFS=8
def_count="$(find "${ROOT}/etc/repart.d" -name '*.conf' 2>/dev/null | wc -l)"
if [ "${def_count}" = "${WANT_DEFS}" ]; then
    pass "/etc/repart.d has exactly ${WANT_DEFS} definitions, one per linux-generic partition in disk order"
else
    fail "/etc/repart.d has ${def_count} definitions, expected ${WANT_DEFS}; repart matches definitions to partitions by type UUID in disk order, so a miscount silently attaches growth to the wrong partition"
fi
grow_defs="$(grep -l '^Weight=1000$' "${ROOT}/etc/repart.d/"*.conf 2>/dev/null || true)"
grow_n="$(echo "${grow_defs}" | grep -c . || true)"
if [ "${grow_n}" = "1" ] && [ "$(basename "${grow_defs}")" = "80-data.conf" ]; then
    pass "exactly one repart definition grows, and it is 80-data.conf (DATA / p${DATA_PARTNUM}), not ephemeral"
else
    fail "expected exactly one growing repart definition, 80-data.conf; found ${grow_n}: $(echo "${grow_defs}" | xargs -r -n1 basename | tr '\n' ' ')"
fi

# --- M4: wipe-safety — nothing precious is reachable only from /var ---
# This is the assertion that makes "/var is discardable" true rather than
# aspirational: identity, credentials and pairings must be binds onto STATE.
for pair in "var-lib-mos.mount:/var/lib/mos" "var-lib-bluetooth.mount:/var/lib/bluetooth"; do
    IFS=':' read -r unit where <<<"${pair}"
    f="${ROOT}/etc/systemd/system/${unit}"
    if [ ! -f "${f}" ]; then
        fail "${where} holds precious state but ${unit} does not exist; it would stay on the discardable /var"
    elif ! grep -qx "Where=${where}" "${f}"; then
        fail "${unit} does not mount ${where}"
    elif ! grep -qE '^What=/mnt/state/' "${f}"; then
        fail "${unit} is not backed by STATE (What= must be under /mnt/state)"
    elif [ -z "$(find "${ROOT}/etc/systemd/system" -name "${unit}" -path '*.wants/*' 2>/dev/null | head -n1)" ]; then
        fail "${unit} exists but is not enabled; ${where} would stay on the discardable /var"
    else
        pass "${where} is a STATE-backed bind via ${unit} (survives a /var wipe)"
    fi
done

# --- M4: /var fill-up containment ---
sq_grep /etc/tmpfiles.d/mos-var.conf '^[qQ] /var/tmp ' "tmpfiles.d ages /var/tmp (fixed-size /var cannot grow)"
sq_grep /etc/tmpfiles.d/mos-var.conf '^e /var/cache ' "tmpfiles.d ages /var/cache (regenerable by definition, nothing else reclaims it)"

# --- M4: squashfs xattr / file capabilities ---
# CONFIG_SQUASHFS_XATTR was enabled on the kernel side so a squashfs root does
# not silently drop file capabilities. What can be proven from the PACKED IMAGE
# is that the capability set survived packing intact, so first establish that
# this environment can observe a capability at all — otherwise an empty result
# is indistinguishable from a container that silently drops security.* xattrs,
# and the check would pass for the wrong reason.
: >"${TMP}/cap-probe"
if setcap cap_net_raw+ep "${TMP}/cap-probe" 2>/dev/null &&
    getcap "${TMP}/cap-probe" 2>/dev/null | grep -q cap_net_raw; then
    cap_observable=1
    pass "the verification environment can set and read security.capability, so a capability inventory taken here is trustworthy"
else
    cap_observable=0
    fail "the verification environment cannot round-trip a security.capability xattr, so no claim about capability preservation can be made here"
fi

# The source tree's inventory, captured by the Dockerfile before packing.
ROOTFS_REPORT="${REPO_ROOT}/_out/cx3576/rootfs-report-v2.txt"
if [ "${cap_observable}" -eq 0 ]; then
    fail "file-capability preservation not evaluated (the environment cannot observe capabilities)"
elif [ ! -f "${ROOTFS_REPORT}" ]; then
    fail "capability inventory not found: ${ROOTFS_REPORT} (produce it with os/rootfs/build-v2.sh)"
else
    # An empty capability set is a legitimate result, and both of these
    # pipelines exit non-zero when they match nothing, so neither may be
    # allowed to trip `set -o pipefail`.
    { sed -n '/^== file capabilities ==$/,/^== /p' "${ROOTFS_REPORT}" |
        grep -vE '^(==|$)' | sed 's/[[:space:]]*$//' | sort || true; } >"${TMP}/caps-src.txt"
    { getcap -r "${ROOT}" 2>/dev/null | sed "s|^${ROOT}||" | sed 's/[[:space:]]*$//' | sort || true; } >"${TMP}/caps-pkg.txt"
    src_n="$(grep -c . "${TMP}/caps-src.txt" || true)"
    if diff -q "${TMP}/caps-src.txt" "${TMP}/caps-pkg.txt" >/dev/null 2>&1; then
        if [ "${src_n}" = "0" ]; then
            # Reported honestly rather than dressed up as a preservation proof:
            # this rootfs's package set installs no file capabilities at all,
            # so there is nothing whose survival could be demonstrated. The
            # check is a tripwire for the day a cap-carrying package lands.
            pass "packed file-capability set matches the source inventory (both EMPTY: this rootfs carries no file capabilities, so xattr survival is NOT demonstrated by this image — see docs/task/RFCT-017.md)"
        else
            pass "all ${src_n} file capabilities survived packing into the squashfs (security.capability xattrs preserved)"
        fi
    else
        fail "file capabilities changed during packing; the squashfs must preserve security.capability: $(diff "${TMP}/caps-src.txt" "${TMP}/caps-pkg.txt" | tr '\n' ' ')"
    fi
fi

# ===========================================================================
# summary
# ===========================================================================
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} checks)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} checks)"
    exit 1
fi
