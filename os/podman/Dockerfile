# syntax=docker/dockerfile:1
# PLAN-012 M1 — the container engine, built from upstream source for aarch64.
#
#   make podman   → os/podman/out/{podman,quadlet,crun,conmon,netavark,
#                                  aardvark-dns,catatonit,SHA256SUMS}
#
# Same shape as board/cx3576/kernel/Dockerfile: builder stages, then a final
# scratch stage that `-o` exports. Nothing here installs into a rootfs;
# os/rootfs/build-v2.sh stages the output as it stages modules.tar and mosd.
#
# WHY THIS EXISTS: VERSION CONTROL, not size. trixie ships podman 5.4.2, crun
# 1.21 and netavark 1.14. Building here makes the engine's version a decision
# recorded in versions.env rather than a consequence of which Debian release
# the base happens to be. Trimming the build (see BUILDTAGS) is a second,
# smaller benefit.
#
# DYNAMIC AGAINST GLIBC, NOT STATIC AGAINST MUSL — and the first attempt at
# this file got that wrong. Static/musl was chosen to "decouple the engine from
# the base", which solves a problem this appliance does not have: the image
# already ships glibc, and every library podman needs is either in it already
# or is one runtime package. The static route cost ten build iterations and hit
# two hard blockers, BOTH of them musl-only:
#   * Rust edition 2024 needs rustc >= 1.85; Alpine 3.21 shipped 1.83.
#   * aardvark-dns 2.x calls libc::close_range, which the libc crate defines
#     for gnu and NOT for musl (measured: 1 occurrence in gnu/mod.rs, 0 in
#     musl/mod.rs), forcing a downgrade to the 1.17 network stack.
# Building against glibc removes both, and the 2.1 pair is back.
#
# THE BUILDER IS TRIXIE, matching the image's base on purpose: the binaries
# link against the same glibc, libseccomp and libsubid sonames the rootfs
# carries, so "it linked here" and "it runs there" are the same claim. The
# verify stage emits each binary's NEEDED list and os/rootfs/Dockerfile.v2
# checks it with ldd against the assembled root, rather than trusting it.
#
# CGO IS REQUIRED — podman's own Makefile says so ("Podman does not work w/o
# CGO_ENABLED, except in some very specific cases").
#
# WHY FOUR BUILDER STAGES AND NOT ONE SHARED IMAGE. The obvious economy is to
# merge the C, Rust and Go toolchains into a single builder so the apt work
# happens once. It makes the cache WORSE, and this build measured it: adding
# libsystemd-dev — needed then by the Go stage, for <systemd/sd-journal.h> —
# invalidated go-build and nothing else, so crun, conmon, catatonit, netavark
# and aardvark-dns all came from cache. (The C stage needs it too now: conmon
# compiles its journald path out without it, which cost a device boot to find.
# The measurement above still stands — that is the point of separate lists.) Merged behind one apt list, that same
# one-package edit would have recompiled every component, about 42 minutes
# under emulation. One dependency list means one cache key for five unrelated
# compilers. Separate stages also let BuildKit run C, Rust and Go concurrently.
#
# What the merge was really reaching for is cheap re-provisioning, and that is
# what the cache mounts below buy instead — per-stage apt caches so an
# invalidated stage re-installs from local .debs, plus compiled-output caches
# for all three languages.

ARG BUILDER_IMAGE=debian:trixie-slim
ARG GO_IMAGE=golang:1.25-trixie
ARG RUST_IMAGE=rust:1.90-trixie

# ---------------------------------------------------------------------------
# Sources: fetched once, hashed, shared by every builder below
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM ${BUILDER_IMAGE} AS src
RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-src,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-src,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates
# versions.lock, not versions.env: build.sh derives it by stripping comments
# and blank lines. The two carry identical values, and the lock is what this
# stage's cache key is computed over.
#
# Measured, on this build: adding a paragraph of prose to versions.env — no
# version, no hash changed — invalidated this COPY and with it every downstream
# stage, which is a two-hour recompile of crun, netavark, aardvark-dns and
# podman to record a rationale. A cache key should be the inputs, not the
# commentary about the inputs, or the commentary stops getting written.
COPY versions.lock /versions.env

