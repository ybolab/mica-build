#!/usr/bin/env bash
set -euo pipefail

# Drives os/mkimage-v2.sh --assemble with synthetic inputs so the v2 assembler
# can be exercised without the BSP and without os/rootfs/build-v2.sh. Asserts
# that two consecutive assemblies are byte-identical and that the resulting GPT
# carries all nine partitions with the labels, GUIDs and typecodes pinned in
# os/layout/cx3576-v2.env.
#
# Everything is created under a private $TMPDIR workspace; nothing outside it
# is written and no host system state is touched.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
# shellcheck source=layout/cx3576-v2.env
. "${SCRIPT_DIR}/layout/cx3576-v2.env"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

FAILED=0
check() {
    if [ "$2" = "$3" ]; then
        echo "PASS: $1"
    else
        echo "FAIL: $1 (expected '$3', got '$2')"
        FAILED=1
    fi
}

# Deterministic filler: the same byte repeated, so a rebuild sees identical
# input bytes without depending on a random source.
fill() {
    head -c "$2" /dev/zero | tr '\0' "$3" > "$1"
}

echo "workspace ${WORK}"

# --- synthetic BSP blobs -----------------------------------------------------
mkdir -p "${WORK}/bsp"
fill "${WORK}/bsp/Image" $((4 * 1024 * 1024)) K
fill "${WORK}/bsp/rk3576-src.dtb" $((64 * 1024)) D
fill "${WORK}/bsp/u-boot-rockchip.bin" $((1024 * 1024)) U

# --- synthetic rootfs-verity inputs (stand-ins for os/rootfs/build-v2.sh) -----
VERITY_MIB=4
fill "${WORK}/rootfs-verity.img" $((VERITY_MIB * 1024 * 1024)) R
FAKE_ROOT_HASH=1111111111111111111111111111111111111111111111111111111111111111
cat > "${WORK}/rootfs-verity.env" <<EOF
VERITY_ROOT_HASH=${FAKE_ROOT_HASH}
VERITY_SALT=${VERITY_SALT}
VERITY_HASH_ALGO=sha256
VERITY_DATA_BLOCK_SIZE=4096
VERITY_HASH_BLOCK_SIZE=4096
VERITY_DATA_BLOCKS=768
VERITY_HASH_START_BLOCK=768
VERITY_DATA_SECTORS=6144
EOF
echo "root=/dev/dm-0 rootfstype=squashfs ro selftest-slot=a" > "${WORK}/boot-cmdline-a.txt"
echo "root=/dev/dm-0 rootfstype=squashfs ro selftest-slot=b" > "${WORK}/boot-cmdline-b.txt"

# --- assemble twice ----------------------------------------------------------
# mke2fs must be able to switch orphan_file off (e2fsprogs >= 1.47); when the
# host cannot, run the assembler in the same Alpine image mkimage-v2.sh uses.
host_can_assemble() {
    command -v sgdisk >/dev/null && command -v mkfs.vfat >/dev/null &&
        command -v mcopy >/dev/null && command -v mke2fs >/dev/null || return 1
    local probe rc=0
    probe="${WORK}/mke2fs-probe.img"
    truncate -s "${META_SIZE_MIB}M" "${probe}"
    mke2fs -q -n -t ext4 -b "${EXT4_BLOCK_SIZE}" -O "${EXT4_FEATURES}" \
        -E "root_owner=0:0,hash_seed=${META_FS_UUID}" "${probe}" >/dev/null 2>&1 || rc=1
    rm -f "${probe}"
    return "${rc}"
}

# When the assembly has to run in a container the workspace must be reachable
# by the docker daemon; a sandboxed private /tmp is not.
require_visible_workspace() {
    if docker run --rm -v "${WORK}:/t" alpine:3.21 test -f /t/rootfs-verity.img; then
        return 0
    fi
    echo "error: the docker daemon cannot bind-mount the workspace ${WORK}" >&2
    echo "hint: point TMPDIR at a directory the daemon can see, e.g." >&2
    echo "  mkdir -p ${REPO_ROOT}/_out/tmp && TMPDIR=${REPO_ROOT}/_out/tmp bash ${BASH_SOURCE[0]}" >&2
    exit 1
}

