#!/usr/bin/env bash
# Behavioural test for the systemd-repart loader hazard.
#
# systemd-repart discards every region of the disk that no GPT partition entry
# covers, and it does so on the first boot while growing DATA. The Rockchip
# idbloader lives at raw LBA 64; while it sat outside every partition the
# growth run TRIMmed it away, so the device booted once and reached maskrom on
# the next power-on. That generalises to every SoC that boots from a raw
# offset. The fix is structural: the loader area is a real GPT partition, so
# repart leaves it alone and first-boot TRIM stays enabled.

# This test proves that property against a real systemd-repart on a real image
# on a loop device, with discard enabled -- stock settings, no --discard=no
# anywhere. Both directions, per image:
#   positive  the image as built, with its loader partition: LBA 64 survives.
#   negative  the same image with only the loader partition entry deleted: LBA
#             64 is destroyed. Without this the positive case would prove
#             nothing, because a repart run that quietly did nothing at all
#             would pass it. A guard that has never been seen to fire is not a
#             guard.

# A second section then runs the repart definitions the v2 image actually
# ships, unpacked out of the packed root, and asserts that DATA is bigger
# afterwards -- the growth /srv depends on. Its negative direction removes
# SizeMinBytes=0 from the uenv placeholders, reconstructing the state in which
# repart refused the whole run and /srv silently never grew.
#
#   bash os/tests/repart-loader-test.sh [image]...
#
# With no argument the latest assembled image is tested, if one exists. Needs
# docker with --privileged (loop devices). Fails loudly if unavailable; it
# never skips silently.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAYOUT_ENV="${REPO_ROOT}/os/boards/cx3576/board.env"
if [ ! -f "${LAYOUT_ENV}" ]; then
    echo "error: ${LAYOUT_ENV} not found" >&2
    exit 1
fi
# shellcheck source=../boards/cx3576/board.env
. "${LAYOUT_ENV}"

GROWN_SIZE="8G"

pass_count=0
fail_count=0
pass() { echo "PASS: $*"; pass_count=$((pass_count + 1)); }
fail() { echo "FAIL: $*"; fail_count=$((fail_count + 1)); }

IMAGES=("$@")
if [ "${#IMAGES[@]}" -eq 0 ]; then
    for candidate in "${REPO_ROOT}/_out/cx3576/${IMAGE_LATEST_NAME}"; do
        [ -f "${candidate}" ] && IMAGES+=("${candidate}")
    done
fi
if [ "${#IMAGES[@]}" -eq 0 ]; then
    echo "error: no image found; build one with 'make os-image-cx3576-v2'" >&2
    exit 1
fi
command -v docker >/dev/null || { echo "error: docker is required" >&2; exit 1; }

work="$(mktemp -d "${REPO_ROOT}/_out/repart-test.XXXXXX")"
trap 'rm -rf "${work}"' EXIT

# sgdisk runs on the host at several sites below (partition-table reads, and
# one entry delete on a scratch copy), but the host is not required to carry
# it: this test already cannot run without docker, so a missing sgdisk
# resolves to a same-named function running in a one-time alpine tool image.
# Every path this script hands sgdisk lives under ${REPO_ROOT}/_out — the
# shipped images and ${work} both — so mounting _out at itself makes every
# argument resolve identically and keeps the output byte-identical to a host
# run. os/build/src/toolbox.ts holds the same rule, for the same reason: a
# missing host tool must not read as a FAIL that indicts the image.
if ! command -v sgdisk >/dev/null 2>&1; then
    # The base, from os/build-env/images.env -- IMAGE_ALPINE_3_21, the same key
    # os/build/src/toolsets.ts assembles from and os/verify/src/tools.ts verifies
    # from, so the sgdisk that reads a GPT here is the sgdisk that wrote it. The
    # heredoc is unquoted so ${TOOL_BASE} expands; nothing else in the body is a
    # shell expansion.
    TOOL_BASE="$(bash "${REPO_ROOT}/os/build-env/from.sh" --ref IMAGE_ALPINE_3_21)"
    TOOL_IMAGE="$(docker build -q - <<EOF
