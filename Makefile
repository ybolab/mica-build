.PHONY: os-trust-domain-test os-file-transaction-faults build-env docs-verify docs-verify-test help os-apid-api-spec-pins os-apid-api-test os-apid-ui-build-contract-test os-bare-host-gate os-boot-tools os-build-test os-components os-cx3576-flash-test os-dbus-policy-test os-deb-package-gate os-deb-preflight os-deb-preflight-test os-debian-cache os-debian-install os-debian-test os-debian-verify os-debs os-devkeys os-lock-bump os-pool os-pool-lock-test os-factory-root-gate os-fit-records-test os-gadget-test os-health-test os-host-toolchain-lint os-host-toolchain-lint-test os-image os-install-closure-gate os-layout-lint os-mac-test os-netavark-kernel-test os-quadlet-doc-test os-repart-test os-rootfs-cx3576 os-rootfs-manifest-test os-rootfs-virt-arm64 os-rootfs-x64 os-rust-gate os-shadow-test os-shell-pipefail-lint os-smoke-negative-test os-smoke-test os-verify os-verify-test podman podman-pins podman-pins-test

# THE SUBMODULES, before anything else: build-env/ (mica-build-env) is the
# substrate every target reaches through, rootfs/debian/ (mica-debian) is the
# pinned base the composer installs. A checkout made without
# --recurse-submodules has both directories empty, and every target would then
# fail somewhere deep with a message naming a file instead of the cause.
ifeq ($(wildcard build-env/from.sh),)
$(error build-env/ is empty: the build substrate is the mica-build-env submodule. Run: git submodule update --init --recursive)
endif
ifeq ($(wildcard rootfs/debian/run.sh),)
$(error rootfs/debian/ is empty: the pinned Debian base is the mica-debian submodule. Run: git submodule update --init --recursive)
endif

# mos top-level build entry. Heavy lifting stays in each component; this file
# only routes. Board targets: make <board>-<component>, e.g. cx3576-kernel.

BOARDS := cx3576 s905x5m virt-arm64 x64

# The <board>-% delegation rules are NOT listed here: .PHONY does not accept
# patterns, so an entry like `cx3576-%` matches nothing and silently declares
# nothing. They stay pattern rules (unlisted) because the delegated names are
# open-ended; a stray file named e.g. `cx3576-kernel` in this directory shadows
# the delegation, which is a visible "Nothing to be done" rather than a wrong
# build.

