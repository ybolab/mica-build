# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# The RAUC producer: the `mos-rauc` package.
#
#   make os-deb-rauc   ->  os/build-env/deb/build.sh --producer rauc --arch <amd64|arm64>
#
# This file only ASSERTS, STAGES and PACKS. RAUC itself was compiled from the
# pinned upstream source by this producer's PREPARE hook -- through
# os/pkgs/rauc/build.sh, at the target architecture -- and its five files arrive
# through the `bin` context. This stage runs at the TARGET architecture too,
# because dpkg-shlibdeps resolves an ELF's dependencies against the libraries of
# the container it runs in and os/build-env/deb/pack.sh refuses the mismatch by
# name.
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

# THE LIBRARIES RAUC LINKS, installed into the packing container because
# dpkg-shlibdeps maps a soname to a package by FINDING that soname on the
# system it runs on. mos-build-deb carries dpkg-dev and libc and nothing else,
# so without this the pack below dies with `cannot find library
# libjson-glib-1.0.so.0 needed by .../usr/bin/rauc` -- measured, not feared.
# `ldd` in the no-second-TLS assertion is answered properly for the same
# reason: an unresolved soname is reported as `not found`, which is a weaker
# answer than the loader's.
#
# The -dev packages, and it is the SAME FOUR os/pkgs/rauc/Dockerfile installs to
# compile against. Their runtime siblings arrive as their dependencies, so this
# is one list rather than a second one that has to track soname-package
# renames -- libglib2.0-0 became libglib2.0-0t64 in the 64-bit time_t
# transition and libglib2.0-dev did not.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-dev libjson-glib-dev libssl-dev libfdisk-dev \
    && rm -rf /var/lib/apt/lists/*

COPY control/ /in/control/
COPY copyright /in/copyright

# The no-second-TLS assertion, taken from os/rootfs/scripts/ and not copied into
# this producer. os/rootfs/stages/32-feature-rauc.Dockerfile runs the same file
# against the same binary in the image; two copies of it would be two versions
# of one claim, and the one nobody edited would keep passing.
COPY --from=scripts rauc-assert-no-tls-stack.sh /in/scripts/

COPY --from=bin rauc rauc-service.sh rauc.service \
     de.pengutronix.rauc.conf de.pengutronix.rauc.service /in/bin/

ARG MOS_DEB_VERSION
ARG MOS_DEB_ARCH
ARG SOURCE_DATE_EPOCH

# One staged root and one pack.sh run. The paths and the modes are the ones
# os/rootfs/scripts/rauc-install.sh writes today, so a root composed from this
# package is the tree the stage chain installs.
#
# THE NO-SECOND-TLS ASSERTION RUNS FIRST, and it runs HERE rather than on the
# host, because this stage is at the target architecture: `ldd` is answered by
# the loader that will answer it on the device, under the emulator for a foreign
# board, instead of by an amd64 loader asked about an arm64 file. The binary is
# installed at /usr/bin/rauc in this container -- the path the script names and
# the path it will have on the device -- so the script is run unmodified.
# os/pkgs/rauc/versions.env is why the claim exists at all: rauc was the only
# consumer of libcurl-gnutls in the whole root.
#
# NO ENABLEMENT SYMLINK, deliberately, and os/pkgs/rauc/deb/rauc/producer.env
# declares that as `mos-rauc=0` rather than by leaving the row out.
# os/rootfs/scripts/rauc-install.sh creates none and no other script under
# os/rootfs/ names rauc.service, so the tree this package reproduces reaches the
# daemon through D-Bus activation: de.pengutronix.rauc.service in this payload
# names SystemdService=rauc.service and the bus asks systemd for the unit on the
# first method call. rauc.service keeps whatever [Install] section upstream
# gives it, so `systemctl enable` stays meaningful to anyone debugging on a
# writable root; nothing here creates the link and there is no maintainer script
# to call `systemctl enable` either.
#
# The BOARD's system.conf and bootloader configuration are NOT here. PLAN-036
# section 3 puts them in the board packages, because both are board facts:
# os/pkgs/rauc/system.conf.in is rendered per board and grub-editenv is
# installed by os/rootfs/stages/40-board.Dockerfile gated on RAUC_BOOTLOADER.
#
# WHAT THIS PACKAGE OWNS, asserted rather than described. The declared list
# below is compared against the staged tree path by path AND mode by mode, and
# the two `install -d` parents no `install -D` creates are in it as well -- so a
# later edit that stages a board file, a rendered system.conf, or the source
# build's own NEEDED.txt into this payload fails here, naming the path, instead
# of shipping a path this package had no business owning. pack.sh then asserts
# the archive's payload equals this same tree, which carries the claim through
# to the .deb.
RUN set -eu; \
    install -D -m 0755 /in/bin/rauc /usr/bin/rauc; \
    sh /in/scripts/rauc-assert-no-tls-stack.sh; \
    install -D -m 0755 /usr/bin/rauc                     /stage/usr/bin/rauc; \
    install -D -m 0755 /in/bin/rauc-service.sh           /stage/usr/libexec/rauc-service.sh; \
    install -D -m 0644 /in/bin/rauc.service              /stage/usr/lib/systemd/system/rauc.service; \
    install -D -m 0644 /in/bin/de.pengutronix.rauc.conf  /stage/usr/share/dbus-1/system.d/de.pengutronix.rauc.conf; \
    install -D -m 0644 /in/bin/de.pengutronix.rauc.service /stage/usr/share/dbus-1/system-services/de.pengutronix.rauc.service; \
    install -D -m 0644 /in/copyright                     /stage/usr/share/doc/mos-rauc/copyright; \
    printf '%s\n' \
        'usr 755' \
        'usr/bin 755' \
        'usr/bin/rauc 755' \
        'usr/lib 755' \
        'usr/lib/systemd 755' \
        'usr/lib/systemd/system 755' \
        'usr/lib/systemd/system/rauc.service 644' \
        'usr/libexec 755' \
        'usr/libexec/rauc-service.sh 755' \
        'usr/share 755' \
        'usr/share/dbus-1 755' \
        'usr/share/dbus-1/system-services 755' \
        'usr/share/dbus-1/system-services/de.pengutronix.rauc.service 644' \
        'usr/share/dbus-1/system.d 755' \
        'usr/share/dbus-1/system.d/de.pengutronix.rauc.conf 644' \
        'usr/share/doc 755' \
        'usr/share/doc/mos-rauc 755' \
        'usr/share/doc/mos-rauc/copyright 644' >/in/declared.paths; \
    (cd /stage && find . -mindepth 1 -printf '%P %m\n') | LC_ALL=C sort >/in/staged.paths; \
    if ! diff -u /in/declared.paths /in/staged.paths; then \
        echo "error: the staged mos-rauc tree is not the one this producer declares (-- declared, ++ staged). os/pkgs/rauc/deb/rauc/Dockerfile is where the list lives, and os/rootfs/scripts/rauc-install.sh is the contract it reproduces" >&2; \
        exit 1; \
    fi; \
    pack.sh --root /stage --control /in/control/mos-rauc.control \
            --version "${MOS_DEB_VERSION}" --arch "${MOS_DEB_ARCH}" --out /out; \
    got="$(cd /out && find . -mindepth 1 -printf '%P\n' | LC_ALL=C sort | tr '\n' ' ')"; \
    if [ "${got}" != "mos-rauc_${MOS_DEB_VERSION}_${MOS_DEB_ARCH}.deb " ]; then \
        echo "error: this producer emits mos-rauc and nothing else, and /out holds: ${got}. PACKAGES in os/pkgs/rauc/deb/rauc/producer.env is the declaration the pool and the gate are checked against" >&2; \
        exit 1; \
    fi

# The export stage, the shape os/pkgs/mosd/deb/mosd/Dockerfile ends in:
# `-o type=local` writes this stage's filesystem into _out/debs/<arch>/pool/ and
# nothing here installs into a root.
FROM scratch AS out
COPY --from=pack /out/ /
