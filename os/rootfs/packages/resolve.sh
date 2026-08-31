#!/usr/bin/env bash
# The package-set resolver: WHAT a build installs, from the build's inputs and
# the manifests beside this file.
#
#   bash os/rootfs/packages/resolve.sh --board cx3576 --profile dev \
#        --radios "wifi bluetooth" --without ""
#   -> mos-apid
#      mos-board-cx3576
#      mos-bluetooth
#      ...
#
# One package name per line on stdout, LC_ALL=C sorted and deduplicated, and
# nothing else: two runs over one set of inputs are byte-identical, so a diff of
# two resolutions is a diff of the images they compose. Every refusal goes to
# stderr and exits non-zero.
#
# The manifests are read from THIS directory. The producer set is read at run
# time from `bash os/build-env/deb/producers.sh` -- the only authority on which
# packages exist -- in the repository this directory sits in, located by walking
# up to the Makefile rather than by counting `..` levels. That is what lets a
# COPY of this directory anywhere under the repository resolve against the same
# producers, which is how os/tests/rootfs-manifest-test.sh proves its negative
# tests red: it perturbs a copy of the manifests instead of the tracked ones.
#
# The manifest format is documented in os/rootfs/packages/README.md.
set -euo pipefail

# Sorting, globbing and the byte order of the output all have to agree with the
# one the composer and every diff of two resolutions will see.
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${HERE}"
while [ "${REPO_ROOT}" != "/" ] && [ ! -f "${REPO_ROOT}/Makefile" ]; do
    REPO_ROOT="$(dirname "${REPO_ROOT}")"
done
[ -f "${REPO_ROOT}/Makefile" ] || {
    echo "error: no Makefile was found in any directory above ${HERE}, so this is not a copy of os/rootfs/packages inside the mos repository. The repository root is where \`bash os/build-env/deb/producers.sh\` -- the list of packages a manifest may name -- is read from" >&2
    exit 1
}

usage() {
    echo "usage: bash os/rootfs/packages/resolve.sh --board <board> --profile <profile> --radios \"<radios>\" --without \"<features>\"" >&2
}

# EVERY INPUT IS AN ARGUMENT, AND NONE OF THEM IS RE-DERIVED HERE. This script
# does not read os/boards/<board>/board.env, os/boards/<board>/bsp/containers.env
# or WITH_MOSD/WITH_CONTAINERS/MOS_ROOTFS_WITHOUT/MOS_PROFILE out of the
# environment, and it must not learn to: os/rootfs/build-v2.sh already owns
# every one of those decisions -- which board file is read, which environment
# variable beats which file, how the historical WITH_* spellings fold into the
# decline list. A second copy of that logic here is the second table this
# repository keeps deleting, and the two would disagree about a build the day
# either changed. The driver owns the DECISIONS; this script owns the MANIFEST
# SET and nothing else.
#
# All four are required even when empty, and --radios "" and --without "" are
# how a caller says "none". Making them optional would mean a driver that forgot
# to pass --radios silently produced an image with no radio userland on a board
# that has a radio -- a build that succeeds and a device that cannot see a
# network.
BOARD=""
PROFILE=""
RADIOS=""
WITHOUT=""
HAVE_BOARD=0
HAVE_PROFILE=0
HAVE_RADIOS=0
HAVE_WITHOUT=0
while [ "$#" -gt 0 ]; do
    case "$1" in
    --board)
        BOARD="${2-}"
        HAVE_BOARD=1
        shift 2
        ;;
    --profile)
        PROFILE="${2-}"
        HAVE_PROFILE=1
        shift 2
        ;;
    --radios)
        RADIOS="${2-}"
        HAVE_RADIOS=1
        shift 2
        ;;
    --without)
        WITHOUT="${2-}"
        HAVE_WITHOUT=1
        shift 2
        ;;
    *)
        echo "error: unknown argument '$1'" >&2
        usage
        exit 1
        ;;
    esac
done
for pair in "board:${HAVE_BOARD}" "profile:${HAVE_PROFILE}" "radios:${HAVE_RADIOS}" "without:${HAVE_WITHOUT}"; do
    [ "${pair#*:}" = "1" ] || {
        echo "error: --${pair%%:*} was not given. All four arguments are required; --radios \"\" and --without \"\" are how a build with no radio and no declined feature says so, because an omitted one would resolve to a package set nothing had decided" >&2
        usage
        exit 1
    }
done

