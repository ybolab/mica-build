#!/usr/bin/env bash
set -euo pipefail

# Builds the signed RAUC update bundle for cx3576 (layout v2).
#
#   bash os/bundle.sh [VERSION]        VERSION also settable as MOS_BUNDLE_VERSION
#
# Output: _out/cx3576/mos-cx3576-<epoch>.raucb plus the mos-cx3576-latest.raucb
# symlink, mirroring the image naming convention. The epoch is in the FILENAME
# only — the bundle content is a function of the inputs and the version string,
# never of the wall clock, so the same version rebuilt from the same inputs
# yields the same payload.
#
# The bundle carries one image per slot class of the RAUC slot group:
#   rootfs.img   the raw squashfs+dm-verity slot image from os/rootfs/build-v2.sh
#   boot.vfat    a FAT32 image with Image, the dtb, boot.scr and the per-slot
#                verity env files, written raw into the inactive boot slot
#
# Signed with the development key from os/rauc/.devkeys/ (make os-devkeys).
# When the host has no rauc, the whole build runs in a bookworm container the
# script launches — the same fallback pattern os/mkimage.sh uses for sgdisk.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
LAYOUT_ENV="${SCRIPT_DIR}/layout/cx3576-v2.env"

if [ ! -f "${LAYOUT_ENV}" ]; then
    echo "error: ${LAYOUT_ENV} not found" >&2
    exit 1
fi
# shellcheck source=layout/cx3576-v2.env
. "${LAYOUT_ENV}"

MANIFEST_IN="${SCRIPT_DIR}/rauc/manifest.raucm.in"
BOOT_CMD="${SCRIPT_DIR}/boot/cx3576-boot.cmd"
ROOTFS_PRODUCER="os/rootfs/build-v2.sh"

# The boot payload is written into whichever boot slot is inactive, so it
# cannot carry that slot's FAT identity: one image, two possible destinations.
# A neutral label is correct rather than sloppy — nothing reads it. boot.scr
# addresses its slot as `mmc 0:${bootpart}` (a GPT partition number from
# BOOT_ORDER), and no fstab entry mounts a boot slot. --invariant is what keeps
# the volume id out of the wall clock.
BUNDLE_BOOT_FAT_LABEL=BOOT

