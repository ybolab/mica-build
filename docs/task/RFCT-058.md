# RFCT-058 Re-anchor dashboard.md's D-Bus policy claims to RFCT-048, state the citation rule, correct the README `talos/` line

- **status**: completed — implementation complete, `make docs-verify` green (136/136),
  `bash mosd/hack/check.sh` green
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 17:45
- **claimedAt**: 2026-08-19 17:45
- **completedAt**: 2026-08-19 18:30

Campaign `l1-o7ee8v0o-20260819152009-apid`. Branch `bkd/6snrfigm`, base
`b1e8d41` (the RFCT-057 L2 merge).

## Description

`docs/design/dashboard.md` asserted throughout §5, §6 and §7 that the `mosd`
D-Bus policy lets **any local process, of any uid**, call the interface. That
assertion was **true when RFCT-046 wrote it and stopped being true at
`637295e`** — *"os(RFCT-048): restrict com.mos.mosd to root, on the bus and in
both verifiers"*.

The document was therefore not merely stale. It was stale in the specific way
that survives review: the sentences were written correctly against the tree of
their day, and every citation supporting them still resolved to a real file at a
real line — a line whose contents had been replaced underneath them.

This record re-anchors the claims **without flipping them**, because the
open-policy fact is *fact 2* of §6's option comparison and the comparison's
reasoning is only legible if the fact is dated rather than deleted.

## Ground truth, verified before editing

| Fact | Verification |
|---|---|
| The change landed in `637295e` (RFCT-048) | `git log -1 --format='%H %s' 637295e` |
| The file was **12 lines** before | `git show 637295e^:mosd/dist/com.mos.mosd.conf \| wc -l` -> `12` |
| It is **73 lines** now | `wc -l < mosd/dist/com.mos.mosd.conf` -> `73` |
| In the 12-line file, `:4-11` **were** the policy stanzas | `git show 637295e^:mosd/dist/com.mos.mosd.conf \| cat -n` |
| Today the default context **denies both directions** and only root is allowed | `sed -n '63,73p' mosd/dist/com.mos.mosd.conf` |
| The claim is **confined to `dashboard.md`** | see below |

**The confinement sweep, with its exact pattern.** The `grep` on `PATH` in this
environment is **ugrep 7.5.0**, not GNU grep, and it honours `--ignore-files`;
the sweep was run with `--no-ignore-files` and cross-checked against `git grep`,
which is a different implementation:

    grep -rnI --no-ignore-files -E 'any local (uid|process)' .    # ugrep, minus .git
    git grep -nE 'any local (uid|process)' -- .

Both tools returned the **same three files**: `docs/design/dashboard.md` (6
hits), `os/verify-image.sh` (1), `os/verify-image-v2.sh` (1). The two verifier
hits are **not stale claims** — they are the text of the `fail` branch that
fires when the policy *does* contain a default-context allow, i.e. the message
that would be printed if RFCT-048 were reverted. They are correct as written and
were not touched.

**A correction to the dispatch's own measurement, recorded because counts are
evidence.** The dispatch stated the file is cited "by bare line range in eleven
places". The precise figure: `mosd/dist/com.mos.mosd.conf` is mentioned **11
times** in `dashboard.md`, of which **7 carried a bare line range** (`:4-11` x3,
`:8-11` x3, `:4` x1) and 4 were bare filename mentions with no range. All 11
mentions were reviewed; all 7 ranges are now anchored, plus 1 new anchored
citation introduced by this record's own prose — 8 anchored ranges in total, 0
unanchored, verified programmatically.

## A. The eleven assertion sites, re-anchored

Each site now states three things: **that the policy was open when the
comparison was made**, **that it is root-only as of `637295e`**, and **what that
does to the argument at that site** — the last stated explicitly rather than
left to the reader to derive.

