# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# Bootstrap the minimal locked base, then add selected runtime and mos packages.
ARG MOS_IMAGE_BUN
FROM --platform=$TARGETPLATFORM ${MOS_IMAGE_BUN} AS bootstrap
ARG MOS_ARCH
COPY rootfs/debian/ /mos/rootfs/debian/
RUN --network=none \
    --mount=type=bind,source=_out/debian-base,target=/cache \
    bash /mos/rootfs/debian/run.sh install --arch "$MOS_ARCH" --cache-dir /cache --root /target

ARG COMPOSE_DIR
COPY ${COMPOSE_DIR}/packages.txt /selected.pkgs
RUN --network=none \
    --mount=type=bind,source=_out/debian-base,target=/cache \
    bash /mos/rootfs/debian/run.sh verify --arch "$MOS_ARCH" --cache-dir /cache --packages /selected.pkgs && \
    bash /mos/rootfs/debian/run.sh select --arch "$MOS_ARCH" --packages /selected.pkgs >/upstream.tsv && \
    bun /mos/rootfs/debian/manifest.ts helper >/helper.tsv

FROM scratch AS composed
COPY --from=bootstrap /target/ /
ARG MOS_ARCH
ARG MOS_BOARD
ARG MOS_PROFILE
ARG MOS_RELEASE_VERSION
ARG MOS_RELEASE_COMMIT_DATE
ARG RAUC_VERSION=""
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
