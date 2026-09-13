.PHONY: product-repart-test product-release os-board-artifact-test build-env help os-apid-api-spec-pins os-apid-api-test os-bare-host-gate os-boot-tools os-build-test os-components os-deb-package-gate os-deb-preflight os-deb-preflight-test os-debian-cache os-debian-install os-debian-test os-debian-verify os-debs os-devkeys os-lock-bump os-pool os-pool-lock-test os-factory-root-gate os-fit-records-test os-host-toolchain-lint os-host-toolchain-lint-test os-image os-install-closure-gate os-layout-lint os-netavark-kernel-test os-quadlet-doc-test os-repart-test os-rootfs os-rootfs-manifest-test os-product-test os-board-name-lint os-board-name-lint-test product product-verify products board-add lifecycle-uefi os-shell-pipefail-lint os-smoke-negative-test os-smoke-test os-verify os-verify-test board-fetch board-fetch-all

# THE SOURCE DEPENDENCIES, before anything else: build-env/ (mica-build-env)
# is the substrate every target reaches through, rootfs/debian/ (mica-debian)
# is the pinned base the composer installs, boot/ (mica-boot) the boot tooling
# the kernel component and the signing helpers run. Both are fetched at their pins
# (deps/sources/*.json) by tools/deps.sh and are gitignored, so a fresh clone
# has neither, and every target would then fail somewhere deep with a message
# naming a file instead of the cause. `make deps` is the one target that may
# run without them.
ifeq ($(filter deps,$(MAKECMDGOALS)),)
ifeq ($(wildcard build-env/from.sh),)
$(error build-env/ is empty: the build substrate is fetched at its pin from ybolab/mica-build-env. Run: make deps)
endif
ifeq ($(wildcard rootfs/debian/run.sh),)
$(error rootfs/debian/ is empty: the pinned Debian base is fetched at its pin from ybolab/mica-debian. Run: make deps)
endif
ifeq ($(wildcard boot/verity-tool.sh),)
$(error boot/ is empty: the boot tooling is fetched at its pin from ybolab/mica-boot. Run: make deps)
endif
endif

# Fetch every source dependency at its pin (deps/sources/*.json); a no-op
# when each directory already carries its pin. `make deps-check` reads the
# releases without downloading; `make deps-bump DEP=<repository>` rewrites
# one pin from that repository's newest build-* release.
.PHONY: deps deps-check deps-bump
deps:
	bash tools/deps.sh fetch
deps-check:
	bash tools/deps.sh fetch --check
deps-bump:
	@test -n "$(DEP)" || { echo "error: DEP=<repository> is required, e.g. make deps-bump DEP=mica-build-env" >&2; exit 1; }
	bash tools/deps.sh bump "$(DEP)" $(if $(DEP_TAG),--tag "$(DEP_TAG)")

# mos top-level build entry. Heavy lifting stays in each component; this file
# only routes. Board targets: make <board>-<component>, e.g. cx3576-kernel.


# The <board>-% delegation rules are NOT listed here: .PHONY does not accept
# patterns, so an entry like `cx3576-%` matches nothing and silently declares
# nothing. They stay pattern rules (unlisted) because the delegated names are
# open-ended; a stray file named e.g. `cx3576-kernel` in this directory shadows
# the delegation, which is a visible "Nothing to be done" rather than a wrong
# build.

