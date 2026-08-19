# RFCT-067 PMA records, the task index, and the final consistency pass

- **status**: complete — seven records written and indexed; the consistency pass found one live inconsistency, which is reported with an owner rather than fixed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 15:27
- **claimedAt**: 2026-08-19 17:02
- **completedAt**: 2026-08-19 17:20

Campaign `l1-o7ee8v0o-20260819152142-api` (design proposal, documents only).
Branch `bkd/thxc3jgp`, the last task of the campaign. Base `8f1a957`.

## Description

The closing task: write the PMA record for every L3 in the campaign, index them,
and run the consistency pass that catches what seven separate authors, each
correct within their own section, could not see between them.

`docs/design/api.md` was **complete on this task's base and was not rewritten**.
The only edits made to it are the five listed below, each authorised
specifically and each mechanical.

## Deliverable

Seven records in `docs/task/`, one row each in `docs/task/index.md`:

| record | task |
| --- | --- |
| `RFCT-063.md` | Current API/UI surface inventory and the api.md skeleton |
| `RFCT-064.md` | The API surface and authentication for a programmatic client |
| `RFCT-065.md` | Static hosting, the custom-UI lifecycle, and the safety fallback |
| `RFCT-066.md` | Trust, migration and phasing, and what API-first forecloses |
| `RFCT-067.md` | PMA records, index, and the final consistency pass |
| `RFCT-068.md` | Anchor `mos-ui-inventory.md` as a measurement at a time |
| `RFCT-069.md` | Resolve the auth/CSRF and version-set contradictions |

## The consistency pass — counts, not adjectives

Every check was run, and the number is recorded rather than a verdict.

**Stubs: zero.** RFCT-063 laid 30 stub lines; RFCT-064 consumed 10, RFCT-065 16,
RFCT-066 4.

```
$ grep -c 'Stub — written by' docs/design/api.md
0
$ grep -n 'Stub — written by' docs/design/api.md
(no output)
```

No other placeholder either — a grep for `TODO|TBD|FIXME|XXX|placeholder`
returns nothing.

**The settled inventory is byte-identical, proved at both ends.** §0 and §1
(lines 1-517) were merged by RFCT-063 at `074a7d8` and no later task was
permitted to edit them:

```
$ git show 074a7d8:docs/design/api.md | sed -n '1,517p' | sha256sum
d59478d90d7a244e37783686828e9c4ccd98daa1d52336d63af91731e989b70d  -
$ sed -n '1,517p' docs/design/api.md | sha256sum
d59478d90d7a244e37783686828e9c4ccd98daa1d52336d63af91731e989b70d  -
```

Six merges into one file with the measured half unchanged, verified by hash
rather than asserted.

**Status markers: eleven top-level headings, nine marked, two exempt by
declaration.** §0 and §10 carry none, which is the exemption the document itself
states (`docs/design/api.md:26-29`) on the convention at
`docs/design/access.md:40-41`: they describe no mechanism. §1's subsections
inherit §1's **[implemented]**; §10's inherit the register's exemption. No
heading that describes a mechanism is unmarked.

**Path citations: 63 repo-relative paths extracted, 60 open, 3 accounted for.**
The three that do not open are `mosd/apid/...`, `mosd/apid/Cargo.toml` and
`mosd/webd/...` — two are §0's deliberate description of the post-rename world
and one is an ellipsis form, not a path. No broken citation was found. Non-repo
backticked strings (HTTP routes, MIME types, on-device paths, D-Bus object
paths, the vendored `tower-http-0.6.11/...` source) were excluded; the
`tower-http` citations are correctly qualified in the text as *"the registry
copy of the version pinned at `mosd/Cargo.lock:2364-2366`"*.

**The rename: `RENAME-PENDING`, so nothing was changed.**

```
$ test -d mosd/apid && echo RENAME-LANDED || echo RENAME-PENDING
RENAME-PENDING
```

Campaign `l1-o7ee8v0o-20260819152009-apid` has **not** landed on this base, so
every `mosd/webd/...` path in the document is correct as written and §0's note
stays exactly as it is. It is worth recording that the note is not an
open-ended "until it lands": it is a **mechanical check** (`test -d mosd/apid`)
with both outcomes spelled out (`docs/design/api.md:41-58`), so it does not go
stale the moment the rename merges — it starts answering the other way.