| # | Section | Site | What the re-anchoring says about the argument |
|---|---|---|---|
| 1 | §5.6 | WebSocket security cost | Conclusion **unchanged** — it never rested on the bus. A WebSocket hijacked via the operator's authenticated browser acts *as* `apid`, which is still root |
| 2 | §5.7 | `SettingsChanged` / second actor | Root-only **narrows** the set of second actors without emptying it (root scripts, `busctl`, the health gate), so the refresh-interval trade is unchanged |
| 3 | §5.x | the narrow `SetSettings` race | Race becomes **rarer, not impossible** — every caller in the tree is already root, so it is a `mosd` concurrency question, not an access-control one |
| 4 | §6.1 | **fact 2's definition — the anchor site** | Full treatment: the shipped stanzas quoted, `receive_sender` explained, and the accounting for the whole of §6 stated once |
| 5 | §6.2 | the strongest case for option 1 | **Survives on fact 1 alone** — `apid` is still root, so a compromised `apid` still reaches everything `mosd` can do, by process privilege rather than bus policy |
| 6 | §6.3 | "building a boundary that was never built" | Option 2 is now **partly a delta, not wholly a project** — the policy half is built, the unit half is not |
| 7 | §6.3.2 | D-Bus method allowlisting | The bare allow it proposes replacing **was already replaced** at `637295e` |
| 8 | §6.6 reason 1 | "the remaining consumer keeps the open-policy problem alive" | Clause **retired** — nothing is left alive to keep. Reason 1 **stands** on the `mos-health` step, which RFCT-048 does not touch |
| 9 | §6.6 reason 3 | "the status quo is not a neutral baseline" | **Reduced, not retired** — carried now by facts 1 and 4 (root web server on `0.0.0.0:443` and `:80`), which are unchanged. The "least defensible of the four states" framing is now materially overstated |
| 10 | §7.2 | the de-facto operator contract | **Cost already paid, not pending** — non-root callers broke at `637295e`, not at some future option-2 allowlist |
| 11 | §7.3 | option 1 re-scored | The fact-2 clause is retired; **the trailing clause survives intact** — a merge still forecloses uid separation, which is about process identity, not bus policy |

Two dependent sites were corrected in the same pass because they assert the same
retired fact and would otherwise contradict the eleven: **§7.4.3's ordering
argument** and **Phase 2's scope and verification items**.

### The decision is explicitly NOT reopened

A new **§6.6.1** was added — *"What RFCT-048 changes here, and what it explicitly
does not"* — because five reasons in §6.6 cite fact 2, and a reader who
discovers on their own that fact 2 has moved must be told immediately how far
the damage travels.

**It does not travel to the outcome.** §6's decision to keep two processes
rested on exactly two findings: (1) a merged process makes a provisioning
failure **fatal to the UI**, and (2) `com.mos.mosd1` is **load-bearing for the
update health gate**. `637295e` changes *who may call the interface*, not
*whether it must exist* and not *what happens to the UI when provisioning
fails*. **Neither finding is touched.**

Reason-by-reason, as tabulated in §6.6.1: reasons **2, 4 and 5 are untouched**;
reason **1 stands** with one supporting clause retired; reason **3 is reduced**
but survives on facts 1 and 4. Reason 4 — a non-root daemon cannot open
`/var/lib/mos/secrets/*`, making §2.10's *"No secrets, ever"* a **filesystem
property** rather than a code discipline — is unaffected and is now **the
strongest surviving argument for option 2's hardening**, because no policy
change can deliver it; only a `User=` can.

**Accordingly: the options were not re-scored, no new recommendation was added,
and §6's [decided] marker was not reopened.**

**RFCT-048 delivered part of option 2 in advance.** §6.3.2 proposed a
default-deny policy plus a named-identity allow. The default-deny half is
**shipped**. Option 2's remaining D-Bus work is the `user="apid"` block, which
`mosd/dist/com.mos.mosd.conf` already documents at its `EXTENSION POINT`
comment — together with a warning not to reopen the default context to get
there. The unit hardening remains **entirely unbuilt**, and it is the half
reason 4 depends on.

## B. The citation rule, stated as a convention

The stale citations were worse than stale. In the 12-line file `:4-11` **were**
the policy stanzas; in the 73-line file the same range is explanatory comment
prose containing the sentence *"The previous policy was a development skeleton
that let any local uid send to all of it."* **A reader who followed the citation
landed on text that appeared to confirm the claim that had become false.**

The sharpest case: §6.3 said the policy *"calls itself a dev skeleton
(`com.mos.mosd.conf:4`)"*, while line 4 today reads *"com.mos.mosd is a
ROOT-ONLY bus name (RFCT-048)"* — **the citation had come to assert the exact
negation of the claim it was offered as evidence for.**

So the fix is not only per-citation. A general convention was written into the
document's **citation-convention paragraph near the top**, where a future editor
meets it *before* citing anything:

> **Cite by commit plus quoted content, not by bare line range, for any file
> still under change.** A line range is acceptable only when anchored to a commit
> that pins what those lines were. An unanchored range does not merely go stale —
> it can come to point at text that REFUTES the claim citing it, and the reader
> who does the responsible thing and follows the citation is misled more
> thoroughly than the reader who does not. This is the same discipline as
> anchoring a present-tense claim, applied to the pointer instead of the
> sentence.

