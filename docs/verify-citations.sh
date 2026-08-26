#!/usr/bin/env bash
# Asserts that the `path:line` citations in the English design documents still
# resolve, and that where the citing text quotes its source, the quote still
# appears at the lines it cites. Read-only: it opens files and prints, and
# changes nothing. It needs no network, no root and no container -- bash,
# coreutils, grep, sed and awk, the same floor docs/verify-index.sh sits on.
#
#   bash docs/verify-citations.sh [--advisory]   (or: make docs-verify-citations)
#
# Scope. The documents scanned are docs/design/*.md excluding *.zh.md, plus
# docs/architecture.md. `*.zh.md` is excluded for the same reason
# docs/verify-index.sh excludes it: whether the Chinese translations are kept
# current is a question parked with the user, so a translated sibling must not
# fail a check here while that is unresolved.
#
# A citation is a backticked token of the form `path:line` or `path:line-line`.
# It is in scope only when its path contains a `/` and its first segment names a
# directory that exists at the repo root. Everything else is skipped by reason
# and counted, never dropped: `0.0.0.0:443` is a host and a port; `routes.rs:95`
# is shorthand for a path named earlier in the prose and has no base to resolve
# against; `u-boot/env/mmc.c:118` and `axum-0.8.9/src/lib.rs:10` cite trees this
# repository does not contain and never will. Each of those reasons appears in
# the summary with its count, because a summary that reads "N checked" while M
# were never opened is the false assurance this check exists to prevent.
#
# Check 1, resolution. The cited path exists, is a regular file, and every line
# number named -- both ends of a range -- is at least 1 and at most the file's
# line count.
#
# Check 2, content. Resolution alone passes on a quotation whose source was
# renamed underneath it, which is how one source comment came to be quoted in
# this document set under two different daemon names. So: a citation carries a
# quote when it directly follows a quoted fragment, with nothing between the two
# but whitespace, the emphasis characters `*` and `_`, and an optional opening
# parenthesis, and with no blank line between them -- quote and citation sit in
# one paragraph. A quoted fragment is a double-quoted span or a backticked code
# span, at least three characters long; a backticked span that is itself a
# `path:line` token is a chained citation and not a quote. The fragment is read
# as a literal excerpt of the cited lines and must appear within them, so a
# fragment that names a thing rather than quoting it belongs anywhere but
# directly against the citation. Comparison collapses whitespace runs to one
# space, drops `*`, and strips the comment marker that opens each cited line
# (`//`, `///`, `//!`, `#`), so reflowing a paragraph, bolding a word inside a
# quote, or quoting a doc comment without its markers does not fail it. Nothing
# else is normalised, `_` included, so a renamed identifier is caught. A citation with no quote gets check 1 only. That is
# expected, and the count is in the summary.
#
# What this cannot check, permanently, by this design and by every alternative.
# A provenance claim -- "measured at <commit>", "as of 2026-08-19" -- is
# validated against no file at all. This check reads the working tree; nothing
# mechanical validates a claim about a commit, and moving citations to symbol
# anchors would not change that. Those claims stay a human responsibility, and a
# green run here does not mean the citations are handled.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ADVISORY=0
case "${1:-}" in
    --advisory) ADVISORY=1 ;;
    "")         ;;
    *)          echo "usage: bash docs/verify-citations.sh [--advisory]" >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { echo "usage: bash docs/verify-citations.sh [--advisory]" >&2; exit 2; }

FAIL_RESOLVE=0
FAIL_CONTENT=0
N_DOCS=0
N_FOUND=0
N_INSCOPE=0
N_QUOTED=0
N_NOQUOTE=0
N_SKIP_HOSTPORT=0
N_SKIP_BARE=0
N_SKIP_OUTSIDE=0

fail_resolve() { echo "  FAIL $*" >&2; FAIL_RESOLVE=$((FAIL_RESOLVE + 1)); }
fail_content() { echo "  FAIL $*" >&2; FAIL_CONTENT=$((FAIL_CONTENT + 1)); }

