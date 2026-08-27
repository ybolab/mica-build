#!/usr/bin/env bash
# Asserts that the two document indexes agree with the tree, in BOTH
# directions. Read-only: it opens files and prints, and changes nothing.
#
#   bash docs/verify-index.sh          (or: make docs-verify)
#
# Three sections, each checked forward and backward:
#
#   1. docs/design/*.md      <-> docs/README.md
#   2. docs/research/*.md    <-> docs/README.md
#   3. docs/task/RFCT-*.md   <-> docs/task/index.md
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

# --- verdict ---------------------------------------------------------------
if [ "$FAIL" -ne 0 ]; then
    echo "docs/verify-index.sh: $FAIL FAILED, $CHECKS passed" >&2
    exit 1
fi
echo "docs/verify-index.sh: $CHECKS/$CHECKS PASS"
