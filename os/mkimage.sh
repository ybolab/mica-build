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

# The Rockchip loader area is a REAL GPT partition here exactly as it is in
# layout v2, and for the same reason: systemd-repart discards every region no
# partition entry covers, so a loader living in an untracked gap at sector 64 is
# TRIMmed away by the first-boot growth run — the device boots once and comes up
# in maskrom afterwards. v1 is the image the board is flashed with during
# bring-up, so it carries the identical hazard and gets the identical fix.
#
# The loader geometry, label and typecode are SOURCED from the v2 layout file
# rather than restated: there is one loader area on this board, not two. Only
# the unique partition GUID belongs to v1's own disk-identity family, and it is
# in that file too (LOADER_V1_GUID).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAYOUT_ENV="${SCRIPT_DIR}/layout/cx3576-v2.env"
if [ ! -f "${LAYOUT_ENV}" ]; then
    echo "error: ${LAYOUT_ENV} not found" >&2
    exit 1
fi
# shellcheck source=layout/cx3576-v2.env
. "${LAYOUT_ENV}"

# Disk layout (sectors are 512 bytes). Only the pre-boot area is fixed: both
# filesystem partition sizes are content-derived (whole MiB). Boot is the staged
# payload plus BOOT_HEADROOM_MIB, never below BOOT_MIN_SIZE_MIB, rounded up to a
# BOOT_ALIGN_MIB multiple — the floor matches the 64 MiB BOOT-A/B slots the M4
# A/B layout reserves. Rootfs is the packed rootfs.img. Total image = 16 MiB
# pre-boot area + boot + rootfs + 1 MiB backup-GPT slack.
#
# The v1 constants below deliberately follow the source above so they win: v1
# keeps its own disk identity and its own partition numbering.
BOOT_START_SECTOR=$((LOADER_START_SECTOR + LOADER_SIZE_SECTORS)) # 16 MiB
BOOT_MIN_SIZE_MIB=64
BOOT_HEADROOM_MIB=16
BOOT_ALIGN_MIB=4
LOADER_PARTNUM=1
BOOT_PARTNUM=2
ROOTFS_PARTNUM=3

APPEND="root=PARTLABEL=rootfs rw console=ttyFIQ0,1500000 earlycon=uart8250,mmio32,0x2ad40000 net.ifnames=0 rootwait"

# Determinism knobs: content must not vary between builds of the same inputs.
FAT_VOLUME_ID="C3576002"
FILE_MTIME="@1577836800" # 2020-01-01T00:00:00Z (FAT cannot store pre-1980 dates)
DISK_GUID="5AC35760-0001-4000-8000-000000000000"
BOOT_GUID="5AC35760-0001-4000-8000-000000000001"
ROOTFS_GUID="5AC35760-0001-4000-8000-000000000002"
# Typecodes come from the layout file. The boot partition is an ESP and the
# loader is "Linux reserved", so the rootfs is the ONLY linux-generic partition
# on the disk — which is what makes the single /etc/repart.d/50-rootfs.conf
# definition match the rootfs and nothing else. repart pairs definitions with
# partitions by type UUID in disk order, so no definition can ever attach itself
# to the loader.
ESP_TYPE="${TYPECODE_ESP}"
LINUX_FS_DATA="${TYPECODE_LINUX}"