# Every citation token in the document named by $1, one per line, tab
# separated: citing line, path, first line, last line, the token as written,
# the quote kind (`text`, `code` or `none`), and the quote. Only the last field
# can be empty, which is what keeps a tab-delimited read of this correct: with
# tab in IFS an interior empty field would collapse into its neighbour, so the
# quote kind says `none` rather than being left blank.
#
# The scan is one left-to-right pass over the whole document, because both the
# line number and the paragraph start have to advance with it: recomputing
# either from the top per token would be quadratic on a document this size.
# Quotes span lines and so does the gap between a quote and its citation, which
# is why the document is held as one string rather than read line by line.
extract_citations() {
    awk '
        { txt = txt $0 "\n" }
        END {
            rest = txt; absbase = 1; line = 1; para = 1
            while (match(rest, /`[^` ]+:-?[0-9]+(--?[0-9]+)?`/)) {
                abs = absbase + RSTART - 1
                tok = substr(rest, RSTART + 1, RLENGTH - 2)
                chunk = substr(rest, 1, RSTART - 1)

                # the last blank line at or before this token starts the
                # paragraph the lookback below is allowed to reach into
                c = chunk; b = absbase
                while ((i = index(c, "\n\n")) > 0) { para = b + i + 1; b = para; c = substr(c, i + 2) }
                line += gsub(/\n/, "\n", chunk)

                q = ""; qkind = "none"
                j = abs - 1
                while (j >= para && substr(txt, j, 1) ~ /[ \t\n*_(]/) j--
                if (j >= para) {
                    ch = substr(txt, j, 1)
                    if (ch == "`") {
                        k = j - 1
                        while (k >= para && substr(txt, k, 1) != "`") k--
                        if (k >= para) {
                            cand = substr(txt, k + 1, j - k - 1)
                            # a chained citation, `a/b.rs:1` -> `a/b.rs:9`, is
                            # not a quotation of anything
                            if (cand !~ /^[^ ]+:-?[0-9]+(--?[0-9]+)?$/) { q = cand; qkind = "code" }
                        }
                    } else if (ch == "\"") {
                        k = j - 1
                        while (k >= para && substr(txt, k, 1) != "\"") k--
                        if (k >= para) { q = substr(txt, k + 1, j - k - 1); qkind = "text" }
                    }
                }
                gsub(/[ \t\n]+/, " ", q); sub(/^ /, "", q); sub(/ $/, "", q)
                if (length(q) < 3) { q = ""; qkind = "none" }

                # the path can hold colons of its own, so the line part is what
                # follows the LAST one
                ci = 0
                for (i = length(tok); i >= 1; i--) if (substr(tok, i, 1) == ":") { ci = i; break }
                path = substr(tok, 1, ci - 1); tail = substr(tok, ci + 1)
                if (tail ~ /^-?[0-9]+$/) { first = tail + 0; last = first }
                else {
                    di = 0
                    for (i = 2; i <= length(tail); i++) if (substr(tail, i, 1) == "-") { di = i; break }
                    first = substr(tail, 1, di - 1) + 0; last = substr(tail, di + 1) + 0
                }
                printf "%d\t%s\t%d\t%d\t%s\t%s\t%s\n", line, path, first, last, tok, qkind, q

                absbase = abs + RLENGTH
                rest = substr(rest, RSTART + RLENGTH)
            }
        }
    ' "$1"
}

