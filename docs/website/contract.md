# Mica OS official website — content contract

This document is the contract for the Mica OS official website: which pages exist,
what each may say, and the rules that keep the site honest. It defines content
and truth rules only. Rendering technology, CMS selection, hosting and public
deployment are explicitly out of scope and are decided separately after this
contract is stable.

## Purpose and audience

The website exists to let a visitor answer four questions without reading the
engineering record: what Mica OS is, whether their board can run it, how to obtain
and verify a release, and what support they can expect. The primary audience is
the **product integrator** — an engineering team selecting an embedded OS for a
board they own and a product they ship. Secondary audiences are field/support
engineers following a link from a support case, and security reviewers auditing
the update and signing posture. The website is not aimed at desktop end users
and never pretends Mica OS is a general-purpose distribution.

## Site navigation map

Pages appear in this order in the primary navigation. Each page has a brief in
this directory; the brief carries the page's purpose, audience, navigation
position, content outline and draft copy.

| # | Page | Brief | Role |
|---|------|-------|------|
| 1 | Product | [product.md](product.md) | What Mica OS is, who it is for, what it is not |
| 2 | Embedded differences | [embedded.md](embedded.md) | Why Mica OS is not a server/cloud CoreOS |
| 3 | Downloads | [downloads.md](downloads.md) | Release and per-board image selection, verification facts |
| 4 | Supported hardware | [hardware.md](hardware.md) | Board support taxonomy and per-board evidence |
| 5 | Documentation | [documentation.md](documentation.md) | Portal into the user documentation set |
| 6 | Security | [security.md](security.md) | Trust chain posture and advisories |
| 7 | Support | [support.md](support.md) | Lifecycle, tiers, where to get help |
| 8 | Source & licensing | [licensing.md](licensing.md) | License facts and source availability |

Cross-linking rules:

- Every page links into the user documentation set under `docs/user/` for the
  operational detail it summarises; the site never restates a procedure that a
  `docs/user/` page owns.
- The downloads page links to supported hardware (compatibility) and security
  (verification); supported hardware links to the BSP porting entry point
  ([../boards/porting.md](../boards/porting.md)); security links to support for the
  advisory contact.
- Footer links on every page: documentation, security, support, licensing.

## The truth rule

Every capability claim on the website traces to a status-labelled statement in
these briefs. A claim carries exactly one status from this closed set:

- **shipped** — the capability exists in the released system, and the status
  line cites an existing repository path or a `make` target that proves it.
- **board-dependent** — the capability exists but only on specific boards or
  with specific hardware; the status line cites the repository evidence and the
  page names the boards.
- **proposed** — the capability is planned and not delivered; the status line
  cites the plan record (`docs/plan/PLAN-0xx.md`). Proposed work is always
  rendered as forward-looking ("planned", "designed") and **never** in the
  present tense of an existing feature.
- **unsupported** — Mica OS does not provide this and does not currently plan to;
  no evidence is cited because there is nothing to cite.

The status line is a Markdown blockquote of this exact shape (em dash with
spaces as the separator, evidence references in backticks, multiple references
separated by comma and space):

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`

**Marketing language must never outrun the evidence.** The site may never
claim more than the documentation; where the documentation records a gap, the
site either says the same thing or says nothing. A superlative with no
evidence target is a defect, not a style choice. When a proposed capability
ships, its status line changes to `shipped` with real evidence in the same
change that publishes the claim — never before.

## The update cadence rule

Site facts **regenerate from release facts; they are never hand-copied.**
Release identity, artifact names, digests and per-board compatibility come from
the machine-readable release manifest each release directory carries, and
per-board evidence from the board dossiers, so a new release updates the site by
regeneration rather than by editing prose.

> status: shipped — evidence: `docs/design/release-artifacts.md`, `docs/boards/qualification.md`

Support windows are the exception, and it is a rule rather than a delay:
nothing binds a window to a release, so there is no release fact to regenerate
from and the site prints none.

> status: unsupported

Until that manifest ships, the downloads page carries no concrete release list
(see [downloads.md](downloads.md)) — an empty honest page beats a hand-typed
stale one. Prose that does not encode release facts (the product story, the
embedded rationale) changes only through this contract's briefs, in the
repository, under review.

## Out of scope

- Selecting or operating a CMS.
- Hosting, DNS, CDN and deployment infrastructure.
- Rendering technology (static site generator, styling, templates).
- Analytics, search and any interactive service behind the site.
- Implementing any capability the briefs label `proposed`.
