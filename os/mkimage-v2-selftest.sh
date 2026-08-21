#!/usr/bin/env bash
set -euo pipefail

# Drives os/mkimage-v2.sh --assemble with synthetic inputs so the v2 assembler
# can be exercised without the BSP and without os/rootfs/build-v2.sh. Asserts
# that two consecutive assemblies are byte-identical and that the resulting GPT
# carries all eleven partitions with the labels, GUIDs and typecodes pinned in
# os/layout/cx3576-v2.env, plus the guards that refuse a stale partition number
# or a loader area that does not contain a loader.
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
# Two distinct U-Boot blobs, mirroring the board's two variants. The v2 image
# may only carry uboot-mos; the debug one exists here so the pairing guard has
# something to compare against.
# Both must start with the Rockchip idbloader magic, because the assembler
# refuses a blob that does not: the loader PARTITION is only worth having if it
# covers something the BootROM will load. The filler after the magic is what
# makes the two variants differ, which is what the pairing guard needs.
mkloader() { # out-file total-size fill-char
    printf "$(echo "${LOADER_MAGIC_HEX}" | sed 's/../\\x&/g')" > "$1"
    head -c "$(($2 - 4))" /dev/zero | tr '\0' "$3" >> "$1"
}
mkloader "${WORK}/bsp/u-boot-mos.bin" $((1024 * 1024)) M
mkloader "${WORK}/bsp/u-boot-debug.bin" $((1024 * 1024)) U
# Same size, no magic: the negative case for the idbloader-magic guard.
fill "${WORK}/bsp/u-boot-nomagic.bin" $((1024 * 1024)) M
UBOOT_FIXTURE="${WORK}/bsp/u-boot-mos.bin"
UBOOT_DEBUG_FIXTURE="${WORK}/bsp/u-boot-debug.bin"

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
# host cannot, run the assembler in TOOL_IMAGE — the prebuilt equivalent of
# the Alpine-plus-packages container mkimage-v2.sh's own fallback uses (built
# further down, before any assembly runs).
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

# Name of a doctored boot.cmd inside ${WORK}, or empty to use the tree's own.
# Set by the renumbering tests below.
BOOT_CMD_FIXTURE=""

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
        if [ -n "${BOOT_CMD_FIXTURE}" ]; then
            pin_env+=("BOOT_CMD=${WORK}/${BOOT_CMD_FIXTURE}")
        fi
        env KERNEL_IMAGE="${WORK}/bsp/Image" \
            DTB="${WORK}/bsp/rk3576-src.dtb" \
            UBOOT="${UBOOT_FIXTURE}" \
            UBOOT_DEBUG="${UBOOT_DEBUG_FIXTURE}" \
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
        if [ -n "${BOOT_CMD_FIXTURE}" ]; then
            pin_args+=(-e "BOOT_CMD=/t/${BOOT_CMD_FIXTURE}")
        fi
        docker run --rm \
            -v "${REPO_ROOT}:/work:ro" \
            -v "${WORK}:/t" \
            -e KERNEL_IMAGE=/t/bsp/Image \
            -e DTB=/t/bsp/rk3576-src.dtb \
            -e UBOOT="/t/${UBOOT_FIXTURE#"${WORK}/"}" \
            -e UBOOT_DEBUG="/t/${UBOOT_DEBUG_FIXTURE#"${WORK}/"}" \
            -e ROOTFS_VERITY_IMG="/t/${verity}" \
            -e ROOTFS_VERITY_ENV=/t/rootfs-verity.env \
            -e BOOT_CMDLINE_A=/t/boot-cmdline-a.txt \
            -e BOOT_CMDLINE_B=/t/boot-cmdline-b.txt \
            -e IMG_OUT="/t/${out}" "${pin_args[@]}" \
            "${TOOL_IMAGE}" \
            bash /work/os/mkimage-v2.sh --assemble
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

