#!/usr/bin/env bash
set -euo pipefail

# Verifies a cx3576 mos disk image against the PLAN-010 M1 image contract:
# GPT layout, the raw u-boot inside its own loader partition, FAT boot partition
# contents and the Debian systemd rootfs on p3, plus the mosd daemon integration
# (binary, unit, D-Bus policy).
# Emits one PASS:/FAIL: line per check and a final
# "RESULT: PASS|FAIL (n/m checks)" summary; exits non-zero if any check fails.
# Totals are dynamic (PASS_N/total); nothing to hand-bump when checks change.
#
# No loop mounts and no --privileged: GPT is inspected with sgdisk, the FAT
# partition with mtools at an offset, and the ext4 partition by dd-extracting
# it to a temp file and reading it with debugfs/tune2fs. When the host lacks
# the required tools the whole verification re-executes inside an Alpine
# container (same pattern as hack/cx3576/mkimage.sh).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
BOARD_DIR="${BOARD_DIR:-${REPO_ROOT}/board/cx3576}"

# The loader partition's geometry, label, typecode, GUID and idbloader magic are
# the SAME facts v1 and v2 share, so they are sourced from the layout file rather
# than restated here. Everything else below is v1's own contract.
LAYOUT_ENV="${SCRIPT_DIR}/layout/cx3576-v2.env"
if [ ! -f "${LAYOUT_ENV}" ]; then
    echo "error: ${LAYOUT_ENV} not found" >&2
    exit 1
fi
# shellcheck source=layout/cx3576-v2.env
. "${LAYOUT_ENV}"

# Image contract constants. Both filesystem partition sizes are content-derived,
# so they are read from the GPT instead of being fixed here — p2 only has to
# clear the BOOT_MIN_SIZE_MIB floor and land on a BOOT_ALIGN_MIB boundary, and
# the p3 start plus the FAT/rootfs extraction offsets follow from the partition
# entries. The total image size follows as 16 MiB pre-boot area + p2 + p3 +
# 1 MiB backup-GPT slack; the loader partition lives inside that head area and
# adds nothing to it.
DISK_GUID="5AC35760-0001-4000-8000-000000000000"
BOOT_GUID="5AC35760-0001-4000-8000-000000000001"
ROOTFS_GUID="5AC35760-0001-4000-8000-000000000002"
ESP_TYPE="${TYPECODE_ESP}"
LINUX_FS_DATA="${TYPECODE_LINUX}"
ROOTFS_UUID="5ac35760-0002-4000-8000-000000000002"
BOOT_PARTNUM=2
ROOTFS_PARTNUM=3
BOOT_FIRST_SECTOR=$((LOADER_START_SECTOR + LOADER_SIZE_SECTORS))
BOOT_MIN_SIZE_MIB=64
BOOT_ALIGN_MIB=4
UBOOT_OFFSET_BYTES=$((LOADER_START_SECTOR * SECTOR_SIZE))
FREE_FLOOR_BYTES=$((32 * 1024 * 1024))
KERNEL_VERSION="6.1.115"
APPEND_LINE="append root=PARTLABEL=rootfs rw console=ttyFIQ0,1500000 earlycon=uart8250,mmio32,0x2ad40000 storagemedia=emmc net.ifnames=0 rootwait"

UBOOT_SRC="${BOARD_DIR}/out/uboot/u-boot-rockchip.bin"
KERNEL_SRC="${BOARD_DIR}/out/kernel/Image"
DTB_SRC="${BOARD_DIR}/out/kernel/rk3576-src.dtb"

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
    IMG="${REPO_ROOT}/_out/cx3576/cx3576-mos-latest.img"
    EXPECT_SYMLINK=1
fi

if [ ! -e "${IMG}" ]; then
    echo "error: image not found: ${IMG}" >&2
    exit 1
fi

# Re-exec in a container when the host lacks any required tool.
REQUIRED_TOOLS=(sgdisk mdir mcopy debugfs tune2fs dumpe2fs e2fsck cmp)
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
            sh -c 'apk add --no-cache -q bash coreutils diffutils gptfdisk sgdisk dosfstools mtools e2fsprogs e2fsprogs-extra && exec bash /work/os/verify-image.sh "$@"' \
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

# --- check 0: default path must be the -latest symlink ---
if [ "${EXPECT_SYMLINK}" -eq 1 ]; then
    link_target="$(readlink "${IMG}" 2>/dev/null || true)"
    link_target="${link_target#./}"
    if [ -L "${IMG}" ] && [[ "${link_target}" =~ ^cx3576-mos-[0-9]+\.img$ ]]; then
        pass "default path is a symlink to ${link_target}"
    else
        fail "default path must be a symlink to cx3576-mos-<epoch>.img in the same directory (got: ${link_target:-not a symlink})"
    fi
fi

