#!/usr/bin/env bash
# Negative tests for tools/docs/verify-terms.sh: each refused term or citation
# is placed in an otherwise clean fixture tree.
#
#   bash tools/docs/verify-terms-test.sh          (or: make docs-verify-test)
#
# The REAL verifier is copied into ${case}/tools/docs/ and resolves its root
# from ${BASH_SOURCE}, so it reads ${case}/docs. No root, no network.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER="${HERE}/verify-terms.sh"

[ -e "${VERIFIER}" ] || { echo "error: ${VERIFIER} not found" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $*"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $*"; }

# A clean page citing an existing record, a fenced block that may say anything,
# and history files outside the scope that may name removed systems.
new_fixture() {
    local dir="$1"
    rm -rf "${dir}"
    mkdir -p "${dir}/docs/design" "${dir}/docs/plan" "${dir}/docs/task" \
             "${dir}/docs/decisions" "${dir}/tools/docs"
    cp "${VERIFIER}" "${dir}/tools/docs/"
    printf '# record\n' >"${dir}/docs/task/20260101-0000-open-work.md"
    cat >"${dir}/docs/design/page.md" <<'PAGE'
# fixture page

Data lives on DATA/state. Open work: 20260101-0000-open-work.

```text
STATE RAUC PLAN-001 are allowed inside a fence
```
PAGE
    printf '# Changelog\n\nRemoved RAUC and PLAN-001.\n' >"${dir}/docs/changelog.md"
    printf '# old\n\nRFCT-001 used RAUC.\n' >"${dir}/docs/task/RFCT-001.md"
}

run_verifier() {
    RC=0
    bash "$1/tools/docs/verify-terms.sh" >"${WORK}/out" 2>&1 || RC=$?
}

expect_all_pass() {
    local name="$1" got_fail got_checks
    run_verifier "${FIX}"
    got_fail="$(grep -c '^  FAIL ' "${WORK}/out" || true)"
    got_checks="$(sed -n 's|^tools/docs/verify-terms.sh: \([0-9]*\)/\1 PASS$|\1|p' "${WORK}/out")"
    if [ "${RC}" -eq 0 ] && [ "${got_fail}" -eq 0 ] && [ -n "${got_checks}" ]; then
        pass "${name}: ${got_checks}/${got_checks}, no failures, exit 0"
    else
        fail "${name}: expected a clean N/N PASS and exit 0, got ${got_fail} failure(s) / exit ${RC}"
        sed 's/^/    | /' "${WORK}/out"
    fi
}

# $2 is how many assertions must fire; every remaining argument is a substring
# that must appear in a FAIL line. An extra assertion firing fails the case.
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
        pass "${name}: ${want} assertion(s) fail, exit ${RC}"
    else
        fail "${name}: expected ${want} FAIL line(s) and a non-zero exit, got ${got_fail} FAIL / exit ${RC}"
        sed 's/^/    | /' "${WORK}/out"
    fi
}

append() { printf '\n%s\n' "$2" >>"$1"; }

echo "verifier under test: ${VERIFIER}"
echo

FIX="${WORK}/baseline"
new_fixture "${FIX}"
expect_all_pass "baseline: clean prose, a fenced block and out-of-scope history"

for term in RAUC TUF lode raw-slot STATE connd; do
    FIX="${WORK}/term-${term}"
    new_fixture "${FIX}"
    append "${FIX}/docs/design/page.md" "The device once used ${term} here."
    expect_fail "prose naming '${term}'" 1 "uses '${term}'"
done

FIX="${WORK}/boot-credit"
new_fixture "${FIX}"
append "${FIX}/docs/design/page.md" "A failed boot burns boot credits."
expect_fail "prose naming boot credits" 1 "uses 'boot credits'"

FIX="${WORK}/numbered-record"
new_fixture "${FIX}"
append "${FIX}/docs/design/page.md" "Decided in PLAN-070 section 5."
expect_fail "a numbered record ID" 1 "uses 'PLAN-070'"

FIX="${WORK}/deleted-record"
new_fixture "${FIX}"
append "${FIX}/docs/design/page.md" "See the delivery record (20260908-2229-file-ab-delivery)."
expect_fail "a timestamped ID with no record" 1 \
    "cites '20260908-2229-file-ab-delivery', which is not a record"

FIX="${WORK}/no-files"
new_fixture "${FIX}"
rm "${FIX}/docs/design/page.md"
expect_fail "no permanent documents at all" 1 "no permanent documents found"

echo
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} cases)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} cases)"
    exit 1
fi
