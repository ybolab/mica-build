#!/usr/bin/env bash
# Asserts that every board dossier under docs/boards/ carries the section list
# board-template.md mandates, and that its qualification matrix rows are
# honest. Read-only: it opens files and prints, and changes nothing.
#
#   bash tools/docs/verify-board.sh          (or: make docs-verify)
#
# THE REQUIRED HEADINGS ARE PARSED FROM THE TEMPLATE, not hardcoded here: the
# template's numbered section list (`1. \`## Identity\`` ...) is the one
# normative statement of the thirteen H2s, and a copy of that list in this
# script would be a second statement free to drift from the first. The
# template says "spelled exactly and in this order, with no H2 heading
# outside this list", so all three are asserted: presence, absence of
# extras, and order.
#
# A DOSSIER IS DISCOVERED, NOT NAMED. The template fixes the instance shape
# ("Board dossier: <board>" as the H1), so every docs/boards/*.md whose H1 starts `# Board dossier:` is
# validated. A new board's dossier is gated the day it lands, with no edit
# here.
#
# QUALIFICATION ROWS (template: "never implicitly green"): every result cell
# is exactly pass | fail | N/A | not tested, and pass/fail rows carry an ISO
# date. Both the heading list and the row set must be non-empty before
# anything is asserted -- a check over an empty set reports green without
# having checked anything.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../docs/boards" && pwd)"

TEMPLATE=board-template.md
FAIL=0
CHECKS=0

fail() { echo "  FAIL $*" >&2; FAIL=$((FAIL + 1)); }
ok()   { CHECKS=$((CHECKS + 1)); }

# --- the required H2 list, from the template's numbered section list --------
mapfile -t required < <(sed -n 's/^[0-9][0-9]*\. `\(## .*\)`$/\1/p' "$TEMPLATE")

if [ "${#required[@]}" -eq 0 ]; then
    fail "$TEMPLATE yields zero required H2 headings; every dossier would pass vacuously"
else
    ok
fi

# --- the dossier instances, discovered by their H1 --------------------------
dossiers=()
for f in ./*.md; do
    f=${f#./}
    h1=$(grep -m1 '^# ' "$f" || true)
    case "$h1" in "# Board dossier:"*) dossiers+=("$f") ;; esac
done

if [ "${#dossiers[@]}" -eq 0 ]; then
    fail "no dossier instance found (no docs/boards/*.md with an H1 starting '# Board dossier:'); nothing would be asserted"
else
    ok
fi

echo "tools/docs/verify-board.sh: ${#dossiers[@]} dossier(s) against $TEMPLATE (${#required[@]} required headings)"

# With either set empty there is nothing meaningful left to assert -- every
# dossier H2 would count as "outside" an empty list -- so the guards' verdict
# is the verdict.
if [ "$FAIL" -ne 0 ]; then
    echo "tools/docs/verify-board.sh: $FAIL FAILED, $CHECKS passed" >&2
    exit 1
fi

check_dossier() {
    local f=$1 h ordered=1
    mapfile -t have < <(grep -E '^## ' "$f" || true)

    # presence: every required heading, spelled exactly
    for h in "${required[@]}"; do
        if printf '%s\n' "${have[@]}" | grep -xF -- "$h" >/dev/null; then
            ok
        else
            fail "$f is missing the required heading '$h'"
            ordered=0
        fi
    done

    # no extras: an H2 the template does not name
    for h in "${have[@]}"; do
        if printf '%s\n' "${required[@]}" | grep -xF -- "$h" >/dev/null; then
            ok
        else
            fail "$f carries the heading '$h', which is outside the template's section list"
            ordered=0
        fi
    done

    # order: with presence and extras clean, the two sequences must be equal
    if [ "$ordered" -eq 1 ]; then
        if [ "$(printf '%s\n' "${have[@]}")" = "$(printf '%s\n' "${required[@]}")" ]; then
            ok
        else
            fail "$f carries every required heading but not in the template's order"
        fi
    fi

    # qualification rows: cells 2 (result) and 3 (date) of every data row
    # under '## Qualification results', header and |---| separator skipped
    local rows=0 result date row
    while IFS= read -r row; do
        rows=$((rows + 1))
        result=$(awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $3); print $3}' <<<"$row")
        date=$(awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $4); print $4}' <<<"$row")
        case "$result" in
            pass|fail|N/A|"not tested") ok ;;
            *) fail "$f qualification row has result '$result'; allowed: pass | fail | N/A | not tested -- '$row'"
               continue ;;
        esac
        case "$result" in
            pass|fail)
                if [[ $date =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
                    ok
                else
                    fail "$f qualification row is '$result' without an ISO date -- '$row'"
                fi ;;
        esac
    done < <(awk '
        /^## Qualification results$/ { inq = 1; next }
        /^## /                       { inq = 0 }
        inq && /^\|/ {
            gsub(/^[ \t]+|[ \t]+$/, "", $0)
            if ($0 ~ /^\|[ \t:|-]*$/) next        # |---|---| separator
            if (header_seen == 0) { header_seen = 1; next }
            print
        }
    ' "$f")

    if [ "$rows" -eq 0 ]; then
        fail "$f has zero qualification rows; 'never implicitly green' would pass vacuously"
    else
        ok
    fi
}

for f in "${dossiers[@]}"; do
    check_dossier "$f"
done

# --- verdict ---------------------------------------------------------------
if [ "$FAIL" -ne 0 ]; then
    echo "tools/docs/verify-board.sh: $FAIL FAILED, $CHECKS passed" >&2
    exit 1
fi
echo "tools/docs/verify-board.sh: $CHECKS/$CHECKS PASS"
