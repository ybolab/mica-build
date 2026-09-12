#!/usr/bin/env bash
# Asserts that docs/README.md and the shipped document tree agree, in BOTH
# directions. Read-only: it opens files and prints, and changes nothing.
#
#   bash tools/docs/verify-index.sh          (or: make docs-verify)
#
#   docs/design/*.md    <->  docs/README.md
#   docs/user/*.md      <->  docs/README.md
#   docs/website/*.md   <->  docs/README.md
#   docs/boards/*.md    <->  docs/README.md
#   docs/research/*.md  <->  docs/README.md
#
# SCOPE. Each catalogued directory gets one `check_readme_dir` call; a further
# catalogued directory is one more call. `docs/plan/` and `docs/task/` are
# checked by verify-tracking.sh, and docs/zh/ by verify-coverage.sh.
#
# The reverse direction is the half that is easy to omit and the half that
# catches a rename: a forward-only check passes happily on an index full of
# entries pointing at files that no longer exist.
#
# The per-entry DESCRIPTION text is NOT asserted against the documents it
# describes: the bullets and the documents' headings are independently written
# prose with no shared token, and a keyword-overlap heuristic would pass on
# exactly the misleading bullet it was meant to catch. Membership stays
# mechanical here; description truth is a review concern.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

README=docs/README.md
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

echo "tools/docs/verify-index.sh: design/ user/ website/ boards/ research/ <-> $README"
check_readme_dir design
check_readme_dir user
check_readme_dir website
check_readme_dir boards
check_readme_dir research
# --- verdict ---------------------------------------------------------------
if [ "$FAIL" -ne 0 ]; then
    echo "tools/docs/verify-index.sh: $FAIL FAILED, $CHECKS passed" >&2
    exit 1
fi
echo "tools/docs/verify-index.sh: $CHECKS/$CHECKS PASS"
