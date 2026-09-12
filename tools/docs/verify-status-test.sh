#!/usr/bin/env bash
# Negative tests for tools/docs/verify-status.sh: each enforcement clause of the
# truth-status grammar is driven against a fixture in which its fact is
# false, and is required to fail with ITS OWN message.
#
#   bash tools/docs/verify-status-test.sh          (or: make docs-verify-test)
#
# HOW. The REAL tools/docs/verify-status.sh is run, once per case, over a fixture
# tree. The verifier resolves its own root from ${BASH_SOURCE}, so a copy at
# ${case}/tools/docs/verify-status.sh reads ${case}/docs and ${case}/Makefile --
# the approach verify-index-test.sh established.
#
# The baseline is SYNTHETIC: the real trees' evidence refs point across the
# whole repository (boards/, pkgs/, the Makefile's targets), so a verbatim
# copy of docs/ alone cannot be green. The fixture instead carries one valid
# line per status -- shipped with a path ref, board-dependent with a `make`
# ref, proposed with a plan ref, bare unsupported -- and the positive control
# proves the fixture green before any mutation is trusted to be what turned
# it red.
#
# No root, no network, nothing outside a temp dir.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER="${HERE}/verify-status.sh"

[ -e "${VERIFIER}" ] || { echo "error: ${VERIFIER} not found" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $*"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $*"; }

# One page per scanned tree, together covering all four statuses and both
# evidence forms (repository path, `make <target>`), plus the referenced
# artifacts themselves.
new_fixture() {
    local dir="$1"
    rm -rf "${dir}"
    mkdir -p "${dir}/docs/user" "${dir}/docs/website" "${dir}/docs/boards" \
             "${dir}/docs/plan" "${dir}/docs/task" "${dir}/pkgs"
    mkdir -p "${dir}/tools/docs"
    cp "${VERIFIER}" "${dir}/tools/docs/"
    : >"${dir}/pkgs/artifact.json"
    printf '# 20260101-0000-fixture-plan\n' >"${dir}/docs/plan/20260101-0000-fixture-plan.md"
    printf '# 20260101-0001-fixture-task\n' >"${dir}/docs/task/20260101-0001-fixture-task.md"
    printf '# Plans\n\n- [ ] [**20260101-0000-fixture-plan Fixture plan**](20260101-0000-fixture-plan.md) `2026-01-01`\n' \
        >"${dir}/docs/plan/index.md"
    printf '# Tasks\n\n- [-] [**20260101-0001-fixture-task Fixture task**](20260101-0001-fixture-task.md) `P2`\n' \
        >"${dir}/docs/task/index.md"
    cat >"${dir}/Makefile" <<'EOF'
fixture-check other-target:
	true
EOF
    cat >"${dir}/docs/user/page.md" <<'EOF'
# fixture user page

> status: shipped — evidence: `pkgs/artifact.json`, `docs/plan/`

> status: unsupported
EOF
    cat >"${dir}/docs/website/page.md" <<'EOF'
# fixture website page

> status: board-dependent — evidence: `make fixture-check`
EOF
    cat >"${dir}/docs/boards/page.md" <<'EOF'
# fixture boards page

> status: proposed — evidence: `docs/plan/20260101-0000-fixture-plan.md`

> status: proposed — evidence: `docs/task/20260101-0001-fixture-task.md`
EOF
}

# Replaces the whole status line matching $2 in file $1 with $3, refusing to
# "succeed" when the pattern was not there: a mutation that changed nothing
# would make the case below pass for free.
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

run_verifier() {
    RC=0
    bash "$1/tools/docs/verify-status.sh" >"${WORK}/out" 2>&1 || RC=$?
}

