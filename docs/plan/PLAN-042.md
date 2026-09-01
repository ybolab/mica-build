# PLAN-042 Build the user documentation contract and official website content

- **status**: implementing
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