# --- GPT: sgdisk --verify ---
verify_out="$(sgdisk --verify "${IMG}" 2>&1 || true)"
complaints="$(echo "${verify_out}" | grep -E "Caution|Warning" | grep -Ev "doesn't (begin|end) on a|degraded performance" || true)"
if echo "${verify_out}" | grep -q "No problems found" &&
    ! echo "${verify_out}" | grep -Eq "problems!|Problem:|Creating new GPT entries|invalid GPT|damaged GPT" &&
    [ -z "${complaints}" ]; then
    pass "sgdisk --verify reports no problems"
else
    fail "sgdisk --verify reported problems: $(echo "${verify_out}" | tr '\n' ' ')"
fi

# --- GPT: disk GUID and partition count ---
ptable="$(sgdisk -p "${IMG}" 2>/dev/null || true)"
disk_guid="$(echo "${ptable}" | sed -n 's/^Disk identifier (GUID): //p')"
if [ "${disk_guid^^}" = "${DISK_GUID}" ]; then
    pass "disk GUID is ${DISK_GUID}"
else
    fail "disk GUID is '${disk_guid}', expected ${DISK_GUID}"
fi
part_count="$(echo "${ptable}" | grep -cE '^[[:space:]]+[0-9]+[[:space:]]' || true)"
if [ "${part_count}" = "3" ]; then
    pass "exactly 3 partitions"
else
    fail "found ${part_count} partitions, expected 3"
fi

# Extract one field from sgdisk -i output.
sg_field() {
    echo "$1" | sed -n "s/^$2: //p" | head -n1
}

# --- p1 (loader) ---
# The Rockchip idbloader area is a real GPT partition, and that is what stops
# systemd-repart from discarding it during first-boot growth. Every assertion
# here is against the ASSEMBLED image, because sgdisk is free to relocate a
# non-2048-aligned start and asserting the intent would hide exactly that.
pL="$(sgdisk -i "${LOADER_PARTNUM}" "${IMG}" 2>&1 || true)"
pL_name="$(sg_field "${pL}" "Partition name")"
if [ "${pL_name}" = "'${LOADER_LABEL}'" ]; then
    pass "p${LOADER_PARTNUM} name is '${LOADER_LABEL}'"
else
    fail "p${LOADER_PARTNUM} name is ${pL_name:-unreadable}, expected '${LOADER_LABEL}'"
fi
pL_first="$(sg_field "${pL}" "First sector" | awk '{print $1}')"
if [ "${pL_first}" = "${LOADER_START_SECTOR}" ]; then
    pass "p${LOADER_PARTNUM} first sector is ${LOADER_START_SECTOR} (where the RK3576 BootROM looks)"
else
    fail "p${LOADER_PARTNUM} first sector is '${pL_first}', expected ${LOADER_START_SECTOR}; sgdisk relocates a non-2048-aligned start unless -a ${GPT_ALIGN_SECTORS} is used, and a relocated loader partition leaves the bootloader in a discardable gap"
fi
pL_size="$(sg_field "${pL}" "Partition size" | awk '{print $1}')"
if [ "${pL_size}" = "${LOADER_SIZE_SECTORS}" ]; then
    pass "p${LOADER_PARTNUM} size is ${LOADER_SIZE_SECTORS} sectors"
else
    fail "p${LOADER_PARTNUM} size is '${pL_size}' sectors, expected ${LOADER_SIZE_SECTORS}"
fi
pL_type="$(sg_field "${pL}" "Partition GUID code" | awk '{print $1}')"
if [ "${pL_type^^}" = "${LOADER_TYPECODE}" ]; then
    pass "p${LOADER_PARTNUM} typecode is ${LOADER_TYPECODE} (Linux reserved)"
else
    fail "p${LOADER_PARTNUM} typecode is '${pL_type}', expected ${LOADER_TYPECODE}"
fi
# The distinct type is what keeps the loader out of systemd-repart's matching.
# /etc/repart.d ships exactly one definition, Type=linux-generic, so it can only
# ever pair with a linux-generic partition — demonstrated, not assumed, by
# counting them in the assembled GPT.
if [ "${pL_type^^}" != "${LINUX_FS_DATA}" ] && [ "${pL_type^^}" != "${ESP_TYPE}" ]; then
    pass "p${LOADER_PARTNUM} type differs from linux-generic and from the ESP type, so no repart definition can match it"
else
    fail "p${LOADER_PARTNUM} type '${pL_type}' collides with a type repart definitions use; the grow definition would attach to the loader"
fi
pL_guid="$(sg_field "${pL}" "Partition unique GUID")"
if [ "${pL_guid^^}" = "${LOADER_V1_GUID}" ]; then
    pass "p${LOADER_PARTNUM} GUID is ${LOADER_V1_GUID}"
else
    fail "p${LOADER_PARTNUM} GUID is '${pL_guid}', expected ${LOADER_V1_GUID}"
fi
# The partition must abut the boot partition: a gap between them would be a
# region no entry covers, which is the state repart discards.
if [[ "${pL_first}" =~ ^[0-9]+$ ]] && [[ "${pL_size}" =~ ^[0-9]+$ ]] &&
    [ $((pL_first + pL_size)) -eq "${BOOT_FIRST_SECTOR}" ]; then
    pass "p${LOADER_PARTNUM} ends exactly where the boot partition begins (sector ${BOOT_FIRST_SECTOR}), leaving no untracked gap"
