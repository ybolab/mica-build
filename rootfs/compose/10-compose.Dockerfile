# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# Bootstrap the minimal locked base, then add selected runtime and mos packages.
ARG MICA_IMAGE_BUN
FROM --platform=$TARGETPLATFORM ${MICA_IMAGE_BUN} AS bootstrap
ARG MICA_ARCH
COPY rootfs/debian/ /mos/rootfs/debian/
RUN --network=none \
    --mount=type=bind,source=_out/debian-base,target=/cache \
    bash /mos/rootfs/debian/run.sh install --arch "$MICA_ARCH" --cache-dir /cache --root /target

ARG COMPOSE_DIR
COPY ${COMPOSE_DIR}/packages.txt /selected.pkgs
RUN --network=none \
    --mount=type=bind,source=_out/debian-base,target=/cache \
    bash /mos/rootfs/debian/run.sh verify --arch "$MICA_ARCH" --cache-dir /cache --packages /selected.pkgs && \
    bash /mos/rootfs/debian/run.sh select --arch "$MICA_ARCH" --packages /selected.pkgs >/upstream.tsv && \
    bun /mos/rootfs/debian/manifest.ts helper >/helper.tsv

# THE ROOT, ENTERED RATHER THAN CHROOTED INTO. `install` above only unpacks the
# bootstrap floor and stages /.debian-extra/configure.sh; dpkg configuration
# runs maintainer scripts and therefore needs the new root to be `/`. This stage
# makes it `/` -- and that is what makes an emulated cross-build work at all,
# because buildkit runs a foreign-architecture step by prepending its own
# emulator, and that emulator re-executes itself through /proc/self/exe for
# every child it spawns. A chroot puts an empty $ROOT/proc under that path, so
# every exec inside the new root fails as ENOENT and the message names whatever
# binary was being run rather than the interpreter that could not be found.
# rootfs/debian/configure.sh carries the measurement.
FROM scratch AS base
COPY --from=bootstrap /target/ /
RUN --network=none sh /.debian-extra/configure.sh

# FROM scratch and a whole-tree COPY rather than `FROM base`: the stage above
# deletes /.debian-extra, and inheriting it would carry those archives into the
# layer this Dockerfile hands the finalizer as dead weight under a whiteout.
FROM scratch AS composed
COPY --from=base / /
ARG MICA_ARCH
ARG MICA_BOARD
ARG MICA_PROFILE
ARG MICA_RELEASE_VERSION
ARG MICA_RELEASE_COMMIT_DATE
ARG MICA_RELEASE_UNLOCKED
ARG SOURCE_DATE_EPOCH
ARG COMPOSE_DIR
COPY ${COMPOSE_DIR}/ /mos-compose/
COPY --from=bootstrap /upstream.tsv /helper.tsv /mos-compose/
RUN --network=none \
    --mount=type=bind,source=rootfs/compose,target=/mos-scripts \
    --mount=type=bind,source=rootfs/debian,target=/mos-debian \
    --mount=type=bind,source=_out/debian-base,target=/mos-debian-cache \
    --mount=type=bind,source=_out/debs,target=/mos-debs \
    sh /mos-scripts/compose-install.sh
