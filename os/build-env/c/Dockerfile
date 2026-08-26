# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# mos-build-c -- the C and C++ toolchain, on top of mos-build-base.
#
#   make build-env   -> localhost/mos-build-c
#
# FROM localhost/mos-build-base, which is itself built from a digest pinned in
# os/build-env/images.env; the chain is pinned at its root, which is the only
# place a chain can be pinned. Nothing in this file names an image, a version
# or a floor.

# It is a separate image rather than more packages in mos-build-base because
# os/podman/Dockerfile tried the merged list and recorded the bill: adding one
# package to a shared apt list invalidated the cache for five unrelated
# compilers, about 42 minutes of recompilation under emulation. Kept apart,
# adding a C library here rebuilds this image and leaves Go and Rust alone.
# The same arithmetic is why images.lock is filtered per image.

# What is in it is the language toolchain -- compiler, linker driver, the three
# build drivers a C project might use, and ccache in front of the compiler.
# Component-specific -dev packages are NOT here: os/podman/Dockerfile's C stage
# needs libseccomp-dev, libcap-dev, libjson-c-dev, libyajl-dev, libglib2.0-dev
# and libsystemd-dev, and none of those is a fact about C -- they are facts
# about crun and conmon. They belong in a stage that is FROM mos-build-c with
# its own apt list, so that a header only crun needs does not invalidate an
# image netavark also stands on.

# Native only, deliberately. This image carries no cross toolchain because the
# C components in this tree are built under emulation at the target platform --
# os/podman/build.sh passes --platform and lets buildkit's qemu do it -- so a
# cross gcc here would be weight nothing invokes. mos-build-rust is the
# opposite case and says why in its own header; the asymmetry is between what
# the two ecosystems make cheap, not between two opinions.
ARG MOS_BASE_IMAGE

FROM ${MOS_BASE_IMAGE} AS final

# images.lock, not images.env: os/build-env/build.sh derives it by stripping
# comments and blank lines, and filters it to this image's own C_ keys. Prose
# added to images.env therefore does not invalidate this layer, and a pin added
# for Go or Rust does not either -- both measured elsewhere in this tree, both
# in os/podman/Dockerfile's header.
#
# It lands on /etc/mos-build/images.env, overwriting the parent's copy of the
# same path. That is intended: the parent's BASE_ keys are already spent -- they
# were asserted while mos-build-base was built and the result is recorded in
# /etc/mos-build/base.env, which this image inherits and does not touch. What a
# reader of this image needs is the pins THIS image was built from.
COPY images.lock /etc/mos-build/images.env

# One apt list, one cache id, and the id is this image's own so that a
# concurrent mos-build-go build cannot block on it. rm of docker-clean is what
# lets the cache mount keep the downloaded .debs -- the stock configuration
# deletes them in the same layer, so without it the mount caches nothing.
#
# build-essential rather than a hand-picked gcc/g++/libc6-dev/make list: it is
# the package Debian keeps correct as a set, and picking the members by hand is
# how an image ends up with a compiler and no libc headers, which fails at the
# first #include and not at install time.
RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-mos-build-c,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-mos-build-c,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        pkgconf \
        autoconf \
        automake \
        libtool \
        ccache \
        python3

# ccache in front of the real compilers, as os/podman/Dockerfile's C stage does
# and for the reason it measured: the C components had no compiled-object cache
# while the Go stage had two, so any change upstream paid a full crun recompile
# -- about 10 minutes under emulation -- to rebuild bytes identical to the
# previous run's.
#
# Set here rather than in each consumer so the win is not something every
# consumer has to remember. CCACHE_DIR is a path and not a cache: what makes it
# survive a layer invalidation is a consumer mounting it,
# `--mount=type=cache,target=/ccache`. Without the mount ccache still works and
# still throws its cache away with the layer, which is the same behaviour as not
# having it -- so this is a floor, not a promise.
ENV CCACHE_DIR=/ccache \
    PATH="/usr/lib/ccache:${PATH}"

# The toolchain, asserted from inside the image that promises it.

# The compile is the assertion, and the version numbers are the smaller half of
# this stage. `gcc --version` answers on an image whose libc headers were never
# installed, whose linker is missing, and whose cross-arch confusion means it
# emits objects for the host while claiming to be the target -- every one of
# which is a green version check and a build that dies two images above, at a
# distance from the cause. So this compiles a C and a C++ translation unit,
# links both, and reads the architecture back out of the ELF with `file`, one
# of the tools mos-build-base promised. An image that cannot produce a binary
# of its own architecture is not a C toolchain whatever gcc prints.

