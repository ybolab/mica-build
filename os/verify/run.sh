#!/usr/bin/env bash
# The single entry point for os/verify.
#
#   bash os/verify/run.sh                install if needed, typecheck, then test
#   bash os/verify/run.sh --help
#   bash os/verify/run.sh src/board.test.ts   extra arguments go to `bun test`
#   bash os/verify/run.sh --lint         the board-definition schema lint instead
#
# WHAT THIS PACKAGE IS. PLAN-014 M3: the bun+TypeScript foundation the rest of
# os/ moves onto, in the shape test/apid-api already established -- bun.lock,
# package.json, tsconfig.json, run.sh, src/. It starts with the board
# definition, because that is the smallest thing in the tree that every other
# thing reads: os/boards/<board>/board.env, parsed as DATA rather than sourced.
#
# THE SEAM FOR THE TOOL-LESS HOST, now closed. Exactly one function below
# decides how bun is invoked -- run_bun -- and it has two routes: a bun binary
# on the host, or the digest-pinned bun container recorded as IMAGE_BUN_1 in
# os/build-env/images.env. Every caller passes an argv and reads an exit status
# and cannot tell which route it got, which is what makes a host with no bun a
# SUPPORTED host rather than a documented limitation. Before M3b that was a
# nicety; since M3b it is a regression-closer, because os-layout-lint used to
# run on bare bash and now needs bun like the suite does.
#
# ZERO TESTS IS A FAILURE, AND BUN DOES NOT AGREE. Measured with bun 1.4.0 on
# 2026-08-25: `bun test` exits 1 when no test FILE matches its glob, but exits
# 0 when a file matches and declares no tests -- "Ran 0 tests across 1 file",
# green. That is the exact shape of the failure this tree keeps finding in its
# own checkers: the shell lint this package replaced printed FAIL lines and
# reported "RESULT: PASS (0/0 checks)" because its counters died in a subshell.
# So the count is read out of the run and a run that asserted nothing is turned
# red here. The same guard, at the lint's own granularity, is in src/lint.ts.
set -euo pipefail

# Anchored, not counted. `..` arithmetic always produces a path, so a file that
# moves fails later on a directory that is empty rather than absent -- and
# PLAN-014 has moved most of os/ once already, with M5 and M6 still to come.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
for anchor in "${HERE}/package.json" "${HERE}/src/board-env.ts" "${REPO_ROOT}/Makefile" "${REPO_ROOT}/os/boards"; do
    [ -e "${anchor}" ] || {
        echo "error: ${anchor} does not exist." >&2
        echo "       This script computed HERE=${HERE} and REPO_ROOT=${REPO_ROOT} from its own location;" >&2
        echo "       either os/verify/ moved and that arithmetic is stale, or the anchor did." >&2
        exit 1
    }
done

usage() {
    cat <<'USAGE'
usage: bash os/verify/run.sh [--help] [bun-test-args...]
       bash os/verify/run.sh --lint [board.env ...]

Installs the dev dependencies if they are missing, typechecks src/, then runs
the suite. Any extra arguments are passed to `bun test` (a filename filter, for
example). Every step must pass; nothing here skips.

With --lint FIRST, it runs the board-definition schema lint over the named
layouts instead of the suite -- `make os-layout-lint`. Same install, same
typecheck, same bun; only the last step differs. The flag has to come first so
that it can never be mistaken for a `bun test` filter.

A host with no bun runs the same steps in the bun container pinned by digest as
IMAGE_BUN_1 in os/build-env/images.env. That route is taken automatically; it
needs docker, and it is announced on the first line of output so a run is never
ambiguous about which bun produced it.

environment:
  MOS_VERIFY_BUN         the bun binary to use, instead of searching PATH and ~/.bun
  MOS_VERIFY_CONTAINER=1 use the pinned container even where a host bun exists,
                         which is how the two routes are compared on one host
USAGE
}

# --lint is a MODE, not a filter, so it is recognised only in first position.
MODE=suite
case "${1:-}" in
--help | -h) usage; exit 0 ;;
--lint) MODE=lint; shift ;;
esac

# ...and anywhere else it is a MISTAKE, refused rather than forwarded. Driven
# from the failing side: `run.sh src/lint.test.ts --lint` handed --lint to
# `bun test`, which ignored the unknown flag, ran the suite and exited 0 -- so
# asking for the lint got a green that was about something else entirely.
for arg in "$@"; do
    [ "${arg}" = "--lint" ] || continue
    echo "error: --lint has to be the FIRST argument; here it came after '$1'." >&2
    echo "       Anywhere else it would be forwarded to \`bun test\`, which ignores it and" >&2
    echo "       reports a green suite in answer to a request for the lint." >&2
    exit 1
done

