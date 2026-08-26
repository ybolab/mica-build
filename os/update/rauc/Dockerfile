# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# RAUC, built from upstream source without the network and streaming modes.
#
#   make os-rauc   → os/update/rauc/out-<arch>/{rauc, rauc.service,
#                                        de.pengutronix.rauc.conf,
#                                        de.pengutronix.rauc.service,
#                                        NEEDED.txt, SHA256SUMS}
#
# Same shape as os/podman/Dockerfile: builder stages, then a scratch stage that
# `-o` exports. Nothing here installs into a rootfs; os/rootfs/scripts/rauc-install.sh
# copies the output in.
#
# WHY: see os/update/rauc/versions.env. Short version -- Debian builds rauc with
# streaming on, that links libcurl-gnutls, and rauc was the only thing in the
# whole packed root that used it. Turning it off removes a second TLS stack
# from a signed image; it does not remove a feature this project ships, because
# the streaming install path is DEFERRED in os/update/rauc/manifest.raucm.in.

# THE TWO BUILDER IMAGES, INJECTED FROM os/build-env/images.env by
# os/build-env/from.sh, which os/update/rauc/build.sh calls. RFCT-108 M2c; what
# stood here was `FROM debian:trixie-slim` twice -- a tag upstream repoints
# whenever it rebuilds, so "which toolchain built the rauc on this device" was
# answerable only from a build log.
#
# NO DEFAULTS. Without a value docker refuses with "base name should not be
# blank" before any stage runs; with a default it would build green against an
# image nobody chose, which is the float this milestone removes. Build this
# through `make os-rauc`.
ARG MOS_BUILD_BASE
ARG MOS_BUILD_C

# No apt-get: git and the CA bundle are two of the five packages mos-build-base
# carries and ASSERTS from inside itself. Re-installing them here would make
# that assertion decorative -- a floor nothing spends is a floor that is never
# tested, and the first slimmed base would be found by a failed clone instead of
# by the image whose whole job is to claim the floor.
FROM ${MOS_BUILD_BASE} AS src
COPY versions.lock /versions.env

# The tag is fetched and the TREE is hashed, not the tarball: a release
# tarball can be re-rolled, and a tag can be moved. `git archive` of the tag is
# a deterministic byte stream over the source that is actually compiled.
#
# PENDING PRINTS THE HASH IT COMPUTED AND FAILS, with no environment variable
# that softens it. Until RFCT-108 M2c there was one: MOS_RAUC_STRICT defaulted
# to 0 and this was a warning.
#
# THE KNOB WENT BECAUSE ITS JUSTIFICATION WAS NEVER IMPLEMENTED. The comment
# here said an unhashed source "can reach a developer and never a release" --
# which is true only if the release path sets MOS_RAUC_STRICT=1, and nothing in
# this repository ever has: not .gitea/workflows/check.yml, not privileged.yml,
# not the Makefile, not os/update/rauc/build.sh, which passed through
# ${MOS_RAUC_STRICT:-0}. Measured by grep across the whole tree, M2c. The
# developer path and the release path were the same warning.
#
# os/update/rauc/versions.env's bump instructions carried the knob's name and so
# were not false the way os/podman/versions.env's were -- but a value that is
# never 1 makes the parenthesis describing it the only place the behaviour
# exists. os/build-env/images.env records the general form of this reasoning
# (M2a): a pin that only warns floats for as long as nobody reads a log.
RUN set -eu; . /versions.env; \
    git clone --quiet --depth 1 --branch "${RAUC_VERSION}" \
        https://github.com/rauc/rauc.git /src/rauc; \
    got="$(git -C /src/rauc archive --format=tar "${RAUC_VERSION}" | sha256sum | cut -d' ' -f1)"; \
    if [ "${RAUC_SHA256}" = "PENDING" ]; then \
        echo "HASH rauc ${RAUC_VERSION} ${got}"; \
        echo "error: rauc is pinned to ${RAUC_VERSION} with no hash. Record RAUC_SHA256=${got} in os/update/rauc/versions.env and run again; until then this build would compile whatever the tag points at today, which is a different fact from the source this tree agreed to ship" >&2; exit 1; \
    elif [ "${RAUC_SHA256}" != "${got}" ]; then \
        echo "error: rauc ${RAUC_VERSION} hashes to ${got}, but os/update/rauc/versions.env pins ${RAUC_SHA256}. Either the tag was moved upstream or the pin is stale; do not paste the new hash in without finding out which" >&2; exit 1; \
    else \
        echo "ok rauc ${RAUC_VERSION} ${got}"; \
    fi; \
    rm -rf /src/rauc/.git

