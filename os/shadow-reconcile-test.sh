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

# A bcrypt hash of the shape mosd writes, and a second one standing in for a
# hash mosd did NOT write (set by hand over the serial console, or by a future
# provisioning path -- on v2 no buildable image can BAKE one, since the pack
# stage fails a factory shadow with a usable hash). Opaque on purpose: the
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
# This is the branch that lets a root hash mosd did not write survive a
# reboot, which is the whole reason this is a marker rather than "lock root on
# every boot": the reconciler may only clear a credential it owns.
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

# --- 9. shadow files whose final line is NOT newline-terminated (RFCT-038) ---
# The reconcile path copies $SHADOW and then appends missing entries with `>>`.
# If the copy's final line carries no terminator the first appended entry lands
# on that line, welding two accounts into one malformed record -- and the
# welded account then no longer matches the `grep -q "^${user}:"` guard, so the
# next boot appends it again and the damage compounds.
#
# new_case above writes "exactly one trailing newline, whether the body arrived
# through a command substitution or as a plain variable". That normalisation is
# what kept this invisible: it guaranteed the one input shape the append path
# could not mishandle. Everything below deliberately does not normalise.

# Same sandbox as new_case, but the shadow body is written VERBATIM.
new_case_raw() {
    CASE=$WORK/case-$1
    STATE=$CASE/state
    SHADOW=$STATE/shadow
    MARKER=$STATE/transient-root-password
    rm -rf "$CASE"
    mkdir -p "$STATE"
    printf '%s' "$2" >"$SHADOW"
    chmod 0640 "$SHADOW"
    printf '%s' "${3:-$PASSWD_BOTH}" >"$CASE/passwd"
    printf '%s' "$FACTORY_BODY" >"$CASE/factory"
}

# The whole file as a flat hex string. Every byte comparison in this section
# goes through od: `$(cat file)` strips trailing newlines, so it reports a
# terminated and an unterminated file as EQUAL, which is precisely the
# difference under test here.
file_hex() { od -An -tx1 "$1" | tr -d ' \n'; }

# yes when the last byte is a newline. An empty file answers no: it has no
# final line to terminate.
ends_with_newline() {
    [ "$(tail -c 1 "$1" | od -An -tx1 | tr -d ' \n')" = "0a" ] && echo yes || echo no
}

# awk counts an unterminated final line as a record; `wc -l` does not, and
# would silently under-count exactly the fixtures below.
line_count() { awk 'END { print NR }' "$1"; }
blank_lines() { awk '/^$/ { n++ } END { print n + 0 }' "$1"; }

# yes when every NON-EMPTY line has nine fields. Distinct from well_formed,
# which also rejects blank lines: a blank line a fixture itself carried is not
# something the script created, and preserving it is the correct behaviour.
well_formed_nonblank() {
    awk -F: 'NF == 0 { next } NF != 9 { bad = 1 } END { exit bad ? 1 : 0 }' "$1" \
        && echo yes || echo no
}

# Run the case a second time and assert it is a fixed point. This is the half
# that catches a fix which "repairs" a converged file into a fresh write.
check_idempotent() {
    local name=$1 after rc2
    after=$(file_hex "$SHADOW")
    run_reconcile >/dev/null 2>&1 && rc2=0 || rc2=$?
    check "$name -> second run exits 0" "0" "$rc2"
    check "$name -> second run byte-identical" "$after" "$(file_hex "$SHADOW")"
    check "$name -> second run leaves no temp files" "yes" "$(no_temp_files)"
}

ROOT_DEV_LINE="root:${DEV_HASH}:19000:0:99999:7:::"
ROOT_MOS_LINE="root:${MOS_HASH}:19000:0:99999:7:::"
DAEMON_LINE='daemon:*:19000:0:99999:7:::'
# Two lines, NO terminator on the second. Built with $'\n' rather than a
# command substitution, which would strip the very bytes under test.
UNTERMINATED="${ROOT_DEV_LINE}"$'\n'"${DAEMON_LINE}"
UNTERM_MOS="${ROOT_MOS_LINE}"$'\n'"${DAEMON_LINE}"
# The same two lines followed by TWO newlines, i.e. one trailing blank line.
MULTI_NEWLINE="${ROOT_DEV_LINE}"$'\n'"${DAEMON_LINE}"$'\n\n'

