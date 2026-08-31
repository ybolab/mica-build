# mos top-level build entry. Heavy lifting stays in each component; this file
# only routes. Board targets: make <board>-<component>, e.g. cx3576-kernel.

BOARDS := cx3576 x64

# The <board>-% delegation rules are NOT listed here: .PHONY does not accept
# patterns, so an entry like `cx3576-%` matches nothing and silently declares
# nothing. They stay pattern rules (unlisted) because the delegated names are
# open-ended; a stray file named e.g. `cx3576-kernel` in this directory shadows
# the delegation, which is a visible "Nothing to be done" rather than a wrong
# build.
.PHONY: help os os-rootfs-cx3576-v2 \
	os-quadlet-doc-test \
	os-image-cx3576-v2 os-verify-cx3576-v2 os-bundle-cx3576 os-devkeys os-health-test podman \
	podman-pins podman-pins-test os-netavark-kernel-test \
	os-smoke-test os-smoke-negative-test os-factory-root-gate \
	os-shadow-test os-dbus-policy-test os-repart-test \
	os-uboot-handshake-test \
	os-layout-lint os-verify-test os-build-test \
	os-debs os-deb-package-gate os-install-closure-gate \
	docs-verify docs-verify-test build-env

help:
	@echo "mos build targets:"
	@echo "  os                  RETIRED; use the os-*-cx3576-v2 targets"
	@echo "v2 (A/B layout, squashfs+dm-verity rootfs, RAUC updates):"
	@echo "  os-rootfs-cx3576-v2 build the squashfs+dm-verity rootfs slot image"
	@echo "  os-image-cx3576-v2  build the cx3576 A/B disk image (layout v2)"
	@echo "  os-verify-cx3576-v2 verify the assembled v2 image against the v2 image contract (docker)"
	@echo "  os-smoke-test       execute every self-built binary inside the factory root, assert its pin (docker)"
	@echo "  os-smoke-negative-test  break that root three ways and require each to turn the run red (docker)"
	@echo "  os-factory-root-gate    prove the root the smoke run executes in is the root the device ships (docker)"
	@echo "  os-bundle-cx3576    build the RAUC update bundle"
	@echo "  os-devkeys          populate the gitignored repo-root ca/ with a development trust root"
	@echo "  os-health-test      run the offline tests for the health gate and machine-id oneshots"
	@echo "  os-shadow-test      run the offline tests for the STATE /etc/shadow reconciler"
	@echo "  os-dbus-policy-test prove the shipped mosd D-Bus policy is root-only against a real dbus-daemon"
	@echo "  os-repart-test      prove first-boot repart growth grows DATA and cannot wipe the loader (privileged docker)"
	@echo "  os-layout-lint      check every board layout against the board-definition schema"
	@echo "  os-verify-test      run the os/verify bun+TypeScript suite (typecheck + bun test)"
	@echo "  os-build-test       run the os/build bun+TypeScript suite: board geometry and the toolset wrappers (docker)"
	@echo "  docs-verify         assert docs/README.md and the design tree agree, in both directions"
	@echo "  docs-verify-test    prove those assertions actually fail on a duplicate or a missing row"
	@echo "  podman              build the container engine from source into os/pkgs/podman/out-\$$MOS_ARCH"
	@echo "  podman-pins         ask the six pinned upstreams for their newest release; red when a pin is behind (network)"
	@echo "  podman-pins-test    drive that check against recorded upstream responses, both directions (no network)"
	@echo "  os-netavark-kernel-test  assert the cx3576 kernel config carries the symbols netavark programs rules against"
	@echo "  build-env           build the pinned builder images localhost/mos-build-{base,c,deb,go,rust}:<arch>"
	@echo "  os-deb-<producer>   build one producer's Debian packages for the architectures it declares; \`bash os/build-env/deb/producers.sh\` lists them (docker)"
	@echo "  os-debs             build every Debian package for both architectures and index both pools (docker)"
	@echo "  os-deb-package-gate check the built pools: ownership, fields, reproducibility, enablement (docker)"
	@echo "  os-install-closure-gate  apt-install both pools into clean roots: closure, ldd, accounts, versions (docker)"
	@echo "  os-quadlet-doc-test run docs/design/containers.md's examples through Quadlet"
	@echo "  cx3576-<t>          delegate target <t> to os/boards/cx3576/bsp (uboot|kernel|rootfs|image|clean)"

