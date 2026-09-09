# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# mos-build-rust-check -- mos-build-rust plus the four tools the Rust gate runs
# and the bus daemon its tests refuse to skip without.
#
#   make build-env     -> localhost/mos-build-rust-check:<arch>
#   make os-rust-gate  -> runs the gate inside it
#
# DERIVED, and that is the whole design. mos-build-rust is the FROM of every
# Rust deb producer and of pkgs/mosd/hack/build-target.sh, so anything installed
# there is paid for on every build -- which is the case its own header makes for
# the components it declines: "each is tens of megabytes in an image every build
# pulls". Nothing pulls THIS image except the gate, so those megabytes cost one
# run of one target and that argument does not transfer. The compiler image
# stays lean; the gate gets a home.
#
# A home is the point. The gate used to run in mos-build-rust with the host
# directory /srv/mos-rust-tools bind-mounted at /tools, and clippy, rustfmt,
# nextest and cargo-deny all came from there. No Makefile target named that
# directory and no script referenced it; it was emptied on 2026-08-29 and
# NOTHING FAILED. CI kept running both check.sh scripts on a rustup toolchain
# of its own (.github/workflows/check.yml), so what disappeared was not the
# check -- it was the ability to run it HERE, on the tree in front of you,
# before pushing it. A bind mount can be emptied out from under a build. An
# image cannot.

# clippy and rustfmt cost NO NEW PIN, and a reader should not go looking for
# one. They ship inside the same rust-${RUST_VERSION}-${triple}.tar.xz that
# mos-build-rust already installs rustc, cargo and std from, whose bytes
# RUST_SHA256_<arch> already names: this image re-fetches that one recorded
# tarball -- through the same download cache, so on a host that has built
# mos-build-rust there is not even a second download -- and asks install.sh for
# two more component names. Upstream does publish clippy and rustfmt as separate
# per-component tarballs; taking those would be four more hashes to bump in
# lockstep with RUST_VERSION, and a pin that must be bumped in lockstep with
# another is one that eventually is not.
#
# cargo-nextest and cargo-deny are the opposite case and are pinned in full.
# Neither is in any Rust tarball, each is a separate upstream with its own
# release cadence, and each therefore carries a URL and a sha256 per
# architecture in build-env/images.env, fetched and verified here exactly the
# way the toolchain is. That is what pkgs/mosd/hack/check.sh's last two lines
# cost, and they are worth it: `cargo deny check licenses bans advisories` is
# the only thing in this tree that checks the licence inventory and the advisory
# database that a shipped release's SBOM asserts.
ARG MOS_BASE_IMAGE

FROM ${MOS_BASE_IMAGE} AS fetch

# Filtered to this image's RUST_ and RUSTCHECK_ keys -- see build-env/images.env
# on the prefix convention. Both prefixes, because this image consumes both: the
# toolchain tarball it takes two components out of is named by the RUST_ keys
# that mos-build-rust is built from, and a second copy of that URL and hash here
# would be a thing that can disagree with the image this one is FROM.
COPY images.lock /etc/mos-build/images.env

RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-mos-build-rust-check-fetch,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-mos-build-rust-check-fetch,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends curl

