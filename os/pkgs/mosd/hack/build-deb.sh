#!/usr/bin/env bash
# Build one producer's Debian packages for one architecture.
#
#   bash os/pkgs/mosd/hack/build-deb.sh --producer mosd --arch amd64
#   bash os/pkgs/mosd/hack/build-deb.sh --producer mqtt --arch arm64
#
#   -> _out/debs/<arch>/pool/{mosd,mos-apid}_<version>_<arch>.deb
#   -> _out/debs/<arch>/pool/{mos-mqttd,mos-mqtt-broker}_<version>_<arch>.deb
#
# A PRODUCER is a subset of this workspace compiled and packaged on its own:
# its own crate list, its own CARGO_TARGET_DIR, its own control templates and
# its own archives. os/pkgs/mosd/deb/README.md says what that buys and how to
# add the next one; the case block below is the whole registration.
#
# TWO ROUTES, and they run at different architectures on purpose.
#
#   A. the compile, at amd64 for both targets. cargo cross-compiles, so this is
#      a plain `docker run` against localhost/mos-build-rust:amd64 and needs no
#      buildx and no emulation.
#   B. the packaging, at the TARGET architecture. dpkg-shlibdeps resolves an
#      ELF's dependencies against the libraries installed next to it, and
#      os/build-env/deb/pack.sh refuses an arm64 payload in an amd64 container
#      rather than recording amd64's versions in it. This host has no binfmt,
#      so `docker run --platform linux/arm64` is not a route -- it dies with
#      `exec format error`. buildx on the `mos-arm64` docker-container builder
#      is, because its buildkit image bundles the emulators.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(cd "${HERE}/.." && pwd)"
REPO_ROOT="$(cd "${WORKSPACE}/../../.." && pwd)"
FROM_SH="${REPO_ROOT}/os/build-env/from.sh"
VERSION_SH="${REPO_ROOT}/os/build-env/deb/version.sh"
DEB_DIR="${WORKSPACE}/deb"
for p in "${WORKSPACE}/Cargo.toml" "${FROM_SH}" "${VERSION_SH}" "${DEB_DIR}"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. os/pkgs/mosd/hack/build-deb.sh derives the workspace as its own directory's parent and the repository as three levels above that; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done

command -v docker >/dev/null 2>&1 || {
    echo "error: docker is required and not on PATH. Both routes run in containers -- the host carries neither cargo nor dpkg -- which is what makes the compiler and the packer values os/build-env/images.env records" >&2
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
        [ -n "${ARCH}" ] || { echo "error: --arch takes amd64 or arm64" >&2; exit 1; }
        shift 2
        ;;
    *)
        echo "usage: bash os/pkgs/mosd/hack/build-deb.sh --producer <name> --arch <amd64|arm64>" >&2
        exit 1
        ;;
    esac
done
[ -n "${PRODUCER}" ] || { echo "error: --producer is required; there is no default producer, because a build that picked one would package a subset nobody asked for" >&2; exit 1; }
[ -n "${ARCH}" ] || { echo "error: --arch is required; guessing the host's would silently produce amd64 packages for a cx3576 image" >&2; exit 1; }

# Every binary this workspace can build. A producer names the ones it OWNS
# below, and the complement is what the independence assertion looks for -- so
# a fifth binary added here is checked without any producer being edited.
ALL_BINARIES=(mosd apid mos-mqttd mos-mqtt-broker)

# The producer register. Adding one is a case here plus os/pkgs/mosd/deb/<name>/
# holding a Dockerfile and control/; nothing else in this file changes.
#
# DIST_CONTEXTS names the buildx contexts the producer's Dockerfile reads its
# unit files and D-Bus policy out of. It is registered per producer rather than
# fixed, because the unit sources are not all in one place: mosd.service and
# apid.service sit in os/pkgs/mosd/dist/, while mos-mqttd.service and
# mos-mqtt-broker.service sit beside their own crates in mqttd/dist/ and
# broker/dist/. The only directory holding both of those is the workspace root,
# which carries the cargo target trees buildx must not walk -- so the MQTT
# producer takes two contexts instead of one.
case "${PRODUCER}" in
mosd)
    BINARIES=(mosd apid)
    PACKAGES=(mosd mos-apid)
    DIST_CONTEXTS=("dist=${WORKSPACE}/dist")
    ;;
mqtt)
    BINARIES=(mos-mqttd mos-mqtt-broker)
    PACKAGES=(mos-mqttd mos-mqtt-broker)
    DIST_CONTEXTS=("mqttd-dist=${WORKSPACE}/mqttd/dist" "broker-dist=${WORKSPACE}/broker/dist")
    ;;
