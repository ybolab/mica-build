#!/bin/sh
# PLAN-086 S2: take the boot inputs OUT of the root, into the one export the
# image assembler and the bundle builder both read.
#
# Called from rootfs/compose/90-pack.Dockerfile (pack stage), where the
# reasoning lives. Reads /rootfs, writes /out/boot/, and REMOVES from /rootfs
# what it wrote -- which is the half this script did not use to do.
#
# WHY THEY WERE EVER IN THE ROOT. The board and kernel packages carry them on
# purpose: mos-board-cx3576's control says it, and boards/cx3576/deb/
# board-cx3576/Dockerfile says why -- "the finalizer exports the SELECTED
# board's boot artifacts from the installed package rather than reach back into
# boards/, so which blobs an image was assembled from is a property of the
# package set that composed it". That argument is about PROVENANCE and it is
# kept: this script is the finalizer doing exactly that export. What it does not
# require is that the blobs then also SHIP. Nothing on the device reads them --
# the kernel a slot boots comes off the boot partition, and U-Boot comes out of
# the loader region -- so a copy inside the verity root is 54 MB on cx3576 and
# 53 MB on a UEFI board of content the device already has somewhere it can
# actually use.
#
# WHAT IS NOT REMOVED: /boot/config-<release>. It is not a boot input -- no
# bootloader reads it -- it is the record of how the kernel beside it was
# configured, and the image contract reads it out of the packed root
# (verify/src/checks-kernel.ts) to assert this board's no-initramfs verity
# floor. 227 KB, and it is the subject of a check rather than a duplicate of
# anything on the boot partition.
set -eu

: "${MOS_BOARD:?pack-export-boot.sh needs MOS_BOARD to name the board directory it exports}"
mkdir -p /out/boot

exported=""
stage() { # stage <source> <name in /out/boot>
    [ ! -e "/out/boot/$2" ] ||
        { echo "error: two boot inputs would both be exported as /out/boot/$2; the export is flat because that is how the assembler names them, so two sources for one name is one of them silently winning" >&2; exit 1; }
    cp "$1" "/out/boot/$2"
    chmod 0644 "/out/boot/$2"
    exported="${exported} $2"
}

if ls /rootfs/boot/vmlinuz-* >/dev/null 2>&1; then
    kernels="$(ls /rootfs/boot/vmlinuz-* | wc -l)"
    [ "${kernels}" = 1 ] ||
        { echo "error: the packed root carries ${kernels} kernels in /boot, so which one this exports -- and therefore which one the bootloader launches -- would be decided by sort order" >&2; exit 1; }

    # NO INITRAMFS, and the assertion is the inverse of the one this script
    # used to make.
    #
    # Until PLAN-074 this board ran Debian's generic kernel, which has no
    # CONFIG_DM_INIT and so ignored the dm-mod.create= verity table on the
    # kernel command line. An initrd re-implemented it, this script exported
    # that initrd, and it checked the archive for veritysetup and the
    # mos-verity local-top script -- because without them the boot stopped at
    # "ALERT! /dev/dm-0 does not exist". mos-kernel-x64 carries the device
    # mapper, dm-verity and squashfs built in and reads the command line
    # itself, exactly as cx3576's kernel does, so there is no initrd to export
    # and no archive to inspect.
    #
    # RFCT-281 IS NOT DROPPED HERE, IT IS RESTATED STRONGER. That clause said
    # BusyBox must not be an initramfs dependency, and it was checked by
    # listing the exported initrd and refusing any entry named for busybox.
    # With no initrd that grep would search nothing and report green forever --
    # so what is asserted instead is the fact that makes the clause
    # unconditional: this board's early boot has no userspace at all, because
    # there is no initramfs for one to live in. verify/src/checks-busybox.ts
    # keeps the other half, over the /etc/initramfs-tools and
    # /usr/share/initramfs-tools trees that a reintroduced initramfs would have
    # to bring back with it.
    #
    # Checked in the ROOT rather than in /out, and both spellings of the name:
    # an initrd nothing exports is still an initrd something built, and the
    # question is whether this image grew an early userspace, not whether this
    # script copied one.
    initrds="$(ls /rootfs/boot/initrd.img-* /rootfs/boot/initrd-* 2>/dev/null | tr '\n' ' ')"
    [ -z "${initrds}" ] ||
        { echo "error: the packed root carries an initramfs: ${initrds}. This board's kernel assembles the dm-verity root from the kernel command line and the bootloader passes no initrd, so nothing here is supposed to build one -- something has reintroduced initramfs-tools and a kernel package whose postinst fires it, and early boot has grown a userspace that is neither verified nor covered by RFCT-281's BusyBox clause" >&2; exit 1; }

    # The floor the absent initrd is only safe WITHOUT. Read off the config the
    # image ships beside the kernel, so this is a statement about the artefact
    # rather than about the build that produced it.
    release="$(ls /rootfs/boot/vmlinuz-* | sed 's|.*/vmlinuz-||')"
    config="/rootfs/boot/config-${release}"
    [ -f "${config}" ] ||
        { echo "error: the packed root has /boot/vmlinuz-${release} and no /boot/config-${release} beside it, so nothing states how the kernel this image boots was configured and the check below has nothing to read" >&2; exit 1; }
    for option in DM_INIT BLK_DEV_DM DM_VERITY SQUASHFS; do
        grep -q "^CONFIG_${option}=y\$" "${config}" ||
            { echo "error: ${config} does not declare CONFIG_${option}=y. With no initramfs, everything between 'the disk exists' and 'the verity root is mounted' has to be in the kernel image; as a module it cannot be loaded, because there is nothing to load it from yet" >&2; exit 1; }
    done

    stage "/rootfs/boot/vmlinuz-${release}" vmlinuz
    rm -f "/rootfs/boot/vmlinuz-${release}"
    echo "boot: kernel ${release} carries the no-initramfs verity floor built in, and the root has no initrd"
    echo "boot: exported vmlinuz for a bootloader that cannot read squashfs, and took it out of the root"
