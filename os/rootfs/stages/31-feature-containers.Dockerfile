# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# stages/31-feature-containers -- the container engine: its runtime packages,
# the seven self-built binaries, the three assertions about the assembled root,
# the runtime exercise, and the assertion that mos's own configuration is the
# only configuration layer.

# This stage is the switch. There is no WITH_CONTAINERS build arg: a build that
# does not want the engine does not build this file. One decision, made once,
# by whoever assembles the stage list. It is a decision that is recorded --
# os/build/src/stages.ts writes rootfs-stages.txt beside the artifacts, one
# line per stage that ran, because an image built without a feature stage and
# an image whose feature stage did nothing are otherwise indistinguishable
# afterwards.

# The caller-facing spelling is unchanged: `WITH_CONTAINERS=0 bash
# os/rootfs/build-v2.sh` and os/boards/<name>/bsp/containers.env still work, and
# build-v2.sh turns them into `--without containers`.

# `podman-assert-config` is last in this file because it asserts what the
# overlay wrote; stages/20-install installs the overlay two stages ahead of
# every feature, so it needs nothing this file does not already have.

# The link back up the chain. MOS_STAGE_PREV is the local image tag the
# previous stage was written to; the driver passes it and refuses to build a
# stage that does not declare it. There is no default, so this file cannot be
# built standalone against whatever `FROM` happened to be typed -- which is the
# whole safety of a chain built out of separate files.
ARG MOS_STAGE_PREV
FROM ${MOS_STAGE_PREV}

# The container engine ships installed and inert. The switch is
# `container.enabled` in the settings tree and mosd owns the transition; an
# image that started containers before anyone asked would be the opposite of
# the decision.

# Inert by construction, not by masking. Upstream's system units live in
# podman's contrib/ tree and are installed by `make install.systemd`, which
# os/pkgs/podman does not run. The units are not masked -- they are absent, and the
# assertion below is that no unit named podman* exists anywhere in the image.
# That fails on any podman unit at all, whatever its name, where a mask list
# could only fail if podman's known unit set changed.

# What the absent units would have done, and who does it now:
#   podman.socket/.service -- the root REST API, socket-activated so `disable`
#     was never enough. Not built.
#   podman-auto-update.* -- scheduled image pulls. mos does not manage
#     container updates; the integrator does.
#   podman-restart.service -- restart policies at boot; systemd already owns
#     lifecycle here, through Quadlet-generated units.
#   podman-clean-transient -- transient state cleanup at boot.
#   podman-kube@.service -- the Kubernetes YAML path, which this project does
#     not carry.

# No engine packages here. This list installs what the engine links and execs;
# the seven binaries themselves come from os/pkgs/podman, built from pinned upstream
# source, and are copied in below. Every package is derived from podman
# v5.8.6's own source rather than from what `apt-get install podman` pulls.

#   nftables -- netavark 2.1.0 has exactly three firewall drivers: Firewalld,
#     Nftables, Fwnone (src/firewall/mod.rs); the iptables driver was removed
#     in 2.x. nftables is the compile-time default (build.rs:69) and netavark
#     reaches it by execing `nft` off PATH (nftables-0.6.3/src/helper.rs:13,
#     NFT_EXECUTABLE = "nft"). Without it the first `podman run` fails with
#     `netavark: nftables error: unable to execute nft`. A dependency reached
#     by exec is invisible to every NEEDED-soname check by construction, which
#     is why it is listed here by name.

#   libjson-c5 -- crun 1.29.1 requires json-c: its configure.ac has one JSON
#     dependency, `PKG_CHECK_MODULES([JSON_C], [json-c >= 0.14])`, and the
#     string "yajl" does not appear in the file. trixie's crun 1.21 links
#     libyajl2 instead, so the packaged engine would need the wrong one of the
#     pair.

