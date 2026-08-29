#!/usr/bin/env bash
# Asserts that the three document indexes agree with the tree, in BOTH
# directions. Read-only: it opens files and prints, and changes nothing.
#
#   bash docs/verify-index.sh          (or: make docs-verify)
#
# Four sections, each checked forward and backward:
#
#   1. docs/design/*.md      <-> docs/README.md
#   2. docs/research/*.md    <-> docs/README.md
#   3. docs/task/RFCT-*.md   <-> docs/task/index.md
#   4. docs/plan/PLAN-*.md   <-> docs/plan/index.md
#
# The reverse direction is the half that is easy to omit and the half that
# catches a rename: a forward-only check passes happily on an index full of
# entries pointing at files that no longer exist.
#
# docs/README.md's per-entry DESCRIPTION bullets are NOT asserted against the
# documents they describe, DELIBERATELY (PLAN-020 M2 "space 3", decided in
# docs/task/RFCT-171.md). There is no shared token to assert: the bullets and
# the documents' first headings are independently written prose -- the README
# says "connd.md -- unified connectivity service: WiFi STA/AP, Bluetooth,
# CAN" while connd.md's own H1 says "Design: connd -- WiFi station and access
# point on the systemd/mosd base" -- and zero of the 21 indexed design/
# research files carry a bullet equal to their heading under any punctuation
# or case normalization. An equality contract would mean rewriting one side
# tree-wide, content edits in settled documents that M2's scope forbids; and
# a keyword-overlap heuristic goes green exactly where the one measured lying
# bullet lives, because "WiFi" appears in both the wrong bullet and the true
# heading (RFCT-159 finding d, the connd case). A check that cannot fail on
# the defect it was built for is not a check, so membership stays mechanical
# here and description truth stays a review concern.
#
# `*.zh.md` is excluded DELIBERATELY, and this is not an oversight to be
# "fixed" later. Whether the existing Chinese translations are kept current is
# a decision parked with the user and unresolved (see the rules paragraph in
# docs/README.md). Until that is resolved a translated sibling is not required
# to be indexed, and must not fail this check.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

README=docs/README.md
TASK_INDEX=docs/task/index.md
PLAN_INDEX=docs/plan/index.md
FAIL=0
CHECKS=0

fail() { echo "  FAIL $*" >&2; FAIL=$((FAIL + 1)); }
ok()   { CHECKS=$((CHECKS + 1)); }