FROM ${TOOL_BASE}
RUN apk add --no-cache -q sgdisk
EOF
    )"
    [ -n "${TOOL_IMAGE}" ] || { echo "error: could not build the sgdisk tool image" >&2; exit 1; }
    sgdisk() { docker run --rm -v "${REPO_ROOT}/_out:${REPO_ROOT}/_out" "${TOOL_IMAGE}" sgdisk "$@"; }
    echo "host has no sgdisk; using container image ${TOOL_IMAGE} for it"
fi

# The stopgap must not exist. Protection comes from the partition entry; a
# --discard=no drop-in is the other approach, and carrying both would hide a
# regression in the partition entry behind a flag nobody remembers is there --
# the positive case below would keep passing for the wrong reason. Scoped to
# os/rootfs, which is everything that lands in an image: an overlay drop-in or
# a Dockerfile RUN that writes one. Prose elsewhere in the tree explains why
# the flag is not used, and matching that would make the check unfalsifiable;
# comment lines are dropped for the same reason.
discard_hits="$(grep -rn -- '--discard=no' "${REPO_ROOT}/os/rootfs" 2>/dev/null |
    grep -v ':[[:space:]]*#' || true)"
if [ -z "${discard_hits}" ]; then
    pass "no --discard=no override is staged into any image (os/rootfs); first-boot TRIM is enabled and the loader is protected structurally"
else
    fail "a --discard=no override is staged into an image ($(echo "${discard_hits}" | tr '\n' ' ')); this test would then pass for the wrong reason"
fi

# Reads the first four bytes of LBA 64 as hex.
loader_magic_of() {
    dd if="$1" bs="${SECTOR_SIZE}" skip="${LOADER_START_SECTOR}" count=1 status=none |
        od -An -tx1 -N4 | tr -d ' \n'
}

# Builds a definition set matching an image's linux-generic partitions: one
# inert placeholder per partition, in disk order, and the last one growing.
# Derived from the image's own GPT rather than restated, so it stays correct
# for both pipelines. repart pairs definitions with partitions by type UUID, so
# the count is exactly the number of linux-generic partitions -- and the
# loader, carrying LOADER_TYPECODE, is not one of them.

# The set is synthesised rather than copied from the image so that this test
# covers both pipelines from one code path: v1 and v2 ship different definition
# sets, and what is under test here is the loader, not either set.
# SizeMinBytes=0 is set for the same reason the shipped v2 definitions set it:
# systemd-repart will not claim an existing partition smaller than the
# definition's minimum size, and that minimum defaults to 10 MiB, while uenv-a
# and uenv-b are 64 KiB. Omitting it makes repart abort the whole run with
# "Can't fit requested partitions into available free space" before touching
# anything, so /srv never grows. The growth check further down runs the shipped
# definitions rather than these synthesised ones.
mkdefs() {
    local img="$1" dir="$2" n=0 i part_count type
    rm -rf "${dir}"
    mkdir -p "${dir}"
    part_count="$(sgdisk -p "${img}" | grep -cE '^[[:space:]]+[0-9]+[[:space:]]')"
    for i in $(seq 1 "${part_count}"); do
        type="$(sgdisk -i "${i}" "${img}" | sed -n 's/^Partition GUID code: //p' | awk '{print $1}')"
        if [ "${type^^}" = "${TYPECODE_LINUX^^}" ]; then
            n=$((n + 1))
        fi
    done
    for i in $(seq 1 "${n}"); do
        if [ "${i}" -eq "${n}" ]; then
            printf '%s\n' '[Partition]' 'Type=linux-generic' 'SizeMinBytes=0' 'Weight=1000' \
                > "$(printf '%s/%02d-grow.conf' "${dir}" "${i}")"
        else
            printf '%s\n' '[Partition]' 'Type=linux-generic' 'SizeMinBytes=0' 'Weight=0' 'PaddingWeight=0' \
                > "$(printf '%s/%02d-hold.conf' "${dir}" "${i}")"
        fi
    done
    echo "${n}"
}

