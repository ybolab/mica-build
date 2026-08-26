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
	os-shadow-test os-dbus-policy-test os-repart-test \
	os-uboot-handshake-test \
	os-layout-lint os-layout-lint-test os-verify-test os-build-test \
	docs-verify docs-verify-test build-env

help:
	@echo "mos build targets:"
	@echo "  os                  RETIRED by PLAN-010; use the os-*-cx3576-v2 targets"
	@echo "v2 (A/B layout, squashfs+dm-verity rootfs, RAUC updates):"
	@echo "  os-rootfs-cx3576-v2 build the squashfs+dm-verity rootfs slot image"
	@echo "  os-image-cx3576-v2  build the cx3576 A/B disk image (layout v2)"
	@echo "  os-verify-cx3576-v2 verify the assembled v2 image against the v2 image contract (docker)"
	@echo "  os-bundle-cx3576    build the RAUC update bundle"
	@echo "  os-devkeys          generate the gitignored development signing material"
	@echo "  os-health-test      run the offline tests for the health gate and machine-id oneshots"
	@echo "  os-shadow-test      run the offline tests for the STATE /etc/shadow reconciler"
	@echo "  os-dbus-policy-test prove the shipped mosd D-Bus policy is root-only against a real dbus-daemon"
	@echo "  os-repart-test      prove first-boot repart growth grows DATA and cannot wipe the loader (privileged docker)"
	@echo "  os-layout-lint      check every board layout against the board-definition schema"
	@echo "  os-layout-lint-test prove the layout linter rejects a broken board definition, including one declared empty"
	@echo "  os-verify-test      run the os/verify bun+TypeScript suite (typecheck + bun test)"
	@echo "  os-build-test       run the os/build bun+TypeScript suite: board geometry and the toolset wrappers (docker)"
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

# THE SHIPPING ASSEMBLER, and since PLAN-014 M6e it is the TypeScript one.
# os/mkimage-v2.sh was this until RFCT-112 M6e ported it into os/build/ and
# deleted it, at byte-identity: four images from the two implementations over
# identical inputs, one sha256 (f36bf809...), with a one-byte control that moved
# both to the same new hash and back. os/build/HARNESS.md carries the recipe.
os-image-cx3576-v2:
	bash os/rootfs/build-v2.sh
	bash os/build/run.sh --mkimage-v2

# THE IMAGE CONTRACT. os/verify-image-v2.sh was this until RFCT-110 M4e ported
# it into os/verify/ and deleted it; src/verify-cli.ts prints the same
# PASS/FAIL/SKIP lines and the same RESULT line, and reproduced both boards'
# summary counts exactly at the port's tip.
#
# Needs DOCKER on a host without sgdisk/mtools/debugfs/unsquashfs/veritysetup --
# it reads them out of the pinned IMAGE_ALPINE_3_21, exactly as the deleted
# script re-exec'd into it. Verify the other board with --board.
os-verify-cx3576-v2:
	bash os/verify/run.sh --verify --board cx3576

# Likewise: os/update/bundle.sh was this until M6e. Gated the same way, on the
# squashfs PAYLOAD rather than the file -- rauc salts the bundle's own verity
# hash tree at random and the CMS signature carries a signingTime, so the file
# hash moves every run and a file comparison would be flaky for a reason that
# has nothing to do with the code. Both boards were gated; --board x64 builds
# the grub branch.
os-bundle-cx3576:
	bash os/build/run.sh --bundle

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

# os-ui-location-test WAS HERE, and it went with the verifier it drove.
#
# It ran the REAL os/verify-image-v2.sh once per case against a mutated fixture
# root -- an fstab with /srv moved onto EPHEMERAL or STATE, one stripped of
# x-systemd.growfs, a UI bundle BAKED under /srv/ui, an asset tree at the
# reserved /builtin prefix -- and required each assertion to fail with its own
# message. With that script deleted (RFCT-110 M4e) the suite has nothing to
# drive: it read the verifier's own source for constants and shelled out to it
# 59 times. It is one of the "now-ported fixture suites" RFCT-110's scope names.
#
# WHAT IT PROVED IS NOT LOST, and that is the condition under which it went.
# Every one of its seven UI identities is a case in os/verify/src/checks-fstab.ts
# with failing-side tests beside it in checks-fstab.test.ts -- /srv moved onto
# STATE, moved onto the wipeable /var, content baked under the UI root, the
# reserved prefix, and the packed-root mountpoint check the UI assertions CHAIN
# to. Those run under `make os-verify-test`, need no image and no docker, and
# are driven from the failing side, which is what os-ui-location-test existed
# to guarantee.