help:
	@echo "  os-image            assemble two signed deployments (MICA_BOARD, MICA_IMAGE_RECORDS, MICA_METADATA_PUBLIC_KEYS, MICA_FIRMWARE_PACKAGE, MICA_IMAGE_OUT)"
	@echo "  product             one product's closure: fetch, compose, sign root/kernel/firmware, two deployments, the image and the update archive into _out/products/<name> (PRODUCT=<name>; reused when its receipt is unchanged)"
	@echo "  product-verify      verify that product's image against the contract"
	@echo "  lifecycle-uefi      the QEMU lifecycle suite (boot, runtime, updates, faults, reset, shutdown) over a built UEFI product (PRODUCT=<name>)"
	@echo "  products            product, for every product whose board is a release target"
	@echo "  board-add           pin a new board's bundle artifact (deps/boards) and its packages from the newest mica-boards artifacts, write products/<board>-minimal (BOARD=<board> [BOARD_TAG=build-<commit12>])"
	@echo "  os-board-artifact-test  tools/board-pool.sh --pin/--fetch against a local registry container: every refusal by name"
	@echo "  product-release     push a built product's composed root as ghcr.io/ybolab/mica-build:root.<name>.build-<commit12> (PRODUCT=<name>)"
	@echo "  os-rootfs           compose a product's root (PRODUCT=<name>; products/*/product.env, tools/product.sh --list)"
	@echo "  os-product-test     every product validates against its board, and each refusal of the product contract fires"
	@echo "  os-board-name-lint  no board name in the engine: the assembly dispatches on board facts, never on a name (tests/board-name-lint.sh)"
	@echo "  os-board-name-lint-test  ...and that lint goes red on a planted literal"
	@echo "  os-keys-init        detect or create development keys in meta (MICA_SIGNING_OUTPUT overrides)"
	@echo "  os-devkeys          create explicit development inputs (MICA_SIGNING_OUTPUT, default meta; refuses existing output)"
	@echo "  os-layout-lint      check the current three-partition contracts"
	@echo "  os-fit-records-test verify bounded native FIT record parsing"
	@echo "mos build targets:"
	@echo "  os-debian-cache     cache the fixed Debian runtime base (MICA_ARCH=amd64|arm64)"
	@echo "  os-debian-verify    verify the runtime cache without network access"
	@echo "  os-debian-install   install the cached base with dpkg (MICA_ROOT=<empty directory>)"
	@echo "  os-debian-test      test the Debian runtime cache boundary"
	@echo "image (signed component files on SYSTEM with unified DATA):"
	@echo "  os-boot-tools       build the pinned signed UKI/systemd-boot packager (boot/, the mica-boot pin)"
	@echo "  board-fetch         read a board's bundle -- board.env, manifests, kernel, firmware, U-Boot -- out of its pinned mica-kernel-<board> archive into _out/boards/<board> (BOARD=<board>)"
	@echo "  board-fetch-all     the same for every pinned board (deps/boards/*.json); os-pool runs it"
	@echo "  os-components      build independent components (MICA_COMPONENT_ARGS='root|kernel|firmware|deployment|image|archive ...')"
	@echo "  os-verify verify the assembled mos image against the mos image contract (docker)"
	@echo "  os-smoke-test       execute every self-built binary inside the factory root, assert its pin (docker)"
	@echo "  os-smoke-negative-test  break that root three ways and require each to turn the run red (docker)"
	@echo "  os-factory-root-gate    prove the root the smoke run executes in is the root the device ships (docker)"
	@echo "  os-repart-test      prove first-boot repart growth grows DATA and cannot wipe the loader (privileged docker)"
	@echo "  os-host-toolchain-lint  no compiler, filesystem maker or assembler runs on the host (docs/design/build.md section 0)"
	@echo "  os-host-toolchain-lint-test  plant a host invocation, a stale exemption and a broken declaration; require each red"
	@echo "  os-bare-host-gate   climb PLAN-080 section 4's ladder for real: clone HEAD into the pinned docker-cli image and build from it (docker)"
	@echo "  os-verify-test      run the verify bun+TypeScript suite (typecheck + bun test)"
	@echo "  os-build-test       run the build bun+TypeScript suite: board geometry and the toolset wrappers (docker)"
	@echo "  os-netavark-kernel-test  assert every board kernel config carries the symbols netavark programs rules against"
	@echo "  build-env           build the pinned builder images localhost/mica-build-{base,c,deb,go,openssl,rust,rust-check}:<arch>"
	@echo "  os-deb-<producer>   build one producer's Debian packages for the architectures it declares; \`bash build-env/deb/producers.sh\` lists them (docker)"
	@echo "  os-deb-preflight    list every missing package-build input at once, and check every lock row is reachable, before os-pool starts a container"
	@echo "  os-deb-preflight-test   drive that pre-flight red and green, and mutate each half of its hook count contract"
	@echo "  os-debs             build every Debian package this tree's producers emit (locked ones skipped) for both architectures and index both pools (docker)"
	@echo "  deps                fetch the source dependencies (build-env/, rootfs/debian/) at their pins in deps/sources/ (network)"
	@echo "  deps-check          read each source pin's release without downloading"
	@echo "  deps-bump           rewrite the pin of DEP=<repository> from its newest build-* release (or DEP_TAG=build-<commit12>)"
	@echo "  os-pool             the whole pool: fetch what deps/packages/ pins from the source repositories' releases, build the rest, index both pools (docker, network)"
	@echo "  os-lock-bump        rewrite the package pins of COMPONENT=<repository> from its newest build-* release (or LOCK_TAG=build-<commit12>) and print the diff (network)"
	@echo "  os-pool-lock-test   drive fetch.sh, lock.sh, publish.sh and deps.sh against a local registry container: every refusal by name"
	@echo "  os-deb-package-gate check the built pools: ownership, fields, reproducibility, enablement (docker)"
	@echo "  os-install-closure-gate  apt-install both pools into clean roots: closure, ldd, accounts, versions (docker)"
	@echo "  os-rootfs-manifest-test  resolve every product and every legal feature set of every board; prove each refusal and that no package is unreachable"
	@echo "  os-quadlet-doc-test run docs/design/containers.md's examples through Quadlet"
