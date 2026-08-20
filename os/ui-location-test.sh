#!/usr/bin/env bash
# Negative tests for the custom-UI location assertions in os/verify-image-v2.sh
# (docs/design/api.md section 5.2: a customer's UI bundles live at /srv/ui, on
# DATA, with no bind and no seed unit).
#
#   bash os/ui-location-test.sh
#
# WHY THIS EXISTS. `make os-verify-cx3576-v2` runs those assertions against the
# assembled image and they pass. That is one direction. An assertion nobody has
# ever seen FAIL proves nothing about the image -- it is equally consistent with
# an assertion that cannot fail at all, which is precisely the defect this file
# is guarding against elsewhere: the three checks section 5.2 leans on are about
# /srv AS A PARTITION and would go on passing after somebody moved the UI root
# to /var/lib. So each assertion is driven here against an input in which its
# fact is FALSE, and each is required to fail -- and to fail with ITS OWN
# message, because an assertion that fires for an unrelated reason is not the
# assertion under test.
#
# HOW. The REAL os/verify-image-v2.sh is run, once per case, with
# MOS_VERIFY_FIXTURE_ROOT pointing at a fixture directory standing in for the
# unpacked read-only root. Nothing is reimplemented here; a reimplementation
# would be testing this file's idea of the assertion rather than the assertion.
#
# The baseline fixture is not hand-written either: it is the SHIPPED
# os/rootfs/overlay-v2/etc/fstab.in rendered with the SHIPPED
# os/layout/cx3576-v2.env, exactly as os/rootfs/build-v2.sh renders it, with one
# directory per mountpoint the rendered file names. Every case then MUTATES that
# baseline. Mutating an fstab this script had authored would prove only that the
# script can spell.
#
# No root, no image, no docker, nothing outside a temp dir. It fails loudly when
# it cannot run rather than skipping.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER="${HERE}/verify-image-v2.sh"
FSTAB_IN="${HERE}/rootfs/overlay-v2/etc/fstab.in"
LAYOUT_ENV="${HERE}/layout/cx3576-v2.env"

for required in "${VERIFIER}" "${FSTAB_IN}" "${LAYOUT_ENV}"; do
    [ -f "${required}" ] || { echo "error: ${required} not found" >&2; exit 1; }
done
# shellcheck source=layout/cx3576-v2.env
. "${LAYOUT_ENV}"
for key in DATA_GUID STATE_GUID EPHEMERAL_GUID META_GUID; do
    eval "value=\${$key:-}"
    [ -n "${value}" ] || { echo "error: ${LAYOUT_ENV} is missing ${key}" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $*"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $*"; }

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# The /srv entry as os/rootfs/build-v2.sh:165 spells it. Tabs are literal, as
# they are there.
SRV_LINE="PARTUUID=$(lower "${DATA_GUID}")	/srv	ext4	noatime,x-systemd.growfs	0	2"

# Renders the shipped template into ${1}/etc/fstab and creates one directory per
# mountpoint it names -- the packed read-only root's own contract, since nothing
# can create a mountpoint at runtime on a verity root.
new_fixture() {
    local dir="$1"
    rm -rf "${dir}"
    mkdir -p "${dir}/etc"
    sed -e "s|@SRV_LINE@|${SRV_LINE}|g" \
        -e "s|@STATE_GUID@|$(lower "${STATE_GUID}")|g" \
        -e "s|@META_GUID@|$(lower "${META_GUID}")|g" \
        -e "s|@EPHEMERAL_GUID@|$(lower "${EPHEMERAL_GUID}")|g" \
        -e "s|@VAR_OPTS@|noatime|g" \
        "${FSTAB_IN}" >"${dir}/etc/fstab"
    if grep -q '@[A-Z_]\+@' "${dir}/etc/fstab"; then
        echo "error: unrendered placeholder left in the fixture fstab; ${FSTAB_IN} has grown a placeholder this test does not render" >&2
        exit 1
    fi
    local mnt
    while read -r mnt; do
        mkdir -p "${dir}${mnt}"
    done < <(awk '$0 !~ /^[[:space:]]*#/ && NF >= 4 && $2 ~ /^\// {print $2}' "${dir}/etc/fstab")
}

