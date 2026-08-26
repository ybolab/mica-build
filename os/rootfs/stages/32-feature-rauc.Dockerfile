# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# =============================================================================
# stages/32-feature-rauc — the update client: five files off os/update/rauc's
# build, and the assertion that the binary in THIS root links no second TLS
# stack.
#
# PLAN-014 M5 (RFCT-111 M5c), cut out of the temporary 30-40-unsplit
# (positions 4 and 5).
#
# A FEATURE STAGE WITH NO CALLER-FACING SWITCH, and that is worth saying
# plainly rather than leaving a reader to notice. RFCT-111 names four
# switchable features; RAUC is not one of them, and no board declines it --
# an image without RAUC is an image that cannot take an update, which is the
# whole of mos's A/B design. It is a stage because the material has to live
# somewhere and one-feature-per-stage is the vocabulary M5 chose, and because
# it is the one grouping under which `rauc-install` and its no-TLS assertion
# are obviously the same subject.
#
# So the mechanism can omit it -- `--without rauc` builds a chain without this
# file -- and nothing does. If a board ever should decline the update client,
# the switch already exists and os/rootfs/build-v2.sh is the one file that has
# to learn to use it.
#
# grub-editenv is NOT here. RAUC's grub backend execs it, so it reads as RAUC
# material; it is installed in stages/40-board because it is gated on
# RAUC_BOOTLOADER, which is a board fact, and because it is an apt transaction
# and the board stage is where the rest of them are.
# =============================================================================

# THE LINK BACK UP THE CHAIN. MOS_STAGE_PREV is the local image tag the
# previous stage was written to; the driver passes it and refuses to build a
# stage that does not declare it. There is no default, so this file cannot be
# built standalone against whatever `FROM` happened to be typed -- which is the
# whole safety of a chain built out of separate files.
ARG MOS_STAGE_PREV
FROM ${MOS_STAGE_PREV}

# RAUC, built from upstream by os/update/rauc/ (see os/update/rauc/versions.env for why it is
# not the Debian package). Five files, and all five are on the activation path:
# the binary, the unit, the script the D-Bus service file Execs, the bus policy
# and the activation file itself. Debian splits these across two packages and
# the split has bitten this image before -- the note at the top of the package
# list records what a `rauc` with no service files does, which is answer "the
# name de.pengutronix.rauc was not provided by any .service files" while the
# health gate reports green.
ARG RAUC_DIR
COPY ${RAUC_DIR}/ /tmp/rauc/
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/rauc-install.sh

# NOT LINKED AGAINST A SECOND TLS STACK, asserted against the binary that is
# actually in this root rather than against the build's own claim. `ldd` here
# is the loader's answer under emulation for a foreign board; a curl or GnuTLS
# soname reappearing would mean the source build silently regained streaming.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/rauc-assert-no-tls-stack.sh
