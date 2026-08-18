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
# The cmdline files stand in for what os/rootfs/build-v2.sh emits: a full
# kernel append line whose verity table points at that slot's own rootfs
# partition, plus the dm-mod.waitfor= the assembler insists on.
#
# Slot A deliberately uses LOWERCASE PARTUUIDs, which is what the real producer
# emits (udev/libblkid spell by-partuuid names lowercase) and what once tripped
# the assembler's literal comparison against the uppercase layout constants.
# Slot B deliberately uses UPPERCASE, the GPT/sgdisk spelling. Both must be
# accepted; the two together are the case-insensitivity regression test.
lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

mkcmdline() { # out-file rootfs-partition-guid
    printf 'root=/dev/dm-0 rootfstype=squashfs ro rootwait dm-mod.create="mos,,0,ro,0 6144 verity 1 PARTUUID=%s PARTUUID=%s 4096 4096 768 768 sha256 %s %s" dm-mod.waitfor=PARTUUID=%s console=ttyFIQ0,1500000\n' \
        "$2" "$2" "${FAKE_ROOT_HASH}" "${VERITY_SALT}" "$2" > "$1"
}
mkcmdline "${WORK}/boot-cmdline-a.txt" "$(lc "${ROOTFS_A_GUID}")"
mkcmdline "${WORK}/boot-cmdline-b.txt" "${ROOTFS_B_GUID}"

