# RFCT-257 PLAN-028 M2: the bare-continuation resolver

- **status**: in progress — pass 1 of 2. The census is measured and committed; the class A corrections and the dated-record decisions land on it; the resolver itself waits for M1 (RFCT-256) to merge, because both milestones change the same extractor in `docs/verify-citations.sh` and a two-sided edit would collide.
- **priority**: P1
- **owner**: bkd/n50ivit0
- **createdAt**: 2026-08-28
- **plan**: PLAN-028 (M2)

Every number below was measured on this branch at its own HEAD, not relayed.
Where a re-measurement disagreed with the figure the milestone was briefed
with, the disagreement is stated and the measured value is the one used.

## 1. The form, and why it is invisible

The bare form is a backticked token that opens with the colon: `` `:NNN` `` or
`` `:NNN-MMM` ``. The gate's extractor matches
`` `[^` ]+:-?[0-9]+(--?[0-9]+)?` ``, whose `` [^` ]+ `` needs at least one
character before the colon. A bare token offers none, so it does not match the
extractor at all. It is not checked, not skipped with a reason, and not
counted — it is absent from every line of the summary. That is the blind spot
PLAN-028 M2 exists to close.

## 2. What the corpus holds

Measured at this HEAD over the gate's own document set — `docs/design/*.md`,
`docs/task/*.md` and `docs/research/*.md` excluding `*.zh.md`, plus
`docs/architecture.md`:

| | tokens | documents |
|---|---|---|
| bare tokens in documents the gate scans | **1020** | 79 |
| of those, in documents already carrying a `dated-record` marker | 407 | 23 |
| **in play for this milestone** | **613** | **56** |

The 407 keep their carve-out untouched; `docs/research/mos-ui-inventory.md`
alone holds 170 of them. Both figures reproduce the brief exactly.

**PLAN-028's Context does not size this milestone.** It cites RFCT-214's
finding of 56 never-valid bare citations into `routes.rs`. That was one
document's slice measured at RFCT-214's own base, and the corpus has moved
since — RFCT-215 rewrote api.md section 1. The corpus-wide figure is 613, and
56 must not be carried forward as this milestone's size.

## 3. The census

Applying the same-line inheritance rule and then the gate's existing scope
rule, the 613 split first by whether an antecedent exists on the line at all:

| | count |
|---|---|
| has a same-line antecedent | **228** |
| has none | **385** |