# 9.1 unterminated, and an account still needs an entry.
new_case_raw unterminated-append "$UNTERMINATED" "$PASSWD_WITH_NEW"
check "unterminated fixture -> really has no terminator" "no" "$(ends_with_newline "$SHADOW")"
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "unterminated + append -> exit 0" "0" "$rc"
check "unterminated + append -> every line has nine fields" "yes" "$(well_formed "$SHADOW")"
check "unterminated + append -> three lines, nothing welded" "3" "$(line_count "$SHADOW")"
check "unterminated + append -> root line byte-identical" "$ROOT_DEV_LINE" \
    "$(sed -n '1p' "$SHADOW")"
check "unterminated + append -> previously-final line byte-identical" "$DAEMON_LINE" \
    "$(sed -n '2p' "$SHADOW")"
check "unterminated + append -> new entry is line three" "newsvc" \
    "$(awk -F: 'NR == 3 { print $1 }' "$SHADOW")"
check "unterminated + append -> new entry is LOCKED" "newsvc:!" \
    "$(awk -F: '$1 == "newsvc" { print $1 ":" $2 }' "$SHADOW")"
check "unterminated + append -> exactly one newsvc line" "1" \
    "$(grep -c '^newsvc:' "$SHADOW" || true)"
check "unterminated + append -> daemon and newsvc never share a line" "0" \
    "$(grep -c 'daemon.*newsvc' "$SHADOW" || true)"
check "unterminated + append -> result is terminated" "yes" "$(ends_with_newline "$SHADOW")"
check "unterminated + append -> no temp files left" "yes" "$(no_temp_files)"
check_idempotent "unterminated + append"

# 9.2 unterminated, but nothing to add: the file must NOT be rewritten. With no
# append there is nothing that can be welded, so repairing the terminator here
# would be a gratuitous write to a credential store.
new_case_raw unterminated-converged "$UNTERMINATED"
before=$(file_hex "$SHADOW")
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "unterminated + converged -> exit 0" "0" "$rc"
check "unterminated + converged -> byte-identical" "$before" "$(file_hex "$SHADOW")"
check "unterminated + converged -> still unterminated" "no" "$(ends_with_newline "$SHADOW")"
check "unterminated + converged -> converged message" "yes" \
    "$(grep -q 'already converged' <<<"$out" && echo yes || echo no)"
check "unterminated + converged -> nothing logged as added" "no" \
    "$(grep -q 'added locked entry' <<<"$out" && echo yes || echo no)"
check "unterminated + converged -> no temp files left" "yes" "$(no_temp_files)"
check_idempotent "unterminated + converged"

# 9.3 empty shadow file: entries land, and no blank first line is introduced.
new_case_raw empty-shadow ""
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "empty shadow -> exit 0" "0" "$rc"
check "empty shadow -> two entries land" "2" "$(line_count "$SHADOW")"
check "empty shadow -> no blank lines at all" "0" "$(blank_lines "$SHADOW")"
check "empty shadow -> first line is root" "root" "$(awk -F: 'NR == 1 { print $1 }' "$SHADOW")"
check "empty shadow -> root entry is locked" "!" "$(root_field)"
check "empty shadow -> every line has nine fields" "yes" "$(well_formed "$SHADOW")"
check "empty shadow -> result is terminated" "yes" "$(ends_with_newline "$SHADOW")"
check_idempotent "empty shadow"

# 9.4 a single unterminated line.
new_case_raw single-unterminated "$ROOT_DEV_LINE"
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "single unterminated line -> exit 0" "0" "$rc"
check "single unterminated line -> two lines, nothing welded" "2" "$(line_count "$SHADOW")"
check "single unterminated line -> original line byte-identical" "$ROOT_DEV_LINE" \
    "$(sed -n '1p' "$SHADOW")"
