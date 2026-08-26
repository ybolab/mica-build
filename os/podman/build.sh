#!/usr/bin/env bash
# Build the container engine from upstream source into seven aarch64 binaries.
#
#   bash os/podman/build.sh
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
# Two levels up, proved rather than assumed: os/build-env/from.sh is reached
# through it, and a relative path here would resolve against whatever directory
# the caller happened to be in. os-bundle-cx3576 spent two merges broken on
# exactly that.
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
FROM_SH="${REPO_ROOT}/os/build-env/from.sh"
[ -f "${FROM_SH}" ] || {
    echo "error: ${FROM_SH} does not exist. os/podman/build.sh derives REPO_ROOT as two levels above itself; if this file moved, that arithmetic moved with it" >&2
    exit 1
}

# MOS_ARCH selects the target. The output directory follows it, so an arm64 and
# an amd64 set can coexist: one shared out/ would mean every board switch is a
# full recompile of four language toolchains, and -- worse -- a stale out/ from
# the other architecture looks exactly like a fresh one to anything that only
# checks the files are present.
MOS_ARCH="${MOS_ARCH:-arm64}"
case "${MOS_ARCH}" in
arm64) ELF_ARCH=aarch64 ;;
amd64) ELF_ARCH=x86-64 ;;
*) echo "error: MOS_ARCH is '${MOS_ARCH}'; it must be arm64 or amd64" >&2; exit 1 ;;
esac
OUT="${HERE}/out-${MOS_ARCH}"

for tool in docker; do
    command -v "${tool}" >/dev/null 2>&1 || {
        echo "error: ${tool} is required and not on PATH" >&2
        exit 1
    }
done

# THE BUILDER: `default`, EXPLICITLY, AND WHY THIS FILE CANNOT INHERIT ONE.
# An earlier arrangement picked a docker-container builder whenever the
# ambient one could not reach linux/${MOS_ARCH}, and passed no --builder
# otherwise -- inheriting whatever `docker buildx use` last selected.
#
# Neither is possible any more, and the reason is the switchover itself: every
# stage below is now FROM a localhost/mos-build-* tag, which exists only in the
# LOCAL DOCKER IMAGE STORE. Only the `docker` driver can resolve one. A
# docker-container builder has its own content store and treats `localhost/` as
# a registry HOSTNAME, producing `dial tcp [::1]:80: connect: connection
# refused` against a FROM line that is correct, which is the same reason
# os/build-env/build.sh pins itself to `default`. Inheriting is worse still: a
# leftover `mos-rauc-arm64` from an unrelated build is a plausible ambient
# selection on any host that has ever run `make os-rauc`.
#
# So the emulation fallback becomes a REFUSAL, and it is deliberately phrased
# around what is missing rather than around this host's architecture: the
# default builder reaches linux/${MOS_ARCH} exactly when the host has binfmt
# registered for it, and on such a host this build works cross-architecture with
# no change to this file. What it needs beyond that is an mos-build-* family
# built FOR that architecture, which os/build-env/from.sh checks next.
BUILDER_ARGS=(--builder default)
# The whole output is captured BEFORE anything reads it, rather than piped into
# a grep. An early-exiting `grep -q` on the right of a pipe closes it the moment
# it matches; under `set -o pipefail` the producer then dies of SIGPIPE and the
# PIPELINE reports failure exactly when the pattern IS found -- so the refusal
# below would fire on the hosts that can build, intermittently, depending on
# whether the output fit the pipe buffer first. os/tests/shell-pipefail-lint.sh
# exists for this one mistake and caught this line.
default_platforms="$(docker buildx inspect default 2>/dev/null || true)"
if ! printf '%s\n' "${default_platforms}" | grep -c "linux/${MOS_ARCH}" >/dev/null; then
    echo "error: the 'default' buildx builder does not offer linux/${MOS_ARCH} on this host, and it is the only builder that can be used here: every stage of os/podman/Dockerfile is FROM a localhost/mos-build-* tag, which lives in the local docker image store, and a docker-container builder treats 'localhost/' as a registry hostname. Register the emulator on the HOST -- docker run --privileged --rm tonistiigi/binfmt --install ${MOS_ARCH} -- so that the default builder can reach it; a docker-container builder would not help" >&2
    exit 1
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
# The check moved to os/rootfs/scripts/podman-assert.sh, where it runs `ldd`
# against the
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

# THE FOUR BUILDER IMAGES, resolved out of os/build-env/images.env before
# anything is deleted or built. os/podman/Dockerfile declares them with no
# defaults, so a missing one is refused here by name -- with the command that
# makes it -- rather than by docker, which reports a missing localhost tag as a
# failed pull from a registry called `localhost`.
#
# --arch IS PASSED, and it is the check this switchover added. A local tag
# carries exactly ONE architecture, unlike the multi-architecture digests
# images.env pins for upstream bases, so `MOS_ARCH=arm64 make podman` against an
# amd64 builder family has to be refused. Left to docker it surfaces as "no
# match for platform in manifest" against a FROM line that is correct.
mapfile -t FROM_ARGS < <("${FROM_SH}" --arch="${MOS_ARCH}" \
    MOS_BUILD_BASE=LOCAL_MOS_BUILD_BASE \
    MOS_BUILD_C=LOCAL_MOS_BUILD_C \
    MOS_BUILD_GO=LOCAL_MOS_BUILD_GO \
    MOS_BUILD_RUST=LOCAL_MOS_BUILD_RUST)
# mapfile itself cannot fail, so its exit status says nothing about the process
# inside the substitution; an empty array is what a refusal looks like from
# here, and an empty array would build with no --build-arg at all.
[ "${#FROM_ARGS[@]}" -eq 8 ] || {
    echo "error: os/build-env/from.sh did not yield the four builder images (see its message above); this build would have run with an unpinned or missing FROM" >&2
    exit 1
}

rm -rf "${OUT}"
mkdir -p "${OUT}"

docker buildx build "${BUILDER_ARGS[@]}" \
    --platform "linux/${MOS_ARCH}" \
    "${FROM_ARGS[@]}" \
    --build-arg "ELF_ARCH=${ELF_ARCH}" \
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
