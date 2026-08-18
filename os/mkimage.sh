#!/usr/bin/env bash
set -euo pipefail

# Assembles the flashable cx3576 (Rockchip RK3576, eMMC /dev/mmcblk0) GPT disk
# image from the Debian systemd rootfs (os/rootfs/build.sh) plus the BSP
# kernel/dtb/u-boot artifacts.
#
# The output filename carries the assembly-time epoch, but the image CONTENT is
# deterministic: fixed GPT GUIDs, fixed FAT volume id and fixed file mtimes.
# Known deviation: rootfs.img (the ext4 partition content) is only as
# reproducible as the docker build cache — a cache-hot rebuild reuses the same
# bytes, a cold rebuild may produce a differing ext4 image for the same inputs.
# Known deviation: the FAT partition is byte-identical only across builds using
# the same mtools version; different mtools builds (e.g. host vs the Alpine
# container) allocate clusters in a different order for the same inputs.
#
# When the host lacks sgdisk/mkfs.vfat/mcopy the assembly runs inside an Alpine
# container (--assemble mode); epoch naming and the -latest symlink always
# happen on the host side.

# Fixed disk layout (sectors are 512 bytes). The rootfs partition size is
# derived from the packed rootfs.img (content-sized, whole MiB); total image =
# 16 MiB pre-boot area + 512 MiB boot + rootfs + 1 MiB backup-GPT slack.
BOOT_START_SECTOR=32768 # 16 MiB
BOOT_SIZE_MIB=512
UBOOT_SEEK_SECTOR=64

APPEND="root=PARTLABEL=rootfs rw console=ttyFIQ0,1500000 earlycon=uart8250,mmio32,0x2ad40000 storagemedia=emmc net.ifnames=0 rootwait"

# Determinism knobs: content must not vary between builds of the same inputs.
FAT_VOLUME_ID="C3576002"
FILE_MTIME="@1577836800" # 2020-01-01T00:00:00Z (FAT cannot store pre-1980 dates)
DISK_GUID="5AC35760-0001-4000-8000-000000000000"
BOOT_GUID="5AC35760-0001-4000-8000-000000000001"
ROOTFS_GUID="5AC35760-0001-4000-8000-000000000002"
# ESP typecode: the systemd-repart definition in the rootfs matches the root
# partition uniquely only if p1 is typed as an ESP, not linux-generic.
ESP_TYPE="C12A7328-F81F-11D2-BA4B-00A0C93EC93B"
LINUX_FS_DATA="0FC63DAF-8483-4772-8E79-3D69D8477DE4"

