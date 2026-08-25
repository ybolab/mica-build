#!/usr/bin/env bash
# The single entry point for os/verify.
#
#   bash os/verify/run.sh              install if needed, typecheck, then test
#   bash os/verify/run.sh --help
#   bash os/verify/run.sh board.env    extra arguments go to `bun test`
#
# WHAT THIS PACKAGE IS. PLAN-014 M3: the bun+TypeScript foundation the rest of
# os/ moves onto, in the shape test/apid-api already established -- bun.lock,
# package.json, tsconfig.json, run.sh, src/. It starts with the board
# definition, because that is the smallest thing in the tree that every other
# thing reads: os/boards/<board>/board.env, parsed as DATA rather than sourced.
#
# THE SEAM FOR THE TOOL-LESS HOST. Exactly one function below decides how bun
# is invoked -- run_bun. Today it runs whatever bun it can find on the host.
# RFCT-109's remaining half puts a pinned container in front of that decision,
# with the digest recorded in os/build-env/images.env, and nothing outside
# run_bun should need to change for it: every caller passes an argv and reads
# an exit status. The manual command that works in the meantime is in the
# refusal below, so a host without bun is told what to run rather than left
# with "command not found".
#
# ZERO TESTS IS A FAILURE, AND BUN DOES NOT AGREE. Measured with bun 1.4.0 on
# 2026-08-25: `bun test` exits 1 when no test FILE matches its glob, but exits
# 0 when a file matches and declares no tests -- "Ran 0 tests across 1 file",
# green. That is the exact shape of the failure this tree keeps finding in its
# own checkers: os/verify/lint.sh printed FAIL lines and reported "RESULT: PASS
# (0/0 checks)" because its counters died in a subshell. So the count is read
# out of the run and a run that asserted nothing is turned red here.
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

environment:
  MOS_VERIFY_BUN   the bun binary to use, instead of searching PATH and ~/.bun
USAGE
}

# --lint is a MODE, not a filter, so it is recognised only in first position.
MODE=suite
case "${1:-}" in
--help | -h) usage; exit 0 ;;
--lint) MODE=lint; shift ;;
esac

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

# --- how bun is invoked, and the only place that decides -------------------
BUN="${MOS_VERIFY_BUN:-}"
if [ -z "${BUN}" ]; then
    if command -v bun >/dev/null 2>&1; then
        BUN="$(command -v bun)"
    elif [ -x "${HOME:-/root}/.bun/bin/bun" ]; then
        BUN="${HOME:-/root}/.bun/bin/bun"
    fi
fi

if [ -z "${BUN}" ]; then
    echo "error: no bun on this host, and the pinned-container fallback is not wired up yet (RFCT-109)." >&2
    echo "       Set MOS_VERIFY_BUN to a bun binary, or run the suite in a container from the repository root:" >&2
    echo "" >&2
    echo "         docker run --rm -v \"\$(git rev-parse --show-toplevel):/w\" -w /w/os/verify \\" >&2
    echo "           oven/bun:1 sh -c 'bun install && bun run typecheck && bun test'" >&2
    echo "" >&2
    echo "       Mount the REPOSITORY, not a temporary directory: a /tmp mount does not propagate" >&2
    echo "       to the docker daemon on this host and silently yields an empty directory." >&2
    exit 1
fi

run_bun() {
    # The seam. Everything above and below passes an argv and reads a status;
    # replacing this body with a `docker run ... "${BUN_IMAGE}" bun "$@"` is the
    # whole of the tool-less-host path.
    ( cd "${HERE}" && "${BUN}" "$@" )
}

echo "os/verify: $("${BUN}" --version 2>/dev/null || echo '?') at ${BUN}"

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
