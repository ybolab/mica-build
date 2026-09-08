#!/usr/bin/env bash
# ENTRY SCRIPT -- compose a SECOND signed root for the two-roots proof, without
# disturbing the shipped one.
#
# WHAT IT PROVES, or rather what it makes provable: proof 2 needs two roots
# with different hashes that the same kernel accepts, and the honest way to get
# the second is to compose one. rootfs/build.sh writes into `_out/<board>/`,
# which is also where the assembled image's companions live -- so this script
# takes the shipped root and its environment aside first, composes the second
# with a package declined, moves the result out of the way, and puts the
# shipped pair back with their timestamps. Without that, `verify --board
# <board>` afterwards reports on a root the image was not built from, which is
# exactly the red this script exists to prevent.
#
# ON WHICH TARGET. Any board whose root this checkout can compose; the pool for
# that architecture has to exist and to carry this tree's stamp.
#
#   bash tests/signed-boot-lab/second-root.sh --board x64 [--without rauc]
#
# The composition ends non-zero on purpose-built roots that decline a feature:
# rootfs/build.sh's last step executes the self-built binaries and refuses a
# reduced set by name. The root and its verity tree are already written when
# that happens, which is what this script keeps.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

BOARD=""; WITHOUT=rauc
while [ "$#" -gt 0 ]; do
    case "$1" in
        --board)   BOARD="${2:?--board takes a board name}"; shift 2 ;;
        --without) WITHOUT="${2:?--without takes a package name}"; shift 2 ;;
        *) echo "error: '$1' is not an option this script takes" >&2; exit 2 ;;
    esac
done
[ -n "${BOARD}" ] || { echo "error: --board is required" >&2; exit 2; }

OUT="${REPO_ROOT}/_out/${BOARD}"
KEEP="${LAB_WORK}/second-root/${BOARD}"
DEST="${LAB_WORK}/roots/${BOARD}-without-${WITHOUT}"
[ -s "${OUT}/rootfs-verity.img" ] || {
    echo "error: ${OUT}/rootfs-verity.img does not exist, so there is no shipped root to protect. Compose one first: MOS_BOARD=${BOARD} bash rootfs/build.sh" >&2
    exit 1
}
mkdir -p "${KEEP}" "${DEST}"

# Preserved with -p: the assembled image is checked against the packed root's
# mtime, and a copy that came back NEWER than the image reads as "the image is
# stale" -- measured.
lab_note "taking the shipped root of ${BOARD} aside"
cp -p "${OUT}/rootfs-verity.img" "${OUT}/rootfs-verity.env" "${KEEP}/"

restore() {
    lab_note "restoring the shipped root of ${BOARD}"
    cp -p "${KEEP}/rootfs-verity.img" "${KEEP}/rootfs-verity.env" "${OUT}/"
}
trap restore EXIT

lab_note "composing ${BOARD} with ${WITHOUT} declined"
set +e
( cd "${REPO_ROOT}" && MOS_BOARD="${BOARD}" MOS_ROOTFS_WITHOUT="${WITHOUT}" bash rootfs/build.sh )
rc=$?
set -e
[ -s "${OUT}/rootfs-verity.img" ] || { echo "error: the second composition wrote no root (rootfs/build.sh exited ${rc})" >&2; exit 1; }
cp "${OUT}/rootfs-verity.img" "${OUT}/rootfs-verity.env" "${DEST}/"
lab_note "second root in ${DEST} (rootfs/build.sh exited ${rc}; a non-zero status here is its smoke step refusing a reduced package set, after the root was packed)"
grep '^VERITY_ROOT_HASH=' "${DEST}/rootfs-verity.env" "${KEEP}/rootfs-verity.env"
