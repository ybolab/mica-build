#!/usr/bin/env bash
# What this tree takes out of the imported mica-deploy archives and source.
#
#   bash tools/deploy-pool.sh --lifecycle <amd64|arm64> <dir>   mica-init and mica-shutdown into <dir>
#   bash tools/deploy-pool.sh --check                          the contract fixtures against the pinned source
#
#   reads   _out/debs/<arch>/pool/mica-lifecycle_*.deb   (fetched at the pin by build-env/deb/fetch.sh)
#           _out/src/mica-deploy/                        (build-env/deb/source.sh, at the pinned commit)
#   writes  <dir>/mica-init, <dir>/mica-shutdown         (--lifecycle)
#
# The native boot and deployment tools are built and released by
# ybolab/mica-deploy; this repository imports mica-deploy (the device-side
# client, installed into every root) and mica-lifecycle (the two static
# executables the signed kernel carries) through deps/packages/ and never
# sees that repository's tree. Two consumers still need something out of it:
#
# - build/src/kernel-package.ts packs mica-init and mica-shutdown into the
#   initramfs and the exit ramdisk, where they are part of the authenticated
#   kernel identity. --lifecycle reads them out of the pinned archive of the
#   board's architecture (tools/deb-member.py), so the kernel is built from
#   the binaries the pin names and nothing is compiled here.
# - tests/component-contracts/ is the contract between build/ (the producer
#   of envelopes and records) and the crate's reader; both repositories
#   commit the same four files. --check reads mica-deploy's copy at the
#   locked commit and refuses a difference, so the two cannot drift apart
#   without a bump on one side and a diff on the other. `make os-pool` runs
#   it beside the fetch, where the network is already required.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/.." && pwd)"
POOL="${MICA_POOL_DIR:-${REPO_ROOT}/_out/debs}"
MEMBER="${HERE}/deb-member.py"

archive_for() {
    local arch="$1" found=()
    for f in "${POOL}/${arch}/pool/"mica-lifecycle_*_"${arch}".deb; do
        [ -e "${f}" ] && found+=("${f}")
    done
    [ "${#found[@]}" -eq 1 ] || {
        echo "error: expected exactly one mica-lifecycle archive in ${POOL}/${arch}/pool, found ${#found[@]}. deps/packages/mica-lifecycle.json pins it; fetch it with \`make os-pool\`" >&2
        exit 1
    }
    printf '%s\n' "${found[0]}"
}

case "${1:-}" in
--lifecycle)
    arch="${2:-}"; dir="${3:-}"
    case "${arch}" in amd64 | arm64) ;; *) echo "usage: bash tools/deploy-pool.sh --lifecycle <amd64|arm64> <dir>" >&2; exit 1 ;; esac
    [ -n "${dir}" ] || { echo "usage: bash tools/deploy-pool.sh --lifecycle <amd64|arm64> <dir>" >&2; exit 1; }
    archive="$(archive_for "${arch}")"
    mkdir -p "${dir}"
    for b in mica-init mica-shutdown; do
        python3 "${MEMBER}" "${archive}" "usr/lib/mica/lifecycle/${b}" "${dir}/${b}"
    done
    echo "deploy-pool.sh: mica-init and mica-shutdown for ${arch} in ${dir} from ${archive##*/}"
    ;;
--check)
    bash "${REPO_ROOT}/build-env/deb/source.sh" mica-deploy
    theirs="${REPO_ROOT}/_out/src/mica-deploy/tests/component-contracts"
    ours="${REPO_ROOT}/tests/component-contracts"
    [ -d "${theirs}" ] || { echo "error: ${theirs#"${REPO_ROOT}"/} does not exist at the pinned mica-deploy commit; the contract fixtures are expected there" >&2; exit 1; }
    diff -ruN "${ours}" "${theirs}" || {
        echo "error: tests/component-contracts differs from mica-deploy's copy at the pinned commit (see the diff above). The four files are one contract read by both sides; change them in mica-deploy, release, bump the pin here, and copy the same files" >&2
        exit 1
    }
    echo "deploy-pool.sh: tests/component-contracts matches mica-deploy at the pinned commit"
    ;;
*)
    echo "usage: bash tools/deploy-pool.sh --lifecycle <amd64|arm64> <dir> | --check" >&2
    exit 1
    ;;
esac
