#!/usr/bin/env bash
# Build one rootfs-content producer's Debian packages for one architecture.
#
#   bash os/rootfs/packages-src/build-deb.sh --producer-dir <dir> --arch <amd64|arm64|all>
#
#   -> _out/debs/<arch>/pool/<package>_<version>_<arch>.deb
#
# A PRODUCER here is a directory holding a Dockerfile and a producer.env, and
# that is the whole registration: this driver has no case block naming the
# producers it knows, unlike os/pkgs/mosd/hack/build-deb.sh, whose producers
# each own a crate subset that only a register can express. The packages under
# os/rootfs/packages-src/ carry ROOTFS CONTENT -- files the stage chain writes
# into the image today -- so what a producer needs is a payload description,
# and producer.env is it. os/rootfs/packages-src/README.md is the contract.
#
# The packaging runs at the TARGET architecture, because dpkg-shlibdeps
# resolves an ELF's dependencies against the libraries of the container it runs
# in and os/build-env/deb/pack.sh refuses the mismatch by name. This host has
# no binfmt registration, so `docker run --platform linux/arm64` is not a route
# -- it dies with `exec format error`. `docker buildx build` on the `mos-arm64`
# docker-container builder is, because its buildkit image bundles the
# emulators; that builder cannot resolve a `localhost/*` tag, so the base is
# handed over as an OCI layout by os/build-env/from.sh --contexts=.
set -euo pipefail

die() {
    echo "build-deb: error: $*" >&2
    exit 1
}

# The version of every package produced from this directory, in ONE place.
# These packages have no crate manifest and no upstream release to read a
# number out of -- os/pkgs/mosd/hack/build-deb.sh takes its `0.1.0` from the
# crate that produced the binary -- so the number is written here and nowhere
# else in the tree. A second copy is a number that stops matching the first
# time one of them moves.
MOS_ROOTFS_PKG_VERSION="0.1.0"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
FROM_SH="${REPO_ROOT}/os/build-env/from.sh"
for p in "${REPO_ROOT}/Makefile" "${FROM_SH}"; do
    [ -e "${p}" ] ||
        die "${p} does not exist. os/rootfs/packages-src/build-deb.sh derives REPO_ROOT as three levels above itself; if this file moved, that arithmetic moved with it"
done

command -v docker >/dev/null 2>&1 ||
    die "docker is required and not on PATH. The packaging runs in a container -- the host carries no dpkg -- which is what makes the packer a value os/build-env/images.env records"

PRODUCER_REL=""
ARCH=""
while [ "$#" -gt 0 ]; do
    case "$1" in
    --producer-dir)
        PRODUCER_REL="${2-}"
        [ -n "${PRODUCER_REL}" ] || die "--producer-dir takes a repository-relative producer directory"
        shift 2
        ;;
    --arch)
        ARCH="${2-}"
        [ -n "${ARCH}" ] || die "--arch takes amd64, arm64 or all"
        shift 2
        ;;
    *)
        echo "usage: bash os/rootfs/packages-src/build-deb.sh --producer-dir <dir> --arch <amd64|arm64|all>" >&2
        exit 1
        ;;
    esac
done
[ -n "${PRODUCER_REL}" ] ||
    die "--producer-dir is required; there is no default producer, because a build that picked one would package a payload nobody asked for"
[ -n "${ARCH}" ] ||
    die "--arch is required; guessing the host's would silently file amd64 packages for a cx3576 image"
case "${ARCH}" in
amd64 | arm64 | all) ;;
*) die "--arch ${ARCH} is not amd64, arm64 or all. Those are the three values os/build-env/deb/pack.sh takes" ;;
esac

