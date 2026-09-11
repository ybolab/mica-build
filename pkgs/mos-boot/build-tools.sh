#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TARGET=${MOS_BOOT_TARGET-x64}
if [ "$#" -ne 0 ]; then
    [ "$#" -eq 2 ] && [ "$1" = --target ] || {
        echo 'usage: build-tools.sh [--target {x64|aa64}]' >&2; exit 64;
    }
    [ -z "${MOS_BOOT_TARGET+x}" ] || [ "$TARGET" = "$2" ] || {
        echo 'error: conflicting boot-tools targets' >&2; exit 64;
    }
    TARGET=$2
fi
case "$TARGET" in
    x64) IMAGE_TARGET=amd64 ;;
    aa64) IMAGE_TARGET=arm64 ;;
    *) echo 'error: boot-tools target must be x64 or aa64' >&2; exit 64 ;;
esac
command -v docker >/dev/null
SNAPSHOT="$(. "$REPO/rootfs/debian/sources.env"; printf '%s' "$MIRROR")"
SNAPSHOT="${SNAPSHOT/https:\/\//http:\/\/}"
mapfile -t BASE < <(bash "$REPO/build-env/from.sh" --arch=amd64 MOS_IMAGE_DEBIAN_TRIXIE=IMAGE_DEBIAN_TRIXIE)
test "${#BASE[@]}" = 2
# The producer tools run on amd64; TARGET selects the produced EFI ABI.
docker build --platform linux/amd64 --label ai-agent=true -t "ai-agent/mos-boot-tools-$IMAGE_TARGET" \
    "${BASE[@]}" --build-arg "MOS_DEBIAN_SNAPSHOT=$SNAPSHOT" --build-arg "MOS_BOOT_TARGET=$TARGET" "$HERE"