# NEEDS THE arm64 POOL. The root is composed from _out/debs/arm64 now, so this
# target refuses until `make os-pool` has built it -- by name, rather than by
# compiling a component on demand. That refusal is the composer's, not this
# file's; see rootfs/build.sh.
os-rootfs:
	@test -n "$(PRODUCT)" || { echo "error: PRODUCT=<name> is required, e.g. make os-rootfs PRODUCT=<board>-dev; the products are: $$(bash tools/product.sh --list | tr '\n' ' ')" >&2; exit 1; }
	MICA_PRODUCT=$(PRODUCT) bash rootfs/build.sh
os-product-test:
	bash tests/product-test.sh
product:
	@test -n "$(PRODUCT)" || { echo "error: PRODUCT=<name> is required; the products are: $$(bash tools/product.sh --list | tr '\n' ' ')" >&2; exit 1; }
	bash tools/product-build.sh "$(PRODUCT)"
# The UEFI lifecycle suite (boot, runtime, updates, faults, reset, shutdown
# under QEMU) over a built product; tests/lifecycle-uefi/product-inputs.sh
# derives the suite's inputs from _out/products/<name>.
lifecycle-uefi:
	@test -n "$(PRODUCT)" || { echo "error: PRODUCT=<name> is required" >&2; exit 1; }
	bash tests/lifecycle-uefi/run.sh "$(PRODUCT)"
product-release:
	@test -n "$(PRODUCT)" || { echo "error: PRODUCT=<name> is required" >&2; exit 1; }
	bash tools/product-release.sh "$(PRODUCT)"
product-verify:
	@test -n "$(PRODUCT)" || { echo "error: PRODUCT=<name> is required" >&2; exit 1; }
	bash tools/product-build.sh "$(PRODUCT)" --verify
# Every product whose board is a release target, discovered from products/ and the fetched boards.
products:
	@set -e; for p in $$(bash tools/product.sh --list); do \
	    b="$$(bash tools/product.sh "$$p" | sed -n 's/^BOARD=//p')"; \
	    grep -qx 'BOARD_RELEASE_TARGET=1' "_out/boards/$$b/board.env" || { echo "products: $$p skipped, board $$b is not a release target"; continue; }; \
	    bash tools/product-build.sh "$$p"; \
	done
board-add:
	@test -n "$(BOARD)" || { echo "error: BOARD=<board> is required" >&2; exit 1; }
	@set -e; tag="$$(bash tools/board-pool.sh --pin "$(BOARD)" $(if $(BOARD_TAG),--tag $(BOARD_TAG)))"; \
	    bash build-env/deb/lock.sh --bump mica-boards --tag "$$tag" --package "mica-board-$(BOARD)"
	bash tools/board-pool.sh --fetch "$(BOARD)"
	@test -d "products/$(BOARD)-minimal" || { mkdir -p "products/$(BOARD)-minimal/meta/updates"; cp meta.example/updates/manifest.json "products/$(BOARD)-minimal/meta/updates/manifest.json"; \
	    printf '# The $(BOARD) minimal image: the floor and the board package, nothing selectable.\nPRODUCT=$(BOARD)-minimal\nBOARD=$(BOARD)\nPROFILE=dev\nFEATURES=""\nCOMPONENTS=""\nIMAGE_KINDS="disk"\n' > "products/$(BOARD)-minimal/product.env"; \
	    echo "board-add: wrote products/$(BOARD)-minimal"; }
	bash tools/product.sh "$(BOARD)-minimal" >/dev/null && echo "board-add: $(BOARD) is pinned, fetched and has its minimal product; next: make product PRODUCT=$(BOARD)-minimal"