# --- assemble twice ----------------------------------------------------------
# mke2fs must be able to switch orphan_file off (e2fsprogs >= 1.47); when the
# host cannot, run the assembler in the same Alpine image mkimage-v2.sh uses.
host_can_assemble() {
    command -v sgdisk >/dev/null && command -v mkfs.vfat >/dev/null &&
        command -v mcopy >/dev/null && command -v mke2fs >/dev/null &&
        command -v mkimage >/dev/null || return 1
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

# run_assemble <out-name> <verity-img-name> [slot-pin]
# The pin is forwarded only when non-empty, so the unpinned run really is
# unpinned (that is what selects the floor mode inside the assembler).
run_assemble() {
    local out="$1" verity="$2" pin="${3-}"
    if host_can_assemble; then
        local pin_env=()
        if [ -n "${pin}" ]; then
            pin_env=("MOS_ROOTFS_SLOT_MIB=${pin}")
        fi
        env KERNEL_IMAGE="${WORK}/bsp/Image" \
            DTB="${WORK}/bsp/rk3576-src.dtb" \
            UBOOT="${WORK}/bsp/u-boot-rockchip.bin" \
            ROOTFS_VERITY_IMG="${WORK}/${verity}" \
            ROOTFS_VERITY_ENV="${WORK}/rootfs-verity.env" \
            BOOT_CMDLINE_A="${WORK}/boot-cmdline-a.txt" \
            BOOT_CMDLINE_B="${WORK}/boot-cmdline-b.txt" \
            IMG_OUT="${WORK}/${out}" "${pin_env[@]}" \
            bash "${SCRIPT_DIR}/mkimage-v2.sh" --assemble
    else
        local pin_args=()
        if [ -n "${pin}" ]; then
            pin_args=(-e "MOS_ROOTFS_SLOT_MIB=${pin}")
        fi
        docker run --rm \
            -v "${REPO_ROOT}:/work:ro" \
            -v "${WORK}:/t" \
            -e KERNEL_IMAGE=/t/bsp/Image \
            -e DTB=/t/bsp/rk3576-src.dtb \
            -e UBOOT=/t/bsp/u-boot-rockchip.bin \
            -e ROOTFS_VERITY_IMG="/t/${verity}" \
            -e ROOTFS_VERITY_ENV=/t/rootfs-verity.env \
            -e BOOT_CMDLINE_A=/t/boot-cmdline-a.txt \
            -e BOOT_CMDLINE_B=/t/boot-cmdline-b.txt \
            -e IMG_OUT="/t/${out}" "${pin_args[@]}" \
            alpine:3.21 \
            sh -c 'apk add --no-cache -q bash coreutils sgdisk dosfstools mtools e2fsprogs u-boot-tools && exec bash /work/os/mkimage-v2.sh --assemble'
    fi
}

# expect_failure <label> <verity-img-name> <pin> <expected-substring>...
# An empty pin means an unpinned (floor-mode) run.
expect_failure() {
    local label="$1" verity="$2" pin="$3"
    shift 3
    local log="${WORK}/expectfail.log"
    if run_assemble expectfail.img "${verity}" "${pin}" > "${log}" 2>&1; then
        echo "FAIL: ${label}: the build succeeded but should have refused"
        FAILED=1
        rm -f "${WORK}/expectfail.img"
        return
    fi
    echo "PASS: ${label}: exits non-zero"
    local want
    for want in "$@"; do
        if grep -qF -- "${want}" "${log}"; then
            echo "PASS: ${label}: message states '${want}'"
        else
            echo "FAIL: ${label}: message lacks '${want}' — got: $(tr '\n' ' ' < "${log}")"
            FAILED=1
        fi
    done
    rm -f "${WORK}/expectfail.img"
}

host_can_assemble || require_visible_workspace

echo "--- assembly 1 (unpinned, floor mode) ---"
run_assemble one.img rootfs-verity.img | tee "${WORK}/one.log"
echo "--- assembly 2 (unpinned, floor mode) ---"
run_assemble two.img rootfs-verity.img

echo "--- assertions ---"
if grep -qF "(floor ${MOS_ROOTFS_SLOT_MIB}," "${WORK}/one.log"; then
    echo "PASS: an unpinned build reports floor mode"
else
    echo "FAIL: an unpinned build did not report floor mode"
    FAILED=1
fi
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

# Both FAT slots carry the kernel, the dtb and the shared boot.scr, plus their
# own mos-verity.env — and NO extlinux config, which would win over boot.scr in
# U-Boot and silently bypass the A/B handshake.
for slot in a b; do
    case "${slot}" in
    a) off="${BOOT_A_OFFSET_BYTES}"; guid="${ROOTFS_A_GUID}" ;;
    b) off="${BOOT_B_OFFSET_BYTES}"; guid="${ROOTFS_B_GUID}" ;;
    esac
    listing="$(mdir -i "${IMG}@@${off}" -b ::/ 2>/dev/null || true)"
    for f in "::/Image" "::/rk3576-src.dtb" "::/${BOOT_SCRIPT_NAME}" "::/${BOOT_VERITY_ENV_NAME}"; do
        if echo "${listing}" | grep -qF "${f}"; then
            echo "PASS: boot-${slot} contains ${f}"
        else
            echo "FAIL: boot-${slot} is missing ${f}"
            FAILED=1
        fi
    done
    if echo "${listing}" | grep -qi "extlinux"; then
        echo "FAIL: boot-${slot} contains an extlinux entry: ${listing}"
        FAILED=1
    else
        echo "PASS: boot-${slot} has no extlinux directory or config"
    fi

    mcopy -n -i "${IMG}@@${off}" "::/${BOOT_SCRIPT_NAME}" "${WORK}/bootscr-${slot}"
    mcopy -n -i "${IMG}@@${off}" "::/${BOOT_VERITY_ENV_NAME}" "${WORK}/verityenv-${slot}"

    check "boot-${slot} ${BOOT_VERITY_ENV_NAME} is a single verity_args line" \
        "$(grep -c '^verity_args=dm-mod\.create=' "${WORK}/verityenv-${slot}")" 1
    if grep -qiF "PARTUUID=${guid}" "${WORK}/verityenv-${slot}"; then
        echo "PASS: boot-${slot} verity table points at its own rootfs (${guid}, either case)"
    else
        echo "FAIL: boot-${slot} verity table does not reference ${guid}"
        FAILED=1
    fi
    if grep -qiF "dm-mod.waitfor=PARTUUID=${guid}" "${WORK}/verityenv-${slot}"; then
        echo "PASS: boot-${slot} verity args carry dm-mod.waitfor for its own rootfs"
    else
        echo "FAIL: boot-${slot} verity args lack dm-mod.waitfor=PARTUUID=${guid}"
        FAILED=1
    fi