check "single unterminated line -> daemon on its own line" "daemon:*" \
    "$(awk -F: 'NR == 2 { print $1 ":" $2 }' "$SHADOW")"
check "single unterminated line -> every line has nine fields" "yes" "$(well_formed "$SHADOW")"
check "single unterminated line -> root hash untouched" "$DEV_HASH" "$(root_field)"
check "single unterminated line -> result is terminated" "yes" "$(ends_with_newline "$SHADOW")"
check_idempotent "single unterminated line"

# 9.5 a file ending in MULTIPLE newlines, both directions.
new_case_raw multi-newline-append "$MULTI_NEWLINE" "$PASSWD_WITH_NEW"
before_blanks=$(blank_lines "$SHADOW")
before_lines=$(line_count "$SHADOW")
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "multi-newline + append -> exit 0" "0" "$rc"
check "multi-newline + append -> no blank line invented" "$before_blanks" \
    "$(blank_lines "$SHADOW")"
check "multi-newline + append -> exactly one line gained" "$((before_lines + 1))" \
    "$(line_count "$SHADOW")"
check "multi-newline + append -> every non-blank line has nine fields" "yes" \
    "$(well_formed_nonblank "$SHADOW")"
check "multi-newline + append -> new entry is LOCKED" "newsvc:!" \
    "$(awk -F: '$1 == "newsvc" { print $1 ":" $2 }' "$SHADOW")"
check "multi-newline + append -> exactly one newsvc line" "1" \
    "$(grep -c '^newsvc:' "$SHADOW" || true)"
check "multi-newline + append -> new entry is not glued to a blank line" "0" \
    "$(grep -c '^:.*newsvc' "$SHADOW" || true)"
check "multi-newline + append -> the two seeded accounts survive" "2" \
    "$(grep -c -e '^root:' -e '^daemon:' "$SHADOW" || true)"
check_idempotent "multi-newline + append"

new_case_raw multi-newline-converged "$MULTI_NEWLINE"
before=$(file_hex "$SHADOW")
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "multi-newline + converged -> exit 0" "0" "$rc"
check "multi-newline + converged -> byte-identical" "$before" "$(file_hex "$SHADOW")"
check "multi-newline + converged -> converged message" "yes" \
    "$(grep -q 'already converged' <<<"$out" && echo yes || echo no)"
check_idempotent "multi-newline + converged"

# 9.6 the transient-marker path against an unterminated file, both directions.
# That path rewrites the whole file through awk rather than appending to it, and
# awk's `print` supplies ORS, so its output is always terminated and it cannot
# weld. These cases prove that rather than assuming it.
new_case_raw unterminated-transient-match "$UNTERM_MOS"
printf '%s\n' "$MOS_HASH" >"$MARKER"
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "unterminated + matching marker -> exit 0" "0" "$rc"
check "unterminated + matching marker -> root cleared to !" "!" "$(root_field)"
check "unterminated + matching marker -> two lines, nothing welded" "2" \
    "$(line_count "$SHADOW")"
check "unterminated + matching marker -> daemon line byte-identical" "$DAEMON_LINE" \
    "$(sed -n '2p' "$SHADOW")"
check "unterminated + matching marker -> every line has nine fields" "yes" \
    "$(well_formed "$SHADOW")"
check "unterminated + matching marker -> marker gone" "no" "$(exists "$MARKER")"
check "unterminated + matching marker -> logged as cleared" "yes" \
    "$(grep -q 'transient root password cleared' <<<"$out" && echo yes || echo no)"
check "unterminated + matching marker -> the rewrite terminated the file" "yes" \
    "$(ends_with_newline "$SHADOW")"
check "unterminated + matching marker -> no temp files left" "yes" "$(no_temp_files)"
check_idempotent "unterminated + matching marker"

