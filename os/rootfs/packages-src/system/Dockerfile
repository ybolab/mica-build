# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# The system producer: the `mos-system` package.
#
#   bash os/build-env/deb/build.sh --producer system --arch all
#
# This file only STAGES and PACKS. Nothing is compiled here: the payload is the
# board-independent part of os/rootfs/overlay-v2 plus two files the stage chain
# generates, so the package carries what stages/10-base and stages/20-install
# write into the image today.
#
# No default for the base, for the reason os/build-env/deb/Dockerfile gives: a
# driver that failed to pass the argument would otherwise build from a floating
# tag.
ARG MOS_BUILD_DEB

FROM ${MOS_BUILD_DEB} AS pack

# pack.sh comes over as a named context rather than out of the image. It is the
# packaging CONTRACT, shared by every producer, and os/build-env/deb/README.md
# requires this shape: an edit to the packer then takes effect without
# rebuilding the whole builder family.
COPY --from=packer pack.sh /usr/local/bin/pack.sh

COPY --from=family copyright /in/copyright
COPY control/ /in/control/
COPY maintainer/ /in/maintainer/

# The overlay tree, whole, from the `overlay` context producer.env declares.
# The RUN below installs from it path by path and is the ONLY statement of what
# this package claims -- copying the tree in does not put a file in the
# payload. That matters because the tree holds files this package deliberately
# does not own; see the exclusion note on the staging step.
COPY --from=overlay . /in/overlay/

ARG MOS_DEB_VERSION
ARG MOS_DEB_ARCH
ARG SOURCE_DATE_EPOCH

