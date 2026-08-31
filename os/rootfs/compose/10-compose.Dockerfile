# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# compose/10-compose -- the whole device root, in one APT transaction.
#
# PLAN-036 section 4. This file replaces stages 10 through 40 of the chain: the
# floor, the read-only-root wiring, the four feature stages and the board are
# all Debian packages now, and what decides the order they are configured in is
# their own `Depends` rather than a number in a filename. There is nothing here
# for a stage boundary to sit between -- one apt transaction is atomic by
# construction -- so this directory holds two files and not nine.
#
# THE FINALIZER IS NOT COPIED HERE. 90-pack.Dockerfile beside this file is a
# SYMLINK to ../stages/90-pack.Dockerfile, so the chain and the composition
# reach one definition of the close-and-pack half. That is load-bearing rather
# than tidy: os/tests/dual-build-gate.sh compares a chain-built root against a
# composed one, and if the two paths ran different finalizer code every
# difference it reported would be ambiguous between "the composition differs"
# and "the finalizer differs". The stage driver records each file's content
# hash in _out/<board>/rootfs-stages.txt, so the two builds' manifests carry
# the SAME hash for 90-pack and the gate asserts that they do.
#
# The driver is os/build/src/stages-cli.ts, unchanged: it discovers
# <number>-<name>.Dockerfile in the directory it is pointed at, builds them in
# numeric order, hands each the previous one's image through MOS_STAGE_PREV,
# and exports the last one's `artifact` and `factory-root` targets. It knows
# nothing about which directory it was given, which is why a composed build
# needs no second driver.

# This stage's base, injected from os/build-env/images.env by
# os/build-env/from.sh exactly as stages/10-base's is, and pinned for the same
# reason: a bare `debian:trixie-slim` is a tag upstream repoints, so the answer
# to "which Debian is in this device image" would be the date of the build.
# No default -- without a value docker refuses before anything runs, and with
# one it would build green against an image nobody chose.
ARG MOS_IMAGE_DEBIAN_TRIXIE

FROM --platform=$TARGETPLATFORM ${MOS_IMAGE_DEBIAN_TRIXIE} AS composed

# $TARGETPLATFORM and not a pinned linux/arm64, for stages/10-base's reason: a
# pin overrides whatever --platform the caller passed, so an amd64 build would
# silently produce an arm64 root and fail at first exec.

# What the composer is handed, and it is deliberately little. Every fact about
# WHICH packages -- board, profile, radios, declined features -- was resolved by
# os/rootfs/packages/resolve.sh on the host and arrives as one file. This
# Dockerfile makes no selection of its own; a second copy of the decline logic
# here is the second table this repository keeps deleting.
ARG MOS_ARCH
ARG MOS_BOARD

# The upstream RAUC version, for /rootfs-report.rauc -- the one file the
# finalizer's build report reads that no package payload carries.
# os/rootfs/scripts/rauc-install.sh writes it in the chain from the
# RAUC_VERSION.env the source build stages beside the binary; mos-rauc packages
# the binary and not that file, so on this path the value comes from
# os/pkgs/rauc/versions.env, which is the same pin os/verify's smoke register
# requires the binary in the image to REPORT. Empty is refused when mos-rauc is
# in the resolution.
ARG RAUC_VERSION=""

# update-initramfs reads this from the ENVIRONMENT, not from a flag, and an
# unset one is not a broken build -- it is a working one whose initrd carries
# the build clock and this host's inode numbers into the verity-covered root.
# stages/40-board declares it for the same RUN in the chain; here it is
# linux-image-amd64's own postinst that runs update-initramfs, so the value has
# to be in this stage's environment rather than in a script's arguments.
ARG SOURCE_DATE_EPOCH

# The host-staged half of the context: the resolved package list and the RAUC
# trust root. Both are per-build values that no package can carry --
# the resolution is this build's selection, and the keyring is the CA an
# operator put in the repository-root ca/. COPY and not a bind mount because
# the keyring has to end up IN the image; the pool below is bound instead,
# because 300 MB of archives must not.
ARG COMPOSE_DIR
COPY ${COMPOSE_DIR}/ /mos-compose/

# THE POOL IS BOUND, NOT COPIED, and the source path is a literal.
# `_out/debs` holds one directory per architecture and the script picks
# ${MOS_ARCH} out of it, so this needs no build argument and cannot be pointed
# at the other architecture's pool by a caller who got one wrong. A COPY here
# would put every archive into a layer that the packed root does not keep but
# the intermediate OCI layout does.
RUN --mount=type=bind,source=os/rootfs/compose,target=/mos-scripts \
    --mount=type=bind,source=_out/debs,target=/mos-debs \
    sh /mos-scripts/compose-install.sh
