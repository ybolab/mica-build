# syntax=docker/dockerfile:1
# =============================================================================
# uboot/ — mainline U-Boot for CX3576-Z (cross-compiled, any host arch)
#
#   make uboot      (= docker buildx build -f uboot/Dockerfile -o out/uboot uboot)
#   → out/uboot/u-boot-rockchip.bin   (idbloader+FIT combined; write to eMMC sector 64)
#   make uboot-mos  (--target artifact-mos -o out/uboot-mos)
#   → out/uboot-mos/u-boot-rockchip.bin  mos A/B variant: same tree plus the
#     persistent redundant environment + boot.scr contract from
#     docs/design/uboot-ab-handshake.md (uenv pair at 16/17 MiB, setexpr,
#     bootmeth order pinned to script). The debug variant keeps ENV_IS_NOWHERE.
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

# mos A/B variant — reconfigures the already-built tree with the env/boot
# contract of docs/design/uboot-ab-handshake.md §3.2/§10 and rebuilds:
# · redundant env pair pinned at uenv-a 0x1000000 / uenv-b 0x1100000, 64 KiB
#   each, eMMC user area (ENV_SIZE must stay 0x10000: the Rockchip default
#   0x1f000 would overrun into uenv-b)
# · ENV_MMC_USE_DT / ENV_MMC_USE_SW_PARTITION / PARTITION_TYPE_GUID stay off,
#   or env/mmc.c relocates the env to a partition END instead of the offsets
# · boot.scr is the only auto-discoverable entry: bootmeth order pinned to
#   script; the rockusb rescue tail and PREBOOT recovery key are preserved
FROM build AS build-mos
ARG DDR_BLOB=rk3576_ddr_lp4_2112MHz_lp5_2736MHz_v1.12.bin
ARG BL31_BLOB=rk3576_bl31_v1.24.elf
RUN cd /uboot && \
    scripts/config --disable ENV_IS_NOWHERE \
                   --enable ENV_IS_IN_MMC \
                   --set-val ENV_OFFSET 0x1000000 \
                   --set-val ENV_SIZE 0x10000 \
                   --enable ENV_REDUNDANT \
                   --set-val ENV_OFFSET_REDUND 0x1100000 \
                   --set-val ENV_MMC_DEVICE_INDEX 0 \
                   --set-val ENV_MMC_EMMC_HW_PARTITION 0 \
                   --enable SAVEENV --enable CMD_SAVEENV \
                   --enable CMD_SETEXPR --enable CMD_SOURCE --enable CMD_IMPORTENV \
                   --enable CMD_FS_GENERIC --enable CMD_FAT --enable CMD_BOOTI --enable CMD_PART \
                   --enable LEGACY_IMAGE_FORMAT --enable HUSH_PARSER \
                   --disable ENV_MMC_USE_DT --disable ENV_MMC_USE_SW_PARTITION \
                   --disable PARTITION_TYPE_GUID \
                   --set-str BOOTCOMMAND "bootmeth order script; bootflow scan -lb; echo BOOT FAILED - entering rockusb; rockusb 0 mmc 0" && \
    make olddefconfig && \
    for line in \
        CONFIG_ENV_IS_IN_MMC=y \
        CONFIG_ENV_OFFSET=0x1000000 \
        CONFIG_ENV_SIZE=0x10000 \
        CONFIG_ENV_REDUNDANT=y \
        CONFIG_ENV_OFFSET_REDUND=0x1100000 \
        CONFIG_CMD_SETEXPR=y \
        CONFIG_CMD_SAVEENV=y \
        CONFIG_HUSH_PARSER=y; do \
        grep -q "^${line}$" .config || { echo "ERROR: ${line} missing from mos .config" >&2; exit 1; }; \
    done && \
    for sym in CONFIG_ENV_IS_NOWHERE CONFIG_ENV_MMC_USE_DT \
               CONFIG_ENV_MMC_USE_SW_PARTITION CONFIG_PARTITION_TYPE_GUID; do \
        if grep -q "^${sym}=y" .config; then \
            echo "ERROR: ${sym}=y would relocate the env off the pinned offsets" >&2; exit 1; \
        fi; \
    done && \
    make -j"$(nproc)" \
        CROSS_COMPILE=aarch64-linux-gnu- \
        ROCKCHIP_TPL=/rkbin/bin/rk35/${DDR_BLOB} BL31=/rkbin/bin/rk35/${BL31_BLOB} && \
    ls -la u-boot-rockchip.bin spl/u-boot-spl.bin u-boot.itb

FROM scratch AS artifact-mos
COPY --from=build-mos /uboot/u-boot-rockchip.bin /
COPY --from=build-mos /uboot/spl/u-boot-spl.bin /
COPY --from=build-mos /uboot/u-boot.itb /

FROM scratch AS artifact
COPY --from=build /uboot/u-boot-rockchip.bin /
# Split artifacts for the update.img path (boot_merger loader + uboot partition)
COPY --from=build /uboot/spl/u-boot-spl.bin /
COPY --from=build /uboot/u-boot.itb /
