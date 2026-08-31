#!/usr/bin/env bash
# Build one producer's Debian packages for one architecture. THE driver: every
# producer in this repository is built by this script and no other.
#
#   bash os/build-env/deb/build.sh --producer mosd --arch amd64
#   bash os/build-env/deb/build.sh --producer mos-ca-trust --arch all
#
#   -> _out/debs/<arch>/pool/<package>_<version>_<arch>.deb
#
# What a producer IS lives in os/build-env/deb/producers.sh and in
# os/build-env/deb/README.md; what a producer SAYS lives in its producer.env.
# This script is the thing that reads the second and runs a build from it, so
# adding a producer is adding a directory and never editing a driver.
#
# PACKAGING RUNS AT THE TARGET ARCHITECTURE. dpkg-shlibdeps resolves an ELF's
# dependencies against the libraries installed next to it, and
# os/build-env/deb/pack.sh refuses an arm64 payload in an amd64 container rather
# than recording amd64's versions in it. This host has no binfmt registration,
# so `docker run --platform linux/arm64` is not a route -- it dies with `exec
# format error`. buildx on the `mos-<arch>` docker-container builder is, because
# its buildkit image bundles the emulators.
#
# ANYTHING THAT IS NOT PACKAGING -- compiling a binary, generating a payload --
# is the producer's own business and runs in its PREPARE hook, on the host,
# before the build. The hook is what carries the parts of a producer that no
# key in producer.env could express; see README.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
FROM_SH="${REPO_ROOT}/os/build-env/from.sh"
VERSION_SH="${HERE}/version.sh"
PRODUCERS_SH="${HERE}/producers.sh"
for p in "${REPO_ROOT}/Makefile" "${FROM_SH}" "${VERSION_SH}" "${PRODUCERS_SH}"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. os/build-env/deb/build.sh derives the repository as three levels above itself; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done

command -v docker >/dev/null 2>&1 || {
    echo "error: docker is required and not on PATH. The packaging runs in a container -- the host carries no dpkg -- which is what makes the packer a value os/build-env/images.env records" >&2
    exit 1
}

PRODUCER=""
ARCH=""
while [ "$#" -gt 0 ]; do
    case "$1" in
    --producer)
        PRODUCER="${2-}"
        [ -n "${PRODUCER}" ] || { echo "error: --producer takes a producer name" >&2; exit 1; }
        shift 2
        ;;
    --arch)
        ARCH="${2-}"
        [ -n "${ARCH}" ] || { echo "error: --arch takes amd64, arm64 or all" >&2; exit 1; }
        shift 2
        ;;
    *)
        echo "usage: bash os/build-env/deb/build.sh --producer <name> --arch <amd64|arm64|all>" >&2
        exit 1
        ;;
    esac
done
[ -n "${PRODUCER}" ] || { echo "error: --producer is required; there is no default producer, because a build that picked one would package a subset nobody asked for" >&2; exit 1; }
[ -n "${ARCH}" ] || { echo "error: --arch is required; guessing the host's would silently produce amd64 packages for a cx3576 image" >&2; exit 1; }

# Discovery resolves the name, and refuses one it does not know by name.
PRODUCER_REL="$(bash "${PRODUCERS_SH}" --dir-for "${PRODUCER}")"
PRODUCER_DIR="${REPO_ROOT}/${PRODUCER_REL}"

# producer.env is plain KEY=value in the os/boards/*/board.env discipline.
PACKAGES=""
ARCHES=""
BUILD_CONTEXTS=""
FROM_IMAGES=""
BUILD_ARGS=""
PREPARE=""
# shellcheck disable=SC1091
. "${PRODUCER_DIR}/producer.env"

# producers.sh has already refused an empty or malformed PACKAGES/ARCHES, so
# this only has to decide whether THIS arch is one the producer builds. A
# producer asked for an architecture it does not declare would otherwise write
# an archive into a pool it never meant to be in.
in_arches=0
for a in ${ARCHES}; do [ "${a}" != "${ARCH}" ] || in_arches=1; done
[ "${in_arches}" = 1 ] || {
    echo "error: the producer '${PRODUCER}' declares ARCHES='${ARCHES}' and was asked for --arch ${ARCH}. That architecture is not one it builds; ${PRODUCER_REL}/producer.env is where that list lives" >&2
    exit 1
}

