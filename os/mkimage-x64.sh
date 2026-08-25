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

# --- the kernel command line, split by what changes --------------------------
# Same FORM as cx3576's and produced from the same verity env; on cx3576 the
# kernel's own dm-init reads it, here the initramfs script does. One format, so
# the boot contract is one thing.
#
# But it is ASSEMBLED IN TWO PLACES (RFCT-106). The board constants -- each
# slot's PARTUUID, the fixed arguments -- are rendered into grub.cfg, which no
# update ever rewrites. The per-image facts below go into a fragment per slot,
# which RAUC replaces on every install. The dividing line is not style: a
# bundle carries one image per slot CLASS, so the fragment's bytes have to be
# correct for whichever slot the install targets, and anything slot-specific in
# it would make one of the two wrong.
cmdline_facts() {
    printf 'set MOS_SECTORS=%s\n' "${VERITY_DATA_SECTORS}"
    printf 'set MOS_DATA_BLOCK_SIZE=%s\n' "${VERITY_DATA_BLOCK_SIZE}"
    printf 'set MOS_HASH_BLOCK_SIZE=%s\n' "${VERITY_HASH_BLOCK_SIZE}"
    printf 'set MOS_DATA_BLOCKS=%s\n' "${VERITY_DATA_BLOCKS}"
    printf 'set MOS_HASH_START_BLOCK=%s\n' "${VERITY_HASH_START_BLOCK}"
    printf 'set MOS_HASH_ALGO=%s\n' "${VERITY_HASH_ALGO}"
    printf 'set MOS_ROOT_HASH=%s\n' "${VERITY_ROOT_HASH}"
    printf 'set MOS_SALT=%s\n' "${VERITY_SALT}"
}

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
# grub.cfg carries the BOARD constants and nothing that changes with a build.
sed -e "s|@ROOTFS_A_PARTUUID@|$(lower "${ROOTFS_A_GUID}")|g" \
    -e "s|@ROOTFS_B_PARTUUID@|$(lower "${ROOTFS_B_GUID}")|g" \
    -e "s|@BOOT_A_PARTNUM@|${BOOT_A_PARTNUM}|g" \
    -e "s|@BOOT_B_PARTNUM@|${BOOT_B_PARTNUM}|g" \
    -e "s|@BOARD_CMDLINE_ARGS@|${BOARD_CMDLINE_ARGS}|g" \
    "${GRUB_CFG_IN}" > "${WORK}/grub.cfg"
if grep -q '@[A-Z_]\+@' "${WORK}/grub.cfg"; then
    echo "error: unrendered placeholder left in grub.cfg" >&2
    grep -n '@[A-Z_]\+@' "${WORK}/grub.cfg" >&2
    exit 1
fi

# NO ROOT HASH ON A `linux` LINE. The verity table is there, because the
# PARTUUIDs in it are board constants -- but every value that changes with the
# build must arrive as a ${MOS_*} variable from the per-slot fragment. A
# literal hash here would be a per-install fact in the one file RAUC never
# rewrites, which is the whole defect RFCT-106 exists to remove.
#
# Asserted against the RENDERED file and by SHAPE (a run of 32+ hex bytes),
# not by grepping for the word "verity": two earlier drafts of this check did
# that and rejected the correct file, once for a comment and once for the
# console message printed when a fragment is missing.
if grep -E '^[[:space:]]*linux[[:space:]]' "${WORK}/grub.cfg" | grep -cE '[0-9a-f]{32,}' >/dev/null; then
    echo "error: a linux line in ${GRUB_CFG_IN} carries a literal hash. The dm-verity root hash changes with every build, so it belongs in the per-slot fragment RAUC installs, not in the file it must never rewrite" >&2
    grep -nE '^[[:space:]]*linux[[:space:]]' "${WORK}/grub.cfg" >&2
    exit 1
fi
# ...and the composition must actually reference the fragment's variables, or
# the line above would be "clean" because it says nothing at all.
for v in MOS_SECTORS MOS_DATA_BLOCKS MOS_HASH_START_BLOCK MOS_ROOT_HASH MOS_SALT; do
    if ! grep -qE "^[[:space:]]*linux[[:space:]].*\\\${${v}}" "${WORK}/grub.cfg"; then
        echo "error: no linux line in ${GRUB_CFG_IN} uses \${${v}}; the per-slot fragment would be installed and never read" >&2
        exit 1
    fi
done

# The per-slot fragments. Identical bytes today -- both slots ship the same
# rootfs image -- and each replaced independently by an install.
cmdline_facts > "${WORK}/cmdline.cfg"

cat >"${WORK}/assemble.sh" <<'INNER'
set -eu
cd /w
# The layout is SOURCED here rather than threaded through fifty `docker run -e`
# flags. The -e form passes only EXPORTED variables, so a layout key that was
# merely set -- which is every key in the file -- arrives unset, and `set -u`
# then names one of them while the other forty-nine are equally missing.
. /w/layout.env
MIB=1048576

# --- the ESP: static, in no slot group ---------------------------------------
esp_bytes=$(( ESP_SIZE_MIB * MIB ))
truncate -s "${esp_bytes}" esp.img
mkfs.vfat -F 32 -n "${ESP_FAT_LABEL}" -i "${ESP_FAT_VOLUME_ID}" esp.img >/dev/null

