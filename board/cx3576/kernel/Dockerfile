# syntax=docker/dockerfile:1
# =============================================================================
# kernel/ — armbian/linux-rockchip rk-6.1-rkr5.1 (6.1.115) (cross-compiled)
#
#   make kernel   (= docker buildx build -f kernel/Dockerfile -o out/kernel .)
#   → out/kernel/Image          kernel image
#   → out/kernel/modules.tar    kernel modules (rootfs project unpacks them into /lib/modules)
#   → out/kernel/rk3576-src.dtb  final dtb (built from the in-tree source dts; used as-is by the assembly stage)
#
# .config baseline = kernel/config/kernel-cx3576z.config
#   (vendor ikconfig + squashfs-zstd/overlayfs/docker prerequisites/fbcon;
#    olddefconfig migrates it to 6.1.115 automatically)
# WiFi: AP6275P uses in-tree bcmdhd (AP6XXX=m), SDIO interface, built as modules
# Patches: kernel/patches/*.patch applied in filename order (YT8531 vendor init sequence, etc.)
# dtb: built directly from the in-tree source kernel/dts/rk3576-cx3576z.dts
# Context = repo root (see the Dockerfile.dockerignore allowlist next to this file)
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
# Shared Talos runtime baseline from board/common/ — requires the named build
# context: docker buildx build --build-context mos-common=../common ...
# (wired in the board Makefile; a bare build without it fails here, loudly).
COPY --from=mos-common mos-required.fragment /mos-required.fragment

ARG KERNEL_EXPECT=6.1.115
RUN cd /ksrc && \
    scripts/config --disable LOCALVERSION_AUTO \
                   `# WiFi: AP6275 on this board is on SDIO (vendor dtb: sdio host+pwrseq on, WiFi on SDIO --` \
                   `#       pcie0 carries a separate Realtek NIC unrelated to WiFi, do not confuse them).` \
                   `#       Firmware paths moved to the standard locations` \
                   --enable BCMDHD_SDIO --disable BCMDHD_PCIE \
                   --set-str BCMDHD_FW_PATH "/lib/firmware/fw_bcmdhd.bin" \
                   --set-str BCMDHD_NVRAM_PATH "/lib/firmware/nvram.txt" \
                   `# RTC: on-board AT8563 (HYM8563 clone); vendor uses a private .ko, we use the in-tree driver` \
                   --enable RTC_DRV_HYM8563 \
                   `# WiFi alternative: aic8800 (dual-SKU design; vendor rootfs ships both bcmdhd and aic8800 .ko).` \
                   `# The in-tree directory gate SPARD_WLAN_SUPPORT has no Kconfig definition (trap!); patch 0002` \
                   `# switches the gate to AIC_WLAN_SUPPORT; the sub-Makefile forces :=m, all three built as modules.` \
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

# In-tree source dtb; the sole extlinux boot entry
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
