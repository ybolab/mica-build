#!/usr/bin/env bash
# Asserts that the `path:line` citations in the English design documents still
# resolve, and that where the citing text quotes its source, the quote still
# appears at the lines it cites. Read-only: it opens files and prints, and
# changes nothing. It needs no network, no root and no container -- bash,
# coreutils, grep, sed, awk and `git ls-files`. The one addition to
# docs/verify-index.sh's floor is git, and it is load-bearing rather than
# convenient: the no-slash citation form below resolves against the set of
# TRACKED files, which is a question only git can answer.
#
#   bash docs/verify-citations.sh [--advisory]   (or: make docs-verify-citations)
#
# Scope. The documents scanned are docs/design/*.md, docs/task/*.md and
# docs/research/*.md, each excluding *.zh.md, plus docs/architecture.md.
# `*.zh.md` is excluded for the same reason docs/verify-index.sh excludes it:
# whether the Chinese translations are kept current is a question parked with
# the user, so a translated sibling must not fail a check here while that is
# unresolved. docs/task and docs/research entered scope with RFCT-172: their
# citations were scanned by no gate at all (RFCT-159 finding a measured 77
# stale ones), which is a silent space, not a policy.
#
# Dated records. Some documents in the widened scope are frozen records of a
# past measurement -- a worklist pinned at a commit, an inventory of a tree
# that has since moved. Their citations name where things WERE, and re-pointing
# them at today's tree would falsify the record (RFCT-159 finding a;
# RFCT-079's rule: dated claims bind to their period). Such a document declares
# itself with a marker line anywhere in its body:
#
#   <!-- dated-record: <what is frozen, and at what point> -->
#
# A marked document is exempt from both checks, and the exemption is never
# silent: the summary counts the exempted documents and names each one, one
# line per file, so "left alone" is evidenced in every run, and the marker is a
# committed, diffable decision in the exempted file itself (the PLAN-018
# Amendment-1 pattern). The marker exempts whichever scanned file carries it --
# a marker on a file nobody classified as dated still prints in the census, so
# review reads the census rather than trusting silence.
#
# A citation is a backticked token of the form `path:line` or `path:line-line`.
# A path containing a `/` is in scope when its first segment names a directory
# that exists at the repo root.
#
# The no-slash form. A path with no `/` at all -- `routes.rs:2545` -- matched
# the token regex and was then dropped, on the ground that `routes.rs:95`
# is shorthand for a path named earlier in the prose and has no base to resolve
# against. That left 392 citations in this corpus checked by nothing (RFCT-214
# measured the class, RFCT-256 closed it), which is silence rather than a
# policy. The form is now read the way a reader reads it. If the token is itself a tracked path, it IS a citation and
# resolves to that file: `Makefile:31` and `.gitignore:8` name repository-root
# files whose path happens to carry no directory. Otherwise the tracked files
# whose basename it names are its candidates, and exactly one candidate
# resolves it. Several candidates is an ERROR that names them all, because a
# gate that picked the first would assert a file the writer did not mean --
# `bus.rs:461` is os/pkgs/mosd/mosd/src/bus.rs or os/pkgs/mosd/mosd/tests/bus.rs
# and nothing here can tell which. That is fixed by writing the citation in
# full in the document, never by a waiver here. No candidate at all is a
# counted SKIP, not a failure: `localhost:8080`, `eth0:1`, `10-base:`,
# `do_mounts.c:1442` and `PageSettingsWifi.qml:74` all land there, and a gate
# that failed on a host and a port would be broken rather than strict.
#
# Candidates come from `git ls-files` and not from a filesystem walk. A walk
# would pull in target/ and node_modules/, whose basenames would make ordinary
# names spuriously ambiguous, and a citation into a build artefact is not a
# citation into this repository. Nothing else is excluded.
#
# Metalinguistic examples. Some documents quote the citation FORM rather than
# citing anything: docs/task/RFCT-214.md writes `` `routes.rs:2545` `` as an
# example of the form under discussion, and docs/task/RFCT-170.md quotes whole
# quote-and-citation pairs as illustrations of an adjacency rule. Under the
# basename rule those resolve and would go silently green while asserting
# nothing, so a no-slash token inside a `` double-backtick span `` is a counted
# SKIP with its own reason -- eight sites in two documents when the rule
# landed. Only the no-slash form is treated this way: a full-form citation
# inside such a span is resolved and green today, and taking it out of scope
# would loosen an assertion this milestone had no mandate to loosen.
#
# Everything else is skipped by reason and counted, never dropped:
# `0.0.0.0:443` is a host and a port; `u-boot/env/mmc.c:118` and
# `axum-0.8.9/src/lib.rs:10` cite trees this repository does not contain and
# never will. Each of those reasons appears in the summary with its count,
# because a summary that reads "N checked" while M were never opened is the
# false assurance this check exists to prevent.
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
# segment (`os/`, `docs/`, ...) -- of the path the citation RESOLVED to, so a
# no-slash citation to a repository-root file counts under that file's own name
# (`Makefile`, `.gitignore`) -- and docs/verify-citations-baseline.txt holds a
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
# The ratchet. Class 1 -- an unquoted citation that resolves but names the
# wrong line (RFCT-128's worked example) -- is not mechanisable without a
# quote, so it is held by policy instead:
# docs/verify-citations-unquoted-baseline.txt commits a per-document CEILING
# on the unquoted count, and a document whose count EXCEEDS its row FAILS the
# run. A document with no row has a ceiling of 0, so new documents start
# fully quoted. Dated records are exempt exactly as they are from the checks
# themselves. Update procedure: when a document's unquoted count drops, lower
# its row -- or delete it at zero -- in the SAME commit, so the ratchet only
# ever tightens; when a new unquoted citation is genuinely wanted, raising
# the row in the same commit is the explicit, reviewable override. The file
# is required, like the census baseline: a missing file is an error, not an
# empty set of ceilings.
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
UNQUOTED_BASELINE=docs/verify-citations-unquoted-baseline.txt

