#!/usr/bin/env bash
# The pool version, in one place, for every producer in the repository.
#
#   bash build-env/deb/version.sh
#   -> 0.1.0+git9671c7cf2d4d-1          a clean tree
#   -> 0.1.0+git9671c7cf2d4d.dirty-1    a tree with uncommitted changes
#
# tests/deb-package-gate.sh requires ONE stamp across every archive this
# repository builds, and the pool is shared by producers that have nothing else
# in common. A rule each producer implemented for itself would be a rule they
# agree on until one of them is edited, so the rule lives here and every
# producer asks for it.
#
# The number comes from ${REPO_ROOT}/VERSION: one line, the repository's own
# release version. It used to be read out of the mosd workspace's crate
# manifests, which tied the substrate to one component's layout; each
# repository now declares its version in a file the substrate can read without
# knowing what the repository holds. pkgs/mosd/hack/check.sh asserts that the
# workspace crates carry the same number, so the two cannot drift apart
# silently.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
VERSION_FILE="${REPO_ROOT}/VERSION"
for p in "${REPO_ROOT}/Makefile" "${VERSION_FILE}"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. build-env/deb/version.sh derives the repository as two levels above itself and reads its VERSION file; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done

[ "$#" -eq 0 ] || {
    echo "usage: bash build-env/deb/version.sh    (no arguments; there is one pool and it has one version)" >&2
    exit 1
}

# `0.1.0` is not a fallback anywhere below. An empty or malformed VERSION is an
# error: an unset version would compose into `+git<commit>-1`, which dpkg
# accepts and which orders below every real version.
VERSION="$(sed -n '1p' "${VERSION_FILE}" | tr -d '[:space:]')"
[ "$(grep -c . "${VERSION_FILE}")" -eq 1 ] || {
    echo "error: ${VERSION_FILE} must hold exactly one non-empty line, the repository's release version (for example 0.1.0)" >&2
    exit 1
}
[[ "${VERSION}" =~ ^[0-9][A-Za-z0-9.~]*$ ]] || {
    echo "error: ${VERSION_FILE} declares '${VERSION}', which is not a Debian upstream version (a digit, then letters, digits, dots or tildes). The pool's version is built around this string; there is no fallback" >&2
    exit 1
}

git -C "${REPO_ROOT}" rev-parse --git-dir >/dev/null 2>&1 || {
    echo "error: ${REPO_ROOT} is not a git checkout. The package version is <version>+git<commit>-1; that has no defensible value here without git, and a fallback would make every archive irreproducible while every build stayed green" >&2
    exit 1
}
COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short=12 HEAD)"
[ -n "${COMMIT}" ] || {
    echo "error: \`git rev-parse --short=12 HEAD\` named no commit in ${REPO_ROOT}" >&2
    exit 1
}
# `.dirty` marks an archive no commit reproduces. The commit alone would name a
# tree that is not the one being packaged.
DIRTY=""
[ -z "$(git -C "${REPO_ROOT}" status --porcelain)" ] || DIRTY=".dirty"

# The `-1` is the Debian revision. These packages have no upstream/downstream
# split, so it does not move.
echo "${VERSION}+git${COMMIT}${DIRTY}-1"