# Rewrites the fstab line whose mountpoint is $2 in fixture $1, replacing the
# whole line with $3. Fails loudly if there was no such line: a mutation that
# silently changed nothing would make the case below pass for free.
replace_mount_line() {
    local dir="$1" mnt="$2" new="$3" fstab="$1/etc/fstab"
    awk -v m="${mnt}" 'BEGIN { n = 0 } $0 !~ /^[[:space:]]*#/ && $2 == m { n++ } END { exit n == 1 ? 0 : 1 }' \
        "${fstab}" ||
        { echo "error: fixture fstab has no single ${mnt} entry to mutate" >&2; exit 1; }
    awk -v m="${mnt}" -v r="${new}" '$0 !~ /^[[:space:]]*#/ && $2 == m { print r; next } { print }' \
        "${fstab}" >"${fstab}.new"
    mv "${fstab}.new" "${fstab}"
}

# Runs the REAL verifier against fixture $1 and leaves its output in ${WORK}/out
# and its exit status in ${RC}.
run_verifier() {
    RC=0
    MOS_VERIFY_FIXTURE_ROOT="$1" bash "${VERIFIER}" >"${WORK}/out" 2>&1 || RC=$?
}

# The positive control. Six assertions, all passing, exit 0.
expect_all_pass() {
    local name="$1" got_pass got_fail
    run_verifier "${FIX}"
    got_pass="$(grep -c '^PASS:' "${WORK}/out" || true)"
    got_fail="$(grep -c '^FAIL:' "${WORK}/out" || true)"
    if [ "${RC}" -eq 0 ] && [ "${got_fail}" -eq 0 ] && [ "${got_pass}" -eq 6 ]; then
        pass "${name}: 6 assertions, all pass, exit 0"
    else
        fail "${name}: expected 6 PASS / 0 FAIL / exit 0, got ${got_pass} PASS / ${got_fail} FAIL / exit ${RC}"
        sed 's/^/    | /' "${WORK}/out"
    fi
}

# The negative direction. $2 is how many assertions must fire -- stated rather
# than inferred, since two substrings can legitimately belong to one message --
# and every remaining argument is a substring that must appear in a FAIL line.
# An EXTRA assertion firing is a failure of this test, not a bonus. Matching the
# message rather than only the exit status is the whole point: an assertion that
# fired for an unrelated reason is not the assertion under test.
expect_fail() {
    local name="$1" want="$2"
    shift 2
    local got_fail pat unmatched=0
    run_verifier "${FIX}"
    got_fail="$(grep -c '^FAIL:' "${WORK}/out" || true)"
    for pat in "$@"; do
        grep -F -- "${pat}" "${WORK}/out" | grep -q '^FAIL:' || {
            unmatched=1
            echo "    | no FAIL line contains: ${pat}"
        }
    done
    if [ "${RC}" -ne 0 ] && [ "${got_fail}" -eq "${want}" ] && [ "${unmatched}" -eq 0 ]; then
        pass "${name}: ${want} assertion(s) fail, each with its own message, exit ${RC}"
        grep '^FAIL:' "${WORK}/out" | sed 's/^/    | /'
    else
        fail "${name}: expected ${want} FAIL line(s) and a non-zero exit, got ${got_fail} FAIL / exit ${RC}"
        sed 's/^/    | /' "${WORK}/out"
    fi
}

echo "verifier under test: ${VERIFIER}"
echo "fixture fstab rendered from: ${FSTAB_IN}"
echo

# --- 0. positive control ----------------------------------------------------
# Without this the negatives below could all be passing because the fixture is
# malformed in some way that has nothing to do with the mutation.
FIX="${WORK}/baseline"
new_fixture "${FIX}"
expect_all_pass "baseline: shipped fstab, shipped mountpoints, no /srv/ui"

# --- 1. the UI root moved onto EPHEMERAL ------------------------------------
# The tidy-looking mistake: /var is writable, it is small, and nothing about a
# UI says "precious". Every custom UI would vanish at the first wipe.
FIX="${WORK}/on-ephemeral"
new_fixture "${FIX}"
replace_mount_line "${FIX}" /srv "PARTUUID=$(lower "${EPHEMERAL_GUID}")	/srv	ext4	noatime,x-systemd.growfs	0	2"
expect_fail "/srv mounted from the EPHEMERAL GUID" 2 \
    "moved off DATA: /srv/ui resolves under mountpoint /srv" \
    "moved onto the wipeable /var partition: /srv/ui is governed by /srv"

