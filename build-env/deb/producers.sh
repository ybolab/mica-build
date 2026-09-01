#!/usr/bin/env bash
# Every Debian package producer in this repository, discovered from the tree.
#
#   bash build-env/deb/producers.sh
#   -> mosd pkgs/mosd/deb/mosd amd64,arm64 mosd,mos-apid mosd=1,mos-apid=1
#      mqtt pkgs/mosd/deb/mqtt amd64,arm64 mos-mqttd,mos-mqtt-broker mos-mqttd=0,mos-mqtt-broker=0
#
#   bash build-env/deb/producers.sh --dir-for <producer>
#   -> pkgs/mosd/deb/mosd
#
# Five space-separated fields, sorted by producer name:
#
#   <producer>    the producer directory's basename, and what `make os-deb-<x>`
#                 selects on
#   <dir>         the producer directory, repository-relative
#   <arches>      comma-separated, from ARCHES
#   <packages>    comma-separated, from PACKAGES
#   <enablement>  comma-separated <package>=<count>, from ENABLEMENT, or `-`
#
# THE MARKER IS THE PAIR `Dockerfile` + `producer.env`, and it is looked for
# ANYWHERE in the tree. Not under pkgs/ -- producers live under
# rootfs/packages-src/ and boards/<board>/deb/ as well, and a glob rooted
# at one of those directories is a glob that silently omits the others. A
# Dockerfile alone is not the marker: this tree has a dozen of those and none of
# the others is a package producer. producer.env is what declares intent, and a
# directory that has it without a Dockerfile is refused by name as half a
# producer.
#
# THIS IS THE ONLY PLACE THE LAYOUT IS WRITTEN DOWN. The Makefile's `os-debs`
# and `os-deb-%`, build-env/deb/build.sh and tests/deb-package-gate.sh all
# read this script; none of them searches for itself. A second implementation of
# the search would let `make os-debs` and the gate disagree about what exists,
# and the one that had not been taught about a producer would report green over
# it.
#
# The convention is documented in build-env/deb/README.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
[ -e "${REPO_ROOT}/Makefile" ] || {
    echo "error: ${REPO_ROOT}/Makefile does not exist. build-env/deb/producers.sh derives the repository as two levels above itself; if this file moved, that arithmetic moved with it" >&2
    exit 1
}

DIR_FOR=""
while [ "$#" -gt 0 ]; do
    case "$1" in
    --dir-for)
        DIR_FOR="${2-}"
        [ -n "${DIR_FOR}" ] || { echo "error: --dir-for takes a producer name" >&2; exit 1; }
        shift 2
        ;;
    *)
        echo "usage: bash build-env/deb/producers.sh [--dir-for <producer>]" >&2
        exit 1
        ;;
    esac
done

# _out and tmp are build outputs, and a producer.env copied into either by a
# staging step is not a producer -- it is the same producer seen twice, which
# would collide on the name check below. .git holds no source at all.
mapfile -t ENVS < <(
    find "${REPO_ROOT}" \
        \( -path "${REPO_ROOT}/.git" -o -path "${REPO_ROOT}/_out" -o -path "${REPO_ROOT}/tmp" -o -name node_modules \) -prune -o \
        -type f -name producer.env -print | LC_ALL=C sort
)

