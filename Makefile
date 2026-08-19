# mos top-level build entry. Heavy lifting stays in each component; this file
# only routes. Board targets: make <board>-<component>, e.g. cx3576-kernel.

BOARDS := cx3576 x64

.PHONY: help os os-image-cx3576 os-verify-cx3576 os-rootfs-cx3576-v2 \
	os-image-cx3576-v2 os-verify-cx3576-v2 os-bundle-cx3576 os-devkeys os-health-test \
	os-repart-test docs-verify \
	$(addsuffix -%,$(BOARDS))

help:
	@echo "mos build targets:"
	@echo "  os                  build the Talos-based OS artifacts (see talos/)"
	@echo "  os-image-cx3576     build the cx3576 mos disk image (rootfs + BSP artifacts; BOARD_DIR=...)"
	@echo "  os-verify-cx3576    verify the assembled cx3576 mos disk image against the image contract"
	@echo "v2 (A/B layout, squashfs+dm-verity rootfs, RAUC updates):"
	@echo "  os-rootfs-cx3576-v2 build the squashfs+dm-verity rootfs slot image"
	@echo "  os-image-cx3576-v2  build the cx3576 A/B disk image (layout v2)"
	@echo "  os-verify-cx3576-v2 verify the assembled v2 image against the v2 image contract"
	@echo "  os-bundle-cx3576    build the RAUC update bundle"
	@echo "  os-devkeys          generate the gitignored development signing material"
	@echo "  os-health-test      run the offline tests for the health gate and machine-id oneshots"
	@echo "  os-repart-test      prove first-boot repart growth grows DATA and cannot wipe the loader (privileged docker)"
	@echo "  docs-verify         assert both document indexes agree with the tree, in both directions"
	@echo "  cx3576-<t>          delegate target <t> to board/cx3576 (uboot|kernel|rootfs|image|clean)"
	@echo "  x64-image           x64 uses the upstream talos image pipeline (see board/x64/README.md)"

os:
	$(MAKE) -C talos

os-image-cx3576:
	bash os/rootfs/build.sh
	bash os/mkimage.sh

os-verify-cx3576:
	bash os/verify-image.sh

os-rootfs-cx3576-v2:
	bash os/rootfs/build-v2.sh

os-image-cx3576-v2:
	bash os/rootfs/build-v2.sh
	bash os/mkimage-v2.sh

os-verify-cx3576-v2:
	bash os/verify-image-v2.sh

os-bundle-cx3576:
	bash os/bundle.sh

os-devkeys:
	bash os/rauc/gen-dev-keys.sh

os-health-test:
	bash os/health/test.sh

# Behavioural check on first-boot growth: a real systemd-repart, with discard
# enabled, over a copy of each assembled image on a loop device. It proves two
# things the image contract cannot — that growth does not wipe the Rockchip
# idbloader at LBA 64, and that the definitions the v2 image ships actually GROW
# DATA rather than refusing the run (a refusal looks exactly like a clean exit).
# Needs privileged docker, so it is a dedicated target rather than part of
# os-verify; it fails loudly when it cannot run rather than skipping.
os-repart-test:
	bash os/repart-loader-test.sh

# Structural check on the two document indexes. It exists because the indexes
# are the one thing no other check can reach: a document that is never listed
# in docs/README.md is not broken, does not fail a build, and is simply never
# found again. That drift is measured, not hypothetical -- three design
# documents had accumulated in the tree unlisted (docs/task/RFCT-045.md). Both
# directions are asserted, because the forward half alone passes happily on an
# index full of entries pointing at files a rename deleted.
docs-verify:
	bash docs/verify-index.sh

cx3576-%:
	$(MAKE) -C board/cx3576 $*

x64-%:
	@echo "x64 has no BSP build; use the talos image pipeline (board/x64/README.md)" && false
