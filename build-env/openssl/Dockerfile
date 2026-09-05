# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# mos-build-openssl -- the crypto tooling that mints this tree's trust material.
#
#   make build-env   -> localhost/mos-build-openssl:<arch>
#
# WHAT RUNS IN IT. pkgs/rauc/gen-dev-keys.sh, which writes the RAUC CA, the
# bundle signer certificate and the ed25519 package root key into meta/, and
# edits meta/updates/manifest.json with jq. Every one of those bytes is baked
# into every image the tree builds, which makes both tools PRODUCERS by
# docs/design/build.md section 0 -- "what openssl writes into a certificate is
# openssl's decision" -- so neither may come off the host. rootfs/build.sh's
# alg_of_material() also reads this image's openssl: it is a judge rather than a
# producer, and it is here because what it parses is openssl's own TEXT
# rendering of a key, which is a version-sensitive thing to depend on.
#
# WHY IT IS ITS OWN IMAGE and not two more packages in mos-build-base. The base
# is the FROM of every builder in the tree, so anything installed there is paid
# for by every component build; openssl and jq are wanted by one generator and
# one read-back. mos-build-rust-check made the same call for the same reason and
# its header is the longer version of this paragraph.
#
# jq IS DELIBERATELY HERE, although the host-toolchain check's table does not
# carry a jq row. That table cannot tell the one producing use of jq in this
# tree -- rewriting trust.signingKeys in a file that reaches the image -- from
# the fixture edits elsewhere that are verdicts, so it lists neither and the
# producing one travels with the openssl it sits beside. The generator gets both
# out of this image and reaches for neither on the host.
#
# No default for the base, for the reason build-env/base/Dockerfile gives:
# a driver that failed to pass the argument would otherwise build from a
# floating tag.
ARG MOS_BASE_IMAGE

FROM ${MOS_BASE_IMAGE} AS final

# Filtered to this image's OPENSSL_ keys only -- see build-env/images.env on the
# prefix convention.
COPY images.lock /etc/mos-build/images.env

# The whole list, and `openssl` is on it although the parent already HAS one.
# Measured 2026-09-05 while building this image: mos-build-base carries
# `OpenSSL 3.5.6` because ca-certificates depends on the openssl package, and
# the apt run below reported `Unpacking openssl (3.5.7-1~deb13u2) over
# (3.5.6-1~deb13u2)`. Naming it here is the difference between an openssl that
# is present as a side effect of an unrelated dependency -- unfloored,
# unrecorded, free to move whenever ca-certificates' chain does -- and one this
# file declares, floors and writes down. `jq` is not in the parent at all.
RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-mos-build-openssl,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-mos-build-openssl,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
        openssl jq

# The floor, asserted from inside the image that promises it.
#
# Floors and not exact versions, for the reason mos-build-base's block gives:
# the digest pins the base filesystem and not the apt archive these come from.
#
# THE OPENSSL FLOOR IS THE ONE THAT DECIDES BYTES. A certificate's default
# encoding, its extension ordering and its serial are the minting openssl's
# choices, and the material this image writes is trusted by every device the
# tree flashes. A floor that went backwards silently is a trust root minted by
# something nobody chose; that is what this stops, and it is why the version is
# also RECORDED below rather than only compared.
ARG MOS_BASE_IMAGE
ARG TARGETARCH
RUN set -eu; \
    . /etc/mos-build/images.env; \
    fail=0; \
    say() { echo "mos-build-openssl: $*" >&2; fail=1; }; \
    ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }; \
    check() { \
        name="$1"; want="$2"; got="$3"; \
        if [ -z "${got}" ]; then say "error: could not read a version out of ${name}"; \
        elif ge "${got}" "${want}"; then echo "ok ${name} ${got} (floor ${want})"; \
        else say "error: ${name} is ${got}, below the floor ${want} that build-env/images.env declares. Either the base moved backwards or the floor was raised without measuring; do not lower the floor to make this pass"; fi; \
    }; \
    arch="$(dpkg --print-architecture)"; \
    if [ -n "${TARGETARCH:-}" ] && [ "${arch}" != "${TARGETARCH}" ]; then \
        say "error: this image is ${arch} but the build asked for ${TARGETARCH}; the builder has no emulator for it and silently produced a host-architecture image, so the tag would name an architecture the image is not"; \
    fi; \
    check openssl "${OPENSSL_FLOOR_OPENSSL_MIN}" "$(openssl version 2>/dev/null | sed -n 's/^OpenSSL \([0-9][0-9.]*\).*/\1/p')"; \
    check jq      "${OPENSSL_FLOOR_JQ_MIN}"      "$(jq --version 2>/dev/null | sed -n 's/^jq-\([0-9][0-9.]*\).*/\1/p')"; \
    printf 'x' | openssl dgst -sha256 >/dev/null 2>&1 || \
        say "error: openssl runs but cannot hash, so the libcrypto behind it is not usable; every mint in gen-dev-keys.sh would fail one command later"; \
    [ "${fail}" = 0 ] || { echo "mos-build-openssl: the toolchain this image promises is not what it contains; see the errors above" >&2; exit 1; }; \
    mkdir -p /etc/mos-build; \
    { \
        echo "MOS_BUILD_IMAGE=mos-build-openssl"; \
        echo "MOS_BUILD_FROM=${MOS_BASE_IMAGE}"; \
        echo "MOS_BUILD_ARCH=${arch}"; \
        echo "MOS_BUILD_OPENSSL=$(dpkg-query -W -f='${Version}' openssl)"; \
        echo "MOS_BUILD_OPENSSL_VERSION=$(openssl version)"; \
        echo "MOS_BUILD_JQ=$(dpkg-query -W -f='${Version}' jq)"; \
    } >/etc/mos-build/openssl.env

# Its own file, named after this image and not the parent's base.env -- see
# build-env/build.sh's read-back. What minted a keyring is answerable from the
# image that minted it.
LABEL org.opencontainers.image.title="mos-build-openssl" \
      org.opencontainers.image.description="mos signing-material toolchain (openssl, jq)" \
      org.opencontainers.image.base.name="${MOS_BASE_IMAGE}" \
      com.mos.build-env.source="build-env/openssl/Dockerfile" \
      com.mos.build-env.pins="build-env/images.env"
