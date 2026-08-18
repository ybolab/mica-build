#!/usr/bin/env bash
set -euo pipefail

# Assembles the flashable cx3576 (Rockchip RK3576, eMMC /dev/mmcblk0) A/B GPT
# disk image — layout v2, nine partitions: a redundant U-Boot env pair, two
# FAT32 boot slots, two raw squashfs+dm-verity rootfs slots and the
# meta/state/ephemeral ext4 partitions. Every layout constant comes from
# os/layout/cx3576-v2.env; nothing is duplicated here.
#
# v1 (os/mkimage.sh) is untouched and keeps building the single-slot image.
#
# The output filename carries the assembly-time epoch, but the image CONTENT is
# deterministic: fixed GPT GUIDs, fixed FAT volume ids, fixed ext4 fs UUIDs and
# hash seeds, E2FSPROGS_FAKE_TIME, and all staged files touched to FILE_MTIME.
# Known deviation (inherited from v1): the FAT partitions are byte-identical
# only across builds using the same mtools version, and rootfs-verity.img is
# only as reproducible as the pipeline that produced it.
#
# When the host lacks sgdisk/mkfs.vfat/mcopy or an mke2fs new enough to turn
# off orphan_file (e2fsprogs >= 1.47), the assembly runs inside an Alpine
# container (--assemble mode); epoch naming and the -latest symlink always
# happen on the host side.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
LAYOUT_ENV="${SCRIPT_DIR}/layout/cx3576-v2.env"

if [ ! -f "${LAYOUT_ENV}" ]; then
    echo "error: ${LAYOUT_ENV} not found" >&2
    exit 1
fi
# Two slot-sizing modes, distinguished by whether MOS_ROOTFS_SLOT_MIB was
# supplied from the environment at all — never by its value, so a release that
# legitimately pins the same number as the built-in default still gets the
# strict mode. The pin has to be captured here because sourcing the layout
# defaults would otherwise overwrite it.
if [ -n "${MOS_ROOTFS_SLOT_MIB+set}" ]; then
    ROOTFS_SLOT_PINNED=1
    _slot_pin="${MOS_ROOTFS_SLOT_MIB}"
else
    ROOTFS_SLOT_PINNED=0
    _slot_pin=""
fi
# shellcheck source=layout/cx3576-v2.env
. "${LAYOUT_ENV}"
if [ "${ROOTFS_SLOT_PINNED}" = 1 ]; then
    if ! [[ "${_slot_pin}" =~ ^[1-9][0-9]*$ ]]; then
        echo "error: MOS_ROOTFS_SLOT_MIB='${_slot_pin}' is not a positive whole number of MiB" >&2
        exit 1
    fi
    MOS_ROOTFS_SLOT_MIB="${_slot_pin}"
fi
export E2FSPROGS_FAKE_TIME

# The four rootfs-side inputs all come from the same producer; name it in every
# error message so a missing input is actionable.
ROOTFS_PRODUCER="os/rootfs/build-v2.sh"

# Reads one KEY=value out of a plain env-style file without executing it.
env_file_get() {
    sed -n "s/^$2=//p" "$1" | tail -n1
}

# Formats one partition slot's ext4 filesystem into a standalone image file.
# Args: out-file size-MiB fs-label fs-uuid
mkext4() {
    truncate -s "$2M" "$1"
    mke2fs -q -t ext4 -b "${EXT4_BLOCK_SIZE}" -L "$3" -U "$4" \
        -O "${EXT4_FEATURES}" -E "root_owner=0:0,hash_seed=$4" "$1"
}

