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
.PHONY: help os os-rootfs-cx3576-v2 \
	os-quadlet-doc-test \
	os-image-cx3576-v2 os-verify-cx3576-v2 os-bundle-cx3576 os-devkeys os-health-test podman \
	os-shadow-test os-dbus-policy-test os-repart-test os-ui-location-test \
	os-uboot-handshake-test os-mkimage-v2-test os-mkimage-x64-test \
	os-layout-lint os-layout-lint-test os-verify-test \
	docs-verify docs-verify-test build-env

help:
	@echo "mos build targets:"
	@echo "  os                  RETIRED by PLAN-010; use the os-*-cx3576-v2 targets"
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
	@echo "  os-mkimage-v2-test  prove the v2 assembler rebuilds byte-identically, and refuses every layout mistake that would need a re-flash (docker)"
	@echo "  os-mkimage-x64-test prove the x64 assembler rebuilds byte-identically, and refuses every boot-chain mistake that leaves a machine at the UEFI shell (docker)"
	@echo "  os-layout-lint      check every board layout against the board-definition schema"
	@echo "  os-layout-lint-test prove the layout linter rejects a broken board definition, including one declared empty"
	@echo "  os-verify-test      run the os/verify bun+TypeScript suite (typecheck + bun test)"
	@echo "  docs-verify         assert both document indexes agree with the tree, in both directions"
	@echo "  docs-verify-test    prove the index assertions actually fail on a duplicated row or entry"
	@echo "  podman              build the container engine from source into os/podman/out-\$$MOS_ARCH"
	@echo "  build-env           build the pinned builder images localhost/mos-build-{base,c,go,rust}"
	@echo "  os-quadlet-doc-test run docs/design/containers.md's examples through Quadlet"
	@echo "  cx3576-<t>          delegate target <t> to board/cx3576 (uboot|kernel|rootfs|image|clean)"

# PLAN-010 moved the OS core off Talos onto systemd + mosd, which retired the
# Talos artifact build this target used to route to. It keeps a recipe rather
# than being deleted for the reason x64-% has one: with neither a recipe nor a
# rule, `make os` prints "Nothing to be done for 'os'" and exits 0 -- a
# retired build path that reports success is the failure mode every check in
# this repository exists to prevent. That reasoning is unchanged by RFCT-107
# deleting the v1 single-slot chain this message used to also name; only the
# targets it points at moved on.
os:
	@echo "os: retired by PLAN-010 (Talos base -> systemd + mosd)." >&2
	@echo "    build and verify with: make os-image-cx3576-v2 / os-verify-cx3576-v2 / os-bundle-cx3576" >&2
	@false

os-rootfs-cx3576-v2:
	bash os/rootfs/build-v2.sh

os-image-cx3576-v2:
	bash os/rootfs/build-v2.sh
	bash os/mkimage-v2.sh

os-verify-cx3576-v2:
	bash os/verify-image-v2.sh

os-bundle-cx3576:
	bash os/update/bundle.sh

os-devkeys:
	bash os/update/rauc/gen-dev-keys.sh

os-health-test:
	bash os/tests/health-test.sh

# Drives the real mos-shadow-reconcile against fixtures in a temp dir: the
# transient-root-password clearing, the mismatch branch that lets a dev image's
# ROOT_PASSWORD survive a reboot, and the pre-existing append rule. Needs no
# root and touches no host state.
os-shadow-test:
	bash os/tests/shadow-reconcile-test.sh

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
	bash os/tests/repart-loader-test.sh

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
	bash os/tests/ui-location-test.sh

