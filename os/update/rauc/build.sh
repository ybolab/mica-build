#!/usr/bin/env bash
# Build RAUC from upstream source for one architecture.
#
#   MOS_BOARD=x64 bash os/update/rauc/build.sh      → os/update/rauc/out-amd64/
#   MOS_BOARD=cx3576 bash os/update/rauc/build.sh   → os/update/rauc/out-arm64/
#
# Same driver shape as os/podman/build.sh, and for the same reason: the
# Dockerfile's last stage is FROM scratch and `-o` exports it, so nothing here
# writes into a rootfs. os/rootfs/Dockerfile.v2 copies the result in.
#
# WHY THE BUILD EXISTS AT ALL: os/update/rauc/versions.env.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
MOS_BOARD="${MOS_BOARD:-cx3576}"
LAYOUT_ENV="${HERE}/../../boards/${MOS_BOARD}/board.env"

if [ ! -f "${LAYOUT_ENV}" ]; then
    echo "error: ${LAYOUT_ENV} not found (MOS_BOARD=${MOS_BOARD})" >&2
    exit 1
fi
# shellcheck disable=SC1090
. "${LAYOUT_ENV}"

if [ -z "${MOS_ARCH:-}" ]; then
    echo "error: ${LAYOUT_ENV} declares no MOS_ARCH; the build would target the host's architecture and the image would refuse the binary" >&2
    exit 1
fi
OUT="${HERE}/out-${MOS_ARCH}"

# The Dockerfile's src stage COPYs versions.lock, not versions.env, so editing
# a comment does not invalidate the compile stages below it.
sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' \
    "${HERE}/versions.env" >"${HERE}/versions.lock"
if [ ! -s "${HERE}/versions.lock" ]; then
    echo "error: versions.lock came out empty from versions.env; the src stage would clone nothing and the failure would surface as a missing binary" >&2
    exit 1
fi

BUILDER_ARGS=()
if [ -z "${BUILDX_BUILDER:-}" ] && ! docker buildx inspect 2>/dev/null | grep -c "linux/${MOS_ARCH}" >/dev/null; then
    docker buildx create --name "mos-rauc-${MOS_ARCH}" --use >/dev/null 2>&1 || true
    BUILDER_ARGS=(--builder "mos-rauc-${MOS_ARCH}")
fi

rm -rf "${OUT}"
mkdir -p "${OUT}"

docker buildx build "${BUILDER_ARGS[@]}" \
    --platform "linux/${MOS_ARCH}" \
    --build-arg "MOS_RAUC_STRICT=${MOS_RAUC_STRICT:-0}" \
    -f "${HERE}/Dockerfile" \
    -o "${OUT}" \
    "${HERE}"

# The exported tree, re-checked. The build stage asserts what it BUILT; this
# asserts what landed on disk for os/rootfs/build-v2.sh to stage. An export
# that dropped a file, or a cache hit that served an older layer, is invisible
# to the first check and caught here.
missing=""
for f in rauc rauc.service rauc-service.sh de.pengutronix.rauc.conf de.pengutronix.rauc.service NEEDED.txt SHA256SUMS RAUC_VERSION.env; do
    [ -f "${OUT}/${f}" ] || missing="${missing} ${f}"
done
if [ -n "${missing}" ]; then
    echo "error: the export is missing:${missing}" >&2
    exit 1
fi
if grep -ciE 'curl|gnutls' "${OUT}/NEEDED.txt" >/dev/null; then
    echo "error: the exported rauc links curl or GnuTLS; see os/update/rauc/versions.env for why that is the one thing this build must not do" >&2
    cat "${OUT}/NEEDED.txt" >&2
    exit 1
fi

echo "rauc $(sed -n 's/^RAUC_VERSION=//p' "${OUT}/RAUC_VERSION.env") for ${MOS_ARCH}: $(stat -c%s "${OUT}/rauc") bytes, $(grep -c . "${OUT}/NEEDED.txt") shared libraries"
sed 's/^/  /' "${OUT}/NEEDED.txt"