# `make os` is retired. It keeps a recipe rather than being deleted for the
# reason x64-% has one: with neither a recipe nor a rule, `make os` prints
# "Nothing to be done for 'os'" and exits 0, and a retired build path that
# reports success is the failure mode every check in this repository exists to
# prevent.
os:
	@echo "os: retired." >&2
	@echo "    build and verify with: make os-image-cx3576-v2 / os-verify-cx3576-v2 / os-bundle-cx3576" >&2
	@false

os-rootfs-cx3576-v2:
	bash os/rootfs/build-v2.sh

# The shipping assembler: build the rootfs slot image, then write the A/B disk
# image around it.
os-image-cx3576-v2:
	bash os/rootfs/build-v2.sh
	bash os/build/run.sh --mkimage-v2

# THE IMAGE CONTRACT: read the assembled image back and check it against the
# contract, check by check.
#
# Needs DOCKER on a host without sgdisk/mtools/debugfs/unsquashfs/veritysetup --
# it reads them out of the pinned IMAGE_ALPINE_3_21. Verify the other board
# with --board.
os-verify-cx3576-v2:
	bash os/verify/run.sh --verify --board cx3576

# Every self-built binary EXECUTED inside the root that ships it, with the
# version it reports required to equal the version this repository pinned.
# `os-verify-cx3576-v2` reads the image; this one runs what is in it.
#
# THIS IS NOT THE ONLY THING THAT RUNS IT: `os/rootfs/build-v2.sh` runs the same
# command as its last step, under `set -e`, so a root whose binaries do not run
# does not become an image. This target is how to ask the question on its own,
# against a root that is already built.
#
# Needs DOCKER, and for a stronger reason than the verifier does: it executes
# binaries built for the BOARD, so the host must be able to run that platform --
# which on cx3576 means binfmt_misc. It refuses rather than skipping when the
# image is absent, and refuses before concluding anything when the host cannot
# execute it. MOS_BOARD selects the board; x64 is the default.
os-smoke-test:
	bash os/verify/run.sh --smoke

# The three negative tests, which are a check on the check above.
#
# Each builds an image from that board's real factory root carrying one
# deliberately made defect -- a wrong-arch binary, a binary whose NEEDed library
# has been taken away, a binary that reports a version other than its pin -- and
# requires the smoke run to go red naming the RIGHT cause and taking no other
# artifact with it. Every mutation asserts its own before-and-after and fails
# the image build rather than producing an unmutated image, so a case cannot
# pass without having made its defect.
#
# It is a separate target from os-smoke-test rather than a flag on it because
# these are three image builds and three deliberate defects, and putting them in
# front of every rootfs build would make "the smoke run passed" mean two
# different things depending on which invocation produced it.
os-smoke-negative-test:
	bash os/verify/run.sh --smoke-negative

# The assumption every smoke result rests on and nothing else checks: that the
# OCI image the smoke run executes in is byte-for-byte the tree the device
# ships. The two are produced by two exports of one stage, so nothing about
# their agreement is structural -- and a smoke run inside a DIFFERENT tree is a
# measurement of something that never boots.
#
# It compares the two trees four ways and then BREAKS each comparison in turn
# and requires each to go red. Needs docker (neither side is readable on the
# build host -- no unsquashfs, no getcap) and a built rootfs, like
# os-verify-cx3576-v2. MOS_BOARD selects the board; x64 is the default.
os-factory-root-gate:
	bash os/tests/factory-root-gate/gate.sh _out/$(or $(MOS_BOARD),x64)

# The RAUC update bundle. Its rebuild gate is on the squashfs PAYLOAD rather
# than on the file: rauc salts the bundle's own verity hash tree at random and
# the CMS signature carries a signingTime, so the file hash moves every run.
# --board x64 builds the grub branch.
os-bundle-cx3576:
	bash os/build/run.sh --bundle

