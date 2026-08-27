# RFCT-080 Close the duplicate-row hole in the index verifier, and sweep the `sort -u` shape

- **status**: completed — three duplicate assertions added, each proved to fail with its own message; nine `sort -u` sites judged, none changed
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-20 15:20
- **claimedAt**: 2026-08-20 15:22
- **completedAt**: 2026-08-20 16:05

Campaign `l1-o7ee8v0o-20260820142702-ui`. This is a task about a **gate**, not
about the campaign's feature. Base `16dd382`.

```
$ git rev-parse HEAD
16dd382a478bfc5f05da5231b0d96ccf52f28743
$ git merge-base --is-ancestor 16dd382 HEAD && echo BASE-OK
BASE-OK
```

No Rust was written or changed; `mosd/` was not touched.

## Description

`docs/verify-index.sh` checks both document indexes forward and backward, and
**neither direction can see a row that appears twice.**

| direction | code | why it cannot see a duplicate |
| --- | --- | --- |
| forward, task | `grep -qF -- "($base)"` (`:88`) | `-q` is satisfied by one occurrence or by five |
| reverse, task | `grep -oE ... \| tr -d '()' \| sort -u` (`:96`) | `sort -u` removes the duplicate **before** the loop that would have noticed |
| forward, design/research | `readme_entries_under ... \| grep -qxF` (`:58`) | same `-q` |
| reverse, design/research | `for entry in $(readme_entries_under "$dir")` (`:66`) | each copy is checked separately and **both pass** |

Measured at the base, injecting a second `(RFCT-073.md)` row into
`docs/task/index.md`:

```
occurrences of (RFCT-073.md) now: 2
docs/verify-index.sh: design/ <-> docs/README.md
docs/verify-index.sh: research/ <-> docs/README.md
docs/verify-index.sh: task/RFCT-*.md <-> docs/task/index.md
docs/verify-index.sh: 162/162 PASS
VERIFIER_EXIT=0
```

**The check count does not even move** — 162/162 with the duplicate and 162/162
without it. So this is not merely "not caught": it is also invisible to a
before/after count comparison, which is the other control this project routinely
relies on. (The working tree was restored with `git checkout` and left clean;
nothing of that experiment is committed.)

**Why it matters here specifically.** Every L3 in this campaign appends a row to
`docs/task/index.md` at the same point, so every merge produces a two-row
conflict, and those are hand-resolved on the justification that this gate checks
the resolution. It checked two of the three failure modes. The third — a
duplicated row — is precisely the one a two-row append conflict is most likely
to produce.

## Deliverable

| file | what |
| --- | --- |
| `docs/verify-index.sh` | two "once each" loops: one in `check_readme_dir` (covering both `design/` and `research/`), one for `docs/task/index.md` |
| `docs/verify-index-test.sh` | eight cases driving the real verifier against mutated copies of the real docs tree |
| `Makefile` | `docs-verify-test`, with the comment block saying why it exists and what it proves |
| `docs/task/RFCT-080.md`, `docs/task/index.md` | this record and its row |

```
$ git diff --cached --stat 16dd382
 Makefile                  |  16 +++
 docs/task/RFCT-080.md     | 346 ++++++++++++++++++++++++++++++++++++++++++++++
 docs/task/index.md        |   1 +
 docs/verify-index-test.sh | 220 +++++++++++++++++++++++++++++
 docs/verify-index.sh      |  28 ++++
 5 files changed, 611 insertions(+)
```

**No file under `os/` was changed**, because the sweep below justified no change
there. Nothing under `mosd/`, `docs/design/`, `docs/README.md`, `os/rootfs/`,
`Cargo.toml` or `Cargo.lock` was touched.

## The assertion

Each new loop iterates the **distinct** names and takes the count from the
**undeduplicated** source:

```sh
for entry in $(grep -oE '\(RFCT-[^)]+\.md\)' "$TASK_INDEX" | tr -d '()' | sort -u); do
    n=$(grep -cF -- "($entry)" "$TASK_INDEX")
```

The `sort -u` that remains is the list of names to *examine*; it is no longer
the thing that decides whether a name is duplicated. That distinction is the
whole content of the fix, and it is the same distinction the sweep below turns
on.

**The assertion is per-fact, not aggregate**, and that was deliberate. A single
`pass "no row appears twice"` computed over the whole file would have inherited
the very defect being closed: it would move the total by exactly 1 whether there
were zero duplicates or five, leaving the new check itself count-invariant to
the multiplicity it exists to measure, and its message could only say *that*
something duplicated. One check per indexed name instead, so the total scales
with what is checked and every duplicated link is named with its own count:

```
  FAIL docs/task/index.md carries 2 rows for 'RFCT-071.md'; ...
  FAIL docs/task/index.md carries 3 rows for 'RFCT-073.md'; ...
docs/verify-index.sh: 2 FAILED, 244 passed
```