# Repository-relative, resolved here, so that the same invocation works from
# any directory: four of this repository's build entry points already run from
# a cwd that is not the repository root.
PRODUCER_DIR="${REPO_ROOT}/${PRODUCER_REL}"
DOCKERFILE="${PRODUCER_DIR}/Dockerfile"
PRODUCER_ENV="${PRODUCER_DIR}/producer.env"
[ -f "${DOCKERFILE}" ] ||
    die "${DOCKERFILE} does not exist. A producer directory is a Dockerfile that stages and packs plus a producer.env that describes what it emits; this one has at most half of that"
[ -f "${PRODUCER_ENV}" ] ||
    die "${PRODUCER_ENV} does not exist. Without it nothing says which packages this producer emits or which architectures it may be built for, and the read-back below would assert over an empty package list -- which passes by having nothing to check"

# producer.env is plain `KEY=value` lines, the discipline os/boards/<b>/board.env
# keeps, and it is what makes a producer SELF-DESCRIBING rather than registered
# in this driver: adding one is a directory, not an edit here.
#
# The shape is checked BEFORE the file is sourced, because sourcing is what
# would run a command substitution hidden in it. A description that can execute
# is not a description.
while IFS= read -r line; do
    case "${line}" in
    '' | '#'*) continue ;;
    esac
    case "${line}" in
    *'$('* | *'`'*)
        die "${PRODUCER_ENV} carries a command substitution: ${line}. This file is a DESCRIPTION of a producer and is sourced by this driver; logic in it runs at build time in whatever context the caller had"
        ;;
    esac
    [[ "${line}" =~ ^[A-Z][A-Z0-9_]*= ]] ||
        die "${PRODUCER_ENV} carries a line that is not KEY=value and not a comment: ${line}. Plain assignments only -- see os/rootfs/packages-src/README.md"
done <"${PRODUCER_ENV}"

# Cleared before the source, so that a variable already in this process's
# environment cannot stand in for one the producer failed to declare.
PACKAGES=""
ARCHES=""
BUILD_CONTEXTS=""
FROM_IMAGES=""
BUILD_ARGS=""
# shellcheck source=/dev/null
. "${PRODUCER_ENV}"

[ -n "${PACKAGES}" ] ||
    die "${PRODUCER_ENV} declares no PACKAGES. That list is what the export is asserted against; an empty one would let a build that produced nothing report success"
[ -n "${ARCHES}" ] ||
    die "${PRODUCER_ENV} declares no ARCHES. Without it every --arch would be accepted, and an Architecture: all payload built as amd64 is a well-formed archive that installs on one of the two images"
for a in ${ARCHES}; do
    case "${a}" in
    amd64 | arm64 | all) ;;
    *) die "${PRODUCER_ENV} declares ARCHES=\"${ARCHES}\", which names '${a}'; only amd64, arm64 and all exist here" ;;
    esac
done

# The refusal that makes ARCHES worth declaring. A producer whose payload is
# architecture-independent says `all`, and building it as amd64 would produce
# an archive that is correct in every field except the one that decides which
# images may install it -- so the mismatch is named rather than absorbed.
arch_declared=0
for a in ${ARCHES}; do
    [ "${a}" != "${ARCH}" ] || arch_declared=1
done
[ "${arch_declared}" = 1 ] ||
    die "the producer ${PRODUCER_REL} declares ARCHES=\"${ARCHES}\" and was asked for --arch ${ARCH}. It is not built as ${ARCH}: the architecture a package declares is what decides which images can install it, so this is refused rather than silently answered with a build for an architecture the producer never claimed"

git -C "${REPO_ROOT}" rev-parse --git-dir >/dev/null 2>&1 ||
    die "${REPO_ROOT} is not a git checkout. The package version is ${MOS_ROOTFS_PKG_VERSION}+git<commit>-1 and SOURCE_DATE_EPOCH is that commit's timestamp; neither has a defensible value here without git, and a fallback would make every archive irreproducible while every build stayed green"
COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short=12 HEAD)"
DIRTY=""
[ -z "$(git -C "${REPO_ROOT}" status --porcelain)" ] || DIRTY=".dirty"
VERSION="${MOS_ROOTFS_PKG_VERSION}+git${COMMIT}${DIRTY}-1"

