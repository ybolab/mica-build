#!/usr/bin/env bash
# Offline tests for os/rootfs/overlay-v2/usr/lib/mos/mos-shadow-reconcile, with
# the transient-root-password clearing as the subject. The REAL script is run,
# once per case, against fixtures in a temp dir: MOS_SHADOW_PASSWD and
# MOS_SHADOW_FACTORY redirect its two absolute inputs and the shadow path is
# passed as the argument the script already takes, so nothing on the host is
# read or written.
#
#   bash os/shadow-reconcile-test.sh
#
# No root required. `chgrp shadow` is the one thing in the script that needs
# privilege; when it is unavailable a fake is put on PATH ahead of the real one
# and the group assertions are skipped. Which mode was taken is printed below.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT=$HERE/rootfs/overlay-v2/usr/lib/mos/mos-shadow-reconcile
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
PASS=0
FAIL=0

[ -f "$SCRIPT" ] || { echo "no $SCRIPT to test" >&2; exit 1; }

# A bcrypt hash of the shape mosd writes, and a second one standing in for the
# hash a dev image's ROOT_PASSWORD build-arg bakes in. Opaque on purpose: the
# script compares them as strings and never parses them.
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
    if find "$STATE" -name '*.transient.*' -o -name '*.reconcile.*' | grep -q .; then
        echo no
    else
        echo yes
    fi
}
group_of() { stat -c %G "$1"; }
mode_of() { stat -c %a "$1"; }

# --- 1. a marker matching the current root hash clears it --------------------
new_case matching "$(shadow_with "$MOS_HASH")"
printf '%s\n' "$MOS_HASH" >"$MARKER"
before_others=$(lines_after_root)
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "matching marker -> exit 0" "0" "$rc"
check "matching marker -> root hash becomes !" "!" "$(root_field)"
check "matching marker -> marker gone" "no" "$(exists "$MARKER")"
check "matching marker -> other lines byte-identical" "$before_others" "$(lines_after_root)"
check "matching marker -> still well formed" "yes" "$(well_formed)"
check "matching marker -> logged as cleared" "yes" \
    "$(grep -q 'transient root password cleared' <<<"$out" && echo yes || echo no)"
check "matching marker -> no temp files left" "yes" "$(no_temp_files)"
check "matching marker -> mode 0640" "640" "$(mode_of "$SHADOW")"
if [ "$GROUP_MODE" = real ]; then
    check "matching marker -> group shadow" "shadow" "$(group_of "$SHADOW")"
fi

# --- 2. a marker that does NOT match is left strictly alone ------------------
# This is the branch that lets a dev image's ROOT_PASSWORD build-arg hash
# survive a reboot, which is the whole reason this is a marker rather than
# "lock root on every boot".
new_case mismatch "$(shadow_with "$DEV_HASH")"
printf '%s\n' "$MOS_HASH" >"$MARKER"
before=$(cat "$SHADOW")
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "mismatched marker -> exit 0" "0" "$rc"
check "mismatched marker -> shadow byte-identical" "$before" "$(cat "$SHADOW")"
check "mismatched marker -> dev hash survives" "$DEV_HASH" "$(root_field)"
check "mismatched marker -> marker gone" "no" "$(exists "$MARKER")"
check "mismatched marker -> logged as not matching" "yes" \
    "$(grep -q 'does not match the current root hash' <<<"$out" && echo yes || echo no)"
check "mismatched marker -> not confused with a clear" "no" \
    "$(grep -q 'transient root password cleared' <<<"$out" && echo yes || echo no)"

# --- 3. no marker: nothing cleared, and the append rule still works ----------
new_case no-marker-converged "$(shadow_with "$DEV_HASH")"
before=$(cat "$SHADOW")
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "no marker -> exit 0" "0" "$rc"
check "no marker -> shadow byte-identical" "$before" "$(cat "$SHADOW")"
check "no marker -> converged early exit reached" "yes" \
    "$(grep -q 'already converged' <<<"$out" && echo yes || echo no)"

new_case no-marker-appends "$(shadow_with "$DEV_HASH")" "$PASSWD_WITH_NEW"
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "no marker -> exit 0 with an account to add" "0" "$rc"
check "no marker -> missing account gets a LOCKED entry" "newsvc:!" \
    "$(awk -F: '$1 == "newsvc" { print $1 ":" $2 }' "$SHADOW")"
check "no marker -> the untouched root hash still survives an append" "$DEV_HASH" \
    "$(root_field)"
check "no marker -> still well formed after the append" "yes" "$(well_formed)"

# --- 4. a marker with no root: line to act on -------------------------------
# The passwd fixture omits root too, so the append rule cannot fire and
# "otherwise unchanged" means exactly that.
new_case no-root-line "$OTHER_LINES" "$PASSWD_DAEMON_ONLY"
printf '%s\n' "$MOS_HASH" >"$MARKER"
before=$(cat "$SHADOW")
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "no root: line -> exit 0" "0" "$rc"
check "no root: line -> shadow byte-identical" "$before" "$(cat "$SHADOW")"
check "no root: line -> no root entry invented" "(none)" "$(root_field)"
check "no root: line -> marker gone" "no" "$(exists "$MARKER")"
check "no root: line -> logged as unusable" "yes" \
    "$(grep -q 'names no usable hash' <<<"$out" && echo yes || echo no)"

# --- 5. an empty marker file counts as no marker at all ---------------------
new_case empty-marker "$(shadow_with "$MOS_HASH")"
: >"$MARKER"
before=$(cat "$SHADOW")
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "empty marker -> exit 0" "0" "$rc"
check "empty marker -> shadow byte-identical" "$before" "$(cat "$SHADOW")"
check "empty marker -> hash not cleared" "$MOS_HASH" "$(root_field)"
check "empty marker -> marker gone" "no" "$(exists "$MARKER")"