VERSION="$(bash "${VERSION_SH}")"
[ -n "${VERSION}" ] || {
    echo "error: ${VERSION_SH} printed no version (see its message above); the archives would be named around an empty string" >&2
    exit 1
}

# SOURCE_DATE_EPOCH is the commit's timestamp, resolved on the HOST: the
# container sees this worktree through a bind mount whose .git is a file naming
# a gitdir outside it, so git in there reports `not a git repository`. pack.sh
# has no default for it and fails by name if it is unset.
#
# A dirty tree keeps the same commit timestamp rather than taking `now`. The
# version already says `.dirty`, so the archive is marked as one that no commit
# reproduces; moving the clamp forward would only make two dirty builds of one
# tree differ from each other as well, which is the property worth keeping.
git -C "${REPO_ROOT}" rev-parse --git-dir >/dev/null 2>&1 || {
    echo "error: ${REPO_ROOT} is not a git checkout. SOURCE_DATE_EPOCH is HEAD's timestamp and has no defensible value here without git; a fallback would make every archive irreproducible while every build stayed green" >&2
    exit 1
}
SOURCE_DATE_EPOCH="$(git -C "${REPO_ROOT}" log -1 --format=%ct)"
[ -n "${SOURCE_DATE_EPOCH}" ] || {
    echo "error: \`git log -1 --format=%ct\` produced no commit timestamp in ${REPO_ROOT}" >&2
    exit 1
}

case "$(uname -m)" in
x86_64) HOST_ARCH=amd64 ;;
aarch64 | arm64) HOST_ARCH=arm64 ;;
*)
    echo "error: $(uname -m) is not an architecture os/build-env/images.env builds a mos-build-deb for, so there is no container to pack in" >&2
    exit 1
    ;;
esac

# THE POOLS THIS BUILD WRITES, and the architecture the container runs at.
#
# `all` is the interesting case. An Architecture: all archive has no ELF, so
# there is nothing for dpkg-shlibdeps to resolve and pack.sh exempts it from the
# container-architecture check -- it is built ONCE, at the host's architecture,
# needing no emulation. It is then a valid member of EVERY pool, so the one
# build writes BOTH, with two exporters rather than two builds: two builds would
# be two chances to produce two different archives for one package name, and the
# composer resolves each pool independently.
if [ "${ARCH}" = all ]; then
    DEB_ARCH=all
    BUILD_PLATFORM="${HOST_ARCH}"
    POOL_ARCHES=(amd64 arm64)
else
    DEB_ARCH="${ARCH}"
    BUILD_PLATFORM="${ARCH}"
    POOL_ARCHES=("${ARCH}")
fi

# A small staging directory rather than whatever the hook compiled in place: a
# cargo target directory is gigabytes of intermediates and buildx would walk all
# of it. tmp/ is gitignored and under the worktree, which is where anything a
# container must see lives -- the docker daemon does not share this session's
# /tmp.
STAGE="${REPO_ROOT}/tmp/deb-${PRODUCER}-${ARCH}"
rm -rf "${STAGE}"
mkdir -p "${STAGE}"