help:
	@echo "  os-image            assemble two signed deployments (MOS_BOARD, MOS_IMAGE_RECORDS, MOS_METADATA_PUBLIC_KEYS, MOS_FIRMWARE_PACKAGE, MOS_IMAGE_OUT)"
	@echo "  os-rootfs-x64 / os-rootfs-virt-arm64 / os-rootfs-cx3576 compose independent roots"
	@echo "  os-keys-init        detect or create development keys in meta (MOS_SIGNING_OUTPUT overrides)"
	@echo "  os-devkeys          create explicit development inputs (MOS_SIGNING_OUTPUT, default meta; refuses existing output)"
	@echo "  os-layout-lint      check the current three-partition contracts"
	@echo "  os-fit-records-test verify bounded native FIT record parsing"
	@echo "  s905x5m-<t>         build the s905x5m BSP (kernel|uboot|userland|uboot-package)"
	@echo "mos build targets:"
	@echo "  os-debian-cache     cache the fixed Debian runtime base (MOS_ARCH=amd64|arm64)"
	@echo "  os-debian-verify    verify the runtime cache without network access"
	@echo "  os-debian-install   install the cached base with dpkg (MOS_ROOT=<empty directory>)"
	@echo "  os-debian-test      test the Debian runtime cache boundary"
	@echo "image (signed component files on SYSTEM with unified DATA):"
	@echo "  os-boot-tools      build the pinned signed UKI/systemd-boot packager"
	@echo "  os-components      build independent components (MOS_COMPONENT_ARGS='root|kernel|firmware|deployment|image|archive ...')"
	@echo "  os-rootfs-cx3576 compose the independent signed rootfs input"
	@echo "  os-verify verify the assembled mos image against the mos image contract (docker)"
	@echo "  os-smoke-test       execute every self-built binary inside the factory root, assert its pin (docker)"
	@echo "  os-smoke-negative-test  break that root three ways and require each to turn the run red (docker)"
	@echo "  os-factory-root-gate    prove the root the smoke run executes in is the root the device ships (docker)"
	@echo "  os-health-test      run the health and failure-handler tests"
	@echo "  os-shadow-test      run the offline tests for the DATA /etc/shadow reconciler"
	@echo "  os-mac-test         prove the stable-MAC derivation follows the port, not the interface name; drives the by-name defect red"
	@echo "  os-dbus-policy-test prove the shipped mosd D-Bus policy is root-only against a real dbus-daemon"
	@echo "  os-repart-test      prove first-boot repart growth grows DATA and cannot wipe the loader (privileged docker)"
	@echo "  os-cx3576-flash-test    drive the cx3576 flash read-back against a stub rkdeveloptool: argv, sector arithmetic, and a hole that must go red before rd"
	@echo "  os-host-toolchain-lint  no compiler, filesystem maker or assembler runs on the host (docs/design/build.md section 0)"
	@echo "  os-host-toolchain-lint-test  plant a host invocation, a stale exemption and a broken declaration; require each red"
	@echo "  os-bare-host-gate   climb PLAN-080 section 4's ladder for real: clone HEAD into the pinned docker-cli image and build from it (docker)"
	@echo "  os-verify-test      run the verify bun+TypeScript suite (typecheck + bun test)"
	@echo "  os-build-test       run the build bun+TypeScript suite: board geometry and the toolset wrappers (docker)"
	@echo "  docs-verify         assert the docs catalog, links, truth-status lines, board dossiers, tracking records and stale terms"
	@echo "  docs-verify-test    prove those assertions actually fail on fixtures where their facts are false"
	@echo "  podman              build the container engine from source into pkgs/podman/out-\$$MOS_ARCH"
	@echo "  podman-pins         ask the six pinned upstreams for their newest release; red when a pin is behind (network)"
	@echo "  podman-pins-test    drive that check against recorded upstream responses, both directions (no network)"
	@echo "  os-netavark-kernel-test  assert every board kernel config carries the symbols netavark programs rules against"
	@echo "  build-env           build the pinned builder images localhost/mos-build-{base,c,deb,go,openssl,rust,rust-check}:<arch>"
	@echo "  os-rust-gate        run both Rust workspaces' hack/check.sh (fmt, clippy -D warnings, nextest, doctests, cargo-deny) in the pinned gate image (docker)"
	@echo "  os-deb-<producer>   build one producer's Debian packages for the architectures it declares; \`bash build-env/deb/producers.sh\` lists them (docker)"
	@echo "  os-deb-preflight    list every missing package-build input at once, and check every lock row is reachable, before os-pool starts a container"
	@echo "  os-deb-preflight-test   drive that pre-flight red and green, and mutate each half of its hook count contract"
	@echo "  os-debs             build every Debian package this tree's producers emit (locked ones skipped) for both architectures and index both pools (docker)"
	@echo "  os-pool             the whole pool: fetch what rootfs/packages/lock.tsv imports, build the rest, index both pools (docker, network)"
	@echo "  os-lock-bump        rewrite the lock rows of COMPONENT=<repository> from the registry index and print the diff (network)"
	@echo "  os-pool-lock-test   drive fetch.sh and lock.sh against a stub registry: every refusal by name (no docker, no network)"
	@echo "  os-deb-package-gate check the built pools: ownership, fields, reproducibility, enablement (docker)"
	@echo "  os-install-closure-gate  apt-install both pools into clean roots: closure, ldd, accounts, versions (docker)"
	@echo "  os-rootfs-manifest-test  resolve the rootfs package set for every board, profile and feature set; prove each refusal and that no producer package is unreachable"
	@echo "  os-quadlet-doc-test run docs/design/containers.md's examples through Quadlet"
	@echo "  cx3576-<t>          delegate target <t> to boards/cx3576/bsp (uboot|kernel|rootfs|image|clean)"
	@echo "  x64-<t>             delegate target <t> to boards/x64/bsp (kernel|kernel-config|clean); no bootloader is built, the firmware is one"
	@echo "  virt-arm64-<t>      delegate target <t> to boards/virt-arm64/bsp (kernel|kernel-config|clean); the QEMU aarch64 board, same shape as x64"
# NEEDS THE arm64 POOL. The root is composed from _out/debs/arm64 now, so this
# target refuses until `make os-pool` has built it -- by name, rather than by
# compiling a component on demand. That refusal is the composer's, not this
# file's; see rootfs/build.sh.
os-rootfs-cx3576:
	bash rootfs/build.sh


s905x5m-%:
	$(MAKE) -C boards/s905x5m/bsp $*
# THE IMAGE CONTRACT: read the assembled image back and check it against the
# contract, check by check.
#
# Needs DOCKER on a host without sgdisk/mtools/debugfs/unsquashfs/veritysetup --
# it reads them out of the pinned IMAGE_ALPINE_3_21. Verify the other board
# with --board.
os-verify:
	@test -n "$(MOS_BOARD)" -a -n "$(MOS_VERIFY_IMAGE)" -a -n "$(MOS_METADATA_PUBLIC_KEY_FILES)"
	bash verify/run.sh --verify --board "$(MOS_BOARD)" --image "$(MOS_VERIFY_IMAGE)" $(foreach key,$(MOS_METADATA_PUBLIC_KEY_FILES),--public-key "$(key)")

