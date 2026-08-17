# syntax=docker/dockerfile:1
# =============================================================================
# os/rootfs — Debian systemd arm64 rootfs for cx3576 (PLAN-010 M1)
#
#   bash os/rootfs/build.sh
#   → _out/cx3576/rootfs.img         ext4 root (exactly 1024 MiB)
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
RUN apt-get update && apt-get install -y --no-install-recommends \
        systemd \
        systemd-sysv \
        systemd-resolved \
        udev \
        dbus \
        kmod \
        openssh-server \
        iproute2 \
    && rm -rf /var/lib/apt/lists/*

# Kernel modules. Debian is merged-usr (/lib -> usr/lib) and the tar's paths
# start with lib/, so it cannot be ADDed to / directly — extract to a temp dir
# and copy into /usr/lib/modules. dep files are inside the tar; no depmod needed.
ARG MODULES_TAR
COPY ${MODULES_TAR} /tmp/modules.tar
RUN mkdir -p /tmp/mods /usr/lib/modules && \
    tar -xf /tmp/modules.tar -C /tmp/mods && \
    cp -a /tmp/mods/lib/modules/. /usr/lib/modules/ && \
    rm -rf /tmp/mods /tmp/modules.tar

# WiFi firmware (AP6275S / AIC8800D80 dual SKU) + driver autoload
COPY board/cx3576/rootfs/firmware/ /usr/lib/firmware/
RUN ln -sf fw_bcm43752a2_ag.bin /usr/lib/firmware/fw_bcmdhd.bin && \
    ln -sf nvram_ap6275s.txt /usr/lib/firmware/nvram.txt && \
    ln -sf clm_bcm43752a2_ag.blob /usr/lib/firmware/clm_bcmdhd.blob && \
    printf '%s\n' 'bcmdhd' 'aic8800_fdrv' > /etc/modules-load.d/wifi.conf

# Networking: DHCP on all eth* (kernel cmdline has net.ifnames=0)
RUN printf '%s\n' \
        '[Match]' \
        'Name=eth*' \
        '' \
        '[Network]' \
        'DHCP=yes' \
        > /etc/systemd/network/80-dhcp.network && \
    { systemctl enable systemd-networkd systemd-resolved ssh || true; } && \
    mkdir -p /etc/systemd/system/multi-user.target.wants && \
    for u in systemd-networkd systemd-resolved ssh; do \
        [ -L "/etc/systemd/system/multi-user.target.wants/$u.service" ] || \
            ln -s "/lib/systemd/system/$u.service" \
                  "/etc/systemd/system/multi-user.target.wants/$u.service"; \
    done && \
    test -L /etc/systemd/system/multi-user.target.wants/systemd-networkd.service && \
    test -L /etc/systemd/system/multi-user.target.wants/systemd-resolved.service && \
    test -L /etc/systemd/system/multi-user.target.wants/ssh.service
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
# Pack: ext4 image, fixed 1024 MiB
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM debian:bookworm-slim AS pack
RUN apt-get update && apt-get install -y --no-install-recommends e2fsprogs \
    && rm -rf /var/lib/apt/lists/*
COPY --from=rootfs / /rootfs/
# ^orphan_file is mandatory — kernel 6.1 cannot mount orphan_file filesystems.
RUN mkdir -p /out && \
    mv /rootfs/rootfs-report.txt /out/rootfs-report.txt && \
    ln -sf ../run/systemd/resolve/stub-resolv.conf /rootfs/etc/resolv.conf && \
    echo 'mos' > /rootfs/etc/hostname && \
    echo '127.0.1.1 mos' >> /rootfs/etc/hosts && \
    : > /rootfs/etc/machine-id && \
    mke2fs -q -t ext4 -L rootfs -U 5ac35760-0002-4000-8000-000000000002 \
        -d /rootfs -O ^orphan_file,^metadata_csum_seed \
        -E root_owner=0:0 /out/rootfs.img 1024M

FROM scratch AS artifact
COPY --from=pack /out/rootfs.img /
COPY --from=pack /out/rootfs-report.txt /
