# RFCT-251 PLAN-026 M5: `GetState` names `NotFound`, and apid stops reading the name

- **status**: completed — `GetState` raises `com.mos.mosd1.Error.NotFound` for a dot-path that resolves to nothing, `api_v1_state` is one call again, and the wire is byte-for-byte what it was
- **priority**: P1
- **owner**: bkd/jah7ss1a
- **createdAt**: 2026-08-29
- **completedAt**: 2026-08-29
- **plan**: PLAN-026 (M5)

`GET /api/v1/state/{path}` answered **404 `settings_not_found`** for a dot-path
that does not resolve, and it got there by reading an error name apid had no
general right to read. This task moves the naming to mosd, where the condition
is known, and deletes the reading. **Nothing a client can see changes**, and
that is the acceptance test rather than a caveat.

## 1. What was measured, before anything was changed

The brief's three claims were re-measured at `ffa65ca`, the branch point, and
all three held.

1. The rewrite was where it was said to be:
   `Some(zbus::Error::MethodError(name, message, _)) if name.as_str() == FDO_INVALID_ARGS =>`,
   inside `api_v1_state`. It sat at line 1262 of
   `os/pkgs/mosd/apid/src/routes.rs` as that file stood at `ffa65ca`.
2. Its own comment named the cleaner fix — *"The cleaner fix is a `NotFound`
   error name mosd-side; PLAN-025's scope excludes mosd itself, so the reading
   is done here, where it is still unambiguous"* — at lines 1247 to 1256 of the
   same pre-image.

Both positions above are written as **prose, not as citations**, and
deliberately. They name lines as they stood at `ffa65ca`; this task deleted
them, so a full-form citation would resolve against today's tree, land on
unrelated code, and pass the gate while saying something false. A no-slash
short form such as a bare file name and line would be worse still — the gate
skips it entirely, so it could point anywhere forever and stay green. A
pre-image position is not a citation, and forcing it into citation shape is how
a record becomes green and wrong at the same time.
3. The rotate-key path had already shipped that split, and still has:
   `return Err(SettingsFault::NotFound(format!(`
   (`os/pkgs/mosd/mosd/src/bus.rs:899`), with the reason in the comment above it
   — *"The split is here rather than in apid because apid had nothing left to
   tell them apart with."*

So the two paths disagreed about which side named the same class of condition.
That is the whole of the defect: not a wrong status code, a wrong **owner** for
the classification.

One thing the brief did not say, and it matters for scoping: `bus_api_error`
already mapped `MOSD_NOT_FOUND` to 404 `settings_not_found` with mosd's message
and the dot-path attached — `ApiError::mosd("settings_not_found", message)`
(`os/pkgs/mosd/apid/src/routes.rs:3066`), `Some(path) => error.at(path),`
(`os/pkgs/mosd/apid/src/routes.rs:3093`). The rewrite branch and the shared
classifier therefore produced the *same* response, member for member. That is
why requirement 4 is satisfiable at all, and it was checked before the branch
was deleted rather than asserted afterwards.

## 2. RED first

The failing test was written, run and committed before the fix
(`f73b9b6`). It asserts the bus-visible name, which is the only thing that
moves:

```
thread 'bus::tests::a_state_path_that_does_not_resolve_is_not_found' (2203)
panicked at mosd/src/bus.rs:1402:9:
assertion `left == right` failed: a dot-path that resolves to nothing names
nothing, which is a 404 and not a 422: state path not found: `no.such.path`
  left: "org.freedesktop.DBus.Error.InvalidArgs"
 right: "com.mos.mosd1.Error.NotFound"
test bus::tests::a_state_path_that_does_not_resolve_is_not_found ... FAILED
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 322 filtered out
```

The test is placed against
`a_rotation_refuses_an_interface_that_is_not_a_tunnel`, the PLAN-023 M6 test
that pins the same rule for the rotate-key path, because the two now assert one
rule and reading them together is the point.

