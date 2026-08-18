#!/usr/bin/env bash
set -euo pipefail

# Verifies a cx3576 mos disk image against the PLAN-010 M1 image contract:
# GPT layout, raw u-boot, FAT boot partition contents and the Debian systemd
# rootfs on p2, plus the mosd daemon integration (binary, unit, D-Bus policy).
# Emits one PASS:/FAIL: line per check and a final
# "RESULT: PASS|FAIL (n/m checks)" summary; exits non-zero if any check fails.
# Expected total on the default path: 47 checks (42 for the M1 contract + 5
# for mosd).
#
# No loop mounts and no --privileged: GPT is inspected with sgdisk, the FAT
# partition with mtools at an offset, and the ext4 partition by dd-extracting
# it to a temp file and reading it with debugfs/tune2fs. When the host lacks
# the required tools the whole verification re-executes inside an Alpine
# container (same pattern as hack/cx3576/mkimage.sh).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
BOARD_DIR="${BOARD_DIR:-${REPO_ROOT}/board/cx3576}"

# Image contract constants.
TOTAL_SIZE_BYTES=$((1554 * 1024 * 1024))
DISK_GUID="5AC35760-0001-4000-8000-000000000000"
BOOT_GUID="5AC35760-0001-4000-8000-000000000001"
ROOTFS_GUID="5AC35760-0001-4000-8000-000000000002"
ESP_TYPE="C12A7328-F81F-11D2-BA4B-00A0C93EC93B"
LINUX_FS_DATA="0FC63DAF-8483-4772-8E79-3D69D8477DE4"
ROOTFS_UUID="5ac35760-0002-4000-8000-000000000002"
BOOT_FIRST_SECTOR=32768
BOOT_SIZE_SECTORS=$((512 * 2048))
ROOTFS_FIRST_SECTOR=1081344
ROOTFS_SIZE_SECTORS=$((1024 * 2048))
UBOOT_OFFSET_BYTES=$((64 * 512))
FAT_OFFSET_BYTES=$((16 * 1024 * 1024))
ROOTFS_OFFSET_MIB=528
ROOTFS_SIZE_MIB=1024
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
REQUIRED_TOOLS=(sgdisk mdir mcopy debugfs tune2fs cmp)
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

# --- image size ---
actual_size="$(stat -Lc %s "${IMG}" 2>/dev/null || echo 0)"
if [ "${actual_size}" = "${TOTAL_SIZE_BYTES}" ]; then
    pass "image size is ${TOTAL_SIZE_BYTES} bytes (1554 MiB)"
else
    fail "image size is ${actual_size} bytes, expected ${TOTAL_SIZE_BYTES} (1554 MiB)"
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
if [ "${part_count}" = "2" ]; then
    pass "exactly 2 partitions"
else
    fail "found ${part_count} partitions, expected 2"
fi

# Extract one field from sgdisk -i output.
sg_field() {
    echo "$1" | sed -n "s/^$2: //p" | head -n1
}

# --- p1 (boot) ---
p1="$(sgdisk -i 1 "${IMG}" 2>&1 || true)"
p1_name="$(sg_field "${p1}" "Partition name")"
if [ "${p1_name}" = "'boot'" ]; then
    pass "p1 name is 'boot'"
else
    fail "p1 name is ${p1_name:-unreadable}, expected 'boot'"
fi
p1_first="$(sg_field "${p1}" "First sector" | awk '{print $1}')"
if [ "${p1_first}" = "${BOOT_FIRST_SECTOR}" ]; then
    pass "p1 first sector is ${BOOT_FIRST_SECTOR} (16 MiB)"
else
    fail "p1 first sector is '${p1_first}', expected ${BOOT_FIRST_SECTOR}"
fi
p1_size="$(sg_field "${p1}" "Partition size" | awk '{print $1}')"
if [ "${p1_size}" = "${BOOT_SIZE_SECTORS}" ]; then
    pass "p1 size is ${BOOT_SIZE_SECTORS} sectors (512 MiB)"
else
    fail "p1 size is '${p1_size}' sectors, expected ${BOOT_SIZE_SECTORS} (512 MiB)"