That is the general rule this task is an instance of: **a check count is a
control only over facts the verifier enumerates one-per-check, and is invariant
under any defect living inside an aggregating check** — a `sort -u`, a `grep -q`
over a set, a loop whose body collapses its input.

**All three sections shared the blindness, and all three are closed.** Sections
1 and 2 differ from section 3 in one respect worth recording: their reverse loop
has no `sort -u`, so a duplicated README entry made the count move, 162 -> 163.
That is not a detection. **A count that rises by one is exactly what adding a
real document looks like**, so nobody reading the number could tell the two
apart. Measured, in a copy of the tree rather than by editing the fenced
`docs/README.md`:

```
$ bash "$W/docs/verify-index.sh"        # api.md listed twice under design/
docs/verify-index.sh: 163/163 PASS
EXIT=0
```

## The check total, before and after

```
$ bash docs/verify-index.sh        # base 16dd382
docs/verify-index.sh: 162/162 PASS

$ bash docs/verify-index.sh        # verifier change only
docs/verify-index.sh: 243/243 PASS

$ bash docs/verify-index.sh        # final tree, this record and its row added
docs/verify-index.sh: 246/246 PASS
```

**Delta +81 for the assertions**, and it decomposes exactly: 11 distinct
`design/` entries + 5 distinct `research/` entries + 65 distinct task links =
81, one new check per distinct indexed name. A change that added assertions and
left the total unmoved would mean they never ran — which is precisely what the
defect above looked like.

**The further +3 is this task's own record**, which is now the 66th task link
and so is examined once by each of the three task-section loops — forward,
reverse, and once-each. That is the per-document cost of the new assertion, and
it is the number every future L3 should expect to see the total rise by.

## The count delta: predicted, then observed

**Stated plainly: the 162 -> 243 delta was read off after the fact, not
predicted before the run.** It was decomposed afterwards (11 + 5 + 65), which is
a description of what happened, not a control on it.

So the control was constructed afterwards, on facts not yet observed. Each
prediction below was written down before the corresponding run, derived from the
tree: `check_readme_dir` and the task section each contribute **three** checks
per document — forward, reverse, once-each — so the tree's 11 design + 5
research + 66 task links should account for the total exactly.

| fixture | predicted | observed | |
| --- | --- | --- | --- |
| three extra task records, each with its row | `255/255 PASS`, exit 0 (+3 per record) | `255/255 PASS`, exit 0 | match |
| one task row duplicated | `1 FAILED, 245 passed` | `1 FAILED, 245 passed` | match |
| one `design/` entry duplicated | `1 FAILED, 246 passed` | `1 FAILED, 246 passed` | match |
| two rows duplicated, at multiplicity 2 and 3 | `2 FAILED, 244 passed`, two FAIL lines | `2 FAILED, 244 passed`, two FAIL lines naming 2 and 3 | match |

The third row is the one that carried information. It predicts **one more
passing check than the second**, from the same single duplicate, and the reason
is structural: the task section's reverse loop iterates *distinct* links and so
gains nothing from a duplicate, while `check_readme_dir`'s reverse loop has no
`sort -u`, gains a passing check, and that gain exactly offsets the once-each
check it lost. Had both come back with the same passed-count, the model of the
two sections would have been wrong. They did not.

## The negative direction

`docs/verify-index-test.sh` runs the **real** `docs/verify-index.sh` once per
case, over a **copy** of the real docs tree with one mutation applied. The
verifier resolves its own root from `${BASH_SOURCE}`, so a copy placed at
`${case}/docs/verify-index.sh` reads `${case}/docs` — no environment hook was
added and the real tree is never written to. Nothing is reimplemented; a
reimplementation would be testing the test's idea of the assertion.

The baseline is the shipped `docs/README.md`, `docs/task/index.md` and document
tree, copied verbatim, and every case mutates that. An index the test had
authored would prove only that the test can spell. **Nothing is hardcoded about
the baseline check count** — that number grows with every document added, and a
test that pinned 243 would fail on the next merge for no reason.

Each case asserts a non-zero exit **and** an exact expected count of `FAIL`
lines **and** that each expected substring appears in a FAIL line. An extra
assertion firing is a failure of the test, not a bonus. The mutation helper
fails loudly if the line it was told to duplicate was not present exactly once
to begin with: a mutation that silently changed nothing would make its case pass
for free.

