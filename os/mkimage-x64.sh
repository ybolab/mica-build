#!/usr/bin/env bash
# Assemble the x64 disk image: GPT, an ESP that GRUB boots from, both rootfs
# slots, and the meta/state/ephemeral/data filesystems.
#
#   bash os/mkimage-x64.sh
#   → _out/x64/x64-mos-v2-<epoch>.img  (+ a -latest symlink)
#
# WHY THIS IS NOT os/mkimage-v2.sh. That script assembles a cx3576 disk and is
# 575 lines of U-Boot: a loader partition at a fixed sector, a redundant
# environment pair, a compiled boot.scr, and geometry assertions about all
# three. None of it exists on a UEFI machine. Threading conditionals through it
# would have put a second board's boot chain inside the first board's
# assertions, where a mistake in either is a mistake in both.
#
# What the two DO share is the layout format and the RAUC slot model, and those
# are shared as files rather than as copied constants: os/layout/x64-v2.env and
# the same os/rauc/render-config.sh.
#
# WHAT THIS IMAGE IS FOR. x64 is a product target -- amd64 industrial PCs --
# and QEMU boots this same image from the same GPT through the same firmware
# path. So a QEMU run exercises the real boot chain: OVMF -> GRUB -> grubenv
# A/B order -> kernel -> initramfs verity -> systemd -> mosd. Nothing here is
# a test-only shortcut, and in particular there is no `-kernel` path: booting
# the kernel directly would skip the two components most likely to be wrong.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
LAYOUT_ENV="${REPO_ROOT}/os/layout/x64-v2.env"
OUT_DIR="${REPO_ROOT}/_out/x64"
GRUB_CFG_IN="${SCRIPT_DIR}/boot/x64-grub.cfg"

# shellcheck source=layout/x64-v2.env
. "${LAYOUT_ENV}"

ROOTFS_IMG="${OUT_DIR}/rootfs-verity.img"
VERITY_ENV="${OUT_DIR}/rootfs-verity.env"
KERNEL="${OUT_DIR}/boot/vmlinuz"
INITRD="${OUT_DIR}/boot/initrd.img"

for f in "${ROOTFS_IMG}" "${VERITY_ENV}" "${KERNEL}" "${INITRD}" "${GRUB_CFG_IN}"; do
    if [ ! -f "${f}" ]; then
        echo "error: ${f} not found. Build the root first: MOS_BOARD=x64 bash os/rootfs/build-v2.sh" >&2
        exit 1
    fi
done
# shellcheck source=/dev/null
. "${VERITY_ENV}"

lower() { echo "$1" | tr 'A-Z' 'a-z'; }

# --- the kernel command line, per slot ---------------------------------------
# Identical in FORM to cx3576's, and produced from the same verity env. On
# cx3576 the kernel's own dm-init reads this; here the initramfs script does.
# One format, so the boot contract is one thing.
cmdline_for() {
    local partuuid="PARTUUID=$(lower "$1")"
    printf 'dm-mod.create="rootfs,,,ro,0 %s verity 1 %s %s %s %s %s %s %s %s %s" dm-mod.waitfor=%s root=/dev/dm-0 rootfstype=squashfs ro rootwait rauc.slot=%s %s' \
        "${VERITY_DATA_SECTORS}" "${partuuid}" "${partuuid}" \
        "${VERITY_DATA_BLOCK_SIZE}" "${VERITY_HASH_BLOCK_SIZE}" "${VERITY_DATA_BLOCKS}" \
        "${VERITY_HASH_START_BLOCK}" "${VERITY_HASH_ALGO}" "${VERITY_ROOT_HASH}" "${VERITY_SALT}" \
        "${partuuid}" "$2" "${BOARD_CMDLINE_ARGS}"
}
CMDLINE_A="$(cmdline_for "${ROOTFS_A_GUID}" A)"
CMDLINE_B="$(cmdline_for "${ROOTFS_B_GUID}" B)"

# --- geometry ---------------------------------------------------------------
rootfs_bytes=$(stat -c%s "${ROOTFS_IMG}")
slot_mib=$(( (rootfs_bytes * ROOTFS_SLOT_HEADROOM_PCT / 100 + MIB_BYTES - 1) / MIB_BYTES ))
slot_mib=$(( (slot_mib + ROOTFS_SLOT_ALIGN_MIB - 1) / ROOTFS_SLOT_ALIGN_MIB * ROOTFS_SLOT_ALIGN_MIB ))
if [ "${slot_mib}" -lt "${MOS_ROOTFS_SLOT_MIB}" ]; then
    slot_mib="${MOS_ROOTFS_SLOT_MIB}"
fi

