#!/usr/bin/env bash
# The single entry point for os/build.
#
#   bash os/build/run.sh                 install if needed, typecheck, then test
#   bash os/build/run.sh --help
#   bash os/build/run.sh src/geometry.test.ts   extra arguments go to `bun test`
#
# WHAT THIS PACKAGE IS. PLAN-014 M6a (RFCT-112): the TypeScript build driver the
# two disk assemblers and the bundle builder move onto, in the shape os/verify
# established in M3 -- bun.lock, package.json, tsconfig.json, run.sh, src/. This
# milestone opens it with the two things every later part needs and nothing
# else: the TYPED GEOMETRY of a board (taken from os/verify's model, not a
# second copy of it) and Bun.$ WRAPPERS for the external toolset. No assembly
# happens here; that is M6b (cx3576), M6c (x64) and M6d (bundle).
#
# WHY THIS IS A SECOND SCRIPT AND NOT os/verify/run.sh PARAMETERISED. The two
# do overlap -- both find a bun, both typecheck, both refuse a suite that
# asserted nothing -- and the campaign's rule about duplication is that two
# copies which must AGREE ABOUT THE SAME INPUT are the thing to remove. That is
# why there is one board parser and not two (verify-package.ts says so at
# length). These two scripts agree about nothing observable: each has to find a
# working bun for its own package, and there is no input on which one of them
# could be right and the other wrong. What they must not duplicate is the PIN --
# which bun -- and they do not: both ask os/build-env/from.sh for IMAGE_BUN_1
# and neither re-validates it.
#
# WHERE THEY GENUINELY DIFFER, and it is not cosmetic. os/verify needs bun and
# nothing else. os/build drives sgdisk, mtools, mkimage, veritysetup, e2fsprogs
# and rauc, and on a host that has none of them (this one has none of the first
# four) the toolbox runs them in a pinned container -- so os/build needs a
# DOCKER CLIENT wherever bun ends up running, including inside the pinned bun
# container itself. That is what the extra mounts below are for, and os/verify
# has no reason to carry any of it.
#
# ZERO TESTS IS A FAILURE, AND BUN DOES NOT AGREE. Measured with bun 1.4.0:
# `bun test` exits 1 when no test FILE matches its glob, but exits 0 when a file
# matches and declares no tests -- "Ran 0 tests across 1 file", green. M3a and
# M3b each shipped a guard against this that was itself unreachable, found only
# by mutating it, so the guard at the bottom of this file was driven the same
# way before it was committed: see HARNESS.md.
set -euo pipefail

# Anchored, not counted -- src/paths.ts states the reasoning for the TypeScript
# side and it is the same here. os/verify is in the list because this package
# imports its board model; a reader whose os/verify moved should be told that
# rather than left with "Cannot find module".
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
for anchor in "${HERE}/package.json" "${HERE}/src/geometry.ts" \
    "${REPO_ROOT}/Makefile" "${REPO_ROOT}/os/boards" \
    "${REPO_ROOT}/os/verify/package.json" "${REPO_ROOT}/os/build-env/from.sh"; do
    [ -e "${anchor}" ] || {
        echo "error: ${anchor} does not exist." >&2
        echo "       This script computed HERE=${HERE} and REPO_ROOT=${REPO_ROOT} from its own location;" >&2
        echo "       either os/build/ moved and that arithmetic is stale, or the anchor did." >&2
        exit 1
    }
done

usage() {
    cat <<'USAGE'
usage: bash os/build/run.sh [--help] [bun-test-args...]
       bash os/build/run.sh --mkimage-v2 [assembler-args...]

Installs the dev dependencies if they are missing, typechecks src/, then runs
the suite. Any extra arguments are passed to `bun test` (a filename filter, for
example). Every step must pass; nothing here skips.

With --mkimage-v2 FIRST, it assembles the cx3576 image instead -- the
TypeScript port of os/mkimage-v2.sh (PLAN-014 M6b). Its remaining arguments are
the assembler's own; try --mkimage-v2 --help.

The suite drives the real external toolset -- sgdisk, mtools, dd, mkimage,
veritysetup, e2fsprogs and rauc. Each of those runs on the host when the host
has it and in the container pinned for that toolset otherwise, which on a host
without them means this suite needs docker. There is no third route and nothing
is skipped: a tool that can be reached neither way is a failure, not a gap.

environment:
  MOS_BUILD_BUN         the bun binary to use, instead of searching PATH and ~/.bun
  MOS_BUILD_CONTAINER=1 use the pinned bun container even where a host bun exists,
                        which is how the two routes are compared on one host
  MOS_BUILD_DOCKER      the docker CLI to use, instead of searching PATH
USAGE
}

