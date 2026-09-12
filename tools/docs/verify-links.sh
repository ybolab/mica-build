#!/usr/bin/env bash
# Asserts that every relative Markdown link under docs/ points at something
# that exists. Read-only: it opens files and prints, and changes nothing.
#
#   bash tools/docs/verify-links.sh          (or: make docs-verify)
#
# WHAT COUNTS AS A LINK. Every `](target)` in every docs/**/*.md, including
# the zh/ tree, whose target does not start with http://, https://, mailto:
# or #. The #fragment, if any, is stripped and NOT validated -- an anchor is
# a rendering fact, not a filesystem fact, and validating one would mean
# reimplementing each renderer's slug rules. The remaining path is resolved
# against the linking file's own directory and must exist; a link out of
# docs/ into the source tree (a dossier citing `boards/cx3576/board.env`) is
# resolved the same way and asserted the same way. No network is touched.
#
# SCOPE. Every Markdown file under docs/ except `docs/plan/index.md` and
# `docs/task/index.md`: their rows, including the format specimen and `[d]`
# entries whose detail files were deleted on purpose, are checked by
# verify-tracking.sh instead.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

FAIL=0
CHECKS=0

fail() { echo "  FAIL $*" >&2; FAIL=$((FAIL + 1)); }
ok()   { CHECKS=$((CHECKS + 1)); }

mapfile -t files < <(find docs -name '*.md' \
    -not -path 'docs/plan/index.md' -not -path 'docs/task/index.md' | sort)

echo "tools/docs/verify-links.sh: relative link targets under docs/ (${#files[@]} files)"

for f in "${files[@]}"; do
    dir=$(dirname "$f")
    # `|| true`: a file with no links is fine; grep's exit 1 is not a finding.
    while IFS= read -r raw; do
        target=${raw#](}
        target=${target%)}
        case "$target" in
            http://*|https://*|mailto:*|'#'*) continue ;;
        esac
        target=${target%%#*}
        [ -n "$target" ] || continue
        if [ -e "$dir/$target" ]; then
            ok
        else
            fail "$f links to '$target', but $dir/$target does not exist"
        fi
    done < <(grep -oE '\]\([^)]+\)' "$f" || true)
done

# An empty search space must not pass: zero links means the extraction broke,
# not that the tree is clean.
if [ "$CHECKS" -eq 0 ] && [ "$FAIL" -eq 0 ]; then
    fail "no relative Markdown links found under docs/; this check would pass by finding nothing"
fi

# --- verdict ---------------------------------------------------------------
if [ "$FAIL" -ne 0 ]; then
    echo "tools/docs/verify-links.sh: $FAIL FAILED, $CHECKS passed" >&2
    exit 1
fi
echo "tools/docs/verify-links.sh: $CHECKS/$CHECKS PASS"
