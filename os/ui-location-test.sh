#!/usr/bin/env bash
# Negative tests for the assertions os/verify-image-v2.sh runs in fixture mode:
# the custom-UI location (docs/design/api.md section 5.2 -- a customer's UI
# bundles live at /srv/ui, on DATA, with no bind and no seed unit), section
# 6.2's built-in escape as an on-image fact, and the packed-root mountpoint
# check that the first of those CHAINS to.
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
# os/layout/cx3576-v2.env, exactly as os/rootfs/build-v2.sh renders it, plus the
# directories and the binary stand-in new_fixture documents below -- every one
# of them derived from the verifier's own constants. Every case then MUTATES
# that baseline. Mutating an fstab this script had authored would prove only
# that the script can spell.
#
# WHAT EACH CASE ASSERTS, AND WHY IT IS NOT A COUNT. Every case names the
# assertions it expects to have run, BY IDENTITY, and the harness diffs that set
# against the set that actually ran. It does not count PASS lines and it does
# not settle for absence-of-failure. Both of those are invariant under a run in
# which the assertions never executed at all -- and this file has a case,
# "/srv absent from the tree", whose entire content is that six assertions still
# PASSED. Under a count that case survives the count being wrong; under
# absence-of-failure it survives the assertions not running. Under an identity
# diff it survives neither, and the next task to widen fixture mode adds a name
# to ASSERTIONS below instead of editing a number that was always going to
# break.
#
# No root, no image, no docker, nothing outside a temp dir. It fails loudly when
# it cannot run rather than skipping.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER="${HERE}/verify-image-v2.sh"
FSTAB_IN="${HERE}/rootfs/overlay-v2/etc/fstab.in"
LAYOUT_ENV="${HERE}/layout/cx3576-v2.env"
# The SHIPPED unit, not one this script authors: the ordering assertions exist
# to catch the shipped file losing its ordering, and a fixture built from a
# local copy would go on passing after the real unit changed.
LED_UNIT_SRC="${HERE}/rootfs/overlay-v2/usr/lib/systemd/system/mos-status-led.service"

for required in "${VERIFIER}" "${FSTAB_IN}" "${LAYOUT_ENV}" "${LED_UNIT_SRC}"; do
    [ -f "${required}" ] || { echo "error: ${required} not found" >&2; exit 1; }
done
# shellcheck source=layout/cx3576-v2.env
. "${LAYOUT_ENV}"
for key in DATA_GUID STATE_GUID EPHEMERAL_GUID META_GUID; do
    eval "value=\${$key:-}"
    [ -n "${value}" ] || { echo "error: ${LAYOUT_ENV} is missing ${key}" >&2; exit 1; }
done

# Read out of the verifier rather than restated here. A fixture built from this
# file's own idea of the reserved prefix, the binary path or the mountpoint set
# would test that idea and not the verifier's; the same reason the fstab below
# is rendered from the SHIPPED template rather than hand-written.
verifier_const() {
    local name="$1" quote="$2" value
    value="$(sed -n "s/^${name}=${quote}\(.*\)${quote}\$/\1/p" "${VERIFIER}")"
    [ -n "${value}" ] || {
        echo "error: ${VERIFIER} no longer defines ${name}; this test cannot build a fixture without it" >&2
        exit 1
    }
    printf '%s' "${value}"
}
BUILTIN_PREFIX="$(verifier_const BUILTIN_PREFIX '"')"
BUILTIN_MARKUP="$(verifier_const BUILTIN_MARKUP "'")"
APID_BIN="$(verifier_const APID_BIN '"')"
PACKED_MOUNTPOINTS="$(verifier_const PACKED_MOUNTPOINTS '"')"
# PLAN-011 D5's writable unit directory, read out of the verifier for the same
# reason as the rest -- and here it doubles as a cross-check. new_fixture builds
# the tree from PACKED_MOUNTPOINTS; the case below removes the directory this
# names. While D5's constant and the packed set agree, that is the same
# directory. The day they drift apart the rmdir finds nothing to remove and dies
# under set -e, which is the loud failure -- a case whose mutation silently
# changed nothing would otherwise pass for free.
EXT_UNIT_DIR="$(verifier_const EXT_UNIT_DIR '"')"

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