# The manifests, discovered rather than listed: a manifest added to this
# directory is in the resolution the day it lands, and one this script had to be
# taught about would be one it could silently omit.
shopt -s nullglob
MANIFEST_FILES=("${HERE}"/*.pkgs)
shopt -u nullglob
[ "${#MANIFEST_FILES[@]}" -gt 0 ] || {
    echo "error: ${HERE} holds no *.pkgs manifest at all. Every resolution would then be empty, and a resolver with nothing to resolve reports the empty set rather than reporting this" >&2
    exit 1
}

# The packages that exist, read from the producers rather than restated. A
# manifest naming something no producer emits is a line APT would fail on inside
# the composition, where the message is about an unsatisfiable package rather
# than about the manifest that named it.
#
# CAPTURED before it is read, never piped straight into the loop: a `producer |
# while` reports the reader's status, so a producers.sh that refused its own
# discovery would be swallowed and every manifest line would then be compared
# against the empty set that failure left behind.
declare -A DECLARED=()
DECLARED_N=0
PRODUCER_ROWS="$(bash "${REPO_ROOT}/os/build-env/deb/producers.sh")"
while read -r _producer _dir _arches packages _enablement; do
    for pkg in ${packages//,/ }; do
        [ -n "${DECLARED[${pkg}]:-}" ] || DECLARED_N=$((DECLARED_N + 1))
        DECLARED["${pkg}"]=1
    done
done <<<"${PRODUCER_ROWS}"
[ "${DECLARED_N}" -gt 0 ] || {
    echo "error: bash os/build-env/deb/producers.sh named no package. The cross-check below would then accept every manifest line, having compared each against an empty set" >&2
    exit 1
}

# Every manifest in the directory is parsed and cross-checked on EVERY run, not
# just the handful this resolution reads. A typo in the manifest of the other
# board is a typo that fails one board's build and not the other's, and the run
# that would have caught it is the run nobody makes.
declare -A MANIFEST=()
BOARDS=()
PROFILES=()
KNOWN_RADIOS=()
FEATURES=()
for file in "${MANIFEST_FILES[@]}"; do
    base="$(basename "${file}" .pkgs)"
    names=""
    lineno=0
    while IFS= read -r line || [ -n "${line}" ]; do
        lineno=$((lineno + 1))
        line="${line%%#*}"
        # shellcheck disable=SC2086 # deliberate: the split is how a line
        # carrying more than one name is detected.
        set -- ${line}
        [ "$#" -gt 0 ] || continue
        [ "$#" -eq 1 ] || {
            echo "error: ${file}:${lineno} names $# packages on one line. A manifest holds ONE package name per line, so that a line can be added, removed or blamed on its own; see os/rootfs/packages/README.md" >&2
            exit 1
        }
        [ -n "${DECLARED[$1]:-}" ] || {
            echo "error: ${file}:${lineno} names the package '$1', which NO producer in this repository declares. A manifest may only name a package some producer's PACKAGES field emits; \`bash os/build-env/deb/producers.sh\` lists every one of them, and the packages that exist are: $(printf '%s\n' "${!DECLARED[@]}" | sort | tr '\n' ' ')" >&2
            exit 1
        }
        names="${names}$1 "
    done <"${file}"
    MANIFEST["${base}"]="${names}"

    # The family is the filename's prefix, and an unrecognised one is refused
    # rather than ignored: a manifest nothing selects is a package set that
    # never reaches an image and never fails a build either.
    case "${base}" in
    common) ;;
    board-*) BOARDS+=("${base#board-}") ;;
    profile-*) PROFILES+=("${base#profile-}") ;;
    radio-*) KNOWN_RADIOS+=("${base#radio-}") ;;
    feature-*) FEATURES+=("${base#feature-}") ;;
    *)
        echo "error: ${file} belongs to no manifest family. A manifest is named common.pkgs, board-<board>.pkgs, profile-<profile>.pkgs, radio-<radio>.pkgs or feature-<feature>.pkgs; nothing selects any other name, so this file would never be read into a resolution" >&2
        exit 1
        ;;
    esac
done

# `radios` is a feature and has no feature-radios.pkgs, because the radio
# packages are per-radio and --radios selects them: the feature is the switch
# that decides whether the radio family is consulted at all, which is what
# MOS_ROOTFS_WITHOUT=radios means to os/rootfs/build-v2.sh (it drops
# stages/30-feature-radios whatever the board declares). An empty
# feature-radios.pkgs carrying only that sentence would still leave this case
# in the code below, so it is stated once, here.
FEATURES+=("radios")
mapfile -t FEATURES < <(printf '%s\n' "${FEATURES[@]}" | sort -u)

in_list() {
    local needle="$1"
    shift
    local item
    for item in "$@"; do [ "${item}" != "${needle}" ] || return 0; done
    return 1
}

for feature in ${WITHOUT}; do
    in_list "${feature}" ${FEATURES[@]+"${FEATURES[@]}"} || {
        echo "error: --without names the feature '${feature}', which this repository has no such thing as. The features that exist are: ${FEATURES[*]}. They come from the feature-<name>.pkgs manifests in ${HERE}, plus 'radios', which gates the radio-<name>.pkgs family" >&2
        exit 1
    }
done
# The same spelling os/rootfs/build-v2.sh uses, so "is this feature in the
# image" reads identically on both sides of the argument list.
WITHOUT_FEATURES=" ${WITHOUT} "
declined() { case "${WITHOUT_FEATURES}" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

in_list "${BOARD}" ${BOARDS[@]+"${BOARDS[@]}"} || {
    echo "error: --board is '${BOARD}', for which ${HERE} holds no board-${BOARD}.pkgs. The boards with a manifest are: ${BOARDS[*]-none}" >&2
    exit 1
}
in_list "${PROFILE}" ${PROFILES[@]+"${PROFILES[@]}"} || {
    echo "error: --profile is '${PROFILE}', for which ${HERE} holds no profile-${PROFILE}.pkgs. The profiles with a manifest are: ${PROFILES[*]-none}" >&2
    exit 1
}
# Radio names are checked even when `radios` is declined. A board declaring a
# radio this repository has never heard of is a broken board file, and a build
# that happens to decline radios is not the place for that to become invisible;
# os/rootfs/scripts/radios-packages.sh refuses the same unknown name today.
for radio in ${RADIOS}; do
    in_list "${radio}" ${KNOWN_RADIOS[@]+"${KNOWN_RADIOS[@]}"} || {
        echo "error: --radios names '${radio}', for which ${HERE} holds no radio-${radio}.pkgs. The radios with a manifest are: ${KNOWN_RADIOS[*]-none}" >&2
        exit 1
    }
done

RESOLVED="${MANIFEST[common]:-}"
RESOLVED="${RESOLVED}${MANIFEST[profile-${PROFILE}]:-}"
RESOLVED="${RESOLVED}${MANIFEST[board-${BOARD}]:-}"
if ! declined radios; then
    for radio in ${RADIOS}; do
        RESOLVED="${RESOLVED}${MANIFEST[radio-${radio}]:-}"
    done
fi
for feature in "${FEATURES[@]}"; do
    [ "${feature}" != "radios" ] || continue
    declined "${feature}" || RESOLVED="${RESOLVED}${MANIFEST[feature-${feature}]:-}"
done

# An empty resolution composes a root holding nothing but Debian, and every
# check downstream of it is a check over an image with no mos in it.
RESOLVED_N=0
for pkg in ${RESOLVED}; do RESOLVED_N=$((RESOLVED_N + 1)); done
[ "${RESOLVED_N}" -gt 0 ] || {
    echo "error: the resolution for --board ${BOARD} --profile ${PROFILE} is EMPTY. Every manifest it reads named nothing, so the composer would install no mos package at all and every check over the result would run against a plain Debian root" >&2
    exit 1
}

# EXACTLY ONE profile package, counted over the resolved set rather than assumed
# from the fact that --profile picked one manifest: any manifest may name one,
# and mos-profile-dev arriving alongside mos-profile-prod is an APT conflict
# while NEITHER arriving is an image mosd reads as production with every check
# green. The two names come from the profile-* manifests themselves; a literal
# pair here would be a second list to keep in step with them.
PROFILE_PACKAGES=""
for name in ${PROFILES[@]+"${PROFILES[@]}"}; do
    PROFILE_PACKAGES="${PROFILE_PACKAGES}${MANIFEST[profile-${name}]:-}"
done
PROFILE_IN_SET=""
PROFILE_IN_SET_N=0
for pkg in ${RESOLVED}; do
    in_list "${pkg}" ${PROFILE_PACKAGES} || continue
    case " ${PROFILE_IN_SET} " in *" ${pkg} "*) continue ;; esac
    PROFILE_IN_SET="${PROFILE_IN_SET}${pkg} "
    PROFILE_IN_SET_N=$((PROFILE_IN_SET_N + 1))
done
[ "${PROFILE_IN_SET_N}" -eq 1 ] || {
    if [ "${PROFILE_IN_SET_N}" -eq 0 ]; then
        echo "error: the resolution for --board ${BOARD} --profile ${PROFILE} carries NO profile package. mosd fails closed to prod when /usr/lib/mos/profile.conf is absent, so this image would behave as production -- SSH off on a dev build -- with nothing anywhere reporting a defect. One of ${PROFILE_PACKAGES% } has to be in the set" >&2
    else
        echo "error: the resolution for --board ${BOARD} --profile ${PROFILE} carries ${PROFILE_IN_SET_N} profile packages: ${PROFILE_IN_SET% }. They Conflict by name and are alternative renderings of one immutable file, so APT would refuse the transaction; exactly one belongs in an image" >&2
    fi
    exit 1
}

# A resolution with no board package has no kernel, no device tree and no
# rendered layout: it composes a root that cannot boot on anything.
BOARD_PACKAGES=""
for name in ${BOARDS[@]+"${BOARDS[@]}"}; do
    BOARD_PACKAGES="${BOARD_PACKAGES}${MANIFEST[board-${name}]:-}"
done
BOARD_IN_SET_N=0
for pkg in ${RESOLVED}; do
    in_list "${pkg}" ${BOARD_PACKAGES} && BOARD_IN_SET_N=$((BOARD_IN_SET_N + 1))
done
[ "${BOARD_IN_SET_N}" -gt 0 ] || {
    echo "error: the resolution for --board ${BOARD} --profile ${PROFILE} carries NO board package. board-${BOARD}.pkgs named none, so the image would have no kernel, no device tree and none of the layout files rendered from os/boards/${BOARD}/board.env -- an artifact that composes and cannot boot" >&2
    exit 1
}

printf '%s\n' ${RESOLVED} | sort -u
