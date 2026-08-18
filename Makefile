# mos top-level build entry. Heavy lifting stays in each component; this file
# only routes. Board targets: make <board>-<component>, e.g. cx3576-kernel.

BOARDS := cx3576 x64

.PHONY: help os os-image-cx3576 os-verify-cx3576 os-health-test $(addsuffix -%,$(BOARDS))

help:
	@echo "mos build targets:"
	@echo "  os               build the Talos-based OS artifacts (see talos/)"
	@echo "  os-image-cx3576  build the cx3576 mos disk image (rootfs + BSP artifacts; BOARD_DIR=...)"
	@echo "  os-verify-cx3576 verify the assembled cx3576 mos disk image against the image contract"
	@echo "  os-health-test   run the offline tests for the health gate and machine-id oneshots"
	@echo "  cx3576-<t>       delegate target <t> to board/cx3576 (uboot|kernel|rootfs|image|clean)"
	@echo "  x64-image        x64 uses the upstream talos image pipeline (see board/x64/README.md)"

os:
	$(MAKE) -C talos

os-image-cx3576:
	bash os/rootfs/build.sh
	bash os/mkimage.sh

os-verify-cx3576:
	bash os/verify-image.sh

os-health-test:
	bash os/health/test.sh

cx3576-%:
	$(MAKE) -C board/cx3576 $*

x64-%:
	@echo "x64 has no BSP build; use the talos image pipeline (board/x64/README.md)" && false