# Stages one boot slot's FAT32 filesystem. Args: out-file fat-label volume-id
# cmdline-file
mkboot() {
    local stage="${workdir}/stage-$3"
    mkdir -p "${stage}/extlinux"
    cp "${KERNEL_IMAGE}" "${stage}/Image"
    cp "${DTB}" "${stage}/rk3576-src.dtb"
    local append
    append="$(tr -d '\n' < "$4")"
    if [ -z "${append}" ]; then
        echo "error: $4 is empty; regenerate it with ${ROOTFS_PRODUCER}" >&2
        exit 1
    fi
    cat > "${stage}/extlinux/extlinux.conf" <<EOF
default cx3576
timeout 3
label cx3576
    kernel /Image
    fdt /rk3576-src.dtb
    append ${append}
EOF
    find "${stage}" -exec touch -h -d "${FILE_MTIME}" {} +

    truncate -s "${BOOT_SIZE_MIB}M" "$1"
    mkfs.vfat --invariant -F 32 -n "$2" -i "$3" "$1" >/dev/null
    mcopy -s -m -i "$1" "${stage}"/* ::/
}

# Assembly, running either natively or inside the container. Inputs/output are
# taken from the environment: KERNEL_IMAGE, DTB, UBOOT, ROOTFS_VERITY_IMG,
# ROOTFS_VERITY_ENV, BOOT_CMDLINE_A, BOOT_CMDLINE_B, IMG_OUT.
assemble() {
    workdir="$(mktemp -d)"
    trap 'rm -rf "${workdir:-}"' EXIT

    for input in "${KERNEL_IMAGE}" "${DTB}" "${UBOOT}"; do
        if [ ! -f "${input}" ]; then
            echo "error: ${input} not found" >&2
            exit 1
        fi
    done
    for input in "${ROOTFS_VERITY_IMG}" "${ROOTFS_VERITY_ENV}" \
        "${BOOT_CMDLINE_A}" "${BOOT_CMDLINE_B}"; do
        if [ ! -f "${input}" ]; then
            echo "error: ${input} not found; produce it with '${ROOTFS_PRODUCER}'" >&2
            exit 1
        fi
    done

    if [ "$(stat -c %s "${UBOOT}")" -gt "${UBOOT_MAX_BYTES}" ]; then
        echo "error: ${UBOOT} does not fit between sector ${UBOOT_SEEK_SECTOR} and ${UENV_A_LABEL} at ${UENV_A_START_MIB} MiB" >&2
        exit 1
    fi

    # The verity image is written raw into a slot, so it must land on a whole
    # MiB boundary exactly as the v1 rootfs does.
    local verity_bytes verity_mib
    verity_bytes="$(stat -c %s "${ROOTFS_VERITY_IMG}")"
    if [ "${verity_bytes}" -eq 0 ] || [ $((verity_bytes % MIB_BYTES)) -ne 0 ]; then
        echo "error: ${ROOTFS_VERITY_IMG} is ${verity_bytes} bytes, not a non-zero whole-MiB multiple; fix ${ROOTFS_PRODUCER}" >&2
        exit 1
    fi
    verity_mib=$((verity_bytes / MIB_BYTES))

    local root_hash verity_salt
    root_hash="$(env_file_get "${ROOTFS_VERITY_ENV}" VERITY_ROOT_HASH)"
    verity_salt="$(env_file_get "${ROOTFS_VERITY_ENV}" VERITY_SALT)"
    if [ -z "${root_hash}" ]; then
        echo "error: VERITY_ROOT_HASH missing from ${ROOTFS_VERITY_ENV}; fix ${ROOTFS_PRODUCER}" >&2
        exit 1
    fi
    if [ "${verity_salt}" != "${VERITY_SALT}" ]; then
        echo "error: ${ROOTFS_VERITY_ENV} salt '${verity_salt}' does not match the pinned VERITY_SALT '${VERITY_SALT}'; fix ${ROOTFS_PRODUCER}" >&2
        exit 1
    fi

    # Slot sizing. Pinned: the geometry is FROZEN at the pin, and an oversized
    # rootfs is a build failure — growing the slot would move rootfs-b, meta,
    # state and ephemeral, producing a GPT that no already-flashed device can
    # accept and RAUC bundles that no longer fit the deployed slot. Unpinned
    # (dev path): the built-in default acts as a floor and the slot grows with
    # the content.
    local slot_mib mode
    if [ "${ROOTFS_SLOT_PINNED}" = 1 ]; then
        mode="pinned"
        slot_mib="${MOS_ROOTFS_SLOT_MIB}"
        if [ "${verity_mib}" -gt "${slot_mib}" ]; then
            echo "error: rootfs slot geometry is pinned at MOS_ROOTFS_SLOT_MIB=${slot_mib} MiB but ${ROOTFS_VERITY_IMG} is ${verity_mib} MiB — $((verity_mib - slot_mib)) MiB too large." >&2
            echo "The slot size is frozen for every device already flashed with this layout, so it cannot be grown: shrink the rootfs instead." >&2
            exit 1
        fi
    else
        mode="floor"
        slot_mib=$(((verity_mib * ROOTFS_SLOT_HEADROOM_PCT + 99) / 100))
        slot_mib=$(((slot_mib + ROOTFS_SLOT_ALIGN_MIB - 1) / ROOTFS_SLOT_ALIGN_MIB * ROOTFS_SLOT_ALIGN_MIB))
        if [ "${slot_mib}" -lt "${MOS_ROOTFS_SLOT_MIB}" ]; then
            slot_mib="${MOS_ROOTFS_SLOT_MIB}"
        fi
    fi

    local rootfs_b_start_mib meta_start_mib state_start_mib ephemeral_start_mib total_size_mib
    rootfs_b_start_mib=$((ROOTFS_A_START_MIB + slot_mib))
    meta_start_mib=$((rootfs_b_start_mib + slot_mib))
    state_start_mib=$((meta_start_mib + META_SIZE_MIB))
    ephemeral_start_mib=$((state_start_mib + STATE_SIZE_MIB))
    total_size_mib=$((ephemeral_start_mib + EPHEMERAL_SIZE_MIB + IMAGE_TAIL_SLACK_MIB))
    if [ "${mode}" = "pinned" ]; then
        echo "rootfs payload ${verity_mib} MiB -> rootfs slot ${slot_mib} MiB (pinned, frozen geometry); boot ${BOOT_SIZE_MIB}+${BOOT_SIZE_MIB} MiB; image ${total_size_mib} MiB"
    else
        echo "rootfs payload ${verity_mib} MiB -> rootfs slot ${slot_mib} MiB (floor ${MOS_ROOTFS_SLOT_MIB}, ${ROOTFS_SLOT_HEADROOM_PCT}% headroom, ${ROOTFS_SLOT_ALIGN_MIB} MiB aligned); boot ${BOOT_SIZE_MIB}+${BOOT_SIZE_MIB} MiB; image ${total_size_mib} MiB"
    fi
    echo "verity root hash ${root_hash}"

    mkboot "${workdir}/boot-a.img" "${BOOT_A_FAT_LABEL}" "${BOOT_A_FAT_VOLUME_ID}" "${BOOT_CMDLINE_A}"
    mkboot "${workdir}/boot-b.img" "${BOOT_B_FAT_LABEL}" "${BOOT_B_FAT_VOLUME_ID}" "${BOOT_CMDLINE_B}"
    mkext4 "${workdir}/meta.img" "${META_SIZE_MIB}" "${META_FS_LABEL}" "${META_FS_UUID}"
    mkext4 "${workdir}/state.img" "${STATE_SIZE_MIB}" "${STATE_FS_LABEL}" "${STATE_FS_UUID}"
    mkext4 "${workdir}/ephemeral.img" "${EPHEMERAL_SIZE_MIB}" "${EPHEMERAL_FS_LABEL}" "${EPHEMERAL_FS_UUID}"

    local img_tmp="${IMG_OUT}.tmp"
    rm -f "${img_tmp}"
    truncate -s "${total_size_mib}M" "${img_tmp}"

    # Every start is given explicitly in sectors: the layout is pinned, not
    # negotiated with sgdisk's allocator.
    sgdisk --clear \
        --disk-guid="${DISK_GUID}" \
        --new="${UENV_A_PARTNUM}:${UENV_A_START_SECTOR}:+${UENV_SIZE_SECTORS}S" \
        --change-name="${UENV_A_PARTNUM}:${UENV_A_LABEL}" \
        --typecode="${UENV_A_PARTNUM}:${UENV_A_TYPECODE}" \
        --partition-guid="${UENV_A_PARTNUM}:${UENV_A_GUID}" \
        --new="${UENV_B_PARTNUM}:${UENV_B_START_SECTOR}:+${UENV_SIZE_SECTORS}S" \
        --change-name="${UENV_B_PARTNUM}:${UENV_B_LABEL}" \
        --typecode="${UENV_B_PARTNUM}:${UENV_B_TYPECODE}" \
        --partition-guid="${UENV_B_PARTNUM}:${UENV_B_GUID}" \
        --new="${BOOT_A_PARTNUM}:${BOOT_A_START_SECTOR}:+${BOOT_SIZE_MIB}M" \
        --change-name="${BOOT_A_PARTNUM}:${BOOT_A_LABEL}" \
        --typecode="${BOOT_A_PARTNUM}:${BOOT_A_TYPECODE}" \
        --partition-guid="${BOOT_A_PARTNUM}:${BOOT_A_GUID}" \
        --new="${BOOT_B_PARTNUM}:${BOOT_B_START_SECTOR}:+${BOOT_SIZE_MIB}M" \
        --change-name="${BOOT_B_PARTNUM}:${BOOT_B_LABEL}" \
        --typecode="${BOOT_B_PARTNUM}:${BOOT_B_TYPECODE}" \
        --partition-guid="${BOOT_B_PARTNUM}:${BOOT_B_GUID}" \
        --new="${ROOTFS_A_PARTNUM}:${ROOTFS_A_START_SECTOR}:+${slot_mib}M" \
        --change-name="${ROOTFS_A_PARTNUM}:${ROOTFS_A_LABEL}" \
        --typecode="${ROOTFS_A_PARTNUM}:${ROOTFS_A_TYPECODE}" \
        --partition-guid="${ROOTFS_A_PARTNUM}:${ROOTFS_A_GUID}" \
        --new="${ROOTFS_B_PARTNUM}:$((rootfs_b_start_mib * MIB_BYTES / SECTOR_SIZE)):+${slot_mib}M" \
        --change-name="${ROOTFS_B_PARTNUM}:${ROOTFS_B_LABEL}" \
        --typecode="${ROOTFS_B_PARTNUM}:${ROOTFS_B_TYPECODE}" \
        --partition-guid="${ROOTFS_B_PARTNUM}:${ROOTFS_B_GUID}" \
        --new="${META_PARTNUM}:$((meta_start_mib * MIB_BYTES / SECTOR_SIZE)):+${META_SIZE_MIB}M" \
        --change-name="${META_PARTNUM}:${META_LABEL}" \
        --typecode="${META_PARTNUM}:${META_TYPECODE}" \
        --partition-guid="${META_PARTNUM}:${META_GUID}" \
        --new="${STATE_PARTNUM}:$((state_start_mib * MIB_BYTES / SECTOR_SIZE)):+${STATE_SIZE_MIB}M" \
        --change-name="${STATE_PARTNUM}:${STATE_LABEL}" \
        --typecode="${STATE_PARTNUM}:${STATE_TYPECODE}" \
        --partition-guid="${STATE_PARTNUM}:${STATE_GUID}" \
        --new="${EPHEMERAL_PARTNUM}:$((ephemeral_start_mib * MIB_BYTES / SECTOR_SIZE)):+${EPHEMERAL_SIZE_MIB}M" \
        --change-name="${EPHEMERAL_PARTNUM}:${EPHEMERAL_LABEL}" \
        --typecode="${EPHEMERAL_PARTNUM}:${EPHEMERAL_TYPECODE}" \
        --partition-guid="${EPHEMERAL_PARTNUM}:${EPHEMERAL_GUID}" \
        "${img_tmp}" >/dev/null

    # uenv-a/uenv-b and rootfs-b stay holes: nothing is written into them.
    dd if="${UBOOT}" of="${img_tmp}" bs=512 seek="${UBOOT_SEEK_SECTOR}" conv=notrunc status=none
    dd if="${workdir}/boot-a.img" of="${img_tmp}" bs=1M seek="${BOOT_A_START_MIB}" conv=notrunc status=none
    dd if="${workdir}/boot-b.img" of="${img_tmp}" bs=1M seek="${BOOT_B_START_MIB}" conv=notrunc status=none
    dd if="${ROOTFS_VERITY_IMG}" of="${img_tmp}" bs=1M seek="${ROOTFS_A_START_MIB}" conv=notrunc status=none
    dd if="${workdir}/meta.img" of="${img_tmp}" bs=1M seek="${meta_start_mib}" conv=notrunc status=none
    dd if="${workdir}/state.img" of="${img_tmp}" bs=1M seek="${state_start_mib}" conv=notrunc status=none
    dd if="${workdir}/ephemeral.img" of="${img_tmp}" bs=1M seek="${ephemeral_start_mib}" conv=notrunc status=none

    local verify
    verify="$(sgdisk --verify "${img_tmp}")"
    echo "${verify}"
    if ! echo "${verify}" | grep -q "No problems found"; then
        echo "error: sgdisk --verify reported problems" >&2
        exit 1
    fi

    mv "${img_tmp}" "${IMG_OUT}"
}

if [ "${1:-}" = "--assemble" ]; then
    assemble
    exit 0
fi

BOARD_DIR="${BOARD_DIR:-${REPO_ROOT}/board/cx3576}"
OUT_DIR="${REPO_ROOT}/_out/cx3576"

ROOTFS_VERITY_IMG="${OUT_DIR}/rootfs-verity.img"
ROOTFS_VERITY_ENV="${OUT_DIR}/rootfs-verity.env"
BOOT_CMDLINE_A="${OUT_DIR}/boot-cmdline-a.txt"
BOOT_CMDLINE_B="${OUT_DIR}/boot-cmdline-b.txt"
KERNEL_IMAGE="${BOARD_DIR}/out/kernel/Image"
DTB="${BOARD_DIR}/out/kernel/rk3576-src.dtb"
UBOOT="${BOARD_DIR}/out/uboot/u-boot-rockchip.bin"

for input in "${ROOTFS_VERITY_IMG}" "${ROOTFS_VERITY_ENV}" "${BOOT_CMDLINE_A}" "${BOOT_CMDLINE_B}"; do
    if [ ! -f "${input}" ]; then
        echo "error: ${input} not found; run 'bash ${ROOTFS_PRODUCER}' first" >&2
        exit 1
    fi
done
for input in "${KERNEL_IMAGE}" "${DTB}" "${UBOOT}"; do
    if [ ! -f "${input}" ]; then
        echo "error: ${input} not found; build the BSP or set BOARD_DIR (currently: ${BOARD_DIR})" >&2
        exit 1
    fi
done

mkdir -p "${OUT_DIR}"

# Epoch is computed here at assembly time; only the filename varies per build.
IMG_NAME="${IMAGE_NAME_PREFIX}$(date +%s)${IMAGE_NAME_SUFFIX}"

# mke2fs must be able to switch orphan_file off (e2fsprogs >= 1.47) and honour
# -E hash_seed; older host tools silently cannot, so probe instead of guessing.
host_can_assemble() {
    command -v sgdisk >/dev/null && command -v mkfs.vfat >/dev/null &&
        command -v mcopy >/dev/null && command -v mke2fs >/dev/null || return 1
    local probe rc=0
    probe="$(mktemp)"
    truncate -s "${META_SIZE_MIB}M" "${probe}"
    mke2fs -q -n -t ext4 -b "${EXT4_BLOCK_SIZE}" -O "${EXT4_FEATURES}" \
        -E "root_owner=0:0,hash_seed=${META_FS_UUID}" "${probe}" >/dev/null 2>&1 || rc=1
    rm -f "${probe}"
    return "${rc}"
}

# The inner run must see the pin only when this one was actually pinned:
# passing the resolved value unconditionally would turn every build into a
# frozen-geometry build.
INNER_ENV=()
DOCKER_PIN_ARGS=()
if [ "${ROOTFS_SLOT_PINNED}" = 1 ]; then
    INNER_ENV=("MOS_ROOTFS_SLOT_MIB=${MOS_ROOTFS_SLOT_MIB}")
    DOCKER_PIN_ARGS=(-e "MOS_ROOTFS_SLOT_MIB=${MOS_ROOTFS_SLOT_MIB}")
fi

if host_can_assemble; then
    env KERNEL_IMAGE="${KERNEL_IMAGE}" DTB="${DTB}" UBOOT="${UBOOT}" \
        ROOTFS_VERITY_IMG="${ROOTFS_VERITY_IMG}" ROOTFS_VERITY_ENV="${ROOTFS_VERITY_ENV}" \
        BOOT_CMDLINE_A="${BOOT_CMDLINE_A}" BOOT_CMDLINE_B="${BOOT_CMDLINE_B}" \
        IMG_OUT="${OUT_DIR}/${IMG_NAME}" "${INNER_ENV[@]}" \
        bash "${BASH_SOURCE[0]}" --assemble
else
    echo "sgdisk/mkfs.vfat/mcopy/mke2fs(>=1.47) not all available on the host; assembling in a container"
    docker run --rm \
        -v "${REPO_ROOT}:/work" \
        -v "${BOARD_DIR}:/board:ro" \
        -e KERNEL_IMAGE=/board/out/kernel/Image \
        -e DTB=/board/out/kernel/rk3576-src.dtb \
        -e UBOOT=/board/out/uboot/u-boot-rockchip.bin \
        -e ROOTFS_VERITY_IMG=/work/_out/cx3576/rootfs-verity.img \
        -e ROOTFS_VERITY_ENV=/work/_out/cx3576/rootfs-verity.env \
        -e BOOT_CMDLINE_A=/work/_out/cx3576/boot-cmdline-a.txt \
        -e BOOT_CMDLINE_B=/work/_out/cx3576/boot-cmdline-b.txt \
        -e IMG_OUT="/work/_out/cx3576/${IMG_NAME}" \
        "${DOCKER_PIN_ARGS[@]}" \
        alpine:3.21 \
        sh -c 'apk add --no-cache -q bash coreutils sgdisk dosfstools mtools e2fsprogs && exec bash /work/os/mkimage-v2.sh --assemble'
fi

ln -sfn "${IMG_NAME}" "${OUT_DIR}/${IMAGE_LATEST_NAME}"
echo "assembled ${OUT_DIR}/${IMG_NAME} (${IMAGE_LATEST_NAME} -> ${IMG_NAME})"
