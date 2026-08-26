# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# =============================================================================
# stages/34-feature-mqtt — the two MQTT service accounts, mos-mqttd (970) and
# mos-mqtt-broker (969).
#
# PLAN-014 M5 (RFCT-111 M5c), cut out of the temporary 30-40-unsplit
# (positions 15 and 16), unchanged and in that order.
#
# WHY THE ACCOUNTS ARE A STAGE AND THE BINARIES ARE NOT. The binaries are
# installed by stages/33-feature-mosd, because they come out of the same cargo
# build as mosd and arrive in the same staged directory. The IDENTITIES are
# separate because they are the half of the MQTT feature that is not a file
# copy: each is a pinned uid/gid, a `chage -d` that keeps the shadow
# LAST-CHANGE off the build date, and a collision check against the base image.
# RFCT-111 names mqtt as one of the four switchable features, and this is the
# part of it a board could decline without declining mosd.
#
# WHAT OMITTING THIS STAGE DOES, measured rather than predicted: the image
# still carries /usr/bin/mos-mqttd and mos-mqttd.service, the unit still says
# User=mos-mqttd, and /etc/passwd has no such account -- so systemd refuses to
# start the unit and dbus-daemon drops the mos-mqttd.conf policy rule. Both
# failures are at boot, on the device. os/verify-image-v2.sh reports it as
# "mqttd: the unit runs as 'mos-mqttd' and no such account is in
# .../etc/passwd", which is the negative test RFCT-111 asks for.
#
# BUILD-V2.SH DOES NOT COUPLE THIS TO mosd, and that is today's behaviour
# preserved rather than a decision: WITH_MOSD=0 built an image with no mosd and
# with both accounts. Now that they are a stage, dropping them with it is one
# more `--without mqtt` -- a content decision for whoever owns the board
# matrix, not something to fold into the cut.
# =============================================================================

# THE LINK BACK UP THE CHAIN. MOS_STAGE_PREV is the local image tag the
# previous stage was written to; the driver passes it and refuses to build a
# stage that does not declare it. There is no default, so this file cannot be
# built standalone against whatever `FROM` happened to be typed -- which is the
# whole safety of a chain built out of separate files.
ARG MOS_STAGE_PREV
FROM ${MOS_STAGE_PREV}

# The mos-mqttd service account.
#
# WHY A STATIC ACCOUNT AND NOT DynamicUser. mos-mqttd.service ran under
# DynamicUser=yes until the bridge was wired into an image. com.mos.mosd is a
# root-only bus name, so the bridge needs an explicit D-Bus grant, and
# <policy user="..."> resolves its user when dbus-daemon reads the file at
# startup -- before any dynamic user exists. The rule would load and match
# nothing, and the bridge would publish nothing with no error anywhere. The
# grant is mos-mqttd.conf; this account is the identity it names.
#
# uid AND gid are PINNED for the same reason the mos account's are, arrived at
# by a different route: the D-Bus policy names the account BY NAME, and
# dbus-daemon resolves that name to a number at startup. An unpinned allocator
# would make the number a build-time detail, and a build that resolved it
# differently would leave the shipped policy granting a uid the unit does not
# run as -- a live rule matching nobody, which is the failure this whole
# arrangement exists to avoid.
#
# THE NUMBER IS 970 BECAUSE 990 COLLIDED, and the collision is why the check
# below exists. 990 was free on bookworm and is taken by `sshd` on trixie, so
# the base-image upgrade failed here rather than silently producing an account
# at some other uid -- which would have left mos-mqttd.conf granting a uid the
# unit does not run as, and the bridge publishing nothing with no error at the
# point of cause. 970 is free on both, and sits well below the 999 that
# Debian's `useradd --system` allocates downward from, so it does not race the
# base image's own accounts as that allocation walks down.
#
# --system: no home, no login shell, no aging. `chage -d` pins the shadow
# LAST-CHANGE field for the same determinism reason as the mos account: useradd
# stamps today's date, which would change the packed rootfs -- and its
# dm-verity root hash -- on every build day for no content reason.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/account-mos-mqttd.sh

# The mos-mqtt-broker service account.
#
# WHY A STATIC ACCOUNT AND NOT DynamicUser, arrived at by a different route
# than mos-mqttd's. The broker reads /var/lib/mos/mqtt-broker-users.toml, a
# credentials file on STATE that outlives every start of the unit and survives
# an A/B update. A dynamic uid is allocated at start and gone at stop, so there
# is no identity to own that file: the ownership written on one boot names
# nobody on the next, and the only way to keep it readable would be to make the
# credentials world-readable.
#
# uid AND gid are PINNED, and NOT for the reason recorded above this. The broker
# has no D-Bus policy at all -- it never speaks D-Bus -- so there is no
# <policy user=> resolving a name to a number at dbus-daemon startup. They are
# pinned because that credentials file sits on persistent storage that outlives
# any single image: a uid that moved between builds would leave a file on STATE
# owned by a number the new image hands to somebody else, so the broker would
# lose its own credentials or another service would silently inherit them.
#
# THE NUMBER IS 969 because it is the next free number below the 970 mos-mqttd
# holds, and it is well below the 999 that Debian's `useradd --system` allocates
# downward from, so it does not race the base image's own accounts as that
# allocation walks down. The collision check below is the one the 970 block
# carries, kept for the reason recorded there: 990 was free on bookworm and is
# taken by `sshd` on trixie, so a base-image upgrade must fail HERE rather than
# silently produce the account at some other uid.
#
# --system: no home, no login shell, no aging. `chage -d` pins the shadow
# LAST-CHANGE field for the same determinism reason as the accounts above:
# useradd stamps today's date, which would change the packed rootfs -- and its
# dm-verity root hash -- on every build day for no content reason.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/account-mos-mqtt-broker.sh
