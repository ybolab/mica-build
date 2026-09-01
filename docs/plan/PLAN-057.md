# PLAN-057 Define the built-in UI product-design guide

- **status**: completed
- **createdAt**: 2026-09-01 21:48
- **approvedAt**: 2026-09-01 21:48
- **relatedTask**: [UI-003](../task/UI-003.md)

## Context

The existing built-in UI development guide is an implementation handoff. It
mixes capability maturity with API, frontend, security and delivery detail.
Designers need a separate source that describes product intent, workflows and
screen states across the complete roadmap, including functions that should be
prototyped before their backend exists.

The user also replaced the previous HTML/prototype delivery with a strict
Markdown-only output and requested removal of the repository `designs/` tree.

## Proposal

Create one Chinese design guide at
`docs/zh/design/built-in-ui-design.md`. It will:

1. define the intended six-area local information architecture;
2. use maturity markers for shipped, API-ready, planned and reserved concepts;
3. inventory setup, overview, network, services, applications, access, system,
   update, storage, diagnostics, recovery, local display and conditional fleet;
4. specify the objective, content, primary actions, exceptional states and
   dangerous decisions for each screen;
5. define cross-screen models for configured/applied/observed state, freshness,
   tasks, secrets, confirmation and offline/degraded behavior;
6. give designers explicit prototype journeys and annotation rules; and
7. explain that developers expose only capabilities available on the target
   device and hide the rest without altering the approved design structure.

The guide will reuse the current mos visual language and the applicable
interaction findings from the Venus study without copying its domain or
assets. It will avoid method/path tables, repository structure, component code
and build instructions.

## Risks

- A future-complete design can look shipped. Maturity must be repeated where
  the feature is encountered, not confined to the introduction.
- Planned navigation may be implemented as disabled clutter. The handoff must
  require capability gating and preserve route ownership without showing
  unavailable entries.
- Comprehensive feature coverage can produce a generic control panel. Page
  briefs must lead with operator goals and workflows.

## Scope

In scope: the single Chinese Markdown design guide, its documentation index
entry, and removal of former HTML design artifacts.

Out of scope: production UI/backend changes, a new design-system package,
standalone HTML/PDF, interactive prototype files and public marketplace
implementation.

## Alternatives

1. Keep a combined designer/developer guide. Rejected because the readers and
   decisions are materially different.
2. Use HTML as the canonical artifact. Superseded by direct user instruction.
3. Design only current features. Rejected because the user explicitly wants
   planned interactions and prototypes before implementation.

## Annotations

- 2026-09-01: User approved this scope directly and requested one Chinese
  Markdown document at the design-guide path.
- 2026-09-01: Delivered the 23-chapter Markdown design guide, removed the
  untracked `designs/` tree through a recoverable move, and verified the
  documentation index 54/54 plus whitespace integrity.
