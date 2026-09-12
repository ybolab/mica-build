#!/usr/bin/env bash
# Fetch every archive the lock names for one architecture into the pool.
#
#   bash build-env/deb/fetch.sh --arch <amd64|arm64>          download + verify
#   bash build-env/deb/fetch.sh --arch <amd64|arm64> --check  one HEAD per row, no download
#
#   reads   rootfs/packages/lock.tsv, build-env/deb/registry.env
#   writes  _out/debs/<arch>/pool/<package>_<version>_<arch|all>.deb
#           (MOS_POOL_DIR overrides _out/debs, as for build.sh and repo.sh)
#
# THE LOCK IS THE ONLY LIST. A row says package, version, architecture,
# sha256, source repository and source commit; this script downloads exactly
# that archive and refuses, naming the package, unless the bytes hash to the
# row's sha256 AND the control file inside says the row's Package, Version,
# Architecture, Mos-Source-Repo and Mos-Source-Commit. An archive already in
# the pool at the right digest is not downloaded again. Nothing here resolves
# a version, follows a "latest" or reads a Packages index: that is lock.sh's
# job, and a lock diff is the reviewable import.
#
# A REJECTED ARCHIVE DOES NOT STAY IN THE POOL: the download lands in a
# scratch file and is moved into the pool only after every check passed.
# Other versions of the same package are removed from the pool when the locked
# one lands, for the reason build.sh removes them: repo.sh indexes every .deb
# it finds and the composer resolves each pool independently.
#
# 401/403 name the token VARIABLE (registry.env's MOS_REGISTRY_TOKEN_VAR) and
# never a value. The host has dpkg-deb; nothing here needs a container.
#
# mos-build-side: host
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
# shellcheck disable=SC1091
. "${HERE}/registry.sh"

ARCH=""
CHECK=0
while [ "$#" -gt 0 ]; do
    case "$1" in
    --arch) ARCH="${2-}"; [ -n "${ARCH}" ] || { echo "error: --arch takes amd64 or arm64" >&2; exit 1; }; shift 2 ;;
    --check) CHECK=1; shift ;;
    *) echo "usage: bash build-env/deb/fetch.sh --arch <amd64|arm64> [--check]" >&2; exit 1 ;;
    esac
done
case "${ARCH}" in
amd64 | arm64) ;;
*) echo "error: --arch must be amd64 or arm64; it selects the pool the locked archives are fetched into" >&2; exit 1 ;;
esac
for t in curl sha256sum dpkg-deb; do
    command -v "${t}" >/dev/null 2>&1 || { echo "error: ${t} is required and not on PATH" >&2; exit 1; }
done

registry_load
mapfile -t ROWS < <(lock_rows "${ARCH}")
if [ "${#ROWS[@]}" -eq 0 ]; then
    echo "fetch.sh: ${LOCK_FILE#"${REPO_ROOT}"/} locks no package for ${ARCH}; nothing to fetch"
    exit 0
fi
registry_token

POOL="${MOS_POOL_DIR:-${REPO_ROOT}/_out/debs}/${ARCH}/pool"
mkdir -p "${POOL}"
SCRATCH="$(mktemp -d "${POOL}/.fetch.XXXXXX")"
trap 'rm -rf "${SCRATCH}"' EXIT

fetched=0
kept=0
for row in "${ROWS[@]}"; do
    IFS=$'\t' read -r pkg version row_arch sha repo commit <<<"${row}"
    name="${pkg}_${version}_${row_arch}.deb"
    url="${MOS_REGISTRY_URL}/pool/${MOS_REGISTRY_DIST}/${repo}/${name}"

    if [ "${CHECK}" = 1 ]; then
        status="$(registry_curl HEAD "${url}" /dev/null -I)"
        case "${status}" in
        200) echo "fetch.sh: ${pkg} ${version} ${row_arch} is reachable at ${url}" ;;
        401 | 403) echo "error: ${url} answered ${status}; ${MOS_REGISTRY_TOKEN_VAR} does not grant read access to the registry" >&2; exit 1 ;;
        404) echo "error: the registry does not hold ${name} under component ${repo} (${url} answered 404). The lock names an archive that was never published, or was removed; \`make os-lock-bump COMPONENT=${repo}\` re-reads what the registry holds" >&2; exit 1 ;;
        *) echo "error: ${url} answered HTTP ${status}" >&2; exit 1 ;;
        esac
        continue
    fi

    dest="${POOL}/${name}"
    if [ -f "${dest}" ] && [ "$(sha256sum "${dest}" | cut -d' ' -f1)" = "${sha}" ]; then
        kept=$((kept + 1))
        echo "fetch.sh: ${name} is already in the pool at the locked digest"
        continue
    fi

    tmp="${SCRATCH}/${name}"
    status="$(registry_curl GET "${url}" "${tmp}")"
    case "${status}" in
    200) ;;
    401 | 403) echo "error: ${url} answered ${status}; ${MOS_REGISTRY_TOKEN_VAR} does not grant read access to the registry" >&2; exit 1 ;;
    404) echo "error: the registry does not hold ${name} under component ${repo} (${url} answered 404). The lock names an archive that was never published, or was removed; \`make os-lock-bump COMPONENT=${repo}\` re-reads what the registry holds" >&2; exit 1 ;;
    000) echo "error: ${url} could not be reached (transport failure); the registry is offline or unreachable from this host" >&2; exit 1 ;;
    *) echo "error: ${url} answered HTTP ${status}" >&2; exit 1 ;;
    esac

    got_sha="$(sha256sum "${tmp}" | cut -d' ' -f1)"
    [ "${got_sha}" = "${sha}" ] || {
        echo "error: ${pkg} ${version} ${row_arch}: the registry served bytes with sha256 ${got_sha}, and the lock says ${sha}. The archive was replaced under its name, or the lock row is stale; the download was discarded" >&2
        exit 1
    }
    for pair in "Package:${pkg}" "Version:${version}" "Architecture:${row_arch}" "Mos-Source-Repo:${repo}" "Mos-Source-Commit:${commit}"; do
        field="${pair%%:*}"
        want="${pair#*:}"
        got="$(dpkg-deb --field "${tmp}" "${field}" 2>/dev/null || true)"
        [ "${got}" = "${want}" ] || {
            echo "error: ${pkg} ${version} ${row_arch}: the archive's control file says ${field}: '${got}', and the lock row says '${want}'. The bytes match the lock's digest, so the LOCK ROW is wrong about the archive it names; \`make os-lock-bump COMPONENT=${repo}\` rewrites it from the registry index. The download was discarded" >&2
            exit 1
        }
    done

    # Only now does it enter the pool, and the other versions of the same
    # package leave it.
    rm -f "${POOL}/${pkg}"_*.deb
    mv "${tmp}" "${dest}"
    fetched=$((fetched + 1))
    echo "fetch.sh: ${name} fetched from ${repo}@${commit:0:12} and verified against the lock"
done

if [ "${CHECK}" = 1 ]; then
    echo "fetch.sh: every locked archive for ${ARCH} (${#ROWS[@]}) is reachable"
else
    echo "fetch.sh: ${ARCH}: ${fetched} archive(s) fetched, ${kept} already present, ${#ROWS[@]} locked"
fi
