# syntax=docker/dockerfile:1
# =============================================================================
# kernel/ — armbian/linux-rockchip rk-6.1-rkr5.1 (6.1.115)（交叉编译）
#
#   make kernel   （= docker buildx build -f kernel/Dockerfile -o out/kernel .）
#   → out/kernel/Image          内核
#   → out/kernel/modules.tar    内核模块（rootfs 工程负责解到 /lib/modules）
#   → out/kernel/rk3576-src.dtb  成品 dtb（入树源码 dts 编译,合成级直接用）
#
# .config 基线 = kernel/config/kernel-cx3576z.config
#   （原厂 ikconfig + squashfs-zstd/overlayfs/docker 前置/fbcon，6.1.84 实机验证过，
#    olddefconfig 自动迁移到 6.1.115）
# WiFi：AP6275P 走树内 bcmdhd(AP6XXX=m)，SDIO 接口，编成模块
# 补丁：kernel/patches/*.patch 按文件名顺序施加（YT8531 原厂初始化序列等）
# dtb：入树源码 kernel/dts/rk3576-cx3576z.dts 直接编译（原厂 base+overlay 路线已废弃）
# 上下文 = 仓库根（见同目录 Dockerfile.dockerignore 白名单）
# =============================================================================
FROM --platform=$BUILDPLATFORM ubuntu:24.04 AS build

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates build-essential bc bison flex \
        libssl-dev libelf-dev python3 kmod patch \
        gcc-aarch64-linux-gnu \
    && rm -rf /var/lib/apt/lists/*

ARG KERNEL_REPO=https://github.com/armbian/linux-rockchip.git
ARG KERNEL_BRANCH=rk-6.1-rkr5.1
RUN git clone --depth=1 -b "${KERNEL_BRANCH}" "${KERNEL_REPO}" /ksrc

COPY kernel/patches/ /patches/
RUN cd /ksrc && for p in $(ls /patches/*.patch 2>/dev/null | sort); do \
        echo ">> applying $(basename $p)" && patch -p1 --no-backup-if-mismatch < "$p"; \
    done

COPY kernel/config/kernel-cx3576z.config /ksrc/.config
COPY kernel/config/mos-required.fragment /mos-required.fragment

ARG KERNEL_EXPECT=6.1.115
RUN cd /ksrc && \
    scripts/config --disable LOCALVERSION_AUTO \
                   `# WiFi: 本板 AP6275 走 SDIO（原厂 dtb: sdio host+pwrseq 开,WiFi 在 SDIO 上——` \
                   `#       pcie0 上另挂 Realtek 网卡,与 WiFi 无关,别混淆）。固件路径改标准位置` \
                   --enable BCMDHD_SDIO --disable BCMDHD_PCIE \
                   --set-str BCMDHD_FW_PATH "/lib/firmware/fw_bcmdhd.bin" \
                   --set-str BCMDHD_NVRAM_PATH "/lib/firmware/nvram.txt" \
                   `# RTC: 板载 AT8563(HYM8563 克隆),原厂用私有 .ko,我们走树内驱动` \
                   --enable RTC_DRV_HYM8563 \
                   `# WiFi 备选:aic8800(双 SKU 设计,原厂 rootfs 同时带 bcmdhd 与 aic8800 .ko)。` \
                   `# 树内目录门禁 SPARD_WLAN_SUPPORT 无 Kconfig 定义(坑!),0002 补丁改由` \
                   `# AIC_WLAN_SUPPORT 门禁;子 Makefile 强制 :=m,三件套编成模块。` \
                   --set-str AIC_FW_PATH "/lib/firmware" && \
    ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- \
        scripts/kconfig/merge_config.sh -m .config /mos-required.fragment && \
    make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- olddefconfig && \
    grep -q "^CONFIG_SQUASHFS_ZSTD=y" .config && \
    grep -q "^CONFIG_OVERLAY_FS=y" .config && \
    grep -q "^CONFIG_MEMCG=y" .config && \
    grep -q "^CONFIG_FRAMEBUFFER_CONSOLE=y" .config && \
    grep -q "^CONFIG_DRM_FBDEV_EMULATION=y" .config && \
    grep -q "^CONFIG_AP6XXX=m" .config && \
    grep -q "^CONFIG_BCMDHD_SDIO=y" .config && \
    for option in \
        CGROUP_BPF VETH BRIDGE BRIDGE_NETFILTER \
        NF_CONNTRACK NF_NAT NF_TABLES NF_TABLES_INET \
        NFT_CT NFT_MASQ NFT_NAT NFT_COMPAT \
        NETFILTER_XTABLES NETFILTER_XT_MATCH_ADDRTYPE \
        NETFILTER_XT_MATCH_CONNTRACK NETFILTER_XT_MARK \
        NETFILTER_XT_TARGET_CHECKSUM NETFILTER_XT_TARGET_CT \
        NETFILTER_XT_TARGET_MASQUERADE NETFILTER_XT_TARGET_REDIRECT \
        IP_NF_FILTER IP_NF_MANGLE IP_NF_RAW IP_NF_NAT \
        IP6_NF_IPTABLES IP6_NF_FILTER IP6_NF_MANGLE IP6_NF_RAW \
        IP6_NF_NAT IP6_NF_TARGET_MASQUERADE; do \
        grep -q "^CONFIG_${option}=y" .config || { \
            echo "missing Docker kernel option: CONFIG_${option}=y" >&2; \
            exit 1; \
        }; \
    done && \
    for line in $(sed -n 's/^\(CONFIG_[A-Z0-9_]*=y\)$/\1/p' /mos-required.fragment); do \
        grep -q "^${line}$" .config || { \
            echo "missing mos-required option: ${line}" >&2; \
            exit 1; \
        }; \
    done

RUN cd /ksrc && \
    make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- -j"$(nproc)" Image modules && \
    echo "kernel release: $(cat include/config/kernel.release)" && \
    [ "$(cat include/config/kernel.release)" = "${KERNEL_EXPECT}" ] && \
    make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- \
         INSTALL_MOD_PATH=/kmods INSTALL_MOD_STRIP=1 modules_install && \
    tar -C /kmods -cf /modules.tar lib && \
    ls /kmods/lib/modules/

# 入树源码 dtb（完整开源路线,extlinux 默认且唯一启动项）
COPY kernel/dts/rk3576-cx3576z.dts /ksrc/arch/arm64/boot/dts/rockchip/
RUN cd /ksrc && \
    echo 'dtb-$(CONFIG_ARCH_ROCKCHIP) += rk3576-cx3576z.dtb' \
        >> arch/arm64/boot/dts/rockchip/Makefile && \
    make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- rockchip/rk3576-cx3576z.dtb && \
    cp arch/arm64/boot/dts/rockchip/rk3576-cx3576z.dtb /rk3576-src.dtb

FROM scratch AS artifact
COPY --from=build /ksrc/arch/arm64/boot/Image /
COPY --from=build /modules.tar /
COPY --from=build /rk3576-src.dtb /