# The MANUAL entry to the repo-root ca/, which is where every build takes its
# trust root from. Running it is optional: a build that finds ca/ empty
# generates the same material itself and says so loudly. This target exists for
# doing it on purpose, ahead of a build, and for `--force` rotation.
os-devkeys:
	bash os/pkgs/rauc/gen-dev-keys.sh

os-health-test:
	bash os/tests/health-test.sh

# Drives the real mos-shadow-reconcile against fixtures in a temp dir: the
# transient-root-password clearing, the mismatch branch that lets a dev image's
# ROOT_PASSWORD survive a reboot, and the pre-existing append rule. Needs no
# root and touches no host state.
os-shadow-test:
	bash os/tests/shadow-reconcile-test.sh

# Stands up a real dbus-daemon whose configuration <include>s the SHIPPED
# os/pkgs/mosd/dist/com.mos.mosd.conf, owns com.mos.mosd from a root connection, and
# drives root and non-root clients at it. Reading the XML back would only prove
# the file says the right thing; this proves dbus-daemon acts on it. Both
# directions of every guard — a refusal-only suite passes just as well against a
# policy that denies root too. Needs root (it drops to uid 65534 with setpriv)
# and fails loudly when it cannot run rather than skipping.
os-dbus-policy-test:
	bash os/pkgs/mosd/tests/dbus-policy-test.sh

# Behavioural check on first-boot growth: a real systemd-repart, with discard
# enabled, over a copy of each assembled image on a loop device. It proves two
# things the image contract cannot — that growth does not wipe the Rockchip
# idbloader at LBA 64, and that the definitions the v2 image ships actually GROW
# DATA rather than refusing the run (a refusal looks exactly like a clean exit).
# Needs privileged docker, so it is a dedicated target rather than part of
# os-verify; it fails loudly when it cannot run rather than skipping.
os-repart-test:
	bash os/tests/repart-loader-test.sh

# Executes the SHIPPED os/boards/cx3576/boot.cmd -- compiled by the same mkimage
# invocation the assembler uses, byte-unmodified -- under a U-Boot sandbox binary
# (same source pin as the board build) that carries the board's persistent-env
# contract, against a layout-v2 GPT disk backed by a host file. Proves the A/B
# handshake state machine across real process invocations: the boot-attempt
# decrement persists 3->2->1->0, the other slot is chosen at zero, exhaustion
# refills to 3, a slot missing its mos-verity-<slot>.env is burned, and a
# returning booti burns the slot it tried. Needs docker; network only on the
# first (uncached) build, offline afterwards. See os/tests/handshake-test/harness.sh
# for the execution model, including the one emulated transition (kernel handoff)
# and why.
os-uboot-handshake-test:
	bash os/tests/handshake-test/run.sh

# A board is defined by its layout file and the shared scripts read that
# definition rather than knowing any board's shape. This checks the definition
# is complete AND that no board declares a key its role cannot honour -- the
# second direction is what catches e.g. BOOT_ATTEMPTS_DEFAULT sitting in the
# grub board's layout, which RAUC refuses on the device.
#
# Both go through os/verify/run.sh so that there is exactly ONE place deciding
# how bun is invoked; on a host without bun they run in the container pinned as
# IMAGE_BUN_1.
os-layout-lint:
	bash os/verify/run.sh --lint

# The os/verify bun+TypeScript suite, entered through one script.
#
# os/verify/run.sh finds bun, installs the dev dependencies if they are absent,
# typechecks and runs the suite -- and turns a run that asserted nothing red,
# which bun does not: `bun test` exits 0 on a test file that declares no tests.
# A host with no bun runs all of that in the container pinned as IMAGE_BUN_1 in
# os/build-env/images.env, automatically and with the route announced; CI
# installs no bun, so that is the route it takes.
os-verify-test:
	bash os/verify/run.sh

