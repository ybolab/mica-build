# CX3576-Z build entry — targets documented in the Dockerfile headers.
# Requires docker buildx; on x86 hosts run once: docker run --privileged --rm tonistiigi/binfmt --install arm64

OUT ?= out
ROOTFS ?= alpine

.PHONY: all uboot kernel rootfs image clean

all: image

uboot:
	docker buildx build -f uboot/Dockerfile -o $(OUT)/uboot uboot

kernel:
	docker buildx build --build-context mos-common=../common -f kernel/Dockerfile -o $(OUT)/kernel .

# The rootfs context is the variant directory itself: the Dockerfile installs
# rootfs/alpine/rootfs/ onto / with a single COPY. Kernel modules and firmware
# come from named contexts so they stay out of that overlay.
rootfs:
	docker buildx build --platform linux/arm64 \
		--build-context kernel-out=$(OUT)/kernel \
		--build-context firmware=rootfs/firmware \
		-f rootfs/$(ROOTFS)/Dockerfile -o $(OUT)/rootfs rootfs/$(ROOTFS)

image:
	docker buildx build -f Dockerfile.alpine -o $(OUT) .

clean:
	rm -rf $(OUT)