# Assembly, running either natively or inside the container. Inputs/output are
# taken from the environment: KERNEL_IMAGE, DTB, UBOOT, ROOTFS_IMG, IMG_OUT.
assemble() {
    workdir="$(mktemp -d)"
    trap 'rm -rf "${workdir:-}"' EXIT

    # The loader partition is exactly the space between sector 64 and the boot
    # partition, so the fit check and the partition are the same number.
    local uboot_limit_bytes=$((LOADER_SIZE_SECTORS * SECTOR_SIZE))
    local uboot_bytes uboot_magic
    uboot_bytes="$(stat -c %s "${UBOOT}")"
    if [ "${LOADER_START_SECTOR}" -ne "${UBOOT_SEEK_SECTOR}" ] ||
        [ $((LOADER_START_SECTOR + LOADER_SIZE_SECTORS)) -ne "${BOOT_START_SECTOR}" ]; then
        echo "error: the loader partition (sectors ${LOADER_START_SECTOR}..$((LOADER_START_SECTOR + LOADER_SIZE_SECTORS - 1))) does not cover sector ${UBOOT_SEEK_SECTOR} up to the boot partition at ${BOOT_START_SECTOR}" >&2
        exit 1
    fi
    if [ "${uboot_bytes}" -gt "${uboot_limit_bytes}" ]; then
        echo "error: ${UBOOT} does not fit between sector ${UBOOT_SEEK_SECTOR} and the boot partition" >&2
        exit 1
    fi
    # 'RKNS' — the first field of a Rockchip idbloader. A loader partition whose
    # contents the BootROM would not recognise is worse than none: it passes
    # every structural check and does not boot.
    uboot_magic="$(od -An -tx1 -N4 "${UBOOT}" | tr -d ' \n')"
    if [ "${uboot_magic}" != "${LOADER_MAGIC_HEX}" ]; then
        echo "error: ${UBOOT} starts with '${uboot_magic}', not the Rockchip idbloader magic '${LOADER_MAGIC_HEX}' ('RKNS')" >&2
        exit 1
    fi
    local rootfs_bytes rootfs_size_mib boot_content_mib boot_size_mib total_size_mib
    rootfs_bytes="$(stat -c %s "${ROOTFS_IMG}")"
    if [ $((rootfs_bytes % 1048576)) -ne 0 ]; then
        echo "error: ${ROOTFS_IMG} is ${rootfs_bytes} bytes, not a whole-MiB multiple" >&2
        exit 1
    fi
    rootfs_size_mib=$((rootfs_bytes / 1048576))

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

    # --apparent-size keeps the measurement independent of the block size of
    # whatever filesystem mktemp landed on; -m rounds up to whole MiB.
    boot_content_mib="$(du -sm --apparent-size "${workdir}/boot" | cut -f1)"
    boot_size_mib=$((boot_content_mib + BOOT_HEADROOM_MIB))
    if [ "${boot_size_mib}" -lt "${BOOT_MIN_SIZE_MIB}" ]; then
        boot_size_mib="${BOOT_MIN_SIZE_MIB}"
    fi
    boot_size_mib=$(((boot_size_mib + BOOT_ALIGN_MIB - 1) / BOOT_ALIGN_MIB * BOOT_ALIGN_MIB))
    total_size_mib=$((BOOT_START_SECTOR / 2048 + boot_size_mib + rootfs_size_mib + 1))
    echo "boot payload ${boot_content_mib} MiB -> boot partition ${boot_size_mib} MiB (min ${BOOT_MIN_SIZE_MIB}, +${BOOT_HEADROOM_MIB} headroom, ${BOOT_ALIGN_MIB} MiB aligned); rootfs ${rootfs_size_mib} MiB; image ${total_size_mib} MiB"

    truncate -s "${boot_size_mib}M" "${workdir}/boot.img"
    mkfs.vfat --invariant -F 32 -n BOOT -i "${FAT_VOLUME_ID}" "${workdir}/boot.img" >/dev/null
    mcopy -s -m -i "${workdir}/boot.img" "${workdir}"/boot/* ::/

    local img_tmp="${IMG_OUT}.tmp"
    rm -f "${img_tmp}"
    truncate -s "${total_size_mib}M" "${img_tmp}"

    # p1 loader at sector 64; boot at 16 MiB; rootfs right after it (sgdisk picks
    # the next MiB-aligned sector), grown to fill the eMMC on first boot by
    # systemd-repart + x-systemd.growfs.
    #
    # -a ${GPT_ALIGN_SECTORS} is mandatory: sector 64 is not 2048-aligned and
    # sgdisk silently relocates a non-aligned start to 2048, which would leave
    # the bootloader outside its own partition and back in a discardable gap.
    # Both other starts are MiB-aligned, so nothing else moves.
    sgdisk --clear -a "${GPT_ALIGN_SECTORS}" \
        --disk-guid="${DISK_GUID}" \
        --new=${LOADER_PARTNUM}:${LOADER_START_SECTOR}:+${LOADER_SIZE_SECTORS}S --change-name=${LOADER_PARTNUM}:"${LOADER_LABEL}" --typecode=${LOADER_PARTNUM}:"${LOADER_TYPECODE}" --partition-guid=${LOADER_PARTNUM}:"${LOADER_V1_GUID}" \
        --new=${BOOT_PARTNUM}:${BOOT_START_SECTOR}:+${boot_size_mib}M --change-name=${BOOT_PARTNUM}:boot --typecode=${BOOT_PARTNUM}:"${ESP_TYPE}" --attributes=${BOOT_PARTNUM}:set:2 --partition-guid=${BOOT_PARTNUM}:"${BOOT_GUID}" \
        --new=${ROOTFS_PARTNUM}:0:+${rootfs_size_mib}M --change-name=${ROOTFS_PARTNUM}:rootfs --typecode=${ROOTFS_PARTNUM}:"${LINUX_FS_DATA}" --partition-guid=${ROOTFS_PARTNUM}:"${ROOTFS_GUID}" \
        "${img_tmp}" >/dev/null

    dd if="${UBOOT}" of="${img_tmp}" bs=512 seek=${UBOOT_SEEK_SECTOR} conv=notrunc status=none
    dd if="${workdir}/boot.img" of="${img_tmp}" bs=1M seek=$((BOOT_START_SECTOR / 2048)) conv=notrunc status=none
    dd if="${ROOTFS_IMG}" of="${img_tmp}" bs=1M seek=$((BOOT_START_SECTOR / 2048 + boot_size_mib)) conv=notrunc status=none

    local verify
    verify="$(sgdisk --verify "${img_tmp}")"
    echo "${verify}"
    if ! echo "${verify}" | grep -q "No problems found"; then
        echo "error: sgdisk --verify reported problems" >&2
        exit 1
    fi

    # Read the loader back out of the ASSEMBLED image: sgdisk may move a start
    # sector, so asserting what was requested proves nothing.
    local got_start got_size got_magic
    got_start="$(sgdisk -i "${LOADER_PARTNUM}" "${img_tmp}" | sed -n 's/^First sector: //p' | awk '{print $1}')"
    got_size="$(sgdisk -i "${LOADER_PARTNUM}" "${img_tmp}" | sed -n 's/^Partition size: //p' | awk '{print $1}')"
    if [ "${got_start}" != "${LOADER_START_SECTOR}" ] || [ "${got_size}" != "${LOADER_SIZE_SECTORS}" ]; then
        echo "error: the assembled ${LOADER_LABEL} partition is ${got_size} sectors at ${got_start}, expected ${LOADER_SIZE_SECTORS} at ${LOADER_START_SECTOR}" >&2
        exit 1
    fi
    got_magic="$(dd if="${img_tmp}" bs="${SECTOR_SIZE}" skip="${got_start}" count=1 status=none | od -An -tx1 -N4 | tr -d ' \n')"
    if [ "${got_magic}" != "${LOADER_MAGIC_HEX}" ]; then
        echo "error: the first bytes of the ${LOADER_LABEL} partition are '${got_magic}', not the idbloader magic '${LOADER_MAGIC_HEX}'" >&2
        exit 1
    fi
    echo "${LOADER_LABEL} p${LOADER_PARTNUM}: sectors ${got_start}..$((got_start + got_size - 1)), ${uboot_bytes} of $((got_size * SECTOR_SIZE)) bytes used ($((got_size * SECTOR_SIZE - uboot_bytes)) spare); first bytes ${got_magic} ('RKNS')"

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
