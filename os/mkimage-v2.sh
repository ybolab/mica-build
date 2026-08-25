#!/usr/bin/env bash
set -euo pipefail

# Assembles the flashable cx3576 (Rockchip RK3576, eMMC /dev/mmcblk0) A/B GPT
# disk image — layout v2, eleven partitions: the raw Rockchip loader area, a
# redundant U-Boot env pair, two FAT32 boot slots, two raw squashfs+dm-verity
# rootfs slots and the meta/state/ephemeral/data ext4 partitions. Every layout
# constant comes from os/boards/cx3576/board.env; nothing is duplicated here.
#
# Each boot slot holds Image, rk3576-src.dtb, the shared boot.scr compiled from
# os/boards/cx3576/boot.cmd, and a per-slot mos-verity.env. It holds NO
# extlinux/extlinux.conf: U-Boot tries extlinux before boot.scr in both boot
# frameworks, so an extlinux config here would silently bypass the RAUC A/B
# handshake (docs/design/uboot-ab-handshake.md sections 5.4-5.5).
#
# The output filename carries the assembly-time epoch, but the image CONTENT is
# deterministic: fixed GPT GUIDs, fixed FAT volume ids, fixed ext4 fs UUIDs and
# hash seeds, E2FSPROGS_FAKE_TIME, and all staged files touched to FILE_MTIME.
# Known deviation (inherited from v1): the FAT partitions are byte-identical
# only across builds using the same mtools version, and rootfs-verity.img is
# only as reproducible as the pipeline that produced it.
#
# When the host lacks sgdisk/mkfs.vfat/mcopy or an mke2fs new enough to turn
# off orphan_file (e2fsprogs >= 1.47), the assembly runs inside an Alpine
# container (--assemble mode); epoch naming and the -latest symlink always
# happen on the host side.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "${SCRIPT_DIR}")"
LAYOUT_ENV="${SCRIPT_DIR}/boards/cx3576/board.env"

if [ ! -f "${LAYOUT_ENV}" ]; then
    echo "error: ${LAYOUT_ENV} not found" >&2
    exit 1
fi
# Two slot-sizing modes, distinguished by whether MOS_ROOTFS_SLOT_MIB was
# supplied from the environment at all — never by its value, so a release that
# legitimately pins the same number as the built-in default still gets the
# strict mode. The pin has to be captured here because sourcing the layout
# defaults would otherwise overwrite it.
if [ -n "${MOS_ROOTFS_SLOT_MIB+set}" ]; then
    ROOTFS_SLOT_PINNED=1
    _slot_pin="${MOS_ROOTFS_SLOT_MIB}"
else
    ROOTFS_SLOT_PINNED=0
    _slot_pin=""
fi
# shellcheck source=boards/cx3576/board.env
. "${LAYOUT_ENV}"
if [ "${ROOTFS_SLOT_PINNED}" = 1 ]; then
    if ! [[ "${_slot_pin}" =~ ^[1-9][0-9]*$ ]]; then
        echo "error: MOS_ROOTFS_SLOT_MIB='${_slot_pin}' is not a positive whole number of MiB" >&2
        exit 1
    fi
    MOS_ROOTFS_SLOT_MIB="${_slot_pin}"
fi
export E2FSPROGS_FAKE_TIME

# The four rootfs-side inputs all come from the same producer; name it in every
# error message so a missing input is actionable.
ROOTFS_PRODUCER="os/rootfs/build-v2.sh"
# Overridable only so os/mkimage-v2-selftest.sh can point the numbering guard
# below at a deliberately-stale copy; every real build uses the tree's own file.
BOOT_CMD="${BOOT_CMD:-${SCRIPT_DIR}/boards/cx3576/boot.cmd}"

# Set by assemble() from rootfs-verity.env, read by mkverityenv().
root_hash=""

# The v2 image may only carry the uboot-mos variant. Stated once because both
# the host wrapper and the inner assembly need to say it.
uboot_missing_error() {
    echo "error: $1 not found; build it with 'make -C board/cx3576 uboot-mos'." >&2
    echo "The v1 blob under out/${UBOOT_DEBUG_VARIANT_DIR}/ is NOT a substitute. It is the debug variant: CONFIG_ENV_IS_NOWHERE (no persistent environment at all) and no pinned bootmeth order, so a v2 image built with it would boot, look healthy, and silently never run the RAUC A/B handshake — no BOOT_ORDER, no attempt counters, no rollback." >&2
    exit 1
}

# Reads one KEY=value out of a plain env-style file without executing it.
env_file_get() {
    sed -n "s/^$2=//p" "$1" | tail -n1
}