# Runs a real systemd-repart over a copy of the image on a loop device, with
# STOCK settings: no --discard flag at all, so discard is on. Echoes the four
# bytes at LBA 64 afterwards; the run's own log lands in ${work}/<name>.log.
# The repart container's base, from os/build-env/images.env, resolved once for
# the three containers below that share it: the two systemd-repart runs and the
# unsquashfs that reads /etc/repart.d back out of the shipped root.
#
# IMAGE_DEBIAN_BOOKWORM and not _TRIXIE: all three containers run on
# `debian:bookworm-slim`, and the pin records that rather than moving them.
REPART_BASE="$(bash "${REPO_ROOT}/os/build-env/from.sh" --ref IMAGE_DEBIAN_BOOKWORM)"

run_repart() {
    local name="$1" defs="$2"
    local copy="${work}/${name}.img"

    truncate -s "${GROWN_SIZE}" "${copy}"

    docker run --rm --privileged -v "${work}:/w" "${REPART_BASE}" sh -c "
        set -e
        apt-get update -qq >/dev/null 2>&1
        apt-get install -y -qq systemd util-linux >/dev/null 2>&1
        # The kernel hands out the first loop number free SYSTEM-wide, which on a
        # busy host is well past any range we could pre-create; creating 0..7 and
        # hoping fails with ENOENT on a perfectly good image. Ask which number it
        # will give us, then make that node.
        n=\$(losetup -f | sed 's|/dev/loop||')
        [ -e /dev/loop\$n ] || mknod /dev/loop\$n b 7 \$n
        loop=/dev/loop\$n
        losetup \$loop /w/${name}.img
        # Loop devices are HOST-GLOBAL (this container is --privileged): if
        # repart fails between the attach and the detach, set -e would exit
        # this shell with the device still attached, leaking it on the host
        # until someone notices losetup -a filling up. Detach on EXIT instead
        # of only on the success path; the '|| true' covers the normal case
        # where the explicit detach below already ran.
        trap 'losetup -d \"\$loop\" 2>/dev/null || true' EXIT
        SYSTEMD_LOG_LEVEL=debug systemd-repart --definitions=/w/${defs} --dry-run=no \"\$loop\"
        losetup -d \"\$loop\"
    " > "${work}/${name}.log" 2>&1

    loader_magic_of "${copy}"
}

