# mos top-level build entry. Heavy lifting stays in each component; this file
# only routes. Board targets: make <board>-<component>, e.g. cx3576-kernel.

BOARDS := cx3576 x64

.PHONY: help os $(addsuffix -%,$(BOARDS))

help:
	@echo "mos build targets:"
	@echo "  os               build the Talos-based OS artifacts (see talos/)"
	@echo "  cx3576-<t>       delegate target <t> to board/cx3576 (uboot|kernel|rootfs|image|clean)"
	@echo "  x64-image        x64 uses the upstream talos image pipeline (see board/x64/README.md)"

os:
	$(MAKE) -C talos

cx3576-%:
	$(MAKE) -C board/cx3576 $*

x64-%:
	@echo "x64 has no BSP build; use the talos image pipeline (board/x64/README.md)" && false