# --mkimage-v2 is a MODE, not a filter, so it is recognised only in first
# position -- os/verify/run.sh's rule, for the reason it records: anywhere else
# the flag would be forwarded to `bun test`, which ignores an unknown option,
# runs the whole suite and exits 0. A request to assemble an image would be
# answered by a green suite about something else entirely.
MODE=suite
case "${1:-}" in
--help | -h) usage; exit 0 ;;
--mkimage-v2) MODE=mkimage-v2; shift ;;
esac

for arg in "$@"; do
    case "${arg}" in --mkimage-v2) ;; *) continue ;; esac
    echo "error: --mkimage-v2 has to be the FIRST argument; here it came after '$1'." >&2
    echo "       Anywhere else it would be forwarded to \`bun test\`, which ignores it and reports" >&2
    echo "       a green suite in answer to a request to assemble an image." >&2
    exit 1
done

# --- how bun is invoked, and the only place in this package that decides ------
ROUTE=host
WHY=""
BUN="${MOS_BUILD_BUN:-}"

# An explicit binary and an explicit container are contradictory instructions;
# honouring one silently would run a bun other than the one that was asked for.
if [ -n "${BUN}" ] && [ "${MOS_BUILD_CONTAINER:-0}" = 1 ]; then
    echo "error: MOS_BUILD_BUN names a binary and MOS_BUILD_CONTAINER asks for the pinned" >&2
    echo "       container. Those are two different buns; set one or the other, not both." >&2
    exit 1
fi

if [ "${MOS_BUILD_CONTAINER:-0}" = 1 ]; then
    ROUTE=container
    WHY="MOS_BUILD_CONTAINER=1"
elif [ -z "${BUN}" ]; then
    if command -v bun >/dev/null 2>&1; then
        BUN="$(command -v bun)"
    elif [ -x "${HOME:-/root}/.bun/bin/bun" ]; then
        BUN="${HOME:-/root}/.bun/bin/bun"
    else
        ROUTE=container
        WHY="no bun on this host"
    fi
fi

# THE DOCKER CLIENT IS A REQUIREMENT OF THIS PACKAGE, not of its bun route.
# src/toolbox.ts falls back to a pinned container for every tool the host does
# not have, and this host has none of sgdisk, mcopy, mkimage or veritysetup. A
# missing docker surfaced from inside a test reads as a tool failure; named
# here it reads as what it is.
DOCKER="${MOS_BUILD_DOCKER:-}"
if [ -z "${DOCKER}" ]; then
    DOCKER="$(command -v docker || true)"
fi
[ -n "${DOCKER}" ] || {
    echo "error: no docker CLI on this host." >&2
    echo "       os/build drives sgdisk, mtools, mkimage, veritysetup, e2fsprogs and rauc. Each runs" >&2
    echo "       on the host when the host has it and in the image pinned for its toolset in" >&2
    echo "       os/build-env/images.env otherwise -- and a host carrying the whole toolset natively" >&2
    echo "       is rare enough that this is the normal route, not a fallback. Install docker, or" >&2
    echo "       point MOS_BUILD_DOCKER at a client that can reach a daemon." >&2
    exit 1
}
"${DOCKER}" version --format '{{.Server.Version}}' >/dev/null 2>&1 || {
    echo "error: ${DOCKER} cannot reach a docker daemon." >&2
    echo "       The client exists; the daemon does not answer. Every tool this suite cannot find on" >&2
    echo "       the host is run through it, so this is a failure now rather than nine tool failures" >&2
    echo "       later, each naming a binary rather than the daemon." >&2
    exit 1
}

MOUNTS=()
BUN_IMAGE=""
BUN_VERSION=""

if [ "${ROUTE}" = host ]; then
    BUN_VERSION="$("${BUN}" --version 2>/dev/null || echo '?')"
