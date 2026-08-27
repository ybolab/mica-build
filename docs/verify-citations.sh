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
# quote when it sits directly against a quoted fragment on EITHER side -- the
# quote before the citation or the citation before the quote -- with nothing
# between the two but whitespace, the emphasis characters `*` and `_`, an
# optional parenthesis facing the right way (opening before a trailing
# citation, closing after a leading one), and with no blank line between them:
# quote and citation sit in one paragraph. When both sides carry a fragment the
# one BEFORE the citation wins, which keeps every pairing the backward-only
# rule made. A quoted fragment is a double-quoted span or a backticked code
# span, at least three characters long; a backticked span that is itself a
# `path:line` token is a chained citation and not a quote, in either direction.
# The fragment is read as a literal excerpt of the cited lines and must appear
# within them, so a fragment that names a thing rather than quoting it belongs
# anywhere but directly against the citation. Comparison collapses whitespace
# runs to one space, drops `*`, and strips the comment marker that opens each
# cited line (`//`, `///`, `//!`, `#`), so reflowing a paragraph, bolding a
# word inside a quote, or quoting a doc comment without its markers does not
# fail it. Nothing else is normalised, `_` included, so a renamed identifier is
# caught. A citation with no quote gets check 1 only. That is expected, and the
# count is in the summary -- per document, one line each, so the ratchet
# RFCT-173 records has a stable line to read.
#
# The adjacency is deliberately zero-tolerance: ONE interposed word between
# quote and citation demotes the pair to resolution-only. Measured over this
# corpus before the rule was chosen (RFCT-170): at a tolerance of 1, 2 and 3
# words the candidates number roughly 62, 129 and 58, and even at one word the
# genuine pairs ("`axum = \"0.8\"` at `Cargo.toml:45`") are inseparable from
# coincidences (adjacent table cells across `|`, appositions across a comma)
# without a word allowlist that would rot. So no N arms the check, and the
# demoted class is SURFACED instead of silent: a citation with no armed quote
# but a quoted span 1 to 3 whitespace-delimited words away, on either side in
# the same paragraph, is counted in the summary as a near-miss (RFCT-155's
# "around" case is one). A near-miss never fails the run; it marks prose worth
# tightening so the quote actually gets checked.
#
# The census. The summary reports the in-scope citation count per first path
# segment (`os/`, `docs/`, ...), and docs/verify-citations-baseline.txt holds a
# committed floor per segment. A segment named there FAILS the run when its
# count reaches zero or falls below its floor. This is what catches a
# repository-root directory vanishing out from under its citations: the scope
# rule reclassifies them as skipped-outside and a bare pass count shrinks
# silently (RFCT-167 lost six citations that way). Updating the baseline: when
# a drop is intended -- citations rewritten, a tree renamed -- lower or remove
# the segment's row in the SAME commit, so the diff shows the decision; when
# citations grow, raising the floor is optional but keeps the ratchet tight.
# The baseline file is required: a missing baseline is an error, not an empty
# set of floors.
#
# What this cannot check, permanently, by this design and by every alternative.
# A provenance claim -- "measured at <commit>", "as of 2026-08-19" -- is
# validated against no file at all. This check reads the working tree; nothing
# mechanical validates a claim about a commit, and moving citations to symbol
# anchors would not change that. Those claims stay a human responsibility, and a
# green run here does not mean the citations are handled.
#
# A citation whose first path segment is not a repo-root directory --
# `talos/hack/...` -- is SKIPPED as outside this tree, never failed. A path that
# once existed here is indistinguishable from one that never did.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ADVISORY=0
case "${1:-}" in
    --advisory) ADVISORY=1 ;;
    "")         ;;
    *)          echo "usage: bash docs/verify-citations.sh [--advisory]" >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { echo "usage: bash docs/verify-citations.sh [--advisory]" >&2; exit 2; }

BASELINE=docs/verify-citations-baseline.txt

FAIL_RESOLVE=0
FAIL_CONTENT=0
FAIL_CENSUS=0
N_DOCS=0
N_FOUND=0
N_INSCOPE=0
N_QUOTED=0
N_NOQUOTE=0
N_NEARMISS=0
N_SKIP_HOSTPORT=0
N_SKIP_BARE=0
N_SKIP_OUTSIDE=0
declare -A SEG_COUNT=()
declare -A NOQUOTE_BY_DOC=()

