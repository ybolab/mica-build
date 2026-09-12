#!/usr/bin/env bash
# Negative tests for tools/docs/verify-coverage.sh: each enforcement clause of the
# en/zh coverage rule is driven against a fixture in which its fact is false,
# and is required to fail with ITS OWN message.
#
#   bash tools/docs/verify-coverage-test.sh          (or: make docs-verify-test)
#
# HOW. The REAL tools/docs/verify-coverage.sh is run, once per case, over a
# fixture tree. The verifier resolves its own root from ${BASH_SOURCE}, so a
# copy at ${case}/tools/docs/verify-coverage.sh reads ${case}/docs -- the approach
# verify-index-test.sh established.
#
# The baseline is SYNTHETIC: the real table carries 32 rows across three trees,
# and a case that mutates one of them would be read against 31 others. The
# fixture instead carries the smallest table that still has both directions to
# check -- one translated English page (`current`, with its docs/zh/ file), one
# untranslated page per remaining gated tree -- and the positive control proves
# the fixture green before any mutation is trusted to be what turned it red.
#
# No root, no network, nothing outside a temp dir.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER="${HERE}/verify-coverage.sh"

[ -e "${VERIFIER}" ] || { echo "error: ${VERIFIER} not found" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $*"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $*"; }

# One English page per gated tree, one of them translated, and the three-row
# table that claims exactly that. The translated pair carries one `> status:`
# line on each side: without it the parity clause would compare two empty
# lists and pass by finding nothing, in the baseline and in every case below.
new_fixture() {
    local dir="$1"
    rm -rf "${dir}"
    mkdir -p "${dir}/docs/user" "${dir}/docs/website" "${dir}/docs/boards" \
             "${dir}/docs/zh/user" "${dir}/docs/design"
    mkdir -p "${dir}/tools/docs"
    cp "${VERIFIER}" "${dir}/tools/docs/"
    printf '# fixture user page\n\n> status: shipped — evidence: `docs/user/page.md`\n' \
        >"${dir}/docs/user/page.md"
    printf '# fixture website page\n' >"${dir}/docs/website/page.md"
    printf '# fixture boards page\n'     >"${dir}/docs/boards/page.md"
    printf '# fixture design page\n'  >"${dir}/docs/design/page.md"
    printf '# 夹具用户页面\n\n> status: shipped — evidence: `docs/user/page.md`\n' \
        >"${dir}/docs/zh/user/page.md"
    cat >"${dir}/docs/zh/README.md" <<'EOF'
# fixture zh index

| 源页面 | 源版本 | 覆盖状态 |
|---|---|---|
| `../user/page.md` | db66fc02 | current |
| `../website/page.md` | db66fc02 | not-translated |
| `../boards/page.md` | db66fc02 | not-translated |
EOF
}

# Replaces the whole line matching $2 in file $1 with $3, refusing to "succeed"
# when the pattern was not there: a mutation that changed nothing would make
# the case below pass for free.
replace_line() {
    local file="$1" pat="$2" new="$3" before
    before=$(grep -cF -- "${pat}" "${file}")
    [ "${before}" -eq 1 ] || {
        echo "error: ${file} has ${before} lines matching '${pat}', expected exactly 1" >&2
        exit 1
    }
    awk -v p="${pat}" -v n="${new}" 'index($0, p) { print n; next } { print }' \
        "${file}" >"${file}.new"
    mv "${file}.new" "${file}"
    echo "    | replaced '${pat}' with '${new}'"
}

append_line() {
    local file="$1" new="$2"
    printf '%s\n' "${new}" >>"${file}"
    echo "    | appended '${new}'"
}

run_verifier() {
    RC=0
    bash "$1/tools/docs/verify-coverage.sh" >"${WORK}/out" 2>&1 || RC=$?
}

