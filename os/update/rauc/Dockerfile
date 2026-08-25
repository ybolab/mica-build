# syntax=docker/dockerfile:1
# RAUC, built from upstream source without the network and streaming modes.
#
#   make os-rauc   → os/update/rauc/out-<arch>/{rauc, rauc.service,
#                                        de.pengutronix.rauc.conf,
#                                        de.pengutronix.rauc.service,
#                                        NEEDED.txt, SHA256SUMS}
#
# Same shape as os/podman/Dockerfile: builder stages, then a scratch stage that
# `-o` exports. Nothing here installs into a rootfs; os/rootfs/Dockerfile.v2
# copies the output in.
#
# WHY: see os/update/rauc/versions.env. Short version -- Debian builds rauc with
# streaming on, that links libcurl-gnutls, and rauc was the only thing in the
# whole packed root that used it. Turning it off removes a second TLS stack
# from a signed image; it does not remove a feature this project ships, because
# the streaming install path is DEFERRED in os/update/rauc/manifest.raucm.in.

FROM debian:trixie-slim AS src
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY versions.lock /versions.env

# The tag is fetched and the TREE is hashed, not the tarball: a release
# tarball can be re-rolled, and a tag can be moved. `git archive` of the tag is
# a deterministic byte stream over the source that is actually compiled.
#
# PENDING is accepted and reported rather than silently passed -- it is how a
# version is bumped. MOS_RAUC_STRICT=1 refuses it, so an unhashed source can
# reach a developer and never a release.
ARG MOS_RAUC_STRICT=0
RUN set -eu; . /versions.env; \
    git clone --quiet --depth 1 --branch "${RAUC_VERSION}" \
        https://github.com/rauc/rauc.git /src/rauc; \
    got="$(git -C /src/rauc archive --format=tar "${RAUC_VERSION}" | sha256sum | cut -d' ' -f1)"; \
    if [ "${RAUC_SHA256}" = "PENDING" ]; then \
        echo "HASH rauc ${RAUC_VERSION} ${got}"; \
        if [ "${MOS_RAUC_STRICT}" = "1" ]; then \
            echo "error: rauc is pinned to ${RAUC_VERSION} with no hash and MOS_RAUC_STRICT=1 refuses that. Record the hash printed above in os/update/rauc/versions.env" >&2; exit 1; \
        fi; \
        echo "warning: rauc ${RAUC_VERSION} is UNHASHED. Record ${got} in os/update/rauc/versions.env -- until then this build trusts whatever the tag points at today" >&2; \
    elif [ "${RAUC_SHA256}" != "${got}" ]; then \
        echo "error: rauc ${RAUC_VERSION} hashes to ${got}, but os/update/rauc/versions.env pins ${RAUC_SHA256}. Either the tag was moved upstream or the pin is stale; do not paste the new hash in without finding out which" >&2; exit 1; \
    else \
        echo "ok rauc ${RAUC_VERSION} ${got}"; \
    fi; \
    rm -rf /src/rauc/.git

FROM debian:trixie-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
        meson ninja-build pkg-config gcc libc6-dev binutils \
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
# policy is the split-package failure os/rootfs/Dockerfile.v2 already records
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
