#!/usr/bin/env bash
# Build the squashfs + dm-verity arm64 rootfs slot image for cx3576 (layout v2).
# Usage: [BOARD_DIR=...] [WITH_MOSD=0|1] [WITH_CONTAINERS=0|1] [MOS_PROFILE=dev|prod] bash os/rootfs/build-v2.sh
#
# There is deliberately NO ROOT_PASSWORD here (v1's build.sh keeps it). A v2
# rootfs is a signed, byte-identical squashfs, and the pack stage FAILS any
# build whose factory shadow carries a usable hash — so a baked v2 root
# password is unbuildable by design, not merely discouraged. Dev root access on
# v2 is the transient password set at runtime through mosd
# (SetTransientRootPassword; cleared on the next boot by mos-shadow-reconcile)
# plus the serial console, whose root account stays locked until that password
# is set. See docs/design/access.md section 4.1.
#
# Outputs (all under _out/cx3576/, consumed by os/mkimage-v2.sh):
#   rootfs-verity.img     squashfs-zstd with the verity hash tree appended,
#                         padded to a whole MiB
#   rootfs-verity.env     verity parameters, strict KEY=value
#   boot-cmdline-a.txt    kernel append line for the A slot
#   boot-cmdline-b.txt    kernel append line for the B slot
#   rootfs-report-v2.txt  package list + installed size
#
# v1 (os/rootfs/build.sh) is untouched and keeps producing the writable ext4
# root. Every layout constant is read from os/layout/cx3576-v2.env.
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
LAYOUT_ENV="$REPO_ROOT/os/layout/${MOS_BOARD}-v2.env"
BOARD_DIR=${BOARD_DIR:-"$REPO_ROOT/board/${MOS_BOARD}"}
OUT_DIR="$REPO_ROOT/_out/${MOS_BOARD}"
# Installed-size budget. A per-board fact for the same reason
# BOARD_CMDLINE_ARGS is: it protects a rootfs slot, and the slots differ.
SIZE_BUDGET_MB="${SIZE_BUDGET_MB_OVERRIDE:-}"
WITH_MOSD=${WITH_MOSD:-1}

# PLAN-012: whether the container engine is in the image at all.
#
# BOARD-LEVEL, because it is a board decision: the engine costs ~107 MB
# installed and a board with a tighter rootfs slot, or no use for containers,
# should not carry it. The board opts OUT by shipping a containers.env saying
# so; absent means ON, which is the cx3576 default the user asked for.
#
# An explicit WITH_CONTAINERS in the environment beats the board file, so a
# one-off build can go either way without editing the board.
#
# This is the BUILD-time switch: is the engine present. The RUN-time switch —
# `container.enabled` in the settings tree, driven from apid — is PLAN-012 M3
# and is a different question: whether an engine that IS present may be used.
if [ -z "${WITH_CONTAINERS:-}" ] && [ -f "$BOARD_DIR/containers.env" ]; then
    # shellcheck disable=SC1091
    . "$BOARD_DIR/containers.env"
fi
WITH_CONTAINERS=${WITH_CONTAINERS:-1}
case "$WITH_CONTAINERS" in
0 | 1) ;;
*)
    echo "error: WITH_CONTAINERS is '$WITH_CONTAINERS'; it must be exactly 0 or 1. Any other value would be read as 0 by the Dockerfile's comparison and the engine would silently not ship" >&2
    exit 1
    ;;
esac
# Image profile baked into /usr/lib/mos/profile.conf. mosd reads it on first
# boot and FAILS CLOSED to prod, so the value has to be exactly "dev" or "prod"
# in lowercase; the Dockerfile rejects anything else. It no longer selects the
# access.ssh.enabled seed: both profiles seed SSH OFF and neither image ships
# ssh.service enabled, so the profile currently changes nothing that is seeded.
MOS_PROFILE=${MOS_PROFILE:-dev}

if [ ! -f "$LAYOUT_ENV" ]; then
    echo "error: $LAYOUT_ENV not found" >&2
    exit 1
fi
# shellcheck source=../layout/cx3576-v2.env
. "$LAYOUT_ENV"