# The TypeScript build driver: the typed board geometry the assemblers read, and
# the Bun.$ wrappers for the toolset they drive.
#
# It needs DOCKER, which os-verify-test does not: the suite runs sgdisk, mtools,
# mkimage, veritysetup, e2fsprogs and rauc for real. Each runs on the host where
# the host has it and in the image pinned for its toolset otherwise, which is
# src/toolbox.ts's rule. Nothing is skipped: a tool reachable neither way is a
# failure, not a gap.
os-build-test:
	bash os/build/run.sh

# RAUC, built from upstream source instead of installed from Debian. The reason
# is recorded in os/pkgs/rauc/versions.env: the distribution builds it with
# streaming on, that links libcurl-gnutls, and rauc is the ONLY consumer of that
# library in the whole packed root -- it would bring GnuTLS, p11-kit, GMP,
# Nettle and Kerberos into a signed image for an install path this project
# defers. Built here it links libc, libcrypto, libfdisk, glib and json-glib, all
# of which the image already carries.
os-rauc:
	MOS_BOARD=$(or $(MOS_BOARD),cx3576) bash os/pkgs/rauc/build.sh

# ONE PRODUCER, every architecture it declares, resolved against discovery.
# This is a PATTERN rule and not a list: `make os-deb-mosd`, `make os-deb-mqtt`
# and `make os-deb-<anything os/build-env/deb/producers.sh finds>` all route
# here. A producer added to the tree gets its target with no edit to this file
# -- which is the point, because the workstreams adding the next producers have
# been told to escalate rather than edit here, and that only works if there is
# nothing here for them to edit.
#
# The architectures come from the producer's own producer.env, not from a pair
# written here: seven of the packages this repository is growing are
# architecture-independent and build once as `all`, and a rule that ran every
# producer at amd64 and arm64 would build those twice and file two archives
# under one name.
#
# producers.sh resolves the stem and refuses an unknown one by name; this recipe
# does not second-guess it, so there is one message for "no such producer" and
# one implementation of what a producer is.
#
# NOT LISTED IN .PHONY: .PHONY does not accept patterns, so an `os-deb-%` entry
# there would match nothing and silently declare nothing -- the same reason the
# <board>-% delegations at the top of this file are unlisted. Shadowing needs a
# FILE named os-deb-<producer> in the repository root, whose entries are
# Makefile, README.md, LICENSE, docs/, extensions/ and os/; nothing there can
# match, and a stray one would show as a visible "Nothing to be done" rather
# than a wrong build. `os-deb-package-gate` below is an explicit target and is
# therefore not caught by this pattern: make prefers an explicit rule over a
# pattern rule that also matches.
os-deb-%:
	@set -e; \
	bash os/build-env/deb/producers.sh --dir-for '$*' >/dev/null; \
	arches="$$(bash os/build-env/deb/producers.sh | awk -v p='$*' '$$1 == p { print $$3 }' | tr ',' ' ')"; \
	for arch in $$arches; do \
	    echo "bash os/build-env/deb/build.sh --producer $* --arch $$arch"; \
	    bash os/build-env/deb/build.sh --producer '$*' --arch "$$arch"; \
	done

# THE WHOLE LOCAL POOL: every DISCOVERED producer at every architecture it
# declares, then the index beside each pool. The composer resolves its package
# set through _out/debs/<arch>/{Packages,SHA256SUMS,manifest.txt}, so a build
# that stopped before repo.sh would leave a pool APT cannot see into.
#
# No producer is named here. The set comes from os/build-env/deb/producers.sh,
# which refuses an empty discovery by name -- without that, this target would
# loop over nothing, run repo.sh over a stale pool and report success.
#
# Both pools are indexed whatever the producers declared, because an
# Architecture: all producer writes one archive into both and neither pool is
# ever "the one nothing touched".
#
# SEQUENTIAL, and this is a shell loop in ONE recipe rather than a prerequisite
# per producer for exactly that reason. Every producer writes into shared pool
# directories and each clears its own previous archives out of them with
# `rm -f <package>_*.deb`; under `make -j` two prerequisite targets would run
# that unlink and that export against the same directory at once, and repo.sh
# would index whatever survived. Recipe lines, and a loop within one, are always
# run in order whatever -j says.
#
# producers.sh is CAPTURED before it is read, never piped straight into the
# `while`: `producer | while` reports the reader's status, so an empty
# discovery -- the one failure this target most needs to see -- would be
# swallowed and this would report success over no producers at all.
os-debs:
	@set -e; \
	rows="$$(bash os/build-env/deb/producers.sh)"; \
	printf '%s\n' "$$rows" | while read -r producer dir arches packages enablement; do \
	    for arch in $$(printf '%s' "$$arches" | tr ',' ' '); do \
	        echo "bash os/build-env/deb/build.sh --producer $$producer --arch $$arch  ($$dir)"; \
	        bash os/build-env/deb/build.sh --producer "$$producer" --arch "$$arch"; \
	    done; \
	done; \
	for arch in amd64 arm64; do \
	    echo "bash os/build-env/deb/repo.sh --arch $$arch"; \
	    bash os/build-env/deb/repo.sh --arch "$$arch"; \
	done