# The tracked files, indexed both by full path and by basename, for resolving
# the no-slash citation form. `git ls-files` and not a `find`: see the header.
# A repository with no tracked files at all is a broken invocation rather than
# an empty index, so it is an error here instead of 392 silent skips later.
command -v git >/dev/null 2>&1 || {
    echo "error: git is not on PATH; the no-slash citation form has no tracked-file set to resolve against" >&2
    exit 1
}
declare -A TRACKED=()
declare -A BYBASE=()
N_TRACKED=0
while IFS= read -r tracked_path; do
    [ -n "$tracked_path" ] || continue
    TRACKED[$tracked_path]=1
    tracked_base=${tracked_path##*/}
    BYBASE[$tracked_base]="${BYBASE[$tracked_base]:+${BYBASE[$tracked_base]} }$tracked_path"
    N_TRACKED=$((N_TRACKED + 1))
done < <(git ls-files)
[ "$N_TRACKED" -gt 0 ] || {
    echo "error: \`git ls-files\` listed no files here; the no-slash citation form cannot be resolved" >&2
    exit 1
}

FAIL_RESOLVE=0
FAIL_CONTENT=0
FAIL_AMBIGUOUS=0
FAIL_CENSUS=0
FAIL_RATCHET=0
N_DOCS=0
N_FOUND=0
N_INSCOPE=0
N_QUOTED=0
N_NOQUOTE=0
N_NEARMISS=0
N_SKIP_HOSTPORT=0
N_SKIP_BARE_OUTSIDE=0
N_SKIP_BARE_META=0
N_BARE_RESOLVED=0
N_SKIP_OUTSIDE=0
N_DATED=0
DATED_DOCS=()
declare -A SEG_COUNT=()
declare -A NOQUOTE_BY_DOC=()

fail_resolve()   { echo "  FAIL $*" >&2; FAIL_RESOLVE=$((FAIL_RESOLVE + 1)); }
fail_content()   { echo "  FAIL $*" >&2; FAIL_CONTENT=$((FAIL_CONTENT + 1)); }
fail_ambiguous() { echo "  FAIL $*" >&2; FAIL_AMBIGUOUS=$((FAIL_AMBIGUOUS + 1)); }
fail_census()  { echo "  FAIL $*" >&2; FAIL_CENSUS=$((FAIL_CENSUS + 1)); }
fail_ratchet() { echo "  FAIL $*" >&2; FAIL_RATCHET=$((FAIL_RATCHET + 1)); }

# Every citation token in the document named by $1, one per line, tab
# separated: citing line, path, first line, last line, the token as written,
# the quote kind (`text`, `code` or `none`), the near-miss flag (0 or 1), the
# metalinguistic flag (0 or 1: the token sits inside a `` double-backtick
# span ``, so it quotes the citation form rather than citing), and
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
        # Is position p inside one of the double-backtick spans found below?
        function in_metaspan(p, q,    t) {
            for (t = 1; t <= nspan; t++)
                if (spanb[t] <= p && q <= spane[t]) return 1
            return 0
        }
        { txt = txt $0 "\n" }
        END {
            # The `` spans, left to right. A run of three or more backticks is a
            # fenced block rather than an inline span, so it is stepped over.
            nspan = 0; i = 1
            while ((k = index(substr(txt, i), "``")) > 0) {
                b = i + k - 1
                if (substr(txt, b, 3) == "```") { i = b + 3; continue }
                m = index(substr(txt, b + 2), "``")
                if (m == 0) break
                e = b + 2 + m - 1
                nspan++; spanb[nspan] = b; spane[nspan] = e + 1
                i = e + 2
            }

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
                meta = in_metaspan(abs, tokend - 1)
                printf "%d\t%s\t%d\t%d\t%s\t%s\t%d\t%d\t%s\n", line, path, first, last, tok, qkind, near, meta, q

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
# The widened scope (RFCT-172). The existence guard is for the self-test's
# fixture trees, which may build only docs/design; a real tree missing either
# directory would already have failed docs/verify-index.sh.
for doc in docs/task/*.md docs/research/*.md; do
    case "$doc" in *.zh.md) continue ;; esac
    [ -e "$doc" ] || continue
    DOCS+=("$doc")
done

for doc in "${DOCS[@]}"; do
    [ -f "$doc" ] || { echo "error: $doc not found" >&2; exit 1; }
    N_DOCS=$((N_DOCS + 1))
    if grep -q '^<!-- dated-record:' "$doc"; then
        N_DATED=$((N_DATED + 1))
        DATED_DOCS+=("$doc")
        continue
    fi
    NOQUOTE_BY_DOC[$doc]=0
    while IFS=$'\t' read -r dline path first last tok qkind near meta quote; do
        N_FOUND=$((N_FOUND + 1))

        resolved=$path
        case "$path" in
            */*)
                if [ ! -d "${path%%/*}" ]; then
                    N_SKIP_OUTSIDE=$((N_SKIP_OUTSIDE + 1)); continue
                fi
                ;;
            *[!0-9.]*)
                # The no-slash form. Read by the tracked-path-then-unique-
                # basename rule of the header, in that order: an exact tracked
                # path is a citation written in full that happens to carry no
                # directory, and it is never ambiguous.
                if [ "$meta" = 1 ]; then
                    N_SKIP_BARE_META=$((N_SKIP_BARE_META + 1)); continue
                fi
                if [ -z "${TRACKED[$path]+x}" ]; then
                    cands=${BYBASE[$path]:-}
                    if [ -z "$cands" ]; then
                        N_SKIP_BARE_OUTSIDE=$((N_SKIP_BARE_OUTSIDE + 1)); continue
                    fi
                    case "$cands" in
                        *' '*)
                            fail_ambiguous "$doc:$dline cites \`$tok\`, and $path is the basename of several tracked files: $cands; write the citation in full so it names one"
                            continue ;;
                    esac
                    resolved=$cands
                fi
                N_BARE_RESOLVED=$((N_BARE_RESOLVED + 1))
                ;;
            *)
                # digits and dots only, and no directory: an address and a port
                N_SKIP_HOSTPORT=$((N_SKIP_HOSTPORT + 1)); continue ;;
        esac
        # The resolved path, so a bare filename is reported where it landed
        via=""
        [ "$resolved" = "$path" ] || via=" (resolved to $resolved)"
        N_INSCOPE=$((N_INSCOPE + 1))
        seg=${resolved%%/*}
        SEG_COUNT[$seg]=$((${SEG_COUNT[$seg]:-0} + 1))

        # --- check 1: resolution -------------------------------------------
        if [ ! -e "$resolved" ]; then
            fail_resolve "$doc:$dline cites \`$tok\`$via, and $resolved does not exist"
            continue
        fi
        if [ ! -f "$resolved" ]; then
            fail_resolve "$doc:$dline cites \`$tok\`$via, and $resolved is not a regular file"
            continue
        fi
        if [ "$first" -lt 1 ] || [ "$last" -lt 1 ]; then
            fail_resolve "$doc:$dline cites \`$tok\`$via, and line numbers start at 1"
            continue
        fi
        nlines=$(awk 'END { print NR }' "$resolved")
        if [ "$first" -gt "$nlines" ] || [ "$last" -gt "$nlines" ]; then
            fail_resolve "$doc:$dline cites \`$tok\`$via, and $resolved has $nlines lines"
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
        haystack=$(normalise "$(sed -n "${first},${last}p" "$resolved" | sed -E 's@^[[:space:]]*(///?!?|#+)[[:space:]]*@@')")
        needle=$(normalise "$quote")
        case "$haystack" in
            *"$needle"*) ;;
            *) fail_content "$doc:$dline quotes \"$quote\", and that text is not at \`$tok\`$via" ;;
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

# --- the per-document unquoted counts against their committed ceilings -------
if [ ! -f "$UNQUOTED_BASELINE" ]; then
    echo "error: $UNQUOTED_BASELINE not found; the unquoted ratchet has no ceilings to check against" >&2
    exit 1
fi
declare -A UNQ_CEIL=()
while read -r bdoc ceil _rest; do
    case "$bdoc" in ''|'#'*) continue ;; esac
    case "$ceil" in
        ''|*[!0-9]*)
            echo "error: $UNQUOTED_BASELINE names $bdoc with ceiling '$ceil', which is not a number" >&2
            exit 1 ;;
    esac
    UNQ_CEIL[$bdoc]=$ceil
done < "$UNQUOTED_BASELINE"
for doc in "${DOCS[@]}"; do
    # a dated record never entered the count, so the ratchet never reads it
    [ -n "${NOQUOTE_BY_DOC[$doc]+x}" ] || continue
    ceil=${UNQ_CEIL[$doc]:-0}
    if [ "${NOQUOTE_BY_DOC[$doc]}" -gt "$ceil" ]; then
        fail_ratchet "$doc has ${NOQUOTE_BY_DOC[$doc]} unquoted citations, above its ceiling $ceil in $UNQUOTED_BASELINE; quote the new citation, or raise the ceiling in the same commit so the diff shows the decision"
    fi
done

# --- summary ---------------------------------------------------------------
echo "docs/verify-citations.sh: docs/design/*.md, docs/task/*.md and docs/research/*.md excluding *.zh.md, plus docs/architecture.md"
echo "  documents scanned:      $N_DOCS"
echo "  exempted as dated records, citations not checked: $N_DATED"
for doc in "${DATED_DOCS[@]}"; do
    echo "  dated record: $doc"
done
echo "  citations found:        $N_FOUND"
echo "  in scope:               $N_INSCOPE"
for seg in $(printf '%s\n' "${!SEG_COUNT[@]}" | sort); do
    echo "  in scope, first segment $seg/: ${SEG_COUNT[$seg]}"
done
echo "  in scope, bare filename resolved against the tracked files: $N_BARE_RESOLVED"
echo "  skipped, path is outside this repository's tree: $N_SKIP_OUTSIDE"
echo "  skipped, bare filename matching no tracked file, so outside this tree: $N_SKIP_BARE_OUTSIDE"
echo "  skipped, bare filename quoted as an example of the citation form: $N_SKIP_BARE_META"
echo "  skipped, a host and a port rather than a citation: $N_SKIP_HOSTPORT"
echo "  resolution failures:    $FAIL_RESOLVE"
echo "  content failures:       $FAIL_CONTENT"
echo "  ambiguous bare filenames: $FAIL_AMBIGUOUS"
echo "  census failures:        $FAIL_CENSUS"
echo "  ratchet failures:       $FAIL_RATCHET"
echo "  in-scope citations carrying a quote: $N_QUOTED"
echo "  in-scope citations carrying no quote, resolution checked only: $N_NOQUOTE"
for doc in "${DOCS[@]}"; do
    # a dated record never entered the count, so it has no line here
    [ -n "${NOQUOTE_BY_DOC[$doc]+x}" ] || continue
    echo "  no quote, by document: $doc ${NOQUOTE_BY_DOC[$doc]}"
done
echo "  near-miss: no quote armed, but a quoted span sits 1-3 words away: $N_NEARMISS"
echo "  not checked here, and not checkable: a provenance claim such as \"measured at <commit>\" is validated against no file at all, so a green run here does not mean the citations are handled"
echo "  not distinguished: a skipped-as-outside path that once existed in this tree reads the same as one that never did, and a bare filename matching no tracked file is the same refusal by the same reason"

TOTAL_FAIL=$((FAIL_RESOLVE + FAIL_CONTENT + FAIL_AMBIGUOUS + FAIL_CENSUS + FAIL_RATCHET))
if [ "$ADVISORY" -eq 1 ]; then
    echo "docs/verify-citations.sh: advisory run, exit 0 whatever the counts above say"
    exit 0
fi
if [ "$TOTAL_FAIL" -ne 0 ]; then
    echo "docs/verify-citations.sh: $TOTAL_FAIL FAILED ($FAIL_RESOLVE resolution, $FAIL_CONTENT content, $FAIL_AMBIGUOUS ambiguous, $FAIL_CENSUS census, $FAIL_RATCHET ratchet), $((N_INSCOPE - FAIL_RESOLVE - FAIL_CONTENT)) citations passed" >&2
    exit 1
fi
echo "docs/verify-citations.sh: $N_INSCOPE/$N_INSCOPE PASS"
