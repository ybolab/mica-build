#!/usr/bin/env bash
# Exercise first-boot /var initialization and persistent state retention.
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fail() { echo "FAIL $*" >&2; exit 1; }
mkdir -p "$work/data/var" "$work/template/lib/service" "$work/template/tmp"
chmod 0700 "$work/template/lib/service"
chmod 1777 "$work/template/tmp"
printf 'factory\n' >"$work/template/lib/service/config"
ln -s /run "$work/template/run"
seed() { MOS_DATA_ROOT="$work/data" MOS_VAR_TEMPLATE="$work/template" sh "$repo/rootfs/overlay/usr/lib/mica/mica-seed-var"; }
seed
[ "$(cat "$work/data/var/lib/service/config")" = factory ] || fail 'factory content'
[ "$(stat -c %a "$work/data/var/lib/service")" = 700 ] || fail 'private mode'
[ "$(stat -c %a "$work/data/var/tmp")" = 1777 ] || fail 'temporary mode'
[ "$(readlink "$work/data/var/run")" = /run ] || fail 'runtime symlink'
printf 'runtime\n' >"$work/data/var/lib/service/config"
mkdir "$work/data/var/lib/new-service"
seed
[ "$(cat "$work/data/var/lib/service/config")" = runtime ] || fail 'persistent content replaced'
[ -d "$work/data/var/lib/new-service" ] || fail 'new service state lost'
rm "$work/data/var/lib/service/config"
seed
[ ! -e "$work/data/var/lib/service/config" ] || fail 'deleted state restored after initialization'
mv "$work/data/var" "$work/kept-var"
ln -s "$work/kept-var" "$work/data/var"
if seed >"$work/refusal.log" 2>&1; then fail 'symbolic var accepted'; fi
echo 'PASS persistent var initialization'