done

# The producer's lowercase spelling must survive into the boot slot unchanged:
# the assembler compares case-insensitively, it does not rewrite the cmdline.
if grep -qF "PARTUUID=$(lc "${ROOTFS_A_GUID}")" "${WORK}/verityenv-a"; then
    echo "PASS: a lowercase PARTUUID cmdline is accepted and passed through verbatim"
else
    echo "FAIL: the lowercase PARTUUID from the slot-a cmdline did not survive"
    FAILED=1
fi
if grep -qF "PARTUUID=${ROOTFS_B_GUID}" "${WORK}/verityenv-b"; then
    echo "PASS: an uppercase PARTUUID cmdline is accepted and passed through verbatim"
else
    echo "FAIL: the uppercase PARTUUID from the slot-b cmdline did not survive"
    FAILED=1
fi

if cmp -s "${WORK}/bootscr-a" "${WORK}/bootscr-b"; then
    echo "PASS: boot.scr is byte-identical in both slots"
else
    echo "FAIL: the two slots carry different boot.scr"
    FAILED=1
fi
# 0x27051956 big-endian is the legacy uImage magic mkimage writes.
check "boot.scr is a legacy U-Boot image" \
    "$(od -An -tx1 -N4 "${WORK}/bootscr-a" | tr -d ' \n')" 27051956
if cmp -s "${WORK}/verityenv-a" "${WORK}/verityenv-b"; then
    echo "FAIL: both slots carry the same mos-verity.env; they must differ"
    FAILED=1
else
    echo "PASS: the two slots carry different mos-verity.env"
fi

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

# --- pinned mode: frozen geometry that fits ----------------------------------
PIN_MIB=64
echo "--- assembly 3 (pinned ${PIN_MIB} MiB) ---"
run_assemble pinned.img rootfs-verity.img "${PIN_MIB}" | tee "${WORK}/pinned.log"

echo "--- pinned-mode assertions ---"
if grep -qF "(pinned, frozen geometry)" "${WORK}/pinned.log"; then
    echo "PASS: a pinned build reports frozen geometry"
else
    echo "FAIL: a pinned build did not report frozen geometry"
    FAILED=1
fi

IMG="${WORK}/pinned.img"
PIN_TOTAL_MIB=$((ROOTFS_A_START_MIB + 2 * PIN_MIB + META_SIZE_MIB + STATE_SIZE_MIB + EPHEMERAL_SIZE_MIB + IMAGE_TAIL_SLACK_MIB))
check "pinned image size is ${PIN_TOTAL_MIB} MiB" \
    "$(stat -c %s "${IMG}")" "$((PIN_TOTAL_MIB * MIB_BYTES))"
check "pinned rootfs-a size is exactly the pin, not the grown size" \
    "$(part_field "${ROOTFS_A_PARTNUM}" 'Partition size' | cut -d' ' -f1)" \
    "$((PIN_MIB * MIB_BYTES / SECTOR_SIZE))"
check "pinned rootfs-b starts at $((ROOTFS_A_START_MIB + PIN_MIB)) MiB" \
    "$(part_field "${ROOTFS_B_PARTNUM}" 'First sector' | cut -d' ' -f1)" \
    "$(((ROOTFS_A_START_MIB + PIN_MIB) * MIB_BYTES / SECTOR_SIZE))"
check "pinned meta starts at $((ROOTFS_A_START_MIB + 2 * PIN_MIB)) MiB" \
    "$(part_field "${META_PARTNUM}" 'First sector' | cut -d' ' -f1)" \
    "$(((ROOTFS_A_START_MIB + 2 * PIN_MIB) * MIB_BYTES / SECTOR_SIZE))"
