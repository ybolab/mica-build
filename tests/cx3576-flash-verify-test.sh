#!/usr/bin/env bash
# The cx3576 flash read-back, driven end to end against a stub rkdeveloptool.
#
#   bash tests/cx3576-flash-verify-test.sh        (or: make os-cx3576-flash-test)
#
# WHAT THIS EXISTS FOR. `verify-boot-area` read back the first 16 MiB and its
# echo said the boot area was verified, which was true and was read as broader
# than it was: boards/cx3576/board.env puts boot-a at 18 MiB and rootfs-a at
# 146 MiB, so everything that decides whether the machine runs was outside the
# window. A flash reported success and left the kernel in boot-a as a mixture
# of two builds -- the current build at file offset 0x31da8, the previous
# build's bytes at 0x1e87800 -- and the board died in paging_init
# (docs/task/RFCT-351.md). Case 3 below is that failure, planted at that offset
# in the partition the incident put it in, and case 3f runs the OLD comparison
# over the SAME medium and requires it to pass: without that half, "the new
# check goes red" would not be attributable to widening the window.
#
# WHAT IT CAN AND CANNOT REACH. There is no board, so `rkdeveloptool` itself is
# never executed here and this suite says nothing about whether the real tool
# accepts these arguments. What it does check is everything on this side of
# that call: the argv the recipes build, the sector arithmetic derived from
# board.env, which ranges of the image are covered, that a hole in any of them
# turns the run red BEFORE `rd` reboots the board into it, and that the
# refusals refuse. docs/task/RFCT-353.md names the lines that have never run.
#
# Needs no docker, no network and no root. It fails loudly rather than skipping.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BSP_DIR="${REPO_ROOT}/boards/cx3576/bsp"
LAYOUT_ENV="${REPO_ROOT}/boards/cx3576/board.env"
if [ ! -f "${LAYOUT_ENV}" ]; then
    echo "error: ${LAYOUT_ENV} not found" >&2
    exit 1
fi
# shellcheck source=../boards/cx3576/board.env
. "${LAYOUT_ENV}"

pass_count=0
fail_count=0
pass() { echo "PASS: $*"; pass_count=$((pass_count + 1)); }
fail() { echo "FAIL: $*"; fail_count=$((fail_count + 1)); }

mkdir -p "${REPO_ROOT}/_out"
work="$(mktemp -d "${REPO_ROOT}/_out/cx3576-flash-verify.XXXXXX")"
trap 'rm -rf "${work}"' EXIT
mkdir -p "${work}/bin"

# --- the stub ---------------------------------------------------------------
# It plays the eMMC with a file: `wl` writes the image into it at the given
# sector, `rl` reads sectors back out of it, and RK_HOLE_AT plants the one
# failure this suite is about -- a write that reports success and leaves
# somebody else's bytes behind. Every invocation is appended to RK_LOG, which
# is how the argv the Makefile builds is checked rather than assumed.
STUB="${work}/bin/rkdeveloptool"
cat > "${STUB}" <<'STUBEOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${RK_LOG}"
case "${1:-}" in
    wl)
        dd if="$3" of="${RK_DEVICE}" bs=512 seek="$2" conv=notrunc,sparse status=none
        if [ -n "${RK_HOLE_AT:-}" ]; then
            dd if="${RK_HOLE_FILE}" of="${RK_DEVICE}" bs=1 seek="${RK_HOLE_AT}" \
               conv=notrunc status=none
        fi
        ;;
    rl)
        dd if="${RK_DEVICE}" of="$4" bs=512 skip="$2" count="$3" conv=sparse status=none
        ;;
    db|rd)
        ;;
    *)
        echo "stub rkdeveloptool: unknown verb '${1:-}'" >&2
        exit 2
        ;;
esac
STUBEOF
chmod +x "${STUB}"

# The eight stale bytes the board actually read: `adrp x1, ...` / `add x1, x1,
# #0x3e8` out of the PREVIOUS build's early_kvm_mode_cfg, found at 0x1e87800 in
# the kernel that was flashed before the one that crashed.
HOLE_FILE="${work}/stale.bin"
printf '\x61\xef\xff\x90\x21\xa0\x0f\x91' > "${HOLE_FILE}"

# --- fixtures ---------------------------------------------------------------
# The product image's size, from board.env's own formula rather than from a
# built image: this suite must run in a fresh checkout with an empty _out.
# Sparse, so 1315 MiB of mostly-holes costs no disk.
IMAGE_MIB=$(( ROOTFS_A_START_MIB + 2 * MOS_ROOTFS_SLOT_MIB + META_SIZE_MIB \
              + STATE_SIZE_MIB + MOS_VAR_MIB + DATA_SIZE_MIB + IMAGE_TAIL_SLACK_MIB ))
