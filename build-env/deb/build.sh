#!/usr/bin/env bash
# Build one producer's Debian packages for one architecture. THE driver: every
# producer in this repository is built by this script and no other.
#
#   bash build-env/deb/build.sh --producer mosd --arch amd64
#   bash build-env/deb/build.sh --producer mos-ca-trust --arch all
#
#   -> _out/debs/<arch>/pool/<package>_<version>_<arch>.deb
#
# What a producer IS lives in build-env/deb/producers.sh and in
# build-env/deb/README.md; what a producer SAYS lives in its producer.env.
# This script is the thing that reads the second and runs a build from it, so
# adding a producer is adding a directory and never editing a driver.
#
# PACKAGING RUNS AT THE TARGET ARCHITECTURE. dpkg-shlibdeps resolves an ELF's
# dependencies against the libraries installed next to it, and
# build-env/deb/pack.sh refuses an arm64 payload in an amd64 container rather
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
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
FROM_SH="${REPO_ROOT}/build-env/from.sh"
VERSION_SH="${HERE}/version.sh"
PRODUCERS_SH="${HERE}/producers.sh"
for p in "${REPO_ROOT}/Makefile" "${FROM_SH}" "${VERSION_SH}" "${PRODUCERS_SH}"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. build-env/deb/build.sh derives the repository as two levels above itself; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done

command -v docker >/dev/null 2>&1 || {
    echo "error: docker is required and not on PATH. The packaging runs in a container -- the host carries no dpkg -- which is what makes the packer a value build-env/images.env records" >&2
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
        echo "usage: bash build-env/deb/build.sh --producer <name> --arch <amd64|arm64|all>" >&2
        exit 1
        ;;
    esac
done
[ -n "${PRODUCER}" ] || { echo "error: --producer is required; there is no default producer, because a build that picked one would package a subset nobody asked for" >&2; exit 1; }
[ -n "${ARCH}" ] || { echo "error: --arch is required; guessing the host's would silently produce amd64 packages for a cx3576 image" >&2; exit 1; }

# Discovery resolves the name, and refuses one it does not know by name.
PRODUCER_REL="$(bash "${PRODUCERS_SH}" --dir-for "${PRODUCER}")"
PRODUCER_DIR="${REPO_ROOT}/${PRODUCER_REL}"
PRODUCER_ENV="${PRODUCER_DIR}/producer.env"

# THE SHAPE, CHECKED BEFORE THE FILE IS SOURCED. producer.env is plain
# `KEY=value` in the boards/*/board.env discipline, and sourcing is what would
# run a command substitution hidden in it: a description that can execute is not
# a description, it is a build step nothing declared.
#
# WHAT THIS DOES NOT COVER, written down because a reader will otherwise assume
# it does. producers.sh has already read every producer.env by the time this
# runs -- that read is what resolved the name above. It makes that read in a
# subshell so that a producer cannot change what discovery does with the
# producers after it, and producers.sh is the single authority on the producer
# SET, so the same refusal beside that read belongs to that file rather than to
# a second search here. What is refused HERE is the source whose variables
# become this build's arguments, contexts and pool writes.
while IFS= read -r line; do
    case "${line}" in
    '' | '#'*) continue ;;
    esac
    case "${line}" in
    *'$('* | *'`'*)
        echo "error: ${PRODUCER_REL}/producer.env carries a command substitution: ${line}. This file DESCRIBES a producer and is sourced by this driver; logic in it runs at build time in whatever context the caller had" >&2
        exit 1
        ;;
    esac
    [[ "${line}" =~ ^[A-Z][A-Z0-9_]*= ]] || {
        echo "error: ${PRODUCER_REL}/producer.env carries a line that is neither KEY=value nor a comment: ${line}. Plain assignments only -- see build-env/deb/README.md" >&2
        exit 1
    }
done <"${PRODUCER_ENV}"

# Cleared before the source, so that a variable already in this process's
# environment cannot stand in for one the producer failed to declare.
PACKAGES=""
ARCHES=""
BUILD_CONTEXTS=""
FROM_IMAGES=""
BUILD_ARGS=""
PREPARE=""
VERSION_FROM=""
# shellcheck disable=SC1091
. "${PRODUCER_ENV}"

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
# The workspace version, BEFORE any VERSION_FROM override: it is what
# @SYSTEM_VERSION@ substitutes to, so an upstream-versioned package can pin a
# first-party one (mos-podman Depends mos-system (= @SYSTEM_VERSION@)) at the
# version that package actually carries.
SYSTEM_VERSION="${VERSION}"

