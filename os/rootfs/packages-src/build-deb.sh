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
ENABLEMENT=""
PREPARE=""
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

# ENABLEMENT: how many multi-user.target.wants symlinks each package's payload
# carries, one entry per package with no package left out. It is REQUIRED and a
# zero is WRITTEN rather than omitted, because those two are the same sentence
# to a reader and opposite sentences to a check: an omitted package is one
# whose enablement nothing asserts, so it can acquire or lose a wants-symlink
# with every gate green. The declared count is asserted at the end of this
# script against the archive this run wrote -- a field that only some
# downstream gate reads is a field that drifts until that gate finally reads it.
[ -n "${ENABLEMENT}" ] ||
    die "${PRODUCER_ENV} declares no ENABLEMENT. Every producer states, per package, how many /etc/systemd/system/multi-user.target.wants symlinks its payload carries; a package that starts nothing writes the zero (e.g. ENABLEMENT=\"${PACKAGES%% *}=0\"). Defaulting it would leave the common case unwritten and therefore unchecked"

enablement_for() {
    local want="$1" e
    for e in ${ENABLEMENT}; do
        [ "${e%%=*}" = "${want}" ] || continue
        printf '%s\n' "${e#*=}"
        return 0
    done
    return 1
}

for e in ${ENABLEMENT}; do
    e_pkg="${e%%=*}"
    e_n="${e#*=}"
    if [ "${e_pkg}" = "${e}" ] || [ -z "${e_pkg}" ] || [ -z "${e_n}" ]; then
        die "${PRODUCER_ENV} names '${e}' in ENABLEMENT, which is not <package>=<count>"
    fi
    case "${e_n}" in
    *[!0-9]*) die "${PRODUCER_ENV} names '${e}' in ENABLEMENT, whose count '${e_n}' is not a decimal number" ;;
    esac
    e_declared=0
    for p in ${PACKAGES}; do
        [ "${p}" != "${e_pkg}" ] || e_declared=1
    done
    [ "${e_declared}" = 1 ] ||
        die "${PRODUCER_ENV} names '${e_pkg}' in ENABLEMENT and PACKAGES=\"${PACKAGES}\" does not emit it. No archive would ever exist for that entry to be checked against, so it would sit there reading like an assertion and asserting nothing"
    e_seen=0
    for e2 in ${ENABLEMENT}; do
        [ "${e2%%=*}" != "${e_pkg}" ] || e_seen=$((e_seen + 1))
    done
    [ "${e_seen}" = 1 ] ||
        die "${PRODUCER_ENV} names '${e_pkg}' ${e_seen} times in ENABLEMENT. Two counts for one package is one count that is never checked, because the first match wins"
done
for p in ${PACKAGES}; do
    enablement_for "${p}" >/dev/null ||
        die "${PRODUCER_ENV} emits '${p}' and its ENABLEMENT=\"${ENABLEMENT}\" says nothing about it. Every package carries a count, including the zero of a package that starts nothing"
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