# ------------------------------------------------------------ the hook
#
# Everything a producer needs done BEFORE packaging: cross-compiling its
# binaries, generating a payload, and asserting whatever the producer is willing
# to claim about what it just produced. It runs on the host, and what it leaves
# in ${MOS_DEB_STAGE} arrives in the build as the `bin` context.
if [ -n "${PREPARE}" ]; then
    hook="${PRODUCER_DIR}/${PREPARE}"
    [ -f "${hook}" ] || {
        echo "error: ${PRODUCER_REL}/producer.env names PREPARE=${PREPARE} and ${PRODUCER_REL}/${PREPARE} does not exist. The hook is the producer's own half of its build; a named one that is absent means the payload is never produced and the pack below would stage nothing" >&2
        exit 1
    }
    echo "build.sh: ${PRODUCER} running PREPARE hook ${PRODUCER_REL}/${PREPARE} for ${ARCH}"
    MOS_DEB_REPO_ROOT="${REPO_ROOT}" \
        MOS_DEB_PRODUCER="${PRODUCER}" \
        MOS_DEB_PRODUCER_DIR="${PRODUCER_DIR}" \
        MOS_DEB_ARCH="${ARCH}" \
        MOS_DEB_STAGE="${STAGE}" \
        MOS_DEB_VERSION="${VERSION}" \
        SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH}" \
        bash "${hook}"
    # A hook that ran and staged nothing is a hook whose output the Dockerfile
    # will not find, and the failure would surface as a COPY error naming a
    # context rather than naming the hook.
    [ -n "$(ls -A "${STAGE}")" ] || {
        echo "error: the PREPARE hook ${PRODUCER_REL}/${PREPARE} reported success and left ${STAGE} empty. That directory is the 'bin' build context this producer's Dockerfile copies from" >&2
        exit 1
    }
fi

# ------------------------------------------------------------ the build

# Builder selection, the same register os/pkgs/rauc/build.sh keeps and for the
# same reasons: BUILDX_BUILDER wins because a caller who named a builder made a
# decision; with nothing named, `default` is used when it reaches the platform
# and the `mos-<arch>` docker-container builder otherwise. What must not happen
# is inheriting the ambient selection -- a leftover `mos-rauc-arm64` from an
# unrelated build is the current builder on any host that has run `make os-rauc`.
if [ -n "${BUILDX_BUILDER:-}" ]; then
    echo "note: using the builder BUILDX_BUILDER names (${BUILDX_BUILDER})"
    BUILDER="${BUILDX_BUILDER}"
else
    # Captured before it is read, never piped into an early-exiting reader:
    # `producer | grep -q` dies of SIGPIPE under pipefail and inverts its own
    # answer. os/tests/shell-pipefail-lint.sh exists for that one mistake.
    default_platforms="$(docker buildx inspect default 2>/dev/null || true)"
    if [ "${#POOL_ARCHES[@]}" -eq 1 ] && printf '%s\n' "${default_platforms}" | grep -c "linux/${BUILD_PLATFORM}" >/dev/null; then
        BUILDER=default
    else
        # Two exporters need a builder the docker driver cannot be: `docker`
        # accepts one output per build. An `all` producer therefore always takes
        # the docker-container builder, which is also the one that can emulate.
        BUILDER="mos-${BUILD_PLATFORM}"
        docker buildx inspect "${BUILDER}" >/dev/null 2>&1 ||
            docker buildx create --name "${BUILDER}" --driver docker-container >/dev/null
    fi
fi

# Read off the builder rather than inferred from its name -- BUILDX_BUILDER may
# name anything -- because the driver is what decides whether the base goes over
# as a tag or as content.
builder_inspect="$(docker buildx inspect "${BUILDER}" 2>/dev/null || true)"
BUILDER_DRIVER="$(printf '%s\n' "${builder_inspect}" | sed -n 's/^Driver:[[:space:]]*//p')"
[ -n "${BUILDER_DRIVER}" ] || {
    echo "error: \`docker buildx inspect ${BUILDER}\` names no driver, so this build cannot tell whether that builder can resolve a localhost/mos-build-deb tag or has to be handed it as an OCI layout. Either the builder does not exist or it is not running: \`docker buildx ls\` lists what does" >&2
    exit 1
}
if [ "${BUILDER_DRIVER}" = docker ] &&
    ! printf '%s\n' "${builder_inspect}" | grep -c "linux/${BUILD_PLATFORM}" >/dev/null; then
    echo "error: the buildx builder '${BUILDER}' uses the docker driver and does not offer linux/${BUILD_PLATFORM} on this host, so pack.sh would fail with 'exec format error' before it read a single control field. Either register the emulator on the HOST -- docker run --privileged --rm tonistiigi/binfmt --install ${BUILD_PLATFORM} -- or unset BUILDX_BUILDER and let this script select the docker-container builder 'mos-${BUILD_PLATFORM}', whose buildkit image bundles the emulators and needs no host registration" >&2
    exit 1
