# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# =============================================================================
# stages/30-40-unsplit — NOT A STAGE. The material 30-feature-* and 40-board
# are cut from, held in one file until they are.
#
# THIS FILE IS TEMPORARY AND ITS NAME SAYS SO. PLAN-014 M5's chain is
# 10-base -> 20-install -> 30-feature-* -> 40-board -> 90-pack. M5b (RFCT-111)
# built the chain and the three stages either end of this one; M5c owns
# 30-feature-* and M5d owns 40-board. Neither had landed when the chain had to
# build end to end, and a chain missing its middle does not build -- so the
# middle is here, in the order it had in the single-file Dockerfile.v2, under a
# number no plan uses and a name nobody can mistake for a stage.
#
# WHAT M5c TAKES. The feature material, which is every RUN below that is
# already conditional on a WITH_* argument or on BOARD_RADIOS: the radio
# userland and its unit masking and mount wiring, the container engine's
# packages, install, assertions and runtime exercise, RAUC, mosd/apid, and the
# two MQTT service accounts. RFCT-111 asks for one stage per switchable
# feature, replacing the WITH_* args with stage SELECTION -- so each of those
# groups becomes a file the driver includes or does not.
#
# WHAT M5d TAKES. The board material: the kernel and its initramfs, the AIC
# firmware, grub-editenv, and the per-board hwinit units.
#
# THE ORDER IN THIS FILE IS THE ORDER Dockerfile.v2 HAD, and that is the only
# claim it makes. It is NOT a claim that features must precede board work --
# they interleave here because the single file grew one RUN at a time. Whoever
# cuts this up owns re-deciding that, and owns measuring it: the gate is the
# content diff in os/rootfs/README.md, not a sha256.
#
# WHEN BOTH CUTS HAVE LANDED THIS FILE IS EMPTY AND MUST BE DELETED. The driver
# reads the directory rather than a list, so removing it is the whole of the
# removal.
# =============================================================================

# THE LINK BACK UP THE CHAIN. MOS_STAGE_PREV is the local image tag the
# previous stage was written to; the driver passes it and refuses to build a
# stage that does not declare it. There is no default, so this file cannot be
# built standalone against whatever `FROM` happened to be typed -- which is the
# whole safety of a chain built out of separate files.
ARG MOS_STAGE_PREV
FROM ${MOS_STAGE_PREV}

# The radio userland, only for boards that declare a radio.
#
# bluez 4823 KB + wpasupplicant 3902 KB + hostapd 2329 KB + rfkill 111 KB =
# 11.2 MB, and on a board with no radio every one of them is inert at best:
# bluetoothd starts, finds no adapter, and stays running; the WiFi reconcilers
# render configuration for interfaces that do not exist. Installed software
# that cannot work is not free -- it is attack surface, journal noise and
# 11 MB of a rootfs slot, and it makes "this board has no Bluetooth" a runtime
# discovery rather than a property of the image.
#
# BOARD_RADIOS comes from the layout: os/boards/<board>/board.env. Empty means the
# board declares none, which is a statement rather than an omission.
ARG BOARD_RADIOS=""
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/radios-packages.sh