# --- container tooling, for assembly AND assertions --------------------------
# run_assemble falls back to a container when the host cannot assemble, but the
# assertion phase below calls sgdisk/mdir/mcopy/dumpe2fs/debugfs directly. On a
# host with docker and no sgdisk/mtools the assembly SUCCEEDS in the container
# and every assertion then emits a FAIL that indicts the image, when the only
# thing missing was a host tool. So every tool the assertion phase needs is
# resolved here: the host binary when present, otherwise a shell function of
# the same name running it in the container image below, with ${WORK} mounted
# at its own path — so every file argument resolves identically and the output
# is byte-identical on both routes, which the expected-value comparisons
# depend on.
#
# The image carries exactly the package line os/mkimage-v2.sh's own container
# fallback installs, and is BUILT ONCE (docker caches it) rather than `apk
# add`ed per container: the assertion phase makes dozens of tool calls, and
# this selftest makes ~15 assembly runs — one network fetch instead of one per
# run is also what keeps a single flaky mirror from failing an unrelated case.
ASSERT_TOOLS=(sgdisk mdir mcopy dumpe2fs debugfs)
TOOL_IMAGE=""
tool_in_container() {
    docker run --rm -v "${WORK}:${WORK}" "${TOOL_IMAGE}" "$@"
}
missing_tools=0
for t in "${ASSERT_TOOLS[@]}"; do
    command -v "${t}" >/dev/null 2>&1 || missing_tools=1
done
if ! host_can_assemble || [ "${missing_tools}" -eq 1 ]; then
    require_visible_workspace
    TOOL_IMAGE="$(docker build -q - <<'EOF'
FROM alpine:3.21
RUN apk add --no-cache -q bash coreutils sgdisk dosfstools mtools e2fsprogs u-boot-tools
EOF
    )"
    [ -n "${TOOL_IMAGE}" ] || { echo "error: could not build the container tool image" >&2; exit 1; }
    for t in "${ASSERT_TOOLS[@]}"; do
        if ! command -v "${t}" >/dev/null 2>&1; then
            # Same name as the tool, so no call site changes and no site can
            # forget to use the wrapper.
            eval "${t}() { tool_in_container ${t} \"\$@\"; }"
        fi
    done
    echo "host tools incomplete; using container image ${TOOL_IMAGE} for assembly and/or assertions"
fi

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
EXPECT_TOTAL_MIB=$((ROOTFS_A_START_MIB + 2 * SLOT_MIB + META_SIZE_MIB + STATE_SIZE_MIB + MOS_VAR_MIB + DATA_SIZE_MIB + IMAGE_TAIL_SLACK_MIB))
check "image size is ${EXPECT_TOTAL_MIB} MiB" \
    "$(stat -c %s "${IMG}")" "$((EXPECT_TOTAL_MIB * MIB_BYTES))"
check "partition count" "$(sgdisk --print "${IMG}" | awk '$1 ~ /^[0-9]+$/ {n++} END {print n+0}')" 11
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
DATA_START_MIB=$((EPHEMERAL_START_MIB + MOS_VAR_MIB))

check "p${UENV_A_PARTNUM} offset is ${UENV_A_OFFSET_BYTES} bytes" \
    "$(($(part_field "${UENV_A_PARTNUM}" 'First sector' | cut -d' ' -f1) * SECTOR_SIZE))" \
    "${UENV_A_OFFSET_BYTES}"
check "p${UENV_B_PARTNUM} offset is ${UENV_B_OFFSET_BYTES} bytes" \
    "$(($(part_field "${UENV_B_PARTNUM}" 'First sector' | cut -d' ' -f1) * SECTOR_SIZE))" \
    "${UENV_B_OFFSET_BYTES}"

assert_part "${LOADER_PARTNUM}" "${LOADER_LABEL}" "${LOADER_GUID}" "${LOADER_TYPECODE}" \
    "${LOADER_START_SECTOR}" "${LOADER_SIZE_SECTORS}"
# sgdisk relocates a non-2048-aligned start unless -a is relaxed, so the start
# sector above is the load-bearing assertion, not a formality. These two add the
# properties that make the entry actually protect the bootloader: it abuts
# uenv-a (no uncovered gap between them) and its first bytes are an idbloader.
check "loader ends exactly where ${UENV_A_LABEL} begins" \
    "$((LOADER_START_SECTOR + LOADER_SIZE_SECTORS))" "${UENV_A_START_SECTOR}"
check "loader partition starts with the idbloader magic" \
    "$(dd if="${IMG}" bs="${SECTOR_SIZE}" skip="${LOADER_START_SECTOR}" count=1 status=none | od -An -tx1 -N4 | tr -d ' \n')" \
    "${LOADER_MAGIC_HEX}"
# repart pairs definitions with partitions BY TYPE UUID, so the loader is
# invisible to it only while its type is neither of the two the layout uses.
check "loader type is not linux-generic" \
    "$([ "${LOADER_TYPECODE}" = "${TYPECODE_LINUX}" ] && echo collides || echo distinct)" distinct