```
$ make docs-verify-test
verifier under test: /srv/.../docs/verify-index.sh
fixture copied from: /srv/.../docs

PASS: baseline: the shipped docs tree, copied verbatim: 246/246, no failures, exit 0
    | occurrences of '(RFCT-073.md)': 1 -> 2
PASS: docs/task/index.md carrying the RFCT-073 row twice: 1 assertion(s) fail, each with its own message, exit 1
    |   FAIL docs/task/index.md carries 2 rows for 'RFCT-073.md'; that record's status now lives in two places that can disagree, and a merge that kept both sides of an append is how it got there
    | occurrences of '(RFCT-073.md)': 1 -> 3
PASS: docs/task/index.md carrying the RFCT-073 row three times: 1 assertion(s) fail, each with its own message, exit 1
    |   FAIL docs/task/index.md carries 3 rows for 'RFCT-073.md'; ...
    | occurrences of '  - `api.md`': 1 -> 2
PASS: docs/README.md listing api.md twice under design/: 1 assertion(s) fail, each with its own message, exit 1
    |   FAIL docs/README.md lists 'api.md' 2 times under design/; a reader who edits one description will not see the other, and the two will drift apart unnoticed
    | occurrences of '  - `os-comparison.md` — ...': 1 -> 2
PASS: docs/README.md listing a research document twice: 1 assertion(s) fail, each with its own message, exit 1
    |   FAIL docs/README.md lists 'os-comparison.md' 2 times under research/; ...
PASS: a row whose record a rename deleted: 1 assertion(s) fail, each with its own message, exit 1
    |   FAIL docs/task/index.md has a row for 'RFCT-073.md', but docs/task/RFCT-073.md does not exist
PASS: a task record with no row: 1 assertion(s) fail, each with its own message, exit 1
    |   FAIL docs/task/RFCT-999.md exists but has no row in docs/task/index.md
PASS: a README entry whose document a rename deleted: 1 assertion(s) fail, each with its own message, exit 1
    |   FAIL docs/README.md indexes 'api.md' under design/, but docs/design/api.md does not exist

RESULT: PASS (8/8 cases)
```

Case 0 is the positive control; without it every negative could be passing
because the copy is broken in some way that has nothing to do with the mutation.
Case 2 exists because the message must report the multiplicity it **found** — a
three-way pile-up and a plain duplicate are different-sized messes. Case 4 runs
the same function with a different directory argument, proving the directory is
a parameter and not baked into the message. Cases 5-7 drive the three
pre-existing assertions; they are not what the file was written for, they are
there so a future edit cannot disarm them while the duplicate cases go on
passing.

### The test is not vacuous

An eight-for-eight run proves the assertions fire; it does not by itself prove
the **test** could ever fail. So it was run against the **pre-fix** verifier —
`git show 16dd382:docs/verify-index.sh` dropped into a scratch copy of the tree:

```
$ bash "$S/docs/verify-index-test.sh"
PASS: baseline: the shipped docs tree, copied verbatim: 162/162, no failures, exit 0
    | occurrences of '(RFCT-073.md)': 1 -> 2
    | no FAIL line contains: carries 2 rows for 'RFCT-073.md'
FAIL: docs/task/index.md carrying the RFCT-073 row twice: expected 1 FAIL line(s) and a non-zero exit, got 0 FAIL / exit 0
    | docs/verify-index.sh: 162/162 PASS
...
RESULT: FAIL (4/8 cases)
EXIT=1
```

The four duplicate cases fail against the old verifier and the three
pre-existing cases pass against both — so the test discriminates the fix from
its absence, and it also reproduces the original measurement from inside the
harness: **162/162 with the duplicate row present.**

## The `sort -u` sweep — nine sites, none changed

`sort -u` inside a verifier makes a check idempotent over its input. That is
correct wherever the value genuinely **is** a set, and it is a hazard wherever
**multiplicity itself is the defect**. Every site in the tree was re-derived by
grep rather than taken from the brief, and judged individually.

| site | verdict | why |
| --- | --- | --- |
| `docs/verify-index.sh:96` (base numbering) | **hazard — closed** | the duplicate row is the defect. Closed by adding a counting assertion, **not** by removing the `sort -u`: the deduplicated list is the right thing to iterate, it was just the only thing anyone counted. |
| `os/verify-image-v2.sh:1352` / `os/verify-image.sh:706` | set | the distinct `com.mos.*` names the D-Bus policy mentions. A policy naming the bus in five rules names **one** bus, and deduping is what makes that true. The upstream awk has already deduplicated into `names[v]=1` before `sort -u` sees it. Multiplicity of *distinct* names is still checked — `:1377` compares the joined result for **equality** against `mosd.service`'s `BusName=`, so a second distinct name fails the check. |
| `os/verify-image-v2.sh:2285` / `os/verify-image.sh:1121` | set | the commands the `/usr/lib/mos` boot scripts invoke, gathered across all scripts, each then resolved in the packed rootfs. `cp` invoked by three scripts is one binary to find. A vacuity guard already covers the failure that *would* matter here (`< 10` extracted names fails). |
| `os/verify-image-v2.sh:2520` | set **for this predicate** — see below | |
| `os/verify-image-v2.sh:2680` / `os/verify-image.sh:1447` | set, and deliberately so | the distinct crypt(3) prefixes `transient.rs` pins. The very next line requires the count to be **exactly 1**, so multiplicity is not merely visible here, it is the assertion. What must be deduped is a prefix written twice in the source, which is one format; the message says "distinct crypt(3) prefixes" and means it. |
| `os/verify-image-v2.sh:2707` / `os/verify-image.sh:1485` | set | inside a FAIL message, listing which formats the packed libcrypt carries. A prefix appears many times in a `.so`; printing it fifty times would be noise. Presentational, and it decides nothing. |

