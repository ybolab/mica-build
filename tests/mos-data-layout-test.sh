#!/usr/bin/env bash
# Offline contract tests for the Phase-A /mos data-layout migration.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT=$HERE/../rootfs/overlay/usr/lib/mos/mos-data-layout
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

[ -x "$SCRIPT" ] || { echo "no executable $SCRIPT to test" >&2; exit 1; }

new_case() {
    CASE=$WORK/$1
    SRV=$CASE/srv
    mkdir -p "$SRV"
}

run_layout() {
    MOS_DATA_ROOT=$SRV "$SCRIPT"
}

fail() { echo "FAIL $*" >&2; exit 1; }

new_case fresh
run_layout
for name in ui containers home root; do
    [ "$(readlink "$SRV/$name")" = ".mos/$name" ] || fail "$name compatibility link"
    [ -d "$SRV/.mos/$name" ] || fail "$name canonical directory"
done
for name in updates/downloads updates/verified updates/staging apps; do
    [ -d "$SRV/.mos/$name" ] || fail "$name writable system directory"
done
[ "$(cat "$SRV/.mos/.layout-version")" = 1 ] || fail "layout marker"
[ "$(stat -c %a "$SRV/.mos")" = 755 ] || fail "system root mode"
[ "$(stat -c %a "$SRV/.mos/ui")" = 755 ] || fail "UI root mode"
[ "$(stat -c %a "$SRV/.mos/containers")" = 711 ] || fail "container root mode"
[ "$(stat -c %a "$SRV/.mos/home")" = 755 ] || fail "home backing mode"
[ "$(stat -c %a "$SRV/.mos/root")" = 700 ] || fail "root backing mode"

# A pre-existing legacy tree is renamed, not copied, and the old spelling
# remains usable through a relative link (including from an old A/B slot).
new_case migrate
mkdir -p "$SRV/ui/assets" "$SRV/home/mos"
printf 'keep\n' >"$SRV/ui/assets/app.js"
printf 'keep\n' >"$SRV/home/mos/file"
run_layout
[ "$(cat "$SRV/.mos/ui/assets/app.js")" = keep ] || fail "UI migration preserved bytes"
[ "$(cat "$SRV/ui/assets/app.js")" = keep ] || fail "legacy UI path still resolves"
[ "$(cat "$SRV/home/mos/file")" = keep ] || fail "legacy home path still resolves"
before=$(find "$SRV" -printf '%P|%y|%l\n' | sort)
run_layout
after=$(find "$SRV" -printf '%P|%y|%l\n' | sort)
[ "$before" = "$after" ] || fail "second run is not idempotent"

# Both real trees means authority is ambiguous. Refuse without deleting or
# moving either side; this is the rollback-safety boundary.
new_case collision
mkdir -p "$SRV/ui" "$SRV/.mos/ui"
printf 'legacy\n' >"$SRV/ui/value"
printf 'canonical\n' >"$SRV/.mos/ui/value"
if run_layout >/dev/null 2>&1; then
    fail "collision was accepted"
fi
[ "$(cat "$SRV/ui/value")" = legacy ] || fail "collision changed legacy tree"
[ "$(cat "$SRV/.mos/ui/value")" = canonical ] || fail "collision changed canonical tree"

# A foreign link must not be followed or replaced.
new_case foreign-link
mkdir -p "$CASE/outside"
ln -s "$CASE/outside" "$SRV/ui"
if run_layout >/dev/null 2>&1; then
    fail "foreign compatibility link was accepted"
fi
[ "$(readlink "$SRV/ui")" = "$CASE/outside" ] || fail "foreign link was replaced"

# The system namespace itself and a canonical child must always be real
# directories. Following either link would let a writable DATA entry redirect
# privileged services outside the owned namespace.
new_case foreign-system-root
mkdir -p "$CASE/outside"
ln -s "$CASE/outside" "$SRV/.mos"
if run_layout >/dev/null 2>&1; then
    fail "symbolic .mos root was accepted"
fi
[ "$(readlink "$SRV/.mos")" = "$CASE/outside" ] || fail "symbolic .mos root was replaced"

new_case foreign-canonical-link
mkdir -p "$SRV/.mos" "$CASE/outside"
ln -s "$CASE/outside" "$SRV/.mos/ui"
ln -s .mos/ui "$SRV/ui"
if run_layout >/dev/null 2>&1; then
    fail "symbolic canonical UI directory was accepted"
fi
[ "$(readlink "$SRV/.mos/ui")" = "$CASE/outside" ] || fail "canonical link was replaced"

echo "PASS mos data layout migration"
