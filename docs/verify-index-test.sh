#!/usr/bin/env bash
# Negative tests for docs/verify-index.sh -- in particular for the "once each"
# assertions, which are the half that catches a document or a task row listed
# TWICE.
#
#   bash docs/verify-index-test.sh          (or: make docs-verify-test)
#
# WHY THIS EXISTS. `make docs-verify` passes, and passed just as happily before
# the duplicate assertions existed: with a second `(RFCT-073.md)` row injected
# into docs/task/index.md the verifier reported 162/162 PASS and exit 0. It was
# not merely failing to complain -- the CHECK COUNT DID NOT MOVE either, 162/162
# with the duplicate and 162/162 without it, so the before/after count
# comparison this project otherwise leans on could not see it either. (Under
# design/ and research/ the count DID move, by one, which is exactly what adding
# a real document looks like -- not a signal anyone can act on.) An assertion
# nobody has ever seen FAIL is equally consistent with an assertion that CANNOT
# fail, which is what these were: forward was a `grep -q`, satisfied by one
# occurrence or by five, and reverse dedupes its input with `sort -u` before the
# loop that would have noticed. So each assertion is driven here against an
# index in which its fact is FALSE, and each is required to fail -- and to fail
# with ITS OWN message, because an assertion that fires for an unrelated reason
# is not the assertion under test.
#
# The three pre-existing assertions (unindexed document, dangling row, dangling
# README entry) are driven the same way. They are not what this file was written
# for; they are here so that a future edit to verify-index.sh cannot quietly
# disarm them while the duplicate cases go on passing.
#
# HOW. The REAL docs/verify-index.sh is run, once per case, over a COPY of the
# real docs tree with one mutation applied. Nothing is reimplemented here; a
# reimplementation would be testing this file's idea of the assertion rather
# than the assertion. The verifier resolves its own root from ${BASH_SOURCE},
# so a copy at ${case}/docs/verify-index.sh reads ${case}/docs -- no environment
# hook is needed and the real tree is never written to.
#
# The baseline is not hand-written either: it is the SHIPPED docs/README.md,
# docs/task/index.md and document tree, copied verbatim. Every case then MUTATES
# that baseline. An index this script had authored would prove only that the
# script can spell. Nothing is hardcoded about how many checks the baseline
# reports, because that number grows with every document added.
#
# No root, no network, nothing outside a temp dir. It fails loudly when it
# cannot run rather than skipping.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
VERIFIER="${HERE}/verify-index.sh"

for required in "${VERIFIER}" "${HERE}/README.md" "${HERE}/task/index.md"; do
    [ -e "${required}" ] || { echo "error: ${required} not found" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $*"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $*"; }

# A copy of everything the verifier reads, and nothing else.
new_fixture() {
    local dir="$1"
    rm -rf "${dir}"
    mkdir -p "${dir}/docs"
    cp "${ROOT}/docs/README.md" "${ROOT}/docs/verify-index.sh" "${dir}/docs/"
    cp -R "${ROOT}/docs/design" "${ROOT}/docs/research" "${ROOT}/docs/task" "${dir}/docs/"
}

# Duplicates the line matching $2 in file $1, and fails loudly if that line was
# not there exactly once to begin with: a mutation that silently changed nothing
# would make the case below pass for free.
duplicate_line() {
    local file="$1" pat="$2" times="${3:-1}" before after
    before=$(grep -cF -- "${pat}" "${file}")
    [ "${before}" -eq 1 ] || {
        echo "error: ${file} has ${before} lines matching '${pat}', expected exactly 1 to duplicate" >&2
        exit 1
    }
    awk -v p="${pat}" -v n="${times}" 'index($0, p) { for (i = 0; i <= n; i++) print; next } { print }' \
        "${file}" >"${file}.new"
    mv "${file}.new" "${file}"
    after=$(grep -cF -- "${pat}" "${file}")
    [ "${after}" -eq $((times + 1)) ] || {
        echo "error: duplication of '${pat}' in ${file} produced ${after} copies, expected $((times + 1))" >&2
        exit 1
    }
    echo "    | occurrences of '${pat}': ${before} -> ${after}"
}

# Runs the REAL verifier over fixture $1, leaving its output in ${WORK}/out and
# its exit status in ${RC}.
run_verifier() {
    RC=0
    bash "$1/docs/verify-index.sh" >"${WORK}/out" 2>&1 || RC=$?
}

# The positive control.
expect_all_pass() {
    local name="$1" got_fail got_checks
    run_verifier "${FIX}"
    got_fail="$(grep -c '^  FAIL ' "${WORK}/out" || true)"
    got_checks="$(sed -n 's|^docs/verify-index.sh: \([0-9]*\)/\1 PASS$|\1|p' "${WORK}/out")"
    if [ "${RC}" -eq 0 ] && [ "${got_fail}" -eq 0 ] && [ -n "${got_checks}" ]; then
        pass "${name}: ${got_checks}/${got_checks}, no failures, exit 0"
    else
        fail "${name}: expected a clean N/N PASS and exit 0, got ${got_fail} failure(s) / exit ${RC}"
        sed 's/^/    | /' "${WORK}/out"
    fi
}

