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
# The bind unit's NAME out of the verifier too, and then the SHIPPED unit it
# names -- not a transcription. Same reason as LED_UNIT_SRC: the Where=, What=
# and enablement assertions exist to catch the SHIPPED unit losing those
# properties, and a fixture built from a local copy would go on passing after
# the real unit changed. Reading the name from the verifier also makes the two
# agree by construction: the day they drift, the path below does not exist and
# this dies loudly instead of testing a unit nothing ships.
EXT_MOUNT_UNIT="$(verifier_const EXT_MOUNT_UNIT '"')"
# PLAN-011 D5's extension D-Bus policy, on the same principle: the path is read
# out of the verifier, and the file the fixture installs is the one mosd SHIPS.
# A hand-written stand-in would keep this suite green after the real policy
# widened its own_prefix, which is the single most dangerous edit the file has.
EXT_POLICY_PATH="$(verifier_const EXT_POLICY_PATH '')"
EXT_POLICY_SRC="${HERE}/../mosd/dist/$(basename "${EXT_POLICY_PATH}")"
[ -f "${EXT_POLICY_SRC}" ] || {
    echo "error: ${EXT_POLICY_SRC} not found; ${VERIFIER} asserts ${EXT_POLICY_PATH} but mosd ships no such policy" >&2
    exit 1
}
EXT_MOUNT_UNIT_SRC="${HERE}/rootfs/overlay-v2/etc/systemd/system/${EXT_MOUNT_UNIT}"
[ -f "${EXT_MOUNT_UNIT_SRC}" ] || {
    echo "error: ${EXT_MOUNT_UNIT_SRC} not found; ${VERIFIER} names ${EXT_MOUNT_UNIT} as PLAN-011 D5's bind unit but the overlay ships no such file" >&2
    exit 1
}

# PLAN-011 D6's MQTT bridge. Paths out of the verifier, files out of the tree:
# the unit and the policy the fixture installs are the ones the image installs,
# for the same reason the extension policy is copied rather than written. A
# hand-authored stand-in would keep this suite green after the shipped unit
# went back to DynamicUser or the shipped grant lost its send_member=, which
# are the two edits that break the bridge silently.
MQTTD_BIN="$(verifier_const MQTTD_BIN '"')"
MQTTD_UNIT="$(verifier_const MQTTD_UNIT '"')"
MQTTD_POLICY_PATH="$(verifier_const MQTTD_POLICY_PATH '"')"
MQTTD_WANTS="$(verifier_const MQTTD_WANTS '"')"
MQTTD_UNIT_SRC="${HERE}/../mosd/mqttd/dist/$(basename "${MQTTD_UNIT}")"
MQTTD_POLICY_SRC="${HERE}/../mosd/dist/$(basename "${MQTTD_POLICY_PATH}")"
for required in "${MQTTD_UNIT_SRC}" "${MQTTD_POLICY_SRC}"; do
    [ -f "${required}" ] || {
        echo "error: ${required} not found; ${VERIFIER} asserts the MQTT bridge into the image but the tree ships no such file" >&2
        exit 1
    }
done
# The mount unit that makes the bridge's EnvironmentFile writable. Named by the
# unit itself rather than restated, so retargeting EnvironmentFile= to a path
# no mount backs is caught here instead of leaving the fixture agreeing with a
# verifier that agrees with nothing.
MQTTD_ENV_DIR="$(dirname "$(sed -n 's/^EnvironmentFile=-\{0,1\}//p' "${MQTTD_UNIT_SRC}" | tail -n1)")"
# PLAN-012's container engine. Paths from the verifier, the mount unit from
# the overlay: the assertion is about the unit mos SHIPS, and a fixture that
# authored its own would keep passing after the real one lost its enablement
# or its STATE backing -- which is exactly the defect case 8e reproduces.
CONTAINER_BINARIES="$(verifier_const CONTAINER_BINARIES '"')"
QUADLET_GENERATOR="$(verifier_const QUADLET_GENERATOR '"')"
QUADLET_DIR="$(verifier_const QUADLET_DIR '"')"
QUADLET_MOUNT_UNIT="$(verifier_const QUADLET_MOUNT_UNIT '"')"
QUADLET_MOUNT_SRC="${HERE}/rootfs/overlay-v2/etc/systemd/system/${QUADLET_MOUNT_UNIT}"
[ -f "${QUADLET_MOUNT_SRC}" ] || {
    echo "error: ${QUADLET_MOUNT_SRC} not found; ${VERIFIER} names ${QUADLET_MOUNT_UNIT} as the Quadlet directory's bind but the overlay ships no such file" >&2
    exit 1
}
# The unit set podman brings. Restated here rather than read from the image,
# deliberately: the fixture has no podman, and what these cases exercise is the
# verifier's masking logic, not podman's packaging. The IMAGE run is what holds
# the real set honest, and the Dockerfile fails the build if podman grows a
# unit the masking list does not name.
PODMAN_UNITS="podman.socket podman.service podman-auto-update.timer podman-auto-update.service podman-restart.service podman-clean-transient.service podman-kube@.service"

MQTTD_ENV_MOUNT_SRC="$(grep -rl "^Where=${MQTTD_ENV_DIR}\$" \
    "${HERE}/rootfs/overlay-v2/etc/systemd/system" 2>/dev/null | head -n1)"
