# syntax=docker/dockerfile:1
# =============================================================================
# rootfs/alpine-rom — 只读 ROM：Alpine(OpenRC) + Docker，overlayroot 架构
#
#   make rootfs ROOTFS=alpine-rom
#   → out/rootfs/rootfs.img     只读 ext4 根（ROM 本体,轻量 musl）
#   → out/rootfs/initramfs.gz   overlayroot 初始化镜像（tmpfs 叠只读根）
#
# 与 debian-systemd 同架构、更轻（无 glibc/systemd）。全开源 musl 栈,适合无需
# GPU/NPU/硬解码 的工业网关。持久数据（Docker）落 p3 data 分区。
# 依赖：out/kernel/modules.tar（先 make kernel）；上下文=仓库根。
# 本阶段执行 arm64 二进制：x86 主机一次性 tonistiigi/binfmt --install arm64
#
# 注：等价于 Alpine 官方 diskless(run-from-RAM) 模式,但用我们的 initramfs 以适配
# u-boot/extlinux/自编内核管线（Alpine 原生 diskless 依赖 mkinitfs+modloop+apkovl）。
# =============================================================================

# ---------------------------------------------------------------------------
# 根文件系统：Alpine + OpenRC + Docker
# ---------------------------------------------------------------------------
FROM --platform=linux/arm64 alpine:3.20 AS rootfs
RUN apk add --no-cache \
        openrc \
        docker docker-cli-compose iptables \
        wpa_supplicant iw \
        openssh dhcpcd iproute2 \
        e2fsprogs util-linux \
        htop ethtool pciutils usbutils i2c-tools can-utils \
        libdrm

# 内核模块（Alpine /lib 是真目录,直接解到 /）
ADD out/kernel/modules.tar /
# WiFi 固件（AP6275S/AIC8800D80 双 SKU）
COPY rootfs/firmware/ /lib/firmware/
RUN ln -sf fw_bcm43752a2_ag.bin /lib/firmware/fw_bcmdhd.bin && \
    ln -sf nvram_ap6275s.txt /lib/firmware/nvram.txt && \
    ln -sf clm_bcm43752a2_ag.blob /lib/firmware/clm_bcmdhd.blob 2>/dev/null || true; \
    printf '%s\n' 'bcmdhd' 'aic8800_fdrv' > /etc/modules-load.d/wifi.conf 2>/dev/null || \
    printf '%s\n' 'bcmdhd' 'aic8800_fdrv' >> /etc/modules

# 主机名 + root 密码 + SSH 主机密钥（只读根下烘焙,稳定）
RUN echo 'rk3576' > /etc/hostname; \
    echo 'root:root' | chpasswd; \
    sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config; \
    ssh-keygen -A

# fstab：p3 持久分区 → /srv（首启扩满 eMMC）；/tmp /run tmpfs
RUN printf '%s\n' \
    '# 只读 ROM。根由 initramfs 做成 tmpfs-overlay,这里仅声明持久/易失挂载' \
    '/dev/mmcblk0p3  /srv             ext4  rw,noatime,nofail  0 0' \
    'tmpfs           /tmp             tmpfs rw,nosuid,nodev     0 0' \
    > /etc/fstab

# Docker：数据落 /srv/docker（/srv=p3 扩充分区）,overlay2
RUN mkdir -p /etc/docker /srv && printf '%s\n' \
    '{' \
    '  "data-root": "/srv/docker",' \
    '  "storage-driver": "overlay2",' \
    '  "log-driver": "json-file",' \
    '  "log-opts": { "max-size": "10m", "max-file": "3" }' \
    '}' > /etc/docker/daemon.json

# WiFi auto-connect (optional: --build-arg WIFI_SSID=... --build-arg WIFI_PSK=...)
ARG WIFI_SSID=""
ARG WIFI_PSK=""
RUN mkdir -p /etc/wpa_supplicant && \
    printf '%s\n' \
        'ctrl_interface=/var/run/wpa_supplicant' \
        'update_config=1' \
        > /etc/wpa_supplicant/wpa_supplicant.conf && \
    if [ -n "$WIFI_SSID" ]; then \
        printf '\nnetwork={\n\tssid="%s"\n\tpsk="%s"\n\tkey_mgmt=WPA-PSK\n}\n' \
            "$WIFI_SSID" "$WIFI_PSK" \
            >> /etc/wpa_supplicant/wpa_supplicant.conf; \
    fi

# 板级开机脚本：USB OTG host + WiFi 驱动/连接 + 全 eth* DHCP（OpenRC local.d）
RUN mkdir -p /etc/local.d && cat > /etc/local.d/rk3576.start <<'BOARD' && chmod +x /etc/local.d/rk3576.start
#!/bin/sh
# USB OTG(drd0) 角色：默认 host（第二网口/外设）;要 ACM 台改 /etc/usb-otg-mode=peripheral
M=$(cat /etc/usb-otg-mode 2>/dev/null || echo host)
echo "$M" > /sys/devices/platform/2602e000.syscon/2602e000.syscon:usb2-phy@0/otg_mode 2>/dev/null

