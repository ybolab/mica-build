# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# =============================================================================
# stages/40-board — everything the image carries because of WHICH BOARD it is:
# the bootloader's environment editor, the kernel and its initramfs, the radio
# firmware, and the hardware-init oneshots. Four RUNs, in the order
# 30-40-unsplit had them, behind every feature stage.
#
# ═══ NO BOARD IS NAMED IN THIS FILE (RFCT-111 M5d) ═══
#
# It named one twice, and both were content decisions taken in a file every
# board builds:
#
#   COPY board/cx3576/rootfs/firmware/<five files>  -> /tmp/fw/
#   COPY os/boards/cx3576/hwinit/                   -> /tmp/hwinit/
#
# Both ran on EVERY board. x64 staged 2 MB of AIC8800D80 firmware and six
# hardware-init oneshots into a QEMU image and then discarded them at runtime —
# firmware-install.sh on MOS_ARCH=amd64, hwinit-install.sh by finding no board
# fact for any unit to read. The image came out right. What was wrong is where
# the decision lived: a board's content chosen by a literal in a shared file,
# which is the shape PLAN-014 M1 spent four L3s removing everywhere else.
#
# ═══ THE SHAPE: A STAGED DIRECTORY PER BOARD, NOT A 40-board PER BOARD ═══
#
# Both were available and this file already recorded the constraint that
# decides between them: A COPY CANNOT BE GATED ON AN ARG. So a board's content
# reaches a shared instruction as a DIRECTORY whose contents the board chose,
# and the empty directory is how a board says "none of that here".
#
# THAT PATTERN IS NOT NEW HERE, WHICH IS WHY IT WAS EXTENDED RATHER THAN
# INVENTED. MODULES_TAR below is an empty-but-valid tar on amd64 for exactly
# this reason, and BOARD_INIT_DIR has always been "may be an empty dir (boards
# without hw-init facts)". BOARD_FIRMWARE_DIR and BOARD_HWINIT_DIR are the same
# mechanism applied to the two COPYs that had not had it yet. os/rootfs/build-v2.sh
# stages all four beside each other, in one block, from the board's own
# definition.
#
# WHY NOT A 40-board PER BOARD, which is the other shape M5c named:
#
#   - THE STAGE LIST IS THE DIRECTORY (os/build/src/stages.ts, deliberately:
#     "a stage added to the tree but not to a list would be a stage that
#     silently never runs"). Two files numbered 40 are refused for sharing a
#     number; numbered 40 and 41 they both BUILD, so every board would run
#     every other board's stage. Making the driver skip by board means a second
#     selection mechanism beside --without, keyed on something the driver is
#     not told today — it takes --board for the image TAGS only.
#   - It duplicates the reasoning, not just the instructions. grub-editenv is
#     gated on the BOOTLOADER and not on the board, and says so at length; the
#     hwinit rationale is about a mechanism that is board-agnostic. Both would
#     exist once per board and drift, which is exactly how the hardcoded hwinit
#     list drifted behind the v1 Dockerfile (see below).
#   - It scales by copying: board three is a 170-line file again.
#   - It is one more Dockerfile per board in os/build-env's frontend-pin check,
#     which counts the files rather than a list.
#
# WHAT THE BOARD DECIDES, AND WHERE IT SAYS SO. Every one of these is read from
# os/boards/<board>/board.env, which is where the layout, the architecture, the
# bootloader and the radio list already live:
#
#   BOARD_FIRMWARE_FILES   which firmware the image carries (empty = none)
#   MOS_ARCH               which kernel and initramfs route it takes
#   RAUC_BOOTLOADER        whether grub-editenv is needed at all
#
# and two directories os/rootfs/build-v2.sh stages from the board's own trees,
# either of which may legitimately be empty: BOARD_FIRMWARE_DIR
# (board/<b>/rootfs/firmware, filtered to BOARD_FIRMWARE_FILES) and
# BOARD_HWINIT_DIR (os/boards/<b>/hwinit).
#
# ═══ WHAT M5c DID TO THIS FILE ═══
#
# Gave it the name and number PLAN-014 M5's vocabulary reserves for it, moved
# it BEHIND the five 30-feature-* stages, and touched none of the four RUNs.
# M5d changed the two COPYs above, the two scripts that read them, and nothing
# else: the four RUNs, their order and their arguments are still
# 30-40-unsplit's.
#
# ═══ WHY THE BOARD WORK IS AFTER THE FEATURES, WHICH WAS A RE-DECISION ═══
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
# os/rootfs/README.md: M5c came in at SIX differing entries of 9,241, which is
# the control's own set, and M5d re-ran it against that six.
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
# Gated on the BOOTLOADER, not on the architecture and not on the board name:
# an arm64 UEFI board would need this and does not exist yet, and keying it to
# amd64 would make that board's first symptom the message above rather than a
# build error. It stays in 40-board rather than moving to 32-feature-rauc for
# the same reason: the gate is a BOARD fact, and this is an apt transaction
# whose position decides the order of the logs the pack stage keeps.
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
# That is the same reasoning the two staged board directories below run on.
ARG MOS_ARCH=arm64
COPY os/rootfs/initramfs/ /tmp/initramfs/
ARG MODULES_TAR
COPY ${MODULES_TAR} /tmp/modules.tar
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/kernel-and-initramfs.sh