# Renders the shipped template into ${1}/etc/fstab and builds the rest of the
# packed read-only root's own contract, since nothing can create any of it at
# runtime on a verity root:
#
#   * one directory per mountpoint the rendered fstab names;
#   * one directory per name in the verifier's PACKED_MOUNTPOINTS -- a superset,
#     because /home and /root are STATE binds owned by mount units and fstab
#     never names them;
#   * ${APID_BIN}, carrying the escape page's rendered markup, which is what
#     section 6.2 says the shipped binary is.
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
    for mnt in ${PACKED_MOUNTPOINTS}; do
        mkdir -p "${dir}${mnt}"
    done
    mkdir -p "${dir}$(dirname "${APID_BIN}")"
    printf 'ELF-stand-in%sELF-stand-in' "${BUILTIN_MARKUP}" >"${dir}${APID_BIN}"
    mkdir -p "${dir}/usr/lib/systemd/system" "${dir}/usr/lib/mos" \
        "${dir}/etc/systemd/system/multi-user.target.wants"
    cp "${LED_UNIT_SRC}" "${dir}/usr/lib/systemd/system/mos-status-led.service"
    printf '#!/bin/sh\n' >"${dir}/usr/lib/mos/mos-status-led"
    ln -sf /usr/lib/systemd/system/mos-status-led.service \
        "${dir}/etc/systemd/system/multi-user.target.wants/mos-status-led.service"
}

