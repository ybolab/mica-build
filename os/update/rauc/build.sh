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
FROM_SH="${REPO_ROOT}/os/build-env/from.sh"
[ -f "${FROM_SH}" ] || {
    echo "error: ${FROM_SH} does not exist. os/update/rauc/build.sh derives REPO_ROOT as three levels above itself; if this file moved, that arithmetic moved with it" >&2
    exit 1
}
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

# THE BUILDER: `default`, EXPLICITLY, AND WHY THIS FILE CANNOT INHERIT ONE.
# Until RFCT-108 M2c this block picked a docker-container builder whenever the
# ambient one could not reach linux/${MOS_ARCH}, and passed no --builder
# otherwise -- inheriting whatever `docker buildx use` last selected.
#
# Neither is possible any more, and the reason is the switchover itself: every
# stage below is now FROM a localhost/mos-build-* tag, which exists only in the
# LOCAL DOCKER IMAGE STORE. Only the `docker` driver can resolve one. A
# docker-container builder has its own content store and treats `localhost/` as
# a registry HOSTNAME, producing `dial tcp [::1]:80: connect: connection
# refused` against a FROM line that is correct -- measured by M2b, and the same
# reason os/build-env/build.sh pins itself to `default`. Inheriting was worse
# still: a leftover `mos-rauc-arm64` from an unrelated build is a plausible
# ambient selection on any host that has ever run `make os-rauc`.
#
# So the emulation fallback becomes a REFUSAL, and it is deliberately phrased
# around what is missing rather than around this host's architecture: the
# default builder reaches linux/${MOS_ARCH} exactly when the host has binfmt
# registered for it, and on such a host this build works cross-architecture with
# no change to this file. What it needs beyond that is an mos-build-* family
# built FOR that architecture, which os/build-env/from.sh checks next and
# RFCT-108's M2b note describes.
BUILDER_ARGS=(--builder default)
if ! docker buildx inspect default 2>/dev/null | grep -q "linux/${MOS_ARCH}"; then
    echo "error: the 'default' buildx builder does not offer linux/${MOS_ARCH} on this host, and it is the only builder that can be used here: every stage of os/update/rauc/Dockerfile is FROM a localhost/mos-build-* tag, which lives in the local docker image store, and a docker-container builder treats 'localhost/' as a registry hostname. Register the emulator on the HOST -- docker run --privileged --rm tonistiigi/binfmt --install ${MOS_ARCH} -- so that the default builder can reach it; a docker-container builder would not help" >&2
    exit 1
fi

rm -rf "${OUT}"
mkdir -p "${OUT}"

# The two builder images, resolved out of os/build-env/images.env before
# anything is built. --arch is passed because a localhost tag carries exactly
# ONE architecture, unlike the multi-architecture digests images.env pins for
# upstream bases: MOS_BOARD=cx3576 against an amd64 builder family has to be
# refused by name rather than as "no match for platform in manifest" pointing at
# a FROM line that is correct.
mapfile -t FROM_ARGS < <("${FROM_SH}" --arch="${MOS_ARCH}" \
    MOS_BUILD_BASE=LOCAL_MOS_BUILD_BASE \
    MOS_BUILD_C=LOCAL_MOS_BUILD_C)
# mapfile cannot fail, so its status says nothing about the process inside the
# substitution; an empty array is what a refusal looks like from here, and an
# empty array would build with no --build-arg at all.
[ "${#FROM_ARGS[@]}" -eq 4 ] || {
    echo "error: os/build-env/from.sh did not yield the two builder images (see its message above); this build would have run with an unpinned or missing FROM" >&2
    exit 1
}

docker buildx build "${BUILDER_ARGS[@]}" \
    --platform "linux/${MOS_ARCH}" \
    "${FROM_ARGS[@]}" \
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
