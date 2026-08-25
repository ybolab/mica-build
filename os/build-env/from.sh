#!/usr/bin/env bash
# Turn os/build-env/images.env keys into the --build-arg lines that carry a
# `FROM` into a Dockerfile, and refuse everything that must not reach one.
#
#   bash os/build-env/from.sh MOS_IMAGE_UBUNTU_2404=IMAGE_UBUNTU_2404
#       -> --build-arg
#          MOS_IMAGE_UBUNTU_2404=ubuntu:24.04@sha256:33ceb719...
#
#   bash os/build-env/from.sh --check     validate every IMAGE_ key, print
#                                         nothing, exit 0 or 1
#
# PLAN-014 M2 (RFCT-108), the M2c half: every Dockerfile in this tree takes its
# base image as a build argument, and this is the only thing that produces one.
#
# WHY A SCRIPT AND NOT `$(grep ... images.env)` AT EACH CALL SITE. There are
# eight call sites -- os/podman/build.sh, os/update/rauc/build.sh,
# os/rootfs/build-v2.sh, os/tests/handshake-test/run.sh,
# mosd/hack/build-target.sh and four board/cx3576 make recipes -- and the check
# that a value is a digest and not a tag is the entire point of the exercise. A
# grep at each call site is eight copies of that check, of which seven
# eventually stop being it. os/build-env/build.sh calls this too, with --check,
# rather than keeping the second copy it started with.
#
# WHY THE ARGUMENT NAME IS WRITTEN OUT AT EACH CALL SITE rather than derived
# from the key. Deriving it would make the Dockerfile's ARG name a consequence
# of a naming rule in this file, and a reader of the Dockerfile would have to
# come here to learn what feeds it. `MOS_IMAGE_UBUNTU_2404=IMAGE_UBUNTU_2404` is
# the whole wiring, on one line, at the place that does the wiring.
#
# WHAT IT DOES NOT DO: build anything, or pull anything. It reads a file and
# asks the local image store one question. A caller that gets output from this
# has a value it can put after `FROM`; a caller that gets a non-zero exit has a
# reason.
set -euo pipefail

# Path arithmetic, proved rather than assumed -- os/build-env/build.sh derives
# REPO_ROOT the same way and for the same reason (os-bundle-cx3576 spent two
# merges broken on a relative path that resolved against the caller's cwd).
# This one is called from board/cx3576/Makefile, whose cwd is two directories
# further down, so "the caller is at the repository root" is not merely
# something not to depend on: it is false at four of the eight call sites.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
IMAGES_ENV="${HERE}/images.env"

for p in "${REPO_ROOT}/Makefile" "${IMAGES_ENV}"; do
    [ -e "${p}" ] || {
        echo "error: ${p} does not exist. os/build-env/from.sh derives REPO_ROOT as two levels above itself; if this file moved, that arithmetic moved with it" >&2
        exit 1
    }
done

STRIPPED="$(sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' "${IMAGES_ENV}")"
[ -n "${STRIPPED}" ] || {
    echo "error: ${IMAGES_ENV} carries no assignments once comments are stripped, so every FROM below it would be handed an empty string" >&2
    exit 1
}
# shellcheck disable=SC1090
. <(printf '%s\n' "${STRIPPED}")

# The same expression os/build-env/build.sh applied to IMAGE_ keys before this
# file existed, now in one place. A tag is well-formed and resolves and is
# WRONG: it is the silent float this milestone removes, so it is named
# separately from a malformed reference.
check_image_key() {
    local k="$1" v="$2"
    case "${v}" in
    *PENDING*)
        echo "error: ${k}=${v} in os/build-env/images.env is still PENDING, so there is no recorded base image to build on. Run \`make build-env\`: it resolves the tag, prints the digest and fails, which is how a digest gets recorded here" >&2
        return 1
        ;;
    esac
    if [ "${v#*@}" = "${v}" ]; then
        echo "error: ${k}=${v} in os/build-env/images.env names a TAG and not a digest. A tag is repointed by upstream whenever it rebuilds; pin it as name:tag@sha256:<64 hex> (see the HOW TO BUMP A DIGEST note in that file)" >&2
        return 1
    fi
    if ! [[ "${v}" =~ ^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$ ]]; then
        echo "error: ${k}=${v} in os/build-env/images.env is not a well-formed digest pin. Expected name:tag@sha256: followed by exactly 64 lowercase hex digits" >&2
        return 1
    fi
    return 0
}