rootfs_b_start=$(( ROOTFS_A_START_MIB + slot_mib ))
meta_start=$(( rootfs_b_start + slot_mib ))
state_start=$(( meta_start + META_SIZE_MIB ))
ephemeral_start=$(( state_start + STATE_SIZE_MIB ))
data_start=$(( ephemeral_start + MOS_VAR_MIB ))
disk_mib=$(( data_start + DATA_SIZE_MIB + IMAGE_TAIL_SLACK_MIB ))

STAMP="$(date +%s)"
IMG="${OUT_DIR}/${IMAGE_NAME_PREFIX}${STAMP}${IMAGE_NAME_SUFFIX}"
# Under _out/, not mktemp -d. The container writes the assembled image back
# through this bind, and on this host a bind of a /tmp path does not propagate
# writes -- the daemon has its own /tmp. Measured: a write into a bound /tmp
# directory is invisible outside, a write into a bound /srv one is not. The
# symptom is an assembly that reports success and leaves nothing behind.
WORK="${OUT_DIR}/.mkimage-work"
rm -rf "${WORK}"
mkdir -p "${WORK}"
trap 'rm -rf "${WORK}"' EXIT

# Everything that touches the image runs in one container: the host has no
# sgdisk, no mtools and no grub-mkstandalone, and requiring them would make
# this script work on one machine.
cp "${ROOTFS_IMG}" "${WORK}/rootfs.img"
cp "${KERNEL}" "${WORK}/vmlinuz"
cp "${INITRD}" "${WORK}/initrd.img"
sed -e "s|@CMDLINE_A@|${CMDLINE_A}|" -e "s|@CMDLINE_B@|${CMDLINE_B}|" \
    "${GRUB_CFG_IN}" > "${WORK}/grub.cfg"
if grep -q '@[A-Z_]\+@' "${WORK}/grub.cfg"; then
    echo "error: unrendered placeholder left in grub.cfg" >&2
    grep -n '@[A-Z_]\+@' "${WORK}/grub.cfg" >&2
    exit 1
fi

cat >"${WORK}/assemble.sh" <<'INNER'
set -eu
cd /w
# The layout is SOURCED here rather than threaded through fifty `docker run -e`
# flags. The -e form passes only EXPORTED variables, so a layout key that was
# merely set -- which is every key in the file -- arrives unset, and `set -u`
# then names one of them while the other forty-nine are equally missing.
. /w/layout.env
MIB=1048576

esp_bytes=$(( BOOT_SIZE_MIB * MIB ))
truncate -s "${esp_bytes}" esp.img
mkfs.vfat -F 32 -n "${BOOT_A_FAT_LABEL}" -i "${BOOT_A_FAT_VOLUME_ID}" esp.img >/dev/null

# GRUB, with every module it needs embedded. grub-install writes into a MOUNTED
# ESP and this script never mounts anything -- a loop mount needs privileges
# that a build should not want. grub-mkstandalone produces one self-contained
# EFI binary instead, and the memdisk config below is the only thing it needs
# to find the real one.
cat >early.cfg <<'EARLY'
search --no-floppy --label BOOT-A --set root
if [ -z "${root}" ]; then
    search --no-floppy --label BOOT-B --set root
fi
set prefix=($root)/EFI/mos
configfile ($root)/EFI/mos/grub.cfg
EARLY

grub-mkstandalone \
    --format=x86_64-efi \
    --output=BOOTX64.EFI \
    --modules="part_gpt fat search search_label configfile linux normal echo test loadenv" \
    "boot/grub/grub.cfg=early.cfg"

# grubenv is a FIXED 1024-byte file; grub-editenv creates it that way and RAUC
# rewrites it in place with the same tool. A file of any other size is not a
# grubenv, and GRUB ignores it silently -- which would look exactly like an
# A/B order that never changes.
grub-editenv grubenv create
grub-editenv grubenv set ORDER="A B"
grub-editenv grubenv set A_OK=0 A_TRY=0 B_OK=0 B_TRY=0
[ "$(stat -c%s grubenv)" = "1024" ] || {
    echo "error: grubenv is $(stat -c%s grubenv) bytes, not 1024; GRUB would ignore it and the A/B order would silently never change" >&2
    exit 1
}

mmd -i esp.img ::/EFI ::/EFI/BOOT ::/EFI/mos
mcopy -i esp.img BOOTX64.EFI ::/EFI/BOOT/BOOTX64.EFI
mcopy -i esp.img grub.cfg    ::/EFI/mos/grub.cfg
mcopy -i esp.img grubenv     ::/EFI/mos/grubenv
mcopy -i esp.img vmlinuz     ::/vmlinuz-a
mcopy -i esp.img initrd.img  ::/initrd-a
mcopy -i esp.img vmlinuz     ::/vmlinuz-b
mcopy -i esp.img initrd.img  ::/initrd-b

