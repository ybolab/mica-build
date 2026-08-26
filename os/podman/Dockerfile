# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# The container engine, built from upstream source for aarch64.
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
# verify stage emits each binary's NEEDED list and os/rootfs/scripts/podman-assert.sh
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
#
# THE FOUR SHARED BUILDER IMAGES DO NOT UNDO THAT. The stages start from
# mos-build-{base,c,go,rust}, which is where the language toolchain comes from
# and not how many stages there are. Each stage keeps its own apt list, holding
# exactly the -dev packages its own components need, so the measurement above
# still describes what a one-package edit costs: adding libsystemd-dev to the
# Go list invalidates go-build and nothing else. The shared images carry
# compilers; they carry no component's headers, and that boundary is what keeps
# them shared.

# THE FOUR BUILDER IMAGES, INJECTED FROM os/build-env/images.env by
# os/build-env/from.sh, which os/podman/build.sh calls. Bare tags like
#
#     ARG BUILDER_IMAGE=debian:trixie-slim
#     ARG GO_IMAGE=golang:1.25-trixie
#     ARG RUST_IMAGE=rust:1.90-trixie
#
# -- three tags upstream repoints on its own schedule, so "which compiler built
# the engine on this device" was answerable only from a build log, and only if
# somebody kept one.
#
# NO DEFAULTS, DELIBERATELY, and this is the one place in this file that differs
# from ELF_ARCH's reasoning below. ELF_ARCH is defaulted so that a bare
# `docker buildx build` on this Dockerfile still checks SOMETHING; a default
# here would do the opposite, because the thing it would default to is exactly
# the unpinned float this milestone removes. Without a value docker refuses with
# "base name (${MOS_BUILD_BASE}) should not be blank" before any stage runs,
# which is a loud failure; with a default it would build green against an image
# nobody chose. Build this through `make podman`.
#
# THE TOOLCHAIN IS THE BUILDER IMAGES', NOT AN UPSTREAM LANGUAGE IMAGE'S:
# mos-build-go is Go 1.26.7 and mos-build-rust is Rust 1.98.0, both pinned by
# sha256 in os/build-env/images.env. os/podman/README.md records what was
# checked under them beyond "it built".
ARG MOS_BUILD_BASE
ARG MOS_BUILD_C
ARG MOS_BUILD_GO
ARG MOS_BUILD_RUST

