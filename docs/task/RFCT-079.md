# RFCT-079 Status markers per subsection, the §10.3 register entry, and the final consistency pass

- **status**: complete — §§4, 5 and 6 marked per subsection with the code named by path, the §0 marker divergence registered at §10.3 item 15 with the preamble bound to its period, the hardware position said once, and 44 pre-rename citations re-pointed and re-measured
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-20 22:15
- **claimedAt**: 2026-08-20 22:15
- **completedAt**: 2026-08-20 23:40

Campaign `l1-o7ee8v0o-20260820142702-ui`, phase 4 of `docs/design/api.md` §8.2.
The last task of the phase. Branch `bkd/j1gymrh4`. Base `0d4f3c6`.

```
$ git rev-parse HEAD
0d4f3c62018eafc608d509356984ef9d06fc6a6c
$ git merge-base --is-ancestor 0d4f3c6 HEAD && echo BASE-OK
BASE-OK
$ test -f mosd/apid/src/startup.rs && test -f mosd/apid/src/tests/broken_classes.rs \
    && grep -q '/builtin' mosd/apid/src/routes.rs && echo DEPS-OK
DEPS-OK
```

`DEPS-OK` is positive evidence of the right base rather than the absence of a
complaint: `main` is at `b4b7c72` and carries none of RFCT-071..078 or 080, so
`startup.rs`, `broken_classes.rs` and the `/builtin` prefix would not exist
there. HEAD is `0d4f3c6` exactly.

**No Rust was written or changed, and nothing under `os/` was touched.** Every
mechanism this task describes was merged and gated by a sibling; where one is
wrong, this record reports it rather than editing it.

## Description

Nothing here implements anything. The subject is making `docs/design/api.md`
tell the truth about the tree now that phase 4 has landed: markers that are
checkable, a register entry for the one convention claim that is false, the
hardware position said once and explicitly, and citations that resolve.

## What changed

**1. Status markers, per subsection, with the path named.** §§4, 5 and 6 were
`[proposed]` throughout. Every subsection now carries the marker that is true
of it, and every one marked `[implemented]` names its code **by path** in its
own text, which is what §0's definition requires and what makes the mark
checkable with `git` rather than trusted.

| subsection | marker | code named |
| --- | --- | --- |
| 4.1 Routing between API and assets | `[implemented]` | `mosd/apid/src/routes.rs` (`app`, `:88-161`), `mosd/apid/src/assets/serve.rs` |
| 4.2 SPA fallback | `[implemented]` | `mosd/apid/src/assets/serve.rs` (`fallback`, `respond`, `offers_html`, `ends_in_a_route_segment`) |
| 4.3 MIME and caching | `[implemented]` | `mosd/apid/src/assets/mime.rs` (`:58-59`, `:83-132`), `mosd/apid/src/assets/serve.rs`, `mosd/apid/src/routes.rs:176` |
| 4.4 Path traversal | `[implemented]` | `mosd/apid/src/assets/path.rs` (`resolve`), `mosd/apid/src/bundle.rs` (`validate_tree`) |
| 5.1 Why it cannot live in the rootfs | `[implemented]` (unchanged) | already named `os/rootfs/overlay-v2/etc/fstab.in`, `os/rauc/system.conf.in` |
| 5.2 The location, and the bind | `[implemented]` | `mosd/apid/src/bundle.rs:42`, `:53`, `:55`; `os/verify-image-v2.sh:210`, `:254`; `os/ui-location-test.sh` |
| 5.3 Install and removal | `[implemented]` | `mosd/apid/src/bundle.rs:475`, `:531`, `:552`, `:582`, `:605` |
| 5.4 Survives-what | `[implemented]` | `mosd/apid/src/bundle.rs` (`point_current_at`, `deactivate`), `mosd/apid/src/startup.rs` |
| 6.1 What "broken" covers | `[implemented]` | `mosd/apid/src/startup.rs`, `mosd/apid/src/assets/serve.rs`, `mosd/apid/src/tests/broken_classes.rs`, `mosd/apid/src/main.rs:83` |
| 6.2 The built-in default UI, inside verity | `[implemented]` | `mosd/apid/src/assets/serve.rs` (`built_in`), `mosd/apid/src/routes.rs:802`, `os/verify-image-v2.sh:231`, `:341` |
| 6.3 The deterministic way to reach it | `[implemented]` | `mosd/apid/src/routes.rs:115-125`, `:122`, `:125`, `:851`; `mosd/apid/src/tests/broken_classes.rs` |
| 6.4 Why this is the same reasoning that split mosd and apid | `[implemented]` (unchanged) | already named `mosd/dist/mosd.service:8`, `mosd/dist/apid.service:8` |