# Every self-built binary EXECUTED inside the root that ships it, with the
# version it reports required to equal the version this repository pinned.
# `os-verify` reads the image; this one runs what is in it.
#
# THIS IS NOT THE ONLY THING THAT RUNS IT: `rootfs/build.sh` runs the same
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
	bash verify/run.sh --smoke

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
	bash verify/run.sh --smoke-negative

# The assumption every smoke result rests on and nothing else checks: that the
# OCI image the smoke run executes in is byte-for-byte the tree the device
# ships. The two are produced by two exports of one stage, so nothing about
# their agreement is structural -- and a smoke run inside a DIFFERENT tree is a
# measurement of something that never boots.
#
# It compares the two trees four ways and then BREAKS each comparison in turn
# and requires each to go red. Needs docker (neither side is readable on the
# build host -- no unsquashfs, no getcap) and a built rootfs, like
# os-verify. MOS_BOARD selects the board; x64 is the default.
os-factory-root-gate:
	bash tests/factory-root-gate/gate.sh _out/$(or $(MOS_BOARD),x64)
os-health-test:
	bash tests/health-test.sh
	bash tests/boot-failure-test.sh

# Drives the real boards/cx3576/hwinit/hwinit-gadget against a fake configfs in
# a temp dir, from cwd `/` -- the cwd its Type=oneshot service actually has.
# What it asserts is the property configfs applies and an ordinary filesystem
# does not: configfs_symlink() resolves the target STRING with kern_path() at
# creation time, so a RELATIVE target names a different directory depending on
# where the caller stands. That is why the broken form linked correctly in every
# temp-directory reproduction and produced `Config c/1 ... needs at least one
# function` on hardware. Drives the red direction too, by making configs/c.1 a
# regular file. Needs no root, no docker and no board.
os-gadget-test:
	bash tests/gadget-configfs-test.sh

# Drives the real boards/cx3576/hwinit/hwinit-mac against a fake sysfs and a
# stub ip(8). The property is stability under RENAMING: this board boots
# net.ifnames=0, so eth0/eth1 is the order the two NICs registered in -- 4.5 ms
# apart on the first hardware boot -- and the same port at the same place on the
# board must get the same address under either name. The red direction is
# produced from the shipped script rather than written beside it: the md5 input
# is rewritten back to the interface name, which is what this file used to hash,
# and the swapped fixture must then exchange the two addresses. Needs no root,
# no docker and no board.
os-mac-test:
	bash tests/mac-stable-test.sh

# Drives the real mos-shadow-reconcile against fixtures in a temp dir: the
# transient-root-password clearing, the mismatch branch that lets a dev image's
# ROOT_PASSWORD survive a reboot, and the pre-existing append rule. Needs no
# root and touches no host state.
os-shadow-test:
	bash tests/shadow-reconcile-test.sh

# Stands up a real dbus-daemon whose configuration <include>s the SHIPPED
# pkgs/mosd/dist/com.mos.mosd.conf, owns com.mos.mosd from a root connection, and
# drives root and non-root clients at it. Reading the XML back would only prove
# the file says the right thing; this proves dbus-daemon acts on it. Both
# directions of every guard — a refusal-only suite passes just as well against a
# policy that denies root too. Needs root (it drops to uid 65534 with setpriv)
# and fails loudly when it cannot run rather than skipping.
os-dbus-policy-test:
	bash pkgs/mosd/tests/dbus-policy-test.sh

# Behavioural check on first-boot growth: a real systemd-repart, with discard
# enabled, over a copy of each assembled image on a loop device. It proves two
# things the image contract cannot — that growth does not wipe the Rockchip
# idbloader at LBA 64, and that the definitions the mos image ships actually GROW
# DATA rather than refusing the run (a refusal looks exactly like a clean exit).
# Needs privileged docker, so it is a dedicated target rather than part of
# os-verify; it fails loudly when it cannot run rather than skipping.
os-repart-test:
	bash tests/repart-loader-test.sh "$(MOS_BOARD)" "$(MOS_VERIFY_IMAGE)" "$(MOS_VERIFY_ROOT_IMAGE)"
# The cx3576 flash read-back, driven against a stub rkdeveloptool: the argv the
# BSP's flash targets build, the sector arithmetic they derive from
# boards/cx3576/board.env, and the failure this suite exists for -- a write that
# reports success and leaves the previous build's bytes in boot-a, which must
# turn the flash red BEFORE `rd` reboots the board into it. The old 16 MiB
# read-back is run over the same medium and required to pass, so the new
# result is attributable to the widened window rather than to the fixture.
#
# No board, so the real rkdeveloptool is never executed and nothing here says
# it accepts these arguments; docs/task/RFCT-353.md names those lines. Needs no
# docker, no network and no root.
os-cx3576-flash-test:
	bash tests/cx3576-flash-verify-test.sh
