# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# =============================================================================
# stages/20-install — the read-only-root wiring: seed units, repart.d, network
#
# ONE LINK IN THE CHAIN; stages/README.md says what the chain is.
#
# WHAT IS HERE. The rendered overlay -- fstab, the repart.d set, the STATE and
# DATA bind mounts, the seed oneshots -- and the image's own network defaults.
# This is the arrangement that makes the root read-only, so it comes BEFORE
# every feature: a feature stage that adds a mount point or a unit is adding it
# to a root that is already wired, and 30-feature-*'s radio mounts and
# container configuration are both assertions ABOUT what this stage installed.
# =============================================================================

# THE LINK BACK UP THE CHAIN. MOS_STAGE_PREV is the local image tag the
# previous stage was written to; the driver passes it and refuses to build a
# stage that does not declare it. There is no default, so this file cannot be
# built standalone against whatever `FROM` happened to be typed -- which is the
# whole safety of a chain built out of separate files.
ARG MOS_STAGE_PREV
FROM ${MOS_STAGE_PREV}

# Networking: DHCP on all eth* (kernel cmdline has net.ifnames=0)
#
# 80-dhcp.network is the image's own default and must keep LOSING to anything
# mosd renders. mosd's network reconciler writes 50-mos-<iface>.network and the
# two WiFi reconcilers write 90-wifi-client-<iface>.network and
# 90-wifi-ap-<iface>.network into /run/systemd/network; networkd applies the
# first match in lexical order across both directories, so 80- sits between them
# deliberately. os/verify-image-v2.sh asserts that ordering, and asserts that no
# file the IMAGE ships could ever be mistaken for a reconciler-owned one — the
# network reconciler DELETES every *-mos-*.network it did not itself render.
#
# ssh.service is left DISABLED in the image, on BOTH profiles. mosd seeds
# `access.ssh.enabled` false for dev and prod alike (see
# Profile::ssh_enabled_default), so an image that shipped sshd enabled would be
# listening from early boot until mosd's first reconcile shut it down — exactly
# the window this design exists to close. Turning SSH on is a runtime decision
# made against the settings tree, never a property of the image.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/network-and-ssh-units.sh
# /etc/resolv.conf cannot be replaced here (bind-mounted by buildkit during
# RUN); the stub-resolv.conf symlink is created in stages/90-pack instead. It
# points into /run, so it stays writable with / read-only.

# Read-only root wiring: fstab (DATA /srv, STATE, META, EPHEMERAL /var, tmpfs
# /tmp), the repart.d set that grows DATA, the six STATE bind mounts
# (/var/lib/mos, /var/lib/bluetooth, /etc/ssh, /etc/hostname,
# /etc/wpa_supplicant, /etc/hostapd), the two DATA bind mounts (/home and
# /root, which are user data rather than configuration and so do not belong on
# the small, precious STATE partition -- see home.mount and root.mount), the
# seed oneshots (mos-seed-state converges on every boot; the others act on
# first boot), the /var fill-up policies and the fw_env.config pointing at
# the uenv pair.
# The tree is rendered from os/boards/cx3576/board.env by build-v2.sh; nothing
# here duplicates a layout constant. Modes are set explicitly so the packed
# image cannot inherit a host umask.
# /root gets its own mkdir/chown/chmod rather than joining the 0755 mountpoint
# list: Debian already ships it at 0700 root:root, but nothing GUARANTEED that,
# and a root home that reached the image group- or world-readable would be a
# different defect from the one root.mount fixes -- one that /srv, unlike the
# verity root, is not protected against either.
ARG OVERLAY_DIR
COPY ${OVERLAY_DIR}/ /tmp/overlay/
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/overlay-install.sh