# Each fetch is a shallow clone at the pinned tag, verified against the hash in
# versions.env. `git archive` of the tag is a deterministic byte stream for the
# tree we compile — unlike a release tarball, which upstream can regenerate,
# and unlike a commit id, which says nothing about content.
#
# --recurse-submodules, because crun vendors libocispec as one and a clone
# without it leaves an EMPTY directory that ./configure only warns about and
# make then dies on ("No rule to make target 'all'"). Found by building.
#
# WHAT THE HASH COVERS, precisely: `git archive` writes the superproject tree,
# in which a submodule appears as its commit id, not its content. The submodule
# is pinned TRANSITIVELY — a git commit id is content-addressed — but its bytes
# are not in this hash. Stated because "the hash covers the source we compile"
# is very nearly true and the difference is exactly one indirection.
#
# .git is kept: crun and podman both read it to stamp a version, and deleting
# it traded a few MB in a stage that never ships for `fatal: not a git
# repository` in the middle of a compile.
#
# PENDING is accepted and reported rather than silently passed: it is how a
# version is bumped (see versions.env). MOS_PODMAN_STRICT=1 refuses it, which
# is what CI sets, so an unhashed source can reach a developer and never a
# release.
ARG MOS_PODMAN_STRICT=0
RUN --mount=type=cache,target=/root/.cache/git \
    set -eu; . /versions.env; \
    fetch() { \
        name="$1"; url="$2"; tag="$3"; want="$4"; \
        git clone --quiet --depth 1 --branch "${tag}" \
            --recurse-submodules --shallow-submodules "${url}" "/src/${name}"; \
        got="$(git -C "/src/${name}" archive --format=tar "${tag}" | sha256sum | cut -d' ' -f1)"; \
        if [ "${want}" = "PENDING" ]; then \
            echo "HASH ${name} ${tag} ${got}"; \
            if [ "${MOS_PODMAN_STRICT}" = "1" ]; then \
                echo "error: ${name} is pinned to ${tag} with no hash, and MOS_PODMAN_STRICT=1 refuses that. Record the hash printed above in os/podman/versions.env" >&2; exit 1; \
            fi; \
            echo "warning: ${name} ${tag} is UNHASHED. Record ${got} in os/podman/versions.env — until then this build trusts whatever the tag points at today" >&2; \
        elif [ "${want}" != "${got}" ]; then \
            echo "error: ${name} ${tag} hashes to ${got}, but os/podman/versions.env pins ${want}. Either the tag was moved upstream or the pin is stale; do not paste the new hash in without finding out which" >&2; exit 1; \
        else \
            echo "ok ${name} ${tag} ${got}"; \
        fi; \
    }; \
    fetch podman       https://github.com/containers/podman.git       "${PODMAN_VERSION}"    "${PODMAN_SHA256}"; \
    fetch crun         https://github.com/containers/crun.git         "${CRUN_VERSION}"      "${CRUN_SHA256}"; \
    fetch conmon       https://github.com/containers/conmon.git       "${CONMON_VERSION}"    "${CONMON_SHA256}"; \
    fetch netavark     https://github.com/containers/netavark.git     "${NETAVARK_VERSION}"  "${NETAVARK_SHA256}"; \
    fetch aardvark-dns https://github.com/containers/aardvark-dns.git "${AARDVARK_VERSION}"  "${AARDVARK_SHA256}"; \
    fetch catatonit    https://github.com/openSUSE/catatonit.git      "${CATATONIT_VERSION}" "${CATATONIT_SHA256}"

# ---------------------------------------------------------------------------
# C components. Runs AS aarch64 under the builder's emulation.
# ---------------------------------------------------------------------------
FROM ${BUILDER_IMAGE} AS c-build
# Grouped by what needs each package. A missing build tool reports as a missing
# command a hundred lines into a compile, which is how an earlier revision of
# this file spent an iteration on an absent autoconf.
RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-c,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-c,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
        build-essential git make cmake pkgconf file python3 ca-certificates \
        autoconf automake libtool ccache \
        libseccomp-dev libcap-dev \
        libjson-c-dev libyajl-dev \
        libglib2.0-dev \
        libsystemd-dev
# ccache in front of the real compilers. The C components had NO compiled-object
# cache while the Go stage had two (/root/.cache/go-build and /go/pkg/mod), so
# any change upstream of this stage paid a full crun recompile -- ~10 minutes
# under emulation -- to rebuild bytes identical to the previous run's.
ENV CCACHE_DIR=/ccache PATH="/usr/lib/ccache:${PATH}"
COPY --from=src /src/crun /src/crun
COPY --from=src /src/conmon /src/conmon
COPY --from=src /src/catatonit /src/catatonit
RUN mkdir -p /out

RUN --mount=type=cache,target=/ccache,id=ccache-c \
    set -eu; cd /src/crun; \
    ./autogen.sh; \
    ./configure --disable-systemd; \
    make -j"$(nproc)"; \
    install -m0755 crun /out/crun