# Drops the whole `Key=value` line from the fixture's status-LED unit. Fails
# loudly when the key is not there: a mutation that changed nothing would make
# its case pass for free, which is the failure this harness exists to prevent.
drop_led_directive() {
    local dir="$1" key="$2" unit="$1/usr/lib/systemd/system/mos-status-led.service"
    grep -Eq "^${key}=" "${unit}" ||
        { echo "error: fixture unit has no ${key}= line to drop" >&2; exit 1; }
    grep -Ev "^${key}=mos-health\.service$" "${unit}" >"${unit}.new"
    mv "${unit}.new" "${unit}"
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

# ---------------------------------------------------------------------------
# The expected set, by identity.
#
# One row per assertion fixture mode runs, as
#
#     key | substring identifying its PASS line | its FAIL line | baseline state
#
# An empty third field means the two directions share one substring, which is
# true of every assertion written in RFCT-073's "catches ..." register: the name
# is the same whichever way it went, and only the explanation after the colon
# differs. The packed-root mountpoint check predates that register and says two
# different things, so it spells both out -- and the FAIL substring is the one
# that gives it its first failing observation.
#
# The baseline state is what the UNMUTATED fixture must produce. It is PASS for
# everything except the no-covering-entry assertion, which only exists on
# check_ui_location's early-return path and can therefore never PASS: on that
# path the six that follow it do not run at all, and asserting them ABSENT is
# how this file states that the early return is real.
ASSERTIONS='
ui-off-data|catches a custom UI root moved off DATA||PASS
ui-on-state|catches a custom UI root moved onto STATE||PASS
ui-on-ephemeral|catches a custom UI root moved onto the wipeable /var partition||PASS
ui-unasserted-mountpoint|catches a custom UI root under an unasserted mountpoint||PASS
ui-fixed-ceiling|catches a custom UI root with a fixed ceiling||PASS
ui-content-baked|catches content baked under the custom UI root||PASS
ui-no-filesystem|catches a custom UI root with NO filesystem under it||ABSENT
builtin-on-disk|catches a built-in escape that has grown an on-disk half||PASS
builtin-in-binary|catches a built-in escape that is no longer inside the binary||PASS
mountpoints-exist|every fstab/bind mountpoint exists in the read-only root|mountpoint(s) missing from the read-only root|PASS
led-after-health|catches an indicator that reports ready before the slot is confirmed||PASS
led-requires-health|catches an indicator that turns blue on a slot whose health gate failed||PASS
dev-keyring|catches a baked-in RAUC keyring||PASS
'

# WHAT THIS REGISTER DOES NOT COVER, AND WHY IT IS A BOUNDARY RATHER THAN A GAP
# IN IT. PLAN-011 D5 added assertions to os/verify-image-v2.sh in two places
# that this file cannot reach:
#
#   * the extension mount unit -- its existence, its Where=, its What= being
#     under /mnt/state, and its enablement -- plus the negative guard that no
#     unit binds over /etc/systemd/system;
#   * the com.mos.ext.conf policy set -- the file's presence, the own_prefix
#     grant surviving comment-stripping, the widened own_prefix="com.mos", and
#     the unexpected-prefixes/own= check.
#
# All of them are written INLINE in the verifier's main body, and the fixture
# hook dispatches a fixed list of FUNCTIONS and then exits well above them.
# MOS_VERIFY_FIXTURE_ROOT therefore never reaches them: a fixture that violates
# every one at once still comes back RESULT: PASS, and forcing any of them to
# pass unconditionally leaves this file green. They cannot be driven from here
# no matter what a case does to a fixture, so no case pretends to.
#
# This is deliberately recorded rather than left to be rediscovered, because the
# absence looks identical to coverage from outside -- which is the same
# confusion the mountpoint case below exists to remove. Note that none of them
# needs an image: every read is ${ROOT}-relative and TMP is created before the
# hook, so the whole set is offline-CAPABLE and merely offline-UNREACHABLE.
# Hoisting each into a function named in the hook's dispatch list is all that is
# missing, and the hook's own comment already says that list "is expected to
# GROW". When it does, this file says which name it did not expect rather than
# silently changing a count -- so the rows go here at the same time, and this
# comment shrinks by exactly what they cover.

# Drives the verifier over ${FIX} and asserts the set of assertions that ran,
# by name and by direction.
#
#   expect_set "<case name>" "<overrides>" [<substring> ...]
#
# $2 is a space-separated list of key=PASS|FAIL|ABSENT deltas from the baseline
# states above; "" means the baseline unchanged. Every remaining argument is a
# substring that must appear in some FAIL line -- kept from the old harness,
# because identity says WHICH assertion fired and these say the message carried
# the right particulars.
#
# The exit status is DERIVED rather than stated: a case expecting any FAIL
# requires a non-zero exit and a case expecting none requires zero. That keeps
# the old control without a second thing to hand-maintain.
expect_set() {
    local name="$1" overrides="$2"
    shift 2

    local -A want=() got=() ppat=() fpat=()
    local key p f base row
    while IFS='|' read -r key p f base; do
        [ -n "${key}" ] || continue
        ppat["${key}"]="${p}"
        fpat["${key}"]="${f:-${p}}"
        want["${key}"]="${base}"
        got["${key}"]=ABSENT
    done <<<"${ASSERTIONS}"

    local over state
    for over in ${overrides}; do
        key="${over%%=*}"
        state="${over#*=}"
        [ -n "${ppat[${key}]:-}" ] || {
            echo "error: case '${name}' overrides unknown assertion '${key}'" >&2
            exit 1
        }
        want["${key}"]="${state}"
    done

    run_verifier "${FIX}"

    # Observe. Every PASS:/FAIL: line must resolve to exactly one key: zero
    # means fixture mode grew an assertion nobody named here, and more than one
    # means two names are not distinguishable and the diff below would be
    # meaningless either way.
    local line dir body hit n unknown=""
    while IFS= read -r line; do
        case "${line}" in
        "PASS: "*) dir=PASS; body="${line#PASS: }" ;;
        "FAIL: "*) dir=FAIL; body="${line#FAIL: }" ;;
        *) continue ;;
        esac
        hit=""
        n=0
        for key in "${!ppat[@]}"; do
            if [ "${dir}" = PASS ]; then p="${ppat[${key}]}"; else p="${fpat[${key}]}"; fi
            case "${body}" in *"${p}"*) hit="${key}"; n=$((n + 1)) ;; esac
        done
        if [ "${n}" -eq 1 ]; then
            got["${hit}"]="${dir}"
        elif [ "${n}" -eq 0 ]; then
            unknown="${unknown}
    | unnamed assertion ran: ${line}"
        else
            echo "error: '${line}' matches ${n} names in ASSERTIONS; the names are not distinguishable" >&2
            exit 1
        fi
    done <"${WORK}/out"

    # Diff.
    local missing="" unexpected="" wrong=""
    for key in "${!want[@]}"; do
        [ "${want[${key}]}" = "${got[${key}]}" ] && continue
        if [ "${got[${key}]}" = ABSENT ]; then
            missing="${missing} ${key}(expected ${want[${key}]})"
        elif [ "${want[${key}]}" = ABSENT ]; then
            unexpected="${unexpected} ${key}(${got[${key}]})"
        else
            wrong="${wrong} ${key}(expected ${want[${key}]}, got ${got[${key}]})"
        fi
    done

    local pat unmatched=""
    for pat in "$@"; do
        grep -F -- "${pat}" "${WORK}/out" | grep '^FAIL:' >/dev/null || unmatched="${unmatched}
    | no FAIL line contains: ${pat}"
    done

    # Derived exit status.
    local want_rc=0 rc_note=""
    for key in "${!want[@]}"; do
        [ "${want[${key}]}" = FAIL ] && want_rc=1
    done
    if [ "${want_rc}" -eq 0 ] && [ "${RC}" -ne 0 ]; then
        rc_note=" exit ${RC}, expected 0"
    elif [ "${want_rc}" -eq 1 ] && [ "${RC}" -eq 0 ]; then
        rc_note=" exit 0, expected non-zero"
    fi

    local failed="" fired=""
    for key in "${!want[@]}"; do
        [ "${want[${key}]}" = FAIL ] && fired="${fired} ${key}"
    done
    fired="$(printf '%s' "${fired# }" | tr ' ' '\n' | sort | tr '\n' ' ')"
    fired="${fired% }"

    if [ -n "${missing}${unexpected}${wrong}${unmatched}${unknown}${rc_note}" ]; then
        failed=1
    fi
    if [ -z "${failed}" ]; then
        if [ -z "${fired}" ]; then
            pass "${name}: every assertion ran in its baseline state, exit 0"
        else
            pass "${name}: exactly ${fired} failed, each with its own message, exit ${RC}"
            grep '^FAIL:' "${WORK}/out" | sed 's/^/    | /'
        fi
        return
    fi
    fail "${name}: the assertions that ran are not the ones expected"
    [ -z "${missing}" ] || echo "    | did not run:${missing}"
    [ -z "${unexpected}" ] || echo "    | ran but was not expected to:${unexpected}"
    [ -z "${wrong}" ] || echo "    | ran the wrong way:${wrong}"
    [ -z "${rc_note}" ] || echo "    |${rc_note}"
    [ -n "${unmatched}" ] && printf '%s\n' "${unmatched# }"
    [ -n "${unknown}" ] && printf '%s\n' "${unknown# }"
    sed 's/^/    | /' "${WORK}/out"
}

