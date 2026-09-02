# PLAN-064 Recreate the built-in UI from the approved prototype

- **status**: draft
- **createdAt**: 2026-09-02 03:32
- **relatedTask**: [UI-008](../task/UI-008.md)

## Context

The supplied prototype under `docs/zh/design/mos-ui/` defines the approved
visual direction and interaction model for the built-in UI. Its defining
characteristics are a compact horizontal application shell, the Klein-derived
blue palette, Barlow typography, responsive mobile navigation, dense cards and
tables, light/dark modes, bilingual copy, explicit data states, and dialog-led
editing flows. It covers Overview, Network, Services, Applications, Access and
System areas, including several capabilities that are still product plans.

The production frontend already lives at `pkgs/mosd/apid/ui` and is embedded by
APID as a generated virtual asset tree at `/_ui/`. It already uses React 19,
Vite 8, TanStack Router, TanStack Query, Tailwind CSS 4, i18next and the shadcn
`base-nova` style backed by Base UI. The current vertical-sidebar presentation
and route composition differ materially from the prototype, however, and the
source layout predates the current PMA Web conventions.

The current OpenAPI contract supports authentication, setup, health and device
metadata, settings, tasks, network interfaces, Wi-Fi, WireGuard peers, service
settings, API tokens, SSH keys, sessions, transient root access, power actions,
and versioned UI bundle management. It does not yet provide the application
catalog/runtime, OS update, time, storage, diagnostics/support, backup/restore,
recovery, factory-reset or browser-terminal contracts shown by the prototype.
The prototype's fixture data, simulated timers and older `.uipkg`, `/recover`
and `/data` references are therefore not valid production inputs.

The existing lint, typecheck and 18-test suite passes. Coverage is currently
41.70% by lines, below the PMA Web target. The committed built asset tree is
approximately 676 KiB before adding self-hosted fonts.

## Proposal

Recreate the prototype as the production built-in UI while preserving the
existing API and embedded-delivery boundaries. Visual parity applies to every
screen that is shipped. Capabilities without an implemented API remain absent
from production navigation instead of appearing with sample data, disabled
actions or simulated success. Their complete interaction design remains in the
Chinese product-design guide and the supplied prototype until their backend
tasks are delivered.

### 1. Align the application foundation

- Keep the single React/Vite application, the `/_ui/` Vite base, the APID
  virtual asset tree and the committed `dist` delivery contract.
- Move file routes and the generated route tree under `src/app/routes` and
  `src/app/routeTree.gen.ts`. Keep route files declarative and place domain UI
  under `src/features/*`.
- Move reusable shadcn primitives to `src/shared/components/ui`, shared HTTP
  code to `src/shared/lib/http.ts`, and cross-feature hooks and utilities to
  the corresponding `src/shared/*` directories.
- Make application bootstrap fail explicitly when its root element is absent.
- Use TypeScript 7.0.2 for CLI typechecking while installing
  `@typescript/typescript6` 6.0.2 as the `typescript` compatibility package
  consumed by `typescript-eslint`, whose supported peer range remains below
  TypeScript 6.1. This follows the official side-by-side TypeScript 7 migration
  model instead of weakening or removing ESLint type support.
- Continue to use TanStack Query for server state and local React state for
  route-local interaction. Do not add Zustand unless implementation proves a
  genuinely shared UI-only state requirement.

### 2. Reproduce the approved visual system

- Replace the vertical sidebar with the prototype's sticky horizontal header,
  active navigation treatment, centered content canvas, persistent status
  footer and mobile Base UI sheet navigation.
- Encode the prototype's Klein light and dark appearances as semantic OKLCH
  tokens in `:root`, `.dark` and `@theme inline`. Component code must not carry
  literal palette values.
- Preserve the prototype's spacing, radii, borders, shadows, typography scale,
  compact information density, responsive breakpoints and 44-pixel minimum
  touch targets. Use Lucide icons at the prototype's 1.5-pixel stroke weight.
- Self-host Barlow and Barlow Condensed WOFF2 assets through the application
  bundle so the embedded UI remains compatible with its self-only CSP.
- Use Spectrum interaction semantics for hierarchy, focus, validation,
  destructive actions, overlays and system feedback while constructing all
  interactive controls from shadcn `base-nova` components backed by
  `@base-ui/react`. Add or update primitives with the shadcn CLI; do not add
  Radix UI or another component library.
- Retain only system, light and dark appearance choices. The prototype's design
  palette switcher is an authoring aid, not a new product preference.

### 3. Rebuild API-backed product areas

- **Login and setup:** reproduce the centered authentication surface and keep
  the current auth/setup behavior and session handling.
- **Overview:** implement the attention list, metric cards and recent-task
  composition using only current health, metadata, state and task responses.
  Omit cards whose values cannot be derived from the API.
- **Network:** deliver the prototype's Interfaces, Wi-Fi and WireGuard tabs,
  detail panels and dialog workflows on the existing read/write contracts,
  including review/apply progress where the API exposes asynchronous tasks.