# Radio firmware: the runtime set THIS BOARD declares, and nothing whatever for
# a board that declares none.
#
# WHAT IT IS on the board that has a radio: the AIC8800D80 combo (single SKU;
# the bcmdhd/AP6275S fallback was dropped when the fleet was confirmed AIC-only
# and the kernel stopped building bcmdhd). Driver loading is the mos-modules
# unit's job, not this one's.
#
# WHICH FILES IS THE BOARD'S DECISION AND NOT THIS FILE'S, which is the whole
# of what M5d changed here. board/<b>/rootfs/firmware is the vendor BSP drop:
# 33 files, most of them for other AIC parts (8800dc, 8800dw) and other silicon
# revisions. Only the confirmed U02 runtime set may enter a signed root, and
# that set is BOARD_FIRMWARE_FILES in os/boards/<b>/board.env -- where it
# already was. os/verify-image-v2.sh has asserted the image against exactly
# that key since the x64 board arrived, so this reads the list the verifier
# reads rather than a second copy of it, and build-v2.sh stages precisely those
# files into BOARD_FIRMWARE_DIR.
#
# AN EMPTY DIRECTORY IS HOW A BOARD SAYS "NO RADIO", and the script then
# installs nothing AND CREATES NOTHING: no /usr/lib/firmware is made to stand
# empty where firmware would be. 2 MB of firmware for hardware that is not
# there would be a file an operator reading the image cannot account for, and
# an empty directory is a smaller version of the same question.
#
# THE LIST IS PASSED AS WELL AS STAGED, and that is a positive control rather
# than a duplicate: the script asserts that every path the board declared is on
# the root when it is done. What it replaces is `test -f
# /usr/lib/firmware/fmacfw_8800d80_u02.bin` -- the same assertion with one
# board's answer written into a file both boards run.
ARG BOARD_FIRMWARE_DIR
ARG BOARD_FIRMWARE_FILES=""
COPY ${BOARD_FIRMWARE_DIR}/ /tmp/fw/
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/firmware-install.sh

# Board hardware init: best-effort oneshots from the board's own hwinit
# directory, plus the per-board facts they read, staged into /etc/mos.
#
# THE MECHANISM IS BOARD-AGNOSTIC -- nothing below names a board -- and as of
# M5d the CONTENT is not filed under one either. The units used to be COPYd
# from os/boards/cx3576/hwinit on every board, because cx3576 was the only
# board that declared a fact for them to read; x64 carried all six scripts and
# ran none. Now os/boards/<board>/hwinit is staged into BOARD_HWINIT_DIR the
# way board/<board>/init has always been staged into BOARD_INIT_DIR, and a
# board with no hwinit directory stages an empty one.
#
# BOTH DIRECTORIES MAY BE EMPTY, and on x64 both are. Every unit is
# condition-gated on its conf file, so enabling them is safe either way -- but
# "never runs" is a property of a file being absent, not of a gate being right.
# Dead code in a signed read-only root is not free: x64 is a QEMU machine with
# no Bluetooth and it was carrying hwinit-bt, whose `rfkill unblock` put a
# dependency on a binary that board has no reason to install, and the image
# verifier reported exactly that.
#
# THE INSTALL LIST IS ENUMERATED from the board facts actually staged, never
# restated here. A hardcoded list is what let this file drift behind the (since
# deleted) v1 Dockerfile once already: mos-mac and mos-gadget were installed
# but silently left disabled, costing the image its stable MAC and its USB
# debug console with no error anywhere. Adding hwinit-<n> plus mos-<n>.service
# under os/boards/<board>/hwinit, and an <n>.conf to the board, is enough.
#
# THE FAILURE THE STAGED SHAPE ADDS IS ALREADY CAUGHT, and that was checked
# rather than assumed. An hwinit directory that went missing stages an EMPTY
# one -- and a board that declares any fact at all then hits the first
# assertion in the loop below ("a board fact that no hwinit script reads"), by
# name. What stays uncovered is the older half: a board that declares
# BOARD_HWINIT_CONFS and whose board/<board>/init went missing stages no conf,
# installs no unit, and the two counts agree at zero. That predates M5d --
# BOARD_INIT_DIR was already a staged directory -- and os/verify-image-v2.sh
# holds it at image level (:2680, declared facts against installed helpers).
# Reported, not fixed here: a build-time copy of the verifier's equality is the
# second table this tree keeps deleting.
#
# NO BOARD FACT APPEARS IN THIS STAGE. Module names, sysfs paths, UART device,
# CAN bitrate, MAC seed and gadget IDs all live in BOARD_INIT_DIR and are read
# from /etc/mos at runtime by the units. MOS_BOARD reaches the script for its
# DIAGNOSTICS only -- so that a missing hwinit-<n> is reported as the path a
# reader should create, under the board that asked for it.
ARG MOS_BOARD
ARG BOARD_HWINIT_DIR
ARG BOARD_INIT_DIR
COPY ${BOARD_HWINIT_DIR}/ /tmp/hwinit/
COPY ${BOARD_INIT_DIR}/ /tmp/board-init/
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/hwinit-install.sh
