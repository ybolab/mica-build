# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# mos-build-go -- the Go toolchain, from a tarball pinned by sha256.
#
#   make build-env   -> localhost/mos-build-go
#
# PLAN-014 M2, decision 4: NOT `golang:1.25-trixie`. The official
# image is a moving floor nobody here chose -- it picks its own Debian release,
# its own CA bundle and its own git, and changes all three on its own schedule,
# so "what did this build run on" is answerable only as a date. This is
# mos-build-base, which is a pinned digest, plus one tarball whose bytes are
# named in os/build-env/images.env. What that costs is written in PLAN-014's
# risks: a Go security release now arrives by editing images.env.
#
# TWO STAGES, AND THE SPLIT IS NOT COSMETIC. `fetch` needs curl to get the
# tarball; the finished builder does not, and a network client in a build image
# is a tool nothing in it invokes. More usefully, the split separates "get
# exactly these bytes" from "assert what we got", so the sha256 refusal below
# happens in a stage whose only job is the bytes.
#
# WHAT MAKES THIS PIN REAL, AND THE ONE THING THAT WOULD UNDO IT. Since Go 1.21
# the go command reads the `go` line of a go.mod and, if it names a newer
# release, DOWNLOADS AND RUNS THAT TOOLCHAIN -- silently, mid-build, over the
# network. A sha256-pinned tarball plus the default GOTOOLCHAIN setting is
# therefore not a pinned Go at all: the first dependency with a forward `go`
# line replaces the compiler this file went to the trouble of pinning, and
# nothing in the build output says so. GOTOOLCHAIN=local is set below and
# asserted below that. It is the single most load-bearing line in this file.
ARG MOS_BASE_IMAGE

# ---------------------------------------------------------------------------
FROM ${MOS_BASE_IMAGE} AS fetch
# ---------------------------------------------------------------------------

# Filtered to this image's GO_ keys only, so a pin added for Rust or for M2c's
# ubuntu BSP does not invalidate this download. os/build-env/images.env carries
# the prefix convention that makes the filter possible, and
# os/podman/Dockerfile carries the 42-minute measurement that makes it worth
# having.
COPY images.lock /etc/mos-build/images.env

RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-mos-build-go-fetch,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-mos-build-go-fetch,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends curl

# THE PIN, ENFORCED. TARGETARCH selects which tarball, because they are
# different files with different hashes -- which is why images.env reserves
# GO_SHA256_<arch> per architecture rather than one key for "the" tarball.
#
# THE BUMP FLOW. Set GO_SHA256_<arch> to PENDING and run `make build-env`: this
# stage downloads the tarball, prints the sha256 it computed, and FAILS. Paste
# the value into images.env and run again. There is no environment variable that
# softens it -- images.env says why this file is stricter than
# os/podman/Dockerfile on that one point.
#
# THE DOWNLOAD IS CACHED AND THE VERIFICATION IS NOT. A cache mount is not part
# of the image layer, so a re-run after pasting the hash does not re-download
# 80 MB. It is safe precisely because the sha256 is checked on every run,
# cached or fresh: what the cache can hold is the pinned bytes or bytes that
# fail the check. A cached file that does not match is re-downloaded once
# rather than refused, so a truncated download self-heals instead of wedging
# the build until someone learns the word "buildx prune".
#
# curl gets --proto '=https' --tlsv1.2 and not just -fsSL: without them a
# redirect to plain http is followed silently, and a tarball fetched over http
# is a tarball an intermediary chose. The sha256 would catch that too, which is
# the point -- these are the layer that makes the sha256 the LAST line of
# defence rather than the only one.
ARG TARGETARCH
RUN --mount=type=cache,target=/var/cache/mos-fetch,id=mos-fetch-go,sharing=locked \
    set -eu; \
    . /etc/mos-build/images.env; \
    uarch="$(echo "${TARGETARCH:?TARGETARCH is unset; buildkit always sets it, so this image is being built by something that is not buildx}" | tr '[:lower:]' '[:upper:]')"; \
    eval "url=\${GO_URL_${uarch}-}"; \
    eval "want=\${GO_SHA256_${uarch}-}"; \
    [ -n "${url}" ] || { echo "mos-build-go: error: os/build-env/images.env defines no GO_URL_${uarch}, so there is no pinned Go tarball for ${TARGETARCH}. Add the URL and its GO_SHA256_${uarch} rather than letting this image resolve one" >&2; exit 1; }; \
    [ -n "${want}" ] || { echo "mos-build-go: error: os/build-env/images.env defines no GO_SHA256_${uarch}, so ${url} would be installed unverified" >&2; exit 1; }; \
    tb="/var/cache/mos-fetch/$(basename "${url}")"; \
    got=""; \
    [ -s "${tb}" ] && got="$(sha256sum "${tb}" | awk '{print $1}')" || true; \
    if [ "${got}" != "${want}" ]; then \
        echo "fetching ${url}"; \
        curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 -o "${tb}.part" "${url}"; \
        mv "${tb}.part" "${tb}"; \
        got="$(sha256sum "${tb}" | awk '{print $1}')"; \
    else \
        echo "using the cached ${tb}, which already matches the recorded hash"; \
    fi; \
    if [ "${want}" = PENDING ]; then \
        echo "SHA256 GO_SHA256_${uarch} ${got}"; \
        echo "mos-build-go: error: GO_SHA256_${uarch} is PENDING. Record" >&2; \
        echo "mos-build-go:   GO_SHA256_${uarch}=${got}" >&2; \
        echo "mos-build-go: in os/build-env/images.env -- that is the sha256 of ${url} as fetched just now -- and run again. Read it before pasting: this build verified nothing, it only measured" >&2; \
        exit 1; \
    fi; \
    [ "${got}" = "${want}" ] || { \
        echo "mos-build-go: error: ${url} hashes to ${got}, but os/build-env/images.env records GO_SHA256_${uarch}=${want}. Either the pin is wrong or the bytes are not the ones this tree agreed to compile with; do not paste the new hash over the old one without knowing which" >&2; \
        exit 1; \
    }; \
    echo "ok GO_SHA256_${uarch} ${got}"; \
    mkdir -p /opt; \
    tar -C /opt -xzf "${tb}"; \
    [ -x /opt/go/bin/go ] || { echo "mos-build-go: error: ${url} unpacked without an executable /opt/go/bin/go; the tarball layout is not what this file expects" >&2; exit 1; }