# The negative direction. $2 is how many assertions must fire -- stated rather
# than inferred, since two substrings can legitimately belong to one message --
# and every remaining argument is a substring that must appear in a FAIL line.
# An EXTRA assertion firing is a failure of this test, not a bonus. Matching the
# message rather than only the exit status is the whole point: an assertion that
# fired for an unrelated reason is not the assertion under test.
expect_fail() {
    local name="$1" want="$2"
    shift 2
    local got_fail pat unmatched=0
    run_verifier "${FIX}"
    got_fail="$(grep -c '^  FAIL ' "${WORK}/out" || true)"
    for pat in "$@"; do
        grep -F -- "${pat}" "${WORK}/out" | grep -q '^  FAIL ' || {
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
echo "fixture copied from: ${ROOT}/docs"
echo

# --- 0. positive control ----------------------------------------------------
# Without this the negatives below could all be passing because the copy is
# broken in some way that has nothing to do with the mutation.
FIX="${WORK}/baseline"
new_fixture "${FIX}"
expect_all_pass "baseline: the shipped docs tree, copied verbatim"

# --- 1. a task row kept twice by a merge ------------------------------------
# THE CASE THIS FILE EXISTS FOR. Every L3 in a campaign appends its row to
# docs/task/index.md at the same point, so the conflict is a two-row conflict
# and keeping both sides is the likeliest wrong resolution.
FIX="${WORK}/task-row-twice"
new_fixture "${FIX}"
duplicate_line "${FIX}/docs/task/index.md" "(RFCT-073.md)"
expect_fail "docs/task/index.md carrying the RFCT-073 row twice" 1 \
    "carries 2 rows for 'RFCT-073.md'" \
    "lives in two places that can disagree"

# --- 2. the same row kept three times ---------------------------------------
# The message must report the multiplicity it FOUND, not just "not one" -- a
# three-way pile-up and a plain duplicate are different-sized messes and the
# operator resolving it needs to know which one is on the table.
FIX="${WORK}/task-row-thrice"
new_fixture "${FIX}"
duplicate_line "${FIX}/docs/task/index.md" "(RFCT-073.md)" 2
expect_fail "docs/task/index.md carrying the RFCT-073 row three times" 1 \
    "carries 3 rows for 'RFCT-073.md'"

# --- 3. a design/ document listed twice in the README ------------------------
FIX="${WORK}/design-entry-twice"
new_fixture "${FIX}"
duplicate_line "${FIX}/docs/README.md" '  - `api.md`'
expect_fail "docs/README.md listing api.md twice under design/" 1 \
    "lists 'api.md' 2 times under design/" \
    "will drift apart unnoticed"

# --- 4. a research/ document listed twice ------------------------------------
# Section 2 runs the same function as section 1 with a different argument, so
# this proves the directory is a PARAMETER and not baked into the message.
FIX="${WORK}/research-entry-twice"
new_fixture "${FIX}"
research_entry="$(awk '/^- `research\/` /{ inblock = 1; next } /^- /{ inblock = 0 } inblock && /^  - `/ { print; exit }' "${HERE}/README.md")"
[ -n "${research_entry}" ] || { echo "error: no research/ entry found in ${HERE}/README.md to duplicate" >&2; exit 1; }
duplicate_line "${FIX}/docs/README.md" "${research_entry}"
expect_fail "docs/README.md listing a research document twice" 1 \
    "times under research/" \
    "will drift apart unnoticed"

# --- 5. the pre-existing assertions, driven in the failing direction ---------
# Not what this file was written for. They are here so a future edit cannot
# disarm them while the duplicate cases above go on passing.
FIX="${WORK}/dangling-row"
new_fixture "${FIX}"
rm "${FIX}/docs/task/RFCT-073.md"
expect_fail "a row whose record a rename deleted" 1 \
    "has a row for 'RFCT-073.md', but docs/task/RFCT-073.md does not exist"

FIX="${WORK}/unindexed-record"
new_fixture "${FIX}"
cp "${FIX}/docs/task/RFCT-073.md" "${FIX}/docs/task/RFCT-999.md"
expect_fail "a task record with no row" 1 \
    "docs/task/RFCT-999.md exists but has no row in docs/task/index.md"

FIX="${WORK}/dangling-readme-entry"
new_fixture "${FIX}"
rm "${FIX}/docs/design/api.md"
expect_fail "a README entry whose document a rename deleted" 1 \
    "indexes 'api.md' under design/, but docs/design/api.md does not exist"

echo
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} cases)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} cases)"
    exit 1
fi