# The pins, enforced. Same shape and same bump flow as build-env/rust/Dockerfile:
# set a hash to PENDING, run `make build-env`, this stage prints the sha256 it
# computed and fails, paste it in. Three verified fetches rather than that
# file's two, and the first of the three is literally the same bytes.
#
# The download cache is id=mos-fetch-rust, SHARED with mos-build-rust's fetch
# stage on purpose: it is keyed by the tarball's own file name, every use is
# re-hashed against the recorded pin before anything is unpacked, and a second
# cache would mean downloading the same 200 MB twice on one host. `sharing=locked`
# is what makes that safe while both images build.
ARG TARGETARCH
RUN --mount=type=cache,target=/var/cache/mos-fetch,id=mos-fetch-rust,sharing=locked \
    set -eu; \
    . /etc/mos-build/images.env; \
    fetch_verified() { \
        _key="$1"; _url="$2"; _want="$3"; \
        [ -n "${_url}" ] || { echo "mos-build-rust-check: error: build-env/images.env defines no URL for ${_key}, so there is no pinned tarball to install" >&2; return 1; }; \
        [ -n "${_want}" ] || { echo "mos-build-rust-check: error: build-env/images.env defines no ${_key}, so ${_url} would be installed unverified" >&2; return 1; }; \
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
            echo "mos-build-rust-check: error: ${_key} is PENDING. Record" >&2; \
            echo "mos-build-rust-check:   ${_key}=${_got}" >&2; \
            echo "mos-build-rust-check: in build-env/images.env -- that is the sha256 of ${_url} as fetched just now -- and run again" >&2; \
            return 1; \
        fi; \
        [ "${_got}" = "${_want}" ] || { \
            echo "mos-build-rust-check: error: ${_url} hashes to ${_got}, but build-env/images.env records ${_key}=${_want}. Either the pin is wrong or the bytes are not the ones this tree agreed to check with; do not paste the new hash over the old one without knowing which" >&2; \
            return 1; \
        }; \
        echo "ok ${_key} ${_got}"; \
        FETCHED="${_tb}"; \
    }; \
    uarch="$(echo "${TARGETARCH:?TARGETARCH is unset; buildkit always sets it, so this image is being built by something that is not buildx}" | tr '[:lower:]' '[:upper:]')"; \
    case "${uarch}" in \
    AMD64 | ARM64) ;; \
    *) echo "mos-build-rust-check: error: ${TARGETARCH} is not an architecture build-env/images.env pins these tools for" >&2; exit 1 ;; \
    esac; \
    eval "triple=\${RUST_TRIPLE_${uarch}-}"; \
    [ -n "${triple}" ] || { echo "mos-build-rust-check: error: build-env/images.env is missing RUST_TRIPLE_${uarch}" >&2; exit 1; }; \
    mkdir -p /tmp/unpack /stage/rust /stage/tools/bin; \
    \
    eval "url=\${RUST_URL_${uarch}-}"; eval "want=\${RUST_SHA256_${uarch}-}"; \
    fetch_verified "RUST_SHA256_${uarch}" "${url}" "${want}"; \
    tar -C /tmp/unpack -xJf "${FETCHED}"; \
    dir="/tmp/unpack/$(basename "${url}" .tar.xz)"; \
    [ -x "${dir}/install.sh" ] || { echo "mos-build-rust-check: error: ${url} unpacked without an executable ${dir}/install.sh; the tarball layout is not what this file expects" >&2; exit 1; }; \
    [ -f "${dir}/components" ] || { echo "mos-build-rust-check: error: ${url} unpacked without a components file, so the two component names below cannot be checked before install.sh is asked for them" >&2; exit 1; }; \
    for c in clippy-preview rustfmt-preview; do \
        grep -qx "${c}" "${dir}/components" || { echo "mos-build-rust-check: error: ${url} carries no component named '${c}'. It carries: $(tr '\n' ' ' <"${dir}/components")-- upstream renamed one, and install.sh would have installed nothing under that name without saying so" >&2; exit 1; }; \
    done; \
    "${dir}/install.sh" --prefix=/stage/rust --disable-ldconfig \
        --components="clippy-preview,rustfmt-preview"; \
    for b in cargo-clippy clippy-driver cargo-fmt rustfmt; do \
        [ -x "/stage/rust/bin/${b}" ] || { echo "mos-build-rust-check: error: install.sh reported success but /stage/rust/bin/${b} is not there" >&2; exit 1; }; \
    done; \
    rm -rf /tmp/unpack; \
    \
    eval "nurl=\${RUSTCHECK_NEXTEST_URL_${uarch}-}"; eval "nwant=\${RUSTCHECK_NEXTEST_SHA256_${uarch}-}"; \
    fetch_verified "RUSTCHECK_NEXTEST_SHA256_${uarch}" "${nurl}" "${nwant}"; \
    tar -C /stage/tools/bin -xzf "${FETCHED}" cargo-nextest; \
    [ -x /stage/tools/bin/cargo-nextest ] || { echo "mos-build-rust-check: error: ${nurl} does not carry cargo-nextest at the root of the archive" >&2; exit 1; }; \
    \
    eval "durl=\${RUSTCHECK_DENY_URL_${uarch}-}"; eval "dwant=\${RUSTCHECK_DENY_SHA256_${uarch}-}"; \
    fetch_verified "RUSTCHECK_DENY_SHA256_${uarch}" "${durl}" "${dwant}"; \
    ddir="$(basename "${durl}" .tar.gz)"; \
    tar -C /stage/tools/bin --strip-components=1 -xzf "${FETCHED}" "${ddir}/cargo-deny"; \
    [ -x /stage/tools/bin/cargo-deny ] || { echo "mos-build-rust-check: error: ${durl} does not carry ${ddir}/cargo-deny" >&2; exit 1; }

FROM ${MOS_BASE_IMAGE} AS final

