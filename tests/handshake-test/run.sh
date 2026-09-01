#!/usr/bin/env bash
set -euo pipefail

# Offline U-Boot A/B handshake harness, host side.
#
# Builds (once, with network) a U-Boot v2026.07 SANDBOX binary carrying the
# board's persistent-env contract, caches the artifacts under _out/, then runs
# tests/handshake-test/harness.sh inside the builder image against the
# SHIPPED boards/cx3576/boot.cmd. Every run after the first build is offline:
# the builder image is local and the run mounts only local paths.
#
#   make os-uboot-handshake-test        # or: bash tests/handshake-test/run.sh
#   HANDSHAKE_REBUILD=1 bash run.sh     # force the container build to re-run
#
# The docker daemon must be able to bind-mount the repository and _out/, which
# repository-local paths always are.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUT="${REPO_ROOT}/_out/handshake-test"
# The tag for the src stage; a stable tag keeps the cached clone and toolchain
# layers warm across runs.
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
    # The builder image, out of build-env/images.env. The
    # Dockerfile declares MOS_IMAGE_UBUNTU_2404 with no default, so this is not
    # optional -- and it is resolved before the first of the two builds rather
    # than in front of each, so a bad pin cannot leave a tagged src stage behind
    # to be reused as a cache on the next run.
    mapfile -t FROM_ARGS < <("${REPO_ROOT}/build-env/from.sh" \
        MOS_IMAGE_UBUNTU_2404=IMAGE_UBUNTU_2404)
    # mapfile cannot fail, so its status says nothing about the process inside
    # the substitution; an empty array is what a refusal looks like from here.
    [ "${#FROM_ARGS[@]}" -eq 2 ] || {
        echo "error: build-env/from.sh did not yield the builder image (see its message above); this build would have run with a missing FROM" >&2
        exit 1
    }
    DOCKER_BUILDKIT=1 docker build --target src -t "${IMAGE_TAG}" \
        "${FROM_ARGS[@]}" "${SCRIPT_DIR}"
    mkdir -p "${OUT}"
    DOCKER_BUILDKIT=1 docker build --target artifact \
        "${FROM_ARGS[@]}" \
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
    bash /repo/tests/handshake-test/harness.sh