ROWS=()
declare -A SEEN=()
for env_file in ${ENVS[@]+"${ENVS[@]}"}; do
    dir="$(dirname "${env_file}")"
    rel="${dir#"${REPO_ROOT}"/}"
    producer="$(basename "${dir}")"

    # The other half of the marker. A producer.env with no Dockerfile beside it
    # is a directory that declares packages nothing can build; discovery names
    # it, so `make os-debs` would reach it and fail somewhere less obvious.
    [ -f "${dir}/Dockerfile" ] || {
        echo "error: ${rel}/producer.env has no Dockerfile beside it. A producer is the PAIR: producer.env declares what it emits and the Dockerfile stages and packs it. This directory has only the declaration" >&2
        exit 1
    }

    # The output is read with `read -r producer dir arches packages enablement`,
    # so a name carrying whitespace would split into the wrong fields and route
    # a build at some other producer.
    case "${producer}" in
    *[[:space:]]*)
        echo "error: the producer directory ${rel} has a name containing whitespace. build-env/deb/producers.sh emits space-separated fields and every reader splits on that, so such a name would be read as a different producer entirely" >&2
        exit 1
        ;;
    esac
    # The name is the directory's basename and it selects a build, so two
    # producers cannot share one: `make os-deb-<name>` would have no way to say
    # which was meant, and both would write into the same pool.
    [ -z "${SEEN[${producer}]:-}" ] || {
        echo "error: two producer directories are both named '${producer}': ${SEEN[${producer}]} and ${rel}. The basename is the producer's identity -- it is what \`make os-deb-${producer}\` selects on -- so one of them has to be renamed" >&2
        exit 1
    }
    SEEN["${producer}"]="${rel}"

    # producer.env is plain KEY=value in the boards/*/board.env discipline,
    # so it is sourced. In a subshell: a producer must not be able to change
    # what discovery does with the producers after it.
    vals="$(
        # shellcheck disable=SC1090
        . "${env_file}"
        printf 'A=%s\nP=%s\nE=%s\n' "${ARCHES-}" "${PACKAGES-}" "${ENABLEMENT-}"
    )"
    arches="$(printf '%s\n' "${vals}" | sed -n 's/^A=//p')"
    packages="$(printf '%s\n' "${vals}" | sed -n 's/^P=//p')"
    enablement="$(printf '%s\n' "${vals}" | sed -n 's/^E=//p')"

    # PACKAGES and ARCHES are what BUILDING needs, so they are refused here.
    # ENABLEMENT is an assertion input and means nothing to a build; it is
    # carried through and tests/deb-package-gate.sh is what refuses a
    # producer that does not declare one.
    [ -n "${packages// /}" ] || {
        echo "error: ${rel}/producer.env declares no PACKAGES. That is the list of Debian packages this producer emits, and everything downstream is derived from it: an empty one builds nothing, clears nothing out of the pool and contributes nothing to any expectation -- which reports green rather than reporting this" >&2
        exit 1
    }
    [ -n "${arches// /}" ] || {
        echo "error: ${rel}/producer.env declares no ARCHES. That is the list of architectures this producer builds: amd64, arm64, or 'all' for an architecture-independent package" >&2
        exit 1
    }
    for a in ${arches}; do
        case "${a}" in
        amd64 | arm64 | all) ;;
        *)
            echo "error: ${rel}/producer.env declares ARCHES entry '${a}'. The only values are amd64, arm64 and all; amd64 and arm64 are what build-env/images.env pins a mos-build-deb for, and 'all' is an architecture-independent package that is a valid member of every pool" >&2
            exit 1
            ;;
        esac
    done
    case " ${arches} " in
    *" all "*)
        [ "$(printf '%s\n' ${arches} | wc -l)" -eq 1 ] || {
            echo "error: ${rel}/producer.env declares ARCHES='${arches}', mixing 'all' with a specific architecture. An 'all' package is already a member of every pool, so the pair says both that this producer is architecture-independent and that it is not" >&2
            exit 1
        }
        ;;
    esac

    ROWS+=("${producer} ${rel} $(printf '%s' "${arches}" | tr -s ' ' ',') $(printf '%s' "${packages}" | tr -s ' ' ',') $(if [ -n "${enablement// /}" ]; then printf '%s' "${enablement}" | tr -s ' ' ','; else printf '%s' -; fi)")
done

# An empty discovery is a hard failure, the way build-env/deb/repo.sh refuses
# an empty pool. `make os-debs` over no producers builds nothing and reports
# success, and the gate over no producers checks nothing and reports success --
# both green, both having done nothing at all.
[ "${#ROWS[@]}" -gt 0 ] || {
    echo "error: no package producer was found anywhere under ${REPO_ROOT}. Every caller of this script would then have an empty set to work over: \`make os-debs\` would build nothing and tests/deb-package-gate.sh would assert nothing, and both would report success. A producer is a directory holding BOTH a Dockerfile and a producer.env; see build-env/deb/README.md" >&2
    exit 1
}

mapfile -t ROWS < <(printf '%s\n' "${ROWS[@]}" | LC_ALL=C sort)

if [ -n "${DIR_FOR}" ]; then
    # Resolved here rather than by the caller, so the Makefile's pattern rule,
    # the generic driver and any other reader refuse an unknown name with one
    # message and one idea of what a producer is.
    for row in "${ROWS[@]}"; do
        read -r producer dir _rest <<<"${row}"
        [ "${producer}" = "${DIR_FOR}" ] || continue
        echo "${dir}"
        exit 0
    done
    echo "error: '${DIR_FOR}' is not a producer this repository defines. Discovered: $(printf '%s\n' "${ROWS[@]}" | cut -d' ' -f1 | tr '\n' ' ')-- a producer is a directory holding both a Dockerfile and a producer.env, and its NAME is that directory's basename; see build-env/deb/README.md" >&2
    exit 1
fi

printf '%s\n' "${ROWS[@]}"