COPY images.lock /etc/mos-build/images.env

# Merged into the toolchain's own prefix rather than kept beside it, because
# clippy-driver and rustfmt find their libraries through an RPATH of
# $ORIGIN/../lib: installed anywhere but next to rustc they load nothing and
# fail with a missing librustc_driver. The files that collide are install.sh's
# own bookkeeping -- lib/rustlib/components, the per-component manifests and
# uninstall.sh -- which nothing in this image reads; rustc and cargo resolve
# their sysroot by path, and the assertions below run both after the copy.
COPY --from=fetch /stage/rust/ /opt/rust/

# /usr/local/cargo/bin is CARGO_HOME/bin and is empty in mos-build-rust, which
# is where a cargo subcommand belongs: `cargo nextest` and `cargo deny` are
# found by cargo on PATH, and the base already puts this directory on it.
COPY --from=fetch /stage/tools/bin/ /usr/local/cargo/bin/

# dbus-daemon, and it is not a convenience. Several of mosd's and apid's tests
# assert real behaviour over a private session bus and are written to FAIL
# rather than skip when there is no daemon -- "dbus-daemon was not found at
# /usr/bin/dbus-daemon or on PATH. This test asserts" (pkgs/mosd/mosd/tests/scan.rs),
# and apid/tests/e2e.rs repeats it. Without this package the gate's nextest line
# does not report a missing dependency; it reports 1 failed out of 705 with 648
# cancelled, which reads as a broken workspace. It was installed by hand in the
# container on every run of this gate that has ever happened; here it is part of
# the image, so it cannot be forgotten on the run that matters.
RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-mos-build-rust-check,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-mos-build-rust-check,sharing=locked \
    set -eu; \
    rm -f /etc/apt/apt.conf.d/docker-clean; \
    apt-get update; \
    apt-get install -y --no-install-recommends dbus curl

