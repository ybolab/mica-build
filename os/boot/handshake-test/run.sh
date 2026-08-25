#!/usr/bin/env bash
set -euo pipefail

# RFCT-087 — offline U-Boot A/B handshake harness, host side.
#
# Builds (once, with network) a U-Boot v2026.07 SANDBOX binary carrying the
# board's persistent-env contract, caches the artifacts under _out/, then runs
# os/boot/handshake-test/harness.sh inside the builder image against the
# SHIPPED os/boards/cx3576/boot.cmd. Every run after the first build is offline:
# the builder image is local and the run mounts only local paths.
#
#   make os-uboot-handshake-test        # or: bash os/boot/handshake-test/run.sh
#   HANDSHAKE_REBUILD=1 bash run.sh     # force the container build to re-run
#
# The docker daemon must be able to bind-mount the repository and _out/, which
# repository-local paths always are (same constraint as mkimage-v2-selftest).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
OUT="${REPO_ROOT}/_out/handshake-test"
# The tag the spike's first pass left behind for the src stage; reusing it
# keeps the cached clone/toolchain layers warm.
IMAGE_TAG=mos-hs-src
ARTIFACTS=(u-boot u-boot.dtb mkimage mkenvimage)

command -v docker >/dev/null || { echo "error: docker is required" >&2; exit 1; }

need_build=0
for a in "${ARTIFACTS[@]}"; do
    [ -f "${OUT}/${a}" ] || need_build=1
done
docker image inspect "${IMAGE_TAG}" >/dev/null 2>&1 || need_build=1
[ "${HANDSHAKE_REBUILD:-0}" = "1" ] && need_build=1

if [ "${need_build}" = "1" ]; then
    echo "== building the sandbox U-Boot (network needed on the first, uncached build) =="
    DOCKER_BUILDKIT=1 docker build --target src -t "${IMAGE_TAG}" "${SCRIPT_DIR}"
    mkdir -p "${OUT}"
    DOCKER_BUILDKIT=1 docker build --target artifact \
        --output "type=local,dest=${OUT}" "${SCRIPT_DIR}"
    for a in "${ARTIFACTS[@]}"; do
        [ -f "${OUT}/${a}" ] || { echo "error: build did not produce ${OUT}/${a}" >&2; exit 1; }
    done
else
    echo "== cached sandbox U-Boot in ${OUT}; skipping build (HANDSHAKE_REBUILD=1 forces) =="
fi

WORK="${OUT}/work.$$"
mkdir -p "${WORK}"
trap 'rm -rf "${WORK}"' EXIT

docker run --rm \
    -v "${REPO_ROOT}:/repo:ro" \
    -v "${OUT}:/cache:ro" \
    -v "${WORK}:/work" \
    -w /work \
    "${IMAGE_TAG}" \
    bash /repo/os/boot/handshake-test/harness.sh