All 16 occurrences of `webd` outside backticks are quoted source comments,
quoted commit-message text, or line-wrapped continuations of a code span. **No
prose sentence uses `webd` where it means the daemon.**

**RFCT-068's six drifts still agree with §1.7**, item for item, and its
citations into `api.md` (`:488-510`, `:515-516`, `:18-20`) all resolve — which
they must, since §1.7 is inside the hash-stable range.

## The five edits made, line by line

Authorised as mechanical commit anchors: a claim about the current tree stated
in an open-ended present tense, whose measurement was confirmed by reading the
tree, gains the commit it was measured at. **No argument was rewritten.**

| line | before → after | confirmed by |
| --- | --- | --- |
| `api.md:532` | "so today every `/api/...`" → "so at `86cd669` every `/api/...`" | `sed -n '44,68p' mosd/webd/src/routes.rs \| grep -c '/api'` → `0` |
| `:926` | "one handler today," → "one handler at `86cd669`," | `mosd/webd/src/routes.rs:441-444` is `setup_submit`'s `set_settings("access.webAdmin", …)` |
| `:1590` | "listeners that exist today" → "listeners that exist at `86cd669`" | `mosd/webd/src/config.rs:34-37` defaults `0.0.0.0:443` and `0.0.0.0:80` |
| `:1867` | "not a dependency of the crate today" → "…at `86cd669`" | `sed -n '11,29p' mosd/webd/Cargo.toml \| grep -c tower-http` → `0` |
| `:1956` | "apid runs as root today" → "apid runs as root at `86cd669`" | `grep -n 'User=' mosd/dist/webd.service` → no match; `[Service]` is four directives |

One further unanchored present tense was found and **deliberately left**:
`:2086` ("Not implemented today") is a claim about `docs/design/access.md`'s
content, not a measurement of the crate, so a commit anchor does not apply.

## The inconsistency that is real, and is not fixed here

**§9 item 8 no longer describes the document.** It was written against the
§3.2/§3.3 contradiction that RFCT-069 resolved. Its verdict — *"Not mitigated
as written; the design does not currently say enough to be checked"* — and its
two sentences quoting a cookie mint at an `/api/v1/` path describe a draft §3.2
no longer contains: §3.2 now mints at `POST /builtin/tokens` and returns `401`
to a cookie on `/api/v1/tokens`.

This is **not fixed here**. §9 belongs to RFCT-066, RFCT-069 correctly cited
rather than edited it, and it is recorded as **§10.3 item 14** with the
restatement its next editor owes (partly mitigated: the `/api/v1/` half closed
by the mint moving off the API path, the same-origin half accepted and named as
§3.3 attack 5).

**The document is therefore not reported as internally consistent.** It has one
known, recorded inconsistency with a named owner — which is a different and
better state than an unreported one. A consistency pass that fixed it would have
produced a section written by the pass and reviewed by nobody.

Two contradictions are also **open by design** rather than stale: §10.3 item 1
(§2.1 versus §4.1 on whether today's paths are reserved) is recorded unresolved.
§6.2 and §8.1 were checked and **do** agree — §8.1 answers §6.2's open question
explicitly and quotes it. §3 and §7 agree — §7.4's signing argument derives from
§3.2's "no scopes in phase 1" and cites it.

## What could not be established

**The L3 reports were not retrievable.** The BKD issue log for this campaign
stores no comments (`/issues/<id>/comments` returns an empty array for every
L3) and exposes no follow-up or transcript endpoint. The records above were
therefore built from the repository — commit bodies, diffs and the document
itself — which is the authority the campaign specifies anyway. Where a report
would have disagreed with the tree, the tree is what is recorded; but no report
was available to disagree.

## Scope fence

`docs/design/api.md` §0 and §1 not edited (hash-verified above). No file owned
by campaign `l1-o7ee8v0o-20260819152009-apid` was touched. The `cargo test` run
used to reproduce RFCT-069's `36 passed; 0 failed` left the worktree clean and
committed nothing.

No product code changed.