# Board console facts. These describe a board's serial console, not its
# partition layout -- and the comment here used to say "if a second board ever
# needs a v2 image they move into a per-board file". x64 is that second board,
# so they moved: each os/layout/<board>-v2.env now carries its own
# BOARD_CMDLINE_ARGS, and this refuses a layout that forgot to.
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
        echo "Build it with 'make -C board/$MOS_BOARD kernel' or point BOARD_DIR at" >&2
        echo "prebuilt BSP artifacts, e.g. BOARD_DIR=/srv/ai/mos/board/cx3576" >&2
        exit 1
    fi
    cp "$MODULES_TAR" "$OUT_DIR/modules.tar"
fi

# The container engine, built from source by os/podman (PLAN-012 M1/M2).
# Staged like modules.tar and mosd; the directory always exists (empty when
# WITH_CONTAINERS=0) so the Dockerfile COPY works on both paths.
#
# NOT built on demand here. `make podman` compiles four Go/Rust/C trees and
# takes tens of minutes; running it implicitly from a rootfs build would make
# an image build occasionally take an hour with no indication why. It is a
# separate target, and the absence of its output is an error with the command
# to run in it.
PODMAN_STAGE="$OUT_DIR/podman"
rm -rf "$PODMAN_STAGE"
mkdir -p "$PODMAN_STAGE"
if [ "$WITH_CONTAINERS" = "1" ]; then
    PODMAN_OUT="$REPO_ROOT/os/podman/out-$MOS_ARCH"
    for b in podman quadlet crun conmon netavark aardvark-dns catatonit; do
        if [ ! -f "$PODMAN_OUT/$b" ]; then
            echo "error: $PODMAN_OUT/$b not found." >&2
            echo "WITH_CONTAINERS=1 asks for a container engine and none has been built." >&2
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
# directory always exists (empty when WITH_MOSD=0) so the Dockerfile COPY works
# on both paths.
MOSD_STAGE="$OUT_DIR/mosd"
rm -rf "$MOSD_STAGE"
mkdir -p "$MOSD_STAGE"
if [ "$WITH_MOSD" = "1" ]; then
    bash "$REPO_ROOT/mosd/hack/build-target.sh" "$RUST_TARGET" "$ELF_ARCH"
    cp "$REPO_ROOT/mosd/target/$RUST_TARGET/release/mosd" "$MOSD_STAGE/mosd"
    cp "$REPO_ROOT/mosd/dist/mosd.service" "$MOSD_STAGE/mosd.service"
    cp "$REPO_ROOT/mosd/dist/com.mos.mosd.conf" "$MOSD_STAGE/com.mos.mosd.conf"
    cp "$REPO_ROOT/mosd/dist/com.mos.ext.conf" "$MOSD_STAGE/com.mos.ext.conf"
    cp "$REPO_ROOT/mosd/target/$RUST_TARGET/release/apid" "$MOSD_STAGE/apid"
    cp "$REPO_ROOT/mosd/dist/apid.service" "$MOSD_STAGE/apid.service"
    # The MQTT bridge (PLAN-011 M3/D6). Its unit lives in the crate rather than
    # mosd/dist because the crate is where it is maintained; its D-Bus grant
    # lives in mosd/dist beside the policy it is layered over.
    cp "$REPO_ROOT/mosd/target/$RUST_TARGET/release/mos-mqttd" \
        "$MOSD_STAGE/mos-mqttd"
    cp "$REPO_ROOT/mosd/mqttd/dist/mos-mqttd.service" "$MOSD_STAGE/mos-mqttd.service"
    cp "$REPO_ROOT/mosd/dist/mos-mqttd.conf" "$MOSD_STAGE/mos-mqttd.conf"
    # The broker the bridge above connects to (RFCT-104). No D-Bus grant to
    # stage beside it: it is not a bus client, it only listens on TCP. Its
    # config is not staged either -- mosd renders /run/mos/mqtt-broker.toml at
    # runtime, because a file baked into an immutable root would be the same
    # listen address on every device flashed with this image.
    cp "$REPO_ROOT/mosd/target/$RUST_TARGET/release/mos-mqtt-broker" \
        "$MOSD_STAGE/mos-mqtt-broker"
    cp "$REPO_ROOT/mosd/broker/dist/mos-mqtt-broker.service" \
        "$MOSD_STAGE/mos-mqtt-broker.service"
else
    echo "note: WITH_MOSD=0; building rootfs without mosd"
fi

