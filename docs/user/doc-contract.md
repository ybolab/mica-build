# The mos user documentation contract

This page is the contract behind everything under `docs/user/`: who these
pages are for, what each page owns, how a claim about the product is labelled
and evidenced, how the set is versioned, and how the English and Chinese trees
relate. Pages in this set follow this contract; a page that cannot is a defect
in the page, not a licence to relax the contract.

## 1. Audience

mos is an embedded appliance operating system. The user documentation serves
three readers, in this order:

1. **Device operators** — the person in front of a fielded appliance:
   installing, configuring, updating, recovering, and deciding what to tell
   support.
2. **Product integrators** — the team building a product on mos: composing
   images, delivering applications, selecting and qualifying boards.
3. **Support engineers** — the person a failure report reaches, who needs the
   device's identity and the honest boundary between shipped behaviour and
   roadmap.

The engineering design record stays in [`docs/design/`](../README.md) and
[`docs/architecture.md`](../architecture.md). User pages state current
supported behaviour and link back to the design record for rationale; they do
not restate design history, and design rationale is not duplicated here.

## 2. Information architecture

The customer journey runs from release selection through installation,
operation, applications, update, recovery, troubleshooting and support. One
page owns each stage; a fact appears on the page that owns it and is linked
from everywhere else.

| Page | Owns |
|---|---|
| [quickstart.md](quickstart.md) | the shortest honest path to a running mos system |
| [download.md](download.md) | release selection and obtaining an image |
| [install.md](install.md) | writing an image to a board and reaching first boot |
| [first-run.md](first-run.md) | first boot, the offline provisioning document, and claiming the device |
| [manufacturing.md](manufacturing.md) | putting mos on units at volume: identity and credential ownership, factory records, quarantine |
| [configuration.md](configuration.md) | the configuration model and every supported way to change settings |
| [applications.md](applications.md) | delivering and running applications: native packages and containers |
| [update-rollback.md](update-rollback.md) | the A/B update path, health confirmation and rollback |
| [recovery.md](recovery.md) | what to do when a device does not boot, and what recovery costs |
| [storage.md](storage.md) | the storage tiers, what survives what, and where data belongs |
| [troubleshooting.md](troubleshooting.md) | diagnosis: access channels, evidence to read, refusals to interpret |
| [security.md](security.md) | the security posture: what is protected, by what, and the named gaps |
| [release-notes.md](release-notes.md) | how releases are identified and where release facts come from |
| [api.md](api.md) | the programmatic surface and its machine-readable contract |
| [support.md](support.md) | support tiers, lifecycle ownership, and what a support case needs |

Website content briefs live under `docs/website/` and the BSP porting and
qualification set under `docs/bsp/`; user pages link into both where the
journey crosses them (hardware selection, downloads, support tiers).

## 3. Truth-status taxonomy — normative

Every capability claim in this documentation set carries a status. This is the
core of the contract: documentation alone can close usability gaps, and it must
never claim that missing mechanisms already ship.

The four statuses:

- **shipped** — the capability exists in this repository and is exercised by
  the build or its checks. Claiming it requires evidence that exists.
- **board-dependent** — the capability ships for at least one board and its
  presence or shape is a board fact (declared in `boards/<board>/` or by a
  board's BSP).
- **proposed** — the capability is planned and recorded in an approved or
  draft plan under `docs/plan/`, and does not ship. Describing a proposed
  contract is allowed; presenting it as current behaviour is not.
- **unsupported** — the capability does not exist and is not currently
  planned, or is explicitly outside the product contract.

### The grammar

A status line is a Markdown blockquote of exactly this shape — statuses as
above, the separator an em dash with spaces, each evidence reference in
backticks, multiple references separated by `, `:

```
> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`
> status: board-dependent — evidence: `boards/cx3576/board.env`
> status: proposed — evidence: `docs/plan/PLAN-052.md`
> status: unsupported
```

### Evidence rules

- `shipped` and `board-dependent` must cite an existing repository path (a
  file or a directory) or a `make <target>` that exists in the top-level
  `Makefile`.
- `proposed` must cite an existing `docs/plan/PLAN-0xx.md`.
- `unsupported` carries no evidence; the absence is the claim.
- Evidence is verified to exist before it is cited. A dead evidence reference
  is a broken claim, not a cosmetic defect.
- No `path:line` citations anywhere in this set. A document coupled to line
  numbers is falsified by edits that leave its meaning intact. Where a precise
  contract is needed, the artifact that carries it is named instead — for
  example, the HTTP surface is `pkgs/mosd/apid/openapi.json`.

### Proposed content and TODO markers

Where a page describes a capability a plan is still building, it states the
planned contract, labels it `proposed` with the plan as evidence, and marks the
section with a single line of the form `TODO(PLAN-0xx): revisit after this plan
merges`, so the section is swept and relabelled when the plan lands. At most
one such marker per section.

## 4. Versioning

The user documentation set is versioned with the mos release it ships in.
A page describes the release it is checked out with; there is no separate
documentation version number, and no page describes a newer or older release
than the tree that contains it. Statements tied to a specific board or profile
say so.

> status: shipped — evidence: `docs/user/`

## 5. English and Chinese

English under `docs/user/` is authoritative. A tracked Chinese user-facing set
lives under `docs/zh/`, indexed by `docs/zh/README.md` with a per-page
coverage table carrying, for every page in this set: the source page, the
source version it was translated from, and a status that is one of `current`,
`lagging` or `not-translated`. On any conflict the English page wins.

The Chinese set exists under `docs/zh/`, and the check that holds the coverage
table honest is `docs/zh/verify-coverage.sh`, run by `make docs-verify`: it
asserts the table against both trees in both directions, and requires a
`current` page to carry the same status lines, in the same order, as its
English source.

> status: shipped — evidence: `docs/zh/README.md`, `docs/zh/verify-coverage.sh`

## 6. Style rules

- Every page starts with an H1. Internal links are relative.
- Sober prose; no marketing register. A limitation is stated in the sentence
  that would otherwise overclaim, not in a footnote.
- Commands shown are the real ones, verified against the `Makefile` and the
  scripts they name.
- User pages do not narrate implementation. The design record owns the why;
  these pages own what an operator or integrator can do today.
