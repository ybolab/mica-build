# RFCT-040 Venus OS web UI and information architecture study

- **status**: completed — research complete, reference document, no code
- **priority**: P2
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-19 10:17
- **claimedAt**: 2026-08-19 10:20
- **completedAt**: 2026-08-19 11:40

Campaign `l1-o7ee8v0o-20260819101756-venus` (research/design-proposal, documents
only). Branch `bkd/jroc69qp`, merged by L2 into `bkd/sqexk7je`.

## Description

mos already borrowed Venus OS's settings-tree model
(`docs/design/mosd.md:18`, `docs/design/mosd.md:47`) but had never studied the
layer above it. Venus OS is the closest shipping analogue to mos: an appliance
Linux with a central settings bus, a local browser UI and a remote console. This
task studies that UI layer — gui-v2 — as a reference, so that the dashboard
proposal (RFCT-043, RFCT-044) argues from a measured example rather than from
taste.

The task deliberately produces **description, not proposal**. The sibling that
owns the proposal cites this file.

## Deliverable

`docs/research/venus-os-ui.md` (901 lines).

Covers: what gui-v2 is as an artefact and its relationship to the on-screen
display; how the UI is served on the LAN and reached remotely; the information
architecture — landing screen, top-level navigation, settings nesting and
navigation depth.

## Companion document

`docs/research/venus-os-access.md` (RFCT-041) is the other half of the same
study. The two were originally specified to be folded into one file; that fold
was measured and dropped. See RFCT-045 for the decision and its evidence. Each
file now carries a one-line pointer to the other near the top.

## The licence fence

The single constraint that governs every downstream use of this document:
gui-v2 ships under "Victron Energy OS license v1", which states *"USE OF THE
SOFTWARE AND ITS MODIFICATIONS WITH SYSTEMS WHOSE CORE IS NOT VICTRON ENERGY
PRODUCTS IS EXPRESSLY NOT AUTHORIZED"* (`gui-v2/LICENSE.txt:18-23`, quoted and
verified at `docs/research/venus-os-ui.md:77-83`, section 1.5).

mos is not a Victron product. **No gui-v2 code, markup, asset name or verbatim
string may be copied into mos.** Only ideas and interaction patterns may be
learned from, and every borrowing must be attributed. The fence is restated at
`docs/design/dashboard.md:864-871` and `:1601-1612` rather than left to a
sibling section, because an implementer may reach the design document first.
Both restatements say plainly that they did not re-verify the licence file; this
document did.

## Sourcing discipline

Every claim about Venus carries a URL or a `repo/path/file.ext` reference to a
public repository actually read, at a commit pinned in the document's section
1.3. Claims that could not be verified are under an explicit gaps heading rather
than presented as fact.

## Consumers

`docs/design/dashboard.md` cites this file 37 times.
