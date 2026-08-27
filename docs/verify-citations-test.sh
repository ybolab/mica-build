#!/usr/bin/env bash
# Negative tests for docs/verify-citations.sh. Every assertion that checker
# makes is driven here against a document in which its fact is false, and is
# required to fail -- and to fail with its own message, because an assertion
# that fired for an unrelated reason is not the assertion under test.
#
#   bash docs/verify-citations-test.sh          (or: make docs-verify-citations-test)
#
# Why this exists. The checker's own report is the thing most able to lie: it
# skips citations it cannot resolve on purpose -- host and port pairs, bare
# filenames, upstream trees this repository does not contain -- and a report
# that prints "N checked" while quietly dropping the rest reads green while a
# whole category was never opened. So the skipped counts and the provenance
# limit are asserted here as output, not just as behaviour, and one case runs a
# document with nothing skipped at all to prove the categories still print when
# their count is zero.
#
# How. The REAL docs/verify-citations.sh is run, once per case, over a small
# fixture tree it resolves as its own repo root from ${BASH_SOURCE}. Nothing is
# reimplemented here.
#
# The fixture is authored rather than copied from the shipped documents, which
# is the one place this file departs from docs/verify-index-test.sh. The
# shipped corpus is red today -- the comment cleanup moved the lines a few
# hundred citations point at -- so it cannot serve as the positive control, and
# a control that starts red proves nothing about the mutations layered on it.
# The fixture is therefore small enough that every count in the summary is
# stated below by hand and asserted exactly.
#
# No root, no network, nothing outside a temp dir. It fails loudly when it
# cannot run rather than skipping.
#
# The single-quoted strings below carry backticked `path:line` tokens on
# purpose: they are the literal text of a citation, not a command substitution.
# shellcheck disable=SC2016
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKER="${HERE}/verify-citations.sh"

[ -e "${CHECKER}" ] || { echo "error: ${CHECKER} not found" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $*"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $*"; }

# The fixture tree. Two documents in scope, one cited source file of exactly
# ten lines, and one directory that exists at the root so that `mosd/...` is in
# scope while `u-boot/...` is not.
#
# The baseline document holds seven citations: two in scope carrying a quote,
# one in scope carrying none, two host-and-port pairs, one upstream tree, and
# one bare filename. Every case below mutates that.
new_fixture() {
    local dir="$1" n
    rm -rf "${dir}"
    mkdir -p "${dir}/docs/design" "${dir}/mosd/apid/src"
    cp "${CHECKER}" "${dir}/docs/verify-citations.sh"

    cat >"${dir}/mosd/apid/src/settings_api.rs" <<'RS'
//! Fixture source for the citation checker tests.
/// The power actions are here rather than executed locally because mosd owns
/// every system action: apid never spawns a process and never talks to
/// systemd itself.
pub trait SettingsApi {
    fn reboot(&self);
}
const COOKIE: &str = "Path=/; HttpOnly; Secure";

// end of fixture
RS
    n=$(awk 'END { print NR }' "${dir}/mosd/apid/src/settings_api.rs")
    [ "${n}" -eq 10 ] || {
        echo "error: the fixture source is ${n} lines, and every line assertion below is written for 10" >&2
        exit 1
    }

    cat >"${dir}/docs/architecture.md" <<'MD'
# Architecture

This fixture document cites nothing.
MD

    cat >"${dir}/docs/design/fixture.md" <<'MD'
# Fixture

The trait doc states it as a rule: *"apid never spawns a process and never
talks to systemd itself"* (`mosd/apid/src/settings_api.rs:2-4`).

The session cookie carries `Path=/; HttpOnly; Secure`
(`mosd/apid/src/settings_api.rs:8`).

The trait is declared at `mosd/apid/src/settings_api.rs:5`, and this sentence
quotes nothing of it.

The plain listener binds `0.0.0.0:80` and the TLS listener binds `0.0.0.0:443`.

The board firmware reads its environment from (`u-boot/env/mmc.c:118`).

The handler lives at `routes.rs:95-105` in the file named above.
MD
}

# Appends a paragraph to the fixture document.
add_para() {
    printf '\n%s\n' "$2" >>"$1/docs/design/fixture.md"
}