fi
if [ "${BUILDER_DRIVER}" = docker ] && [ "${#POOL_ARCHES[@]}" -gt 1 ]; then
    echo "error: the buildx builder '${BUILDER}' uses the docker driver, which accepts one --output per build, and the producer '${PRODUCER}' is Architecture: all and writes ${#POOL_ARCHES[@]} pools from one build. Unset BUILDX_BUILDER and let this script select the docker-container builder" >&2
    exit 1
fi

# The base images the producer's Dockerfile takes as build arguments. Named in
# producer.env rather than fixed here, because a producer that packs a payload
# somebody else compiled needs only the packer, and one that does its own work
# in the Dockerfile may need more.
#
# IMAGE_ARCH is the architecture of the CONTAINER the packing runs in, which for
# an `all` producer is the host's -- there is no ELF in the payload to resolve
# against a foreign architecture's libraries.
IMAGE_ARCH="${BUILD_PLATFORM}"
FROM_ARGS=()
OCI_DIRS=()
for entry in ${FROM_IMAGES}; do
    argname="${entry%%=*}"
    key="${entry#*=}"
    [ -n "${argname}" ] && [ -n "${key}" ] && [ "${argname}" != "${entry}" ] || {
        echo "error: ${PRODUCER_REL}/producer.env declares FROM_IMAGES entry '${entry}', which is not <build-arg name>=<images.env key>. os/build-env/from.sh takes that pair and it is the whole wiring between a Dockerfile's ARG and an images.env digest" >&2
        exit 1
    }
    mapfile -t got < <(bash "${FROM_SH}" --arch="${IMAGE_ARCH}" "${argname}=${key}")
    [ "${#got[@]}" -eq 2 ] || {
        echo "error: os/build-env/from.sh did not resolve ${argname}=${key} for ${IMAGE_ARCH} (see its message above); the builder images are built by \`make build-env\`" >&2
        exit 1
    }
    FROM_ARGS+=("${got[@]}")

    # The same image a second time, as content, for a builder that cannot read
    # the local image store: every driver but `docker` has its own content store
    # and reads `localhost/` as a registry hostname. Only for that builder --
    # exporting it otherwise would copy 300 MB to disk on every native build to
    # change nothing.
    case "${key}" in
    LOCAL_*)
        if [ "${BUILDER_DRIVER}" != docker ]; then
            oci="${REPO_ROOT}/tmp/deb-oci-${PRODUCER}-${ARCH}-${key}"
            rm -rf "${oci}"
            mkdir -p "${oci}"
            OCI_DIRS+=("${oci}")
            mapfile -t ctx < <(bash "${FROM_SH}" --arch="${IMAGE_ARCH}" --contexts="${oci}" "${key}")
            [ "${#ctx[@]}" -eq 2 ] || {
                echo "error: os/build-env/from.sh did not yield the OCI layout context for ${key} at ${IMAGE_ARCH} (see its message above); the '${BUILDER}' builder would have resolved the FROM as a pull from a registry called 'localhost'" >&2
                exit 1
            }
            FROM_ARGS+=("${ctx[@]}")
        fi
        ;;
    esac
done
cleanup() { for d in ${OCI_DIRS[@]+"${OCI_DIRS[@]}"}; do rm -rf "${d}"; done; }
trap cleanup EXIT

# pack.sh always, as a named context rather than out of the image, because it is
# the packaging CONTRACT and an edit to it must take effect without rebuilding
# the whole builder family. The staging directory the hook wrote is `bin`.
CTX_ARGS=(--build-context "packer=${HERE}")
[ -z "${PREPARE}" ] || CTX_ARGS+=(--build-context "bin=${STAGE}")
for entry in ${BUILD_CONTEXTS}; do
    name="${entry%%=*}"
    path="${entry#*=}"
    [ -n "${name}" ] && [ -n "${path}" ] && [ "${name}" != "${entry}" ] || {
        echo "error: ${PRODUCER_REL}/producer.env declares BUILD_CONTEXTS entry '${entry}', which is not <context name>=<repository-relative path>" >&2
        exit 1
    }
    [ -e "${REPO_ROOT}/${path}" ] || {
        echo "error: ${PRODUCER_REL}/producer.env declares the build context '${name}=${path}' and ${path} does not exist. buildx would resolve a missing local context as a remote one and fail naming neither" >&2
        exit 1
    }
    CTX_ARGS+=(--build-context "${name}=${REPO_ROOT}/${path}")