fi
p1_attrs="$(sg_field "${p1}" "Attribute flags")"
if [[ "${p1_attrs}" =~ ^[0-9A-Fa-f]+$ ]] && [ $((16#${p1_attrs} & 4)) -ne 0 ]; then
    pass "p1 attribute bit 2 is set (flags ${p1_attrs})"
else
    fail "p1 attribute bit 2 not set (flags '${p1_attrs}')"
fi
p1_type="$(sg_field "${p1}" "Partition GUID code" | awk '{print $1}')"
if [ "${p1_type^^}" = "${ESP_TYPE}" ]; then
    pass "p1 typecode is ${ESP_TYPE} (ESP)"
else
    fail "p1 typecode is '${p1_type}', expected ${ESP_TYPE} (ESP)"
fi
p1_guid="$(sg_field "${p1}" "Partition unique GUID")"
if [ "${p1_guid^^}" = "${BOOT_GUID}" ]; then
    pass "p1 GUID is ${BOOT_GUID}"
else
    fail "p1 GUID is '${p1_guid}', expected ${BOOT_GUID}"
fi
fat_sig="$(dd if="${IMG}" skip=$((FAT_OFFSET_BYTES + 82)) count=5 iflag=skip_bytes,count_bytes status=none 2>/dev/null || true)"
if [ "${fat_sig}" = "FAT32" ]; then
    pass "p1 has a FAT32 boot sector signature"
else
    fail "p1 FAT32 signature not found at offset 16 MiB + 82"
fi

# --- p2 (rootfs) ---
p2="$(sgdisk -i 2 "${IMG}" 2>&1 || true)"
p2_name="$(sg_field "${p2}" "Partition name")"
if [ "${p2_name}" = "'rootfs'" ]; then
    pass "p2 name is 'rootfs'"
else
    fail "p2 name is ${p2_name:-unreadable}, expected 'rootfs'"
fi
p2_first="$(sg_field "${p2}" "First sector" | awk '{print $1}')"
if [ "${p2_first}" = "${ROOTFS_FIRST_SECTOR}" ]; then
    pass "p2 first sector is ${ROOTFS_FIRST_SECTOR} (528 MiB)"
else
    fail "p2 first sector is '${p2_first}', expected ${ROOTFS_FIRST_SECTOR}"
fi
p2_size="$(sg_field "${p2}" "Partition size" | awk '{print $1}')"
if [ "${p2_size}" = "${ROOTFS_SIZE_SECTORS}" ]; then
    pass "p2 size is ${ROOTFS_SIZE_SECTORS} sectors (1024 MiB)"
else
    fail "p2 size is '${p2_size}' sectors, expected ${ROOTFS_SIZE_SECTORS} (1024 MiB)"
fi
p2_type="$(sg_field "${p2}" "Partition GUID code" | awk '{print $1}')"
if [ "${p2_type^^}" = "${LINUX_FS_DATA}" ]; then
    pass "p2 typecode is ${LINUX_FS_DATA}"
else
    fail "p2 typecode is '${p2_type}', expected ${LINUX_FS_DATA}"
fi
p2_guid="$(sg_field "${p2}" "Partition unique GUID")"
if [ "${p2_guid^^}" = "${ROOTFS_GUID}" ]; then
    pass "p2 GUID is ${ROOTFS_GUID}"
else
    fail "p2 GUID is '${p2_guid}', expected ${ROOTFS_GUID}"
fi

# --- raw u-boot at sector 64 ---
if [ ! -f "${UBOOT_SRC}" ]; then
    fail "u-boot compare source not found: ${UBOOT_SRC}"
else
    uboot_size="$(stat -c %s "${UBOOT_SRC}")"
    if dd if="${IMG}" skip="${UBOOT_OFFSET_BYTES}" count="${uboot_size}" iflag=skip_bytes,count_bytes status=none 2>/dev/null |
        cmp -s - "${UBOOT_SRC}"; then
        pass "u-boot at sector 64 matches ${UBOOT_SRC}"
    else
        fail "u-boot at sector 64 differs from ${UBOOT_SRC}"
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

# --- p2 ext4 rootfs ---
P2_IMG="${TMP}/p2.img"
dd if="${IMG}" of="${P2_IMG}" bs=1M skip="${ROOTFS_OFFSET_MIB}" count="${ROOTFS_SIZE_MIB}" \
    conv=sparse status=none 2>/dev/null || true

e2info="$(tune2fs -l "${P2_IMG}" 2>/dev/null || true)"
e2label="$(echo "${e2info}" | sed -n 's/^Filesystem volume name:[[:space:]]*//p')"
if [ "${e2label}" = "rootfs" ]; then
    pass "p2 ext4 label is 'rootfs'"
else
    fail "p2 ext4 label is '${e2label}', expected 'rootfs'"
fi
e2uuid="$(echo "${e2info}" | sed -n 's/^Filesystem UUID:[[:space:]]*//p')"
if [ "${e2uuid,,}" = "${ROOTFS_UUID}" ]; then
    pass "p2 ext4 UUID is ${ROOTFS_UUID}"
else
    fail "p2 ext4 UUID is '${e2uuid}', expected ${ROOTFS_UUID}"
fi

# Run a single debugfs command against the extracted p2.
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

# --- summary ---
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} checks)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} checks)"
    exit 1
fi
