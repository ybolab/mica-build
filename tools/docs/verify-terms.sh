#!/usr/bin/env bash
# Asserts that permanent documentation carries no vocabulary from removed
# systems and no citation of a tracking record that no longer exists.
# Read-only.
#
#   bash tools/docs/verify-terms.sh          (or: make docs-verify)
#
# SCOPE. Every Markdown file under docs/ except docs/plan/, docs/task/,
# docs/decisions/ and docs/changelog.md, which are history and tracking.
# Fenced code blocks are skipped.
#
# WHAT IS REFUSED (docs/README.md "Ownership"):
#   - names of the removed update stack and layout: RAUC, TUF, lode, raw-slot,
#     the STATE partition, boot credits, and the connd daemon name;
#   - numbered record IDs (PLAN-NNN, RFCT-NNN, UI-NNN): permanent documents
#     state rationale themselves instead of pointing at a record;
#   - a timestamped record ID (<YYYYMMDD-HHmm>-<slug>) with no matching file
#     under docs/plan/ or docs/task/.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

FAIL=0
CHECKS=0

fail() { echo "  FAIL $*" >&2; FAIL=$((FAIL + 1)); }
ok()   { CHECKS=$((CHECKS + 1)); }

TERMS='\b(RAUC|rauc|TUF|lode|raw-slot|STATE|connd)\b|boot credits?\b|\b(PLAN|RFCT|UI)-[0-9]{3}\b'
RECORD_ID='\b20[0-9]{6}-[0-9]{4}-[a-z0-9]+(-[a-z0-9]+)*\b'

prose() {
    awk '/^[[:space:]]*```/ { fence = !fence; next } !fence { printf "%d:%s\n", NR, $0 }' "$1"
}

mapfile -t files < <(find docs -name '*.md' \
    -not -path 'docs/plan/*' -not -path 'docs/task/*' \
    -not -path 'docs/decisions/*' -not -path docs/changelog.md | sort)

echo "tools/docs/verify-terms.sh: stale terms and record citations (${#files[@]} files)"

if [ "${#files[@]}" -eq 0 ]; then
    fail "no permanent documents found under docs/; this check would pass by finding nothing"
fi

for f in "${files[@]}"; do
    clean=1
    while IFS= read -r hit; do
        clean=0
        fail "$f:${hit%%:*} uses '$(grep -oE "$TERMS" <<<"${hit#*:}" | head -1)'"
    done < <(prose "$f" | grep -E "$TERMS" || true)

    while IFS= read -r hit; do
        line=${hit%%:*}
        for id in $(grep -oE "$RECORD_ID" <<<"${hit#*:}"); do
            if [ -e "docs/plan/$id.md" ] || [ -e "docs/task/$id.md" ]; then
                ok
            else
                clean=0
                fail "$f:$line cites '$id', which is not a record under docs/plan/ or docs/task/"
            fi
        done
    done < <(prose "$f" | grep -E "$RECORD_ID" || true)

    [ "$clean" -eq 1 ] && ok
done

# --- verdict ---------------------------------------------------------------
if [ "$FAIL" -ne 0 ]; then
    echo "tools/docs/verify-terms.sh: $FAIL FAILED, $CHECKS passed" >&2
    exit 1
fi
echo "tools/docs/verify-terms.sh: $CHECKS/$CHECKS PASS"
