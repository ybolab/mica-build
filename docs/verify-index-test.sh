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
# docs/task/index.md, docs/plan/index.md and document tree, copied verbatim.
# Every case then MUTATES that baseline. An index this script had authored
# would prove only that the script can spell. Nothing is hardcoded about how
# many checks the baseline reports, because that number grows with every
# document added.
#
# No root, no network, nothing outside a temp dir. It fails loudly when it
# cannot run rather than skipping.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/.." && pwd)"
VERIFIER="${HERE}/verify-index.sh"

for required in "${VERIFIER}" "${HERE}/README.md" "${HERE}/task/index.md" \
                "${HERE}/plan/index.md"; do
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
    cp -R "${ROOT}/docs/design" "${ROOT}/docs/research" "${ROOT}/docs/task" \
          "${ROOT}/docs/plan" "${dir}/docs/"
}

# docs/plan is copied rather than guarded against. verify-index.sh's plan
# section could have been made skippable when docs/plan/index.md is absent --
# the shape docs/verify-citations.sh uses for its widened scope -- but that
# would leave the section unexercised here, including by the positive control,
# which is the state RFCT-258 was written to end. verify-index.sh is the gate
# that DEFINES what the real tree must contain, so a missing index there is a
# failure and not a reason to fall silent.

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

# --- 6. the checkbox-vs-status assertions (RFCT-171) --------------------------
# The direction that matters is a row ticked `[x]` over a record that still
# says `pending`: that presents an open defect as finished work, and a
# finished-looking row is one nobody opens again (RFCT-144). Each mutation
# below is verified to have landed, for the same reason duplicate_line checks
# its own work: a mutation that silently changed nothing makes the case pass
# for free.
#
# The exemplar record is DISCOVERED from the fixture, not named. These three
# cases were written against RFCT-094 by name, and RFCT-094 was completed at
# e33ef7b -- from that commit on the guard below fired, `exit 1` ran before any
# case reported, and the whole self-test was red for a reason that had nothing
# to do with verify-index.sh. Naming a record here couples a test of the
# ASSERTION to the lifecycle of one task, and every open task eventually
# closes; the property the cases need is "some row is still `[ ]`", which
# `pending_id` reads off the fixture the same way case 4 reads its research
# entry. If a tree ever has no pending row at all, that is reported loudly
# rather than skipped -- see the header.
FIX="${WORK}/checkbox-over-pending"
new_fixture "${FIX}"
pending_id="$(sed -n 's/^- \[ \] \[\*\*\(RFCT-[0-9]*\) .*/\1/p' "${FIX}/docs/task/index.md" | head -1)"
[ -n "${pending_id}" ] || {
    echo "error: no pending '- [ ] [**RFCT-...' row in the fixture index to tick" >&2; exit 1; }
sed -i "s/^- \[ \] \[\*\*${pending_id} /- [x] [**${pending_id} /" "${FIX}/docs/task/index.md"
grep -q "^- \[x\] \[\*\*${pending_id} " "${FIX}/docs/task/index.md" || {
    echo "error: ticking the ${pending_id} row in the fixture index changed nothing" >&2; exit 1; }
expect_fail "a row ticked [x] over a record whose status head is pending" 1 \
    "marks '${pending_id}.md' '[x]'" \
    "status head 'pending', which maps to '[ ]'"

FIX="${WORK}/non-canonical-head"
new_fixture "${FIX}"
pending_rec="$(grep -lxF -- '- **status**: pending' "${FIX}"/docs/task/RFCT-*.md | head -1)"
[ -n "${pending_rec}" ] || {
    echo "error: no record in the fixture carries the bare pending head to mutate" >&2; exit 1; }
pending_rec="$(basename "${pending_rec}")"
sed -i 's/^- \*\*status\*\*: pending$/- **status**: Pending review/' "${FIX}/docs/task/${pending_rec}"
grep -q '^- \*\*status\*\*: Pending review$' "${FIX}/docs/task/${pending_rec}" || {
    echo "error: rewriting the status head in ${pending_rec} changed nothing" >&2; exit 1; }
expect_fail "a status line with a non-canonical head" 1 \
    "docs/task/${pending_rec} status head 'Pending review' is not one of pending|in progress|completed|closed"

FIX="${WORK}/no-status-line"
new_fixture "${FIX}"
grep -q '^- \*\*status\*\*: ' "${FIX}/docs/task/${pending_rec}" || {
    echo "error: ${pending_rec} has no status line to delete" >&2; exit 1; }
sed -i '/^- \*\*status\*\*: /d' "${FIX}/docs/task/${pending_rec}"
expect_fail "a record whose status line was deleted outright" 1 \
    "docs/task/${pending_rec} has no parseable status line"

