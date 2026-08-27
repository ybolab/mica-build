# RFCT-173 PLAN-020 M4: the self-test fixture repoints to os/pkgs, and the unquoted count becomes a ratchet

- **status**: completed — P4 repoint landed alone (48 path occurrences), unquoted ratchet live at 763 across 36 ceilings, 27/27 self-test cases, PLAN-020 closed
- **priority**: P2
- **owner**: bkd/r2dbek4n
- **createdAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-020 (M4)

PLAN-020 M4, the campaign's last milestone: the deferred cosmetic repoint of
the citation checker's self-test fixture (RFCT-165's P4), the ratchet that
closes Context class 1 as policy, and the closeout that maps all eight
measured silent spaces to what now holds each one.

## 1. The P4 repoint, alone in its own commit

RFCT-165 deferred this on an asymmetric-risk argument: editing the fixture of
the gate during the same milestone that rewrote 726 real citations could mask
a tree mistake with a test mistake. Deferral was the point, so the repoint
rode alone, with nothing else in the commit, and can be reviewed standalone.

The self-test built its synthetic tree under a stale example path shape,
`mosd/apid/src`, a directory the real tree lost when PLAN-019 moved mosd
under `os/pkgs/`. RFCT-165 measured 27 occurrences; the M1 and M3 test growth
since (16 to 24 cases) raised that to **48 occurrences** of the path string,
plus 9 fixture strings naming the bare `mosd` census segment (baseline rows,
floor messages, the segment report line, the rm -rf mutation), which followed
their first path segment to `os`. Pure string repoint: case set, behaviour
and every asserted count unchanged, 24/24 cases green before and after.

## 2. The unquoted-citation ratchet (Context class 1)

Class 1 — an unquoted citation that resolves but names the wrong line,
RFCT-128's worked example — is recorded as **not mechanisable without
quotes**: resolution can only prove the file and line exist, never that they
hold what the sentence claims. The fix is policy, and M1 built its
instrument: the per-document no-quote census line. This milestone makes it
binding.

`docs/verify-citations-unquoted-baseline.txt` commits a per-document CEILING
on the unquoted count, measured over the current tree (post-M3 widened
scope) and exact, not slack. `docs/verify-citations.sh` fails any scanned
document whose count exceeds its row — a fourth failure class (ratchet),
distinct in the FAIL line, the summary and the exit tally. A document with no
row has a ceiling of 0, so every new document starts fully quoted; dated
records stay exempt exactly as they are from the checks themselves.
Decreases pass, and the procedure (documented in the checker header and the
baseline file) is to lower the row in the same commit, so the ratchet only
ever tightens and the diff shows every decision; raising a row in the same
commit is the explicit, reviewable override.

The baseline at this commit: **763 unquoted citations across 36 documents**
with non-zero ceilings (of 149 scanned non-exempt documents; 376 citations
carry a quote). The concentration is the point of recording it:

| document | ceiling |
| --- | --- |
| `docs/design/api.md` | 439 |
| `docs/design/dashboard.md` | 83 |
| `docs/task/RFCT-150.md` | 72 |
| `docs/task/RFCT-172.md` | 21 |
| `docs/task/RFCT-169.md` | 19 |
| `docs/task/RFCT-159.md` | 17 |
| `docs/design/uboot-ab-handshake.md` | 12 |
| 29 further documents | 1–9 each, 100 total |

Self-test 24 -> 27 cases: a document above its ceiling fails with the
ratchet's own message; a new document with no row fails at ceiling 0 on a
citation that resolves (no other check can see it); a decrease under an
unchanged ceiling stays green.

## 3. Closeout: the eight spaces, and what now closes each

Verified on this branch with all three sibling milestones merged.

| # | space (worked example) | closed by |
| --- | --- | --- |
| 1 | unquoted resolves-but-wrong (RFCT-128) | policy, this task: the ratchet ceilings; NOT mechanisable without quotes |
| 2 | checkbox never compared with status, split vocabulary (RFCT-144) | M2/RFCT-171: canonical status heads, tree-wide sweep, verify-index.sh compares both halves |
| 3 | index descriptions can lie (RFCT-159 finding d) | M2/RFCT-171: documented why-not — no shared token exists, and a keyword heuristic passes the one known defect; stays a review concern |
| 4 | one interposed word silently demotes the content check (RFCT-155) | M1/RFCT-170: N=0 kept with corpus evidence, demotions surfaced as the near-miss count |
| 5 | docs/task and docs/research scanned by no gate (RFCT-159 finding a) | M3/RFCT-172: scope widened, 31 dated records exempted by name every run, 15 live citations repaired |
| 6 | citation-before-quote never arms (RFCT-163) | M1/RFCT-170: forward arming under the mirrored adjacency; the worked example is now checked every run |
| 7 | a vanishing root segment leaves scope silently (RFCT-167) | M1/RFCT-170: per-segment census with committed floors, zero or below-floor fails |
| 8 | the count is necessary, not sufficient (RFCT-169) | M1 census floors plus this ratchet bound the class; the residue is permanent (below) |

Milestone delivery, per the plan: M1 order-independent arming, interposed
rule, census (RFCT-170) [x]; M2 checkbox-vs-status gate and the README
contract answered with reasons (RFCT-171) [x]; M3 widened scope with the
exemption census (RFCT-172) [x]; M4 items 1 and 2 above [x]. PLAN-020 status
set to completed, 2026-08-27.

## Residual gaps, named rather than implied

- **Within-ceiling drift.** An unquoted citation whose target file's interior
  shifted still resolves and still passes while the document stays at or
  under its ceiling. The ratchet bounds the size of the invisible class; it
  cannot inspect its members. Shrinking it is content work — quoting or
  removing the 763 — owned by the documents' workstreams, ratcheted down as
  it lands.
- **Provenance claims** ("measured at a commit") are validated against no
  file at all, permanently, as the checker header states.
- **A skipped-as-outside path that once existed** reads the same as one that
  never did.
- **The 234 near-misses** are surfaced, not repaired: each is prose worth
  tightening so its quote arms.
- **Description truth** in the indexes stays a review concern by the M2
  decision.

## Checks

All four green at each of this task's three commits (repoint, ratchet,
closeout): `bash docs/verify-citations.sh` 1139/1139 with 0 ratchet failures,
`bash docs/verify-index.sh` 692/692 before this record joined,
`bash docs/verify-citations-test.sh` 27/27 cases,
`bash docs/verify-index-test.sh` 11/11 cases.