done

ARG_ARGS=(
    --build-arg "MOS_DEB_VERSION=${VERSION}"
    --build-arg "MOS_DEB_ARCH=${DEB_ARCH}"
    --build-arg "SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}"
)
for entry in ${BUILD_ARGS}; do
    ARG_ARGS+=(--build-arg "${entry}")
done

# This producer's own archives only, out of every pool it writes. The pool is
# shared -- os/build-env/deb/repo.sh indexes every .deb in it -- so a wholesale
# clean here would delete another producer's output, while leaving the previous
# VERSION of this one behind would have repo.sh index two versions of one
# package.
OUT_ARGS=()
for pool_arch in "${POOL_ARCHES[@]}"; do
    pool="${REPO_ROOT}/_out/debs/${pool_arch}/pool"
    mkdir -p "${pool}"
    for p in ${PACKAGES}; do
        rm -f "${pool}/${p}"_*.deb
    done
    OUT_ARGS+=(-o "type=local,dest=${pool}")
done

echo "build.sh: packing ${PACKAGES} ${VERSION} as ${DEB_ARCH} on builder '${BUILDER}' (${BUILDER_DRIVER}) into ${POOL_ARCHES[*]}"
docker buildx build --builder "${BUILDER}" \
    --platform "linux/${BUILD_PLATFORM}" \
    "${FROM_ARGS[@]}" \
    "${CTX_ARGS[@]}" \
    "${ARG_ARGS[@]}" \
    -f "${PRODUCER_DIR}/Dockerfile" \
    "${OUT_ARGS[@]}" \
    "${PRODUCER_DIR}"

# What landed on disk, not what the build stage said it wrote. An export that
# dropped a file, or a cache hit that served an older layer, is invisible to
# pack.sh's own read-back and caught here.
missing=""
for pool_arch in "${POOL_ARCHES[@]}"; do
    pool="${REPO_ROOT}/_out/debs/${pool_arch}/pool"
    for p in ${PACKAGES}; do
        [ -f "${pool}/${p}_${VERSION}_${DEB_ARCH}.deb" ] || missing="${missing} ${pool_arch}/${p}_${VERSION}_${DEB_ARCH}.deb"
    done
done
if [ -n "${missing}" ]; then
    echo "error: the export is missing:${missing} under ${REPO_ROOT}/_out/debs" >&2
    exit 1
fi

# The two exports of an `all` build are one archive by construction, and this is
# the assertion of it: the composer resolves each pool on its own, so two pools
# holding different bytes under one filename is a device whose package set
# depends on which pool it was installed from.
if [ "${#POOL_ARCHES[@]}" -gt 1 ]; then
    first="${POOL_ARCHES[0]}"
    for p in ${PACKAGES}; do
        for pool_arch in "${POOL_ARCHES[@]:1}"; do
            a="${REPO_ROOT}/_out/debs/${first}/pool/${p}_${VERSION}_${DEB_ARCH}.deb"
            b="${REPO_ROOT}/_out/debs/${pool_arch}/pool/${p}_${VERSION}_${DEB_ARCH}.deb"
            cmp -s "${a}" "${b}" || {
                echo "error: ${p} was exported to the ${first} and ${pool_arch} pools from ONE build and the two archives differ. An Architecture: all package is one archive that is a member of every pool" >&2
                exit 1
            }
        done
    done
fi

rm -rf "${STAGE}"
for pool_arch in "${POOL_ARCHES[@]}"; do
    for p in ${PACKAGES}; do
        echo "${REPO_ROOT}/_out/debs/${pool_arch}/pool/${p}_${VERSION}_${DEB_ARCH}.deb"
    done
done