run_assemble() {
    if host_can_assemble; then
        KERNEL_IMAGE="${WORK}/bsp/Image" \
            DTB="${WORK}/bsp/rk3576-src.dtb" \
            UBOOT="${WORK}/bsp/u-boot-rockchip.bin" \
            ROOTFS_VERITY_IMG="${WORK}/rootfs-verity.img" \
            ROOTFS_VERITY_ENV="${WORK}/rootfs-verity.env" \
            BOOT_CMDLINE_A="${WORK}/boot-cmdline-a.txt" \
            BOOT_CMDLINE_B="${WORK}/boot-cmdline-b.txt" \
            IMG_OUT="${WORK}/$1" \
            bash "${SCRIPT_DIR}/mkimage-v2.sh" --assemble
    else
        docker run --rm \
            -v "${REPO_ROOT}:/work:ro" \
            -v "${WORK}:/t" \
            -e KERNEL_IMAGE=/t/bsp/Image \
            -e DTB=/t/bsp/rk3576-src.dtb \
            -e UBOOT=/t/bsp/u-boot-rockchip.bin \
            -e ROOTFS_VERITY_IMG=/t/rootfs-verity.img \
            -e ROOTFS_VERITY_ENV=/t/rootfs-verity.env \
            -e BOOT_CMDLINE_A=/t/boot-cmdline-a.txt \
            -e BOOT_CMDLINE_B=/t/boot-cmdline-b.txt \
            -e IMG_OUT="/t/$1" \
            alpine:3.21 \
            sh -c 'apk add --no-cache -q bash coreutils sgdisk dosfstools mtools e2fsprogs && exec bash /work/os/mkimage-v2.sh --assemble'
    fi
}

host_can_assemble || require_visible_workspace

echo "--- assembly 1 ---"
run_assemble one.img
echo "--- assembly 2 ---"
run_assemble two.img

echo "--- assertions ---"
if cmp -s "${WORK}/one.img" "${WORK}/two.img"; then
    echo "PASS: the two assemblies are byte-identical"
else
    echo "FAIL: the two assemblies differ"
    FAILED=1
fi

IMG="${WORK}/one.img"
# SLOT_MIB = max(pin, align16(ceil(4 * 125 / 100))) = max(256, 16) = 256
SLOT_MIB="${MOS_ROOTFS_SLOT_MIB}"
EXPECT_TOTAL_MIB=$((ROOTFS_A_START_MIB + 2 * SLOT_MIB + META_SIZE_MIB + STATE_SIZE_MIB + EPHEMERAL_SIZE_MIB + IMAGE_TAIL_SLACK_MIB))
check "image size is ${EXPECT_TOTAL_MIB} MiB" \
    "$(stat -c %s "${IMG}")" "$((EXPECT_TOTAL_MIB * MIB_BYTES))"
check "partition count" "$(sgdisk --print "${IMG}" | awk '$1 ~ /^[0-9]+$/ {n++} END {print n+0}')" 9
check "disk GUID" "$(sgdisk --print "${IMG}" | sed -n 's/^Disk identifier (GUID): //p')" "${DISK_GUID}"

part_field() { sgdisk -i "$1" "${IMG}" | sed -n "s/^$2: //p"; }

assert_part() { # num label guid typecode start-sector size-sectors
    check "p$1 name" "$(part_field "$1" 'Partition name' | tr -d "'")" "$2"
    check "p$1 unique GUID" "$(part_field "$1" 'Partition unique GUID')" "$3"
    check "p$1 typecode" "$(part_field "$1" 'Partition GUID code' | cut -d' ' -f1)" "$4"
    check "p$1 first sector" "$(part_field "$1" 'First sector' | cut -d' ' -f1)" "$5"
    check "p$1 size in sectors" "$(part_field "$1" 'Partition size' | cut -d' ' -f1)" "$6"
}

ROOTFS_B_START_MIB=$((ROOTFS_A_START_MIB + SLOT_MIB))
META_START_MIB=$((ROOTFS_B_START_MIB + SLOT_MIB))
STATE_START_MIB=$((META_START_MIB + META_SIZE_MIB))
EPHEMERAL_START_MIB=$((STATE_START_MIB + STATE_SIZE_MIB))

check "p${UENV_A_PARTNUM} offset is ${UENV_A_OFFSET_BYTES} bytes" \
    "$(($(part_field "${UENV_A_PARTNUM}" 'First sector' | cut -d' ' -f1) * SECTOR_SIZE))" \
    "${UENV_A_OFFSET_BYTES}"
check "p${UENV_B_PARTNUM} offset is ${UENV_B_OFFSET_BYTES} bytes" \
    "$(($(part_field "${UENV_B_PARTNUM}" 'First sector' | cut -d' ' -f1) * SECTOR_SIZE))" \
    "${UENV_B_OFFSET_BYTES}"

assert_part "${UENV_A_PARTNUM}" "${UENV_A_LABEL}" "${UENV_A_GUID}" "${UENV_A_TYPECODE}" \
    "${UENV_A_START_SECTOR}" "${UENV_SIZE_SECTORS}"