# A LOCAL_ key names an image this repository builds, so the question is not
# "is it a digest" -- it has none that survives a rebuild, and images.env says
# why -- but "is it here". Left to docker, a missing localhost/mos-build-c is
# reported as a failed pull from a registry called `localhost`, which names
# neither the image that is missing nor the command that makes it. This is also
# the check that keeps `make build-env` a real prerequisite rather than a step
# in a README.
#
# AND WHICH ARCHITECTURE IT IS, when the caller says what it is building for.
# This is the one property a locally-tagged FROM loses relative to an upstream
# reference: `debian:trixie-slim@sha256:...` is a multi-architecture index and
# docker picks the right manifest, while `localhost/mos-build-c` is exactly the
# one architecture `make build-env` last produced. A component build that asks
# for the other one gets "no match for platform in manifest" pointing at a FROM
# line that is correct, which is the same shape of misdirection M2b measured
# when a docker-container builder tried to resolve a localhost tag. Asked here,
# it names the image, the two architectures and the command -- and because it is
# a MEASUREMENT of the image rather than a rule about this host, it starts
# passing on its own the day arm64 builder images exist.
FROM_ARCH=""
check_local_key() {
    local k="$1" v="$2" got
    case "${v}" in
    localhost/*) ;;
    *)
        echo "error: ${k}=${v} in os/build-env/images.env does not start with localhost/, but its LOCAL_ prefix says it is an image this repository builds. One of the two is wrong" >&2
        return 1
        ;;
    esac
    docker image inspect "${v}" >/dev/null 2>&1 || {
        echo "error: ${k}=${v} is not in the local docker image store. It is built by \`make build-env\` (os/build-env/build.sh), which must run before any component build that stands on it -- there is no registry to fall back to and docker would report this as a failed pull from a host called 'localhost'" >&2
        return 1
    }
    [ -n "${FROM_ARCH}" ] || return 0
    got="$(docker image inspect --format '{{.Architecture}}' "${v}" 2>/dev/null || true)"
    [ -n "${got}" ] || {
        echo "error: ${v} is in the local image store but reports no architecture, so nothing can say whether it matches the ${FROM_ARCH} build that is about to stand on it" >&2
        return 1
    }
    [ "${got}" = "${FROM_ARCH}" ] || {
        echo "error: ${k}=${v} is a ${got} image and this build targets ${FROM_ARCH}. A local tag carries exactly one architecture -- unlike the IMAGE_ digests above it, which are multi-architecture indexes -- so \`make build-env\` has to have produced a ${FROM_ARCH} family: MOS_BUILD_PLATFORM=linux/${FROM_ARCH} make build-env. os/build-env/build.sh refuses that today when it is not the host's architecture, and RFCT-108's M2b note records what closing it needs (each image published as content with --output type=oci, consumed as --build-context oci-layout://)" >&2
        return 1
    }
    return 0
}

# --check: every IMAGE_ key in the file, whether or not this run consumes it.
# os/build-env/build.sh calls this before it builds anything, for the reason its
# PENDING scan gives: a pin added for one build and wrong is wrong the day it is
# written, not the day something reads it.
if [ "${1-}" = "--check" ]; then
    [ "$#" -eq 1 ] || { echo "error: --check takes no other arguments" >&2; exit 1; }
    bad=0
    seen=0
    while IFS= read -r k; do
        [ "${k#IMAGE_}" != "${k}" ] || continue
        seen=$((seen + 1))
        check_image_key "${k}" "${!k-}" || bad=1
    done < <(printf '%s\n' "${STRIPPED}" | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p')
    [ "${seen}" -gt 0 ] || {
        echo "error: os/build-env/images.env defines no IMAGE_ key at all, so this check passed by having nothing to check" >&2
        exit 1
    }
    exit "${bad}"
fi

if [ "${1-}" != "${1#--arch=}" ]; then
    FROM_ARCH="${1#--arch=}"
    shift
    [ -n "${FROM_ARCH}" ] || {
        echo "error: --arch= was given with no architecture. Omit the flag entirely to skip the check; an empty one reads like a check that ran" >&2
        exit 1
    }
fi

[ "$#" -gt 0 ] || {
    cat >&2 <<'USAGE'
usage: from.sh [--arch=<amd64|arm64>] <ARG_NAME>=<IMAGES_ENV_KEY> [...]
       from.sh --check

A call with no pairs would print nothing and exit 0, and a caller that
substituted that into a docker command line would build with no --build-arg at
all -- which is precisely the unpinned build this file exists to prevent.
USAGE
    exit 1
}

bad=0
out=()
for pair in "$@"; do
    arg="${pair%%=*}"
    key="${pair#*=}"
    if [ "${arg}" = "${pair}" ] || [ -z "${arg}" ] || [ -z "${key}" ]; then
        echo "error: '${pair}' is not <ARG_NAME>=<IMAGES_ENV_KEY>" >&2
        bad=1
        continue
    fi
    # `${!key-}` is empty for a key that is absent AND for a key that is
    # defined empty, and both are the same failure here: a FROM with nothing
    # after it. docker reports that as "base name should not be blank", which
    # names neither the key nor the file.
    val="${!key-}"
    if [ -z "${val}" ]; then
        echo "error: os/build-env/images.env defines no ${key} (asked for as ${arg}). Every base image in this tree is a key in that file; if this is a new one, add it there rather than writing it into a FROM" >&2
        bad=1
        continue
    fi
    case "${key}" in
    IMAGE_*) check_image_key "${key}" "${val}" || bad=1 ;;
    LOCAL_*) check_local_key "${key}" "${val}" || bad=1 ;;
    *)
        echo "error: ${key} is neither an IMAGE_ nor a LOCAL_ key, so os/build-env/from.sh cannot say what would make it valid. A base image is either an upstream reference pinned by digest (IMAGE_) or one this repository builds (LOCAL_)" >&2
        bad=1
        continue
        ;;
    esac
    out+=(--build-arg "${arg}=${val}")
done
[ "${bad}" = 0 ] || exit 1

printf '%s\n' "${out[@]}"
