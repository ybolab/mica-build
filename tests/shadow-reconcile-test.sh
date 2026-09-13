#!/usr/bin/env bash
# Offline tests for rootfs/overlay/usr/lib/mica/mica-shadow-reconcile, with
# the transient-root-password clearing as the subject. The REAL script is run,
# once per case, against fixtures in a temp dir: MOS_SHADOW_PASSWD and
# MOS_SHADOW_FACTORY redirect its two absolute inputs and the shadow path is
# passed as the argument the script already takes, so nothing on the host is
# read or written.
#
#   bash tests/shadow-reconcile-test.sh
#
# No root required. `chgrp shadow` is the one thing in the script that needs
# privilege; when it is unavailable a fake is put on PATH ahead of the real one
# and the group assertions are skipped. Which mode was taken is printed below.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT=$HERE/../rootfs/overlay/usr/lib/mica/mica-shadow-reconcile
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PASS=0
FAIL=0

[ -f "$SCRIPT" ] || { echo "no $SCRIPT to test" >&2; exit 1; }

# A bcrypt hash of the shape micad writes, and a second one standing in for a
# hash micad did NOT write -- set by hand over the serial console, say; no
# buildable image can bake one, since the pack stage fails a factory shadow with
# a usable hash. Opaque on purpose: the script compares them as strings and
# never parses them.
MOS_HASH='$2b$12$abcdefghijklmnopqrstuvOJqM0iZ5wKzXwZ2G8bqZ0aVjPQnDGa'
DEV_HASH='$2b$12$ZZZZZZZZZZZZZZZZZZZZZuOJqM0iZ5wKzXwZ2G8bqZ0aVjPQnDGa'

# Can this process hand a file to the shadow group? Only root normally can.
mkdir -p "$WORK/probe"
: >"$WORK/probe/file"
FAKEBIN=$WORK/fakebin
mkdir -p "$FAKEBIN"
if chgrp shadow "$WORK/probe/file" 2>/dev/null; then
    GROUP_MODE=real
else
    GROUP_MODE=faked
    printf '#!/bin/sh\nexit 0\n' >"$FAKEBIN/chgrp"
    chmod 0755 "$FAKEBIN/chgrp"
fi
echo "chgrp mode: $GROUP_MODE ($([ "$GROUP_MODE" = real ] \
    && echo 'real chgrp, group assertions active' \
    || echo 'chgrp faked on PATH, group assertions skipped'))"
echo

check() {
    local name=$1 want=$2 got=$3
    if [ "$want" = "$got" ]; then
        PASS=$((PASS + 1))
        echo "PASS $name"
    else
        FAIL=$((FAIL + 1))
        echo "FAIL $name: expected [$want], got [$got]"
    fi
}

# Per-case sandbox: a state dir holding the shadow file, plus the passwd and
# factory fixtures the script reads. $1 names the case, $2 is the shadow body,
# $3 is the passwd body (default: root and daemon).
new_case() {
    CASE=$WORK/case-$1
    STATE=$CASE/state
    SHADOW=$STATE/shadow
    MARKER=$STATE/transient-root-password
    rm -rf "$CASE"
    mkdir -p "$STATE"
    # Exactly one trailing newline, whether the body arrived through a command
    # substitution (which strips them all) or as a plain variable. A shadow file
    # whose last line is unterminated is not the shape this script is fed on a
    # device, and it would make the append rule glue two entries together.
    printf '%s\n' "$(printf '%s' "$2")" >"$SHADOW"
    chmod 0640 "$SHADOW"
    printf '%s' "${3:-$PASSWD_BOTH}" >"$CASE/passwd"
    printf '%s' "$FACTORY_BODY" >"$CASE/factory"
}

# Run the real script against this case. Prints its own output; returns its
# exit status in $rc via the caller's `&& rc=0 || rc=$?` idiom.
run_reconcile() {
    env PATH="$FAKEBIN:$PATH" \
        MOS_SHADOW_PASSWD="$CASE/passwd" \
        MOS_SHADOW_FACTORY="$CASE/factory" \
        sh "$SCRIPT" "$SHADOW"
}

PASSWD_BOTH='root:x:0:0:root:/root:/bin/sh
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
'
PASSWD_DAEMON_ONLY='daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
'
PASSWD_WITH_NEW='root:x:0:0:root:/root:/bin/sh
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
newsvc:x:990:990:new service:/nonexistent:/usr/sbin/nologin
'
FACTORY_BODY='root:!:19000:0:99999:7:::
daemon:*:19000:0:99999:7:::
'
OTHER_LINES='daemon:*:19000:0:99999:7:::
'

# Shadow body whose root hash is $1.
shadow_with() { printf 'root:%s:19000:0:99999:7:::\n%s' "$1" "$OTHER_LINES"; }

# The hash field of the root: line, or the literal (none) when there is none.
root_field() {
    awk -F: '$1 == "root" { print $2; found = 1; exit } END { if (!found) print "(none)" }' \
        "$SHADOW"
}

# yes when every line of the shadow file has exactly nine colon-separated
# fields. A marker that could inject a colon, a newline or a shell expansion
# would show up here as a malformed file.
well_formed() {
    awk -F: 'NF != 9 { bad = 1 } END { exit bad ? 1 : 0 }' "$SHADOW" && echo yes || echo no
}

exists() { [ -e "$1" ] && echo yes || echo no; }
lines_after_root() { grep -v '^root:' "$SHADOW" || true; }
no_temp_files() {
    if find "$STATE" -name '*.transient.*' -o -name '*.reconcile.*' | grep -c . >/dev/null; then
        echo no
    else
        echo yes
    fi
}
# yes when the file's last byte is a newline. An unterminated last line would
# glue the next appended entry onto it, which is how a malformed factory copy
# turns into two accounts sharing one line.
ends_with_newline() {
    [ -s "$1" ] && [ "$(tail -c1 "$1" | od -An -tu1 | tr -d ' \n')" = "10" ] \
        && echo yes || echo no
}
group_of() { stat -c %G "$1"; }
mode_of() { stat -c %a "$1"; }