os-board-name-lint:
	bash tests/board-name-lint.sh
os-board-name-lint-test:
	bash tests/board-name-lint.sh --test


# THE IMAGE CONTRACT: read the assembled image back and check it against the
# contract, check by check.
#
# Needs DOCKER on a host without sgdisk/mtools/debugfs/unsquashfs/veritysetup --
# it reads them out of the pinned IMAGE_ALPINE_3_21. Verify the other board
# with --board.
os-verify:
	@test -n "$(MICA_BOARD)" -a -n "$(MICA_VERIFY_IMAGE)" -a -n "$(MICA_METADATA_PUBLIC_KEY_FILES)"
	bash tools/micad-pool.sh --source
	bash verify/run.sh --verify --board "$(MICA_BOARD)" --image "$(MICA_VERIFY_IMAGE)" $(foreach key,$(MICA_METADATA_PUBLIC_KEY_FILES),--public-key "$(key)")

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
# execute it. MICA_BOARD selects the board; there is no default.
os-smoke-test:
	@test -n "$(PRODUCT)" || { echo "error: PRODUCT=<name> is required; the smoke run executes _out/products/<name>/build/factory-root.oci" >&2; exit 1; }
	MICA_PRODUCT=$(PRODUCT) bash verify/run.sh --smoke --product $(PRODUCT)

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
	@test -n "$(PRODUCT)" || { echo "error: PRODUCT=<name> is required; the negative runs break _out/products/<name>/build/factory-root.oci" >&2; exit 1; }
	MICA_PRODUCT=$(PRODUCT) bash verify/run.sh --smoke-negative --product $(PRODUCT)

# The assumption every smoke result rests on and nothing else checks: that the
# OCI image the smoke run executes in is byte-for-byte the tree the device
# ships. The two are produced by two exports of one stage, so nothing about
# their agreement is structural -- and a smoke run inside a DIFFERENT tree is a
# measurement of something that never boots.
#
# It compares the two trees four ways and then BREAKS each comparison in turn
# and requires each to go red. Needs docker (neither side is readable on the
# build host -- no unsquashfs, no getcap) and a built rootfs, like
# os-verify. MICA_BOARD selects the board; there is no default.
os-factory-root-gate:
	@test -n "$(PRODUCT)" || { echo "error: PRODUCT=<name> is required; the gate reads _out/products/<name>/build" >&2; exit 1; }
	bash tests/factory-root-gate/gate.sh _out/products/$(PRODUCT)/build
# Behavioural check on first-boot growth: a real systemd-repart, with discard
# enabled, over a copy of each assembled image on a loop device. It proves two
# things the image contract cannot — that growth does not wipe the Rockchip
# idbloader at LBA 64, and that the definitions the mos image ships actually GROW
# DATA rather than refusing the run (a refusal looks exactly like a clean exit).
# Needs privileged docker, so it is a dedicated target rather than part of
# os-verify; it fails loudly when it cannot run rather than skipping.
os-repart-test:
	bash tests/repart-loader-test.sh "$(MICA_BOARD)" "$(MICA_VERIFY_IMAGE)" "$(MICA_VERIFY_ROOT_IMAGE)"
# The same over a built product: its board, its image and its root component.
product-repart-test:
	@test -n "$(PRODUCT)" || { echo "error: PRODUCT=<name> is required" >&2; exit 1; }
	bash -c 'eval "$$(bash tools/product.sh "$(PRODUCT)")" && bash tests/repart-loader-test.sh "$$BOARD" "_out/products/$(PRODUCT)/image/$$(awk "NR == 1 { print \$$2 }" _out/products/$(PRODUCT)/image/SHA256SUMS)" "_out/products/$(PRODUCT)/root/rootfs.img"'
