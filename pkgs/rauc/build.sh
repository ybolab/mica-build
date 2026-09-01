#!/usr/bin/env bash
# Build RAUC from upstream source for one architecture.
#
#   MOS_BOARD=x64 bash pkgs/rauc/build.sh      → pkgs/rauc/out-amd64/
#   MOS_BOARD=cx3576 bash pkgs/rauc/build.sh   → pkgs/rauc/out-arm64/
#
# Same driver shape as pkgs/podman/build.sh, and for the same reason: the
# Dockerfile's last stage is FROM scratch and `-o` exports it, so nothing here
# writes into a rootfs. rootfs/scripts/rauc-install.sh copies the result in.
#
# Why the build exists at all: pkgs/rauc/versions.env.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
FROM_SH="${REPO_ROOT}/build-env/from.sh"
[ -f "${FROM_SH}" ] || {
    echo "error: ${FROM_SH} does not exist. pkgs/rauc/build.sh derives REPO_ROOT as three levels above itself; if this file moved, that arithmetic moved with it" >&2
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

# The builder is NAMED rather than inherited, and named rather than pinned --
# the same BUILDX_BUILDER register as rootfs/build.sh. BUILDX_BUILDER wins,
# because a caller who names a builder has made a decision; with nothing named,
# `default` is the docker driver on every docker installation. What must not
# happen is inheriting the ambient selection: a leftover `mos-rauc-arm64` from
# an unrelated build is a plausible current builder on any host that has ever
# run `make os-rauc`.

# `default` reaches linux/${MOS_ARCH} exactly when the host has binfmt
# registered for it. When it does not, this no longer refuses: it selects the
# `mos-${MOS_ARCH}` docker-container builder, whose buildkit image bundles the
# emulators and needs no host registration -- same name and creation path as
# tests/quadlet-doc-test.sh, so there is one way to get a
# cross-capable builder in this tree. That it genuinely executes the target
# architecture is measured rather than inspected: `docker buildx ls` reports
# mos-arm64 as linux/amd64 (+3), linux/386 on this host, and a throwaway
# `FROM localhost/mos-build-base` + `RUN uname -m` built with
# `--builder mos-arm64 --platform linux/arm64` printed aarch64.

# What that driver cannot do is resolve a `localhost/mos-build-*` FROM: it has
# its own content store and reads `localhost/` as a registry hostname, measured
# here as `Head "http://localhost/v2/mos-build-base/manifests/latest": dial tcp
# [::1]:80: connect: connection refused` against a FROM line that is correct.
# That is closed below rather than refused: build-env/from.sh --contexts=
# hands the bases over as CONTENT, as OCI layouts named after the tags they
# came from, and the Dockerfile keeps saying FROM ${MOS_BUILD_C}.
if [ -n "${BUILDX_BUILDER:-}" ]; then
    echo "note: using the builder BUILDX_BUILDER names (${BUILDX_BUILDER})"
    BUILDER="${BUILDX_BUILDER}"
else
    # The whole output is captured BEFORE anything reads it, rather than piped
    # into a grep. An early-exiting `grep -q` on the right of a pipe closes it
    # the moment it matches; under `set -o pipefail` the producer then dies of
    # SIGPIPE and the PIPELINE reports failure exactly when the pattern IS
    # found -- so this would pick the container builder on the hosts that can
    # build natively, intermittently, depending on whether the output fit the
    # pipe buffer first. tests/shell-pipefail-lint.sh exists for this one
    # mistake and caught this line.
    default_platforms="$(docker buildx inspect default 2>/dev/null || true)"
    if printf '%s\n' "${default_platforms}" | grep -c "linux/${MOS_ARCH}" >/dev/null; then
        BUILDER=default
    else
        BUILDER="mos-${MOS_ARCH}"
        docker buildx inspect "${BUILDER}" >/dev/null 2>&1 ||
            docker buildx create --name "${BUILDER}" --driver docker-container >/dev/null
    fi
fi
BUILDER_ARGS=(--builder "${BUILDER}")

# Which driver it turned out to be decides whether the bases go over as tags or
# as layouts, so it is read off the builder rather than inferred from its name:
# BUILDX_BUILDER may name anything.
builder_inspect="$(docker buildx inspect "${BUILDER}" 2>/dev/null || true)"
BUILDER_DRIVER="$(printf '%s\n' "${builder_inspect}" | sed -n 's/^Driver:[[:space:]]*//p')"
[ -n "${BUILDER_DRIVER}" ] || {
    echo "error: \`docker buildx inspect ${BUILDER}\` names no driver, so this build cannot tell whether that builder can resolve a localhost/mos-build-* tag or has to be handed the bases as OCI layouts. Either the builder does not exist or it is not running: \`docker buildx ls\` lists what does" >&2
    exit 1
}

# The refusal that is left, and it is about the one builder this script may not
# replace. A caller who named BUILDX_BUILDER named it deliberately, so a
# docker-driver builder on a host with no binfmt for ${MOS_ARCH} is a dead end
# here rather than something to silently route around -- and it is refused now
# instead of surfacing as `exec /bin/sh: exec format error` inside a compile
# stage. Note what it does NOT say any more: host binfmt is no longer what this
# build needs, only what THAT builder needs.
if [ "${BUILDER_DRIVER}" = docker ] &&
    ! printf '%s\n' "${builder_inspect}" | grep -c "linux/${MOS_ARCH}" >/dev/null; then
    echo "error: the buildx builder '${BUILDER}' uses the docker driver and does not offer linux/${MOS_ARCH} on this host, so every RUN in pkgs/rauc/Dockerfile would fail with 'exec format error'. Either register the emulator on the HOST -- docker run --privileged --rm tonistiigi/binfmt --install ${MOS_ARCH} -- or unset BUILDX_BUILDER and let this script select the docker-container builder 'mos-${MOS_ARCH}', whose buildkit image bundles the emulators and needs no host registration" >&2
    exit 1
fi

rm -rf "${OUT}"
mkdir -p "${OUT}"

# The two builder images, resolved out of build-env/images.env before
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
    echo "error: build-env/from.sh did not yield the two builder images (see its message above); this build would have run with an unpinned or missing FROM" >&2
    exit 1
}

