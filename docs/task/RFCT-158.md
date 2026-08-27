# RFCT-158 PLAN-017 M4: the provenance lines in access.md, connd.md and provisioning.md

- **status**: completed
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-26 22:05
- **claimedAt**: 2026-08-27 06:47
- **completedAt**: 2026-08-27 06:53
- **plan**: PLAN-017 (M4)

PLAN-017 M4. Four commits, merged at `fa337ee`: 93 insertions, 140 deletions
across five design documents.

## What landed

| commit | document | change |
| --- | --- | --- |
| `498fb93` | `access.md` | the two provenance banners and the Go-sshd archaeology deleted; the one-policy-source argument kept as a statement about why mosd owns the only sshd drop-in |
| `b4a7fca` | `connd.md` | §1 opens with what ships rather than a migration record; every fact the PLAN-008 comparison table carried on its right-hand side survives into the prose |
| `8679a20` | `provisioning.md` | the two provenance banners and the retirement record deleted; the zero-external-input requirement, the credential-model facts already in §3.6, and what the image verifiers actually assert are kept |
| `cdfe8d5` | `api.md`, `remote-management.md` | the `access.md` line citations the sweep moved, re-pointed — line numbers only, no prose in either file |

`access.md`'s *"Base change (PLAN-010 M5, 2026-08-19)"* banner and its
`DebugAccessConfig` / COSI-controller / Go-sshd retraction are gone; the header
now carries one line stating that the `.zh.md` sibling is stale. `connd.md` §1
is renamed from *"What changed from PLAN-008, and what did not"* to
*"What ships"*.

Net effect on the citation gate: **886/886 before, 886/886 after** — a sweep
that re-pointed 44 citations and dropped none.

## The re-point, measured

Deleting the banners moved every line in three documents. Two other design
documents cite `access.md` by line, and `cdfe8d5` re-pointed all of them:

| document | `access.md:NNN` tokens re-pointed | lines touched |
| --- | --- | --- |
| `docs/design/api.md` | 38 | 34 |
| `docs/design/remote-management.md` | 6 | 6 |
| **total** | **44** | **40** |

All 38 of api.md's `access.md` line citations were re-pointed — the whole
population, not a subset. remote-management.md's six were all introduced by
RFCT-156 in the same round; `main`'s copy of that document cited `access.md` by
line zero times.

## Ordering deviation from PLAN-017

PLAN-017's **Ordering** section says: *"M1/M2 are independent of PLAN-018.
M3/M4 run after PLAN-018 reaches main."* **M4 did not.** It ran before
PLAN-018, and after M1. This is a deviation from the plan as written, approved
by L1 — it is not something PLAN-017 said.

The two measured grounds:

1. **Running before PLAN-018 is safe because these three documents cite no
   board path at all.** PLAN-018's whole subject is the move of `board/` to
   `os/boards/` and the retirement of `board.yaml`; a document that names
   neither cannot be invalidated by it. Measured on `main` before the sweep,
   over `access.md`, `connd.md` and `provisioning.md`:

   ```
   $ grep -n 'board/\|os/boards\|board\.env\|board\.yaml' \
       docs/design/{access,connd,provisioning}.md
   docs/design/access.md:464:   keyboard/touch input (design/display.md).
   ```

   One hit, and it is the substring `board/` inside *"keyboard/touch"*. No
   board path is cited in any of the three.

2. **Running after M1 is required because api.md cites access.md by line about
   thirty times.** Measured on `main`:

   ```
   $ git show main:docs/design/api.md | grep -c 'access\.md:[0-9]'
   33
   ```

   Deleting access.md's banners shifts every one of those. Had M4 landed
   first, M1 would have had to re-point them mid-rewrite against a moving
   target; running M4 second meant one sweep against a settled api.md — the
   38 in the table above.

**Provenance of this section.** RFCT-158's completion report is not readable
back from the repository, so the commands, their output and the counts above
are re-derived here against the merged tree and `main` rather than copied from
that report. They are stated as what this record measured.

## What this subtask did not settle

`docs/task/**` and `docs/research/**` are outside
`docs/verify-citations.sh`'s scope and hold line citations into `access.md`,
`connd.md` and `provisioning.md` that this sweep invalidated. They are
inventoried in `docs/task/RFCT-159.md`, not fixed here.