else
    fail "p${LOADER_PARTNUM} ends at sector $((${pL_first:-0} + ${pL_size:-0})) but the boot partition starts at ${BOOT_FIRST_SECTOR}"
fi
# The first byte of the partition must be the idbloader magic.
loader_magic="$(dd if="${IMG}" bs="${SECTOR_SIZE}" skip="${LOADER_START_SECTOR}" count=1 status=none 2>/dev/null | od -An -tx1 -N4 | tr -d ' \n' || true)"
if [ "${loader_magic}" = "${LOADER_MAGIC_HEX}" ]; then
    pass "p${LOADER_PARTNUM} starts with the Rockchip idbloader magic ${LOADER_MAGIC_HEX} ('RKNS')"
else
    fail "p${LOADER_PARTNUM} starts with '${loader_magic}', expected the idbloader magic ${LOADER_MAGIC_HEX} ('RKNS')"
fi

# --- p2 (boot) ---
p1="$(sgdisk -i "${BOOT_PARTNUM}" "${IMG}" 2>&1 || true)"
p1_name="$(sg_field "${p1}" "Partition name")"
if [ "${p1_name}" = "'boot'" ]; then
    pass "p${BOOT_PARTNUM} name is 'boot'"
else
    fail "p${BOOT_PARTNUM} name is ${p1_name:-unreadable}, expected 'boot'"
fi
p1_first="$(sg_field "${p1}" "First sector" | awk '{print $1}')"
if [ "${p1_first}" = "${BOOT_FIRST_SECTOR}" ]; then
    pass "p${BOOT_PARTNUM} first sector is ${BOOT_FIRST_SECTOR} (16 MiB)"
else
    fail "p${BOOT_PARTNUM} first sector is '${p1_first}', expected ${BOOT_FIRST_SECTOR}"
fi
if [[ "${p1_first}" =~ ^[0-9]+$ ]]; then
    FAT_OFFSET_BYTES=$((p1_first * 512))
else
    FAT_OFFSET_BYTES=$((BOOT_FIRST_SECTOR * 512))
fi
p1_size="$(sg_field "${p1}" "Partition size" | awk '{print $1}')"
if [[ "${p1_size}" =~ ^[0-9]+$ ]] && [ $((p1_size % 2048)) -eq 0 ] &&
    [ "${p1_size}" -ge $((BOOT_MIN_SIZE_MIB * 2048)) ]; then
    BOOT_SIZE_MIB=$((p1_size / 2048))
    pass "p${BOOT_PARTNUM} size is ${p1_size} sectors (${BOOT_SIZE_MIB} MiB, whole-MiB and >= ${BOOT_MIN_SIZE_MIB} MiB floor)"
else
    BOOT_SIZE_MIB=0
    fail "p${BOOT_PARTNUM} size is '${p1_size}' sectors, expected a whole-MiB multiple of at least ${BOOT_MIN_SIZE_MIB} MiB"
fi
if [ "${BOOT_SIZE_MIB}" -gt 0 ] && [ $((BOOT_SIZE_MIB % BOOT_ALIGN_MIB)) -eq 0 ]; then
    pass "p${BOOT_PARTNUM} size ${BOOT_SIZE_MIB} MiB is a multiple of ${BOOT_ALIGN_MIB} MiB"
else
    fail "p${BOOT_PARTNUM} size ${BOOT_SIZE_MIB} MiB is not a multiple of ${BOOT_ALIGN_MIB} MiB"
