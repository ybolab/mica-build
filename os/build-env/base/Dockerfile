# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# mos-build-base -- the floor every mos builder image stands on.
#
#   make build-env   -> localhost/mos-build-base
#
# PLAN-014 M2 (RFCT-108), decision 4. The image name, the digest it is built
# from and the versions it asserts are all values in os/build-env/images.env;
# nothing in this file names any of them. That is the point of the milestone:
# "which environment did this build run in" has to be answerable from the tree.
#
# WHAT IS IN IT, AND WHY SO LITTLE. ca-certificates, git, file, binutils, xz --
# the things a builder needs whatever language it is building. Compilers,
# language runtimes and their headers are NOT here; they belong to
# mos-build-{c,go,rust}, each with its own apt list.
#
# That split is measured, not aesthetic. os/podman/Dockerfile tried the obvious
# economy of one shared builder so the apt work happens once, and recorded what
# it cost: adding a single package to the merged list invalidated the cache for
# every component behind it, about 42 minutes of recompilation under emulation,
# because one dependency list is one cache key for five unrelated compilers.
# Kept apart, a Go-only package edit rebuilds the Go image and nothing else.
#
# WHY IT ASSERTS INSTEAD OF INSTALLING AND HOPING. The digest in images.env
# pins this image's base filesystem. It does not pin the apt archive: the
# `apt-get install` below resolves against live deb.debian.org and returns
# whatever trixie holds on the day it runs. So "the packages were requested" and
# "the floor is there" are different claims, and only the second one is what
# every image above this one is entitled to assume. The assert stage makes the
# second claim, inside the image, and fails the build when it is false --
# RFCT-108's "each builder image asserts its toolchain version internally",
# applied to the one image whose toolchain is the floor itself.

# No default, and the `check=skip` above is what that costs. A default would
# mean a driver that failed to pass the argument still builds -- from a floating
# tag, silently, which is the exact thing images.env exists to prevent. Blank
# here is a hard docker error instead, and os/build-env/build.sh refuses an
# undigested value before it ever gets here.
#
# BuildKit lints the absent default as InvalidDefaultArgInFrom, which is
# ordinarily good advice and is wrong for this file. It is skipped by name
# rather than left to print: a warning that is emitted on every green build is
# a warning nobody reads on the build where it matters.
ARG MOS_BASE_IMAGE

FROM ${MOS_BASE_IMAGE} AS base

# images.lock, not images.env: os/build-env/build.sh derives it by stripping
# comments and blank lines, and filters it to this image's own keys. Two
# separate reasons, both measured elsewhere in this tree.
#
# Stripping comments, because os/podman/Dockerfile measured the alternative:
# adding a paragraph of prose to versions.env -- no version and no hash changed
# -- invalidated the COPY and with it every stage below, a two-hour recompile to
# record a rationale. A cache key should be the inputs, not the commentary about
# the inputs, or the commentary stops getting written.
#
# Filtering by key prefix, for the same arithmetic one level up: an unfiltered
# lock would make M2c's ubuntu BSP pin invalidate this image, which shares
# nothing with it. os/build-env/images.env documents the prefix convention that
# makes the filter possible.
COPY images.lock /etc/mos-build/images.env

# One apt list, one cache id. rm of docker-clean is what lets the cache mount
# keep the downloaded .debs -- the stock configuration deletes them in the same
# layer, so without it the mount caches nothing and re-provisioning after an
# invalidation is a full re-download. Same arrangement, and the same reasoning,
# as every stage in os/podman/Dockerfile.
#
# NOTE ON WHAT THE CACHE MEANS HERE: BuildKit keys this RUN on the command
# text, not on what the archive returned, so a cached layer keeps yesterday's
# package versions until something above it changes. For a build environment
# that is the wanted behaviour -- it is stability, not staleness -- and bumping
# the digest in images.env is what deliberately invalidates it.
RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-mos-build-base,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-mos-build-base,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        file \
        binutils \
        xz-utils

