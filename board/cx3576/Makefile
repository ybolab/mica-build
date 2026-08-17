# CX3576-Z build entry — targets documented in the Dockerfile headers.
# Requires docker buildx; on x86 hosts run once: docker run --privileged --rm tonistiigi/binfmt --install arm64

OUT ?= out
ROOTFS ?= alpine-rom

.PHONY: all uboot kernel rootfs image clean

all: image

uboot:
	docker buildx build -f uboot/Dockerfile -o $(OUT)/uboot uboot

kernel:
	docker buildx build -f kernel/Dockerfile -o $(OUT)/kernel .

rootfs:
	docker buildx build -f rootfs/$(ROOTFS)/Dockerfile -o $(OUT)/rootfs .

image:
	docker buildx build -f Dockerfile.alpine -o $(OUT) .

clean:
	rm -rf $(OUT)
