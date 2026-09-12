#!/usr/bin/env bash
# Upload the archives this repository built to the package registry.
#
#   bash build-env/deb/publish.sh [--pool <dir>] [--arch <amd64|arm64>] [--package <name> ...]
#
#   reads   <pool>/<arch>/pool/*.deb     (default pool: _out/debs, both arches)
#   writes  PUT <registry>/pool/<dist>/<component>/upload, one per archive
#
# THE COMPONENT IS THIS REPOSITORY, by the same rule build.sh writes into
# Mos-Source-Repo: MOS_SOURCE_REPO, else the basename of `origin`. An archive
# whose control field names another repository is refused -- publishing it
# here would file another repository's output under this one's name.
#
# WHAT IS REFUSED, each by name: a version stamped `.dirty` (no commit
# reproduces it, so nothing can lock it); an archive whose Mos-Source-Commit
# is not this checkout's HEAD (it was built from another commit; publish it
# from that one); a checkout with uncommitted changes (the archives may be
# clean and the tree not, and the next build would not reproduce them).
#
# AFTER EVERY UPLOAD THE ARCHIVE IS READ BACK and its sha256 compared: the
# registry's copy is what every later fetch verifies against, so what it holds
# is asserted rather than assumed. An archive the registry already holds under
# this name (409) is read back the same way -- identical bytes are "already
# published", different bytes are a refusal, because a name that resolves to
# two archives is a lock that can never be right.
#
# --package restricts the run to the named packages (every architecture in the
# pool); without it every archive in the pool is published.
#
# Prints, at the end, the lock rows for what it published. `make
# os-lock-bump COMPONENT=<name>` reads the registry rather than this output,
# so the two cannot disagree about what was published.
#
# mos-build-side: host
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
# shellcheck disable=SC1091
. "${HERE}/registry.sh"

POOL_ROOT="${REPO_ROOT}/_out/debs"
ARCHES=(amd64 arm64)
ONLY=()
while [ "$#" -gt 0 ]; do
    case "$1" in
    --pool) POOL_ROOT="${2-}"; [ -n "${POOL_ROOT}" ] || { echo "error: --pool takes a directory" >&2; exit 1; }; shift 2 ;;
    --arch) [ -n "${2-}" ] || { echo "error: --arch takes amd64 or arm64" >&2; exit 1; }; ARCHES=("$2"); shift 2 ;;
    --package) [ -n "${2-}" ] || { echo "error: --package takes a package name" >&2; exit 1; }; ONLY+=("$2"); shift 2 ;;
    *) echo "usage: bash build-env/deb/publish.sh [--pool <dir>] [--arch <amd64|arm64>] [--package <name> ...]" >&2; exit 1 ;;
    esac
done
for a in "${ARCHES[@]}"; do
    case "${a}" in amd64 | arm64) ;; *) echo "error: --arch must be amd64 or arm64" >&2; exit 1 ;; esac
done
for t in curl sha256sum dpkg-deb git; do
    command -v "${t}" >/dev/null 2>&1 || { echo "error: ${t} is required and not on PATH" >&2; exit 1; }
done

registry_load
registry_repo_name
registry_token

[ -z "$(git -C "${REPO_ROOT}" status --porcelain)" ] || {
    echo "error: ${REPO_ROOT} has uncommitted changes. An archive is published as the output of one commit; commit first, rebuild, then publish" >&2
    exit 1
}
HEAD_COMMIT="$(git -C "${REPO_ROOT}" rev-parse HEAD)"

# Every archive, once: an Architecture: all archive sits in both pools as one
# file, and uploading it twice is a 409 the second time for no reason.
declare -A SEEN=()
DEBS=()
for a in "${ARCHES[@]}"; do
    pool="${POOL_ROOT}/${a}/pool"
    [ -d "${pool}" ] || { echo "error: ${pool} does not exist; build the pool first (make os-debs)" >&2; exit 1; }
    while IFS= read -r f; do
        n="$(basename "${f}")"
        [ -z "${SEEN[${n}]:-}" ] || continue
        if [ "${#ONLY[@]}" -gt 0 ]; then
            wanted=0
            for o in "${ONLY[@]}"; do [ "${n%%_*}" != "${o}" ] || wanted=1; done
            [ "${wanted}" = 1 ] || continue
        fi
        SEEN["${n}"]="${f}"
        DEBS+=("${f}")
    done < <(find "${pool}" -maxdepth 1 -type f -name '*.deb' | LC_ALL=C sort)
