# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# stages/33-feature-mosd -- the management daemon and the HTTP API beside it:
# mosd, apid, the MQTT bridge, the MQTT broker, their units and their two D-Bus
# policies.
#
# THIS STAGE IS THE SWITCH. A build that does not want mosd does not build this
# file, and rootfs-stages.txt records which stages ran -- so "this image has no
# mosd" is written down at the time rather than inferred from an absence
# afterwards. mosd-install.sh therefore names every file it expects and FAILS
# on the first one that is not there: reaching this stage already means mosd
# was asked for, and a silent skip here would produce an image that builds
# green, boots, and has no management daemon.
#
# The caller-facing spelling: `WITH_MOSD=0 bash os/rootfs/build-v2.sh` works,
# and build-v2.sh turns it into `--without mosd`.
#
# THE TWO MQTT SERVICE ACCOUNTS ARE NOT HERE. They are stages/34-feature-mqtt,
# which runs immediately after this one, and that order matters: the units
# installed here name User=mos-mqttd, and an account created before its unit
# would be an account nothing yet refers to.

# THE LINK BACK UP THE CHAIN. MOS_STAGE_PREV is the local image tag the
# previous stage was written to; the driver passes it and refuses to build a
# stage that does not declare it. There is no default, so this file cannot be
# built standalone against whatever `FROM` happened to be typed -- which is the
# whole safety of a chain built out of separate files.
ARG MOS_STAGE_PREV
FROM ${MOS_STAGE_PREV}

# mosd management daemon: binary + systemd unit (enabled) + D-Bus system policy.
# MOSD_DIR is staged by build-v2.sh and every file in it is REQUIRED: this
# stage is only in the chain when mosd was asked for. /var/lib/mos is the bind
# target of var-lib-mos.mount.
#
# THE TWO MQTT UNITS ARE INSTALLED AND LEFT DISABLED. mqtt.enabled seeds false
# for every profile, so an image that shipped the bridge enabled would run it
# from early boot until mosd's first reconcile stopped it -- and against a
# broker the same switch has not started, which is exactly the retry noise this
# arrangement exists to prevent. Turning MQTT on is a runtime decision made against the
# settings tree, never a property of the image. mosd owns the lifecycle of both
# units, and each absent symlink is ASSERTED below rather than left to happen.
#
# The broker ships NO D-Bus policy file, and that absence is deliberate rather
# than an omission: it never speaks D-Bus. It reads one file mosd renders into
# /run and listens on a TCP socket. The bridge is the half of this pair that
# talks to com.mos.mosd, and mos-mqttd.conf is its grant.
ARG MOSD_DIR
COPY ${MOSD_DIR}/ /tmp/mosd/
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/mosd-install.sh
