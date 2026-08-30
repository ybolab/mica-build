#!/usr/bin/env bash
# A pipeline whose reader exits early is a lie under `set -o pipefail`.
#
# `producer | grep -q PATTERN` looks like "did the producer say PATTERN?". It is
# not. -q makes grep exit at the FIRST match, which closes the pipe; the
# producer's next write dies of SIGPIPE (status 141); and pipefail defines the
# pipeline's status as that of the rightmost command to exit non-zero. So the
# pipeline reports FAILURE precisely when the pattern was FOUND -- the answer is
# inverted, and which way it lands depends on whether the producer still had
# bytes to write, which makes it a race rather than a reliable bug.
#
# The worst instance of it is a security assertion whose failure direction is
# green: "the MQTT bridge is granted none of Reboot, PowerOff, SetSettings or
# SetTransientRootPassword" reports PASS precisely because the grant is there.
#
# The rule is narrow on purpose, so that it has no false positives to teach
# anyone to ignore. Only -q is flagged: it prints NOTHING, so the exit status is
# the only thing a caller can want from it, and on the right of a pipe under
# pipefail that status is the one thing it gets wrong. `grep -c PATTERN
# >/dev/null` keeps the same exit status, reads to EOF, and hands nobody a
# closed pipe.
#
# NOT flagged, though they exit early too: `| grep -m1`, `| head`, `| sed q`.
# These PRINT, so they are normally used for their output -- os/pkgs/mosd/tests/apid-api/run.sh
# does `hit="$(console_since ... | grep -m1 APID_LISTENING || true)"`, where the
# matched line is the point and the status is discarded. Flagging -m as well
# would make that line the rule's only hit in the tree, and a rule whose every
# finding is a false positive is worse than no rule.
#
# Comment lines are skipped, so prose describing the trap -- including the
# paragraph above -- is not reported as an instance of it.
set -euo pipefail

cd "$(dirname "$0")/../.."

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); [ -n "${LINT_QUIET:-}" ] || echo "PASS: $1"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $1"; }

# The file list comes from git, so a script added to the tree is covered the day
# it lands. An untracked scratch file is deliberately out of scope.
mapfile -t files < <(git ls-files '*.sh' 'hack/*' | sort)
[ "${#files[@]}" -gt 0 ] || { echo "error: no shell scripts found; this lint would pass by finding nothing" >&2; exit 1; }

scanned=0
for f in "${files[@]}"; do
    [ -f "${f}" ] || continue
    # The WHOLE file, not its first N lines: `set -euo pipefail` does not have
    # to be near the top, and a scoping heuristic that quietly excludes files
    # is indistinguishable, in the output, from a tree that is clean.
    grep -c 'pipefail' "${f}" >/dev/null || continue
    scanned=$((scanned + 1))
    # A pipe, optional whitespace, then grep with -q among its flags; comment
    # lines dropped afterwards so prose about the trap is not an instance of it.
    hits="$(grep -nE '\|[[:space:]]*(command[[:space:]]+)?e?grep([[:space:]]+-[A-Za-z]*q[A-Za-z]*)+' "${f}" |
        grep -vE '^[0-9]+:[[:space:]]*#' || true)"
    if [ -n "${hits}" ]; then
        while IFS= read -r h; do
            fail "${f}:${h%%:*}: an early-exiting grep on the right of a pipe, in a file that sets pipefail: the pipeline reports failure when the pattern IS found. Use 'grep -c ... >/dev/null'"
        done <<<"${hits}"
    else
        pass "${f} pipes nothing into an early-exiting grep"
    fi
done

[ "${scanned}" -gt 0 ] || { echo "error: no file enabled pipefail; the scan matched nothing and would report clean" >&2; exit 1; }

echo "RESULT: $([ "${FAIL_N}" -eq 0 ] && echo PASS || echo FAIL) ($((PASS_N))/$((PASS_N + FAIL_N)) files clean, ${scanned} scanned)"
[ "${FAIL_N}" -eq 0 ]