# --- in-container (or native) build ----------------------------------------
# Inputs arrive through the environment so this half is identical whether it
# runs on the host or inside the container: KERNEL_IMAGE, DTB,
# ROOTFS_VERITY_IMG, BOOT_CMDLINE_A, BOOT_CMDLINE_B, CERT, KEY, KEYRING,
# BUNDLE_OUT, BUNDLE_VERSION, BUNDLE_COMPATIBLE.
build() {
    local workdir stage
    workdir="$(mktemp -d)"
    trap 'rm -rf "${workdir:-}"' EXIT
    stage="${workdir}/input"
    mkdir -p "${stage}"

    # boot.scr, compiled from the same source the image assembler uses and
    # pinned to FILE_MTIME: without SOURCE_DATE_EPOCH mkimage stamps the legacy
    # image header with the current time.
    #
    # The credit defaults the script installs on a virgin environment have to
    # stay where RAUC's hex counter and U-Boot's decimal `test -gt` agree. The
    # assembler checks this too; a bundle can be built without ever building an
    # image, so the check belongs on both paths.
    local credits
    while read -r credits; do
        if [ "${credits}" -lt "${BOOT_ATTEMPTS_MIN}" ] || [ "${credits}" -gt "${BOOT_ATTEMPTS_MAX}" ]; then
            echo "error: ${BOOT_CMD} sets a boot-attempts value of ${credits}; RAUC writes this counter in hex and U-Boot compares it in decimal, so it must stay in ${BOOT_ATTEMPTS_MIN}..${BOOT_ATTEMPTS_MAX}" >&2
            exit 1
        fi
    done < <(grep -oE 'BOOT_[AB]_LEFT [0-9]+' "${BOOT_CMD}" | awk '{print $2}')
    SOURCE_DATE_EPOCH="${FILE_MTIME#@}" \
        mkimage -T script -C none -n "mos boot" -d "${BOOT_CMD}" "${workdir}/${BOOT_SCRIPT_NAME}" >/dev/null

    # Per-slot verity parameters, lifted out of the cmdline files exactly as
    # os/mkimage-v2.sh does — the dm-verity table is computed in one place only,
    # by the rootfs producer.
    #
    # BOTH slots' env files ship, under slot-suffixed names, because a single
    # boot payload can land in either slot and the table names that slot's own
    # rootfs partition. Today's boot.scr loads the unsuffixed
    # ${BOOT_VERITY_ENV_NAME}, which this payload deliberately does not carry:
    # a missing file makes boot.scr burn the slot's credits and roll back
    # cleanly, whereas the other slot's table would build a verity device over
    # the wrong partition. See docs/task/RFCT-014.md — the boot.cmd change that
    # makes updated slots bootable is an escalation, not this task's to make.
    local verity_base="${BOOT_VERITY_ENV_NAME%.env}"
    write_verity_env() {
        local out="$1" cmdline="$2" slot="$3"
        local create waitfor
        create="$(sed -n 's/.*\(dm-mod\.create="[^"]*"\).*/\1/p' "${cmdline}")"
        waitfor="$(sed -n 's/.*\(dm-mod\.waitfor=[^ ]*\).*/\1/p' "${cmdline}")"
        if [ -z "${create}" ] || [ -z "${waitfor}" ]; then
            echo "error: ${cmdline} carries no dm-mod.create=/dm-mod.waitfor= verity table for slot ${slot}; fix ${ROOTFS_PRODUCER}" >&2
            exit 1
        fi
        printf 'verity_args=%s %s\n' "${create}" "${waitfor}" > "${out}"
    }
    write_verity_env "${workdir}/${verity_base}-a.env" "${BOOT_CMDLINE_A}" A
    write_verity_env "${workdir}/${verity_base}-b.env" "${BOOT_CMDLINE_B}" B

    cp "${KERNEL_IMAGE}" "${workdir}/Image"
    cp "${DTB}" "${workdir}/rk3576-src.dtb"
    find "${workdir}" -maxdepth 1 -type f -exec touch -h -d "${FILE_MTIME}" {} +

    truncate -s "${BOOT_SIZE_MIB}M" "${stage}/boot.vfat"
    mkfs.vfat --invariant -F 32 -n "${BUNDLE_BOOT_FAT_LABEL}" "${stage}/boot.vfat" >/dev/null
    mcopy -s -m -i "${stage}/boot.vfat" \
        "${workdir}/Image" "${workdir}/rk3576-src.dtb" \
        "${workdir}/${BOOT_SCRIPT_NAME}" \
        "${workdir}/${verity_base}-a.env" "${workdir}/${verity_base}-b.env" ::/

    cp "${ROOTFS_VERITY_IMG}" "${stage}/rootfs.img"

    sed -e "s|@COMPATIBLE@|${BUNDLE_COMPATIBLE}|g" \
        -e "s|@VERSION@|${BUNDLE_VERSION}|g" \
        "${MANIFEST_IN}" > "${stage}/manifest.raucm"
    if grep -q '@[A-Z_]\+@' "${stage}/manifest.raucm"; then
        echo "error: unrendered placeholder left in the manifest" >&2
        exit 1
    fi
    # rauc 1.8 has no --bundle-format flag; the format is declared in the
    # manifest. Assert it, so a template edit cannot quietly downgrade every
    # bundle to the "plain" format that system.conf refuses to install.
    if ! grep -q '^format=verity$' "${stage}/manifest.raucm"; then
        echo "error: ${MANIFEST_IN} does not declare '[bundle] format=verity'" >&2
        exit 1
    fi
    find "${stage}" -type f -exec touch -h -d "${FILE_MTIME}" {} +

    # rauc drives mksquashfs itself; without these it stamps the payload with
    # the wall clock, the build container's uid map and a thread count.
    rauc bundle \
        --mksquashfs-args="-all-root -no-xattrs -noappend -processors 1 -mkfs-time ${FILE_MTIME#@} -all-time ${FILE_MTIME#@}" \
        --cert="${CERT}" --key="${KEY}" \
        "${stage}" "${BUNDLE_OUT}"

    verify_bundle
}

