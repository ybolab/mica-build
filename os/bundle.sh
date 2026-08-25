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
# Signed with the development key from os/rauc/.devkeys/ (make os-devkeys) by
# default; CERT/KEY/KEYRING in the environment override the defaults, which is
# how a release build points this script at real signing material. When the
# host has no rauc, the whole build runs in a bookworm container the script
# launches — the same fallback pattern os/mkimage-v2.sh uses for sgdisk.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
MOS_BOARD="${MOS_BOARD:-cx3576}"
LAYOUT_ENV="${SCRIPT_DIR}/layout/${MOS_BOARD}-v2.env"

if [ ! -f "${LAYOUT_ENV}" ]; then
    echo "error: ${LAYOUT_ENV} not found (MOS_BOARD=${MOS_BOARD})" >&2
    exit 1
fi
# shellcheck source=layout/cx3576-v2.env
. "${LAYOUT_ENV}"

MANIFEST_IN="${SCRIPT_DIR}/rauc/manifest.raucm.in"
# U-BOOT ONLY. A grub board has no compiled boot script; its boot payload is
# the kernel, the initrd and the per-slot verity facts, installed as files.
BOOT_CMD="${SCRIPT_DIR}/boot/${MOS_BOARD}-boot.cmd"
ROOTFS_PRODUCER="os/rootfs/build-v2.sh"

# Reads one KEY=value out of a plain env-style file without executing it.
env_file_get() {
    sed -n "s/^$2=//p" "$1" | tail -n1
}

# GUIDs are compared case-insensitively everywhere: GPT tooling and the layout
# env spell them uppercase, udev/libblkid and the kernel cmdline lowercase.
# Same rule, same helper as os/mkimage-v2.sh.
lc() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

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
# ROOTFS_VERITY_IMG, ROOTFS_VERITY_ENV, BOOT_CMDLINE_A, BOOT_CMDLINE_B, CERT,
# KEY, KEYRING, BUNDLE_OUT, BUNDLE_VERSION, BUNDLE_COMPATIBLE.
# THE RAUC THAT BUILDS A BUNDLE MUST BE THE RAUC THAT INSTALLS IT.
#
# The bundle format and the slot model are a contract between two programs that
# never meet. Until this check, nothing made them the same version: bundles
# were built in a bookworm container (rauc 1.8) and installed by the image's
# Debian 13 rauc (1.13). It was found by failure rather than by a check -- 1.8
# refused the x64 slot model outright when it was finally asked to read it.
#
# Both halves now come from os/rauc/ -- the image's rauc and this one are built
# from the same pinned source, so agreeing is the normal state rather than a
# coincidence. The check remains because they are built at different TIMES: an
# image flashed before a version bump and a bundle built after it would differ,
# and that is exactly the case nothing else would notice.
assert_rauc_matches_image() {
    local report="$1" want have
    if [ ! -f "${report}" ]; then
        echo "error: ${report} not found; the image's RAUC version is unknown and a bundle built by an unknown-matching rauc is not one this can vouch for. Run the rootfs build first" >&2
        exit 1
    fi
    want="$(sed -n 's/^RAUC_VERSION //p' "${report}" | tail -n1)"
    have="$(sed -n 's/^RAUC_VERSION=//p' "${RAUC_BUILD_ENV:-/nonexistent}" 2>/dev/null || true)"
    if [ -z "${want}" ]; then
        echo "error: ${report} records no RAUC_VERSION. It predates the check, or the rootfs build stopped emitting it -- either way the comparison would pass by finding nothing" >&2
        exit 1
    fi
    if [ -z "${have}" ]; then
        echo "error: no RAUC_VERSION from ${RAUC_BUILD_ENV:-<unset>}; this half of the comparison is missing and the check would pass by finding nothing. Build rauc with 'make os-rauc'" >&2
        exit 1
    fi
    if [ "${want}" != "${have}" ]; then
        echo "error: this rauc is ${have}, the image ships ${want}. A bundle written by one version and installed by another is a format and slot-model contract nobody checked. Both come from os/rauc/versions.env now, so this means the image predates a version bump: rebuild the rootfs" >&2
        exit 1
    fi
    echo "rauc ${have} here, ${want} in the image"
}