**No subsection was refused a marker**, because none landed partially. The one
that looks like it — §5.3, whose step 1 *unpack* has no code — is not: §5.3
routes the archive-format choice to 10.2 rather than settling it, and §8.2
gives phase 4 the whole mechanism **except** the request that delivers the
archive and gives that request to phase 5. `Store::activate` takes an
already-staged tree and says so in a comment. That boundary is now stated in
§5.3 under the marker rather than left for a reader to discover.

**The section headings `## 4`, `## 5` and `## 6` now carry no marker at all.**
A section-level mark is a claim about every subsection under it, and the one
subsection that did not land is exactly the one a reader would trust it for.
§0 already exempts sections that describe no mechanism; the mechanisms here are
the subsections'. §4 carries the note explaining this, and §5 and §6 point at it.

**2. §10.3 item 15 — the §0 marker divergence.** `api.md:14-15` claims the
convention is access.md's *"reused here in the same form"*. It is not:
`docs/design/access.md:27-33` lists four markers and `api.md:18-20` lists three,
two of four overlap, api.md dropped `[partial]` and `[decided]` and added
`[proposed]`. Written in item 14's form — an owed action naming what its next
editor must do, with the two admissible resolutions and neither taken here.
Measured at `0d4f3c6`, carried inline. §0 was **not** edited: a pass that
applies the convention and also rewrites the section governing it would have
written §0 with nobody left to review it, which is the failure RFCT-067 refused
for §9 item 8.

**3. The §10.3 preamble amendment.** Appending falsified two of its own
sentences — its scope (*"Everything §7, §8 and §9 found"*) and its measurement
(*"All claims were measured at `86cd669`"*). Neither was restated to cover the
new item. Both are bound to their period and one sentence appended saying that
entries added after this section was written name their own source section and
their own measurement commit inline — the shape `api.md:88` already uses for a
re-measured claim. That also settles the taxonomy: an entry appended at 15 sits
in the region a reader scans as routed work and does not need to move, because
it carries its own descriptors. *"Items 1 to 3 ... All three are now resolved"*
is bounded by item number, stays true on append, and was not touched.

**4. The hardware sentence, said once.** In §4's preamble, scoped explicitly to
§§4, 5 and 6, with §5 and §6 pointing at it rather than restating it:

> **A path is evidence of code. Evidence of code is not evidence of a booted
> device.**

Every mechanism in §§4-6 is host- and container-tested and **none is exercised
on hardware**. The accurate surrounding position is stated because both
overstatements are wrong: hardware **has** booted — a **v1** image reached the
`mos login:` prompt on a real CX3576-Z, and the repart/maskrom and SPL-hash
investigations ran against a real board — while the **v2** stack (verity root,
A/B, `rauc install`, apid itself) has **never** run on hardware. The phrase is
*"not exercised on hardware"*; neither *"never booted"* nor *"verified on
device"* appears. §6.3's *"No hardware claim is made anywhere in this section"*
is unaffected and still true.

**5. The consistency pass.**

- **44 citation occurrences re-pointed** from the pre-rename `mosd/webd/...`
  and `mosd/dist/webd.service` spellings — 41 in §§4-6 and 3 in §8.2 phase 4.
  Tool and pattern: `python3` over the line range between the `## 4. Static
  hosting` and `## 7. Trust` headings and between the `#### Phase 4 —` and
  `#### Phase 5 —` headings, replacing `mosd/webd/` → `mosd/apid/` and
  `mosd/dist/webd.service` → `mosd/dist/apid.service`, counted with
  `re.findall(r'mosd/webd/|mosd/dist/webd\.service')` per changed line.
- **Line numbers re-measured at `0d4f3c6`** wherever the file moved under them,
  not only re-pointed. Re-pointing a citation while leaving its line stale is
  the worst failure a citation has: it resolves, and the line it lands on
  contradicts the sentence citing it. The `routes.rs` citations were the ones
  that mattered — the file grew from 1338 to 1648 lines — and `:45-65`,
  `:74`, `:149`, `:98-103`, `:106-116`, `:157-165`, `:157`, `:176` and `:581`
  all needed moving.