# Replaces $3 with $4 in file $2 under fixture $1, and fails loudly if $3 was
# not there exactly once: a mutation that silently changed nothing would make
# the case that follows it pass for free.
must_replace() {
    local dir="$1" file="$2" from="$3" to="$4" before after
    before=$(grep -cF -- "${from}" "${dir}/${file}")
    [ "${before}" -eq 1 ] || {
        echo "error: ${file} has ${before} lines containing '${from}', expected exactly 1" >&2
        exit 1
    }
    awk -v f="${from}" -v t="${to}" '
        { i = index($0, f); if (i > 0) $0 = substr($0, 1, i - 1) t substr($0, i + length(f)) ; print }
    ' "${dir}/${file}" >"${dir}/${file}.new"
    mv "${dir}/${file}.new" "${dir}/${file}"
    after=$(grep -cF -- "${to}" "${dir}/${file}")
    [ "${after}" -ge 1 ] || {
        echo "error: replacing '${from}' with '${to}' in ${file} produced nothing" >&2
        exit 1
    }
    echo "    | ${file}: '${from}' -> '${to}'"
}

# Runs the REAL checker over fixture ${FIX}, leaving its output in ${WORK}/out
# and its exit status in ${RC}. Any argument is passed straight through.
run_checker() {
    RC=0
    bash "${FIX}/docs/verify-citations.sh" "$@" >"${WORK}/out" 2>&1 || RC=$?
}

# The positive control.
expect_all_pass() {
    local name="$1" got_fail
    run_checker
    got_fail="$(grep -c '^  FAIL ' "${WORK}/out" || true)"
    if [ "${RC}" -eq 0 ] && [ "${got_fail}" -eq 0 ] && grep -q ': 3/3 PASS$' "${WORK}/out"; then
        pass "${name}: 3/3, no failures, exit 0"
    else
        fail "${name}: expected a clean 3/3 PASS and exit 0, got ${got_fail} failure(s) / exit ${RC}"
        sed 's/^/    | /' "${WORK}/out"
    fi
}

