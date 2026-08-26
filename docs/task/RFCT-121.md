# RFCT-121 PLAN-015 M4: the docs citation checker, resolution and content

- **status**: done
- **priority**: P2
- **owner**: PLAN-015 M4
- **createdAt**: 2026-08-26
- **plan**: PLAN-015 (M4)

`docs/verify-citations.sh` checks the `path:line` citations in the English
design documents. `make docs-verify-citations` runs it as a gate;
`make docs-verify-citations-test` runs its negative tests; the offline CI job
runs both. It is read-only, and needs bash, coreutils, grep, sed and awk and
nothing else.

## What it checks

Documents scanned: `docs/design/*.md` excluding `*.zh.md`, plus
`docs/architecture.md`. The translations are excluded for the reason
`docs/verify-index.sh` excludes them: whether they are kept current is a
question parked with the user.

A citation is a backticked `path:line` or `path:line-line` token. It is in
scope only when its path contains a `/` and its first segment names a directory
that exists at the repo root.

**Check 1, resolution.** The path exists, is a regular file, and both ends of
the range are at least 1 and at most the file's line count.

**Check 2, content.** A citation carries a quote when it directly follows a
quoted fragment, with nothing between the two but whitespace, the emphasis
characters `*` and `_`, and an optional opening parenthesis, and with no blank
line between them. A quoted fragment is a double-quoted span or a backticked
code span of at least three characters; a backticked span that is itself a
`path:line` token is a chained citation, not a quote. The fragment must then
appear within the cited lines. Comparison collapses whitespace runs to one
space, drops `*`, and strips the comment marker opening each cited line (`//`,
`///`, `//!`, `#`), so a reflowed paragraph, a bolded word, or a quotation of a
doc comment written without its markers does not fail. Nothing else is
normalised, `_` included, so a renamed identifier is caught: the case that
decides this design is a source comment quoted in one document under two
different daemon names, which a resolution-only check passes on both times.

## What it does not check

A provenance claim -- "measured at `<commit>`", "as of 2026-08-19" -- is
validated against no file at all. The check reads the working tree; nothing
mechanical validates a claim about a commit, and moving citations to symbol
anchors would not change that. Those claims are a permanent human
responsibility, and a green run does not mean the citations are handled. The
script header says this, the summary prints it, and the negative tests assert
that it is printed.

Three further classes are out of scope by construction, and each is counted and
named in the summary rather than dropped: a host and a port (`0.0.0.0:443`), a
bare filename that is shorthand for a path named earlier in the prose
(`routes.rs:95-105`), and a citation into a tree this repository does not
contain (`u-boot/env/mmc.c:118`, `axum-0.8.9/src/lib.rs:10`). An in-scope
citation carrying no quote gets check 1 only; that count is printed too.

That last class carries a limit of its own. A citation whose first path segment
is not a repo-root directory is skipped as outside this tree and counted there,
never failed -- so `talos/hack/cx3576/dev-config/config.yaml`, a path that did
exist here, reads exactly like `axum-0.8.9/src/lib.rs:10`, which never did. The
script header says this and the summary prints it. It was found by tripping over
a dangling `talos/` path in `docs/design/provisioning.md`, not by reasoning
about the scope rule.

A second limit sits beside the provenance one and is not mechanical either. A
citation whose line still resolves while the text it named has moved is
invisible to the checker when the citation carries no quote: check 1 passes on
the new occupant of that line, and there is no check 2 to run. RFCT-128 records
the campaign's instance.

The content check reads its fragment as a literal excerpt, so a fragment that
names a thing rather than quoting the source is reported when the name does not
appear in the cited lines. Moving such a fragment away from the citation is the
way to say it is not a quotation.

## Measured, first run over this tree

`bash docs/verify-citations.sh` exits 1. 16 documents scanned, 1027 citations
found, 761 in scope. Skipped: 197 bare filenames, 56 paths outside this tree,
13 host and port pairs. 157 resolution failures -- 156 citations into files
that are not here (64 `mosd/webd/src/routes.rs`, 22 `mosd/webd/src/session.rs`,
12 `os/verify-image-v2.sh`, 10 `mosd/dist/webd.service`, 9
`mosd/webd/src/bus_client.rs`, 8 `os/mkimage.sh`, and a tail) and one line past
the end of its file (`mosd/hack/build-aarch64.sh:9`, which has 7 lines). 180
in-scope citations carry a quote and 140 of those quotes are no longer at the
lines they cite. 424 in-scope citations carry no quote. By document: 231
failures in `api.md`, 55 in `dashboard.md`, 10 in `uboot-ab-handshake.md`, 1 in
`bus.md`.

`bash docs/verify-citations.sh --advisory` exits 0 over the same tree and
reports the same counts.

## Why the counts above are drift, not defects

The 297 failures above are real drift in the documents, not defects in the
check. `--advisory` exists so a tree carrying known drift can report it without
turning the whole suite red; the Makefile target and the CI step do not pass it,
and a citation that does not resolve, or a quote no longer at the lines it
cites, fails the build. RFCT-128 records the repair that made that honest.

## Negative tests

`docs/verify-citations-test.sh` runs the real checker over an authored fixture,
16 cases. Every assertion is driven red at least once: a missing path, a path
that resolves to a directory, a line past the end, a range whose far end is
past the end, line zero, a negative line, a quotation the document renamed, a
quotation the source renamed underneath it, and a quoted code span the source
shortened. The controls are a clean baseline, a quotation rewrapped and bolded,
a document of nothing but host and port pairs, and a document of nothing but
upstream citations. The summary itself is asserted: the skipped counts, the
provenance limit, and -- against a document with nothing skipped -- that each
skipped category still prints its zero. `--advisory` is asserted to report the
same failure and exit 0.

The fixture is authored rather than copied from the shipped documents, which is
where this departs from `docs/verify-index-test.sh`. The shipped corpus is red,
so it cannot serve as a positive control.
