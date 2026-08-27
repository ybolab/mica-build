# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# mos-build-rust -- the Rust toolchain, from tarballs pinned by sha256.
#
#   make build-env   -> localhost/mos-build-rust
#
# Not `rust:1.90-trixie`, for the reason mos-build-go's header gives: this is
# mos-build-base -- a pinned digest -- plus upstream's standalone installer,
# whose bytes are named in os/build-env/images.env.

# And not rustup either, which is the less obvious half of the same decision.
# rustup is a version resolver: it reads rust-toolchain.toml out of whatever
# source tree it is pointed at and installs what that file asks for, over the
# network, mid-build. In an image whose whole purpose is that the compiler is a
# value in images.env, a resolver is the mechanism that quietly overrides it --
# the same failure GOTOOLCHAIN=local closes on the Go side, arriving by a
# different route. The standalone installer has no such path: what is unpacked
# here is what runs, and a rust-toolchain.toml in a consumer's tree is inert.

# Two architectures of std, which Go does not need and Rust does. The
# standalone `rust-` tarball ships std for its own host triple only, so an
# image built from it alone can compile for exactly one target -- and the
# target this project actually ships to is the other one:
# mosd/hack/build-aarch64.sh cross-builds the device binaries, and
# mosd/.cargo/config.toml already names `aarch64-linux-gnu-gcc` as their
# linker. So this image also installs the cross std, pinned by its own sha256,
# and the matching Debian cross linker, and then proves the combination by
# linking a binary for the other architecture. mosd/hack/build-target.sh runs
# inside this image, and an image that could not cross-compile would be a
# handoff that cannot be taken.
ARG MOS_BASE_IMAGE

FROM ${MOS_BASE_IMAGE} AS fetch

# Filtered to this image's RUST_ keys only -- see os/build-env/images.env on the
# prefix convention and os/pkgs/podman/Dockerfile on what a shared cache key costs.
COPY images.lock /etc/mos-build/images.env

RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-mos-build-rust-fetch,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-mos-build-rust-fetch,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends curl

# The pins, enforced -- two of them, and the second is the cross std. The bump
# flow is mos-build-go's: set a hash to PENDING, run `make build-env`, this
# stage prints the sha256 it computed and fails, paste it in. No environment
# variable softens it; os/build-env/images.env says why this file is stricter
# than os/pkgs/podman/Dockerfile on that one point.

# xz and not gz: upstream publishes both and the .xz is roughly half the bytes.
# mos-build-base already promises xz-utils and asserts a floor on it, so this
# is spending a dependency that is paid for rather than adding one.

