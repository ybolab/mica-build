#!/usr/bin/env bash
# Stage the BSP-dependent inputs of mos-board-cx3576, then build the package.
#
#   [BOARD_DIR=...] bash os/boards/cx3576/deb/render.sh
#
#   -> _out/debs/arm64/pool/mos-board-cx3576_<version>_arm64.deb
#
# THIS IS THE PRODUCER'S ENTRY POINT, and os/rootfs/packages-src/build-deb.sh
# is still the driver: this script does only the work that must happen on the
# HOST, and then hands over.
#
# Three things force a host-side step here, and the profile producer needed
# none of them:
#
#   - BOARD_DIR. os/rootfs/build-v2.sh takes prebuilt BSP artifacts from
#     ${BOARD_DIR:-os/boards/<b>/bsp}, and this producer accepts the same
#     override. A build context in producer.env is a fixed repository-relative
#     path -- that file is plain KEY=value with no expansion, deliberately --
#     so a directory chosen by an environment variable cannot be named there.
#     The artifacts are copied into one fixed staging path instead, and THAT is
#     what producer.env names.
#   - The refusal. A missing BSP input must be reported BEFORE anything is
#     built; inside the Dockerfile it would be reported after buildkit has
#     already resolved the base, transferred the contexts and started a stage.
#   - os/pkgs/rauc/render-config.sh, which is INVOKED rather than reimplemented
#     or copied from. It derives its own repository root from its location and
#     reads three files this producer does not own, so it runs where the
#     repository is: here.
#
# Everything that is a function of committed content alone -- the hwinit split,
# the firmware selection, the modules unpack, the payload's modes and symlinks
# -- is in the Dockerfile, where the rest of the producer family keeps it.
set -euo pipefail

die() {
    echo "render.sh: error: $*" >&2
    exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOARD_ROOT="$(cd "${HERE}/.." && pwd)"
REPO_ROOT="$(cd "${BOARD_ROOT}/../../.." && pwd)"
# The board is this producer's LOCATION, not a constant written down twice: the
# directory that holds board.env is the same one that holds this script.
MOS_BOARD="$(basename "${BOARD_ROOT}")"
PRODUCER_REL="os/boards/${MOS_BOARD}/deb"
LAYOUT_ENV="${BOARD_ROOT}/board.env"

[ -f "${LAYOUT_ENV}" ] ||
    die "${LAYOUT_ENV} does not exist. Every value this producer renders or selects is read from it; there is no default for any of them"
# shellcheck source=../board.env
. "${LAYOUT_ENV}"

# The same override os/rootfs/build-v2.sh accepts, spelled the same way.
BOARD_DIR="${BOARD_DIR:-${BOARD_ROOT}/bsp}"
BSP_MAKEFILE="${BOARD_ROOT}/bsp/Makefile"

# The command that produces a missing BSP artifact, READ OUT OF the BSP
# Makefile rather than written down here. `kernel` and `uboot-mos` are that
# file's target names; a second copy of them in this message is a copy that
# starts naming a target nobody has the day one is renamed, and the whole point
# of the message is that it can be pasted into a shell.
bsp_target_for() {
    awk -v want="-o out/$1 " '
        /^[a-zA-Z][a-zA-Z0-9_.-]*:/ { target = substr($0, 1, index($0, ":") - 1) }
        target != "" && index($0, want) > 0 { print target; exit }
    ' "${BSP_MAKEFILE}"
}

# Every missing input is collected and reported TOGETHER. Reporting the first
# one alone sends a reader through two ten-minute builds to learn that the
# second was missing as well.
MISSING=()
require_bsp() {
    local path="$1" out_subdir="$2"
    [ ! -f "${path}" ] || return 0
    local target
    target="$(bsp_target_for "${out_subdir}")"
    [ -n "${target}" ] ||
        die "no target in ${BSP_MAKEFILE} writes out/${out_subdir}, so this script cannot name the command that produces ${path}. Either the Makefile's output directories moved or ${LAYOUT_ENV} names a variant that is not built there"
    MISSING+=("error: ${path} not found.
Build it with 'make -C os/boards/${MOS_BOARD}/bsp ${target}' or point BOARD_DIR at
prebuilt BSP artifacts, e.g. BOARD_DIR=/srv/ai/mos/os/boards/${MOS_BOARD}/bsp")
}

# The boot inputs the finalizer consumes, derived from the board's own boot-slot
# declaration. BOOT_SLOT_REQUIRED_FILES is what a slot must CONTAIN; two of its
# entries are BSP artifacts and two are made during assembly, so they are
# separated by what produces them rather than by name:
#   @SLOT@       -- the per-slot verity parameters, written by the assembler
#   BOOT_SCRIPT_NAME -- compiled from BOOT_CMD_SOURCE, which is staged below
BOOT_INPUTS=""
for f in ${BOOT_SLOT_REQUIRED_FILES}; do
    case "${f}" in
    *'@SLOT@'*) continue ;;
    "${BOOT_SCRIPT_NAME}") continue ;;
    esac
    BOOT_INPUTS="${BOOT_INPUTS} ${f}"
    require_bsp "${BOARD_DIR}/out/kernel/${f}" kernel