# An upstream-versioned producer: VERSION_FROM names the env file and key that
# hold the upstream tag, and the packages' version becomes that tag (leading
# `v` stripped) in front of the same `+git<commit><dirty>-<rev>` stamp every
# other producer carries. The prefix says WHAT is packaged, the stamp says
# WHICH COMMIT packaged it -- tests/deb-package-gate.sh asserts the shared
# stamp over the pool, and rootfs/build.sh matches the stamp, not the
# prefix, against the tree it composes from. Producer-scoped, because no
# producer here mixes an upstream repack with a first-party package.
if [ -n "${VERSION_FROM}" ]; then
    VF_PATH="${VERSION_FROM%%:*}"
    VF_KEY="${VERSION_FROM##*:}"
    if [ -z "${VF_PATH}" ] || [ -z "${VF_KEY}" ] || [ "${VF_PATH}" = "${VERSION_FROM}" ]; then
        echo "error: ${PRODUCER_REL}/producer.env declares VERSION_FROM='${VERSION_FROM}', which is not <repository-relative env file>:<KEY>. That pair is the whole wiring between the producer and the upstream version it packages; see build-env/deb/README.md" >&2
        exit 1
    fi
    [ -f "${REPO_ROOT}/${VF_PATH}" ] || {
        echo "error: ${PRODUCER_REL}/producer.env declares VERSION_FROM=${VERSION_FROM} and ${VF_PATH} does not exist under ${REPO_ROOT}. The upstream version comes from that file or from nowhere; a fallback here would stamp a number the tree does not declare" >&2
        exit 1
    }
    UPSTREAM="$(sed -n "s/^${VF_KEY}=//p" "${REPO_ROOT}/${VF_PATH}" | head -n1)"
    [ -n "${UPSTREAM}" ] || {
        echo "error: ${VF_PATH} declares no non-empty ${VF_KEY}, which ${PRODUCER_REL}/producer.env names in VERSION_FROM. An empty upstream version would compose into '+git<commit>-1', which dpkg accepts and which orders below every real version" >&2
        exit 1
    }
    UPSTREAM="${UPSTREAM#v}"
    case "${UPSTREAM}" in
    [0-9]*) ;;
    *)
        echo "error: ${VF_PATH}'s ${VF_KEY} is '${UPSTREAM}' after stripping a leading 'v', which does not begin with a digit. A Debian upstream version starts with a digit; anything else here is a tag this rule was never written for, and guessing an interpretation would stamp it silently" >&2
        exit 1
        ;;
    esac
    VERSION="${UPSTREAM}+${VERSION#*+}"
fi