# The cx3576 flash read-back, driven against a stub rkdeveloptool: the argv the
# BSP's flash targets build, the sector arithmetic they derive from
# boards/cx3576/board.env, and the failure this suite exists for -- a write that
# reports success and leaves the previous build's bytes in boot-a, which must
# turn the flash red BEFORE `rd` reboots the board into it. The old 16 MiB
# read-back is run over the same medium and required to pass, so the new
# result is attributable to the widened window rather than to the fixture.
#
# The verify bun+TypeScript suite, entered through one script.
#
# verify/run.sh finds bun, installs the dev dependencies if they are absent,
# typechecks and runs the suite -- and turns a run that asserted nothing red,
# which bun does not: `bun test` exits 0 on a test file that declares no tests.
# A host with no bun runs all of that in the container pinned as IMAGE_BUN_1 in
# build-env/images.env, automatically and with the route announced; CI
# installs no bun, so that is the route it takes.
os-verify-test:
	bash tools/micad-pool.sh --source
	bash verify/run.sh

# The TypeScript build driver: the typed board geometry the assemblers read, and
# the Bun.$ wrappers for the toolset they drive.
#
# It needs DOCKER, which os-verify-test does not: the suite runs sgdisk, mtools,
# sgdisk, veritysetup, e2fsprogs and mtools in their pinned containers. Nothing is skipped: a tool reachable neither way is a
# failure, not a gap.
os-build-test:
	bash build/run.sh
# ONE PRODUCER, every architecture it declares, resolved against discovery.
# This is a PATTERN rule and not a list: `make os-deb-micad`, `make os-deb-mqtt`
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
# development loop under MICA_POOL_UNLOCKED (build-env/deb/README.md).
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
	        echo "os-debs: skipping the '$$producer' producer ($$dir): deps/packages/ pins $$packages; make os-deb-$$producer builds it anyway"; \
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

# THE WHOLE POOL, both classes: the archives deps/packages/ pins
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
	bash tools/podman-pool.sh --check
	bash tools/deploy-pool.sh --check
	bash tools/board-pool.sh --fetch-all

# fetch.sh and lock.sh against a stub of the release API that requires the
# token: a replaced asset, a lying lock row, a missing asset, an unreleased
# commit, a duplicate row, a missing or wrong token, each red by name; the
# bump's diff and its no-op.
os-pool-lock-test:
	bash build-env/tests/oci-test.sh
os-board-artifact-test:
	bash tests/board-artifact-test.sh

# The pins' only writer. Reads a release of COMPONENT (a package repository's
# name) -- LOCK_TAG=build-<commit12>, else its newest build-* release --
# rewrites that component's pins from the archives themselves and prints the
# diff; the diff is the import, reviewed like any other change to this tree.
os-lock-bump:
	@test -n "$(COMPONENT)" || { echo "error: COMPONENT=<repository> is required, e.g. make os-lock-bump COMPONENT=mica-podman" >&2; exit 1; }
	bash build-env/deb/lock.sh --bump "$(COMPONENT)" $(if $(LOCK_TAG),--tag "$(LOCK_TAG)") $(if $(LOCK_VERSION),--version "$(LOCK_VERSION)") $(foreach p,$(LOCK_PACKAGES),--package "$(p)")

# The package-level gates of PLAN-036 section 6, over the pool os-pool built:
# unique file ownership with no Replaces escape, the fields and the Depends
# closure read back out of each archive, a non-empty copyright per package, the
# enablement asymmetry between the micad and MQTT packages, no conffiles, and
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
# go into three separate roots; and the mica-profile provider experiment is run
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
# so at the site with `# mica-build-side: container -- <why>`, and the
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
	bash build-env/deb/fetch.sh --arch amd64
	bash tests/rootfs-runtime-test.sh

# Negative and positive tests for the pre-flight above. Its value is a count and
# a list, and both fail silently: a run that looked at nothing prints the same
# shape of green line as one that looked at everything. So each case perturbs
# ONE input and requires the reported numbers to move by exactly that much, and
# each half of the hook count contract is mutated until the run goes red -- the
# first spelling of that guard reported every input present having skipped a
# producer entirely, and it was found by hand rather than by a check. No docker
# and no pool: this runs the pre-flight, the two hooks that answer it, and the
# producer input accounting, against fixtures it builds and removes (the
# podman stamp half of it lives in ybolab/mica-podman now).
os-deb-preflight-test:
	bash tests/deb-preflight-test.sh

# Documentation gates (tools/docs/): the docs/README.md catalog in both
# directions, relative links, truth-status evidence, zh coverage, board
# dossiers, the /pma tracking indexes against their records, and stale terms or
# dead record citations in permanent documents.
# Every example in docs/design/containers.md, fed to the aarch64 Quadlet
# generator the image ships. A configuration example nothing executes is a claim
# that cannot fail; this makes the document part of the suite.
os-quadlet-doc-test:
	bash tests/quadlet-doc-test.sh

