# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# =============================================================================
# stages/30-feature-radios — the radio userland, its unit masking, and its
# mount wiring: everything that is in the image because the BOARD DECLARES A
# RADIO, and nothing that is in it for any other reason.
#
# PLAN-014 M5 (RFCT-111 M5c), cut out of the temporary 30-40-unsplit. The three
# RUNs below were positions 1, 3 and 12 of that file: `radios-packages` and
# `radios-mask-units` ran before the board work and `radios-mounts` after it,
# with the container feature interleaved between them. A feature split across
# other stages cannot be one omittable stage, so they are contiguous here.
#
# WHY IT IS THE FIRST FEATURE STAGE AND NOT THE SECOND. `radios-packages` is
# the first `apt-get install` after stages/10-base's allowlist, and it was the
# first in 30-40-unsplit too. The order of the apt transactions decides the
# order entries land in dpkg's database and in the log files the pack stage
# carries into /usr/share/factory/var/log, so keeping radios ahead of
# containers is what makes this cut a re-grouping rather than a re-install.
#
# THE SWITCH IS BOARD_RADIOS, AND IT STAYS AN ARGUMENT. The other feature
# stages replaced a WITH_* boolean with the presence of a file; this one did
# not, and the difference is deliberate. BOARD_RADIOS is a LIST -- `wifi`,
# `bluetooth`, both -- read out of os/boards/<board>/board.env, so the stage
# has to read it even when it is present. Its empty value is a statement the
# three scripts each print ("this board declares none"), and on x64 that
# printed early exit is the only place on an amd64 host where any of this code
# runs at all. Dropping the stage on a board with no radio would delete that.
#
# The stage IS omittable -- `bash os/build/run.sh --build-rootfs --without
# radios` builds a chain without it -- and os/rootfs/build-v2.sh does not use
# that, on purpose, for the reason above.
# =============================================================================

# THE LINK BACK UP THE CHAIN. MOS_STAGE_PREV is the local image tag the
# previous stage was written to; the driver passes it and refuses to build a
# stage that does not declare it. There is no default, so this file cannot be
# built standalone against whatever `FROM` happened to be typed -- which is the
# whole safety of a chain built out of separate files.
ARG MOS_STAGE_PREV
FROM ${MOS_STAGE_PREV}

# The radio userland, only for boards that declare a radio.
#
# bluez 4823 KB + wpasupplicant 3902 KB + hostapd 2329 KB + rfkill 111 KB =
# 11.2 MB, and on a board with no radio every one of them is inert at best:
# bluetoothd starts, finds no adapter, and stays running; the WiFi reconcilers
# render configuration for interfaces that do not exist. Installed software
# that cannot work is not free -- it is attack surface, journal noise and
# 11 MB of a rootfs slot, and it makes "this board has no Bluetooth" a runtime
# discovery rather than a property of the image.
#
# BOARD_RADIOS comes from the layout: os/boards/<board>/board.env. Empty means the
# board declares none, which is a statement rather than an omission.
ARG BOARD_RADIOS=""
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/radios-packages.sh

# Both connd packages ship a NON-templated unit that their postinst ENABLES, and
# both are lifecycles mosd owns and must be the only one driving. Measured on
# hostapd/wpasupplicant 2:2.10-12+deb12u3 arm64, not assumed:
#
#   hostapd.service         [Install] WantedBy=multi-user.target, linked into
#                           /etc/systemd/system/multi-user.target.wants by the
#                           postinst. It runs a SECOND hostapd on the same radio
#                           from /etc/hostapd/hostapd.conf — a file mosd never
#                           writes. Today it is condition-gated on that file
#                           being non-empty, so it does not actually start; that
#                           is one operator `cp` away from a second daemon
#                           fighting the reconciler for the radio while
#                           hostapd@wlan0.service still reports healthy.
#   wpa_supplicant.service  D-Bus mode, no condition at all, so it DOES start.
#                           It carries RuntimeDirectory=wpa_supplicant, which
#                           means systemd DELETES /run/wpa_supplicant when it
#                           stops — taking the control socket of the templated
#                           instance mosd started with it.
#
# So both are masked rather than merely disabled: masking also blocks the D-Bus
# activation path (wpasupplicant ships
# /usr/share/dbus-1/system-services/fi.w1.wpa_supplicant1.service), which a
# plain `systemctl disable` would leave open. The Alias= link the postinst
# creates for that name is masked too, since it names the same unit by another
# name. On v2 these mask symlinks are inside the signed, read-only root, so they
# cannot be removed on a running device.
#
# The TEMPLATES are left installed and NOT enabled: mosd enables and starts
# exactly the instance the settings tree asks for. Their ExecStart paths are
# asserted against the reconcilers' own constants by os/verify-image-v2.sh.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/radios-mask-units.sh

# The RADIO mount points, for boards that have radios.
#
# var-lib-bluetooth.mount, etc-wpa_supplicant.mount and etc-hostapd.mount are
# the writable configuration directories for bluez, wpa_supplicant and hostapd.
# They live in os/boards/cx3576/overlay/ with the rest of that board's radio
# facts, so on a board with none they are simply not there -- and the chmod and
# the local-fs.target.wants loop in stages/20-install's overlay-install.sh used
# to name them unconditionally, which is what failed the first x64 build after
#
# the move: `chmod: cannot access`.
#
# AFTER stages/20-install, never before it. Placed before, this loop looked
# for the units under /etc/systemd/system while they were still sitting in
# /tmp/overlay, and reported "declared but not in the overlay" for a board
# whose overlay had all three. x64 could not catch that: it declares no radio,
# so it takes the early exit and never reaches the test at all. A board with
# the feature is the only one that runs this code.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/radios-mounts.sh