check "loader type is not the ESP type" \
    "$([ "${LOADER_TYPECODE}" = "${TYPECODE_ESP}" ] && echo collides || echo distinct)" distinct

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
    "$((EPHEMERAL_START_MIB * MIB_BYTES / SECTOR_SIZE))" "$((MOS_VAR_MIB * MIB_BYTES / SECTOR_SIZE))"
assert_part "${DATA_PARTNUM}" "${DATA_LABEL}" "${DATA_GUID}" "${DATA_TYPECODE}" \
    "$((DATA_START_MIB * MIB_BYTES / SECTOR_SIZE))" "$((DATA_SIZE_MIB * MIB_BYTES / SECTOR_SIZE))"

# data must be LAST: systemd-repart can only extend the final partition to the
# end of the disk. Nothing may sit between its end and the backup-GPT slack.
check "data is the last partition" \
    "$(sgdisk --print "${IMG}" | awk '$1 ~ /^[0-9]+$/ {n=$1} END {print n}')" "${DATA_PARTNUM}"
check "data ends ${IMAGE_TAIL_SLACK_MIB} MiB before the end of the image" \
    "$(($(part_field "${DATA_PARTNUM}" 'Last sector' | cut -d' ' -f1) + 1))" \
    "$(((EXPECT_TOTAL_MIB - IMAGE_TAIL_SLACK_MIB) * MIB_BYTES / SECTOR_SIZE))"
check "ephemeral is exactly MOS_VAR_MIB (${MOS_VAR_MIB} MiB), no longer a growth target" \
    "$(part_field "${EPHEMERAL_PARTNUM}" 'Partition size' | cut -d' ' -f1)" \
    "$((MOS_VAR_MIB * MIB_BYTES / SECTOR_SIZE))"

# The four ext4 partitions must carry the pinned label and fs UUID and hold no
# content beyond what mke2fs itself creates.
assert_ext4() { # partnum start-mib size-mib fs-label fs-uuid
    local part="${WORK}/ext4-p$1.img"
    dd if="${IMG}" bs=1M skip="$2" count="$3" status=none > "${part}"
    check "p$1 fs label" "$(dumpe2fs -h "${part}" 2>/dev/null | sed -n 's/^Filesystem volume name: *//p')" "$4"
    check "p$1 fs UUID" "$(dumpe2fs -h "${part}" 2>/dev/null | sed -n 's/^Filesystem UUID: *//p')" "$5"
    check "p$1 is empty apart from lost+found" \
        "$(debugfs -R 'ls -p /' "${part}" 2>/dev/null | tr '/' '\n' | grep -cvE '^$|^[0-9]+$|^\.$|^\.\.$|^lost\+found$')" 0
    rm -f "${part}"
}
assert_ext4 "${META_PARTNUM}" "${META_START_MIB}" "${META_SIZE_MIB}" "${META_FS_LABEL}" "${META_FS_UUID}"
assert_ext4 "${STATE_PARTNUM}" "${STATE_START_MIB}" "${STATE_SIZE_MIB}" "${STATE_FS_LABEL}" "${STATE_FS_UUID}"
assert_ext4 "${EPHEMERAL_PARTNUM}" "${EPHEMERAL_START_MIB}" "${MOS_VAR_MIB}" "${EPHEMERAL_FS_LABEL}" "${EPHEMERAL_FS_UUID}"
assert_ext4 "${DATA_PARTNUM}" "${DATA_START_MIB}" "${DATA_SIZE_MIB}" "${DATA_FS_LABEL}" "${DATA_FS_UUID}"

