# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# The rauc-update producer: the `mos-rauc-update` package.
#
#   make os-deb-rauc-update   ->  build-env/deb/build.sh --producer rauc-update --arch <amd64|arm64>
#
# This file only STAGES and PACKS. The binaries were cross-compiled on an amd64
# Rust builder by this producer's PREPARE hook and arrive through the `bin`
# context; the copyright file arrives through `family`, because the build
# context is this producer's own directory. This stage runs at the TARGET
# architecture because dpkg-shlibdeps resolves an ELF's dependencies against the
# libraries of the container it runs in, and build-env/deb/pack.sh refuses the
# mismatch by name.
#
# No default for the base, for the reason build-env/deb/Dockerfile gives: a
# driver that failed to pass the argument would otherwise build from a floating
# tag.
ARG MOS_BUILD_DEB

FROM ${MOS_BUILD_DEB} AS pack

# pack.sh comes over as a named context rather than out of the image. It is the
# packaging CONTRACT, shared by every producer, and build-env/deb/README.md
# requires this shape: an edit to the packer then takes effect without
# rebuilding the whole builder family.
COPY --from=packer pack.sh /usr/local/bin/pack.sh

COPY --from=family copyright /in/copyright
COPY control/ /in/control/
COPY --from=bin rauc-update rauc-verify /in/bin/

ARG MOS_DEB_VERSION
ARG MOS_DEB_ARCH
ARG SOURCE_DATE_EPOCH

# One staged root and one pack.sh run. Both binaries go to /usr/bin, which is
# where docs/design/release-signing.md section 3.1 spells the operator
# sequence and where rauc-update's own `--install` route expects to find `rauc`
# beside it.
#
# NO ENABLEMENT SYMLINK, and none is missing: this package ships no unit at all.
# Nothing on a device schedules `sync`/`check` yet -- that is mosd's
# orchestration and a separate workstream -- so there is no unit for a
# multi-user.target.wants link to point at. producer.env writes the zero.
#
# NO MAINTAINER SCRIPT either. The client reads
# /usr/share/mos/release-identity.env, and that file is written by the
# composition (rootfs/compose/compose-install.sh) from the board, profile and
# pool version of the build that made the image -- three facts no package can
# carry, because an archive is built once per architecture and installed into
# images of different boards and profiles.
RUN set -eu; \
    install -D -m 0755 /in/bin/rauc-update /stage/rauc-update/usr/bin/rauc-update; \
    install -D -m 0755 /in/bin/rauc-verify /stage/rauc-update/usr/bin/rauc-verify; \
    install -D -m 0644 /in/copyright /stage/rauc-update/usr/share/doc/mos-rauc-update/copyright; \
    pack.sh --root /stage/rauc-update --control /in/control/mos-rauc-update.control \
            --version "${MOS_DEB_VERSION}" --arch "${MOS_DEB_ARCH}" --out /out

# The export stage, the shape pkgs/mosd/deb/mosd/Dockerfile ends in: `-o
# type=local` writes this stage's filesystem into _out/debs/<arch>/pool/ and
# nothing here installs into a root.
FROM scratch AS out
COPY --from=pack /out/ /