else
    # ONE resolver, the tree's own: from.sh validates that the key exists, is a
    # digest and not a tag, and is well formed, naming the key and the file.
    BUN_IMAGE="$(bash "${REPO_ROOT}/os/build-env/from.sh" --ref IMAGE_BUN_1)" || exit 1

    # A well-formed and WRONG digest is the one failure from.sh cannot see: it
    # checks the shape of a reference, not that a registry has it. Left to the
    # `docker run` below it arrives as exit 125, indistinguishable at this seam
    # from bun itself exiting 125 -- so the image is obtained once, here, where
    # the failure can still be attributed to the key that carries it.
    if ! "${DOCKER}" image inspect "${BUN_IMAGE}" >/dev/null 2>&1; then
        echo "os/build: ${BUN_IMAGE} is not in the local image store; pulling it"
        "${DOCKER}" pull -q "${BUN_IMAGE}" >/dev/null 2>&1 || {
            echo "error: IMAGE_BUN_1=${BUN_IMAGE} could not be obtained." >&2
            echo "       That key in os/build-env/images.env is this tree's record of which bun it runs." >&2
            echo "       The reference is well formed -- from.sh just checked that -- so what failed is" >&2
            echo "       the lookup: either no image has that digest, or this host cannot reach the" >&2
            echo "       registry. A run that continued past this would be a run by an unknown bun." >&2
            exit 1
        }
    fi

    # THE REPOSITORY AT ITS OWN PATH, and three more mounts os/verify has no use
    # for. The identity mount is M3c's rule and this package needs it MORE, not
    # less: a container started from inside this one is a SIBLING, created by
    # the same daemon, so every -v it passes is resolved against the HOST
    # filesystem. Under a /w mount the path bun computed inside would name a
    # different thing -- or nothing -- when the daemon read it back, and a bind
    # mount of a path the daemon cannot see does not fail here: it succeeds and
    # delivers an EMPTY DIRECTORY (measured on this host with /tmp). Mounted at
    # its own path there is nothing to translate: the same bytes answer to the
    # same name in all three of the host, this container and its siblings.
    MOUNTS=(-v "${REPO_ROOT}:${REPO_ROOT}")

    # The docker CLI is a statically linked Go binary (checked with `file`), so
    # it needs nothing from the host but itself and the socket. It is mounted at
    # its own path for the same reason as everything else, and read-only: a
    # container has no business writing to the client that started it.
    MOUNTS+=(-v "${DOCKER}:${DOCKER}:ro" -v /var/run/docker.sock:/var/run/docker.sock)

    # THE MOUNT THAT SUCCEEDS AND CARRIES NOTHING. On this host a bind mount of
    # anything under /tmp propagates as an empty directory rather than failing,
    # so every path this run depends on is asserted VISIBLE INSIDE THE CONTAINER
    # before any of it is used. One container, and it carries the version and
    # the daemon check too, so it costs no extra start over the `bun --version`
    # the host route prints.
    PREFLIGHT=("${HERE}/package.json" "${HERE}/src/geometry.ts" "${REPO_ROOT}/os/verify/src/board.ts" "${DOCKER}")
    probe="$("${DOCKER}" run --rm "${MOUNTS[@]}" "${BUN_IMAGE}" \
        sh -c 'bun --version; for f in "$@"; do [ -e "$f" ] || printf "unseen:%s\n" "$f"; done' \
        sh "${PREFLIGHT[@]}" 2>&1)" || {
        echo "error: the pinned bun container would not start." >&2
        printf '%s\n' "${probe}" >&2
        exit 1
    }
    BUN_VERSION="$(printf '%s\n' "${probe}" | head -n 1)"
    unseen="$(printf '%s\n' "${probe}" | sed -n 's/^unseen://p')"
    if [ -n "${unseen}" ]; then
        echo "error: the pinned bun container cannot see paths that this host can:" >&2
        printf '%s\n' "${unseen}" | while IFS= read -r u; do echo "         ${u}" >&2; done
        echo "       The mount succeeded and delivered nothing, which is how a bind mount of /tmp" >&2
        echo "       behaves on this host. The file IS there; it is the mount that is empty. Put the" >&2
        echo "       repository somewhere the docker daemon can share (under /srv, or _out/), or run" >&2
        echo "       on a host with bun so no mount is involved." >&2
        exit 1
    fi

    # A docker CLI that is present but cannot reach the daemon FROM IN HERE is
    # the failure this route adds over the host route, and it is silent without
    # this: the socket mount can succeed while the daemon refuses the caller.
    "${DOCKER}" run --rm "${MOUNTS[@]}" --entrypoint "${DOCKER}" "${BUN_IMAGE}" \
        version --format '{{.Server.Version}}' >/dev/null 2>&1 || {
        echo "error: the docker client works on this host but not inside the pinned bun container." >&2
        echo "       ${DOCKER} and /var/run/docker.sock are both mounted; the daemon still would not" >&2
        echo "       answer. Every external tool this suite runs goes through a container started" >&2
        echo "       from in there, so nothing below would work -- and each failure would name a" >&2
        echo "       tool rather than the socket." >&2
        exit 1
    }
