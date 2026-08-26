# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# =============================================================================
# stages/40-board — the residue of 30-40-unsplit: the four RUNs its header
# assigned to M5d. Renamed, renumbered, RE-ORDERED WITH RESPECT TO THE FEATURE
# STAGES, and otherwise untouched.
#
# ═══ WHAT M5c DID TO THIS FILE, AND WHAT IT DID NOT ═══
#
# DID: gave it the name and number PLAN-014 M5's vocabulary reserves for it,
# and moved it BEHIND the five 30-feature-* stages. Moved the kernel-modules
# comment down to the COPY it describes -- in 30-40-unsplit it sat above the
# grub-editenv block, nine lines away from the instruction it explains.
#
# DID NOT: touch the four RUNs, their relative order, their arguments, or the
# scripts behind them. RFCT-111 M5d owns splitting board material from the
# generic mechanism that carries it (this file still COPYs os/boards/cx3576/
# and board/cx3576/ by fixed path, on every board), and that is not smuggled
# into the cut that had to move it.
#
# ═══ WHY THE BOARD WORK MOVED AFTER THE FEATURES, WHICH IS A RE-DECISION ═══
#
# 30-40-unsplit's header said outright that its order was Dockerfile.v2's and
# "NOT a claim that features must precede board work", and handed the decision
# to whoever cut it. Here it is, with what it was decided on.
#
# In that file the board RUNs were positions 9, 10, 11 and 17, with two feature
# RUNs (`radios-mounts`, `podman-assert-config`) between 11 and 17 and the mosd
# and MQTT work between them and 17. Neither arrangement is free: making the
# features contiguous means either pulling those two forward past the board
# work, or pushing the board work back past the rest of the features. Both were
# available, and the constraint that decided it is that the numbers have to
# read in the order they run -- 30-feature-* before 40-board is the vocabulary
# PLAN-014 fixed, so a 40-board that ran first would be a file whose number
# lied about when it happened.
#
# It is safe in the direction that matters, which was checked rather than
# assumed: nothing in these four RUNs reads anything a feature stage writes.
# The kernel and initramfs work reads /usr/lib/modules and the initramfs hooks;
# the firmware install moves files into /usr/lib/firmware; grub-editenv names
# its own libdevmapper dependency rather than depending on the cryptsetup-bin
# that arrives later ("depending on that ordering would make this step pass or
# fail according to where someone moves it" -- its own comment); hwinit reads
# the staged board facts. The other direction is the one that could bite, and
# does not: the two feature RUNs that moved forward read the overlay, and
# stages/20-install installs that before any feature stage runs.
#
# WHAT IT COSTS, MEASURED AND NOT ARGUED. The apt transactions still run in the
# order they ran before -- radios, containers, grub-editenv, kernel -- because
# the feature stages are ordered to keep that true, and their order is what
# decides the order of entries in the logs the pack stage carries into
# /usr/share/factory/var/log. The gate is the content diff in
# os/rootfs/README.md, and M5c's number is recorded there: SIX differing
# entries of 9,241, which is the control's own set -- nothing beyond it.
#
# ═══ WHEN 30-40-unsplit's HEADER SAID "THIS FILE IS EMPTY, DELETE IT" ═══
#
# It is: every RUN it held that was not board material is now in a
# 30-feature-* file, and this is the rest. The file is gone and this is what
# was under it.
# =============================================================================

# THE LINK BACK UP THE CHAIN. MOS_STAGE_PREV is the local image tag the
# previous stage was written to; the driver passes it and refuses to build a
# stage that does not declare it. There is no default, so this file cannot be
# built standalone against whatever `FROM` happened to be typed -- which is the
# whole safety of a chain built out of separate files.
ARG MOS_STAGE_PREV
FROM ${MOS_STAGE_PREV}

# grub-editenv, for the boards RAUC drives through the grub backend.
#
# RAUC's grub backend does not write grubenv itself -- it EXECS grub-editenv,
# the way the uboot backend execs fw_setenv. Without it rauc.service starts and
# then cannot answer anything:
#   Failed getting primary slot: grub backend: Failed to start grub-editenv:
#   Failed to execute child process "grub-editenv" (No such file or directory)
# which is a device with an A/B layout, a boot order in grubenv, and no way to
# read or write it. Found by booting x64 after the boot-attempts fix let RAUC
# start at all.
#
# THE FILE, NOT THE PACKAGE. `grub-common` is a 20 MB installed increment here
# -- it drags in libfreetype6, libpng16, libfuse3, libefivar and gettext-base,
# none of which a device that only rewrites a grubenv has any use for. The
# binary itself is 403 KB and links only against libraries this root already
# carries. apt-get download + dpkg-deb extracts exactly one path and installs
# nothing, so no dependency resolution happens and nothing has to be purged
# again afterwards.
#
# Gated on the BOOTLOADER, not on the architecture: an arm64 UEFI board would
# need this and does not exist yet, and keying it to amd64 would make that
# board's first symptom the message above rather than a build error.
ARG RAUC_BOOTLOADER=uboot
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/grub-editenv-install.sh