# ---------------------------------------------------------------------------
FROM ${MOS_BASE_IMAGE} AS final
# ---------------------------------------------------------------------------

COPY images.lock /etc/mos-build/images.env
COPY --from=fetch /opt/go /opt/go

# GOTOOLCHAIN=local is the pin. See the header: without it the go command
# replaces this tarball with one it downloads, the first time a go.mod asks for
# a newer release, and the build that produced a shipped binary is then not the
# build this file describes. The assert stage below refuses an image where it is
# not in effect, so deleting this line fails the build rather than the audit.
#
# GOFLAGS=-mod=readonly and not -mod=mod: a build that can rewrite the go.sum it
# is being checked against is a build that cannot be checked. It is the default
# in modern Go and is set anyway, because a default is a thing upstream can
# change and a pinned build environment is exactly where that must not happen
# quietly.
#
# GOPATH=/go matches what every consumer of the official image already assumes,
# so the cache mounts in os/podman/Dockerfile (/go/pkg/mod, /root/.cache/go-build)
# keep working across M2c's switchover without being re-derived.
ENV GOROOT=/opt/go \
    GOPATH=/go \
    GOTOOLCHAIN=local \
    GOFLAGS=-mod=readonly \
    PATH="/opt/go/bin:/go/bin:${PATH}"

