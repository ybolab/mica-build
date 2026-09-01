#!/usr/bin/env bash
# Asserts that the en/zh coverage table in docs/zh/README.md and the document
# trees agree, in BOTH directions. Read-only: it opens files and prints, and
# changes nothing.
#
#   bash docs/zh/verify-coverage.sh          (or: make docs-verify)
#
# THE RULE (docs/user/doc-contract.md section 5, normative): English under
# docs/user/ is authoritative, a tracked Chinese set lives under docs/zh/, and
# docs/zh/README.md carries a per-page coverage table naming, for every page in
# the gated trees, the source page, the source version it was translated from,
# and a status of `current`, `lagging` or `not-translated`.
#
# A ROW is a table line whose first cell is a backticked path beginning `../`,
# resolved from docs/zh/, and whose remaining two cells are the source version
# and the coverage status:
#
#   | `../user/api.md` | db66fc02 | current |
#
# WHAT IS ENFORCED:
#   - every candidate row parses into exactly the three cells above;
#   - every row's source page is inside one of the gated trees -- a row for a
#     page this table does not govern claims coverage nobody checks;
#   - every row's source page exists: a row surviving a rename is a coverage
#     claim about a document that is gone;
#   - every status token is one of the three the contract defines;
#   - every source version is a short git commit (7-40 hex), so the "which
#     revision was this translated from" column cannot decay into prose;
#   - every `current` row has the matching file under docs/zh/ -- `current`
#     is the one status that asserts a translation exists;
#   - every English page in the gated trees has EXACTLY one row: none means
#     an untracked page, two mean two claims that will drift apart;
#   - every file under docs/zh/user/ has a `current` row -- the direction that
#     catches a translation whose row was left behind at `not-translated`.
#
# And one meta-assertion: a table with ZERO rows fails. A check over an empty
# set reports green without having checked anything, and the bijection's other
# leg -- every row's page must exist -- is what keeps an emptied tree from
# passing the same way.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

TABLE=docs/zh/README.md
TREES=(user website bsp)

FAIL=0
CHECKS=0

fail() { echo "  FAIL $*" >&2; FAIL=$((FAIL + 1)); }
ok()   { CHECKS=$((CHECKS + 1)); }

# The strict row shape, as a sed program emitting `path<TAB>version<TAB>status`.
# Applied to one line it is the parser; applied to the table it is the list of
# well-formed rows, so the two can never disagree about what a row is.
ROW_SED='s/^\|[[:space:]]*`([^`]+)`[[:space:]]*\|[[:space:]]*([^|[:space:]]+)[[:space:]]*\|[[:space:]]*([^|[:space:]]+)[[:space:]]*\|[[:space:]]*$/\1\t\2\t\3/p'

# Every line that MEANS to be a coverage row, well-formed or not, so that a
# malformed one is reported rather than silently skipped.
candidate_rows() {
    grep -E '^\|[[:space:]]*`\.\./' "$TABLE" || true
}

coverage_rows() {
    sed -nE "$ROW_SED" "$TABLE"
}

# `../user/api.md` -> the docs/ path it names, and the docs/zh/ path that
# would hold its translation.
source_path() { echo "docs/${1#../}"; }
zh_path()     { echo "docs/zh/${1#../}"; }

in_gated_tree() {
    local tree
    for tree in "${TREES[@]}"; do
        case "$1" in "../$tree/"*) return 0 ;; esac
    done
    return 1
}

echo "docs/zh/verify-coverage.sh: en/zh coverage rows in $TABLE <-> docs/{$(IFS=,; echo "${TREES[*]}")}/"

# --- 1. every row: shape, scope, source page, status, version, translation --
while IFS= read -r line; do
    parsed=$(printf '%s\n' "$line" | sed -nE "$ROW_SED")
    if [ -z "$parsed" ]; then
        fail "$TABLE: row does not parse -- '$line'"
        continue
    fi
    IFS=$'\t' read -r path version status <<<"$parsed"

    if ! in_gated_tree "$path"; then
        fail "$TABLE: row '$path' is outside the gated trees ${TREES[*]}; this table does not govern it and nothing checks the claim"
        continue
    fi
    ok

    if [ -e "$(source_path "$path")" ]; then
        ok
    else
        fail "$TABLE: row '$path' names a source page that does not exist at $(source_path "$path")"
    fi

    case "$status" in
        current|lagging|not-translated) ok ;;
        *) fail "$TABLE: row '$path' carries status '$status', not one of current, lagging, not-translated" ;;
    esac

    if [[ $version =~ ^[0-9a-f]{7,40}$ ]]; then
        ok
    else
        fail "$TABLE: row '$path' carries source version '$version', which is not a short git commit"
    fi

    if [ "$status" = current ] && [ ! -e "$(zh_path "$path")" ]; then
        fail "$TABLE: row '$path' is 'current' but $(zh_path "$path") does not exist"
    else
        ok
    fi
done < <(candidate_rows)

# --- 2. every English page in the gated trees has exactly one row -----------
for tree in "${TREES[@]}"; do
    for f in "docs/$tree"/*.md; do
        [ -e "$f" ] || continue
        path="../$tree/$(basename "$f")"
        # `grep -c ... >/dev/null`, not `grep -q`: -q exits at the first match,
        # coverage_rows' sed takes SIGPIPE, and `set -o pipefail` turns that
        # 141 into a dead run. -c reads to EOF and keeps the same status.
        n=$(coverage_rows | cut -f1 | grep -cxF -- "$path" || true)
        if [ "$n" -eq 1 ]; then
            ok
        else
            fail "$f has $n coverage rows in $TABLE, expected exactly 1"
        fi
    done
done

# --- 3. every translated page under docs/zh/user/ has a `current` row -------
for f in docs/zh/user/*.md; do
    [ -e "$f" ] || continue
    path="../user/$(basename "$f")"
    # cut -f1,3: the row is path/version/status, and this direction asks only
    # which status the table gives that path.
    if coverage_rows | cut -f1,3 | grep -cxF -- "$(printf '%s\tcurrent' "$path")" >/dev/null; then
        ok
    else
        fail "$f is translated but $TABLE does not carry a 'current' row for '$path'"
    fi
done

# --- 4. the vacuity floor ---------------------------------------------------
rows=$(coverage_rows | grep -c '' || true)
if [ "$rows" -eq 0 ]; then
    fail "$TABLE carries zero coverage rows; every assertion above would pass by finding nothing"
else
    ok
fi

# --- verdict ---------------------------------------------------------------
if [ "$FAIL" -ne 0 ]; then
    echo "docs/zh/verify-coverage.sh: $FAIL FAILED, $CHECKS passed" >&2
    exit 1
fi
echo "docs/zh/verify-coverage.sh: $CHECKS/$CHECKS PASS"
