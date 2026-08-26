# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# The image os/verify runs the full verifier in on a host that has no bun.
#
#   bash os/verify/run.sh --verify --board cx3576   (on a host with no bun)
#   make os-verify-cx3576-v2
#
# Not built by `make build-env`. That target builds the four mos-build-*
# COMPILER images, and nothing in this repository runs it before running the
# verifier -- .gitea/workflows/check.yml's os-verify job installs no bun and
# runs no build-env, so an image this file produced there would be missing at
# exactly the moment it is needed. os/verify/run.sh builds it on demand instead,
# once, and only when it has both to take the container route AND to run
# `--verify`. A host with bun never builds it; the suite and the lint never
# build it.
#
# Why this exists. The full verifier has to run on a host with no bun, and
# IMAGE_BUN_1 alone cannot carry it: os/verify drives docker itself --
# src/tools.ts reads the image with sgdisk, mtools, debugfs, unsquashfs and
# veritysetup out of IMAGE_ALPINE_3_21 -- and the pinned bun image carries no
# docker client at all, so inside it every route ends at `docker: command not
# found`. The user decided on 2026-08-26 to close that by pinning a client;
# os/build-env/images.env's IMAGE_DOCKER_CLI_28 block records the decision, what
# it costs, and the alternative that was not chosen.
#
# Two pins, no third thing. Both FROMs are digests handed in as build arguments
# by os/verify/run.sh, which resolves them through os/build-env/from.sh -- the
# one resolver, which refuses a tag. Nothing is installed here: no apk, no apt,
# no curl. This image is exactly the pinned bun image plus one file out of the
# pinned client image, so "what did the verifier run on" is answerable from two
# digests in one file rather than from a build log.
#
# The client is static, which is what lets an alpine-built binary run on a
# debian-based bun image. Checked rather than assumed -- `ldd` reports "Not a
# valid dynamic program" -- and it matters, because a dynamically linked client
# would need musl and this COPY would produce an image that fails at exec time
# with a message about an interpreter, three steps away from the cause.

ARG MOS_DOCKER_CLI_IMAGE=invalid-must-be-passed
ARG MOS_BUN_IMAGE=invalid-must-be-passed

FROM ${MOS_DOCKER_CLI_IMAGE} AS cli

FROM ${MOS_BUN_IMAGE}
# /usr/local/bin, which is where the client image itself keeps it and where the
# bun image's PATH already looks. Copied to its own path rather than /usr/bin so
# that it cannot shadow anything the base ships.
COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker

# Asserted at BUILD time, not left for the verifier to discover. A COPY whose
# source moved upstream produces an image that is missing the one thing this
# file exists to add, and the failure would then surface inside a verify run as
# a route that could not find docker -- which is the exact sentence this image
# was built to stop printing.
RUN docker --version && bun --version