# The lint's arguments are FILES, and run_bun cds into this package before it
# invokes bun -- so a relative path from the caller's shell would resolve
# against os/verify/ and be reported as "not found" for the wrong reason.
if [ "${MODE}" = lint ]; then
    ABS=()
    for arg in "$@"; do
        case "${arg}" in
        -*) ABS+=("${arg}") ;;
        /*) ABS+=("${arg}") ;;
        *) ABS+=("${PWD}/${arg}") ;;
        esac
    done
    set -- ${ABS[@]+"${ABS[@]}"}
fi

# --- how bun is invoked, and the only place that decides ---------------------
# Two routes, one seam. A bun binary on the host, or the digest-pinned bun
# container. The choice is made once, here, and announced.
ROUTE=host
WHY=""
BUN="${MOS_VERIFY_BUN:-}"

# An explicit binary and an explicit container are contradictory instructions.
# Honouring one silently would run a bun other than the one that was asked for,
# and the whole point of pinning is that which bun ran is never a guess.
if [ -n "${BUN}" ] && [ "${MOS_VERIFY_CONTAINER:-0}" = 1 ]; then
    echo "error: MOS_VERIFY_BUN names a binary and MOS_VERIFY_CONTAINER asks for the pinned" >&2
    echo "       container. Those are two different buns; set one or the other, not both." >&2
    exit 1
fi

if [ "${MOS_VERIFY_CONTAINER:-0}" = 1 ]; then
    ROUTE=container
    WHY="MOS_VERIFY_CONTAINER=1"
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

MOUNTS=()
BUN_IMAGE=""
BUN_VERSION=""

if [ "${ROUTE}" = host ]; then
    BUN_VERSION="$("${BUN}" --version 2>/dev/null || echo '?')"
else
    command -v docker >/dev/null 2>&1 || {
        echo "error: no bun on this host, and no docker to run the pinned one in." >&2
        echo "       os/verify needs one of the two. Either install bun, or set MOS_VERIFY_BUN to a" >&2
        echo "       bun binary, or install docker -- the bun this tree runs is recorded as" >&2
        echo "       IMAGE_BUN_1 in os/build-env/images.env and needs a container runtime to be it." >&2
        exit 1
    }

    # ONE resolver, the tree's own. from.sh validates that the key exists, is a
    # digest and not a tag, and is well formed, and it says so naming the key
    # and the file -- so none of that is restated here.
    BUN_IMAGE="$(bash "${REPO_ROOT}/os/build-env/from.sh" --ref IMAGE_BUN_1)" || exit 1

    # A digest that is well formed and WRONG is the one failure from.sh cannot
    # see: it checks the shape of a reference, not that a registry has it. Left
    # to the `docker run` below, that arrives as exit 125 with a manifest error
    # -- and 125 at this seam is indistinguishable from bun itself exiting 125.
    # So the image is obtained ONCE, here, where the failure can still be
    # attributed to the key that carries it.
    if ! docker image inspect "${BUN_IMAGE}" >/dev/null 2>&1; then
        echo "os/verify: ${BUN_IMAGE} is not in the local image store; pulling it"
        docker pull -q "${BUN_IMAGE}" >/dev/null 2>&1 || {
            echo "error: IMAGE_BUN_1=${BUN_IMAGE} could not be obtained." >&2
            echo "       That key in os/build-env/images.env is this tree's record of which bun it runs." >&2
            echo "       The reference is well formed -- from.sh just checked that -- so what failed is" >&2
            echo "       the lookup: either no image has that digest, or this host cannot reach the" >&2
            echo "       registry. A run that continued past this would be a run by an unknown bun." >&2
            exit 1
        }
    fi

    # WHY THE REPOSITORY IS MOUNTED AT ITS OWN PATH, and not at /w or /work like
    # the two image assemblers. Those containers RUN A SCRIPT and build their
    # paths inside; this one is a TOOL handed paths from outside. The lint's file
    # arguments were absolutised against the caller's cwd above, and paths.ts
    # resolves the shipped boards by climbing from import.meta.dir -- both
    # produce HOST absolute paths. Under a /w mount they would name nothing
    # inside the container, and the fix for that would be a prefix rewrite: a
    # second path arithmetic, on the one input whose identity the verdict is
    # about. Mounted at its own path there is no rewrite to get wrong and no
    # arithmetic to go stale -- the same bytes answer to the same name on both
    # routes, which is what makes the two runs comparable verdict for verdict.
    # os/tests/mkimage-v2-selftest.sh and mkimage-x64-selftest.sh mount ${WORK}
    # at ${WORK} for their tool containers and say so in the same terms.
    MOUNTS=(-v "${REPO_ROOT}:${REPO_ROOT}")

    # A board file OUTSIDE the repository is a case the host route serves and so
    # this one must too: its directory is mounted at its own path as well. Read
    # only -- the lint never writes to what it is checking.
    NEED_SEEN=()
    if [ "${MODE}" = lint ]; then
        for arg in "$@"; do
            case "${arg}" in -*) continue ;; esac
            argdir="$(dirname "${arg}")"
            # A directory that is not there means the FILE is not there, and
            # that is the lint's own error to report, in its own words.
            [ -d "${argdir}" ] || continue
            argdir="$(cd "${argdir}" && pwd)"
            case "${argdir}/" in "${REPO_ROOT}/"*) continue ;; esac
            seen=0
            for m in ${MOUNTS[@]+"${MOUNTS[@]}"}; do
                [ "${m}" = "${argdir}:${argdir}:ro" ] && seen=1
            done
            [ "${seen}" = 1 ] || MOUNTS+=(-v "${argdir}:${argdir}:ro")
            NEED_SEEN+=("${arg}")
        done
    fi

    # THE MOUNT THAT SUCCEEDS AND CARRIES NOTHING. On this host a bind mount of
    # anything under /tmp propagates as an EMPTY DIRECTORY rather than failing:
    # measured 2026-08-25, `docker run -v /tmp/d:/tmp/d ... cat /tmp/d/f` reports
    # "No such file or directory" for a file the host reads fine.
    #
    # WHAT THIS GUARD IS AND IS NOT, measured rather than assumed. It is NOT the
    # only thing between that mount and a green run: with this check disabled,
    # all three ways in still fail, and all three exit 1 -- the lint's own
    # existsSync says "<path> not found", `bun test` over a vanished package
    # says "No tests found!", and `bun run src/lint-cli.ts` says "Module not
    # found". Nothing reports a false green, and the claim that it would be
    # wrong.
    #
    # What it buys is the CAUSE. Each of those three sentences describes a file
    # that is missing, and on this route the file is not missing -- the mount is
    # empty, and the file is exactly where the caller said it was. A reader sent
    # to look for a path they can `cat` is being sent to the wrong edit, which is
    # the same defect M3b recorded when lint.sh said "declares no X" about a file
    # containing X="". So every path the run depends on is asserted VISIBLE
    # INSIDE THE CONTAINER first, and the refusal names the mount. One container,
    # ~260ms, and it carries the version too, so it costs no extra start over the
    # `bun --version` the host route prints.
    PREFLIGHT=("${HERE}/package.json" "${HERE}/src/lint-cli.ts")
    PREFLIGHT+=(${NEED_SEEN[@]+"${NEED_SEEN[@]}"})
    probe="$(docker run --rm "${MOUNTS[@]}" "${BUN_IMAGE}" \
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
        echo "       behaves on this host. Without this check the run would still have failed -- but" >&2
        echo "       it would have failed saying the file was not found, and the file IS there; it is" >&2
        echo "       the mount that is empty. Put it somewhere the docker daemon can actually share" >&2
        echo "       (inside the repository, or under _out/ or /srv), or run on a host with bun so no" >&2
        echo "       mount is involved." >&2
        exit 1
    fi
fi

run_bun() {
    # The seam. Everything above and below passes an argv and reads a status,
    # and neither can tell which of the two routes answered.
    if [ "${ROUTE}" = container ]; then
        docker run --rm "${MOUNTS[@]}" -w "${HERE}" "${BUN_IMAGE}" bun "$@"
    else
        ( cd "${HERE}" && "${BUN}" "$@" )
    fi
}

if [ "${ROUTE}" = container ]; then
    echo "os/verify: ${BUN_VERSION} in ${BUN_IMAGE} (${WHY})"
else
    echo "os/verify: ${BUN_VERSION} at ${BUN}"
fi

# --- dependencies ------------------------------------------------------------
# `bun test` needs none of this -- bun:test and the node: builtins are in the
# runtime, measured on 2026-08-25 by running the suite with node_modules moved
# aside. `tsc` does. So an install failure is reported as an install failure
# rather than surfacing later as "tsc: command not found".
if [ ! -d "${HERE}/node_modules" ]; then
    echo "os/verify: installing dev dependencies from bun.lock"
    run_bun install --frozen-lockfile || {
        echo "error: 'bun install --frozen-lockfile' failed. It needs the registry;" >&2
        echo "       a host with no network cannot typecheck, and this run does not pretend otherwise." >&2
        exit 1
    }
fi

# --- typecheck ---------------------------------------------------------------
echo "os/verify: typecheck"
run_bun run typecheck

# --- the lint, which is the other thing this package is for ------------------
# No vacuity guard here, because the lint carries its own: src/lint.ts refuses a
# run in which any FILE contributed zero assertions, which is finer than a total
# that is merely non-zero. The shell predecessor learned that the hard way --
# one board died while being sourced, contributed nothing, and the run reported
# PASS from the other board alone.
if [ "${MODE}" = lint ]; then
    echo "os/verify: board-definition schema lint"
    rc=0
    run_bun run src/lint-cli.ts "$@" || rc=$?
    exit "${rc}"
fi

# --- the suite, and the guard against a run that asserted nothing ------------
OUT="$(mktemp)"
trap 'rm -f "${OUT}"' EXIT

echo "os/verify: bun test"
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