# The package-level gates of PLAN-036 section 6, over the pool os-debs built:
# unique file ownership with no Replaces escape, the fields and the Depends
# closure read back out of each archive, a non-empty copyright per package, the
# enablement asymmetry between the mosd and MQTT packages, no conffiles, and
# `sh -n` over every maintainer script.
#
# It also REBUILDS one producer for each architecture on a buildx builder it
# creates for the purpose, and requires the archives to come back byte-identical.
# The empty cache is the point: a second build on the normal builder replays the
# cached packing layer and re-exports the same bytes, which proves the export is
# deterministic and nothing about pack.sh.
os-deb-package-gate:
	bash os/tests/deb-package-gate.sh

# The INSTALL-time half of PLAN-036 section 6, over the same pools: APT installs
# the set os/rootfs/packages/resolve.sh yields into a clean pinned Debian base,
# once per architecture, and again with `rauc` declined; the three radio packages
# go into three separate roots; and the mos-profile provider experiment is run
# and recorded verbatim.
#
# Separate from the gate above rather than folded into it, because they answer
# different questions from different material: that one reads archives with
# dpkg-deb and says so in its own header, and nothing it can see tells you
# whether APT can satisfy the closure, whether a wants-symlink lands on a unit
# somebody shipped, or what a binary reports when it is asked.
os-install-closure-gate:
	bash os/tests/install-closure-gate.sh

# Every shell script that enables pipefail, checked for an early-exiting reader
# on the right of a pipe. `producer | grep -q PATTERN` inverts its own answer
# there: -q exits at the first match, the producer dies of SIGPIPE, and pipefail
# hands back that failure -- so the pipeline reports "not found" BECAUSE the
# pattern was found. The rationale is at the top of the script.
os-shell-pipefail-lint:
	bash os/tests/shell-pipefail-lint.sh

# Structural check on docs/README.md. It exists because the index is the one
# thing no other check can reach: a document that is never listed there is not
# broken, does not fail a build, and is simply never found again. Both
# directions are asserted, because the forward half alone passes happily on an
# index full of entries pointing at files a rename deleted. docs/plan/ and
# docs/task/ are NOT gated: they are PMA process tracking rather than product,
# and a record is deleted when it closes, so the set would be empty or nearly
# so -- a check over an empty set reports green without having checked.
docs-verify:
	bash docs/verify-index.sh

# Negative tests for the target above. Each assertion is driven against an
# index where its fact is false and required to fail with ITS OWN message -- a
# duplicated entry is the likeliest wrong resolution of a two-row append
# conflict, and a forward `grep -q` plus a reverse `sort -u` cannot see one.
# Needs no root and no network, and it fails loudly when it cannot run rather
# than skipping.
docs-verify-test:
	bash docs/verify-index-test.sh

# Every example in docs/design/containers.md, fed to the aarch64 Quadlet
# generator the image ships. A configuration example nothing executes is a claim
# that cannot fail; this makes the document part of the suite.
os-quadlet-doc-test:
	bash os/tests/quadlet-doc-test.sh