# The verify bun+TypeScript suite, entered through one script.
#
# verify/run.sh finds bun, installs the dev dependencies if they are absent,
# typechecks and runs the suite -- and turns a run that asserted nothing red,
# which bun does not: `bun test` exits 0 on a test file that declares no tests.
# A host with no bun runs all of that in the container pinned as IMAGE_BUN_1 in
# build-env/images.env, automatically and with the route announced; CI
# installs no bun, so that is the route it takes.
os-verify-test:
	bash verify/run.sh

# The built-in UI is generated before Rust compiles APID. This source-only
# gate proves the generated tree stays outside Git and that every owned Cargo
# entry preserves the producer boundary.
os-apid-ui-build-contract-test:
	bash tests/apid-ui-build-contract-test.sh

# The TypeScript build driver: the typed board geometry the assemblers read, and
# the Bun.$ wrappers for the toolset they drive.
#
# It needs DOCKER, which os-verify-test does not: the suite runs sgdisk, mtools,
# sgdisk, veritysetup, e2fsprogs and mtools in their pinned containers. Nothing is skipped: a tool reachable neither way is a
# failure, not a gap.
os-build-test:
	bash build/run.sh
# ONE PRODUCER, every architecture it declares, resolved against discovery.
# This is a PATTERN rule and not a list: `make os-deb-mosd`, `make os-deb-mqtt`
# and `make os-deb-<anything build-env/deb/producers.sh finds>` all route
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
# Makefile, README.md, LICENSE, docs/ and the build trees; nothing there can
# match, and a stray one would show as a visible "Nothing to be done" rather
# than a wrong build. `os-deb-package-gate` below is an explicit target and is
# therefore not caught by this pattern: make prefers an explicit rule over a
# pattern rule that also matches.
os-deb-%:
	@set -e; \
	bash build-env/deb/producers.sh --dir-for '$*' >/dev/null; \
	arches="$$(bash build-env/deb/producers.sh | awk -v p='$*' '$$1 == p { print $$3 }' | tr ',' ' ')"; \
	for arch in $$arches; do \
	    echo "bash build-env/deb/build.sh --producer $* --arch $$arch"; \
	    bash build-env/deb/build.sh --producer '$*' --arch "$$arch"; \
	done

# EVERY MISSING INPUT AT ONCE, before anything is built. os-debs used to fail
# partway: each producer checks its own inputs when its turn comes, so a
# missing BSP artefact surfaced after the producers ahead of it had already
# been packed, named one file, and the next one was learned on the next
# attempt. The script says what it examined and refuses to report success over
# a count of zero.
#
# EXPLICIT, so make prefers it over the `os-deb-%` pattern above --
# `os-deb-package-gate` below is explicit for the same reason.
os-deb-preflight:
	bash build-env/deb/preflight.sh
	bash build-env/deb/fetch.sh --arch amd64 --check
	bash build-env/deb/fetch.sh --arch arm64 --check

# THE WHOLE LOCAL POOL: every DISCOVERED producer at every architecture it
# declares, then the index beside each pool. The composer resolves its package
# set through _out/debs/<arch>/{Packages,SHA256SUMS,manifest.txt}, so a build
# that stopped before repo.sh would leave a pool APT cannot see into.
#
# No producer is named here. The set comes from build-env/deb/producers.sh,
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
#
# THE PRE-FLIGHT IS A PREREQUISITE, so it runs before the first container and
# is also a target an operator can run alone. Every producer still refuses its
# own missing inputs when its turn comes -- `make os-deb-<producer>` does not
# come through here -- but that refusal arrives after the producers ahead of it
# have been packed and names one file; this one names them all, first.
#
# A PRODUCER WHOSE EVERY PACKAGE THE LOCK IMPORTS IS SKIPPED, by name: the
# composer takes the locked archive and refuses a locally built one at another
# digest, so building it here would only overwrite what os-pool fetched.
# `make os-deb-<producer>` still builds it on request, for the local
# development loop under MOS_POOL_UNLOCKED (build-env/deb/README.md).
os-debs: os-deb-preflight
	@set -e; \
	rows="$$(bash build-env/deb/producers.sh)"; \
	locked="$$(bash build-env/deb/lock.sh --rows | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')"; \
	printf '%s\n' "$$rows" | while read -r producer dir arches packages enablement; do \
	    unlocked_pkgs=""; \
	    for p in $$(printf '%s' "$$packages" | tr ',' ' '); do \
	        case " $$locked" in *" $$p "*) ;; *) unlocked_pkgs="$$unlocked_pkgs $$p" ;; esac; \
	    done; \
	    if [ -z "$$unlocked_pkgs" ]; then \
	        echo "os-debs: skipping the '$$producer' producer ($$dir): rootfs/packages/lock.tsv imports $$packages; make os-deb-$$producer builds it anyway"; \
	        continue; \
	    fi; \
	    for arch in $$(printf '%s' "$$arches" | tr ',' ' '); do \
	        echo "bash build-env/deb/build.sh --producer $$producer --arch $$arch  ($$dir)"; \
	        bash build-env/deb/build.sh --producer "$$producer" --arch "$$arch"; \
	    done; \
	done; \
	for arch in amd64 arm64; do \
	    echo "bash build-env/deb/repo.sh --arch $$arch"; \
	    bash build-env/deb/repo.sh --arch "$$arch"; \
	done

