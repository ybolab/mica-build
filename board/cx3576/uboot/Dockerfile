# syntax=docker/dockerfile:1
# =============================================================================
# uboot/ — mainline U-Boot for CX3576-Z (cross-compiled, any host arch)
#
#   make uboot   (= docker buildx build -f uboot/Dockerfile -o out/uboot uboot)
#   → out/uboot/u-boot-rockchip.bin   (idbloader+FIT combined; write to eMMC sector 64)
#
# Combination: U-Boot v2026.07 (tag, same as the armbian reference board) + rkbin
#   DDR v1.12 / BL31 v1.24 (blobs pinned explicitly: armbian reports v1.09+ fails
#   to boot on some rk3576 boards; v1.12 verified OK on this board)
# Customizations:
#   · adc-keys: hold the recovery key (saradc ch1, 17mV level) at power-on →
#     preboot enters rockusb
#   · saradc: add vdd-microvolts=1.8V (the mainline driver fails to probe without
#     a vref — the root cause of the dead recovery key)
#   · bootcmd fallback: automatically enter rockusb when boot fails
#   · patches/*.patch: rockusb enumerates as Loader (bcdUSB=0x0201) and honors
#     K_FW_RESET subcode 3/6 -> boot-mode-reg flag, so upgrade_tool uf /
#     rkdeveloptool rd 3 can bounce the board into real maskrom
# =============================================================================
FROM --platform=$BUILDPLATFORM ubuntu:24.04 AS build

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates build-essential bc bison flex \
        libssl-dev python3 python3-setuptools python3-pyelftools \
        device-tree-compiler swig python3-dev \
        gcc-aarch64-linux-gnu libgnutls28-dev uuid-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth=1 https://github.com/rockchip-linux/rkbin /rkbin

ARG UBOOT_REF=v2026.07
RUN git clone --depth=1 -b "${UBOOT_REF}" https://github.com/u-boot/u-boot.git /uboot

COPY patches/ /patches/
RUN cd /uboot && for p in $(ls /patches/*.patch | sort); do \
        echo ">> applying $(basename $p)" && git apply -v "$p"; \
    done

ARG DDR_BLOB=rk3576_ddr_lp4_2112MHz_lp5_2736MHz_v1.12.bin
ARG BL31_BLOB=rk3576_bl31_v1.24.elf
ARG BOARD=generic-rk3576
RUN cd /uboot && \
    DDR=/rkbin/bin/rk35/${DDR_BLOB} && BL31=/rkbin/bin/rk35/${BL31_BLOB} && \
    [ -f "$DDR" ] && [ -f "$BL31" ] && \
    make "${BOARD}_defconfig" && \
    DTSNAME=$(sed -n 's/^CONFIG_DEFAULT_DEVICE_TREE="\(.*\)"/\1/p' .config) && \
    DTSFILE=$(find dts arch -name "${DTSNAME}.dts" | head -1) && \
    echo ">> patching $DTSFILE (adc-keys: recovery key -> rockusb)" && \
    printf '%s\n' \
      '' \
      '/ {' \
      '	adc-keys {' \
      '		compatible = "adc-keys";' \
      '		io-channels = <&saradc 1>;' \
      '		io-channel-names = "buttons";' \
      '		keyup-threshold-microvolt = <1800000>;' \
      '		poll-interval = <100>;' \
      '		button-recovery {' \
      '			label = "recovery";' \
      '			linux,code = <0x73>;' \
      '			press-threshold-microvolt = <17000>;' \
      '		};' \
      '	};' \
      '};' \
      '' \
      '&saradc {' \
      '	status = "okay";' \
      '	/* u-boot rockchip-saradc fails to probe without a vref (so the key can never be read).' \
      '	 * The generic board has no PMIC config; vdd-microvolts is the fallback = on-board vcca_1v8_s0 (1.8V, always-on) */' \
      '	vdd-microvolts = <1800000>;' \
      '};' >> "$DTSFILE" && \
    scripts/config --enable CMD_ROCKUSB \
                   --enable USB_GADGET \
                   --enable USB_FUNCTION_ROCKUSB \
                   --enable ADC \
                   --enable ADC_ROCKCHIP \
                   --enable BUTTON \
                   --enable BUTTON_ADC \
                   --enable CMD_BUTTON \
                   --enable CMD_ADC \
                   --enable FIT \
                   --set-val SYS_BOOTM_LEN 0x8000000 \
                   --enable USE_PREBOOT \
                   --set-str PREBOOT "if button recovery; then echo RECOVERY KEY - entering rockusb; rockusb 0 mmc 0; fi" \
                   --set-str BOOTCOMMAND "bootflow scan -lb; echo BOOT FAILED - entering rockusb; rockusb 0 mmc 0" && \
    make olddefconfig && \
    grep -E "^CONFIG_PREBOOT=|^CONFIG_BUTTON_ADC=|^CONFIG_CMD_ROCKUSB=" .config && \
    { grep -q "^CONFIG_FIT=y" .config || { echo "ERROR: CONFIG_FIT=y missing from .config" >&2; exit 1; }; } && \
    { grep -q "^CONFIG_SYS_BOOTM_LEN=0x8000000" .config || { echo "ERROR: CONFIG_SYS_BOOTM_LEN=0x8000000 missing from .config" >&2; exit 1; }; } && \
    make -j"$(nproc)" \
        CROSS_COMPILE=aarch64-linux-gnu- \
        ROCKCHIP_TPL="$DDR" BL31="$BL31" && \
    ls -la u-boot-rockchip.bin spl/u-boot-spl.bin u-boot.itb

FROM scratch AS artifact
COPY --from=build /uboot/u-boot-rockchip.bin /
# Split artifacts for the update.img path (boot_merger loader + uboot partition)
COPY --from=build /uboot/spl/u-boot-spl.bin /
COPY --from=build /uboot/u-boot.itb /