# The container engine, built from upstream source into seven aarch64 binaries.
# Same arrangement as the board artifact builds -- a Dockerfile whose last stage
# is FROM scratch, exported with -o. Dynamically linked against the image's
# glibc except catatonit, which is copied into containers and must not depend on
# this image's libc; os/pkgs/podman/README.md has the reasoning.
podman:
	bash os/pkgs/podman/build.sh

# Is any of those seven binaries built from a source tree upstream has moved
# past? versions.env is the upgrade interface and this is what says there is
# something to bump: it READS the file and never writes it, opens no pull
# request and bumps nothing, because recording a hash is an act rather than a
# copy from an upstream page nobody re-checked. Needs the network, so it runs
# in the weekly privileged lane rather than the fast one.
podman-pins:
	bash os/pkgs/podman/check-pins.sh

# The check on that check, against upstream responses recorded in
# os/tests/podman-pins/. Offline, and it drives the red directions too -- most
# of all catatonit, whose upstream has been quiet since 2024, where "correctly
# pinned" and "never actually compared" produce the same green.
podman-pins-test:
	bash os/tests/podman-pins-test.sh

# The kernel side of the same engine. netavark writes nftables rules -- masquerade,
# dnat, `fib daddr type local` -- into one inet table, and a board kernel built
# without the symbols behind any of them fails EVERY bridge network at container
# start, with nothing in this tree having noticed. cx3576 shipped exactly that
# gap: NFT_FIB_IPV4/IPV6 unset and NFT_FIB_INET absent. The list is derived from
# netavark source at the tag versions.env pins, and each entry cites the line
# that needs it. Offline, bash only.
os-netavark-kernel-test:
	bash os/tests/netavark-kernel-config-test.sh

# The builder image every component build stands on, built from a base pinned by
# DIGEST in os/build-env/images.env rather than by a tag upstream repoints
# whenever it rebuilds.
#
# mos-build-base carries only the language-independent floor -- ca-certificates,
# git, file, binutils, xz -- and ASSERTS that floor from inside itself, so an apt
# archive that moved backwards fails the build rather than the component two
# images above it. mos-build-{c,go,rust} are FROM it and each keeps its OWN apt
# list: one shared list is one cache key for unrelated compilers.
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
	$(MAKE) -C os/boards/cx3576/bsp $*

x64-%:
	@echo "x64 has no BSP build; assemble its image with: bash os/build/run.sh --mkimage-x64 (board definition: os/boards/x64/board.env)" && false

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
# THE RUN DIRECTORY IS SHARED. The harness boots out of the single fixed path
# _out/x64/.qemu, and _out is per-checkout and gitignored -- so a worktree points
# it at the checkout that built the image and TWO SUCH RUNS CANNOT GO AT ONCE:
# each overwrites the other's disk.img and the loser fails somewhere unrelated. The harness refuses to start while
# another container holds that directory rather than discovering the collision
# halfway through a nine-minute boot.
#
# `bash os/pkgs/mosd/tests/apid-api/run.sh --dry-run` performs the preconditions and the
# network discovery and boots nothing; it is how to check the harness in
# seconds. Needs docker, and it fails loudly when it cannot run rather than
# skipping.
.PHONY: os-apid-api-test
os-apid-api-test:
	bash os/pkgs/mosd/tests/apid-api/run.sh

# The BUILD-TIME half of that suite, and the only part of it that runs on a
# checkout: every literal a phase pins which openapi.json ALSO states, asserted
# to agree with the document. No image, no QEMU, no network -- it reads the
# phase files' own bytes and os/pkgs/mosd/apid/openapi.json and compares them.
#
# It exists because os-apid-api-test above is the only thing that runs the
# phases, and it needs a built image and a nine-minute boot. A milestone that
# moved a shipped status therefore left every phase pinning the old one green
# until somebody booted the image. This target closes the part of that gap that
# needs no boot; the full black-box suite remains the runtime check.
#
# Needs bun OR docker: it runs on a host bun when there is one and in the bun
# pinned as IMAGE_BUN_1 otherwise, and says which. MOS_APID_CONTAINER=1 forces
# the pinned container.
.PHONY: os-apid-api-spec-pins
os-apid-api-spec-pins:
	bash os/pkgs/mosd/tests/apid-api/spec-pins.sh