# SOURCE_DATE_EPOCH is the commit's timestamp, resolved on the HOST: the
# container sees this worktree through a bind mount whose .git is a file naming
# a gitdir outside it, so git in there reports `not a git repository`. pack.sh
# has no default for it and fails by name if it is unset.
#
# A dirty tree keeps the same commit timestamp rather than taking `now`. The
# version already says `.dirty`, so the archive is marked as one that no commit
# reproduces; moving the clamp forward would only make two dirty builds of one
# tree differ from each other as well.
SOURCE_DATE_EPOCH="$(git -C "${REPO_ROOT}" log -1 --format=%ct)"
[ -n "${SOURCE_DATE_EPOCH}" ] ||
    die "\`git log -1 --format=%ct\` produced no commit timestamp in ${REPO_ROOT}"

case "$(uname -m)" in
x86_64) HOST_ARCH=amd64 ;;
aarch64 | arm64) HOST_ARCH=arm64 ;;
*) die "$(uname -m) is not an architecture os/build-env/images.env builds a mos-build-deb for, so there is no container to run pack.sh in" ;;
esac

# The architecture the BUILD runs at, which is not the architecture the package
# is FOR when that is `all`. An `all` payload has no ELF, so pack.sh exempts it
# from the `dpkg --print-architecture` match -- packing it under emulation
# would cost minutes of qemu to produce identical bytes, and on a host with no
# binfmt it would need a docker-container builder created for nothing at all.
# So `all` packs natively, and the builder selection below reaches `default`.
if [ "${ARCH}" = all ]; then
    BUILD_ARCH="${HOST_ARCH}"
else
    BUILD_ARCH="${ARCH}"
fi

# The pools this build writes. repo.sh accepts an archive declaring
# `Architecture: all` in either per-architecture pool (it matches the pool's
# architecture OR `all`), and there is no architecture-neutral pool for it to
# sit in -- so one `all` build is exported into BOTH, leaving each pool
# complete for the composer that reads it.
case "${ARCH}" in
all) POOL_ARCHES=(amd64 arm64) ;;
*) POOL_ARCHES=("${ARCH}") ;;
esac

# Builder selection, the same register os/pkgs/mosd/hack/build-deb.sh and
# os/pkgs/rauc/build.sh keep and for the same reasons: BUILDX_BUILDER wins
# because a caller who named a builder made a decision; with nothing named,
# `default` is used when it reaches the platform and the `mos-<arch>`
# docker-container builder otherwise. What must not happen is inheriting the
# ambient selection -- a leftover `mos-rauc-arm64` from an unrelated build is
# the current builder on any host that has run `make os-rauc`.
if [ -n "${BUILDX_BUILDER:-}" ]; then
    echo "note: using the builder BUILDX_BUILDER names (${BUILDX_BUILDER})"
    BUILDER="${BUILDX_BUILDER}"
else
    # Captured before it is read, never piped into an early-exiting reader:
    # `producer | grep -q` dies of SIGPIPE under pipefail and inverts its own
    # answer. os/tests/shell-pipefail-lint.sh exists for that one mistake.
    default_platforms="$(docker buildx inspect default 2>/dev/null || true)"
    if printf '%s\n' "${default_platforms}" | grep -c "linux/${BUILD_ARCH}" >/dev/null; then
        BUILDER=default
    else
        BUILDER="mos-${BUILD_ARCH}"
        docker buildx inspect "${BUILDER}" >/dev/null 2>&1 ||
            docker buildx create --name "${BUILDER}" --driver docker-container >/dev/null
    fi
fi

