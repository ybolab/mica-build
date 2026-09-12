#!/usr/bin/env bash
# Negative tests for tools/docs/verify-board.sh: each assertion is driven
# against a fixture in which its fact is false, and is required to fail with
# ITS OWN message.
#
#   bash tools/docs/verify-board-test.sh          (or: make docs-verify-test)
#
# HOW. The REAL tools/docs/verify-board.sh is run, once per case, over a COPY
# of the real template and dossier with one mutation applied -- the approach
# verify-index-test.sh established. The verifier resolves its own directory
# from ${BASH_SOURCE}, so a copy at ${case}/tools/docs/verify-board.sh reads
# ${case}/docs/boards, and unlike the link and status gates this one's inputs
# live entirely inside docs/boards/, so the SHIPPED template and dossier are the
# baseline, copied verbatim -- a fixture this script had authored would prove
# only that the script can spell.
#
# No root, no network, nothing outside a temp dir.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER="${HERE}/verify-board.sh"
TEMPLATE="${HERE}/../../docs/boards/board-template.md"
DOSSIER="${HERE}/../../docs/boards/cx3576.md"

for required in "${VERIFIER}" "${TEMPLATE}" "${DOSSIER}"; do
    [ -e "${required}" ] || { echo "error: ${required} not found" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $*"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $*"; }

new_fixture() {
    local dir="$1"
    rm -rf "${dir}"
    mkdir -p "${dir}/docs/boards" "${dir}/tools/docs"
    cp "${VERIFIER}" "${dir}/tools/docs/"
    cp "${TEMPLATE}" "${DOSSIER}" "${dir}/docs/boards/"
}

# Replaces the single line matching $2 in file $1 with $3 ("" deletes it),
# refusing to "succeed" when the pattern was not there exactly once: a
# mutation that silently changed nothing would make its case pass for free.
replace_line() {
    local file="$1" pat="$2" new="$3" before
    before=$(grep -cF -- "${pat}" "${file}")
    [ "${before}" -eq 1 ] || {
        echo "error: ${file} has ${before} lines matching '${pat}', expected exactly 1" >&2
        exit 1
    }
    awk -v p="${pat}" -v n="${new}" \
        'index($0, p) { if (n != "") print n; next } { print }' \
        "${file}" >"${file}.new"
    mv "${file}.new" "${file}"
    echo "    | replaced '${pat}' with '${new:-<nothing>}'"
}

run_verifier() {
    RC=0
    bash "$1/tools/docs/verify-board.sh" >"${WORK}/out" 2>&1 || RC=$?
}

expect_all_pass() {
    local name="$1" got_fail got_checks
    run_verifier "${FIX}"
    got_fail="$(grep -c '^  FAIL ' "${WORK}/out" || true)"
    got_checks="$(sed -n 's|^tools/docs/verify-board.sh: \([0-9]*\)/\1 PASS$|\1|p' "${WORK}/out")"
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
echo "fixture copied from: ${TEMPLATE} + ${DOSSIER}"
echo

# --- 0. positive control ----------------------------------------------------
FIX="${WORK}/baseline"
new_fixture "${FIX}"
expect_all_pass "baseline: the shipped template and dossier, copied verbatim"

# --- 1. a required heading missing from the dossier --------------------------
FIX="${WORK}/missing-heading"
new_fixture "${FIX}"
replace_line "${FIX}/docs/boards/cx3576.md" '## Console' ''
expect_fail "a dossier without the Console section" 1 \
    "cx3576.md is missing the required heading '## Console'"

# --- 2. an H2 the template does not name -------------------------------------
FIX="${WORK}/extra-heading"
new_fixture "${FIX}"
printf '\n## Bench notes\n\nScratch.\n' >>"${FIX}/docs/boards/cx3576.md"
expect_fail "a dossier with a heading outside the template list" 1 \
    "carries the heading '## Bench notes', which is outside the template's section list"

# --- 3. every heading present, two of them swapped ---------------------------
FIX="${WORK}/swapped-headings"
new_fixture "${FIX}"
# One sed pass: the Console line falls through both later substitutions and
# lands as Peripherals; the Peripherals line becomes Console.
sed -i 's/^## Console$/## Peripherals/; t; s/^## Peripherals$/## Console/' \
    "${FIX}/docs/boards/cx3576.md"
expect_fail "a dossier with Console and Peripherals swapped" 1 \
    "carries every required heading but not in the template's order"

# --- 4. a qualification result outside the vocabulary ------------------------
FIX="${WORK}/bad-result-cell"
new_fixture "${FIX}"
replace_line "${FIX}/docs/boards/cx3576.md" \
    '| Warm boot | not tested | — | needs bench hardware |' \
    '| Warm boot | untested | — | needs bench hardware |'
expect_fail "a result cell saying 'untested'" 1 \
    "qualification row has result 'untested'; allowed: pass | fail | N/A | not tested"

# --- 5. a pass row without an ISO date ---------------------------------------
FIX="${WORK}/pass-without-date"
new_fixture "${FIX}"
replace_line "${FIX}/docs/boards/cx3576.md" \
    '| Cold boot | not tested | — | needs bench hardware |' \
    '| Cold boot | pass | — | claimed without a run on record |'
expect_fail "a pass row with no date" 1 \
    "qualification row is 'pass' without an ISO date"

# --- 6. a template whose section list is gone --------------------------------
# The vacuity guard: zero required headings must never validate anything.
FIX="${WORK}/empty-template-list"
new_fixture "${FIX}"
sed -i '/^[0-9][0-9]*\. `## /d' "${FIX}/docs/boards/board-template.md"
expect_fail "a template yielding zero required headings" 1 \
    "yields zero required H2 headings; every dossier would pass vacuously"

# --- 7. no dossier instance at all -------------------------------------------
FIX="${WORK}/no-dossier"
new_fixture "${FIX}"
rm "${FIX}/docs/boards/cx3576.md"
expect_fail "a tree with no dossier to validate" 1 \
    "no dossier instance found"

# --- 8. a dossier whose qualification table is empty -------------------------
FIX="${WORK}/no-qualification-rows"
new_fixture "${FIX}"
sed -i '/^## Qualification results$/,$ { /^|/d }' \
    "${FIX}/docs/boards/cx3576.md"
expect_fail "a dossier with zero qualification rows" 1 \
    "has zero qualification rows; 'never implicitly green' would pass vacuously"

echo
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} cases)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} cases)"
    exit 1
fi