# The toolchain, asserted from inside the image that promises it.
#
# EXACT, NOT A FLOOR, and the difference from mos-build-c is not a style
# choice. mos-build-c's gcc arrives from `apt-get install` against live
# deb.debian.org, which no digest in this repository pins, so only a floor can
# be maintained honestly there. This Go arrives as a tarball whose bytes are
# named by sha256 in os/build-env/images.env: the version is a fact the tree
# owns, and anything other than exactly GO_VERSION means the recorded hash and
# the installed compiler have come apart -- a tarball unpacked over an older
# one, a cached layer serving a pre-bump toolchain, an image someone edited by
# hand. A floor would pass every one of those.
#
# THE BUILD IS THE ASSERTION. `go version` answers on an image whose GOROOT is
# half-unpacked and whose linker cannot produce an executable. So this compiles
# and links a real program and reads the architecture back out of the ELF with
# `file`, one of the tools mos-build-base promises -- and then does it AGAIN for
# the other architecture, because cross-compilation is the whole reason this
# project has a build environment and Go is the one toolchain here that gets it
# for free. mos-build-rust needs a pinned std tarball and an apt cross linker
# for the same capability; asserting it here is what makes that asymmetry a
# measured fact rather than a claim in a comment.
#
# GOPROXY=off during the probe: the probe imports nothing outside the standard
# library, so any network access at all would mean the toolchain is resolving
# something this file did not ask for, and off turns that into an error instead
# of a delay.
ARG MOS_BASE_IMAGE
ARG TARGETARCH
RUN set -eu; \
    . /etc/mos-build/images.env; \
    fail=0; \
    say() { echo "mos-build-go: $*" >&2; fail=1; }; \
    arch="$(dpkg --print-architecture)"; \
    if [ -n "${TARGETARCH:-}" ] && [ "${arch}" != "${TARGETARCH}" ]; then \
        say "error: this image is ${arch} but the build asked for ${TARGETARCH}; the builder has no emulator for it and silently produced a host-architecture image"; \
    fi; \
    command -v go >/dev/null 2>&1 || say "error: go is not on PATH, but this image promises it"; \
    got="$(go version 2>/dev/null | awk '{print $3}' | sed 's/^go//')"; \
    if [ -z "${got}" ]; then say "error: could not read a version out of 'go version'"; \
    elif [ "${got}" = "${GO_VERSION}" ]; then echo "ok go ${got} (exactly GO_VERSION, which the sha256 pin makes checkable exactly)"; \
    else say "error: go is ${got}, but os/build-env/images.env pins GO_VERSION=${GO_VERSION} by sha256. This is not a floor: the recorded tarball hash and the installed compiler have come apart, and one of the two is lying about what this image builds with"; fi; \
    tc="$(go env GOTOOLCHAIN 2>/dev/null || true)"; \
    if [ "${tc}" != "local" ]; then \
        say "error: GOTOOLCHAIN is '${tc}' and not 'local'. Since Go 1.21 the go command downloads and runs whatever toolchain a go.mod's 'go' line names, so with anything but 'local' the sha256-pinned tarball in this image is a default that the first forward go.mod silently replaces -- over the network, mid-build, saying nothing"; \
    else echo "ok GOTOOLCHAIN=local (the go.mod toolchain-download path is closed)"; fi; \
    hostarch="$(go env GOARCH 2>/dev/null || true)"; \
    [ "${hostarch}" = "${arch}" ] || say "error: go reports GOARCH=${hostarch} on a ${arch} image; the tarball for the wrong architecture was unpacked"; \
    case "${arch}" in \
    amd64) other=arm64; otherelf=aarch64 ;; \
    arm64) other=amd64; otherelf=x86-64 ;; \
    *) other=""; otherelf="" ;; \
    esac; \
    d="$(mktemp -d)"; \
    printf 'package main\n\nimport (\n\t"fmt"\n\t"runtime"\n)\n\nfunc main() { fmt.Println(runtime.GOARCH) }\n' >"${d}/main.go"; \
    ( cd "${d}" && GOPROXY=off GOFLAGS=-mod=mod go mod init probe >/dev/null 2>&1 ) || say "error: 'go mod init' failed in an empty directory; the toolchain is present but not functional"; \
    if ( cd "${d}" && GOPROXY=off GOCACHE="${d}/cache" go build -o "${d}/probe" . 2>"${d}/native.err" ); then \
        got="$(file -b "${d}/probe")"; \
        case "${arch}:${got}" in \
        amd64:*x86-64*) echo "ok go builds an amd64 ELF" ;; \
        arm64:*aarch64*) echo "ok go builds an arm64 ELF" ;; \
        *) say "error: go on this ${arch} image produced '${got}', which is not a ${arch} ELF" ;; \
        esac; \
    else \
        say "error: go cannot build a standard-library-only program: $(head -n3 "${d}/native.err" | tr '\n' ' ')"; \
    fi; \
    if [ -n "${other}" ]; then \
        if ( cd "${d}" && GOPROXY=off GOCACHE="${d}/cache" CGO_ENABLED=0 GOARCH="${other}" go build -o "${d}/cross" . 2>"${d}/cross.err" ); then \
            got="$(file -b "${d}/cross")"; \
            case "${got}" in \
            *"${otherelf}"*) echo "ok go cross-builds a ${other} ELF with no extra pin (this is why images.env has no GO_STD_* block)" ;; \
            *) say "error: GOARCH=${other} produced '${got}', which is not a ${other} ELF; this image cannot cross-build for the architecture the other board ships" ;; \
            esac; \
        else \
            say "error: GOARCH=${other} go build failed, so this image cannot cross-build for the architecture the other board ships: $(head -n3 "${d}/cross.err" | tr '\n' ' ')"; \
        fi; \
    fi; \
    rm -rf "${d}"; \
    [ "${fail}" = 0 ] || { echo "mos-build-go: the toolchain this image promises is not what it contains; see the errors above" >&2; exit 1; }; \
    mkdir -p /etc/mos-build /go; \
    eval "recorded_sha=\${GO_SHA256_$(echo "${arch}" | tr '[:lower:]' '[:upper:]')}"; \
    { \
        echo "MOS_BUILD_IMAGE=mos-build-go"; \
        echo "MOS_BUILD_FROM=${MOS_BASE_IMAGE}"; \
        echo "MOS_BUILD_ARCH=${arch}"; \
        echo "MOS_BUILD_GO=$(go version | awk '{print $3}' | sed 's/^go//')"; \
        echo "MOS_BUILD_GO_SHA256=${recorded_sha}"; \
        echo "MOS_BUILD_GOROOT=$(go env GOROOT)"; \
        echo "MOS_BUILD_GOTOOLCHAIN=$(go env GOTOOLCHAIN)"; \
        echo "MOS_BUILD_GO_CROSS=${other:-none}"; \
    } >/etc/mos-build/go.env

# Its own file, named after this image and not the parent's base.env. See
# os/build-env/build.sh's read-back: an image that inherits its parent's record
# and writes none of its own is asserting nothing under its own name.
LABEL org.opencontainers.image.title="mos-build-go" \
      org.opencontainers.image.description="mos Go toolchain, sha256-pinned tarball (PLAN-014 M2, RFCT-108)" \
      org.opencontainers.image.base.name="${MOS_BASE_IMAGE}" \
      com.mos.build-env.source="os/build-env/go/Dockerfile" \
      com.mos.build-env.pins="os/build-env/images.env"