build() {
    local workdir stage
    workdir="$(mktemp -d)"
    trap 'rm -rf "${workdir:-}"' EXIT
    stage="${workdir}/input"
    mkdir -p "${stage}"

    assert_rauc_matches_image "${ROOTFS_REPORT}"

    # THE BOOT HALF, which is the one thing that genuinely differs between the
    # two bootloaders (RFCT-106).
    #
    #   uboot — one FAT image per slot pair, carrying kernel, dtb, boot.scr and
    #           the per-slot verity env files. U-Boot selects a boot PARTITION
    #           from its own environment, so installing that filesystem into
    #           the inactive boot slot is what the next boot will read.
    #   grub  — three FILES: the kernel, the initrd and the per-slot verity
    #           facts. UEFI firmware picks the ESP, not the device, so there is
    #           one ESP and the payload is installed onto it by path.
    if [ "${RAUC_BOOTLOADER}" = "uboot" ]; then
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
        # rootfs partition. boot.scr loads the slot-suffixed name FIRST and falls
        # back to the unsuffixed ${BOOT_VERITY_ENV_NAME} only for older
        # hand-assembled boot partitions (os/mkimage-v2.sh refuses to compile a
        # boot.cmd without the suffixed load), so an installed slot boots straight
        # from these files. The unsuffixed name is deliberately not written: a
        # factory slot carries none either, and shipping one here would make an
        # updated slot's layout differ from the flashed one.
        #
        # The same cross-checks as os/mkimage-v2.sh's mkverityenv() run here, and
        # must: a bundle can be built without ever assembling an image, and these
        # env files are the ONLY tie between the shipped mos-verity-{a,b}.env and
        # the shipped rootfs.img. A cmdline pointing at the wrong slot's partition
        # or carrying some other build's root hash would otherwise land in a signed
        # bundle and fail only on hardware, after the slot was already written.
        local root_hash verity_salt
        root_hash="$(env_file_get "${ROOTFS_VERITY_ENV}" VERITY_ROOT_HASH)"
        verity_salt="$(env_file_get "${ROOTFS_VERITY_ENV}" VERITY_SALT)"
        if [ -z "${root_hash}" ]; then
            echo "error: VERITY_ROOT_HASH missing from ${ROOTFS_VERITY_ENV}; fix ${ROOTFS_PRODUCER}" >&2
            exit 1
        fi
        if [ "$(lc "${verity_salt}")" != "$(lc "${VERITY_SALT}")" ]; then
            echo "error: ${ROOTFS_VERITY_ENV} salt '${verity_salt}' does not match the pinned VERITY_SALT '${VERITY_SALT}'; fix ${ROOTFS_PRODUCER}" >&2
            exit 1
        fi
        local verity_base="${BOOT_VERITY_ENV_NAME%.env}"
        write_verity_env() {
            local out="$1" cmdline="$2" slot="$3" guid="$4"
            local create waitfor
            create="$(sed -n 's/.*\(dm-mod\.create="[^"]*"\).*/\1/p' "${cmdline}")"
            waitfor="$(sed -n 's/.*\(dm-mod\.waitfor=[^ ]*\).*/\1/p' "${cmdline}")"
            if [ -z "${create}" ] || [ -z "${waitfor}" ]; then
                echo "error: ${cmdline} carries no dm-mod.create=/dm-mod.waitfor= verity table for slot ${slot}; fix ${ROOTFS_PRODUCER}" >&2
                exit 1
            fi
            local create_lc waitfor_lc guid_lc hash_lc salt_lc
            create_lc="$(lc "${create}")"
            waitfor_lc="$(lc "${waitfor}")"
            guid_lc="$(lc "${guid}")"
            hash_lc="$(lc "${root_hash}")"
            salt_lc="$(lc "${verity_salt}")"
            if [ "${create_lc#*"${guid_lc}"}" = "${create_lc}" ]; then
                echo "error: the slot-${slot} verity table in ${cmdline} does not reference PARTUUID ${guid} (compared case-insensitively); each slot must point dm-verity at its own rootfs partition." >&2
                echo "  found: ${create}" >&2
                echo "Fix ${ROOTFS_PRODUCER}." >&2
                exit 1
            fi
            if [ "${waitfor_lc#*"${guid_lc}"}" = "${waitfor_lc}" ]; then
                echo "error: the slot-${slot} dm-mod.waitfor= in ${cmdline} does not reference PARTUUID ${guid} (compared case-insensitively); the wait must name the same partition the verity table uses." >&2
                echo "  found: ${waitfor}" >&2
                echo "Fix ${ROOTFS_PRODUCER}." >&2
                exit 1
            fi
            if [ "${create_lc#*"${hash_lc}"}" = "${create_lc}" ]; then
                echo "error: the slot-${slot} verity table in ${cmdline} does not carry the root hash ${root_hash} from ${ROOTFS_VERITY_ENV} (compared case-insensitively)." >&2
                echo "  found: ${create}" >&2
                echo "Fix ${ROOTFS_PRODUCER}." >&2
                exit 1
            fi
            if [ "${create_lc#*"${salt_lc}"}" = "${create_lc}" ]; then
                echo "error: the slot-${slot} verity table in ${cmdline} does not carry the salt ${verity_salt} from ${ROOTFS_VERITY_ENV} (compared case-insensitively)." >&2
                echo "  found: ${create}" >&2
                echo "Fix ${ROOTFS_PRODUCER}." >&2
                exit 1
            fi
            printf 'verity_args=%s %s\n' "${create}" "${waitfor}" > "${out}"
        }
        write_verity_env "${workdir}/${verity_base}-a.env" "${BOOT_CMDLINE_A}" A "${ROOTFS_A_GUID}"
        write_verity_env "${workdir}/${verity_base}-b.env" "${BOOT_CMDLINE_B}" B "${ROOTFS_B_GUID}"

        cp "${KERNEL_IMAGE}" "${workdir}/Image"
        cp "${DTB}" "${workdir}/rk3576-src.dtb"
        find "${workdir}" -maxdepth 1 -type f -exec touch -h -d "${FILE_MTIME}" {} +

        truncate -s "${BOOT_SIZE_MIB}M" "${stage}/boot.vfat"
        mkfs.vfat --invariant -F 32 -n "${BUNDLE_BOOT_FAT_LABEL}" "${stage}/boot.vfat" >/dev/null
        mcopy -s -m -i "${stage}/boot.vfat" \
            "${workdir}/Image" "${workdir}/rk3576-src.dtb" \
            "${workdir}/${BOOT_SCRIPT_NAME}" \
            "${workdir}/${verity_base}-a.env" "${workdir}/${verity_base}-b.env" ::/
    else
        # A grub board's slot boot partition holds three files: the kernel, the
        # initrd and that slot's dm-verity facts. Same slot TYPE as cx3576's
        # (vfat) and the same one-image-per-slot-class model; only the contents
        # differ, because U-Boot needs a compiled boot script and GRUB reads its
        # own configuration from the ESP.
        #
        # The SAME bytes work in either slot, deliberately. The rootfs PARTUUIDs
        # live in the ESP's grub.cfg, which no install rewrites, so nothing in
        # here is slot-specific -- a bundle carries one image per slot class and
        # RAUC chooses the target, so anything slot-specific would be wrong half
        # the time.
        #
        # Read from the verity env the rootfs build produced, not recomputed: a
        # second computation of the same hash is a second thing to get wrong.
        # env_file_get, not `.`, is the same reader the rest of this script uses.
        : >"${workdir}/${SLOT_CMDLINE_NAME}"
        for pair in MOS_SECTORS:VERITY_DATA_SECTORS \
            MOS_DATA_BLOCK_SIZE:VERITY_DATA_BLOCK_SIZE \
            MOS_HASH_BLOCK_SIZE:VERITY_HASH_BLOCK_SIZE \
            MOS_DATA_BLOCKS:VERITY_DATA_BLOCKS \
            MOS_HASH_START_BLOCK:VERITY_HASH_START_BLOCK \
            MOS_HASH_ALGO:VERITY_HASH_ALGO \
            MOS_ROOT_HASH:VERITY_ROOT_HASH \
            MOS_SALT:VERITY_SALT; do
            grub_name="${pair%%:*}"
            env_name="${pair#*:}"
            value="$(env_file_get "${ROOTFS_VERITY_ENV}" "${env_name}")"
            if [ -z "${value}" ]; then
                echo "error: ${env_name} missing from ${ROOTFS_VERITY_ENV}; the installed slot would get an incomplete dm-verity table and GRUB would refuse to boot it. Fix ${ROOTFS_PRODUCER}" >&2
                exit 1
            fi
            printf 'set %s=%s\n' "${grub_name}" "${value}" >>"${workdir}/${SLOT_CMDLINE_NAME}"
        done
        if ! grep -qE '^set MOS_ROOT_HASH=[0-9a-f]{32,}$' "${workdir}/${SLOT_CMDLINE_NAME}"; then
            echo "error: the cmdline fragment carries no root hash; every slot installed from this bundle would refuse to boot" >&2
            exit 1
        fi

        cp "${KERNEL_IMAGE}" "${workdir}/${SLOT_KERNEL_NAME}"
        cp "${INITRD_IMAGE}" "${workdir}/${SLOT_INITRD_NAME}"
        find "${workdir}" -maxdepth 1 -type f -exec touch -h -d "${FILE_MTIME}" {} +

        truncate -s "${BOOT_SIZE_MIB}M" "${stage}/boot.vfat"
        mkfs.vfat --invariant -F 32 -n "${BUNDLE_BOOT_FAT_LABEL}" "${stage}/boot.vfat" >/dev/null
        mcopy -s -m -i "${stage}/boot.vfat" \
            "${workdir}/${SLOT_KERNEL_NAME}" "${workdir}/${SLOT_INITRD_NAME}" \
            "${workdir}/${SLOT_CMDLINE_NAME}" ::/
    fi

    cp "${ROOTFS_VERITY_IMG}" "${stage}/rootfs.img"

    # The boot half of the image set, one line pair per payload file. Spliced
    # by LINE rather than substituted: sed cannot put a newline into a
    # replacement, and this block has several.
    printf '[image.boot]\nfilename=boot.vfat\n' >"${workdir}/boot-images"
    awk -v f="${workdir}/boot-images" '
        $0 == "@BOOT_IMAGES@" { while ((getline line < f) > 0) print line; next }
        { print }
    ' "${MANIFEST_IN}" >"${workdir}/manifest.in"

    sed -e "s|@COMPATIBLE@|${BUNDLE_COMPATIBLE}|g" \
        -e "s|@VERSION@|${BUNDLE_VERSION}|g" \
        "${workdir}/manifest.in" > "${stage}/manifest.raucm"
    # Comment lines excluded. The template DOCUMENTS the other template's
    # placeholder by name, and a check over the raw bytes rejected the manifest
    # for a sentence about @SLOTS@ -- the third time in this change that a
    # blunt grep failed a correct file for saying what it does.
    if grep -vE '^[[:space:]]*#' "${stage}/manifest.raucm" | grep -c '@[A-Z_]\+@' >/dev/null; then
        echo "error: unrendered placeholder left in a manifest VALUE:" >&2
        grep -nE '@[A-Z_]+@' "${stage}/manifest.raucm" | grep -vE ':[[:space:]]*#' >&2
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

BOARD_DIR="${BOARD_DIR:-${REPO_ROOT}/board/${MOS_BOARD}}"
OUT_DIR="${REPO_ROOT}/_out/${MOS_BOARD}"
KEYDIR="${SCRIPT_DIR}/rauc/.devkeys"
SYSTEM_CONF="${REPO_ROOT}/os/rootfs/overlay-v2/etc/rauc/system.conf"

# The shipped slot configuration must be current before anything is signed
# against it: a stale system.conf means the bundle's compatible string or the
# slot GUIDs no longer describe the devices in the field.
MOS_BOARD="${MOS_BOARD}" bash "${SCRIPT_DIR}/rauc/render-config.sh" --check

BUNDLE_COMPATIBLE="$(sed -n 's/^compatible=//p' "${SYSTEM_CONF}")"
if [ -z "${BUNDLE_COMPATIBLE}" ]; then
    echo "error: no compatible= in ${SYSTEM_CONF}" >&2
    exit 1
fi

# Signing material: caller-supplied CERT/KEY/KEYRING win, the dev keys are only
# the default. All three are resolved and checked HERE, before anything runs,
# so the failure names the file that is actually missing — an unset trio with
# no devkeys means "make os-devkeys", a caller-supplied path that does not
# exist is the caller's typo, and neither may be silently overridden the way
# the hardcoded assignments in both branches used to do.
CERT="${CERT:-${KEYDIR}/signer.cert.pem}"
KEY="${KEY:-${KEYDIR}/signer.key.pem}"
KEYRING="${KEYRING:-${KEYDIR}/ca.cert.pem}"
for keyfile in "${CERT}" "${KEY}" "${KEYRING}"; do
    if [ ! -f "${keyfile}" ]; then
        echo "error: signing material not found: ${keyfile}" >&2
        case "${keyfile}" in
        "${KEYDIR}"/*)
            echo "Generate development keys with 'make os-devkeys', or set CERT/KEY/KEYRING to real ones (caller-supplied values are honoured on both the host and the container path)." >&2
            ;;
        *)
            echo "CERT/KEY/KEYRING were supplied from the environment but this file does not exist." >&2
            ;;
        esac
        exit 1
    fi
done

ROOTFS_VERITY_IMG="${OUT_DIR}/rootfs-verity.img"
ROOTFS_VERITY_ENV="${OUT_DIR}/rootfs-verity.env"

# Where the kernel comes from is a board fact. A BSP board builds its own and
# the bundle takes it from BOARD_DIR; a Debian-kernel board takes the one the
# rootfs build already extracted into _out, which is also the one the image
# assembler put on the ESP -- so the bundle and the flashed image cannot ship
# different kernels for the same build.
if [ "${RAUC_BOOTLOADER}" = "uboot" ]; then
    BOOT_CMDLINE_A="${OUT_DIR}/boot-cmdline-a.txt"
    BOOT_CMDLINE_B="${OUT_DIR}/boot-cmdline-b.txt"
    KERNEL_IMAGE="${BOARD_DIR}/out/kernel/Image"
    DTB="${BOARD_DIR}/out/kernel/rk3576-src.dtb"
    REQUIRED_INPUTS="${ROOTFS_VERITY_IMG} ${ROOTFS_VERITY_ENV} ${BOOT_CMDLINE_A} ${BOOT_CMDLINE_B}"
    REQUIRED_BOARD_INPUTS="${KERNEL_IMAGE} ${DTB}"
else
    BOOT_CMDLINE_A=""
    BOOT_CMDLINE_B=""
    KERNEL_IMAGE="${OUT_DIR}/boot/vmlinuz"
    INITRD_IMAGE="${OUT_DIR}/boot/initrd.img"
    DTB=""
    REQUIRED_INPUTS="${ROOTFS_VERITY_IMG} ${ROOTFS_VERITY_ENV} ${KERNEL_IMAGE} ${INITRD_IMAGE}"
    REQUIRED_BOARD_INPUTS=""
fi

for input in ${REQUIRED_INPUTS}; do
    if [ ! -f "${input}" ]; then
        echo "error: ${input} not found; run 'MOS_BOARD=${MOS_BOARD} bash ${ROOTFS_PRODUCER}' first" >&2
        exit 1
    fi
done
for input in ${REQUIRED_BOARD_INPUTS}; do
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

# The same inputs, named as the CONTAINER sees them. Spelled out per board
# rather than rewritten from the host paths: a substitution that only matched
# the BSP board's prefix left x64's kernel path untouched and the build failed
# inside the container on a host path.
# THE HOST's architecture, not the board's. The bundle is written on the build
# machine, so the rauc that writes it is a host binary -- while the image being
# bundled for may be a foreign board. Both are built from os/rauc/versions.env,
# which is what makes their VERSIONS the same thing to compare.
case "$(uname -m)" in
x86_64) HOST_ARCH=amd64 ;;
aarch64) HOST_ARCH=arm64 ;;
*) echo "error: unsupported build host architecture $(uname -m); os/rauc/ builds amd64 and arm64" >&2; exit 1 ;;
esac
RAUC_HOST_BIN="${REPO_ROOT}/os/rauc/out-${HOST_ARCH}/rauc"
if [ ! -f "${RAUC_HOST_BIN}" ]; then
    echo "error: ${RAUC_HOST_BIN} not found. RAUC is built from source now, not installed from Debian (os/rauc/versions.env says why); build it with 'MOS_BOARD=${MOS_BOARD} make os-rauc'" >&2
    exit 1
fi

if [ "${RAUC_BOOTLOADER}" = "uboot" ]; then
    CONTAINER_KERNEL_IMAGE="/board/out/kernel/Image"
    CONTAINER_INITRD_IMAGE=""
    CONTAINER_DTB="/board/out/kernel/rk3576-src.dtb"
else
    CONTAINER_KERNEL_IMAGE="/work/_out/${MOS_BOARD}/boot/vmlinuz"
    CONTAINER_INITRD_IMAGE="/work/_out/${MOS_BOARD}/boot/initrd.img"
    CONTAINER_DTB=""
fi

if host_can_build; then
    env MOS_BOARD="${MOS_BOARD}" \
        ROOTFS_REPORT="${OUT_DIR}/rootfs-report-v2.txt" \
        RAUC_BUILD_ENV="${REPO_ROOT}/os/rauc/out-${HOST_ARCH}/RAUC_VERSION.env" \
        KERNEL_IMAGE="${KERNEL_IMAGE}" DTB="${DTB}" \
        INITRD_IMAGE="${INITRD_IMAGE:-}" \
        ROOTFS_VERITY_IMG="${ROOTFS_VERITY_IMG}" \
        ROOTFS_VERITY_ENV="${ROOTFS_VERITY_ENV}" \
        BOOT_CMDLINE_A="${BOOT_CMDLINE_A}" BOOT_CMDLINE_B="${BOOT_CMDLINE_B}" \
        CERT="${CERT}" KEY="${KEY}" KEYRING="${KEYRING}" \
        BUNDLE_OUT="${OUT_DIR}/${BUNDLE_NAME}" \
        BUNDLE_VERSION="${BUNDLE_VERSION}" BUNDLE_COMPATIBLE="${BUNDLE_COMPATIBLE}" \
        bash "${BASH_SOURCE[0]}" --build
else
    echo "rauc/mksquashfs/mkfs.vfat/mcopy/mkimage/jq not all available on the host; building in a container"
    # The resolved CERT/KEY/KEYRING are bind-mounted read-only one file at a
    # time and the CONTAINER paths are what the inner run sees. This is what
    # makes caller-supplied keys work on this branch too: they can live
    # anywhere on the host, including outside REPO_ROOT, and nothing here may
    # quietly substitute the devkeys for them. Read-only because a signing key
    # is an input; the container has no business writing near it.
    docker run --rm \
        -v "${REPO_ROOT}:/work" \
        -v "${BOARD_DIR}:/board:ro" \
        -v "${CERT}:/keys/signer.cert.pem:ro" \
        -v "${KEY}:/keys/signer.key.pem:ro" \
        -v "${KEYRING}:/keys/ca.cert.pem:ro" \
        -e MOS_BOARD="${MOS_BOARD}" \
        -e KERNEL_IMAGE="${CONTAINER_KERNEL_IMAGE}" \
        -e INITRD_IMAGE="${CONTAINER_INITRD_IMAGE}" \
        -e DTB="${CONTAINER_DTB}" \
        -e ROOTFS_VERITY_IMG="/work/_out/${MOS_BOARD}/rootfs-verity.img" \
        -e ROOTFS_VERITY_ENV="/work/_out/${MOS_BOARD}/rootfs-verity.env" \
        -e ROOTFS_REPORT="/work/_out/${MOS_BOARD}/rootfs-report-v2.txt" \
        -e RAUC_BIN="/work/os/rauc/out-${HOST_ARCH}/rauc" \
        -e RAUC_BUILD_ENV="/work/os/rauc/out-${HOST_ARCH}/RAUC_VERSION.env" \
        -e BOOT_CMDLINE_A="${BOOT_CMDLINE_A:+/work/_out/${MOS_BOARD}/boot-cmdline-a.txt}" \
        -e BOOT_CMDLINE_B="${BOOT_CMDLINE_B:+/work/_out/${MOS_BOARD}/boot-cmdline-b.txt}" \
        -e CERT=/keys/signer.cert.pem \
        -e KEY=/keys/signer.key.pem \
        -e KEYRING=/keys/ca.cert.pem \
        -e BUNDLE_OUT="/work/_out/${MOS_BOARD}/${BUNDLE_NAME}" \
        -e BUNDLE_VERSION="${BUNDLE_VERSION}" \
        -e BUNDLE_COMPATIBLE="${BUNDLE_COMPATIBLE}" \
        debian:trixie-slim \
        bash -c 'apt-get update -qq && apt-get install -y -qq --no-install-recommends \
            squashfs-tools dosfstools mtools u-boot-tools jq \
            libglib2.0-0t64 libjson-glib-1.0-0 libfdisk1 libssl3t64 >/dev/null && \
            install -m0755 "${RAUC_BIN}" /usr/local/bin/rauc && \
            exec bash /work/os/bundle.sh --build'
fi

ln -sfn "${BUNDLE_NAME}" "${OUT_DIR}/${BUNDLE_LATEST}"
echo "built ${OUT_DIR}/${BUNDLE_NAME} (${BUNDLE_LATEST} -> ${BUNDLE_NAME})"