# SOURCE_DATE_EPOCH is the commit's timestamp, resolved on the HOST: the
# container sees this worktree through a bind mount whose .git is a file naming
# a gitdir outside it, so git in there reports `not a git repository`. pack.sh
# has no default for it and fails by name if it is unset.
#
# A dirty tree keeps the same commit timestamp rather than taking `now`. The
# version already says `.dirty`, so the archive is marked as one that no commit
# reproduces; moving it forward would only make two dirty builds of one
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
    echo "error: $(uname -m) is not an architecture build-env/images.env builds a mos-build-deb for, so there is no container to pack in" >&2
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
    # A FILE NAME BESIDE THE producer.env THAT DECLARES IT, never a path. A
    # producer that reached out of its own directory would be running a script
    # it does not own, and the hook runs on the host with this session's
    # privileges -- so the one place a producer may put executable code is the
    # one place its own directory can hold.
    case "${PREPARE}" in
    */*)
        echo "error: ${PRODUCER_REL}/producer.env names PREPARE=${PREPARE}, which is a path. A hook is a file name beside the producer.env that declares it" >&2
        exit 1
        ;;
    esac
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

# Builder selection, the same register pkgs/rauc/build.sh keeps and for the
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
    # answer. tests/shell-pipefail-lint.sh exists for that one mistake.
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

# The packer image is passed UNBIDDEN, for the same reason and in the same way
# that pack.sh itself is: a producer packs inside mos-build-deb BY
# CONSTRUCTION -- that is what a producer is -- so the one base every producer
# shares is this driver's to supply, not a line each producer.env has to
# remember. A forgotten one does not read as a forgotten declaration either; it
# arrives from buildx as `base name (${MOS_BUILD_DEB}) should not be blank`,
# which names neither the producer nor this file. FROM_IMAGES keeps its real
# job: the ADDITIONAL, non-universal bases, which is what
# MOS_IMAGE_DEBIAN_TRIXIE is.
#
# A producer that declares the packer anyway is tolerated: its entry REPLACES
# the one below rather than being appended after it, so the build argument is
# resolved once either way and the two spellings of the same producer are the
# same build.
FROM_ENTRIES=("MOS_BUILD_DEB=LOCAL_MOS_BUILD_DEB")
for entry in ${FROM_IMAGES}; do
    case "${entry}" in
    MOS_BUILD_DEB=*) FROM_ENTRIES[0]="${entry}" ;;
    *) FROM_ENTRIES+=("${entry}") ;;
    esac
done

FROM_ARGS=()
OCI_DIRS=()
for entry in "${FROM_ENTRIES[@]}"; do
    argname="${entry%%=*}"
    key="${entry#*=}"
    [ -n "${argname}" ] && [ -n "${key}" ] && [ "${argname}" != "${entry}" ] || {
        echo "error: ${PRODUCER_REL}/producer.env declares FROM_IMAGES entry '${entry}', which is not <build-arg name>=<images.env key>. build-env/from.sh takes that pair and it is the whole wiring between a Dockerfile's ARG and an images.env digest" >&2
        exit 1
    }
    mapfile -t got < <(bash "${FROM_SH}" --arch="${IMAGE_ARCH}" "${argname}=${key}")
    [ "${#got[@]}" -eq 2 ] || {
        echo "error: build-env/from.sh did not resolve ${argname}=${key} for ${IMAGE_ARCH} (see its message above); the builder images are built by \`make build-env\`" >&2
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
                echo "error: build-env/from.sh did not yield the OCI layout context for ${key} at ${IMAGE_ARCH} (see its message above); the '${BUILDER}' builder would have resolved the FROM as a pull from a registry called 'localhost'" >&2
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
    # A DIRECTORY, not merely something that exists. `--build-context <n>=<path>`
    # names a local context and buildkit walks it as a tree; handed a regular
    # file, buildx reports it at the `COPY --from=<n>` that reads it, or as a
    # context it could not resolve, rather than as the wrong kind of path it is.
    [ -d "${REPO_ROOT}/${path}" ] || {
        echo "error: ${PRODUCER_REL}/producer.env declares the build context '${name}=${path}', which is not a directory under ${REPO_ROOT}. buildx would resolve a missing local context as a remote one and fail naming neither" >&2
        exit 1
    }
    CTX_ARGS+=(--build-context "${name}=${REPO_ROOT}/${path}")
done

ARG_ARGS=(
    --build-arg "MOS_DEB_VERSION=${VERSION}"
    --build-arg "MOS_DEB_SYSTEM_VERSION=${SYSTEM_VERSION}"
    --build-arg "MOS_DEB_ARCH=${DEB_ARCH}"
    --build-arg "SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}"
)
for entry in ${BUILD_ARGS}; do
    # KEY=VALUE, never a bare KEY. `--build-arg KEY` is buildx's "take it from
    # the environment" form, so a bare name here would hand the build whatever
    # this session happened to hold -- or nothing at all -- and the archive would
    # be a function of the caller's environment rather than of the tree.
    case "${entry}" in
    *=*) ARG_ARGS+=(--build-arg "${entry}") ;;
    *)
        echo "error: ${PRODUCER_REL}/producer.env declares BUILD_ARGS entry '${entry}', which is not KEY=VALUE" >&2
        exit 1
        ;;
    esac
done

# This producer's own archives only, out of every pool it writes. The pool is
# shared -- build-env/deb/repo.sh indexes every .deb in it -- so a wholesale
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

# Everything this run put in the pools, so that a refusal below can take it back
# out again.
EXPORTED=()
for pool_arch in "${POOL_ARCHES[@]}"; do
    for p in ${PACKAGES}; do
        EXPORTED+=("${REPO_ROOT}/_out/debs/${pool_arch}/pool/${p}_${VERSION}_${DEB_ARCH}.deb")
    done
done

# A REJECTED PACKAGE DOES NOT STAY IN THE POOL. Everything below this point runs
# after `-o type=local` has already written the archives, so a refusal that only
# exited non-zero would leave the artifact it just rejected on disk -- where
# build-env/deb/repo.sh indexes every .deb it finds and a composer would
# install it. The refusal would then live in a log while the package shipped,
# which is worse than not checking at all: the log gets closed and the pool does
# not.
#
# The whole run is withdrawn rather than the offending archive alone. These are
# exported together, and a producer left half in the pool is exactly the
# half-state that is hard to notice. Nothing is put back either, and there is
# nothing to put back: the previous version of each of these packages was
# deleted before the build, which is how this driver keeps repo.sh from indexing
# two versions of one package. The pool ends with NO archive for this producer
# and the next green build is what refills it.
reject() {
    rm -f "${EXPORTED[@]}"
    echo "error: $* -- and the ${#EXPORTED[@]} archive(s) this run exported have been removed from the pool, because a package this driver refused must not be left where repo.sh would index it. There is now no archive for ${PACKAGES}; rebuild once the cause is fixed" >&2
    exit 1
}

# What landed on disk, not what the build stage said it wrote. An export that
# dropped a file, or a cache hit that served an older layer, is invisible to
# pack.sh's own read-back and caught here.
missing=""
for deb in "${EXPORTED[@]}"; do
    [ -f "${deb}" ] || missing="${missing} ${deb#"${REPO_ROOT}"/}"
done
[ -z "${missing}" ] || reject "the export is missing:${missing}"

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
            cmp -s "${a}" "${b}" ||
                reject "${p} was exported to the ${first} and ${pool_arch} pools from ONE build and the two archives differ. An Architecture: all package is one archive that is a member of every pool"
        done
    done
fi

# ENABLEMENT IS NOT COUNTED HERE, and the omission is a decision rather than a
# gap: tests/deb-package-gate.sh reads the multi-user.target.wants symlinks
# out of every archive of every producer and compares them with the same
# producer.env field, over the whole pool. A second count in this driver would be
# a second implementation of one rule, and two implementations of a rule agree
# until one of them is edited.

rm -rf "${STAGE}"
for pool_arch in "${POOL_ARCHES[@]}"; do
    for p in ${PACKAGES}; do
        echo "${REPO_ROOT}/_out/debs/${pool_arch}/pool/${p}_${VERSION}_${DEB_ARCH}.deb"
    done
done