for IMAGE in "${IMAGES[@]}"; do
    echo
    echo "=== image: ${IMAGE} ==="
    if [ ! -f "${IMAGE}" ]; then
        fail "image not found: ${IMAGE}"
        continue
    fi
    tag="$(basename "${IMAGE}" | tr -c 'A-Za-z0-9' '-')"

    before="$(loader_magic_of "${IMAGE}")"
    if [ "${before}" = "${LOADER_MAGIC_HEX}" ]; then
        pass "${tag}: carries the loader magic ${LOADER_MAGIC_HEX} at LBA ${LOADER_START_SECTOR} before any repart run"
    else
        fail "${tag}: LBA ${LOADER_START_SECTOR} is '${before}', expected '${LOADER_MAGIC_HEX}' — nothing else about this image is meaningful"
        continue
    fi

    # The property under test, stated as a fact about the GPT rather than about
    # a flag: some partition entry covers LBA 64.
    loader_first="$(sgdisk -i "${LOADER_PARTNUM}" "${IMAGE}" | sed -n 's/^First sector: //p' | awk '{print $1}')"
    if [ "${loader_first}" = "${LOADER_START_SECTOR}" ]; then
        pass "${tag}: p${LOADER_PARTNUM} covers LBA ${LOADER_START_SECTOR}"
    else
        fail "${tag}: p${LOADER_PARTNUM} starts at '${loader_first}', not ${LOADER_START_SECTOR}"
    fi

    defs_dir="defs-${tag}"
    def_n="$(mkdefs "${IMAGE}" "${work}/${defs_dir}")"
    echo "${tag}: ${def_n} linux-generic partitions -> ${def_n} repart definitions, the last one growing"

    # --- positive: the image as built, stock repart, discard ENABLED
    cp "${IMAGE}" "${work}/with-loader-${tag}.img"
    with="$(run_repart "with-loader-${tag}" "${defs_dir}")"
    if [ "${with}" = "${LOADER_MAGIC_HEX}" ]; then
        pass "${tag}: stock repart (discard ENABLED) leaves LBA ${LOADER_START_SECTOR} intact — the partition entry is what protects it"
    else
        fail "${tag}: stock repart left LBA ${LOADER_START_SECTOR} as '${with}', expected '${LOADER_MAGIC_HEX}'"
        echo "--- repart log ---"
        cat "${work}/with-loader-${tag}.log"
    fi
    # The run has to have actually done something, or the positive result is
    # vacuous: a repart that failed to open the disk would also leave LBA 64
    # alone. DATA must have been grown towards the new end of the medium.
    if grep -qiE "Growing|Successfully|Adding|resiz" "${work}/with-loader-${tag}.log"; then
        pass "${tag}: the repart run actually modified the disk (it is not a no-op)"
    else
        fail "${tag}: the repart run appears to have done nothing, so the positive result proves nothing: $(tail -n 5 "${work}/with-loader-${tag}.log" | tr '\n' ' ')"
    fi

    # --- negative: the same image with ONLY the loader entry removed
    # Not a different layout and not a different flag: one GPT entry deleted,
    # which is exactly the state this task changed. If the loader survives this,
    # the positive case above was protecting nothing.
    cp "${IMAGE}" "${work}/no-loader-${tag}.img"
    sgdisk -d "${LOADER_PARTNUM}" "${work}/no-loader-${tag}.img" >/dev/null
    if [ "$(loader_magic_of "${work}/no-loader-${tag}.img")" != "${LOADER_MAGIC_HEX}" ]; then
        fail "${tag}: deleting the partition entry already destroyed LBA ${LOADER_START_SECTOR}; the negative case cannot attribute anything to repart"
    else
        without="$(run_repart "no-loader-${tag}" "${defs_dir}")"
        if [ "${without}" != "${LOADER_MAGIC_HEX}" ]; then
            pass "${tag}: with the loader entry removed, the SAME stock repart destroys LBA ${LOADER_START_SECTOR} ('${without}') — the hazard is real and this test can fire"
            echo "${tag}: repart said: $(grep -i 'discard' "${work}/no-loader-${tag}.log" | head -n 2 | tr '\n' ' ')"
        else
            fail "${tag}: with no loader partition, stock repart still left LBA ${LOADER_START_SECTOR} intact; the hazard did not reproduce, so the positive case proves nothing"
        fi
    fi
done

# v2: the shipped repart definitions must actually grow DATA.
#
# The loop above proves the loader survives, but it does so with a synthesised
# definition set. That deliberately says nothing about the set the image
# actually carries -- and the set the image carried could not drive a
# successful run at all: systemd-repart refuses to claim an existing partition
# below the definition's minimum size, which defaults to 10 MiB, while uenv-a
# and uenv-b are 64 KiB. repart therefore concluded it had to create two new
# partitions, could not place them, and aborted with
#     Can't fit requested partitions into available free space (6.7G), refusing.
# before touching anything. /srv never grew on a real device, and a refusal
# looks exactly like a clean exit.

# So this section runs the definitions the image ships, unpacked out of the
# packed rootfs slot, and asserts the outcome that matters: DATA is bigger
# afterwards. "repart did not error" is not enough -- that is what the refusal
# already looked like. The negative direction removes SizeMinBytes=0 from the
# two uenv definitions, reconstructing the pre-fix state, and asserts the run
# refuses and DATA does not grow. Without it the positive case would be a guard
# that has never been seen to fire.
V2_IMAGE=""
for candidate in "${IMAGES[@]}"; do
    case "$(basename "${candidate}")" in
    "${IMAGE_NAME_PREFIX}"*) V2_IMAGE="${candidate}" ;;
    esac
done
ROOTFS_SLOT="${REPO_ROOT}/_out/cx3576/rootfs-verity.img"