done
[ -n "${BOOT_INPUTS# }" ] ||
    die "${LAYOUT_ENV} declares BOOT_SLOT_REQUIRED_FILES=\"${BOOT_SLOT_REQUIRED_FILES}\" and none of it is a BSP artifact. The package would carry no kernel and no device tree for the finalizer to export"

UBOOT_BIN="${BOARD_DIR}/out/${UBOOT_VARIANT_DIR}/${UBOOT_BIN_NAME}"
require_bsp "${UBOOT_BIN}" "${UBOOT_VARIANT_DIR}"
MODULES_TAR="${BOARD_DIR}/out/kernel/modules.tar"
require_bsp "${MODULES_TAR}" kernel

# Firmware is committed vendor content rather than a build product, so a
# missing file is not answered with a make target. The shape of the message is
# os/rootfs/build-v2.sh's for the same failure.
for fw in ${BOARD_FIRMWARE_FILES}; do
    case "${fw}" in
    /usr/lib/firmware/*) ;;
    *) die "${LAYOUT_ENV} declares BOARD_FIRMWARE_FILES entry '${fw}', which is not under /usr/lib/firmware/. The entries are INSTALLED paths -- the package stages each one at the path it declares, and the verification suite checks the image for the same" ;;
    esac
    fw_src="${BOARD_DIR}/rootfs/firmware/${fw##*/}"
    [ -f "${fw_src}" ] || MISSING+=("error: ${LAYOUT_ENV} declares ${fw} and ${fw_src} does not exist.
Firmware is a BSP artefact like modules.tar; point BOARD_DIR at a tree that has it,
e.g. BOARD_DIR=/srv/ai/mos/os/boards/${MOS_BOARD}/bsp")
done

BOOT_CMD="${REPO_ROOT}/${BOOT_CMD_SOURCE}"
[ -f "${BOOT_CMD}" ] || MISSING+=("error: ${LAYOUT_ENV} declares BOOT_CMD_SOURCE=${BOOT_CMD_SOURCE} and ${BOOT_CMD} does not exist.")

if [ "${#MISSING[@]}" -gt 0 ]; then
    printf '%s\n\n' "${MISSING[@]}" >&2
    echo "render.sh: refusing to build mos-board-cx3576: the BSP inputs above are missing (BOARD_DIR=${BOARD_DIR}). Nothing was staged and no container was started." >&2
    exit 1
fi

# One fixed path, because producer.env names it as a build context and that
# file cannot expand a variable. Under tmp/, which is gitignored and is this
# repository's declared bind-mount root -- os/rootfs/packages-src/build-deb.sh
# puts its own OCI layouts beside it.
STAGE="${REPO_ROOT}/tmp/mos-board-${MOS_BOARD}-deb"
rm -rf "${STAGE}"
mkdir -p "${STAGE}/etc/rauc" "${STAGE}/firmware" "${STAGE}/boot"

# board.env travels with the staged inputs so the Dockerfile reads THE FILE
# rather than a set of build arguments this script would have had to transcribe
# key by key. A whole-file copy cannot disagree with its source.
cp "${LAYOUT_ENV}" "${STAGE}/board.env"

# The rendering, exactly as os/rootfs/build-v2.sh does it. lower() and render()
# are that script's, including the refusal to emit a file with a placeholder
# left in it; SRV_LINE and VAR_OPTS are its values.
#
# PARTUUIDs are lowercased because udev derives /dev/disk/by-partuuid/ from
# libblkid's lowercase GUID formatting and systemd's fstab-generator resolves
# PARTUUID= through those symlinks without normalising case.
lower() { echo "$1" | tr 'A-Z' 'a-z'; }
render() {
    local src="$1" dst="$2"
    shift 2
    local expr=()
    while [ "$#" -gt 0 ]; do
        expr+=(-e "s|@$1@|$2|g")
        shift 2
    done
    sed "${expr[@]}" "${src}" >"${dst}"
    chmod 0644 "${dst}"
    if grep -c '@[A-Z_]\+@' "${dst}" >/dev/null; then
        echo "error: unrendered placeholder left in ${dst}" >&2
        grep -n '@[A-Z_]\+@' "${dst}" >&2
        exit 1
    fi
}

OVERLAY_SRC="${REPO_ROOT}/os/rootfs/overlay-v2"
SRV_LINE="PARTUUID=$(lower "${DATA_GUID}")	/srv	ext4	noatime,x-systemd.growfs	0	2"
VAR_OPTS="noatime"
render "${OVERLAY_SRC}/etc/fstab.in" "${STAGE}/etc/fstab" \
    EPHEMERAL_GUID "$(lower "${EPHEMERAL_GUID}")" \
    STATE_GUID "$(lower "${STATE_GUID}")" \
    META_GUID "$(lower "${META_GUID}")" \
    VAR_OPTS "${VAR_OPTS}" \
    SRV_LINE "${SRV_LINE}"
render "${OVERLAY_SRC}/etc/fw_env.config.in" "${STAGE}/etc/fw_env.config" \
    UENV_A_GUID "$(lower "${UENV_A_GUID}")" \
    UENV_B_GUID "$(lower "${UENV_B_GUID}")" \
    UENV_SIZE_HEX "$(printf '0x%x' "${UENV_SIZE_BYTES}")"

# The RAUC system configuration is that renderer's output, not a second
# rendering of its template: it owns the statusfile placement, the boot-attempts
# radix range and the fw_env.config cross-checks, and every one of those is an
# assertion this producer wants run. SYSTEM_CONF_OUT is the script's own
# override, which keeps the generated file out of os/rootfs/overlay-v2 -- that
# copy belongs to the image build, and a package producer must not move it.
MOS_BOARD="${MOS_BOARD}" SYSTEM_CONF_OUT="${STAGE}/etc/rauc/system.conf" \
    bash "${REPO_ROOT}/os/pkgs/rauc/render-config.sh"
[ -s "${STAGE}/etc/rauc/system.conf" ] ||
    die "os/pkgs/rauc/render-config.sh produced no system.conf to stage"

for fw in ${BOARD_FIRMWARE_FILES}; do
    cp "${BOARD_DIR}/rootfs/firmware/${fw##*/}" "${STAGE}/firmware/${fw##*/}"
done
cp "${MODULES_TAR}" "${STAGE}/modules.tar"
for f in ${BOOT_INPUTS}; do
    cp "${BOARD_DIR}/out/kernel/${f}" "${STAGE}/boot/${f}"
done
cp "${UBOOT_BIN}" "${STAGE}/boot/${UBOOT_BIN_NAME}"
cp "${BOOT_CMD}" "${STAGE}/boot/${BOOT_CMD_SOURCE##*/}"
chmod 0644 "${STAGE}"/firmware/* "${STAGE}"/boot/* "${STAGE}/modules.tar" "${STAGE}/board.env"

echo "render.sh: staged BSP inputs from ${BOARD_DIR} into ${STAGE}"

# MOS_ARCH, because the architecture a board's package is built for is a board
# fact. producer.env declares the same value as its only ARCHES entry, and the
# driver refuses any other.
exec bash "${REPO_ROOT}/os/rootfs/packages-src/build-deb.sh" \
    --producer-dir "${PRODUCER_REL}" --arch "${MOS_ARCH}"