# libsystemd-dev above is what gives conmon JOURNALD SUPPORT, and its absence
# is not a build error -- conmon's Makefile probes for libsystemd with
# pkg-config and simply compiles the journald path out when it is missing. The
# binary builds, installs and runs; it refuses only at the moment a container
# actually starts:
#   [conmon:e]: Include journald in compilation path to log to systemd journal
#   Error: conmon failed: exit status 1
# and /etc/containers/containers.conf sets log_driver = "journald", so that is
# EVERY container on the device. Found by booting x64 and starting one, after
# the CA bundle let the image pull succeed.
#
# os/rootfs/Dockerfile.v2 already asserts libsystemd.so.0 is in the image
# because podman DLOPENS it for journald logging. That check is about podman
# and could not see this: conmon's dependency is decided at COMPILE time, in a
# different build, by whether a header was present.
RUN --mount=type=cache,target=/ccache,id=ccache-c \
    set -eu; cd /src/conmon; \
    make -j"$(nproc)" bin/conmon; \
    install -m0755 bin/conmon /out/conmon; \
    ldd /out/conmon | grep -q libsystemd || \
        { echo "error: conmon was built WITHOUT journald support. Its Makefile compiles the journald path out when libsystemd is not found, silently -- and containers.conf sets log_driver=journald, so every container start fails with 'Include journald in compilation path'" >&2; exit 1; }; \
    echo "conmon: linked against libsystemd, so log_driver=journald works"

# catatonit is STATIC, alone among these, and for a reason that is not about
# this image: it is copied INTO containers as their init, where the libc is
# whatever the container ships. A dynamic catatonit fails to exec inside
# anything not built against this glibc.
RUN --mount=type=cache,target=/ccache,id=ccache-c \
    set -eu; cd /src/catatonit; \
    ./autogen.sh && ./configure LDFLAGS="-static"; \
    make -j"$(nproc)"; \
    install -m0755 catatonit /out/catatonit

# ---------------------------------------------------------------------------
# Rust: netavark and aardvark-dns
# ---------------------------------------------------------------------------
FROM ${RUST_IMAGE} AS rust-build
RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-rust,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-rust,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
        protobuf-compiler pkgconf ca-certificates
COPY --from=src /src/netavark /src/netavark
COPY --from=src /src/aardvark-dns /src/aardvark-dns
# No --target and no crt-static: this is a native glibc build, so cargo's host
# and target are the same and nothing needs the host/target flag split the musl
# attempt required (crt-static in plain RUSTFLAGS reaches the host build too,
# and a proc-macro is a dynamic library that cannot be produced under it).
# The target/ mounts are the expensive omission this build ran into. With only
# the registry cached, cargo re-downloaded nothing and RECOMPILED everything:
# measured on this build, netavark 23m58s and aardvark-dns 8m05s, almost all of
# it the shared dependency tree, every time any stage above was invalidated.
# The Go stage next door had been caching its compiled output since it was
# written -- the asymmetry was an oversight, not a decision.
#
# A cache mount is not part of the image layer, so it survives layer
# invalidation; that is the point, and it is safe here because cargo decides
# what to reuse by fingerprint, not by mtime. A version bump in versions.env
# changes the source tree and cargo rebuilds what changed.
RUN --mount=type=cache,target=/usr/local/cargo/registry,id=cargo-registry \
    --mount=type=cache,target=/usr/local/cargo/git,id=cargo-git \
    --mount=type=cache,target=/src/netavark/target,id=netavark-target \
    --mount=type=cache,target=/src/aardvark-dns/target,id=aardvark-target \
    set -eu; mkdir -p /out; \
    cd /src/netavark && cargo build --release; \
    install -m0755 target/release/netavark /out/netavark; \
    cd /src/aardvark-dns && cargo build --release; \
    install -m0755 target/release/aardvark-dns /out/aardvark-dns

# ---------------------------------------------------------------------------
# Go: podman and its Quadlet generator
# ---------------------------------------------------------------------------
FROM ${GO_IMAGE} AS go-build
RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-go,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-go,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
        build-essential pkgconf git ca-certificates binutils \
        libseccomp-dev libsubid-dev libsqlite3-dev libsystemd-dev
COPY --from=src /src/podman /src/podman