# The tools, asserted from inside the image that promises them.
#
# nextest and deny are asserted EXACTLY, for build-env/rust/Dockerfile's reason
# about rustc: they arrive as tarballs whose bytes images.env names by sha256,
# so the version is a fact this tree owns and a mismatch means the recorded hash
# and the installed binary have come apart.
#
# clippy is asserted against RUSTC's OWN release, not against a number in
# images.env, and that is the assertion that matters here: clippy-driver links
# the compiler it was built with, so a clippy from any tarball other than the
# one mos-build-rust installed rustc from would be a second toolchain in one
# image -- exactly the failure /srv/mos-rust-tools produced, where a 1.96
# rustc ahead of a 1.98 one on PATH reported `can't find crate for std` and read
# as a broken workspace. Comparing the two release strings catches it here
# instead of in somebody's clippy output.
#
# rustfmt is asserted by running, not by number: its version line carries its
# own sequence (`rustfmt 1.9.0-stable`), which is not a value images.env
# records, and a second number kept in step by hand disagrees eventually.
ARG MOS_BASE_IMAGE
ARG TARGETARCH
RUN set -eu; \
    . /etc/mos-build/images.env; \
    fail=0; \
    say() { echo "mos-build-rust-check: $*" >&2; fail=1; }; \
    arch="$(dpkg --print-architecture)"; \
    if [ -n "${TARGETARCH:-}" ] && [ "${arch}" != "${TARGETARCH}" ]; then \
        say "error: this image reports dpkg architecture ${arch} but was built for TARGETARCH=${TARGETARCH}"; \
    fi; \
    for t in rustc cargo cargo-clippy clippy-driver rustfmt cargo-nextest cargo-deny dbus-daemon curl; do \
        command -v "${t}" >/dev/null 2>&1 || say "error: ${t} is not on PATH, but this image promises it"; \
    done; \
    rustc_rel="$(rustc -vV 2>/dev/null | sed -n 's/^release: //p')"; \
    clippy_rel="$(clippy-driver -vV 2>/dev/null | sed -n 's/^release: //p')"; \
    if [ -z "${rustc_rel}" ] || [ -z "${clippy_rel}" ]; then \
        say "error: could not read a release line out of 'rustc -vV' or 'clippy-driver -vV'"; \
    elif [ "${rustc_rel}" = "${clippy_rel}" ]; then \
        echo "ok clippy-driver ${clippy_rel} is the same release as rustc (one toolchain in this image, not two)"; \
    else \
        say "error: rustc is ${rustc_rel} and clippy-driver is ${clippy_rel}. They came from different tarballs, so this image holds two toolchains: clippy would report the workspace's dependencies as broken and be right about nothing"; \
    fi; \
    [ "${rustc_rel}" = "${RUST_VERSION}" ] || say "error: rustc is ${rustc_rel}, but build-env/images.env pins RUST_VERSION=${RUST_VERSION}; the base image and the components installed over it disagree"; \
    rustfmt_v="$(rustfmt --version 2>/dev/null || true)"; \
    case "${rustfmt_v}" in \
    rustfmt*) echo "ok ${rustfmt_v}" ;; \
    *) say "error: 'rustfmt --version' printed '${rustfmt_v}' rather than a version line" ;; \
    esac; \
    nextest_v="$(cargo nextest --version 2>/dev/null || true)"; \
    case "${nextest_v}" in \
    *"${RUSTCHECK_NEXTEST_VERSION}"*) echo "ok cargo nextest ${RUSTCHECK_NEXTEST_VERSION} (exactly RUSTCHECK_NEXTEST_VERSION, which the sha256 pin makes checkable exactly)" ;; \
    *) say "error: 'cargo nextest --version' printed '${nextest_v}', which does not carry the pinned RUSTCHECK_NEXTEST_VERSION=${RUSTCHECK_NEXTEST_VERSION}" ;; \
    esac; \
    deny_v="$(cargo deny --version 2>/dev/null || true)"; \
    case "${deny_v}" in \
    *"${RUSTCHECK_DENY_VERSION}"*) echo "ok cargo deny ${RUSTCHECK_DENY_VERSION} (exactly RUSTCHECK_DENY_VERSION)" ;; \
    *) say "error: 'cargo deny --version' printed '${deny_v}', which does not carry the pinned RUSTCHECK_DENY_VERSION=${RUSTCHECK_DENY_VERSION}" ;; \
    esac; \
    dbus_v="$(dbus-daemon --version 2>/dev/null | head -n1 || true)"; \
    [ -n "${dbus_v}" ] || say "error: dbus-daemon is installed but 'dbus-daemon --version' printed nothing"; \
    [ "${fail}" = 0 ] || { echo "mos-build-rust-check: the gate toolchain this image promises is not what it contains; see the errors above" >&2; exit 1; }; \
    mkdir -p /etc/mos-build; \
    uarch="$(echo "${arch}" | tr '[:lower:]' '[:upper:]')"; \
    eval "recorded_rust=\${RUST_SHA256_${uarch}-}"; \
    eval "recorded_nextest=\${RUSTCHECK_NEXTEST_SHA256_${uarch}-}"; \
    eval "recorded_deny=\${RUSTCHECK_DENY_SHA256_${uarch}-}"; \
    { \
        echo "MOS_BUILD_IMAGE=mos-build-rust-check"; \
        echo "MOS_BUILD_FROM=${MOS_BASE_IMAGE}"; \
        echo "MOS_BUILD_ARCH=${arch}"; \
        echo "MOS_BUILD_RUSTC=${rustc_rel}"; \
        echo "MOS_BUILD_CLIPPY=${clippy_rel}"; \
        echo "MOS_BUILD_RUSTFMT=$(rustfmt --version | awk '{print $2}')"; \
        echo "MOS_BUILD_NEXTEST=${RUSTCHECK_NEXTEST_VERSION}"; \
        echo "MOS_BUILD_DENY=${RUSTCHECK_DENY_VERSION}"; \
        echo "MOS_BUILD_DBUS=$(dbus-daemon --version | head -n1 | awk '{print $NF}')"; \
        echo "MOS_BUILD_RUST_SHA256=${recorded_rust}"; \
        echo "MOS_BUILD_NEXTEST_SHA256=${recorded_nextest}"; \
        echo "MOS_BUILD_DENY_SHA256=${recorded_deny}"; \
    } >/etc/mos-build/rust-check.env

# Its own file, named after this image and not the parent's rust.env, for the
# reason build-env/build.sh's read-back gives: an image that inherits its
# parent's record and writes none of its own is asserting nothing under its own
# name -- and here the parent's record is specifically the record of an image
# that cannot run this gate.
LABEL org.opencontainers.image.title="mos-build-rust-check" \
      org.opencontainers.image.description="mos Rust gate toolchain: clippy and rustfmt from the pinned Rust tarball, sha256-pinned cargo-nextest and cargo-deny, dbus-daemon" \
      org.opencontainers.image.base.name="${MOS_BASE_IMAGE}" \
      com.mos.build-env.source="build-env/rust-check/Dockerfile" \
      com.mos.build-env.pins="build-env/images.env"
