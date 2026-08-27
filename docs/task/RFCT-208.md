# RFCT-208 PLAN-022 records brought green under PLAN-020's hardened docs gates

- **status**: completed — 12 content failures resolved (7 re-anchored, 4 requoted, 1 provenance-pinned), 2 ratchet rows added, RFCT-200 ratified
- **priority**: P2
- **owner**: bkd/082emjtd
- **createdAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-022 (finding, slot reserved by RFCT-200 section 8)

RFCT-200 section 8 reserves 208 and 209 for findings raised while M2-M8 run.
This is the first of them, and it is not a defect in any milestone's work: it
is the seam between two campaigns that ran in parallel.

## 1. The finding

PLAN-020 hardened the documentation gates while PLAN-022 M1-M4 were being
written on branches cut before that hardening landed. Three of its changes
reach records that were green when authored:

- `docs/verify-citations.sh` widened its scanned set to `docs/task`, so task
  records are content-checked for the first time.
- The same script gained a per-document ceiling on unquoted citations, read
  from `docs/verify-citations-unquoted-baseline.txt`, where a document with
  no row has a ceiling of 0. Every record authored after that file was
  written therefore starts fully quoted, whether or not its author knew.
- `docs/verify-index.sh` gained a closed list of accepted status heads.

On the merged branch this measured 14 citation failures (12 content, 2
ratchet) and 1 index failure, all inside RFCT-200 and RFCT-201. Nothing in
the tree was wrong; the records simply predate the rules now applied to them.

## 2. The status head

RFCT-200 was written with a status head of `review`, meaning design complete
and awaiting the user ratification that is the PLAN-022 M1 gate. That gate
has since been passed: the design was ratified as PLAN-022 Amendment 1, which
is on main, and M2, M3 and M4 are built on it. The head moves to `completed`
with that recorded in its prose, and the `docs/task/index.md` marker follows
it to `[x]`, which is the pairing `docs/verify-index.sh` checks. This is the
workstream's own record; no other file's status marker was touched.

## 3. The twelve citations, one decision each

Every failing citation quotes code as it stood when the design was measured,
at `4580dfb`, and M2-M4 have since moved it. The question is per citation,
not per document: does the sentence still describe the current tree, or does
it describe the world the design was about to replace?

**Seven re-anchored, quote unchanged.** The construct stands and only its
line numbers moved: `StaticConfig`'s address, gateway and dns fields; the
`/network` route; the mosd proxy's service name; the settings and live-state
rows of the api.md route table; `deny_unknown_fields` on `IfaceSettings`,
which M3 extended with new fields but left denying unknown ones; and the
v3-to-v2 downgrade rationale that M3's migration reuses.

**Four re-anchored with the quote refreshed.** In each the fragment named a
construct rather than excerpting the cited lines, so it could never have
passed the content check, in this tree or the one it was written against —
`Settings::set` twice, and the install stage described by its repository path
while the Dockerfile spells the same script through its bind mount. The
fourth is section 2.1's claim that apid's writers quote a dotted segment:
that was the design speaking about the tree it was about to change, and M2
landed it, so the citation now points at `iface_settings_path`, where the
claim reads true of the current tree.

**One provenance-pinned.** Section 1.3 is the end-to-end measurement of the
pre-M2 world, and its dot-path write is exactly what M2 replaced. Re-pointing
it at today's writer would falsify the record of what was measured, so it
keeps the quote and drops the line number, naming the file and the commit
instead — a provenance claim, which the script's own header says is validated
against no file at all. That is the honest form here: the claim is about a
commit, and nothing mechanical can check it.

## 4. The ratchet rows

With the content check satisfied, both records still failed the ceiling that
a missing row sets to 0. Rows were added at the measured counts, taken after
the citation pass rather than before it: RFCT-200 at 65 and RFCT-201 at 2.
The baseline's update procedure calls a raise the explicit, reviewable
override, which is what these are — the alternative, a `dated-record` marker,
would have exempted the whole document from both checks and from the ratchet
itself, and RFCT-200 is a live design record that M5-M8 still cite, not a
frozen worklist.

What those 67 unquoted citations mean is worth stating plainly, because a
green run does not mean they are all correct. They resolve, and policy holds
them at a ceiling that can only fall; class 1 — a resolving citation naming
the wrong line — is not mechanisable without a quote, which is why the
ratchet exists. Some of RFCT-200's are certainly stale in that sense, section
1's inventory of a tree M2-M4 rewrote most of all. They were left alone
deliberately: re-pointing them would mean rewriting design prose about a
superseded world, which is the falsification the dated-record reasoning
warns against, and the ceiling records the debt where a later pass can see it.

## 5. Scope and checks

Edited: `docs/task/RFCT-200.md` (citations, status head), the unquoted
baseline, `docs/task/index.md`, and this record. RFCT-201's citations were
not edited; only its ceiling row was added. No source file, design document
or other record was touched, and design prose is unchanged throughout — the
diff is citations, quotes, one status line and two baseline rows.

The census baseline needed no change: `os/` counts 1027 in-scope citations
against a floor of 935 and `docs/` 200 against 176, so the single citation
the provenance pin retired breaches no floor.

Both gates are green: `docs/verify-citations.sh` at 1234/1234 and
`docs/verify-index.sh` at 712/712. No code changed, so the Rust gates do not
apply and were not run.
