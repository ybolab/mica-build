# RFCT-043 Dashboard landing screen and information architecture

- **status**: completed — proposal complete, the design decision is the user's, and open
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 10:17
- **claimedAt**: 2026-08-19 11:45
- **completedAt**: 2026-08-19 12:40

Campaign `l1-o7ee8v0o-20260819101756-venus` (research/design-proposal, documents
only). Branch `bkd/786c88pu`, merged by L2 into `bkd/sqexk7je`.

## Description

The mos management UI today is a set of forms. This task proposes turning it
into a dashboard: a landing screen that answers "is this device healthy" before
the operator has to navigate anywhere, and an information architecture for
everything that is not the landing screen.

It proposes **no code, no route handlers, no markup, and no rendering or
live-update technology** (`docs/design/dashboard.md:9-12`). Where a proposal
only works under some technology choice, that is said in one line and the choice
is left open for RFCT-044.

## Deliverable

`docs/design/dashboard.md` **sections 1-4** — the file this task created, later
extended in place by RFCT-044 (section 5) and RFCT-046 (sections 6-8).

| section | line | subject |
| --- | --- | --- |
| 1 | `docs/design/dashboard.md:45` | Problem and current state |
| 2 | `:135` | The landing dashboard |
| 3 | `:525` | Information architecture for the rest |
| 4 | `:751` | Proposed but not yet possible |

## Section 4 is the load-bearing one

"Proposed but not yet possible" is the section that keeps this document honest.
A dashboard proposal that lists only what it can have is a wish list; this one
separates the tiles that can be built against today's `mosd` from the tiles that
need data `mosd` does not expose yet, and costs the gap explicitly. A future
implementer reading section 2 alone would build tiles that cannot be populated.

## Evidence base

Three research documents produced by the same campaign and merged before this
task started: `docs/research/venus-os-ui.md` (RFCT-040),
`docs/research/venus-os-access.md` (RFCT-041) and
`docs/research/mos-ui-inventory.md` (RFCT-042). The current-state claims come
from the inventory, not from reading the tree a second time; the borrowed
interaction patterns come from Venus and are attributed at each use.

## Licence fence

Venus OS gui-v2 is a **study reference only** — see RFCT-040. This task states
the fence in the document's own preamble (`docs/design/dashboard.md:30-36`)
rather than leaving it in the campaign record, because an implementer may reach
the design document first. Sections 5 and 6, added later, restate it again for
the same reason (`:853-860`, `:1601-1612`).

## Status of the decision

Proposal. The document proposes; it does not decide, and every claim of its own
is marked **[proposal]** and explicitly unsourced, because it does not exist yet
(`docs/design/dashboard.md:24-28`).

Sections 6 and 7, added later by RFCT-046, present process-architecture options
whose resolution can change what section 2 is able to build. Section 5 records
that explicitly: whether `webd` is renamed, whether it is merged into `mosd`,
and in what order any of this is delivered are all RFCT-046's, and where a
recommendation would be changed by that decision it is flagged in one line and
left open (`docs/design/dashboard.md:873-877`).