IMAGE_BYTES=$((IMAGE_MIB * MIB_BYTES))
HEAD_SECTORS=$((LOADER_START_SECTOR + LOADER_SIZE_SECTORS))
HEAD_BYTES=$((HEAD_SECTORS * SECTOR_SIZE))
# Where RFCT-351 found the stale word: inside boot-a, at the offset the kernel
# image occupies in that partition.
INCIDENT_AT=$((BOOT_A_OFFSET_BYTES + 0x1e87800))

mos_image() {
    local path="$1"
    truncate -s "${IMAGE_BYTES}" "${path}"
    # Recognisable content at the offsets the layout names, so that a
    # comparison over this image compares something.
    printf 'RKNS' | dd of="${path}" bs=1 seek=$((LOADER_START_SECTOR * SECTOR_SIZE)) \
        conv=notrunc status=none
    printf 'uenv-a' | dd of="${path}" bs=1 seek="${UENV_A_OFFSET_BYTES}" conv=notrunc status=none
    printf 'boot-a' | dd of="${path}" bs=1 seek="${BOOT_A_OFFSET_BYTES}" conv=notrunc status=none
    printf '\xd4\x21\x00\x00' | dd of="${path}" bs=1 seek="${INCIDENT_AT}" conv=notrunc status=none
    printf 'rootfs-a' | dd of="${path}" bs=1 seek="${ROOTFS_A_OFFSET_BYTES}" conv=notrunc status=none
}

# One `make flash-mos` run against a fresh medium. Prints the log; returns the
# recipe's status in RUN_RC.
RUN_RC=0
run_flash_mos() {
    local image="$1" hole_at="${2:-}"
    RK_LOG="${work}/log.txt"
    : > "${RK_LOG}"
    RK_DEVICE="${work}/emmc.img"
    rm -f "${RK_DEVICE}"
    truncate -s 0 "${RK_DEVICE}"
    RUN_RC=0
    RK_LOG="${RK_LOG}" RK_DEVICE="${RK_DEVICE}" RK_HOLE_FILE="${HOLE_FILE}" \
    RK_HOLE_AT="${hole_at}" \
        make -s -C "${BSP_DIR}" flash-mos \
            RKDEVELOPTOOL="${STUB}" MOS_IMAGE="${image}" \
            > "${work}/out.txt" 2> "${work}/err.txt" || RUN_RC=$?
}

log_line() { sed -n "$1p" "${work}/log.txt"; }
log_count() { grep -c '' "${work}/log.txt" || true; }

echo "=== 1. the argv the recipes build, and where the default image comes from"

# 1a. The default MOS_IMAGE is resolved from board.env, not written a second
# time in the Makefile: change IMAGE_LATEST_NAME and this moves with it.
dry="$(make -s -n -C "${BSP_DIR}" flash-mos RKDEVELOPTOOL=rkdeveloptool)"
if printf '%s\n' "${dry}" | grep -cF "wl 0 ../../../_out/cx3576/${IMAGE_LATEST_NAME}" >/dev/null; then
    pass "flash-mos writes _out/cx3576/${IMAGE_LATEST_NAME}, the name board.env declares"
else
    fail "flash-mos does not write _out/cx3576/${IMAGE_LATEST_NAME}; it runs: $(printf '%s' "${dry}" | tr '\n' ' ')"
fi

# 1b. Distinct from BSP_OUT. RFCT-343 separated the bsp SOURCE directory, the
# bsp OUTPUT directory and the top-level image output; a flash-mos that reached
# into _out/boards/cx3576 would have re-conflated two of them.
if printf '%s\n' "${dry}" | grep -cF "_out/boards/cx3576" >/dev/null; then
    fail "flash-mos names _out/boards/cx3576 (BSP_OUT); the product image is not the BSP's output"
else
    pass "flash-mos does not reach into BSP_OUT: the product image and the BSP output stay distinct"
fi

echo
echo "=== 2. a faithful flash: the whole image is read back and compared"

IMG="${work}/cx3576-mos-fixture.img"
mos_image "${IMG}"
run_flash_mos "${IMG}"

if [ "${RUN_RC}" -eq 0 ]; then
    pass "a faithful write verifies green (make flash-mos exited 0)"
else
    fail "a faithful write did not verify: make exited ${RUN_RC}; $(tail -n 3 "${work}/err.txt" | tr '\n' ' ')"
fi