echo "verifier under test: ${VERIFIER}"
echo "fixture fstab rendered from: ${FSTAB_IN}"
echo

# --- 0. positive control ----------------------------------------------------
# Without this the negatives below could all be passing because the fixture is
# malformed in some way that has nothing to do with the mutation.
FIX="${WORK}/baseline"
new_fixture "${FIX}"
expect_set "baseline: shipped fstab, shipped mountpoints, no /srv/ui, apid carrying the escape page" ""

# --- 1. the UI root moved onto EPHEMERAL ------------------------------------
# The tidy-looking mistake: /var is writable, it is small, and nothing about a
# UI says "precious". Every custom UI would vanish at the first wipe.
FIX="${WORK}/on-ephemeral"
new_fixture "${FIX}"
replace_mount_line "${FIX}" /srv "PARTUUID=$(lower "${EPHEMERAL_GUID}")	/srv	ext4	noatime,x-systemd.growfs	0	2"
expect_set "/srv mounted from the EPHEMERAL GUID" "ui-off-data=FAIL ui-on-ephemeral=FAIL" \
    "moved off DATA: /srv/ui resolves under mountpoint /srv" \
    "moved onto the wipeable /var partition: /srv/ui is governed by /srv"

# --- 2. the UI root moved onto STATE ----------------------------------------
FIX="${WORK}/on-state"
new_fixture "${FIX}"
replace_mount_line "${FIX}" /srv "PARTUUID=$(lower "${STATE_GUID}")	/srv	ext4	noatime	0	2"
expect_set "/srv mounted from the STATE GUID" "ui-off-data=FAIL ui-on-state=FAIL ui-fixed-ceiling=FAIL" \
    "moved off DATA: /srv/ui resolves under mountpoint /srv" \
    "moved onto STATE: /srv/ui is governed by /srv" \
    "fixed ceiling: the entry governing /srv/ui (/srv) lacks x-systemd.growfs"