check "pinned uenv-a offset is still ${UENV_A_OFFSET_BYTES} bytes" \
    "$(($(part_field "${UENV_A_PARTNUM}" 'First sector' | cut -d' ' -f1) * SECTOR_SIZE))" \
    "${UENV_A_OFFSET_BYTES}"

# --- pinned mode: refuses a rootfs that does not fit -------------------------
echo "--- pinned-mode refusal ---"
expect_failure "pin below the payload" rootfs-verity.img 2 \
    "MOS_ROOTFS_SLOT_MIB=2 MiB" "is ${VERITY_MIB} MiB" \
    "$((VERITY_MIB - 2)) MiB too large" "frozen"

# A pin equal to the built-in default must still be strict: selection is by
# "was it supplied", not by comparing against 256.
OVERSIZE_MIB=$((MOS_ROOTFS_SLOT_MIB + 44))
truncate -s "${OVERSIZE_MIB}M" "${WORK}/rootfs-verity-oversize.img"
expect_failure "pin equal to the built-in default" rootfs-verity-oversize.img \
    "${MOS_ROOTFS_SLOT_MIB}" \
    "MOS_ROOTFS_SLOT_MIB=${MOS_ROOTFS_SLOT_MIB} MiB" "is ${OVERSIZE_MIB} MiB" \
    "44 MiB too large"

# A cmdline that lost dm-mod.waitfor= is a cross-task mismatch, not something
# the assembler may paper over.
echo "--- missing dm-mod.waitfor ---"
cp "${WORK}/boot-cmdline-b.txt" "${WORK}/boot-cmdline-b.orig"
sed -i 's/ dm-mod\.waitfor=[^ ]*//' "${WORK}/boot-cmdline-b.txt"
expect_failure "cmdline without dm-mod.waitfor" rootfs-verity.img "" \
    "carries no dm-mod.waitfor=" "cross-task mismatch" "os/rootfs/build-v2.sh"
mv "${WORK}/boot-cmdline-b.orig" "${WORK}/boot-cmdline-b.txt"

# A slot whose verity table points at the other slot's rootfs is refused too.
echo "--- wrong-slot verity table ---"
cp "${WORK}/boot-cmdline-b.txt" "${WORK}/boot-cmdline-b.orig"
mkcmdline "${WORK}/boot-cmdline-b.txt" "$(lc "${ROOTFS_A_GUID}")"
expect_failure "slot-b cmdline pointing at rootfs-a" rootfs-verity.img "" \
    "does not reference PARTUUID ${ROOTFS_B_GUID}" "found: dm-mod.create="
mv "${WORK}/boot-cmdline-b.orig" "${WORK}/boot-cmdline-b.txt"

# The same oversize payload grows the slot instead when nothing is pinned.
echo "--- floor-mode growth ---"
run_assemble grown.img rootfs-verity-oversize.img > "${WORK}/grown.log" 2>&1
GROWN_SLOT_MIB=$(((OVERSIZE_MIB * ROOTFS_SLOT_HEADROOM_PCT + 99) / 100))
GROWN_SLOT_MIB=$(((GROWN_SLOT_MIB + ROOTFS_SLOT_ALIGN_MIB - 1) / ROOTFS_SLOT_ALIGN_MIB * ROOTFS_SLOT_ALIGN_MIB))
IMG="${WORK}/grown.img"
check "unpinned build grows the slot past the floor" \
    "$(part_field "${ROOTFS_A_PARTNUM}" 'Partition size' | cut -d' ' -f1)" \
    "$((GROWN_SLOT_MIB * MIB_BYTES / SECTOR_SIZE))"

if [ "${FAILED}" -eq 0 ]; then
    echo "RESULT: PASS"
else
    echo "RESULT: FAIL"
    exit 1
fi