Every affected citation now carries **`as of 637295e^`** — the last commit at
which the cited range meant what the citing sentence says.

A **[re-anchored]** status marker was defined in the same place, following the
marker discipline of `docs/design/access.md` §0. It is the fact-level
counterpart of **[decided]**: where **[decided]** records that an open *question*
was settled, **[re-anchored]** records that a *fact* moved beneath an analysis
that remains otherwise valid.

## C. §7.4.1's stale count, and the two staleness axes that cross in it

§7.4.1's rename-cost table called `com.mos.mosd.conf` *"a 12-line file whose
only identity is `root`"*. Corrected to **73**.

**The correction belongs to the RFCT-048 axis, not the rename axis, and the
record says so.** The figure "12" was never a statement about `webd` or about
the rename; it was a measurement of the file's size, and it went stale at
`637295e` — **before this campaign began**.

**The proof that it is the earlier axis**, and it is stronger than an argument
from intent: `git merge-base --is-ancestor 637295e 86cd669` returns true, and
`git show 86cd669:mosd/dist/com.mos.mosd.conf | wc -l` returns **73**. The file
was *already* 73 lines at the pre-rename base the section is frozen against.
**The freeze could not have protected the figure, because the figure was already
wrong when the freeze was taken.**

**The pre-rename freeze is unchanged and restated in the document.** Every path
and string in §7.4 remains deliberately `webd` — `mosd/webd/`, `webd.service`,
`WEBD_STATE_DIR` and the rest are **not** rewritten, exactly as RFCT-056 left
them. Only the policy line count moved.

The rule drawn, and written into the section so it outlives this task:
***"it is a preserved measurement"* is a defence against being updated on the
axis it was preserved for — not against every later fact.** A frozen section can
carry a number that was never about the freeze, and that number gets no
protection from it. So a preserved section must say **which axis** it is frozen
on, or it will be read as frozen on all of them.

## D. The cookie exception, recorded in RFCT-055

An **append-only addendum** was added to `docs/task/RFCT-055.md` recording L1's
confirmation that the `webd_session` -> `apid_session` rename is an accepted
exception. Nothing RFCT-055 originally claimed was altered — proven by
`git diff ... -- docs/task/RFCT-055.md | grep '^-' | grep -v '^---'` returning
**nothing** (72 insertions, 0 deletions).