# --- 3. growth removed ------------------------------------------------------
# Still DATA, still a real mountpoint: only the ceiling changed, which is the
# one thing section 5.2 says a bundle root must not have.
FIX="${WORK}/no-growfs"
new_fixture "${FIX}"
replace_mount_line "${FIX}" /srv "PARTUUID=$(lower "${DATA_GUID}")	/srv	ext4	noatime	0	2"
expect_set "the /srv entry stripped of x-systemd.growfs" "ui-fixed-ceiling=FAIL" \
    "fixed ceiling: the entry governing /srv/ui (/srv) lacks x-systemd.growfs"

# --- 4. the mountpoint missing: the chain, and the far end of it ------------
# ui-unasserted-mountpoint is CHAINED: it asserts the covering mountpoint is one
# the packed-root mountpoint check already covers, and lets that check own
# whether the directory is there. So removing /srv from the fixture tree must
# leave all six UI assertions passing -- a UI assertion that also failed here
# would be the parallel copy this design exists to avoid.
#
# But six passes only prove the UI assertions do not RE-DERIVE existence. They
# do not prove anything still CATCHES a missing /srv, and from outside those two
# are the same picture. So fixture mode runs the check being delegated to as
# well, and this case requires it to go red with ITS OWN message. Before this,
# that loop had only ever been observed passing: it runs against real images,
# where /srv is always present. This is its first failing observation, and the
# proof of the chain is now the two halves together rather than an absence.
FIX="${WORK}/no-mountpoint"
new_fixture "${FIX}"
rmdir "${FIX}/srv"
expect_set "/srv absent from the tree: existence is chained, and the far end of the chain fires" \
    "mountpoints-exist=FAIL" \
    "mountpoint(s) missing from the read-only root: /srv"

# --- 4b. PLAN-011 D5's writable unit directory absent from the tree ----------
# The one M5 assertion this harness can reach, and it is reachable BY DESIGN:
# the D5 block declines to assert its own mountpoint's existence and delegates
# it to PACKED_MOUNTPOINTS instead, saying that "owning it there rather than
# here is what puts it inside the fixture hook, where os/ui-location-test.sh can
# watch it fail without an image". That sentence is a claim about this file, and
# until this case existed it was not true of it.
#
# Case 4 above already drives the mountpoint loop -- but only ever for /srv. A
# name ADDED to that set and never removed from a fixture is indistinguishable
# from a name the loop does not visit at all: both look like a green run. So
# this removes the D5 directory and nothing else, and the assertion is required
# to fail naming THAT path. The path in the message is the whole point; the
# shared "mountpoint(s) missing" wording alone would be satisfied by /srv.
#
# What it protects on the device: the pack stage creates this directory inside
# the verity squashfs, and a verity root cannot create one at runtime. Without
# it the bind has nowhere to land, so the writable unit directory silently is
# not writable and every unit an integrator installs is gone at the next boot.
FIX="${WORK}/no-ext-unit-dir"
new_fixture "${FIX}"
rmdir "${FIX}${EXT_UNIT_DIR}"
expect_set "PLAN-011 D5's ${EXT_UNIT_DIR} absent from the tree" \
    "mountpoints-exist=FAIL" \
    "mountpoint(s) missing from the read-only root: ${EXT_UNIT_DIR}"