[ -n "${MQTTD_ENV_MOUNT_SRC}" ] || {
    echo "error: no overlay .mount unit has Where=${MQTTD_ENV_DIR}, which ${MQTTD_UNIT_SRC} reads its EnvironmentFile from; the shipped unit and the shipped mounts disagree and no fixture can paper over that" >&2
    exit 1
}

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
    # PLAN-011 D5's bind unit, as SHIPPED, plus the local-fs.target.wants
    # symlink os/rootfs/Dockerfile.v2 enables it with. The symlink is absolute
    # and therefore dangles inside the fixture, exactly as the LED one above
    # does: what the verifier asserts is that the symlink NAME is present under
    # a *.wants directory, because that is what enablement IS on the device.
    mkdir -p "${dir}/etc/systemd/system/local-fs.target.wants"
    cp "${EXT_MOUNT_UNIT_SRC}" "${dir}/etc/systemd/system/${EXT_MOUNT_UNIT}"
    ln -sf "/etc/systemd/system/${EXT_MOUNT_UNIT}" \
        "${dir}/etc/systemd/system/local-fs.target.wants/${EXT_MOUNT_UNIT}"
    # The SHIPPED extension policy, at the path the verifier asserts and the
    # Dockerfile installs to. Copied, never authored: the negative assertions
    # below are about what mosd/dist/com.mos.ext.conf actually grants.
    mkdir -p "${dir}$(dirname "${EXT_POLICY_PATH}")"
    cp "${EXT_POLICY_SRC}" "${dir}${EXT_POLICY_PATH}"

    # PLAN-011 D6's MQTT bridge, as os/rootfs/Dockerfile.v2 installs it: the
    # binary (a stand-in, like apid's -- nothing here reads its contents), the
    # SHIPPED unit, the SHIPPED grant, and the enablement symlink.
    mkdir -p "${dir}$(dirname "${MQTTD_BIN}")" \
        "${dir}$(dirname "${MQTTD_UNIT}")" \
        "${dir}$(dirname "${MQTTD_POLICY_PATH}")" \
        "${dir}$(dirname "${MQTTD_WANTS}")"
    printf '#!/bin/sh\n' >"${dir}${MQTTD_BIN}"
    cp "${MQTTD_UNIT_SRC}" "${dir}${MQTTD_UNIT}"
    cp "${MQTTD_POLICY_SRC}" "${dir}${MQTTD_POLICY_PATH}"
    ln -sf "${MQTTD_UNIT}" "${dir}${MQTTD_WANTS}"
    # ...the mount unit its EnvironmentFile depends on...
    cp "${MQTTD_ENV_MOUNT_SRC}" \
        "${dir}/etc/systemd/system/$(basename "${MQTTD_ENV_MOUNT_SRC}")"
    # ...and the account it runs as. The NAME is taken from the shipped unit,
    # never written here: a fixture that spelled the account itself would keep
    # passing after the unit changed User=, which is the exact drift the
    # assertion exists to catch.
    local mqttd_user
    mqttd_user="$(sed -n 's/^User=//p' "${MQTTD_UNIT_SRC}" | tail -n1)"
    [ -n "${mqttd_user}" ] || {
        echo "error: ${MQTTD_UNIT_SRC} sets no User=; the fixture cannot create an account the unit does not name" >&2
        exit 1
    }
    printf 'root:x:0:0:root:/root:/bin/bash\n%s:x:990:990:mos MQTT bridge:/nonexistent:/usr/sbin/nologin\n' \
        "${mqttd_user}" >"${dir}/etc/passwd"

    # RFCT-099's purged root: the licence texts Debian ships, and NO package
    # manager. 120 copyright files rather than a token one, because the
    # assertion is a threshold and a fixture with three would pass a check that
    # had lost its comparison.
    mkdir -p "${dir}/usr/share/doc/gcc-12-base" "${dir}/usr/bin" "${dir}/usr/sbin"
    local i
    for i in $(seq 1 120); do
        mkdir -p "${dir}/usr/share/doc/pkg${i}"
        printf 'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\n' \
            >"${dir}/usr/share/doc/pkg${i}/copyright"
    done

    # PLAN-012's container engine, as os/rootfs/Dockerfile.v2 installs it:
    # binaries present (stand-ins -- nothing reads their contents), every
    # podman unit masked to /dev/null, and the Quadlet directory bound from
    # STATE and enabled.
    local b u
    for b in ${CONTAINER_BINARIES} "${QUADLET_GENERATOR}"; do
        mkdir -p "${dir}$(dirname "${b}")"
        printf '#!/bin/sh\n' >"${dir}${b}"
    done
    mkdir -p "${dir}/usr/lib/systemd/system"
    for u in ${PODMAN_UNITS}; do
        printf '[Unit]\nDescription=%s\n' "${u}" >"${dir}/usr/lib/systemd/system/${u}"
        ln -sf /dev/null "${dir}/etc/systemd/system/${u}"
    done
    cp "${QUADLET_MOUNT_SRC}" "${dir}/etc/systemd/system/${QUADLET_MOUNT_UNIT}"
    ln -sf "/etc/systemd/system/${QUADLET_MOUNT_UNIT}" \
        "${dir}/etc/systemd/system/local-fs.target.wants/${QUADLET_MOUNT_UNIT}"

    # The image's networkd namespace, for check_networkd_namespace. Two files,
    # both outside every reconciler-owned prefix: the image's DHCP fallback and
    # one stock systemd unit standing in for the eight the Debian base carries.
    # Neither may collide, and the case below makes one that does.
    mkdir -p "${dir}/etc/systemd/network" "${dir}/usr/lib/systemd/network"
    printf '[Match]\nName=*\n[Network]\nDHCP=yes\n' \
        >"${dir}/etc/systemd/network/80-dhcp.network"
    printf '[Match]\nName=vb-*\n[Network]\nDHCP=no\n' \
        >"${dir}/usr/lib/systemd/network/80-container-vb.network"
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