SCRATCH="${work}/.verify-flash.img"
if [ -e "${SCRATCH}" ]; then
    fail "the read-back ${SCRATCH} survived a green run"
else
    pass "the read-back is deleted when the comparison passes"
fi

# The four calls, in order, with their arguments.
expected_1="wl 0 ${IMG}"
expected_4="rd"
if [ "$(log_count)" -eq 4 ] && [ "$(log_line 1)" = "${expected_1}" ] && [ "$(log_line 4)" = "${expected_4}" ]; then
    pass "the run is exactly write, two read-backs, reset -- in that order"
else
    fail "the run was: $(tr '\n' '|' < "${work}/log.txt")"
fi

read -r _verb head_begin head_count _file <<<"$(log_line 2)"
read -r _verb tail_begin tail_count _file <<<"$(log_line 3)"

# 2a. The head window is board.env's, three independent ways. A constant that
# moves in the layout and not here fails this.
head_from_mib=$((IMAGE_HEAD_MIB * MIB_BYTES / SECTOR_SIZE))
if [ "${head_begin}" = "0" ] && [ "${head_count}" = "${HEAD_SECTORS}" ] \
   && [ "${HEAD_SECTORS}" -eq "${UENV_A_START_SECTOR}" ] \
   && [ "${HEAD_SECTORS}" -eq "${head_from_mib}" ]; then
    pass "the first read-back is sectors 0..$((HEAD_SECTORS - 1)): LOADER_START_SECTOR+LOADER_SIZE_SECTORS = UENV_A_START_SECTOR = IMAGE_HEAD_MIB*MIB_BYTES/SECTOR_SIZE = ${HEAD_SECTORS}"
else
    fail "the first read-back is 'rl ${head_begin} ${head_count}', and board.env derives the head area three ways as ${HEAD_SECTORS}/${UENV_A_START_SECTOR}/${head_from_mib}"
fi

# 2b. The second read starts where the first stopped and ends at the last
# sector of the file: no gap, no overshoot.
image_sectors=$(( (IMAGE_BYTES + SECTOR_SIZE - 1) / SECTOR_SIZE ))
if [ "${tail_begin}" = "${HEAD_SECTORS}" ] \
   && [ "$((tail_begin + tail_count))" -eq "${image_sectors}" ]; then
    pass "the second read-back continues at sector ${tail_begin} and ends at ${image_sectors}, the last sector of a ${IMAGE_BYTES}-byte image"
else
    fail "the second read-back is 'rl ${tail_begin} ${tail_count}'; expected begin ${HEAD_SECTORS} and end ${image_sectors}"
fi

# 2c. The two ranges together are the file, which is the whole claim.
covered=$(( (head_count + tail_count) * SECTOR_SIZE ))
if [ "${covered}" -ge "${IMAGE_BYTES}" ] && [ "$((covered - IMAGE_BYTES))" -lt "${SECTOR_SIZE}" ]; then
    pass "the read-backs cover ${covered} bytes for a ${IMAGE_BYTES}-byte image: the whole file, rounded up to a sector"
else
    fail "the read-backs cover ${covered} bytes of a ${IMAGE_BYTES}-byte image"
fi

echo
echo "=== 3. every partition the board reads is inside the verified range"

# 3a. Walk the layout. A partition whose bytes fall outside the range that is
# read back is a partition this check cannot see -- which is exactly what
# happened.
outside=""
for part in ${LAYOUT_PARTITIONS}; do
    eval "off=\${${part}_OFFSET_BYTES:-}"
    eval "start_sector=\${${part}_START_SECTOR:-}"
    if [ -z "${off}" ] && [ -n "${start_sector}" ]; then
        off=$((start_sector * SECTOR_SIZE))
    fi
    [ -n "${off}" ] || continue
    if [ "${off}" -ge "${covered}" ]; then
        outside="${outside} ${part}@${off}"
    fi
done
if [ -z "${outside}" ]; then
    pass "every partition in LAYOUT_PARTITIONS with a fixed offset starts inside the ${covered} bytes read back"
else
    fail "these partitions start past the verified range:${outside}"
fi

# 3b. The same walk against the window this replaced. Without this the check
# above would pass on a suite that had never been able to fail.
old_window=16777216
old_outside=""
for part in ${LAYOUT_PARTITIONS}; do
    eval "off=\${${part}_OFFSET_BYTES:-}"
    [ -n "${off}" ] || continue
    if [ "${off}" -ge "${old_window}" ]; then
        old_outside="${old_outside} ${part}"
    fi