# Size of a partition in the image's GPT, in sectors.
part_sectors_of() {
    sgdisk -i "$2" "$1" 2>/dev/null | sed -n 's/^Partition size: //p' | awk '{print $1}'
}

# Runs a real systemd-repart over a fresh copy grown to GROWN_SIZE, tolerating
# failure. Echoes the exit status; the log lands in ${work}/<name>.log.
run_repart_rc() {
    local name="$1" defs="$2" src="$3" rc=0
    cp "${src}" "${work}/${name}.img"
    truncate -s "${GROWN_SIZE}" "${work}/${name}.img"
    docker run --rm --privileged -v "${work}:/w" "${REPART_BASE}" sh -c "
        set -e
        apt-get update -qq >/dev/null 2>&1
        apt-get install -y -qq systemd util-linux >/dev/null 2>&1
        # The kernel hands out the first loop number free SYSTEM-wide, which on a
        # busy host is well past any range we could pre-create; creating 0..7 and
        # hoping fails with ENOENT on a perfectly good image. Ask which number it
        # will give us, then make that node.
        n=\$(losetup -f | sed 's|/dev/loop||')
        [ -e /dev/loop\$n ] || mknod /dev/loop\$n b 7 \$n
        loop=/dev/loop\$n
        losetup \$loop /w/${name}.img
        # Same host-global loop hazard as run_repart above — and this variant
        # EXPECTS failing repart runs (the negative direction), so without the
        # trap every negative case would leak one loop device per run.
        trap 'losetup -d \"\$loop\" 2>/dev/null || true' EXIT
        SYSTEMD_LOG_LEVEL=debug systemd-repart --definitions=/w/${defs} --dry-run=no \"\$loop\"
        losetup -d \"\$loop\"
    " > "${work}/${name}.log" 2>&1 || rc=$?
    echo "${rc}"
}

echo
echo "=== v2 growth: the definitions the image ships ==="
if [ -z "${V2_IMAGE}" ]; then
    fail "no v2 image among the images under test, so the shipped-definition growth check cannot run; build one with 'make os-image-cx3576-v2'"
elif [ ! -f "${ROOTFS_SLOT}" ]; then
    fail "${ROOTFS_SLOT} not found, so /etc/repart.d cannot be read out of the SHIPPED root; build it with 'make os-image-cx3576-v2'"
