#!/usr/bin/env bash
# Negative tests for docs/verify-links.sh: each assertion is driven against a
# fixture in which its fact is false, and is required to fail with ITS OWN
# message -- an assertion that fires for an unrelated reason is not the
# assertion under test.
#
#   bash docs/verify-links-test.sh          (or: make docs-verify-test)
#
# HOW. The REAL docs/verify-links.sh is run, once per case, over a fixture
# tree. Nothing is reimplemented here. The verifier resolves its own root
# from ${BASH_SOURCE}, so a copy at ${case}/docs/verify-links.sh reads
# ${case}/docs -- the approach verify-index-test.sh established, and the real
# tree is never written to.
#
# UNLIKE verify-index-test.sh, the baseline here is SYNTHETIC, not a copy of
# the shipped tree: real docs pages link out of docs/ into the source tree
# (`boards/...`, `pkgs/...`), so a verbatim docs/ copy would fail on links
# whose targets were correct in place. The synthetic baseline instead
# exercises each grammar feature the verifier must accept -- a subdirectory
# hop, a stripped #fragment, a skipped absolute/mailto/anchor link, a link
# above docs/ -- and the positive control proves the fixture itself is green
# before any mutation is trusted to be what turned it red.
#
# No root, no network, nothing outside a temp dir.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER="${HERE}/verify-links.sh"

[ -e "${VERIFIER}" ] || { echo "error: ${VERIFIER} not found" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $*"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $*"; }

# A minimal tree every link-shape the verifier must ACCEPT: same-directory,
# subdirectory, fragment-carrying, out-of-docs, and every skipped scheme.
new_fixture() {
    local dir="$1"
    rm -rf "${dir}"
    mkdir -p "${dir}/docs/user" "${dir}/boards"
    cp "${VERIFIER}" "${dir}/docs/"
    : >"${dir}/boards/board.env"
    cat >"${dir}/docs/README.md" <<'EOF'
# fixture index

- [architecture](architecture.md)
- [user quickstart](user/quickstart.md)
- [external](https://example.invalid/) and [plain](http://example.invalid/)
- [mail](mailto:nobody@example.invalid) and [anchor](#fixture-index)
EOF
    cat >"${dir}/docs/architecture.md" <<'EOF'
# fixture architecture

Back to the [index](README.md#fixture-index), out of docs to
[the board definition](../boards/board.env).
EOF
    cat >"${dir}/docs/user/quickstart.md" <<'EOF'
# fixture quickstart

Up to the [architecture](../architecture.md).
EOF
}

run_verifier() {
    RC=0
    bash "$1/docs/verify-links.sh" >"${WORK}/out" 2>&1 || RC=$?
}

expect_all_pass() {
    local name="$1" got_fail got_checks
    run_verifier "${FIX}"
    got_fail="$(grep -c '^  FAIL ' "${WORK}/out" || true)"
    got_checks="$(sed -n 's|^docs/verify-links.sh: \([0-9]*\)/\1 PASS$|\1|p' "${WORK}/out")"
    if [ "${RC}" -eq 0 ] && [ "${got_fail}" -eq 0 ] && [ -n "${got_checks}" ]; then
        pass "${name}: ${got_checks}/${got_checks}, no failures, exit 0"
    else
        fail "${name}: expected a clean N/N PASS and exit 0, got ${got_fail} failure(s) / exit ${RC}"
        sed 's/^/    | /' "${WORK}/out"
    fi
}

# $2 is how many assertions must fire; every remaining argument is a substring
# that must appear in a FAIL line. An EXTRA assertion firing is a failure of
# this test, not a bonus.
expect_fail() {
    local name="$1" want="$2"
    shift 2
    local got_fail pat unmatched=0
    run_verifier "${FIX}"
    got_fail="$(grep -c '^  FAIL ' "${WORK}/out" || true)"
    for pat in "$@"; do
        grep -F -- "${pat}" "${WORK}/out" | grep -c '^  FAIL ' >/dev/null || {
            unmatched=1
            echo "    | no FAIL line contains: ${pat}"
        }
    done
    if [ "${RC}" -ne 0 ] && [ "${got_fail}" -eq "${want}" ] && [ "${unmatched}" -eq 0 ]; then
        pass "${name}: ${want} assertion(s) fail, each with its own message, exit ${RC}"
        grep '^  FAIL ' "${WORK}/out" | sed 's/^/    | /'
    else
        fail "${name}: expected ${want} FAIL line(s) and a non-zero exit, got ${got_fail} FAIL / exit ${RC}"
        sed 's/^/    | /' "${WORK}/out"
    fi
}

echo "verifier under test: ${VERIFIER}"
echo

# --- 0. positive control ----------------------------------------------------
FIX="${WORK}/baseline"
new_fixture "${FIX}"
expect_all_pass "baseline: every accepted link shape resolves"

# --- 1. a link whose target a rename deleted ---------------------------------
FIX="${WORK}/dangling-target"
new_fixture "${FIX}"
rm "${FIX}/docs/user/quickstart.md"
expect_fail "a link to a deleted file" 1 \
    "docs/README.md links to 'user/quickstart.md'" \
    "docs/user/quickstart.md does not exist"

# --- 2. a dangling target hidden behind a #fragment --------------------------
# The fragment must be STRIPPED, not treated as part of the path: a broken
# link does not become invisible by carrying an anchor.
FIX="${WORK}/dangling-behind-fragment"
new_fixture "${FIX}"
rm "${FIX}/docs/README.md"
cat >"${FIX}/docs/README.md" <<'EOF'
# fixture index

- [architecture](architecture.md)
- [gone](missing.md#some-anchor)
EOF
expect_fail "a fragment-carrying link to a missing file" 1 \
    "docs/README.md links to 'missing.md'" \
    "docs/missing.md does not exist"

# --- 3. a link that escapes docs/ to a target that is not there --------------
FIX="${WORK}/dangling-out-of-docs"
new_fixture "${FIX}"
rm "${FIX}/boards/board.env"
expect_fail "an out-of-docs link whose target is gone" 1 \
    "docs/architecture.md links to '../boards/board.env'"

# --- 4. a tree with no links at all ------------------------------------------
# The vacuity guard: zero extracted links means the extraction broke, not
# that the tree is clean.
FIX="${WORK}/no-links"
new_fixture "${FIX}"
for f in README.md architecture.md user/quickstart.md; do
    printf '# linkless page\n' >"${FIX}/docs/${f}"
done
expect_fail "a docs tree containing zero links" 1 \
    "no relative Markdown links found under docs/"

echo
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} cases)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} cases)"
    exit 1
fi
