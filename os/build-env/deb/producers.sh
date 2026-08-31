#!/usr/bin/env bash
# Every Debian package producer in this repository, discovered from the tree.
#
#   bash os/build-env/deb/producers.sh
#   -> mosd mosd os/pkgs/mosd/hack/build-deb.sh
#      mosd mqtt os/pkgs/mosd/hack/build-deb.sh
#
#   bash os/build-env/deb/producers.sh --driver-for <producer>
#   -> os/pkgs/mosd/hack/build-deb.sh
#
# Three fields, space separated, sorted: <component> <producer> <driver>. The
# driver is repository-relative, because both callers run from the repository
# root.
#
# THIS IS THE ONLY PLACE THE LAYOUT IS WRITTEN DOWN. The Makefile's `os-debs`
# and `os-deb-%` and os/tests/deb-package-gate.sh all read this script; none of
# them globs for itself. A producer is added by creating its directory, and a
# second implementation of the glob is what would make that stop being true --
# `make os-debs` and the gate would then disagree about what exists, and the
# one that had not been taught about a producer would report green over it.
#
# The convention is documented in os/build-env/deb/README.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
PKGS="${REPO_ROOT}/os/pkgs"
for p in "${REPO_ROOT}/Makefile" "${PKGS}"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. os/build-env/deb/producers.sh derives the repository as three levels above itself; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done

DRIVER_FOR=""
while [ "$#" -gt 0 ]; do
    case "$1" in
    --driver-for)
        DRIVER_FOR="${2-}"
        [ -n "${DRIVER_FOR}" ] || { echo "error: --driver-for takes a producer name" >&2; exit 1; }
        shift 2
        ;;
    *)
        echo "usage: bash os/build-env/deb/producers.sh [--driver-for <producer>]" >&2
        exit 1
        ;;
    esac
done

# Producer DIRECTORIES, not control templates. Discovering by
# os/pkgs/*/deb/*/control/*.control alone would make a producer directory that
# holds no control template invisible -- not refused, invisible: it would
# contribute nothing to the expected package set, build nothing, and every
# check downstream would pass without ever having heard of it. The directory is
# the declaration; a missing control/ is an incomplete producer and is refused
# by name below.
mapfile -t DIRS < <(find "${PKGS}" -mindepth 3 -maxdepth 3 -type d -path "${PKGS}/*/deb/*" | LC_ALL=C sort)

ROWS=()
for d in "${DIRS[@]}"; do
    rel="${d#"${PKGS}"/}"
    component="${rel%%/*}"
    producer="${rel##*/}"

    # The output is read with `read -r component producer driver`, so a name
    # carrying whitespace would silently split into the wrong fields and route
    # a build at some other producer.
    case "${component}${producer}" in
    *[[:space:]]*)
        echo "error: the producer directory ${d} has a component or producer name containing whitespace. os/build-env/deb/producers.sh emits space-separated fields and every reader splits on that, so such a name would be read as a different producer entirely" >&2
        exit 1
        ;;
    esac

    mapfile -t controls < <(find "${d}/control" -mindepth 1 -maxdepth 1 -type f -name '*.control' 2>/dev/null | LC_ALL=C sort)
    [ "${#controls[@]}" -gt 0 ] || {
        echo "error: ${d} is a producer directory holding no control/*.control, so it declares no package. It would build nothing, contribute nothing to the pool and be absent from every expectation derived from the tree -- which reports green rather than reporting this. Add control/<package>.control per package it emits; see os/build-env/deb/README.md" >&2
        exit 1
    }

    driver="os/pkgs/${component}/hack/build-deb.sh"
    [ -f "${REPO_ROOT}/${driver}" ] || {
        echo "error: the producer ${component}/${producer} has no build driver at ${driver}. Discovery names it, so \`make os-debs\` and \`make os-deb-${producer}\` would both try to run it; the driver and the producer directory are two halves of one producer and this one has only its half" >&2
        exit 1
    }

    ROWS+=("${component} ${producer} ${driver}")
done

# An empty discovery is a hard failure, the way os/build-env/deb/repo.sh refuses
# an empty pool. `make os-debs` over no producers builds nothing and reports
# success, and the gate over no producers checks nothing and reports success --
# both green, both having done nothing at all.
[ "${#ROWS[@]}" -gt 0 ] || {
    echo "error: no package producer was found under ${PKGS}/*/deb/*/. Every caller of this script would then have an empty set to work over: \`make os-debs\` would build nothing and os/tests/deb-package-gate.sh would assert nothing, and both would report success. A producer is a directory os/pkgs/<component>/deb/<producer>/ holding control/<package>.control; see os/build-env/deb/README.md" >&2
    exit 1
}

if [ -n "${DRIVER_FOR}" ]; then
    # Resolved here rather than by the caller, so the Makefile's pattern rule
    # and any other reader refuse an unknown name with one message. Ambiguity
    # is refused too: two components may each hold a producer of one name, and
    # `make os-deb-<that name>` cannot say which was meant.
    matches=()
    for row in "${ROWS[@]}"; do
        read -r component producer driver <<<"${row}"
        [ "${producer}" = "${DRIVER_FOR}" ] || continue
        matches+=("${component} ${driver}")
    done
    case "${#matches[@]}" in
    1)
        read -r _component driver <<<"${matches[0]}"
        echo "${driver}"
        ;;
    0)
        echo "error: '${DRIVER_FOR}' is not a producer this repository defines. Discovered: $(printf '%s\n' "${ROWS[@]}" | cut -d' ' -f2 | LC_ALL=C sort -u | tr '\n' ' ')-- a producer is a directory os/pkgs/<component>/deb/${DRIVER_FOR}/ holding control/<package>.control and a driver at os/pkgs/<component>/hack/build-deb.sh; see os/build-env/deb/README.md" >&2
        exit 1
        ;;
    *)
        echo "error: '${DRIVER_FOR}' names $(printf '%s\n' "${matches[@]}" | cut -d' ' -f1 | tr '\n' ' ')producers in different components, so there is no single driver to run for it. Rename one of them; the producer name is what \`make os-deb-<producer>\` selects on" >&2
        exit 1
        ;;
    esac
    exit 0
fi

printf '%s\n' "${ROWS[@]}"