# Both slots start life with the same CONTENTS, as on cx3576: an image that
# shipped an empty B would have nothing to fall back TO on the first bad update.
#
# But B gets its OWN filesystem identity, not a copy of A's. `cp` plus `mlabel`
# changed the label and left the FAT volume id as A's, so the layout declared
# BOOT_B_FAT_VOLUME_ID and nothing ever wrote it -- a constant with no reader,
# which is the same shape as the boot-attempts value that sat in this board's
# layout claiming a U-Boot contract grub does not implement. Found by running
# os/verify-image-v2.sh against an x64 image for the first time:
#   FAIL: factory: BOOT-B FAT volume id is 'C3576103', expected C3576104
#
# mlabel cannot set a volume id, so B is made rather than copied, and the
# contents are copied in afterwards. os/mkimage-v2.sh builds cx3576's two slots
# the same way, each through mkfs.vfat with its own -n and -i.
truncate -s "${esp_bytes}" esp-b.img
mkfs.vfat -F 32 -n "${BOOT_B_FAT_LABEL}" -i "${BOOT_B_FAT_VOLUME_ID}" esp-b.img >/dev/null
mmd -i esp-b.img ::/EFI ::/EFI/BOOT ::/EFI/mos
mcopy -i esp-b.img BOOTX64.EFI ::/EFI/BOOT/BOOTX64.EFI
mcopy -i esp-b.img grub.cfg    ::/EFI/mos/grub.cfg
mcopy -i esp-b.img grubenv     ::/EFI/mos/grubenv
mcopy -i esp-b.img vmlinuz     ::/vmlinuz-a
mcopy -i esp-b.img initrd.img  ::/initrd-a
mcopy -i esp-b.img vmlinuz     ::/vmlinuz-b
mcopy -i esp-b.img initrd.img  ::/initrd-b

# The two slots must differ ONLY in their filesystem identity. Asserted here
# rather than left to the verifier: a divergence introduced above would ship,
# and the verifier only checks the files it knows to look for.
a_list="$(mdir -/ -b -i esp.img ::/ | sort)"
b_list="$(mdir -/ -b -i esp-b.img ::/ | sort)"
[ "${a_list}" = "${b_list}" ] || {
    echo "error: the two boot slots do not carry the same files" >&2
    diff <(printf '%s\n' "${a_list}") <(printf '%s\n' "${b_list}") >&2 || true
    exit 1
}

mkfs_ext4() {
    local out="$1" mib="$2" label="$3" uuid="$4"
    truncate -s "$(( mib * MIB ))" "${out}"
    mkfs.ext4 -q -F -b "${EXT4_BLOCK_SIZE}" -O "${EXT4_FEATURES}" \
        -L "${label}" -U "${uuid}" "${out}"
}
mkfs_ext4 meta.img      "${META_SIZE_MIB}" "${META_FS_LABEL}"      "${META_FS_UUID}"
mkfs_ext4 state.img     "${STATE_SIZE_MIB}" "${STATE_FS_LABEL}"     "${STATE_FS_UUID}"
mkfs_ext4 ephemeral.img "${MOS_VAR_MIB}"   "${EPHEMERAL_FS_LABEL}" "${EPHEMERAL_FS_UUID}"
mkfs_ext4 data.img      "${DATA_SIZE_MIB}" "${DATA_FS_LABEL}"      "${DATA_FS_UUID}"