expect_all_pass() {
    local name="$1" got_fail got_checks
    run_verifier "${FIX}"
    got_fail="$(grep -c '^  FAIL ' "${WORK}/out" || true)"
    got_checks="$(sed -n 's|^tools/docs/verify-coverage.sh: \([0-9]*\)/\1 PASS$|\1|p' "${WORK}/out")"
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
expect_all_pass "baseline: three rows, one translated page, both directions"

# --- 1. a row that does not parse -------------------------------------------
# Two assertions fire, and both are wanted: the row is unreadable, AND the page
# it meant to cover is left with no row a reader could count.
FIX="${WORK}/unparseable-row"
new_fixture "${FIX}"
replace_line "${FIX}/docs/zh/README.md" '| `../boards/page.md` | db66fc02 | not-translated |' \
    '| `../boards/page.md` | db66fc02 |'
expect_fail "a row missing its status cell" 2 \
    "row does not parse" \
    "docs/boards/page.md has 0 coverage rows"

# --- 2. a row for a page outside the gated trees -----------------------------
# docs/design/page.md exists, so the row is not merely dead: it is a coverage
# claim about a tree this table does not govern.
FIX="${WORK}/out-of-scope-row"
new_fixture "${FIX}"
append_line "${FIX}/docs/zh/README.md" '| `../design/page.md` | db66fc02 | current |'
expect_fail "a row for a tree the table does not govern" 1 \
    "is outside the gated trees"

# --- 3. a row whose source page a rename deleted -----------------------------
FIX="${WORK}/dead-source-page"
new_fixture "${FIX}"
rm "${FIX}/docs/website/page.md"
expect_fail "a row naming a source page that no longer exists" 1 \
    "names a source page that does not exist"

# --- 4. a status word outside the taxonomy -----------------------------------
FIX="${WORK}/unknown-status"
new_fixture "${FIX}"
replace_line "${FIX}/docs/zh/README.md" '| `../website/page.md` | db66fc02 | not-translated |' \
    '| `../website/page.md` | db66fc02 | partial |'
expect_fail "a coverage status outside the taxonomy" 1 \
    "carries status 'partial'"

# --- 5. a source version that is not a commit --------------------------------
FIX="${WORK}/prose-version"
new_fixture "${FIX}"
replace_line "${FIX}/docs/zh/README.md" '| `../boards/page.md` | db66fc02 | not-translated |' \
    '| `../boards/page.md` | unknown | not-translated |'
expect_fail "a source version column decayed into prose" 1 \
    "carries source version 'unknown'"

# --- 6. `current` with no translation behind it ------------------------------
FIX="${WORK}/current-without-file"
new_fixture "${FIX}"
rm "${FIX}/docs/zh/user/page.md"
expect_fail "a 'current' row whose translation was deleted" 1 \
    "is 'current' but docs/zh/user/page.md does not exist"

# --- 7. an English page with no row ------------------------------------------
FIX="${WORK}/untracked-page"
new_fixture "${FIX}"
printf '# a second fixture user page\n' >"${FIX}/docs/user/second.md"
expect_fail "an English page the table never mentions" 1 \
    "docs/user/second.md has 0 coverage rows"

# --- 8. an English page with two rows ----------------------------------------
# Neither per-row check can see this: both copies parse, and both are true.
FIX="${WORK}/duplicate-row"
new_fixture "${FIX}"
append_line "${FIX}/docs/zh/README.md" '| `../user/page.md` | db66fc02 | current |'
expect_fail "one page claimed by two rows" 1 \
    "docs/user/page.md has 2 coverage rows"

# --- 9. a translated page whose row was left behind --------------------------
# The reverse direction, and the one a forward-only check would miss: the file
# is there, the row says it is not.
FIX="${WORK}/translated-but-not-current"
new_fixture "${FIX}"
replace_line "${FIX}/docs/zh/README.md" '| `../user/page.md` | db66fc02 | current |' \
    '| `../user/page.md` | db66fc02 | lagging |'
expect_fail "a translated page whose row does not say 'current'" 1 \
    "is translated but docs/zh/README.md does not carry a 'current' row"

# --- 10. a zh page whose status line drifted from its source -----------------
# The prose of a translation is free; its claims are not. Nothing else here
# reads inside a page, so a `current` row keeps claiming agreement while the
# two pages state different statuses.
FIX="${WORK}/status-line-drift"
new_fixture "${FIX}"
replace_line "${FIX}/docs/zh/user/page.md" '> status: shipped — evidence: `docs/user/page.md`' \
    '> status: proposed — evidence: `docs/plan/PLAN-001.md`'
expect_fail "a translated page whose status line does not match its source" 1 \
    "docs/zh/user/page.md carries different '> status:' lines than its source docs/user/page.md"

# --- 11. a table with no rows at all -----------------------------------------
# Five assertions fire, and all five are wanted: the floor itself, one per
# English page now untracked, and the translated page with no row to be current.
FIX="${WORK}/vacuous-table"
new_fixture "${FIX}"
printf '# fixture zh index\n\nno coverage table here.\n' >"${FIX}/docs/zh/README.md"
expect_fail "a coverage table emptied of every row" 5 \
    "carries zero coverage rows" \
    "docs/user/page.md has 0 coverage rows" \
    "docs/website/page.md has 0 coverage rows" \
    "docs/boards/page.md has 0 coverage rows" \
    "is translated but docs/zh/README.md does not carry a 'current' row"

echo
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} cases)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} cases)"
    exit 1
fi
