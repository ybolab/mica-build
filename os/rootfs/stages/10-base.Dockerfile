# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# stages/10-base -- the system-essential floor.
#
# The first link of the chain, and the only one that names a base image of its
# own; every stage after it starts FROM the tag this one is written to. What
# the chain is, how it is sequenced and why the numbers are what they are is in
# stages/README.md, which is the file to read before this one.

# What is here: the package allowlist, the TLS trust anchors, the image
# profile, the operator account and journald's storage policy -- the things
# every mos image has whatever board it is for and whatever features it
# declares. A stage that can be omitted does not belong here; that is
# 30-feature-*.

# Root filesystem: Debian trixie + systemd.
# $TARGETPLATFORM, not a pinned linux/arm64. A pin overrides whatever
# --platform the caller passed, so an amd64 build would silently produce an
# arm64 root and fail at first exec. build-v2.sh passes the platform it means.

# The TLS trust anchors, built here and COPIED, so the packed root gets the
# certificates without the tool that generates them.
#
# `ca-certificates` Depends on `openssl`, and openssl is 2506 KB of CLI the
# device has no use for: apid's TLS is pure Rust (rustls + rcgen + ring,
# reqwest on rustls-tls), and no /usr/lib/mos script invokes openssl.
# Installing the package into the rootfs stage would drag it in -- and with it
# /usr/bin/c_rehash, a Perl script the package-manager purge's
# dangling-interpreter check rejects.
#
# BUILDPLATFORM, not TARGETPLATFORM: ca-certificates is `Architecture: all`.
# The bundle is data, identical for arm64 and amd64, so generating it under
# emulation would buy nothing and cost the emulation.

# The base image of this stage, injected from os/build-env/images.env by
# os/build-env/from.sh, which the stage driver calls. A bare tag like
# `debian:trixie-slim` is one upstream repoints whenever it rebuilds, so the
# answer to "which Debian is in this device image" would be the date of the
# build and nothing in the tree.

# One key per stage file, not one for the chain. Trixie is declared here
# because this file's two FROMs consume it; bookworm is declared in
# stages/90-pack for the same reason and is not declared here at all. A stage
# that does not name an image cannot be built against the wrong one.

# Not mos-build-*, and that is the distinction this stage turns on: the builder
# family is for stages that compile, while this one assembles a device root and
# its package set is the shipped system. Putting a builder image under it would
# install git, binutils, xz, gcc and ccache into the thing that boots.

# No default: without a value docker refuses before any stage runs; with one it
# would build green against an image nobody chose. Build through
# `make os-rootfs-<board>-v2`.
ARG MOS_IMAGE_DEBIAN_TRIXIE

FROM --platform=$BUILDPLATFORM ${MOS_IMAGE_DEBIAN_TRIXIE} AS certs
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/ca-certificates-generate.sh

# The same key as the certs stage, and not re-declared. ARG is per-stage for
# everything a RUN reads -- stages/90-pack re-declares BOARD_RADIOS for exactly
# that reason -- but a FROM line resolves against the arguments declared before
# the first stage of its own file, which is the only scope a FROM can see. So
# one declaration up there serves both FROMs in this file and none of the RUNs.
FROM --platform=$TARGETPLATFORM ${MOS_IMAGE_DEBIAN_TRIXIE} AS rootfs

# Strict package allowlist -- add nothing here without documenting it in
# README.md. libubootenv-tool provides fw_printenv/fw_setenv for RAUC's U-Boot
# backend and the machine-id oneshot; curl is the health gate's apid probe, and
# without it that probe silently SKIPs and the gate covers two of three
# components while still reporting green.

# RAUC is not installed from Debian. It is built from upstream source by
# os/update/rauc/ and installed further down the chain by
# stages/32-feature-rauc, because Debian builds it with -Dstreaming=true and
# that links libcurl-gnutls: rauc would be the only consumer of libcurl-gnutls
# in the whole packed root, and it would bring GnuTLS, p11-kit, GMP, Nettle and
# the Kerberos libraries with it -- a second TLS stack, in an image whose own
# daemons use rustls on purpose, for a streaming install path
# os/update/rauc/manifest.raucm.in records as deferred. glib, json-glib and
# libfdisk are named explicitly below because nothing else pulls them in: they
# are what the self-built rauc links, and each is in the image for rauc alone.

