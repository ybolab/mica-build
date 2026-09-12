#!/usr/bin/env bash
# Negative tests for tools/docs/verify-tracking.sh: each assertion is driven
# against a fixture tree where exactly that fact is false.
#
#   bash tools/docs/verify-tracking-test.sh          (or: make docs-verify-test)
#
# The REAL verifier is copied into ${case}/tools/docs/ and resolves its root
# from ${BASH_SOURCE}, so it reads ${case}/docs. No root, no network.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER="${HERE}/verify-tracking.sh"

[ -e "${VERIFIER}" ] || { echo "error: ${VERIFIER} not found" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $*"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $*"; }

task() { # dir id status owner
    printf '# %s Fixture\n\n- **status**: %s\n- **priority**: P2\n- **owner**: %s\n' "$2" "$3" "$4" >"$1/docs/task/$2.md"
}
plan() { # dir id status relatedTask
    printf '# %s Fixture\n\n- **status**: %s\n- **relatedTask**: %s\n' "$2" "$3" "$4" >"$1/docs/plan/$2.md"
}

# Every marker once, a [d] row without a file, and a format specimen above the
# section heading that must not be read as a row.
new_fixture() {
    local dir="$1"
    rm -rf "${dir}"
    mkdir -p "${dir}/docs/task" "${dir}/docs/plan" "${dir}/tools/docs"
    cp "${VERIFIER}" "${dir}/tools/docs/"
    cat >"${dir}/docs/task/index.md" <<'INDEX'
# Fixture - Task List

### Format

- [ ] [**20260907-1428-add-endpoint Add endpoint**](20260907-1428-add-endpoint.md) `P1`

## Tasks

- [ ] [**20260101-0000-pending Pending task**](20260101-0000-pending.md) `P2`
- [-] [**20260101-0001-active Active task**](20260101-0001-active.md) `P1`
- [x] [**20260101-0002-done Done task**](20260101-0002-done.md) `P1`
- [~] [**20260101-0003-closed Closed task**](20260101-0003-closed.md) `P3`
- [d] [**RFCT-001 Deleted task**](RFCT-001.md) `P2`
INDEX
    task "$dir" 20260101-0000-pending pending '(unassigned)'
    task "$dir" 20260101-0001-active in_progress worker/a
    task "$dir" 20260101-0002-done completed worker/a
    task "$dir" 20260101-0003-closed closed worker/a
    cat >"${dir}/docs/plan/index.md" <<'INDEX'
# Fixture - Plan Index

## Plans

- [ ] [**20260101-0100-draft Draft plan**](20260101-0100-draft.md) `2026-01-01`
- [-] [**20260101-0101-active Active plan**](20260101-0101-active.md) `2026-01-01`
- [x] [**20260101-0102-done Done plan**](20260101-0102-done.md) `2026-01-01`
- [~] [**20260101-0103-rejected Rejected plan**](20260101-0103-rejected.md) `2026-01-01`
- [d] [**PLAN-001 Deleted plan**](PLAN-001.md) `2026-01-01`
INDEX
    plan "$dir" 20260101-0100-draft draft 20260101-0000-pending
    plan "$dir" 20260101-0101-active implementing 20260101-0001-active
    plan "$dir" 20260101-0102-done completed '(none)'
    plan "$dir" 20260101-0103-rejected rejected 20260101-0003-closed
}

run_verifier() {
    RC=0
    bash "$1/tools/docs/verify-tracking.sh" >"${WORK}/out" 2>&1 || RC=$?
}

expect_all_pass() {
    local name="$1" got_fail got_checks
    run_verifier "${FIX}"
    got_fail="$(grep -c '^  FAIL ' "${WORK}/out" || true)"
    got_checks="$(sed -n 's|^tools/docs/verify-tracking.sh: \([0-9]*\)/\1 PASS$|\1|p' "${WORK}/out")"
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

echo "verifier under test: ${VERIFIER}"
echo

FIX="${WORK}/baseline"
new_fixture "${FIX}"
expect_all_pass "baseline: every marker, a [d] row and the format specimen"

FIX="${WORK}/malformed-row"
new_fixture "${FIX}"
sed -i 's/^- \[ \] \[\*\*20260101-0000-pending Pending task\*\*\](20260101-0000-pending.md) `P2`$/- [ ] 20260101-0000-pending Pending task/' \
    "${FIX}/docs/task/index.md"
expect_fail "a row outside the index format" 2 \
    "row does not match the /pma index format" \
    "20260101-0000-pending.md has no row"

FIX="${WORK}/duplicate-row"
new_fixture "${FIX}"
row="$(grep '20260101-0001-active' "${FIX}/docs/task/index.md")"
printf '%s\n' "${row}" >>"${FIX}/docs/task/index.md"
expect_fail "an id with two rows" 1 "20260101-0001-active has more than one row"

FIX="${WORK}/missing-detail"
new_fixture "${FIX}"
rm "${FIX}/docs/task/20260101-0000-pending.md"
expect_fail "a row whose detail file is gone without [d]" 2 \
    "20260101-0000-pending is marked [ ] but" \
    "names relatedTask '20260101-0000-pending'"

FIX="${WORK}/deleted-but-present"
new_fixture "${FIX}"
plan "${FIX}" PLAN-001 draft '(none)'
expect_fail "a [d] row whose detail file still exists" 1 "PLAN-001 is marked [d] but"

FIX="${WORK}/unindexed-detail"
new_fixture "${FIX}"
task "${FIX}" 20260101-0009-orphan pending '(unassigned)'
expect_fail "a detail file with no row" 1 "20260101-0009-orphan.md has no row"

FIX="${WORK}/marker-status-mismatch"
new_fixture "${FIX}"
sed -i 's/^- \*\*status\*\*: in_progress$/- **status**: completed/' "${FIX}/docs/task/20260101-0001-active.md"
expect_fail "a record whose status disagrees with its marker" 1 \
    "has status 'completed' but its row is [-], which requires 'in_progress'"

FIX="${WORK}/noncanonical-status"
new_fixture "${FIX}"
sed -i 's/^- \*\*status\*\*: draft$/- **status**: approved/' "${FIX}/docs/plan/20260101-0100-draft.md"
expect_fail "a plan status outside the /pma set" 1 "has status 'approved' but its row is [ ]"

FIX="${WORK}/missing-owner"
new_fixture "${FIX}"
sed -i '/^- \*\*owner\*\*/d' "${FIX}/docs/task/20260101-0002-done.md"
expect_fail "a task without an owner line" 1 "has 0 owner lines"

FIX="${WORK}/dead-related-task"
new_fixture "${FIX}"
sed -i 's/^- \*\*relatedTask\*\*: 20260101-0001-active$/- **relatedTask**: RFCT-404/' "${FIX}/docs/plan/20260101-0101-active.md"
expect_fail "a plan naming a task that does not exist" 1 "names relatedTask 'RFCT-404'"

FIX="${WORK}/no-rows"
new_fixture "${FIX}"
printf '# empty\n\n## Tasks\n' >"${FIX}/docs/task/index.md"
printf '# empty\n\n## Plans\n' >"${FIX}/docs/plan/index.md"
rm "${FIX}"/docs/task/2026*.md "${FIX}"/docs/plan/2026*.md
expect_fail "indexes with zero rows" 1 "no index rows found"

echo
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} cases)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} cases)"
    exit 1
fi
