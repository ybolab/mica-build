# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# stages/40-board -- everything the image carries because of which board it is:
# the bootloader's environment editor, the kernel and its initramfs, the radio
# firmware, and the hardware-init oneshots. Four RUNs, behind every feature
# stage.

# No board is named in this file. A board's content reaches a shared
# instruction as a directory whose contents the board chose, because a COPY
# cannot be gated on an ARG; an empty directory is how a board says "none of
# that here". os/rootfs/build-v2.sh stages all four (MODULES_TAR,
# BOARD_FIRMWARE_DIR, BOARD_HWINIT_DIR and BOARD_INIT_DIR) beside each other,
# from the board's own definition.

# What the board decides is read from os/boards/<board>/board.env, where the
# layout, the architecture, the bootloader and the radio list already live:
#   BOARD_FIRMWARE_FILES   which firmware the image carries (empty = none)
#   MOS_ARCH               which kernel and initramfs route it takes
#   RAUC_BOOTLOADER        whether grub-editenv is needed at all
# plus two directories os/rootfs/build-v2.sh stages from the board's own trees,
# either of which may legitimately be empty: BOARD_FIRMWARE_DIR
# (os/boards/<b>/bsp/rootfs/firmware, filtered to BOARD_FIRMWARE_FILES) and
# BOARD_HWINIT_DIR (os/boards/<b>/hwinit).

# The board work runs after the features because the stage numbers have to read
# in the order they run, and 30-feature-* before 40-board is the vocabulary
# this tree fixed. It is safe in the direction that matters: nothing in these
# four RUNs reads anything a feature stage writes. The kernel and initramfs
# work reads /usr/lib/modules and the initramfs hooks; the firmware install
# moves files into /usr/lib/firmware; grub-editenv names its own libdevmapper
# dependency rather than depending on the cryptsetup-bin that arrives later;
# hwinit reads the staged board facts. In the other direction, the two feature
# RUNs that read the overlay get it from stages/20-install, which runs before
# any feature stage.

# The order of the apt transactions is part of the contract -- radios,
# containers, grub-editenv, kernel -- because it decides the order of entries in
# the package-manager logs, which stages/90-pack captures out of the tree to
# _out/<board>/pkg-logs/ rather than shipping. The gate is the content diff in
# os/rootfs/README.md, and it is run by hand: nothing in this repository
# compares two builds automatically.

# The link back up the chain. MOS_STAGE_PREV is the local image tag the
# previous stage was written to; the driver passes it and refuses to build a
# stage that does not declare it. There is no default, so this file cannot be
# built standalone against whatever `FROM` happened to be typed -- which is the
# whole safety of a chain built out of separate files.
ARG MOS_STAGE_PREV
FROM ${MOS_STAGE_PREV}

# grub-editenv, for the boards RAUC drives through the grub backend. RAUC's
# grub backend does not write grubenv itself -- it execs grub-editenv, the way
# the uboot backend execs fw_setenv. Without it rauc.service starts and then
# cannot answer anything:
#   Failed getting primary slot: grub backend: Failed to start grub-editenv:
#   Failed to execute child process "grub-editenv" (No such file or directory)
# which is a device with an A/B layout, a boot order in grubenv, and no way to
# read or write it.

# The file, not the package. `grub-common` is a 20 MB installed increment here
# -- it drags in libfreetype6, libpng16, libfuse3, libefivar and gettext-base,
# none of which a device that only rewrites a grubenv has any use for. The
# binary itself is 403 KB and links only against libraries this root already
# carries. apt-get download + dpkg-deb extracts exactly one path and installs
# nothing, so no dependency resolution happens and nothing has to be purged
# again afterwards.

# Gated on the bootloader, not on the architecture and not on the board name:
# an arm64 UEFI board would need this and does not exist yet, and keying it to
# amd64 would make that board's first symptom the message above rather than a
# build error. It stays in 40-board rather than moving to 32-feature-rauc for
# the same reason -- the gate is a board fact -- and this is an apt transaction
# whose position decides the order of the logs the pack stage keeps.
ARG RAUC_BOOTLOADER=uboot
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/grub-editenv-install.sh

