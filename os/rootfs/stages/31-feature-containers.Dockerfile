# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# =============================================================================
# stages/31-feature-containers — the container engine: its runtime packages,
# the seven self-built binaries, the three assertions about the assembled root,
# the runtime exercise, and the assertion that mos's own configuration is the
# only configuration layer.
#
# PLAN-014 M5 (RFCT-111 M5c), cut out of the temporary 30-40-unsplit.
#
# ═══ THIS STAGE IS THE SWITCH. WITH_CONTAINERS IS GONE ═══
#
# It used to be `ARG WITH_CONTAINERS=1`, tested by the RUN below and again by
# four of the five scripts, each of which opened with `if [ "$WITH_CONTAINERS"
# != "1" ]; then exit 0; fi`. RFCT-111 replaces that with stage selection:
# a build that does not want the engine does not build this file.
#
# WHY THAT IS A BETTER SWITCH AND NOT A RESPELLING OF THE SAME ONE. The old
# arrangement had five independent copies of one decision, and a build in which
# any of them disagreed was a build that produced an image nobody asked for --
# the engine installed and its assertions skipped, or the assertions run
# against a root with no engine in it. The comment this replaced said so:
# "everything downstream keys off the same arg, so a board without the engine
# is not a board with half of one." That was a rule the file asked its readers
# to keep. It is now a property of the chain: there is one decision, it is made
# once, and it is made by whoever assembles the stage list.
#
# It is also a decision that is RECORDED. os/build/src/stages.ts writes
# rootfs-stages.txt beside the artifacts, one line per stage that ran, because
# an image built without a feature stage and an image whose feature stage did
# nothing are indistinguishable afterwards -- which is exactly what a build arg
# set to 0 left behind.
#
# The caller-facing spelling has NOT changed. `WITH_CONTAINERS=0 bash
# os/rootfs/build-v2.sh` and board/<name>/containers.env still mean what they
# meant; build-v2.sh turns them into `--without containers`. RFCT-111 replaces
# the BUILD ARG, which is the copy that had to be threaded through five files.
#
# ═══ THE ORDER INSIDE THIS FILE ═══
#
# Positions 2, 6, 7, 8 and 13 of 30-40-unsplit, in that relative order.
# `podman-assert-config` was the 13th: it sat after the board's kernel and
# firmware RUNs because it needs the overlay, which stages/20-install installs.
# The overlay is now two stages behind every feature, so it needs nothing that
# is not already there and it rejoins the feature it belongs to.
# =============================================================================

# THE LINK BACK UP THE CHAIN. MOS_STAGE_PREV is the local image tag the
# previous stage was written to; the driver passes it and refuses to build a
# stage that does not declare it. There is no default, so this file cannot be
# built standalone against whatever `FROM` happened to be typed -- which is the
# whole safety of a chain built out of separate files.
ARG MOS_STAGE_PREV
FROM ${MOS_STAGE_PREV}

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
# A SEPARATE apt TRANSACTION from stages/10-base's allowlist, and no longer a
# conditional one. The `if [ "$WITH_CONTAINERS" = "1" ]` that used to wrap this
# is gone with the argument: a build that does not want the engine does not
# build this file, so reaching this line already means the engine was asked
# for. The `else` arm printed a note saying the engine was being skipped, and
# rootfs-stages.txt now carries that fact in a form that outlives the log.
RUN apt-get update && apt-get install -y --no-install-recommends \
        nftables \
        libjson-c5 libsubid5 libseccomp2 libcap2 libglib2.0-0t64 \
    && rm -rf /var/lib/apt/lists/*

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