# Both FAT slots carry the kernel, the dtb and the shared boot.scr, plus their
# own mos-verity.env — and NO extlinux config, which would win over boot.scr in
# U-Boot and silently bypass the A/B handshake.
for slot in a b; do
    case "${slot}" in
    a) off="${BOOT_A_OFFSET_BYTES}"; guid="${ROOTFS_A_GUID}"; venv="${BOOT_VERITY_ENV_A_NAME}" ;;
    b) off="${BOOT_B_OFFSET_BYTES}"; guid="${ROOTFS_B_GUID}"; venv="${BOOT_VERITY_ENV_B_NAME}" ;;
    esac
    listing="$(mdir -i "${IMG}@@${off}" -b ::/ 2>/dev/null || true)"
    for f in "::/Image" "::/rk3576-src.dtb" "::/${BOOT_SCRIPT_NAME}" "::/${venv}"; do
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

    # A RAUC-installed slot carries ONLY the slot-suffixed files, so a factory
    # slot must too: any unsuffixed file here would mean the layout a device
    # boots from after an update differs from the one it was flashed with.
    if echo "${listing}" | grep -qF "::/${BOOT_VERITY_ENV_NAME}"; then
        echo "FAIL: boot-${slot} carries the unsuffixed ${BOOT_VERITY_ENV_NAME}; a RAUC-installed slot never has one"
        FAILED=1
    else
        echo "PASS: boot-${slot} carries no unsuffixed ${BOOT_VERITY_ENV_NAME} (bundle-shaped layout)"
    fi

    mcopy -n -i "${IMG}@@${off}" "::/${BOOT_SCRIPT_NAME}" "${WORK}/bootscr-${slot}"
    mcopy -n -i "${IMG}@@${off}" "::/${venv}" "${WORK}/verityenv-${slot}"

    check "boot-${slot} ${venv} is a single verity_args line" \
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
    echo "FAIL: both slots carry the same verity env; they must differ"
    FAILED=1
else
    echo "PASS: the two slots carry different per-slot verity env files"
fi

# Contract cross-check: the filename boot.scr builds at runtime must be the one
# that is actually present in that slot. Both halves are read out of
# os/boot/cx3576-boot.cmd rather than restated here, so this fails if either
# the load line or the slotsuffix assignments drift.
BOOT_CMD_FILE="${SCRIPT_DIR}/boot/cx3576-boot.cmd"
VERITY_BASE="${BOOT_VERITY_ENV_NAME%.env}"
check "boot.cmd loads the per-slot verity env first" \
    "$(sed -n '/^if load mmc/{s/.*[[:space:]]\([^[:space:]]*\);[[:space:]]*then$/\1/p;q}' "${BOOT_CMD_FILE}")" \
    "${VERITY_BASE}-\${slotsuffix}.env"
check "boot.cmd falls back to the unsuffixed name" \
    "$(sed -n '/^elif load mmc/{s/.*[[:space:]]\([^[:space:]]*\);[[:space:]]*then$/\1/p;q}' "${BOOT_CMD_FILE}")" \
    "${BOOT_VERITY_ENV_NAME}"
for slot in a b; do
    case "${slot}" in
    a) off="${BOOT_A_OFFSET_BYTES}" ;;
    b) off="${BOOT_B_OFFSET_BYTES}" ;;
    esac
    suffix="$(grep -oE "^ +setenv slotsuffix ${slot}\$" "${BOOT_CMD_FILE}" | awk '{print $3}')"
    check "boot.cmd sets slotsuffix=${slot} for that slot" "${suffix}" "${slot}"
    want="${VERITY_BASE}-${suffix}.env"
    if mdir -i "${IMG}@@${off}" -b ::/ 2>/dev/null | grep -qF "::/${want}"; then
        echo "PASS: boot-${slot} contains ${want}, the exact name boot.scr will load"
    else
        echo "FAIL: boot-${slot} does not contain ${want}, the name boot.scr will load"
        FAILED=1
    fi
done

# rootfs-a carries the payload; rootfs-b stays zero-filled.
check "rootfs-a holds the verity payload" \
    "$(dd if="${IMG}" bs=1M skip="${ROOTFS_A_START_MIB}" count="${VERITY_MIB}" status=none | cmp -s - "${WORK}/rootfs-verity.img" && echo yes || echo no)" \
    yes
check "rootfs-b is zero-filled" \
    "$(dd if="${IMG}" bs=1M skip="${ROOTFS_B_START_MIB}" count="${SLOT_MIB}" status=none | tr -d '\0' | wc -c)" \
    0
check "sector ${UBOOT_SEEK_SECTOR} carries the uboot-mos blob, not the debug one" \
    "$(dd if="${IMG}" bs=512 skip="${UBOOT_SEEK_SECTOR}" count=2048 status=none | cmp -s - <(head -c $((1024 * 1024)) "${UBOOT_FIXTURE}") && echo mos || echo other)" \
    mos