# Rewrites the whole `Key=value` line in the fixture's D5 bind unit. Fails
# loudly when there is no such key, on the same reasoning as drop_led_directive:
# a mutation that silently changed nothing would make its case pass for free.
set_ext_unit_directive() {
    local dir="$1" key="$2" value="$3" unit="$1/etc/systemd/system/${EXT_MOUNT_UNIT}"
    grep -Eq "^${key}=" "${unit}" ||
        { echo "error: fixture unit ${EXT_MOUNT_UNIT} has no ${key}= line to rewrite" >&2; exit 1; }
    awk -v k="${key}" -v v="${value}" '$0 ~ "^" k "=" { print k "=" v; next } { print }' \
        "${unit}" >"${unit}.new"
    mv "${unit}.new" "${unit}"
}

# Applies sed expression $2 to the fixture's extension D-Bus policy, and fails
# loudly if the file came out unchanged. Same discipline as drop_led_directive:
# a mutation that silently matched nothing would make its case pass for free,
# and these four cases are the only thing driving those assertions at all.
mutate_ext_policy() {
    local dir="$1" expr="$2" f="$1${EXT_POLICY_PATH}" before
    before="$(cat "${f}")"
    sed -i "${expr}" "${f}"
    [ "${before}" != "$(cat "${f}")" ] ||
        { echo "error: sed '${expr}' changed nothing in ${EXT_POLICY_PATH}; the shipped policy no longer contains what this case mutates" >&2; exit 1; }
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
# PLAN-011 D5's bind assertion is an if/elif CHAIN with four distinct failure
# messages and one PASS, so it is five rows rather than one. ext-unit-ok owns
# the PASS direction; the four negative rows can only ever be observed FAILING
# and are ABSENT at baseline, the same shape as ui-no-filesystem above. Folding
# them into one row would need a substring common to all five messages, and the
# only one is the unit's own name -- which also appears inside ext-no-etc-bind's
# failure text, so the harness could no longer tell the two assertions apart.
# Five rows is what makes "the RIGHT branch fired" a thing this file can state.
# ASSERTIONS is single-quoted, so a substring chosen here cannot contain an
# apostrophe -- "systemd's unit load path" ends the string and the rows after
# it become commands. Pick a clause without one; several of these messages
# have an apostrophe somewhere and the failure does not point back here.
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
ext-unit-absent|usr-local-lib-systemd-system.mount is not in the image, so||ABSENT
ext-unit-where|puts a writable directory somewhere systemd does not read||ABSENT
ext-unit-what|which is not under /mnt/state||ABSENT
ext-unit-enabled|usr-local-lib-systemd-system.mount exists but is not enabled||ABSENT
ext-unit-ok|is a STATE-backed bind via usr-local-lib-systemd-system.mount||PASS
ext-no-etc-bind|no unit in the image mounts anything over /etc/systemd/system|a unit in the image mounts over /etc/systemd/system|PASS
ext-policy-grant|extension services can take their bus names at all||PASS
ext-policy-live-rule|grant is a live rule, not text inside an XML comment|only inside an XML comment|PASS
ext-policy-widened|does not grant the widened own_prefix|hands ownership of com.mos.mosd to every local uid|PASS
ext-policy-namespace|grants exactly one thing|grants ownership beyond the extension namespace|PASS
mqttd-bin|mqttd: /usr/bin/mos-mqttd is a regular file|mqttd: /usr/bin/mos-mqttd is missing|PASS
mqttd-unit-file|mqttd: /usr/lib/systemd/system/mos-mqttd.service is a regular file|mqttd: /usr/lib/systemd/system/mos-mqttd.service is missing|PASS
mqttd-policy-file|mqttd: /usr/share/dbus-1/system.d/mos-mqttd.conf is a regular file|mqttd: /usr/share/dbus-1/system.d/mos-mqttd.conf is missing|PASS
mqttd-enabled|mqttd: the bridge is enabled|is not a symlink, so mos-mqttd never starts|PASS
mqttd-static-user|mqttd: the unit runs as the static user|dbus-daemon resolves <policy user=> when it reads the file at startup|PASS
mqttd-grant-user|mqttd: the D-Bus grant names the same user the unit runs as|A grant naming the wrong identity|PASS
mqttd-account-exists|exists in the image'"'"'s /etc/passwd|and no such account is in|PASS
mqttd-per-member|mqttd: every grant on com.mos.mosd names a member|grant on com.mos.mosd|PASS
mqttd-no-danger|include none of|A compromise of the network-facing daemon becomes device control|PASS
mqttd-broker-configurable|mqttd: ExecStart takes the broker from the environment|does not reference|PASS
mqttd-env-on-state|mqttd: EnvironmentFile=|EnvironmentFile|PASS
pkgmgr-absent|carries no package manager|still carries package management|PASS
pkgmgr-copyrights|licence texts survived the purge|copyright files are left under|PASS
pkgmgr-dangling|names perl as its interpreter, so removing perl left nothing broken|still name it as their interpreter|PASS
container-present|the container engine is in the image|the container engine is incomplete|PASS
container-masked|podman units are masked to /dev/null|masked to /dev/null|PASS
container-not-enabled|no podman unit carries an enablement symlink|enablement symlink in the image|PASS
quadlet-dir|is a STATE-backed bind via etc-containers-systemd.mount|etc-containers-systemd.mount|PASS
connd-contract|read the connd contract out of mosd|could not read the connd contract|PASS
networkd-namespace|networkd namespace is clear|networkd namespace|PASS
'

# WHAT THIS REGISTER CANNOT SEE, AND WHY IT IS STRUCTURAL RATHER THAN AN
# OVERSIGHT. The fixture hook in os/verify-image-v2.sh dispatches a fixed list
# of FUNCTIONS and then exits. An assertion written INLINE below that exit is
# unreachable from here no matter what a case does to a fixture: it cannot be
# driven, it can never be observed failing, and its absence from this register
# looks identical to coverage from outside.
#
# THE INVENTORY THAT USED TO SIT HERE IS EMPTY. Both sets it named -- PLAN-011
# D5's mount-unit assertions and its com.mos.ext.conf policy assertions -- are
# now hoisted into check_ext_unit_dir and check_ext_policy and registered above.
# The warning stays even though the list is empty, because the list is not the
# durable part: TWO separate authors wrote assertions past that boundary without
# noticing, which makes it a property of the file rather than a lapse by either.
# A third will do it again unless something says so.
#
# So: if you add an assertion to the verifier and want it driven from here, wrap
# it in a function, add the name to the hook dispatch list, and add its rows
# below IN THE SAME CHANGE -- otherwise this file reports an unnamed assertion.
# The same warning sits at the hook exit in os/verify-image-v2.sh, which is
# where you will actually be standing when you are about to do it.

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

# --- 4c-4g. PLAN-011 D5's bind unit, driven one broken fact at a time -------
# WHY THESE ARE NEW AND WHAT THEY REPLACE. Until this task these five
# assertions were INLINE in the verifier's main body, far below the fixture
# hook -- and that hook dispatches a named set and exits, so
# MOS_VERIFY_FIXTURE_ROOT never reached them. They could not be driven at all.
# A sibling task measured the consequence on the negative guard specifically:
# it forced etc_units_binds="" so the guard ALWAYS passed, and this suite still
# reported RESULT: PASS (18/18 cases) with no FAIL line anywhere. An assertion
# that cannot fail is worse than no assertion, because its presence tells the
# next reader the hazard is watched. The verifier now wraps the block in
# check_ext_unit_dir and the hook dispatches it; these cases are what turn that
# reachability into an observation.

# --- 4c. the bind unit not shipped at all -----------------------------------
# The whole of D5 on the device: without this unit /usr/local/lib/systemd/system
# is just another directory inside the read-only squashfs, so a unit the
# integrator installs there is discarded at the next reboot with no error.
# The enablement symlink is deliberately LEFT in place, so the case also proves
# the absence is caught by the branch that owns it rather than by the *.wants
# check downstream of it.
FIX="${WORK}/ext-unit-absent"
new_fixture "${FIX}"
rm -f "${FIX}/etc/systemd/system/${EXT_MOUNT_UNIT}"
expect_set "PLAN-011 D5's ${EXT_MOUNT_UNIT} absent from the image" \
    "ext-unit-absent=FAIL ext-unit-ok=ABSENT" \
    "stays on the read-only squashfs" \
    "PLAN-011 D5's whole extension model does not work on the device"

# --- 4d. the bind pointed at a writable directory that does not survive ------
# /run/systemd/system is the tempting wrong answer, and it is what every mosd
# reconciler uses TODAY via runtime=true: it is genuinely writable and systemd
# genuinely reads it, so an integrator's unit appears to install correctly. It
# is a tmpfs. Everything installed there is gone at the next boot, which is the
# exact defect D5 exists to remove, and only Where= being READ from the unit
# rather than restated can catch it.
FIX="${WORK}/ext-unit-where"
new_fixture "${FIX}"
set_ext_unit_directive "${FIX}" Where /run/systemd/system
expect_set "the D5 bind re-pointed at the tmpfs /run/systemd/system" \
    "ext-unit-where=FAIL ext-unit-ok=ABSENT" \
    "mounts '/run/systemd/system', not ${EXT_UNIT_DIR}"

# --- 4e. the bind backed by something other than STATE ----------------------
# Where= stays correct, the unit stays enabled, and the directory really is
# writable on the device -- so nothing about the running system looks wrong.
# /var is the EPHEMERAL partition: the installed units survive a reboot and
# vanish at the first A/B update or factory reset, which is the failure that
# only shows up long after whoever made the change has stopped looking.
FIX="${WORK}/ext-unit-what"
new_fixture "${FIX}"
set_ext_unit_directive "${FIX}" What /var/lib/systemd-units
expect_set "the D5 bind backed by /var instead of STATE" \
    "ext-unit-what=FAIL ext-unit-ok=ABSENT" \
    "which is not under /mnt/state" \
    "lost by the next A/B update or factory reset"

# --- 4f. the unit shipped but never enabled ---------------------------------
# The quietest of the five. The unit is present and every line in it is
# correct, so a reviewer reading the unit finds nothing wrong; it simply never
# runs. Installing a unit then works exactly once -- until the next boot.
FIX="${WORK}/ext-unit-not-enabled"
new_fixture "${FIX}"
rm -f "${FIX}/etc/systemd/system/local-fs.target.wants/${EXT_MOUNT_UNIT}"
expect_set "the D5 bind unit shipped but not enabled" \
    "ext-unit-enabled=FAIL ext-unit-ok=ABSENT" \
    "no *.wants symlink under /etc/systemd/system" \
    "installing a unit appears to work and stops working at the next boot"

# --- 4g. the rejected /etc/systemd/system target, reintroduced --------------
# THE case this whole hoist was done for. PLAN-011 D5 originally named
# /etc/systemd/system and it was rejected on 2026-08-22; anyone reading the
# superseded sentence repairs the "deviation" by pointing the bind back, and
# that diff reads like restoring the plan while reintroducing the defect. The
# image ships this boot chain's own mount units in that directory TOGETHER with
# the local-fs.target.wants symlinks enabling them, so the bind would be
# performed by a unit living in the directory it hides and would take the
# enablement of every other STATE mount with it.
#
# Both assertions are required to fire and the case names both: Where= is no
# longer ${EXT_UNIT_DIR}, and a unit in the image now mounts over
# /etc/systemd/system. The second is the one that was structurally unobservable
# until now -- forcing it to pass left this suite green at 18/18.
FIX="${WORK}/ext-unit-over-etc"
new_fixture "${FIX}"
set_ext_unit_directive "${FIX}" Where /etc/systemd/system
expect_set "the D5 bind re-pointed at the rejected /etc/systemd/system" \
    "ext-unit-where=FAIL ext-no-etc-bind=FAIL ext-unit-ok=ABSENT" \
    "mounts '/etc/systemd/system', not ${EXT_UNIT_DIR}" \
    "a unit in the image mounts over /etc/systemd/system (/etc/systemd/system/${EXT_MOUNT_UNIT})" \
    "re-pointing it here looks like restoring the plan while reintroducing the defect"

# --- 4h-4k. the com.mos.ext.conf policy, driven one broken fact at a time ---
# These four were unreachable for exactly the same structural reason as the
# mount-unit set above, and a sibling task measured it the same way: a fixture
# violating all four at once still returned RESULT: PASS, and breaking the
# widened-prefix guard outright left this suite green with zero FAIL lines.
# Reaching them needed three helpers moved above the fixture hook as well as the
# block itself -- sq_grep, dbus_policy_rules_only and MOSD_POLICY_PATH were all
# defined BELOW it, so a policy check dispatched from the hook would have called
# functions that did not exist yet.

# --- 4h. no policy file at all ----------------------------------------------
# dbus-daemon default-denies ownership, so with this file gone NO extension can
# take a com.mos.ext.* name: every one of them dies at RequestName with
# AccessDenied, which reads like a bug in the extension rather than a missing
# policy. Both the raw presence check and the live-rule check fire; the two
# negative assertions correctly stay quiet, because a file that grants nothing
# grants nothing too widely.
FIX="${WORK}/ext-policy-absent"
new_fixture "${FIX}"
rm -f "${FIX}${EXT_POLICY_PATH}"
expect_set "the extension D-Bus policy absent from the image" \
    "ext-policy-grant=FAIL ext-policy-live-rule=FAIL" \
    "missing or does not match" \
    "every extension unit dies at RequestName with AccessDenied"

# --- 4i. the grant present, but only inside an XML comment ------------------
# THE case that justifies stripping comments before matching. The raw text still
# contains the grant, so a naive grep -- and ext-policy-grant, which is exactly
# that -- goes on PASSING. dbus-daemon ignores comments, so on the device no
# extension can own its name. Only the comment-stripped assertion can tell the
# difference, and this is the case that proves it does.
FIX="${WORK}/ext-policy-commented"
new_fixture "${FIX}"
mutate_ext_policy "${FIX}" 's|<allow own_prefix="com.mos.ext"/>|<!-- <allow own_prefix="com.mos.ext"/> -->|'
expect_set "the own_prefix grant commented out, so only the raw text still has it" \
    "ext-policy-live-rule=FAIL" \
    "only inside an XML comment" \
    "every extension unit dies at RequestName with AccessDenied"

# --- 4j. the prefix widened to com.mos --------------------------------------
# The one-character edit com.mos.ext.conf warns about in its own EXTENSION POINT
# section: one shorter string, one fewer dot, and it reads in a diff like a
# simplification. What it does is re-grant ownership of com.mos.mosd to every
# local uid -- a unit with DefaultDependencies=no can claim the name before mosd
# does and apid talks to an impostor for the rest of the boot. com.mos.mosd.conf
# root-only rules keep passing throughout, because they cannot see a grant made
# in another file. All four fire: the ext grant is gone AND a wider one is here.
FIX="${WORK}/ext-policy-widened"
new_fixture "${FIX}"
mutate_ext_policy "${FIX}" 's|own_prefix="com.mos.ext"/>|own_prefix="com.mos"/>|'
expect_set "the extension grant widened to own_prefix=com.mos" \
    "ext-policy-grant=FAIL ext-policy-live-rule=FAIL ext-policy-widened=FAIL ext-policy-namespace=FAIL" \
    "hands ownership of com.mos.mosd to every local uid" \
    "grants ownership beyond the extension namespace" \
    "unexpected prefixes"

# --- 4k. ownership granted outside the extension namespace ------------------
# The other direction, and the one a deny-list would never catch: the prefix
# grant stays exactly right and a SECOND rule names a system bus outright. Every
# name outside com.mos.ext.* is a system name, so one own= rule here opens it to
# every local uid while com.mos.mosd.conf keeps passing.
FIX="${WORK}/ext-policy-own-system"
new_fixture "${FIX}"
mutate_ext_policy "${FIX}" 's|<allow own_prefix="com.mos.ext"/>|<allow own_prefix="com.mos.ext"/>\n    <allow own="com.mos.mosd"/>|'
expect_set "an outright <allow own=> for a system name in the extension policy" \
    "ext-policy-namespace=FAIL" \
    "grants ownership beyond the extension namespace" \
    "own rules [<allow own=\"com.mos.mosd\"]"

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


# ===========================================================================
# PLAN-011 D6: the MQTT bridge, as the image installs it
# ===========================================================================
# Every case here is a defect the wiring ACTUALLY HAD before these assertions
# existed. The crate, the unit and fourteen protocol tests were green the whole
# time; none of them can see an image.

mutate_mqttd_unit() {
    local dir="$1" expr="$2" f="$1${MQTTD_UNIT}" before
    before="$(cat "${f}")"
    sed -i "${expr}" "${f}"
    [ "${before}" != "$(cat "${f}")" ] ||
        { echo "error: sed '${expr}' changed nothing in ${MQTTD_UNIT}; the shipped unit no longer contains what this case mutates" >&2; exit 1; }
}
mutate_mqttd_policy() {
    local dir="$1" expr="$2" f="$1${MQTTD_POLICY_PATH}" before
    before="$(cat "${f}")"
    sed -i "${expr}" "${f}"
    [ "${before}" != "$(cat "${f}")" ] ||
        { echo "error: sed '${expr}' changed nothing in ${MQTTD_POLICY_PATH}; the shipped grant no longer contains what this case mutates" >&2; exit 1; }
}

# --- 5a. the bridge is simply not in the image ------------------------------
# THE STATE MAIN WAS IN until this task: mos-mqttd built, tested and shipped
# nowhere. Nothing in the image, and nothing anywhere said so.
FIX="${WORK}/mqttd-absent"
new_fixture "${FIX}"
rm -f "${FIX}${MQTTD_BIN}" "${FIX}${MQTTD_UNIT}" "${FIX}${MQTTD_POLICY_PATH}" \
    "${FIX}${MQTTD_WANTS}"
expect_set "the MQTT bridge absent from the image" \
    "mqttd-bin=FAIL mqttd-unit-file=FAIL mqttd-policy-file=FAIL mqttd-enabled=FAIL mqttd-static-user=FAIL mqttd-grant-user=FAIL mqttd-account-exists=FAIL mqttd-per-member=FAIL mqttd-no-danger=PASS mqttd-broker-configurable=FAIL mqttd-env-on-state=FAIL" \
    "is not in this image at all" \
    "there is no grant on com.mos.mosd at all" \
    "no EnvironmentFile= line at all"

# --- 5b. installed but never enabled ----------------------------------------
# The root is a read-only verity squashfs, so systemctl enable has nowhere to
# write: a unit that ships disabled ships permanently disabled.
FIX="${WORK}/mqttd-disabled"
new_fixture "${FIX}"
rm -f "${FIX}${MQTTD_WANTS}"
expect_set "the bridge installed but not enabled" \
    "mqttd-enabled=FAIL" \
    "cannot be fixed with systemctl enable on the device"

# --- 5c. back to DynamicUser ------------------------------------------------
# The unit's ORIGINAL state, and the one that makes the grant a rule matching
# nobody. Two assertions fire: the identity is not static, and the policy's
# user no longer matches the unit's.
FIX="${WORK}/mqttd-dynamic-user"
new_fixture "${FIX}"
mutate_mqttd_unit "${FIX}" 's/^User=mos-mqttd$/DynamicUser=yes/'
expect_set "the bridge back on DynamicUser=yes" \
    "mqttd-static-user=FAIL mqttd-grant-user=FAIL mqttd-account-exists=FAIL" \
    "before any dynamic user for the unit exists" \
    "A grant naming the wrong identity"

# --- 5d. the account the unit names is not in the image ---------------------
# systemd refuses to start the unit and dbus-daemon drops the rule. Both
# failures are at boot, on the device.
FIX="${WORK}/mqttd-no-account"
new_fixture "${FIX}"
printf 'root:x:0:0:root:/root:/bin/bash\n' >"${FIX}/etc/passwd"
expect_set "the bridge's account missing from /etc/passwd" \
    "mqttd-account-exists=FAIL" \
    "no such account is in"

# --- 5e. the unit and the grant name different identities -------------------
# Neither file is wrong on its own, which is what makes this the drift that
# survives review: two correct-looking files and a grant nobody holds.
FIX="${WORK}/mqttd-user-drift"
new_fixture "${FIX}"
mutate_mqttd_policy "${FIX}" 's/user="mos-mqttd"/user="mos-mqtt"/'
expect_set "the grant naming a different user than the unit runs as" \
    "mqttd-grant-user=FAIL" \
    "A grant naming the wrong identity"

# --- 5f. the grant widened to the whole interface ---------------------------
# The escalation. com.mos.mosd.conf keeps passing throughout, because it cannot
# see a grant made in another file -- the same blind spot 4j and 4k exercise
# for ownership, reached here through send_destination.
FIX="${WORK}/mqttd-blanket-grant"
new_fixture "${FIX}"
mutate_mqttd_policy "${FIX}" \
    's|<allow send_destination="com.mos.mosd"$|<allow send_destination="com.mos.mosd"/><allow x="y"|'
mutate_mqttd_policy "${FIX}" '0,/<allow x="y"/s|<allow x="y"|<!-- |'
expect_set "a blanket send_destination grant on com.mos.mosd" \
    "mqttd-per-member=FAIL" \
    "names no member"

# --- 5g. a dangerous member granted -----------------------------------------
# The bridge is the only daemon in the image holding a network socket, and
# SetTransientRootPassword writes a root credential into /etc/shadow.
FIX="${WORK}/mqttd-danger-member"
new_fixture "${FIX}"
mutate_mqttd_policy "${FIX}" 's/send_member="GetItems"/send_member="Reboot"/'
expect_set "the bridge granted com.mos.mosd1.Reboot" \
    "mqttd-no-danger=FAIL" \
    "becomes device control"

# --- 5h. the broker baked into the read-only root ---------------------------
# The unit's ORIGINAL ExecStart. On an immutable squashfs a literal host is the
# same host on every device the image is written to, unchangeable.
FIX="${WORK}/mqttd-baked-broker"
new_fixture "${FIX}"
mutate_mqttd_unit "${FIX}" 's/--broker-host ${MOS_MQTT_BROKER_HOST}/--broker-host localhost/'
expect_set "a broker address baked into ExecStart" \
    "mqttd-broker-configurable=FAIL" \
    "the same address on every device flashed with this image"

# --- 5i. the environment file on a path nothing mounts ----------------------
# A configurable broker whose configuration file lives inside the verity root
# is not configurable. This is the half that makes 5h's fix real.
FIX="${WORK}/mqttd-env-unwritable"
new_fixture "${FIX}"
mutate_mqttd_unit "${FIX}" 's|^EnvironmentFile=-.*|EnvironmentFile=-/etc/mos/mqttd.env|'
expect_set "the bridge's EnvironmentFile on a path no mount unit backs" \
    "mqttd-env-on-state=FAIL" \
    "no .mount unit in the image mounts"

# ===========================================================================
# The connd contract, and the namespace check that depends on it
# ===========================================================================

# --- 6a. the sweep marker the extractor cannot find -------------------------
# THE DEFECT THIS TASK FIXED, driven. network.rs was refactored from
# `file_name.contains("-mos-")` to an anchored is_mos_managed(), the verifier's
# regex stopped matching, and MOS_SWEEP silently became "". The contract read
# failed and nineteen assertions below it went green anyway.
#
# MOS_VERIFY_RECONCILER_DIR is what makes this drivable at all: without it the
# rot could only be waited for. The copy is of the REAL reconcilers, so the
# case is about one removed line and not about a directory this test authored.
RECONCILER_SRC="${HERE}/../mosd/mosd/src/reconciler"
[ -d "${RECONCILER_SRC}" ] || {
    echo "error: ${RECONCILER_SRC} not found; the verifier reads the connd contract out of it" >&2
    exit 1
}
FIX="${WORK}/connd-marker-gone"
new_fixture "${FIX}"
ROTTED="${WORK}/reconciler-rotted"
rm -rf "${ROTTED}"
cp -r "${RECONCILER_SRC}" "${ROTTED}"
before="$(cat "${ROTTED}/network.rs")"
sed -i 's/file_name\.starts_with("[^"]*")/is_mos_prefixed(file_name)/' "${ROTTED}/network.rs"
[ "${before}" != "$(cat "${ROTTED}/network.rs")" ] ||
    { echo "error: network.rs no longer contains a file_name.starts_with(...) for this case to remove" >&2; exit 1; }
MOS_VERIFY_RECONCILER_DIR="${ROTTED}" \
    expect_set "the sweep marker moved behind a helper the extractor cannot read" \
    "connd-contract=FAIL networkd-namespace=FAIL" \
    "could not read the connd contract" \
    "networkd namespace check did not run"

# --- 6b. an image .network file inside the sweep namespace ------------------
# The TRUE positive, which the unanchored `*${MOS_SWEEP}*` glob could not
# distinguish from the eight false ones it reported: a file that really does
# start with the prefix network.rs sweeps, and really would be deleted on the
# device on the reconciler's first pass.
FIX="${WORK}/networkd-collision"
new_fixture "${FIX}"
printf '[Match]\nName=eth0\n[Network]\nDHCP=yes\n' \
    >"${FIX}/usr/lib/systemd/network/50-mos-eth0.network"
expect_set "an image .network file inside network.rs's sweep namespace" \
    "networkd-namespace=FAIL" \
    "swept-by-network.rs"

# --- 6c. an image .network file inside a WiFi reconciler's prefix -----------
# The other namespace, and the other direction: not swept but SHADOWING, since
# networkd applies the first match in lexical order.
FIX="${WORK}/networkd-sta-collision"
new_fixture "${FIX}"
printf '[Match]\nName=wlan0\n[Network]\nDHCP=yes\n' \
    >"${FIX}/usr/lib/systemd/network/90-wifi-client-wlan0.network"
expect_set "an image .network file inside the station reconciler's prefix" \
    "networkd-namespace=FAIL" \
    "station-namespace"


# ===========================================================================
# RFCT-099: the packed root ships no package manager
# ===========================================================================

# --- 7a. apt survived the purge ---------------------------------------------
# The state every Debian-derived image is in until something removes it.
FIX="${WORK}/pkgmgr-apt-left"
new_fixture "${FIX}"
printf '#!/bin/sh\n' >"${FIX}/usr/bin/apt-get"
expect_set "apt-get left in the packed root" \
    "pkgmgr-absent=FAIL" \
    "still carries package management"

# --- 7b. the dpkg database restored from the factory tree -------------------
# The one a check that only looked at /var would miss: the pack stage relocates
# /var to /usr/share/factory/var, and mos-seed-var copies it back on first boot.
# A root that looks clean would repopulate itself.
FIX="${WORK}/pkgmgr-factory-db"
new_fixture "${FIX}"
mkdir -p "${FIX}/usr/share/factory/var/lib/dpkg"
expect_set "the dpkg database still under the factory tree" \
    "pkgmgr-absent=FAIL" \
    "/usr/share/factory/var/lib/dpkg"

# --- 7c. the licence texts taken with the purge -----------------------------
# The half a size-driven cleanup gets wrong, and the one that fails silently.
FIX="${WORK}/pkgmgr-copyright-gone"
new_fixture "${FIX}"
rm -rf "${FIX}/usr/share/doc"
expect_set "the copyright files removed along with the package manager" \
    "pkgmgr-copyrights=FAIL" \
    "breaches those terms"

# --- 7d. perl gone but a script still names it ------------------------------
FIX="${WORK}/pkgmgr-dangling-perl"
new_fixture "${FIX}"
printf '#!/usr/bin/perl\nprint "hi";\n' >"${FIX}/usr/bin/deb-systemd-helper"
expect_set "a perl script left behind after perl was removed" \
    "pkgmgr-dangling=FAIL" \
    "still name it as their interpreter"


# ===========================================================================
# PLAN-012: the container engine, installed and inert
# ===========================================================================

# --- 8a. a piece of the engine missing --------------------------------------
FIX="${WORK}/container-incomplete"
new_fixture "${FIX}"
rm -f "${FIX}/usr/libexec/podman/quadlet"
expect_set "the Quadlet binary missing from the engine" \
    "container-present=FAIL" \
    "the container engine is incomplete"

# --- 8b. the Quadlet GENERATOR missing --------------------------------------
# Separate from 8a because it is the piece whose absence is invisible: podman
# works, `podman run` works, and .container files are simply never turned into
# services. Nothing errors.
FIX="${WORK}/container-no-generator"
new_fixture "${FIX}"
rm -f "${FIX}/usr/lib/systemd/system-generators/podman-system-generator"
expect_set "the Quadlet systemd generator missing" \
    "container-present=FAIL" \
    "the container engine is incomplete"

# --- 8c. podman.socket unmasked ---------------------------------------------
# THE ONE THAT MATTERS MOST. podman.socket is socket-activated: leaving it
# merely disabled means anything that connects starts the root-run engine.
FIX="${WORK}/container-socket-unmasked"
new_fixture "${FIX}"
rm -f "${FIX}/etc/systemd/system/podman.socket"
expect_set "podman.socket left unmasked" \
    "container-masked=FAIL" \
    "masked to /dev/null" \
    "SOCKET-ACTIVATED"

# --- 8d. a podman unit enabled ----------------------------------------------
FIX="${WORK}/container-unit-enabled"
new_fixture "${FIX}"
mkdir -p "${FIX}/etc/systemd/system/multi-user.target.wants"
ln -sf /usr/lib/systemd/system/podman.service \
    "${FIX}/etc/systemd/system/multi-user.target.wants/podman.service"
expect_set "a podman unit enabled in the image" \
    "container-not-enabled=FAIL" \
    "enablement symlink in the image"

# --- 8e. the Quadlet bind shipped but NOT ENABLED ---------------------------
# THE DEFECT THIS TASK ACTUALLY HAD. The mount unit was installed and its
# local-fs.target.wants symlink was not, so /etc/containers/systemd would have
# stayed on the read-only squashfs. Caught by the assertion on its first run.
FIX="${WORK}/quadlet-not-enabled"
new_fixture "${FIX}"
rm -f "${FIX}/etc/systemd/system/local-fs.target.wants/${QUADLET_MOUNT_UNIT}"
expect_set "the Quadlet bind installed but not enabled" \
    "quadlet-dir=FAIL" \
    "exists but is not enabled"

# --- 8f. no Quadlet bind at all ---------------------------------------------
# The state the image was in before this task: podman installed, and nowhere
# on the device to put a .container file that survives a reboot.
FIX="${WORK}/quadlet-absent"
new_fixture "${FIX}"
rm -f "${FIX}/etc/systemd/system/${QUADLET_MOUNT_UNIT}" \
      "${FIX}/etc/systemd/system/local-fs.target.wants/${QUADLET_MOUNT_UNIT}"
expect_set "no Quadlet directory bind in the image" \
    "quadlet-dir=FAIL" \
    "NOWHERE to install a container"

# --- 8g. the bind pointed somewhere Quadlet does not read -------------------
# The plan's original, wrong assumption: /usr/local/lib/systemd/system, the
# extension unit directory. Quadlet never looks there.
FIX="${WORK}/quadlet-wrong-where"
new_fixture "${FIX}"
sed -i 's|^Where=.*|Where=/usr/local/lib/systemd/system|' \
    "${FIX}/etc/systemd/system/${QUADLET_MOUNT_UNIT}"
expect_set "the Quadlet bind pointed at the extension unit directory" \
    "quadlet-dir=FAIL" \
    "the only one of Quadlet's three search directories"

# --- 8h. the bind backed by /var instead of STATE ---------------------------
# /var is the wipeable EPHEMERAL partition. Containers would install, work,
# and vanish on the next A/B update.
FIX="${WORK}/quadlet-not-state"
new_fixture "${FIX}"
sed -i 's|^What=.*|What=/var/lib/quadlet|' \
    "${FIX}/etc/systemd/system/${QUADLET_MOUNT_UNIT}"
expect_set "the Quadlet bind backed by /var instead of STATE" \
    "quadlet-dir=FAIL" \
    "not survive an A/B update"

echo
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} cases)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} cases)"
    exit 1
fi
