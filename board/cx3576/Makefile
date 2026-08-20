# Build and flash the CX3576-Z Alpine image.
# Layout: U-Boot at LBA 64, boot at 16 MiB, and rootfs at 80 MiB.
.PHONY: all uboot uboot-mos kernel rootfs image rkdeveloptool-macos flash flash-maskrom flash-rootfs-offline \
	source-check clean

TOOLS_DIR ?= tools
THIRD_DIR ?= third
RKDEVELOPTOOL_LOCAL := $(TOOLS_DIR)/rkdeveloptool
RKDEVELOPTOOL ?= $(if $(wildcard $(RKDEVELOPTOOL_LOCAL)),$(RKDEVELOPTOOL_LOCAL),rkdeveloptool)
VENDOR_MINILOADER := uboot/MiniLoaderAll.bin

all: image

uboot:
	docker buildx build -f uboot/Dockerfile \
	  $(if $(UBOOT_COMMIT),--build-arg UBOOT_COMMIT=$(UBOOT_COMMIT)) \
	  $(if $(RKBIN_COMMIT),--build-arg RKBIN_COMMIT=$(RKBIN_COMMIT)) \
	  -o out/uboot uboot

# mos A/B variant (persistent redundant env + boot.scr contract); consumed by
# the v2 image pipeline, while the debug variant above stays on v1/alpine.
uboot-mos:
	docker buildx build -f uboot/Dockerfile --target artifact-mos \
	  $(if $(UBOOT_COMMIT),--build-arg UBOOT_COMMIT=$(UBOOT_COMMIT)) \
	  $(if $(RKBIN_COMMIT),--build-arg RKBIN_COMMIT=$(RKBIN_COMMIT)) \
	  -o out/uboot-mos uboot

kernel:
	docker buildx build --build-context mos-common=../common -f kernel/Dockerfile \
	  $(if $(KERNEL_COMMIT),--build-arg KERNEL_COMMIT=$(KERNEL_COMMIT)) \
	  $(if $(KERNEL_EXPECT),--build-arg KERNEL_EXPECT=$(KERNEL_EXPECT)) \
	  -o out/kernel .

rootfs: kernel
	docker buildx build -f rootfs/alpine/Dockerfile \
	  --platform linux/arm64 \
	  --build-context kernel-out=out/kernel \
	  --build-context firmware=rootfs/firmware \
	  -o out/rootfs rootfs/alpine

image: uboot rootfs
	docker buildx build -f Dockerfile.alpine --target artifact -o out .
	@cd out && shasum -a 256 disk.img > disk.img.sha256
	@ls -la out/disk.img
	@cat out/disk.img.sha256

# Build the native macOS flashing tool.
rkdeveloptool-macos:
	$(THIRD_DIR)/rkdeveloptool/build-macos.sh

# Reject CJK text in source and configuration files; Markdown is documentation.
source-check:
	@if git grep --untracked -I -n -P '(*UTF)[\x{3400}-\x{4dbf}\x{4e00}-\x{9fff}\x{f900}-\x{faff}]' \
		-- . ':(exclude)*.md' ':(exclude)*.ppm'; then \
		echo 'error: CJK text is not allowed in source files' >&2; \
		exit 1; \
	else \
		rc=$$?; test "$$rc" -eq 1 || exit "$$rc"; \
	fi

# Read back the raw boot area (GPT + idblock + u-boot.itb, first 16 MiB) and
# compare it against the source image; a partial or corrupt write here is the
# one failure that bricks the board past the recovery key.
define verify-boot-area
	$(RKDEVELOPTOOL) rl 0 32768 out/.verify-boot.img
	head -c 16777216 out/disk.img | cmp - out/.verify-boot.img
	rm -f out/.verify-boot.img
	@echo "Boot area (loader + u-boot.itb) verified against out/disk.img."
endef

# Flash the complete image while the board is in Loader mode.
flash:
	@echo "WARNING: Keep board power and USB connected until rkdeveloptool rd completes."
	$(RKDEVELOPTOOL) wl 0 out/disk.img
	$(verify-boot-area)
	$(RKDEVELOPTOOL) rd

# Recover from Maskrom with the pinned vendor Loader, then flash the full image.
flash-maskrom:
	@echo "WARNING: Keep board power and USB connected until rkdeveloptool rd completes."
	shasum -a 256 -c uboot/MiniLoaderAll.bin.sha256
	$(RKDEVELOPTOOL) db $(VENDOR_MINILOADER)
	$(RKDEVELOPTOOL) wl 0 out/disk.img
	$(verify-boot-area)
	$(RKDEVELOPTOOL) rd

# Flash only rootfs when the kernel and partition layout are unchanged.
flash-rootfs-offline:
	@echo "WARNING: Keep board power and USB connected until rkdeveloptool rd completes."
	$(RKDEVELOPTOOL) wl 163840 out/rootfs/rootfs.img
	$(RKDEVELOPTOOL) rd

clean:
	rm -rf out
