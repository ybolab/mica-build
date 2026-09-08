# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# U-Boot sandbox build for the offline A/B handshake harness.
#
# Same source pin as boards/cx3576/bsp/uboot/Dockerfile (v2026.07 commit): the
# harness must exercise the same U-Boot generation the board runs, only built
# for the host (sandbox_defconfig) so the shipped boot.scr can be executed
# without hardware. Network is needed once, for this build; every run of the
# harness afterwards is offline (docker caches every stage).

# The builder image, injected from build-env/images.env by
# build-env/from.sh, which tests/handshake-test/run.sh calls. It is the
# same key the BSP builders use, deliberately: the claim above is about the
# source pin, and it is weaker than it reads if the two builds do not also
# stand on the same builder -- a sandbox U-Boot compiled by a different gcc
# than boards/cx3576/bsp/uboot's is a different program being asserted about. No
# default: without a value docker refuses before any stage runs.
ARG MOS_IMAGE_UBUNTU_2404
FROM ${MOS_IMAGE_UBUNTU_2404} AS src

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates build-essential bc bison flex \
        libssl-dev python3 python3-setuptools python3-pyelftools \
        python3-dev swig device-tree-compiler pkg-config uuid-dev \
        libsdl2-dev libgnutls28-dev \
        mtools dosfstools gdisk \
    && rm -rf /var/lib/apt/lists/*

# Identical pin to boards/cx3576/bsp/uboot/Dockerfile.
ARG UBOOT_REPO=https://github.com/u-boot/u-boot.git
ARG UBOOT_COMMIT=ece349ade2973e220f524ce59e59711cc919263f
RUN git init -q /uboot && \
    git -C /uboot remote add origin "${UBOOT_REPO}" && \
    git -C /uboot fetch --depth=1 origin "${UBOOT_COMMIT}" && \
    git -C /uboot checkout -q --detach FETCH_HEAD && \
    test "$(git -C /uboot rev-parse HEAD)" = "${UBOOT_COMMIT}"

# Sandbox build carrying the board's env contract
# (boards/cx3576/bsp/uboot/Dockerfile --target artifact-mos): redundant env pair at
# the same absolute eMMC offsets, uenv-a 0x1000000 / uenv-b 0x1100000, 64 KiB
# each, on mmc device 0 -- here a host file, because the sandbox mmc driver
# mmaps the DT `filename` property MAP_SHARED (drivers/mmc/sandbox_mmc.c,
# os_map_file), so saveenv genuinely persists into the file across process
# invocations, which is what makes one process invocation = one boot cycle
# testable at all.

# The one sandbox-only divergence that is a requirement, not a convenience:
# SANDBOX_RAM_SIZE_MB=2048. The shipped script loads the verity env at
# 0x40f00000 and the boot digest at 0x40f10000; sandbox default RAM is 256 MiB
# and every address above RAM is a hard os_abort(). 2048 MiB puts every address
# the script uses in range.
#
# WHAT THIS COMMENT USED TO SAY, and what RFCT-352 measured instead. It claimed
# the harness could model "the kernel accepted control" by pointing
# kernel_addr_r above RAM, so that `load ... Image` aborted the process after
# the decrement's saveenv and before the burn. The abort was real; the line it
# came from was not. With CONFIG_LMB=y -- sandbox's default, and NOT optional,
# because CMD_BOOTI is unbuildable without it -- fs_read_lmb_check() (fs/fs.c)
# refuses an out-of-RAM read before anything is written and `load` returns
# FAILURE. The abort came one line later, from `booti` mapping the address
# nothing had been loaded to (`phys_to_virt: Cannot map sandbox address
# f0000000`). It worked only because the script IGNORED the failed load, which
# is the defect RFCT-352 closes: a guarded script refuses that slot and never
# reaches booti, so the model is no longer expressible and no cycle on sandbox
# can end anywhere but in a burn. tests/handshake-test/harness.sh says what
# that costs and what now covers the watchdog instead.

# The mmc node is appended to the sandbox devicetree; `filename` is relative,
# resolved against the harness workspace cwd at run time.

# EFI_LOADER is off: sandbox_defconfig enables EFI capsule authentication,
# whose ESL generation needs host tooling this image does not carry (Error 127
# at lib/efi_loader/Makefile capsule_esl_file), and nothing in the handshake
# touches EFI. UNIT_TEST must go with it -- the built-in test suite
# (test/boot/bootflow.c) links against EFI symbols unconditionally -- and
# UPL/CMD_UPL must go with UNIT_TEST, because cmd/upl.c links against the
# suite's upl_get_test_data (CMD_UPL declares no Kconfig dependency on it).
FROM src AS build
RUN cd /uboot && \
    make sandbox_defconfig && \
    printf '%s\n' \
      '' \
      '/ {' \
      '	aliases {' \
      '		mmc0 = &mos_mmc;' \
      '	};' \
      '' \
      '	mos_mmc: mmc0 {' \
      '		compatible = "sandbox,mmc";' \
      '		filename = "mmc0.img";' \
      '		non-removable;' \
      '	};' \
      '};' >> arch/sandbox/dts/sandbox.dts && \
    # board/sandbox/sandbox.c overrides env_get_location() with a hardcoded
    # priority list -- NOWHERE and EXT4, then FAT and SPI_FLASH -- that never
    # offers ENVL_MMC, and the driver-lookup loop stops at the first priority
    # with no compiled driver, so with only ENV_IS_IN_MMC built, env_init()
    # returns -ENODEV and the board refuses to start. MMC must replace the
    # first slot.
    sed -i 's/\tENVL_NOWHERE,/\tENVL_MMC,/' board/sandbox/sandbox.c && \
    grep -qF 'ENVL_MMC,' board/sandbox/sandbox.c && \
    scripts/config --disable ENV_IS_NOWHERE \
                   --disable ENV_IS_IN_FAT \
                   --disable ENV_IS_IN_EXT4 \
                   --disable ENV_IS_IN_SPI_FLASH \
                   --enable ENV_IS_IN_MMC \
                   --set-val ENV_OFFSET 0x1000000 \
                   --set-val ENV_SIZE 0x10000 \
                   --enable ENV_REDUNDANT \
                   --set-val ENV_OFFSET_REDUND 0x1100000 \
                   --set-val ENV_MMC_DEVICE_INDEX 0 \
                   --set-val ENV_MMC_EMMC_HW_PARTITION 0 \
                   --enable CMD_CRC32 \
                   --enable CRC32_VERIFY \
                   --set-val SANDBOX_RAM_SIZE_MB 2048 \
                   --disable SANDBOX_SDL \
                   --disable EFI_LOADER \
                   --disable UNIT_TEST \
                   --disable UPL \
                   --disable CMD_UPL && \
    make olddefconfig && \
    # Env-contract and script-vocabulary pins, board-Dockerfile style: each of
    # these is a command or a placement the board's boot.cmd depends on, and an
    # olddefconfig that silently dropped one would surface as a confusing
    # runtime failure instead of a red build.
    for line in \
        CONFIG_ENV_IS_IN_MMC=y \
        CONFIG_ENV_OFFSET=0x1000000 \
        CONFIG_ENV_SIZE=0x10000 \
        CONFIG_ENV_REDUNDANT=y \
        CONFIG_ENV_OFFSET_REDUND=0x1100000 \
        CONFIG_ENV_MMC_DEVICE_INDEX=0 \
        CONFIG_ENV_MMC_EMMC_HW_PARTITION=0 \
        CONFIG_SANDBOX_RAM_SIZE_MB=2048 \
        CONFIG_CMD_CRC32=y \
        CONFIG_CRC32_VERIFY=y \
        CONFIG_LMB=y \
        CONFIG_CMD_BOOTI=y \
        CONFIG_CMD_SETEXPR=y \
        CONFIG_CMD_SAVEENV=y \
        CONFIG_CMD_SOURCE=y \
        CONFIG_CMD_IMPORTENV=y \
        CONFIG_CMD_FS_GENERIC=y \
        CONFIG_HUSH_PARSER=y \
        CONFIG_LEGACY_IMAGE_FORMAT=y \
        CONFIG_MMC_SANDBOX=y \
        CONFIG_MMC_WRITE=y \
        CONFIG_FS_FAT=y \
        CONFIG_EFI_PARTITION=y; do \
        grep -q "^${line}$" .config || { echo "ERROR: ${line} missing from sandbox .config" >&2; exit 1; }; \
    done && \
    for sym in CONFIG_ENV_IS_NOWHERE CONFIG_ENV_IS_IN_FAT \
               CONFIG_ENV_IS_IN_EXT4 CONFIG_ENV_IS_IN_SPI_FLASH; do \
        if grep -q "^${sym}=y" .config; then \
            echo "ERROR: ${sym}=y would relocate the env off the mmc-backed file" >&2; exit 1; \
        fi; \
    done && \
    make -j"$(nproc)" NO_SDL=1 && \
    test "$(fdtget u-boot.dtb /mmc0 filename)" = "mmc0.img" && \
    test "$(fdtget u-boot.dtb /aliases mmc0)" = "/mmc0" && \
    # Headless smoke test: the binary must run without a terminal and bind the
    # file-backed mmc as device 0. A zeroed backing file means a bad-CRC env,
    # which is exactly the virgin-environment state the harness starts from.
    truncate -s 16M mmc0.img && \
    { timeout 60 ./u-boot -d u-boot.dtb -c 'if mmc dev 0; then echo SMOKE_MMC_OK; fi' \
        </dev/null >smoke.log 2>&1 || true; } && \
    grep -q SMOKE_MMC_OK smoke.log && \
    rm -f mmc0.img smoke.log && \
    ls -la u-boot u-boot.dtb tools/mkimage tools/mkenvimage

FROM scratch AS artifact
COPY --from=build /uboot/u-boot /
COPY --from=build /uboot/u-boot.dtb /
COPY --from=build /uboot/tools/mkimage /
COPY --from=build /uboot/tools/mkenvimage /