- **Renamed values corrected, not only paths**: `webd_session` → `apid_session`
  (§4.3), `/var/lib/mos/webd` → `/var/lib/mos/apid` (§4.4), `WEBD_STATE_DIR` →
  `APID_STATE_DIR` (§6.2), `WEBD_LISTENING` → `APID_LISTENING` (§6.1 and §8.2
  phase 4), `/usr/bin/webd` → `/usr/bin/apid` (§5.4, §6.2, §6.4), the `webd`
  binary in §6.2's *"how it gets there"*, and the D-Bus policy quote in §4.4,
  which the file now spells `apid.service`.
- **Verified mechanically**: every path-bearing citation in §§4-6 opens and
  every line number is within its file — 136 path-bearing citations and 57
  bare `:NNN` continuations, checked by resolving each continuation against the
  preceding path.
- **Dated claims bound to their period rather than re-pointed into falsehood.**
  §4.1's *"declares no fallback at all"* and §6.2's *"compiled into the `webd`
  binary"* are true of `86cd669` and false of `0d4f3c6`. Each keeps its dated
  sentence and states what landed beside it, with current line numbers.

**6. §8.2 phase 4 and §10.2.** Phase 4 is marked as landed, with the campaign
and the merge commit named, and its four acceptances each recorded with the
evidence that met them and the two limits on that evidence (acceptance 3 is met
at the header level, no browser driven; acceptance 4 is met by re-evaluating
against a different served set, no A/B update performed). Seven §10.2 items owed
to this phase now say they are discharged rather than sitting as open debts:
§2.4's `/api/` 404 envelope, §2.1's version token (as a value, not a route),
§2.2/§2.3's status read (semantics only), the static-file dependency decision
(hand-rolled), `model.rs` (not owed — deactivate is the pointer), the seed unit
(none added), and `os/verify-image-v2.sh` (its "no new assertion" conclusion is
superseded, with the reasoning that superseded it kept).

## Checks

**Predicted before running.** `docs/verify-index.sh` is
`3 x (design + research entries) + 3R`. At the base: `3 x (11 + 5) + 3 x 71 =
48 + 213 = 261`. Adding `RFCT-079.md` and its one row makes `R = 72`, so
`48 + 216 = 264`. `docs/verify-index-test.sh` is unaffected by a document being
added and stays `8/8`.

```
$ bash docs/verify-index.sh
docs/verify-index.sh: 264/264 PASS
$ bash docs/verify-index-test.sh
RESULT: PASS (8/8 cases)
```

Predicted 264, observed 264. Predicted 8/8, observed 8/8.

**`mosd/hack/check.sh`, the image build and `os/verify-image-v2.sh` are
provably unreachable by this diff, so they were not run.** The proof is the
diff, not a judgement about risk: `git diff --name-only 0d4f3c6..HEAD` is three
files, all under `docs/`: `docs/design/api.md`, `docs/task/RFCT-079.md` and
`docs/task/index.md`. No `.rs`, no `Cargo.toml`, no `Cargo.lock`, nothing
under `os/`, and not the `Makefile`. `check.sh` compiles, clippies, tests and
audits a Rust workspace this diff does not touch; the image is built from
`os/` and `mosd/` inputs this diff does not touch; the verifier reads an
assembled image. A run of any of them would re-prove the base's result and
attribute it to this change.

## Findings — reported, not designed around

**F1. §1.1's startup marker is wrong, and §1 is the *measured* section.**
`api.md:101` states the line is `WEBD_LISTENING https=<addr> http=<addr>` while
citing `mosd/apid/src/main.rs:69` — a post-rename path. At `0d4f3c6` the binary
prints `APID_LISTENING` (`mosd/apid/src/main.rs:72`), so the string is wrong and
the line number is now wrong too. Raised by RFCT-071 as its finding 2 and by
RFCT-076 as its F1, and still open. **Not fixed here**: this task's item 5
scopes the citation pass to §§4-6, and §1 is the section §0 anchors the whole
document to — editing it is a re-measure of §1, which is a different piece of
work with a different reviewer. §6.1 and §8.2 phase 4, which repeat the same
string, were in scope and are corrected.

**F2. §1's other post-phase-4 drift, measured.** `api.md` §1.1 also cites the
inline stylesheet at `mosd/apid/src/routes.rs:158-165` and its injection at
`:176`; at `0d4f3c6` they are `:278-285` and `:296`. §1.6's evidence 2 — *"the
HTTPS router declares no `nest_service`, no `fallback_service` and no `fallback`
at all"* — is **false by construction** as of RFCT-074, which is the task that
added the fallback; RFCT-074 recorded it as its F4. §1 is `[implemented]` and
measured, so this is the section where drift costs the most. Owed to whoever
re-measures §1.