# The negative direction. $2 is how many assertions must fire -- stated rather
# than inferred -- and every remaining argument is a substring that must appear
# in a FAIL line. An EXTRA assertion firing is a failure of this test.
expect_fail() {
    local name="$1" want="$2"
    shift 2
    local got_fail pat unmatched=0
    run_checker
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

# Every argument is a line that must appear in the report verbatim.
expect_report() {
    local name="$1"
    shift
    local pat missing=0
    for pat in "$@"; do
        grep -qF -- "${pat}" "${WORK}/out" || { missing=1; echo "    | absent from the report: ${pat}"; }
    done
    if [ "${missing}" -eq 0 ]; then
        pass "${name}"
    else
        fail "${name}"
        sed 's/^/    | /' "${WORK}/out"
    fi
}

echo "checker under test: ${CHECKER}"
echo "fixture root:       ${WORK}"
echo

# --- 0. positive control ----------------------------------------------------
# Without this, every negative below could be passing because the fixture is
# broken in some way that has nothing to do with the mutation.
FIX="${WORK}/baseline"
new_fixture "${FIX}"
expect_all_pass "baseline: two quoted citations that still match, one unquoted, three skipped"

# --- 1. the report names every category, with its count ----------------------
# The failure mode this whole check exists to prevent is a green report that
# never examined part of its input. The counts are asserted against a fixture
# whose contents are known exactly.
expect_report "the report counts what it skipped, by reason, and what it never examined" \
    "documents scanned:      2" \
    "citations found:        7" \
    "in scope:               3" \
    "skipped, path is outside this repository's tree: 1" \
    "skipped, bare filename with no directory to resolve against: 1" \
    "skipped, a host and a port rather than a citation: 2" \
    "in-scope citations carrying a quote: 2" \
    "in-scope citations carrying no quote, resolution checked only: 1" \
    "a provenance claim such as \"measured at <commit>\" is validated against no file at all"

# --- 2. the categories print even when nothing fell into them ----------------
# A report that omits a line whose count is zero cannot be read as a statement
# about the whole input, only about the part that happened to be interesting.
FIX="${WORK}/nothing-skipped"
new_fixture "${FIX}"
cat >"${FIX}/docs/design/fixture.md" <<'MD'
# Fixture

The trait is declared at `mosd/apid/src/settings_api.rs:5`, and this sentence
quotes nothing of it.
MD
run_checker
expect_report "a document with nothing skipped still prints all three skipped categories" \
    "skipped, path is outside this repository's tree: 0" \
    "skipped, bare filename with no directory to resolve against: 0" \
    "skipped, a host and a port rather than a citation: 0"

# --- 3. resolution: a path that is not there ---------------------------------
FIX="${WORK}/missing-path"
new_fixture "${FIX}"
add_para "${FIX}" 'The helper lives at `mosd/apid/src/gone.rs:3` and nothing quotes it.'
expect_fail "a citation into a file no longer in the tree" 1 \
    'cites `mosd/apid/src/gone.rs:3`, and mosd/apid/src/gone.rs does not exist'

# --- 4. resolution: a path that resolves to a directory ----------------------
FIX="${WORK}/not-a-file"
new_fixture "${FIX}"
mkdir -p "${FIX}/mosd/apid/src/tools"
add_para "${FIX}" 'The toolset sits at `mosd/apid/src/tools:3` in the tree.'
expect_fail "a citation whose path is a directory" 1 \
    'cites `mosd/apid/src/tools:3`, and mosd/apid/src/tools is not a regular file'

# --- 5. resolution: a line past the end of the file --------------------------
# The cited paragraph quotes nothing, so this also proves check 1 runs on a
# citation that check 2 will never look at.
FIX="${WORK}/past-eof"
new_fixture "${FIX}"
add_para "${FIX}" 'The tail is at `mosd/apid/src/settings_api.rs:99`, unquoted.'
expect_fail "an unquoted citation past the end of the cited file" 1 \
    'cites `mosd/apid/src/settings_api.rs:99`, and mosd/apid/src/settings_api.rs has 10 lines'

# --- 6. resolution: a range whose far end is past the end --------------------
FIX="${WORK}/range-past-eof"
new_fixture "${FIX}"
add_para "${FIX}" 'The block runs `mosd/apid/src/settings_api.rs:5-40` here.'
expect_fail "a range that starts inside the file and ends past it" 1 \
    'cites `mosd/apid/src/settings_api.rs:5-40`, and mosd/apid/src/settings_api.rs has 10 lines'

# --- 7. resolution: line zero ------------------------------------------------
FIX="${WORK}/line-zero"
new_fixture "${FIX}"
add_para "${FIX}" 'The head is at `mosd/apid/src/settings_api.rs:0` here.'
expect_fail "a citation of line zero" 1 \
    'cites `mosd/apid/src/settings_api.rs:0`, and line numbers start at 1'

# --- 8. resolution: a negative line ------------------------------------------
FIX="${WORK}/line-negative"
new_fixture "${FIX}"
add_para "${FIX}" 'The head is at `mosd/apid/src/settings_api.rs:-3` here.'
expect_fail "a citation of a negative line" 1 \
    'cites `mosd/apid/src/settings_api.rs:-3`, and line numbers start at 1'

# --- 9. content: the citing document renames what it quotes ------------------
# The case that decides resolution-only against content-matching. The path
# still exists and the lines are still there, so check 1 passes; only the
# quoted identifier moved.
FIX="${WORK}/quote-renamed-in-doc"
new_fixture "${FIX}"
must_replace "${FIX}" docs/design/fixture.md "apid never spawns" "webd never spawns"
expect_fail "a quotation whose daemon name the document changed" 1 \
    'quotes "webd never spawns a process and never talks to systemd itself", and that text is not at `mosd/apid/src/settings_api.rs:2-4`'

# --- 10. content: the source moves out from under the quotation --------------
FIX="${WORK}/quote-renamed-in-source"
new_fixture "${FIX}"
must_replace "${FIX}" mosd/apid/src/settings_api.rs "apid never spawns" "webd never spawns"
expect_fail "a quotation the source renamed underneath it" 1 \
    'quotes "apid never spawns a process and never talks to systemd itself", and that text is not at `mosd/apid/src/settings_api.rs:2-4`'

# --- 11. content: a quoted code span the source no longer carries ------------
FIX="${WORK}/code-span-drift"
new_fixture "${FIX}"
must_replace "${FIX}" mosd/apid/src/settings_api.rs "Path=/; HttpOnly; Secure" "Path=/; HttpOnly"
expect_fail "a quoted code span the source has shortened" 1 \
    'quotes "Path=/; HttpOnly; Secure", and that text is not at `mosd/apid/src/settings_api.rs:8`'

# --- 12. content: the comparison survives a reflow and an emphasis -----------
# The control for the normalisation. The quotation is rewrapped at different
# points and one of its words is bolded; none of that is a change to what the
# document claims, so none of it may turn the check red.
FIX="${WORK}/reflowed-quote"
new_fixture "${FIX}"
cat >"${FIX}/docs/design/fixture.md" <<'MD'
# Fixture

The trait doc states it as a rule:
*"apid **never** spawns a process
and never talks to systemd itself"*
(`mosd/apid/src/settings_api.rs:2-4`).

The session cookie carries `Path=/; HttpOnly; Secure`
(`mosd/apid/src/settings_api.rs:8`).

The trait is declared at `mosd/apid/src/settings_api.rs:5`, and this sentence
quotes nothing of it.

The plain listener binds `0.0.0.0:80` and the TLS listener binds `0.0.0.0:443`.

The board firmware reads its environment from (`u-boot/env/mmc.c:118`).

The handler lives at `routes.rs:95-105` in the file named above.
MD
expect_all_pass "a quotation rewrapped and bolded, cited unchanged"

# --- 13. a host and a port is skipped, not resolved --------------------------
# If the pair were treated as a citation it would fail to resolve, so a clean
# run over a document holding nothing else is the assertion.
FIX="${WORK}/host-port-only"
new_fixture "${FIX}"
cat >"${FIX}/docs/design/fixture.md" <<'MD'
# Fixture

The plain listener binds `0.0.0.0:80` and the TLS listener binds `0.0.0.0:443`.
MD
run_checker
if [ "${RC}" -eq 0 ] && grep -q 'a host and a port rather than a citation: 2' "${WORK}/out" \
   && grep -q 'in scope:               0' "${WORK}/out"; then
    pass "a document of nothing but host and port pairs: 2 skipped, 0 in scope, exit 0"
else
    fail "a document of nothing but host and port pairs: expected 2 skipped, 0 in scope, exit 0, got exit ${RC}"
    sed 's/^/    | /' "${WORK}/out"
fi

# --- 14. an upstream tree is skipped, and counted ----------------------------
FIX="${WORK}/upstream-only"
new_fixture "${FIX}"
cat >"${FIX}/docs/design/fixture.md" <<'MD'
# Fixture

The board firmware reads its environment (`u-boot/env/mmc.c:118`), and the
server is `axum-0.8.9/src/routing/mod.rs:212`.
MD
run_checker
if [ "${RC}" -eq 0 ] && grep -q "outside this repository's tree: 2" "${WORK}/out" \
   && grep -q 'in scope:               0' "${WORK}/out"; then
    pass "a document of nothing but upstream citations: 2 skipped, 0 in scope, exit 0"
else
    fail "a document of nothing but upstream citations: expected 2 skipped, 0 in scope, exit 0, got exit ${RC}"
    sed 's/^/    | /' "${WORK}/out"
fi

# --- 15. --advisory reports the same failures and exits 0 --------------------
FIX="${WORK}/advisory"
new_fixture "${FIX}"
add_para "${FIX}" 'The helper lives at `mosd/apid/src/gone.rs:3` and nothing quotes it.'
run_checker --advisory
if [ "${RC}" -eq 0 ] \
   && grep -q '^  FAIL .*mosd/apid/src/gone.rs does not exist' "${WORK}/out" \
   && grep -q 'advisory run' "${WORK}/out"; then
    pass "--advisory: the failure is still reported, the run still says it is advisory, exit 0"
else
    fail "--advisory: expected the failure reported and exit 0, got exit ${RC}"
    sed 's/^/    | /' "${WORK}/out"
fi

echo
total=$((PASS_N + FAIL_N))
if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} cases)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} cases)"
    exit 1
fi
