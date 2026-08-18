# syntax=docker/dockerfile:1
# =============================================================================
# rootfs/alpine — Alpine 3.24.1 writable host system
#
# Target experience: close to an ordinary KVM Alpine virtual machine:
#   - BusyBox init + OpenRC service management
#   - login prompts on ttyFIQ0/tty1 (no passwordless shell)
#   - OpenSSH, Docker/Compose, ifupdown-ng + per-interface dhcpcd invocation
#   - DHCP only configures address/routes; DNS is fixed to 1.1.1.1, 8.8.8.8
#
#   make rootfs
#   -> out/rootfs/rootfs.img (ext4, ready for assembly/dd)
#
# Default lab accounts: root / root, regular user alpine / alpine.
# Change the passwords immediately after first login.
# Depends on out/kernel/modules.tar (make rootfs builds kernel first).
# =============================================================================

# Pin the 3.24.1 multi-arch OCI manifest so alpine:3.24 cannot drift to a later
# maintenance release.
ARG ALPINE_IMAGE=alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b
FROM --platform=linux/arm64 ${ALPINE_IMAGE} AS rootfs

RUN apk add --no-cache \
        openrc busybox-openrc busybox-mdev-openrc \
        openssh \
        sudo \
        docker docker-cli-compose \
        ifupdown-ng dhcpcd iproute2 iptables nftables \
        ca-certificates tzdata chrony \
        wpa_supplicant iw \
        e2fsprogs-extra sgdisk parted cloud-utils-growpart \
        htop ethtool pciutils usbutils i2c-tools can-utils libdrm-tests && \
    echo 'root:root' | chpasswd && \
    adduser -D -s /bin/ash alpine && \
    echo 'alpine:alpine' | chpasswd && \
    adduser alpine wheel && \
    install -d -m 0750 /etc/sudoers.d && \
    printf '%s\n' '%wheel ALL=(ALL:ALL) ALL' > /etc/sudoers.d/wheel && \
    chmod 0440 /etc/sudoers.d/wheel && \
    visudo -cf /etc/sudoers && \
    echo 'rk3576-alpine' > /etc/hostname

# Kernel modules must come from the same build as out/kernel/Image.
ADD out/kernel/modules.tar /

# Wi-Fi/BT firmware: AIC8800D80 is the primary path on this board; the Broadcom
# blobs cover the other SKU.
COPY rootfs/firmware/ /lib/firmware/
RUN ln -sf fw_bcm43752a2_ag.bin /lib/firmware/fw_bcmdhd.bin && \
    ln -sf fw_bcm43752a2_ag_apsta.bin /lib/firmware/fw_bcmdhd_apsta.bin && \
    ln -sf nvram_ap6275s.txt /lib/firmware/nvram.txt && \
    ln -sf clm_bcm43752a2_ag.blob /lib/firmware/clm_bcmdhd.blob

COPY scripts/rs485-pair-test.sh /usr/local/sbin/rs485-pair-test
RUN chmod 0755 /usr/local/sbin/rs485-pair-test

# networking/ifupdown-ng is the sole interface controller; the DHCP stanza runs
# dhcpcd per interface, no global dhcpcd OpenRC service is started. ifupdown-ng
# automatically prefers the installed dhcpcd; background in /etc/dhcpcd.conf
# lets carrier-less interfaces wait in the background instead of blocking boot.
RUN mkdir -p /etc/network/interfaces.d && \
    cat > /etc/network/interfaces <<'INTERFACES'
# /etc/network/interfaces -- managed by ifupdown-ng/OpenRC networking
auto lo
iface lo inet loopback

# On-board GMAC0 + YT8531
auto eth0
iface eth0 inet dhcp

# PCIe RTL8168 second Ethernet port
auto eth1
iface eth1 inet dhcp

# The Wi-Fi service starts by default and stays idle until a network={} block is
# configured. Write credentials, then reload or reboot to connect.
auto wlan0
iface wlan0 inet dhcp

# Static address example (replace the matching DHCP stanza, then run
# ifdown eth0; ifup eth0):
# auto eth0
# iface eth0 inet static
#	address 192.168.1.100/24
#	gateway 192.168.1.1