# The only check in this repository that claims to prove BYTE-IDENTICAL
# rebuilds. It drives the real os/mkimage-v2.sh --assemble twice over fabricated
# BSP, rootfs-verity and factory-/var inputs and requires the two images to
# compare equal, then reads the result back with sgdisk/mdir/dumpe2fs/debugfs and
# requires every partition, unique GUID, typecode, start sector, FAT payload and
# ext4 root listing to match os/boards/cx3576/board.env.
#
# The half that is worth more than the byte comparison is the refusals, driven
# from the failing side: a stale partition number in boot.cmd, a pin the rootfs
# does not fit, a loader blob without the idbloader magic, a cmdline that lost
# dm-mod.waitfor, a RAUC slot addressed by partition number. None of those
# announce themselves on hardware -- a stale bootpart makes U-Boot persist the
# boot-attempt decrement and then fail to find Image, and the board needs
# re-flashing -- so the build refusing is the entire defence, and a refusal that
# has only ever been observed working is not evidence that it still can.
#
# It had no target from RFCT-020 until now, which is precisely why nobody
# noticed it stopped running: bb48e49 gave the assembler a mandatory FACTORY_VAR
# and did not touch the selftest, so every assembly died on the precondition and
# the byte-identity claim above went unmeasured. PLAN-014 M5/M6 hang gates on
# this instrument; it needs a name something can invoke.
#
# Needs docker. No BSP, no built image, no root -- minutes, unlike
# os-repart-test, which needs privileged docker and an image. It fails loudly
# when it cannot run rather than skipping.
#
# TMPDIR is defaulted into the gitignored _out/ because the workspace has to be
# bind-mountable by the docker daemon and a sandboxed private /tmp is not. An
# already-set TMPDIR wins, and the script still refuses by name -- printing this
# same remedy -- when whatever it ends up with is invisible to the daemon.
os-mkimage-v2-test:
	mkdir -p $(CURDIR)/_out/tmp
	TMPDIR=$${TMPDIR:-$(CURDIR)/_out/tmp} bash os/tests/mkimage-v2-selftest.sh

# The same instrument for the OTHER board, and it exists SEPARATELY FROM THE
# PORT IT PRECEDES for one reason: PLAN-014 M6c ports this assembler to
# TypeScript and will gate that port on byte-identity, and a byte-identity gate
# CANNOT SEE A DROPPED REFUSAL. A port that quietly loses the ESP cluster-count
# floor still produces identical bytes for a good input and passes the gate
# perfectly; what it stopped catching is a machine sitting at the UEFI shell
# with nothing on the console to say why. Folding this into M6c would also have
# made that port's scope "port it, and also write the test that should have
# existed", which is how ports acquire a reputation for being risky.
#
# So the half worth more than the byte comparison is again the refusals, and
# again they are driven FROM THE FAILING SIDE -- an ESP sized below the 65525
# clusters FAT32 requires (mkfs.vfat writes a FAT32 boot sector over it and
# reports success; OVMF leaves the partition out of its device list entirely), a
# grubenv that is not exactly 1024 bytes (GRUB ignores it silently, which looks
# exactly like an A/B order that never changes), a dm-verity root hash baked
# into the one file RAUC never rewrites, a per-slot kernel on the ESP no install
# could ever replace, two boot slots that do not carry the same files, an
# exported /var with no dpkg database, and a timestamp the seeding pass cannot
# write. Every one of them names the assertion it expects BY IDENTITY and the
# harness diffs that against the set that actually fired, so a case that trips
# the wrong guard on the way is a FAIL rather than a pass -- and the register of
# identities is itself checked against the shipped source first, because a row
# naming a message the code can no longer produce asserts nothing while looking
# exactly like coverage.
#
# Byte-identity is asserted as IDENTITY, never as a byte delta: the single
# seeding-time defect RFCT-106 closed measured 465, 467, 562 or 925 differing
# bytes depending only on the gap between the two assemblies and on whether
# relatime had bumped the fixture's atimes that day, so a pinned count would be
# flaky for a reason that has nothing to do with the code.
#
# Fixture-based like its sibling and cheaper: no BSP, no U-Boot blobs, no
# boot.scr to compile, no built image and no root -- synthetic kernel, initrd,
# rootfs-verity and a fabricated factory /var are the whole input set, which is
# what keeps it in the cheap CI lane RFCT-086 records. Needs docker, and it
# fails loudly when it cannot run rather than skipping.
#
# The assembler takes NO input from the environment -- it derives its layout,
# its grub.cfg and its output directory from its own location -- so the
# selftest copies those four files into its workspace and runs the shipped
# script there. Nothing is written to the developer's _out/x64. TMPDIR is
# defaulted into the gitignored _out/ for the same reason as above: the
# workspace has to be bind-mountable by the docker daemon and a sandboxed
# private /tmp is not.
os-mkimage-x64-test:
	mkdir -p $(CURDIR)/_out/tmp
	TMPDIR=$${TMPDIR:-$(CURDIR)/_out/tmp} bash os/tests/mkimage-x64-selftest.sh