# The container engine is built and released by ybolab/mica-podman and
# imported here through deps/packages/mica-podman.json; tools/podman-pool.sh
# keeps deps/packages/mica-podman.versions.env (what the smoke register, the
# install-closure gate and the netavark kernel check compare against) equal
# to what the pinned archives carry, and extracts the aarch64 quadlet
# tests/quadlet-doc-test.sh runs.

# The kernel side of the same engine. netavark writes nftables rules -- masquerade,
# dnat, `fib daddr type local` -- into one inet table, and a board kernel built
# without the symbols behind any of them fails EVERY bridge network at container
# start, with nothing in this tree having noticed. cx3576 shipped exactly that
# gap: NFT_FIB_IPV4/IPV6 unset and NFT_FIB_INET absent. The list is derived from
# netavark source at the tag versions.env pins, and each entry cites the line
# that needs it. Offline, bash only.
os-netavark-kernel-test:
	bash build-env/deb/fetch.sh --arch amd64
	bash build-env/deb/fetch.sh --arch arm64
	bash tools/board-pool.sh --fetch-all
	bash tests/netavark-kernel-config-test.sh

# The builder image every component build stands on, built from a base pinned by
# DIGEST in build-env/images.env rather than by a tag upstream repoints
# whenever it rebuilds.
#
# mica-build-base carries only the language-independent floor -- ca-certificates,
# git, file, binutils, xz -- and ASSERTS that floor from inside itself, so an apt
# archive that moved backwards fails the build rather than the component two
# images above it. mica-build-{c,deb,go,rust} are FROM it and each keeps its OWN
# apt list: one shared list is one cache key for unrelated compilers.
# mica-build-rust-check is the one image FROM a sibling rather than the base --
# mica-build-rust plus the tools the Rust gate runs -- and build-env/build.sh
# orders the rows so that parent is built first.
#
# WHAT EACH ONE ASSERTS, AND WHY THE TWO KINDS DIFFER. mica-build-c's gcc comes
# from apt against live deb.debian.org, which no digest here pins, so it asserts
# version FLOORS -- an exact match would go red on the next trixie point release.
# mica-build-go and mica-build-rust install tarballs pinned by sha256, so they
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
# for its target. mica-build-go and mica-build-rust also link for the OTHER
# architecture, which is what the device builds actually need.
#
# Needs docker. MICA_BUILD_PLATFORM=linux/<arch> cross-builds it; the default is
# the host. It fails loudly when a pin is missing, unresolved or written as a
# tag rather than skipping.
build-env:
	bash build-env/build.sh


# x64 HAS a BSP build now, and it has exactly one target: the kernel. This
# rule used to be a refusal saying the board had none, which was true until
# PLAN-074 -- a UEFI machine's firmware provides the boot chain, so there is
# still no U-Boot and no vendor rootfs here, but the kernel is this
# repository's since it stopped being Debian's. The image is still assembled
# with `bash build/run.sh --mkimage-uefi --board x64`.

# virt-arm64, the QEMU aarch64 board, has the same one BSP target for the same
# reason x64 does: its firmware is AAVMF and provides the boot chain, so nothing
# here compiles a bootloader. The kernel IS built, and not by preference -- the
# authenticated initramfs needs built-in storage, signed verity and watchdog
# support. See boards/virt-arm64/board.env.
#
# The stem cannot collide with x64-%: a target has to begin `x64-` to match
# that rule, and `virt-arm64-kernel` does not.

# The apid API suite: boot the x64 image in QEMU with apid's port forwarded,
# wait for the daemon to answer, and drive it over a real socket. It is the
# only thing in this repository that TALKS TO apid rather than reading it --
# os-verify inspects the binary and the image, micad's own tests
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
# `bash tests/apid-api/run.sh --dry-run` performs the preconditions and the
# network discovery and boots nothing; it is how to check the harness in
# seconds. Needs docker, and it fails loudly when it cannot run rather than
# skipping.
os-apid-api-test:
	bash tests/apid-api/run.sh

