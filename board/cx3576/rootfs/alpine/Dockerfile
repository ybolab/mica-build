# syntax=docker/dockerfile:1
# =============================================================================
# rootfs/alpine — Alpine 3.24.1 可写主机系统
#
# 目标体验接近一台普通 KVM Alpine 虚拟机：
#   - BusyBox init + OpenRC 服务管理
#   - ttyFIQ0/tty1 登录提示（不再提供免密 shell）
#   - OpenSSH、Docker/Compose、ifupdown-ng + 按接口调用 dhcpcd
#   - DHCP 只配置地址/路由；DNS 固定为 1.1.1.1、8.8.8.8
#
#   make rootfs
#   -> out/rootfs/rootfs.img（ext4，可直接组装/dd）
#
# 默认实验室账号：root / root，普通用户 alpine / alpine。首次登录后应立即修改密码。
# 依赖 out/kernel/modules.tar（make rootfs 会先构建 kernel）。
# =============================================================================

# 固定 3.24.1 的多架构 OCI manifest，避免 alpine:3.24 漂移到后续维护版本。
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

# 内核模块必须与 out/kernel/Image 来自同一次构建。
ADD out/kernel/modules.tar /

# Wi-Fi/BT 固件：AIC8800D80 为当前板主路径，Broadcom 用于兼容其他 SKU。
COPY rootfs/firmware/ /lib/firmware/
RUN ln -sf fw_bcm43752a2_ag.bin /lib/firmware/fw_bcmdhd.bin && \
    ln -sf fw_bcm43752a2_ag_apsta.bin /lib/firmware/fw_bcmdhd_apsta.bin && \
    ln -sf nvram_ap6275s.txt /lib/firmware/nvram.txt && \
    ln -sf clm_bcm43752a2_ag.blob /lib/firmware/clm_bcmdhd.blob

COPY scripts/rs485-pair-test.sh /usr/local/sbin/rs485-pair-test
RUN chmod 0755 /usr/local/sbin/rs485-pair-test

# networking/ifupdown-ng 是唯一接口控制器；DHCP stanza 按接口调用 dhcpcd，
# 不启动全局 dhcpcd OpenRC 服务。ifupdown-ng 会优先自动选择已安装的 dhcpcd；
# /etc/dhcpcd.conf 的 background 让无 carrier 接口在后台等待，不阻塞启动。
RUN mkdir -p /etc/network/interfaces.d && \
    cat > /etc/network/interfaces <<'INTERFACES'
# /etc/network/interfaces -- managed by ifupdown-ng/OpenRC networking
auto lo
iface lo inet loopback

# 板载 GMAC0 + YT8531
auto eth0
iface eth0 inet dhcp

# PCIe RTL8168 第二网口
auto eth1
iface eth1 inet dhcp

# Wi-Fi 服务默认启动；未配置 network={} 时保持空闲。写入凭据后重载或重启即可连接。
auto wlan0
iface wlan0 inet dhcp

# 静态地址示例（替换对应 DHCP stanza 后执行 ifdown eth0; ifup eth0）：
# auto eth0
# iface eth0 inet static
#	address 192.168.1.100/24
#	gateway 192.168.1.1

source /etc/network/interfaces.d/*
INTERFACES

# ifupdown-ng 自动检测 /sbin/dhcpcd 并读取此公共配置；全局 dhcpcd 服务不启动。
# background 立即返回并监听 carrier：无链路时不发 DHCP，链路恢复后自动获取租约。
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

# Wi-Fi demo（整段保持注释，默认不会连接）：
#   wpa_passphrase 'DemoWiFi' 'ChangeMe1234'
# 生成结果：
# network={
#	ssid="DemoWiFi"
#	#psk="ChangeMe1234"
#	psk=2865d37bfe4035f2c5274b6831c4863ac29edbd3fcf554ea5b59483cd349960d
# }
#
# 实际使用时运行 wpa_passphrase，并把输出的 network={} 追加到本文件。
WPA

# wpa_supplicant 默认启动且必须等待 rk-board 加载无线驱动、创建 wlan0。
RUN printf '%s\n' 'rc_need="rk-board"' >> /etc/conf.d/wpa_supplicant

# OpenSSH 提供真正的主机登录体验。主机密钥由 Alpine sshd OpenRC 服务在首次启动时
# 生成，避免所有刷写同一镜像的设备共用一套 host key。
RUN sed -i \
        -e 's/^#\?PermitRootLogin .*/PermitRootLogin yes/' \
        -e 's/^#\?PasswordAuthentication .*/PasswordAuthentication yes/' \
        /etc/ssh/sshd_config && \
    printf '%s\n' \
        'AllowTcpForwarding yes' \
        'ClientAliveInterval 60' \
        'ClientAliveCountMax 3' \
        >> /etc/ssh/sshd_config

# Docker 使用可写 p2 根分区；首启扩容后 /var/lib/docker 可使用整个 eMMC。
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

# 板级早期初始化：OTG 默认 host；为无 EEPROM 的 RTL8168 派生稳定本地 MAC；
# 尝试加载两种可能 SKU 的 Wi-Fi 驱动。networking 通过 rc_need 等待本服务。
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

# 把整盘镜像写入更大的 eMMC 后，修复 GPT 备份头并在线扩展 p2/ext4。
# 在 virtio/KVM 等没有 mmcblk0p2 的环境中安全跳过。
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

	# 整盘镜像写入更大 eMMC 后，先把备份 GPT 移到真实磁盘末尾。
	if ! sgdisk -e /dev/mmcblk0 >/dev/null 2>&1; then
		eend 1 "GPT relocation failed; it will be retried next boot"
		return 1
	fi

	# growpart 能处理已挂载根分区，并用 partx --update 通知内核。NOCHANGE 也可能表示
	# 分区已经是最大值，因此不依据退出码判定成功，以下面 sysfs 尺寸为准。
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

	# resize2fs 在“无需扩容”时也会返回成功，因此必须独立核对 ext4 与分区尺寸。
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

# 标准登录控制台：HDMI tty1 + RK UART ttyFIQ0。没有 -n/-l /bin/sh，因此必须认证。
RUN sed -i '/^tty[2-6]::/d; /^#\?ttyS0::/d; /^ttyFIQ0::/d' /etc/inittab && \
    printf '%s\n' \
        'ttyFIQ0::respawn:/sbin/getty -L 1500000 ttyFIQ0 vt100' \
        >> /etc/inittab

# 建立完整 OpenRC 启动顺序。
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

# ---- 打包成 ext4 块设备镜像 ----
FROM --platform=$BUILDPLATFORM ubuntu:24.04 AS pack
RUN apt-get update && apt-get install -y --no-install-recommends e2fsprogs \
    && rm -rf /var/lib/apt/lists/*
COPY --from=rootfs / /rootfs/

# /etc/resolv.conf 在 OCI 构建阶段是运行时注入文件，因此必须在 pack 阶段写入最终 rootfs。
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