expect_all_pass() {
    local name="$1" got_fail got_checks
    run_verifier "${FIX}"
    got_fail="$(grep -c '^  FAIL ' "${WORK}/out" || true)"
    got_checks="$(sed -n 's|^tools/docs/verify-status.sh: \([0-9]*\)/\1 PASS$|\1|p' "${WORK}/out")"
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
expect_all_pass "baseline: all four statuses, both evidence forms"

# --- 1. a status word outside the taxonomy -----------------------------------
FIX="${WORK}/unknown-status"
new_fixture "${FIX}"
replace_line "${FIX}/docs/user/page.md" '> status: unsupported' \
    '> status: planned'
expect_fail "a status word outside the taxonomy" 1 \
    "does not parse -- '> status: planned'"

# --- 2. the wrong separator --------------------------------------------------
# A hyphen instead of the em dash: the whole rest of the line is then read as
# the status word, which is not in the taxonomy.
FIX="${WORK}/hyphen-separator"
new_fixture "${FIX}"
replace_line "${FIX}/docs/website/page.md" '> status: board-dependent — evidence:' \
    '> status: board-dependent - evidence: `make fixture-check`'
expect_fail "a hyphen where the grammar demands an em dash" 1 \
    "does not parse -- '> status: board-dependent - evidence:"

# --- 3. an unquoted evidence ref ---------------------------------------------
FIX="${WORK}/unquoted-ref"
new_fixture "${FIX}"
replace_line "${FIX}/docs/website/page.md" '> status: board-dependent — evidence:' \
    '> status: board-dependent — evidence: make fixture-check'
expect_fail "an evidence ref without backticks" 1 \
    "evidence list does not parse"

# --- 4. shipped with no evidence ---------------------------------------------
FIX="${WORK}/shipped-bare"
new_fixture "${FIX}"
replace_line "${FIX}/docs/user/page.md" '> status: shipped — evidence:' \
    '> status: shipped'
expect_fail "shipped without evidence" 1 \
    "shipped requires evidence"

# --- 5. a dead path ref ------------------------------------------------------
FIX="${WORK}/dead-path-ref"
new_fixture "${FIX}"
rm "${FIX}/pkgs/artifact.json"
expect_fail "evidence citing a path a rename deleted" 1 \
    "evidence 'pkgs/artifact.json' does not exist"

# --- 6. a make target the Makefile does not define ---------------------------
FIX="${WORK}/dead-make-ref"
new_fixture "${FIX}"
replace_line "${FIX}/docs/website/page.md" '`make fixture-check`' \
    '> status: board-dependent — evidence: `make no-such-target`'
expect_fail "evidence citing an undefined make target" 1 \
    "evidence 'make no-such-target' does not exist"

# --- 7. proposed without a record ref ----------------------------------------
# The cited path exists, but it is not a tracking record. The baseline cites
# both an open plan and an open task, so a verifier that accepts only one of
# them fails the positive control, not this case.
FIX="${WORK}/proposed-no-plan"
new_fixture "${FIX}"
replace_line "${FIX}/docs/boards/page.md" '`docs/plan/20260101-0000-fixture-plan.md`' \
    '> status: proposed — evidence: `pkgs/artifact.json`'
expect_fail "proposed citing no plan record" 1 \
    "proposed requires an open docs/plan/ or docs/task/ record ref"

# --- 7b. proposed citing the plan index -------------------------------------
# docs/plan/index.md always exists; it is the list, not a record.
FIX="${WORK}/proposed-index-only"
new_fixture "${FIX}"
replace_line "${FIX}/docs/boards/page.md" '`docs/plan/20260101-0000-fixture-plan.md`' \
    '> status: proposed — evidence: `docs/plan/index.md`'
expect_fail "proposed citing only the plan index" 1 \
    "proposed requires an open docs/plan/ or docs/task/ record ref"

# --- 8. proposed citing a plan that does not exist ---------------------------
# Two assertions fire, and both are wanted: the ref is dead, AND no existing
# plan ref remains to satisfy the proposed clause.
FIX="${WORK}/proposed-dead-plan"
new_fixture "${FIX}"
rm "${FIX}/docs/plan/20260101-0000-fixture-plan.md"
expect_fail "proposed citing a deleted plan record" 2 \
    "evidence 'docs/plan/20260101-0000-fixture-plan.md' does not exist" \
    "proposed requires an open docs/plan/ or docs/task/ record ref"

# --- 8b. proposed citing a record that has completed --------------------------
# The file still exists, but its row is `[x]`: the page must be relabelled.
FIX="${WORK}/proposed-completed-record"
new_fixture "${FIX}"
sed -i 's/^- \[-\] \[\*\*20260101-0001-fixture-task /- [x] [**20260101-0001-fixture-task /' \
    "${FIX}/docs/task/index.md"
expect_fail "proposed citing a completed task record" 1 \
    "proposed requires an open docs/plan/ or docs/task/ record ref"

# --- 9. unsupported carrying evidence ----------------------------------------
FIX="${WORK}/unsupported-evidence"
new_fixture "${FIX}"
replace_line "${FIX}/docs/user/page.md" '> status: unsupported' \
    '> status: unsupported — evidence: `pkgs/artifact.json`'
expect_fail "unsupported with an evidence clause" 1 \
    "unsupported carries no evidence"

# --- 10. a tree with zero status lines ---------------------------------------
FIX="${WORK}/vacuous-tree"
new_fixture "${FIX}"
printf '# fixture website page\n\nno claims here.\n' >"${FIX}/docs/website/page.md"
expect_fail "a scanned tree with no status lines at all" 1 \
    "docs/website/ contains zero status lines"

echo
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} cases)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} cases)"
    exit 1
fi