# install.sh is asked for exactly three components. The combined tarball also
# carries rust-docs, rust-analysis, clippy and rustfmt; none is needed to run
# `cargo build --release --locked`, which is the whole of what
# mosd/hack/build-target.sh does, and each is tens of megabytes in an image
# every build pulls. Naming the components explicitly rather than taking the
# default also means a component upstream renames fails here, by name, instead
# of silently not being installed.
ARG TARGETARCH
RUN --mount=type=cache,target=/var/cache/mos-fetch,id=mos-fetch-rust,sharing=locked \
    set -eu; \
    . /etc/mos-build/images.env; \
    fetch_verified() { \
        _key="$1"; _url="$2"; _want="$3"; \
        [ -n "${_url}" ] || { echo "mos-build-rust: error: os/build-env/images.env defines no URL for ${_key}, so there is no pinned tarball to install" >&2; return 1; }; \
        [ -n "${_want}" ] || { echo "mos-build-rust: error: os/build-env/images.env defines no ${_key}, so ${_url} would be installed unverified" >&2; return 1; }; \
        _tb="/var/cache/mos-fetch/$(basename "${_url}")"; \
        _got=""; \
        [ -s "${_tb}" ] && _got="$(sha256sum "${_tb}" | awk '{print $1}')" || true; \
        if [ "${_got}" != "${_want}" ]; then \
            echo "fetching ${_url}"; \
            curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 -o "${_tb}.part" "${_url}"; \
            mv "${_tb}.part" "${_tb}"; \
            _got="$(sha256sum "${_tb}" | awk '{print $1}')"; \
        else \
            echo "using the cached ${_tb}, which already matches the recorded hash"; \
        fi; \
        if [ "${_want}" = PENDING ]; then \
            echo "SHA256 ${_key} ${_got}"; \
            echo "mos-build-rust: error: ${_key} is PENDING. Record" >&2; \
            echo "mos-build-rust:   ${_key}=${_got}" >&2; \
            echo "mos-build-rust: in os/build-env/images.env -- that is the sha256 of ${_url} as fetched just now -- and run again. Read it before pasting: this build verified nothing, it only measured" >&2; \
            return 1; \
        fi; \
        [ "${_got}" = "${_want}" ] || { \
            echo "mos-build-rust: error: ${_url} hashes to ${_got}, but os/build-env/images.env records ${_key}=${_want}. Either the pin is wrong or the bytes are not the ones this tree agreed to compile with; do not paste the new hash over the old one without knowing which" >&2; \
            return 1; \
        }; \
        echo "ok ${_key} ${_got}"; \
        FETCHED="${_tb}"; \
    }; \
    uarch="$(echo "${TARGETARCH:?TARGETARCH is unset; buildkit always sets it, so this image is being built by something that is not buildx}" | tr '[:lower:]' '[:upper:]')"; \
    case "${uarch}" in \
    AMD64) uother=ARM64 ;; \
    ARM64) uother=AMD64 ;; \
    *) echo "mos-build-rust: error: ${TARGETARCH} is not an architecture os/build-env/images.env pins a Rust triple for" >&2; exit 1 ;; \
    esac; \
    eval "triple=\${RUST_TRIPLE_${uarch}-}"; \
    eval "otriple=\${RUST_TRIPLE_${uother}-}"; \
    [ -n "${triple}" ] && [ -n "${otriple}" ] || { echo "mos-build-rust: error: os/build-env/images.env is missing RUST_TRIPLE_${uarch} or RUST_TRIPLE_${uother}" >&2; exit 1; }; \
    mkdir -p /opt/rust /tmp/unpack; \
    eval "url=\${RUST_URL_${uarch}-}"; eval "want=\${RUST_SHA256_${uarch}-}"; \
    fetch_verified "RUST_SHA256_${uarch}" "${url}" "${want}"; \
    tar -C /tmp/unpack -xJf "${FETCHED}"; \
    dir="/tmp/unpack/$(basename "${url}" .tar.xz)"; \
    [ -x "${dir}/install.sh" ] || { echo "mos-build-rust: error: ${url} unpacked without an executable ${dir}/install.sh; the tarball layout is not what this file expects" >&2; exit 1; }; \
    "${dir}/install.sh" --prefix=/opt/rust --disable-ldconfig \
        --components="rustc,cargo,rust-std-${triple}"; \
    eval "ourl=\${RUST_STD_URL_${uother}-}"; eval "owant=\${RUST_STD_SHA256_${uother}-}"; \
    fetch_verified "RUST_STD_SHA256_${uother}" "${ourl}" "${owant}"; \
    tar -C /tmp/unpack -xJf "${FETCHED}"; \
    odir="/tmp/unpack/$(basename "${ourl}" .tar.xz)"; \
    [ -x "${odir}/install.sh" ] || { echo "mos-build-rust: error: ${ourl} unpacked without an executable ${odir}/install.sh" >&2; exit 1; }; \
    "${odir}/install.sh" --prefix=/opt/rust --disable-ldconfig \
        --components="rust-std-${otriple}"; \
    rm -rf /tmp/unpack; \
    [ -x /opt/rust/bin/rustc ] && [ -x /opt/rust/bin/cargo ] \
        || { echo "mos-build-rust: error: install.sh reported success but /opt/rust/bin does not hold both rustc and cargo" >&2; exit 1; }