source /etc/network/interfaces.d/*
INTERFACES

# ifupdown-ng auto-detects /sbin/dhcpcd and reads this shared config; the global
# dhcpcd service is not started. background returns immediately and watches
# carrier: no DHCP is sent without link; a lease is acquired once link returns.
RUN cat > /etc/dhcpcd.conf <<'DHCPCD'
background
hostname
clientid
vendorclassid
option static_routes, classless_static_routes
option interface_mtu
require dhcp_server_identifier
noipv4ll
noipv6
nohook resolv.conf, wpa_supplicant
DHCPCD

RUN cat > /etc/wpa_supplicant/wpa_supplicant.conf <<'WPA'
ctrl_interface=/run/wpa_supplicant
update_config=1
country=CN

# Wi-Fi demo (the whole block stays commented; no connection by default):
#   wpa_passphrase 'DemoWiFi' 'ChangeMe1234'
# generates:
# network={
#	ssid="DemoWiFi"
#	#psk="ChangeMe1234"
#	psk=2865d37bfe4035f2c5274b6831c4863ac29edbd3fcf554ea5b59483cd349960d
# }
#
# For real use, run wpa_passphrase and append the resulting network={} block to
# this file.
WPA

# wpa_supplicant starts by default and must wait for rk-board to load the
# wireless driver and create wlan0.
RUN printf '%s\n' 'rc_need="rk-board"' >> /etc/conf.d/wpa_supplicant

# OpenSSH provides the real host login experience. Host keys are generated on
# first boot by the Alpine sshd OpenRC service, so devices flashed from the same
# image do not share one host key set.
RUN sed -i \
        -e 's/^#\?PermitRootLogin .*/PermitRootLogin yes/' \
        -e 's/^#\?PasswordAuthentication .*/PasswordAuthentication yes/' \
        /etc/ssh/sshd_config && \
    printf '%s\n' \
        'AllowTcpForwarding yes' \
        'ClientAliveInterval 60' \
        'ClientAliveCountMax 3' \
        >> /etc/ssh/sshd_config

# Docker uses the writable p2 root partition; after first-boot expansion
# /var/lib/docker can use the whole eMMC.
RUN mkdir -p /etc/docker && cat > /etc/docker/daemon.json <<'DOCKER'
{
  "storage-driver": "overlay2",
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
DOCKER

# Early board init: OTG defaults to host; derive a stable locally-administered
# MAC for the EEPROM-less RTL8168; try loading the Wi-Fi drivers of both
# possible SKUs. networking waits for this service via rc_need.
RUN cat > /etc/init.d/rk-board <<'BOARD' && chmod 0755 /etc/init.d/rk-board
#!/sbin/openrc-run

description="CX3576-Z board initialization"

depend() {
	need localmount modules
	before networking
}

start() {
	ebegin "Initializing CX3576-Z board"

	local otg_mode_sys mode cid net_path iface driver mac
	otg_mode_sys=/sys/devices/platform/2602e000.syscon/2602e000.syscon:usb2-phy@0/otg_mode
	mode=$(cat /etc/usb-otg-mode 2>/dev/null || echo host)
	case "$mode" in
		host|peripheral) echo "$mode" > "$otg_mode_sys" 2>/dev/null || true ;;
		*) ewarn "Ignoring invalid /etc/usb-otg-mode: $mode" ;;
	esac

	cid=$(cat /sys/block/mmcblk0/device/cid 2>/dev/null || echo cx3576z)
	for net_path in /sys/class/net/eth*; do
		[ -e "$net_path" ] || continue
		iface=${net_path##*/}
		driver=$(basename "$(readlink "$net_path/device/driver" 2>/dev/null)" 2>/dev/null)
		[ "$driver" = r8168 ] || [ "$driver" = r8169 ] || continue
		mac=$(printf '%s-%s' "$cid" "$iface" | md5sum | awk \
			'{h=$1;printf "02:%s:%s:%s:%s:%s",substr(h,1,2),substr(h,3,2),substr(h,5,2),substr(h,7,2),substr(h,9,2)}')
		ip link set dev "$iface" down 2>/dev/null || true
		ip link set dev "$iface" address "$mac" 2>/dev/null || true
	done

	modprobe bcmdhd 2>/dev/null || true
	modprobe aic8800_fdrv 2>/dev/null || true
	eend 0
}
BOARD

RUN printf '%s\n' 'rc_need="rk-board"' > /etc/conf.d/networking

# After the whole-disk image is written to a larger eMMC, fix the backup GPT
# header and grow p2/ext4 online. Safely skipped in environments without
# mmcblk0p2, such as virtio/KVM.
RUN cat > /etc/init.d/resize-rootfs <<'RESIZE' && chmod 0755 /etc/init.d/resize-rootfs
#!/sbin/openrc-run

description="Expand the RK3576 root partition to fill eMMC"

depend() {
	need localmount
	before docker
}

