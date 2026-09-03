# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# The busybox producer: the `mos-busybox` package.
#
#   bash build-env/deb/build.sh --producer busybox --arch amd64
#   bash build-env/deb/build.sh --producer busybox --arch arm64
#
# Two stages, the split rootfs/packages-src/ca-trust makes and for the same
# reason: `harvest` takes the payload out of the pinned Debian base, `pack`
# turns it into an archive. What is harvested here is ONE FILE -- Debian's
# busybox binary -- and everything that ships beside it in Debian's own busybox
# package is deliberately left behind.
#
# WHY THE ARCHIVE IS UNPACKED AND NEVER INSTALLED, and why this package exists
# at all instead of a `Depends: busybox`. The Debian package carries
# /usr/share/initramfs-tools/hooks/zz-busybox and
# /usr/share/initramfs-tools/conf-hooks.d/busybox. The hook copies busybox into
# the initramfs and then hard-links EVERY applet name beside it inside the
# initrd; the conf fragment is what turns the hook on. On x64 the kernel
# package's postinst runs update-initramfs during the compose, so a
# `Depends: busybox` would have produced an initrd containing busybox and 270
# applet links -- the two things RFCT-281 exists to prevent -- as a side effect
# of a dependency nobody would have read. `dpkg-deb -x` runs no maintainer
# script and installs no trigger, so what lands here is exactly what this file
# names and nothing else.
#
# No default for either base, for the reason build-env/deb/Dockerfile gives: a
# driver that failed to pass the argument would otherwise build from a floating
# tag.
ARG MOS_BUILD_DEB
ARG MOS_IMAGE_DEBIAN_TRIXIE


# The harvest stage, at the TARGET architecture. producer.env declares
# ARCHES="amd64 arm64", so build.sh sets BUILD_PLATFORM from --arch and this
# whole build runs there -- which is what makes `apt-get download busybox`
# fetch the archive for the architecture the package is FOR, and what lets the
# binary be executed below on the architecture it will run on.
FROM ${MOS_IMAGE_DEBIAN_TRIXIE} AS harvest

