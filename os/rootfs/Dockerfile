# syntax=docker/dockerfile:1
# =============================================================================
# os/rootfs — Debian systemd arm64 rootfs for cx3576 (PLAN-010 M1)
#
#   bash os/rootfs/build.sh
#   → _out/cx3576/rootfs.img         ext4 root (minimal, content-derived size)
#   → _out/cx3576/rootfs-report.txt  package list + installed size
#
# Build context = repo root. Depends on board/cx3576/out/kernel/modules.tar,
# staged into the context by build.sh (path passed via ARG MODULES_TAR).
# Executes arm64 binaries: on x86 hosts install emulation once with
#   docker run --privileged --rm tonistiigi/binfmt --install arm64
# =============================================================================

# ---------------------------------------------------------------------------
# Root filesystem: Debian bookworm + systemd
# ---------------------------------------------------------------------------
FROM --platform=linux/arm64 debian:bookworm-slim AS rootfs

# Strict package allowlist — add nothing here without documenting it in README.md
#
# wpasupplicant and hostapd are the connd userland: mosd's WiFi reconcilers
# render configuration for them and drive their unit TEMPLATES. Neither daemon
# is started by the image. dnsmasq is deliberately absent — the provisioning
# AP's DHCP server is systemd-networkd's built-in DHCPServer=yes, which needs
# no extra package and no second lifecycle.
RUN apt-get update && apt-get install -y --no-install-recommends \
        systemd \
        systemd-sysv \
        systemd-resolved \
        udev \
        dbus \
        kmod \
        openssh-server \
        iproute2 \
        bluez \
        rfkill \
        wpasupplicant \
        hostapd \
    && rm -rf /var/lib/apt/lists/*

# Both packages ship a NON-templated unit that their postinst ENABLES, and both
# are lifecycles mosd owns and must be the only one driving. Measured on
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
# name.
#
# The TEMPLATES are left installed and NOT enabled: mosd enables and starts
# exactly the instance the settings tree asks for.
RUN set -eu; \
    mkdir -p /etc/systemd/system; \
    for u in hostapd.service wpa_supplicant.service \
             dbus-fi.w1.wpa_supplicant1.service; do \
        rm -f "/etc/systemd/system/${u}"; \
        ln -s /dev/null "/etc/systemd/system/${u}"; \
        [ "$(readlink "/etc/systemd/system/${u}")" = /dev/null ]; \
    done; \
    rm -f /etc/systemd/system/multi-user.target.wants/hostapd.service \
          /etc/systemd/system/multi-user.target.wants/wpa_supplicant.service; \
    for u in hostapd@.service wpa_supplicant@.service; do \
        test -f "/usr/lib/systemd/system/${u}"; \
        if find /etc/systemd/system /usr/lib/systemd/system -path '*.wants/*' \
                -name "${u}" | grep -q .; then \
            echo "error: ${u} is statically enabled; mosd owns that lifecycle" >&2; exit 1; \
        fi; \
    done; \
    echo "connd: hostapd.service and wpa_supplicant.service masked, templates present and unenabled"

# The two directories the WiFi reconcilers render into. Both end up holding a
# pre-shared key in the clear, so 0700 rather than the packages' 0755.
# v1's root is a writable ext4, so nothing further is needed here; v2 binds
# these paths onto STATE (etc-wpa_supplicant.mount / etc-hostapd.mount) because
# its root is a read-only verity squashfs.
RUN mkdir -p /etc/wpa_supplicant /etc/hostapd && \
    chmod 0700 /etc/wpa_supplicant /etc/hostapd

# Image profile. mosd reads this file ONCE, on first boot, to seed
# `access.ssh.enabled`, and it FAILS CLOSED: missing, unreadable or carrying a
# value this build does not know all resolve to `prod`, which means SSH off.
# The match is case-SENSITIVE, so `DEV` is not `dev`.
#
# That failure mode is silent by construction — a misspelt key or a missing file
# yields an image where every check is green and the dev SSH path has simply
# disappeared — so the value is validated here and asserted again by
# os/verify-image.sh against the packed artifact.
#
# /usr/lib and not /etc: it describes the IMAGE, not the device.
ARG MOS_PROFILE=dev
RUN set -eu; \
    case "${MOS_PROFILE}" in \
    dev | prod) ;; \
    *) echo "error: MOS_PROFILE is '${MOS_PROFILE}'; it must be exactly 'dev' or 'prod' in lowercase. mosd's comparison is case-sensitive and every other value resolves to prod, which silently disables SSH" >&2; exit 1 ;; \
    esac; \
    mkdir -p /usr/lib/mos; \
    printf 'MOS_PROFILE=%s\n' "${MOS_PROFILE}" > /usr/lib/mos/profile.conf; \
    chmod 0444 /usr/lib/mos/profile.conf; \
    echo "profile: MOS_PROFILE=${MOS_PROFILE}"

# Kernel modules. Debian is merged-usr (/lib -> usr/lib) and the tar's paths
# start with lib/, so it cannot be ADDed to / directly — extract to a temp dir
# and copy into /usr/lib/modules. dep files are inside the tar; no depmod needed.
ARG MODULES_TAR
COPY ${MODULES_TAR} /tmp/modules.tar
RUN mkdir -p /tmp/mods /usr/lib/modules && \
    tar -xf /tmp/modules.tar -C /tmp/mods && \
    cp -a /tmp/mods/lib/modules/. /usr/lib/modules/ && \
    rm -rf /tmp/mods /tmp/modules.tar

# WiFi/BT firmware: AIC8800D80 combo (single SKU; the bcmdhd/AP6275S fallback
# was dropped when the fleet was confirmed AIC-only and the kernel stopped
# building bcmdhd). Only the confirmed U02 runtime set enters the image, per
# the board BSP. Driver loading is done by the mos-modules unit.
COPY board/cx3576/rootfs/firmware/aic_userconfig_8800d80.txt \
     board/cx3576/rootfs/firmware/fw_adid_8800d80_u02.bin \
     board/cx3576/rootfs/firmware/fw_patch_8800d80_u02.bin \
     board/cx3576/rootfs/firmware/fw_patch_table_8800d80_u02.bin \
     board/cx3576/rootfs/firmware/fmacfw_8800d80_u02.bin \
     /usr/lib/firmware/

# Networking: DHCP on all eth* (kernel cmdline has net.ifnames=0)
#
# 80-dhcp.network is the image's own default and must keep LOSING to anything
# mosd renders. mosd's network reconciler writes 50-mos-<iface>.network and the
# two WiFi reconcilers write 90-wifi-client-<iface>.network and
# 90-wifi-ap-<iface>.network into /run/systemd/network; networkd applies the
# first match in lexical order across both directories, so 80- sits between
# them deliberately. os/verify-image.sh asserts that ordering, and asserts that
# no file the IMAGE ships could ever be mistaken for a reconciler-owned one.
#
# ssh.service enablement follows MOS_PROFILE. A prod image must not come up
# with sshd running before mosd has read the profile and decided: mosd seeds
# `access.ssh.enabled` false on prod and its reconciler would then stop a
# service that had already been listening since early boot. dev keeps it
# enabled, which is the whole point of the dev profile.
RUN printf '%s\n' \
        '[Match]' \
        'Name=eth*' \
        '' \
        '[Network]' \
        'DHCP=yes' \
        > /etc/systemd/network/80-dhcp.network && \
    { systemctl enable systemd-networkd systemd-resolved || true; } && \
    mkdir -p /etc/systemd/system/multi-user.target.wants && \
    for u in systemd-networkd systemd-resolved; do \
        [ -L "/etc/systemd/system/multi-user.target.wants/$u.service" ] || \
            ln -s "/lib/systemd/system/$u.service" \
                  "/etc/systemd/system/multi-user.target.wants/$u.service"; \
    done && \
    test -L /etc/systemd/system/multi-user.target.wants/systemd-networkd.service && \
    test -L /etc/systemd/system/multi-user.target.wants/systemd-resolved.service && \
    if [ "${MOS_PROFILE}" = "dev" ]; then \
        { systemctl enable ssh || true; }; \
        ln -sf /lib/systemd/system/ssh.service \
               /etc/systemd/system/multi-user.target.wants/ssh.service; \
        test -L /etc/systemd/system/multi-user.target.wants/ssh.service; \
        echo "profile dev: ssh.service enabled in the image"; \
    else \
        rm -f /etc/systemd/system/multi-user.target.wants/ssh.service; \
        test ! -e /etc/systemd/system/multi-user.target.wants/ssh.service; \
        echo "profile prod: ssh.service left DISABLED in the image"; \
    fi
# /etc/resolv.conf cannot be replaced here (bind-mounted by buildkit during RUN);
# the stub-resolv.conf symlink is created in the pack stage instead.

# First-boot disk growth: systemd-repart grows partition 2 to fill the media
# and relocates the backup GPT. The service is statically enabled in bookworm
# (sysinit.target.wants) and condition-gated on /etc/repart.d being non-empty —
# no systemctl enable needed. x-systemd.growfs makes the fstab-generator emit
# an online ext4 grow unit (systemd-growfs). Both are idempotent and boot-safe.
RUN mkdir -p /etc/repart.d && \
    printf '%s\n' '[Partition]' 'Type=linux-generic' \
        > /etc/repart.d/50-rootfs.conf && \
    printf '%s\n' 'PARTLABEL=rootfs / ext4 defaults,x-systemd.growfs 0 0' \
        > /etc/fstab

# mosd management daemon: binary + systemd unit (enabled) + D-Bus system policy.
# build.sh always stages MOSD_DIR (empty when WITH_MOSD=0), so the COPY works
# on both paths and the RUN installs only when the binary was staged.
ARG MOSD_DIR
ARG WITH_MOSD=1
COPY ${MOSD_DIR}/ /tmp/mosd/
RUN if [ "$WITH_MOSD" = "1" ] && [ -f /tmp/mosd/mosd ]; then \
        install -m 0755 /tmp/mosd/mosd /usr/bin/mosd && \
        install -m 0644 /tmp/mosd/mosd.service /usr/lib/systemd/system/mosd.service && \
        install -m 0644 /tmp/mosd/com.mos.mosd.conf /usr/share/dbus-1/system.d/com.mos.mosd.conf && \
        mkdir -p /var/lib/mos /etc/systemd/system/multi-user.target.wants && \
        ln -sf /usr/lib/systemd/system/mosd.service \
               /etc/systemd/system/multi-user.target.wants/mosd.service && \
        test -L /etc/systemd/system/multi-user.target.wants/mosd.service; \
    fi && \
    if [ "$WITH_MOSD" = "1" ] && [ -f /tmp/mosd/webd ]; then \
        install -m 0755 /tmp/mosd/webd /usr/bin/webd && \
        install -m 0644 /tmp/mosd/webd.service /usr/lib/systemd/system/webd.service && \
        mkdir -p /etc/systemd/system/multi-user.target.wants && \
        ln -sf /usr/lib/systemd/system/webd.service \
               /etc/systemd/system/multi-user.target.wants/webd.service && \
        test -L /etc/systemd/system/multi-user.target.wants/webd.service; \
    fi && rm -rf /tmp/mosd

# Board hardware init: generic best-effort oneshots (os/hwinit, board-agnostic
# mechanism) + per-board facts staged from BOARD_DIR/init into /etc/mos.
# BOARD_INIT_DIR may be an empty dir (boards without hw-init facts): every unit
# is condition-gated on its conf file, so enabling them is safe either way.
ARG BOARD_INIT_DIR
COPY os/hwinit/ /tmp/hwinit/
COPY ${BOARD_INIT_DIR}/ /tmp/board-init/
RUN mkdir -p /etc/mos /usr/lib/mos /etc/systemd/system/multi-user.target.wants \
        /usr/lib/udev/rules.d && \
    cp -a /tmp/board-init/. /etc/mos/ && \
    install -m 0755 /tmp/hwinit/hwinit-* /usr/lib/mos/ && \
    install -m 0644 /tmp/hwinit/*.service /usr/lib/systemd/system/ && \
    install -m 0644 /tmp/hwinit/*.rules /usr/lib/udev/rules.d/ && \
    for u in mos-modules mos-otg mos-can mos-bt mos-mac mos-gadget; do \
        ln -sf "/usr/lib/systemd/system/$u.service" \
               "/etc/systemd/system/multi-user.target.wants/$u.service" && \
        test -L "/etc/systemd/system/multi-user.target.wants/$u.service"; \
    done && \
    rm -rf /tmp/hwinit /tmp/board-init

# journald in RAM only for M1 (no persistent /var/log/journal)
RUN mkdir -p /etc/systemd/journald.conf.d && \
    printf '%s\n' '[Journal]' 'Storage=volatile' \
        > /etc/systemd/journald.conf.d/00-volatile.conf

# Identity files (/etc/hostname, /etc/hosts, /etc/machine-id) are written in the
# pack stage: buildkit bind-mounts them during RUN, so writes here would be lost.

# Serial console getty: intentionally none — systemd's getty-generator spawns
# serial-getty@ttyFIQ0 automatically from the kernel console= parameter.

# DEV profile only — never set ROOT_PASSWORD for production images.
# Default (empty): root stays locked and PermitRootLogin is untouched.
ARG ROOT_PASSWORD=""
RUN if [ -n "$ROOT_PASSWORD" ]; then \
        echo "root:${ROOT_PASSWORD}" | chpasswd && \
        mkdir -p /etc/ssh/sshd_config.d && \
        printf 'PermitRootLogin yes\n' > /etc/ssh/sshd_config.d/10-dev.conf; \
    fi

# Build report (moved out of the tree by the pack stage; never ships in the image)
RUN { dpkg-query -W -f='${Package}\t${Installed-Size}\n'; \
      echo; \
      echo "TOTAL_MB $(du -sxm --exclude=/proc --exclude=/sys --exclude=/dev / 2>/dev/null | cut -f1)"; \
    } > /rootfs-report.txt

# ---------------------------------------------------------------------------
# Pack: ext4 image, minimal content-derived size
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM debian:bookworm-slim AS pack
RUN apt-get update && apt-get install -y --no-install-recommends e2fsprogs \
    && rm -rf /var/lib/apt/lists/*
COPY --from=rootfs / /rootfs/
# ^orphan_file is mandatory — kernel 6.1 cannot mount orphan_file filesystems.
# Size is derived from content only (no clock, no randomness):
#   size_mib = ceil(du_mib * 115 / 100) + 48
# The 48 MiB fixed margin covers ext4 metadata plus early-boot writes BEFORE
# systemd-repart/growfs expand p2 (journal replay, first-boot machine-id and
# /var dirs, ssh host key generation). -b 4096 pins the block size: below
# 512 MiB mke2fs's "small" profile would silently switch to 1 KiB blocks.
# Guard the mos-owned files against CJK text (repo rule: code and docs are
# English). Only our own paths are scanned; vendor packages ship translations
# and are none of our business.
RUN set -e; \
    mos_paths=""; \
    for f in /rootfs/usr/lib/mos /rootfs/etc/mos \
             /rootfs/usr/lib/udev/rules.d/60-mos-*.rules \
             /rootfs/usr/lib/systemd/system/mos-*.service \
             /rootfs/usr/lib/systemd/system/mosd.service \
             /rootfs/usr/lib/systemd/system/webd.service \
             /rootfs/usr/share/dbus-1/system.d/com.mos.mosd.conf \
             /rootfs/etc/systemd/network/*.network; do \
        if [ -e "$f" ]; then mos_paths="$mos_paths $f"; fi; \
    done; \
    test -n "$mos_paths"; \
    hits=$(grep -rlP '[\x{3400}-\x{4dbf}\x{4e00}-\x{9fff}\x{f900}-\x{faff}]' \
        $mos_paths 2>/dev/null || true); \
    if [ -n "$hits" ]; then \
        echo 'CJK text found in mos-owned image files:' >&2; \
        echo "$hits" >&2; \
        exit 1; \
    fi

RUN mkdir -p /out && \
    mv /rootfs/rootfs-report.txt /out/rootfs-report.txt && \
    ln -sf ../run/systemd/resolve/stub-resolv.conf /rootfs/etc/resolv.conf && \
    echo 'mos' > /rootfs/etc/hostname && \
    echo '127.0.1.1 mos' >> /rootfs/etc/hosts && \
    : > /rootfs/etc/machine-id && \
    du_mib=$(du -sxm /rootfs | cut -f1) && \
    size_mib=$(( (du_mib * 115 + 99) / 100 + 48 )) && \
    echo "pack: content ${du_mib} MiB -> image ${size_mib} MiB" && \
    mke2fs -q -t ext4 -b 4096 -L rootfs -U 5ac35760-0002-4000-8000-000000000002 \
        -d /rootfs -O ^orphan_file,^metadata_csum_seed \
        -E root_owner=0:0 /out/rootfs.img "${size_mib}M"

FROM scratch AS artifact
COPY --from=pack /out/rootfs.img /
COPY --from=pack /out/rootfs-report.txt /
