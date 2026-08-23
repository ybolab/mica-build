#!/usr/bin/env bash
# Build the container engine from upstream source into seven aarch64 binaries.
#
#   [MOS_PODMAN_STRICT=1] bash os/podman/build.sh
#   → os/podman/out/{podman,quadlet,crun,conmon,netavark,aardvark-dns,catatonit}
#
# A script rather than a bare `docker buildx build` in the Makefile, for one
# reason: the builder selection below. The first run of this build failed with
# `exec /bin/sh: exec format error` because the default buildx builder cannot
# execute linux/arm64 — and os/rootfs/build-v2.sh had already solved exactly
# that, with the same fallback, forty lines of its own. Duplicating the
# invocation in a Makefile recipe would have duplicated the bug too.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${HERE}/out"

for tool in docker; do
    command -v "${tool}" >/dev/null 2>&1 || {
        echo "error: ${tool} is required and not on PATH" >&2
        exit 1
    }
done

# If the current builder cannot run linux/arm64 (host binfmt registration
# unavailable), fall back to a docker-container builder: its buildkit image
# bundles QEMU emulators and needs no host binfmt. Same reasoning, same builder
# name and same condition as os/rootfs/build-v2.sh, deliberately: two ways to
# get an arm64 builder would be two things to keep working.
BUILDER_ARGS=()
if [ -z "${BUILDX_BUILDER:-}" ] && ! docker buildx inspect 2>/dev/null | grep -q 'linux/arm64'; then
    echo "note: current builder lacks linux/arm64; using docker-container builder 'mos-arm64'"
    docker buildx inspect mos-arm64 >/dev/null 2>&1 ||
        docker buildx create --name mos-arm64 --driver docker-container >/dev/null
    BUILDER_ARGS=(--builder mos-arm64)
fi

# NO image-libs.txt, and no rootfs prerequisite. An earlier revision generated
# a soname list out of the PACKED rootfs and had the verify stage diff every
# binary's NEEDED against it. That was wrong twice over:
#
#   * It checked the PREVIOUS image. The binaries built here go into the NEXT
#     one, whose package list this build has not seen.
#   * It was a cycle. os/rootfs/build-v2.sh now stages os/podman/out, so the
#     rootfs needed the engine and the engine's check needed the rootfs; a
#     clean checkout could build neither.
#
# The check moved to os/rootfs/Dockerfile.v2, where it runs `ldd` against the
# real binaries in the assembled root under emulation. That is the loader's own
# answer about the image being shipped, not a list compared to a list.


# The Dockerfile's src stage COPYs this, not versions.env itself, so that
# editing a comment in versions.env does not invalidate every compile stage
# below it. Comments and blank lines out, nothing else touched.
sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' \
    "${HERE}/versions.env" >"${HERE}/versions.lock"
if [ ! -s "${HERE}/versions.lock" ]; then
    echo "error: versions.lock came out empty from versions.env; the src stage would clone nothing and the failure would surface as a missing binary" >&2
    exit 1
fi

rm -rf "${OUT}"
mkdir -p "${OUT}"

docker buildx build "${BUILDER_ARGS[@]}" \
    --platform linux/arm64 \
    --build-arg "MOS_PODMAN_STRICT=${MOS_PODMAN_STRICT:-0}" \
    -f "${HERE}/Dockerfile" \
    -o "${OUT}" \
    "${HERE}"

# The Dockerfile's own stage already refuses a wrong-architecture artifact, a
# dynamically linked catatonit, or a NEEDED soname the image does not carry. This re-checks the EXPORTED tree, which is a different claim: the
# stage asserts what it built, this asserts what landed on disk for
# os/rootfs/build-v2.sh to stage. An export that dropped a file, or a cache hit
# that served an older layer, is invisible to the first check and caught here.
missing=""
for b in podman quadlet crun conmon catatonit netavark aardvark-dns; do
    [ -f "${OUT}/${b}" ] || missing="${missing} ${b}"
done
[ -z "${missing}" ] || {
    echo "error: the build reported success but these binaries are not in ${OUT}:${missing}" >&2
    exit 1
}

echo
echo "=== ${OUT} ==="
for b in podman quadlet crun conmon catatonit netavark aardvark-dns; do
    printf '  %-14s %8s KiB  %s\n' "${b}" \
        "$(($(stat -c%s "${OUT}/${b}") / 1024))" \
        "$(file -b "${OUT}/${b}" 2>/dev/null | cut -c1-46)"
done
total=$(du -sb "${OUT}" | cut -f1)
printf '  %-14s %8s KiB\n' "TOTAL" "$((total / 1024))"