# SPIKE RFCT-087: executes the SHIPPED os/boards/cx3576/boot.cmd — compiled by
# the same mkimage invocation the assembler uses, byte-unmodified — under a
# U-Boot v2026.07 sandbox binary (same source pin as the board build) that
# carries the board's persistent-env contract, against a layout-v2 GPT disk
# backed by a host file. Proves the A/B handshake state machine across real
# process invocations: the boot-attempt decrement persists 3->2->1->0, the
# other slot is chosen at zero, exhaustion refills to 3, a slot missing its
# mos-verity-<slot>.env is burned, and a returning booti burns the slot it
# tried. Needs docker; network only on the first (uncached) build, offline
# afterwards. See os/tests/handshake-test/harness.sh for the execution model,
# including the one emulated transition (kernel handoff) and why.
os-uboot-handshake-test:
	bash os/tests/handshake-test/run.sh

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
#
# THE NAMES ARE KEPT AND WHAT THEY RUN CHANGED (RFCT-109 M3b). Both targets used
# to run a shell pair that `source`d each board definition; they now run the
# TypeScript port, which parses it. RFCT-109's scope allows either keeping these
# names or registering successors, and keeping them is the smaller change: they
# are what the help lists, what two board.env files cite and what a person
# types, and what moved is the implementation, not the question being asked.
#
# Both go through os/verify/run.sh so that there is exactly ONE place deciding
# how bun is invoked -- which is what let the pinned-bun container become a
# second route inside that one function rather than a second way in. These two
# targets used to run on bare bash; since the lint was ported they need bun,
# and on a host without one they run it in the container pinned as IMAGE_BUN_1.
# os-layout-lint-test is os-verify-test filtered to the lint's own cases;
# run.sh's vacuity guard counts `Ran N tests`, so a filter that matched nothing
# is red rather than green.
os-layout-lint:
	bash os/verify/run.sh --lint

os-layout-lint-test:
	bash os/verify/run.sh src/lint.test.ts

# PLAN-014 M3: the bun+TypeScript foundation, entered through one script.
#
# os/verify/run.sh finds bun, installs the dev dependencies if they are absent,
# typechecks and runs the suite -- and turns a run that asserted nothing red,
# which bun does not: measured with bun 1.4.0, `bun test` exits 0 on a test file
# that declares no tests. A host with no bun runs all of that in the container
# pinned as IMAGE_BUN_1 in os/build-env/images.env, automatically and with the
# route announced; CI installs no bun, so that is the route it takes.
os-verify-test:
	bash os/verify/run.sh

# Every shell script that enables pipefail, checked for an early-exiting reader
# on the right of a pipe. `producer | grep -q PATTERN` inverts its own answer
# there: -q exits at the first match, the producer dies of SIGPIPE, and pipefail
# hands back that failure -- so the pipeline reports "not found" BECAUSE the
# pattern was found. It cost this tree a false PASS on the assertion that only
# one D-Bus policy names com.mos.mosd, and another on the members the MQTT
# bridge is forbidden to be granted. The rationale is at the top of the script.
# RAUC, built from upstream source instead of installed from Debian. The reason
# is measured and recorded in os/update/rauc/versions.env: the distribution builds it
# with streaming on, that links libcurl-gnutls, and rauc was the ONLY consumer
# of that library in the whole packed root -- it brought GnuTLS, p11-kit, GMP,
# Nettle and Kerberos into a signed image for an install path this project
# defers. Built here it links libc, libcrypto, libfdisk, glib and json-glib,
# all of which the image already carries.
os-rauc:
	MOS_BOARD=$(or $(MOS_BOARD),cx3576) bash os/update/rauc/build.sh

os-shell-pipefail-lint:
	bash os/tests/shell-pipefail-lint.sh

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
	bash os/tests/quadlet-doc-test.sh

