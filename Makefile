# mos top-level build entry. Heavy lifting stays in each component; this file
# only routes. Board targets: make <board>-<component>, e.g. cx3576-kernel.

BOARDS := cx3576 x64

.PHONY: help os os-image-cx3576 os-verify-cx3576 os-rootfs-cx3576-v2 \
	os-image-cx3576-v2 os-verify-cx3576-v2 os-bundle-cx3576 os-devkeys os-health-test \
	os-shadow-test os-dbus-policy-test os-repart-test os-ui-location-test docs-verify \
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
	@echo "  os-shadow-test      run the offline tests for the STATE /etc/shadow reconciler"
	@echo "  os-dbus-policy-test prove the shipped mosd D-Bus policy is root-only against a real dbus-daemon"
	@echo "  os-repart-test      prove first-boot repart growth grows DATA and cannot wipe the loader (privileged docker)"
	@echo "  os-ui-location-test prove the custom-UI location assertions in the v2 verifier actually fail when the location moves"
	@echo "  docs-verify         assert both document indexes agree with the tree, in both directions"
	@echo "  cx3576-<t>          delegate target <t> to board/cx3576 (uboot|kernel|rootfs|image|clean)"

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

# Drives the real mos-shadow-reconcile against fixtures in a temp dir: the
# transient-root-password clearing, the mismatch branch that lets a dev image's
# ROOT_PASSWORD survive a reboot, and the pre-existing append rule. Needs no
# root and touches no host state.
os-shadow-test:
	bash os/shadow-reconcile-test.sh

# Stands up a real dbus-daemon whose configuration <include>s the SHIPPED
# mosd/dist/com.mos.mosd.conf, owns com.mos.mosd from a root connection, and
# drives root and non-root clients at it. Reading the XML back would only prove
# the file says the right thing; this proves dbus-daemon acts on it. Both
# directions of every guard — a refusal-only suite passes just as well against a
# policy that denies root too. Needs root (it drops to uid 65534 with setpriv)
# and fails loudly when it cannot run rather than skipping.
os-dbus-policy-test:
	bash mosd/hack/dbus-policy-test.sh

# Behavioural check on first-boot growth: a real systemd-repart, with discard
# enabled, over a copy of each assembled image on a loop device. It proves two
# things the image contract cannot — that growth does not wipe the Rockchip
# idbloader at LBA 64, and that the definitions the v2 image ships actually GROW
# DATA rather than refusing the run (a refusal looks exactly like a clean exit).
# Needs privileged docker, so it is a dedicated target rather than part of
# os-verify; it fails loudly when it cannot run rather than skipping.
os-repart-test:
	bash os/repart-loader-test.sh

# Drives the real os/verify-image-v2.sh against mutated fixtures -- an fstab
# with /srv moved onto EPHEMERAL or STATE, one stripped of x-systemd.growfs, one
# with a deeper /srv/ui entry, a root tree with a UI bundle BAKED under /srv/ui
# -- and requires each custom-UI assertion to fail, with its own message rather
# than merely a non-zero exit.
#
# It proves what the image contract cannot: that those assertions can fail at
# all. os-verify-cx3576-v2 runs them against the assembled image and they pass,
# which is one direction, and one direction is not evidence -- the checks
# docs/design/api.md section 5.2 leans on are about /srv AS A PARTITION and
# would go on passing after somebody moved the UI root to /var/lib, taking every
# custom UI on every device with it.
#
# Two cases deliberately expect ALL SIX to pass: the unmutated baseline, and a
# tree with /srv removed. The second is the proof that mountpoint existence is
# CHAINED to the mountpoint-exists check rather than re-derived -- a UI
# assertion that also fired there would be a parallel copy adding a line and no
# coverage. Needs no root, no image and no docker, and it fails loudly when it
# cannot run rather than skipping.
os-ui-location-test:
	bash os/ui-location-test.sh

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