**F3. 135 `mosd/webd/...` citation occurrences remain outside §§4-6 and §8.2
phase 4.** Counted with `grep -c 'mosd/webd/\|mosd/dist/webd.service'` at
`0d4f3c6` after this task's edits. They are in §§1, 2, 3, 7, 9, 10.1 and 10.3
items 1-14, all of which remain anchored at `86cd669` per §0, where those paths
**do** open under `git show`. They were left deliberately: §§4-6 were re-pointed
because a subsection claiming `[implemented]` names code a reader is expected to
open today, and that asymmetry is now stated in §4 rather than left to look like
an incomplete sweep. A document-wide sweep is a re-measure of §0's anchor and is
not this task's.

**F4. `//api/versions` reaches the asset router and is served from the bundle.**
RFCT-074's F2, **not closed** by it and not closed here. §4.1 rule 1 is written
about paths that *begin* `/api/`; `//api/versions` does not, so it reaches the
fallback, where §4.4 rule 3 strips all leading separators and resolves it to the
bundle's `api/versions`. Nothing is shadowed — phase 2's routes answer at
`/api/v1/...` regardless — so this is not the failure rule 1 exists to prevent,
but the reserved subtree's *names* remain reachable from a bundle by adding one
slash. Closing it needs either the in-handler prefix check §4.1 explicitly
rejects or a path-normalising middleware, which is a design decision §4 does not
make. It is now named in §4.1 under the marker rather than living only in a task
record.

**F5. Two source comments in `mosd/apid/` are stale, and both say a thing exists
that now does.** `mosd/apid/src/assets/serve.rs`, in `root`'s doc comment:
*"§6.3's reserved prefix, where it becomes reachable unconditionally, does not
exist yet and is not created here."* It exists — RFCT-075 declared
`.nest(BUILTIN, …)` in `routes.rs`. And `mosd/apid/src/bundle.rs:23-26` carries
`#![allow(dead_code)]` under the comment *"The store has no in-tree caller yet:
the asset router and the start-up re-check that consume it are separate phase-4
work."* Both consumers landed — `routes.rs` constructs the `Store` and
`serve.rs` and `startup.rs` call it. Whether the attribute is still needed for
the entry points that remain unused is a question for whoever next edits
`bundle.rs`; the comment is wrong either way. **`mosd/` is not this task's to
edit.**

**F6. A corrupted activation record is indistinguishable from an absent one.**
RFCT-076's F3. `Store::read_record` ends in `serde_json::from_slice(&bytes).ok()`,
so `records/<gen>.json` full of garbage reads as "no record", and the bundle
reports *"active, unchecked"* rather than as §6.1 class 3. An operator with a
root shell who corrupts the tree **and** its record escapes the start-up check.
The counterweight §6.1 already concedes is that the same operator can delete the
record. Now recorded in §5.3 under the marker; the fix changes `read_record`'s
signature and belongs to whoever next owns §5.3.

**F7. The bundle store does not expose `immutableDir` after install.**
RFCT-074's F5. `Store::status` returns `ManifestSummary { name, version }` and
`read_manifest` is private, so §4.3's third cache class cannot be applied from
the store's public API; the asset router reads `mos-ui.json` from the served
tree instead. A public accessor is the clean fix. Recorded in §4.3 under the
marker.

## What could not be established

- **Nothing in §§4-6 is exercised on hardware**, and this task added no
  evidence of any kind — it ran no Rust, built no image and touched no board.
  Every `[implemented]` mark it sets rests on a sibling task's host-side
  `cargo nextest` run and on image assertions run against an assembled image
  and a fixture root. The mark means what §0 says it means: code exists and is
  named by path.
- **Whether the two admissible resolutions of item 15 are equally acceptable to
  the document's owner.** The entry names both and takes neither; that is the
  point of its form, and it is also the one thing this task cannot settle from
  the tree.

## Scope fence

Touched: `docs/design/api.md`, `docs/task/RFCT-079.md` (new),
`docs/task/index.md` (one row). Not touched: anything under `mosd/` or `os/`,
the `Makefile`, `docs/design/access.md`, `docs/design/dashboard.md`,
`docs/design/ro-root.md`, `docs/README.md` (no row is owed — it indexes
`design/` and `research/`, and this task adds neither).