else
    cp "${ROOTFS_SLOT}" "${work}/slot.squashfs"
    rm -rf "${work}/defs-shipped" "${work}/defs-prefix"
    docker run --rm -v "${work}:/w" "${REPART_BASE}" sh -c '
        set -e
        apt-get update -qq >/dev/null 2>&1
        apt-get install -y -qq squashfs-tools >/dev/null 2>&1
        rm -rf /w/unsq
        unsquashfs -n -d /w/unsq /w/slot.squashfs /etc/repart.d >/dev/null
        mkdir -p /w/defs-shipped
        cp /w/unsq/etc/repart.d/*.conf /w/defs-shipped/
        rm -rf /w/unsq
    ' >"${work}/unpack-defs.log" 2>&1 || true

    # `find` on a directory the unpack failed to create exits non-zero, which
    # would abort the script under `set -o pipefail` instead of reporting.
    shipped_n="$({ find "${work}/defs-shipped" -name '*.conf' 2>/dev/null || true; } | wc -l | tr -d ' ')"
    if [ "${shipped_n}" -gt 0 ]; then
        pass "read ${shipped_n} repart definitions out of the PACKED root ($(basename "${ROOTFS_SLOT}")), so what follows tests the image's own set and not a synthesised one"
    else
        fail "could not unpack /etc/repart.d out of ${ROOTFS_SLOT}: $(tail -n 3 "${work}/unpack-defs.log" | tr '\n' ' ')"
    fi

    data_before="$(part_sectors_of "${V2_IMAGE}" "${DATA_PARTNUM}")"
    if [ -n "${data_before}" ] && [ "${data_before}" -gt 0 ] 2>/dev/null; then
        pass "v2 DATA (p${DATA_PARTNUM}) is ${data_before} sectors in the image as built"
    else
        fail "cannot read the size of v2 DATA (p${DATA_PARTNUM}) from ${V2_IMAGE}; nothing below can be attributed to repart"
    fi

    if [ "${shipped_n}" -gt 0 ]; then
        # --- positive: the shipped set, on the real GPT, grown medium
        rc="$(run_repart_rc "grow-shipped" defs-shipped "${V2_IMAGE}")"
        data_after="$(part_sectors_of "${work}/grow-shipped.img" "${DATA_PARTNUM}")"
        if [ "${rc}" = "0" ]; then
            pass "the shipped v2 definitions drive systemd-repart to completion (exit 0) on an 8G medium"
        else
            fail "the shipped v2 definitions made systemd-repart exit ${rc}: $(grep -iE 'refus|error|cannot|fit' "${work}/grow-shipped.log" | head -n 3 | tr '\n' ' ')"
        fi
        if [ -n "${data_after}" ] && [ -n "${data_before}" ] &&
            [ "${data_after}" -gt "${data_before}" ] 2>/dev/null; then
            pass "DATA actually GREW: ${data_before} -> ${data_after} sectors ($((data_before / 2048)) MiB -> $((data_after / 2048)) MiB). /srv scales with the medium"
        else
            fail "DATA did NOT grow: ${data_before} -> ${data_after:-unreadable} sectors. A repart run that REFUSES looks exactly like a clean exit, so this is the assertion that distinguishes them"
        fi
        if [ "$(loader_magic_of "${work}/grow-shipped.img")" = "${LOADER_MAGIC_HEX}" ]; then
            pass "the growing run left LBA ${LOADER_START_SECTOR} intact — growth and loader protection hold together, not one at the cost of the other"
        else
            fail "the growing run destroyed LBA ${LOADER_START_SECTOR}"
        fi

        # --- negative: the same set with the fix taken back out
        # One directive removed from two files, which is exactly the state this
        # task changed. If DATA still grew, the fix above was protecting
        # nothing and the positive case proves nothing.
        mkdir -p "${work}/defs-prefix"
        cp "${work}/defs-shipped/"*.conf "${work}/defs-prefix/"
        stripped=0
        for f in "${work}/defs-prefix/"*.conf; do
            if grep -q '^SizeMinBytes=0$' "${f}"; then
                { grep -v '^SizeMinBytes=0$' "${f}" || true; } >"${f}.new"
                mv "${f}.new" "${f}"
                stripped=$((stripped + 1))
            fi
        done
        if [ "${stripped}" -gt 0 ]; then
            pass "the negative case has something to remove: ${stripped} shipped definition(s) carry SizeMinBytes=0"
        else
            fail "no shipped definition carries SizeMinBytes=0, so the negative case cannot reconstruct the pre-fix state and the positive case is unattributed"
        fi
        rc_neg="$(run_repart_rc "grow-prefix" defs-prefix "${V2_IMAGE}")"
        data_neg="$(part_sectors_of "${work}/grow-prefix.img" "${DATA_PARTNUM}")"
        if [ "${stripped}" -eq 0 ]; then
            fail "the pre-fix negative case did not run (nothing was stripped)"
        elif [ "${rc_neg}" != "0" ] && [ "${data_neg}" = "${data_before}" ]; then
            pass "with SizeMinBytes=0 removed the SAME run refuses (exit ${rc_neg}) and DATA stays at ${data_neg} sectors — the defect is real, the fix is what closes it, and this check can fire: $(grep -iE 'refusing' "${work}/grow-prefix.log" | head -n 1 | tr '\n' ' ')"
        else
            fail "with SizeMinBytes=0 removed the run exited ${rc_neg} and DATA went ${data_before} -> ${data_neg}; the pre-fix defect did not reproduce, so the positive case above proves nothing about SizeMinBytes"
        fi
    fi
fi

echo
total=$((pass_count + fail_count))
if [ "${fail_count}" -eq 0 ]; then
    echo "RESULT: PASS (${pass_count}/${total} checks)"
else
    echo "RESULT: FAIL (${pass_count} passed, ${fail_count} failed)"
    exit 1
fi