new_case_raw unterminated-transient-mismatch "$UNTERMINATED"
printf '%s\n' "$MOS_HASH" >"$MARKER"
before=$(file_hex "$SHADOW")
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "unterminated + mismatched marker -> exit 0" "0" "$rc"
check "unterminated + mismatched marker -> byte-identical" "$before" "$(file_hex "$SHADOW")"
check "unterminated + mismatched marker -> still unterminated" "no" \
    "$(ends_with_newline "$SHADOW")"
check "unterminated + mismatched marker -> dev hash survives" "$DEV_HASH" "$(root_field)"
check "unterminated + mismatched marker -> marker gone" "no" "$(exists "$MARKER")"
check "unterminated + mismatched marker -> logged as not matching" "yes" \
    "$(grep -q 'does not match the current root hash' <<<"$out" && echo yes || echo no)"
check "unterminated + mismatched marker -> not confused with a clear" "no" \
    "$(grep -q 'transient root password cleared' <<<"$out" && echo yes || echo no)"
check_idempotent "unterminated + mismatched marker"

# The interaction: the marker does not match, so the transient path writes
# nothing and leaves the file unterminated -- and the append path immediately
# after it has to cope with exactly that.
new_case_raw unterminated-transient-mismatch-append "$UNTERMINATED" "$PASSWD_WITH_NEW"
printf '%s\n' "$MOS_HASH" >"$MARKER"
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "unterminated + mismatch + append -> exit 0" "0" "$rc"
check "unterminated + mismatch + append -> three lines, nothing welded" "3" \
    "$(line_count "$SHADOW")"
check "unterminated + mismatch + append -> previously-final line byte-identical" \
    "$DAEMON_LINE" "$(sed -n '2p' "$SHADOW")"
check "unterminated + mismatch + append -> new entry is LOCKED" "newsvc:!" \
    "$(awk -F: '$1 == "newsvc" { print $1 ":" $2 }' "$SHADOW")"
check "unterminated + mismatch + append -> every line has nine fields" "yes" \
    "$(well_formed "$SHADOW")"
check "unterminated + mismatch + append -> dev hash survives" "$DEV_HASH" "$(root_field)"
check "unterminated + mismatch + append -> marker gone" "no" "$(exists "$MARKER")"
check_idempotent "unterminated + mismatch + append"

# 9.7 lock_entry fed from an UNTERMINATED factory template. lock_entry pipes
# through `echo` and awk, and both supply a terminator, so the entry it appends
# is exactly one terminated line however the factory file ends. The shadow file
# here is unterminated too, so this exercises both write paths at once.
new_case_raw unterminated-factory "$ROOT_DEV_LINE"
printf '%s\n%s' 'root:!:19000:0:99999:7:::' "$DAEMON_LINE" >"$CASE/factory"
check "unterminated factory fixture -> really has no terminator" "no" \
    "$(ends_with_newline "$CASE/factory")"
out=$(run_reconcile 2>&1) && rc=0 || rc=$?
check "unterminated factory -> exit 0" "0" "$rc"
check "unterminated factory -> two lines, nothing welded" "2" "$(line_count "$SHADOW")"
check "unterminated factory -> appended entry on its own line" "daemon:*" \
    "$(awk -F: 'NR == 2 { print $1 ":" $2 }' "$SHADOW")"
check "unterminated factory -> the aging fields came from the template" \
    "19000:0:99999:7:::" "$(awk -F: 'NR == 2 { print $3 ":" $4 ":" $5 ":" $6 ":" $7 ":" $8 ":" $9 }' "$SHADOW")"
check "unterminated factory -> every line has nine fields" "yes" "$(well_formed "$SHADOW")"
check "unterminated factory -> result is terminated" "yes" "$(ends_with_newline "$SHADOW")"
check_idempotent "unterminated factory"

echo
echo "$PASS passed, $FAIL failed"
echo "RESULT: $([ "$FAIL" -eq 0 ] && echo PASS || echo FAIL) ($PASS/$((PASS + FAIL)) checks)"
[ "$FAIL" -eq 0 ]