# Kernel modules. Debian is merged-usr (/lib -> usr/lib) and the tar's paths
# start with lib/, so it cannot be ADDed to / directly -- extract to a temp dir
# and copy into /usr/lib/modules. dep files are inside the tar; no depmod needed.
#
# On amd64 there is no vendor tree and no modules.tar: the QEMU image the
# apid-api harness boots takes Debian's own linux-image-amd64, which brings
# its kernel, its initramfs and its modules in one package. build-v2.sh stages
# an empty-but-valid tar on that path rather than making this COPY conditional
# -- a COPY cannot be gated, and a missing context file is a build error a
# hundred lines from its cause.
ARG MOS_ARCH=arm64
COPY os/rootfs/initramfs/ /tmp/initramfs/
ARG MODULES_TAR
COPY ${MODULES_TAR} /tmp/modules.tar
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/kernel-and-initramfs.sh

# Radio firmware: the runtime set this board declares, and nothing whatever
# for a board that declares none. On the board that has a radio it is the
# AIC8800D80 combo (single SKU); driver loading is the mos-modules unit's job,
# not this one's.

# Which files is the board's decision, not this file's.
# os/boards/<b>/bsp/rootfs/firmware is the vendor BSP drop: 32 files, most of them for
# other AIC parts (8800dc, 8800dw) and other silicon revisions. Only the
# confirmed U02 runtime set may enter a signed root, and that set is
# BOARD_FIRMWARE_FILES in os/boards/<b>/board.env. os/verify asserts the image
# against exactly that key, so this reads the list the verifier reads rather
# than a second copy of it, and build-v2.sh stages precisely those files into
# BOARD_FIRMWARE_DIR.

# An empty directory is how a board says "no radio", and the script then
# installs nothing and creates nothing: no /usr/lib/firmware is made to stand
# empty where firmware would be. 2 MB of firmware for hardware that is not
# there would be a file an operator reading the image cannot account for, and
# an empty directory is a smaller version of the same question. The list is
# passed as well as staged, which is a positive control rather than a
# duplicate: the script asserts that every path the board declared is on the
# root when it is done.
ARG BOARD_FIRMWARE_DIR
ARG BOARD_FIRMWARE_FILES=""
COPY ${BOARD_FIRMWARE_DIR}/ /tmp/fw/
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/firmware-install.sh

# Board hardware init: best-effort oneshots from the board's own hwinit
# directory, plus the per-board facts they read, staged into /etc/mos. The
# mechanism is board-agnostic -- nothing below names a board, and neither does
# the content. os/boards/<board>/hwinit is staged into BOARD_HWINIT_DIR the way
# os/boards/<board>/bsp/init is staged into BOARD_INIT_DIR, and a board with no hwinit
# directory stages an empty one.

# Both directories may be empty, and on x64 both are. Every unit is
# condition-gated on its conf file, so enabling them is safe either way -- but
# "never runs" is a property of a file being absent, not of a gate being right.
# Dead code in a signed read-only root is not free: x64 is a QEMU machine with
# no Bluetooth, and an hwinit-bt on it would put a `rfkill unblock` dependency
# on a binary that board has no reason to install, which the image verifier
# reports.

# The install list is enumerated from the board facts actually staged, never
# restated here. A hardcoded list drifts: mos-mac and mos-gadget installed but
# silently left disabled costs the image its stable MAC and its USB debug
# console with no error anywhere. Adding hwinit-<n> plus mos-<n>.service under
# os/boards/<board>/hwinit, and an <n>.conf to the board, is enough.

# An hwinit directory that went missing stages an empty one, and a board that
# declares any fact at all then hits the first assertion in the loop below ("a
# board fact that no hwinit script reads"), by name. The other half -- a board
# that declares BOARD_HWINIT_CONFS and whose os/boards/<board>/bsp/init went missing --
# stages no conf, installs no unit, and the two counts agree at zero; os/verify
# holds that at image level, comparing declared facts against installed
# helpers. A build-time copy of the verifier's equality would be the second
# table this tree keeps deleting.

# No board fact appears in this stage. Module names, sysfs paths, UART device,
# CAN bitrate, MAC seed and gadget IDs all live in BOARD_INIT_DIR and are read
# from /etc/mos at runtime by the units. MOS_BOARD reaches the script for its
# diagnostics only -- so that a missing hwinit-<n> is reported as the path a
# reader should create, under the board that asked for it.
ARG MOS_BOARD
ARG BOARD_HWINIT_DIR
ARG BOARD_INIT_DIR
COPY ${BOARD_HWINIT_DIR}/ /tmp/hwinit/
COPY ${BOARD_INIT_DIR}/ /tmp/board-init/
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/hwinit-install.sh