# THE WHOLE POOL, both classes: the archives rootfs/packages/lock.tsv imports
# are fetched from the registry and verified against their rows, then the
# producers of this tree build the rest, then both pools are indexed. This is
# the target rootfs/build.sh names in its refusal. The fetch comes first so
# that a lock row the registry cannot serve stops the run before a container
# is started; os-debs re-indexes both pools after the builds, over the fetched
# and the built archives together.
os-pool: os-deb-preflight
	bash build-env/deb/fetch.sh --arch amd64
	bash build-env/deb/fetch.sh --arch arm64
	$(MAKE) os-debs

# fetch.sh and lock.sh against a stub registry that requires the token: a
# replaced archive, a lying lock row, a missing archive, a duplicate row, a
# missing or wrong token, each red by name; the bump's diff and its no-op.
os-pool-lock-test:
	bash tests/pool-lock-test.sh

# The lock's only writer. Reads the registry's index for COMPONENT (a package
# repository's name), rewrites that component's rows and prints the diff; the
# diff is the import, reviewed like any other change to this tree.
os-lock-bump:
	@test -n "$(COMPONENT)" || { echo "error: COMPONENT=<repository> is required, e.g. make os-lock-bump COMPONENT=mica-podman" >&2; exit 1; }
	bash build-env/deb/lock.sh --bump "$(COMPONENT)" $(if $(LOCK_VERSION),--version "$(LOCK_VERSION)") $(foreach p,$(LOCK_PACKAGES),--package "$(p)")

# The package-level gates of PLAN-036 section 6, over the pool os-pool built:
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
	bash build-env/deb/package-gate.sh

# The INSTALL-time half of PLAN-036 section 6, over the same pools: APT installs
# the set rootfs/packages/resolve.sh yields into a clean pinned Debian base,
# once per architecture, and again with optional services declined; the three radio packages
# go into three separate roots; and the mos-profile provider experiment is run
# and recorded verbatim.
#
# Separate from the gate above rather than folded into it, because they answer
# different questions from different material: that one reads archives with
# dpkg-deb and says so in its own header, and nothing it can see tells you
# whether APT can satisfy the closure, whether a wants-symlink lands on a unit
# somebody shipped, or what a binary reports when it is asked.
os-install-closure-gate:
	bash tests/install-closure-gate.sh

# Every shell script that enables pipefail, checked for an early-exiting reader
# on the right of a pipe. `producer | grep -q PATTERN` inverts its own answer
# there: -q exits at the first match, the producer dies of SIGPIPE, and pipefail
# hands back that failure -- so the pipeline reports "not found" BECAUSE the
# pattern was found. The rationale is at the top of the script.
os-shell-pipefail-lint:
	bash tests/shell-pipefail-lint.sh

# THE BUILD POLICY, made to fail. docs/design/build.md section 0 is the rule --
# no toolchain on the host, no compilation on the host, no assembly on the host
# -- and this is what goes red when a new path breaks it. That page carried the
# claim long before anything enforced it, which is the whole reason this target
# exists: a documented rule with no check is a sentence, not a gate.
#
# It scans every tracked shell script, Makefile and workflow for a producer
# binary in command position. A file or a block that runs INSIDE an image says
# so at the site with `# mos-build-side: container -- <why>`, and the
# invocations that cannot move yet are registered in
# tests/host-toolchain-exemptions with their reasons -- where an entry matching
# NOTHING is itself a failure, so a waiver cannot outlive what it waived.
#
# No docker, no bun: bash, awk and git. It runs in the CI lane that says its
# suites need neither.
os-host-toolchain-lint:
	bash tests/host-toolchain-lint.sh

# The check on that check. Fifteen cases, each planting ONE defect in a
# throwaway git checkout and requiring the lint to go red naming it -- plus two
# that plant something legitimate and require green, because a rule whose
# findings are false positives teaches people to ignore it. Among them the
# positive control driven directly: a scan that saw no container-side producer
# at all has not found this repository's build and must not report clean.
os-host-toolchain-lint-test:
	bash tests/host-toolchain-lint-test.sh