# --- 5a. the bare /srv/ui directory SHIPPED in the packed root --------------
FIX="${WORK}/ships-dir"
new_fixture "${FIX}"
mkdir -p "${FIX}/srv/ui"
expect_set "the bare /srv/ui directory shipped inside the read-only root" "ui-content-baked=FAIL" \
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
expect_set "a UI bundle baked under /srv/ui in the read-only root" "ui-content-baked=FAIL" \
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
expect_set "/srv correct but a deeper /srv/ui entry on EPHEMERAL" \
    "ui-off-data=FAIL ui-on-ephemeral=FAIL ui-unasserted-mountpoint=FAIL" \
    "resolves under mountpoint /srv/ui" \
    "moved onto the wipeable /var partition: /srv/ui is governed by /srv/ui" \
    "under an unasserted mountpoint: /srv/ui is governed by /srv/ui, which is NOT in the set"

# --- 7. nothing covers the UI root at all -----------------------------------
# The root is deliberately absent from fstab, so removing /srv leaves /srv/ui
# on the verity squashfs with no entry that could ever cover it. The six that
# follow it are named ABSENT rather than left unstated: check_ui_location
# RETURNS on this path, and "did not run" is a different fact from "ran and
# passed" that only an identity diff can tell apart. /srv is removed from the
# tree here too, so the mountpoint check fires alongside.
FIX="${WORK}/uncovered"
new_fixture "${FIX}"
awk '$0 ~ /^[[:space:]]*#/ || $2 != "/srv" { print }' "${FIX}/etc/fstab" >"${FIX}/etc/fstab.new"
mv "${FIX}/etc/fstab.new" "${FIX}/etc/fstab"
rmdir "${FIX}/srv"
expect_set "no fstab entry covering /srv/ui" \
    "ui-no-filesystem=FAIL mountpoints-exist=FAIL ui-off-data=ABSENT ui-on-state=ABSENT \
     ui-on-ephemeral=ABSENT ui-unasserted-mountpoint=ABSENT ui-fixed-ceiling=ABSENT \
     ui-content-baked=ABSENT" \
    "NO filesystem under it: no /etc/fstab entry covers /srv/ui" \
    "mountpoint(s) missing from the read-only root: /srv"

# --- 8. something shipped at the reserved prefix ----------------------------
# Section 6.2's built-in UI is maud expansions inside /usr/bin/apid and nothing
# else, because section 6 requires the fallback to be the artifact with NO build
# chain. A file tree under the reserved prefix is a second artifact that has to
# be shipped in step with the binary, and the day it is stale the escape fails
# in exactly the situation it exists for.
FIX="${WORK}/builtin-on-disk"
new_fixture "${FIX}"
mkdir -p "${FIX}${BUILTIN_PREFIX}/assets"
: >"${FIX}${BUILTIN_PREFIX}/assets/app.js"
expect_set "an asset tree shipped at the reserved ${BUILTIN_PREFIX} prefix" "builtin-on-disk=FAIL" \
    "${BUILTIN_PREFIX}/assets/app.js"

