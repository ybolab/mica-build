# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# The profile producer: the `mica-profile-dev` and `mica-profile-prod` packages.
#
#   bash build-env/deb/build.sh --producer profile --arch all
#
# This file only STAGES and PACKS. Nothing is compiled here and nothing is
# copied out of another image: the payload is one generated text file per
# package, which is why this producer needs no `bin` or `dist` context.
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

ARG MOS_DEB_VERSION
ARG MOS_DEB_ARCH
ARG SOURCE_DATE_EPOCH
# Provenance, written into the control file by pack.sh; see build-env/deb/README.md.
ARG MOS_DEB_SOURCE_REPO
ARG MOS_DEB_SOURCE_COMMIT

# One loop over the two profile values, and not two spelled-out stanzas as
# pkgs/micad/deb/micad/Dockerfile has. There the two packages hold different
# binaries and different units, so writing them out is writing out a real
# difference; here the two payloads are ONE payload rendered twice, differing
# in the bytes of profile.conf and in the doc directory that carries the
# package's own name. A loop makes that a property of the file rather than a
# claim about it -- there is no line where the two could drift apart.
#
# The path, the mode and the bytes are the ones rootfs/scripts/profile-write.sh
# writes today from rootfs/stages/10-base.Dockerfile, down to the trailing
# newline `printf 'MOS_PROFILE=%s\n'` produces: micad's comparison is
# case-sensitive and fails closed to `prod`, so a payload that differed from
# the stage chain's by a byte would disable SSH on a dev image with every gate
# green.
#
# 0444 for the same reason it is 0444 there. /usr/lib and not /etc: the file
# describes the IMAGE, not the device, and on mos /usr is inside the read-only
# verity root, so a production device cannot be edited into a development one.
#
# No maintainer scripts and no enablement links -- this package owns no unit.
# Both control archives therefore hold `control` and `md5sums` and nothing
# else.
RUN set -eu; \
    for p in dev prod; do \
        install -d -m 0755 "/stage/${p}/usr/lib/mica"; \
        printf 'MOS_PROFILE=%s\n' "${p}" >"/stage/${p}/usr/lib/mica/profile.conf"; \
        chmod 0444 "/stage/${p}/usr/lib/mica/profile.conf"; \
        install -D -m 0644 /in/copyright \
            "/stage/${p}/usr/share/doc/mica-profile-${p}/copyright"; \
        pack.sh --root "/stage/${p}" --control "/in/control/mica-profile-${p}.control" \
            --version "${MOS_DEB_VERSION}" --arch "${MOS_DEB_ARCH}" --out /out; \
    done

# The export stage, the shape pkgs/micad/deb/micad/Dockerfile ends in:
# `-o type=local` writes this stage's filesystem into _out/debs/<arch>/pool/
# and nothing here installs into a root.
FROM scratch AS out
COPY --from=pack /out/ /