# --- 6. a marker naming an EMPTY hash field ---------------------------------
# An empty field is passwordless root, not a locked account (RFCT-024), so the
# script must never write one. It takes the "change nothing" branch: a root
# field that was already empty stays empty because nothing here wrote it, and
# the file comes out byte-identical.
new_case empty-hash-marker "$(shadow_with "")"
printf '\n' >"$MARKER"
before=$(cat "$SHADOW")
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "empty-hash marker -> exit 0" "0" "$rc"
check "empty-hash marker -> shadow byte-identical" "$before" "$(cat "$SHADOW")"
check "empty-hash marker -> marker gone" "no" "$(exists "$MARKER")"
check "empty-hash marker -> logged as unusable" "yes" \
    "$(grep -q 'names no usable hash' <<<"$out" && echo yes || echo no)"
check "empty-hash marker -> the empty field was not written by this run" "yes" \
    "$([ "$before" = "$(cat "$SHADOW")" ] && echo yes || echo no)"

# The same marker against a shadow that carries a real hash: still no write, so
# a stray newline in the marker can never blank out a working credential.
new_case empty-hash-marker-real "$(shadow_with "$MOS_HASH")"
printf '\n' >"$MARKER"
before=$(cat "$SHADOW")
run_reconcile >/dev/null 2>&1 && rc=0 || rc=$?
check "empty-hash marker over a real hash -> exit 0" "0" "$rc"
check "empty-hash marker over a real hash -> hash untouched" "$MOS_HASH" "$(root_field)"
check "empty-hash marker over a real hash -> shadow byte-identical" "$before" "$(cat "$SHADOW")"

# --- 7. hostile marker content ----------------------------------------------
# Only the first line may be read, nothing may be expanded or executed, and the
# file must come out either correctly rewritten or untouched -- never malformed.
new_case hostile-two-lines "$(shadow_with "$MOS_HASH")"
printf '%s\nrm -rf /\n' "$MOS_HASH" >"$MARKER"
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "two-line marker -> exit 0" "0" "$rc"
check "two-line marker -> first line is the one that matched" "!" "$(root_field)"
check "two-line marker -> second line had no effect" "yes" "$(well_formed)"
check "two-line marker -> marker gone" "no" "$(exists "$MARKER")"

BIG=$(printf 'x%.0s' $(seq 4096))
hostile_names=(space-leading space-trailing colon dollar backtick backslash quote long)
hostile_values=(' abc12345' 'abc12345 ' 'ab:cd' 'a$(id)b' 'a`id`b' 'a\b\c' 'a"b"c' "$BIG")

for i in "${!hostile_names[@]}"; do
    name=${hostile_names[$i]}
    value=${hostile_values[$i]}

    # Direction A: the marker does not match, so the file must be untouched.
    new_case "hostile-$name-nomatch" "$(shadow_with "$DEV_HASH")"
    printf '%s\n' "$value" >"$MARKER"
    before=$(cat "$SHADOW")
    out=$(run_reconcile 2>&1) && rc=0 || rc=$?
    check "hostile $name (no match) -> exit 0" "0" "$rc"
    check "hostile $name (no match) -> shadow byte-identical" "$before" "$(cat "$SHADOW")"
    check "hostile $name (no match) -> still well formed" "yes" "$(well_formed)"
    check "hostile $name (no match) -> marker gone" "no" "$(exists "$MARKER")"
    check "hostile $name (no match) -> nothing was executed" "no" \
        "$(grep -q 'uid=' <<<"$out" && echo yes || echo no)"

    # Direction B: the same value IS the stored hash, so it must clear cleanly.
    # Skipped for the colon case: a colon inside the hash field is not a value
    # a shadow entry can carry in the first place, so there is nothing to match.
    case "$value" in *:*) continue ;; esac
    new_case "hostile-$name-match" "$(shadow_with "$value")"
    printf '%s\n' "$value" >"$MARKER"
    out=$(run_reconcile 2>&1) && rc=0 || rc=$?
    check "hostile $name (match) -> exit 0" "0" "$rc"
    check "hostile $name (match) -> cleared to !" "!" "$(root_field)"
    check "hostile $name (match) -> still well formed" "yes" "$(well_formed)"
    check "hostile $name (match) -> other lines byte-identical" "$OTHER_LINES" \
        "$(lines_after_root)
"
done

# --- 8. idempotence ---------------------------------------------------------
new_case idempotent "$(shadow_with "$MOS_HASH")"
printf '%s\n' "$MOS_HASH" >"$MARKER"
run_reconcile >/dev/null 2>&1 && rc=0 || rc=$?
check "first run -> exit 0" "0" "$rc"
first=$(cat "$SHADOW")
run_reconcile >/dev/null 2>&1 && rc=0 || rc=$?
check "second run -> exit 0" "0" "$rc"
check "second run -> same bytes" "$first" "$(cat "$SHADOW")"
check "second run -> root still locked" "!" "$(root_field)"
check "second run -> no marker resurrected" "no" "$(exists "$MARKER")"
check "second run -> no temp files left" "yes" "$(no_temp_files)"

echo
echo "$PASS passed, $FAIL failed"
echo "RESULT: $([ "$FAIL" -eq 0 ] && echo PASS || echo FAIL) ($PASS/$((PASS + FAIL)) checks)"
[ "$FAIL" -eq 0 ]
