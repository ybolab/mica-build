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
# Each fixture is a git repository, because the checker resolves the no-slash
# citation form against `git ls-files` (RFCT-256). Nothing is committed: `git
# add` is enough to populate the index `ls-files` reads, and run_checker
# refreshes it immediately before every run so a case that writes a file after
# new_fixture needs no bookkeeping of its own.
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
command -v git >/dev/null 2>&1 || {
    echo "error: git is not on PATH, and the checker needs it to resolve the no-slash form" >&2
    exit 1
}

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

PASS_N=0
FAIL_N=0
pass() { PASS_N=$((PASS_N + 1)); echo "PASS: $*"; }
fail() { FAIL_N=$((FAIL_N + 1)); echo "FAIL: $*"; }

# The fixture tree. Two documents in scope, one cited source file of exactly
# ten lines, one directory that exists at the root so that `os/...` is in
# scope while `u-boot/...` is not, and a census baseline naming that one
# segment with its exact count as the floor.
#
# The baseline document holds eight citations: three in scope carrying a quote
# -- two with the quote before the citation, one with the quote directly after
# it -- one in scope carrying none, two host-and-port pairs, one upstream
# tree, and one bare filename. Every case below mutates that. The
# unquoted-ratchet baseline pins the fixture document at a ceiling of 4 rather
# than its count of 1, because the chained (case 17) and near-miss (case 18)
# mutations push the count to 3 and 4 and must stay green.
new_fixture() {
    local dir="$1" n
    rm -rf "${dir}"
    mkdir -p "${dir}/docs/design" "${dir}/os/pkgs/mosd/apid/src"
    git init -q "${dir}"
    cp "${CHECKER}" "${dir}/docs/verify-citations.sh"

    cat >"${dir}/os/pkgs/mosd/apid/src/settings_api.rs" <<'RS'
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
    n=$(awk 'END { print NR }' "${dir}/os/pkgs/mosd/apid/src/settings_api.rs")
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
talks to systemd itself"* (`os/pkgs/mosd/apid/src/settings_api.rs:2-4`).

The session cookie carries `Path=/; HttpOnly; Secure`
(`os/pkgs/mosd/apid/src/settings_api.rs:8`).

Cited first and quoted after: `os/pkgs/mosd/apid/src/settings_api.rs:5`
`pub trait SettingsApi` sits directly after its citation.

The trait is declared at `os/pkgs/mosd/apid/src/settings_api.rs:5`, and this sentence
quotes nothing of it.

The plain listener binds `0.0.0.0:80` and the TLS listener binds `0.0.0.0:443`.

The board firmware reads its environment from (`u-boot/env/mmc.c:118`).

The handler lives at `routes.rs:95-105` in the file named above.
MD

    cat >"${dir}/docs/verify-citations-baseline.txt" <<'TXT'
# Fixture census floors: every in-scope citation here starts with os/.
os 4
TXT

    cat >"${dir}/docs/verify-citations-unquoted-baseline.txt" <<'TXT'
# Fixture unquoted ceilings: fixture.md carries one unquoted citation; see
# the fixture comment for why the ceiling sits at 4.
docs/design/fixture.md 4
TXT
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
    # The index is what `git ls-files` reads, and a case may have written files
    # after new_fixture returned; refreshing here keeps every case honest
    # without each one remembering to.
    git -C "${FIX}" add -A >/dev/null 2>&1
    bash "${FIX}/docs/verify-citations.sh" "$@" >"${WORK}/out" 2>&1 || RC=$?
}