FROM ${MOS_BASE_IMAGE} AS final

COPY images.lock /etc/mos-build/images.env
COPY --from=fetch /opt/rust /opt/rust

# The linker is not optional, and this is the one apt list in os/build-env/
# whose absence is not a missing convenience but a broken image. rustc does not
# link: it drives the system `cc`, so without gcc and libc6-dev every build in
# this image dies at the last step with "linker `cc` not found" -- a failure
# that says nothing about the image that caused it. gcc and libc6-dev are named
# separately because --no-install-recommends drops the libc6-dev that gcc
# merely recommends, which yields a compiler with no headers and no crt
# objects: the exact half-toolchain that passes `rustc --version`.

# The cross linker is selected by the architecture this image is being built
# for, because the interesting target is always the other one. Debian names the
# packages asymmetrically -- gcc-aarch64-linux-gnu with libc6-dev-arm64-cross,
# gcc-x86-64-linux-gnu with libc6-dev-amd64-cross, three different spellings of
# "arm64" between them -- so this is a case and not a computed string. A
# computed one would be a package name nobody can grep for.

# The cross libc is named for the same reason the native one is, and this was
# not theory: with only gcc-aarch64-linux-gnu installed, this image built,
# asserted rustc 1.98.0 exactly, found std for both triples, linked a native
# binary -- and then died on `cannot find crti.o` when it tried to link for
# aarch64. Every version check passed; what caught it was the cross build being
# an assertion rather than a claim.

# ${cross} is left unquoted on purpose -- it holds two package names and has to
# word-split. That is the one place in os/build-env/ where an unquoted expansion
# is correct, so it is said here rather than left for a reader to wonder about.
# build-essential is deliberately not used here, unlike mos-build-c: this image
# needs a linker driver and a libc, not make, g++, dpkg-dev and the rest. Cargo
# crates that need more (a C++ build script, pkg-config) add it in their own
# stage, which is the same split mos-build-c's header argues for.
RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-mos-build-rust,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-mos-build-rust,sharing=locked \
    set -eu; \
    case "$(dpkg --print-architecture)" in \
    amd64) cross="gcc-aarch64-linux-gnu libc6-dev-arm64-cross" ;; \
    arm64) cross="gcc-x86-64-linux-gnu libc6-dev-amd64-cross" ;; \
    *) echo "mos-build-rust: error: $(dpkg --print-architecture) has no cross linker package named in this file" >&2; exit 1 ;; \
    esac; \
    rm -f /etc/apt/apt.conf.d/docker-clean; \
    apt-get update; \
    apt-get install -y --no-install-recommends gcc libc6-dev ${cross}

# CARGO_HOME=/usr/local/cargo is not a preference: os/pkgs/podman/Dockerfile's rust
# stage already mounts /usr/local/cargo/registry and /usr/local/cargo/git as
# named caches, and it measured what losing them costs -- netavark 23m58s and
# aardvark-dns 8m05s of recompilation, "almost all of it the shared dependency
# tree, every time any stage above was invalidated". Keeping the path means
# M2c's switchover changes the image and not the cache mounts.
#
# CARGO_TARGET_<TRIPLE>_LINKER covers both directions. mosd/.cargo/config.toml
# names the aarch64 linker for builds run from that tree; this covers the
# amd64-from-arm64 direction that file does not, and covers any consumer built
# outside mosd/. Set as env rather than written into a config.toml so that a
# consumer's own .cargo/config.toml still wins -- an image should supply a
# default, not overrule the tree it is compiling.
ENV RUSTUP_HOME=/nonexistent \
    CARGO_HOME=/usr/local/cargo \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc \
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-gnu-gcc \
    PATH="/opt/rust/bin:/usr/local/cargo/bin:${PATH}"

# The toolchain, asserted from inside the image that promises it.