- **Services:** restyle and retain current container and MQTT settings. Hide the
  browser-terminal control until a terminal transport and authorization API
  exists.
- **Access:** reproduce password, API-token, SSH-key, session and transient-root
  workflows with Base UI dialogs and current security contracts.
- **System:** reproduce the API-backed General, device information, UI version
  manager and power actions. Hide time, update/recovery, storage,
  diagnostics/support, backup/restore, factory reset and other unimplemented
  sections.
- **Applications:** omit the route and navigation item until the native/container
  application management API and lifecycle work are delivered.

Every query surface must distinguish initial loading, refetching/stale data,
empty results, actionable errors and offline state. Mutations must expose
pending state, field-level validation where applicable, success/failure
feedback and deliberate confirmation for destructive actions. Native browser
confirm dialogs and prototype-only timers are not permitted.

### 4. Preserve localization, accessibility and security

- Keep English and Simplified Chinese as complete first-class locales. Move all
  new visible text and accessible names into feature-scoped i18n resources and
  preserve the saved locale preference.
- Preserve system/light/dark preference behavior without a flash of the wrong
  theme. Both modes must retain readable contrast and visible keyboard focus.
- Use semantic landmarks, native interactive elements beneath Base UI,
  correctly associated labels and descriptions, focus restoration, Escape
  behavior and keyboard-complete dialogs, menus, tabs and mobile navigation.
- Keep the existing same-origin API client, CSP, authentication and
  credential-handling rules. Do not render untrusted strings as HTML or log
  secrets.

### 5. Verify behavior and visual fidelity

- Apply TDD to each migrated behavior: first capture the current API contract
  and expected prototype interaction in a failing test, then implement the
  smallest production path.
- Extend Vitest and Testing Library coverage across routes, queries, mutations,
  state surfaces, theme/locale persistence, keyboard behavior and security
  boundaries. Enforce at least 80% for statements, branches, functions and
  lines in the test configuration and normal UI quality gate.
- Add Playwright screenshot and critical-flow coverage for representative
  desktop, tablet and mobile viewports in light and dark modes. Store only
  production UI snapshots; do not execute or ship the prototype runtime.
- Run lint, TypeScript 7 typecheck, unit coverage, Playwright checks and the
  production build. Regenerate the committed `dist` tree and run the APID UI
  asset/package checks so the embedded result matches the source build.
- Measure the final `dist` and generated Rust asset size. Import only the font
  weights and glyph subsets needed by the two supported locales and keep route
  chunks lazy-loaded.

## Risks

- Pixel-level parity can regress across browsers and font rendering engines.
  Tokenized dimensions plus fixed Playwright environments reduce, but do not
  eliminate, platform differences.
- Hiding unsupported prototype modules produces a smaller production
  navigation than the complete design prototype. Showing them would imply
  capabilities the system does not provide; they should be enabled only with
  their future API work.
- TypeScript 7 no longer supplies the programmatic API expected by the current
  ESLint parser. The side-by-side TypeScript 6 compatibility dependency must be
  kept isolated from the TypeScript 7 CLI gate and verified in a clean install.
- Self-hosted fonts and visual snapshots increase repository and embedded
  binary size. Font subsetting, route chunking and an explicit size comparison
  are required before acceptance.
- Network mutations and power/security actions are higher-risk than the current
  mostly read-only UI. Tests must prove request payloads, pending guards,
  confirmation boundaries and error recovery before those controls ship.

## Scope

In scope: the production application under `pkgs/mosd/apid/ui`; its route and
shared-source layout; visual tokens, bundled fonts, shadcn/Base UI primitives,
English and Chinese resources; all currently API-backed routes and workflows;
unit, accessibility, security, visual and critical-flow tests; generated route
tree and committed `dist`; focused APID embedding verification; and updates to
the built-in UI development guide and changelog that describe the delivered
implementation.

Out of scope: backend or OpenAPI changes; application marketplace/runtime;
browser terminal; time, update, storage, diagnostics, support, backup, recovery
or factory-reset implementation; mock/demo product data; other locales; a
user-selectable color-palette system; compatibility for pre-release UI layouts;
and modifying or embedding the supplied prototype bundle.

## Alternatives

1. **Ship every prototype screen with fixtures or simulated operations.** This
   gives the largest visual surface immediately but presents false device state
   and cannot meet production error/security requirements; rejected.
2. **Only reskin the current pages.** This is faster but leaves network write
   workflows and responsive interaction materially short of the approved
   prototype; rejected.
3. **Wait for every planned backend feature.** This avoids temporarily hidden
   modules but blocks usable UI progress on unrelated roadmap work; rejected.
4. **Copy the prototype's HTML/CSS/JavaScript runtime.** This is visually close
   but violates the PMA Web architecture, component, state, testing and
   security requirements; rejected.

## Annotations

- 2026-09-02: Created after inspecting the complete supplied prototype, current
  frontend source, embedded build contract, OpenAPI surface and baseline quality
  gates.