# THE CRITERION ITSELF, RUN. `os-host-toolchain-lint` above reads the tree and
# says whether it looks compliant; this one takes a host that IS the criterion's
# host -- the pinned docker-cli image, docker and git and a busybox userland,
# plus the bash and make PLAN-080 section 1 permits -- clones HEAD into it, and
# climbs. It exists because section 9 named the absence of it as that record's
# largest risk: section 4 was run by hand once, nothing re-ran it, and the next
# path that needs a host tool would pass every static check and break the
# criterion silently.
#
# The ceiling is rungs 1-3: the docs gates, the policy lint, the board layout
# lint and the 1270-test verify suite, all with no bun on the host. It does NOT
# assemble an image -- that is rung 4 and it needs the amd64 package pool.
# tests/bare-host-gate/ladder.sh names what the lower ceiling stops covering.
#
# Needs docker and the network: it pulls the pin if it is absent and adds bash
# and make into the running container with apk.
os-bare-host-gate:
	bash tests/bare-host-gate/gate.sh

# rootfs/packages/resolve.sh over every board, profile, radio set and feature
# set this repository supports, plus the reverse direction: every package a
# producer declares has to be reachable by SOME legal resolution. That half is
# the one nothing else can see -- a package no manifest can name is simply never
# installed, and every check downstream of composition runs over the set that
# WAS. No docker and no pool: this reads manifests and runs producers.sh.
os-rootfs-manifest-test:
	bash tests/rootfs-manifest-test.sh

# Explicit runtime closure and metadata preservation on small offline roots.
.PHONY: os-rootfs-runtime-test
os-rootfs-runtime-test:
	bash tests/rootfs-runtime-test.sh

# Negative and positive tests for the pre-flight above. Its value is a count and
# a list, and both fail silently: a run that looked at nothing prints the same
# shape of green line as one that looked at everything. So each case perturbs
# ONE input and requires the reported numbers to move by exactly that much, and
# each half of the hook count contract is mutated until the run goes red -- the
# first spelling of that guard reported every input present having skipped a
# producer entirely, and it was found by hand rather than by a check. No docker
# and no pool: this runs the pre-flight, the two hooks that answer it, and the
# podman versions stamp, against fixtures it builds and removes.
os-deb-preflight-test:
	bash tests/deb-preflight-test.sh

# Documentation gates (tools/docs/): the docs/README.md catalog in both
# directions, relative links, truth-status evidence, zh coverage, board
# dossiers, the /pma tracking indexes against their records, and stale terms or
# dead record citations in permanent documents.
docs-verify:
	bash tools/docs/verify-index.sh
	bash tools/docs/verify-links.sh
	bash tools/docs/verify-status.sh
	bash tools/docs/verify-coverage.sh
	bash tools/docs/verify-board.sh
	bash tools/docs/verify-tracking.sh
	bash tools/docs/verify-terms.sh

# Negative tests for the target above. Each assertion is driven against an
# index where its fact is false and required to fail with ITS OWN message -- a
# duplicated entry is the likeliest wrong resolution of a two-row append
# conflict, and a forward `grep -q` plus a reverse `sort -u` cannot see one.
# Needs no root and no network, and it fails loudly when it cannot run rather
# than skipping.
docs-verify-test:
	bash tools/docs/verify-index-test.sh
	bash tools/docs/verify-links-test.sh
	bash tools/docs/verify-status-test.sh
	bash tools/docs/verify-coverage-test.sh
	bash tools/docs/verify-board-test.sh
	bash tools/docs/verify-tracking-test.sh
	bash tools/docs/verify-terms-test.sh

# Every example in docs/design/containers.md, fed to the aarch64 Quadlet
# generator the image ships. A configuration example nothing executes is a claim
# that cannot fail; this makes the document part of the suite.
os-quadlet-doc-test:
	bash tests/quadlet-doc-test.sh

# The container engine, built from upstream source into seven aarch64 binaries.
# Same arrangement as the board artifact builds -- a Dockerfile whose last stage
# is FROM scratch, exported with -o. Dynamically linked against the image's
# glibc except catatonit, which is copied into containers and must not depend on
# this image's libc; pkgs/podman/README.md has the reasoning.
podman:
	bash pkgs/podman/build.sh

# Is any of those seven binaries built from a source tree upstream has moved
# past? versions.env is the upgrade interface and this is what says there is
# something to bump: it READS the file and never writes it, opens no pull
# request and bumps nothing, because recording a hash is an act rather than a
# copy from an upstream page nobody re-checked. Needs the network, so it runs
# in the weekly privileged lane rather than the fast one.
podman-pins:
	bash pkgs/podman/check-pins.sh

# The check on that check, against upstream responses recorded in
# tests/podman-pins/. Offline, and it drives the red directions too -- most
# of all catatonit, whose upstream has been quiet since 2024, where "correctly
# pinned" and "never actually compared" produce the same green.
podman-pins-test:
	bash tests/podman-pins-test.sh

