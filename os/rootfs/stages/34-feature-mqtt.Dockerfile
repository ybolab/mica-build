# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# stages/34-feature-mqtt -- the two MQTT service accounts, mos-mqttd (970) and
# mos-mqtt-broker (969).

# The accounts are a stage and the binaries are not. The binaries are installed
# by stages/33-feature-mosd, because they come out of the same cargo build as
# mosd and arrive in the same staged directory. The identities are separate
# because they are the half of the MQTT feature that is not a file copy: each
# is a pinned uid/gid, a `chage -d` that keeps the shadow last-change field off
# the build date, and a collision check against the base image. This is the
# part of the feature a board can decline without declining mosd.

# Omitting this stage leaves the image carrying /usr/bin/mos-mqttd and
# mos-mqttd.service, the unit still saying User=mos-mqttd, and /etc/passwd with
# no such account -- so systemd refuses to start the unit and dbus-daemon drops
# the mos-mqttd.conf policy rule. Both failures are at boot, on the device.
# os/verify reports it as "mqttd: the unit runs as 'mos-mqttd' and no such
# account is in .../etc/passwd". build-v2.sh does NOT couple this to mosd:
# `--without mosd` and `--without mqtt` are separate decisions.

# The link back up the chain. MOS_STAGE_PREV is the local image tag the
# previous stage was written to; the driver passes it and refuses to build a
# stage that does not declare it. There is no default, so this file cannot be
# built standalone against whatever `FROM` happened to be typed -- which is the
# whole safety of a chain built out of separate files.
ARG MOS_STAGE_PREV
FROM ${MOS_STAGE_PREV}

# The mos-mqttd service account, static rather than DynamicUser.
# mos-mqttd.service ran under DynamicUser=yes until the bridge was wired into
# an image. The bridge needs an explicit, single-member identity grant on the
# root-only com.mos.mosd name plus exact grants supplied by applications, and
# <policy user="..."> resolves its user when
# dbus-daemon reads the file at startup -- before any dynamic user exists. The
# rule would load and match nothing, and the bridge would publish nothing with
# no error anywhere. The grant is mos-mqttd.conf; this account is the identity
# it names.

# uid and gid are pinned for the same reason the mos account's are, arrived at
# by a different route: the D-Bus policy names the account by name, and
# dbus-daemon resolves that name to a number at startup. An unpinned allocator
# would make the number a build-time detail, and a build that resolved it
# differently would leave the shipped policy granting a uid the unit does not
# run as -- a live rule matching nobody, which is the failure this whole
# arrangement exists to avoid.

# The number is 970 because 990 collided, and that collision is why the check
# below exists. 990 was free on bookworm and is taken by `sshd` on trixie, so
# the base-image upgrade failed here rather than silently producing an account
# at some other uid -- which would have left mos-mqttd.conf granting a uid the
# unit does not run as, and the bridge publishing nothing with no error at the
# point of cause. 970 is free on both, and sits well below the 999 that
# Debian's `useradd --system` allocates downward from, so it does not race the
# base image's own accounts as that allocation walks down.

# --system: no home, no login shell, no aging. `chage -d` pins the shadow
# last-change field for the same determinism reason as the mos account:
# useradd stamps today's date, which would change the packed rootfs -- and its
# dm-verity root hash -- on every build day for no content reason.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/account-mos-mqttd.sh

# The mos-mqtt-broker service account, static rather than DynamicUser, arrived
# at by a different route than mos-mqttd's. The broker reads
# /var/lib/mos/mqtt-broker-users.toml, a credentials file on STATE that
# outlives every start of the unit and survives an A/B update. A dynamic uid is
# allocated at start and gone at stop, so there is no identity to own that
# file: the ownership written on one boot names nobody on the next, and the
# only way to keep it readable would be to make the credentials
# world-readable.

# uid and gid are pinned, and NOT for the reason recorded above this. The
# broker has no D-Bus policy at all -- it never speaks D-Bus -- so there is no
# <policy user=> resolving a name to a number at dbus-daemon startup. They are
# pinned because that credentials file sits on persistent storage that outlives
# any single image: a uid that moved between builds would leave a file on STATE
# owned by a number the new image hands to somebody else, so the broker would
# lose its own credentials or another service would silently inherit them.

# The number is 969 because it is the next free number below the 970 mos-mqttd
# holds, and it is well below the 999 that Debian's `useradd --system`
# allocates downward from, so it does not race the base image's own accounts as
# that allocation walks down. The collision check below is the one the 970
# block carries, kept for the reason recorded there: 990 was free on bookworm
# and is taken by `sshd` on trixie, so a base-image upgrade must fail here
# rather than silently produce the account at some other uid.

# --system: no home, no login shell, no aging. `chage -d` pins the shadow
# last-change field for the same determinism reason as the accounts above:
# useradd stamps today's date, which would change the packed rootfs -- and its
# dm-verity root hash -- on every build day for no content reason.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/account-mos-mqtt-broker.sh
