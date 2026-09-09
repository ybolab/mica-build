#!/usr/bin/env bash
# Offline contract tests for the direct development-stage DATA layout.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT=$HERE/../rootfs/overlay/usr/lib/mos/mos-data-layout
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/bin"
cat >"$WORK/bin/stat" <<'SH'
#!/bin/sh
if [ "$1" = -f ]; then printf '65536 4096 16384\n'; else /usr/bin/stat "$@"; fi
SH
for command in chattr setquota; do
    printf '#!/bin/sh\nprintf "%%s\\n" "$*" >>"$MOS_QUOTA_CALLS"\n' >"$WORK/bin/$command"
done
chmod +x "$WORK/bin/"*
export PATH="$WORK/bin:$PATH"
export MOS_QUOTA_CALLS="$WORK/quotas.log"

[ -x "$SCRIPT" ] || { echo "no executable $SCRIPT to test" >&2; exit 1; }

new_case() {
    CASE=$WORK/$1
    DATA=$CASE/data
    mkdir -p "$DATA"
}

run_layout() {
    MOS_DATA_ROOT=$DATA "$SCRIPT"
}

fail() { echo "FAIL $*" >&2; exit 1; }

new_case fresh
run_layout
for name in state meta cache tmp; do
    [ -d "$DATA/$name" ] && [ ! -L "$DATA/$name" ] || fail "$name namespace"
done
[ "$(stat -c %a "$DATA/state")" = 700 ] || fail "state namespace mode"
[ "$(stat -c %a "$DATA/meta")" = 700 ] || fail "metadata namespace mode"
[ "$(stat -c %a "$DATA/tmp")" = 1777 ] || fail "temporary namespace mode"
grep -Fx -- "-P 100 0 98304 0 12288 $DATA" "$MOS_QUOTA_CALLS" >/dev/null || fail "bulk reserve budget"
grep -Fx -- "-P 101 0 32768 0 2048 $DATA" "$MOS_QUOTA_CALLS" >/dev/null || fail "disposable budget"

for name in ui config containers home root diagnostics; do
    [ -d "$DATA/mos/$name" ] || fail "$name canonical directory"
    [ ! -L "$DATA/mos/$name" ] || fail "$name canonical directory is a link"
done
for name in updates/downloads updates/verified updates/staging apps; do
    [ -d "$DATA/mos/$name" ] || fail "$name writable system directory"
done
[ -d "$DATA/srv" ] && [ ! -L "$DATA/srv" ] || fail "user root"
[ ! -e "$DATA/.mos" ] && [ ! -L "$DATA/.mos" ] || fail "legacy .mos root remains"
[ ! -e "$DATA/mos/.layout-version" ] || fail "obsolete layout marker remains"
[ "$(stat -c %a "$DATA/mos")" = 755 ] || fail "system root mode"
[ "$(stat -c %a "$DATA/srv")" = 755 ] || fail "user root mode"
[ "$(stat -c %a "$DATA/mos/ui")" = 755 ] || fail "UI root mode"
[ "$(stat -c %a "$DATA/mos/containers")" = 711 ] || fail "container root mode"
[ "$(stat -c %a "$DATA/mos/home")" = 755 ] || fail "home backing mode"
[ "$(stat -c %a "$DATA/mos/root")" = 700 ] || fail "root backing mode"
# The configuration namespace is credential material (PLAN-070 section 5.2.4):
# 0700 here, 0600 on every document mosd writes into it.
[ "$(stat -c %a "$DATA/mos/config")" = 700 ] || fail "config namespace mode"
[ "$(stat -c %a "$DATA/mos/diagnostics")" = 700 ] || fail "diagnostics namespace mode"

# Existing content in either final namespace is preserved, and initialization
# is idempotent.
printf 'keep\n' >"$DATA/mos/ui/value"
printf 'user\n' >"$DATA/srv/value"
run_layout
[ "$(cat "$DATA/mos/ui/value")" = keep ] || fail "system content was changed"
[ "$(cat "$DATA/srv/value")" = user ] || fail "user content was changed"
before=$(find "$DATA" -printf '%P|%y|%l\n' | sort)
run_layout
after=$(find "$DATA" -printf '%P|%y|%l\n' | sort)
[ "$before" = "$after" ] || fail "second run is not idempotent"

# The two namespace roots must be real directories. Following either link
# would redirect privileged or user writes outside DATA.
new_case foreign-system-link
mkdir -p "$CASE/outside"
ln -s "$CASE/outside" "$DATA/mos"
if run_layout >/dev/null 2>&1; then
    fail "symbolic system root was accepted"
fi
[ "$(readlink "$DATA/mos")" = "$CASE/outside" ] || fail "symbolic system root was replaced"

new_case foreign-user-link
mkdir -p "$CASE/outside"
ln -s "$CASE/outside" "$DATA/srv"
if run_layout >/dev/null 2>&1; then
    fail "symbolic user root was accepted"
fi
[ "$(readlink "$DATA/srv")" = "$CASE/outside" ] || fail "symbolic user root was replaced"

for name in state meta cache tmp; do
    new_case "foreign-$name-link"
    mkdir -p "$CASE/outside"
    ln -s "$CASE/outside" "$DATA/$name"
    if run_layout >/dev/null 2>&1; then fail "symbolic $name namespace was accepted"; fi
    [ -z "$(find "$CASE/outside" -mindepth 1 -print -quit)" ] || fail "followed $name link"
done


# Capacity failure occurs before any unbounded writer can start.
new_case undersized
cat >"$WORK/bin/stat" <<'SH'
#!/bin/sh
if [ "$1" = -f ]; then printf '32768 4096 8192\n'; else /usr/bin/stat "$@"; fi
SH
if run_layout >"$WORK/undersized.log" 2>&1; then fail 'undersized DATA accepted'; fi
grep -c 'too small' "$WORK/undersized.log" >/dev/null || fail 'missing capacity diagnosis'

echo "PASS direct mos data layout"