# ---------------------------------------------------------------------------
# Sources: fetched once, hashed, shared by every builder below
# ---------------------------------------------------------------------------
# NO apt-get HERE ANY MORE. This stage needs git and a CA bundle, and those
# are two of the five packages mos-build-base exists to carry and ASSERTS from
# inside itself (os/build-env/base/Dockerfile). Re-installing them would make
# the assertion decorative: the floor would be a thing the base promises and
# nothing spends, and the first slimmed base would be found by a failed clone
# in a component build instead of by the image that claims the floor.
FROM --platform=$BUILDPLATFORM ${MOS_BUILD_BASE} AS src
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
# PENDING PRINTS THE HASH IT COMPUTED AND FAILS. There is deliberately no
# environment variable that softens it into a warning. A strictness knob is
# only meaningful if something sets it, and a build that WARNS while
# os/podman/versions.env says it FAILS teaches a reader to stop believing the
# documentation.
#
# What it costs is real and small: a bump is two runs instead of one. What it
# buys is that `git log` can never contain a commit whose engine came from an
# unhashed tag.
RUN --mount=type=cache,target=/root/.cache/git \
    set -eu; . /versions.env; \
    fetch() { \
        name="$1"; url="$2"; tag="$3"; want="$4"; \
        git clone --quiet --depth 1 --branch "${tag}" \
            --recurse-submodules --shallow-submodules "${url}" "/src/${name}"; \
        got="$(git -C "/src/${name}" archive --format=tar "${tag}" | sha256sum | cut -d' ' -f1)"; \
        if [ "${want}" = "PENDING" ]; then \
            echo "HASH ${name} ${tag} ${got}"; \
            echo "error: ${name} is pinned to ${tag} with no hash. Record the hash above against ${name} in os/podman/versions.env and run again; until then this build would compile whatever the tag points at today, which is a different fact from the source this tree agreed to ship" >&2; exit 1; \
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
FROM ${MOS_BUILD_C} AS c-build
# THE LANGUAGE TOOLCHAIN CAME WITH THE IMAGE; THE COMPONENTS' HEADERS DID NOT,
# and the split is the whole reason mos-build-c is a shared image and this apt
# list still exists. build-essential, make, cmake, pkgconf, autoconf, automake,
# libtool, python3, ccache and file are facts about compiling C, so they are in
# mos-build-c, which asserts their versions from inside itself. The six -dev
# packages below are facts about crun, conmon and catatonit -- three programs --
# and hoisting them into the shared image would put them in the cache key of
# every OTHER component that stands on it. os/podman/Dockerfile measured that
# arithmetic in the note further up: one dependency list for five compilers
# turned a one-package edit into ~42 minutes of recompilation.
#
# Grouped by what needs each package. A missing build tool reports as a missing
# command a hundred lines into a compile, which is how an earlier revision of
# this file spent an iteration on an absent autoconf.
RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-c,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-c,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
        libseccomp-dev libcap-dev \
        libjson-c-dev libyajl-dev \
        libglib2.0-dev \
        libsystemd-dev
# CCACHE_DIR AND THE /usr/lib/ccache PATH ENTRY ARE SET BY mos-build-c, not
# here, and the mounts below are what make them worth setting: ccache in front
# of the real compilers gives the C components the compiled-object cache the Go
# stage has had since it was written (/root/.cache/go-build and /go/pkg/mod).
# Without it any change upstream of this stage paid a full crun recompile --
# ~10 minutes under emulation -- to rebuild bytes identical to the previous
# run's. A cache DIRECTORY is not a cache; the consumer's mount is.
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
# os/rootfs/scripts/podman-assert.sh already asserts libsystemd.so.0 is in the image
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
# mos-build-rust, which is Rust 1.98.0 from the tarball images.env pins by
# sha256. netavark and aardvark-dns compile and their test suites are not what
# this stage runs,
# so "it built" is the whole claim -- os/podman/README.md records what was
# checked beyond that.
#
# protobuf-compiler and pkgconf stay HERE: netavark's build script runs protoc
# for its plugin API, which is a fact about netavark. ca-certificates is gone
# from this list because mos-build-base carries it and asserts it.
FROM ${MOS_BUILD_RUST} AS rust-build
RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-rust,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-rust,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
        protobuf-compiler pkgconf
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
# mos-build-go, which is Go 1.26.7 from the tarball images.env pins by
# sha256.
#
# build-essential IS STILL INSTALLED HERE, and that is not an oversight:
# mos-build-go deliberately carries no C compiler. podman needs one because
# CGO_ENABLED is mandatory for it (the note at the top of this file quotes
# podman's own Makefile), but a cgo consumer needs its own -dev list anyway --
# the four below -- so putting gcc in the shared Go image would give every
# pure-Go consumer a C toolchain in its cache key and still not spare this
# stage its apt line. git, ca-certificates and binutils are gone from this list:
# mos-build-base carries all three and asserts them.
FROM ${MOS_BUILD_GO} AS go-build
RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-go,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-go,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
        build-essential pkgconf \
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
#   seccomp                    KEPT. On a root-mode engine the
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
# Debian passes the right PREFIX in its packaging, which is why an
# apt-installed engine does not have this problem. Building ourselves means
# owning the flag.
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
# mos-build-base again, and this stage is the reason its floor names `file` and
# `binutils` rather than leaving them to whoever needs them: every assertion
# below is `file -b` reading an ELF header and `objdump -p` reading a NEEDED
# list. No apt-get, for the reason the src stage gives.
FROM ${MOS_BUILD_BASE} AS verify
# The architecture this build is FOR, so the assertion below cannot pass by
# naming the one it was first written against. Defaulted rather than required
# so a bare `docker buildx build` on this Dockerfile still checks something --
# unlike the four image arguments at the top, whose default would be the
# unpinned base this milestone exists to remove.
ARG ELF_ARCH=aarch64
COPY --from=c-build /out/ /out/
COPY --from=rust-build /out/ /out/
COPY --from=go-build /out/ /out/
# NEEDED.txt is EMITTED here, not checked here. Whether each soname resolves is
# a question about the image these binaries are going into, and it is asked in
# os/rootfs/scripts/podman-assert.sh with `ldd` against the assembled root -- the loader's
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