done
[ "${#DEBS[@]}" -gt 0 ] || { echo "error: no .deb under ${POOL_ROOT}/{${ARCHES[*]}}/pool${ONLY[@]+ named ${ONLY[*]}}; nothing to publish" >&2; exit 1; }
for o in ${ONLY[@]+"${ONLY[@]}"}; do
    found=0
    for f in "${DEBS[@]}"; do [ "$(basename "${f}")" != "${o}_"* ] || found=1; done
    [ "${found}" = 1 ] || { echo "error: --package ${o} names no archive under ${POOL_ROOT}/{${ARCHES[*]}}/pool" >&2; exit 1; }
done

# Refusals first, over the whole set, so a run either publishes everything it
# was handed or nothing.
for deb in "${DEBS[@]}"; do
    n="$(basename "${deb}")"
    version="$(dpkg-deb --field "${deb}" Version)"
    repo="$(dpkg-deb --field "${deb}" Mos-Source-Repo)"
    commit="$(dpkg-deb --field "${deb}" Mos-Source-Commit)"
    case "${version}" in
    *.dirty-*) echo "error: ${n} is versioned ${version}: a dirty archive is one no commit reproduces, and the registry holds only what a lock can name. Commit, rebuild, publish" >&2; exit 1 ;;
    esac
    [ "${repo}" = "${REPO_NAME}" ] || {
        echo "error: ${n} says Mos-Source-Repo: ${repo:-(none)}, and this checkout is ${REPO_NAME}. Only this repository's own archives are published under its component" >&2
        exit 1
    }
    [ "${commit}" = "${HEAD_COMMIT}" ] || {
        echo "error: ${n} says Mos-Source-Commit: ${commit:-(none)}, and HEAD is ${HEAD_COMMIT}. It was built from another commit; publish from that checkout, or rebuild here" >&2
        exit 1
    }
done

published=0
present=0
ROWS=()
for deb in "${DEBS[@]}"; do
    n="$(basename "${deb}")"
    pkg="$(dpkg-deb --field "${deb}" Package)"
    version="$(dpkg-deb --field "${deb}" Version)"
    arch="$(dpkg-deb --field "${deb}" Architecture)"
    sha="$(sha256sum "${deb}" | cut -d' ' -f1)"
    url="${MOS_REGISTRY_URL}/pool/${MOS_REGISTRY_DIST}/${REPO_NAME}/${n}"
    body="$(mktemp)"
    status="$(registry_curl PUT "${MOS_REGISTRY_URL}/pool/${MOS_REGISTRY_DIST}/${REPO_NAME}/upload" "${body}" --upload-file "${deb}")"
    case "${status}" in
    201) published=$((published + 1)); echo "publish.sh: ${n} uploaded" ;;
    409) present=$((present + 1)); echo "publish.sh: ${n} is already in the registry; comparing bytes" ;;
    401 | 403) echo "error: upload of ${n} answered ${status}; ${MOS_REGISTRY_TOKEN_VAR} does not grant write access to the registry" >&2; rm -f "${body}"; exit 1 ;;
    000) echo "error: the registry at ${MOS_REGISTRY_URL} could not be reached (transport failure)" >&2; rm -f "${body}"; exit 1 ;;
    *) echo "error: upload of ${n} answered HTTP ${status}: $(head -c 300 "${body}")" >&2; rm -f "${body}"; exit 1 ;;
    esac
    # Read back, always.
    status="$(registry_curl GET "${url}" "${body}")"
    [ "${status}" = 200 ] || { echo "error: ${url} answered HTTP ${status} right after the upload; the registry does not serve what it accepted" >&2; rm -f "${body}"; exit 1; }
    got="$(sha256sum "${body}" | cut -d' ' -f1)"
    rm -f "${body}"
    [ "${got}" = "${sha}" ] || {
        echo "error: the registry serves ${n} with sha256 ${got}, and the archive here is ${sha}. Under one name the registry holds different bytes than this build produced; a lock naming it could never be right. Nothing further was published" >&2
        exit 1
    }
    ROWS+=("${pkg}	${version}	${arch}	${sha}	${REPO_NAME}	${HEAD_COMMIT}")
done

echo "publish.sh: ${published} archive(s) uploaded, ${present} already present, all read back at their digests; component ${REPO_NAME}, distribution ${MOS_REGISTRY_DIST}"
echo "publish.sh: lock rows for what the registry now holds from this commit:"
printf '%s\n' "${ROWS[@]}"