# Every path is named, and the modes are the ones os/rootfs/scripts/overlay-install.sh
# ends up with: its explicit `chmod` where it makes one, the file's committed
# mode otherwise. An `cp -a` of the whole tree would be shorter and would claim
# paths this package must not own.
#
# WHAT IS DELIBERATELY LEFT OUT OF A TREE THAT IS OTHERWISE COPIED WHOLESALE:
#
#   /etc/containers/** and /etc/systemd/system/etc-containers-systemd.mount
#     -> `mos-podman`. Files AND directories: dpkg would let two packages share
#        the bare /etc/containers/systemd directory, but mos-podman owns every
#        file beneath it, so leaving the whole subtree to it leaves nothing for
#        integration to reconcile. The package gate's unique-ownership check
#        reads one pool at a time, and these two packages do not share a pool
#        until the workstreams merge -- a duplicate claim would stay invisible
#        until then, which is the most expensive place to find it.
#   /etc/fstab.in, /etc/fw_env.config.in, /etc/repart.d/{10-uenv-a,20-uenv-b}.conf,
#   /etc/systemd/system/boot.mount
#     -> the board packages. Each is rendered from os/boards/<b>/board.env and
#        cannot be board-independent; the two uenv definitions are cx3576's and
#        the .in templates are not even valid files until rendered.
#   /etc/rauc/**            -> `mos-rauc` and the board packages
#   /usr/lib/mos/profile.conf -> mos-profile-dev / mos-profile-prod
#   the TLS trust bundle    -> `mos-ca-trust`
#   wpa_supplicant, hostapd and bluetooth units and mounts -> the radio packages
#   `rm -f /etc/ssh/ssh_host_*` -> a whole-image finalizer step, not a package
#
# The two generated files are written here rather than copied, byte for byte as
# the scripts that own them print them today: 80-dhcp.network is the five lines
# os/rootfs/scripts/network-and-ssh-units.sh writes, and 00-volatile.conf is
# the two os/rootfs/stages/10-base.Dockerfile writes. 80-dhcp.network must keep
# losing to anything mosd renders into /run/systemd/network, which is why the
# `80-` prefix sits between mosd's `50-` and the WiFi reconcilers' `90-`.
#
# ENABLEMENT IS PACKAGE-OWNED FILES: the wants-symlinks below are payload, in
# the exact set and with the exact targets overlay-install.sh and
# network-and-ssh-units.sh create. No preset, and no `systemctl enable` in a
# maintainer script. There is deliberately NO multi-user.target.wants/ssh.service
# -- mosd owns that lifecycle and the image leaves sshd disabled on both
# profiles -- and no local-fs.target.wants/etc-containers-systemd.mount, which
# overlay-install.sh spells out at length is left unlinked so that Quadlet
# cannot generate root-capable units from STATE with no operator decision.
#
# mos-health.service and mos-machine-id.service are enabled by symlinks that
# ship as symlinks INSIDE overlay-v2, pointing into /usr/lib/systemd/system
# where those two units live; they are copied with `cp -a` so their targets are
# the tree's and not this file's guess at them.
#
# /var/lib/mos is an empty directory and is load-bearing: it and
# var-lib-mos.mount are two halves of one mechanism, mosd.service declares
# `RequiresMountsFor=/var/lib/mos`, and os/pkgs/mosd/deb/README.md records that
# mosd names mos-system in Depends rather than shipping the directory itself.
# /root is 0700 root:root for the reason stages/20-install gives: a root home
# that reached the image group- or world-readable would be a different defect
# from the one root.mount fixes.
RUN set -eu; \
    R=/stage/mos-system; \
    for f in mos-health mos-machine-id mos-seed-home mos-seed-root mos-seed-state \
             mos-seed-var mos-shadow-reconcile; do \
        install -D -m 0755 "/in/overlay/usr/lib/mos/${f}" "${R}/usr/lib/mos/${f}"; \
    done; \
    for f in mos-health.service mos-machine-id.service; do \
        install -D -m 0644 "/in/overlay/usr/lib/systemd/system/${f}" \
            "${R}/usr/lib/systemd/system/${f}"; \
    done; \
    for f in mos-apply-hostname.service mos-seed-home.service mos-seed-root.service \
             mos-seed-state.service mos-seed-var.service mos-shadow-reconcile.service \
             var-lib-mos.mount etc-hostname.mount etc-ssh.mount home.mount root.mount \
             usr-local-lib-systemd-system.mount; do \
        install -D -m 0644 "/in/overlay/etc/systemd/system/${f}" \
            "${R}/etc/systemd/system/${f}"; \
    done; \
    for f in 30-rootfs-a.conf 40-rootfs-b.conf 50-meta.conf 60-state.conf \
             70-ephemeral.conf 80-data.conf; do \
        install -D -m 0644 "/in/overlay/etc/repart.d/${f}" "${R}/etc/repart.d/${f}"; \
    done; \
    install -D -m 0644 /in/overlay/etc/tmpfiles.d/mos-var.conf \
        "${R}/etc/tmpfiles.d/mos-var.conf"; \
    install -D -m 0644 /in/overlay/etc/mos/health.conf "${R}/etc/mos/health.conf"; \
    install -D -m 0644 /in/overlay/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf \
        "${R}/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf"; \
    install -d -m 0755 "${R}/etc/systemd/network"; \
    printf '%s\n' '[Match]' 'Name=eth*' '' '[Network]' 'DHCP=yes' \
        >"${R}/etc/systemd/network/80-dhcp.network"; \
    chmod 0644 "${R}/etc/systemd/network/80-dhcp.network"; \
    install -d -m 0755 "${R}/etc/systemd/journald.conf.d"; \
    printf '%s\n' '[Journal]' 'Storage=volatile' \
        >"${R}/etc/systemd/journald.conf.d/00-volatile.conf"; \
    chmod 0644 "${R}/etc/systemd/journald.conf.d/00-volatile.conf"; \
    install -d -m 0755 "${R}/srv" "${R}/mnt/state" "${R}/mnt/meta" "${R}/home" \
        "${R}/usr/local/lib/systemd" "${R}/usr/local/lib/systemd/system" \
        "${R}/var/lib/mos" \
        "${R}/etc/systemd/system/local-fs.target.wants" \
        "${R}/etc/systemd/system/timers.target.wants" \
        "${R}/etc/systemd/system/multi-user.target.wants"; \
    install -d -m 0700 "${R}/root"; \
    for u in mos-seed-var.service mos-seed-state.service mos-seed-home.service \
             mos-seed-root.service var-lib-mos.mount etc-ssh.mount etc-hostname.mount \
             home.mount root.mount usr-local-lib-systemd-system.mount \
             mos-apply-hostname.service; do \
        ln -s "/etc/systemd/system/${u}" \
            "${R}/etc/systemd/system/local-fs.target.wants/${u}"; \
    done; \
    ln -s /etc/systemd/system/mos-shadow-reconcile.service \
        "${R}/etc/systemd/system/multi-user.target.wants/mos-shadow-reconcile.service"; \
    for u in mos-health.service mos-machine-id.service; do \
        cp -a "/in/overlay/etc/systemd/system/multi-user.target.wants/${u}" \
            "${R}/etc/systemd/system/multi-user.target.wants/${u}"; \
    done; \
    for u in systemd-networkd.service systemd-resolved.service; do \
        ln -s "/lib/systemd/system/${u}" \
            "${R}/etc/systemd/system/multi-user.target.wants/${u}"; \
    done; \
    ln -s /lib/systemd/system/fstrim.timer \
        "${R}/etc/systemd/system/timers.target.wants/fstrim.timer"; \
    install -D -m 0644 /in/copyright "${R}/usr/share/doc/mos-system/copyright"; \
    pack.sh --root "${R}" --control /in/control/mos-system.control \
        --maintainer-scripts /in/maintainer/mos-system \
        --version "${MOS_DEB_VERSION}" --arch "${MOS_DEB_ARCH}" --out /out

# The export stage, the shape os/pkgs/mosd/deb/mosd/Dockerfile ends in:
# `-o type=local` writes this stage's filesystem into _out/debs/<arch>/pool/
# and nothing here installs into a root.
FROM scratch AS out
COPY --from=pack /out/ /
