#!/usr/bin/env bash
# Index one architecture's package pool: Packages, SHA256SUMS and a manifest.
#
#   bash build-env/deb/repo.sh --arch <amd64|arm64>
#
#   reads   _out/debs/<arch>/pool/*.deb
#   writes  _out/debs/<arch>/{Packages,SHA256SUMS,manifest.txt}
#
# Every column of every line it writes is read out of an archive. There is no
# maintained list anywhere in this file, deliberately: a repository index
# generated from a list is one that reports success while installing something
# else, and the rootfs composer in PLAN-036 section 4 resolves the whole
# package set through exactly these three files.
#
# Runs on the HOST, which has no dpkg, so the work happens inside
# localhost/mos-build-deb -- the same arrangement pkgs/mosd/hack/build-target.sh
# uses for cargo.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
FROM_SH="${REPO_ROOT}/build-env/from.sh"
for p in "${REPO_ROOT}/Makefile" "${FROM_SH}"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. build-env/deb/repo.sh derives REPO_ROOT as two levels above itself; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done

ARCH=""
while [ "$#" -gt 0 ]; do
    case "$1" in
    --arch)
        ARCH="${2-}"
        [ -n "${ARCH}" ] || { echo "error: --arch takes amd64 or arm64" >&2; exit 1; }
        shift 2
        ;;
    *)
        echo "usage: bash build-env/deb/repo.sh --arch <amd64|arm64>" >&2
        exit 1
        ;;
    esac
done
case "${ARCH}" in
amd64 | arm64) ;;
*)
    echo "error: --arch must be amd64 or arm64; it selects the pool under _out/debs/ that is indexed" >&2
    exit 1
    ;;
esac

command -v docker >/dev/null 2>&1 || {
    echo "error: docker is required and not on PATH. dpkg-scanpackages and dpkg-deb run inside localhost/mos-build-deb rather than on the host, which is what keeps the host free of a Debian toolchain" >&2
    exit 1
}

DIST="${REPO_ROOT}/_out/debs/${ARCH}"
POOL="${DIST}/pool"
[ -d "${POOL}" ] || {
    echo "error: ${POOL} does not exist, so there is nothing to index. A package producer writes it; this only reads it" >&2
    exit 1
}
# An empty pool is a hard failure and not an empty Packages file. APT accepts an
# empty index without complaint, so the composer would resolve nothing, install
# nothing and report success.
mapfile -t DEBS < <(find "${POOL}" -maxdepth 1 -type f -name '*.deb' -printf '%f\n' | LC_ALL=C sort)
[ "${#DEBS[@]}" -gt 0 ] || {
    echo "error: ${POOL} holds no .deb, so this would write an index over nothing. APT takes an empty Packages file without complaint, which makes a build that installs none of its own packages look green" >&2
    exit 1
}

# The image, out of images.env, refused by name if it is missing -- docker
# reports an absent localhost/ tag as a failed pull from a registry called
# `localhost`, which names neither the image nor `make build-env`.
#
# The HOST architecture's image, not --arch's, and that is a decision. Reading
# control fields and hashing bytes is architecture-neutral work: dpkg-deb
# --field and dpkg-scanpackages parse the archives, they do not execute them. It
# is also the only thing that works, because this host has no binfmt
# registration -- `docker run` on a foreign-architecture image dies with `exec
# format error` before dpkg-scanpackages is reached, which would leave the arm64
# pool unindexable on the machine that just produced it. --arch selects the
# POOL, and the pool's architecture is asserted below out of the archives
# themselves.
case "$(uname -m)" in
x86_64) IMAGE_ARCH=amd64 ;;
aarch64 | arm64) IMAGE_ARCH=arm64 ;;
*)
    echo "error: $(uname -m) is not an architecture build-env/images.env builds a mos-build-deb for, so there is no container to run dpkg-scanpackages in" >&2
    exit 1
    ;;