The addendum records the genuine instruction conflict ("no behaviour change,
does not touch sessions" against "zero `webd` outside docs"), why a wire-visible
cookie **name** warranted surfacing even though the mechanism did not move, the
verified diff, and why the cost is **zero additional** — the already-accepted
StateDirectory regeneration produces a new signing key, so every pre-existing
cookie fails its MAC whatever it is called.

**A measurement correction carried into the addendum.** The review described the
diff as *two* changed lines. Re-verified, it is **three lines across two sites**:
the `COOKIE_NAME` constant, and a doc-comment sentence spanning two lines because
the article `a` -> `an` falls on the preceding wrapped line. The substance of the
description is exact — one constant and one doc comment — and the extra line
carries no meaning. The HMAC-SHA256 construction, the 128-bit random id, the 24h
TTL, the in-memory table and both unit tests are untouched.

## E. `README.md` — the `talos/` line, and this campaign's own over-rename

**This campaign made the front page worse, and this record says so plainly
rather than presenting the fix as inherited.**

At `86cd669` the layout line read:

    ├── talos/           OS core (independent git repo): Talos fork — rootfs, machined, webd

**RFCT-055 renamed that `webd` to `apid`. That was an over-rename.** The `webd`
there was **not** our daemon: it referred to webd-as-a-Talos-service in the
**abandoned** architecture — `internal/app/webd/main.go` inside the Talos fork,
talking to `machined` over `/run/machined.sock` (PLAN-003, *"bring up webd
skeleton"*). It was **historical, not current-state**, and should have been left
alone.

Renaming it made the line assert that our `apid` lives in `talos/` — producing
exactly the two-daemons-one-token collision RFCT-057 then flagged in the first
screen a reader ever sees. **This is the one place the rename made something
worse rather than neutral.** RFCT-057 found it and correctly refused to fix it,
its README authority covering plain factual errors and this being an ambiguity;
L1 has since ruled, and the ruling makes it a reword.

**The line now reads:**

    ├── talos/           abandoned Talos base, reference-only archive superseded by os/ and mosd/ (PLAN-010, 2026-08-17)

It **no longer calls `talos/` the OS core** (it is not; `os/` is), names it as a
**reference-only archive of the abandoned base**, states it is **superseded by
`os/` and `mosd/`**, and is **anchored to the PLAN-010 decision of 2026-08-17**
rather than asserting a bare present tense — the same discipline as section B's
citation rule, applied to a claim about the tree's own layout. The anchor is
verified: `docs/plan/PLAN-010.md:20` cites *"DECISION 2026-08-17"* and `:703`
records *"talos repo: reference-only, archived at its final commit; no further
fixes."*

**It lists no daemon at all.** Neither `webd` nor `apid` belongs there — the
daemon lives in `mosd/`, which line 15 already says. **Removing it closes the
collision at its source**, so no qualifier is needed anywhere else. Lines 4, 7
and 15 were **not touched**; they correctly describe our daemon. After the
change `grep -n 'apid' README.md` (ugrep) returns exactly **3 hits — lines 4, 7
and 15 — all ours**.

**A second hunk, and why.** The paragraph further down read *"`talos/` is a
standalone git repository (large upstream fork history); everything else is
versioned by this root repo."* Left alone it would have presented `talos/` as a
live component immediately after the layout line called it abandoned. Under L1's
instruction to bring any such text into line, it now reads *"an untracked
standalone git repository ..., archived at its final commit and kept for
reference only"*. **This is the only other change to `README.md`**, and the diff
is therefore two hunks rather than one.

**`Makefile` is untouched** — verified by its absence from the changed-file
list. `Makefile:31` still routes `make os` into `talos/`. That is a build change,
it is **L1's**, and it will be made on main after this campaign merges with the
full suite. Whether the Talos base remains a build target is **settled and not
this record's to settle**: it is not, and L1 is making the tree say so. **No
claim in this record depends on that change landing.**

## Checks

    make docs-verify        -> docs/verify-index.sh: 136/136 PASS
    bash mosd/hack/check.sh -> green

**Why those two and not the image suite.** The diff touches `README.md`, which
is outside `docs/`, so the code gates cannot be dismissed on a path basis. They
are dismissed on an **inertness** basis instead: **no build step reads the root
`README.md`.**

    grep -rn 'README.md' Makefile os/ mosd/ --include='*.sh' --include='Makefile' --include='*.rs'

returns exactly three hits (ugrep), and **none of them is the root README**:
`Makefile:28` and `Makefile:100` name **`board/x64/README.md`** inside `@echo`
strings, and `Makefile:88` is a **comment** about `docs/README.md`. The docs gate
itself reads `docs/README.md` (`docs/verify-index.sh:42`), not the root file.
The root `README.md` is documentation that nothing in the build consumes, so the
image builds, both verifiers and the health/shadow/dbus/repart/bundle gates are
**unreachable from this diff**, not merely unlikely to be affected.

Changed files:

    docs/design/dashboard.md
    docs/task/RFCT-055.md
    docs/task/RFCT-058.md
    docs/task/index.md
    README.md

## What could NOT be proved

- **No on-device or live-bus run.** That the shipped policy actually denies a
  non-root caller is asserted from the file's contents and from RFCT-048's own
  verifier assertions, **not** re-demonstrated here. This record changed no code
  and ran no bus test; `make os-dbus-policy-test` was not run, because nothing in
  scope can affect it.
- **The re-anchoring is an editorial judgement about argument structure.** That
  §6.6 reasons 2, 4 and 5 are *untouched*, that reason 1 *stands*, and that
  reason 3 is *reduced rather than retired* is a reading of the document's own
  reasoning, worked out from §6.6 and stated in §6.6.1 so it can be disagreed
  with explicitly. It is not a mechanical fact and no check enforces it.
- **Whether the `talos/` directory should exist at all is not settled here**, and
  this record deliberately does not settle it. The build target that still points
  at it (`Makefile:31`) is L1's to change.
- **`docs/design/*.zh.md` translations were not checked** for the same stale
  policy claim. The repo-wide sweep above covers them by pattern and returned no
  hits, but the pattern is English; a Chinese rendering of the same assertion
  would not have matched. Out of scope for this record and flagged for whoever
  owns the translations.
- **One adjacent staleness observed and deliberately not fixed.** `README.md:3`
  still describes the product as an *"Immutable Talos-derived OS core"*. Given
  PLAN-010 replaced the Talos core with systemd, that phrase is arguably stale on
  the same axis as the `talos/` line. It was **not** changed: L1's ruling covered
  the `talos/` layout line, and rewriting the product's one-line self-description
  is a different decision. Recorded for whoever owns it.