# Read off the builder rather than inferred from its name -- BUILDX_BUILDER may
# name anything -- because the driver is what decides whether the base goes over
# as a tag or as content.
builder_inspect="$(docker buildx inspect "${BUILDER}" 2>/dev/null || true)"
BUILDER_DRIVER="$(printf '%s\n' "${builder_inspect}" | sed -n 's/^Driver:[[:space:]]*//p')"
[ -n "${BUILDER_DRIVER}" ] ||
    die "\`docker buildx inspect ${BUILDER}\` names no driver, so this build cannot tell whether that builder can resolve a localhost/mos-build-deb tag or has to be handed it as an OCI layout. Either the builder does not exist or it is not running: \`docker buildx ls\` lists what does"
if [ "${BUILDER_DRIVER}" = docker ] &&
    ! printf '%s\n' "${builder_inspect}" | grep -c "linux/${BUILD_ARCH}" >/dev/null; then
    die "the buildx builder '${BUILDER}' uses the docker driver and does not offer linux/${BUILD_ARCH} on this host, so pack.sh would fail with 'exec format error' before it read a single control field. Either register the emulator on the HOST -- docker run --privileged --rm tonistiigi/binfmt --install ${BUILD_ARCH} -- or unset BUILDX_BUILDER and let this script select the docker-container builder 'mos-${BUILD_ARCH}', whose buildkit image bundles the emulators and needs no host registration"
fi

mapfile -t FROM_ARGS < <(bash "${FROM_SH}" --arch="${BUILD_ARCH}" MOS_BUILD_DEB=LOCAL_MOS_BUILD_DEB)
[ "${#FROM_ARGS[@]}" -eq 2 ] ||
    die "os/build-env/from.sh did not yield localhost/mos-build-deb:${BUILD_ARCH} (see its message above); it is built by \`make build-env\`"

# Any further base the producer names. The token IS the build argument its
# Dockerfile declares, and the images.env key is that name without the `MOS_`
# prefix -- the pairing os/build-env/from.sh's own call sites already write out
# (`MOS_IMAGE_UBUNTU_2404=IMAGE_UBUNTU_2404`). Only IMAGE_ keys: a LOCAL_ base
# is one this repository builds, and the only one a producer here stands on is
# the packer, which this driver passes itself.
for name in ${FROM_IMAGES}; do
    case "${name}" in
    MOS_IMAGE_*) ;;
    *) die "${PRODUCER_ENV} names '${name}' in FROM_IMAGES. An entry there is the build argument the producer's Dockerfile declares, and it is MOS_ plus an IMAGE_ key from os/build-env/images.env; the packer base is passed by this driver and is not named here" ;;
    esac
    mapfile -t extra_from < <(bash "${FROM_SH}" --arch="${BUILD_ARCH}" "${name}=${name#MOS_}")
    [ "${#extra_from[@]}" -eq 2 ] ||
        die "os/build-env/from.sh did not resolve ${name#MOS_} for ${name} (see its message above)"
    FROM_ARGS+=("${extra_from[@]}")
done

# The same image a second time, as content, for a builder that cannot read the
# local image store: every driver but `docker` has its own content store and
# reads `localhost/` as a registry hostname. Only for that builder -- exporting
# it otherwise would copy 300 MB to disk on every native build to change
# nothing.
CTX_ARGS=()
if [ "${BUILDER_DRIVER}" != docker ]; then
    OCI_DIR="${REPO_ROOT}/tmp/deb-oci-$(basename "${PRODUCER_DIR}")-${ARCH}"
    rm -rf "${OCI_DIR}"
    mkdir -p "${OCI_DIR}"
    trap 'rm -rf "${OCI_DIR}"' EXIT
    mapfile -t CTX_ARGS < <(bash "${FROM_SH}" --arch="${BUILD_ARCH}" --contexts="${OCI_DIR}" LOCAL_MOS_BUILD_DEB)
    [ "${#CTX_ARGS[@]}" -eq 2 ] ||
        die "os/build-env/from.sh did not yield the OCI layout context for localhost/mos-build-deb:${BUILD_ARCH} (see its message above); the '${BUILDER}' builder would have resolved the FROM as a pull from a registry called 'localhost'"