# The floor, asserted from inside the image that promises it.
#
# TARGETARCH is checked first because everything after it is only meaningful
# once the image is the architecture it was asked for. A builder without the
# emulator for the requested platform does not fail -- it quietly produces a
# host-architecture image, and every version below would pass on it.
# os/update/rauc/build.sh refuses an unset MOS_ARCH for the same reason: a
# cross build that silently became a native one is discovered on the device.
#
# Versions are compared as MINIMUMS with sort -V, not matched exactly. The
# digest does not pin the apt archive (see above), so an exact match would go
# red on the next trixie point release and teach whoever hits it to widen the
# check until it means nothing. A minimum still catches the two directions that
# are real: a package that vanished, and a package that went backwards.
#
# binutils is asked for by five of its programs rather than one. It is a
# COLLECTION, and the failure this guards against is a slimmed or substituted
# package where `strip` is present and `readelf` is not -- which passes a
# one-program check and then breaks whichever builder above needed the missing
# one, at a distance from the cause.
#
# ca-certificates is asserted by the bundle FILE, not by dpkg: the package can
# be installed with an empty or unregenerated /etc/ssl/certs/ca-certificates.crt,
# and an empty bundle fails every TLS fetch in every image built on top of this
# one with an error that names the remote host and never the cause.
ARG MOS_BASE_IMAGE
ARG TARGETARCH
RUN set -eu; \
    . /etc/mos-build/images.env; \
    fail=0; \
    say() { echo "mos-build-base: $*" >&2; fail=1; }; \
    ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }; \
    need() { \
        got="$(command -v "$1" 2>/dev/null || true)"; \
        [ -n "${got}" ] || { say "error: ${1} is not on PATH, but this image promises it"; return 1; }; \
    }; \
    check() { \
        name="$1"; want="$2"; got="$3"; \
        if [ -z "${got}" ]; then say "error: could not read a version out of ${name}"; \
        elif ge "${got}" "${want}"; then echo "ok ${name} ${got} (floor ${want})"; \
        else say "error: ${name} is ${got}, below the floor ${want} that os/build-env/images.env declares. Either the base moved backwards or the floor was raised without measuring; do not lower the floor to make this pass"; fi; \
    }; \
    arch="$(dpkg --print-architecture)"; \
    if [ -n "${TARGETARCH:-}" ] && [ "${arch}" != "${TARGETARCH}" ]; then \
        say "error: this image is ${arch} but the build asked for ${TARGETARCH}; the builder has no emulator for it and silently produced a host-architecture image"; \
    fi; \
    codename="$(. /etc/os-release; echo "${VERSION_CODENAME:-}")"; \
    if [ "${codename}" != "${BASE_FLOOR_CODENAME}" ]; then \
        say "error: the base resolves to Debian '${codename}', but os/build-env/images.env declares BASE_FLOOR_CODENAME=${BASE_FLOOR_CODENAME}. The digest pin was changed to a well-formed digest of a DIFFERENT image"; \
    fi; \
    for t in git file strip objdump readelf ar nm xz; do need "${t}" || true; done; \
    check git      "${BASE_FLOOR_GIT_MIN}"      "$(git --version 2>/dev/null | awk '{print $3}')"; \
    check file     "${BASE_FLOOR_FILE_MIN}"     "$(file --version 2>/dev/null | head -n1 | sed 's/^file-//')"; \
    check binutils "${BASE_FLOOR_BINUTILS_MIN}" "$(strip --version 2>/dev/null | head -n1 | awk '{print $NF}')"; \
    check xz       "${BASE_FLOOR_XZ_MIN}"       "$(xz --version 2>/dev/null | head -n1 | awk '{print $NF}')"; \
    bundle=/etc/ssl/certs/ca-certificates.crt; \
    if [ ! -s "${bundle}" ]; then \
        say "error: ${bundle} is missing or empty; every TLS fetch in every image built on this one would fail naming the remote host and never the cause"; \
    else \
        echo "ok ca-certificates $(grep -c 'BEGIN CERTIFICATE' "${bundle}") certificates"; \
    fi; \
    [ "${fail}" = 0 ] || { echo "mos-build-base: the floor this image promises is not what it contains; see the errors above" >&2; exit 1; }; \
    mkdir -p /etc/mos-build; \
    { \
        echo "MOS_BUILD_IMAGE=mos-build-base"; \
        echo "MOS_BUILD_FROM=${MOS_BASE_IMAGE}"; \
        echo "MOS_BUILD_ARCH=${arch}"; \
        echo "MOS_BUILD_DEBIAN=${codename}"; \
        echo "MOS_BUILD_GIT=$(git --version | awk '{print $3}')"; \
        echo "MOS_BUILD_FILE=$(file --version | head -n1 | sed 's/^file-//')"; \
        echo "MOS_BUILD_BINUTILS=$(strip --version | head -n1 | awk '{print $NF}')"; \
        echo "MOS_BUILD_XZ=$(xz --version | head -n1 | awk '{print $NF}')"; \
    } >/etc/mos-build/base.env

# What the floor RESOLVED to, recorded in the image next to what it PROMISED.
# The promise is a minimum and cannot answer "which git actually built this";
# /etc/mos-build/base.env can, without a rebuild and without the build log,
# which is the only form of that answer that survives.
#
# Labels rather than only the file, so `docker inspect` reaches it too: the
# images above this one are throwaway builders that nobody keeps a shell in.
LABEL org.opencontainers.image.title="mos-build-base" \
      org.opencontainers.image.description="mos common build floor (PLAN-014 M2, RFCT-108)" \
      org.opencontainers.image.base.name="${MOS_BASE_IMAGE}" \
      com.mos.build-env.source="os/build-env/base/Dockerfile" \
      com.mos.build-env.pins="os/build-env/images.env"
