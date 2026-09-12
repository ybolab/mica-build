#!/usr/bin/env bash
# Asserts that the /pma tracking tree is internally consistent. Read-only.
#
#   bash tools/docs/verify-tracking.sh          (or: make docs-verify)
#
# For docs/task/ and docs/plan/, using the formats in the /pma skill:
#   - every row under `## Tasks` / `## Plans` in index.md has the shape
#     `- [m] [**<id> <title>**](<id>.md) `<tag>`` with m one of ' ', -, x, ~, d;
#   - no id has two rows;
#   - a `[d]` row's detail file is absent; every other row's detail file exists;
#   - every detail file has a row;
#   - every detail file has exactly one `- **status**:` line whose value is
#     canonical and agrees with its row's marker;
#   - a task has exactly one `- **owner**:` line;
#   - a plan has exactly one `- **relatedTask**:` line naming `(none)` or an
#     existing task detail file.
# A tree with zero rows fails: the parser broke, not the tree became clean.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

FAIL=0
CHECKS=0
ROWS=0

fail() { echo "  FAIL $*" >&2; FAIL=$((FAIL + 1)); }
ok()   { CHECKS=$((CHECKS + 1)); }

ROW_RE='^- \[([ x~d-])\] \[\*\*([^* ]+) [^*]+\*\*\]\(([^)]+)\) `[^`]+`$'

# field <file> <name>: prints every value of `- **<name>**: <value>`.
field() { sed -n "s/^- \*\*$2\*\*: //p" "$1"; }

check_kind() {
    local kind=$1 section=$2 dir=docs/$1
    local index=$dir/index.md
    local -A marker_of=()
    local line marker id target status expected n f base value

    if [ ! -f "$index" ]; then
        fail "$index does not exist"
        return
    fi

    while IFS= read -r line; do
        [[ $line == '- ['* ]] || continue
        ROWS=$((ROWS + 1))
        if [[ ! $line =~ $ROW_RE ]]; then
            fail "$index: row does not match the /pma index format: $line"
            continue
        fi
        marker=${BASH_REMATCH[1]} id=${BASH_REMATCH[2]} target=${BASH_REMATCH[3]}
        ok
        if [ "$target" != "$id.md" ]; then
            fail "$index: row for $id links to '$target', expected '$id.md'"
            continue
        fi
        if [ -n "${marker_of[$id]+set}" ]; then
            fail "$index: $id has more than one row"
            continue
        fi
        marker_of[$id]=$marker
        if [ "$marker" = d ]; then
            if [ -e "$dir/$target" ]; then
                fail "$index: $id is marked [d] but $dir/$target exists"
            else
                ok
            fi
        elif [ -e "$dir/$target" ]; then
            ok
        else
            fail "$index: $id is marked [$marker] but $dir/$target does not exist"
        fi
    done < <(awk -v s="$section" '$0 == s { on = 1; next } on' "$index")

    for f in "$dir"/*.md; do
        base=$(basename "$f" .md)
        [ "$base" = index ] && continue
        if [ -z "${marker_of[$base]+set}" ]; then
            fail "$f has no row in $index"
            continue
        fi
        ok
        # A [d] row with a file present is already reported above.
        [ "${marker_of[$base]}" = d ] && continue

        n=$(field "$f" status | grep -c '' || true)
        if [ "$n" -ne 1 ]; then
            fail "$f has $n status lines, expected exactly 1"
            continue
        fi
        status=$(field "$f" status)
        case "$kind:${marker_of[$base]}" in
            task:' ') expected=pending ;;
            task:-)   expected=in_progress ;;
            task:x)   expected=completed ;;
            task:'~') expected=closed ;;
            plan:' ') expected=draft ;;
            plan:-)   expected=implementing ;;
            plan:x)   expected=completed ;;
            plan:'~') expected=rejected ;;
        esac
        if [ "$status" = "$expected" ]; then
            ok
        else
            fail "$f has status '$status' but its row is [${marker_of[$base]}], which requires '$expected'"
        fi

        if [ "$kind" = task ]; then
            n=$(field "$f" owner | grep -c '' || true)
            if [ "$n" -eq 1 ]; then ok; else fail "$f has $n owner lines, expected exactly 1"; fi
        else
            n=$(field "$f" relatedTask | grep -c '' || true)
            if [ "$n" -ne 1 ]; then
                fail "$f has $n relatedTask lines, expected exactly 1"
                continue
            fi
            value=$(field "$f" relatedTask)
            if [ "$value" = '(none)' ] || [ -f "docs/task/$value.md" ]; then
                ok
            else
                fail "$f names relatedTask '$value', but docs/task/$value.md does not exist"
            fi
        fi
    done
}

echo "tools/docs/verify-tracking.sh: docs/task/ and docs/plan/ indexes <-> records"
check_kind task '## Tasks'
check_kind plan '## Plans'

if [ "$ROWS" -eq 0 ]; then
    fail "no index rows found under docs/task/ or docs/plan/; this check would pass by finding nothing"
fi

# --- verdict ---------------------------------------------------------------
if [ "$FAIL" -ne 0 ]; then
    echo "tools/docs/verify-tracking.sh: $FAIL FAILED, $CHECKS passed" >&2
    exit 1
fi
echo "tools/docs/verify-tracking.sh: $CHECKS/$CHECKS PASS"