done
if [ -n "${old_outside}" ]; then
    pass "the 16 MiB window this replaced left these outside it, so the widening is what closes the gap:${old_outside}"
else
    fail "the 16 MiB window already covered every partition, which would make this whole change pointless -- the layout must have moved"
fi

echo
echo "=== 4. the incident: a write that succeeds and leaves a hole"

run_flash_mos "${IMG}" "${INCIDENT_AT}"

if [ "${RUN_RC}" -ne 0 ]; then
    pass "eight stale bytes at ${INCIDENT_AT} (boot-a + 0x1e87800) turn the flash red (exit ${RUN_RC})"
else
    fail "the flash reported success with the previous build's bytes at ${INCIDENT_AT} -- the failure of RFCT-351, unchanged"
fi

if grep -cxF 'rd' "${work}/log.txt" >/dev/null; then
    fail "'rkdeveloptool rd' ran after the comparison failed; the board would have been reset into the bad image"
else
    pass "'rd' does not run when the comparison fails: the board stays in loader mode, where a re-write is one command away"
fi

if grep -cF "first difference at image byte ${INCIDENT_AT}" "${work}/err.txt" >/dev/null; then
    pass "the failure names the absolute image byte ${INCIDENT_AT}, not an offset into the second read"
else
    fail "the failure does not name image byte ${INCIDENT_AT}: $(tr '\n' ' ' < "${work}/err.txt")"
fi

if [ -e "${SCRATCH}" ]; then
    pass "the board's copy is kept at ${SCRATCH} when the comparison fails"
else
    fail "the read-back was deleted after a failure; the only evidence of what the medium holds is gone"
fi

# 4a. The same medium, judged by the check this replaced. This is what makes
# the three results above attributable: the bytes were always there.
if head -c "${old_window}" "${IMG}" | cmp -s - <(head -c "${old_window}" "${work}/emmc.img"); then
    pass "the 16 MiB read-back passes on this same medium -- it could not see the hole, and that is the defect"
else
    fail "the 16 MiB read-back also fails here, so this fixture does not reproduce the incident"
fi
rm -f "${SCRATCH}"

echo
echo "=== 5. the boot area is read first, and on its own"

run_flash_mos "${IMG}" 8192
if [ "${RUN_RC}" -ne 0 ] && [ "$(log_count)" -eq 2 ]; then
    pass "a hole inside the loader fails on the first read-back; the second never runs and the image is not pulled back over USB to learn it"
else
    fail "a hole at byte 8192 gave exit ${RUN_RC} after $(log_count) calls: $(tr '\n' '|' < "${work}/log.txt")"
fi
rm -f "${SCRATCH}"

echo
echo "=== 6. the arithmetic's edges, and the refusals"

direct() {
    RUN_RC=0
    RK_LOG="${work}/log.txt"
    : > "${RK_LOG}"
    RK_DEVICE="${work}/emmc.img"
    RK_LOG="${RK_LOG}" RK_DEVICE="${RK_DEVICE}" RK_HOLE_FILE="${HOLE_FILE}" \
    RKDEVELOPTOOL="${STUB}" \
        bash "${BSP_DIR}/scripts/verify-flash.sh" "$1" \
            > "${work}/out.txt" 2> "${work}/err.txt" || RUN_RC=$?
}

# 6a. An image that is not a whole number of sectors. The request must round
# UP, and the comparison must stop at the end of the FILE -- the tail of the
# last sector was never written by this flash.
ODD="${work}/odd.img"
truncate -s $((HEAD_BYTES + 1000)) "${ODD}"
printf 'tail' | dd of="${ODD}" bs=1 seek=$((HEAD_BYTES + 900)) conv=notrunc status=none
cp "${ODD}" "${work}/emmc.img"
# The medium holds a whole sector; what is past the file is not the flash's.
printf '\xff\xff\xff\xff' | dd of="${work}/emmc.img" bs=1 seek=$((HEAD_BYTES + 1010)) \
    conv=notrunc status=none
truncate -s $((HEAD_BYTES + SECTOR_SIZE * 2)) "${work}/emmc.img"
direct "${ODD}"
read -r _verb _begin odd_count _file <<<"$(log_line 2)"
if [ "${RUN_RC}" -eq 0 ] && [ "${odd_count}" = "2" ]; then
    pass "an image ${HEAD_BYTES}+1000 bytes long reads back 2 sectors and compares 1000 bytes: the request rounds up, the comparison does not"
else
    fail "the odd-sized image gave exit ${RUN_RC} with a tail read of '${odd_count}' sectors (expected 2)"
fi
rm -f "${work}/.verify-flash.img"