esac
mapfile -t FROM_ARGS < <(bash "${FROM_SH}" --arch="${IMAGE_ARCH}" MOS_BUILD_DEB=LOCAL_MOS_BUILD_DEB)
[ "${#FROM_ARGS[@]}" -eq 2 ] || {
    echo "error: build-env/from.sh did not yield localhost/mos-build-deb:${IMAGE_ARCH} (see its message above); it is built by \`make build-env\`" >&2
    exit 1
}
IMAGE="${FROM_ARGS[1]#MOS_BUILD_DEB=}"

# _out/debs/<arch> is mounted and nothing above it: this writes three files
# beside the pool and has no business seeing the rest of the tree.
# mos-build-side: container-block -- the index is written by the dpkg inside
# localhost/mos-build-deb, which records its own version in /etc/mos-build/deb.env
# and is read back by the block below
docker run --rm \
    --label ai-agent=true \
    -v "${DIST}:/dist" \
    -w /dist \
    -e "MOS_DEB_ARCH=${ARCH}" \
    --entrypoint /bin/bash \
    "${IMAGE}" -c '
        set -euo pipefail
        [ -f /etc/mos-build/deb.env ] || {
            echo "error: this image carries no /etc/mos-build/deb.env, so what indexed this repository cannot be read back out of it" >&2
            exit 1
        }
        . /etc/mos-build/deb.env
        echo "repo.sh: indexing ${MOS_DEB_ARCH} with dpkg ${MOS_BUILD_DPKG} from ${MOS_BUILD_IMAGE}"

        # Sorted by package name, and by nothing the filesystem decided:
        # dpkg-scanpackages walks readdir order, which differs between two
        # checkouts of the same tree.
        mapfile -t debs < <(cd pool && find . -maxdepth 1 -type f -name "*.deb" -printf "%f\n" | LC_ALL=C sort)

        # The architecture each archive DECLARES, checked against the pool it is
        # sitting in. A cross-packed archive is well formed and installs nowhere;
        # nothing else in this repository would notice it.
        for d in "${debs[@]}"; do
            a="$(dpkg-deb --field "pool/${d}" Architecture)"
            case "${a}" in
            "${MOS_DEB_ARCH}" | all) ;;
            *)
                echo "error: pool/${d} declares Architecture: ${a}, but it is in the ${MOS_DEB_ARCH} pool. It was packed in the wrong container, or filed under the wrong architecture" >&2
                exit 1
                ;;
            esac
        done

        # Packages, generated from the archives and from nothing else. The paths
        # it records are pool-relative, which is what lets the composer add
        # `deb [trusted=yes] file:/dist ./` and have APT find them.
        dpkg-scanpackages --multiversion pool >Packages.new
        [ -s Packages.new ] || {
            echo "error: dpkg-scanpackages produced an empty Packages over ${#debs[@]} archive(s)" >&2
            exit 1
        }
        mv Packages.new Packages

        # Pool-relative paths, so `sha256sum -c SHA256SUMS` works from the
        # directory the file sits in.
        (printf "pool/%s\n" "${debs[@]}" | xargs -r sha256sum) >SHA256SUMS

        {
            echo "# The local package pool for ${MOS_DEB_ARCH}, read out of the archives by build-env/deb/repo.sh."
            echo "# Regenerated whenever the pool changes; never edited by hand."
            printf "#package\tversion\tarchitecture\tinstalled-size\tsha256\tfile\n"
            for d in "${debs[@]}"; do
                printf "%s\t%s\t%s\t%s\t%s\t%s\n" \
                    "$(dpkg-deb --field "pool/${d}" Package)" \
                    "$(dpkg-deb --field "pool/${d}" Version)" \
                    "$(dpkg-deb --field "pool/${d}" Architecture)" \
                    "$(dpkg-deb --field "pool/${d}" Installed-Size)" \
                    "$(sha256sum "pool/${d}" | cut -d" " -f1)" \
                    "pool/${d}"
            done
        } >manifest.txt

        echo "repo.sh: ${#debs[@]} package(s), $(grep -c "^Package: " Packages) stanza(s) in Packages"
    '
# mos-build-side: host

echo "repo.sh: ${DIST}"
sed 's/^/  /' "${DIST}/manifest.txt"