# Kernel modules. Debian is merged-usr (/lib -> usr/lib) and the tar's paths
# start with lib/, so it cannot be ADDed to / directly — extract to a temp dir
# and copy into /usr/lib/modules. dep files are inside the tar; no depmod needed.
#
# On amd64 there is no vendor tree and no modules.tar: the QEMU image (os/qemu)
# takes Debian's own linux-image-amd64, which brings its kernel, its initramfs
# and its modules in one package. build-v2.sh stages an EMPTY-but-valid tar on
# that path rather than making this COPY conditional -- a COPY cannot be gated,
# and a missing context file is a build error a hundred lines from its cause.
ARG MOS_ARCH=arm64
COPY os/rootfs/initramfs/ /tmp/initramfs/
ARG MODULES_TAR
COPY ${MODULES_TAR} /tmp/modules.tar
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/kernel-and-initramfs.sh

# WiFi/BT firmware: AIC8800D80 combo (single SKU; the bcmdhd/AP6275S fallback
# was dropped when the fleet was confirmed AIC-only and the kernel stopped
# building bcmdhd). Only the confirmed U02 runtime set enters the image, per
# the board BSP. Driver loading is done by the mos-modules unit.
#
# Staged to /tmp and installed only on arm64: a QEMU image has no AIC radio, and
# 2 MB of firmware for hardware that is not there would be a file an operator
# reading the image cannot account for.
COPY board/cx3576/rootfs/firmware/aic_userconfig_8800d80.txt \
     board/cx3576/rootfs/firmware/fw_adid_8800d80_u02.bin \
     board/cx3576/rootfs/firmware/fw_patch_8800d80_u02.bin \
     board/cx3576/rootfs/firmware/fw_patch_table_8800d80_u02.bin \
     board/cx3576/rootfs/firmware/fmacfw_8800d80_u02.bin \
     /tmp/fw/
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/firmware-install.sh

# Board hardware init: best-effort oneshots from os/boards/cx3576/hwinit/ +
# per-board facts staged from BOARD_DIR/init into /etc/mos.
#
# The MECHANISM is board-agnostic -- nothing below names a board -- but the
# units are filed under cx3576 because cx3576 is the only board that declares
# a hardware fact for them to read. x64 declares none, so the loop below
# installs none of them there; the COPY is what it has always been, a
# fixed path staged into /tmp for the loop to select from.
#
# BOARD_INIT_DIR may be an empty dir (boards without hw-init facts): every unit
# is condition-gated on its conf file, so enabling them is safe either way.
#
# The install list is ENUMERATED from the board facts actually staged, never
# restated here. A hardcoded list is what let this file drift behind the
# (since deleted) v1 Dockerfile once already: mos-mac and mos-gadget were
# installed but silently left disabled, costing the image its stable MAC and
# its USB debug console with no error anywhere. Adding hwinit-<n> plus
# mos-<n>.service under os/boards/cx3576/hwinit/, and an <n>.conf to the
# board, is enough.
#
# A BOARD ONLY GETS THE SCRIPTS FOR FACILITIES IT DECLARES. Every unit is
# condition-gated on its conf file, so shipping all of them to every board was
# harmless in the sense that the extra ones never ran -- but "never runs" is a
# property of a file being absent, not of a gate being right. x64 is a QEMU
# machine with no Bluetooth: it was carrying hwinit-bt, whose `rfkill unblock`
# put a dependency on a binary that board has no reason to install, and the
# image verifier reported exactly that. Dead code in a signed read-only root is
# not free, and both directions are asserted below: a conf with no script is an
# unread board fact, and a script with no conf is a unit that can never run.
#
# No board fact appears in this stage. Module names, sysfs paths, UART device,
# CAN bitrate, MAC seed and gadget IDs all live in BOARD_INIT_DIR and are read
# from /etc/mos at runtime by the units.
ARG BOARD_INIT_DIR
COPY os/boards/cx3576/hwinit/ /tmp/hwinit/
COPY ${BOARD_INIT_DIR}/ /tmp/board-init/
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/hwinit-install.sh