fi
p1_attrs="$(sg_field "${p1}" "Attribute flags")"
if [[ "${p1_attrs}" =~ ^[0-9A-Fa-f]+$ ]] && [ $((16#${p1_attrs} & 4)) -ne 0 ]; then
    pass "p${BOOT_PARTNUM} attribute bit 2 is set (flags ${p1_attrs})"
else
    fail "p${BOOT_PARTNUM} attribute bit 2 not set (flags '${p1_attrs}')"
fi
p1_type="$(sg_field "${p1}" "Partition GUID code" | awk '{print $1}')"
if [ "${p1_type^^}" = "${ESP_TYPE}" ]; then
    pass "p${BOOT_PARTNUM} typecode is ${ESP_TYPE} (ESP)"
else
    fail "p${BOOT_PARTNUM} typecode is '${p1_type}', expected ${ESP_TYPE} (ESP)"
fi
p1_guid="$(sg_field "${p1}" "Partition unique GUID")"
if [ "${p1_guid^^}" = "${BOOT_GUID}" ]; then
    pass "p${BOOT_PARTNUM} GUID is ${BOOT_GUID}"
else
    fail "p${BOOT_PARTNUM} GUID is '${p1_guid}', expected ${BOOT_GUID}"
fi
fat_sig="$(dd if="${IMG}" skip=$((FAT_OFFSET_BYTES + 82)) count=5 iflag=skip_bytes,count_bytes status=none 2>/dev/null || true)"
if [ "${fat_sig}" = "FAT32" ]; then
    pass "p${BOOT_PARTNUM} has a FAT32 boot sector signature at $((FAT_OFFSET_BYTES / 1048576)) MiB"
else
    fail "p${BOOT_PARTNUM} FAT32 signature not found at offset $((FAT_OFFSET_BYTES / 1048576)) MiB + 82"
fi

# --- p3 (rootfs) ---
p2="$(sgdisk -i "${ROOTFS_PARTNUM}" "${IMG}" 2>&1 || true)"
p2_name="$(sg_field "${p2}" "Partition name")"
if [ "${p2_name}" = "'rootfs'" ]; then
    pass "p${ROOTFS_PARTNUM} name is 'rootfs'"
else
    fail "p${ROOTFS_PARTNUM} name is ${p2_name:-unreadable}, expected 'rootfs'"
fi
p2_first="$(sg_field "${p2}" "First sector" | awk '{print $1}')"
ROOTFS_FIRST_SECTOR=$(((BOOT_FIRST_SECTOR / 2048 + BOOT_SIZE_MIB) * 2048))
if [ "${BOOT_SIZE_MIB}" -gt 0 ] && [ "${p2_first}" = "${ROOTFS_FIRST_SECTOR}" ]; then
    ROOTFS_OFFSET_MIB=$((p2_first / 2048))
    pass "p${ROOTFS_PARTNUM} first sector is ${ROOTFS_FIRST_SECTOR} (${ROOTFS_OFFSET_MIB} MiB, right after p${BOOT_PARTNUM})"
else
    ROOTFS_OFFSET_MIB=0
    fail "p${ROOTFS_PARTNUM} first sector is '${p2_first}', expected ${ROOTFS_FIRST_SECTOR} (16 MiB pre-boot + ${BOOT_SIZE_MIB} MiB boot)"
fi
p2_size="$(sg_field "${p2}" "Partition size" | awk '{print $1}')"
if [[ "${p2_size}" =~ ^[0-9]+$ ]] && [ "${p2_size}" -gt 0 ] && [ $((p2_size % 2048)) -eq 0 ]; then
    ROOTFS_SIZE_MIB=$((p2_size / 2048))
    pass "p${ROOTFS_PARTNUM} size is ${p2_size} sectors (${ROOTFS_SIZE_MIB} MiB, a whole-MiB multiple)"
else
    ROOTFS_SIZE_MIB=0
    fail "p${ROOTFS_PARTNUM} size is '${p2_size}' sectors, expected a positive whole-MiB multiple"
fi
p2_type="$(sg_field "${p2}" "Partition GUID code" | awk '{print $1}')"
if [ "${p2_type^^}" = "${LINUX_FS_DATA}" ]; then
    pass "p${ROOTFS_PARTNUM} typecode is ${LINUX_FS_DATA}"
else
    fail "p${ROOTFS_PARTNUM} typecode is '${p2_type}', expected ${LINUX_FS_DATA}"
fi
p2_guid="$(sg_field "${p2}" "Partition unique GUID")"
if [ "${p2_guid^^}" = "${ROOTFS_GUID}" ]; then
    pass "p${ROOTFS_PARTNUM} GUID is ${ROOTFS_GUID}"
else
    fail "p${ROOTFS_PARTNUM} GUID is '${p2_guid}', expected ${ROOTFS_GUID}"
fi

# repart matches definitions to partitions BY TYPE UUID in disk order, so the
# claim "no definition can attach to the loader" reduces to a countable fact:
# the image must carry exactly as many linux-generic partitions as the rootfs
# ships definitions, and the loader must not be one of them. Counted from the
# assembled GPT rather than assumed.
linux_generic_n=0
for n in $(seq 1 "${part_count:-0}"); do
    t="$(sgdisk -i "${n}" "${IMG}" 2>/dev/null | sed -n 's/^Partition GUID code: //p' | awk '{print $1}')"
    if [ "${t^^}" = "${LINUX_FS_DATA}" ]; then
        linux_generic_n=$((linux_generic_n + 1))
    fi
done
if [ "${linux_generic_n}" = "1" ]; then
    pass "exactly 1 linux-generic partition on the disk (the rootfs), matching the single /etc/repart.d definition; the loader's ${LOADER_TYPECODE} type is unmatchable"
else
    fail "found ${linux_generic_n} linux-generic partitions, expected 1; /etc/repart.d ships one definition and repart pairs by type UUID in disk order, so any other count attaches growth to the wrong partition"
fi

# --- image size: 16 MiB pre-boot (which the loader partition covers) + p2 + p3
#     + 1 MiB backup-GPT slack ---
pre_boot_mib=$((BOOT_FIRST_SECTOR / 2048))
expected_size=$(((pre_boot_mib + BOOT_SIZE_MIB + ROOTFS_SIZE_MIB + 1) * 1024 * 1024))
size_terms="${pre_boot_mib} + ${BOOT_SIZE_MIB} + ${ROOTFS_SIZE_MIB} + 1 MiB"
actual_size="$(stat -Lc %s "${IMG}" 2>/dev/null || echo 0)"
if [ "${BOOT_SIZE_MIB}" -gt 0 ] && [ "${ROOTFS_SIZE_MIB}" -gt 0 ] && [ "${actual_size}" = "${expected_size}" ]; then
    pass "image size is ${expected_size} bytes (${size_terms})"
else
    fail "image size is ${actual_size} bytes, expected ${expected_size} (${size_terms})"
fi

# --- raw u-boot at sector 64, inside the loader partition ---
if [ ! -f "${UBOOT_SRC}" ]; then
    fail "u-boot compare source not found: ${UBOOT_SRC}"
    fail "u-boot containment check skipped (compare source missing)"
else
    uboot_size="$(stat -c %s "${UBOOT_SRC}")"
    if dd if="${IMG}" skip="${UBOOT_OFFSET_BYTES}" count="${uboot_size}" iflag=skip_bytes,count_bytes status=none 2>/dev/null |
        cmp -s - "${UBOOT_SRC}"; then
        pass "u-boot at sector ${LOADER_START_SECTOR} matches ${UBOOT_SRC}"
    else
        fail "u-boot at sector ${LOADER_START_SECTOR} differs from ${UBOOT_SRC}"
    fi
    # Containment with room to spare: the blob must end inside the partition,
    # not merely start in it.
    loader_bytes=$((LOADER_SIZE_SECTORS * SECTOR_SIZE))
    if [ "${uboot_size}" -lt "${loader_bytes}" ]; then
        pass "u-boot (${uboot_size} bytes) fits inside p${LOADER_PARTNUM} (${loader_bytes} bytes) with $((loader_bytes - uboot_size)) bytes to spare"
    else
        fail "u-boot is ${uboot_size} bytes but p${LOADER_PARTNUM} is only ${loader_bytes} bytes; the blob would run past the end of its own partition into ${UENV_A_LABEL}"
    fi
fi

# --- FAT boot partition contents (mtools at offset) ---
FAT_IMG="${IMG}@@${FAT_OFFSET_BYTES}"

# Extract a FAT file and byte-compare it to a BSP source file.
fat_cmp() {
    local name="$1" src="$2" out
    out="${TMP}/fat-$(basename "$1")"
    if ! mcopy -n -i "${FAT_IMG}" "::${name}" "${out}" 2>/dev/null; then
        fail "FAT ${name} missing or unreadable"
        return
    fi
    if [ ! -f "${src}" ]; then
        fail "FAT ${name} compare source not found: ${src}"
        return
    fi
    if cmp -s "${out}" "${src}"; then
        pass "FAT ${name} matches ${src}"
    else
        fail "FAT ${name} differs from ${src}"
    fi
}
fat_cmp /Image "${KERNEL_SRC}"
fat_cmp /rk3576-src.dtb "${DTB_SRC}"

fat_listing="$(mdir -/ -b -i "${FAT_IMG}" ::/ 2>/dev/null || true)"
if [ -z "${fat_listing}" ]; then
    fail "FAT filesystem unreadable (cannot list files)"
elif echo "${fat_listing}" | grep -qi "initr"; then
    fail "FAT contains an initramfs/initrd file: $(echo "${fat_listing}" | grep -i initr | tr '\n' ' ')"
else
    pass "FAT contains no initramfs file"
fi

EXTLINUX="${TMP}/extlinux.conf"
if mcopy -n -i "${FAT_IMG}" ::/extlinux/extlinux.conf "${EXTLINUX}" 2>/dev/null; then
    pass "FAT /extlinux/extlinux.conf present"
    if grep -q "kernel /Image" "${EXTLINUX}"; then
        pass "extlinux.conf has 'kernel /Image'"
    else
        fail "extlinux.conf lacks 'kernel /Image'"
    fi
    if grep -q "fdt /rk3576-src.dtb" "${EXTLINUX}"; then
        pass "extlinux.conf has 'fdt /rk3576-src.dtb'"
    else
        fail "extlinux.conf lacks 'fdt /rk3576-src.dtb'"
    fi
    if sed 's/^[[:space:]]*//' "${EXTLINUX}" | grep -qFx "${APPEND_LINE}"; then
        pass "extlinux.conf append line matches the contract exactly"
    else
        fail "extlinux.conf append line does not match: expected '${APPEND_LINE}'"
    fi
    if grep -Eq '^[[:space:]]*initrd([[:space:]]|$)' "${EXTLINUX}"; then
        fail "extlinux.conf contains an initrd line"
    else
        pass "extlinux.conf has no initrd line"
    fi
else
    fail "FAT /extlinux/extlinux.conf missing or unreadable"
    fail "extlinux.conf 'kernel /Image' check skipped (file missing)"
    fail "extlinux.conf 'fdt /rk3576-src.dtb' check skipped (file missing)"
    fail "extlinux.conf append line check skipped (file missing)"
    fail "extlinux.conf initrd-line check skipped (file missing)"
fi

# --- p3 ext4 rootfs ---
P2_IMG="${TMP}/p3.img"
dd if="${IMG}" of="${P2_IMG}" bs=1M skip="${ROOTFS_OFFSET_MIB}" count="${ROOTFS_SIZE_MIB}" \
    conv=sparse status=none 2>/dev/null || true

e2info="$(tune2fs -l "${P2_IMG}" 2>/dev/null || true)"
e2label="$(echo "${e2info}" | sed -n 's/^Filesystem volume name:[[:space:]]*//p')"
if [ "${e2label}" = "rootfs" ]; then
    pass "p${ROOTFS_PARTNUM} ext4 label is 'rootfs'"
else
    fail "p${ROOTFS_PARTNUM} ext4 label is '${e2label}', expected 'rootfs'"
fi
e2uuid="$(echo "${e2info}" | sed -n 's/^Filesystem UUID:[[:space:]]*//p')"
if [ "${e2uuid,,}" = "${ROOTFS_UUID}" ]; then
    pass "p${ROOTFS_PARTNUM} ext4 UUID is ${ROOTFS_UUID}"
else
    fail "p${ROOTFS_PARTNUM} ext4 UUID is '${e2uuid}', expected ${ROOTFS_UUID}"
fi

# Filesystem geometry and health: the packed ext4 must exactly fill p3, pass
# fsck, and keep the early-boot free-space margin (writes before repart/growfs).
e2fs_header="$(dumpe2fs -h "${P2_IMG}" 2>/dev/null || true)"
block_count="$(echo "${e2fs_header}" | sed -n 's/^Block count:[[:space:]]*//p')"
block_size="$(echo "${e2fs_header}" | sed -n 's/^Block size:[[:space:]]*//p')"
free_blocks="$(echo "${e2fs_header}" | sed -n 's/^Free blocks:[[:space:]]*//p')"
p2_bytes=$((ROOTFS_SIZE_MIB * 1024 * 1024))
fs_bytes=$((${block_count:-0} * ${block_size:-0}))
if [ "${fs_bytes}" -gt 0 ] && [ "${fs_bytes}" -eq "${p2_bytes}" ]; then
    pass "p${ROOTFS_PARTNUM} ext4 size (${block_count} blocks x ${block_size} bytes) matches the partition size"
else
    fail "p${ROOTFS_PARTNUM} ext4 size is ${fs_bytes} bytes, expected ${p2_bytes} (partition size)"
fi
free_bytes=$((${free_blocks:-0} * ${block_size:-0}))
if [ "${free_bytes}" -ge "${FREE_FLOOR_BYTES}" ]; then
    pass "p${ROOTFS_PARTNUM} free space is $((free_bytes / 1048576)) MiB (>= 32 MiB early-boot floor)"
else
    fail "p${ROOTFS_PARTNUM} free space is ${free_bytes} bytes, below the 32 MiB early-boot floor"
fi
if e2fsck -fn "${P2_IMG}" >/dev/null 2>&1; then
    pass "e2fsck -fn on p${ROOTFS_PARTNUM} is clean"
else
    fail "e2fsck -fn on p${ROOTFS_PARTNUM} reported errors"
fi

# Run a single debugfs command against the extracted p3.
dbg() {
    debugfs -R "$1" "${P2_IMG}" 2>/dev/null || true
}

modules_entries="$(dbg "ls -p /usr/lib/modules" | awk -F/ 'NF >= 7 && $6 != "." && $6 != ".." {print $6}')"
if [ "${modules_entries}" = "${KERNEL_VERSION}" ]; then
    pass "/usr/lib/modules contains exactly ${KERNEL_VERSION}"
else
    fail "/usr/lib/modules entries: '$(echo "${modules_entries}" | tr '\n' ' ')', expected exactly ${KERNEL_VERSION}"
fi

# Assert an ext4 path is a regular file.
ext_regular() {
    local path="$1"
    if dbg "stat ${path}" | grep -q "Type: regular"; then
        pass "${path} is a regular file"
    else
        fail "${path} missing or not a regular file"
    fi
}
ext_regular /usr/lib/firmware/fw_bcm43752a2_ag.bin
ext_regular /usr/lib/firmware/nvram_ap6275s.txt
ext_regular /usr/lib/firmware/clm_bcm43752a2_ag.blob
ext_regular /usr/lib/systemd/systemd

# Assert an ext4 path is a symlink pointing at the given target basename.
ext_symlink() {
    local path="$1" target="$2" out dest
    out="$(dbg "stat ${path}")"
    dest="$(echo "${out}" | sed -n 's/.*link dest: "\(.*\)".*/\1/p' | head -n1)"
    if echo "${out}" | grep -q "Type: symlink"; then
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
ext_symlink /usr/lib/firmware/fw_bcmdhd.bin fw_bcm43752a2_ag.bin
ext_symlink /usr/lib/firmware/nvram.txt nvram_ap6275s.txt
ext_symlink /usr/lib/firmware/clm_bcmdhd.blob clm_bcm43752a2_ag.blob

if dbg "stat /etc/systemd/system/multi-user.target.wants/ssh.service" | grep -q "Inode:"; then
    pass "ssh.service is enabled (multi-user.target.wants)"
else
    fail "ssh.service enablement symlink missing"
fi
if dbg "stat /etc/systemd/system/multi-user.target.wants/systemd-networkd.service" | grep -q "Inode:" ||
    dbg "stat /etc/systemd/system/dbus-org.freedesktop.network1.service" | grep -q "Inode:"; then
    pass "systemd-networkd is enabled"
else
    fail "systemd-networkd enablement symlink missing"
fi
if dbg "cat /etc/systemd/network/80-dhcp.network" | grep -q "DHCP=yes"; then
    pass "/etc/systemd/network/80-dhcp.network has DHCP=yes"
else
    fail "/etc/systemd/network/80-dhcp.network missing or lacks DHCP=yes"
fi
repart_conf="$(dbg "cat /etc/repart.d/50-rootfs.conf")"
if echo "${repart_conf}" | grep -qF "[Partition]" &&
    echo "${repart_conf}" | grep -q "Type=linux-generic"; then
    pass "/etc/repart.d/50-rootfs.conf has [Partition] and Type=linux-generic"
else
    fail "/etc/repart.d/50-rootfs.conf missing or lacks [Partition]/Type=linux-generic"
fi
if dbg "cat /etc/fstab" |
    awk '$1 == "PARTLABEL=rootfs" && $2 == "/" && $3 == "ext4" && $4 ~ /(^|,)x-systemd\.growfs(,|$)/ {found = 1} END {exit !found}'; then
    pass "/etc/fstab has a PARTLABEL=rootfs / ext4 entry with x-systemd.growfs"
else
    fail "/etc/fstab lacks a PARTLABEL=rootfs / ext4 entry with x-systemd.growfs"
fi
if dbg "cat /etc/systemd/journald.conf.d/00-volatile.conf" | grep -q "Storage=volatile"; then
    pass "/etc/systemd/journald.conf.d/00-volatile.conf has Storage=volatile"
else
    fail "/etc/systemd/journald.conf.d/00-volatile.conf missing or lacks Storage=volatile"
fi

# --- mosd daemon integration ---
ext_regular /usr/bin/mosd
MOSD_BIN="${TMP}/mosd-bin"
dbg "dump /usr/bin/mosd ${MOSD_BIN}" >/dev/null
elf_head="$(od -An -tx1 -N20 "${MOSD_BIN}" 2>/dev/null | tr -d ' \n')"
# ELF magic 7f454c46; e_machine at offset 18 is 0xB7 (aarch64, little-endian).
if [ "${elf_head:0:8}" = "7f454c46" ] && [ "${elf_head:36:4}" = "b700" ]; then
    pass "/usr/bin/mosd is an aarch64 ELF"
else
    fail "/usr/bin/mosd is not an aarch64 ELF (header: '${elf_head:0:40}')"
fi
if dbg "cat /usr/lib/systemd/system/mosd.service" | grep -q "BusName=com.mos.mosd"; then
    pass "/usr/lib/systemd/system/mosd.service present with BusName=com.mos.mosd"
else
    fail "/usr/lib/systemd/system/mosd.service missing or lacks BusName=com.mos.mosd"
fi
if dbg "stat /etc/systemd/system/multi-user.target.wants/mosd.service" | grep -q "Inode:"; then
    pass "mosd.service is enabled (multi-user.target.wants)"
else
    fail "mosd.service enablement symlink missing"
fi
ext_regular /usr/share/dbus-1/system.d/com.mos.mosd.conf

# --- webd daemon integration ---
ext_regular /usr/bin/webd
WEBD_BIN="${TMP}/webd-bin"
dbg "dump /usr/bin/webd ${WEBD_BIN}" >/dev/null
elf_head="$(od -An -tx1 -N20 "${WEBD_BIN}" 2>/dev/null | tr -d ' \n')"
# ELF magic 7f454c46; e_machine at offset 18 is 0xB7 (aarch64, little-endian).
if [ "${elf_head:0:8}" = "7f454c46" ] && [ "${elf_head:36:4}" = "b700" ]; then
    pass "/usr/bin/webd is an aarch64 ELF"
else
    fail "/usr/bin/webd is not an aarch64 ELF (header: '${elf_head:0:40}')"
fi
webd_unit="$(dbg "cat /usr/lib/systemd/system/webd.service")"
if echo "${webd_unit}" | grep -q "After=.*mosd.service"; then
    pass "/usr/lib/systemd/system/webd.service orders After= mosd.service"
else
    fail "/usr/lib/systemd/system/webd.service missing or lacks After=...mosd.service"
fi
if echo "${webd_unit}" | grep -q "StateDirectory=mos/webd"; then
    pass "/usr/lib/systemd/system/webd.service has StateDirectory=mos/webd"
else
    fail "/usr/lib/systemd/system/webd.service missing or lacks StateDirectory=mos/webd"
fi
if dbg "stat /etc/systemd/system/multi-user.target.wants/webd.service" | grep -q "Inode:"; then
    pass "webd.service is enabled (multi-user.target.wants)"
else
    fail "webd.service enablement symlink missing"
fi

# --- board hardware init ---
modules_conf="$(dbg "cat /etc/mos/modules.conf")"
if echo "${modules_conf}" | grep -q "bcmdhd" && echo "${modules_conf}" | grep -q "aic8800_fdrv"; then
    pass "/etc/mos/modules.conf lists bcmdhd and aic8800_fdrv"
else
    fail "/etc/mos/modules.conf missing or lacks bcmdhd/aic8800_fdrv"
fi
ext_regular /etc/mos/otg.conf
ext_regular /etc/mos/can.conf
ext_regular /etc/mos/bt.conf
ext_regular /etc/mos/mac.conf
ext_regular /etc/mos/gadget.conf
for u in mos-modules mos-otg mos-can mos-bt mos-mac mos-gadget; do
    ext_regular "/usr/lib/systemd/system/${u}.service"
    if dbg "stat /etc/systemd/system/multi-user.target.wants/${u}.service" | grep -q "Inode:"; then
        pass "${u}.service is enabled (multi-user.target.wants)"
    else
        fail "${u}.service enablement symlink missing"
    fi
done
ext_regular /usr/bin/btattach
ext_symlink /usr/lib/firmware/brcm/BCM4362A2.hcd SYN43756B0.hcd

# CAN: classic CAN at 250 kbit/s with CAN FD off (board bring-up facts).
can_conf="$(dbg "cat /etc/mos/can.conf")"
if echo "${can_conf}" | grep -qx "bitrate=250000" && \
   echo "${can_conf}" | grep -qx "fd=off"; then
    pass "/etc/mos/can.conf sets bitrate 250000 and fd off"
else
    fail "/etc/mos/can.conf must set bitrate=250000 and fd=off"
fi

# BT: verified AIC8800D80 combination (H:4 at 1.5 Mbit/s on UART4).
bt_conf="$(dbg "cat /etc/mos/bt.conf")"
if echo "${bt_conf}" | grep -qx "uart=/dev/ttyS4" && \
   echo "${bt_conf}" | grep -qx "proto=h4" && \
   echo "${bt_conf}" | grep -qx "speed=1500000"; then
    pass "/etc/mos/bt.conf sets the verified AIC8800D80 attach parameters"
else
    fail "/etc/mos/bt.conf must set uart=/dev/ttyS4, proto=h4, speed=1500000"
fi
if echo "${modules_conf}" | grep -qx "aic8800_btlpm"; then
    pass "/etc/mos/modules.conf lists aic8800_btlpm (BT core of the combo chip)"
else
    fail "/etc/mos/modules.conf lacks aic8800_btlpm"
fi

# USB OTG: role must stay "otg" so attaching a host PC brings up the gadget.
if dbg "cat /etc/mos/otg.conf" | grep -qx "mode=otg"; then
    pass "/etc/mos/otg.conf sets mode=otg (gadget enumerates on host attach)"
else
    fail "/etc/mos/otg.conf must set mode=otg"
fi

# Stable MAC derivation from the eMMC CID.
if dbg "cat /etc/mos/mac.conf" | grep -qx "seed=/sys/block/mmcblk0/device/cid"; then
    pass "/etc/mos/mac.conf derives MACs from the eMMC CID"
else
    fail "/etc/mos/mac.conf must set seed=/sys/block/mmcblk0/device/cid"
fi
for h in hwinit-mac hwinit-gadget; do
    ext_regular "/usr/lib/mos/${h}"
done
ext_regular /usr/lib/udev/rules.d/60-mos-gadget-getty.rules
if dbg "cat /usr/lib/udev/rules.d/60-mos-gadget-getty.rules" | \
        grep -q "serial-getty@ttyGS0.service"; then
    pass "udev rule pulls in serial-getty@ttyGS0 when the gadget enumerates"
else
    fail "udev rule missing the serial-getty@ttyGS0 SYSTEMD_WANTS"
fi

# Bluetooth adapter name: bluez's hostname plugin overrides Name and falls back
# to the system hostname, so main.conf must not pin a Name of its own.
if dbg "cat /etc/bluetooth/main.conf" | grep -qE "^[[:space:]]*Name[[:space:]]*="; then
    fail "/etc/bluetooth/main.conf pins Name (blocks the hostname plugin)"
else
    pass "/etc/bluetooth/main.conf leaves Name to the hostname plugin"
fi
if dbg "stat /etc/systemd/system/bluetooth.target.wants/bluetooth.service" | \
        grep -q "Inode:"; then
    pass "bluetooth.service is enabled"
else
    fail "bluetooth.service enablement symlink missing"
fi
if dbg "stat /etc/modules-load.d/wifi.conf" | grep -q "Inode:"; then
    fail "/etc/modules-load.d/wifi.conf still present (superseded by mos-modules)"
else
    pass "/etc/modules-load.d/wifi.conf is gone (superseded by mos-modules)"
fi

# --- summary ---
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} checks)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} checks)"
    exit 1
fi