*)
    echo "error: '${PRODUCER}' is not a producer this repository defines. os/pkgs/mosd/deb/README.md lists them and says what registering one takes; a producer named here but absent from that directory would build an empty package set and report success" >&2
    exit 1
    ;;
esac
PRODUCER_DIR="${DEB_DIR}/${PRODUCER}"
[ -f "${PRODUCER_DIR}/Dockerfile" ] || {
    echo "error: ${PRODUCER_DIR}/Dockerfile does not exist, but '${PRODUCER}' is registered in os/pkgs/mosd/hack/build-deb.sh. The register and the directory are two halves of one producer and this one has only its half" >&2
    exit 1
}

# The complement of BINARIES: what this producer's target directory must not
# hold. Computed rather than listed, so it cannot fall behind ALL_BINARIES.
EXCLUDED=()
for name in "${ALL_BINARIES[@]}"; do
    owned=0
    for own in "${BINARIES[@]}"; do
        [ "${name}" != "${own}" ] || owned=1
    done
    [ "${owned}" = 1 ] || EXCLUDED+=("${name}")
done

case "${ARCH}" in
amd64)
    TRIPLE=x86_64-unknown-linux-gnu
    ELF_ARCH=x86-64
    ;;
arm64)
    TRIPLE=aarch64-unknown-linux-gnu
    ELF_ARCH=aarch64
    ;;
*)
    echo "error: --arch ${ARCH} is not amd64 or arm64. Those are the two architectures os/build-env/images.env pins a Rust std and a mos-build-deb for; adding a third is an images.env edit and not an argument to this script" >&2
    exit 1
    ;;
esac

git -C "${REPO_ROOT}" rev-parse --git-dir >/dev/null 2>&1 || {
    echo "error: ${REPO_ROOT} is not a git checkout. The package version is 0.1.0+git<commit>-1 and SOURCE_DATE_EPOCH is that commit's timestamp; neither has a defensible value here without git, and a fallback would make every archive irreproducible while every build stayed green" >&2
    exit 1
}
COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short=12 HEAD)"
DIRTY=""
[ -z "$(git -C "${REPO_ROOT}" status --porcelain)" ] || DIRTY=".dirty"
# The version, from os/build-env/deb/version.sh, which is the ONE
# implementation of the rule for every producer in this repository. The pool
# these archives land in carries a single version across all of it, and it is
# shared with producers that have no crate manifest to read a number out of.
VERSION="$(bash "${VERSION_SH}")"
[ -n "${VERSION}" ] || {
    echo "error: ${VERSION_SH} printed no version (see its message above); the archives would be named around an empty string" >&2
    exit 1
}

# SOURCE_DATE_EPOCH is the commit's timestamp, resolved on the HOST: the
# container sees this worktree through a bind mount whose .git is a file
# naming a gitdir outside it, so git in there reports `not a git repository`.
# pack.sh has no default for it and fails by name if it is unset.
#
# A dirty tree keeps the same commit timestamp rather than taking `now`. The
# version already says `.dirty`, so the archive is marked as one that no commit
# reproduces; moving the clamp forward would only make two dirty builds of one
# tree differ from each other as well, which is the property worth keeping.
SOURCE_DATE_EPOCH="$(git -C "${REPO_ROOT}" log -1 --format=%ct)"
[ -n "${SOURCE_DATE_EPOCH}" ] || {
    echo "error: \`git log -1 --format=%ct\` produced no commit timestamp in ${REPO_ROOT}" >&2
    exit 1
}

# The commit the binaries themselves report, the same value and the same
# resolution os/pkgs/mosd/hack/build-target.sh uses -- mosd and apid answer
# --version with `<name> <crate version> (<commit>)`, and os/verify's smoke
# runner checks that against what the build embedded.
MOS_BUILD_COMMIT="${MOS_BUILD_COMMIT:-${COMMIT}${DIRTY:+-dirty}}"

# ---------------------------------------------------------------- route A

# Producer-private, so this producer has its own cache key and its own output
# directory: sharing os/pkgs/mosd/target/ with build-target.sh would let a
# four-binary build satisfy the independence assertion below with binaries this
# producer never asked for. Gitignored through os/pkgs/mosd/.gitignore.
TARGET_DIR="${WORKSPACE}/target-deb/${PRODUCER}"
RELEASE_DIR="${TARGET_DIR}/${TRIPLE}/release"

CARGO_CACHE="${REPO_ROOT}/_out/cargo"
mkdir -p "${CARGO_CACHE}/registry" "${CARGO_CACHE}/git"