#   the rest -- link-time dependencies, taken from the built binaries' NEEDED
#     entries rather than predicted: libsubid5 and libseccomp2 (podman),
#     libcap2 (crun), libglib2.0-0t64 (conmon). They are not trusted to be
#     right either -- the ldd assertion below runs the real loader against the
#     real binaries in the assembled root and names any soname that fails to
#     resolve. libsqlite3-0 is deliberately NOT here: podman depends on
#     mattn/go-sqlite3 (go.mod:44), the cgo driver, but it compiles the SQLite
#     amalgamation in unless the `libsqlite3` build tag is set, so nothing
#     links the system library.

# A third kind of dependency is invisible to both checks above: podman reaches
# libsystemd by dlopen, not by linking, because go-systemd's sdjournal opens
# "libsystemd.so.0" by name at runtime (vendor/github.com/coreos/go-systemd/
# v22/sdjournal/functions.go:37). It does not appear in NEEDED, ldd cannot see
# it, and containers.conf sets log_driver = "journald", so its absence would
# lose container logs rather than fail loudly. systemd is in the base image so
# the library is present; the assertion below is that it stays present.

# libgpgme11t64 is not needed because os/pkgs/podman builds with the
# `containers_image_openpgp` tag, which replaces gpgme with a pure-Go
# implementation; libyajl2 goes with crun. This is a separate apt transaction
# from stages/10-base's allowlist -- reaching this line already means the
# engine was asked for, because this file only builds when it was.
RUN apt-get update && apt-get install -y --no-install-recommends \
        nftables \
        libjson-c5 libsubid5 libseccomp2 libcap2 libglib2.0-0t64 \
    && rm -rf /var/lib/apt/lists/*

ARG PODMAN_DIR
COPY ${PODMAN_DIR}/ /tmp/podman/
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/podman-install.sh

# Three assertions about the assembled root:
# 1. No podman units. Not "the seven we know about are masked" -- none exists.
# 2. Every soname resolves, answered by the real loader running against the
#    real binaries in the real root, under emulation. Diffing NEEDED against a
#    library list read out of the previous image would be both a weaker claim
#    and a build-order cycle: the rootfs needs the engine, and that list would
#    need the rootfs. ldd here has neither problem.
# 3. The config files podman actually reads are present. Their paths come from
#    podman v5.8.6's own source, cited in each file.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/podman-assert.sh

# The engine is exercised here, not merely installed. This RUN executes arm64
# binaries under the builder's emulation, which is the only place before a real
# flash where the shipped podman and the shipped Quadlet generator can be made
# to do their jobs. Everything above this line is a claim about files.

# What is proven: podman, netavark and aardvark-dns execute on arm64 and report
# their versions; crun and nft execute, each failing in one specific way the
# emulator is known to cause and no other, so "could not run at all" cannot
# pass as "ran"; podman parses the image's containers.conf, checked against a
# deliberately malformed control so the check is known to be capable of
# failing; and Quadlet turns a real .container file into a unit whose ExecStart
# invokes podman with the image it named.

# What is not proven, named specifically rather than as a category, because a
# limitation stated as a category is where a missing file hides behind a
# missing capability:
#   * A container starting. Needs cgroups and namespaces the build sandbox
#     does not have.
#   * That containers.conf's values take effect -- that podman resolves its
#     runtime to /usr/bin/crun and conmon to /usr/libexec/podman/conmon rather
#     than finding something under /usr/local first. `podman info` reports
#     exactly that and cannot run here: it fails with `cannot clone: Invalid
#     argument`, the user-namespace re-exec buildkit does not allow. The
#     verifier checks the file says so; only the device checks podman agrees.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/podman-exercise.sh

# The container configuration mos ships instead of the distribution's. A
# separate RUN from the engine install, because the files it asserts arrive
# with the overlay and not with the engine. stages/20-install installs the
# overlay two stages ahead of every feature, so the paths are there -- but the
# subject of this assertion is still the overlay's output, which is why it is
# not folded into podman-install.sh.

# Nothing else writes them: golang-github-containers-common is not installed,
# so if the overlay ever stops carrying one of these, podman does not fail. It
# falls back to a built-in default nobody chose -- graphroot on the EPHEMERAL
# partition, or a signature policy that is not the one reviewed here.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/podman-assert-config.sh