# The positive control. $2 states the expected pass ratio, `4/4`, because a
# case that rewrites the document changes how many citations are in scope.
expect_all_pass() {
    local name="$1" want="$2" got_fail
    run_checker
    got_fail="$(grep -c '^  FAIL ' "${WORK}/out" || true)"
    if [ "${RC}" -eq 0 ] && [ "${got_fail}" -eq 0 ] && grep -q ": ${want} PASS$" "${WORK}/out"; then
        pass "${name}: ${want}, no failures, exit 0"
    else
        fail "${name}: expected a clean ${want} PASS and exit 0, got ${got_fail} failure(s) / exit ${RC}"
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
expect_all_pass "baseline: three quoted citations that still match, one unquoted, three skipped" "4/4"

# --- 1. the report names every category, with its count ----------------------
# The failure mode this whole check exists to prevent is a green report that
# never examined part of its input. The counts are asserted against a fixture
# whose contents are known exactly. The by-document no-quote lines are the
# census RFCT-173 will ratchet, so their exact shape is pinned here.
expect_report "the report counts what it skipped, by reason, and what it never examined" \
    "documents scanned:      2" \
    "exempted as dated records, citations not checked: 0" \
    "citations found:        8" \
    "in scope:               4" \
    "in scope, first segment os/: 4" \
    "in scope, bare filename resolved against the tracked files: 0" \
    "skipped, path is outside this repository's tree: 1" \
    "skipped, bare filename matching no tracked file, so outside this tree: 1" \
    "skipped, bare filename quoted as an example of the citation form: 0" \
    "skipped, a host and a port rather than a citation: 2" \
    "ambiguous bare filenames: 0" \
    "census failures:        0" \
    "ratchet failures:       0" \
    "in-scope citations carrying a quote: 3" \
    "in-scope citations carrying no quote, resolution checked only: 1" \
    "no quote, by document: docs/architecture.md 0" \
    "no quote, by document: docs/design/fixture.md 1" \
    "near-miss: no quote armed, but a quoted span sits 1-3 words away: 0" \
    "a provenance claim such as \"measured at <commit>\" is validated against no file at all"

# --- 2. the categories print even when nothing fell into them ----------------
# A report that omits a line whose count is zero cannot be read as a statement
# about the whole input, only about the part that happened to be interesting.
FIX="${WORK}/nothing-skipped"
new_fixture "${FIX}"
cat >"${FIX}/docs/design/fixture.md" <<'MD'
# Fixture

The trait is declared at `os/pkgs/mosd/apid/src/settings_api.rs:5`, and this sentence
quotes nothing of it.
MD
cat >"${FIX}/docs/verify-citations-baseline.txt" <<'TXT'
# One citation left in this fixture, so the floor drops with it.
os 1
TXT
run_checker
expect_report "a document with nothing skipped still prints every skipped category" \
    "skipped, path is outside this repository's tree: 0" \
    "skipped, bare filename matching no tracked file, so outside this tree: 0" \
    "skipped, bare filename quoted as an example of the citation form: 0" \
    "skipped, a host and a port rather than a citation: 0"

# --- 3. resolution: a path that is not there ---------------------------------
FIX="${WORK}/missing-path"
new_fixture "${FIX}"
add_para "${FIX}" 'The helper lives at `os/pkgs/mosd/apid/src/gone.rs:3` and nothing quotes it.'
expect_fail "a citation into a file no longer in the tree" 1 \
    'cites `os/pkgs/mosd/apid/src/gone.rs:3`, and os/pkgs/mosd/apid/src/gone.rs does not exist'

# --- 4. resolution: a path that resolves to a directory ----------------------
FIX="${WORK}/not-a-file"
new_fixture "${FIX}"
mkdir -p "${FIX}/os/pkgs/mosd/apid/src/tools"
add_para "${FIX}" 'The toolset sits at `os/pkgs/mosd/apid/src/tools:3` in the tree.'
expect_fail "a citation whose path is a directory" 1 \
    'cites `os/pkgs/mosd/apid/src/tools:3`, and os/pkgs/mosd/apid/src/tools is not a regular file'

# --- 5. resolution: a line past the end of the file --------------------------
# The cited paragraph quotes nothing, so this also proves check 1 runs on a
# citation that check 2 will never look at.
FIX="${WORK}/past-eof"
new_fixture "${FIX}"
add_para "${FIX}" 'The tail is at `os/pkgs/mosd/apid/src/settings_api.rs:99`, unquoted.'
expect_fail "an unquoted citation past the end of the cited file" 1 \
    'cites `os/pkgs/mosd/apid/src/settings_api.rs:99`, and os/pkgs/mosd/apid/src/settings_api.rs has 10 lines'

# --- 6. resolution: a range whose far end is past the end --------------------
FIX="${WORK}/range-past-eof"
new_fixture "${FIX}"
add_para "${FIX}" 'The block runs `os/pkgs/mosd/apid/src/settings_api.rs:5-40` here.'
expect_fail "a range that starts inside the file and ends past it" 1 \
    'cites `os/pkgs/mosd/apid/src/settings_api.rs:5-40`, and os/pkgs/mosd/apid/src/settings_api.rs has 10 lines'

# --- 7. resolution: line zero ------------------------------------------------
FIX="${WORK}/line-zero"
new_fixture "${FIX}"
add_para "${FIX}" 'The head is at `os/pkgs/mosd/apid/src/settings_api.rs:0` here.'
expect_fail "a citation of line zero" 1 \
    'cites `os/pkgs/mosd/apid/src/settings_api.rs:0`, and line numbers start at 1'

# --- 8. resolution: a negative line ------------------------------------------
FIX="${WORK}/line-negative"
new_fixture "${FIX}"
add_para "${FIX}" 'The head is at `os/pkgs/mosd/apid/src/settings_api.rs:-3` here.'
expect_fail "a citation of a negative line" 1 \
    'cites `os/pkgs/mosd/apid/src/settings_api.rs:-3`, and line numbers start at 1'

# --- 9. content: the citing document renames what it quotes ------------------
# The case that decides resolution-only against content-matching. The path
# still exists and the lines are still there, so check 1 passes; only the
# quoted identifier moved.
FIX="${WORK}/quote-renamed-in-doc"
new_fixture "${FIX}"
must_replace "${FIX}" docs/design/fixture.md "apid never spawns" "webd never spawns"
expect_fail "a quotation whose daemon name the document changed" 1 \
    'quotes "webd never spawns a process and never talks to systemd itself", and that text is not at `os/pkgs/mosd/apid/src/settings_api.rs:2-4`'

# --- 10. content: the source moves out from under the quotation --------------
FIX="${WORK}/quote-renamed-in-source"
new_fixture "${FIX}"
must_replace "${FIX}" os/pkgs/mosd/apid/src/settings_api.rs "apid never spawns" "webd never spawns"
expect_fail "a quotation the source renamed underneath it" 1 \
    'quotes "apid never spawns a process and never talks to systemd itself", and that text is not at `os/pkgs/mosd/apid/src/settings_api.rs:2-4`'

# --- 11. content: a quoted code span the source no longer carries ------------
FIX="${WORK}/code-span-drift"
new_fixture "${FIX}"
must_replace "${FIX}" os/pkgs/mosd/apid/src/settings_api.rs "Path=/; HttpOnly; Secure" "Path=/; HttpOnly"
expect_fail "a quoted code span the source has shortened" 1 \
    'quotes "Path=/; HttpOnly; Secure", and that text is not at `os/pkgs/mosd/apid/src/settings_api.rs:8`'

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
(`os/pkgs/mosd/apid/src/settings_api.rs:2-4`).

The session cookie carries `Path=/; HttpOnly; Secure`
(`os/pkgs/mosd/apid/src/settings_api.rs:8`).

Cited first and quoted after:
`os/pkgs/mosd/apid/src/settings_api.rs:5`
*`pub trait **SettingsApi**`* sits after, rewrapped and bolded too.

The trait is declared at `os/pkgs/mosd/apid/src/settings_api.rs:5`, and this sentence
quotes nothing of it.

The plain listener binds `0.0.0.0:80` and the TLS listener binds `0.0.0.0:443`.

The board firmware reads its environment from (`u-boot/env/mmc.c:118`).

The handler lives at `routes.rs:95-105` in the file named above.
MD
expect_all_pass "a quotation rewrapped and bolded, cited unchanged, in both orders" "4/4"

# --- 13. a host and a port is skipped, not resolved --------------------------
# If the pair were treated as a citation it would fail to resolve, so a clean
# run over a document holding nothing else is the assertion.
FIX="${WORK}/host-port-only"
new_fixture "${FIX}"
cat >"${FIX}/docs/design/fixture.md" <<'MD'
# Fixture

The plain listener binds `0.0.0.0:80` and the TLS listener binds `0.0.0.0:443`.
MD
cat >"${FIX}/docs/verify-citations-baseline.txt" <<'TXT'
# Nothing is in scope in this fixture, so no segment carries a floor.
TXT
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
cat >"${FIX}/docs/verify-citations-baseline.txt" <<'TXT'
# Nothing is in scope in this fixture, so no segment carries a floor.
TXT
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
add_para "${FIX}" 'The helper lives at `os/pkgs/mosd/apid/src/gone.rs:3` and nothing quotes it.'
run_checker --advisory
if [ "${RC}" -eq 0 ] \
   && grep -q '^  FAIL .*os/pkgs/mosd/apid/src/gone.rs does not exist' "${WORK}/out" \
   && grep -q 'advisory run' "${WORK}/out"; then
    pass "--advisory: the failure is still reported, the run still says it is advisory, exit 0"
else
    fail "--advisory: expected the failure reported and exit 0, got exit ${RC}"
    sed 's/^/    | /' "${WORK}/out"
fi

# --- 16. content: a misquote that FOLLOWS its citation -----------------------
# The RFCT-163 ordering: before the forward rule this pairing never armed, so
# a wrong quote after its citation was resolution-checked only and green.
FIX="${WORK}/quote-after-citation-misquote"
new_fixture "${FIX}"
add_para "${FIX}" 'The cookie line (`os/pkgs/mosd/apid/src/settings_api.rs:8`) *`Path=/; HttpOnly; Wrong`* is quoted after its citation.'
expect_fail "a misquote that follows its citation, the ordering that never armed before" 1 \
    'quotes "Path=/; HttpOnly; Wrong", and that text is not at `os/pkgs/mosd/apid/src/settings_api.rs:8`'

# --- 17. a chained citation after a citation is still not a quote ------------
# The forward rule inherits the backward rule's exclusion: `a:1` `a:2` is a
# chain, not a quotation, so both stay unquoted and the run stays green.
FIX="${WORK}/chained-forward"
new_fixture "${FIX}"
add_para "${FIX}" 'The trait spans `os/pkgs/mosd/apid/src/settings_api.rs:5` `os/pkgs/mosd/apid/src/settings_api.rs:6` as a pair of unquoted citations.'
run_checker
if [ "${RC}" -eq 0 ] && grep -q ': 6/6 PASS$' "${WORK}/out" \
   && grep -qF 'no quote, by document: docs/design/fixture.md 3' "${WORK}/out"; then
    pass "a chained citation directly after a citation is not a quote: both unquoted, 6/6, exit 0"
else
    fail "a chained citation directly after a citation: expected 6/6 with 3 unquoted in fixture.md, got exit ${RC}"
    sed 's/^/    | /' "${WORK}/out"
fi

# --- 18. the interposed-word boundary: N=0 arms, 1-3 words is a near-miss ----
# The zero-tolerance decision, proved at its edges: one interposed word (the
# RFCT-155 "around" case) does not arm the content check even on a WRONG
# quote -- the run stays green -- but the demotion is counted, at one word and
# at three; at four words the span is no longer a near-miss.
FIX="${WORK}/near-miss-boundary"
new_fixture "${FIX}"
add_para "${FIX}" 'The flags are `Path=/; HttpOnly; Wrong` around (`os/pkgs/mosd/apid/src/settings_api.rs:8`).'
add_para "${FIX}" 'The flags are `Path=/; HttpOnly; Wrong` three words before (`os/pkgs/mosd/apid/src/settings_api.rs:8`).'
add_para "${FIX}" 'The flags are `Path=/; HttpOnly; Wrong` set four words before (`os/pkgs/mosd/apid/src/settings_api.rs:8`).'
run_checker
if [ "${RC}" -eq 0 ] && [ "$(grep -c '^  FAIL ' "${WORK}/out" || true)" -eq 0 ] \
   && grep -q ': 7/7 PASS$' "${WORK}/out" \
   && grep -qF 'near-miss: no quote armed, but a quoted span sits 1-3 words away: 2' "${WORK}/out"; then
    pass "one interposed word demotes a wrong quote to green, and 1-3 words count as near-miss while 4 do not"
else
    fail "the interposed-word boundary: expected 7/7, exit 0 and a near-miss count of 2, got exit ${RC}"
    sed 's/^/    | /' "${WORK}/out"
fi

# --- 19. census: the cited tree's root directory vanishes --------------------
# The RFCT-167 class. Deleting os/ reclassifies every citation into it as
# skipped-outside; without the census the run prints 0/0 PASS and exits 0.
FIX="${WORK}/segment-vanishes"
new_fixture "${FIX}"
rm -rf "${FIX}/os"
expect_fail "the cited root directory deleted: every citation leaves scope, and the census fails" 1 \
    'segment os has 0 in-scope citations, and docs/verify-citations-baseline.txt names it with floor 4'

# --- 20. census: one citation removed while the floor stands -----------------
FIX="${WORK}/segment-below-floor"
new_fixture "${FIX}"
must_replace "${FIX}" docs/design/fixture.md 'declared at `os/pkgs/mosd/apid/src/settings_api.rs:5`' 'declared in the fixture source'
expect_fail "a segment count dropping below its committed floor" 1 \
    'segment os has 3 in-scope citations, below its floor 4 in docs/verify-citations-baseline.txt; lower the floor in the same commit'

# --- 21. widened scope: a stale citation in a task document fails -------------
# The RFCT-159 finding-a class. Before the widening, docs/task was scanned by
# no gate and this citation would have read green by omission.
FIX="${WORK}/task-doc-stale"
new_fixture "${FIX}"
mkdir -p "${FIX}/docs/task"
cat >"${FIX}/docs/task/RFCT-999.md" <<'MD'
# RFCT-999 Fixture task record

The helper this record leans on lives at `os/pkgs/mosd/apid/src/gone.rs:3`, and this
sentence quotes nothing of it.
MD
expect_fail "a stale citation in a non-exempt task document" 1 \
    'docs/task/RFCT-999.md:3 cites `os/pkgs/mosd/apid/src/gone.rs:3`, and os/pkgs/mosd/apid/src/gone.rs does not exist'

# --- 22. the dated-record marker exempts the document, and the census says so -
# The SAME document and the SAME stale citation as case 21; the only change is
# the marker. The run must go green, and "left alone" must be evidenced: the
# exemption count and the per-file census line are asserted verbatim.
FIX="${WORK}/task-doc-exempt"
new_fixture "${FIX}"
mkdir -p "${FIX}/docs/task"
cat >"${FIX}/docs/task/RFCT-999.md" <<'MD'
# RFCT-999 Fixture task record

The helper this record leans on lives at `os/pkgs/mosd/apid/src/gone.rs:3`, and this
sentence quotes nothing of it.

<!-- dated-record: fixture worklist frozen at a past commit -->
MD
run_checker
if [ "${RC}" -eq 0 ] && [ "$(grep -c '^  FAIL ' "${WORK}/out" || true)" -eq 0 ] \
   && grep -q ': 4/4 PASS$' "${WORK}/out" \
   && grep -qF 'documents scanned:      3' "${WORK}/out" \
   && grep -qF 'exempted as dated records, citations not checked: 1' "${WORK}/out" \
   && grep -qF 'dated record: docs/task/RFCT-999.md' "${WORK}/out"; then
    pass "the marker exempts the stale document, 4/4 green, and the census names the file"
else
    fail "the marker on the stale document: expected 4/4, exit 0 and a census naming docs/task/RFCT-999.md, got exit ${RC}"
    sed 's/^/    | /' "${WORK}/out"
fi

# --- 23. no silent exemptions: a marker on any scanned file prints ------------
# The marker exempts whichever file carries it, including one nobody classified
# as dated -- here the design fixture document. The census must name it anyway:
# review reads the census, so an exemption that printed nothing would be the
# silent left-alone this mechanism exists to prevent. The baseline is emptied
# because the marked document held every in-scope citation.
FIX="${WORK}/marker-outside-dated-list"
new_fixture "${FIX}"
printf '\n%s\n' '<!-- dated-record: a marker nobody put on the dated list -->' \
    >>"${FIX}/docs/design/fixture.md"
cat >"${FIX}/docs/verify-citations-baseline.txt" <<'TXT'
# The only citing document is exempted in this fixture, so no floor is named.
TXT
run_checker
if [ "${RC}" -eq 0 ] \
   && grep -qF 'in scope:               0' "${WORK}/out" \
   && grep -qF 'exempted as dated records, citations not checked: 1' "${WORK}/out" \
   && grep -qF 'dated record: docs/design/fixture.md' "${WORK}/out"; then
    pass "a marker on a file outside the dated list still prints in the census"
else
    fail "a marker outside the dated list: expected exit 0 and a census naming docs/design/fixture.md, got exit ${RC}"
    sed 's/^/    | /' "${WORK}/out"
fi

# --- 24. ratchet: a document above its unquoted ceiling -----------------------
# Class 1 held by policy. The mutation lowers the fixture's committed ceiling
# under the document's one unquoted citation -- the same diff shape as a new
# unquoted citation landing in a document already at its ceiling.
FIX="${WORK}/ratchet-exceeded"
new_fixture "${FIX}"
cat >"${FIX}/docs/verify-citations-unquoted-baseline.txt" <<'TXT'
# The fixture document is pinned below its real count of 1.
docs/design/fixture.md 0
TXT
expect_fail "a document exceeding its unquoted ceiling" 1 \
    'docs/design/fixture.md has 1 unquoted citations, above its ceiling 0 in docs/verify-citations-unquoted-baseline.txt; quote the new citation, or raise the ceiling in the same commit'

# --- 25. ratchet: a new document with no baseline row starts at 0 -------------
# The citation resolves, so no other check can catch it; only the default
# ceiling of 0 makes a new document start fully quoted.
FIX="${WORK}/ratchet-new-doc"
new_fixture "${FIX}"
mkdir -p "${FIX}/docs/task"
cat >"${FIX}/docs/task/RFCT-999.md" <<'MD'
# RFCT-999 Fixture task record

The trait is declared at `os/pkgs/mosd/apid/src/settings_api.rs:5`, and this
record quotes nothing of it.
MD
expect_fail "a new document with no baseline row gets ceiling 0" 1 \
    'docs/task/RFCT-999.md has 1 unquoted citations, above its ceiling 0 in docs/verify-citations-unquoted-baseline.txt'

# --- 26. ratchet: a decrease passes under an unchanged ceiling ----------------
# The ratchet is one-directional. The unquoted citation is removed (the same
# mutation as case 20) and the census floor is lowered with it, the sanctioned
# same-commit edit; the ratchet row stays at 4 and the run stays green.
FIX="${WORK}/ratchet-decrease"
new_fixture "${FIX}"
must_replace "${FIX}" docs/design/fixture.md 'declared at `os/pkgs/mosd/apid/src/settings_api.rs:5`' 'declared in the fixture source'
cat >"${FIX}/docs/verify-citations-baseline.txt" <<'TXT'
# The floor drops with the removed citation, the sanctioned same-commit edit.
os 3
TXT
expect_all_pass "an unquoted count dropping below its ceiling" "3/3"

# --- 27. the no-slash form resolves by unique basename, and is checked --------
# The RFCT-256 class. `settings_api.rs:2-4` was skipped as shorthand before
# this rule, so its quotation was checked by nothing at all; now it resolves
# against the one tracked file of that name and the quote is compared.
FIX="${WORK}/bare-unique"
new_fixture "${FIX}"
add_para "${FIX}" 'The rule again, cited short: *"apid never spawns a process and never talks to systemd itself"* (`settings_api.rs:2-4`).'
expect_all_pass "a bare filename with exactly one tracked match, quoted and correct" "5/5"
expect_report "the resolved bare citation is counted as such, under the segment it resolved to" \
    "in scope, bare filename resolved against the tracked files: 1" \
    "in scope, first segment os/: 5"

# --- 28. the no-slash form goes red when its quotation no longer holds --------
# The point of case 27: resolving the form is only worth doing if the content
# check then bites. The message names where the bare filename landed.
FIX="${WORK}/bare-unique-misquote"
new_fixture "${FIX}"
add_para "${FIX}" 'The cookie is `Path=/; HttpOnly; Wrong` (`settings_api.rs:8`).'
expect_fail "a bare filename resolving to a file that does not carry the quoted text" 1 \
    'quotes "Path=/; HttpOnly; Wrong", and that text is not at `settings_api.rs:8` (resolved to os/pkgs/mosd/apid/src/settings_api.rs)'

# --- 29. a bare filename that IS a tracked path, at the repository root -------
# `Makefile:1` carries no directory because it has none. The exact-path branch
# runs before the basename branch, so a root file is never ambiguous, and it
# counts in the census under its own name.
FIX="${WORK}/bare-root-file"
new_fixture "${FIX}"
cat >"${FIX}/Makefile" <<'MK'
# fixture root Makefile, one target and no heavy lifting
all:
	@echo fixture
MK
add_para "${FIX}" 'The root recipe says of itself `fixture root Makefile, one target and no heavy lifting` (`Makefile:1`).'
expect_all_pass "a bare filename that is itself a tracked repository-root path" "5/5"
expect_report "a repository-root file counts as its own census segment" \
    "in scope, first segment Makefile/: 1" \
    "in scope, bare filename resolved against the tracked files: 1"

# --- 30. several candidates is an error that names them all -------------------
# Never a guess and never the first match: the fix belongs in the document.
FIX="${WORK}/bare-ambiguous"
new_fixture "${FIX}"
mkdir -p "${FIX}/os/pkgs/mosd/mosd/src"
cp "${FIX}/os/pkgs/mosd/apid/src/settings_api.rs" "${FIX}/os/pkgs/mosd/mosd/src/settings_api.rs"
add_para "${FIX}" 'The trait is declared at `settings_api.rs:5`, and this sentence quotes nothing of it.'
expect_fail "a bare filename matching two tracked files" 1 \
    'cites `settings_api.rs:5`, and settings_api.rs is the basename of several tracked files: os/pkgs/mosd/apid/src/settings_api.rs os/pkgs/mosd/mosd/src/settings_api.rs'

# --- 31. a metalinguistic example is skipped, with its own reason -------------
# The trap this encodes, exactly as the corpus carries it: docs/task/RFCT-214.md
# writes `` `routes.rs:2545` `` as an example of the FORM under discussion, and
# `routes.rs` resolves uniquely into a file thousands of lines long. A naive
# basename rule resolves that token, finds the line, and reports it green while
# the document asserted nothing whatever about it -- a citation counted as
# checked that was never a citation. So the fixture below carries a long file
# with a unique basename and two form examples against it: one at a line that
# EXISTS, which is the silent-green half, and one past the end, which is the
# loud half.
#
# Removing the skip fails this case twice over: the in-scope count grows past
# 4/4 and the skip line drops to 0 (the first paragraph), and the second
# paragraph raises a resolution failure. A fixture that could not fail on the
# defect it was built for is what docs/verify-index.sh's header warns against.
FIX="${WORK}/bare-metalinguistic"
new_fixture "${FIX}"
awk 'BEGIN { for (i = 1; i <= 200; i++) print "// fixture routes line " i }' \
    >"${FIX}/os/pkgs/mosd/apid/src/routes.rs"
add_para "${FIX}" 'A document naming the form writes it `` `routes.rs:120` ``, and line 120 of that file exists.'
add_para "${FIX}" 'The same example past the end of the file: `` `routes.rs:2545` ``.'
# The fixture document's own closing paragraph carries a plain `routes.rs:95-105`,
# which the long file above now resolves; that is why five citations are in
# scope here and four in the baseline fixture.
run_checker
if [ "${RC}" -eq 0 ] && [ "$(grep -c '^  FAIL ' "${WORK}/out" || true)" -eq 0 ] \
   && grep -q ': 5/5 PASS$' "${WORK}/out" \
   && grep -qF 'in scope:               5' "${WORK}/out" \
   && grep -qF 'skipped, bare filename quoted as an example of the citation form: 2' "${WORK}/out"; then
    pass "a bare filename inside a double-backtick span is skipped as an example, resolvable or not"
else
    fail "a metalinguistic bare filename: expected 5/5, exit 0, 5 in scope and a skip count of 2, got exit ${RC}"
    sed 's/^/    | /' "${WORK}/out"
fi

# --- 32. no candidate at all is a counted skip, never a failure ---------------
# `localhost:8080` is a host and a port whose host is not digits and dots, and
# `do_mounts.c:1442` cites a kernel this repository does not contain. A gate
# that failed on either would be broken rather than strict.
FIX="${WORK}/bare-no-candidate"
new_fixture "${FIX}"
add_para "${FIX}" 'The dev server answers on `localhost:8080`, and the kernel mounts root in `do_mounts.c:1442`.'
run_checker
if [ "${RC}" -eq 0 ] && [ "$(grep -c '^  FAIL ' "${WORK}/out" || true)" -eq 0 ] \
   && grep -q ': 4/4 PASS$' "${WORK}/out" \
   && grep -qF 'skipped, bare filename matching no tracked file, so outside this tree: 3' "${WORK}/out"; then
    pass "bare filenames matching no tracked file are skipped and counted, and the run stays green"
else
    fail "bare filenames with no candidate: expected 4/4, exit 0 and a skip count of 3, got exit ${RC}"
    sed 's/^/    | /' "${WORK}/out"
fi

# --- 33. the table trap: a quote in the ADJACENT cell never arms -------------
# Measured by probing the real extractor: `|` is not in the backward scan's
# skippable set (`[ \t\n*_(]`), so a quoted fragment sitting in the cell before
# a citation is separated from it by a character the scan stops on, and the
# pair never arms. Writing a re-measurement as a two-column table therefore
# converts every one of its citations to resolution-only, silently -- which is
# a format choice manufacturing a class, not an authoring mistake.
#
# Both halves are pinned here, because the useful half is the fix. The SAME
# wrong quote is written twice against the same citation: across a pipe, where
# it stays green and is surfaced only as a near-miss, and inside the citation's
# OWN cell, where it arms and the content check bites. Exactly one FAIL, and it
# is the second row.
FIX="${WORK}/table-cell-arming"
new_fixture "${FIX}"
add_para "${FIX}" '| claim | citation |
|---|---|
| `Path=/; HttpOnly; Wrong` | (`os/pkgs/mosd/apid/src/settings_api.rs:8`) |
| the cookie | `Path=/; HttpOnly; Wrong` (`os/pkgs/mosd/apid/src/settings_api.rs:8`) |'
expect_fail "a wrong quote arms inside the citation's own table cell and not across the pipe" 1 \
    'quotes "Path=/; HttpOnly; Wrong", and that text is not at `os/pkgs/mosd/apid/src/settings_api.rs:8`'
expect_report "the demoted across-the-pipe pairing is surfaced as a near-miss, not silence" \
    "near-miss: no quote armed, but a quoted span sits 1-3 words away: 1"

echo
total=$((PASS_N + FAIL_N))

if [ "${FAIL_N}" -eq 0 ]; then
    echo "RESULT: PASS (${PASS_N}/${total} cases)"
else
    echo "RESULT: FAIL (${PASS_N}/${total} cases)"
    exit 1
fi