fi

# Repository-relative in producer.env and absolute here, for the reason the
# --producer-dir resolution gives: the paths in that file describe the tree,
# not the caller's cwd.
CTX_EXTRA=()
for c in ${BUILD_CONTEXTS}; do
    ctx_name="${c%%=*}"
    ctx_path="${c#*=}"
    if [ "${ctx_name}" = "${c}" ] || [ -z "${ctx_name}" ] || [ -z "${ctx_path}" ]; then
        die "${PRODUCER_ENV} names '${c}' in BUILD_CONTEXTS, which is not <name>=<repository-relative path>"
    fi
    [ -d "${REPO_ROOT}/${ctx_path}" ] ||
        die "${PRODUCER_ENV} names the build context '${ctx_name}' at ${ctx_path}, which is not a directory under ${REPO_ROOT}. buildx would report this at the COPY --from=${ctx_name} rather than as the missing path it is"
    CTX_EXTRA+=(--build-context "${ctx_name}=${REPO_ROOT}/${ctx_path}")
done

ARG_EXTRA=()
for kv in ${BUILD_ARGS}; do
    case "${kv}" in
    *=*) ARG_EXTRA+=(--build-arg "${kv}") ;;
    *) die "${PRODUCER_ENV} names '${kv}' in BUILD_ARGS, which is not KEY=VALUE" ;;
    esac
done

OUT_ARGS=()
for pool_arch in "${POOL_ARCHES[@]}"; do
    POOL="${REPO_ROOT}/_out/debs/${pool_arch}/pool"
    mkdir -p "${POOL}"
    # This producer's own archives only. The pool is shared -- with
    # os/pkgs/mosd's producers, and os/build-env/deb/repo.sh indexes every .deb
    # in it -- so a wholesale clean here would delete another producer's
    # output, while leaving the previous VERSION of this one behind would have
    # repo.sh index two versions of the same package.
    for p in ${PACKAGES}; do
        rm -f "${POOL}/${p}"_*.deb
    done
    OUT_ARGS+=(-o "type=local,dest=${POOL}")
done

echo "build-deb: packing ${PACKAGES} ${VERSION} for ${ARCH} on builder '${BUILDER}' (${BUILDER_DRIVER}), building at ${BUILD_ARCH}"
docker buildx build --builder "${BUILDER}" \
    --platform "linux/${BUILD_ARCH}" \
    "${FROM_ARGS[@]}" \
    ${CTX_ARGS[@]+"${CTX_ARGS[@]}"} \
    --build-context "packer=${REPO_ROOT}/os/build-env/deb" \
    ${CTX_EXTRA[@]+"${CTX_EXTRA[@]}"} \
    --build-arg "MOS_DEB_VERSION=${VERSION}" \
    --build-arg "MOS_DEB_ARCH=${ARCH}" \
    --build-arg "SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}" \
    ${ARG_EXTRA[@]+"${ARG_EXTRA[@]}"} \
    -f "${DOCKERFILE}" \
    "${OUT_ARGS[@]}" \
    "${HERE}"

# What landed on disk, not what the build stage said it wrote. An export that
# dropped a file, or a cache hit that served an older layer, is invisible to
# pack.sh's own read-back and caught here.
missing=""
for pool_arch in "${POOL_ARCHES[@]}"; do
    for p in ${PACKAGES}; do
        deb="${REPO_ROOT}/_out/debs/${pool_arch}/pool/${p}_${VERSION}_${ARCH}.deb"
        [ -f "${deb}" ] || missing="${missing} ${deb}"
    done
done
[ -z "${missing}" ] || die "the export is missing:${missing}"

for pool_arch in "${POOL_ARCHES[@]}"; do
    for p in ${PACKAGES}; do
        echo "${REPO_ROOT}/_out/debs/${pool_arch}/pool/${p}_${VERSION}_${ARCH}.deb"
    done
done
