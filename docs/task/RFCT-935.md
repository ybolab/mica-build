# RFCT-935 Renumber branch-owned plan and task records away from upstream IDs

- **status**: completed
- **priority**: P1
- **owner**: l2-record-renumbering
- **createdAt**: 2026-09-01 02:03 UTC
- **plan**: [PLAN-917](../plan/PLAN-917.md)

## Description

`origin/main` and this branch independently allocated overlapping plan and
RFCT ranges after their common ancestor. Move every branch-owned record into
the reserved `9xx` range, update every mutable in-tree reference, and leave
the exact old-to-new mapping below for immutable BKD issue titles and reports.

No merge, rebase, push, build-host work, or hardware action is part of this
task. `origin/main` records remain untouched.

## Acceptance

- The seven branch plan records use their mapped `PLAN-910` through
  `PLAN-916` identifiers.
- The twenty-five branch task records use their mapped `RFCT-910` through
  `RFCT-934` identifiers.
- Every mutable reference in plan records, task records, indexes, Markdown
  links, source comments, and test titles resolves to the new identifier.
- BKD-facing historical titles and reports are not edited; this table remains
  the lookup point for their old identifiers.
- The documentation index check, a complete old-ID reference audit, and
  `git diff --check` pass. Only immutable artifact filename components and the
  mapping table may retain an old identifier.
- The change is committed using named paths only after
  `git diff --cached --name-only` is reviewed.

## ActiveForm

Renumbered branch-owned records into the reserved `9xx` namespace and verified
their in-tree references without rewriting history.

## Dependencies

- **blocked by**: (none)
- **blocks**: clean future integration of `board/s905x5m` documentation

## Mapping for external BKD records

| Old identifier | New identifier |
|---|---|
| PLAN-034 | PLAN-910 |
| PLAN-035 | PLAN-911 |
| PLAN-036 | PLAN-912 |
| PLAN-037 | PLAN-913 |
| PLAN-038 | PLAN-914 |
| PLAN-039 | PLAN-915 |
| PLAN-040 | PLAN-916 |
| RFCT-270 | RFCT-910 |
| RFCT-271 | RFCT-911 |
| RFCT-272 | RFCT-912 |
| RFCT-273 | RFCT-913 |
| RFCT-274 | RFCT-914 |
| RFCT-275 | RFCT-915 |
| RFCT-276 | RFCT-916 |
| RFCT-277 | RFCT-917 |
| RFCT-278 | RFCT-918 |
| RFCT-279 | RFCT-919 |
| RFCT-280 | RFCT-920 |
| RFCT-281 | RFCT-921 |
| RFCT-282 | RFCT-922 |
| RFCT-283 | RFCT-923 |
| RFCT-284 | RFCT-924 |
| RFCT-285 | RFCT-925 |
| RFCT-286 | RFCT-926 |
| RFCT-287 | RFCT-927 |
| RFCT-288 | RFCT-928 |
| RFCT-289 | RFCT-929 |
| RFCT-290 | RFCT-930 |
| RFCT-291 | RFCT-931 |
| RFCT-292 | RFCT-932 |
| RFCT-293 | RFCT-933 |
| RFCT-294 | RFCT-934 |

## Collision basis and range decision

The Phase 1 audit checked each pre-renumber path against `origin/main`. The
following rows were direct collisions: `PLAN-035` through `PLAN-039`, and
`RFCT-270` through `RFCT-275`. Their old identifiers already named unrelated
mainline records, so moving them was required.

The remaining rows in the mapping table are consistency moves, not assertions
of a direct upstream collision:

| Old identifiers | New identifiers | Reason for move |
|---|---|---|
| `PLAN-034` | `PLAN-910` | The campaign's root plan did not exist upstream, but it anchors the contiguous branch plan range. |
| `PLAN-040` | `PLAN-916` | It did not exist upstream, but it closes the branch plan range after the directly colliding rows. |
| `RFCT-276` through `RFCT-294` | `RFCT-916` through `RFCT-934` | These records did not exist upstream at audit time, but continue the branch task sequence after the directly colliding rows. |

Moving the full ranges was a deliberate trade-off. Keeping `PLAN-034` as the
campaign root while moving its adjacent plans, or keeping later RFCT records in
the sequential mainline namespace, would leave a split active namespace that
is hard to audit and likely to collide again as upstream allocates the next
identifiers. A single disjoint `9xx` branch namespace gives every branch-owned
record one predictable lookup rule and avoids a second partial migration.

That consistency decision has a real external-reference cost: immutable BKD
titles and reports, including historical references to `PLAN-034`, retain the
old labels. The complete mapping table above is therefore the durable bridge
for those records; it deliberately includes consistency moves so a reader can
resolve an old label even when no direct collision caused that particular move.

## Reservation and headroom

`board/s905x5m` reserves `PLAN-910` through `PLAN-999` and `RFCT-910`
through `RFCT-999` until its records are integrated. Mainline allocation must
remain outside that branch-reserved shard. The current upstream rate is five
plans and six RFCT records in 129 commits. The first reserved identifier leaves
870 plan numbers and 635 task numbers: about 22,446 and 13,653 upstream commits
at that observed rate. The reservation makes the intended ownership explicit;
the headroom protects the branch even if that convention is not immediately
visible to upstream.

## Notes

- Implementation was approved on 2026-09-01 04:38 UTC. The current checkout
  already contains `PLAN-918`/`RFCT-936` and uncommitted
  `PLAN-919`/`PLAN-920` and `RFCT-937`/`RFCT-938` allocations in the reserved
  range; they are not part of this renumbering and must retain their assigned
  identifiers.
- Phase 1 audit completed on 2026-09-01 against local `origin/main`
  `f48e039a`; the direct collisions and consistency moves are distinguished
  in the range-decision section above.
- Seven non-document source comments or test titles also refer to the branch
  identifiers and are within scope.
- `bash docs/verify-index.sh` is required by this task, but its documented
  scope is `docs/design/` and `docs/README.md`; the old-ID audit is the
  additional check that covers PMA plan and task records.
- Completed on 2026-09-01 04:43 UTC. All mutable plan/task headings, paths,
  index rows, Markdown links, source comments, test titles, and owner labels
  use the mapped identifiers. PMA index and relative-link audits passed;
  `bash docs/verify-index.sh` passed 48/48; `git diff --check` passed.
- The old-ID audit found only the mapping table above, quoted historical
  commit text in `docs/task/COMMIT-NOTES.md`, and immutable artifact filename
  components below `/backup/mos-artifacts/` or `/srv/`. Those filenames retain
  their original names so the recorded physical artifacts remain locatable.
- The `9xx` reservation is now in the Usage sections of both plan and task
  indexes, which workers inspect before allocating; it is not only recorded
  in this task. The later `PLAN-919`/`PLAN-920` and
  `RFCT-937`/`RFCT-938` allocations were deliberately left un-staged for
  their owners to commit.
- `docs/task/COMMIT-NOTES.md` retains its correction record for `84b9c1c`.
  This renumbering changed only current identifier/path presentation and added
  an explicit historical-versus-current-path clarification. Its six-file
  finding, explanation of the incorrect commit contents, attribution, and
  recommended handling were not changed.