# The BUILD-TIME half of that suite, and the only part of it that runs on a
# checkout: every literal a phase pins which openapi.json ALSO states, asserted
# to agree with the document. No image, no QEMU, no network -- it reads the
# phase files' own bytes and the OpenAPI document the pinned mica-apid archive ships and compares them.
#
# It exists because os-apid-api-test above is the only thing that runs the
# phases, and it needs a built image and a nine-minute boot. A milestone that
# moved a shipped status therefore left every phase pinning the old one green
# until somebody booted the image. This target closes the part of that gap that
# needs no boot; the full black-box suite remains the runtime check.
#
# Needs bun OR docker: it runs on a host bun when there is one and in the bun
# pinned as IMAGE_BUN_1 otherwise, and says which. MICA_APID_CONTAINER=1 forces
# the pinned container.
os-apid-api-spec-pins:
	bash tests/apid-api/spec-pins.sh

os-boot-tools:
	bash boot/build-tools.sh

# The BSP outputs of a board -- its kernel directory, firmware, copyright and
# U-Boot -- out of the pinned mica-kernel-<board> archive into
# _out/boards/<board>/, for the kernel component, the image and the labs.
# The boards live in ybolab/mica-boards; this tree builds no kernel. Refuses an archive built against another verity trust
# certificate than meta/verity/signer.cert.pem.
board-fetch:
	@test -n "$(BOARD)" || { echo "error: BOARD=<board> is required, the pinned boards are: $$(bash tools/board-pool.sh --list | tr '\n' ' ')" >&2; exit 1; }
	bash tools/board-pool.sh --fetch "$(BOARD)"
board-fetch-all:
	bash tools/board-pool.sh --fetch-all

# Explicit component inputs and signing material are supplied as CLI arguments.
os-components:
	bash build/run.sh --components $(MICA_COMPONENT_ARGS)

os-debian-cache:
	bash rootfs/debian/docker.sh cache --arch '$(MICA_ARCH)' $(if $(MICA_DEBIAN_PACKAGES),--packages '$(MICA_DEBIAN_PACKAGES)')

os-debian-verify:
	bash rootfs/debian/docker.sh verify --arch '$(MICA_ARCH)' $(if $(MICA_DEBIAN_PACKAGES),--packages '$(MICA_DEBIAN_PACKAGES)')

os-debian-install:
	bash rootfs/debian/docker.sh install --arch '$(MICA_ARCH)' --root '$(MICA_ROOT)' $(if $(MICA_DEBIAN_PACKAGES),--packages '$(MICA_DEBIAN_PACKAGES)')

os-debian-test:
	bash rootfs/debian/tests/debian-base-test.sh
	bash rootfs/debian/tests/debian-lock-test.sh

# Factory assembly consumes already-built and signed components.
MICA_SIGNING_OUTPUT ?= meta
.PHONY: os-keys-init
os-keys-init:
	bash boot/init-keys.sh --out "$(MICA_SIGNING_OUTPUT)"

os-devkeys:
	bash boot/dev-keys.sh --out "$(MICA_SIGNING_OUTPUT)"

os-image:
	@test -n "$(MICA_BOARD)" -a -n "$(MICA_IMAGE_RECORDS)" -a -n "$(MICA_METADATA_PUBLIC_KEYS)" -a -n "$(MICA_FIRMWARE_PACKAGE)" -a -n "$(MICA_IMAGE_OUT)"
	bash build/run.sh --components image --board "$(MICA_BOARD)" --records "$(MICA_IMAGE_RECORDS)" \
	  --firmware "$(MICA_FIRMWARE_PACKAGE)" --out "$(MICA_IMAGE_OUT)" $(foreach key,$(MICA_METADATA_PUBLIC_KEYS),--public-key "$(key)")

os-layout-lint:
	bash build/run.sh src/file-layout.test.ts

# firmware-io.c compiles the boards' own U-Boot file-boot sources, checked
# out at their pinned commits by tools/board-pool.sh --source.
os-fit-records-test:
	bash tools/board-pool.sh --source
	bash tests/lifecycle-uboot-fit/records.sh
	bash tests/lifecycle-uboot-fit/firmware-io.sh

# Current independent-artifact release directory, SBOM and publication gate.
.PHONY: os-release os-release-gate os-release-verify-test
os-release:
	bash build/run.sh --release assemble $(MICA_RELEASE_ARGS)

os-release-gate:
	bash build/run.sh --release gate $(MICA_RELEASE_ARGS)

os-release-verify-test:
	bash tests/release-verify-test.sh


