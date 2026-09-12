# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# check=skip=InvalidDefaultArgInFrom
# The system producer: the `mos-system` package.
#
#   bash build-env/deb/build.sh --producer system --arch all
#
# This file only STAGES and PACKS. Nothing is compiled here: the payload is the
# board-independent part of rootfs/overlay plus two files the stage chain
# generates, so the package carries what stages/10-base and stages/20-install
# write into the image today.
#
# No default for the base, for the reason build-env/deb/Dockerfile gives: a
# driver that failed to pass the argument would otherwise build from a floating
# tag.
ARG MOS_BUILD_DEB

FROM ${MOS_BUILD_DEB} AS pack

# pack.sh comes over as a named context rather than out of the image. It is the
# packaging CONTRACT, shared by every producer, and build-env/deb/README.md
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
# Provenance, written into the control file by pack.sh; see build-env/deb/README.md.
ARG MOS_DEB_SOURCE_REPO
ARG MOS_DEB_SOURCE_COMMIT

# Every path is named, and the modes are the ones rootfs/scripts/overlay-install.sh
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
#   /etc/fstab.in, /etc/repart.d and board boot.mount -> board packages,
#     rendered from the current three-partition board policy.
#   /usr/lib/mos/profile.conf -> mos-profile-dev / mos-profile-prod
#   the TLS trust bundle    -> `mos-ca-trust`
#   wpa_supplicant, hostapd and bluetooth units and mounts -> the radio packages
#   `rm -f /etc/ssh/ssh_host_*` -> a whole-image finalizer step, not a package
#
# The two generated files are written here rather than copied, byte for byte as
# the scripts that own them print them today: 80-dhcp.network is the five lines
# rootfs/scripts/network-and-ssh-units.sh writes, and 00-volatile.conf is
# the two rootfs/stages/10-base.Dockerfile writes. 80-dhcp.network must keep
# losing to anything mosd renders into /run/systemd/network, which is why the
# `80-` prefix sits between mosd's `50-` and the WiFi reconcilers' `90-`.
#
# ENABLEMENT IS PACKAGE-OWNED FILES: the wants-symlinks below are payload, in
# the exact set and with the exact targets overlay-install.sh and
# network-and-ssh-units.sh create. No preset, and no `systemctl enable` in a
# maintainer script.
#
# EVERY LINK `systemctl enable` WOULD WRITE, NOT ONLY THE PRIMARY ONE. A unit's
# [Install] section can carry `Alias=` and `Also=`, and each of those is another
# link in the root. systemd-networkd.service carries both -- `Alias=` one name
# and `Also=` three further units, each with a WantedBy of its own -- so the
# five links below are what enabling that one unit means. Missing the `Also=`
# for systemd-networkd-wait-online.service is not cosmetic: without its link in
# network-online.target.wants, network-online.target completes WITHOUT WAITING
# FOR A NETWORK and everything ordered after it starts early. The other unit
# with an `Alias=` is systemd-resolved.service; its own package's postinst
# enables it, so its alias and its sysinit link are already in the root and are
# not this package's to own.
#
# TWO TARGET PREFIXES, DELIBERATELY, and they are not interchangeable as
# DECLARATIONS even though merged-/usr resolves them to one file. Each link
# spells what the authority that creates it on the stage chain spells:
# `systemctl enable systemd-networkd` writes /usr/lib, and so does everything it
# pulls in through `Also=` and `Alias=`; systemd-resolved's multi-user link has
# no [Install] behind it at all -- it is the explicit `ln -s /lib/...` fallback
# in network-and-ssh-units.sh -- and so stays /lib, as does fstrim.timer, which
# overlay-install.sh writes the same way.
#
# nftables.service IS DISABLED BY A FILE TOO, 50-mos-nftables.preset, and for a
# reason that is not openssh's. Nothing enables it today, and that is an ABSENCE
# rather than a decision: no preset in this image matched the unit at all, and
# the unmatched fallback is ENABLE. Measured in a clean trixie root with the
# stock preset set, `systemctl preset nftables.service` CREATES
# sysinit.target.wants/nftables.service; with `disable nftables.service` in a
# preset file the same command writes nothing. What that would cost if it ever
# fired: the unit's ExecStart is `nft -f /etc/nftables.conf`, and the config
# nftables ships begins with `flush ruleset`, so an enabled unit clears
# netavark's container-network rules at every boot. mos-system declares nftables
# in Depends, so the unit is in every image now; a preset-all, a future preset
# file or an upstream packaging change that adds an enable line all lead there,
# and this file is what stops them.
#
# ssh.service IS DISABLED BY A FILE, 50-mos-ssh.preset, and not by leaving a
# link out. An absence cannot survive another package's postinst: openssh-server's
# writes multi-user.target.wants/ssh.service through deb-systemd-helper, and
# policy-rc.d stops a maintainer script STARTING a service without touching the
# symlink. A preset is the payload form of that decision -- it is a file this
# package owns, dpkg installs it, and nothing runs a command to arrange it.
#
# MEASURED, NOT ASSUMED, because the mechanism turns on an ordering nobody had
# checked. In a clean debian trixie root, a package that Depends on
# openssh-server and ships this preset gets NO multi-user.target.wants/ssh.service:
# deb-systemd-helper 1.69~deb13u1 reads /usr/lib/systemd/system-preset, and apt
# unpacks this package's data before it configures openssh-server. The postinst
# asserts that outcome; it does not produce it.
#
# THE ALIAS LINK IS PAYLOAD FOR THE SAME REASON. The preset suppresses every
# link openssh's [Install] implies, including its `Alias=sshd.service` --
# /etc/systemd/system/sshd.service -- which the stage chain's root HAS, because
# network-and-ssh-units.sh removes the multi-user link and nothing else. A path
# the chain produces and no package owns is the shape this packaging work exists
# to close, so this package owns it: same name, same target, now declared
# instead of left behind by another package's helper.
#
# There is likewise no local-fs.target.wants/etc-containers-systemd.mount, which
# overlay-install.sh spells out at length is left unlinked so that Quadlet
# cannot generate root-capable units from STATE with no operator decision.
#
# THE OFFLINE PROVISIONING TRANSPORT (PLAN-046 / RFCT-282) is
# mos-provisioning-import, its unit, and the multi-user wants-link below. It is
# mos-system payload and not mosd payload even though mosd is what reads what
# it stages: the script mounts GPT-labelled boot slots and removable block
# devices read-only, which is layout knowledge this package already owns
# (/etc/repart.d, the mount units), and an image built with WITH_MOSD=0 still
# wants the medium left alone rather than a dangling unit. The unit orders
# itself Before=mosd.service from its own [Unit] section, so nothing in mosd's
# package has to know it exists.
#
# The health service enablement is copied from the immutable overlay.
#
# /var/lib/mos is an empty directory and is load-bearing: it and
# var-lib-mos.mount are two halves of one mechanism, mosd.service declares
# `RequiresMountsFor=/var/lib/mos`, and pkgs/mosd/deb/README.md records that
# mosd names mos-system in Depends rather than shipping the directory itself.
# /root is 0700 root:root for the reason stages/20-install gives: a root home
# that reached the image group- or world-readable would be a different defect
# from the one root.mount fixes.
RUN set -eu; \
    R=/stage/mos-system; \
    for f in mos-boot-failure mos-data-layout mos-grow-data mos-health mos-provisioning-import mos-seed-home \
             mos-seed-root mos-seed-state mos-seed-var mos-shadow-reconcile; do \
        install -D -m 0755 "/in/overlay/usr/lib/mos/${f}" "${R}/usr/lib/mos/${f}"; \
    done; \
    for f in mos-health.service; do \
        install -D -m 0644 "/in/overlay/usr/lib/systemd/system/${f}" \
            "${R}/usr/lib/systemd/system/${f}"; \
    done; \
    for f in mos-load-extensions.service mos-boot-failure.service mos-apply-hostname.service mos-data-layout.service mos-provisioning-import.service \
             mos-seed-home.service mos-seed-root.service \
             mos-seed-state.service mos-seed-var.service mos-shadow-reconcile.service \
             mos.mount mos-containers.mount srv.mount var-lib-mos.mount var.mount \
             etc-hostname.mount etc-ssh.mount home.mount root.mount \
             usr-local-lib-systemd-system.mount; do \
        install -D -m 0644 "/in/overlay/etc/systemd/system/${f}" \
            "${R}/etc/systemd/system/${f}"; \
    done; \
    install -D -m 0644 /in/overlay/etc/tmpfiles.d/mos-var.conf \
        "${R}/etc/tmpfiles.d/mos-var.conf"; \
    for unit in systemd-random-seed.service timers.target systemd-logind.service \
                systemd-networkd-persistent-storage.service systemd-networkd.service \
                systemd-tmpfiles-setup.service systemd-timesyncd.service; do \
        install -D -m 0644 "/in/overlay/etc/systemd/system/${unit}.d/10-data.conf" \
            "${R}/etc/systemd/system/${unit}.d/10-data.conf"; \
    done; \
    install -d -m 0755 "${R}/etc/systemd/system.conf.d"; \
    printf '%s\n' '[Manager]' 'RuntimeWatchdogSec=90s' 'RebootWatchdogSec=120s' \
        >"${R}/etc/systemd/system.conf.d/10-data-quota.conf"; \
    for dir in service.d systemd-growfs@.service.d; do \
        cp -a "/in/overlay/etc/systemd/system/$dir" "${R}/etc/systemd/system/"; \
    done; \
    for unit in systemd-bless-boot.service quota.service quotacheck.service rpc-rquotad.service; do \
        ln -s /dev/null "${R}/etc/systemd/system/$unit"; \
    done; \
    install -D -m 0644 /in/overlay/etc/mos/health.conf "${R}/etc/mos/health.conf"; \
    install -D -m 0644 /in/overlay/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf \
        "${R}/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf"; \
    # The pinned time-sync base policy (PLAN-044). The daemon it configures is
    # in Depends, so the drop-in, the enablement link below and the unit they
    # govern arrive in one transaction or not at all.
    install -D -m 0644 /in/overlay/etc/systemd/timesyncd.conf.d/50-mos.conf \
        "${R}/etc/systemd/timesyncd.conf.d/50-mos.conf"; \
    install -d -m 0755 "${R}/etc/systemd/network"; \
    printf '%s\n' '[Match]' 'Name=eth*' '' '[Network]' 'DHCP=yes' \
        >"${R}/etc/systemd/network/80-dhcp.network"; \
    chmod 0644 "${R}/etc/systemd/network/80-dhcp.network"; \
    install -d -m 0755 "${R}/etc/systemd/journald.conf.d"; \
    printf '%s\n' '[Journal]' 'Storage=volatile' \
        >"${R}/etc/systemd/journald.conf.d/00-volatile.conf"; \
    chmod 0644 "${R}/etc/systemd/journald.conf.d/00-volatile.conf"; \
    # Explicit authenticated boot and board mounts own the current disk layout.
    # Disable generic GPT discovery so it cannot introduce writable mounts.
    install -d -m 0755 "${R}/etc/systemd/system-generators"; \
    ln -s /dev/null "${R}/etc/systemd/system-generators/systemd-gpt-auto-generator"; \
    ln -s /dev/null "${R}/etc/systemd/system-generators/systemd-ssh-generator"; \
    install -d -m 0755 "${R}/usr/lib/systemd/system-preset"; \
    printf '%s\n' 'disable ssh.service' \
        >"${R}/usr/lib/systemd/system-preset/50-mos-ssh.preset"; \
    chmod 0644 "${R}/usr/lib/systemd/system-preset/50-mos-ssh.preset"; \
    printf '%s\n' 'disable nftables.service' \
        >"${R}/usr/lib/systemd/system-preset/50-mos-nftables.preset"; \
    chmod 0644 "${R}/usr/lib/systemd/system-preset/50-mos-nftables.preset"; \
    install -d -m 0755 "${R}/srv" "${R}/mos" "${R}/mnt/data" "${R}/mnt/system" "${R}/home" \
        "${R}/usr/local/lib/systemd" "${R}/usr/local/lib/systemd/system" \
        "${R}/var/lib/mos" "${R}/usr/lib/modules" "${R}/usr/lib/firmware" \
        "${R}/etc/systemd/system/local-fs.target.wants" \
        "${R}/etc/systemd/system/timers.target.wants" \
        "${R}/etc/systemd/system/multi-user.target.wants" \
        "${R}/etc/systemd/system/sockets.target.wants" \
        "${R}/etc/systemd/system/network-online.target.wants" \
        "${R}/etc/systemd/system/sysinit.target.wants"; \
    install -d -m 0700 "${R}/root"; \
    for u in mos-data-layout.service mos.mount mos-containers.mount srv.mount mos-seed-state.service \
             mos-seed-home.service mos-seed-root.service var-lib-mos.mount \
             var.mount etc-ssh.mount etc-hostname.mount \
             home.mount root.mount usr-local-lib-systemd-system.mount \
             mos-apply-hostname.service; do \
        ln -s "/etc/systemd/system/${u}" \
            "${R}/etc/systemd/system/local-fs.target.wants/${u}"; \
    done; \
    for u in mos-load-extensions.service mos-shadow-reconcile.service mos-provisioning-import.service; do \
        ln -s "/etc/systemd/system/${u}" \
            "${R}/etc/systemd/system/multi-user.target.wants/${u}"; \
    done; \
    for u in mos-health.service; do \
        cp -a "/in/overlay/etc/systemd/system/multi-user.target.wants/${u}" \
            "${R}/etc/systemd/system/multi-user.target.wants/${u}"; \
    done; \
    ln -s /usr/lib/systemd/system/systemd-networkd.service \
        "${R}/etc/systemd/system/multi-user.target.wants/systemd-networkd.service"; \
    ln -s /lib/systemd/system/systemd-resolved.service \
        "${R}/etc/systemd/system/multi-user.target.wants/systemd-resolved.service"; \
    ln -s /usr/lib/systemd/system/systemd-networkd.service \
        "${R}/etc/systemd/system/dbus-org.freedesktop.network1.service"; \
    ln -s /usr/lib/systemd/system/systemd-networkd.socket \
        "${R}/etc/systemd/system/sockets.target.wants/systemd-networkd.socket"; \
    ln -s /usr/lib/systemd/system/systemd-networkd-wait-online.service \
        "${R}/etc/systemd/system/network-online.target.wants/systemd-networkd-wait-online.service"; \
    ln -s /usr/lib/systemd/system/systemd-network-generator.service \
        "${R}/etc/systemd/system/sysinit.target.wants/systemd-network-generator.service"; \
    # timesyncd's enablement, copied like the mos-health pair so the target is
    # the tree's: the overlay link spells /lib because that is what
    # deb-systemd-helper writes for a Debian-shipped unit, and its own postinst
    # would create this exact link -- shipping it as payload makes it declared
    # instead of a maintainer-script leftover.
    cp -a /in/overlay/etc/systemd/system/sysinit.target.wants/systemd-timesyncd.service \
        "${R}/etc/systemd/system/sysinit.target.wants/systemd-timesyncd.service"; \
    ln -s /usr/lib/systemd/system/ssh.service \
        "${R}/etc/systemd/system/sshd.service"; \
    ln -s /lib/systemd/system/fstrim.timer \
        "${R}/etc/systemd/system/timers.target.wants/fstrim.timer"; \
    install -D -m 0644 /in/copyright "${R}/usr/share/doc/mos-system/copyright"; \
    pack.sh --root "${R}" --control /in/control/mos-system.control \
        --maintainer-scripts /in/maintainer/mos-system \
        --version "${MOS_DEB_VERSION}" --arch "${MOS_DEB_ARCH}" --out /out

# The export stage, the shape pkgs/mosd/deb/mosd/Dockerfile ends in:
# `-o type=local` writes this stage's filesystem into _out/debs/<arch>/pool/
# and nothing here installs into a root.
FROM scratch AS out
COPY --from=pack /out/ /
