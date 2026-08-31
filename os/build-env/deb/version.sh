#!/usr/bin/env bash
# The pool version, in one place, for every producer in the repository.
#
#   bash os/build-env/deb/version.sh
#   -> 0.1.0+git9671c7cf2d4d-1          a clean tree
#   -> 0.1.0+git9671c7cf2d4d.dirty-1    a tree with uncommitted changes
#
# os/tests/deb-package-gate.sh requires ONE version across the whole pool, and
# the pool is shared by producers that have nothing else in common: the mosd
# producers are Rust and carry crate manifests, while the rauc and podman
# producers are neither and carry none. A rule each producer implemented for
# itself would be a rule they agree on until one of them is edited, so the rule
# lives here and every producer asks for it.
#
# The number comes from the mosd workspace's crate manifests. That is where it
# already lived and this file did not move it -- `0.1.0` is written in the
# crates and must not be written a second time, because a second copy is a
# number that stops matching the binaries the first time one of them moves.
# Reaching from the build substrate into one component's workspace is the one
# thing here that is not self-contained; the alternative is a constant in this
# file, which is the copy just described.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
WORKSPACE="${REPO_ROOT}/os/pkgs/mosd"
for p in "${REPO_ROOT}/Makefile" "${WORKSPACE}/Cargo.toml"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. os/build-env/deb/version.sh derives the repository as three levels above itself; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done

[ "$#" -eq 0 ] || {
    echo "usage: bash os/build-env/deb/version.sh    (no arguments; there is one pool and it has one version)" >&2
    exit 1
}

# Every member's version, and they must AGREE. The pool holds one version by
# rule, so a workspace holding two has no single answer to give -- and picking
# one of them here would stamp a number onto packages built from a crate that
# declares the other. Failing names both, which is the decision a divergence
# actually needs.
#
# `0.1.0` is not a fallback anywhere below. A manifest that declares no version,
# and a glob that matches no manifest, are both errors: an unset version would
# compose into `+git<commit>-1`, which dpkg accepts and which orders below every
# real version.
VERSION=""
DECLARED_BY=""
FOUND=0
for m in "${WORKSPACE}"/*/Cargo.toml; do
    [ -f "${m}" ] || continue
    name="$(sed -n '/^\[package\]/,/^\[/ s/^name[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "${m}" | head -n1)"
    [ -n "${name}" ] || continue
    v="$(sed -n '/^\[package\]/,/^\[/ s/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "${m}" | head -n1)"
    [ -n "${v}" ] || {
        echo "error: ${m} declares the crate '${name}' and no version, so the packages built from it would be versioned around an empty string. That manifest is where the number lives; this script carries no fallback" >&2
        exit 1
    }
    FOUND=$((FOUND + 1))
    if [ -z "${VERSION}" ]; then
        VERSION="${v}"
        DECLARED_BY="${name}"
    elif [ "${v}" != "${VERSION}" ]; then
        echo "error: the mosd workspace declares two versions -- ${DECLARED_BY} is ${VERSION} and ${name} is ${v}. The package pool carries ONE version across every producer, so there is no answer to give here until those agree; os/tests/deb-package-gate.sh asserts the same fact over the built archives" >&2
        exit 1
    fi
done
# A glob that matched nothing would leave VERSION empty and every comparison
# above unreached -- the "they all agree" loop is vacuously satisfied by no
# manifests at all, and this is the check that says so.
[ "${FOUND}" -gt 0 ] || {
    echo "error: no crate under ${WORKSPACE} declares a [package] name and version, so there is no version to build the pool's around. This script reads the mosd workspace manifests; if that workspace moved, so did this arithmetic" >&2
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