## 3. What changed

**mosd.** `get_state` now returns `Result<String, SettingsFault>`
(`os/pkgs/mosd/mosd/src/bus.rs:654`) where it returned `fdo::Result<String>`
before, which is what lets it name an interface-scoped error at all. Its two failure paths keep their
count and swap one name:

- the uptime read stays `Failed` —
  `SettingsFault::Fdo(fdo::Error::Failed("read /proc/uptime".to_string()))`
  (`os/pkgs/mosd/mosd/src/bus.rs:657`);
- the unresolvable dot-path becomes not-found —
  `.ok_or_else(|| SettingsFault::NotFound(format!(`
  (`os/pkgs/mosd/mosd/src/bus.rs:678`).

The message is unchanged, deliberately: §2.4 passes mosd's words through, so
changing them would change a response body for no reason.

**apid.** The branch and its explanatory comment are gone. `api_v1_state` is
two lines: `let value = state.api.get_state(&path).await;`
(`os/pkgs/mosd/apid/src/routes.rs:1246`) and
`resource_response(value, &path)` (`os/pkgs/mosd/apid/src/routes.rs:1247`).
`FDO_INVALID_ARGS` is still used, by the shared classifier, and is untouched
there.

The utoipa annotation was **not** edited, including the 422 row that still
reads *"mosd rejected the dot-path (`settings_rejected`); a dot-path that does
not resolve is the 404 above"*. It is still true — the 404 above is still the
answer — and editing it would move `openapi.json`, which requirement 4 forbids.

## 4. The tests, and which one is the acceptance test

- `a_state_path_that_does_not_resolve_is_not_found` (mosd) — new. The
  bus-visible name, asserted directly, per requirement 5.
- `a_state_dot_path_that_does_not_resolve_is_404_not_422` (apid) — **the
  acceptance test**. Kept under its own name because the fact it names did not
  change. Its 404 half is now driven by `com.mos.mosd1.Error.NotFound` instead
  of fdo `InvalidArgs`, and it gains the assertion the old arrangement could not
  make: fdo `InvalidArgs` on the state route is now a plain **422**, because no
  rewrite is left to intercept it. That second half fails against the
  pre-image, which is what makes it evidence rather than decoration.
- `each_fdo_error_name_gets_its_own_envelope` (apid) — the route-dependent row
  is deleted. §2.4's table had one row that read differently on one route; it
  no longer does, and the loop reads the table straight.

`test/apid-api/**` needed no change: its only live-state assertions are
`GET /api/v1/state/network` on a resolvable path, and no phase exercises an
unresolvable one.

## 5. The design documents

`docs/design/bus.md` states no error name for any method — measured, not
assumed: `grep -n "com.mos.mosd1.Error" docs/design/bus.md` is empty — so
there was no bound in it to move.

`docs/design/api.md` carried three:

1. §1.2's route row said the handler separates an unresolved dot-path out
   itself. It now says the classifier answers it.
2. §2.2's live-state paragraph said *"`GetState` returns the subtree at a
   dot-path or `InvalidArgs`"*. It now names `NotFound`. See the finding below:
   this one is not merely a bound that moved.
3. §2.4's `settings_not_found` inventory row listed the deleted branch as a
   second apid-side producer.

### Finding: the citation gate cannot tell a quote from its negation

§2.2's sentence became **false** the moment the fix landed, and
`docs/verify-citations.sh` would have certified it. The citation carries the
armed quote `InvalidArgs`, the gate opens the cited range, finds the string
`InvalidArgs` there, and passes — because the fix introduced a comment reading
*"settings do not declare, and not `InvalidArgs`: the argument is"*
(`os/pkgs/mosd/mosd/src/bus.rs:671`). The gate read the right bytes, in the
right file, at the right lines, and certified a sentence whose meaning the
cited code **denies**.