# rauc-service is NOT optional and NOT implied. Debian splits the project in
# two and `rauc` neither Depends on nor Recommends `rauc-service` (rauc 1.8-2
# Depends is libc6, libcurl3-gnutls, libfdisk1, libglib2.0-0,
# libjson-glib-1.0-0, libssl3, dbus, systemd -- no Recommends at all). Debian's
# CLI is built with service support, so it does not operate locally: it proxies
# every call over D-Bus. With `rauc` alone there is no
# /usr/share/dbus-1/system.d/de.pengutronix.rauc.conf and no
# .../system-services/de.pengutronix.rauc.service, so `rauc status` fails with
# "The name de.pengutronix.rauc was not provided by any .service files", the
# health gate never marks the slot good, and every update rolls back.

# squashfs-tools and cryptsetup-bin are deliberately absent from the running
# system: packing the root is a build-stage job, and on cx3576 the kernel opens
# the verity device from the cmdline without any userspace tool. That second
# clause is true of cx3576 and false of x64, which is the sharpest difference
# between the two boards. Debian's generic amd64 kernel has CONFIG_DM_INIT
# unset -- it is absent from /boot/config entirely -- so `dm-mod.create=` is a
# parameter it does not implement, and an unknown dm-mod parameter is ignored
# rather than rejected: the boot would simply wait forever for a /dev/dm-0
# nothing creates. x64 therefore assembles the device with veritysetup from an
# initramfs script, and cryptsetup-bin is installed on that path only long
# enough for the initramfs hook to copy the binary in, then purged from the
# root.

