#!/usr/bin/env bash
# Check a locked package repository out at its locked commit.
#
#   bash build-env/deb/source.sh <component>
#   -> _out/src/<component>/    at the commit every lock row of that component names
#
# For the assembly tests that need a package's SOURCE rather than its archive
# (the component-contract fixtures, the early-hang init). The commit is the
# lock's, so the source these tests read is the source the fetched archives
# were built from. A component whose rows name two commits is refused: the
# lock is then mid-bump and there is no one source to check out.
#
# Refuses offline by name: git's own error is printed under a line naming the
# repository URL and the variable that changes it (registry.env's
# MOS_SOURCE_URL).
#
# mos-build-side: host
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
# shellcheck disable=SC1091
. "${HERE}/registry.sh"

[ "$#" -eq 1 ] && [ -n "$1" ] || { echo "usage: bash build-env/deb/source.sh <component>" >&2; exit 1; }
COMPONENT="$1"
[[ "${COMPONENT}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "error: '${COMPONENT}' is not a component name" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "error: git is required and not on PATH" >&2; exit 1; }

registry_load
mapfile -t COMMITS < <(lock_rows | awk -F'\t' -v c="${COMPONENT}" '$5 == c { print $6 }' | LC_ALL=C sort -u)
[ "${#COMMITS[@]}" -gt 0 ] || { echo "error: ${LOCK_FILE#"${REPO_ROOT}"/} locks no archive from ${COMPONENT}, so there is no commit to check out" >&2; exit 1; }
[ "${#COMMITS[@]}" -eq 1 ] || { echo "error: ${LOCK_FILE#"${REPO_ROOT}"/} locks ${COMPONENT} at ${#COMMITS[@]} different commits (${COMMITS[*]}); a bump is half done" >&2; exit 1; }
COMMIT="${COMMITS[0]}"

URL="${MOS_SOURCE_URL%/}/${COMPONENT}.git"
DEST="${REPO_ROOT}/_out/src/${COMPONENT}"
mkdir -p "${REPO_ROOT}/_out/src"
if [ ! -d "${DEST}/.git" ]; then
    rm -rf "${DEST}"
    git clone --quiet --no-checkout "${URL}" "${DEST}" || {
        echo "error: could not clone ${URL} (see git's message above). The locked source of ${COMPONENT} is read from that repository; offline, there is nothing to read it from. MOS_SOURCE_URL in build-env/deb/registry.env names the prefix" >&2
        exit 1
    }
fi
git -C "${DEST}" cat-file -e "${COMMIT}^{commit}" 2>/dev/null || git -C "${DEST}" fetch --quiet origin || {
    echo "error: could not fetch ${URL} (see git's message above); the locked commit ${COMMIT} is not in the local clone and the remote is unreachable" >&2
    exit 1
}
git -C "${DEST}" cat-file -e "${COMMIT}^{commit}" 2>/dev/null || {
    echo "error: ${URL} does not contain the locked commit ${COMMIT}; the lock names a commit that repository does not have" >&2
    exit 1
}
git -C "${DEST}" checkout --quiet --detach "${COMMIT}"
[ "$(git -C "${DEST}" rev-parse HEAD)" = "${COMMIT}" ] || { echo "error: ${DEST} is not at ${COMMIT} after checkout" >&2; exit 1; }
[ -z "$(git -C "${DEST}" status --porcelain)" ] || { echo "error: ${DEST} is dirty after checkout; the tests would read edited source" >&2; exit 1; }
echo "source.sh: ${COMPONENT} at ${COMMIT} in ${DEST#"${REPO_ROOT}"/}"