# Floors, not exact versions. Everything above came from apt against live
# deb.debian.org, which the base digest does not pin, so an exact assertion
# would go red on the next trixie point release and teach whoever hit it to
# widen the check until it meant nothing. Contrast mos-build-go and
# mos-build-rust, which assert exact versions because their toolchains arrive
# as tarballs pinned by sha256 -- there the exact value is a fact the tree owns.
# autoconf/automake/libtoolize/python3 are presence-only; images.env records why
# a floor on a build driver is a number nobody can justify raising.
ARG MOS_BASE_IMAGE
ARG TARGETARCH
RUN set -eu; \
    . /etc/mos-build/images.env; \
    fail=0; \
    say() { echo "mos-build-c: $*" >&2; fail=1; }; \
    ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }; \
    need() { \
        command -v "$1" >/dev/null 2>&1 || say "error: ${1} is not on PATH, but this image promises it"; \
    }; \
    check() { \
        name="$1"; want="$2"; got="$3"; \
        if [ -z "${got}" ]; then say "error: could not read a version out of ${name}"; \
        elif ge "${got}" "${want}"; then echo "ok ${name} ${got} (floor ${want})"; \
        else say "error: ${name} is ${got}, below the floor ${want} that os/build-env/images.env declares. Either the apt archive moved backwards or the floor was raised without measuring; do not lower the floor to make this pass"; fi; \
    }; \
    arch="$(dpkg --print-architecture)"; \
    if [ -n "${TARGETARCH:-}" ] && [ "${arch}" != "${TARGETARCH}" ]; then \
        say "error: this image is ${arch} but the build asked for ${TARGETARCH}; the builder has no emulator for it and silently produced a host-architecture image"; \
    fi; \
    for t in gcc g++ cc make cmake pkgconf ccache autoconf automake libtoolize python3 ld; do need "${t}"; done; \
    check gcc     "${C_FLOOR_GCC_MIN}"     "$(gcc -dumpfullversion 2>/dev/null)"; \
    check g++     "${C_FLOOR_GCC_MIN}"     "$(g++ -dumpfullversion 2>/dev/null)"; \
    check make    "${C_FLOOR_MAKE_MIN}"    "$(make --version 2>/dev/null | head -n1 | awk '{print $NF}')"; \
    check cmake   "${C_FLOOR_CMAKE_MIN}"   "$(cmake --version 2>/dev/null | head -n1 | awk '{print $NF}')"; \
    check pkgconf "${C_FLOOR_PKGCONF_MIN}" "$(pkgconf --version 2>/dev/null)"; \
    check ccache  "${C_FLOOR_CCACHE_MIN}"  "$(ccache --version 2>/dev/null | head -n1 | awk '{print $3}')"; \
    d="$(mktemp -d)"; \
    printf '#include <stdio.h>\n#include <stdlib.h>\nint main(void){printf("%%zu\\n", sizeof(void *)); return EXIT_SUCCESS;}\n' >"${d}/probe.c"; \
    printf '#include <string>\n#include <vector>\nint main(){std::vector<std::string> v{"a"}; return v.size() == 1 ? 0 : 1;}\n' >"${d}/probe.cc"; \
    if gcc -O2 -o "${d}/probe.c.bin" "${d}/probe.c" 2>"${d}/cc.err"; then \
        got="$(file -b "${d}/probe.c.bin")"; \
        case "${arch}:${got}" in \
        amd64:*x86-64*) echo "ok gcc links an amd64 ELF" ;; \
        arm64:*aarch64*) echo "ok gcc links an arm64 ELF" ;; \
        *) say "error: gcc on this ${arch} image produced '${got}', which is not a ${arch} ELF. A toolchain that compiles for the wrong architecture passes every version check above and fails at exec time on the device" ;; \
        esac; \
    else \
        say "error: gcc cannot compile and link a program that includes stdio.h: $(head -n3 "${d}/cc.err" | tr '\n' ' ')"; \
    fi; \
    g++ -O2 -o "${d}/probe.cc.bin" "${d}/probe.cc" 2>"${d}/cxx.err" \
        || say "error: g++ cannot compile and link a program that includes <string> and <vector>; the C++ standard library headers are missing even though g++ itself is present: $(head -n3 "${d}/cxx.err" | tr '\n' ' ')"; \
    rm -rf "${d}"; \
    [ "${fail}" = 0 ] || { echo "mos-build-c: the toolchain this image promises is not what it contains; see the errors above" >&2; exit 1; }; \
    mkdir -p /etc/mos-build; \
    { \
        echo "MOS_BUILD_IMAGE=mos-build-c"; \
        echo "MOS_BUILD_FROM=${MOS_BASE_IMAGE}"; \
        echo "MOS_BUILD_ARCH=${arch}"; \
        echo "MOS_BUILD_GCC=$(gcc -dumpfullversion)"; \
        echo "MOS_BUILD_GXX=$(g++ -dumpfullversion)"; \
        echo "MOS_BUILD_MAKE=$(make --version | head -n1 | awk '{print $NF}')"; \
        echo "MOS_BUILD_CMAKE=$(cmake --version | head -n1 | awk '{print $NF}')"; \
        echo "MOS_BUILD_PKGCONF=$(pkgconf --version)"; \
        echo "MOS_BUILD_CCACHE=$(ccache --version | head -n1 | awk '{print $3}')"; \
        echo "MOS_BUILD_AUTOCONF=$(autoconf --version | head -n1 | awk '{print $NF}')"; \
        echo "MOS_BUILD_PYTHON3=$(python3 --version | awk '{print $2}')"; \
    } >/etc/mos-build/c.env

# Its own file, not the parent's. os/build-env/build.sh reads back
# /etc/mos-build/<name>.env named after this image. mos-build-c inherits
# /etc/mos-build/base.env from mos-build-base, so a check for a fixed filename
# would be answered by the parent's record and would prove nothing about the
# child; writing c.env is what makes "each builder image asserts its toolchain
# version internally" a thing that can be verified from outside the build log.
LABEL org.opencontainers.image.title="mos-build-c" \
      org.opencontainers.image.description="mos C/C++ toolchain" \
      org.opencontainers.image.base.name="${MOS_BASE_IMAGE}" \
      com.mos.build-env.source="os/build-env/c/Dockerfile" \
      com.mos.build-env.pins="os/build-env/images.env"
