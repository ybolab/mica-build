#!/usr/bin/env bash
# Install an already verified archive set, honoring Pre-Depends without APT.
# mos-build-side: container -- run inside the bootstrap chroot or the composed Docker stage.
set -eo pipefail
export LC_ALL=C DEBIAN_FRONTEND=noninteractive
helper=$1
shift
[ "$#" -gt 0 ] || exit 0
work=$(mktemp -d)
dpkg-deb -x "$helper" "$work/helper"
DEBOOTSTRAP_DIR=$work/helper/usr/share/debootstrap
. "$DEBOOTSTRAP_DIR/functions"
# The upstream functions register their own exit handler when sourced.
trap 'rm -rf "$work"' EXIT

# Reuse Debian's pre-dependency traversal over metadata from the verified debs.
# The temporary index is local input, never an APT source or network endpoint.
TARGET=$work
ARCH=$(dpkg --print-architecture)
ARCH_ALL_SUPPORTED=0
MIRRORS=file:///mos-locked
SUITE=locked
EXTRA_SUITES=
COMPONENTS=main
APTSTATE=var/lib/apt
DLDEST=apt_dest
index=$work/var/lib/apt/lists/_mos-locked_dists_locked_main_binary-${ARCH}_Packages
mkdir -p "$(dirname "$index")"
declare -A paths
for deb; do
    name=$(dpkg-deb -f "$deb" Package)
    paths[$name]=$deb
    dpkg-deb -f "$deb" >>"$index"
    printf 'Filename: %s\nSize: %s\n\n' "$deb" "$(stat -c %s "$deb")" >>"$index"
done
dpkg --update-avail "$index"
printf '%s install\n' "${!paths[@]}" | dpkg --set-selections
installed=$(dpkg-query -W -f='${Package} ${db:Status-Status}\n' | awk '$2 == "installed" { print $1 }')
while stanza=$(dpkg --predep-package); do
    name=$(sed -n 's/^Package: //p' <<<"$stanza")
    [ -n "$name" ] || { echo 'error: empty dpkg pre-dependency selection' >&2; exit 1; }
    dependencies=$(without "$(resolve_deps "$name")" "$installed")
    archives=()
    for dependency in $dependencies; do
        [ -n "${paths[$dependency]:-}" ] || { echo "error: unlocked pre-dependency: $dependency" >&2; exit 1; }
        archives+=("${paths[$dependency]}")
    done
    [ "${#archives[@]}" -gt 0 ] || { echo "error: unresolved pre-dependency: $name" >&2; exit 1; }
    dpkg --install "${archives[@]}"
    installed="$installed $dependencies"
done
dpkg --unpack --skip-same-version "$@"
dpkg --configure -a
