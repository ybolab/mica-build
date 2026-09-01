# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# mos-build-deb -- the Debian packaging toolchain.
#
#   make build-env   -> localhost/mos-build-deb:<arch>
#
# It builds nothing. build-env/deb/pack.sh turns an already-staged tree into
# a .deb inside this image, and build-env/deb/repo.sh indexes a pool of them;
# both need dpkg-dev and neither needs a compiler. Adding one would put a second
# way to produce the binaries a package carries next to the pinned builders that
# already do -- and dpkg-shlibdeps reads ELF metadata, it does not compile.
#
# No default for the base, for the reason build-env/base/Dockerfile gives:
# a driver that failed to pass the argument would otherwise build from a
# floating tag.
ARG MOS_BASE_IMAGE

FROM ${MOS_BASE_IMAGE} AS final

# Filtered to this image's DEB_ keys only -- see build-env/images.env on the
# prefix convention.
COPY images.lock /etc/mos-build/images.env

# dpkg-dev is the whole list. It brings dpkg-shlibdeps, dpkg-scanpackages and
# dpkg-gencontrol; dpkg-deb is in the `dpkg` essential set the base already
# carries, and objdump -- which dpkg-shlibdeps drives -- is mos-build-base's
# binutils.
RUN --mount=type=cache,target=/var/cache/apt,id=apt-cache-mos-build-deb,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,id=apt-lists-mos-build-deb,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean && \
    apt-get update && apt-get install -y --no-install-recommends \
        dpkg-dev

# The floor, asserted from inside the image that promises it.
#
# Floors and not exact versions, for the reason mos-build-base's block gives:
# the digest pins the base filesystem and not the apt archive these come from.
#
# dpkg-dev's tools are asserted through `--version`, not through `command -v`.
# They are perl scripts over Dpkg::* -- a present script whose modules do not
# load is a packaging run that dies mid-build with a perl backtrace, and only
# running one tells the two apart.
ARG MOS_BASE_IMAGE
ARG TARGETARCH
RUN set -eu; \
    . /etc/mos-build/images.env; \
    fail=0; \
    say() { echo "mos-build-deb: $*" >&2; fail=1; }; \
    ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }; \
    check() { \
        name="$1"; want="$2"; got="$3"; \
        if [ -z "${got}" ]; then say "error: could not read a version out of ${name}"; \
        elif ge "${got}" "${want}"; then echo "ok ${name} ${got} (floor ${want})"; \
        else say "error: ${name} is ${got}, below the floor ${want} that build-env/images.env declares. Either the base moved backwards or the floor was raised without measuring; do not lower the floor to make this pass"; fi; \
    }; \
    arch="$(dpkg --print-architecture)"; \
    if [ -n "${TARGETARCH:-}" ] && [ "${arch}" != "${TARGETARCH}" ]; then \
        say "error: this image is ${arch} but the build asked for ${TARGETARCH}; the builder has no emulator for it and silently produced a host-architecture image. Every dpkg-shlibdeps run in it would then resolve the wrong architecture's libraries"; \
    fi; \
    check dpkg      "${DEB_FLOOR_DPKG_MIN}"     "$(dpkg --version 2>/dev/null | sed -n 's/.*version \([0-9][0-9.]*\).*/\1/p' | head -n1)"; \
    check dpkg-deb  "${DEB_FLOOR_DPKG_MIN}"     "$(dpkg-deb --version 2>/dev/null | sed -n 's/.*version \([0-9][0-9.]*\).*/\1/p' | head -n1)"; \
    check dpkg-dev  "${DEB_FLOOR_DPKG_DEV_MIN}" "$(dpkg-shlibdeps --version 2>/dev/null | sed -n 's/.*version \([0-9][0-9.]*\).*/\1/p' | head -n1)"; \
    check perl      "${DEB_FLOOR_PERL_MIN}"     "$(perl -e 'printf "%vd", $^V' 2>/dev/null)"; \
    for t in dpkg-scanpackages dpkg-gencontrol; do \
        "${t}" --version >/dev/null 2>&1 || say "error: ${t} does not run, but build-env/deb/repo.sh and the packer stand on it"; \
    done; \
    for t in objdump md5sum sha256sum du file; do \
        command -v "${t}" >/dev/null 2>&1 || say "error: ${t} is not on PATH; build-env/deb/pack.sh drives it to find ELF payloads, hash them and size them"; \
    done; \
    [ "${fail}" = 0 ] || { echo "mos-build-deb: the toolchain this image promises is not what it contains; see the errors above" >&2; exit 1; }; \
    mkdir -p /etc/mos-build; \
    { \
        echo "MOS_BUILD_IMAGE=mos-build-deb"; \
        echo "MOS_BUILD_FROM=${MOS_BASE_IMAGE}"; \
        echo "MOS_BUILD_ARCH=${arch}"; \
        echo "MOS_BUILD_DPKG=$(dpkg-query -W -f='${Version}' dpkg)"; \
        echo "MOS_BUILD_DPKG_DEV=$(dpkg-query -W -f='${Version}' dpkg-dev)"; \
        echo "MOS_BUILD_PERL=$(dpkg-query -W -f='${Version}' perl)"; \
    } >/etc/mos-build/deb.env

# Its own file, named after this image and not the parent's base.env -- see
# build-env/build.sh's read-back. A package producer reads it back to answer
# "what packaged this".
LABEL org.opencontainers.image.title="mos-build-deb" \
      org.opencontainers.image.description="mos Debian packaging toolchain" \
      org.opencontainers.image.base.name="${MOS_BASE_IMAGE}" \
      com.mos.build-env.source="build-env/deb/Dockerfile" \
      com.mos.build-env.pins="build-env/images.env"