# WiFi: load drivers (dual SKU); associate via wpa_supplicant.conf once wlan0 appears
modprobe bcmdhd 2>/dev/null || true
modprobe aic8800_fdrv 2>/dev/null || true
( for i in $(seq 1 20); do
    ip link show wlan0 >/dev/null 2>&1 && break; sleep 1
  done
  if ip link show wlan0 >/dev/null 2>&1; then
    ip link set wlan0 up 2>/dev/null
    wpa_supplicant -B -i wlan0 -c /etc/wpa_supplicant/wpa_supplicant.conf 2>/dev/null
    udhcpc -i wlan0 -b >/dev/null 2>&1 &
  fi ) &

# 所有 eth* 起 DHCP（不碰 can/wlan）
for n in /sys/class/net/eth*; do
  [ -e "$n" ] || continue
  i=$(basename "$n")
  ip link set "$i" up 2>/dev/null
  udhcpc -i "$i" -b >/dev/null 2>&1 &
done
BOARD

# OpenRC 服务启用（离线写 runlevel 符号链接）
RUN for s in devfs dmesg mdev hwdrivers modules; do rc-update add $s sysinit 2>/dev/null || true; done; \
    for s in bootmisc hostname localmount; do rc-update add $s boot 2>/dev/null || true; done; \
    for s in docker sshd local; do rc-update add $s default 2>/dev/null || true; done; \
    # 只读根下不 fsck 根、不 remount（overlay 已由 initramfs 处理） \
    sed -i 's/^#\?rc_logger=.*/rc_logger="NO"/' /etc/rc.conf 2>/dev/null || true

# getty：ttyFIQ0 主控制台（1.5M）
RUN sed -i '/tty[1-6]/d' /etc/inittab 2>/dev/null || true; \
    echo 'ttyFIQ0::respawn:/sbin/getty -L ttyFIQ0 1500000 vt100' >> /etc/inittab

# ---------------------------------------------------------------------------
# initramfs：busybox overlayroot（与 debian-systemd 同款,tmpfs 叠只读根）
# ---------------------------------------------------------------------------
FROM --platform=linux/arm64 alpine:3.20 AS initramfs
RUN apk add --no-cache busybox-static cpio gzip
RUN mkdir -p /ir/bin /ir/proc /ir/sys /ir/dev /ir/lower /ir/upper /ir/newroot && \
    cp /bin/busybox.static /ir/bin/busybox && \
    cat > /ir/init <<'INIT' && chmod +x /ir/init
#!/bin/busybox sh
/bin/busybox --install -s /bin 2>/dev/null
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs dev /dev 2>/dev/null
echo "===== INITRAMFS overlayroot (alpine-rom) ====="
ROOT=$(findfs PARTLABEL=rootfs 2>/dev/null)
[ -b "$ROOT" ] || ROOT=/dev/mmcblk0p2
for i in $(seq 1 50); do [ -b "$ROOT" ] && break; sleep 0.1; done
echo "root(ro) = $ROOT"
mount -o ro "$ROOT" /lower
mount -t tmpfs -o size=75% tmpfs /upper
mkdir -p /upper/up /upper/work
modprobe overlay 2>/dev/null
mount -t overlay overlay -o lowerdir=/lower,upperdir=/upper/up,workdir=/upper/work /newroot || {
    echo "overlay 失败,回退只读根直挂"; mount --move /lower /newroot; }
mount --move /proc /newroot/proc
mount --move /sys  /newroot/sys
mount --move /dev  /newroot/dev
exec switch_root /newroot /sbin/init
INIT
RUN cd /ir && find . | cpio -o -H newc 2>/dev/null | gzip -9 > /initramfs.gz && ls -la /initramfs.gz

# ---------------------------------------------------------------------------
# 打包：ext4 只读根镜像 + initramfs
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM ubuntu:24.04 AS pack
RUN apt-get update && apt-get install -y --no-install-recommends e2fsprogs \
    && rm -rf /var/lib/apt/lists/*
COPY --from=rootfs / /rootfs/
COPY --from=initramfs /initramfs.gz /out/initramfs.gz
RUN mkdir -p /out && \
    SZ=$(( $(du -sm /rootfs | cut -f1) * 12 / 10 + 48 )) && \
    mke2fs -q -t ext4 -L rootfs -d /rootfs \
        -O ^orphan_file,^metadata_csum_seed \
        -E root_owner=0:0 /out/rootfs.img "${SZ}M"

FROM scratch AS artifact
COPY --from=pack /out/rootfs.img /
COPY --from=pack /out/initramfs.gz /
