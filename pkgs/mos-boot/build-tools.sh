#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
command -v docker >/dev/null
SNAPSHOT="$(. "$REPO/rootfs/debian/sources.env"; printf '%s' "$MIRROR")"
SNAPSHOT="${SNAPSHOT/https:\/\//http:\/\/}"
mapfile -t BASE < <(bash "$REPO/build-env/from.sh" MOS_IMAGE_DEBIAN_TRIXIE=IMAGE_DEBIAN_TRIXIE)
test "${#BASE[@]}" = 2
docker build --label ai-agent=true -t ai-agent/mos-boot-tools-amd64 \
    "${BASE[@]}" --build-arg "MOS_DEBIAN_SNAPSHOT=$SNAPSHOT" "$HERE"