# wpasupplicant and hostapd are the connd userland. mosd's WiFi reconcilers
# render configuration for them and drive their unit templates
# (wpa_supplicant@<iface>.service, hostapd@<iface>.service); the image starts
# neither. dnsmasq is deliberately absent -- the provisioning AP's DHCP server
# is systemd-networkd's built-in DHCPServer=yes, so there is no second package
# and no second lifecycle.
RUN apt-get update && apt-get install -y --no-install-recommends \
        systemd \
        systemd-sysv \
        systemd-resolved \
        systemd-repart \
        udev \
        dbus \
        kmod \
        openssh-server \
        iproute2 \
        libubootenv-tool \
        curl \
        libglib2.0-0t64 \
        libjson-glib-1.0-0 \
        libfdisk1 \
    && rm -rf /var/lib/apt/lists/*

# systemd-repart is a SEPARATE PACKAGE on trixie and was inside `systemd` on
# bookworm. Without the package the unit is simply absent, the
# sysinit.target.wants symlink with it, and DATA never grows past the 64 MiB
# the image assembler creates -- a failure that announces nothing: the device
# boots, and the partition is just small. It is named in the install list above
# rather than left to a recommends, and os/verify asserts the enablement
# symlink.

# The trust anchors, copied in from the `certs` stage. libssl3t64 is 8 MB of
# TLS library, and without a trust store the packed root has the code to speak
# TLS and nothing to decide who to believe. Every outbound HTTPS connection
# then fails the same way -- `podman pull` on the container engine, and `curl`,
# which the package list above installs and the package-manager purge
# explicitly keeps -- with
#   x509: certificate signed by unknown authority
# after everything on the device side has already worked.

# The whole Debian set, deliberately. A curated bundle holding only the roots
# this fleet talks to today would be a smaller trust surface and a worse
# failure mode: a root rotation at the other end is nobody's notification, the
# root here is read-only, and the symptom would be an outage that looks like a
# certificate error. Breadth is chosen over minimality so that reaching a
# registry or an update server does not depend on a list this image guessed.

# Both paths are needed. The bundle is what OpenSSL, GnuTLS and Go read by
# default; /usr/share/ca-certificates holds the individual certificates the
# hash symlinks under /etc/ssl/certs point at, so copying the directory
# without them would leave a farm of dangling links.
COPY --from=certs /usr/share/ca-certificates /usr/share/ca-certificates
COPY --from=certs /etc/ssl/certs /etc/ssl/certs
COPY --from=certs /etc/ca-certificates.conf /etc/ca-certificates.conf
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/ca-certificates-verify.sh

# Image profile. mosd reads this file ONCE, on first boot, to seed
# `access.ssh.enabled`, and it FAILS CLOSED: missing, unreadable or carrying a
# value this build does not know all resolve to `prod`, which means SSH off.
# The match is case-SENSITIVE, so `DEV` is not `dev`.
#
# That failure mode is silent by construction -- a misspelt key or a missing
# file yields an image where every check is green and the dev SSH path has
# simply disappeared -- so the value is validated here and asserted again by
# os/verify against the packed artifact.
#
# /usr/lib and not /etc: it describes the IMAGE, not the device, and on v2 /usr
# is inside the read-only verity root, so a production device cannot be edited
# into a development one.
ARG MOS_PROFILE=dev
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/profile-write.sh


# sshd host keys are NOT baked in. The openssh-server postinst generates a set
# at build time; on a signed, byte-identical rootfs that would be a host key
# shared by every device, and a random keygen would make the verity root hash
# differ on every cold build. mos-seed-state generates them per device into
# STATE instead (see overlay-v2/usr/lib/mos/mos-seed-state).
RUN rm -f /etc/ssh/ssh_host_*

# journald in RAM only. /var is writable, so a persistent journal is possible,
# but enabling it is a separate decision (flash wear, log retention policy).
RUN mkdir -p /etc/systemd/journald.conf.d && \
    printf '%s\n' '[Journal]' 'Storage=volatile' \
        > /etc/systemd/journald.conf.d/00-volatile.conf

# Identity files (/etc/hostname, /etc/hosts, /etc/machine-id) are written in
# stages/90-pack: buildkit bind-mounts them during RUN, so writes here would be
# lost.

# Serial console getty: intentionally none -- systemd's getty-generator spawns
# serial-getty@ttyFIQ0 automatically from the kernel console= parameter.

# The `mos` operator account. A persistent /home with no owner serves nothing,
# so the account and the home directory arrive together.

# uid and gid are pinned to 1000 explicitly rather than left to useradd's
# allocator. The home directory outlives the rootfs that created it: it sits on
# the DATA partition and survives every A/B update, so its owner is part of the
# on-disk contract, not a build-time allocation detail. If useradd chose the id
# and a later image resolved it differently, every file already in /home/mos
# would be owned by a uid that no longer exists -- and nothing would fail at
# build time, during the update, or on the next boot. That silence is why the
# number is written out here, in /usr/lib/mos/mos-seed-home, and in both
# verifiers.

# No sudo and no supplementary groups, deliberately. Not `adm`, not `shadow`,
# nothing reaching the settings tree. There is no privilege policy to express
# -- the web UI is the admin surface -- and a guessed policy would outlive the
# release that guessed it. The assertion below keeps it true.

# `mos` is NOT a lesser privilege level. sshd is configured with
# AuthorizedKeysFile /etc/ssh/authorized_keys.d/%u over the single key list
# mosd renders for root and for mos alike, so every authorised key is a root
# key. The account buys a persistent working directory and a non-root default
# shell; it does not buy a weaker grant. Do not hand out a key here expecting
# to have handed out an unprivileged shell.

# `chage -d` pins the shadow last-change field. useradd stamps today into it,
# which would make the packed rootfs -- and therefore its dm-verity root hash
# -- differ on every build day for no content reason at all. The pinned value
# is the same 2020-01-01 the layout's FILE_MTIME uses (day 18262), which is
# what keeps the build deterministic.

# --no-create-home: /home is the mountpoint of home.mount and must be empty in
# the packed root, which is a read-only verity squashfs. The real directory is
# created on DATA by mos-seed-home, with these same two numbers.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/account-mos.sh

# There is deliberately NO ROOT_PASSWORD build arg. A v2 rootfs is a signed
# squashfs, byte-identical on every device, so any usable hash baked into it is
# a fleet-wide shared secret -- and stages/90-pack's
# pack-assert-shadow-chain.sh fails the build on exactly that, for every
# account and with no profile exception. Plumbing an arg into an unbuildable
# state would only invite someone to "fix" the assertion. Dev root access is
# the transient password instead (mosd's SetTransientRootPassword, cleared on
# the next boot by mos-shadow-reconcile) plus the serial console, whose root
# stays locked until that password is set. See docs/design/access.md section
# 4.1.