# WHAT THIS STAGE'S OUTPUT IS A FUNCTION OF, and why busybox is not pinned to a
# version here. ${MOS_IMAGE_DEBIAN_TRIXIE} is a digest, so the base filesystem
# is bytes; `apt-get download` is not -- it resolves against live
# deb.debian.org, which carries one version per package in a suite and
# re-points it on every point release. rootfs/packages-src/ca-trust/Dockerfile
# states that shape at length for the trust store and it is the same here.
#
# A `VERSION_FROM` pin was considered and NOT taken. It is what podman and rauc
# use, and both are right to: this repository chooses their versions and
# compiles them from source, so the tree can state one. busybox is neither
# chosen nor compiled here -- it is whatever the pinned base's suite currently
# offers, which is the same relationship rootfs/packages-src/ca-trust has to
# ca-certificates and rootfs/compose has to every other Debian package in the
# root. A hard `busybox=<version>` against deb.debian.org would also break the
# build the day trixie supersedes that version, because the archive keeps only
# the current one.
#
# So the resolved version is RECORDED instead, in the copyright the pack stage
# composes. That is the file a source request is answered from, and "which
# busybox" is exactly what it has to say; the package's own version column
# carries the pool's git stamp, which says which commit built it and not which
# upstream it holds.
#
# `apt-get download`, not `apt-get install`: see the file header. It needs the
# lists and nothing else, and APT::Sandbox::User=root is set because the _apt
# user cannot write the working directory and the warning it emits otherwise
# reads like a failure.
RUN set -eu; \
    apt-get update -qq; \
    mkdir -p /dl /harvest; \
    cd /dl; \
    apt-get download -o APT::Sandbox::User=root -qq busybox; \
    deb="$(ls busybox_*.deb)"; \
    version="$(dpkg-deb -f "${deb}" Version)"; \
    [ -n "${version}" ] || \
        { echo "error: ${deb} declares no Version field" >&2; exit 1; }; \
    printf '%s\n' "${version}" >/harvest/busybox.version; \
    echo "busybox: downloaded ${deb}, busybox ${version} for $(dpkg --print-architecture)"; \
    dpkg-deb -x "${deb}" /unpack; \
    rm -rf /var/lib/apt/lists/*

# WHAT THE ARCHIVE ITSELF SAYS, asserted before one byte of it is kept.
#
# The first assertion is the load-bearing one and it is about DEBIAN's archive,
# not about this producer's staging: today's busybox package ships the binary
# and NO applet symlink -- its own description says so -- and this package's
# entire premise is that the binary arrives unexpanded. If a future Debian
# revision starts shipping links, this build stops here and names them rather
# than the pack stage silently dropping them and the premise quietly becoming
# untrue. Symlinks AND hard links are counted, because the initramfs hook this
# producer refuses to install uses hard links and an expansion that arrived that
# way would be invisible to a symlink-only test.
#
# The binary is EXECUTED. It runs at the target architecture under this stage's
# platform, links the pinned base's libc, and is asked for its applet list --
# which is the one question that proves the harvested file is a working busybox
# rather than a file of the right name and size. `--list` also states the count
# that the "no applet links" property is about: 270-odd names that this image
# deliberately does not put in PATH.
#
# `ld-linux` in the ELF is its INTERP, and it is what "the normal dynamically
# linked Debian binary" (PLAN-045) means concretely. Asserted because the
# alternative -- silently shipping busybox-static one day -- would change what
# the package is while every other check here stayed green. It is spelled as a
# substring rather than read with readelf because the packing image carries no
# binutils and both architectures' loaders are named `ld-linux-*`.
RUN set -eu; \
    links="$(find /unpack -type l -printf '%P\n' | sort)"; \
    [ -z "${links}" ] || \
        { echo "error: the busybox archive ships $(printf '%s\n' "${links}" | grep -c .) symlink(s), and this package's premise is that it does not: ${links}. An applet link farm in the archive is the expansion RFCT-281 refuses, and dropping it here silently would leave that premise stated in prose and enforced nowhere" >&2; exit 1; }; \
    hard="$(find /unpack -type f -links +1 -printf '%P\n' | sort)"; \
    [ -z "${hard}" ] || \
        { echo "error: the busybox archive ships hard-linked file(s): ${hard}. Debian's own initramfs hook expands applets as HARD links, so an expansion arriving this way would pass a symlink-only test" >&2; exit 1; }; \
    files="$(find /unpack -type f -printf '%P\n' | sort | tr '\n' ' ')"; \
    echo "busybox: the archive holds ${files}"; \
    [ -f /unpack/usr/bin/busybox ] || \
        { echo "error: the busybox archive has no /usr/bin/busybox. That path is the whole payload of this package and the one the image contract names" >&2; exit 1; }; \
    grep -q 'ld-linux' /unpack/usr/bin/busybox || \
        { echo "error: /unpack/usr/bin/busybox names no ld-linux interpreter, so it is not the dynamically linked Debian build PLAN-045 specifies -- a static rescue binary is a different decision and is deferred to a designed recovery environment" >&2; exit 1; }; \
    applets="$(/unpack/usr/bin/busybox --list | grep -c .)"; \
    [ "${applets}" -ge 100 ] || \
        { echo "error: the harvested busybox lists ${applets} applet(s). It ran, so it is a working binary, but a build this small is not the Debian package this producer means to ship" >&2; exit 1; }; \
    echo "busybox: the harvested binary runs and offers ${applets} applets, none of them linked into PATH"

# The payload, and the two licence documents it needs. /usr/bin/busybox is the
# ONLY file taken out of the archive: the manual page, the changelogs, the
# lintian override and both initramfs-tools files stay behind.
#
# GPL-2 is harvested from the base's own /usr/share/common-licenses, because
# busybox's copyright POINTS at that path and the mos image does not ship the
# directory -- rootfs/packages-src/ca-trust met the same dangling reference and
# its ruling applies unchanged: a licence's text is not rewritten to make a
# pointer resolve, so the text is carried instead.
RUN set -eu; \
    install -D -m 0755 /unpack/usr/bin/busybox /harvest/busybox; \
    install -D -m 0644 /unpack/usr/share/doc/busybox/copyright /harvest/busybox.copyright; \
    install -D -m 0644 /usr/share/common-licenses/GPL-2 /harvest/GPL-2; \
    grep -q 'GNU GENERAL PUBLIC LICENSE' /harvest/GPL-2 || \
        { echo "error: the base's /usr/share/common-licenses/GPL-2 does not read as the GPL. That file is what busybox's own copyright points at and what this package carries in its place" >&2; exit 1; }


FROM ${MOS_BUILD_DEB} AS pack

# pack.sh comes over as a named context rather than out of the image. It is the
# packaging CONTRACT, shared by every producer, and build-env/deb/README.md
# requires this shape: an edit to the packer then takes effect without
# rebuilding the whole builder family.
COPY --from=packer pack.sh /usr/local/bin/pack.sh

COPY control/ /in/control/
COPY --from=harvest /harvest/ /in/harvest/

ARG MOS_DEB_VERSION
ARG MOS_DEB_ARCH
ARG SOURCE_DATE_EPOCH

# The copyright, composed. There is no shared rootfs/packages-src/copyright in
# this build: that file is for payloads this repository wrote and says so, and
# this payload is Debian's busybox under GPL-2. So busybox's own copyright is
# reproduced verbatim and the GPL-2 text it references is appended beneath it,
# with a header saying which archive the binary came out of.
#
# The resolved upstream version is written INTO the header. It is the answer to
# "which busybox is this" for a source request, and it is the only place that
# question is answerable: the package's own version column carries the pool's
# git stamp, which says which commit built the archive.
RUN set -eu; \
    version="$(cat /in/harvest/busybox.version)"; \
    install -d -m 0755 /stage/usr/share/doc/mos-busybox; \
    { \
        echo 'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/'; \
        echo 'Upstream-Name: busybox'; \
        printf 'Comment: The payload of this package is not mos-authored. It is ONE file --\n'; \
        printf ' /usr/bin/busybox -- taken byte for byte out of Debian'"'"'s busybox binary package\n'; \
        printf ' at version %s, unpacked from the pinned Debian trixie base at package\n' "${version}"; \
        printf ' build time. Nothing was compiled, patched or configured here, and no applet\n'; \
        printf ' link was generated: the mos-authored part of this package is the packaging and\n'; \
        printf ' this file.\n'; \
        printf ' .\n'; \
        printf ' Debian'"'"'s own /usr/share/doc/busybox/copyright is reproduced below, verbatim\n'; \
        printf ' and unedited. Its GPL-2 paragraph points at /usr/share/common-licenses/GPL-2,\n'; \
        printf ' and the mos image does not ship that directory -- so rather than editing the\n'; \
        printf ' text of a licence to make a pointer resolve, the full GPL-2 as shipped by that\n'; \
        printf ' same Debian base is carried after it.\n'; \
        printf ' .\n'; \
        printf ' The source offer for this package is the one the release carries for the whole\n'; \
        printf ' inventory (build/src/release-manifest.ts); busybox %s above is what a\n' "${version}"; \
        printf ' request against it names.\n'; \
        echo ''; \
        echo '# --------------------------------------------------------------------------'; \
        echo '# Below: /usr/share/doc/busybox/copyright, as shipped by the busybox package'; \
        echo '# this binary was unpacked from. Reproduced verbatim.'; \
        echo '# --------------------------------------------------------------------------'; \
        echo ''; \
        cat /in/harvest/busybox.copyright; \
        echo ''; \
        echo '# --------------------------------------------------------------------------'; \
        echo '# Below: /usr/share/common-licenses/GPL-2 from the same Debian base -- the text'; \
        echo '# the paragraph above points at. Reproduced verbatim.'; \
        echo '# --------------------------------------------------------------------------'; \
        echo ''; \
        cat /in/harvest/GPL-2; \
    } >/stage/usr/share/doc/mos-busybox/copyright; \
    chmod 0644 /stage/usr/share/doc/mos-busybox/copyright; \
    grep -q 'GNU GENERAL PUBLIC LICENSE' /stage/usr/share/doc/mos-busybox/copyright || \
        { echo "error: the composed copyright lost the GPL-2 text" >&2; exit 1; }; \
    grep -q 'ftp.busybox.net' /stage/usr/share/doc/mos-busybox/copyright || \
        { echo "error: the composed copyright lost the harvested busybox text" >&2; exit 1; }; \
    echo "busybox: copyright composed for busybox ${version}, $(wc -l </stage/usr/share/doc/mos-busybox/copyright) lines"

# The payload itself, and the assertion that it is the WHOLE payload.
#
# This is the producer-side half of RFCT-281's second acceptance clause. The
# image-side half is verify's busybox family, which reads the packed root; this
# one reads the tree about to be packed, and it is the stronger statement of the
# two because there is no way for an applet link to reach the image that does
# not pass through here. Two regular files, no symlink, no hard link, no
# directory outside the two this package owns.
#
# NO PATH ENTRY AND NO /build/bin: neither is a file this package could ship
# accidentally, but the path-set assertion below is what makes that structural
# rather than asserted -- a profile drop-in, an environment.d fragment or a
# /build/bin directory would each be a third path and each would fail here by
# name.
#
# No mtime normalisation, for the reason rootfs/packages-src/ca-trust/Dockerfile
# records at length: build-env/deb/pack.sh SETS every path in the packed tree to
# SOURCE_DATE_EPOCH, unconditionally, and a second rule here would be a copy of
# that one.
RUN set -eu; \
    install -D -m 0755 /in/harvest/busybox /stage/usr/bin/busybox; \
    got="$(find /stage -mindepth 1 -printf '%y %P\n' | sort | tr '\n' ';')"; \
    want='d usr;d usr/bin;d usr/share;d usr/share/doc;d usr/share/doc/mos-busybox;f usr/bin/busybox;f usr/share/doc/mos-busybox/copyright;'; \
    [ "${got}" = "${want}" ] || \
        { echo "error: the staged payload is '${got}' and this package ships exactly '${want}'. An extra entry here is an applet link, a PATH drop-in or a stray file reaching the image; a missing one is a package that does not do its job" >&2; exit 1; }; \
    hard="$(find /stage -type f -links +1 -printf '%P\n')"; \
    [ -z "${hard}" ] || \
        { echo "error: the staged payload hard-links ${hard}" >&2; exit 1; }; \
    mode="$(find /stage/usr/bin/busybox -printf '%m')"; \
    [ "${mode}" = 755 ] || \
        { echo "error: /usr/bin/busybox is staged mode ${mode}, not 755; an operator reaching for it in an emergency has to be able to execute it" >&2; exit 1; }; \
    echo "busybox: staged /usr/bin/busybox ($(stat -c %s /stage/usr/bin/busybox) bytes) and one copyright, and nothing else"

# Depends is ${shlibs:Depends} alone, resolved by dpkg-shlibdeps from the ELF
# itself at the target architecture -- libc6 today, and libc6 is in every image
# already. Nothing else is written: this package execs nothing, reads no
# configuration and owns no unit, so there is no relationship dpkg-shlibdeps
# cannot see. pack.sh refuses the token if no ELF was staged, which is the
# other direction of the same check.
RUN set -eu; \
    pack.sh --root /stage --control /in/control/mos-busybox.control \
        --version "${MOS_DEB_VERSION}" --arch "${MOS_DEB_ARCH}" --out /out

# The export stage, the shape pkgs/mosd/deb/mosd/Dockerfile ends in:
# `-o type=local` writes this stage's filesystem into _out/debs/<arch>/pool/
# and nothing here installs into a root.
FROM scratch AS out
COPY --from=pack /out/ /