# Exact, not a floor, for rustc: it arrives as a tarball whose bytes are named
# by sha256 in os/build-env/images.env, so the version is a fact this tree owns
# and anything else means the recorded hash and the installed compiler have
# come apart. mos-build-c's gcc is the opposite case and gets a floor; the
# difference is whether the thing asserted is pinned or merely requested.

# cargo is asserted by presence and by use, not by number, and that is
# deliberate. cargo ships in the same pinned tarball, so it is pinned; but its
# version string is upstream's own sequence and is not a value images.env
# records, and a second number kept in step with RUST_VERSION by hand would
# disagree with itself on some future release and be "fixed" by widening. What
# cargo is actually required to do is build, and that is what is checked.

# Both builds are real cargo builds. `rustc --version` answers on an image with
# no linker, with no std for the target, and with the cross linker missing --
# three separate ways for this image to be useless that a version check cannot
# see. --offline because the probes depend on nothing: any network access would
# mean the toolchain is resolving something this file did not ask for.
ARG MOS_BASE_IMAGE
ARG TARGETARCH
RUN set -eu; \
    . /etc/mos-build/images.env; \
    fail=0; \
    say() { echo "mos-build-rust: $*" >&2; fail=1; }; \
    arch="$(dpkg --print-architecture)"; \
    if [ -n "${TARGETARCH:-}" ] && [ "${arch}" != "${TARGETARCH}" ]; then \
        say "error: this image is ${arch} but the build asked for ${TARGETARCH}; the builder has no emulator for it and silently produced a host-architecture image"; \
    fi; \
    uarch="$(echo "${arch}" | tr '[:lower:]' '[:upper:]')"; \
    case "${uarch}" in \
    AMD64) uother=ARM64; otherelf=aarch64; crosscc=aarch64-linux-gnu-gcc ;; \
    ARM64) uother=AMD64; otherelf=x86-64; crosscc=x86_64-linux-gnu-gcc ;; \
    *) echo "mos-build-rust: error: ${arch} is not an architecture images.env pins a Rust triple for" >&2; exit 1 ;; \
    esac; \
    eval "triple=\${RUST_TRIPLE_${uarch}}"; \
    eval "otriple=\${RUST_TRIPLE_${uother}}"; \
    for t in rustc cargo cc "${crosscc}"; do \
        command -v "${t}" >/dev/null 2>&1 || say "error: ${t} is not on PATH, but this image promises it"; \
    done; \
    got="$(rustc --version 2>/dev/null | awk '{print $2}')"; \
    if [ -z "${got}" ]; then say "error: could not read a version out of 'rustc --version'"; \
    elif [ "${got}" = "${RUST_VERSION}" ]; then echo "ok rustc ${got} (exactly RUST_VERSION, which the sha256 pin makes checkable exactly)"; \
    else say "error: rustc is ${got}, but os/build-env/images.env pins RUST_VERSION=${RUST_VERSION} by sha256. This is not a floor: the recorded tarball hash and the installed compiler have come apart, and one of the two is lying about what this image builds with"; fi; \
    echo "ok cargo $(cargo --version 2>/dev/null | awk '{print $2}') (present; its number is upstream's sequence and not a value images.env pins -- what it must do is build, which is checked below)"; \
    sysroot="$(rustc --print sysroot 2>/dev/null || true)"; \
    for tr in "${triple}" "${otriple}"; do \
        if [ -d "${sysroot}/lib/rustlib/${tr}/lib" ]; then echo "ok std for ${tr}"; \
        else say "error: no std for ${tr} under ${sysroot}/lib/rustlib. A cargo build --target ${tr} fails with 'can't find crate for std', which reads as a broken source tree and is a broken image"; fi; \
    done; \
    export CARGO_HOME=/usr/local/cargo; \
    mkdir -p "${CARGO_HOME}"; \
    d="$(mktemp -d)"; \
    mkdir -p "${d}/probe/src"; \
    printf '[package]\nname = "probe"\nversion = "0.0.0"\nedition = "2021"\n\n[[bin]]\nname = "probe"\npath = "src/main.rs"\n' >"${d}/probe/Cargo.toml"; \
    printf 'fn main() { println!("{}", std::env::consts::ARCH); }\n' >"${d}/probe/src/main.rs"; \
    if ( cd "${d}/probe" && cargo build --offline --release --target "${triple}" >"${d}/native.log" 2>&1 ); then \
        gotelf="$(file -b "${d}/probe/target/${triple}/release/probe")"; \
        case "${arch}:${gotelf}" in \
        amd64:*x86-64*) echo "ok cargo links an amd64 ELF for ${triple}" ;; \
        arm64:*aarch64*) echo "ok cargo links an arm64 ELF for ${triple}" ;; \
        *) say "error: cargo on this ${arch} image produced '${gotelf}', which is not a ${arch} ELF" ;; \
        esac; \
    else \
        say "error: cargo cannot build and link a std-only binary for its own target ${triple}: $(tail -n5 "${d}/native.log" | tr '\n' ' ')"; \
    fi; \
    if ( cd "${d}/probe" && cargo build --offline --release --target "${otriple}" >"${d}/cross.log" 2>&1 ); then \
        gotelf="$(file -b "${d}/probe/target/${otriple}/release/probe")"; \
        case "${gotelf}" in \
        *"${otherelf}"*) echo "ok cargo cross-links a ${otriple} ELF through ${crosscc} (this is what RUST_STD_SHA256_${uother} and the cross linker package buy)" ;; \
        *) say "error: cargo --target ${otriple} produced '${gotelf}', which is not a ${otherelf} ELF; this image cannot cross-build for the architecture the other board ships" ;; \
        esac; \
    else \
        say "error: cargo --target ${otriple} failed, so mosd/hack/build-target.sh could not run in this image -- which is the one job RFCT-108 M2c gives it: $(tail -n5 "${d}/cross.log" | tr '\n' ' ')"; \
    fi; \
    rm -rf "${d}"; \
    [ "${fail}" = 0 ] || { echo "mos-build-rust: the toolchain this image promises is not what it contains; see the errors above" >&2; exit 1; }; \
    mkdir -p /etc/mos-build; \
    eval "recorded_sha=\${RUST_SHA256_${uarch}}"; \
    eval "recorded_std=\${RUST_STD_SHA256_${uother}}"; \
    { \
        echo "MOS_BUILD_IMAGE=mos-build-rust"; \
        echo "MOS_BUILD_FROM=${MOS_BASE_IMAGE}"; \
        echo "MOS_BUILD_ARCH=${arch}"; \
        echo "MOS_BUILD_RUSTC=$(rustc --version | awk '{print $2}')"; \
        echo "MOS_BUILD_CARGO=$(cargo --version | awk '{print $2}')"; \
        echo "MOS_BUILD_RUST_SHA256=${recorded_sha}"; \
        echo "MOS_BUILD_RUST_HOST_TRIPLE=${triple}"; \
        echo "MOS_BUILD_RUST_CROSS_TRIPLE=${otriple}"; \
        echo "MOS_BUILD_RUST_CROSS_STD_SHA256=${recorded_std}"; \
        echo "MOS_BUILD_RUST_CROSS_LINKER=${crosscc}"; \
    } >/etc/mos-build/rust.env

# Its own file, named after this image and not the parent's base.env. See
# os/build-env/build.sh's read-back: an image that inherits its parent's record
# and writes none of its own is asserting nothing under its own name.
LABEL org.opencontainers.image.title="mos-build-rust" \
      org.opencontainers.image.description="mos Rust toolchain, sha256-pinned tarballs, cross-capable" \
      org.opencontainers.image.base.name="${MOS_BASE_IMAGE}" \
      com.mos.build-env.source="os/build-env/rust/Dockerfile" \
      com.mos.build-env.pins="os/build-env/images.env"