This is worth separating from the other two blind spots this workstream has
measured, because it is not the same failure:

| blind spot | what the gate does | why it passes |
|---|---|---|
| the bare `:NNN` form | never resolves it at all | the citation is invisible; it is not checked, not counted, not failed |
| the no-slash short form, e.g. a bare file name and line | skips it as shorthand for a path named earlier | same: invisible |
| **quote versus negation** | resolves it, opens the file, matches the quote | the substring is present, so the check is satisfied; **the gate is working exactly as designed and the sentence is still false** |

The first two are gaps in coverage and can be closed by writing citations
differently. This one cannot: a substring match has no way to distinguish
*"raises `InvalidArgs`"* from *"not `InvalidArgs`"*, and any check that could
would have to read the code rather than grep it. The practical consequence for
this campaign is narrow and worth stating plainly: **a green citation gate is
evidence that a quotation still exists at its cited line; it is not evidence
that the sentence around the quotation is true.** When an edit inverts a
meaning rather than moving a line, the passage has to be read. Here it was, and
the sentence was rewritten; nothing but reading it would have caught it.

§2.4's own contract rows were **not** touched, because the contract did not
move: *"the dot-path does not resolve: mosd answered
`com.mos.mosd1.Error.NotFound`"* (`docs/design/api.md:1823`) was already the
written rule for the settings tree, and the state tree has simply stopped being
the exception to it.

## 6. The citation re-anchor

Done last, and done three times, because `bkd/5q6am5rw` moved three times
under this task — `1652b61`, then `dcae967` (M6, M3), then `2b62662` (M1). A
map computed against a base that has since moved is exactly how a citation
lands far from its target with every gate green, so each map was **re-derived
against the merged tree and never replayed**. The first was discarded outright:
`RFCT-249` had landed 48 lines into `os/pkgs/mosd/apid/src/tests.rs` between
computing it and applying it.

**Class A, 609 citations** (`4f108b5`). Mapped from the pre-image
(`git diff -U0 bkd/5q6am5rw -- <path>`) hunk by hunk, never by a constant
offset — the drift is not uniform. Four files shifted, in both directions:

| file | shift |
|---|---|
| `os/pkgs/mosd/apid/src/routes.rs` | `-26` below the deleted branch, `0` above it |
| `os/pkgs/mosd/mosd/src/bus.rs` | `+5`, `+6`, `+14`, `+44` across four boundaries |
| `os/pkgs/mosd/apid/src/tests.rs` | `+2`, `-9`, `-1`, `-5` across four |
| `docs/design/api.md` | `0`, `+1` |

The mapper asserts each hunk's reported `new_start` against its own running
delta before mapping anything, so a misread of the diff format fails loudly
instead of moving 609 citations by a wrong amount.

**Class B, 13 citations** (`a11446d`). These name lines the edit deleted or
rewrote; there is no line to shift them to, and none was guessed at.

- Six quote a fragment that survives, and were re-derived from it: the
  `async fn get_state` signature line, the reflowed uptime `ok_or_else`, and the
  four quoting `resource_response(value, &path)`.
- Seven quote text that is gone outright. `docs/task/RFCT-215.md` section 6
  item 5 **is** the residue this task closes, so it is closed in place with a
  dated append, and its two dead citations are removed rather than re-pointed.
  `RFCT-214`, `RFCT-232` and `RFCT-246` each get the smallest true restatement
  of the point they were making; `RFCT-232` additionally gets a dated note,
  because the names it measured are exactly what changed and the record must
  not read as a present-tense claim about a tree that no longer says that.