# The kernel side of the same engine. netavark writes nftables rules -- masquerade,
# dnat, `fib daddr type local` -- into one inet table, and a board kernel built
# without the symbols behind any of them fails EVERY bridge network at container
# start, with nothing in this tree having noticed. cx3576 shipped exactly that
# gap: NFT_FIB_IPV4/IPV6 unset and NFT_FIB_INET absent. The list is derived from
# netavark source at the tag versions.env pins, and each entry cites the line
# that needs it. Offline, bash only.
os-netavark-kernel-test:
	bash tests/netavark-kernel-config-test.sh

# The builder image every component build stands on, built from a base pinned by
# DIGEST in build-env/images.env rather than by a tag upstream repoints
# whenever it rebuilds.
#
# mos-build-base carries only the language-independent floor -- ca-certificates,
# git, file, binutils, xz -- and ASSERTS that floor from inside itself, so an apt
# archive that moved backwards fails the build rather than the component two
# images above it. mos-build-{c,deb,go,rust} are FROM it and each keeps its OWN
# apt list: one shared list is one cache key for unrelated compilers.
# mos-build-rust-check is the one image FROM a sibling rather than the base --
# mos-build-rust plus the tools the Rust gate runs -- and build-env/build.sh
# orders the rows so that parent is built first.
#
# WHAT EACH ONE ASSERTS, AND WHY THE TWO KINDS DIFFER. mos-build-c's gcc comes
# from apt against live deb.debian.org, which no digest here pins, so it asserts
# version FLOORS -- an exact match would go red on the next trixie point release.
# mos-build-go and mos-build-rust install tarballs pinned by sha256, so they
# assert EXACT versions: there the version is a fact the tree owns.
#
# deb asserts its dpkg tools by running `--version` against floors, and
# rust-check asserts clippy against rustc's own release and nextest and deny
# exactly, each from inside itself (build-env/deb/Dockerfile,
# build-env/rust-check/Dockerfile).
#
# base, c, go and rust assert by USE as well as by number: each compiles and
# links a program and reads the architecture back out of the ELF, because a
# version string answers on an image with no libc headers, no linker and no std
# for its target. mos-build-go and mos-build-rust also link for the OTHER
# architecture, which is what the device builds actually need.
#
# Needs docker. MOS_BUILD_PLATFORM=linux/<arch> cross-builds it; the default is
# the host. It fails loudly when a pin is missing, unresolved or written as a
# tag rather than skipping.
build-env:
	bash build-env/build.sh

# The Rust gate: `pkgs/mosd/hack/check.sh` and `pkgs/mos-deploy/hack/check.sh`,
# UNMODIFIED, inside localhost/mos-build-rust-check. Five commands per
# workspace -- `cargo fmt --all --check`, clippy at `-D warnings`, nextest,
# doctests, and `cargo deny check licenses bans advisories`.
#
# This target exists because those scripts were unrunnable HERE. Their four
# tools came from /srv/mos-rust-tools, a host directory mounted at /tools that
# no Makefile target and no script referenced; it was emptied on 2026-08-29 and
# NOTHING WENT RED. CI kept running both scripts on its own rustup toolchain,
# so the workspace stayed checked and the local route simply stopped existing,
# silently. A substrate that can evaporate without a single failure is one
# nobody is told about; reachable as a target, it is at least noticeable.
#
# `bash tests/rust-gate.sh mosd` runs one workspace. Needs docker, and it builds
# the built-in UI tree first because the gate embeds it; it fails loudly when
# the image is missing rather than skipping, with `make build-env` as the
# remedy.
os-rust-gate:
	bash tests/rust-gate.sh

cx3576-%:
	$(MAKE) -C boards/cx3576/bsp $*

# x64 HAS a BSP build now, and it has exactly one target: the kernel. This
# rule used to be a refusal saying the board had none, which was true until
# PLAN-074 -- a UEFI machine's firmware provides the boot chain, so there is
# still no U-Boot and no vendor rootfs here, but the kernel is this
# repository's since it stopped being Debian's. The image is still assembled
# with `bash build/run.sh --mkimage-uefi --board x64`.
x64-%:
	$(MAKE) -C boards/x64/bsp $*

# virt-arm64, the QEMU aarch64 board, has the same one BSP target for the same
# reason x64 does: its firmware is AAVMF and provides the boot chain, so nothing
# here compiles a bootloader. The kernel IS built, and not by preference -- the
# authenticated initramfs needs built-in storage, signed verity and watchdog
# support. See boards/virt-arm64/board.env.
#
# The stem cannot collide with x64-%: a target has to begin `x64-` to match
# that rule, and `virt-arm64-kernel` does not.
virt-arm64-%:
	$(MAKE) -C boards/virt-arm64/bsp $*

