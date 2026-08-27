#!/usr/bin/env bash
# Build the squashfs + dm-verity arm64 rootfs slot image for cx3576 (layout v2).
# Usage: [BOARD_DIR=...] [WITH_MOSD=0|1]
#        [WITH_CONTAINERS=0|1] [MOS_PROFILE=dev|prod]
#        [MOS_ROOTFS_WITHOUT="radios rauc mqtt ..."] bash os/rootfs/build-v2.sh

# There is deliberately no ROOT_PASSWORD here. A v2 rootfs is a signed,
# byte-identical squashfs and the pack stage fails any build whose factory
# shadow carries a usable hash, so a baked v2 root password is unbuildable by
# design, not merely discouraged. Dev root access on v2 is the transient
# password set at runtime through mosd (SetTransientRootPassword; cleared on
# the next boot by mos-shadow-reconcile) plus the serial console, whose root
# account stays locked until that password is set. See
# docs/design/access.md section 4.1.

# Outputs (all under _out/<board>/). The first four are consumed by the image
# assembler, os/build/src/mkimage-v2.ts and mkimage-x64.ts:
#   rootfs-verity.img: squashfs-zstd with the verity hash tree appended,
#     padded to a whole MiB
#   rootfs-verity.env: verity parameters, strict KEY=value
#   boot-cmdline-a.txt, boot-cmdline-b.txt: the kernel append line per slot

# The rest are records rather than assembler inputs:
#   rootfs-report-v2.txt: package list + installed size
#   factory-root.oci: the packed root as an OCI image, in OCI-layout tar form.
#     NOT consumed by the assembler -- this is what the smoke runner executes
#     the self-built binaries in, so "it linked" and "it runs" stop being the
#     same claim. `docker load -i` it.
#   factory-root.txt: what that archive is -- ref, platform, size, sha256
#   rootfs-stages.txt: the stage chain as built, and a `# declined:` line
#   mosd-build.txt: the commit mosd and apid in this root were built from,
#     copied from _out/mosd-build.txt. NOT copied into the image. Removed when
#     mosd is declined; see below.
# os/rootfs/README.md, "Outputs to _out/<board>/", is the table version of this.

# Every layout constant is read from os/boards/cx3576/board.env.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
# MOS_BOARD selects the layout, the output directory and the architecture.
# cx3576 is the default and its path is unchanged; x64 is the QEMU target, and
# it exists so that the two things the arm64 build CANNOT prove -- a container
# actually starting, and containers.conf's values taking effect -- have
# somewhere to be proven before hardware.
MOS_BOARD=${MOS_BOARD:-cx3576}
case "$MOS_BOARD" in
cx3576)
    MOS_ARCH=arm64
    RUST_TARGET=aarch64-unknown-linux-gnu
    ELF_ARCH=aarch64
    ;;
x64)
    MOS_ARCH=amd64
    RUST_TARGET=x86_64-unknown-linux-gnu
    ELF_ARCH=x86-64
    ;;
*)
    echo "error: MOS_BOARD is '$MOS_BOARD'; known boards are cx3576 and x64" >&2
    exit 1
    ;;
esac
DOCKER_PLATFORM="linux/${MOS_ARCH}"
LAYOUT_ENV="$REPO_ROOT/os/boards/${MOS_BOARD}/board.env"
BOARD_DIR=${BOARD_DIR:-"$REPO_ROOT/os/boards/${MOS_BOARD}/bsp"}
OUT_DIR="$REPO_ROOT/_out/${MOS_BOARD}"
# Installed-size budget. A per-board fact for the same reason
# BOARD_CMDLINE_ARGS is: it protects a rootfs slot, and the slots differ.
SIZE_BUDGET_MB="${SIZE_BUDGET_MB_OVERRIDE:-}"
WITH_MOSD=${WITH_MOSD:-1}
case "$WITH_MOSD" in
0 | 1) ;;
*)
    echo "error: WITH_MOSD is '$WITH_MOSD'; it must be exactly 0 or 1. It selects whether stages/33-feature-mosd is in the chain, and anything else here would be read as 'not 1' and silently build an image with no management daemon" >&2
    exit 1
    ;;
esac

# Whether the container engine is in the image at all.
#
# BOARD-LEVEL, because it is a board decision: the engine costs ~107 MB
# installed and a board with a tighter rootfs slot, or no use for containers,
# should not carry it. The board opts OUT by shipping a containers.env saying
# so; absent means ON, which is the cx3576 default the user asked for.
#
# An explicit WITH_CONTAINERS in the environment beats the board file, so a
# one-off build can go either way without editing the board.
#
# This is the BUILD-time switch: is the engine present. The RUN-time switch --
# `container.enabled` in the settings tree, driven from apid -- is a different
# question: whether an engine that IS present may be used.
if [ -z "${WITH_CONTAINERS:-}" ] && [ -f "$BOARD_DIR/containers.env" ]; then
    # shellcheck disable=SC1091
    . "$BOARD_DIR/containers.env"
fi
WITH_CONTAINERS=${WITH_CONTAINERS:-1}
case "$WITH_CONTAINERS" in
0 | 1) ;;
*)
    echo "error: WITH_CONTAINERS is '$WITH_CONTAINERS'; it must be exactly 0 or 1. It selects whether stages/31-feature-containers is in the chain, and anything else here would be read as 'not 1' and the engine would silently not ship" >&2
    exit 1
    ;;
esac
# The declined features, as one list. WITH_CONTAINERS and WITH_MOSD are the
# two historical spellings and they fold into it here, so there is one answer
# to "is this feature in the image" and every consumer below asks the same
# question. MOS_ROOTFS_WITHOUT is the general form -- a space-separated list of
# feature names -- and it is what makes the three stages with no WITH_* history
# (radios, rauc, mqtt) reachable from the shipping path at all.