check "the two U-Boot fixtures really differ" \
    "$(cmp -s "${UBOOT_FIXTURE}" "${UBOOT_DEBUG_FIXTURE}" && echo same || echo differ)" \
    differ
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
PIN_TOTAL_MIB=$((ROOTFS_A_START_MIB + 2 * PIN_MIB + META_SIZE_MIB + STATE_SIZE_MIB + MOS_VAR_MIB + DATA_SIZE_MIB + IMAGE_TAIL_SLACK_MIB))
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
check "pinned data is still the last partition" \
    "$(sgdisk --print "${IMG}" | awk '$1 ~ /^[0-9]+$/ {n=$1} END {print n}')" "${DATA_PARTNUM}"
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

# --- U-Boot variant pairing ---------------------------------------------------
# The two board variants are not interchangeable and neither mistake announces
# itself on hardware, so both have to be build-time errors.
echo "--- missing uboot-mos ---"
UBOOT_FIXTURE="${WORK}/bsp/u-boot-mos-absent.bin"
expect_failure "uboot-mos blob absent" rootfs-verity.img "" \
    "make -C board/cx3576 uboot-mos" "NOT a substitute" "CONFIG_ENV_IS_NOWHERE"
UBOOT_FIXTURE="${WORK}/bsp/u-boot-mos.bin"

echo "--- uboot-mos identical to the debug build ---"
cp "${WORK}/bsp/u-boot-debug.bin" "${WORK}/bsp/u-boot-mos-copy.bin"
UBOOT_FIXTURE="${WORK}/bsp/u-boot-mos-copy.bin"
expect_failure "uboot-mos byte-identical to the debug build" rootfs-verity.img "" \
    "byte-identical to the debug build" "do not copy or symlink"
UBOOT_FIXTURE="${WORK}/bsp/u-boot-mos.bin"

# The same oversize payload grows the slot instead when nothing is pinned.
echo "--- floor-mode growth ---"
run_assemble grown.img rootfs-verity-oversize.img > "${WORK}/grown.log" 2>&1
GROWN_SLOT_MIB=$(((OVERSIZE_MIB * ROOTFS_SLOT_HEADROOM_PCT + 99) / 100))
GROWN_SLOT_MIB=$(((GROWN_SLOT_MIB + ROOTFS_SLOT_ALIGN_MIB - 1) / ROOTFS_SLOT_ALIGN_MIB * ROOTFS_SLOT_ALIGN_MIB))
IMG="${WORK}/grown.img"
check "unpinned build grows the slot past the floor" \
    "$(part_field "${ROOTFS_A_PARTNUM}" 'Partition size' | cut -d' ' -f1)" \
    "$((GROWN_SLOT_MIB * MIB_BYTES / SECTOR_SIZE))"

# --- the loader area must contain a loader ---------------------------------
# An entry over the wrong bytes protects nothing: the image would pass every
# structural check and the board would still not boot.
echo "--- loader blob without the idbloader magic ---"
UBOOT_FIXTURE="${WORK}/bsp/u-boot-nomagic.bin"
expect_failure "u-boot blob without the 'RKNS' magic" rootfs-verity.img "" \
    "not the Rockchip idbloader magic" "${LOADER_MAGIC_HEX}"
UBOOT_FIXTURE="${WORK}/bsp/u-boot-mos.bin"

# --- THE RENUMBERING GUARD ---------------------------------------------------
# Inserting the loader partition shifted every partition number by one, and
# boot.cmd carries four of them as literals because hush cannot read the layout
# file. A stale number is the worst kind of defect this task can produce: U-Boot
# persists the boot-attempt decrement, then cannot find Image in a partition that
# now holds something else, and the board needs re-flashing. Nothing about it is
# visible at build time unless the build refuses — so these prove the build
# refuses, in both directions: the unmodified file assembles (every case above
# used it), a doctored one does not.
echo "--- stale partition numbers in boot.cmd ---"
for spec in "bootpart:A:${BOOT_A_PARTNUM}" "bootpart:B:${BOOT_B_PARTNUM}" \
    "rootpart:A:${ROOTFS_A_PARTNUM}" "rootpart:B:${ROOTFS_B_PARTNUM}"; do
    IFS=':' read -r var slot num <<<"${spec}"
    stale=$((num - 1)) # exactly the value the pre-loader layout used
    fixture="boot-stale-${var}-${slot}.cmd"
    # Rewrite only this slot's assignment: the awk mirrors how the assembler
    # locates it, from the `setenv bootslot <slot>` line that precedes it.
    awk -v slot="${slot}" -v var="${var}" -v stale="${stale}" '
        $1 == "setenv" && $2 == "bootslot" && $3 == slot { in_slot = 1 }
        $1 == "setenv" && $2 == var && in_slot && !done {
            sub(/[0-9]+$/, stale); done = 1
        }
        { print }
    ' "${BOOT_CMD_FILE}" > "${WORK}/${fixture}"
    if cmp -s "${WORK}/${fixture}" "${BOOT_CMD_FILE}"; then
        echo "FAIL: the ${var}/${slot} fixture is identical to ${BOOT_CMD_FILE}; the negative test would pass vacuously"
        FAILED=1
        continue
    fi
    BOOT_CMD_FIXTURE="${fixture}"
    expect_failure "boot.cmd with a stale ${var} (${stale}) for slot ${slot}" rootfs-verity.img "" \
        "sets '${var}' to '${stale}' for slot ${slot}" "the layout puts that partition at p${num}"
    BOOT_CMD_FIXTURE=""
