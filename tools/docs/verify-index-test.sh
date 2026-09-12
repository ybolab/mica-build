#!/usr/bin/env bash
# Negative tests for tools/docs/verify-index.sh -- in particular for the "once each"
# assertion, which is the half that catches a document listed TWICE.
#
#   bash tools/docs/verify-index-test.sh          (or: make docs-verify-test)
#
# WHY THIS EXISTS. `make docs-verify` passed just as happily before the
# duplicate assertion existed: with a second row injected into an index the
# verifier reported N/N PASS and exit 0, and the CHECK COUNT DID NOT MOVE
# either, so the before/after count comparison this project otherwise leans on
# could not see it. An assertion nobody has ever seen FAIL is equally
# consistent with an assertion that CANNOT fail, which is what it was: forward
# was a `grep -q`, satisfied by one occurrence or by five, and reverse dedupes
# its input with `sort -u` before the loop that would have noticed. So each
# assertion is driven here against an index in which its fact is FALSE, and
# each is required to fail -- and to fail with ITS OWN message, because an
# assertion that fires for an unrelated reason is not the assertion under test.
#
# The two membership assertions -- a document with no row, a row with no
# document -- are driven the same way, so that a future edit cannot quietly
# disarm them while the duplicate case goes on passing.
#
# HOW. The REAL tools/docs/verify-index.sh is run, once per case, over a COPY of the
# real docs tree with one mutation applied. Nothing is reimplemented here; a
# reimplementation would be testing this file's idea of the assertion rather
# than the assertion. The verifier resolves its own root from ${BASH_SOURCE},
# so a copy at ${case}/tools/docs/verify-index.sh reads ${case}/docs -- no environment
# hook is needed and the real tree is never written to.
#
# The baseline is not hand-written either: it is the SHIPPED docs/README.md
# and design tree, copied verbatim.
# Every case then MUTATES that baseline. An index this script had authored
# would prove only that the script can spell. Nothing is hardcoded about how
# many checks the baseline reports, because that number grows with every
# document added.
#
# No root, no network, nothing outside a temp dir. It fails loudly when it
# cannot run rather than skipping.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
VERIFIER="${HERE}/verify-index.sh"

for required in "${VERIFIER}" "${ROOT}/docs/README.md"; do
    [ -e "${required}" ] || { echo "error: ${required} not found" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

# THE EXEMPLAR TASK RECORD, DISCOVERED RATHER THAN NAMED. Cases 1, 2 and 5
# need one real record that is indexed exactly once and whose file exists:
# case 1 duplicates its row, case 5 deletes its file and copies it. They were
# written against RFCT-073 BY NAME, which is the same defect the exemplar at
# case 6 had -- and it is not milder for having a different trigger. Three
# distinct paths abort the whole run: duplicate_line `exit 1`s unless the row
# appears exactly once, and `set -e` kills the run on the `rm` and the `cp` if
# the record is gone. Case 1 is the SECOND case, so an abort there reports one
# case instead of the eight the RFCT-094 abort reached.
#
# The trigger is rarer than RFCT-094's -- a record deletion or rename, or the
# row appearing twice -- but "rare" is what "nobody has ever seen it fail"
# means, and this file exists because that is not evidence. The rule it now
# follows, campaign-wide: a self-test fixture names a SYNTHETIC id or
# discovers its exemplar from the fixture. A live id is a scheduled silent
# death.
#
# This helper's own `exit 1` is not the same hazard. It fires only when NO row
# in the whole index is usable, which means the shipped index is already
# broken and tools/docs/verify-index.sh is already red.

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $*"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $*"; }