# Validates the produced bundle the only way that proves it is installable:
# by reading it back through rauc with signature verification on. No
# `rauc install` anywhere — that writes to real block devices.
verify_bundle() {
    # --conf loads the system.conf the image actually ships, so this is also
    # the one place where that file is parsed by rauc at build time: a slot
    # definition rauc cannot read fails the bundle build instead of failing on
    # a device.
    local info
    info="$(rauc --conf="${REPO_ROOT}/os/rootfs/overlay-v2/etc/rauc/system.conf" \
        info --output-format=json --keyring="${KEYRING}" "${BUNDLE_OUT}")"

    local got
    got="$(echo "${info}" | jq -r '.compatible')"
    if [ "${got}" != "${BUNDLE_COMPATIBLE}" ]; then
        echo "error: bundle compatible is '${got}', expected '${BUNDLE_COMPATIBLE}'" >&2
        exit 1
    fi
    got="$(echo "${info}" | jq -r '.version')"
    if [ "${got}" != "${BUNDLE_VERSION}" ]; then
        echo "error: bundle version is '${got}', expected '${BUNDLE_VERSION}'" >&2
        exit 1
    fi
    local slot
    for slot in "rootfs:rootfs.img" "boot:boot.vfat"; do
        got="$(echo "${info}" | jq -r --arg s "${slot%%:*}" '.images[] | select(has($s)) | .[$s].filename')"
        if [ "${got}" != "${slot#*:}" ]; then
            echo "error: bundle image for slot class '${slot%%:*}' is '${got}', expected '${slot#*:}'" >&2
            exit 1
        fi
    done

    echo "=== rauc info ==="
    echo "${info}"

    # Determinism, stated as a measurable value rather than a claim: the
    # squashfs payload at the head of the bundle is a pure function of the
    # inputs, while the bytes after it are not — rauc salts the bundle's own
    # verity hash tree at random and the CMS signature carries a signingTime
    # attribute. Two builds of the same version must print the same digest.
    local magic payload_bytes
    magic="$(head -c 4 "${BUNDLE_OUT}")"
    if [ "${magic}" != "hsqs" ]; then
        echo "error: ${BUNDLE_OUT} does not start with a squashfs superblock" >&2
        exit 1
    fi
    payload_bytes="$(od -An -tu8 -j40 -N8 "${BUNDLE_OUT}" | tr -d ' ')"
    payload_bytes=$(((payload_bytes + 4095) / 4096 * 4096))
    echo "payload: ${payload_bytes} bytes, sha256 $(head -c "${payload_bytes}" "${BUNDLE_OUT}" | sha256sum | cut -d' ' -f1)"
    echo "bundle:  $(stat -c %s "${BUNDLE_OUT}") bytes (tail after the payload is not byte-stable: random verity salt + CMS signingTime)"
}

if [ "${1:-}" = "--build" ]; then
    build
    exit 0
fi

# --- host side -------------------------------------------------------------
BUNDLE_VERSION="${1:-${MOS_BUNDLE_VERSION:-0.0.0-dev}}"
if ! [[ "${BUNDLE_VERSION}" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]*$ ]]; then
    echo "error: version '${BUNDLE_VERSION}' is not a plain version string" >&2
    exit 1
fi

BOARD_DIR="${BOARD_DIR:-${REPO_ROOT}/board/cx3576}"
OUT_DIR="${REPO_ROOT}/_out/cx3576"
KEYDIR="${SCRIPT_DIR}/rauc/.devkeys"
SYSTEM_CONF="${REPO_ROOT}/os/rootfs/overlay-v2/etc/rauc/system.conf"

# The shipped slot configuration must be current before anything is signed
# against it: a stale system.conf means the bundle's compatible string or the
# slot GUIDs no longer describe the devices in the field.
bash "${SCRIPT_DIR}/rauc/render-config.sh" --check

BUNDLE_COMPATIBLE="$(sed -n 's/^compatible=//p' "${SYSTEM_CONF}")"
if [ -z "${BUNDLE_COMPATIBLE}" ]; then
    echo "error: no compatible= in ${SYSTEM_CONF}" >&2
    exit 1
fi

if [ ! -f "${KEYDIR}/signer.key.pem" ]; then
    echo "error: no signing material in ${KEYDIR}" >&2
    echo "Generate development keys with 'make os-devkeys', or point CERT/KEY at real ones." >&2
    exit 1