# os-mkimage-v2-test AND os-mkimage-x64-test WERE HERE, and both went with the
# assemblers they drove (PLAN-014 M6e, RFCT-112).
#
# Each ran the REAL shell assembler -- `bash os/mkimage-v2.sh --assemble`,
# `bash os/mkimage-x64.sh` -- twice over fabricated inputs, required the two
# images to compare EQUAL, then read the result back with sgdisk/mdir/dumpe2fs/
# debugfs/minfo and required every partition, GUID, typecode, start sector, FAT
# payload and ext4 root listing to match the board definition. 166 and 196
# assertions. With those scripts deleted there is nothing left to drive: the v2
# suite shelled out to the assembler by path, and the x64 suite SCRAPED the
# images.env key out of it with `from.sh --ref <KEY>` on a single line.
#
# They are REMOVED rather than repointed, and that is the honest outcome. A
# target that still exists and passes because nothing is behind it is worse than
# no target -- it reads as coverage from the one place people look for coverage.
# Repointing them at the TypeScript assemblers would have meant rewriting both
# harnesses around a different invocation, which is a port, not a repoint.
#
# WHAT THEY PROVED IS NOT LOST, and that is the condition under which they went.
#
#   BYTE-IDENTICAL REBUILDS. This was their headline claim and it is now made by
#   a stronger instrument. `src/mkimage-v2.test.ts` and `src/mkimage-x64.test.ts`
#   each assemble repeatedly from fabricated inputs and require identity, AND
#   each carries the live control the selftests never had -- one changed input,
#   images that compare UNEQUAL -- so "identical" cannot be a comparison that
#   always passes. Above that, RFCT-112's gate compared the deleted shell
#   against the port over the SAME real inputs and got one sha256 per board.
#
#   THE REFUSALS, which are worth more than the byte comparison, because none of
#   them announce themselves on hardware -- a stale bootpart makes U-Boot persist
#   the boot-attempt decrement and then fail to find Image, and the board needs
#   re-flashing. All 33 of os/mkimage-v2.sh's and all 14 reachable ones of
#   os/mkimage-x64.sh + os/mkimage-common.sh are ported, each driven from the
#   FAILING side with a positive control beside it. os/build/HARNESS.md tables
#   them one by one against the site that drives each red.
#
# Both ran green immediately before they were deleted -- 166 and 196, rc=0 --
# so they went at parity rather than in place of a failure.
#
# They run under `make os-build-test`, which needs docker and no BSP, no built
# image and no root, exactly as they did.

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

# os-verify-parity WAS HERE, and it is removed rather than kept able to refuse.
#
# It ran os/verify-image-v2.sh and the os/verify register against the SAME image
# and diffed their conclusions PER CHECK, by identity rather than by count. Its
# one input was the oracle. With the oracle deleted the target could only refuse
# every time or pass having compared nothing, and a target that passes because
# there is nothing left to compare is the worst outcome available here -- it
# reads exactly like a gate that is still being held.
#
# The gate it held is recorded, not re-runnable. Its last run, at the port's tip:
#     cx3576  PASS  compared 398, diverging 0, UNCLAIMED 0 of 398
#     x64     PASS  compared 312, diverging 0, UNCLAIMED 0 of 312   rc=0
# os/verify/HARNESS.md carries that and what the deletion froze.

# PLAN-014 M6a: the TypeScript build driver -- the typed board geometry the
# assemblers will read, and the Bun.$ wrappers for the toolset they will drive.
#
# It needs DOCKER, which os-verify-test does not: the suite runs sgdisk, mtools,
# mkimage, veritysetup, e2fsprogs and rauc for real, and this host has none of
# the first four. Each runs on the host where the host has it and in the image
# pinned for its toolset otherwise -- the same rule os/mkimage-v2.sh's
# host_can_assemble() applied before M6e deleted it, now src/toolbox.ts's. Nothing is skipped: a tool
# reachable neither way is a failure, not a gap.
os-build-test:
	bash os/build/run.sh

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