# mos-build-c carries the C toolchain -- gcc, libc6-dev via build-essential,
# pkgconf providing pkg-config, and binutils from mos-build-base -- and asserts
# their versions from inside itself. What stays in this apt list is what is
# about RAUC rather than about C: meson and ninja are rauc's build system, and
# the five -dev packages are the libraries rauc links. That boundary is the one
# os/podman/Dockerfile measured at ~42 minutes: a component's headers in a
# shared image put them in every other component's cache key.
FROM ${MOS_BUILD_C} AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
        meson ninja-build \
        libglib2.0-dev libjson-glib-dev libssl-dev libfdisk-dev \
        libdbus-1-dev \
    && rm -rf /var/lib/apt/lists/*
COPY --from=src /src/rauc /src/rauc
WORKDIR /src/rauc

# -Dnetwork=false -Dstreaming=false are the whole point; the rest is the same
# configuration Debian uses, minus the test suite and the HTML documentation.
#
# libdbus-1-dev is a BUILD dependency only: meson.build asks pkg-config for
# dbus-1 and fails setup without it, but the binary talks to the bus through
# GDBus and never links libdbus-1 -- the NEEDED assertion below is what says so.
#
# The install directories are named explicitly rather than left to pkg-config:
# this stage has no systemd and no dbus installed, so their .pc files are
# absent and meson would silently put the unit and the policy somewhere else.
# The image verifier asserts all three paths, so a wrong one is caught -- but
# it is caught two builds later, which is not where a build should learn it.
RUN set -eu; \
    meson setup build \
        -Dnetwork=false \
        -Dstreaming=false \
        -Dservice=true \
        -Dcreate=true \
        -Djson=enabled \
        -Dgpt=enabled \
        -Dtests=false \
        -Dhtmldocs=false \
        -Dsystemdunitdir=/usr/lib/systemd/system \
        -Ddbuspolicydir=/usr/share/dbus-1/system.d \
        -Ddbussystemservicedir=/usr/share/dbus-1/system-services \
        -Dbuildtype=release \
        --prefix=/usr; \
    ninja -C build; \
    DESTDIR=/staging ninja -C build install; \
    strip /staging/usr/bin/rauc

# NO CURL AND NO SECOND TLS STACK. Asserted from the binary's own NEEDED list,
# because that is the claim -- not "the option was passed", which would still
# be true if a future version linked curl for something else.
RUN set -eu; \
    objdump -p /staging/usr/bin/rauc | awk '/NEEDED/{print $2}' | sort >/staging/NEEDED.txt; \
    if grep -qiE 'curl|gnutls|nettle|krb5' /staging/NEEDED.txt; then \
        echo "error: the built rauc links a network/TLS library it must not:" >&2; \
        grep -iE 'curl|gnutls|nettle|krb5' /staging/NEEDED.txt >&2; \
        echo "That is the whole reason this build exists (os/update/rauc/versions.env)." >&2; exit 1; \
    fi; \
    echo "rauc NEEDED:"; sed 's/^/  /' /staging/NEEDED.txt

# THE ACTIVATION PATH IS FIVE FILES, not two. The D-Bus service file says
#   Exec=/usr/libexec/rauc-service.sh   SystemdService=rauc.service
# so a bus-activated `rauc status` reaches the daemon through that script.
# Shipping the binary and the unit and not the script leaves a name that
# activates to nothing.
#
# Every file the image needs, present. A `rauc` with no unit and no D-Bus
# policy is the split-package failure os/rootfs/stages/10-base.Dockerfile already records
# at the top of its package list: the CLI proxies every command over the bus,
# so without these it answers "the name de.pengutronix.rauc was not provided by
# any .service files" and the health gate silently no-ops.
RUN set -eu; \
    for f in /staging/usr/bin/rauc \
             /staging/usr/lib/systemd/system/rauc.service \
             /staging/usr/libexec/rauc-service.sh \
             /staging/usr/share/dbus-1/system.d/de.pengutronix.rauc.conf \
             /staging/usr/share/dbus-1/system-services/de.pengutronix.rauc.service; do \
        [ -f "${f}" ] || { echo "error: the build produced no ${f#/staging}" >&2; exit 1; }; \
    done; \
    cd /staging && sha256sum usr/bin/rauc \
        usr/lib/systemd/system/rauc.service \
        usr/share/dbus-1/system.d/de.pengutronix.rauc.conf \
        usr/libexec/rauc-service.sh \
        usr/share/dbus-1/system-services/de.pengutronix.rauc.service >/staging/SHA256SUMS

COPY --from=src /versions.env /staging/RAUC_VERSION.env

FROM scratch
COPY --from=build /staging/usr/bin/rauc /rauc
COPY --from=build /staging/usr/lib/systemd/system/rauc.service /rauc.service
COPY --from=build /staging/usr/libexec/rauc-service.sh /rauc-service.sh
COPY --from=build /staging/usr/share/dbus-1/system.d/de.pengutronix.rauc.conf /de.pengutronix.rauc.conf
COPY --from=build /staging/usr/share/dbus-1/system-services/de.pengutronix.rauc.service /de.pengutronix.rauc.service
COPY --from=build /staging/NEEDED.txt /NEEDED.txt
COPY --from=build /staging/SHA256SUMS /SHA256SUMS
COPY --from=build /staging/RAUC_VERSION.env /RAUC_VERSION.env