fi

ROOTFS_VERITY_IMG="${OUT_DIR}/rootfs-verity.img"
BOOT_CMDLINE_A="${OUT_DIR}/boot-cmdline-a.txt"
BOOT_CMDLINE_B="${OUT_DIR}/boot-cmdline-b.txt"
KERNEL_IMAGE="${BOARD_DIR}/out/kernel/Image"
DTB="${BOARD_DIR}/out/kernel/rk3576-src.dtb"

for input in "${ROOTFS_VERITY_IMG}" "${BOOT_CMDLINE_A}" "${BOOT_CMDLINE_B}"; do
    if [ ! -f "${input}" ]; then
        echo "error: ${input} not found; run 'bash ${ROOTFS_PRODUCER}' first" >&2
        exit 1
    fi
done
for input in "${KERNEL_IMAGE}" "${DTB}"; do
    if [ ! -f "${input}" ]; then
        echo "error: ${input} not found; build the BSP or set BOARD_DIR (currently: ${BOARD_DIR})" >&2
        exit 1
    fi
done

mkdir -p "${OUT_DIR}"
BUNDLE_NAME="mos-${LAYOUT_BOARD}-$(date +%s).raucb"
BUNDLE_LATEST="mos-${LAYOUT_BOARD}-latest.raucb"

host_can_build() {
    command -v rauc >/dev/null && command -v mksquashfs >/dev/null &&
        command -v mkfs.vfat >/dev/null && command -v mcopy >/dev/null &&
        command -v mkimage >/dev/null && command -v jq >/dev/null
}

if host_can_build; then
    env KERNEL_IMAGE="${KERNEL_IMAGE}" DTB="${DTB}" \
        ROOTFS_VERITY_IMG="${ROOTFS_VERITY_IMG}" \
        BOOT_CMDLINE_A="${BOOT_CMDLINE_A}" BOOT_CMDLINE_B="${BOOT_CMDLINE_B}" \
        CERT="${KEYDIR}/signer.cert.pem" KEY="${KEYDIR}/signer.key.pem" \
        KEYRING="${KEYDIR}/ca.cert.pem" \
        BUNDLE_OUT="${OUT_DIR}/${BUNDLE_NAME}" \
        BUNDLE_VERSION="${BUNDLE_VERSION}" BUNDLE_COMPATIBLE="${BUNDLE_COMPATIBLE}" \
        bash "${BASH_SOURCE[0]}" --build
else
    echo "rauc/mksquashfs/mkfs.vfat/mcopy/mkimage/jq not all available on the host; building in a container"
    docker run --rm \
        -v "${REPO_ROOT}:/work" \
        -v "${BOARD_DIR}:/board:ro" \
        -e KERNEL_IMAGE=/board/out/kernel/Image \
        -e DTB=/board/out/kernel/rk3576-src.dtb \
        -e ROOTFS_VERITY_IMG=/work/_out/cx3576/rootfs-verity.img \
        -e BOOT_CMDLINE_A=/work/_out/cx3576/boot-cmdline-a.txt \
        -e BOOT_CMDLINE_B=/work/_out/cx3576/boot-cmdline-b.txt \
        -e CERT=/work/os/rauc/.devkeys/signer.cert.pem \
        -e KEY=/work/os/rauc/.devkeys/signer.key.pem \
        -e KEYRING=/work/os/rauc/.devkeys/ca.cert.pem \
        -e BUNDLE_OUT="/work/_out/cx3576/${BUNDLE_NAME}" \
        -e BUNDLE_VERSION="${BUNDLE_VERSION}" \
        -e BUNDLE_COMPATIBLE="${BUNDLE_COMPATIBLE}" \
        debian:bookworm-slim \
        bash -c 'apt-get update -qq && apt-get install -y -qq --no-install-recommends \
            rauc squashfs-tools dosfstools mtools u-boot-tools jq >/dev/null && \
            exec bash /work/os/bundle.sh --build'
fi

ln -sfn "${BUNDLE_NAME}" "${OUT_DIR}/${BUNDLE_LATEST}"
echo "built ${OUT_DIR}/${BUNDLE_NAME} (${BUNDLE_LATEST} -> ${BUNDLE_NAME})"