mapfile -t RUST_FROM < <(bash "${FROM_SH}" --arch=amd64 MOS_BUILD_RUST=LOCAL_MOS_BUILD_RUST)
[ "${#RUST_FROM[@]}" -eq 2 ] || {
    echo "error: os/build-env/from.sh did not yield localhost/mos-build-rust:amd64 (see its message above); it is built by \`make build-env\`, which must run before any component build that stands on it" >&2
    exit 1
}
RUST_IMAGE="${RUST_FROM[1]#MOS_BUILD_RUST=}"

# The repository at the fixed path /src, not where it happens to live, for the
# reason build-target.sh gives: rustc records the paths it is given, so
# mounting the checkout at its own path would make the binaries depend on the
# directory the repository was cloned into.
docker run --rm \
    --label ai-agent=true \
    --platform linux/amd64 \
    -v "${REPO_ROOT}:/src" \
    -v "${CARGO_CACHE}/registry:/usr/local/cargo/registry" \
    -v "${CARGO_CACHE}/git:/usr/local/cargo/git" \
    -w /src/os/pkgs/mosd \
    -e "TARGET=${TRIPLE}" \
    -e "ELF_ARCH=${ELF_ARCH}" \
    -e "CRATES=${BINARIES[*]}" \
    -e "CARGO_TARGET_DIR=/src/os/pkgs/mosd/target-deb/${PRODUCER}" \
    -e "MOS_BUILD_COMMIT=${MOS_BUILD_COMMIT}" \
    --entrypoint /bin/bash \
    "${RUST_IMAGE}" -c '
        set -euo pipefail
        [ -f /etc/mos-build/rust.env ] || {
            echo "error: this image carries no /etc/mos-build/rust.env, so what compiled these binaries cannot be read back out of it" >&2
            exit 1
        }
        . /etc/mos-build/rust.env
        echo "build-deb: compiling ${CRATES} for ${TARGET} with rustc ${MOS_BUILD_RUSTC} from ${MOS_BUILD_IMAGE}"
        # -p per crate and nothing else: the whole point of a producer is that
        # it cannot emit a binary it does not own. --locked makes Cargo.lock
        # the decision and refuses a build that would quietly update it.
        pkgs=""
        for c in ${CRATES}; do pkgs="${pkgs} -p ${c}"; done
        # shellcheck disable=SC2086
        cargo build --release --locked --target "${TARGET}" ${pkgs}
        for name in ${CRATES}; do
            bin="${CARGO_TARGET_DIR}/${TARGET}/release/${name}"
            [ -f "${bin}" ] || { echo "error: ${name} was not produced by the build" >&2; exit 1; }
            got="$(file -b "${bin}")"
            case "${got}" in
            *"ELF 64-bit"*"${ELF_ARCH}"*) ;;
            *) echo "error: ${name} is not an ${ELF_ARCH} ELF: ${got}" >&2; exit 1 ;;
            esac
        done
    '

# What this producer OWNS, checked before what it must not hold. Without this
# the scan below would pass over a directory the build never wrote -- an "is
# absent" assertion over an empty tree reports green forever.
for name in "${BINARIES[@]}"; do
    [ -f "${RELEASE_DIR}/${name}" ] || {
        echo "error: ${RELEASE_DIR}/${name} does not exist after the build. The compile reported success, so this is the export or the target directory and not the compiler" >&2
        exit 1
    }
done

# INDEPENDENCE, asserted rather than described. `cargo build -p mosd -p apid`
# is the intent; this is the evidence, and it is what a later gate can point
# at. A binary here means the producer boundary leaked -- a stale target
# directory reused, or a -p list that grew.
stray=""
for name in "${EXCLUDED[@]}"; do
    while IFS= read -r f; do
        [ -z "${f}" ] || stray="${stray} ${f}"
    done < <(find "${TARGET_DIR}" -type f -name "${name}")
done
if [ -n "${stray}" ]; then
    echo "error: the ${PRODUCER} producer's target directory holds binaries it does not own:${stray}. Each producer compiles only its own crates into its own CARGO_TARGET_DIR; see os/pkgs/mosd/deb/README.md" >&2
    exit 1
fi
echo "build-deb: ${TARGET_DIR} holds ${BINARIES[*]} and none of ${EXCLUDED[*]}"

# A small staging directory rather than the release directory itself: a cargo
# target directory is gigabytes of intermediates, and buildx would walk all of
# it to find two files. tmp/ is gitignored and under the worktree, which is
# where anything a container must see lives -- the docker daemon does not share
# this session's /tmp.
STAGE="${REPO_ROOT}/tmp/deb-${PRODUCER}-${ARCH}"
rm -rf "${STAGE}"
mkdir -p "${STAGE}"
for name in "${BINARIES[@]}"; do
    cp "${RELEASE_DIR}/${name}" "${STAGE}/${name}"