# Assembly, running either natively or inside the container. Inputs/output are
# taken from the environment: KERNEL_IMAGE, DTB, UBOOT, ROOTFS_IMG, IMG_OUT.
assemble() {
    workdir="$(mktemp -d)"
    trap 'rm -rf "${workdir:-}"' EXIT

    local uboot_limit_bytes=$(((BOOT_START_SECTOR - UBOOT_SEEK_SECTOR) * 512))
    if [ "$(stat -c %s "${UBOOT}")" -gt "${uboot_limit_bytes}" ]; then
        echo "error: ${UBOOT} does not fit between sector ${UBOOT_SEEK_SECTOR} and the boot partition" >&2
        exit 1
    fi
    local rootfs_bytes rootfs_size_mib total_size_mib
    rootfs_bytes="$(stat -c %s "${ROOTFS_IMG}")"
    if [ $((rootfs_bytes % 1048576)) -ne 0 ]; then
        echo "error: ${ROOTFS_IMG} is ${rootfs_bytes} bytes, not a whole-MiB multiple" >&2
        exit 1
    fi
    rootfs_size_mib=$((rootfs_bytes / 1048576))
    total_size_mib=$((BOOT_START_SECTOR / 2048 + BOOT_SIZE_MIB + rootfs_size_mib + 1))

    mkdir -p "${workdir}/boot/extlinux"
    cp "${KERNEL_IMAGE}" "${workdir}/boot/Image"
    cp "${DTB}" "${workdir}/boot/rk3576-src.dtb"
    cat > "${workdir}/boot/extlinux/extlinux.conf" <<EOF
default cx3576
timeout 3
label cx3576
    kernel /Image
    fdt /rk3576-src.dtb
    append ${APPEND}
EOF
    find "${workdir}/boot" -exec touch -h -d "${FILE_MTIME}" {} +

    truncate -s "${BOOT_SIZE_MIB}M" "${workdir}/boot.img"
    mkfs.vfat --invariant -F 32 -n BOOT -i "${FAT_VOLUME_ID}" "${workdir}/boot.img" >/dev/null
    mcopy -s -m -i "${workdir}/boot.img" "${workdir}"/boot/* ::/

    local img_tmp="${IMG_OUT}.tmp"
    rm -f "${img_tmp}"
    truncate -s "${total_size_mib}M" "${img_tmp}"

    # boot at 16 MiB; rootfs right after it at 528 MiB, grown to fill the
    # eMMC on first boot by systemd-repart + x-systemd.growfs.
    sgdisk --clear \
        --disk-guid="${DISK_GUID}" \
        --new=1:${BOOT_START_SECTOR}:+${BOOT_SIZE_MIB}M --change-name=1:boot --typecode=1:"${ESP_TYPE}" --attributes=1:set:2 --partition-guid=1:"${BOOT_GUID}" \
        --new=2:0:+${rootfs_size_mib}M --change-name=2:rootfs --typecode=2:"${LINUX_FS_DATA}" --partition-guid=2:"${ROOTFS_GUID}" \
        "${img_tmp}" >/dev/null

    dd if="${UBOOT}" of="${img_tmp}" bs=512 seek=${UBOOT_SEEK_SECTOR} conv=notrunc status=none
    dd if="${workdir}/boot.img" of="${img_tmp}" bs=1M seek=$((BOOT_START_SECTOR / 2048)) conv=notrunc status=none
    dd if="${ROOTFS_IMG}" of="${img_tmp}" bs=1M seek=$((BOOT_START_SECTOR / 2048 + BOOT_SIZE_MIB)) conv=notrunc status=none

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

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOARD_DIR="${BOARD_DIR:-${REPO_ROOT}/board/cx3576}"

ROOTFS_IMG="${REPO_ROOT}/_out/cx3576/rootfs.img"
KERNEL_IMAGE="${BOARD_DIR}/out/kernel/Image"
DTB="${BOARD_DIR}/out/kernel/rk3576-src.dtb"
UBOOT="${BOARD_DIR}/out/uboot/u-boot-rockchip.bin"

if [ ! -f "${ROOTFS_IMG}" ]; then
    echo "error: ${ROOTFS_IMG} not found; run 'bash os/rootfs/build.sh' first" >&2
    exit 1
fi
for input in "${KERNEL_IMAGE}" "${DTB}" "${UBOOT}"; do
    if [ ! -f "${input}" ]; then
        echo "error: ${input} not found; build the BSP or set BOARD_DIR (currently: ${BOARD_DIR})" >&2
        exit 1
    fi
done

OUT_DIR="${REPO_ROOT}/_out/cx3576"
mkdir -p "${OUT_DIR}"

# Epoch is computed here at assembly time; only the filename varies per build.
IMG_NAME="cx3576-mos-$(date +%s).img"

if command -v sgdisk >/dev/null && command -v mkfs.vfat >/dev/null && command -v mcopy >/dev/null; then
    KERNEL_IMAGE="${KERNEL_IMAGE}" DTB="${DTB}" UBOOT="${UBOOT}" \
        ROOTFS_IMG="${ROOTFS_IMG}" IMG_OUT="${OUT_DIR}/${IMG_NAME}" \
        "${BASH_SOURCE[0]}" --assemble
else
    echo "sgdisk/mkfs.vfat/mcopy not all available on the host; assembling in a container"
    docker run --rm \
        -v "${REPO_ROOT}:/work" \
        -v "${BOARD_DIR}:/board:ro" \
        -e KERNEL_IMAGE=/board/out/kernel/Image \
        -e DTB=/board/out/kernel/rk3576-src.dtb \
        -e UBOOT=/board/out/uboot/u-boot-rockchip.bin \
        -e ROOTFS_IMG=/work/_out/cx3576/rootfs.img \
        -e IMG_OUT="/work/_out/cx3576/${IMG_NAME}" \
        alpine:3.21 \
        sh -c 'apk add --no-cache -q bash coreutils sgdisk dosfstools mtools && exec bash /work/os/mkimage.sh --assemble'
fi

ln -sfn "${IMG_NAME}" "${OUT_DIR}/cx3576-mos-latest.img"
echo "assembled ${OUT_DIR}/${IMG_NAME} (cx3576-mos-latest.img -> ${IMG_NAME})"