**`os/verify-image-v2.sh:2520` in detail**, since it is the one where paths are
reduced to basenames (`find ... | sed 's|.*/||' | sort -u`) and two distinct
paths sharing a basename do collapse to one. **It is not a hazard here, and the
reason is specific rather than reassuring: the predicate applied to each element
is a pure function of the basename.** The loop tests `${n}` against
`*${MOS_SWEEP}*`, `${STA_PREFIX}*` and `${AP_PREFIX}*` — nothing else. So the
collapsed twin is guaranteed the same verdict as the survivor; examining it
could not change a PASS into a FAIL. Deduping there loses information the check
does not consult.

Two things follow, and both are reported rather than acted on:

- **This is a latent condition, not a safe one.** The moment anyone extends that
  loop with a path-dependent question — "is this file in `/etc` masking one in
  `/usr/lib`?" — the `sed` has already thrown away the answer. That is a real
  systemd relationship (lookup across `/etc`, `/run`, `/usr/lib` is by filename,
  first found wins) and no check in this repository asserts anything about it.
  Adding one is not this task's scope.
- **Whether any duplicate basename exists in the assembled image today was not
  established.** The `.network` files come from packages inside the container,
  not from `os/rootfs/**` (which ships none), so enumerating them needs a built
  image. No image was built, for the reason in the next section.

**One site in the brief does not reproduce.** `mosd/hack/dbus-policy-test.sh`
was listed as carrying one occurrence. It contains **no `sort` at all**, and a
tree-wide search finds no shell `sort -u` anywhere under `mosd/`. Nothing was
owed there and nothing was touched (that path is fenced to a sibling task in any
case).

**Nine real sites examined, one changed.** A sweep that touched all nine would
have been the worse outcome.

## Checks run

| command | result |
| --- | --- |
| `bash docs/verify-index.sh` | `162/162 PASS` at base; **`243/243 PASS`** with the assertions, delta **+81**; **`246/246 PASS`** in the final tree, the further +3 being this record's own row |
| `make docs-verify-test` | `RESULT: PASS (8/8 cases)` |
| the same test vs. the base verifier | `RESULT: FAIL (4/8 cases)`, exit 1 — the anti-vacuity control |
| `make os-image-cx3576-v2` + `make os-verify-cx3576-v2` | **not run, and not owed**: the image pair is owed when `os/verify-image*.sh` changes, and the sweep justified no change there. `git diff --name-only 16dd382..HEAD` lists no path under `os/`. |
| `mosd/hack/check.sh` | **not run, and not owed**: the diff lists `Makefile`, `docs/verify-index.sh`, `docs/verify-index-test.sh` and two files under `docs/task/`. No `.rs`, no `Cargo.toml`, nothing under `mosd/`. |

## What is NOT claimed — hardware

**This work was not exercised on hardware, and could not be.** It changes a
documentation gate and a shell test that runs in a temp directory; no image was
built and nothing was flashed.

The standing position, because both overstatements are equally wrong: hardware
**has** booted — a **v1** image reached the `mos login:` prompt on a real
CX3576-Z, and the repart/maskrom and SPL-hash investigations ran against a real
board. What has **never been exercised on hardware** is the **v2** stack: verity
root, A/B, `rauc install`, and apid. This task moves neither position.

## Deliberately out of scope

- **The `*.zh.md` exclusion.** The new loops inherit the file's existing stance
  and no translated sibling is currently listed in `docs/README.md`, so the
  duplicate check over README entries never sees one. Whether translations are
  kept current remains parked with the user.
- **Duplicate `.network` basenames across `/etc` and `/usr/lib`.** Reported
  above as a latent condition at `os/verify-image-v2.sh:2520`. Asserting the
  masking relationship would be a new claim about the image, not the closing of
  a hole in an existing one.
- **`docs/plan/` and `docs/architecture.md`.** Neither index covers them, and
  extending the verifier's reach is a different task from making its existing
  reach sound.

<!-- dated-record: a measurement record frozen at its commit; its citations name the tree as it was then (pre-PLAN-019 layout, pre-rewrite design documents); exempt from docs/verify-citations.sh (RFCT-172) -->