# Board hardware-init facts (confs consumed by the os/hwinit units), staged
# like mosd so the Dockerfile COPY always has a directory (may be empty).
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
elif [ -d "$REPO_ROOT/board/$MOS_BOARD/init" ]; then
    cp -a "$REPO_ROOT/board/$MOS_BOARD/init/." "$INIT_STAGE/"
fi

# Read-only root wiring. The overlay tree is copied into the build context with
# its *.in templates rendered from the layout env, so the shipped image carries
# no placeholder and the Dockerfile carries no layout constant.
# PARTUUID values are lowercased: udev derives /dev/disk/by-partuuid/ symlinks
# from libblkid, which formats GUIDs in lowercase, and systemd's fstab-generator
# resolves PARTUUID= through those symlinks without normalising case.
OVERLAY_SRC="$SCRIPT_DIR/overlay-v2"
OVERLAY_STAGE="$OUT_DIR/overlay-v2"

# The RAUC system.conf is rendered from os/rauc/system.conf.in and the layout
# env by RFCT-014's renderer, which owns that template and its assertions (the
# statusfile must not land on /var, the boot-attempts radix range, and the
# fw_env.config structure). It is generated rather than committed: a rendered
# artifact in git can drift from its template, and os/bundle.sh's --check can
# only report that drift after the fact, not prevent it. Rendering it here, on
# the build path that consumes it, makes the template the single source of
# truth. The renderer writes into OVERLAY_SRC, so it must run before staging.
MOS_BOARD="$MOS_BOARD" bash "$REPO_ROOT/os/rauc/render-config.sh"

rm -rf "$OVERLAY_STAGE"
mkdir -p "$OVERLAY_STAGE"
cp -a "$OVERLAY_SRC/." "$OVERLAY_STAGE/"

# Per-board overlay, layered ON TOP of the shared one. Only files that are
# WRONG on another board belong here -- x64's ESP mount unit is one, because
# RAUC's grub backend edits a file and the U-Boot backend edits a raw
# partition, so /boot is a mountpoint on exactly one of the two boards.
#
# Layered rather than selected: everything both boards share stays in one
# place, so a change to it cannot reach one board and miss the other.
# The status indicator is a BOARD FILE, not a shared one with an exception.
#
# It used to live in overlay-v2 and be deleted here for boards that declare no
# LED. Adding a file and then removing it is a worse statement than never
# adding it: the shared overlay claimed every board has an indicator, and the
# truth lived in a conditional somewhere else. os/rootfs/overlay-cx3576/ now
# carries mos-status-led, its unit and its wants symlink, so the file's
# LOCATION is the fact. A board with an indicator ships one by having one.
#
# BOARD_HAS_STATUS_LED stays, because the verifier still needs to know which
# outcome to assert -- present and enabled, or absent entirely.

BOARD_OVERLAY_SRC="$REPO_ROOT/os/rootfs/overlay-$MOS_BOARD"
if [ -d "$BOARD_OVERLAY_SRC" ]; then
    cp -a "$BOARD_OVERLAY_SRC/." "$OVERLAY_STAGE/"
    echo "overlay: layered $(find "$BOARD_OVERLAY_SRC" -type f | wc -l) board-specific file(s) from overlay-$MOS_BOARD"
fi
if [ ! -s "$OVERLAY_STAGE/etc/rauc/system.conf" ]; then
    echo "error: os/rauc/render-config.sh produced no system.conf to stage" >&2
    exit 1
fi

# A RAUC keyring inside the overlay ships in the signed read-only root, where
# it makes every device flashed with this image trust whatever that CA signs —
# and os/rauc/gen-dev-keys.sh documents dropping the DEV CA exactly here for
# local bundle testing. That workflow stays possible, but only when named:
# MOS_EXPECT_DEV_KEYRING=1 is the same explicit-toggle shape as the verifier's
# fixture hook (MOS_VERIFY_FIXTURE_ROOT, RFCT-077) — nothing in the build or CI
# sets it, so a keyring cannot reach a release image by being forgotten in the
# overlay. os/verify-image-v2.sh enforces the same contract on the packed root.
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
#
# The DATA constants are REQUIRED, not optional. While partition 10 was still
# being added to the layout env this build carried a nine-partition fallback so
# the two halves could land in either order. That path is now unreachable, and
# leaving it in would be worse than useless: if a constant went missing from the
# layout env through a bad merge or an editing slip, the build would not fail —
# it would quietly emit a nine-partition rootfs with /var growing and no /srv,
# and every downstream check would pass. Fail loudly instead.
#
# All four are demanded even though only DATA_GUID is read here, because a
# partially-edited layout env is exactly the failure this guards against: the
# assembler needs the other three, and a rootfs built against half a layout is
# the kind of artifact that reaches hardware before anyone notices.
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