done

# ---------------------------------------------------------------- route B

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
    if printf '%s\n' "${default_platforms}" | grep -c "linux/${ARCH}" >/dev/null; then
        BUILDER=default
    else
        BUILDER="mos-${ARCH}"
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
    ! printf '%s\n' "${builder_inspect}" | grep -c "linux/${ARCH}" >/dev/null; then
    echo "error: the buildx builder '${BUILDER}' uses the docker driver and does not offer linux/${ARCH} on this host, so pack.sh would fail with 'exec format error' before it read a single control field. Either register the emulator on the HOST -- docker run --privileged --rm tonistiigi/binfmt --install ${ARCH} -- or unset BUILDX_BUILDER and let this script select the docker-container builder 'mos-${ARCH}', whose buildkit image bundles the emulators and needs no host registration" >&2
    exit 1
fi

mapfile -t FROM_ARGS < <(bash "${FROM_SH}" --arch="${ARCH}" MOS_BUILD_DEB=LOCAL_MOS_BUILD_DEB)
[ "${#FROM_ARGS[@]}" -eq 2 ] || {
    echo "error: os/build-env/from.sh did not yield localhost/mos-build-deb:${ARCH} (see its message above); it is built by \`make build-env\`" >&2
    exit 1
}

# The same image a second time, as content, for a builder that cannot read the
# local image store: every driver but `docker` has its own content store and
# reads `localhost/` as a registry hostname. Only for that builder -- exporting
# it otherwise would copy 300 MB to disk on every native build to change
# nothing.
CTX_ARGS=()
if [ "${BUILDER_DRIVER}" != docker ]; then
    OCI_DIR="${REPO_ROOT}/tmp/deb-oci-${PRODUCER}-${ARCH}"
    rm -rf "${OCI_DIR}"
    mkdir -p "${OCI_DIR}"
    trap 'rm -rf "${OCI_DIR}"' EXIT
    mapfile -t CTX_ARGS < <(bash "${FROM_SH}" --arch="${ARCH}" --contexts="${OCI_DIR}" LOCAL_MOS_BUILD_DEB)
    [ "${#CTX_ARGS[@]}" -eq 2 ] || {
        echo "error: os/build-env/from.sh did not yield the OCI layout context for localhost/mos-build-deb:${ARCH} (see its message above); the '${BUILDER}' builder would have resolved the FROM as a pull from a registry called 'localhost'" >&2
        exit 1
    }
fi

POOL="${REPO_ROOT}/_out/debs/${ARCH}/pool"
mkdir -p "${POOL}"
# This producer's own archives only. The pool is shared -- os/build-env/deb/repo.sh
# indexes every .deb in it -- so a wholesale clean here would delete another
# producer's output, while leaving the previous VERSION of this one behind would
# have repo.sh index two versions of the same package.
for p in "${PACKAGES[@]}"; do
    rm -f "${POOL}/${p}"_*.deb
done

DIST_ARGS=()
for c in "${DIST_CONTEXTS[@]}"; do
    DIST_ARGS+=(--build-context "${c}")
done

echo "build-deb: packing ${PACKAGES[*]} ${VERSION} for ${ARCH} on builder '${BUILDER}' (${BUILDER_DRIVER})"
docker buildx build --builder "${BUILDER}" \
    --platform "linux/${ARCH}" \
    "${FROM_ARGS[@]}" \
    ${CTX_ARGS[@]+"${CTX_ARGS[@]}"} \
    --build-context "packer=${REPO_ROOT}/os/build-env/deb" \
    "${DIST_ARGS[@]}" \
    --build-context "bin=${STAGE}" \
    --build-arg "MOS_DEB_VERSION=${VERSION}" \
    --build-arg "MOS_DEB_ARCH=${ARCH}" \
    --build-arg "SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}" \
    -f "${PRODUCER_DIR}/Dockerfile" \
    -o "type=local,dest=${POOL}" \
    "${DEB_DIR}"

# What landed on disk, not what the build stage said it wrote. An export that
# dropped a file, or a cache hit that served an older layer, is invisible to
# pack.sh's own read-back and caught here.
missing=""
for p in "${PACKAGES[@]}"; do
    [ -f "${POOL}/${p}_${VERSION}_${ARCH}.deb" ] || missing="${missing} ${p}_${VERSION}_${ARCH}.deb"
done
if [ -n "${missing}" ]; then
    echo "error: the export is missing:${missing} under ${POOL}" >&2
    exit 1
fi

rm -rf "${STAGE}"
for p in "${PACKAGES[@]}"; do
    echo "${POOL}/${p}_${VERSION}_${ARCH}.deb"
done