# --- 9. the escape page no longer inside the binary -------------------------
# The image-side reading of section 6.2's "no include_str!, no include_bytes!,
# no asset directory": whatever mechanism moved the pages out to files, the
# rendered markup stops being in the shipped binary. Asserting the OUTCOME
# covers mechanisms nobody has thought of yet; enumerating the three named in
# 6.2 would not.
FIX="${WORK}/builtin-not-in-binary"
new_fixture "${FIX}"
printf 'ELF-stand-in-with-no-escape-page' >"${FIX}${APID_BIN}"
expect_set "an apid binary that no longer carries the escape page" "builtin-in-binary=FAIL" \
    "does NOT carry the escape page's rendered markup"

# --- 10. the indicator reordered off the health gate ------------------------
# The wrong-signal case, and the reason these two assertions exist at all. The
# indicator still ships, is still enabled and still works; it just turns blue
# at multi-user.target. Every other check here passes on that image, and the
# board reports ready while its slot is unconfirmed.
FIX="${WORK}/led-not-after-health"
new_fixture "${FIX}"
drop_led_directive "${FIX}" After
expect_set "a status indicator no longer ordered after the health gate" "led-after-health=FAIL" \
    "runs 'rauc status mark-good'"

# --- 11. ordered after the gate but not requiring it ------------------------
# The subtler half, and the one After= alone does not cover: with ordering but
# no requirement, systemd starts the unit once mos-health has FINISHED --
# including when it finished by failing. The board turns blue on precisely the
# slot U-Boot is about to roll back.
FIX="${WORK}/led-not-requiring-health"
new_fixture "${FIX}"
drop_led_directive "${FIX}" Requires
expect_set "a status indicator ordered after the health gate but not requiring it" "led-requires-health=FAIL" \
    "BOOT_x_LEFT counter is about to roll it back"

# --- 12. the unit dropped from the image ------------------------------------
# Both assertions read the unit, so removing the file fails them together and
# the case names both rather than trimming to the one it was written for.
FIX="${WORK}/led-unit-absent"
new_fixture "${FIX}"
rm -f "${FIX}/usr/lib/systemd/system/mos-status-led.service"
expect_set "the status-LED unit dropped from the image" \
    "led-after-health=FAIL led-requires-health=FAIL" \
    "runs 'rauc status mark-good'"

# --- 13. a RAUC keyring baked into the read-only root ------------------------
# The overlay path is gitignored so a developer CAN drop the dev CA in for
# local bundle testing — which is exactly why the packed root has to be
# asserted keyring-free: a forgotten file would ship a trusted signer to every
# device with no error anywhere. This is the state gen-dev-keys.sh's own
# instructions produce, one build later.
FIX="${WORK}/keyring-baked"
new_fixture "${FIX}"
mkdir -p "${FIX}/etc/rauc"
printf -- '-----BEGIN CERTIFICATE-----\nstand-in\n-----END CERTIFICATE-----\n' \
    >"${FIX}/etc/rauc/keyring.pem"
expect_set "a keyring baked at /etc/rauc/keyring.pem, not expected" "dev-keyring=FAIL" \
    "the packed root ships /etc/rauc/keyring.pem" \
    "MOS_EXPECT_DEV_KEYRING=1"

# --- 14. the same keyring, explicitly expected -------------------------------
# MOS_EXPECT_DEV_KEYRING=1 is the sanctioned dev escape, and it must be loud:
# the assertion flips to PASS but the run has to carry the unmissable WARNING
# line, or the escape would make a dev image indistinguishable from a clean
# one in the log. Both halves are asserted — the flip and the noise.
export MOS_EXPECT_DEV_KEYRING=1
expect_set "the same baked keyring, waved through by MOS_EXPECT_DEV_KEYRING=1" \
    "dev-keyring=PASS"
unset MOS_EXPECT_DEV_KEYRING
if grep -q '^WARNING: DEVELOPMENT KEYRING SHIPPED' "${WORK}/out"; then
    pass "the waved-through run still shouts: the WARNING line is present"
else
    fail "the waved-through run is silent: no 'WARNING: DEVELOPMENT KEYRING SHIPPED' line, so a dev image with a baked keyring would look exactly like a clean one"
fi

echo
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} cases)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} cases)"
    exit 1
fi
