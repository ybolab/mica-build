# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# The mosd producer: the `mosd` and `mos-apid` packages.
#
#   bash os/pkgs/mosd/hack/build-deb.sh --producer mosd --arch <amd64|arm64>
#
# This file only STAGES and PACKS. The binaries were cross-compiled on an amd64
# Rust builder by the driver above and arrive through the `bin` context; this
# stage runs at the TARGET architecture because dpkg-shlibdeps resolves an
# ELF's dependencies against the libraries of the container it runs in, and
# os/build-env/deb/pack.sh refuses the mismatch by name.
#
# No default for the base, for the reason os/build-env/deb/Dockerfile gives: a
# driver that failed to pass the argument would otherwise build from a floating
# tag.
ARG MOS_BUILD_DEB

FROM ${MOS_BUILD_DEB} AS pack

# pack.sh comes over as a named context rather than out of the image. It is the
# packaging CONTRACT, shared by every producer, and os/build-env/deb/README.md
# requires this shape: an edit to the packer then takes effect without
# rebuilding the whole builder family.
COPY --from=packer pack.sh /usr/local/bin/pack.sh

COPY copyright /in/copyright
COPY mosd/control/ /in/control/
COPY --from=dist mosd.service apid.service com.mos.mosd.conf /in/dist/
COPY --from=bin mosd apid /in/bin/

ARG MOS_DEB_VERSION
ARG MOS_DEB_ARCH
ARG SOURCE_DATE_EPOCH

# Two staged roots and two pack.sh runs. The paths and modes are the ones
# os/rootfs/scripts/mosd-install.sh writes today, so a device composed from
# these packages carries the same tree the stage chain installs -- with one
# deliberate difference: NO multi-user.target.wants symlink. A package
# describes what it owns; the composer decides what is enabled. The image
# preset that restores enablement is a later workstream, and until it lands
# this producer's output is intentionally less than what the chain ships.
#
# /usr/share/doc/<package>/copyright is per package and not shared, which is
# what keeps the two payloads disjoint: no path is owned by both.
RUN set -eu; \
    install -D -m 0755 /in/bin/mosd               /stage/mosd/usr/bin/mosd; \
    install -D -m 0644 /in/dist/mosd.service      /stage/mosd/usr/lib/systemd/system/mosd.service; \
    install -D -m 0644 /in/dist/com.mos.mosd.conf /stage/mosd/usr/share/dbus-1/system.d/com.mos.mosd.conf; \
    install -D -m 0644 /in/copyright              /stage/mosd/usr/share/doc/mosd/copyright; \
    install -D -m 0755 /in/bin/apid               /stage/apid/usr/bin/apid; \
    install -D -m 0644 /in/dist/apid.service      /stage/apid/usr/lib/systemd/system/apid.service; \
    install -D -m 0644 /in/copyright              /stage/apid/usr/share/doc/mos-apid/copyright; \
    pack.sh --root /stage/mosd --control /in/control/mosd.control \
            --version "${MOS_DEB_VERSION}" --arch "${MOS_DEB_ARCH}" --out /out; \
    pack.sh --root /stage/apid --control /in/control/mos-apid.control \
            --version "${MOS_DEB_VERSION}" --arch "${MOS_DEB_ARCH}" --out /out

# The export stage, the shape os/pkgs/rauc/Dockerfile and
# os/pkgs/podman/Dockerfile end in: `-o type=local` writes this stage's
# filesystem into _out/debs/<arch>/pool/ and nothing here installs into a root.
FROM scratch AS out
COPY --from=pack /out/ /
