# PLAN-055 Define the built-in UI development guide

- **status**: completed
- **createdAt**: 2026-09-01 21:24
- **approvedAt**: 2026-09-01 21:24
- **relatedTask**: [UI-001](../task/UI-001.md)

## Context

mos already ships a built-in React/Vite SPA from `mos-apid`. It handles setup,
login, overview, network observation, service switches, API tokens, SSH access,
password changes, custom UI selection and power actions. The current API is
broader than the current screens: typed network, Wi-Fi known-network and
WireGuard mutations are available but do not yet have product UI flows.

The roadmap then describes time, installation, authenticated updates,
recovery, storage, diagnostics, security lifecycle and conditional fleet
management. PLAN-042 through PLAN-054 are still drafts. Several older design
documents also preserve historical proposals that no longer match the working
code. A UI handoff therefore needs an explicit evidence order and capability
status vocabulary so designers do not bind mockups to missing APIs or mistake
draft plans for commitments.

`docs/research/venus-gui-v2.md` is useful as comparative product research. Its
portable lessons include one local/remote information model, visible
connection freshness, configured-versus-observed status, quick controls,
consistent settings rows and screen-class adaptation. Its energy-domain
information architecture, code, assets and product copy are not inputs to mos.

The built-in delivery mechanism also imposes hard constraints: all product
operations go through the same-origin management API, the SPA is served under
`/ui/`, CSP permits only self-hosted runtime assets, and the Rust asset bundle
expects fixed output filenames. The UI must continue working remotely and in a
future local kiosk without direct process, systemd or filesystem access.

## Proposal

Create a self-contained Chinese UI development guide with these sections:

1. purpose, audience, evidence order, maturity legend and non-goals;
2. shipped architecture, security boundaries, repository layout and build
   contract;
3. a recommended information architecture that retains the current five
   primary destinations -- Overview, Network, Services, Access and System --
   while adding nested routes as capabilities become real;
4. screen specifications for setup, login, the five shipped sections, and
   API-ready Network/Wi-Fi/WireGuard management;
5. explicitly future, feature-gated specifications for System Information,
   Time, Update, Storage, Diagnostics and Recovery, with conditional fleet
   management excluded from the local UI until its product decision exists;
6. an endpoint-to-screen binding matrix, including authentication, CSRF,
   task polling, secret-redaction and error-state requirements;
7. a component and interaction vocabulary covering configured/applied/observed
   state, freshness, task progress, destructive confirmation, loading, empty,
   degraded, offline and unsupported states;
8. responsive, touch/kiosk, keyboard, accessibility, localization and copy
   rules grounded in the current visual system;
9. testing, asset-budget, CSP, fixed-bundle and CI acceptance criteria; and
10. staged delivery slices and a traceability appendix mapping future screens
    to their owning draft plans.

The recommended route shape keeps navigation stable:

- `/ui/` (Overview)
- `/ui/network`, with interface, Wi-Fi and WireGuard child views
- `/ui/services`
- `/ui/access`
- `/ui/system`, with general, information, time, update, storage, diagnostics
  and recovery child views introduced only when their contracts are available

Every feature will carry one of four visible maturity labels in the guide:
`shipped UI`, `API-ready`, `draft plan`, or `conditional/out of scope`. Draft
screens define future layout and state requirements, but the running product
will hide them until capability discovery says they are available. Failure is
rendered as failure; it is never mistaken for capability absence.

The guide will use the current UI's tokens and component vocabulary as its
design-system baseline. It will document improvements such as 44 px minimum
touch targets and removal of raw JSON from normal operator paths without
silently imposing a framework or design-system migration.

## Risks

- A combined current/future guide can accidentally imply that draft roadmap
  work is committed. Maturity labels and plan traceability must appear on every
  future screen specification, not only in an introduction.
- Historical prose conflicts with current code and generated OpenAPI. The
  guide must state and apply an evidence order: implementation/OpenAPI,
  current-status notes, roadmap plans, then comparative research.
- HTML and Markdown copies may drift if both become hand-maintained sources.
  If both formats are selected, one must be declared canonical and the other a
  handoff rendering.
- Designing controls before typed backend contracts exist encourages unsafe
  generic settings writes. Future screens must specify required contracts and
  remain gated.
- The current test suite verifies only a small portion of the SPA. Acceptance
  criteria must require state- and workflow-level coverage for each new slice.

## Scope

In scope: the self-contained guide, one recommended information architecture,
screen and state contracts, API mapping, component conventions, responsive and
accessibility rules, and staged implementation guidance.

Out of scope for this task: modifying production UI behavior, adding backend
endpoints, approving PLAN-042 through PLAN-054, copying Venus implementation
material, inventing unavailable telemetry, building a fleet console, or
redesigning the repository's frontend stack.

## Alternatives

1. Document only the shipped screens. Rejected because it cannot coordinate
   the requested built-in UI roadmap or prevent incompatible future layouts.
2. Turn every roadmap item into a visible disabled menu entry. Rejected because
   it advertises unavailable functions and creates a misleading product state.
3. Replace the current five-section shell with a new maintenance-first
   navigation immediately. Not recommended because nested System and Network
   routes provide room for planned work without unnecessary navigation churn.
4. Treat Venus as a visual template. Rejected because mos has different
   domains, contracts and licensing boundaries; only abstract interaction
   findings are reusable.

## Annotations

- 2026-09-01: Investigation completed against the working SPA, embedded asset
  serving, generated OpenAPI, settings schema, relevant design documentation
  and draft PLAN-042 through PLAN-054.
- 2026-09-01: Current frontend lint, typecheck and tests pass. Coverage is
  22.59% statements, 21.82% branches, 16.52% functions and 24.51% lines.
- 2026-09-01: User approved the recommended deliverable: canonical Chinese
  Markdown plus a standalone printable HTML handoff, a single recommended
  information architecture and an English/Simplified-Chinese-ready copy model.
- 2026-09-01: Delivered the canonical guide at
  `docs/zh/design/built-in-ui-development-guide.md`. An offline HTML handoff
  was produced at that time and later removed by the user's Markdown-only
  direction.
- 2026-09-01: Verified every generated OpenAPI method/path has an entry in the
  guide, the standalone DOM contains 20 linked chapters and no external
  resource, the documentation index gate passes 51/51, and the full apid UI
  delivery gate passes with 8 tests.
- 2026-09-01: HTTP preview returned 200 through nsl. Screenshot verification
  could not run because the installed Chromium and Firefox binaries lack host
  GTK/ATK/X11 shared libraries; static DOM, component syntax and offline
  dependency verification passed instead.
- 2026-09-01: Implementation and verification completed.
- 2026-09-01: A later user direction removed the untracked standalone HTML
  handoff and made Markdown the only design-delivery format. The canonical
  developer guide remains; PLAN-057 owns the separate designer-facing guide.