# --- 7. the plan section (PLAN-028 M3, RFCT-258) -----------------------------
# The plan index went unread by this verifier until RFCT-258, and the defect
# that motivated it is case 7c: `[-]` standing over a `completed` plan file,
# green, until someone caught it by hand (77a3278).
#
# 7a is the FORMAT-EXAMPLE case and the reason the row parser is anchored to
# the `## Plans` section. docs/plan/index.md:11 carries a real `(PLAN-001.md)`
# link and a real `[ ]` marker inside the Usage section; its only other
# distinguishing feature is a literal `YYYY-MM-DD` where a row carries a date.
# So the mutation makes it MAXIMALLY row-shaped -- a real date -- and the
# verifier must still see zero rows there. Without the section anchor this
# fixture produces two failures (PLAN-001 listed twice, and `[ ]` against
# PLAN-001.md's `completed`), which is what a string-matched exclusion of the
# placeholder title would have let back in.
FIX="${WORK}/plan-format-example-is-not-a-row"
new_fixture "${FIX}"
grep -q '^- \[ \] \[\*\*PLAN-001 Short plan title\*\*\](PLAN-001\.md) `YYYY-MM-DD`$' "${FIX}/docs/plan/index.md" || {
    echo "error: the Usage format example is not where this case expects it in docs/plan/index.md" >&2; exit 1; }
sed -i 's/^- \[ \] \[\*\*PLAN-001 Short plan title\*\*\](PLAN-001\.md) `YYYY-MM-DD`$/- [ ] [**PLAN-001 Short plan title**](PLAN-001.md) `2026-01-01`/' "${FIX}/docs/plan/index.md"
grep -q '^- \[ \] \[\*\*PLAN-001 Short plan title\*\*\](PLAN-001\.md) `2026-01-01`$' "${FIX}/docs/plan/index.md" || {
    echo "error: dating the Usage format example changed nothing" >&2; exit 1; }
expect_all_pass "the Usage format example, given a real date, is still not a row"

# 7b: a plan row kept twice, the same append conflict as case 1.
FIX="${WORK}/plan-row-twice"
new_fixture "${FIX}"
duplicate_line "${FIX}/docs/plan/index.md" "(PLAN-020.md)"
expect_fail "docs/plan/index.md carrying the PLAN-020 row twice" 1 \
    "carries 2 rows for 'PLAN-020.md'" \
    "lives in two places that can disagree"

# 7c: THE DEFECT ON RECORD -- `[-]` over a completed plan.
FIX="${WORK}/plan-marker-behind-status"
new_fixture "${FIX}"
grep -q '^- \[x\] \[\*\*PLAN-020 ' "${FIX}/docs/plan/index.md" || {
    echo "error: no completed PLAN-020 row in the fixture plan index to un-tick" >&2; exit 1; }
sed -i 's/^- \[x\] \[\*\*PLAN-020 /- [-] [**PLAN-020 /' "${FIX}/docs/plan/index.md"
expect_fail "a plan row left [-] over a file that says completed" 1 \
    "marks 'PLAN-020.md' '[-]'" \
    "status head 'completed', which maps to '[x]'"

# 7d: an unknown status head FAILS CLOSED. `withdrawn` is a plausible word
# that no plan currently uses and that the Status Markers table does not name,
# which is exactly the case that must not be quietly defaulted.
FIX="${WORK}/plan-unknown-head"
new_fixture "${FIX}"
grep -q '^- \*\*status\*\*: completed$' "${FIX}/docs/plan/PLAN-020.md" || {
    echo "error: PLAN-020.md does not carry the bare completed head to mutate" >&2; exit 1; }
sed -i 's/^- \*\*status\*\*: completed$/- **status**: withdrawn/' "${FIX}/docs/plan/PLAN-020.md"
expect_fail "a plan status head outside the vocabulary" 1 \
    "docs/plan/PLAN-020.md status head 'withdrawn' is not one of"

# 7e: an unknown MARKER fails closed too. `[X]` reads as a tick to a human and
# is not one of the four the index declares.
FIX="${WORK}/plan-unknown-marker"
new_fixture "${FIX}"
sed -i 's/^- \[x\] \[\*\*PLAN-020 /- [X] [**PLAN-020 /' "${FIX}/docs/plan/index.md"
grep -q '^- \[X\] \[\*\*PLAN-020 ' "${FIX}/docs/plan/index.md" || {
    echo "error: rewriting the PLAN-020 marker to [X] changed nothing" >&2; exit 1; }
expect_fail "a plan row marker outside the four the index declares" 1 \
    "marks 'PLAN-020.md' '[X]', which is not one of the four"

# 7f + 7g: both directions of membership.
FIX="${WORK}/plan-unindexed"
new_fixture "${FIX}"
cp "${FIX}/docs/plan/PLAN-020.md" "${FIX}/docs/plan/PLAN-999.md"
expect_fail "a plan file with no row" 1 \
    "docs/plan/PLAN-999.md exists but has no row in the ## Plans section"

FIX="${WORK}/plan-dangling-row"
new_fixture "${FIX}"
rm "${FIX}/docs/plan/PLAN-020.md"
expect_fail "a plan row whose file a rename deleted" 1 \
    "has a row for 'PLAN-020.md', but docs/plan/PLAN-020.md does not exist"

echo
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} cases)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} cases)"
    exit 1
fi
