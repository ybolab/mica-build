#!/usr/bin/env bash
# Build the squashfs + dm-verity arm64 rootfs slot image for cx3576 (layout v2).
# Usage: [BOARD_DIR=...] [ROOT_PASSWORD=...] [WITH_MOSD=0|1] bash os/rootfs/build-v2.sh
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
BOARD_CMDLINE_ARGS="console=ttyFIQ0,1500000 earlycon=uart8250,mmio32,0x2ad40000 storagemedia=emmc net.ifnames=0"

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
    cp "$REPO_ROOT/mosd/target/aarch64-unknown-linux-gnu/release/webd" "$MOSD_STAGE/webd"
    cp "$REPO_ROOT/mosd/dist/webd.service" "$MOSD_STAGE/webd.service"
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
rm -rf "$OVERLAY_STAGE"
mkdir -p "$OVERLAY_STAGE"
cp -a "$OVERLAY_SRC/." "$OVERLAY_STAGE/"

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

render "$OVERLAY_STAGE/etc/fstab.in" "$OVERLAY_STAGE/etc/fstab" \
    EPHEMERAL_GUID "$(lower "$EPHEMERAL_GUID")" \
    STATE_GUID "$(lower "$STATE_GUID")" \
    META_GUID "$(lower "$META_GUID")"

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
        --build-arg VERITY_SALT="$VERITY_SALT" \
        --build-arg VERITY_UUID="$VERITY_UUID" \
        --build-arg SQUASHFS_TIME="$SQUASHFS_TIME" \
        ${ROOT_PASSWORD:+--build-arg ROOT_PASSWORD="$ROOT_PASSWORD"} \
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
# dm-mod.waitfor= is set to the same slot partition. dm_init_init already calls
# wait_for_device_probe(), but the eMMC host probes asynchronously and dm-init
# is only a late_initcall; without waitfor a slow probe turns into a silent
# "no /dev/dm-0" and then an unexplained rootwait hang.
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