done

# --- RAUC slot devices must never carry a partition number -------------------
# system.conf addresses slots by PARTUUID, so renumbering cannot reach it. That
# is a property worth enforcing rather than observing: a /dev/mmcblk0pN path
# would make RAUC install an update over the RUNNING slot after a renumbering,
# silently. Positive direction first (the real template renders), then negative.
echo "--- RAUC slot device shape ---"
RENDER="${REPO_ROOT}/os/rauc/render-config.sh"
if SYSTEM_CONF_OUT="${WORK}/system.conf.real" bash "${RENDER}" >/dev/null 2>&1; then
    echo "PASS: the shipped system.conf.in renders"
else
    echo "FAIL: the shipped system.conf.in no longer renders"
    FAILED=1
fi
if grep -q '^device=/dev/disk/by-partuuid/' "${WORK}/system.conf.real" 2>/dev/null &&
    ! grep '^device=' "${WORK}/system.conf.real" | grep -qv '^device=/dev/disk/by-partuuid/'; then
    echo "PASS: every rendered RAUC slot device is a by-partuuid path (renumbering cannot mis-target an install)"
else
    echo "FAIL: a rendered RAUC slot device is not a by-partuuid path: $(grep '^device=' "${WORK}/system.conf.real" | tr '\n' ' ')"
    FAILED=1
fi
sed 's|^device=/dev/disk/by-partuuid/@ROOTFS_A_PARTUUID@|device=/dev/mmcblk0p6|' \
    "${REPO_ROOT}/os/rauc/system.conf.in" > "${WORK}/system.conf.in.stale"
if cmp -s "${WORK}/system.conf.in.stale" "${REPO_ROOT}/os/rauc/system.conf.in"; then
    echo "FAIL: the doctored system.conf.in is identical to the real one; the negative test would pass vacuously"
    FAILED=1
elif SYSTEM_CONF_IN="${WORK}/system.conf.in.stale" SYSTEM_CONF_OUT="${WORK}/system.conf.stale" \
    bash "${RENDER}" > "${WORK}/render-stale.log" 2>&1; then
    echo "FAIL: the renderer accepted a slot addressed as /dev/mmcblk0p6"
    FAILED=1
elif grep -qF "addresses a slot by something other than a PARTUUID" "${WORK}/render-stale.log"; then
    echo "PASS: the renderer refuses a slot addressed by partition number, and says why"
else
    echo "FAIL: the renderer refused the doctored template for the wrong reason: $(tr '\n' ' ' < "${WORK}/render-stale.log")"
    FAILED=1
fi

# --- what must NOT have moved ------------------------------------------------
# U-Boot's ENV_OFFSET / ENV_OFFSET_REDUND (board/cx3576, CONFIG_ENV_OFFSET
# 0x1000000 / 0x1100000) are ABSOLUTE byte offsets compiled into the bootloader.
# Renumbering the partition table must not shift them by a single byte: a
# shifted env offset strands the A/B boot-order handshake on every device
# already flashed, and it fails silently. The literals below are deliberately
# restated from the U-Boot config rather than derived, because deriving both
# sides from the same file would assert nothing.
check "UENV_A_OFFSET_BYTES is still U-Boot's ENV_OFFSET 0x1000000" \
    "${UENV_A_OFFSET_BYTES}" "$((0x1000000))"
check "UENV_B_OFFSET_BYTES is still U-Boot's ENV_OFFSET_REDUND 0x1100000" \
    "${UENV_B_OFFSET_BYTES}" "$((0x1100000))"

if [ "${FAILED}" -eq 0 ]; then
    echo "RESULT: PASS"
else
    echo "RESULT: FAIL"
    exit 1
fi
