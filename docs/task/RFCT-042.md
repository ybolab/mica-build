# RFCT-042 mos web/UI current-state inventory, measured

- **status**: completed — research complete, inventory, no code
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 10:17
- **claimedAt**: 2026-08-19 10:20
- **completedAt**: 2026-08-19 11:30

Campaign `l1-o7ee8v0o-20260819101756-venus` (research/design-proposal, documents
only). Branch `bkd/2o0djkty`, merged by L2 into `bkd/sqexk7je`.

## Description

A dashboard proposal argued against a remembered version of the current UI would
be a proposal about a system that does not exist. This task establishes the
baseline the other five tasks argue from: **what mos ships today** in its
management UI, and the mechanisms behind it — routes, templates, the auth gate,
the bus calls each page makes, and what is and is not reachable.

Measured from the tree, not recalled. It proposes nothing: no dashboard, no
routes, no technology. The one exception is Appendix A — three sentences of
opinion, explicitly fenced as such (`docs/research/mos-ui-inventory.md:9-10`).

## Deliverable

`docs/research/mos-ui-inventory.md` (638 lines). English only.

## Why this is the highest-value of the three research documents

The two Venus documents can be re-derived by anyone with a browser and the
public Venus repositories. This one cannot: it is a measurement of a moving
tree at a specific commit, and it is the only one of the three whose subject
will be edited out from under it. Every claim therefore carries a
`path/to/file.ext:line` reference verified against the tree, so a future reader
can tell drift from error.

## Consumers

`docs/design/dashboard.md` sections 1-4 (RFCT-043) are built directly on this
inventory — section 1 "Problem and current state"
(`docs/design/dashboard.md:61`) is where it lands. Sections 5-8 (RFCT-044,
RFCT-046) cite it for the baseline they cost their options against.