truncate -s "$(( DISK_MIB * MIB ))" disk.img
sgdisk --disk-guid="${DISK_GUID}" \
    --new="${BOOT_A_PARTNUM}:$(( BOOT_A_START_MIB * MIB / 512 )):+${BOOT_SIZE_MIB}M" \
    --typecode="${BOOT_A_PARTNUM}:${BOOT_A_TYPECODE}" \
    --partition-guid="${BOOT_A_PARTNUM}:${BOOT_A_GUID}" \
    --change-name="${BOOT_A_PARTNUM}:${BOOT_A_LABEL}" \
    --new="${BOOT_B_PARTNUM}:$(( BOOT_B_START_MIB * MIB / 512 )):+${BOOT_SIZE_MIB}M" \
    --typecode="${BOOT_B_PARTNUM}:${BOOT_B_TYPECODE}" \
    --partition-guid="${BOOT_B_PARTNUM}:${BOOT_B_GUID}" \
    --change-name="${BOOT_B_PARTNUM}:${BOOT_B_LABEL}" \
    --new="${ROOTFS_A_PARTNUM}:$(( ROOTFS_A_START_MIB * MIB / 512 )):+${SLOT_MIB}M" \
    --typecode="${ROOTFS_A_PARTNUM}:${ROOTFS_A_TYPECODE}" \
    --partition-guid="${ROOTFS_A_PARTNUM}:${ROOTFS_A_GUID}" \
    --change-name="${ROOTFS_A_PARTNUM}:${ROOTFS_A_LABEL}" \
    --new="${ROOTFS_B_PARTNUM}:$(( ROOTFS_B_START_MIB * MIB / 512 )):+${SLOT_MIB}M" \
    --typecode="${ROOTFS_B_PARTNUM}:${ROOTFS_B_TYPECODE}" \
    --partition-guid="${ROOTFS_B_PARTNUM}:${ROOTFS_B_GUID}" \
    --change-name="${ROOTFS_B_PARTNUM}:${ROOTFS_B_LABEL}" \
    --new="${META_PARTNUM}:$(( META_START_MIB * MIB / 512 )):+${META_SIZE_MIB}M" \
    --typecode="${META_PARTNUM}:${META_TYPECODE}" \
    --partition-guid="${META_PARTNUM}:${META_GUID}" \
    --change-name="${META_PARTNUM}:${META_LABEL}" \
    --new="${STATE_PARTNUM}:$(( STATE_START_MIB * MIB / 512 )):+${STATE_SIZE_MIB}M" \
    --typecode="${STATE_PARTNUM}:${STATE_TYPECODE}" \
    --partition-guid="${STATE_PARTNUM}:${STATE_GUID}" \
    --change-name="${STATE_PARTNUM}:${STATE_LABEL}" \
    --new="${EPHEMERAL_PARTNUM}:$(( EPHEMERAL_START_MIB * MIB / 512 )):+${MOS_VAR_MIB}M" \
    --typecode="${EPHEMERAL_PARTNUM}:${EPHEMERAL_TYPECODE}" \
    --partition-guid="${EPHEMERAL_PARTNUM}:${EPHEMERAL_GUID}" \
    --change-name="${EPHEMERAL_PARTNUM}:${EPHEMERAL_LABEL}" \
    --new="${DATA_PARTNUM}:$(( DATA_START_MIB * MIB / 512 )):+${DATA_SIZE_MIB}M" \
    --typecode="${DATA_PARTNUM}:${DATA_TYPECODE}" \
    --partition-guid="${DATA_PARTNUM}:${DATA_GUID}" \
    --change-name="${DATA_PARTNUM}:${DATA_LABEL}" \
    disk.img >/dev/null

place() { dd if="$1" of=disk.img bs=1M seek="$2" conv=notrunc status=none; }
place esp.img       "${BOOT_A_START_MIB}"
place esp-b.img     "${BOOT_B_START_MIB}"
place rootfs.img    "${ROOTFS_A_START_MIB}"
place rootfs.img    "${ROOTFS_B_START_MIB}"
place meta.img      "${META_START_MIB}"
place state.img     "${STATE_START_MIB}"
place ephemeral.img "${EPHEMERAL_START_MIB}"
place data.img      "${DATA_START_MIB}"

sgdisk --verify disk.img >/dev/null
echo "assembled ${DISK_MIB} MiB, ${SLOT_MIB} MiB per rootfs slot"
INNER

cp "${LAYOUT_ENV}" "${WORK}/layout.env"
{
    echo "DISK_MIB=${disk_mib}"
    echo "SLOT_MIB=${slot_mib}"
    echo "ROOTFS_B_START_MIB=${rootfs_b_start}"
    echo "META_START_MIB=${meta_start}"
    echo "STATE_START_MIB=${state_start}"
    echo "EPHEMERAL_START_MIB=${ephemeral_start}"
    echo "DATA_START_MIB=${data_start}"
} >>"${WORK}/layout.env"

docker run --rm -v "${WORK}:/w" \
    debian:trixie-slim bash -c '
        apt-get update -qq >/dev/null 2>&1
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
            gdisk dosfstools mtools e2fsprogs grub-efi-amd64-bin grub-common >/dev/null 2>&1
        bash /w/assemble.sh' || {
    echo "error: image assembly failed" >&2
    exit 1
}

mv "${WORK}/disk.img" "${IMG}"
ln -sf "$(basename "${IMG}")" "${OUT_DIR}/${IMAGE_LATEST_NAME}"
echo "=== image: ${IMG} ($(stat -c%s "${IMG}") bytes, $(( $(stat -c%s "${IMG}") / 1048576 )) MiB) ==="
echo "=== cmdline A ==="
echo "${CMDLINE_A}"