# A copy of everything the verifier reads, and nothing else.
new_fixture() {
    local dir="$1"
    rm -rf "${dir}"
    mkdir -p "${dir}/docs" "${dir}/tools/docs"
    cp "${ROOT}/docs/README.md" "${dir}/docs/"
    cp "${VERIFIER}" "${dir}/tools/docs/"
    cp -R "${ROOT}/docs/design" "${ROOT}/docs/user" "${ROOT}/docs/website" \
          "${ROOT}/docs/boards" "${ROOT}/docs/research" "${dir}/docs/"
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
    bash "$1/tools/docs/verify-index.sh" >"${WORK}/out" 2>&1 || RC=$?
}

# The positive control.
expect_all_pass() {
    local name="$1" got_fail got_checks
    run_verifier "${FIX}"
    got_fail="$(grep -c '^  FAIL ' "${WORK}/out" || true)"
    got_checks="$(sed -n 's|^tools/docs/verify-index.sh: \([0-9]*\)/\1 PASS$|\1|p' "${WORK}/out")"
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

# --- 1. a design/ document listed twice in the README ------------------------
FIX="${WORK}/design-entry-twice"
new_fixture "${FIX}"
# `wifi.md`, not `api.md`: `api.md` has a row under BOTH design/ and user/,
# and duplicate_line rightly aborts on a pattern that is not unique in the file.
duplicate_line "${FIX}/docs/README.md" '  - `wifi.md`'
expect_fail "docs/README.md listing wifi.md twice under design/" 1 \
    "lists 'wifi.md' 2 times under design/" \
    "will drift apart unnoticed"

# --- 2. the pre-existing assertions, driven in the failing direction ---------
# Not what this file was written for. They are here so a future edit cannot
# disarm them while the duplicate case above goes on passing.
FIX="${WORK}/dangling-readme-entry"
new_fixture "${FIX}"
rm "${FIX}/docs/design/api.md"
expect_fail "a README entry whose document a rename deleted" 1 \
    "indexes 'api.md' under design/, but docs/design/api.md does not exist"

# The forward direction, and the one this gate exists for: a document that is
# never listed is not broken, does not fail a build, and is simply never found
# again. It had no case of its own until the task section left, because the
# task half of this pair was carrying it.
FIX="${WORK}/unindexed-document"
new_fixture "${FIX}"
cp "${FIX}/docs/design/api.md" "${FIX}/docs/design/unlisted.md"
expect_fail "a design document with no README row" 1 \
    "docs/design/unlisted.md exists but is not indexed in docs/README.md"

# --- 3. the other trees, one case per check_readme_dir call ------------------
# Each call is driven in a failing direction once, rotating the assertion
# type, so removing any single call from verify-index.sh turns a case here red. The mutated names are chosen to be unique across the whole
# README -- `api.md` appears under both design/ and user/, and duplicate_line
# would rightly abort on an ambiguous pattern.
FIX="${WORK}/user-entry-twice"
new_fixture "${FIX}"
duplicate_line "${FIX}/docs/README.md" '  - `quickstart.md`'
expect_fail "docs/README.md listing quickstart.md twice under user/" 1 \
    "lists 'quickstart.md' 2 times under user/" \
    "will drift apart unnoticed"

FIX="${WORK}/dangling-website-entry"
new_fixture "${FIX}"
rm "${FIX}/docs/website/downloads.md"
expect_fail "a website README entry whose document is gone" 1 \
    "indexes 'downloads.md' under website/, but docs/website/downloads.md does not exist"

FIX="${WORK}/unindexed-boards-document"
new_fixture "${FIX}"
cp "${FIX}/docs/boards/porting.md" "${FIX}/docs/boards/unlisted.md"
expect_fail "a boards document with no README row" 1 \
    "docs/boards/unlisted.md exists but is not indexed in docs/README.md"

FIX="${WORK}/dangling-research-entry"
new_fixture "${FIX}"
rm "${FIX}/docs/research/root-closure.md"
expect_fail "a research README entry whose document is gone" 1 \
    "indexes 'root-closure.md' under research/, but docs/research/root-closure.md does not exist"

echo
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} cases)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} cases)"
    exit 1
fi