**On the merge route taken.** The recommended route for a merge like this is
to revert one's own re-anchor commits first, merge, then derive once against
the merged tree, on the reasoning that resolving a conflict picks between two
numbers of which neither survives. That reasoning is right, and it is worth
recording that this task reached the same tree by the other route — the merge
and the recomputation were already committed when the advice arrived — and why
redoing it would have changed nothing. Reverting first does **not** collapse
the derivation to a single pre-image: after the merge, citations the incoming
side re-anchored are anchored against its tree and the rest against the merge
base, so provenance still has to be read per citation. That step is the same
either way, and it is the step that carries the risk. What reverting first
genuinely saves is the conflict resolution, which here was 177 hunks of which
173 differ in digits alone — and every one of those digits was overwritten by
the recomputation regardless, so the resolution work was indeed waste. The
guarantee that matters is not which route was taken but that **every** citation
into a file both sides touched was recomputed rather than resolved, and that is
evidenced below by count and by an independent second derivation.

**The M1 merge, and the failure mode that has no conflict.** The third merge
was the dangerous one, and not because of what conflicted. 177 hunks conflicted
across 24 documents and 173 of them differed **in digits alone**; the four that
did not were read and resolved by hand — two `api.md` rows carrying this task's
own prose kept ours, and `RFCT-215` and `RFCT-244` took the incoming side, which
records M1 renaming a test both documents point at.

But resolving those was not the job. Both branches inserted into
`os/pkgs/mosd/apid/src/routes.rs` and `os/pkgs/mosd/apid/src/tests.rs`, and
where two sides edit **different** tokens in the same document git merges them
silently — the true line in the merged file is displaced by the *sum* of both
sides' insertions and matches neither side's number. Nothing conflicts, nothing
is flagged, and every such citation is wrong. So every citation into those
files was recomputed from scratch against the merged tree:

- **Provenance per citation.** The citing line was looked up verbatim in each
  side's own version of the citing document; the side that has it is the tree
  that number was anchored against. 0 citations were left without provenance.
- **Destination by content, not by offset.** A window of at least seven lines
  centred on the cited line in that pre-image had to occur **exactly once** in
  the merged file, widening while ambiguous and refusing rather than guessing.
  This is the rule that stops a lone `}` matching by accident, which this
  campaign has already measured going 44 lines wrong with the gates green.
- **972 citations recomputed, 488 of them moved, 0 refused, 0 without
  provenance.** 488 of 972 were wrong after a merge git reported as clean on
  both files.

**The recomputation was then checked by a second, independent algorithm.**
Numbers this important should not rest on one implementation. Every recomputed
citation was re-derived a second time using difflib's opcode alignment — a
different method with a different failure mode than the unique-window search
that wrote them — and the two compared: **1196 endpoints agree, 0 disagree, 0
that the second method could not map.** Twelve more could not be cross-checked
mechanically, because the citing line's shape is not unique within its own
document once digits are removed, so the check would have compared against the
wrong source line; those twelve were opened and read by hand, and every one
lands on the expected content (six `body: Result<Json<...>, JsonRejection>,`
parameters, five function or doc-comment lines named in the prose beside them,
and the `MAX_COMPONENTS` cap block). Nothing in the recomputed set is
unverified.

A second pass was needed for a target class the first missed: eleven
**documents** are themselves cited by line and were also edited on both sides,
so they carry the identical hazard. Windows were compared with citation digits
normalised away, since what is being located is content. 116 more citations,
2 moved. The gate found this rather than foresight did — two failures into
`docs/task/RFCT-215.md` survived the first pass — which is the argument for
running it and reading it rather than trusting a clean conflict list.

**A defect in the re-anchor tooling, found and fixed mid-pass.** The script
tested the dated-record exemption as a substring, where the gate anchors it to
the start of a line — `grep -q '^<!-- dated-record:'`
(`docs/verify-citations.sh:356`). Four documents that merely *discuss* the
marker were therefore exempted by the script while the gate still checked them.
Re-measured: none of the four carries a citation into a shifted region, so
nothing was in fact missed. It is recorded because the next script to copy that
predicate would not be so lucky.

## 7. Out of scope, untouched

