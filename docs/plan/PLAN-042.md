# PLAN-042 Build the user documentation contract and official website content

- **status**: completed
- **completedAt**: 2026-09-01
- **createdAt**: 2026-09-01 13:18
- **approvedAt**: 2026-09-02
- **relatedTask**: [RFCT-278](../task/RFCT-278.md)

## Context

mos has detailed engineering records under `docs/design/`, but no customer
journey from obtaining an image through operation, update, recovery and support.
The repository also has no official-site content contract for product scope,
downloads, supported hardware, security or lifecycle. Fedora CoreOS is useful
for navigation patterns, but mos must lead with boards, factory/offline setup,
bounded flash, field recovery and long-lived BSP maintenance.

Documentation alone can close usability gaps. It cannot claim that missing
update, recovery, storage, time or security mechanisms already ship.

## Proposal

- **DOC:** create a versioned information architecture for quickstart,
  downloads, installation, first run, configuration, applications, update and
  rollback, recovery, storage, troubleshooting, security, release notes, API
  reference, BSP porting and support lifecycle.
- **DOC:** define official website copy and navigation for product overview,
  embedded differences, releases/downloads, supported hardware, documentation,
  security advisories, support and source/licensing notices.
- **DOC:** maintain English as the engineering source of truth and publish a
  tracked Chinese user-facing set with visible version and coverage status.
- **DOC/SW:** attach every shipped capability statement to a machine-readable
  release fact, tested command/example, board dossier or approved policy. Mark
  content as shipped, board-dependent, proposed or unsupported.
- **SW:** extend documentation verification with internal-link, navigation,
  command/example and English/Chinese coverage checks where practical.
- Keep architecture decisions and historical alternatives in design records;
  user guides present current supported behavior and link back for rationale.

Acceptance is a navigable, version-scoped documentation and website content
set whose claims can be audited. Rendering technology and public deployment can
be selected independently after the content/source contract is stable.

## Risks

- Publishing ahead of child-plan evidence can turn proposals into false product
  claims; status labels and evidence links are mandatory.
- Duplicating API or release facts by hand creates drift; generated/reference
  inputs should be consumed rather than copied.
- A translation can silently lag; each Chinese page needs source version and
  coverage metadata.

## Scope

In scope: information architecture, page briefs, official website copy,
truth-status rules, bilingual/versioning rules, navigation and documentation
quality gates. Out of scope: implementing the capabilities documented by
PLAN-043 through PLAN-054, selecting a hosted CMS, or deploying public
infrastructure.

## Alternatives

1. Publish `docs/design/` directly. Rejected because it mixes current behavior,
   proposals and implementation history.
2. Copy Fedora CoreOS navigation unchanged. Rejected because it omits the board,
   factory, offline and field-service lifecycle central to mos.
3. Wait until all software is complete. Rejected; the structure and honest gap
   pages can be prepared early while shipped claims remain gated.

## Annotations

- 2026-08-31: The user requested both user-delivery documents and official
  website content, adapted for embedded rather than generic CoreOS operation.
- 2026-09-01: Split from PLAN-037 as a documentation-only approval boundary.

## Completion

Completed 2026-09. Delivered by a BKD three-tier campaign
(`l1-6rjx4wrt-20260901180748`): the English user set and its contract, the
official-site content briefs, the Chinese user set with its coverage table, and
the quality gates that hold all three honest.

**What the tree holds now.** `docs/user/` is fifteen pages: the customer journey
from `quickstart.md` through download, install, first run, configuration,
applications, update/rollback, recovery, storage, troubleshooting, security,
release notes, API and support, plus `doc-contract.md`, which is the normative
record — audience, one-page-owns-one-stage information architecture, the
shipped / board-dependent / proposed / unsupported taxonomy with its evidence
rules, the versioning rule and the English/Chinese rule. `docs/website/` is nine
page briefs under a content contract. `docs/zh/user/` is fifteen Chinese pages,
one per English page, indexed by `docs/zh/README.md` alongside a 32-row coverage
table — one row per English page in `docs/user/`, `docs/website/` and
`docs/bsp/`, carrying the source page, the source commit it was translated from,
and a status of `current`, `lagging` or `not-translated`.

**The gate is `make docs-verify` and `make docs-verify-test`.** Four verifiers
carry this plan's claims: `docs/verify-index.sh` (navigation — every document
indexed, every index entry a document, in both directions), `docs/verify-links.sh`
(every relative link under `docs/`, the zh tree included, resolves),
`docs/verify-status.sh` (every `> status:` line parses against the contract's
grammar and cites evidence that exists) and `docs/zh/verify-coverage.sh` (the
coverage table and the two trees agree, in both directions, and a table with no
rows fails rather than passing vacuously). At this head they report 147, 363,
561 and 208 assertions. Each has a negative-test sibling that drives every one
of its clauses red on a fixture where that clause's fact is false; the four
suites are 34 cases, and the positive control in each proves the fixture green
before any mutation is trusted to be what turned it red.

**What remains open, stated as openly as the pages state their own gaps:**

- **Website deployment is out of scope by this plan's own scope section.** The
  briefs are a content and source contract; rendering technology and public
  infrastructure were deliberately deferred.
- **Twenty-two `TODO(PLAN-0xx)` markers await sibling plans** — 043, 044, 046,
  047, 048, 049, 051, 052 and 053. Each marks a section labelled `proposed`
  against an approved plan that has not merged; the sweep belongs to the plan
  that closes the gap, not to this one.
- **Five markers now name plans that have closed** — `TODO(PLAN-042)` in
  `docs/user/doc-contract.md` and `TODO(PLAN-050)` in `docs/user/support.md`,
  `docs/website/embedded.md`, `docs/website/hardware.md` and
  `docs/website/support.md`. They are due for a sweep, but not a mechanical
  one: `doc-contract.md` section 5 can now be relabelled `shipped` against the
  zh tree and its check, while the PLAN-050 sections rest on hardware evidence
  that is still `not tested`, so relabelling those would overclaim. Each needs
  the judgement of whoever owns the section.
- **Command and example execution is partial.** `make os-quadlet-doc-test`
  feeds every example in the containers guide through the shipped generator, so
  a broken example fails the build. The command blocks in the user pages are
  verified against the `Makefile` and the scripts they name by review, not by a
  gate that executes them.
- **The Chinese pages carry the English status lines verbatim, but no gate
  diffs them.** `docs/verify-status.sh` scans the three English trees; the
  coverage check asserts the table-to-tree correspondence, not per-line
  agreement between a page and its translation. A zh status line edited out of
  step with its source would not be caught today.