# PLAN-012 M1: the container engine, built from upstream source into seven
# aarch64 binaries. Same arrangement as the board artifact builds -- a
# Dockerfile whose last stage is FROM scratch, exported with -o. Dynamically
# linked against the image's glibc except catatonit, which is copied into
# containers and must not depend on this image's libc; os/podman/README.md
# has the reasoning.
podman:
	bash os/podman/build.sh

# PLAN-014 M2: the builder image every component build stands on, built from a
# base pinned by DIGEST in os/build-env/images.env rather than by a tag upstream
# repoints whenever it rebuilds. Decision 4 rejected the official `golang:` /
# `rust:` images for the same reason podman and rauc are built from source here:
# a build environment nobody chose is a shipped dependency nobody recorded, and
# "what did this build run on" has to be answerable from the tree rather than
# from a build log.
#
# mos-build-base carries only the language-independent floor -- ca-certificates,
# git, file, binutils, xz -- and ASSERTS that floor from inside itself, so an apt
# archive that moved backwards fails the build rather than the component two
# images above it. mos-build-{c,go,rust} are FROM it and each keeps its OWN apt
# list: one shared list is one cache key for unrelated compilers, and
# os/podman/Dockerfile measured what that costs at about 42 minutes of
# recompilation for a one-package edit.
#
# WHAT EACH ONE ASSERTS, AND WHY THE TWO KINDS DIFFER. mos-build-c's gcc comes
# from apt against live deb.debian.org, which no digest here pins, so it asserts
# version FLOORS -- an exact match would go red on the next trixie point release.
# mos-build-go and mos-build-rust install tarballs pinned by sha256, so they
# assert EXACT versions: there the version is a fact the tree owns.
#
# All four assert by USE as well as by number: each compiles and links a program
# and reads the architecture back out of the ELF, because a version string
# answers on an image with no libc headers, no linker and no std for its target.
# mos-build-go and mos-build-rust also link for the OTHER architecture, which is
# what the device builds actually need.
#
# Needs docker. MOS_BUILD_PLATFORM=linux/<arch> cross-builds it; the default is
# the host. It fails loudly when a pin is missing, unresolved or written as a
# tag rather than skipping.
build-env:
	bash os/build-env/build.sh

cx3576-%:
	$(MAKE) -C board/cx3576 $*

x64-%:
	@echo "x64 has no BSP build; use the talos image pipeline (board/x64/README.md)" && false

# The apid API suite: boot the x64 image in QEMU with apid's port forwarded,
# wait for the daemon to answer, and drive it over a real socket. It is the
# only thing in this repository that TALKS TO apid rather than reading it --
# os-verify-cx3576-v2 inspects the binary and the image, mosd's own tests
# exercise handlers in-process, and neither can tell a route that exists in
# routes.rs from a route the running daemon actually serves. A session cookie
# that is missing Secure, a redirect that names a port nothing can reach, an
# auth gate that lets one route through unauthenticated: all of them are
# invisible from inside the process and obvious from outside it.
#
# IT BUILDS NOTHING and assumes _out/x64/x64-mos-v2-latest.img already exists;
# a missing image is refused by name, with the two commands that make it. A
# target that quietly rebuilt would turn a check into a forty-minute build and
# would then be testing the tree rather than the artefact under test.
#
# THE RUN DIRECTORY IS SHARED. os/tools/qemu-run.sh boots out of the single fixed
# path _out/x64/.qemu, which the x64 verification line uses too, so this target
# and that line CANNOT RUN AT ONCE -- two runs overwrite each other's disk.img
# and the loser fails somewhere unrelated. The harness refuses to start while
# another container holds that directory rather than discovering the collision
# halfway through a nine-minute boot.
#
# `bash test/apid-api/run.sh --dry-run` performs the preconditions and the
# network discovery and boots nothing; it is how to check the harness in
# seconds. Needs docker, and it fails loudly when it cannot run rather than
# skipping.
#
# Declared phony on its own line rather than added to the grouped .PHONY above,
# so appending this target changes nothing that was already here.
.PHONY: os-apid-api-test
os-apid-api-test:
	bash test/apid-api/run.sh