assert_part "${UENV_B_PARTNUM}" "${UENV_B_LABEL}" "${UENV_B_GUID}" "${UENV_B_TYPECODE}" \
    "${UENV_B_START_SECTOR}" "${UENV_SIZE_SECTORS}"
assert_part "${BOOT_A_PARTNUM}" "${BOOT_A_LABEL}" "${BOOT_A_GUID}" "${BOOT_A_TYPECODE}" \
    "${BOOT_A_START_SECTOR}" "$((BOOT_SIZE_MIB * MIB_BYTES / SECTOR_SIZE))"
assert_part "${BOOT_B_PARTNUM}" "${BOOT_B_LABEL}" "${BOOT_B_GUID}" "${BOOT_B_TYPECODE}" \
    "${BOOT_B_START_SECTOR}" "$((BOOT_SIZE_MIB * MIB_BYTES / SECTOR_SIZE))"
assert_part "${ROOTFS_A_PARTNUM}" "${ROOTFS_A_LABEL}" "${ROOTFS_A_GUID}" "${ROOTFS_A_TYPECODE}" \
    "${ROOTFS_A_START_SECTOR}" "$((SLOT_MIB * MIB_BYTES / SECTOR_SIZE))"
assert_part "${ROOTFS_B_PARTNUM}" "${ROOTFS_B_LABEL}" "${ROOTFS_B_GUID}" "${ROOTFS_B_TYPECODE}" \
    "$((ROOTFS_B_START_MIB * MIB_BYTES / SECTOR_SIZE))" "$((SLOT_MIB * MIB_BYTES / SECTOR_SIZE))"
assert_part "${META_PARTNUM}" "${META_LABEL}" "${META_GUID}" "${META_TYPECODE}" \
    "$((META_START_MIB * MIB_BYTES / SECTOR_SIZE))" "$((META_SIZE_MIB * MIB_BYTES / SECTOR_SIZE))"
assert_part "${STATE_PARTNUM}" "${STATE_LABEL}" "${STATE_GUID}" "${STATE_TYPECODE}" \
    "$((STATE_START_MIB * MIB_BYTES / SECTOR_SIZE))" "$((STATE_SIZE_MIB * MIB_BYTES / SECTOR_SIZE))"
assert_part "${EPHEMERAL_PARTNUM}" "${EPHEMERAL_LABEL}" "${EPHEMERAL_GUID}" "${EPHEMERAL_TYPECODE}" \
    "$((EPHEMERAL_START_MIB * MIB_BYTES / SECTOR_SIZE))" "$((EPHEMERAL_SIZE_MIB * MIB_BYTES / SECTOR_SIZE))"

# The FAT slots must both be populated, each with its own slot's cmdline.
for slot in a b; do
    case "${slot}" in
    a) off="${BOOT_A_OFFSET_BYTES}" ;;
    b) off="${BOOT_B_OFFSET_BYTES}" ;;
    esac
    listing="$(mdir -i "${IMG}@@${off}" -b ::/ 2>/dev/null || true)"
    for f in ::/Image ::/rk3576-src.dtb ::/extlinux/; do
        if echo "${listing}" | grep -q "^${f}"; then
            echo "PASS: boot-${slot} contains ${f}"
        else
            echo "FAIL: boot-${slot} is missing ${f}"
            FAILED=1
        fi
    done
    conf="$(mtype -i "${IMG}@@${off}" ::/extlinux/extlinux.conf 2>/dev/null || true)"
    check "boot-${slot} extlinux.conf uses the slot-${slot} cmdline" \
        "$(echo "${conf}" | sed -n 's/^    append //p')" \
        "$(cat "${WORK}/boot-cmdline-${slot}.txt")"
done

# rootfs-a carries the payload; rootfs-b stays zero-filled.
check "rootfs-a holds the verity payload" \
    "$(dd if="${IMG}" bs=1M skip="${ROOTFS_A_START_MIB}" count="${VERITY_MIB}" status=none | cmp -s - "${WORK}/rootfs-verity.img" && echo yes || echo no)" \
    yes
check "rootfs-b is zero-filled" \
    "$(dd if="${IMG}" bs=1M skip="${ROOTFS_B_START_MIB}" count="${SLOT_MIB}" status=none | tr -d '\0' | wc -c)" \
    0
check "uenv pair is zero-filled" \
    "$(dd if="${IMG}" bs=1 skip="${UENV_A_OFFSET_BYTES}" count=$((UENV_B_OFFSET_BYTES - UENV_A_OFFSET_BYTES + UENV_SIZE_BYTES)) status=none | tr -d '\0' | wc -c)" \
    0

if [ "${FAILED}" -eq 0 ]; then
    echo "RESULT: PASS"
else
    echo "RESULT: FAIL"
    exit 1
fi
