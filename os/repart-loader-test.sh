#!/usr/bin/env bash
# Behavioural test for the systemd-repart loader hazard.
#
# systemd-repart discards every region of the disk that no GPT partition entry
# covers, and it does so on the first boot while growing DATA. The Rockchip
# idbloader lives at raw LBA 64; while it sat outside every partition the growth
# run TRIMmed it away, so the device booted once and reached maskrom on the next
# power-on. That is not a Rockchip quirk — it generalises to every SoC that
# boots from a raw offset.
#
# The fix is STRUCTURAL: the loader area is a real GPT partition, so repart
# leaves it alone and first-boot TRIM stays enabled. This test proves that
# property against a real systemd-repart on a real image on a loop device, with
# discard ENABLED — stock settings, no --discard=no anywhere.
#
# Both directions, per image:
#   positive  the image as built, with its loader partition: LBA 64 survives.
#   negative  the SAME image with only the loader partition entry deleted:
#             LBA 64 is destroyed. Without this the positive case would prove
#             nothing — a repart run that quietly did nothing at all would pass
#             it. A guard that has never been seen to fire is not a guard.
#
#   bash os/repart-loader-test.sh [image]...
#
# With no argument both pipelines' latest images are tested, whichever exist.
# Needs docker with --privileged (loop devices). Fails loudly if unavailable;
# it never skips silently.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAYOUT_ENV="${REPO_ROOT}/os/layout/cx3576-v2.env"
if [ ! -f "${LAYOUT_ENV}" ]; then
    echo "error: ${LAYOUT_ENV} not found" >&2
    exit 1
fi
# shellcheck source=layout/cx3576-v2.env
. "${LAYOUT_ENV}"

GROWN_SIZE="8G"

pass_count=0
fail_count=0
pass() { echo "PASS: $*"; pass_count=$((pass_count + 1)); }
fail() { echo "FAIL: $*"; fail_count=$((fail_count + 1)); }

IMAGES=("$@")
if [ "${#IMAGES[@]}" -eq 0 ]; then
    for candidate in "${REPO_ROOT}/_out/cx3576/cx3576-mos-latest.img" \
        "${REPO_ROOT}/_out/cx3576/${IMAGE_LATEST_NAME}"; do
        [ -f "${candidate}" ] && IMAGES+=("${candidate}")
    done
fi
if [ "${#IMAGES[@]}" -eq 0 ]; then
    echo "error: no image found; build one with 'make os-image-cx3576' or 'make os-image-cx3576-v2'" >&2
    exit 1
fi
command -v docker >/dev/null || { echo "error: docker is required" >&2; exit 1; }

work="$(mktemp -d "${REPO_ROOT}/_out/repart-test.XXXXXX")"
trap 'rm -rf "${work}"' EXIT

# --- the stopgap must not exist ---------------------------------------------
# Protection comes from the partition entry. A --discard=no drop-in is the OTHER
# approach, and carrying both would hide a regression in the partition entry
# behind a flag nobody remembers is there — the positive case below would keep
# passing for the wrong reason.
# Scoped to os/rootfs, which is everything that lands in an image: an overlay
# drop-in or a Dockerfile RUN that writes one. Prose elsewhere in the tree
# EXPLAINS why the flag is not used, and matching that would make the check
# unfalsifiable; comment lines are dropped for the same reason.
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
# Derived from the image's own GPT rather than restated, so it stays correct for
# both pipelines. repart pairs definitions with partitions BY TYPE UUID, so the
# count is exactly the number of linux-generic partitions -- and the loader,
# carrying LOADER_TYPECODE, is not one of them.
#
# SizeMinBytes=0 is why this synthesises a set instead of copying
# os/rootfs/overlay-v2/etc/repart.d/. systemd-repart will not claim an EXISTING
# partition smaller than the definition's minimum size, and that minimum
# defaults to 10 MiB. uenv-a and uenv-b are 64 KiB linux-generic partitions, so
# the shipped definitions cannot claim them: repart decides it must CREATE two
# new partitions instead and aborts with "Can't fit requested partitions into
# available free space". That is a PRE-EXISTING defect in the v2 growth path,
# independent of this task and reproducible on the layout before the loader
# partition was added; it is recorded in docs/task/RFCT-031.md and is NOT fixed
# here. Pinning the minimum to 0 makes repart do the real work this test needs
# it to do, on the real GPT.
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
run_repart() {
    local name="$1" defs="$2"
    local copy="${work}/${name}.img"

    truncate -s "${GROWN_SIZE}" "${copy}"

    docker run --rm --privileged -v "${work}:/w" debian:bookworm-slim sh -c "
        set -e
        apt-get update -qq >/dev/null 2>&1
        apt-get install -y -qq systemd util-linux >/dev/null 2>&1
        for n in 0 1 2 3 4 5 6 7; do [ -e /dev/loop\$n ] || mknod /dev/loop\$n b 7 \$n; done
        loop=\$(losetup --show -f /w/${name}.img)
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

    # --- positive: the image as built, stock repart, discard ENABLED ---------
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

    # --- negative: the same image with ONLY the loader entry removed ---------
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

echo
total=$((pass_count + fail_count))
if [ "${fail_count}" -eq 0 ]; then
    echo "RESULT: PASS (${pass_count}/${total} checks)"
else
    echo "RESULT: FAIL (${pass_count} passed, ${fail_count} failed)"
    exit 1
fi