# The same two images a second time, as content, for a builder that cannot read
# the local image store. Only for that builder: with the docker driver the tags
# above resolve directly, and exporting them anyway would copy the whole
# mos-build family to disk on every native build to change nothing.
#
# A temporary directory rather than a path in the tree, because the layouts are
# a copy of what the image store already holds -- they have no life beyond this
# build and nothing may ever read them as an input to the next one.
CTX_ARGS=()
if [ "${BUILDER_DRIVER}" != docker ]; then
    OCI_DIR="$(mktemp -d)"
    trap 'rm -rf "${OCI_DIR}"' EXIT
    mapfile -t CTX_ARGS < <("${FROM_SH}" --arch="${MOS_ARCH}" --contexts="${OCI_DIR}" \
        LOCAL_MOS_BUILD_BASE \
        LOCAL_MOS_BUILD_C)
    [ "${#CTX_ARGS[@]}" -eq 4 ] || {
        echo "error: build-env/from.sh did not yield the two OCI layout contexts (see its message above); the '${BUILDER}' builder would have resolved the FROM lines as pulls from a registry called 'localhost'" >&2
        exit 1
    }
fi

docker buildx build "${BUILDER_ARGS[@]}" \
    --platform "linux/${MOS_ARCH}" \
    "${FROM_ARGS[@]}" \
    ${CTX_ARGS[@]+"${CTX_ARGS[@]}"} \
    -f "${HERE}/Dockerfile" \
    -o "${OUT}" \
    "${HERE}"

# The exported tree, re-checked. The build stage asserts what it BUILT; this
# asserts what landed on disk for rootfs/build.sh to stage. An export
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
    echo "error: the exported rauc links curl or GnuTLS; see pkgs/rauc/versions.env for why that is the one thing this build must not do" >&2
    cat "${OUT}/NEEDED.txt" >&2
    exit 1
fi

echo "rauc $(sed -n 's/^RAUC_VERSION=//p' "${OUT}/RAUC_VERSION.env") for ${MOS_ARCH}: $(stat -c%s "${OUT}/rauc") bytes, $(grep -c . "${OUT}/NEEDED.txt") shared libraries"
sed 's/^/  /' "${OUT}/NEEDED.txt"