# The semantics these cases pin.
#
# /etc/shadow is BUILT IN RAM from /usr/share/factory/etc/shadow on every boot.
# There is no marker, no next-boot clearing protocol, and no rule that an
# existing entry wins over the image's: mos supports exactly one console
# credential, a TRANSIENT root password (docs/design/access.md §4.2).

# --- 1. the file is built from the factory copy, every entry locked ----------
new_case build-from-factory ""
run_reconcile >/dev/null
check "build -> root is locked" "!" "$(root_field)"
check "build -> every line has nine fields" "yes" "$(well_formed "$SHADOW")"
check "build -> result is terminated" "yes" "$(ends_with_newline "$SHADOW")"
check "build -> mode is 0640" "640" "$(mode_of "$SHADOW")"
[ "$GROUP_MODE" = real ] && check "build -> group is shadow" "shadow" "$(group_of "$SHADOW")"

# --- 2. a password does not survive a run -----------------------------------
#
# The security property, stated directly. The file is rebuilt from the image, so
# a password survives only if the rebuild does not happen -- and if the rebuild
# does not happen there is no shadow file at all and PAM fails closed.
new_case password-does-not-survive "$(shadow_with "$MOS_HASH")"
check "before -> the password is present" "$MOS_HASH" "$(root_field)"
run_reconcile >/dev/null
check "after -> root is locked again" "!" "$(root_field)"
check "after -> the hash appears nowhere in the file" "no" \
    "$(grep -qF "$MOS_HASH" "$SHADOW" && echo yes || echo no)"

# The same, for a hash the script has never been told about: there is nothing
# to match against and nothing to decide, so it goes too.
new_case foreign-password-does-not-survive "$(shadow_with "$DEV_HASH")"
run_reconcile >/dev/null
check "foreign hash -> root is locked" "!" "$(root_field)"
check "foreign hash -> the hash is gone" "no" \
    "$(grep -qF "$DEV_HASH" "$SHADOW" && echo yes || echo no)"

# --- 3. an account in passwd with no factory entry is appended, LOCKED -------
new_case appends-new-account "" "$PASSWD_WITH_NEW"
run_reconcile >/dev/null
check "append -> the new account has an entry" "yes" \
    "$(awk -F: '$1 == "newsvc" { f = 1 } END { print f ? "yes" : "no" }' "$SHADOW")"
check "append -> and it is locked" "!" \
    "$(awk -F: '$1 == "newsvc" { print $2; exit }' "$SHADOW")"
check "append -> every line has nine fields" "yes" "$(well_formed "$SHADOW")"

# An account the factory names but passwd does not is kept: the factory copy is
# the image's statement about its own accounts, and dropping one would leave a
# unit's User= with no shadow entry after an A/B update reintroduced it.
new_case keeps-factory-only-account "" "$PASSWD_DAEMON_ONLY"
run_reconcile >/dev/null
check "factory-only -> root is still present" "!" "$(root_field)"

# --- 4. idempotent ----------------------------------------------------------
new_case idempotent ""
run_reconcile >/dev/null
first="$(cat "$SHADOW")"
run_reconcile >/dev/null
check "idempotent -> second run byte-identical" "$first" "$(cat "$SHADOW")"
check "idempotent -> no temp files left" "" \
    "$(find "$STATE" -name 'shadow.*' -printf '%f ' 2>/dev/null)"

# --- 5. the inputs must exist, and the failure is loud ----------------------
new_case missing-passwd ""
rm -f "$CASE/passwd"
rc=0
run_reconcile >/dev/null 2>&1 || rc=$?
check "missing passwd -> exits non-zero" "yes" "$([ "$rc" -ne 0 ] && echo yes || echo no)"

new_case missing-factory ""
rm -f "$CASE/factory"
rc=0
run_reconcile >/dev/null 2>&1 || rc=$?
check "missing factory -> exits non-zero" "yes" "$([ "$rc" -ne 0 ] && echo yes || echo no)"

# --- 6. a factory copy whose last line is unterminated ----------------------
#
# An unterminated last line would glue two entries together on append.
new_case unterminated-factory ""
printf 'root:!:19000:0:99999:7:::\ndaemon:*:19000:0:99999:7:::' >"$CASE/factory"
run_reconcile >/dev/null
check "unterminated factory -> every line has nine fields" "yes" "$(well_formed "$SHADOW")"
check "unterminated factory -> result is terminated" "yes" "$(ends_with_newline "$SHADOW")"
check "unterminated factory -> daemon survived intact" "yes" \
    "$(awk -F: '$1 == "daemon" { f = 1 } END { print f ? "yes" : "no" }' "$SHADOW")"

# --- 7. the destination directory is created if absent ----------------------
#
# /run/mica does not exist on a fresh boot: /run is an empty tmpfs, so the
# script creates its own destination directory.
new_case creates-its-directory ""
rm -rf "$STATE"
run_reconcile >/dev/null
check "creates dir -> the shadow file exists" "yes" \
    "$([ -f "$SHADOW" ] && echo yes || echo no)"
check "creates dir -> root is locked" "!" "$(root_field)"

echo
echo "$PASS passed, $FAIL failed"
echo "RESULT: $([ "$FAIL" -eq 0 ] && echo PASS || echo FAIL) ($PASS/$((PASS + FAIL)) checks)"
[ "$FAIL" -eq 0 ]
