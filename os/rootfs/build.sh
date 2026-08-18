#!/usr/bin/env bash
# Build the Debian systemd arm64 rootfs image for cx3576.
# Usage: [BOARD_DIR=...] [ROOT_PASSWORD=...] [WITH_MOSD=0|1] bash os/rootfs/build.sh
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
BOARD_DIR=${BOARD_DIR:-"$REPO_ROOT/board/cx3576"}
OUT_DIR="$REPO_ROOT/_out/cx3576"
SIZE_BUDGET_MB=400
WITH_MOSD=${WITH_MOSD:-1}

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
else
    echo "note: WITH_MOSD=0; building rootfs without mosd"
fi

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
        -f "$SCRIPT_DIR/Dockerfile" \
        --build-arg MODULES_TAR=_out/cx3576/modules.tar \
        --build-arg MOSD_DIR=_out/cx3576/mosd \
        --build-arg WITH_MOSD="$WITH_MOSD" \
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

REPORT="$OUT_DIR/rootfs-report.txt"
echo
echo "=== rootfs-report.txt ==="
cat "$REPORT"
echo "=== image: $OUT_DIR/rootfs.img ($(stat -c %s "$OUT_DIR/rootfs.img") bytes) ==="

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