# PLAN-012: the container engine, on the board's say-so.
#
# A separate RUN from stages/10-base's package allowlist because it is
# conditional: WITH_CONTAINERS comes from the board (board/<name>/
# containers.env, absent means on) and a board that cannot afford ~107 MB
# installed ships a 0.
# Everything downstream — the unit masking, the Quadlet bind, the runtime
# probe, the verifier's assertions — keys off the same arg, so a board without
# the engine is not a board with half of one.
ARG WITH_CONTAINERS=1
# NO ENGINE PACKAGES. This list installs what the engine LINKS AND EXECS; the
# seven binaries themselves come from os/podman, built from pinned upstream
# source, and are copied in below. Every package here was derived from podman
# v5.8.6's own source rather than from what `apt-get install podman` happened
# to pull:
#
#   nftables      netavark 2.1.0 has exactly three firewall drivers —
#                 Firewalld, Nftables, Fwnone (src/firewall/mod.rs); the
#                 iptables driver was REMOVED in 2.x. nftables is the
#                 compile-time default (build.rs:69) and netavark reaches it by
#                 EXECING `nft` off PATH (nftables-0.6.3/src/helper.rs:13,
#                 NFT_EXECUTABLE = "nft"). Measured: without it, the first
#                 `podman run` fails with `netavark: nftables error: unable to
#                 execute nft`; installing nftables moves the failure past
#                 netavark entirely.
#
#                 This was MISSING from the image RFCT-101/102 shipped, which
#                 passed 376/376 assertions. A dependency reached by exec is
#                 invisible to every NEEDED-soname check by construction, and
#                 the build probe's honest note that it could not start a
#                 container ("that needs cgroups and namespaces the build
#                 sandbox does not have") covered it — though whether a FILE
#                 exists needs no cgroups at all. An accurate statement of a
#                 limit is a good place for an unrelated gap to hide.
#
#   libjson-c5    crun 1.29.1 requires json-c: its configure.ac has one JSON
#                 dependency, `PKG_CHECK_MODULES([JSON_C], [json-c >= 0.14])`,
#                 and the string "yajl" does not appear in the file. trixie's
#                 crun 1.21 links libyajl2 instead, so the packaged image
#                 carried the wrong one of the pair.
#
#   the rest      link-time dependencies, taken from the built binaries'
#                 NEEDED entries rather than predicted: libsubid5 and
#                 libseccomp2 (podman), libcap2 (crun), libglib2.0-0t64
#                 (conmon). They are not trusted to be right either -- the ldd
#                 assertion below runs the real loader against the real
#                 binaries in the assembled root and names any soname that
#                 fails to resolve.
#
#                 libsqlite3-0 was in this list and has been REMOVED. podman
#                 does depend on mattn/go-sqlite3 (go.mod:44), which is the cgo
#                 driver -- but it compiles the SQLite amalgamation IN unless
#                 the `libsqlite3` build tag is set, so nothing links the
#                 system library. Predicting the list from the go.mod would
#                 have shipped a package no binary opens.
#
# A THIRD KIND OF DEPENDENCY, invisible to both of the checks above. podman
# reaches libsystemd by DLOPEN, not by linking: go-systemd's sdjournal opens
# "libsystemd.so.0" by name at runtime (vendor/github.com/coreos/go-systemd/
# v22/sdjournal/functions.go:37). It does not appear in NEEDED, ldd cannot see
# it, and containers.conf sets log_driver = "journald", so its absence would
# lose container logs rather than fail loudly. systemd is in the base image so
# the library is present; the assertion below is that it stays present.
#
# Two packages the apt path pulled are deliberately GONE. libgpgme11t64 is not
# needed because os/podman builds with the `containers_image_openpgp` tag,
# which replaces gpgme with a pure-Go implementation; libyajl2 went with crun.
RUN if [ "$WITH_CONTAINERS" = "1" ]; then \
        apt-get update && apt-get install -y --no-install-recommends \
            nftables \
            libjson-c5 libsubid5 libseccomp2 libcap2 libglib2.0-0t64 \
        && rm -rf /var/lib/apt/lists/*; \
    else \
        echo "note: WITH_CONTAINERS=0; building rootfs without the container engine"; \
    fi

# Both connd packages ship a NON-templated unit that their postinst ENABLES, and
# both are lifecycles mosd owns and must be the only one driving. Measured on
# hostapd/wpasupplicant 2:2.10-12+deb12u3 arm64, not assumed:
#
#   hostapd.service         [Install] WantedBy=multi-user.target, linked into
#                           /etc/systemd/system/multi-user.target.wants by the
#                           postinst. It runs a SECOND hostapd on the same radio
#                           from /etc/hostapd/hostapd.conf — a file mosd never
#                           writes. Today it is condition-gated on that file
#                           being non-empty, so it does not actually start; that
#                           is one operator `cp` away from a second daemon
#                           fighting the reconciler for the radio while
#                           hostapd@wlan0.service still reports healthy.
#   wpa_supplicant.service  D-Bus mode, no condition at all, so it DOES start.
#                           It carries RuntimeDirectory=wpa_supplicant, which
#                           means systemd DELETES /run/wpa_supplicant when it
#                           stops — taking the control socket of the templated
#                           instance mosd started with it.
#
# So both are masked rather than merely disabled: masking also blocks the D-Bus
# activation path (wpasupplicant ships
# /usr/share/dbus-1/system-services/fi.w1.wpa_supplicant1.service), which a
# plain `systemctl disable` would leave open. The Alias= link the postinst
# creates for that name is masked too, since it names the same unit by another
# name. On v2 these mask symlinks are inside the signed, read-only root, so they
# cannot be removed on a running device.
#
# The TEMPLATES are left installed and NOT enabled: mosd enables and starts
# exactly the instance the settings tree asks for. Their ExecStart paths are
# asserted against the reconcilers' own constants by os/verify-image-v2.sh.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/radios-mask-units.sh

# PLAN-012: the container engine ships INSTALLED AND INERT.
#
# The switch is `container.enabled` in the settings tree and mosd owns the
# transition; an image that started containers before anyone asked would be the
# opposite of the decision.
#
# INERT BY CONSTRUCTION, NOT BY MASKING. The apt path installed podman's seven
# system units and this file then symlinked each to /dev/null, with a list that
# had to be kept in step with whatever the package shipped. Building the engine
# from source removes the problem instead of managing it: upstream's units live
# in podman's contrib/ tree and are installed by `make install.systemd`, which
# os/podman does not run. The units are not masked -- they are ABSENT, and the
# assertion below is that no unit named podman* exists anywhere in the image.
#
# That is a stronger claim and a cheaper one. The old check could only fail if
# podman's unit set CHANGED; it could not notice a unit podman added. The new
# one fails on any podman unit at all, whatever its name.
#
# What the units did, and who does it now:
#   podman.socket/.service     the root REST API, SOCKET-ACTIVATED so `disable`
#                              was never enough. Not built.
#   podman-auto-update.*       scheduled image pulls. D4 says mos does not
#                              manage container updates; the integrator does.
#   podman-restart.service     restart policies at boot -- systemd already owns
#                              lifecycle here, through Quadlet-generated units.
#   podman-clean-transient     transient state cleanup at boot.
#   podman-kube@.service       the Kubernetes YAML path. PLAN-002 removed
#                              Kubernetes as a one-way commitment; this was a
#                              corner of it arriving by the back door.
# RAUC, built from upstream by os/update/rauc/ (see os/update/rauc/versions.env for why it is
# not the Debian package). Five files, and all five are on the activation path:
# the binary, the unit, the script the D-Bus service file Execs, the bus policy
# and the activation file itself. Debian splits these across two packages and
# the split has bitten this image before -- the note at the top of the package
# list records what a `rauc` with no service files does, which is answer "the
# name de.pengutronix.rauc was not provided by any .service files" while the
# health gate reports green.
ARG RAUC_DIR
COPY ${RAUC_DIR}/ /tmp/rauc/
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/rauc-install.sh

# NOT LINKED AGAINST A SECOND TLS STACK, asserted against the binary that is
# actually in this root rather than against the build's own claim. `ldd` here
# is the loader's answer under emulation for a foreign board; a curl or GnuTLS
# soname reappearing would mean the source build silently regained streaming.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/rauc-assert-no-tls-stack.sh

ARG PODMAN_DIR
COPY ${PODMAN_DIR}/ /tmp/podman/
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/podman-install.sh

# Three assertions about the ASSEMBLED root, each of which the previous
# arrangement could not make.
#
# 1. NO PODMAN UNITS. Not "the seven we know about are masked" -- none exists.
# 2. EVERY SONAME RESOLVES, answered by the real loader running against the
#    real binaries in the real root, under emulation. os/podman used to diff
#    NEEDED against a library list read out of the PREVIOUS image, which was
#    both a weaker claim and a build-order cycle: the rootfs needs the engine,
#    and that list needed the rootfs. ldd here has neither problem.
# 3. THE CONFIG FILES PODMAN ACTUALLY READS are present. Their paths come from
#    podman v5.8.6's own source, cited in each file.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/podman-assert.sh

# The engine is EXERCISED here, not merely installed.
#
# This RUN executes arm64 binaries under the builder's emulation, which is the
# only place before a real flash where the shipped podman and the shipped
# Quadlet generator can be made to do their jobs. Everything above this line is
# a claim about files.
#
# What is proven: podman, netavark and aardvark-dns execute on arm64 and report
# their versions; crun and nft EXECUTE, each failing in one specific way the
# emulator is known to cause and no other -- anything else is an error, so
# "could not run at all" cannot pass as "ran"; podman parses the image's
# containers.conf, checked against a deliberately malformed control so the
# check is known to be capable of failing; and Quadlet turns a real .container
# file into a unit whose ExecStart invokes podman with the image it named.
#
# WHAT IS NOT PROVEN, named specifically rather than as a category:
#
#   * A container starting. Needs cgroups and namespaces the build sandbox
#     does not have.
#   * That containers.conf's VALUES take effect -- that podman resolves its
#     runtime to /usr/bin/crun and conmon to /usr/libexec/podman/conmon rather
#     than finding something under /usr/local first. `podman info` reports
#     exactly that and cannot run here: it fails with `cannot clone: Invalid
#     argument`, the user-namespace re-exec buildkit does not allow. The
#     verifier checks the FILE says so; only the device checks podman agrees.
#
# THE PREVIOUS VERSION OF THIS COMMENT COVERED A REAL GAP. It said a container
# starting was untestable here, which was true -- and the image shipped with no
# `nft` binary, a missing FILE that needs no cgroups to notice, sitting behind
# that accurate sentence. Each line above now names one claim, so what is
# absent from the list is visible as absent.
#
# THAT LAST SENTENCE USED TO COVER A REAL GAP, and it is worth saying how. The
# image RFCT-101/102 shipped had no `nft` binary, so its first `podman run`
# would have failed -- and nothing caught it, because the missing piece looked
# like it belonged to the part honestly declared untestable here. It did not:
# whether a file exists needs no cgroups. A limitation stated accurately is
# still a place things hide, so each line above names a specific claim rather
# than gesturing at what this stage can reach.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/podman-exercise.sh

# Kernel modules. Debian is merged-usr (/lib -> usr/lib) and the tar's paths
# start with lib/, so it cannot be ADDed to / directly — extract to a temp dir
# and copy into /usr/lib/modules. dep files are inside the tar; no depmod needed.
#
# On amd64 there is no vendor tree and no modules.tar: the QEMU image (os/qemu)
# takes Debian's own linux-image-amd64, which brings its kernel, its initramfs
# and its modules in one package. build-v2.sh stages an EMPTY-but-valid tar on
# that path rather than making this COPY conditional -- a COPY cannot be gated,
# and a missing context file is a build error a hundred lines from its cause.
# grub-editenv, for the boards RAUC drives through the grub backend.
#
# RAUC's grub backend does not write grubenv itself -- it EXECS grub-editenv,
# the way the uboot backend execs fw_setenv. Without it rauc.service starts and
# then cannot answer anything:
#   Failed getting primary slot: grub backend: Failed to start grub-editenv:
#   Failed to execute child process "grub-editenv" (No such file or directory)
# which is a device with an A/B layout, a boot order in grubenv, and no way to
# read or write it. Found by booting x64 after the boot-attempts fix let RAUC
# start at all.
#
# THE FILE, NOT THE PACKAGE. `grub-common` is a 20 MB installed increment here
# -- it drags in libfreetype6, libpng16, libfuse3, libefivar and gettext-base,
# none of which a device that only rewrites a grubenv has any use for. The
# binary itself is 403 KB and links only against libraries this root already
# carries. apt-get download + dpkg-deb extracts exactly one path and installs
# nothing, so no dependency resolution happens and nothing has to be purged
# again afterwards.
#
# Gated on the BOOTLOADER, not on the architecture: an arm64 UEFI board would
# need this and does not exist yet, and keying it to amd64 would make that
# board's first symptom the message above rather than a build error.
ARG RAUC_BOOTLOADER=uboot
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/grub-editenv-install.sh

ARG MOS_ARCH=arm64
COPY os/rootfs/initramfs/ /tmp/initramfs/
ARG MODULES_TAR
COPY ${MODULES_TAR} /tmp/modules.tar
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/kernel-and-initramfs.sh

# WiFi/BT firmware: AIC8800D80 combo (single SKU; the bcmdhd/AP6275S fallback
# was dropped when the fleet was confirmed AIC-only and the kernel stopped
# building bcmdhd). Only the confirmed U02 runtime set enters the image, per
# the board BSP. Driver loading is done by the mos-modules unit.
#
# Staged to /tmp and installed only on arm64: a QEMU image has no AIC radio, and
# 2 MB of firmware for hardware that is not there would be a file an operator
# reading the image cannot account for.
COPY board/cx3576/rootfs/firmware/aic_userconfig_8800d80.txt \
     board/cx3576/rootfs/firmware/fw_adid_8800d80_u02.bin \
     board/cx3576/rootfs/firmware/fw_patch_8800d80_u02.bin \
     board/cx3576/rootfs/firmware/fw_patch_table_8800d80_u02.bin \
     board/cx3576/rootfs/firmware/fmacfw_8800d80_u02.bin \
     /tmp/fw/
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/firmware-install.sh

# The RADIO mount points, for boards that have radios.
#
# var-lib-bluetooth.mount, etc-wpa_supplicant.mount and etc-hostapd.mount are
# the writable configuration directories for bluez, wpa_supplicant and hostapd.
# They live in os/boards/cx3576/overlay/ with the rest of that board's radio
# facts, so on a board with none they are simply not there -- and the chmod and
# the local-fs.target.wants loop in stages/20-install's overlay-install.sh used
# to name them unconditionally, which is what failed the first x64 build after
#
# the move: `chmod: cannot access`.
#
# AFTER stages/20-install, never before it. Placed before, this loop looked
# for the units under /etc/systemd/system while they were still sitting in
# /tmp/overlay, and reported "declared but not in the overlay" for a board
# whose overlay had all three. x64 could not catch that: it declares no radio,
# so it takes the early exit and never reaches the test at all. A board with
# the feature is the only one that runs this code.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/radios-mounts.sh

# The container configuration mos ships INSTEAD of the distribution's.
#
# This is a separate RUN from the engine install because the files arrive with
# the overlay, which stages/20-install installs before this file runs at all --
# and the first draft of this check sat next to the install, where all four
# paths were guaranteed absent.
#
# Nothing else writes them: golang-github-containers-common is not installed,
# so if the overlay ever stops carrying one of these, podman does not fail. It
# falls back to a built-in default nobody chose -- graphroot on the EPHEMERAL
# partition, or a signature policy that is not the one reviewed here.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/podman-assert-config.sh

# mosd management daemon: binary + systemd unit (enabled) + D-Bus system policy.
# build-v2.sh always stages MOSD_DIR (empty when WITH_MOSD=0), so the COPY works
# on both paths and the RUN installs only when the binary was staged.
# /var/lib/mos is the bind target of var-lib-mos.mount; mosd's own paths are
# unchanged from v1.
#
# THE TWO MQTT UNITS ARE INSTALLED AND LEFT DISABLED. mqtt.enabled now seeds
# false for every profile, so an image that shipped the bridge enabled would run
# it from early boot until mosd's first reconcile stopped it — and against a
# broker the same switch has not started, which is exactly the retry noise this
# work exists to end. Turning MQTT on is a runtime decision made against the
# settings tree, never a property of the image. mosd owns the lifecycle of both
# units, and each absent symlink is ASSERTED below rather than left to happen.
#
# The broker ships NO D-Bus policy file, and that absence is deliberate rather
# than an omission: it never speaks D-Bus. It reads one file mosd renders into
# /run and listens on a TCP socket. The bridge is the half of this pair that
# talks to com.mos.mosd, and mos-mqttd.conf is its grant.
ARG MOSD_DIR
ARG WITH_MOSD=1
COPY ${MOSD_DIR}/ /tmp/mosd/
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/mosd-install.sh

# The mos-mqttd service account.
#
# WHY A STATIC ACCOUNT AND NOT DynamicUser. mos-mqttd.service ran under
# DynamicUser=yes until the bridge was wired into an image. com.mos.mosd is a
# root-only bus name, so the bridge needs an explicit D-Bus grant, and
# <policy user="..."> resolves its user when dbus-daemon reads the file at
# startup -- before any dynamic user exists. The rule would load and match
# nothing, and the bridge would publish nothing with no error anywhere. The
# grant is mos-mqttd.conf; this account is the identity it names.
#
# uid AND gid are PINNED for the same reason the mos account's are, arrived at
# by a different route: the D-Bus policy names the account BY NAME, and
# dbus-daemon resolves that name to a number at startup. An unpinned allocator
# would make the number a build-time detail, and a build that resolved it
# differently would leave the shipped policy granting a uid the unit does not
# run as -- a live rule matching nobody, which is the failure this whole
# arrangement exists to avoid.
#
# THE NUMBER IS 970 BECAUSE 990 COLLIDED, and the collision is why the check
# below exists. 990 was free on bookworm and is taken by `sshd` on trixie, so
# the base-image upgrade failed here rather than silently producing an account
# at some other uid -- which would have left mos-mqttd.conf granting a uid the
# unit does not run as, and the bridge publishing nothing with no error at the
# point of cause. 970 is free on both, and sits well below the 999 that
# Debian's `useradd --system` allocates downward from, so it does not race the
# base image's own accounts as that allocation walks down.
#
# --system: no home, no login shell, no aging. `chage -d` pins the shadow
# LAST-CHANGE field for the same determinism reason as the mos account: useradd
# stamps today's date, which would change the packed rootfs -- and its
# dm-verity root hash -- on every build day for no content reason.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/account-mos-mqttd.sh

# The mos-mqtt-broker service account.
#
# WHY A STATIC ACCOUNT AND NOT DynamicUser, arrived at by a different route
# than mos-mqttd's. The broker reads /var/lib/mos/mqtt-broker-users.toml, a
# credentials file on STATE that outlives every start of the unit and survives
# an A/B update. A dynamic uid is allocated at start and gone at stop, so there
# is no identity to own that file: the ownership written on one boot names
# nobody on the next, and the only way to keep it readable would be to make the
# credentials world-readable.
#
# uid AND gid are PINNED, and NOT for the reason recorded above this. The broker
# has no D-Bus policy at all -- it never speaks D-Bus -- so there is no
# <policy user=> resolving a name to a number at dbus-daemon startup. They are
# pinned because that credentials file sits on persistent storage that outlives
# any single image: a uid that moved between builds would leave a file on STATE
# owned by a number the new image hands to somebody else, so the broker would
# lose its own credentials or another service would silently inherit them.
#
# THE NUMBER IS 969 because it is the next free number below the 970 mos-mqttd
# holds, and it is well below the 999 that Debian's `useradd --system` allocates
# downward from, so it does not race the base image's own accounts as that
# allocation walks down. The collision check below is the one the 970 block
# carries, kept for the reason recorded there: 990 was free on bookworm and is
# taken by `sshd` on trixie, so a base-image upgrade must fail HERE rather than
# silently produce the account at some other uid.
#
# --system: no home, no login shell, no aging. `chage -d` pins the shadow
# LAST-CHANGE field for the same determinism reason as the accounts above:
# useradd stamps today's date, which would change the packed rootfs -- and its
# dm-verity root hash -- on every build day for no content reason.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/account-mos-mqtt-broker.sh

# Board hardware init: best-effort oneshots from os/boards/cx3576/hwinit/ +
# per-board facts staged from BOARD_DIR/init into /etc/mos.
#
# The MECHANISM is board-agnostic -- nothing below names a board -- but the
# units are filed under cx3576 because cx3576 is the only board that declares
# a hardware fact for them to read. x64 declares none, so the loop below
# installs none of them there; the COPY is what it has always been, a
# fixed path staged into /tmp for the loop to select from.
#
# BOARD_INIT_DIR may be an empty dir (boards without hw-init facts): every unit
# is condition-gated on its conf file, so enabling them is safe either way.
#
# The install list is ENUMERATED from the board facts actually staged, never
# restated here. A hardcoded list is what let this file drift behind the
# (since deleted) v1 Dockerfile once already: mos-mac and mos-gadget were
# installed but silently left disabled, costing the image its stable MAC and
# its USB debug console with no error anywhere. Adding hwinit-<n> plus
# mos-<n>.service under os/boards/cx3576/hwinit/, and an <n>.conf to the
# board, is enough.
#
# A BOARD ONLY GETS THE SCRIPTS FOR FACILITIES IT DECLARES. Every unit is
# condition-gated on its conf file, so shipping all of them to every board was
# harmless in the sense that the extra ones never ran -- but "never runs" is a
# property of a file being absent, not of a gate being right. x64 is a QEMU
# machine with no Bluetooth: it was carrying hwinit-bt, whose `rfkill unblock`
# put a dependency on a binary that board has no reason to install, and the
# image verifier reported exactly that. Dead code in a signed read-only root is
# not free, and both directions are asserted below: a conf with no script is an
# unread board fact, and a script with no conf is a unit that can never run.
#
# No board fact appears in this stage. Module names, sysfs paths, UART device,
# CAN bitrate, MAC seed and gadget IDs all live in BOARD_INIT_DIR and are read
# from /etc/mos at runtime by the units.
ARG BOARD_INIT_DIR
COPY os/boards/cx3576/hwinit/ /tmp/hwinit/
COPY ${BOARD_INIT_DIR}/ /tmp/board-init/
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/hwinit-install.sh
