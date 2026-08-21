#!/usr/bin/env bash
# Build the squashfs + dm-verity arm64 rootfs slot image for cx3576 (layout v2).
# Usage: [BOARD_DIR=...] [WITH_MOSD=0|1] [MOS_PROFILE=dev|prod] bash os/rootfs/build-v2.sh
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
LAYOUT_ENV="$REPO_ROOT/os/layout/cx3576-v2.env"
BOARD_DIR=${BOARD_DIR:-"$REPO_ROOT/board/cx3576"}
OUT_DIR="$REPO_ROOT/_out/cx3576"
SIZE_BUDGET_MB=400
WITH_MOSD=${WITH_MOSD:-1}
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

# Board console facts, carried over verbatim from the v1 APPEND line in
# os/mkimage.sh. They describe the cx3576 serial console and storage, not the
# partition layout, so they are not layout-env constants; if a second board
# ever needs a v2 image they move into a per-board file.
BOARD_CMDLINE_ARGS="console=ttyFIQ0,1500000 earlycon=uart8250,mmio32,0x2ad40000 net.ifnames=0"

# The verity superblock carries a UUID that veritysetup randomises by default,
# which would make the image differ on every build. Pin it to the rootfs-a
# partition GUID rather than inventing a new magic constant: it is already a
# per-layout identifier from the layout env, and both slots hold the same
# content so sharing one value across A and B is correct.
VERITY_UUID=$(echo "$ROOTFS_A_GUID" | tr 'A-Z' 'a-z')
# FILE_MTIME is the touch(1) form (@epoch); mksquashfs wants bare seconds.
SQUASHFS_TIME=${FILE_MTIME#@}

MODULES_TAR="$BOARD_DIR/out/kernel/modules.tar"
if [ ! -f "$MODULES_TAR" ]; then
    echo "error: $MODULES_TAR not found." >&2
    echo "Build it with 'make -C board/cx3576 kernel' or point BOARD_DIR at" >&2
    echo "prebuilt BSP artifacts, e.g. BOARD_DIR=/srv/ai/mos/board/cx3576" >&2
    exit 1
fi

mkdir -p "$OUT_DIR"
cp "$MODULES_TAR" "$OUT_DIR/modules.tar"

# mosd: cross-build and stage into the context like modules.tar. The staged
# directory always exists (empty when WITH_MOSD=0) so the Dockerfile COPY works
# on both paths.
MOSD_STAGE="$OUT_DIR/mosd"
rm -rf "$MOSD_STAGE"
mkdir -p "$MOSD_STAGE"
if [ "$WITH_MOSD" = "1" ]; then
    bash "$REPO_ROOT/mosd/hack/build-aarch64.sh"
    cp "$REPO_ROOT/mosd/target/aarch64-unknown-linux-gnu/release/mosd" "$MOSD_STAGE/mosd"
    cp "$REPO_ROOT/mosd/dist/mosd.service" "$MOSD_STAGE/mosd.service"
    cp "$REPO_ROOT/mosd/dist/com.mos.mosd.conf" "$MOSD_STAGE/com.mos.mosd.conf"
    cp "$REPO_ROOT/mosd/target/aarch64-unknown-linux-gnu/release/apid" "$MOSD_STAGE/apid"
    cp "$REPO_ROOT/mosd/dist/apid.service" "$MOSD_STAGE/apid.service"
else
    echo "note: WITH_MOSD=0; building rootfs without mosd"
fi

# Board hardware-init facts (confs consumed by the os/hwinit units), staged
# like mosd so the Dockerfile COPY always has a directory (may be empty).
INIT_STAGE="$OUT_DIR/init"
rm -rf "$INIT_STAGE"
mkdir -p "$INIT_STAGE"
if [ -d "$BOARD_DIR/init" ]; then
    cp -a "$BOARD_DIR/init/." "$INIT_STAGE/"
elif [ -d "$REPO_ROOT/board/cx3576/init" ]; then
    cp -a "$REPO_ROOT/board/cx3576/init/." "$INIT_STAGE/"
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
bash "$REPO_ROOT/os/rauc/render-config.sh"

rm -rf "$OVERLAY_STAGE"
mkdir -p "$OVERLAY_STAGE"
cp -a "$OVERLAY_SRC/." "$OVERLAY_STAGE/"
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
want_defs=8
have_defs=$(find "$OVERLAY_STAGE/etc/repart.d" -name '*.conf' | wc -l)
if [ "$have_defs" -ne "$want_defs" ]; then
    echo "error: $have_defs repart definitions staged, expected $want_defs" >&2
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

render "$OVERLAY_STAGE/etc/fstab.in" "$OVERLAY_STAGE/etc/fstab" \
    EPHEMERAL_GUID "$(lower "$EPHEMERAL_GUID")" \
    STATE_GUID "$(lower "$STATE_GUID")" \
    META_GUID "$(lower "$META_GUID")" \
    VAR_OPTS "$VAR_OPTS" \
    SRV_LINE "$SRV_LINE"

render "$OVERLAY_STAGE/etc/fw_env.config.in" "$OVERLAY_STAGE/etc/fw_env.config" \
    UENV_A_GUID "$(lower "$UENV_A_GUID")" \
    UENV_B_GUID "$(lower "$UENV_B_GUID")" \
    UENV_SIZE_HEX "$(printf '0x%x' "$UENV_SIZE_BYTES")"

# If the current builder cannot run linux/arm64 (e.g. host binfmt registration
# is unavailable), fall back to a docker-container builder: its buildkit image
# bundles QEMU emulators and needs no host binfmt.
BUILDER_ARGS=()
if [ -z "${BUILDX_BUILDER:-}" ] && ! docker buildx inspect 2>/dev/null | grep -q 'linux/arm64'; then
    echo "note: current builder lacks linux/arm64; using docker-container builder 'mos-arm64'"
    docker buildx inspect mos-arm64 >/dev/null 2>&1 || \
        docker buildx create --name mos-arm64 --driver docker-container >/dev/null
    BUILDER_ARGS=(--builder mos-arm64)
fi

log=$(mktemp)
trap 'rm -f "$log"' EXIT
if ! docker buildx build \
        "${BUILDER_ARGS[@]}" \
        --platform linux/arm64 \
        -f "$SCRIPT_DIR/Dockerfile.v2" \
        --build-arg MODULES_TAR=_out/cx3576/modules.tar \
        --build-arg MOSD_DIR=_out/cx3576/mosd \
        --build-arg BOARD_INIT_DIR=_out/cx3576/init \
        --build-arg OVERLAY_DIR=_out/cx3576/overlay-v2 \
        --build-arg WITH_MOSD="$WITH_MOSD" \
        --build-arg MOS_PROFILE="$MOS_PROFILE" \
        --build-arg VERITY_SALT="$VERITY_SALT" \
        --build-arg VERITY_UUID="$VERITY_UUID" \
        --build-arg SQUASHFS_TIME="$SQUASHFS_TIME" \
        --target artifact \
        --output "type=local,dest=$OUT_DIR" \
        "$REPO_ROOT" 2>&1 | tee "$log"; then
    if grep -qi 'exec format error' "$log"; then
        echo >&2
        echo "hint: arm64 emulation is missing on this host. Install it with:" >&2
        echo "  docker run --privileged --rm tonistiigi/binfmt --install arm64" >&2
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