fail_resolve() { echo "  FAIL $*" >&2; FAIL_RESOLVE=$((FAIL_RESOLVE + 1)); }
fail_content() { echo "  FAIL $*" >&2; FAIL_CONTENT=$((FAIL_CONTENT + 1)); }
fail_census()  { echo "  FAIL $*" >&2; FAIL_CENSUS=$((FAIL_CENSUS + 1)); }

# Every citation token in the document named by $1, one per line, tab
# separated: citing line, path, first line, last line, the token as written,
# the quote kind (`text`, `code` or `none`), the near-miss flag (0 or 1), and
# the quote. Only the last field can be empty, which is what keeps a
# tab-delimited read of this correct: with tab in IFS an interior empty field
# would collapse into its neighbour, so the quote kind says `none` rather than
# being left blank.
#
# The scan is one left-to-right pass over the whole document, because both the
# line number and the paragraph start have to advance with it: recomputing
# either from the top per token would be quadratic on a document this size.
# Quotes span lines and so does the gap between a quote and its citation, which
# is why the document is held as one string rather than read line by line.
extract_citations() {
    awk '
        # A candidate span is a quote when, whitespace-collapsed, it is at
        # least three characters and (for a backticked span) is not itself a
        # chained `path:line` citation.
        function span_ok(cand, ch) {
            gsub(/[ \t\n]+/, " ", cand); sub(/^ /, "", cand); sub(/ $/, "", cand)
            if (length(cand) < 3) return 0
            if (ch == "`" && cand ~ /^[^ ]+:-?[0-9]+(--?[0-9]+)?$/) return 0
            return 1
        }
        # A quoted span 1-3 whitespace-delimited words before position j,
        # within the paragraph starting at para. Zero words is the armed case
        # and is not a near-miss.
        function nearmiss_bw(j, para,    words, ch, k) {
            words = 0
            while (words <= 3) {
                while (j >= para && substr(txt, j, 1) ~ /[ \t\n*_()]/) j--
                if (j < para) return 0
                ch = substr(txt, j, 1)
                if (ch == "`" || ch == "\"") {
                    if (words < 1) return 0
                    k = j - 1
                    while (k >= para && substr(txt, k, 1) != ch) k--
                    if (k < para) return 0
                    return span_ok(substr(txt, k + 1, j - k - 1), ch)
                }
                while (j >= para && substr(txt, j, 1) !~ /[ \t\n*_()`"]/) j--
                words++
            }
            return 0
        }
        # The mirror: a quoted span 1-3 words after position j, before the
        # paragraph edge at paraend.
        function nearmiss_fw(j, paraend,    words, ch, k) {
            words = 0
            while (words <= 3) {
                while (j < paraend && substr(txt, j, 1) ~ /[ \t\n*_()]/) j++
                if (j >= paraend) return 0
                ch = substr(txt, j, 1)
                if (ch == "`" || ch == "\"") {
                    if (words < 1) return 0
                    k = j + 1
                    while (k < paraend && substr(txt, k, 1) != ch) k++
                    if (k >= paraend) return 0
                    return span_ok(substr(txt, j + 1, k - j - 1), ch)
                }
                while (j < paraend && substr(txt, j, 1) !~ /[ \t\n*_()`"]/) j++
                words++
            }
            return 0
        }
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

                # the paragraph edge ahead of the token, for the forward scans:
                # the next blank line, or the end of the document
                tokend = abs + RLENGTH
                i = index(substr(txt, tokend), "\n\n")
                paraend = i > 0 ? tokend + i - 1 : length(txt) + 1

                q = ""; qkind = "none"; near = 0

                # backward: a quote directly before the citation. This branch
                # is the original rule, unchanged, and it wins when both sides
                # carry a fragment.
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

                # forward: the citation directly before a quote, the mirrored
                # adjacency -- a closing parenthesis where the backward case
                # allows an opening one (RFCT-163: this ordering never armed)
                if (qkind == "none") {
                    j = tokend
                    while (j < paraend && substr(txt, j, 1) ~ /[ \t\n*_)]/) j++
                    if (j < paraend) {
                        ch = substr(txt, j, 1)
                        if (ch == "`") {
                            k = j + 1
                            while (k < paraend && substr(txt, k, 1) != "`") k++
                            if (k < paraend) {
                                cand = substr(txt, j + 1, k - j - 1)
                                if (cand !~ /^[^ ]+:-?[0-9]+(--?[0-9]+)?$/) { q = cand; qkind = "code" }
                            }
                        } else if (ch == "\"") {
                            k = j + 1
                            while (k < paraend && substr(txt, k, 1) != "\"") k++
                            if (k < paraend) { q = substr(txt, j + 1, k - j - 1); qkind = "text" }
                        }
                    }
                    gsub(/[ \t\n]+/, " ", q); sub(/^ /, "", q); sub(/ $/, "", q)
                    if (length(q) < 3) { q = ""; qkind = "none" }
                }

                # near-miss: nothing armed, but a quoted span sits 1-3 words
                # away on either side -- the demoted class, counted not checked
                if (qkind == "none") {
                    near = nearmiss_bw(abs - 1, para)
                    if (!near) near = nearmiss_fw(tokend, paraend)
                }

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
                printf "%d\t%s\t%d\t%d\t%s\t%s\t%d\t%s\n", line, path, first, last, tok, qkind, near, q

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
    NOQUOTE_BY_DOC[$doc]=0
    while IFS=$'\t' read -r dline path first last tok qkind near quote; do
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
        seg=${path%%/*}
        SEG_COUNT[$seg]=$((${SEG_COUNT[$seg]:-0} + 1))

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
            NOQUOTE_BY_DOC[$doc]=$((NOQUOTE_BY_DOC[$doc] + 1))
            if [ "$near" = 1 ]; then
                N_NEARMISS=$((N_NEARMISS + 1))
            fi
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

# --- the census against its committed floors --------------------------------
if [ ! -f "$BASELINE" ]; then
    echo "error: $BASELINE not found; the per-segment census has no floors to check against" >&2
    exit 1
fi
while read -r seg floor _rest; do
    case "$seg" in ''|'#'*) continue ;; esac
    case "$floor" in
        ''|*[!0-9]*)
            echo "error: $BASELINE names segment $seg with floor '$floor', which is not a number" >&2
            exit 1 ;;
    esac
    count=${SEG_COUNT[$seg]:-0}
    if [ "$count" -eq 0 ]; then
        fail_census "segment $seg has 0 in-scope citations, and $BASELINE names it with floor $floor: its citations left scope silently (the RFCT-167 class) or the baseline row is stale"
    elif [ "$count" -lt "$floor" ]; then
        fail_census "segment $seg has $count in-scope citations, below its floor $floor in $BASELINE; lower the floor in the same commit if the drop is intended"
    fi
done < "$BASELINE"

# --- summary ---------------------------------------------------------------
echo "docs/verify-citations.sh: docs/design/*.md excluding *.zh.md, plus docs/architecture.md"
echo "  documents scanned:      $N_DOCS"
echo "  citations found:        $N_FOUND"
echo "  in scope:               $N_INSCOPE"
for seg in $(printf '%s\n' "${!SEG_COUNT[@]}" | sort); do
    echo "  in scope, first segment $seg/: ${SEG_COUNT[$seg]}"
done
echo "  skipped, path is outside this repository's tree: $N_SKIP_OUTSIDE"
echo "  skipped, bare filename with no directory to resolve against: $N_SKIP_BARE"
echo "  skipped, a host and a port rather than a citation: $N_SKIP_HOSTPORT"
echo "  resolution failures:    $FAIL_RESOLVE"
echo "  content failures:       $FAIL_CONTENT"
echo "  census failures:        $FAIL_CENSUS"
echo "  in-scope citations carrying a quote: $N_QUOTED"
echo "  in-scope citations carrying no quote, resolution checked only: $N_NOQUOTE"
for doc in "${DOCS[@]}"; do
    echo "  no quote, by document: $doc ${NOQUOTE_BY_DOC[$doc]}"
done
echo "  near-miss: no quote armed, but a quoted span sits 1-3 words away: $N_NEARMISS"
echo "  not checked here, and not checkable: a provenance claim such as \"measured at <commit>\" is validated against no file at all, so a green run here does not mean the citations are handled"
echo "  not distinguished: a skipped-as-outside path that once existed in this tree reads the same as one that never did"

TOTAL_FAIL=$((FAIL_RESOLVE + FAIL_CONTENT + FAIL_CENSUS))
if [ "$ADVISORY" -eq 1 ]; then
    echo "docs/verify-citations.sh: advisory run, exit 0 whatever the counts above say"
    exit 0
fi
if [ "$TOTAL_FAIL" -ne 0 ]; then
    echo "docs/verify-citations.sh: $TOTAL_FAIL FAILED ($FAIL_RESOLVE resolution, $FAIL_CONTENT content, $FAIL_CENSUS census), $((N_INSCOPE - FAIL_RESOLVE - FAIL_CONTENT)) citations passed" >&2
    exit 1
fi
echo "docs/verify-citations.sh: $N_INSCOPE/$N_INSCOPE PASS"