# The apid API suite: boot the x64 image in QEMU with apid's port forwarded,
# wait for the daemon to answer, and drive it over a real socket. It is the
# only thing in this repository that TALKS TO apid rather than reading it --
# os-verify inspects the binary and the image, mosd's own tests
# exercise handlers in-process, and neither can tell a route that exists in
# routes.rs from a route the running daemon actually serves. A session cookie
# that is missing Secure, a redirect that names a port nothing can reach, an
# auth gate that lets one route through unauthenticated: all of them are
# invisible from inside the process and obvious from outside it.
#
# IT BUILDS NOTHING and assumes _out/x64/x64-mos-latest.img already exists;
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
# `bash pkgs/mosd/tests/apid-api/run.sh --dry-run` performs the preconditions and the
# network discovery and boots nothing; it is how to check the harness in
# seconds. Needs docker, and it fails loudly when it cannot run rather than
# skipping.
os-apid-api-test:
	bash pkgs/mosd/tests/apid-api/run.sh

# The BUILD-TIME half of that suite, and the only part of it that runs on a
# checkout: every literal a phase pins which openapi.json ALSO states, asserted
# to agree with the document. No image, no QEMU, no network -- it reads the
# phase files' own bytes and pkgs/mosd/apid/openapi.json and compares them.
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
os-apid-api-spec-pins:
	bash pkgs/mosd/tests/apid-api/spec-pins.sh

os-boot-tools:
	bash pkgs/mos-boot/build-tools.sh

# Explicit component inputs and signing material are supplied as CLI arguments.
os-components:
	bash build/run.sh --components $(MOS_COMPONENT_ARGS)

os-debian-cache:
	bash rootfs/debian/docker.sh cache --arch '$(MOS_ARCH)' $(if $(MOS_DEBIAN_PACKAGES),--packages '$(MOS_DEBIAN_PACKAGES)')

os-debian-verify:
	bash rootfs/debian/docker.sh verify --arch '$(MOS_ARCH)' $(if $(MOS_DEBIAN_PACKAGES),--packages '$(MOS_DEBIAN_PACKAGES)')

os-debian-install:
	bash rootfs/debian/docker.sh install --arch '$(MOS_ARCH)' --root '$(MOS_ROOT)' $(if $(MOS_DEBIAN_PACKAGES),--packages '$(MOS_DEBIAN_PACKAGES)')

os-debian-test:
	bash rootfs/debian/tests/debian-base-test.sh
	bash rootfs/debian/tests/debian-lock-test.sh

# Factory assembly consumes already-built and signed components.
MOS_SIGNING_OUTPUT ?= meta
.PHONY: os-keys-init
os-keys-init:
	bash pkgs/mos-boot/init-keys.sh --out "$(MOS_SIGNING_OUTPUT)"

os-devkeys:
	bash pkgs/mos-boot/dev-keys.sh --out "$(MOS_SIGNING_OUTPUT)"

os-rootfs-x64:
	MOS_BOARD=x64 bash rootfs/build.sh

os-rootfs-virt-arm64:
	MOS_BOARD=virt-arm64 bash rootfs/build.sh

os-image:
	@test -n "$(MOS_BOARD)" -a -n "$(MOS_IMAGE_RECORDS)" -a -n "$(MOS_METADATA_PUBLIC_KEYS)" -a -n "$(MOS_FIRMWARE_PACKAGE)" -a -n "$(MOS_IMAGE_OUT)"
	bash build/run.sh --components image --board "$(MOS_BOARD)" --records "$(MOS_IMAGE_RECORDS)" \
	  --firmware "$(MOS_FIRMWARE_PACKAGE)" --out "$(MOS_IMAGE_OUT)" $(foreach key,$(MOS_METADATA_PUBLIC_KEYS),--public-key "$(key)")

os-layout-lint:
	bash build/run.sh src/file-layout.test.ts

os-fit-records-test:
	bash tests/file-ab-fit/records.sh
	bash tests/file-ab-fit/firmware-io.sh

# Exact native transaction code, interrupted before and after each observed IO.
os-file-transaction-faults:
	bash tests/file-ab-faults/run.sh

os-trust-domain-test:
	bash tests/trust-domain-hygiene-test.sh

# Current independent-artifact release directory, SBOM and publication gate.
.PHONY: os-release os-release-gate os-release-verify-test
os-release:
	bash build/run.sh --release assemble $(MOS_RELEASE_ARGS)

os-release-gate:
	bash build/run.sh --release gate $(MOS_RELEASE_ARGS)

os-release-verify-test:
	bash tests/release-verify-test.sh

.PHONY: os-rootfs-s905x5m os-image-s905x5m-sd os-verify-s905x5m-sd os-s905x5m-hwinit-test
os-rootfs-s905x5m:
	MOS_BOARD=s905x5m bash rootfs/build.sh

# The SD system image requires the paired MOS firmware in eMMC boot0.
os-image-s905x5m-sd:
	$(MAKE) os-image MOS_BOARD=s905x5m

os-verify-s905x5m-sd:
	$(MAKE) os-verify MOS_BOARD=s905x5m

os-s905x5m-hwinit-test:
	bash tests/s905x5m-wireless.sh