# Whitespace runs to one space, `*` dropped, ends trimmed. Nothing else: `_`
# survives, so `settings_api` and `settingsapi` stay different strings.
normalise() {
    local s=${1//\*/}
    s=${s//$'\t'/ }
    s=${s//$'\n'/ }
    while [ "$s" != "${s//  / }" ]; do s=${s//  / }; done
    s=${s# }
    s=${s% }
    printf '%s' "$s"
}

DOCS=()
for doc in docs/design/*.md; do
    case "$doc" in *.zh.md) continue ;; esac
    DOCS+=("$doc")
done
DOCS+=(docs/architecture.md)

for doc in "${DOCS[@]}"; do
    [ -f "$doc" ] || { echo "error: $doc not found" >&2; exit 1; }
    N_DOCS=$((N_DOCS + 1))
    while IFS=$'\t' read -r dline path first last tok qkind quote; do
        N_FOUND=$((N_FOUND + 1))

        case "$path" in
            */*) ;;
            *[!0-9.]*)
                N_SKIP_BARE=$((N_SKIP_BARE + 1)); continue ;;
            *)
                # digits and dots only, and no directory: an address and a port
                N_SKIP_HOSTPORT=$((N_SKIP_HOSTPORT + 1)); continue ;;
        esac
        if [ ! -d "${path%%/*}" ]; then
            N_SKIP_OUTSIDE=$((N_SKIP_OUTSIDE + 1)); continue
        fi
        N_INSCOPE=$((N_INSCOPE + 1))

        # --- check 1: resolution -------------------------------------------
        if [ ! -e "$path" ]; then
            fail_resolve "$doc:$dline cites \`$tok\`, and $path does not exist"
            continue
        fi
        if [ ! -f "$path" ]; then
            fail_resolve "$doc:$dline cites \`$tok\`, and $path is not a regular file"
            continue
        fi
        if [ "$first" -lt 1 ] || [ "$last" -lt 1 ]; then
            fail_resolve "$doc:$dline cites \`$tok\`, and line numbers start at 1"
            continue
        fi
        nlines=$(awk 'END { print NR }' "$path")
        if [ "$first" -gt "$nlines" ] || [ "$last" -gt "$nlines" ]; then
            fail_resolve "$doc:$dline cites \`$tok\`, and $path has $nlines lines"
            continue
        fi

        # --- check 2: content ----------------------------------------------
        if [ "$qkind" = none ]; then
            N_NOQUOTE=$((N_NOQUOTE + 1))
            continue
        fi
        N_QUOTED=$((N_QUOTED + 1))
        # A quotation of a doc comment is written without the comment marker
        # that opens each of its lines, so the marker is stripped from the
        # cited lines before the comparison. Only a leading run is stripped;
        # anything further into the line is source text.
        haystack=$(normalise "$(sed -n "${first},${last}p" "$path" | sed -E 's@^[[:space:]]*(///?!?|#+)[[:space:]]*@@')")
        needle=$(normalise "$quote")
        case "$haystack" in
            *"$needle"*) ;;
            *) fail_content "$doc:$dline quotes \"$quote\", and that text is not at \`$tok\`" ;;
        esac
    done < <(extract_citations "$doc")
done

# --- summary ---------------------------------------------------------------
echo "docs/verify-citations.sh: docs/design/*.md excluding *.zh.md, plus docs/architecture.md"
echo "  documents scanned:      $N_DOCS"
echo "  citations found:        $N_FOUND"
echo "  in scope:               $N_INSCOPE"
echo "  skipped, path is outside this repository's tree: $N_SKIP_OUTSIDE"
echo "  skipped, bare filename with no directory to resolve against: $N_SKIP_BARE"
echo "  skipped, a host and a port rather than a citation: $N_SKIP_HOSTPORT"
echo "  resolution failures:    $FAIL_RESOLVE"
echo "  content failures:       $FAIL_CONTENT"
echo "  in-scope citations carrying a quote: $N_QUOTED"
echo "  in-scope citations carrying no quote, resolution checked only: $N_NOQUOTE"
echo "  not checked here, and not checkable: a provenance claim such as \"measured at <commit>\" is validated against no file at all, so a green run here does not mean the citations are handled"

TOTAL_FAIL=$((FAIL_RESOLVE + FAIL_CONTENT))
if [ "$ADVISORY" -eq 1 ]; then
    echo "docs/verify-citations.sh: advisory run, exit 0 whatever the counts above say"
    exit 0
fi
if [ "$TOTAL_FAIL" -ne 0 ]; then
    echo "docs/verify-citations.sh: $TOTAL_FAIL FAILED, $((N_INSCOPE - TOTAL_FAIL)) passed" >&2
    exit 1
fi
echo "docs/verify-citations.sh: $N_INSCOPE/$N_INSCOPE PASS"