else
    echo "boot: no /boot/vmlinuz-* in the root; this board's bootloader is given its kernel by the board package"
    : > /out/boot/.no-kernel-in-root
fi

# The board's own boot inputs. On cx3576 that directory is the kernel Image,
# the device tree, the U-Boot binary and boot.cmd; on a UEFI board it does not
# exist at all, and has not since mos-board-x64 stopped shipping a grub.cfg
# (tests/dual-build-sanctions.md, addendum 2026-08-31).
#
# EVERYTHING IN IT IS EXPORTED AND THEN THE TREE GOES. That is not a guess about
# the contents: this directory is the finalizer's input by construction -- the
# board package's control field says nothing there is executed on the device --
# so a file in it is either a boot input or a file in the wrong place. Exporting
# whatever is there and removing the tree keeps those two from having different
# outcomes.
BOARD_INPUTS="/rootfs/usr/lib/mos/board/${MOS_BOARD}"
if [ -d "${BOARD_INPUTS}" ]; then
    INPUT_LIST=/tmp/pack-export-boot.inputs
    find "${BOARD_INPUTS}" -mindepth 1 | LC_ALL=C sort >"${INPUT_LIST}"
    [ -s "${INPUT_LIST}" ] ||
        { echo "error: ${BOARD_INPUTS#/rootfs} exists and is empty. The board package creates that directory to carry this board's kernel, device tree and bootloader into the finalizer, so an empty one means the assembler is about to be handed nothing and the image would boot whatever was in the slot before" >&2; exit 1; }
    n=0
    while IFS= read -r b; do
        [ -f "${b}" ] ||
            { echo "error: ${b#/rootfs} is not a regular file. /usr/lib/mos/board/${MOS_BOARD} is the finalizer's boot-input staging area and holds blobs; a directory or a link in it is something else, which this export would flatten or follow" >&2; exit 1; }
        stage "${b}" "$(basename "${b}")"
        n=$((n + 1))
    done <"${INPUT_LIST}"
    rm -f "${INPUT_LIST}"
    rm -rf /rootfs/usr/lib/mos/board
    echo "boot: exported ${n} board boot input(s) from /usr/lib/mos/board/${MOS_BOARD} and took the directory out of the root"
else
    echo "boot: no /usr/lib/mos/board/${MOS_BOARD} in the root; this board stages no boot blobs through its board package"
fi

# What was just done, asserted over the tree rather than over this script's own
# bookkeeping. PLAN-086's acceptance clause is "final production rootfs contains
# no boot-image copies", and these are the names one can take: a kernel by
# either spelling, an initrd, a flattened device tree, a U-Boot image, and the
# whole board staging directory.
residue="$({ find /rootfs/boot /rootfs/usr/lib/mos/board \
    \( -name 'vmlinuz*' -o -name 'Image' -o -name 'bzImage' -o -name 'initrd*' \
       -o -name '*.dtb' -o -name 'u-boot*' -o -name 'boot.cmd' \) \
    2>/dev/null || true; } | sed 's|^/rootfs||' | tr '\n' ' ')"
[ -z "${residue}" ] ||
    { echo "error: the packed root still carries boot inputs after the export:${residue}" >&2; exit 1; }

echo "boot: /out/boot holds${exported:- (nothing but the no-kernel marker)}"