# A name nothing matches is not validated here, deliberately: the driver holds
# the list of feature stages (it reads the directory) and refuses an unknown
# one by name, with the features that do exist. A second copy of that list in
# this file is the second table this repository keeps deleting.
MOS_ROOTFS_WITHOUT=${MOS_ROOTFS_WITHOUT:-}
WITHOUT_FEATURES=" ${MOS_ROOTFS_WITHOUT} "
[ "$WITH_CONTAINERS" = "1" ] || WITHOUT_FEATURES="${WITHOUT_FEATURES}containers "
[ "$WITH_MOSD" = "1" ] || WITHOUT_FEATURES="${WITHOUT_FEATURES}mosd "
# `case` and not a substring test with [[ ]]: this file is bash, but the pattern
# is the same one the POSIX scripts use and one spelling reads the same in both.
declined() { case "$WITHOUT_FEATURES" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
if [ -n "${MOS_ROOTFS_WITHOUT}" ]; then
    echo "note: MOS_ROOTFS_WITHOUT declines:${MOS_ROOTFS_WITHOUT}"
fi

# Image profile baked into /usr/lib/mos/profile.conf. mosd reads it on first
# boot and FAILS CLOSED to prod, so the value has to be exactly "dev" or "prod"
# in lowercase; the Dockerfile rejects anything else. It does NOT select the
# access.ssh.enabled seed: both profiles seed SSH OFF and neither image ships
# ssh.service enabled, so the profile currently changes nothing that is seeded.
MOS_PROFILE=${MOS_PROFILE:-dev}

if [ ! -f "$LAYOUT_ENV" ]; then
    echo "error: $LAYOUT_ENV not found" >&2
    exit 1
fi
# shellcheck source=../boards/cx3576/board.env
. "$LAYOUT_ENV"

# Board console facts. These describe a board's serial console, not its
# partition layout, so each os/boards/<board>/board.env carries its own
# BOARD_CMDLINE_ARGS and this refuses a layout that forgot to.
SIZE_BUDGET_MB="${SIZE_BUDGET_MB:-${BOARD_SIZE_BUDGET_MB:-}}"
if [ -z "$SIZE_BUDGET_MB" ]; then
    echo "error: $LAYOUT_ENV sets no BOARD_SIZE_BUDGET_MB. Without a budget the root can grow past its slot and the first sign would be an image that does not fit" >&2
    exit 1
fi
if [ -z "${BOARD_CMDLINE_ARGS:-}" ]; then
    echo "error: $LAYOUT_ENV sets no BOARD_CMDLINE_ARGS. The kernel command line would carry no console= at all, so the board would boot with nowhere to print why it did not" >&2
    exit 1
fi

# The verity superblock carries a UUID that veritysetup randomises by default,
# which would make the image differ on every build. Pin it to the rootfs-a
# partition GUID rather than inventing a new magic constant: it is already a
# per-layout identifier from the layout env, and both slots hold the same
# content so sharing one value across A and B is correct.
VERITY_UUID=$(echo "$ROOTFS_A_GUID" | tr 'A-Z' 'a-z')
# FILE_MTIME is the touch(1) form (@epoch); mksquashfs wants bare seconds.
#
# One instant, two consumers: this value is also what the driver is given as
# --source-date-epoch, which buildkit stamps into the OCI export of the packed
# root. Deliberately the same number and not two pinned constants -- the
# squashfs and the OCI image are two encodings of one tree, and a second epoch
# would be a second answer to "when was this root made" that nothing would
# reconcile. The assembler spells it this way for mkimage's SOURCE_DATE_EPOCH.
SQUASHFS_TIME=${FILE_MTIME#@}

mkdir -p "$OUT_DIR"
if [ "$MOS_ARCH" = "amd64" ]; then
    # No vendor tree on this target: the Dockerfile installs Debian's
    # linux-image-amd64, which brings kernel, initramfs and modules together.
    # An empty tar is staged anyway because a COPY cannot be made conditional,
    # and a context file that is simply absent fails the build with a message
    # about the COPY rather than about the board.
    tar -cf "$OUT_DIR/modules.tar" -T /dev/null
else
    MODULES_TAR="$BOARD_DIR/out/kernel/modules.tar"
    if [ ! -f "$MODULES_TAR" ]; then
        echo "error: $MODULES_TAR not found." >&2
        echo "Build it with 'make -C os/boards/$MOS_BOARD/bsp kernel' or point BOARD_DIR at" >&2
        echo "prebuilt BSP artifacts, e.g. BOARD_DIR=/srv/ai/mos/os/boards/cx3576/bsp" >&2
        exit 1
    fi
    cp "$MODULES_TAR" "$OUT_DIR/modules.tar"
fi

# The container engine, built from source by os/podman, staged like
# modules.tar and mosd. The directory is created either way and left empty when
# the engine is declined -- nothing COPYs it then, because
# stages/31-feature-containers is not in the chain, and the mkdir is here so a
# stale directory from a previous WITH_CONTAINERS=1 build cannot be picked up
# by the next one. It is NOT built on demand: `make podman` compiles four
# Go/Rust/C trees and takes tens of minutes, so it is a separate target and the
# absence of its output is an error carrying the command to run.

# RAUC, built from upstream source by os/update/rauc/build.sh. Staged like
# podman and like mosd: the Dockerfile COPYs a directory under _out, never a
# path outside the build context.
RAUC_STAGE="$OUT_DIR/rauc"
rm -rf "$RAUC_STAGE"
mkdir -p "$RAUC_STAGE"
if declined rauc; then
    echo "note: rauc declined; building rootfs without stages/32-feature-rauc"
else
RAUC_OUT="$REPO_ROOT/os/update/rauc/out-$MOS_ARCH"
for f in rauc rauc.service rauc-service.sh de.pengutronix.rauc.conf de.pengutronix.rauc.service NEEDED.txt RAUC_VERSION.env; do
    if [ ! -f "$RAUC_OUT/$f" ]; then
        echo "error: $RAUC_OUT/$f not found." >&2
        echo "RAUC is built from source now, not installed from Debian (os/update/rauc/versions.env says why)." >&2
        echo "Build it with 'MOS_BOARD=$MOS_BOARD make os-rauc'." >&2
        exit 1
    fi
    cp "$RAUC_OUT/$f" "$RAUC_STAGE/$f"
done
echo "rauc: staged $(sed -n 's/^RAUC_VERSION=//p' "$RAUC_STAGE/RAUC_VERSION.env") for $MOS_ARCH"
fi

PODMAN_STAGE="$OUT_DIR/podman"
rm -rf "$PODMAN_STAGE"
mkdir -p "$PODMAN_STAGE"
if ! declined containers; then
    PODMAN_OUT="$REPO_ROOT/os/podman/out-$MOS_ARCH"
    for b in podman quadlet crun conmon netavark aardvark-dns catatonit; do
        if [ ! -f "$PODMAN_OUT/$b" ]; then
            echo "error: $PODMAN_OUT/$b not found." >&2
            echo "stages/31-feature-containers is in the chain, which asks for a container engine, and none has been built." >&2
            echo "Build it with 'MOS_ARCH=$MOS_ARCH make podman', or set WITH_CONTAINERS=0 for a board that declines the engine." >&2
            exit 1
        fi
        cp "$PODMAN_OUT/$b" "$PODMAN_STAGE/$b"
    done
    # `[ -f x ] && cp` would be the last command of the if-branch, and under
    # `set -e` a false test there exits the whole script with 0 -- a rootfs
    # build that stops silently after staging seven binaries.
    if [ -f "$PODMAN_OUT/SHA256SUMS" ]; then
        cp "$PODMAN_OUT/SHA256SUMS" "$PODMAN_STAGE/SHA256SUMS"
    fi
fi

# mosd: cross-build and stage into the context like modules.tar. The staged
# directory is created either way and is left EMPTY when mosd is declined --
# stages/33-feature-mosd is then not in the chain and nothing COPYs it. The
# rm -rf is what keeps a previous WITH_MOSD=1 build's binaries from being
# copied into an image that asked for none.
MOSD_STAGE="$OUT_DIR/mosd"
rm -rf "$MOSD_STAGE"
mkdir -p "$MOSD_STAGE"
# Removed for the same reason the stage directory is emptied: a mosd-build.txt
# left by a previous WITH_MOSD=1 build would describe binaries this image does
# not carry, and the smoke runner would then assert a commit against an artifact
# that is not there. Absent is a state it already handles; stale is one nothing
# could catch.
rm -f "$OUT_DIR/mosd-build.txt"
if ! declined mosd; then
    bash "$REPO_ROOT/mosd/hack/build-target.sh" "$RUST_TARGET" "$ELF_ARCH"
    # The commit that build embedded in mosd and apid, carried into this board's
    # output directory beside the factory root the two binaries end up in.
    # The smoke runner asserts what they REPORT against what was
    # EMBEDDED, and the alternative -- `git rev-parse HEAD` at run time -- would
    # pass on any freshly built tree while asserting nothing about whether the
    # embedding works at all. Copied rather than re-derived, so the value the
    # runner compares against is the one the compiler was actually handed.
    cp "$REPO_ROOT/_out/mosd-build.txt" "$OUT_DIR/mosd-build.txt"
    cp "$REPO_ROOT/mosd/target/$RUST_TARGET/release/mosd" "$MOSD_STAGE/mosd"
    cp "$REPO_ROOT/mosd/dist/mosd.service" "$MOSD_STAGE/mosd.service"
    cp "$REPO_ROOT/mosd/dist/com.mos.mosd.conf" "$MOSD_STAGE/com.mos.mosd.conf"
    cp "$REPO_ROOT/mosd/dist/com.mos.ext.conf" "$MOSD_STAGE/com.mos.ext.conf"
    cp "$REPO_ROOT/mosd/target/$RUST_TARGET/release/apid" "$MOSD_STAGE/apid"
    cp "$REPO_ROOT/mosd/dist/apid.service" "$MOSD_STAGE/apid.service"
    # The MQTT bridge. Its unit lives in the crate rather than
    # mosd/dist because the crate is where it is maintained; its D-Bus grant
    # lives in mosd/dist beside the policy it is layered over.
    cp "$REPO_ROOT/mosd/target/$RUST_TARGET/release/mos-mqttd" \
        "$MOSD_STAGE/mos-mqttd"
    cp "$REPO_ROOT/mosd/mqttd/dist/mos-mqttd.service" "$MOSD_STAGE/mos-mqttd.service"
    cp "$REPO_ROOT/mosd/dist/mos-mqttd.conf" "$MOSD_STAGE/mos-mqttd.conf"
    # The broker the bridge above connects to. No D-Bus grant to
    # stage beside it: it is not a bus client, it only listens on TCP. Its
    # config is not staged either -- mosd renders /run/mos/mqtt-broker.toml at
    # runtime, because a file baked into an immutable root would be the same
    # listen address on every device flashed with this image.
    cp "$REPO_ROOT/mosd/target/$RUST_TARGET/release/mos-mqtt-broker" \
        "$MOSD_STAGE/mos-mqtt-broker"
    cp "$REPO_ROOT/mosd/broker/dist/mos-mqtt-broker.service" \
        "$MOSD_STAGE/mos-mqtt-broker.service"
else
    echo "note: mosd declined; building rootfs without stages/33-feature-mosd"
fi

# The board's own content, staged so that stages/40-board names no board.
#
# A COPY cannot be gated on an ARG, so a board's content reaches
# stages/40-board as a directory this script fills from the board's own trees,
# empty when the board declares nothing. The three below and modules.tar above
# are the whole set, and they are together so that adding a board means filling
# directories rather than editing a Dockerfile.

# Radio firmware, filtered to what the board declares.
#
# NOT the whole BSP drop. os/boards/<b>/bsp/rootfs/firmware is the vendor tarball --
# 32 files for cx3576, most of them other AIC parts (8800dc, 8800dw) and other
# silicon revisions -- and only the confirmed runtime set may enter a signed
# root. BOARD_FIRMWARE_FILES in os/boards/<b>/board.env is that set and already
# was: os/verify-image-v2.sh has asserted the image against it since x64
# arrived. Read here rather than copied, so the build and the verifier cannot
# disagree about which firmware the board carries.
#
# The declared paths are INSTALLED paths (/usr/lib/firmware/...), because that
# is what the verifier needs them to be. This takes the basename and requires
# the BSP to have it: a declared file the drop does not contain is a build
# error naming both, rather than a device whose driver finds no firmware.
FW_STAGE="$OUT_DIR/firmware"
rm -rf "$FW_STAGE"
mkdir -p "$FW_STAGE"
for fw in ${BOARD_FIRMWARE_FILES}; do
    case "$fw" in
    /usr/lib/firmware/*) ;;
    *)
        echo "error: $LAYOUT_ENV declares BOARD_FIRMWARE_FILES entry '$fw', which is not under /usr/lib/firmware/. The entries are INSTALLED paths -- os/verify-image-v2.sh checks the image for each one, and stages/40-board's installer asserts the same paths after the move" >&2
        exit 1
        ;;
    esac
    fw_src="$BOARD_DIR/rootfs/firmware/${fw##*/}"
    if [ ! -f "$fw_src" ]; then
        echo "error: $LAYOUT_ENV declares $fw and $fw_src does not exist." >&2
        echo "Firmware is a BSP artefact like modules.tar; point BOARD_DIR at a tree that has it," >&2
        echo "e.g. BOARD_DIR=/srv/ai/mos/os/boards/$MOS_BOARD/bsp" >&2
        exit 1
    fi
    cp "$fw_src" "$FW_STAGE/${fw##*/}"
done
if [ -n "${BOARD_FIRMWARE_FILES}" ]; then
    echo "firmware: staged $(find "$FW_STAGE" -type f | wc -l | tr -d ' ') file(s) from $BOARD_DIR/rootfs/firmware"
else
    echo "note: $MOS_BOARD declares BOARD_FIRMWARE_FILES empty; staging no radio firmware"
fi

# The hwinit oneshots and their units, from THIS board's directory.
#
# os/boards/<b>/hwinit, not os/boards/cx3576/hwinit. The mechanism in
# stages/40-board is board-agnostic and always was; what was filed under one
# board was the CONTENT, because cx3576 was the only board declaring a fact for
# any of it to read. x64 carried all six scripts, ran none, and the image
# verifier reported hwinit-bt's `rfkill unblock` as a dependency on a binary
# that board has no reason to install.
#
# A board with no hwinit/ stages an empty directory -- the same statement
# BOARD_INIT_DIR below has always been allowed to make. It is not silent: a
# board that declares a fact and stages no script for it fails in
# hwinit-install.sh, by name.
HWINIT_STAGE="$OUT_DIR/hwinit"
rm -rf "$HWINIT_STAGE"
mkdir -p "$HWINIT_STAGE"
if [ -d "$REPO_ROOT/os/boards/$MOS_BOARD/hwinit" ]; then
    cp -a "$REPO_ROOT/os/boards/$MOS_BOARD/hwinit/." "$HWINIT_STAGE/"
fi

# Board hardware-init facts (the confs the hwinit units consume), staged like
# mosd so the Dockerfile COPY always has a directory (may be empty).
INIT_STAGE="$OUT_DIR/init"
rm -rf "$INIT_STAGE"
mkdir -p "$INIT_STAGE"
# The fallback is to THIS board's in-repo init, not to cx3576's. It said
# cx3576 while cx3576 was the only board, and an x64 build would then have
# silently taken bt.conf, can.conf, gadget.conf and otg.conf -- hardware facts
# for a radio, a CAN bus and a USB gadget controller that a QEMU machine does
# not have. Nothing downstream would have objected: the Dockerfile copies
# whatever is staged into /etc/mos, and the hwinit units read what is there.
#
# A board with no init/ at all stages an empty directory, which the Dockerfile
# documents as supported ("BOARD_INIT_DIR may be an empty dir").
if [ -d "$BOARD_DIR/init" ]; then
    cp -a "$BOARD_DIR/init/." "$INIT_STAGE/"
elif [ -d "$REPO_ROOT/os/boards/$MOS_BOARD/bsp/init" ]; then
    cp -a "$REPO_ROOT/os/boards/$MOS_BOARD/bsp/init/." "$INIT_STAGE/"
fi

# Read-only root wiring. The overlay tree is copied into the build context with
# its *.in templates rendered from the layout env, so the shipped image carries
# no placeholder and the Dockerfile carries no layout constant.
# PARTUUID values are lowercased: udev derives /dev/disk/by-partuuid/ symlinks
# from libblkid, which formats GUIDs in lowercase, and systemd's fstab-generator
# resolves PARTUUID= through those symlinks without normalising case.
OVERLAY_SRC="$SCRIPT_DIR/overlay-v2"
OVERLAY_STAGE="$OUT_DIR/overlay-v2"

# The RAUC system.conf is rendered from os/update/rauc/system.conf.in and the
# layout env by os/update/rauc/render-config.sh, which owns that template and
# its assertions (the statusfile must not land on /var, the boot-attempts radix
# range, and the fw_env.config structure). It is generated rather than
# committed: a rendered artifact in git can drift from its template, and a
# --check can only report that drift after the fact, not prevent it. Rendering
# it here, on the build path that consumes it, makes the template the single
# source of truth. The renderer writes into OVERLAY_SRC, so it must run before staging.
MOS_BOARD="$MOS_BOARD" bash "$REPO_ROOT/os/update/rauc/render-config.sh"

rm -rf "$OVERLAY_STAGE"
mkdir -p "$OVERLAY_STAGE"
cp -a "$OVERLAY_SRC/." "$OVERLAY_STAGE/"

# Per-board overlay, layered on top of the shared one. Only files that are
# wrong on another board belong here -- x64's ESP mount unit is one, because
# RAUC's grub backend edits a file and the U-Boot backend edits a raw
# partition, so /boot is a mountpoint on exactly one of the two boards.
# Layered rather than selected: everything both boards share stays in one
# place, so a change to it cannot reach one board and miss the other.

# The status indicator is a board file. It is not in overlay-v2 and is deleted
# here for boards that declare no LED: the shared overlay would otherwise claim
# every board has an indicator and the truth would live in a conditional
# somewhere else. os/boards/cx3576/overlay/ carries mos-status-led, its unit
# and its wants symlink, so the file's location is the fact.
# BOARD_HAS_STATUS_LED stays, because the verifier still needs to know which
# outcome to assert -- present and enabled, or absent entirely.

BOARD_OVERLAY_SRC="$REPO_ROOT/os/boards/$MOS_BOARD/overlay"
if [ -d "$BOARD_OVERLAY_SRC" ]; then
    cp -a "$BOARD_OVERLAY_SRC/." "$OVERLAY_STAGE/"
    echo "overlay: layered $(find "$BOARD_OVERLAY_SRC" -type f | wc -l) board-specific file(s) from boards/$MOS_BOARD/overlay"
fi
if [ ! -s "$OVERLAY_STAGE/etc/rauc/system.conf" ]; then
    echo "error: os/update/rauc/render-config.sh produced no system.conf to stage" >&2
    exit 1
fi

# A RAUC keyring inside the overlay ships in the signed read-only root, where
# it makes every device flashed with this image trust whatever that CA signs —
# and os/update/rauc/gen-dev-keys.sh documents dropping the DEV CA exactly here for
# local bundle testing. That workflow stays possible, but only when named:
# MOS_EXPECT_DEV_KEYRING=1 is the same explicit-toggle shape as the verifier's
# fixture hook (MOS_VERIFY_FIXTURE_ROOT) -- nothing in the build or CI sets it,
# so a keyring cannot reach a release image by being forgotten in the overlay.
# os/verify enforces the same contract on the packed root.
if [ -e "$OVERLAY_STAGE/etc/rauc/keyring.pem" ]; then
    if [ "${MOS_EXPECT_DEV_KEYRING:-0}" = "1" ]; then
        echo "############################################################"
        echo "# WARNING: baking a DEVELOPMENT RAUC keyring into this     #"
        echo "# image (etc/rauc/keyring.pem, MOS_EXPECT_DEV_KEYRING=1).  #"
        echo "# Every device flashed with it trusts every bundle that    #"
        echo "# CA signs. Never flash this image onto anything that      #"
        echo "# leaves your desk.                                        #"
        echo "############################################################"
    else
        echo "error: $OVERLAY_SRC/etc/rauc/keyring.pem exists; refusing to stage it into the image." >&2
        echo "A keyring baked into the signed root makes every flashed device trust that CA's bundles. For a local dev image that installs locally signed bundles, set MOS_EXPECT_DEV_KEYRING=1 (and expect the loud warning); otherwise delete the file." >&2
        exit 1
    fi
fi

lower() { echo "$1" | tr 'A-Z' 'a-z'; }
render() {
    local src="$1" dst="$2"
    shift 2
    local expr=()
    while [ "$#" -gt 0 ]; do
        expr+=(-e "s|@$1@|$2|g")
        shift 2
    done
    sed "${expr[@]}" "$src" > "$dst"
    rm -f "$src"
    if grep -q '@[A-Z_]\+@' "$dst"; then
        echo "error: unrendered placeholder left in $dst" >&2
        exit 1
    fi
}

# Storage tiers. /srv (DATA, partition 10) is the only filesystem that grows;
# /var (EPHEMERAL) is fixed-size disposable residue and must NOT carry
# x-systemd.growfs.

# The DATA constants are required, not optional. A fallback for a missing one
# would not fail: it would quietly emit a nine-partition rootfs with /var
# growing and no /srv, and every downstream check would pass. All four are
# demanded even though only DATA_GUID is read here, because the assembler needs
# the other three, and a rootfs built against half a layout is the kind of
# artifact that reaches hardware before anyone notices.
missing=""
for key in DATA_GUID DATA_PARTNUM DATA_FS_UUID MOS_VAR_MIB; do
    eval "value=\${$key:-}"
    [ -n "$value" ] || missing="$missing $key"
done
if [ -n "$missing" ]; then
    echo "error: $LAYOUT_ENV is missing:$missing" >&2
    echo "The DATA partition (/srv) and the fixed /var size are part of layout v2;" >&2
    echo "a rootfs built without them would silently ship the superseded" >&2
    echo "nine-partition arrangement. Restore the constants in $LAYOUT_ENV." >&2
    exit 1
fi

SRV_LINE="PARTUUID=$(lower "$DATA_GUID")	/srv	ext4	noatime,x-systemd.growfs	0	2"
VAR_OPTS="noatime"

# The repart definition count must equal the number of linux-generic partitions
# on the disk, or repart silently attaches the grow flag to the wrong one — and
# an unmatched definition does not fail, it makes repart CREATE a partition.
# The count is DERIVED from the layout, not written down. systemd-repart pairs
# definitions with existing partitions in order by Type, so the invariant is
# "one definition per linux-generic partition this board actually has" -- and
# a literal 8 was the cx3576 number, which the x64 build satisfied with two
# definitions for U-Boot partitions it does not have. Every partition then got
# the definition meant for the one before it, DATA did not grow, and repart
# reported success.
want_defs=$(grep -c "^[A-Z0-9_]*_TYPECODE=$TYPECODE_LINUX\$" "$LAYOUT_ENV")
have_defs=$(find "$OVERLAY_STAGE/etc/repart.d" -name '*.conf' | wc -l)
if [ "$have_defs" -ne "$want_defs" ]; then
    echo "error: $have_defs repart definitions staged, but $LAYOUT_ENV declares $want_defs partitions of type $TYPECODE_LINUX. systemd-repart matches definitions to partitions IN ORDER, so a mismatch does not fail — it shifts every definition onto the wrong partition and creates new ones for the remainder" >&2
    exit 1
fi
# `|| true` because zero matches must reach the diagnostic below: grep -l
# exits 1 when nothing matches, and under set -e/pipefail that killed the run
# before the "expected exactly 1" message could say what was missing.
grow_defs=$({ grep -l '^Weight=1000$' "$OVERLAY_STAGE"/etc/repart.d/*.conf || true; } | wc -l)
if [ "$grow_defs" -ne 1 ]; then
    echo "error: $grow_defs repart definitions carry Weight=1000, expected exactly 1" >&2
    exit 1
fi
echo "layout: DATA present -> /srv grows, /var fixed"
echo "layout: $have_defs repart definitions, 1 of them growing"

if [ -f "$OVERLAY_STAGE/etc/systemd/system/boot.mount.in" ]; then
    render "$OVERLAY_STAGE/etc/systemd/system/boot.mount.in" \
           "$OVERLAY_STAGE/etc/systemd/system/boot.mount" \
        ESP_GUID "$(lower "$ESP_GUID")"
fi

render "$OVERLAY_STAGE/etc/fstab.in" "$OVERLAY_STAGE/etc/fstab" \
    EPHEMERAL_GUID "$(lower "$EPHEMERAL_GUID")" \
    STATE_GUID "$(lower "$STATE_GUID")" \
    META_GUID "$(lower "$META_GUID")" \
    VAR_OPTS "$VAR_OPTS" \
    SRV_LINE "$SRV_LINE"

# fw_env.config is U-Boot's environment configuration and it is NOT rendered on
# x64: there is no U-Boot there, and the file names two partitions the QEMU
# layout does not create. Shipping it anyway would put a configuration file in
# the image describing storage that does not exist -- readable, plausible, and
# wrong, which is the shape of defect this repo keeps finding.
if [ "$MOS_ARCH" = "amd64" ]; then
    rm -f "$OVERLAY_STAGE/etc/fw_env.config.in"
else
    render "$OVERLAY_STAGE/etc/fw_env.config.in" "$OVERLAY_STAGE/etc/fw_env.config" \
        UENV_A_GUID "$(lower "$UENV_A_GUID")" \
        UENV_B_GUID "$(lower "$UENV_B_GUID")" \
        UENV_SIZE_HEX "$(printf '0x%x' "$UENV_SIZE_BYTES")"
fi

# The builder is named, and it has to be a `docker` driver one. This is a
# chain: os/rootfs/stages/ holds one Dockerfile per stage, and every stage
# after the first opens `FROM ${MOS_STAGE_PREV}`, a local image tag the
# previous stage was written to. Resolving that needs a builder whose driver
# can read the docker image store, and only the `docker` driver can. Measured
# on this host: a docker-container builder handed a tag that is in the store
# answered "pull access denied, repository does not exist", about a registry,
# for an image that is right there.

# So the builder is chosen explicitly rather than inherited. `default` is the
# docker driver on every docker installation; BUILDX_BUILDER still wins,
# because a caller who names a builder has made a decision, and the driver
# checks whatever it is handed and refuses by name. Empty means "whatever
# docker considers current", which is what BUILDX_BUILDER sets.

# The cost, stated rather than absorbed: what stood here created a
# docker-container builder when the current one could not reach the target
# platform -- its buildkit image bundles QEMU, so an amd64 host could build
# cx3576's arm64 with no host binfmt at all, and
# .gitea/workflows/privileged.yml relies on exactly that. That route cannot
# carry a chain, so a cross build now needs host binfmt_misc, and this says so
# with the command rather than failing later inside buildkit.
BUILDER_ARGS=()
if [ -n "${BUILDX_BUILDER:-}" ]; then
    echo "note: using the builder BUILDX_BUILDER names (${BUILDX_BUILDER}); os/verify checks that it can chain"
else
    BUILDER_ARGS=(--builder default)
    # `grep -c ... >/dev/null`, not `grep -q`: this file sets pipefail, and a
    # -q grep exits as soon as it matches, so the producer dies of SIGPIPE and
    # the pipeline reports failure exactly when the platform IS present. The
    # line this replaced used the -c form for the same reason;
    # os/tests/shell-pipefail-lint.sh caught the regression.
    if ! docker buildx inspect default 2>/dev/null | grep -c "${DOCKER_PLATFORM}" >/dev/null; then
        echo "error: the 'default' buildx builder cannot reach ${DOCKER_PLATFORM}." >&2
        echo "       Its platforms are: $(docker buildx inspect default 2>/dev/null | sed -n 's/^Platforms:[[:space:]]*//p')" >&2
        echo "       Install ${MOS_ARCH} emulation on the host:" >&2
        echo "         docker run --privileged --rm tonistiigi/binfmt --install ${MOS_ARCH}" >&2
        echo "       A docker-container builder would bundle QEMU and would ALSO not work here: the" >&2
        echo "       stage chain resolves FROM against the local image store, which that driver" >&2
        echo "       cannot read. os/rootfs/stages/README.md records the measurement." >&2
        exit 1
    fi
fi

log=$(mktemp)
trap 'rm -f "$log"' EXIT
# The two base images of the chain, resolved out of os/build-env/images.env
# before a forty-minute build starts rather than at the FROM line that consumes
# them. NO --arch: both are IMAGE_ keys, which images.env pins as MULTI-
# ARCHITECTURE index digests precisely so that a cross build picks the right
# manifest -- the check os/podman/build.sh needs is about localhost tags, which
# carry exactly one architecture, and this file uses none.
mapfile -t FROM_ARGS < <("$REPO_ROOT/os/build-env/from.sh" \
    MOS_IMAGE_DEBIAN_TRIXIE=IMAGE_DEBIAN_TRIXIE \
    MOS_IMAGE_DEBIAN_BOOKWORM=IMAGE_DEBIAN_BOOKWORM)
# mapfile cannot fail, so its status says nothing about the process inside the
# substitution; an empty array is what a refusal looks like from here, and it
# would reach docker as a build with no --build-arg at all.
if [ "${#FROM_ARGS[@]}" -ne 4 ]; then
    echo "error: os/build-env/from.sh did not yield the two base images (see its message above); this build would have run with an unpinned or missing FROM" >&2
    exit 1
fi

# from.sh yields `--build-arg KEY=VALUE` pairs; the driver takes `--arg KEY=VALUE`.
# Rewritten here rather than teaching from.sh a second output shape: it has one
# caller that wants docker's spelling and one that does not, and a resolver that
# formats for whoever asks is a resolver two callers have to agree with.
DRIVER_FROM_ARGS=()
for a in "${FROM_ARGS[@]}"; do
    case "$a" in --build-arg) DRIVER_FROM_ARGS+=(--arg) ;; *) DRIVER_FROM_ARGS+=("$a") ;; esac
done

# Stage selection, which is what replaced the WITH_* build arguments.
# WITH_CONTAINERS and WITH_MOSD are the caller's spelling -- the environment
# variable, and board/<name>/containers.env. A 0 names a stage the driver does
# NOT build, rather than travelling into the build as a `--build-arg` that five
# separate RUNs and scripts each have to test. One decision instead of five
# copies of one.

# The staged directory's argument goes with the stage, and the driver enforces
# that rather than trusting this list: an --arg no stage declares is refused
# (os/build/src/stages.ts, unusedArgs), because docker only warns about an
# unused --build-arg and a warning scrolls past in a build this size. So
# PODMAN_DIR is passed exactly when 31-feature-containers is in the chain and
# MOSD_DIR exactly when 33-feature-mosd is, and getting that wrong is a refusal
# with the argument's name in it rather than a value that quietly does nothing.
SELECT_ARGS=()
FEATURE_ARGS=()
for f in $WITHOUT_FEATURES; do SELECT_ARGS+=(--without "$f"); done
declined containers || FEATURE_ARGS+=(--arg PODMAN_DIR="_out/$MOS_BOARD/podman")
declined mosd || FEATURE_ARGS+=(--arg MOSD_DIR="_out/$MOS_BOARD/mosd")
declined rauc || FEATURE_ARGS+=(--arg RAUC_DIR="_out/$MOS_BOARD/rauc")

# THE CHAIN, not one Dockerfile. os/build/run.sh --build-rootfs sequences
# os/rootfs/stages/*.Dockerfile in numeric order, tagging each and handing it to
# the next; everything above this line -- the staged context, the layout checks,
# the verity parameters -- is unchanged and is still this script's job. The
# driver decides only the order, the tags and which argument reaches which file,
# and it refuses an argument no stage declares rather than letting docker warn
# about it. See os/rootfs/stages/README.md.
if ! bash "$REPO_ROOT/os/build/run.sh" --build-rootfs \
        --board "$MOS_BOARD" \
        --platform "$DOCKER_PLATFORM" \
        --context "$REPO_ROOT" \
        --dest "$OUT_DIR" \
        ${BUILDER_ARGS[@]+"${BUILDER_ARGS[@]}"} \
        "${DRIVER_FROM_ARGS[@]}" \
        --arg MOS_ARCH="$MOS_ARCH" \
        --arg RAUC_BOOTLOADER="$RAUC_BOOTLOADER" \
        --arg BOARD_RADIOS="$BOARD_RADIOS" \
        --arg MOS_BOARD="$MOS_BOARD" \
        --arg MODULES_TAR="_out/$MOS_BOARD/modules.tar" \
        --arg BOARD_FIRMWARE_DIR="_out/$MOS_BOARD/firmware" \
        --arg BOARD_FIRMWARE_FILES="$BOARD_FIRMWARE_FILES" \
        --arg BOARD_HWINIT_DIR="_out/$MOS_BOARD/hwinit" \
        --arg BOARD_INIT_DIR="_out/$MOS_BOARD/init" \
        --arg OVERLAY_DIR="_out/$MOS_BOARD/overlay-v2" \
        ${SELECT_ARGS[@]+"${SELECT_ARGS[@]}"} \
        ${FEATURE_ARGS[@]+"${FEATURE_ARGS[@]}"} \
        --arg MOS_PROFILE="$MOS_PROFILE" \
        --arg VERITY_SALT="$VERITY_SALT" \
        --arg VERITY_UUID="$VERITY_UUID" \
        --arg SQUASHFS_TIME="$SQUASHFS_TIME" \
        --source-date-epoch "$SQUASHFS_TIME" 2>&1 | tee "$log"; then
    if grep -qi 'exec format error' "$log"; then
        echo >&2
        echo "hint: ${MOS_ARCH} emulation is missing on this host. Install it with:" >&2
        echo "  docker run --privileged --rm tonistiigi/binfmt --install ${MOS_ARCH}" >&2
    fi
    exit 1
fi

VERITY_ENV="$OUT_DIR/rootfs-verity.env"
IMG="$OUT_DIR/rootfs-verity.img"
REPORT="$OUT_DIR/rootfs-report-v2.txt"
FACTORY_ROOT_OCI="$OUT_DIR/factory-root.oci"

# The OCI export, asserted here as well as in the driver, because the two
# statements are different. The driver checks the file it just wrote is not
# empty; this checks that a build which reported success left one at all -- the
# case that matters is a chain built by something OTHER than the current driver
# (an older tree, a hand-typed docker command) dropping its output into the same
# _out directory, where a stale or absent archive would be handed to the smoke
# runner as this build's root. index.json is the OCI-layout entry point, so its
# presence is what distinguishes an OCI archive from any other tar.
if [ ! -s "$FACTORY_ROOT_OCI" ]; then
    echo "error: $FACTORY_ROOT_OCI is missing or empty after a build that reported success." >&2
    echo "       RFCT-113's smoke run executes the self-built binaries inside this image; with no" >&2
    echo "       image there is nothing to execute them in, and an image that ships them unexecuted" >&2
    echo "       looks exactly like one whose smoke run passed." >&2
    exit 1
fi
if ! tar -tf "$FACTORY_ROOT_OCI" index.json >/dev/null 2>&1; then
    echo "error: $FACTORY_ROOT_OCI has no index.json, so it is not an OCI image layout." >&2
    echo "       Whatever wrote it did not write what \`docker load\` reads." >&2
    exit 1
fi

# Read the pack stage's output the same way the assembler does: by parsing
# KEY=value, never by sourcing a generated file.
env_get() { sed -n "s/^$2=//p" "$1" | tail -n1; }

for key in VERITY_ROOT_HASH VERITY_SALT VERITY_DATA_BLOCKS VERITY_HASH_START_BLOCK \
    VERITY_DATA_BLOCK_SIZE VERITY_HASH_BLOCK_SIZE VERITY_HASH_ALGO \
    VERITY_DATA_SECTORS SQUASHFS_BYTES IMAGE_BYTES; do
    if [ -z "$(env_get "$VERITY_ENV" "$key")" ]; then
        echo "error: $key missing from $VERITY_ENV" >&2
        exit 1
    fi
done

ROOT_HASH=$(env_get "$VERITY_ENV" VERITY_ROOT_HASH)
DATA_SECTORS=$(env_get "$VERITY_ENV" VERITY_DATA_SECTORS)
DATA_BLOCKS=$(env_get "$VERITY_ENV" VERITY_DATA_BLOCKS)
HASH_START_BLOCK=$(env_get "$VERITY_ENV" VERITY_HASH_START_BLOCK)
DATA_BLOCK_SIZE=$(env_get "$VERITY_ENV" VERITY_DATA_BLOCK_SIZE)
HASH_BLOCK_SIZE=$(env_get "$VERITY_ENV" VERITY_HASH_BLOCK_SIZE)
HASH_ALGO=$(env_get "$VERITY_ENV" VERITY_HASH_ALGO)
IMAGE_BYTES=$(env_get "$VERITY_ENV" IMAGE_BYTES)

if [ "$(env_get "$VERITY_ENV" VERITY_SALT)" != "$VERITY_SALT" ]; then
    echo "error: pack stage salt does not match the pinned VERITY_SALT" >&2
    exit 1
fi
img_bytes=$(stat -c %s "$IMG")
if [ "$img_bytes" != "$IMAGE_BYTES" ] || [ $((img_bytes % MIB_BYTES)) -ne 0 ] || [ "$img_bytes" -eq 0 ]; then
    echo "error: $IMG is $img_bytes bytes, not a non-zero whole-MiB multiple matching IMAGE_BYTES=$IMAGE_BYTES" >&2
    exit 1
fi

# Kernel cmdline, one per slot. dm-init (CONFIG_DM_INIT=y, kernel 6.1.115)
# builds the verity device before the root mount with no initramfs. Both the
# data and the hash device are the same partition -- the hash tree is appended
# to the squashfs -- so the same PARTUUID appears twice, and <hash_start_block>
# tells the target where the tree begins. dm-init resolves PARTUUID= through
# dm_get_dev_t -> name_to_dev_t -> devt_from_partuuid (case-insensitive),
# verified against the vendor tree; see docs/design/ro-root.md.

# dm-mod.waitfor= is MANDATORY, not an optimisation. dm_init_init runs at
# late_initcall and its wait_for_device_probe() does not cover eMMC card
# discovery, which happens on a delayed workqueue; without the wait the verity
# table is built before the partitions exist, so the boot breaks intermittently
# rather than cleanly. The assembler rejects a cmdline file that lacks it.

# The GUID is lowercased, the same form used in /etc/fstab and the same form
# udev gives /dev/disk/by-partuuid/ (libblkid formats GUIDs lowercase). The
# kernel compares with strncasecmp and accepts either, so one canonical
# lowercase spelling everywhere is the least surprising choice. The assembler
# cross-checks this table against ${ROOTFS_x_GUID}, which the layout env holds
# uppercase, comparing case-insensitively. Do not "fix" anything by
# uppercasing this: lowercase is what udev and fstab use.
write_cmdline() {
    local out="$1" guid="$2"
    local partuuid
    partuuid="PARTUUID=$(lower "$guid")"
    printf '%s\n' "dm-mod.create=\"rootfs,,,ro,0 ${DATA_SECTORS} verity 1 ${partuuid} ${partuuid} ${DATA_BLOCK_SIZE} ${HASH_BLOCK_SIZE} ${DATA_BLOCKS} ${HASH_START_BLOCK} ${HASH_ALGO} ${ROOT_HASH} ${VERITY_SALT}\" dm-mod.waitfor=${partuuid} root=/dev/dm-0 rootfstype=squashfs ro rootwait ${BOARD_CMDLINE_ARGS}" > "$out"
}
write_cmdline "$OUT_DIR/boot-cmdline-a.txt" "$ROOTFS_A_GUID"
write_cmdline "$OUT_DIR/boot-cmdline-b.txt" "$ROOTFS_B_GUID"

echo
echo "=== rootfs-report-v2.txt ==="
cat "$REPORT"
echo "=== rootfs-verity.env ==="
cat "$VERITY_ENV"
echo "=== boot-cmdline-a.txt ==="
cat "$OUT_DIR/boot-cmdline-a.txt"
echo "=== image: $IMG ($img_bytes bytes, $((img_bytes / MIB_BYTES)) MiB) ==="

total_mb=$(awk '/^TOTAL_MB/ {print $2}' "$REPORT")
if [ -z "$total_mb" ]; then
    echo "error: TOTAL_MB missing from $REPORT" >&2
    exit 1
fi
if [ "$total_mb" -gt "$SIZE_BUDGET_MB" ]; then
    echo "error: installed size ${total_mb} MB exceeds budget ${SIZE_BUDGET_MB} MB" >&2
    exit 1
fi
echo "installed size: ${total_mb} MB (budget ${SIZE_BUDGET_MB} MB)"

# The smoke run, and it is part of the build. A wrong-arch, missing-soname or
# version-skewed binary must fail the build, so every self-built binary is
# executed inside the base rootfs before an image ships it. That is this line:
# an image that ships them unexecuted looks exactly like one whose smoke run
# passed.

# It is here rather than in the Makefile because two make targets run this
# script, so does the CI deep lane, and anyone can run it directly; a step
# wired into the callers would be three copies to keep in step and would be
# bypassed by the fourth. The root is not handed to an assembler, to a bundle,
# or to a person, without its binaries having been executed.

# No skip and no opt-out: a flag that turned this off would make "the build
# passed" mean two things. `set -e` is what makes it a gate -- run.sh exits
# with the runner's own status, and a non-zero status here ends the build
# before $OUT_DIR is handed on. It adds no dependency this script did not
# already have: run.sh --smoke needs docker, which this script has needed since
# the first buildx line, and it needs to execute the target platform, which for
# cx3576 means the same host binfmt the refusal at the top of this script
# already requires in order to build at all.
echo
echo "=== smoke: executing the self-built binaries inside the root just packed ==="
MOS_BOARD="$MOS_BOARD" bash "$REPO_ROOT/os/verify/run.sh" --smoke --board "$MOS_BOARD"
