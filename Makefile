# mos top-level build entry. Heavy lifting stays in each component; this file
# only routes. Board targets: make <board>-<component>, e.g. cx3576-kernel.

BOARDS := cx3576 x64

# The <board>-% delegation rules are NOT listed here: .PHONY does not accept
# patterns, so an entry like `cx3576-%` matches nothing and silently declares
# nothing -- the delegated targets stayed shadowable by a file of the same
# name the whole time it was listed. They stay pattern rules (unlisted) because
# the delegated names are open-ended; a stray file named e.g. `cx3576-kernel`
# in this directory would shadow the delegation, which is a visible "Nothing to
# be done" rather than a wrong build.
.PHONY: help os os-image-cx3576 os-verify-cx3576 os-rootfs-cx3576-v2 \
	os-quadlet-doc-test \
	os-image-cx3576-v2 os-verify-cx3576-v2 os-bundle-cx3576 os-devkeys os-health-test podman \
	os-shadow-test os-dbus-policy-test os-repart-test os-ui-location-test \
	os-uboot-handshake-test os-layout-lint os-layout-lint-test \
	docs-verify docs-verify-test

help:
	@echo "mos build targets:"
	@echo "  os                  RETIRED by PLAN-010; use the os-*-cx3576-v2 targets"
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
	@echo "  os-layout-lint      check every board layout against the board-definition schema"
	@echo "  os-layout-lint-test prove the layout linter rejects a broken board definition"
	@echo "  docs-verify         assert both document indexes agree with the tree, in both directions"
	@echo "  docs-verify-test    prove the index assertions actually fail on a duplicated row or entry"
	@echo "  podman              build the container engine from source into os/podman/out-\$$MOS_ARCH"
	@echo "  os-quadlet-doc-test run docs/design/containers.md's examples through Quadlet"
	@echo "  cx3576-<t>          delegate target <t> to board/cx3576 (uboot|kernel|rootfs|image|clean)"

# PLAN-010 moved the OS core off Talos onto systemd + mosd, which retired the
# Talos artifact build this target used to route to. It keeps a recipe rather
# than being deleted for the reason x64-% has one: with neither a recipe nor a
# rule, `make os` prints "Nothing to be done for 'os'" and exits 0 -- a
# retired build path that reports success is the failure mode every check in
# this repository exists to prevent.
os:
	@echo "os: retired by PLAN-010 (Talos base -> systemd + mosd)." >&2
	@echo "    v1 image: make os-image-cx3576 / os-verify-cx3576" >&2
	@echo "    v2 (A/B): make os-image-cx3576-v2 / os-verify-cx3576-v2 / os-bundle-cx3576" >&2
	@false

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
# with a deeper /srv/ui entry, a root tree with a UI bundle BAKED under /srv/ui,
# an asset tree shipped at the reserved /builtin prefix, an apid binary that no
# longer carries the built-in escape page -- and requires each assertion to
# fail, with its own message rather than merely a non-zero exit.
#
# It proves what the image contract cannot: that those assertions can fail at
# all. os-verify-cx3576-v2 runs them against the assembled image and they pass,
# which is one direction, and one direction is not evidence -- the checks
# docs/design/api.md section 5.2 leans on are about /srv AS A PARTITION and
# would go on passing after somebody moved the UI root to /var/lib, taking every
# custom UI on every device with it.
#
# Fixture mode also runs the packed-root mountpoint check the custom-UI
# assertions CHAIN to, and the /srv-absent case requires that check to go red
# with its own message. Six UI passes alone prove only that they do not
# RE-DERIVE mountpoint existence; they do not prove anything still catches a
# missing /srv, and from outside the two look the same. That check had only
# ever been observed passing, because it runs against real images where /srv is
# always there.
#
# Every case names the assertions it expects BY IDENTITY and the harness diffs
# that against what ran. It does not count PASS lines: a count breaks whenever
# fixture mode is widened, and the obvious repair -- exit 0 with no FAIL lines
# -- is invariant under a run in which nothing executed, which would silently
# turn the /srv-absent case from a proof of chaining into a proof of nothing.
# Needs no root, no image and no docker, and it fails loudly when it cannot run
# rather than skipping.
os-ui-location-test:
	bash os/ui-location-test.sh

# SPIKE RFCT-087: executes the SHIPPED os/boot/cx3576-boot.cmd — compiled by
# the same mkimage invocation the assembler uses, byte-unmodified — under a
# U-Boot v2026.07 sandbox binary (same source pin as the board build) that
# carries the board's persistent-env contract, against a layout-v2 GPT disk
# backed by a host file. Proves the A/B handshake state machine across real
# process invocations: the boot-attempt decrement persists 3->2->1->0, the
# other slot is chosen at zero, exhaustion refills to 3, a slot missing its
# mos-verity-<slot>.env is burned, and a returning booti burns the slot it
# tried. Needs docker; network only on the first (uncached) build, offline
# afterwards. See os/boot/handshake-test/harness.sh for the execution model,
# including the one emulated transition (kernel handoff) and why.
os-uboot-handshake-test:
	bash os/boot/handshake-test/run.sh

# Structural check on the two document indexes. It exists because the indexes
# are the one thing no other check can reach: a document that is never listed
# in docs/README.md is not broken, does not fail a build, and is simply never
# found again. That drift is measured, not hypothetical -- three design
# documents had accumulated in the tree unlisted (docs/task/RFCT-045.md). Both
# directions are asserted, because the forward half alone passes happily on an
# index full of entries pointing at files a rename deleted.
# A board is defined by its layout file and the shared scripts read that
# definition rather than knowing any board's shape. This checks the definition
# is complete AND that no board declares a key its role cannot honour -- the
# second direction is what would have caught BOOT_ATTEMPTS_DEFAULT sitting in
# the grub board's layout before RAUC refused it on the device.
os-layout-lint:
	bash os/layout/lint.sh

os-layout-lint-test:
	bash os/layout/lint-test.sh

docs-verify:
	bash docs/verify-index.sh

# Negative tests for the target above, added because it had a hole exactly the
# shape of the merges this repository performs: with a second (RFCT-073.md) row
# injected into docs/task/index.md it reported 162/162 PASS and exit 0 -- the
# count did not even move, so the before/after count comparison could not see it
# either. Forward was a `grep -q`, satisfied by one occurrence or by five, and
# reverse deduplicated with `sort -u` before the loop that would have noticed. A
# duplicated row is the likeliest wrong resolution of the two-row append
# conflict every task record produces, so it is the one failure mode that most
# needed to be reachable. Each assertion is driven against an index where its
# fact is false and required to fail with ITS OWN message. Needs no root and no
# network, and it fails loudly when it cannot run rather than skipping.
docs-verify-test:
	bash docs/verify-index-test.sh

# PLAN-012 M4: every example in docs/design/containers.md, fed to the aarch64
# Quadlet generator the image ships. A configuration example nothing executes
# is a claim that cannot fail; this makes the document part of the suite.
os-quadlet-doc-test:
	bash os/quadlet-doc-test.sh

# PLAN-012 M1: the container engine, built from upstream source into seven
# aarch64 binaries. Same arrangement as the board artifact builds -- a
# Dockerfile whose last stage is FROM scratch, exported with -o. Dynamically
# linked against the image's glibc except catatonit, which is copied into
# containers and must not depend on this image's libc; os/podman/README.md
# has the reasoning.
podman:
	bash os/podman/build.sh

cx3576-%:
	$(MAKE) -C board/cx3576 $*

x64-%:
	@echo "x64 has no BSP build; use the talos image pipeline (board/x64/README.md)" && false