# --- 2. the UI root moved onto STATE ----------------------------------------
FIX="${WORK}/on-state"
new_fixture "${FIX}"
replace_mount_line "${FIX}" /srv "PARTUUID=$(lower "${STATE_GUID}")	/srv	ext4	noatime	0	2"
expect_fail "/srv mounted from the STATE GUID" 3 \
    "moved off DATA: /srv/ui resolves under mountpoint /srv" \
    "moved onto STATE: /srv/ui is governed by /srv" \
    "fixed ceiling: the entry governing /srv/ui (/srv) lacks x-systemd.growfs"

# --- 3. growth removed ------------------------------------------------------
# Still DATA, still a real mountpoint: only the ceiling changed, which is the
# one thing section 5.2 says a bundle root must not have.
FIX="${WORK}/no-growfs"
new_fixture "${FIX}"
replace_mount_line "${FIX}" /srv "PARTUUID=$(lower "${DATA_GUID}")	/srv	ext4	noatime	0	2"
expect_fail "the /srv entry stripped of x-systemd.growfs" 1 \
    "fixed ceiling: the entry governing /srv/ui (/srv) lacks x-systemd.growfs"

# --- 4. the mountpoint missing, which must NOT fire a UI assertion ----------
# Assertion 4 is CHAINED: it asserts the covering mountpoint is one the
# packed-root mountpoint check already covers, and lets that check own whether
# the directory is there. So removing /srv from the fixture tree must leave all
# six passing -- os/verify-image-v2.sh's own mountpoint loop is what fails on a
# real image, and a UI assertion that also failed here would be the parallel
# copy this design exists to avoid. This case is the proof of the chain.
FIX="${WORK}/no-mountpoint"
new_fixture "${FIX}"
rmdir "${FIX}/srv"
expect_all_pass "/srv absent from the tree: existence is chained, not re-derived"

# --- 5a. the bare /srv/ui directory SHIPPED in the packed root --------------
FIX="${WORK}/ships-dir"
new_fixture "${FIX}"
mkdir -p "${FIX}/srv/ui"
expect_fail "the bare /srv/ui directory shipped inside the read-only root" 1 \
    "the packed read-only root ships /srv/ui"

# --- 5b. CONTENT baked under /srv/ui ----------------------------------------
# The broader half, and the one that matters: a bundle baked into the image
# sits on the read-only squashfs, where it either silently wins over the copy
# an operator installed or silently never updates when that copy changes.
# Neither raises an error anywhere, which is why the image has to refuse it.
FIX="${WORK}/ships-content"
new_fixture "${FIX}"
mkdir -p "${FIX}/srv/ui/bundles/1"
: >"${FIX}/srv/ui/bundles/1/index.html"
expect_fail "a UI bundle baked under /srv/ui in the read-only root" 1 \
    "/srv/ui/bundles/1/index.html" \
    "silently WINS over the bundle an operator installed or silently NEVER UPDATES"

# --- 6. a deeper mountpoint covering /srv/ui --------------------------------
# This is what proves the covering entry is DERIVED and not hardcoded to /srv:
# /srv stays correct and untouched, and the checks must still follow /srv/ui
# onto the partition that actually governs it. The reported mountpoint has to
# be /srv/ui, not /srv.
FIX="${WORK}/deeper-mount"
new_fixture "${FIX}"
printf 'PARTUUID=%s\t/srv/ui\text4\tnoatime,x-systemd.growfs\t0\t2\n' \
    "$(lower "${EPHEMERAL_GUID}")" >>"${FIX}/etc/fstab"
expect_fail "/srv correct but a deeper /srv/ui entry on EPHEMERAL" 3 \
    "resolves under mountpoint /srv/ui" \
    "moved onto the wipeable /var partition: /srv/ui is governed by /srv/ui" \
    "under an unasserted mountpoint: /srv/ui is governed by /srv/ui, which is NOT in the set"

# --- 7. nothing covers the UI root at all -----------------------------------
# The root is deliberately absent from fstab, so removing /srv leaves /srv/ui
# on the verity squashfs with no entry that could ever cover it.
FIX="${WORK}/uncovered"
new_fixture "${FIX}"
awk '$0 ~ /^[[:space:]]*#/ || $2 != "/srv" { print }' "${FIX}/etc/fstab" >"${FIX}/etc/fstab.new"
mv "${FIX}/etc/fstab.new" "${FIX}/etc/fstab"
rmdir "${FIX}/srv"
expect_fail "no fstab entry covering /srv/ui" 1 \
    "NO filesystem under it: no /etc/fstab entry covers /srv/ui"

echo
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} cases)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} cases)"
    exit 1
fi