The 228 break down as: 180 inherit a path that resolves in scope, 30 inherit an
outside-tree path, 9 inherit a basename with no candidate, 7 inherit an
ambiguous basename (M1's error class), 1 inherits a host and a port, and 1
inherits a path under which the cited line does not exist.

That last one is a correction to the brief. The brief counted 10 tokens
inheriting *a zero-candidate basename*; measured, it is 9 plus one separate
case — `docs/task/RFCT-058.md:83` writes a root web server's ports as
`0.0.0.0:443` and `:80`, so the bare token inherits a **host and a port**. The
gate already has a distinct skip reason for that, and the resolver must route
it there rather than to the basename reason.

### 3.1 The 386 with no same-line antecedent, by treatment

They are not one class. Measured, they are five, and each wants a different
treatment. This is the finding that reshapes the milestone: PLAN-028 says an
unresolvable bare token is an ERROR and the resolver fails closed, which taken
literally is 385 red sites on the gate's own upgrade — the outcome "the ratchet
only tightens on green" forbids. Only class A is a document defect.

| class | treatment | count |
|---|---|---|
| **A** genuine continuation — file named earlier in the same prose or table cell | correct by full-forming | **245** |
| **B** frozen audit record — the number IS the measurement | never rewrite; decide the marker | **70** |
| **E** table-column continuation — file named in an earlier row of the same column | not reachable by any same-line rule; dated-record territory | **59** |
| **C** metalinguistic — the form quoted, not used | skip by rule; cites nothing | **8** |
| **D** bare port — `` `:8080` ``, not a citation at all | skip by reason | **3** |

Class D has a fourth member, `docs/task/RFCT-058.md:83`, which is the single
token that appears in both halves of the split: it *has* a same-line
antecedent, and that antecedent is the host and port `0.0.0.0:443`. Counting
it once on each side gives 228 + 385 = 613 and A+B+C+D+E = 385.

Classes C, D and E are ones this pass names and justifies; the brief
anticipated three classes and invited a fourth.

**Class C is larger than the brief's five, and is not mechanically
detectable.** The brief lists five sites in `docs/task/RFCT-214.md` written
double-backticked so the literal backticks render. Three more are
metalinguistic but written single-backticked, and no rule can tell them from a
real citation: `docs/task/RFCT-215.md:78` discusses the form itself, and
`docs/task/RFCT-242.md:494` and `:495` discuss a citation's value as data. The
same trap is M1's: seven full-form tokens are written the same way, and one of
them — `docs/task/RFCT-170.md:64` — is **in scope and being content-checked
today** while asserting nothing about the tree.

**Class D**, the bare port, is new. Four sites write a port with the host
elided: `docs/task/RFCT-004.md:17`, `docs/task/RFCT-105.md:37` and
`docs/task/RFCT-156.md:16` in prose, plus the `RFCT-058` case above. A
resolver that treats these as citations invents a file for a port number.

**Class E** is RFCT-214's shorthand seen from the table side. A deliverable or
inventory table names the file in its first data row and every later row
carries only the line, inheriting down the column. `docs/task/RFCT-064.md:28`
onward is the shape (the two rows quoted verbatim):

    | 2.1 | `docs/design/api.md:655` | Versioning and path shape |
    | 2.2 | `:673` | Resource model, derived from mosd's two trees ... |

These are not repairable by full-forming, because the tables are already
stale: `docs/design/api.md:655` no longer holds section 2.1 — it holds a line
of TLS prose. `docs/task/RFCT-043.md`'s naming row points at a blank line, and
`docs/task/RFCT-066.md` places section 7.2 three hundred lines *before*
section 7.1. Full-forming them would multiply a wrong table, not fix it.

### 3.2 Per-document counts

The complete assignment. `same-line` is the 227; A/B/C/D/E are the 386.

| document | bare | same-line | A | B | C | D | E |
|---|---|---|---|---|---|---|---|
| `docs/design/api.md` | 168 | 73 | 86 | 6 | 0 | 0 | 3 |
| `docs/task/RFCT-215.md` | 55 | 12 | 1 | 20 | 1 | 0 | 21 |
| `docs/task/RFCT-169.md` | 47 | 22 | 9 | 16 | 0 | 0 | 0 |
| `docs/design/dashboard.md` | 35 | 18 | 17 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-159.md` | 34 | 15 | 17 | 2 | 0 | 0 | 0 |
| `docs/task/RFCT-214.md` | 34 | 2 | 15 | 12 | 5 | 0 | 0 |
| `docs/task/RFCT-200.md` | 23 | 4 | 19 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-210.md` | 17 | 1 | 0 | 0 | 0 | 0 | 16 |
| `docs/task/RFCT-172.md` | 15 | 15 | 0 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-120.md` | 12 | 12 | 0 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-066.md` | 11 | 0 | 3 | 0 | 0 | 0 | 8 |
| `docs/task/RFCT-076.md` | 11 | 8 | 3 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-167.md` | 10 | 10 | 0 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-114.md` | 8 | 1 | 7 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-180.md` | 8 | 1 | 7 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-058.md` | 7 | 1 | 1 | 4 | 0 | 1 | 0 |
| `docs/task/RFCT-064.md` | 7 | 0 | 0 | 0 | 0 | 0 | 7 |
| `docs/task/RFCT-069.md` | 7 | 1 | 6 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-134.md` | 7 | 0 | 7 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-071.md` | 6 | 1 | 1 | 4 | 0 | 0 | 0 |
| `docs/task/RFCT-074.md` | 6 | 6 | 0 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-115.md` | 6 | 4 | 1 | 0 | 0 | 0 | 1 |
| `docs/task/RFCT-150.md` | 6 | 3 | 0 | 3 | 0 | 0 | 0 |
| `docs/task/RFCT-043.md` | 5 | 0 | 2 | 0 | 0 | 0 | 3 |
| `docs/task/RFCT-203.md` | 5 | 0 | 5 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-212.md` | 5 | 1 | 1 | 3 | 0 | 0 | 0 |
| `docs/task/RFCT-072.md` | 4 | 2 | 2 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-142.md` | 4 | 0 | 4 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-153.md` | 4 | 0 | 4 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-190.md` | 4 | 3 | 1 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-244.md` | 4 | 0 | 4 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-140.md` | 3 | 0 | 3 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-155.md` | 3 | 1 | 2 | 0 | 0 | 0 | 0 |
| `docs/design/uboot-ab-handshake.md` | 2 | 0 | 2 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-081.md` | 2 | 1 | 1 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-129.md` | 2 | 1 | 1 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-136.md` | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-139.md` | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-168.md` | 2 | 0 | 2 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-240.md` | 2 | 0 | 2 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-242.md` | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| `docs/task/RFCT-243.md` | 2 | 0 | 2 | 0 | 0 | 0 | 0 |
| `docs/design/bus.md` | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-004.md` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `docs/task/RFCT-040.md` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-068.md` | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-105.md` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `docs/task/RFCT-111.md` | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-117.md` | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-132.md` | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-133.md` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-135.md` | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-138.md` | 1 | 0 | 1 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-156.md` | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `docs/task/RFCT-157.md` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| `docs/task/RFCT-191.md` | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| **total, 56 documents** | **613** | **227** | **245** | **70** | **8** | **4** | **59** |

## 4. The resolver design

Not implemented in this pass. M1 (RFCT-256) is editing the same extractor in
`docs/verify-citations.sh` on a sibling branch, and a two-sided edit to one awk
program collides. This section is the design the next pass implements on M1's
merged base.

### 4.1 The rule, and the correction the measurement forces

The brief states the rule as *inherit the nearest preceding full citation's
path on the same line*. **Measured against the corpus, that rule is wrong, and
it is wrong in the silent direction.** It mis-binds at six sites, all in
`docs/task/RFCT-172.md`'s stale-citation table, whose columns are
`[citing site] | [old path and its range] | [new full citation] | [note]`:

    | `docs/task/RFCT-139.md:8` | `os/update/rauc/system.conf.in` `:71-78` | ...

The bare `` `:71-78` `` belongs to the old path beside it. The nearest
preceding *full citation* is the citing site in column 1, a different file
entirely. Under the brief's rule the six sites land as:

- `docs/task/RFCT-172.md:92` binds to `docs/task/RFCT-139.md`, which has 73
  lines, and **fails**. This is the single "real defect, re-derive it" the
  brief carried forward. Re-derived: it is not a document defect. The document
  is correct as written; the rule mis-reads it. Nothing in `RFCT-172.md`
  needs changing.
- `:90`, `:91`, `:94`, `:95` and `:96` bind to the citing task file and
  **resolve** — five silent false greens, each asserting a line in the wrong
  file. Worse than the failure, because the run stays green.

The correction: the same-line antecedent is the nearest preceding token of
**either** kind — a full `path:line` citation, or a bare path naming a file.
With bare paths admitted, all six bind to the old path in their own column and
route to the outside-tree skip, which is what a reader does.

### 4.2 Antecedent selection, precisely

Scan backwards along the citing line over backtick spans, properly tokenised —
not by regex over the raw line, which straddles adjacent spans and matched a
bare `/` between `` `GET` `` and `` `PUT ...` `` at `docs/design/api.md:1489`.
A span is a candidate antecedent when it is either:

1. a full `path:line` or `path:line-line` citation, or
2. a **path token**: no space, contains a `/`, does not end in `/`, and its
   first segment is a directory that exists at the repo root.

The nearest candidate wins. A span that is neither is passed over, never
bound. That clause is load-bearing, and each half is forced by a measured site:

- passing over is required by `docs/task/RFCT-074.md:242`, where the route
  `` `/login` `` sits between `` `routes.rs:149` `` and its `` `:230` ``. Its
  first segment is empty, so it is not a path token, and `` `:230` `` reaches
  the citation behind it. Binding to `/login` instead would lose the site.
- the trailing-slash exclusion is required by `docs/task/RFCT-169.md:133`,
  where `` `os/pkgs/mosd/` `` names a directory, not a file.
- the repo-root test is required by `docs/task/RFCT-169.md:254`, where
  `` `mosd/` `` is a path that has not existed since PLAN-019.

### 4.3 Composition with M1's basename rule

An antecedent may itself be no-slash (`routes.rs:947` in
`docs/task/RFCT-210.md`'s inventory column). Resolution composes in one
direction only: the antecedent is resolved to a path **first**, by M1's
unique-basename rule, and the bare token then inherits the result. So a bare
token behind an ambiguous basename is ambiguous, and one behind a
zero-candidate basename is skipped — it never gets a second, looser chance.
Measured, that is 7 ambiguous and 9 zero-candidate.

### 4.4 Fail-closed cases, and what each costs

| outcome | rule | count |
|---|---|---|
| resolves, newly checked | antecedent resolves; line in range | **182** |
| skip, outside this tree | antecedent's first segment is not a repo-root directory | 30 |
| skip, basename has no candidate | M1's rule finds nothing | 9 |
| skip, a host and a port | antecedent is an address | 1 |
| **ERROR**, antecedent basename ambiguous | M1's class; fixing the antecedent to full form fixes these | **7** |
| **ERROR**, antecedent path does not exist | see 4.5 | **9** |
| **ERROR**, unresolvable — no same-line antecedent | 385 today; class A's correction is what shrinks it | **385** |

The out-of-range error class is **empty** once 4.1's correction is applied.
The brief's single failing site was the rule's artifact, not the corpus's.

### 4.5 The nine that name a file the tree does not have

Admitting path tokens as antecedents makes nine sites reachable that were
invisible before, and they resolve to paths that do not exist. Seven are
`RFCT-172.md`'s frozen record of paths that moved, and are correct as records.
**Two are a live defect in a design document**: `docs/design/api.md:3083` and
`:3501` assert image-side checks against `os/verify-image-v2.sh`, and no such
file exists anywhere in this tree — the bash script was replaced by the
TypeScript suite under `os/verify/src/`, where `check_ui_location` survives
only as a name in a comment at `os/verify/src/checks-fstab.ts:14`. The four
bare lines hung off it (`` `:254` ``, `` `:210` ``, `` `:341` ``, `` `:248` ``)
are never-valid: they are offsets into a deleted bash file, and the TypeScript
that replaced it is not a renumbering of it. They are **listed as unresolvable
for a human**, not guessed at — re-deriving them would be inventing anchors,
which is the one thing the brief forbids.

### 4.6 The metalinguistic skip, shared with M1

A token written `` `` `:120` `` `` — double-backticked so the backticks render
— is the form under discussion, not a use of it. Both milestones need this and
must not implement it twice: the skip belongs in the shared extractor, keyed on
the enclosing double backticks, and counts as its own summary reason. It
covers 5 of the 8 class C sites and 5 of the 7 full-form ones.

It does **not** cover the other three (`docs/task/RFCT-215.md:78`,
`docs/task/RFCT-242.md:494` and `:495`) or M1's `docs/task/RFCT-170.md:64`,
which are single-backticked and mechanically identical to real citations. The
honest treatment is a document correction, not a cleverer rule: rewrite those
four to the double-backtick form the corpus already uses for quoted forms, so
the intent becomes machine-visible. That correction is left for the
implementing pass, so that it lands beside the rule that reads it.