fi

run_bun() {
    # The seam. Everything above and below passes an argv and reads a status,
    # and neither can tell which of the two routes answered.
    if [ "${ROUTE}" = container ]; then
        "${DOCKER}" run --rm "${MOUNTS[@]}" -w "${HERE}" \
            -e "MOS_BUILD_DOCKER=${DOCKER}" "${BUN_IMAGE}" bun "$@"
    else
        ( cd "${HERE}" && "${BUN}" "$@" )
    fi
}

if [ "${ROUTE}" = container ]; then
    echo "os/build: ${BUN_VERSION} in ${BUN_IMAGE} (${WHY})"
else
    echo "os/build: ${BUN_VERSION} at ${BUN}"
fi

# --- dependencies ------------------------------------------------------------
# `bun test` needs none of this -- bun:test and the node: builtins are in the
# runtime. `tsc` does. So an install failure is reported as an install failure
# rather than surfacing later as "tsc: command not found".
if [ ! -d "${HERE}/node_modules" ]; then
    echo "os/build: installing dev dependencies from bun.lock"
    run_bun install --frozen-lockfile || {
        echo "error: 'bun install --frozen-lockfile' failed. It needs the registry;" >&2
        echo "       a host with no network cannot typecheck, and this run does not pretend otherwise." >&2
        exit 1
    }
fi

# --- typecheck ---------------------------------------------------------------
# This typechecks os/verify's sources too, because src/verify-package.ts imports
# them and tsc follows a program's imports whether or not `include` names them.
# That is deliberate: the two packages share a board model, so they are checked
# against each other rather than each against its own copy of the truth.
echo "os/build: typecheck"
run_bun run typecheck

# --- the assembler -----------------------------------------------------------
# No vacuity guard here, and it needs none: this mode produces a FILE, and
# src/mkimage-v2.ts reads the loader back out of it before it will rename it into
# place. There is no shape of "ran and asserted nothing" available -- the failure
# mode a count guards against elsewhere is a suite that declared no tests, and
# this declares no tests at all.
if [ "${MODE}" = mkimage-v2 ]; then
    echo "os/build: assembling the cx3576 image"
    rc=0
    run_bun run src/mkimage-v2-cli.ts "$@" || rc=$?
    exit "${rc}"
fi

# --- the suite, and the guard against a run that asserted nothing ------------
OUT="$(mktemp)"
trap 'rm -f "${OUT}"' EXIT

echo "os/build: bun test"
rc=0
# tee, not a `| grep -q`: an early-exiting reader on the right of a pipe under
# `set -o pipefail` kills the producer with SIGPIPE and hands back its failure,
# which is the footgun os/tests/shell-pipefail-lint.sh exists to police.
run_bun test "$@" 2>&1 | tee "${OUT}" || rc=$?

# `Ran 1 test` and `Ran 64 tests` -- bun singularises, and a pattern that
# insists on the plural reads a one-test run as zero and fails it as vacuous.
RAN="$(sed -n 's/^Ran \([0-9][0-9]*\) test.*/\1/p' "${OUT}" | tail -n 1)"
PASSED="$(sed -n 's/^[[:space:]]*\([0-9][0-9]*\) pass$/\1/p' "${OUT}" | tail -n 1)"

if [ "${rc}" -ne 0 ]; then
    echo "RESULT: FAIL (bun test exited ${rc}; ${PASSED:-0} passed of ${RAN:-0} run)" >&2
    exit "${rc}"
fi
if [ -z "${RAN}" ]; then
    echo "error: bun test exited 0 but printed no 'Ran N tests' line. The count is what makes" >&2
    echo "       this run evidence; without it the exit status alone cannot tell a green suite" >&2
    echo "       from one that never executed." >&2
    exit 1
fi
if [ "${RAN}" -eq 0 ]; then
    echo "error: bun test ran 0 tests and exited 0. A suite that asserts nothing reports the same" >&2
    echo "       green as one that passes; that is the failure this package exists to make visible," >&2
    echo "       so it is a failure here." >&2
    exit 1
fi

echo "RESULT: PASS (${PASSED:-${RAN}}/${RAN} tests)"