# The document names the README lists under one directory bullet, one per
# line. The README's shape is a top-level `- \`design/\` -- ...` bullet
# followed by two-space-indented `  - \`name.md\` -- ...` entries, so an entry
# is attributed to the directory bullet above it and prose elsewhere in the
# file is never mistaken for an index entry.
readme_entries_under() {
    awk -v dir="$1/" '
        /^- `[^`]+\/` /       { inblock = ($0 ~ "^- `" dir "` "); next }
        /^- /                 { inblock = 0; next }
        inblock && /^  - `/   { if (match($0, /`[^`]+`/)) {
                                    e = substr($0, RSTART + 1, RLENGTH - 2)
                                    print e
                                } }
    ' "$README"
}

# --- sections 1 and 2: docs/<dir>/*.md <-> docs/README.md ------------------
check_readme_dir() {
    local dir=$1 f base entry

    # forward: every document in the tree is indexed
    for f in "docs/$dir"/*.md; do
        base=$(basename "$f")
        case "$base" in *.zh.md) continue ;; esac
        # `grep -xF ... >/dev/null`, not `grep -qxF`: with -q grep exits the
        # moment it matches, readme_entries_under's awk takes SIGPIPE, and the
        # `set -euo pipefail` at :22 turns that 141 into a dead run -- no
        # verdict line, no FAIL line, just a non-zero exit that reads as a
        # crash. Without -q grep reads to EOF, so there is no early exit for
        # the producer to be signalled by, and the exit status is the same.
        if readme_entries_under "$dir" | grep -xF -- "$base" >/dev/null; then
            ok
        else
            fail "docs/$dir/$base exists but is not indexed in $README"
        fi
    done

    # reverse: every indexed document exists
    for entry in $(readme_entries_under "$dir"); do
        case "$entry" in *.zh.md) continue ;; esac
        if [ -e "docs/$dir/$entry" ]; then
            ok
        else
            fail "$README indexes '$entry' under $dir/, but docs/$dir/$entry does not exist"
        fi
    done

    # once each: neither direction above can see a document listed twice --
    # forward stops at the first hit, and reverse checks each copy separately
    # and passes on both. The `sort -u` here is only the list of names to
    # examine; the count is taken from the undeduplicated list below it.
    for entry in $(readme_entries_under "$dir" | sort -u); do
        n=$(readme_entries_under "$dir" | grep -cxF -- "$entry")
        if [ "$n" -eq 1 ]; then
            ok
        else
            fail "$README lists '$entry' $n times under $dir/; a reader who edits one description will not see the other, and the two will drift apart unnoticed"
        fi
    done
}

echo "docs/verify-index.sh: design/ <-> $README"
check_readme_dir design
echo "docs/verify-index.sh: research/ <-> $README"
check_readme_dir research

# --- section 3: docs/task/RFCT-*.md <-> docs/task/index.md -----------------
echo "docs/verify-index.sh: task/RFCT-*.md <-> $TASK_INDEX"

# forward: every record has a row
for f in docs/task/RFCT-*.md; do
    base=$(basename "$f")
    case "$base" in *.zh.md) continue ;; esac
    if grep -qF -- "($base)" "$TASK_INDEX"; then
        ok
    else
        fail "docs/task/$base exists but has no row in $TASK_INDEX"
    fi
done

# reverse: every row resolves to a record
for entry in $(grep -oE '\(RFCT-[^)]+\.md\)' "$TASK_INDEX" | tr -d '()' | sort -u); do
    if [ -e "docs/task/$entry" ]; then
        ok
    else
        fail "$TASK_INDEX has a row for '$entry', but docs/task/$entry does not exist"
    fi
done

# once each: every L3 appends its row at the same point, so a merge conflict
# here is a two-row conflict and keeping both sides is the likeliest way to
# resolve it wrongly. Neither direction above can see that -- forward's
# `grep -q` is satisfied by one occurrence or by five, and reverse dedupes
# before it looks. The `sort -u` here is only the list of names to examine;
# the count is taken from the undeduplicated file below it.
for entry in $(grep -oE '\(RFCT-[^)]+\.md\)' "$TASK_INDEX" | tr -d '()' | sort -u); do
    n=$(grep -cF -- "($entry)" "$TASK_INDEX")
    if [ "$n" -eq 1 ]; then
        ok
    else
        fail "$TASK_INDEX carries $n rows for '$entry'; that record's status now lives in two places that can disagree, and a merge that kept both sides of an append is how it got there"
    fi
done

# checkbox <-> status: a row's marker and its record's status line are two
# independent records of the same fact, and nothing compared them (RFCT-144's
# finding), so a row ticked `[x]` over a file that says `pending` presented an
# open defect as finished work indefinitely. The contract lives next to the
# Status Markers table in docs/task/index.md: the status line is
# `- **status**: <head>` or `- **status**: <head> — <free detail>`, head is
# exactly one of pending `[ ]`, in progress `[-]`, completed `[x]`,
# closed `[~]`. A record with no such line, or a non-canonical head, FAILS --
# that is the vocabulary gate holding, not a shape to be tolerated.
while IFS='|' read -r marker entry; do
    # a row whose record does not exist already failed the reverse check
    [ -e "docs/task/$entry" ] || continue
    status_line=$(grep -m1 '^- \*\*status\*\*: ' "docs/task/$entry" || true)
    if [ -z "$status_line" ]; then
        fail "docs/task/$entry has no parseable status line: expected '- **status**: <head>' with head one of pending|in progress|completed|closed"
        continue
    fi
    status_head=${status_line#"- **status**: "}
    status_head=${status_head%% — *}
    case "$status_head" in
        pending)       want=" " ;;
        "in progress") want="-" ;;
        completed)     want="x" ;;
        closed)        want="~" ;;
        *)
            fail "docs/task/$entry status head '$status_head' is not one of pending|in progress|completed|closed"
            continue
            ;;
    esac
    if [ "$marker" = "$want" ]; then
        ok
    else
        fail "$TASK_INDEX marks '$entry' '[$marker]' but docs/task/$entry says status head '$status_head', which maps to '[$want]'"
    fi
done < <(sed -n 's/^- \[\(.\)\] \[\*\*.*\](\(RFCT-[^)]*\.md\)).*/\1|\2/p' "$TASK_INDEX")

# --- section 4: docs/plan/PLAN-*.md <-> docs/plan/index.md -----------------
# Section 3's argument applied to plans, which nothing read here until now
# (PLAN-028 M3, RFCT-258). The defect on record: docs/plan/index.md held `[-]`
# against a plan file that said `completed`, and this gate was green over it
# until someone noticed by hand (fixed at 77a3278). A plan's marker and its
# file's status line are, exactly as with tasks, two independent records of one
# fact that nothing compared.
#
# ROWS ARE READ FROM THE `## Plans` SECTION ONLY, and this exclusion is
# load-bearing rather than tidiness. docs/plan/index.md:11 is a FORMAT EXAMPLE
# inside its Usage section --
#
#     - [ ] [**PLAN-001 Short plan title**](PLAN-001.md) `YYYY-MM-DD`
#
# -- carrying a real `(PLAN-001.md)` link and a real `[ ]` marker. The
# task-section idiom above, `grep -oE '\(RFCT-[^)]+\.md\)'` over the whole
# file, would read it as a row: PLAN-001 would be seen twice (failing "once
# each") and its `[ ]` would be compared against PLAN-001.md's `completed`
# (failing checkbox-vs-status). Two false failures over a line that is
# documentation of the format. It is excluded BY SECTION and not by matching
# its placeholder title or its literal `YYYY-MM-DD`, because the example is
# free to be rewritten -- an editor who dates it `2026-01-01` for realism must
# not thereby turn it into a row. The strict row shape below happens to
# exclude it today as well; the section boundary is what this check relies on.
# Line 32's prose note mentioning PLAN-003 is excluded by the same boundary
# and, being prose, by the row shape too.
#
# THE HEAD IS PARSED OFF A TAIL. Plan status lines are `- **status**: <head>`
# with three observed decorations, each of which a naive read gets wrong:
# a ` — <free detail>` paragraph (PLAN-011's runs to several clauses), a
# trailing parenthetical (PLAN-005 `rejected (superseded by PLAN-006)`), and a
# trailing date (PLAN-013 `completed by supersession 2026-08-28 — ...`, whose
# head is a PHRASE and not one word). All three are stripped, in that order,
# and the remainder must then equal a vocabulary entry exactly.
#
# THE VOCABULARY IS NOT INVENTED HERE. The four markers are the four
# docs/plan/index.md declares in its own Status Markers table (`[ ]` Draft /
# Pending review, `[-]` Approved / Implementing, `[x]` Completed, `[~]`
# Rejected / Abandoned) -- that table is the committed contract and this is
# the assertion of it. The heads are the ones the plan tree actually uses.
# Five of them (`draft`, `approved`, `implementing`, `completed`, `rejected`)
# are the table's own words; three are not, so their reading is stated rather
# than assumed: `in progress` is PLAN-010's wording for Implementing;
# `partially implemented` is PLAN-006's, work begun and not finished, which is
# Implementing and emphatically not Completed; `completed by supersession` is
# PLAN-013's, a plan whose goals were delivered by later campaigns, Completed.
# RFCT-258 wrote the resulting head-to-marker mapping INTO that table as a
# third column, so a plan author can read the legal heads where they read the
# markers rather than from this script. The table and the `case` below are the
# same contract stated twice, and drift between them is a review concern the
# task index has carried the same way since RFCT-171.
#
# BOTH AN UNKNOWN HEAD AND AN UNKNOWN MARKER ARE ERRORS. There is no default
# and no silent pass: a status head this list does not carry means the tree
# has grown a status nobody decided how to index, and the resolution is to
# decide it here, in the open, not to let the gate guess. Likewise a marker
# outside the declared four.
#
# WHEN A ROW AND A FILE DISAGREE THE INDEX IS WHAT MOVES. This gate encodes
# consistency, not history: the fix for a failure below is the one-character
# marker edit in docs/plan/index.md. Editing a plan file's status to satisfy
# the gate would be rewriting the record to please the check.
#
# What this DELIBERATELY does not check: that a row's title matches its plan
# file's H1, that the `PLAN-NNN` in a row's bold title matches the `PLAN-NNN`
# in its link, that the trailing date matches anything in the file, and the
# ORDER of the rows (docs/plan/index.md:41 carries PLAN-010 before PLAN-008
# and that is the committed history of when they were added). Those are the
# same class as the README's description bullets discussed at the top of this
# file -- independently written prose, or an ordering with no single truth --
# and membership plus status is what is mechanically assertable.
echo "docs/verify-index.sh: plan/PLAN-*.md <-> $PLAN_INDEX"

# The rows of the `## Plans` section, one `marker|file` per line. The shape is
# anchored whole -- marker, bold title, link, backticked date -- so that prose
# and headings inside the section cannot be read as rows either.
plan_rows() {
    awk '/^## Plans/ { inplans = 1; next } inplans' "$PLAN_INDEX" \
        | sed -n 's/^- \[\(.\)\] \[\*\*PLAN-[0-9]*[^]]*\](\(PLAN-[0-9]*\.md\)) `[0-9][0-9-]*`$/\1|\2/p'
}

# forward: every plan has a row
for f in docs/plan/PLAN-*.md; do
    base=$(basename "$f")
    case "$base" in *.zh.md) continue ;; esac
    # not `grep -q`: see the SIGPIPE note at the head of check_readme_dir
    if plan_rows | cut -d'|' -f2 | grep -xF -- "$base" >/dev/null; then
        ok
    else
        fail "docs/plan/$base exists but has no row in the ## Plans section of $PLAN_INDEX"
    fi
done

# reverse: every row resolves to a plan
for entry in $(plan_rows | cut -d'|' -f2 | sort -u); do
    if [ -e "docs/plan/$entry" ]; then
        ok
    else
        fail "$PLAN_INDEX has a row for '$entry', but docs/plan/$entry does not exist"
    fi
done

# once each: docs/plan/index.md's own Rules say new plans append to the end,
# which is the same two-row merge conflict the task index has, and neither
# direction above can see the result -- forward is satisfied by one row or by
# five, reverse dedupes before it looks.
for entry in $(plan_rows | cut -d'|' -f2 | sort -u); do
    n=$(plan_rows | cut -d'|' -f2 | grep -cxF -- "$entry")
    if [ "$n" -eq 1 ]; then
        ok
    else
        fail "$PLAN_INDEX carries $n rows for '$entry'; that plan's status now lives in two places that can disagree, and a merge that kept both sides of an append is how it got there"
    fi
done

# checkbox <-> status
while IFS='|' read -r marker entry; do
    # a row whose plan does not exist already failed the reverse check
    [ -e "docs/plan/$entry" ] || continue
    case "$marker" in
        " " | "-" | "x" | "~") ;;
        *)
            fail "$PLAN_INDEX marks '$entry' '[$marker]', which is not one of the four markers $PLAN_INDEX declares in its own Status Markers table: '[ ]' '[-]' '[x]' '[~]'"
            continue
            ;;
    esac
    status_line=$(grep -m1 '^- \*\*status\*\*: ' "docs/plan/$entry" || true)
    if [ -z "$status_line" ]; then
        fail "docs/plan/$entry has no parseable status line: expected '- **status**: <head>', head one of draft|approved|implementing|in progress|partially implemented|completed|completed by supersession|rejected"
        continue
    fi
    status_head=${status_line#"- **status**: "}
    status_head=${status_head%% — *}                                    # free detail
    status_head=${status_head% (*)}                                     # parenthetical
    status_head=$(printf '%s' "$status_head" | sed -E 's/ [0-9]{4}-[0-9]{2}-[0-9]{2}$//')
    case "$status_head" in
        draft)                              want=" " ;;
        approved | implementing)            want="-" ;;
        "in progress")                      want="-" ;;
        "partially implemented")            want="-" ;;
        completed)                          want="x" ;;
        "completed by supersession")        want="x" ;;
        rejected)                           want="~" ;;
        *)
            fail "docs/plan/$entry status head '$status_head' is not one of draft|approved|implementing|in progress|partially implemented|completed|completed by supersession|rejected; the tree has grown a status with no decided marker, and the fix is to decide it in docs/verify-index.sh next to the Status Markers table it asserts"
            continue
            ;;
    esac
    if [ "$marker" = "$want" ]; then
        ok
    else
        fail "$PLAN_INDEX marks '$entry' '[$marker]' but docs/plan/$entry says status head '$status_head', which maps to '[$want]'"
    fi
done < <(plan_rows)

# --- verdict ---------------------------------------------------------------
if [ "$FAIL" -ne 0 ]; then
    echo "docs/verify-index.sh: $FAIL FAILED, $CHECKS passed" >&2
    exit 1
fi
echo "docs/verify-index.sh: $CHECKS/$CHECKS PASS"