# 6b. Too small to be one of this board's images.
truncate -s "${HEAD_BYTES}" "${work}/tiny.img"
direct "${work}/tiny.img"
if [ "${RUN_RC}" -ne 0 ] && [ "$(log_count)" -eq 0 ] \
   && grep -cF "not larger than the ${HEAD_BYTES}-byte head area" "${work}/err.txt" >/dev/null; then
    pass "an image no larger than the head area is refused by name, before any read-back"
else
    fail "a ${HEAD_BYTES}-byte image gave exit ${RUN_RC} after $(log_count) calls: $(tr '\n' ' ' < "${work}/err.txt")"
fi

# 6c. No image at all.
direct "${work}/nothing.img"
if [ "${RUN_RC}" -ne 0 ] && grep -cF "no image at" "${work}/err.txt" >/dev/null; then
    pass "a missing image is refused by name rather than verifying a board against nothing"
else
    fail "a missing image gave exit ${RUN_RC}: $(tr '\n' ' ' < "${work}/err.txt")"
fi

echo
echo "=== 7. the head-window guard fires when the layout disagrees with itself"

# The three derivations of the head area are checked at run time. Mutate one of
# them in a copy of the layout and the script must refuse: a guard whose
# removal changes nothing is not a guard.
mkdir -p "${work}/fake/bsp/scripts"
sed 's/^UENV_A_START_SECTOR=.*/UENV_A_START_SECTOR=40960/' "${LAYOUT_ENV}" \
    > "${work}/fake/board.env"
cp "${BSP_DIR}/scripts/verify-flash.sh" "${work}/fake/bsp/scripts/verify-flash.sh"
# A FAITHFUL medium, so that the only thing that can turn this red is the
# refusal: with the guard gone the copy verifies green and this case fails on
# both of its clauses rather than on a leftover from the case before it.
cp "${IMG}" "${work}/emmc.img"
RUN_RC=0
RK_LOG="${work}/log.txt" RK_DEVICE="${work}/emmc.img" RKDEVELOPTOOL="${STUB}" \
    bash "${work}/fake/bsp/scripts/verify-flash.sh" "${IMG}" \
        > "${work}/out.txt" 2> "${work}/err.txt" || RUN_RC=$?
if [ "${RUN_RC}" -ne 0 ] && grep -cF "disagrees with itself about where the head area ends" "${work}/err.txt" >/dev/null; then
    pass "a layout whose UENV_A_START_SECTOR no longer follows the loader is refused, not read back at a window nothing justifies"
else
    fail "a mutated layout gave exit ${RUN_RC}: $(tr '\n' ' ' < "${work}/err.txt")"
fi

echo
echo "=== 8. the Alpine BSP image is verified the same way"

BSP_TMP="${work}/bsp-out"
mkdir -p "${BSP_TMP}"
truncate -s $((32 * MIB_BYTES)) "${BSP_TMP}/disk.img"
printf 'RKNS' | dd of="${BSP_TMP}/disk.img" bs=1 seek=$((LOADER_START_SECTOR * SECTOR_SIZE)) \
    conv=notrunc status=none
RK_LOG="${work}/log.txt"
: > "${RK_LOG}"
RK_DEVICE="${work}/emmc.img"
truncate -s 0 "${RK_DEVICE}"
RUN_RC=0
RK_LOG="${RK_LOG}" RK_DEVICE="${RK_DEVICE}" RK_HOLE_FILE="${HOLE_FILE}" \
    make -s -C "${BSP_DIR}" flash RKDEVELOPTOOL="${STUB}" BSP_OUT="${BSP_TMP}" \
        > "${work}/out.txt" 2> "${work}/err.txt" || RUN_RC=$?
read -r _verb bsp_begin bsp_count _file <<<"$(log_line 3)"
if [ "${RUN_RC}" -eq 0 ] && [ "$(log_count)" -eq 4 ] \
   && [ "$((bsp_begin + bsp_count))" -eq $((32 * MIB_BYTES / SECTOR_SIZE)) ]; then
    pass "make flash reads back all 32 MiB of its own image, not the first 16"
else
    fail "make flash gave exit ${RUN_RC} with $(log_count) calls, tail read ${bsp_begin}+${bsp_count}: $(tr '\n' '|' < "${work}/log.txt")"
fi

echo
total=$((pass_count + fail_count))
if [ "${fail_count}" -eq 0 ]; then
    echo "RESULT: PASS (${pass_count}/${total} checks)"
else
    echo "RESULT: FAIL (${pass_count} passed, ${fail_count} failed)"
    exit 1
fi