start() {
	local disk_sectors part_start part_sectors remaining
	local fs_blocks fs_block_size fs_sectors slack

	[ -b /dev/mmcblk0 ] || return 0
	[ -b /dev/mmcblk0p2 ] || return 0
	[ ! -e /var/lib/rk3576/rootfs-expanded ] || return 0

	ebegin "Expanding rootfs partition"

	# After the whole-disk image lands on a larger eMMC, first move the backup
	# GPT to the real end of the disk.
	if ! sgdisk -e /dev/mmcblk0 >/dev/null 2>&1; then
		eend 1 "GPT relocation failed; it will be retried next boot"
		return 1
	fi

	# growpart can handle a mounted root partition and notifies the kernel via
	# partx --update. NOCHANGE may also mean the partition is already at its
	# maximum, so success is not judged by the exit code; the sysfs sizes below
	# are authoritative.
	growpart --update force /dev/mmcblk0 2 >/dev/null 2>&1 || true
	partprobe /dev/mmcblk0 >/dev/null 2>&1 || true

	disk_sectors=$(cat /sys/class/block/mmcblk0/size)
	part_start=$(cat /sys/class/block/mmcblk0p2/start)
	part_sectors=$(cat /sys/class/block/mmcblk0p2/size)
	remaining=$((disk_sectors - part_start - part_sectors))
	if [ "$remaining" -lt 0 ] || [ "$remaining" -gt 4096 ]; then
		eend 1 "partition table changed but kernel still sees the old p2; reboot to retry"
		return 1
	fi

	if ! resize2fs /dev/mmcblk0p2 >/dev/null 2>&1; then
		eend 1 "rootfs resize failed; it will be retried next boot"
		return 1
	fi

	# resize2fs also returns success when no resize was needed, so the ext4 and
	# partition sizes must be cross-checked independently.
	fs_blocks=$(LC_ALL=C tune2fs -l /dev/mmcblk0p2 2>/dev/null | \
		awk -F: '/^Block count:/ {gsub(/[[:space:]]/, "", $2); print $2}')
	fs_block_size=$(LC_ALL=C tune2fs -l /dev/mmcblk0p2 2>/dev/null | \
		awk -F: '/^Block size:/ {gsub(/[[:space:]]/, "", $2); print $2}')
	[ -n "$fs_blocks" ] && [ -n "$fs_block_size" ] || {
		eend 1 "cannot verify rootfs size; it will be retried next boot"
		return 1
	}
	fs_sectors=$((fs_blocks * fs_block_size / 512))
	slack=$((part_sectors - fs_sectors))
	if [ "$slack" -lt 0 ] || [ "$slack" -gt 8192 ]; then
		eend 1 "rootfs does not fill p2; it will be retried next boot"
		return 1
	fi

	mkdir -p /var/lib/rk3576
	touch /var/lib/rk3576/rootfs-expanded
	eend 0
}
RESIZE

# Standard login consoles: HDMI tty1 + RK UART ttyFIQ0. No -n/-l /bin/sh, so
# authentication is required.
RUN sed -i '/^tty[2-6]::/d; /^#\?ttyS0::/d; /^ttyFIQ0::/d' /etc/inittab && \
    printf '%s\n' \
        'ttyFIQ0::respawn:/sbin/getty -L 1500000 ttyFIQ0 vt100' \
        >> /etc/inittab

# Establish the full OpenRC boot ordering.
RUN for service in devfs dmesg mdev hwdrivers; do rc-update add "$service" sysinit; done && \
    for service in modules sysctl hostname bootmisc cgroups machine-id seedrng \
                   syslog klogd wpa_supplicant networking resize-rootfs; do \
        rc-update add "$service" boot; \
    done && \
    for service in chronyd crond sshd docker local; do rc-update add "$service" default; done && \
    for service in killprocs mount-ro savecache; do rc-update add "$service" shutdown; done && \
    test -x /sbin/dhcpcd && \
    test -e /etc/runlevels/boot/networking && \
    test ! -e /etc/runlevels/boot/dhcpcd && \
    ifquery -i /etc/network/interfaces --list -a | grep -qx lo && \
    ifquery -i /etc/network/interfaces --list -a | grep -qx eth0 && \
    ifquery -i /etc/network/interfaces --list -a | grep -qx eth1 && \
    ifquery -i /etc/network/interfaces --list -a | grep -qx wlan0 && \
    test -e /etc/runlevels/boot/wpa_supplicant && \
    grep -qx 'rc_need="rk-board"' /etc/conf.d/wpa_supplicant && \
    ! grep -q 'dhcp-program\|dhcp-config\|dhcp-opts' /etc/network/interfaces && \
    grep -qx 'background' /etc/dhcpcd.conf && \
    grep -qx 'nohook resolv.conf, wpa_supplicant' /etc/dhcpcd.conf

# ---- Pack into an ext4 block-device image ----
FROM --platform=$BUILDPLATFORM ubuntu:24.04 AS pack
RUN apt-get update && apt-get install -y --no-install-recommends e2fsprogs \
    && rm -rf /var/lib/apt/lists/*
COPY --from=rootfs / /rootfs/

# During OCI builds /etc/resolv.conf is a runtime-injected file, so the final
# rootfs copy must be written in the pack stage.
RUN rm -f /rootfs/etc/resolv.conf && \
    printf '%s\n' \
        '# Static DNS; DHCP DNS is disabled in /etc/dhcpcd.conf' \
        'nameserver 1.1.1.1' \
        'nameserver 8.8.8.8' \
        > /rootfs/etc/resolv.conf && \
    chmod 0644 /rootfs/etc/resolv.conf && \
    SZ=$(( $(du -sm /rootfs | cut -f1) * 13 / 10 + 64 )) && \
    mke2fs -q -t ext4 -L rootfs -d /rootfs \
        -O ^orphan_file,^metadata_csum_seed \
        -E root_owner=0:0 /rootfs.img "${SZ}M"

FROM scratch AS artifact
COPY --from=pack /rootfs.img /