# FAT32 OR THE FIRMWARE WILL NOT MOUNT IT. Below 65525 clusters the filesystem
# is not FAT32 no matter what -F said, and mkfs.vfat does not refuse: at 32 MiB
# it produced an image mtools read happily, mdir listed, the verifier passed --
# and OVMF left the ESP out of its filesystem list entirely and dropped to the
# UEFI shell. Every check that read the filesystem with mtools agreed it was
# fine, because mtools is not the firmware.
# THE CLUSTER COUNT, not the type the filesystem CLAIMS.
#
# The FAT specification defines the type by cluster count and nothing else:
# under 4085 it is FAT12, under 65525 it is FAT16, at or above it is FAT32.
# `mkfs.vfat -F 32` does not enforce that. Given a 32 MiB partition it writes a
# FAT32 boot sector over 64495 clusters and reports success, and minfo -- which
# reads the type out of the BPB -- calls it FAT32. OVMF computes the type the
# way the spec says, finds a FAT32 BPB describing a FAT16 cluster count, and
# refuses the filesystem: the ESP was simply absent from the firmware's device
# list and the machine dropped to the UEFI shell.
#
# The first version of this check asked minfo for the type. It passed on that
# exact 32 MiB image -- the one that would not boot. Measured floor: 33 MiB is
# the first size that yields >= 65525 clusters at 512-byte sectors.
esp_clusters="$(minfo -i esp.img 2>/dev/null | sed -n 's/^free clusters=//p' | head -n1)"
if [ -z "${esp_clusters}" ] || [ "${esp_clusters}" -lt 65525 ]; then
    echo "error: the ESP has ${esp_clusters:-an unreadable number of} clusters, below the 65525 the FAT specification requires for FAT32. mkfs.vfat wrote a FAT32 boot sector over it anyway and every tool that trusts the boot sector will agree it is FAT32 -- the firmware will not, and firmware that cannot mount the ESP reports nothing at all. Raise ESP_SIZE_MIB (33 MiB is the measured floor)" >&2
    minfo -i esp.img >&2 || true
    exit 1
fi

# GRUB, with every module it needs embedded. grub-install writes into a MOUNTED
# ESP and this script never mounts anything -- a loop mount needs privileges
# that a build should not want. grub-mkstandalone produces one self-contained
# EFI binary instead, and the memdisk config below is the only thing it needs
# to find the real one.
#
# `regexp` is in the module list because grub.cfg uses it to take the disk out
# of $root and address each slot's boot partition on the SAME disk. Without it
# the command silently does nothing, mos_disk stays empty, and every menuentry
# looks for its kernel on a device spelled ",gpt2".
cat >early.cfg <<EARLY
search --no-floppy --label ${ESP_FAT_LABEL} --set root
set prefix=(\$root)/EFI/mos
configfile (\$root)/EFI/mos/grub.cfg
EARLY

grub-mkstandalone \
    --format=x86_64-efi \
    --output=BOOTX64.EFI \
    --modules="part_gpt fat search search_label configfile linux normal echo test loadenv regexp" \
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

# NOTHING PER-SLOT ON THE ESP. Asserted rather than assumed: a kernel or a
# cmdline that reappeared here would be read by GRUB in preference to nothing
# -- there is no "nothing" to prefer -- and would then be a per-install file on
# the one partition RAUC never installs into.
for stray in vmlinuz initrd.img cmdline.cfg; do
    if mdir -/ -b -i esp.img ::/ 2>/dev/null | grep -cxF "::/${stray}" >/dev/null; then
        echo "error: ${stray} is on the ESP. The per-slot payload belongs on the slot's own boot partition; on the ESP no install would ever replace it" >&2
        exit 1
    fi
done

# --- the per-slot boot partitions --------------------------------------------
# Both start life with the same contents: an image whose B side was empty would
# have nothing to fall back TO on the first bad update. Each gets its OWN
# filesystem identity, though -- `cp` plus `mlabel` changed the label and left
# the volume id as A's, so BOOT_B_FAT_VOLUME_ID sat in the layout with nothing
# writing it. mlabel cannot set a volume id, so each is made rather than copied.
boot_bytes=$(( BOOT_SIZE_MIB * MIB ))
for slot in a b; do
    case "${slot}" in
    a) label="${BOOT_A_FAT_LABEL}"; volid="${BOOT_A_FAT_VOLUME_ID}" ;;
    b) label="${BOOT_B_FAT_LABEL}"; volid="${BOOT_B_FAT_VOLUME_ID}" ;;
    esac
    truncate -s "${boot_bytes}" "boot-${slot}.img"
    mkfs.vfat -F 32 -n "${label}" -i "${volid}" "boot-${slot}.img" >/dev/null
    mcopy -i "boot-${slot}.img" vmlinuz     "::/${SLOT_KERNEL_NAME}"
    mcopy -i "boot-${slot}.img" initrd.img  "::/${SLOT_INITRD_NAME}"
    mcopy -i "boot-${slot}.img" cmdline.cfg "::/${SLOT_CMDLINE_NAME}"
done

# The two slots must differ ONLY in their filesystem identity.
a_list="$(mdir -/ -b -i boot-a.img ::/ | sort)"
b_list="$(mdir -/ -b -i boot-b.img ::/ | sort)"
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
    --new="${ESP_PARTNUM}:$(( ESP_START_MIB * MIB / 512 )):+${ESP_SIZE_MIB}M" \
    --typecode="${ESP_PARTNUM}:${ESP_TYPECODE}" \
    --partition-guid="${ESP_PARTNUM}:${ESP_GUID}" \
    --change-name="${ESP_PARTNUM}:${ESP_LABEL}" \
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
place esp.img       "${ESP_START_MIB}"
place boot-a.img    "${BOOT_A_START_MIB}"
place boot-b.img    "${BOOT_B_START_MIB}"
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
echo "=== slot A boot facts (the fragment RAUC replaces on every install) ==="
cmdline_facts | sed 's/^/  /'
echo "=== the linux line that consumes them (from grub.cfg, never rewritten) ==="
grep -E '^[[:space:]]*linux ' "${WORK}/grub.cfg" 2>/dev/null | head -n 1 | sed 's/^ */  /' || true
