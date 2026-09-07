#!/usr/bin/env bash
# Write files into the STATE partition of a board's disk image before booting it.
#
#   bash tools/qemu-seed-state.sh <local-file> <path-inside-state> [...]
#   bash tools/qemu-seed-state.sh ./app.container /quadlet/app.container
#
# WHY. STATE is where a device's configuration lives: mosd's settings.toml, the
# Quadlet directory, the STATE-backed unit directory. Testing anything that
# depends on configuration means putting configuration there, and the guest has
# no login and no network in.
#
# debugfs writes into the ext4 image directly. A loop mount would need
# privileges a build should not want, and would also mean the harness could
# corrupt the host if it got a path wrong.
#
# The image itself is never touched: this edits _out/<board>/.qemu/disk.img, the
# copy the boot engine boots. MOS_BOARD selects the board; x64 is the default. Run it AFTER that copy has been made -- which the
# prepare step does at the start of every run, so the order is:
#
#   bun run src/qemu.ts --prepare-only           (makes the copy, boots nothing)
#   bash tools/qemu-seed-state.sh ...         (writes into it)
#   MOS_QEMU_REUSE_DISK=1 bun run src/qemu.ts --capture ...
#
# The engine is pkgs/mosd/tests/apid-api/src/qemu.ts and it runs in a container carrying
# bun and a docker client; pkgs/mosd/tests/apid-api/run.sh is what invokes it, and calls
# this script in between the two lines above.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# WHICH BOARD, read from the environment the way pkgs/mosd/tests/apid-api/run.sh
# reads it, and defaulting the same way. That harness has been board-
# parameterised since PLAN-085 slice 5 and calls this script with no board
# argument, so a hard-coded x64 here made `MOS_BOARD=virt-arm64` seed the x64
# disk: the run then booted a guest whose STATE had no guest script in it, and
# the phase that reads the script's console lines reported "the smoke never
# ran" -- true, and about the wrong disk. STATE_PARTNUM and STATE_SIZE_MIB below
# come from the layout, so seeding the wrong board also means dd-ing at another
# board's offsets.
MOS_BOARD="${MOS_BOARD:-x64}"
BOARD_ENV="${REPO_ROOT}/boards/${MOS_BOARD}/board.env"
[ -f "${BOARD_ENV}" ] ||
    { echo "error: MOS_BOARD is '${MOS_BOARD}' and ${BOARD_ENV} does not exist; a board IS its board.env" >&2; exit 1; }
OUT_DIR="${REPO_ROOT}/_out/${MOS_BOARD}"
# shellcheck source=/dev/null  # a data file of assignments, resolved at runtime
. "${BOARD_ENV}"
DISK="${OUT_DIR}/.qemu/disk.img"

if [ ! -f "${DISK}" ]; then
    echo "error: ${DISK} not found. Prepare the disk first -- pkgs/mosd/tests/apid-api/run.sh does that with pkgs/mosd/tests/apid-api/src/qemu.ts --prepare-only: this writes into the disk copy that step makes, not into the image itself." >&2
    exit 1
fi
if [ "$#" -eq 0 ] || [ $(( $# % 2 )) -ne 0 ]; then
    echo "usage: $0 <local-file> <path-inside-state> [<local-file> <path-inside-state> ...]" >&2
    exit 2
fi

WORK="${OUT_DIR}/.seed"
rm -rf "${WORK}"
mkdir -p "${WORK}/files"
trap 'rm -rf "${WORK}"' EXIT

: >"${WORK}/manifest"
n=0
while [ "$#" -gt 0 ]; do
    src="$1"; dst="$2"; shift 2
    [ -f "${src}" ] || { echo "error: ${src} not found" >&2; exit 1; }
    case "${dst}" in
    /*) ;;
    *) echo "error: '${dst}' must be an absolute path inside STATE" >&2; exit 1 ;;
    esac
    cp "${src}" "${WORK}/files/f${n}"
    printf '%s %s\n' "f${n}" "${dst}" >>"${WORK}/manifest"
    n=$((n + 1))
done

# The VALUES, not `-e NAME`. Layout keys are set, not exported, so the bare
# form passes nothing and the container fails on an unbound variable while
# forty-nine others are equally absent. Same trap as the x64 assembler's
# (build/src/mkimage-uefi.ts).
# The base, from build-env/images.env, resolved the way every container in
# this tree resolves one. This one writes INTO the STATE partition of a disk
# image with mke2fs and debugfs, so which e2fsprogs it gets decides what the
# guest then mounts.
SEED_IMAGE="$(bash "${REPO_ROOT}/build-env/from.sh" --ref IMAGE_DEBIAN_TRIXIE)"

# mos-build-side: container-block -- debugfs and sgdisk read and write the disk copy
# inside the pinned image; a loop mount on the host would need privileges a build should
# not want
docker run --rm -v "${WORK}:/w" -v "${OUT_DIR}/.qemu:/d" \
    -e STATE_PARTNUM="${STATE_PARTNUM}" -e STATE_SIZE_MIB="${STATE_SIZE_MIB}" \
    "${SEED_IMAGE}" bash -c '
    set -eu
    apt-get update -qq >/dev/null 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
        gdisk e2fsprogs >/dev/null 2>&1
    cd /w
    start=$(sgdisk -i "${STATE_PARTNUM}" /d/disk.img | sed -n "s/^First sector: \([0-9]*\).*/\1/p")
    [ -n "${start}" ] || { echo "error: no STATE partition in the GPT" >&2; exit 1; }
    count=$(( STATE_SIZE_MIB * 2048 ))
    dd if=/d/disk.img of=state.img bs=512 skip="${start}" count="${count}" status=none

    while read -r local dst; do
        dir="$(dirname "${dst}")"
        # debugfs mkdir does not create parents; walk the path.
        acc=""
        IFS=/ read -ra parts <<<"${dir#/}"
        for p in "${parts[@]}"; do
            [ -n "${p}" ] || continue
            acc="${acc}/${p}"
            debugfs -w -R "mkdir ${acc}" state.img >/dev/null 2>&1 || true
        done
        debugfs -w -R "rm ${dst}" state.img >/dev/null 2>&1 || true
        debugfs -w -R "write /w/files/${local} ${dst}" state.img >/dev/null 2>&1
        # Written, or the run would boot a disk that silently lacks the file
        # and every conclusion drawn from it would be about the wrong system.
        debugfs -R "stat ${dst}" state.img 2>/dev/null | grep -c "Inode:" >/dev/null || {
            echo "error: ${dst} was not written into STATE" >&2; exit 1; }
        echo "  seeded ${dst}"
    done </w/manifest

    e2fsck -fp state.img >/dev/null 2>&1 || true
    dd if=state.img of=/d/disk.img bs=512 seek="${start}" conv=notrunc status=none
'
# mos-build-side: host
echo "STATE seeded in ${DISK##*/}"