# GPT tooling — sgdisk, and therefore os/boards/cx3576/board.env — writes GUIDs in
# uppercase, while udev/libblkid write the /dev/disk/by-partuuid/ names in
# lowercase, which is the form the kernel cmdline has to use. Both spellings
# denote the same GUID, so every identifier comparison in this script folds
# case first. Stated once, here, so the rule cannot drift between call sites.
lc() {
    printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# Formats one partition slot's ext4 filesystem into a standalone image file.
# Args: out-file size-MiB fs-label fs-uuid
mkext4() {
    local seed="${5:-}"
    truncate -s "$2M" "$1"
    if [ -n "${seed}" ]; then
        mke2fs -q -t ext4 -b "${EXT4_BLOCK_SIZE}" -L "$3" -U "$4" \
            -O "${EXT4_FEATURES}" -E "root_owner=0:0,hash_seed=$4" -d "${seed}" "$1"
    else
        mke2fs -q -t ext4 -b "${EXT4_BLOCK_SIZE}" -L "$3" -U "$4" \
            -O "${EXT4_FEATURES}" -E "root_owner=0:0,hash_seed=$4" "$1"
    fi
}

# Compiles boot.cmd into the boot.scr both slots share. SOURCE_DATE_EPOCH is
# mandatory: without it mkimage stamps the legacy image header with the current
# time, which would break the byte-identical rebuild contract.
mkbootscr() {
    if [ ! -f "${BOOT_CMD}" ]; then
        echo "error: ${BOOT_CMD} not found" >&2
        exit 1
    fi
    # The credits the script installs on a virgin environment have to stay in
    # the range where RAUC's hex counter and U-Boot's decimal `test -gt` agree.
    local credits
    while read -r credits; do
        if [ "${credits}" -lt "${BOOT_ATTEMPTS_MIN}" ] || [ "${credits}" -gt "${BOOT_ATTEMPTS_MAX}" ]; then
            echo "error: ${BOOT_CMD} sets a boot-attempts value of ${credits}; RAUC writes this counter in hex and U-Boot compares it in decimal, so it must stay in ${BOOT_ATTEMPTS_MIN}..${BOOT_ATTEMPTS_MAX}" >&2
            exit 1
        fi
    done < <(grep -oE 'BOOT_[AB]_LEFT [0-9]+' "${BOOT_CMD}" | awk '{print $2}')
    # The per-slot names, the pattern boot.scr builds at runtime and the pattern
    # os/update/bundle.sh writes must all be the same derivation of the base name. Any
    # of the three drifting means an updated slot silently fails to boot, so
    # tie them together here rather than trusting three copies of a string.
    local verity_base="${BOOT_VERITY_ENV_NAME%.env}"
    if [ "${BOOT_VERITY_ENV_A_NAME}" != "${verity_base}-a.env" ] ||
        [ "${BOOT_VERITY_ENV_B_NAME}" != "${verity_base}-b.env" ]; then
        echo "error: BOOT_VERITY_ENV_A_NAME/BOOT_VERITY_ENV_B_NAME must be '${verity_base}-a.env'/'${verity_base}-b.env' to match what os/update/bundle.sh writes into a RAUC boot payload" >&2
        exit 1
    fi
    # rauc identifies the booted slot from rauc.slot= on the kernel cmdline; it
    # cannot use root=, because the verity root is /dev/dm-0 and rauc matches
    # only bootname / slot name / realpath(device). Losing this token makes
    # every update roll back while the device looks healthy, so it is a build
    # failure, not something to find on a verifier run.
    if ! grep -qF "rauc.slot=\${bootslot}" "${BOOT_CMD}"; then
        echo "error: ${BOOT_CMD} does not set rauc.slot=\${bootslot} on the kernel cmdline; rauc cannot identify the booted slot from root=/dev/dm-0, so 'rauc status' fails, the health gate never runs 'rauc status mark-good' and every installed slot is rolled back" >&2
        exit 1
    fi
    if ! grep -qF "${verity_base}-\${slotsuffix}.env" "${BOOT_CMD}"; then
        echo "error: ${BOOT_CMD} does not load the per-slot verity env '${verity_base}-\${slotsuffix}.env'; a RAUC-installed slot carries only the slot-suffixed files, so an unsuffixed load would roll every update back" >&2
        exit 1
    fi

    # THE RENUMBERING GUARD. boot.cmd addresses its slot as `mmc 0:${bootpart}`,
    # a literal GPT partition NUMBER, and hush cannot read this layout file. So
    # the numbers are written out in boot.cmd and checked here against the
    # layout instead: inserting or removing any partition ahead of the boot
    # slots shifts them, and a stale number does not announce itself — U-Boot
    # just fails to find Image in a partition that now holds something else,
    # after the environment has already been written. That is a brick discovered
    # on hardware, so it is a build failure here.
    local want got var slot num
    for want in "bootpart:A:${BOOT_A_PARTNUM}" "bootpart:B:${BOOT_B_PARTNUM}" \
        "rootpart:A:${ROOTFS_A_PARTNUM}" "rootpart:B:${ROOTFS_B_PARTNUM}"; do
        IFS=':' read -r var slot num <<<"${want}"
        # The slot's assignments are the block that also sets `setenv bootslot
        # <slot>`, so pick the ${var} line that follows it.
        got="$(awk -v slot="${slot}" -v var="${var}" '
            $1 == "setenv" && $2 == "bootslot" && $3 == slot { in_slot = 1; next }
            $1 == "setenv" && $2 == var && in_slot { print $3; exit }
        ' "${BOOT_CMD}")"
        if [ "${got}" != "${num}" ]; then
            echo "error: ${BOOT_CMD} sets '${var}' to '${got:-nothing}' for slot ${slot}, but the layout puts that partition at p${num}." >&2
            echo "boot.scr addresses partitions by number (mmc 0:\${bootpart}); a stale number means U-Boot loads the kernel from the wrong partition, or from none, AFTER it has already persisted the boot-attempt decrement. Update ${BOOT_CMD} to match os/boards/cx3576/board.env." >&2
            exit 1
        fi
    done

    SOURCE_DATE_EPOCH="${FILE_MTIME#@}" \
        mkimage -T script -C none -n "mos boot" -d "${BOOT_CMD}" "$1" >/dev/null
}

# Renders one slot's mos-verity.env from that slot's kernel cmdline. The verity
# table is not re-derived here: it is lifted out of the cmdline the rootfs
# producer already emits, so there is exactly one place that computes it.
# Args: out-file cmdline-file slot-letter rootfs-partition-guid
mkverityenv() {
    local create waitfor
    create="$(sed -n 's/.*\(dm-mod\.create="[^"]*"\).*/\1/p' "$2")"
    waitfor="$(sed -n 's/.*\(dm-mod\.waitfor=[^ ]*\).*/\1/p' "$2")"
    if [ -z "${create}" ]; then
        echo "error: $2 carries no dm-mod.create= verity table; fix ${ROOTFS_PRODUCER}" >&2
        exit 1
    fi
    # dm_init_init() runs at late_initcall and wait_for_device_probe() does not
    # cover eMMC card discovery, so the wait is required, not decorative.
    if [ -z "${waitfor}" ]; then
        echo "error: $2 carries no dm-mod.waitfor=; it is required on kernel 6.1 because the verity table would otherwise be built before the eMMC partitions exist." >&2
        echo "This is a cross-task mismatch with ${ROOTFS_PRODUCER}, not something this assembler can synthesise: the cmdline files must carry dm-mod.waitfor=PARTUUID=<slot rootfs GUID>." >&2
        exit 1
    fi
    local create_lc waitfor_lc guid_lc hash_lc
    create_lc="$(lc "${create}")"
    waitfor_lc="$(lc "${waitfor}")"
    guid_lc="$(lc "$4")"
    hash_lc="$(lc "${root_hash}")"
    if [ "${create_lc#*"${guid_lc}"}" = "${create_lc}" ]; then
        echo "error: the slot-$3 verity table in $2 does not reference PARTUUID $4 (compared case-insensitively); each slot must point dm-verity at its own rootfs partition." >&2
        echo "  found: ${create}" >&2
        echo "Fix ${ROOTFS_PRODUCER}." >&2
        exit 1
    fi
    if [ "${waitfor_lc#*"${guid_lc}"}" = "${waitfor_lc}" ]; then
        echo "error: the slot-$3 dm-mod.waitfor= in $2 does not reference PARTUUID $4 (compared case-insensitively); the wait must name the same partition the verity table uses." >&2
        echo "  found: ${waitfor}" >&2
        echo "Fix ${ROOTFS_PRODUCER}." >&2
        exit 1
    fi
    if [ "${create_lc#*"${hash_lc}"}" = "${create_lc}" ]; then
        echo "error: the slot-$3 verity table in $2 does not carry the root hash ${root_hash} from ${ROOTFS_VERITY_ENV} (compared case-insensitively)." >&2
        echo "  found: ${create}" >&2
        echo "Fix ${ROOTFS_PRODUCER}." >&2
        exit 1
    fi
    printf 'verity_args=%s %s\n' "${create}" "${waitfor}" > "$1"
}

# Stages one boot slot's FAT32 filesystem. The slots hold the same kernel, dtb
# and boot.scr; only the slot-suffixed mos-verity-<slot>.env differs, and it is
# what points the shared script at this slot's rootfs. The unsuffixed name is
# deliberately NOT written: a RAUC-installed slot only ever carries the
# suffixed files, so writing it here would make a factory slot and an updated
# slot differ in layout and leave the suffixed path untested until the first
# update. Deliberately no extlinux/extlinux.conf: both
# U-Boot boot frameworks try extlinux before boot.scr, so one here would
# silently bypass the A/B handshake.
# Args: out-file fat-label volume-id cmdline-file slot-letter rootfs-guid
#       verity-env-filename
mkboot() {
    local stage="${workdir}/stage-$3"
    mkdir -p "${stage}"
    cp "${KERNEL_IMAGE}" "${stage}/Image"
    cp "${DTB}" "${stage}/rk3576-src.dtb"
    cp "${workdir}/${BOOT_SCRIPT_NAME}" "${stage}/${BOOT_SCRIPT_NAME}"
    mkverityenv "${stage}/$7" "$4" "$5" "$6"
    find "${stage}" -exec touch -h -d "${FILE_MTIME}" {} +

    truncate -s "${BOOT_SIZE_MIB}M" "$1"
    mkfs.vfat --invariant -F 32 -n "$2" -i "$3" "$1" >/dev/null
    mcopy -s -m -i "$1" "${stage}"/* ::/
}

# Assembly, running either natively or inside the container. Inputs/output are
# taken from the environment: KERNEL_IMAGE, DTB, UBOOT, UBOOT_DEBUG (optional,
# only used for the pairing guard), ROOTFS_VERITY_IMG,
# ROOTFS_VERITY_ENV, BOOT_CMDLINE_A, BOOT_CMDLINE_B, IMG_OUT.
assemble() {
    workdir="$(mktemp -d)"
    # The factory /var tree the rootfs build exported, copied so the stamp can
    # be added without writing into _out.
    # FACTORY_VAR arrives through the environment like every other input to
    # this half, because the container re-execs this script and the assembly
    # function runs before the top-level OUT_DIR assignment. Using OUT_DIR here
    # cost one build with `OUT_DIR: unbound variable`.
    FACTORY_VAR_STAGE="${workdir}/factory-var"
    if [ ! -d "${FACTORY_VAR:-}" ]; then
        echo "error: FACTORY_VAR=${FACTORY_VAR:-<unset>} is not a directory. The rootfs build exports the factory /var tree; run 'MOS_BOARD=cx3576 bash os/rootfs/build-v2.sh' first" >&2
        exit 1
    fi
    mkdir -p "${FACTORY_VAR_STAGE}"
    cp -a "${FACTORY_VAR}/." "${FACTORY_VAR_STAGE}/"
    trap 'rm -rf "${workdir:-}"' EXIT

    for input in "${KERNEL_IMAGE}" "${DTB}"; do
        if [ ! -f "${input}" ]; then
            echo "error: ${input} not found" >&2
            exit 1
        fi
    done
    if [ ! -f "${UBOOT}" ]; then
        uboot_missing_error "${UBOOT}"
    fi
    # Pairing guard: catches the whole family of "someone copied or symlinked
    # the debug build into uboot-mos because the real build was inconvenient".
    if [ -n "${UBOOT_DEBUG:-}" ] && [ -f "${UBOOT_DEBUG}" ] && cmp -s "${UBOOT}" "${UBOOT_DEBUG}"; then
        echo "error: the U-Boot blob at ${UBOOT} is byte-identical to the debug build at ${UBOOT_DEBUG}." >&2
        echo "A v2 image must carry the uboot-mos variant: redundant environment at ${UENV_A_OFFSET_BYTES}/${UENV_B_OFFSET_BYTES}, setexpr, bootmeth order pinned to script. The debug build has none of that and the A/B handshake would silently never run." >&2
        echo "Rebuild it with 'make -C board/cx3576 uboot-mos'; do not copy or symlink the other variant into place." >&2
        exit 1
    fi
    for input in "${ROOTFS_VERITY_IMG}" "${ROOTFS_VERITY_ENV}" \
        "${BOOT_CMDLINE_A}" "${BOOT_CMDLINE_B}"; do
        if [ ! -f "${input}" ]; then
            echo "error: ${input} not found; produce it with '${ROOTFS_PRODUCER}'" >&2
            exit 1
        fi
    done

    # LOADER geometry. os/boards/cx3576/board.env cannot compute, so the identities
    # it documents are asserted here: the partition must start exactly where the
    # BootROM looks, must end exactly where uenv-a begins, and its size must be
    # the same number of bytes the U-Boot fit check uses. If these drift the
    # loader ends up partly outside its own partition, which is precisely the
    # state systemd-repart trims away.
    if [ "${LOADER_START_SECTOR}" -ne "${UBOOT_SEEK_SECTOR}" ]; then
        echo "error: LOADER_START_SECTOR=${LOADER_START_SECTOR} but the U-Boot blob is written at sector ${UBOOT_SEEK_SECTOR}; the loader partition must start where the bootloader does" >&2
        exit 1
    fi
    if [ $((LOADER_SIZE_SECTORS * SECTOR_SIZE)) -ne "${UBOOT_MAX_BYTES}" ]; then
        echo "error: the loader partition is $((LOADER_SIZE_SECTORS * SECTOR_SIZE)) bytes but UBOOT_MAX_BYTES is ${UBOOT_MAX_BYTES}; a blob that passes the fit check must fit the partition" >&2
        exit 1
    fi
    if [ $((LOADER_START_SECTOR + LOADER_SIZE_SECTORS)) -ne "${UENV_A_START_SECTOR}" ]; then
        echo "error: the loader partition ends at sector $((LOADER_START_SECTOR + LOADER_SIZE_SECTORS)) but ${UENV_A_LABEL} starts at ${UENV_A_START_SECTOR}; the two must abut or the GPT overlaps / leaves an untracked gap" >&2
        exit 1
    fi

    local uboot_bytes uboot_magic
    uboot_bytes="$(stat -c %s "${UBOOT}")"
    if [ "${uboot_bytes}" -gt "${UBOOT_MAX_BYTES}" ]; then
        echo "error: ${UBOOT} does not fit between sector ${UBOOT_SEEK_SECTOR} and ${UENV_A_LABEL} at ${UENV_A_START_MIB} MiB" >&2
        exit 1
    fi
    # The loader partition is only worth having if it actually contains a
    # loader. 'RKNS' is the first field of a Rockchip idbloader; a blob without
    # it is not something the BootROM will load, and shipping it would produce
    # an image that passes every structural check and does not boot.
    uboot_magic="$(od -An -tx1 -N4 "${UBOOT}" | tr -d ' \n')"
    if [ "${uboot_magic}" != "${LOADER_MAGIC_HEX}" ]; then
        echo "error: ${UBOOT} starts with '${uboot_magic}', not the Rockchip idbloader magic '${LOADER_MAGIC_HEX}' ('RKNS'); the RK3576 BootROM would not recognise it at sector ${UBOOT_SEEK_SECTOR}" >&2
        exit 1
    fi

    # The verity image is written raw into a slot, so it must land on a whole
    # MiB boundary exactly as the v1 rootfs does.
    local verity_bytes verity_mib
    verity_bytes="$(stat -c %s "${ROOTFS_VERITY_IMG}")"
    if [ "${verity_bytes}" -eq 0 ] || [ $((verity_bytes % MIB_BYTES)) -ne 0 ]; then
        echo "error: ${ROOTFS_VERITY_IMG} is ${verity_bytes} bytes, not a non-zero whole-MiB multiple; fix ${ROOTFS_PRODUCER}" >&2
        exit 1
    fi
    verity_mib=$((verity_bytes / MIB_BYTES))

    local verity_salt
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

    # Slot sizing. Pinned: the geometry is FROZEN at the pin, and an oversized
    # rootfs is a build failure — growing the slot would move rootfs-b, meta,
    # state and ephemeral, producing a GPT that no already-flashed device can
    # accept and RAUC bundles that no longer fit the deployed slot. Unpinned
    # (dev path): the built-in default acts as a floor and the slot grows with
    # the content.
    local slot_mib mode
    if [ "${ROOTFS_SLOT_PINNED}" = 1 ]; then
        mode="pinned"
        slot_mib="${MOS_ROOTFS_SLOT_MIB}"
        if [ "${verity_mib}" -gt "${slot_mib}" ]; then
            echo "error: rootfs slot geometry is pinned at MOS_ROOTFS_SLOT_MIB=${slot_mib} MiB but ${ROOTFS_VERITY_IMG} is ${verity_mib} MiB — $((verity_mib - slot_mib)) MiB too large." >&2
            echo "The slot size is frozen for every device already flashed with this layout, so it cannot be grown: shrink the rootfs instead." >&2
            exit 1
        fi
    else
        mode="floor"
        slot_mib=$(((verity_mib * ROOTFS_SLOT_HEADROOM_PCT + 99) / 100))
        slot_mib=$(((slot_mib + ROOTFS_SLOT_ALIGN_MIB - 1) / ROOTFS_SLOT_ALIGN_MIB * ROOTFS_SLOT_ALIGN_MIB))
        if [ "${slot_mib}" -lt "${MOS_ROOTFS_SLOT_MIB}" ]; then
            slot_mib="${MOS_ROOTFS_SLOT_MIB}"
        fi
    fi

    local rootfs_b_start_mib meta_start_mib state_start_mib ephemeral_start_mib data_start_mib total_size_mib
    rootfs_b_start_mib=$((ROOTFS_A_START_MIB + slot_mib))
    meta_start_mib=$((rootfs_b_start_mib + slot_mib))
    state_start_mib=$((meta_start_mib + META_SIZE_MIB))
    ephemeral_start_mib=$((state_start_mib + STATE_SIZE_MIB))
    data_start_mib=$((ephemeral_start_mib + MOS_VAR_MIB))
    total_size_mib=$((data_start_mib + DATA_SIZE_MIB + IMAGE_TAIL_SLACK_MIB))
    if [ "${mode}" = "pinned" ]; then
        echo "rootfs payload ${verity_mib} MiB -> rootfs slot ${slot_mib} MiB (pinned, frozen geometry); boot ${BOOT_SIZE_MIB}+${BOOT_SIZE_MIB} MiB; meta ${META_SIZE_MIB} + state ${STATE_SIZE_MIB} + var ${MOS_VAR_MIB} + data ${DATA_SIZE_MIB} MiB; image ${total_size_mib} MiB"
    else
        echo "rootfs payload ${verity_mib} MiB -> rootfs slot ${slot_mib} MiB (floor ${MOS_ROOTFS_SLOT_MIB}, ${ROOTFS_SLOT_HEADROOM_PCT}% headroom, ${ROOTFS_SLOT_ALIGN_MIB} MiB aligned); boot ${BOOT_SIZE_MIB}+${BOOT_SIZE_MIB} MiB; meta ${META_SIZE_MIB} + state ${STATE_SIZE_MIB} + var ${MOS_VAR_MIB} + data ${DATA_SIZE_MIB} MiB; image ${total_size_mib} MiB"
    fi
    echo "data is the last partition and the only growth target; systemd-repart extends it to the end of the disk on first boot"
    echo "verity root hash ${root_hash}"

    mkbootscr "${workdir}/${BOOT_SCRIPT_NAME}"
    mkboot "${workdir}/boot-a.img" "${BOOT_A_FAT_LABEL}" "${BOOT_A_FAT_VOLUME_ID}" \
        "${BOOT_CMDLINE_A}" A "${ROOTFS_A_GUID}" "${BOOT_VERITY_ENV_A_NAME}"
    mkboot "${workdir}/boot-b.img" "${BOOT_B_FAT_LABEL}" "${BOOT_B_FAT_VOLUME_ID}" \
        "${BOOT_CMDLINE_B}" B "${ROOTFS_B_GUID}" "${BOOT_VERITY_ENV_B_NAME}"
    mkext4 "${workdir}/meta.img" "${META_SIZE_MIB}" "${META_FS_LABEL}" "${META_FS_UUID}"
    mkext4 "${workdir}/state.img" "${STATE_SIZE_MIB}" "${STATE_FS_LABEL}" "${STATE_FS_UUID}"
    # EPHEMERAL SHIPS ALREADY SEEDED (RFCT-106). /var is a mount of this
    # filesystem, and an empty one hides the tree the installed packages
    # expect. mos-seed-var used to copy that tree out on the first boot -- at
    # the same moment as every other unit that writes /var, and Debian 13's
    # systemd-networkd-persistent-storage.service creates
    # /var/lib/systemd/network as soon as /var appears. The two raced; a lost
    # race failed the seed, which failed var-lib-mos.mount, which failed mosd,
    # apid and the health gate. Seeding here removes the race instead of
    # ordering against one member of it. The stamp goes in too, so
    # mos-seed-var's ConditionPathExists keeps it from running on a normal
    # boot; it stays for the path where EPHEMERAL has been wiped.
    : >"${FACTORY_VAR_STAGE}/.mos-var-seeded"
    [ -d "${FACTORY_VAR_STAGE}/lib" ] || {
        echo "error: the staged factory /var has no lib/; seeding EPHEMERAL from it would produce a /var with no dpkg database and no mosd state directory" >&2
        exit 1
    }
    mkext4 "${workdir}/ephemeral.img" "${MOS_VAR_MIB}" "${EPHEMERAL_FS_LABEL}" "${EPHEMERAL_FS_UUID}" "${FACTORY_VAR_STAGE}"
    mkext4 "${workdir}/data.img" "${DATA_SIZE_MIB}" "${DATA_FS_LABEL}" "${DATA_FS_UUID}"

    local img_tmp="${IMG_OUT}.tmp"
    rm -f "${img_tmp}"
    truncate -s "${total_size_mib}M" "${img_tmp}"

    # Every start is given explicitly in sectors: the layout is pinned, not
    # negotiated with sgdisk's allocator.
    # -a ${GPT_ALIGN_SECTORS}: the loader starts at sector 64, which is NOT
    # 2048-aligned. Without this sgdisk silently relocates it to sector 2048 and
    # the bootloader ends up outside its own partition again. Every other start
    # here is MiB-aligned, so relaxing the multiple changes nothing else.
    sgdisk --clear -a "${GPT_ALIGN_SECTORS}" \
        --disk-guid="${DISK_GUID}" \
        --new="${LOADER_PARTNUM}:${LOADER_START_SECTOR}:+${LOADER_SIZE_SECTORS}S" \
        --change-name="${LOADER_PARTNUM}:${LOADER_LABEL}" \
        --typecode="${LOADER_PARTNUM}:${LOADER_TYPECODE}" \
        --partition-guid="${LOADER_PARTNUM}:${LOADER_GUID}" \
        --new="${UENV_A_PARTNUM}:${UENV_A_START_SECTOR}:+${UENV_SIZE_SECTORS}S" \
        --change-name="${UENV_A_PARTNUM}:${UENV_A_LABEL}" \
        --typecode="${UENV_A_PARTNUM}:${UENV_A_TYPECODE}" \
        --partition-guid="${UENV_A_PARTNUM}:${UENV_A_GUID}" \
        --new="${UENV_B_PARTNUM}:${UENV_B_START_SECTOR}:+${UENV_SIZE_SECTORS}S" \
        --change-name="${UENV_B_PARTNUM}:${UENV_B_LABEL}" \
        --typecode="${UENV_B_PARTNUM}:${UENV_B_TYPECODE}" \
        --partition-guid="${UENV_B_PARTNUM}:${UENV_B_GUID}" \
        --new="${BOOT_A_PARTNUM}:${BOOT_A_START_SECTOR}:+${BOOT_SIZE_MIB}M" \
        --change-name="${BOOT_A_PARTNUM}:${BOOT_A_LABEL}" \
        --typecode="${BOOT_A_PARTNUM}:${BOOT_A_TYPECODE}" \
        --partition-guid="${BOOT_A_PARTNUM}:${BOOT_A_GUID}" \
        --new="${BOOT_B_PARTNUM}:${BOOT_B_START_SECTOR}:+${BOOT_SIZE_MIB}M" \
        --change-name="${BOOT_B_PARTNUM}:${BOOT_B_LABEL}" \
        --typecode="${BOOT_B_PARTNUM}:${BOOT_B_TYPECODE}" \
        --partition-guid="${BOOT_B_PARTNUM}:${BOOT_B_GUID}" \
        --new="${ROOTFS_A_PARTNUM}:${ROOTFS_A_START_SECTOR}:+${slot_mib}M" \
        --change-name="${ROOTFS_A_PARTNUM}:${ROOTFS_A_LABEL}" \
        --typecode="${ROOTFS_A_PARTNUM}:${ROOTFS_A_TYPECODE}" \
        --partition-guid="${ROOTFS_A_PARTNUM}:${ROOTFS_A_GUID}" \
        --new="${ROOTFS_B_PARTNUM}:$((rootfs_b_start_mib * MIB_BYTES / SECTOR_SIZE)):+${slot_mib}M" \
        --change-name="${ROOTFS_B_PARTNUM}:${ROOTFS_B_LABEL}" \
        --typecode="${ROOTFS_B_PARTNUM}:${ROOTFS_B_TYPECODE}" \
        --partition-guid="${ROOTFS_B_PARTNUM}:${ROOTFS_B_GUID}" \
        --new="${META_PARTNUM}:$((meta_start_mib * MIB_BYTES / SECTOR_SIZE)):+${META_SIZE_MIB}M" \
        --change-name="${META_PARTNUM}:${META_LABEL}" \
        --typecode="${META_PARTNUM}:${META_TYPECODE}" \
        --partition-guid="${META_PARTNUM}:${META_GUID}" \
        --new="${STATE_PARTNUM}:$((state_start_mib * MIB_BYTES / SECTOR_SIZE)):+${STATE_SIZE_MIB}M" \
        --change-name="${STATE_PARTNUM}:${STATE_LABEL}" \
        --typecode="${STATE_PARTNUM}:${STATE_TYPECODE}" \
        --partition-guid="${STATE_PARTNUM}:${STATE_GUID}" \
        --new="${EPHEMERAL_PARTNUM}:$((ephemeral_start_mib * MIB_BYTES / SECTOR_SIZE)):+${MOS_VAR_MIB}M" \
        --change-name="${EPHEMERAL_PARTNUM}:${EPHEMERAL_LABEL}" \
        --typecode="${EPHEMERAL_PARTNUM}:${EPHEMERAL_TYPECODE}" \
        --partition-guid="${EPHEMERAL_PARTNUM}:${EPHEMERAL_GUID}" \
        --new="${DATA_PARTNUM}:$((data_start_mib * MIB_BYTES / SECTOR_SIZE)):+${DATA_SIZE_MIB}M" \
        --change-name="${DATA_PARTNUM}:${DATA_LABEL}" \
        --typecode="${DATA_PARTNUM}:${DATA_TYPECODE}" \
        --partition-guid="${DATA_PARTNUM}:${DATA_GUID}" \
        "${img_tmp}" >/dev/null

    # uenv-a/uenv-b and rootfs-b stay holes: nothing is written into them.
    # conv=sparse on the payloads keeps the rest of the image sparse too: the
    # FAT and ext4 images are mostly zeros, and the destination is a freshly
    # truncated hole, so seeking over a zero block leaves exactly the same
    # bytes as writing it. Content is unaffected; only allocation is.
    dd if="${UBOOT}" of="${img_tmp}" bs=512 seek="${UBOOT_SEEK_SECTOR}" conv=notrunc,sparse status=none
    dd if="${workdir}/boot-a.img" of="${img_tmp}" bs=1M seek="${BOOT_A_START_MIB}" conv=notrunc,sparse status=none
    dd if="${workdir}/boot-b.img" of="${img_tmp}" bs=1M seek="${BOOT_B_START_MIB}" conv=notrunc,sparse status=none
    dd if="${ROOTFS_VERITY_IMG}" of="${img_tmp}" bs=1M seek="${ROOTFS_A_START_MIB}" conv=notrunc,sparse status=none
    dd if="${workdir}/meta.img" of="${img_tmp}" bs=1M seek="${meta_start_mib}" conv=notrunc,sparse status=none
    dd if="${workdir}/state.img" of="${img_tmp}" bs=1M seek="${state_start_mib}" conv=notrunc,sparse status=none
    dd if="${workdir}/ephemeral.img" of="${img_tmp}" bs=1M seek="${ephemeral_start_mib}" conv=notrunc,sparse status=none
    dd if="${workdir}/data.img" of="${img_tmp}" bs=1M seek="${data_start_mib}" conv=notrunc,sparse status=none

    # rc is captured explicitly: a nonzero sgdisk exit would otherwise kill the
    # run via set -e before the diagnostic below could print what sgdisk said.
    # Both failure shapes — nonzero exit AND problem text with exit 0 — must
    # reach the same friendly error.
    local verify verify_rc=0
    verify="$(sgdisk --verify "${img_tmp}")" || verify_rc=$?
    echo "${verify}"
    if [ "${verify_rc}" -ne 0 ] || ! echo "${verify}" | grep -c "No problems found" >/dev/null; then
        echo "error: sgdisk --verify reported problems (exit ${verify_rc})" >&2
        exit 1
    fi

    # Read the loader back OUT OF THE ASSEMBLED IMAGE. sgdisk is free to move a
    # requested start sector, so asserting what we asked for proves nothing;
    # this asserts what is actually there. The first byte of the partition must
    # be the idbloader magic, and the blob must fit inside it with room left.
    local got_start got_size got_magic
    got_start="$(sgdisk -i "${LOADER_PARTNUM}" "${img_tmp}" | sed -n 's/^First sector: //p' | awk '{print $1}')"
    got_size="$(sgdisk -i "${LOADER_PARTNUM}" "${img_tmp}" | sed -n 's/^Partition size: //p' | awk '{print $1}')"
    if [ "${got_start}" != "${LOADER_START_SECTOR}" ] || [ "${got_size}" != "${LOADER_SIZE_SECTORS}" ]; then
        echo "error: the assembled ${LOADER_LABEL} partition is ${got_size} sectors at ${got_start}, expected ${LOADER_SIZE_SECTORS} at ${LOADER_START_SECTOR}. sgdisk relocates a non-2048-aligned start unless -a ${GPT_ALIGN_SECTORS} is passed, and a relocated loader partition no longer covers the bootloader." >&2
        exit 1
    fi
    got_magic="$(dd if="${img_tmp}" bs="${SECTOR_SIZE}" skip="${got_start}" count=1 status=none | od -An -tx1 -N4 | tr -d ' \n')"
    if [ "${got_magic}" != "${LOADER_MAGIC_HEX}" ]; then
        echo "error: the first bytes of the ${LOADER_LABEL} partition are '${got_magic}', not the idbloader magic '${LOADER_MAGIC_HEX}'" >&2
        exit 1
    fi
    echo "${LOADER_LABEL} p${LOADER_PARTNUM}: sectors ${got_start}..$((got_start + got_size - 1)), ${uboot_bytes} of $((got_size * SECTOR_SIZE)) bytes used ($((got_size * SECTOR_SIZE - uboot_bytes)) spare); first bytes ${got_magic} ('RKNS')"

    mv "${img_tmp}" "${IMG_OUT}"
}

if [ "${1:-}" = "--assemble" ]; then
    assemble
    exit 0
fi

BOARD_DIR="${BOARD_DIR:-${REPO_ROOT}/board/cx3576}"
OUT_DIR="${REPO_ROOT}/_out/cx3576"

ROOTFS_VERITY_IMG="${OUT_DIR}/rootfs-verity.img"
ROOTFS_VERITY_ENV="${OUT_DIR}/rootfs-verity.env"
BOOT_CMDLINE_A="${OUT_DIR}/boot-cmdline-a.txt"
BOOT_CMDLINE_B="${OUT_DIR}/boot-cmdline-b.txt"
KERNEL_IMAGE="${BOARD_DIR}/out/kernel/Image"
DTB="${BOARD_DIR}/out/kernel/rk3576-src.dtb"
UBOOT="${BOARD_DIR}/out/${UBOOT_VARIANT_DIR}/${UBOOT_BIN_NAME}"
UBOOT_DEBUG="${BOARD_DIR}/out/${UBOOT_DEBUG_VARIANT_DIR}/${UBOOT_BIN_NAME}"

for input in "${ROOTFS_VERITY_IMG}" "${ROOTFS_VERITY_ENV}" "${BOOT_CMDLINE_A}" "${BOOT_CMDLINE_B}"; do
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
if [ ! -f "${UBOOT}" ]; then
    echo "note: BOARD_DIR is currently ${BOARD_DIR}" >&2
    uboot_missing_error "${UBOOT}"
fi

mkdir -p "${OUT_DIR}"

# Epoch is computed here at assembly time; only the filename varies per build.
IMG_NAME="${IMAGE_NAME_PREFIX}$(date +%s)${IMAGE_NAME_SUFFIX}"

# mke2fs must be able to switch orphan_file off (e2fsprogs >= 1.47) and honour
# -E hash_seed; older host tools silently cannot, so probe instead of guessing.
host_can_assemble() {
    command -v sgdisk >/dev/null && command -v mkfs.vfat >/dev/null &&
        command -v mcopy >/dev/null && command -v mke2fs >/dev/null &&
        command -v mkimage >/dev/null || return 1
    local probe rc=0
    probe="$(mktemp)"
    truncate -s "${META_SIZE_MIB}M" "${probe}"
    mke2fs -q -n -t ext4 -b "${EXT4_BLOCK_SIZE}" -O "${EXT4_FEATURES}" \
        -E "root_owner=0:0,hash_seed=${META_FS_UUID}" "${probe}" >/dev/null 2>&1 || rc=1
    rm -f "${probe}"
    return "${rc}"
}

# The inner run must see the pin only when this one was actually pinned:
# passing the resolved value unconditionally would turn every build into a
# frozen-geometry build.
INNER_ENV=()
DOCKER_PIN_ARGS=()
if [ "${ROOTFS_SLOT_PINNED}" = 1 ]; then
    INNER_ENV=("MOS_ROOTFS_SLOT_MIB=${MOS_ROOTFS_SLOT_MIB}")
    DOCKER_PIN_ARGS=(-e "MOS_ROOTFS_SLOT_MIB=${MOS_ROOTFS_SLOT_MIB}")
fi

if host_can_assemble; then
    env KERNEL_IMAGE="${KERNEL_IMAGE}" DTB="${DTB}" UBOOT="${UBOOT}" UBOOT_DEBUG="${UBOOT_DEBUG}" \
        FACTORY_VAR="${OUT_DIR}/factory-var" \
        ROOTFS_VERITY_IMG="${ROOTFS_VERITY_IMG}" ROOTFS_VERITY_ENV="${ROOTFS_VERITY_ENV}" \
        BOOT_CMDLINE_A="${BOOT_CMDLINE_A}" BOOT_CMDLINE_B="${BOOT_CMDLINE_B}" \
        IMG_OUT="${OUT_DIR}/${IMG_NAME}" "${INNER_ENV[@]}" \
        bash "${BASH_SOURCE[0]}" --assemble
else
    echo "sgdisk/mkfs.vfat/mcopy/mkimage/mke2fs(>=1.47) not all available on the host; assembling in a container"
    docker run --rm \
        -v "${REPO_ROOT}:/work" \
        -v "${BOARD_DIR}:/board:ro" \
        -e KERNEL_IMAGE=/board/out/kernel/Image \
        -e DTB=/board/out/kernel/rk3576-src.dtb \
        -e UBOOT="/board/out/${UBOOT_VARIANT_DIR}/${UBOOT_BIN_NAME}" \
        -e UBOOT_DEBUG="/board/out/${UBOOT_DEBUG_VARIANT_DIR}/${UBOOT_BIN_NAME}" \
        -e FACTORY_VAR=/work/_out/cx3576/factory-var \
        -e ROOTFS_VERITY_IMG=/work/_out/cx3576/rootfs-verity.img \
        -e ROOTFS_VERITY_ENV=/work/_out/cx3576/rootfs-verity.env \
        -e BOOT_CMDLINE_A=/work/_out/cx3576/boot-cmdline-a.txt \
        -e BOOT_CMDLINE_B=/work/_out/cx3576/boot-cmdline-b.txt \
        -e IMG_OUT="/work/_out/cx3576/${IMG_NAME}" \
        "${DOCKER_PIN_ARGS[@]}" \
        alpine:3.21 \
        sh -c 'apk add --no-cache -q bash coreutils sgdisk dosfstools mtools e2fsprogs u-boot-tools && exec bash /work/os/mkimage-v2.sh --assemble'
fi

ln -sfn "${IMG_NAME}" "${OUT_DIR}/${IMAGE_LATEST_NAME}"
echo "assembled ${OUT_DIR}/${IMG_NAME} (${IMAGE_LATEST_NAME} -> ${IMG_NAME})"