# If the current builder cannot run linux/arm64 (e.g. host binfmt registration
# is unavailable), fall back to a docker-container builder: its buildkit image
# bundles QEMU emulators and needs no host binfmt.
BUILDER_ARGS=()
if [ -z "${BUILDX_BUILDER:-}" ] && ! docker buildx inspect 2>/dev/null | grep -c "${DOCKER_PLATFORM}" >/dev/null; then
    echo "note: current builder lacks ${DOCKER_PLATFORM}; using docker-container builder 'mos-${MOS_ARCH}'"
    docker buildx inspect "mos-${MOS_ARCH}" >/dev/null 2>&1 || \
        docker buildx create --name "mos-${MOS_ARCH}" --driver docker-container >/dev/null
    BUILDER_ARGS=(--builder "mos-${MOS_ARCH}")
fi

log=$(mktemp)
trap 'rm -f "$log"' EXIT
if ! docker buildx build \
        "${BUILDER_ARGS[@]}" \
        --platform "$DOCKER_PLATFORM" \
        -f "$SCRIPT_DIR/Dockerfile.v2" \
        --build-arg MOS_ARCH="$MOS_ARCH" \
        --build-arg RAUC_BOOTLOADER="$RAUC_BOOTLOADER" \
        --build-arg BOARD_RADIOS="$BOARD_RADIOS" \
        --build-arg MODULES_TAR="_out/$MOS_BOARD/modules.tar" \
        --build-arg MOSD_DIR="_out/$MOS_BOARD/mosd" \
        --build-arg PODMAN_DIR="_out/$MOS_BOARD/podman" \
        --build-arg BOARD_INIT_DIR="_out/$MOS_BOARD/init" \
        --build-arg OVERLAY_DIR="_out/$MOS_BOARD/overlay-v2" \
        --build-arg WITH_MOSD="$WITH_MOSD" \
        --build-arg WITH_CONTAINERS="$WITH_CONTAINERS" \
        --build-arg MOS_PROFILE="$MOS_PROFILE" \
        --build-arg VERITY_SALT="$VERITY_SALT" \
        --build-arg VERITY_UUID="$VERITY_UUID" \
        --build-arg SQUASHFS_TIME="$SQUASHFS_TIME" \
        --target artifact \
        --output "type=local,dest=$OUT_DIR" \
        "$REPO_ROOT" 2>&1 | tee "$log"; then
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

# Read the pack stage's output the same way os/mkimage-v2.sh does: by parsing
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

# Kernel cmdline, one per slot.
#
# dm-init (CONFIG_DM_INIT=y, kernel 6.1.115) builds the verity device before
# the root mount with no initramfs. Both the data and the hash device are the
# same partition — the hash tree is appended to the squashfs — so the same
# PARTUUID appears twice, and <hash_start_block> tells the target where the
# tree begins. dm-init resolves PARTUUID= through dm_get_dev_t ->
# name_to_dev_t -> devt_from_partuuid (case-insensitive), verified against the
# vendor tree; see docs/design/ro-root.md.
#
# dm-mod.waitfor= is MANDATORY, not an optimisation. dm_init_init runs at
# late_initcall and its wait_for_device_probe() does not cover eMMC card
# discovery, which happens on a delayed workqueue; without the wait the verity
# table is built before the partitions exist, so the boot breaks intermittently
# rather than cleanly. os/mkimage-v2.sh rejects a cmdline file that lacks it.
#
# The GUID is lowercased, the same form used in /etc/fstab and the same form
# udev gives /dev/disk/by-partuuid/ (libblkid formats GUIDs lowercase). The
# kernel compares with strncasecmp and accepts either, so one canonical
# lowercase spelling everywhere is the least surprising choice.
# os/mkimage-v2.sh cross-checks this table against ${ROOTFS_x_GUID}, which the
# layout env holds uppercase, comparing case-insensitively (RFCT-020). Do not
# "fix" anything by uppercasing this: lowercase is what udev and fstab use.
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