# PREPARE: the one step a producer may run on the HOST, before the build.
#
# It exists for the inputs a build context cannot name. BUILD_CONTEXTS entries
# are fixed repository-relative paths -- producer.env is plain KEY=value with no
# expansion, deliberately -- so a producer whose inputs are selected by an
# environment variable, or produced by a script that must run where the
# repository is, has nowhere to put them. The hook stages them instead, and what
# it leaves in ${MOS_DEB_STAGE} arrives in the build as the `bin` context.
#
# It runs HERE, above the builder selection, because that is the last point at
# which nothing has been started: `docker buildx create`/`inspect` bootstraps a
# buildkit container and from.sh --contexts writes OCI layouts. A hook whose
# job is to refuse a missing input must be able to say "nothing was staged and
# no container was started" and have it be true.
BIN_CTX=()
if [ -n "${PREPARE}" ]; then
    case "${PREPARE}" in
    */*) die "${PRODUCER_ENV} names PREPARE=\"${PREPARE}\", which is a path. A hook is a file name beside the producer.env that declares it: a producer that reached out of its own directory would be running a script it does not own" ;;
    esac
    HOOK="${PRODUCER_DIR}/${PREPARE}"
    [ -f "${HOOK}" ] ||
        die "${PRODUCER_ENV} names PREPARE=\"${PREPARE}\" and ${HOOK} does not exist"
    # Emptied rather than added to, so that a hook which stops staging a file
    # cannot be covered by the previous run's copy of it. Under tmp/, this
    # repository's declared bind-mount root, beside the OCI layouts below.
    PRODUCER_SLUG="${PRODUCER_REL//\//-}"
    STAGE_DIR="${REPO_ROOT}/tmp/deb-stage-${PRODUCER_SLUG}-${ARCH}"
    rm -rf "${STAGE_DIR}"
    mkdir -p "${STAGE_DIR}"
    # Everything the hook is allowed to know, and nothing it has to re-derive.
    # MOS_DEB_VERSION and SOURCE_DATE_EPOCH are the same two values the build
    # gets below, so a hook that writes a version or a timestamp into what it
    # stages writes the archive's own.
    MOS_DEB_REPO_ROOT="${REPO_ROOT}" \
        MOS_DEB_PRODUCER="${PRODUCER_REL}" \
        MOS_DEB_PRODUCER_DIR="${PRODUCER_DIR}" \
        MOS_DEB_ARCH="${ARCH}" \
        MOS_DEB_STAGE="${STAGE_DIR}" \
        MOS_DEB_VERSION="${VERSION}" \
        SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH}" \
        bash "${HOOK}"
    [ -n "$(ls -A "${STAGE_DIR}")" ] ||
        die "the PREPARE hook ${PREPARE} of ${PRODUCER_REL} exited 0 and left ${STAGE_DIR} empty. That directory IS the 'bin' build context, so the build would reach its first COPY --from=bin against nothing and either fail there or -- worse -- pack a payload with the hook's material silently missing"
    BIN_CTX=(--build-context "bin=${STAGE_DIR}")
fi

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

# Any further base the producer names, as `<build-arg name>=<images.env key>`
# -- the pairing os/build-env/from.sh's own call sites already write out in
# full (`MOS_IMAGE_UBUNTU_2404=IMAGE_UBUNTU_2404`), and the shape this entry is
# handed to it in unchanged.
#
# The pair is WRITTEN rather than derived from a naming rule. A driver that
# built the key by stripping a prefix would make the Dockerfile's ARG name a
# consequence of arithmetic in this file, so a reader of either half would have
# to come here to learn what feeds the other -- which is the reason from.sh's
# header gives for taking the pair at every one of its call sites.
#
# from.sh is the dispatcher for what a key may be: it refuses anything that is
# neither an IMAGE_ nor a LOCAL_ key, and names the key it refused. There is no
# second copy of that policy here.
for entry in ${FROM_IMAGES}; do
    argname="${entry%%=*}"
    key="${entry#*=}"
    if [ "${argname}" = "${entry}" ] || [ -z "${argname}" ] || [ -z "${key}" ]; then
        die "${PRODUCER_ENV} names '${entry}' in FROM_IMAGES, which is not <build-arg name>=<images.env key> -- e.g. MOS_IMAGE_DEBIAN_TRIXIE=IMAGE_DEBIAN_TRIXIE. The left half is the ARG the producer's Dockerfile declares and the right half is the key os/build-env/images.env pins"
    fi
    mapfile -t extra_from < <(bash "${FROM_SH}" --arch="${BUILD_ARCH}" "${entry}")
    [ "${#extra_from[@]}" -eq 2 ] ||
        die "os/build-env/from.sh did not resolve ${key} for ${argname} (see its message above)"
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

# The primary build context is the PRODUCER DIRECTORY, which is what README.md
# says a producer is: a Dockerfile and a producer.env, plus the material that
# belongs to that package alone. Handing over this directory instead would put
# every sibling producer in each one's context, so a producer could COPY a
# neighbour's control template and nothing would say it had. Whatever a producer
# shares with its siblings -- the copyright file next to this script -- comes
# back through a named BUILD_CONTEXTS entry, where the sharing is written down.
echo "build-deb: packing ${PACKAGES} ${VERSION} for ${ARCH} on builder '${BUILDER}' (${BUILDER_DRIVER}), building at ${BUILD_ARCH}"
docker buildx build --builder "${BUILDER}" \
    --platform "linux/${BUILD_ARCH}" \
    "${FROM_ARGS[@]}" \
    ${CTX_ARGS[@]+"${CTX_ARGS[@]}"} \
    --build-context "packer=${REPO_ROOT}/os/build-env/deb" \
    ${BIN_CTX[@]+"${BIN_CTX[@]}"} \
    ${CTX_EXTRA[@]+"${CTX_EXTRA[@]}"} \
    --build-arg "MOS_DEB_VERSION=${VERSION}" \
    --build-arg "MOS_DEB_ARCH=${ARCH}" \
    --build-arg "SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}" \
    ${ARG_EXTRA[@]+"${ARG_EXTRA[@]}"} \
    -f "${DOCKERFILE}" \
    "${OUT_ARGS[@]}" \
    "${PRODUCER_DIR}"

# Everything this run put in the pools, so that a failed assertion below can
# take it back out.
EXPORTED=()
for pool_arch in "${POOL_ARCHES[@]}"; do
    for p in ${PACKAGES}; do
        EXPORTED+=("${REPO_ROOT}/_out/debs/${pool_arch}/pool/${p}_${VERSION}_${ARCH}.deb")
    done
done

# A REJECTED PACKAGE DOES NOT STAY IN THE POOL. Everything below this point
# runs after `-o type=local` has already written the archives, so a refusal
# that only exited non-zero would leave the artifact it just rejected on disk,
# where os/build-env/deb/repo.sh indexes every .deb it finds and a composer
# would install it. The refusal would then live in a log while the package
# shipped -- which is worse than not checking, because the log gets closed and
# the pool does not.
#
# The whole run is withdrawn, not just the offending package: these archives
# are exported together and a producer left half in the pool is exactly the
# half-state that is hard to notice. Nothing is put back either, and there is
# nothing to put back -- the previous version of each of these packages was
# deleted before the build, which is how this driver keeps repo.sh from
# indexing two versions of one package. So the pool ends with NO archive for
# this producer, and the next green build is what refills it.
reject() {
    rm -f "${EXPORTED[@]}"
    die "$* -- and the ${#EXPORTED[@]} archive(s) this run exported have been removed from the pool, because a package this driver refused must not be left where repo.sh would index it. There is now no archive for ${PACKAGES}; rebuild once the cause is fixed"
}

# What landed on disk, not what the build stage said it wrote. An export that
# dropped a file, or a cache hit that served an older layer, is invisible to
# pack.sh's own read-back and caught here.
missing=""
for deb in "${EXPORTED[@]}"; do
    [ -f "${deb}" ] || missing="${missing} ${deb}"
done
[ -z "${missing}" ] || reject "the export is missing:${missing}"

# ENABLEMENT, asserted out of the archive that was just written.
#
# Read in a container for the reason os/build-env/deb/repo.sh gives for the
# same read: the host carries no dpkg by contract here, and the packer image
# does. The HOST architecture's image, not --arch's -- `dpkg-deb --contents`
# parses an archive rather than executing it, and this host has no binfmt
# registration, so an arm64 image would die with `exec format error` before it
# listed the arm64 package it had just produced.
mapfile -t READBACK_FROM < <(bash "${FROM_SH}" --arch="${HOST_ARCH}" MOS_BUILD_DEB=LOCAL_MOS_BUILD_DEB)
[ "${#READBACK_FROM[@]}" -eq 2 ] ||
    die "os/build-env/from.sh did not yield localhost/mos-build-deb:${HOST_ARCH} to read the built archives back with (see its message above); it is built by \`make build-env\`"
READBACK_IMAGE="${READBACK_FROM[1]#MOS_BUILD_DEB=}"

# One pool is enough. An `all` build exports the same stage into both, so the
# second listing would be the first one again.
#
# ONE container for the whole producer, not one per package. Measured on this
# host with the daemon otherwise idle: `docker run` of the packer costs 7-41
# seconds, against 4 milliseconds for the listing itself, so the container --
# not the work -- is the price. A per-package run put that price on every
# package; this pays it once and lists them all inside.
READBACK_POOL="${REPO_ROOT}/_out/debs/${POOL_ARCHES[0]}/pool"
listings="$(docker run --rm \
    --label ai-agent=true \
    -v "${READBACK_POOL}:/pool:ro" \
    -w /pool \
    -e "MOS_DEB_PACKAGES=${PACKAGES}" \
    -e "MOS_DEB_SUFFIX=_${VERSION}_${ARCH}.deb" \
    --entrypoint /bin/bash \
    "${READBACK_IMAGE}" -c '
        set -eu
        for p in ${MOS_DEB_PACKAGES}; do
            echo "=== ${p}"
            dpkg-deb --contents "${p}${MOS_DEB_SUFFIX}"
        done')"

# The counting stays HERE rather than in the container, so that the expression
# below is the package gate's own, character for character, in a file a reader
# can diff against it. The container's only job is to turn archives into
# listings.
for p in ${PACKAGES}; do
    want="$(enablement_for "${p}")"
    listing="$(awk -v want="=== ${p}" '$0 == want { on = 1; next } /^=== / { on = 0 } on' <<<"${listings}")"
    [ -n "${listing}" ] ||
        reject "the read-back of ${p}_${VERSION}_${ARCH}.deb produced no listing, so its ENABLEMENT was about to be checked against nothing"
    # The counting rule, and it is narrow on purpose. `$1 ~ /^l/` counts
    # SYMLINKS only: a regular file with the same name starts nothing, so it is
    # not enablement. One directory only: a link under local-fs.target.wants or
    # timers.target.wants is real payload, and it is the byte-for-byte payload
    # checks that speak about those, not this number.
    got="$(awk '$1 ~ /^l/ && $6 ~ /^\.\/etc\/systemd\/system\/multi-user\.target\.wants\// { n++ } END { print n + 0 }' <<<"${listing}")"
    [ "${got}" = "${want}" ] ||
        reject "${p} declares ENABLEMENT ${p}=${want} in ${PRODUCER_ENV} and the archive just built carries ${got} multi-user.target.wants symlink(s). Either the payload gained or lost a unit's enablement, or the declaration was never true; both are the drift this field exists to name, so neither is absorbed here"
done

for pool_arch in "${POOL_ARCHES[@]}"; do
    for p in ${PACKAGES}; do
        echo "${REPO_ROOT}/_out/debs/${pool_arch}/pool/${p}_${VERSION}_${ARCH}.deb"
    done
done