# BUILDTAGS — this is the trim, and each tag is a decision:
#
#   containers_image_openpgp   drops libgpgme for Go-native OpenPGP. Debian
#                              already uses this tag for its podman-remote
#                              build and NOT for the local one, which is what
#                              drags the whole GnuPG suite — gpg, gpg-agent,
#                              dirmngr, gpgsm, gnupg-l10n, libgcrypt — into the
#                              image: ~11 MB of tooling for container-image
#                              signature verification this appliance does not
#                              do. Measured on trixie, not assumed.
#   exclude_graphdriver_btrfs
#   exclude_graphdriver_devicemapper
#                              the storage driver is overlay
#                              (os/rootfs/overlay-v2/etc/containers/storage.conf)
#                              and devicemapper is deprecated upstream. Also
#                              keeps libbtrfs and libdevmapper out of the link.
#   seccomp                    KEPT. On a root-mode engine (PLAN-012 D5) the
#                              seccomp profile is the main thing between a
#                              container and the host kernel.
#   systemd                    KEPT. How Quadlet-generated units integrate.
#                              Needs libsystemd-dev at build time for
#                              <systemd/sd-journal.h> — the build failed on its
#                              absence, which is what a build tag costing a
#                              header looks like when the header is missing.
#   libsubid                   KEPT. podman's uid/gid mapping.
#
# apparmor and selinux are NOT in the list, unlike Debian's build: neither is
# enforced in this image, and each adds a link dependency for a policy nothing
# loads.
ARG BUILDTAGS="seccomp systemd libsubid containers_image_openpgp exclude_graphdriver_btrfs exclude_graphdriver_devicemapper"

# PREFIX=/usr, NOT the Makefile's default of /usr/local — and this is the kind
# of default that fails on the device and nowhere else.
#
# Makefile:133 links `-X .../quadlet._binDir=$(BINDIR)` into the quadlet
# binary, and BINDIR defaults to ${PREFIX}/bin = /usr/local/bin. mos installs
# podman at /usr/bin. With the default, quadlet would parse a .container file
# correctly, generate a unit correctly, and write an ExecStart pointing at a
# /usr/local/bin/podman that does not exist. Nothing fails at build time; the
# unit fails at start with "no such file or directory" naming podman, which
# looks like a broken install rather than a wrong compile-time constant.
#
# Debian passes the right PREFIX in its packaging, which is why the
# apt-installed engine RFCT-101 shipped does not have this problem. Building
# ourselves means owning the flag.
ARG PODMAN_PREFIX=/usr
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    set -eu; cd /src/podman; mkdir -p /out; \
    make PREFIX="${PODMAN_PREFIX}" BUILDTAGS="${BUILDTAGS}" bin/podman bin/quadlet; \
    install -m0755 bin/podman /out/podman; \
    install -m0755 bin/quadlet /out/quadlet; \
    if strings -a bin/quadlet | grep -qx "/usr/local/bin"; then \
        echo "error: the quadlet binary still carries /usr/local/bin as its podman directory. Every unit it generates would name a podman that is not in this image, and the failure appears only when a container is started" >&2; exit 1; \
    fi

# ---------------------------------------------------------------------------
# Collect, and prove every artifact is what it claims to be
# ---------------------------------------------------------------------------
FROM ${BUILDER_IMAGE} AS verify
# The architecture this build is FOR, so the assertion below cannot pass by
# naming the one it was first written against. Defaulted rather than required
# so a bare `docker buildx build` on this Dockerfile still checks something.
ARG ELF_ARCH=aarch64
RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-verify,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-verify,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
        file binutils
COPY --from=c-build /out/ /out/
COPY --from=rust-build /out/ /out/
COPY --from=go-build /out/ /out/
# NEEDED.txt is EMITTED here, not checked here. Whether each soname resolves is
# a question about the image these binaries are going into, and it is asked in
# os/rootfs/Dockerfile.v2 with `ldd` against the assembled root -- the loader's
# own answer, rather than a list compared to a list from a previous build.
RUN set -eu; cd /out; \
    for b in podman quadlet crun conmon catatonit netavark aardvark-dns; do \
        test -f "$b" || { echo "error: $b was not produced by the build" >&2; exit 1; }; \
        file -b "$b" | grep -q "ELF 64-bit.*${ELF_ARCH}" || \
            { echo "error: $b is not an ${ELF_ARCH} ELF: $(file -b "$b")" >&2; exit 1; }; \
    done; \
    file -b catatonit | grep -q 'statically linked' || \
        { echo "error: catatonit is dynamically linked. It is copied INTO containers as their init and must not depend on this image's libc" >&2; exit 1; }; \
    for b in podman quadlet crun conmon netavark aardvark-dns; do \
        objdump -p "$b" | awk -v b="$b" '/NEEDED/{print b": "$2}'; \
    done > /out/NEEDED.txt; \
    for b in podman quadlet crun conmon catatonit netavark aardvark-dns; do \
        printf '%-16s %8s KiB  %s\n' "$b" "$(( $(stat -c%s "$b") / 1024 ))" "$(file -b "$b" | cut -c1-38)"; \
    done; \
    sha256sum podman quadlet crun conmon catatonit netavark aardvark-dns > /out/SHA256SUMS

FROM scratch AS artifact
COPY --from=verify /out/ /