- `os/pkgs/mosd/apid/src/routes.rs` from line 2516 down — a sibling milestone
  owns that region, so no line number is cited for it here: a bare `:NNN` form
  is skipped by the citation gate entirely, and a full-form citation into a
  region this task never read would be a claim with no measurement behind it.
  Measured instead: this branch's only hunk in that file is at line 1244
  (`git diff -U0 bkd/5q6am5rw -- os/pkgs/mosd/apid/src/routes.rs`).
- `main`. No merge into it, no other issue filed, nothing dispatched.
- `docs/plan/**`, which L2 closes out.
- Every other apid route: `InvalidArgs` still means *"this argument was
  rejected"* everywhere it is raised, and still answers 422.

## 8. Gates

All four were run in this task's own worktree,
`/srv/bkd/worktrees/u51kzjlk/jah7ss1a`, and the Rust gate's container mounts
that path and no other (`-v /srv/bkd/worktrees/u51kzjlk/jah7ss1a:/work`). The
shared checkout at `/srv/ai/mos` was never entered, edited, mounted or measured
from.

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | **`2230/2230 PASS`**, `ratchet failures: 0`, and `no quote, by document: docs/task/RFCT-251.md 0` — this record arms every citation it makes, so it sits at the ratchet's zero ceiling for a new document rather than taking an override row in `docs/verify-citations-unquoted-baseline.txt`. It carries **no bare `:NNN` form** and no no-slash short form either: both are skipped by the gate outright, so a document can be green and unchecked at once. Near-miss **352** against the merge parent's 354 |
| near-miss, attributed | The -2 was measured, not inferred. `2b62662` was unpacked into this task's scratch directory and the gate run there: `2210/2210` at the previous parent and **`2221/2221 PASS`, near-miss 354** at this one, reproducing the reference exactly. Its per-document unarmed counts were then diffed against this tip. Exactly two documents fall by one each — `docs/design/api.md` 452 to 451, where the prose commit deleted the unarmed citation naming the removed branch, and `docs/task/RFCT-215.md` 8 to 7, where item 5's close removed the unarmed citation to the deleted comment. No document rises, and this record enters at 0, so nothing drifted **into** the near-miss set. The same two documents, for the same two reasons, as before the M1 merge |
| `bash docs/verify-index.sh` | **`879/879 PASS`** at the merge parent, **`883/883 PASS`** here; the whole of the +4 is this task's one new document and its one index row |
| `bash hack/check.sh` in `localhost/mos-build-rust:amd64` | `Summary [  85.075s] 840 tests run: 840 passed, 0 skipped`, then `advisories ok, bans ok, licenses ok` and **`ALL CHECKS PASSED`**. The arithmetic rather than the total: 836 was the campaign baseline at RFCT-245, RFCT-249 (M3) added 2, RFCT-247 (M1) added 1, and this task adds 1 — 836 + 2 + 1 + 1 = 840. Re-run **after** the M1 merge, because the merged `tests.rs` holds M1's test as well as this task's. `dbus` installed in-container first, or the bus round-trip goes rc=100 — and this milestone changes the bus layer, so that test is the one that had to run |
| `oasdiff breaking` | **RC=0**: `No breaking changes to report, but the specs are different.` oasdiff 1.29.1, sha256 verified `541f7c66c933495fceef24eaf5c48aa66c19069f366f7bd0a60a6a4820c5e533`. Base is `main` at `498f0e4`, re-read at the moment of the run. **The spec difference is M1's, not this task's**, and that is measured rather than assumed: `git diff dcae967 bbeec95 -- os/pkgs/mosd/apid/openapi.json` — this task's own commits against the merge base — is empty, and `git diff 2b62662 HEAD` on the same file is also empty, so the merged spec is byte-identical to the incoming side's. The delta against `main` is M1's CIDR wording on two network-write 422 descriptions, which `main` does not yet carry. Requirement 4 holds: this task moved the spec by nothing, so no regeneration was needed and none was done |
