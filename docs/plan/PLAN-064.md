# PLAN-064 Recreate the built-in UI from the approved prototype

- **status**: completed
- **createdAt**: 2026-09-02 03:32
- **approvedAt**: 2026-09-02 09:15
- **completedAt**: 2026-09-02 11:15
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
authenticated update state/actions and versioned UI bundle management. It does
not yet provide the application catalog/runtime, time, automatic-update policy,
storage, diagnostics/support, backup/restore, recovery, factory-reset or
browser-terminal contracts shown by the prototype. The prototype's fixture
data, simulated timers and older `.uipkg`, `/recover` and `/data` references are
therefore not valid production inputs.

The existing lint, typecheck and 18-test suite passes. Coverage is currently
41.70% by lines, below the PMA Web target. The committed built asset tree is
approximately 676 KiB before adding self-hosted fonts.

## Proposal

Recreate the complete prototype as the production built-in UI while preserving
the existing API and embedded-delivery boundaries. Visual parity applies to
every screen in the prototype. Capabilities with an implemented API use the
real typed transport. Capabilities without an implemented API use an explicit,
isolated simulation adapter and remain fully navigable and interactive. Every
page containing simulated state or actions displays a localized simulation
notice at the bottom of its content, immediately above the application status
footer, stating that the behavior is simulated and does not change the device.

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
  route-local interaction. Use Zustand only for simulated UI state that must be
  shared between routes; never mirror real API state into it.
- Define real and simulated feature adapters explicitly. A feature must not
  silently fall back from a failed real request to fixtures, and simulated
  adapters must not import or invoke the shared HTTP client.

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

### 3. Rebuild the complete product surface

- **Login and setup:** reproduce the centered authentication surface and keep
  the current auth/setup behavior and session handling.
- **Overview:** implement the attention list, metric cards and recent-task
  composition using only current health, metadata, state and task responses.
  Omit cards whose values cannot be derived from the API.
- **Network:** deliver the prototype's Interfaces, Wi-Fi and WireGuard tabs,
  detail panels and dialog workflows on the existing read/write contracts,
  including review/apply progress where the API exposes asynchronous tasks.
- **Services:** restyle and retain current container and MQTT settings. Hide the
  real browser-terminal transport until an authorization API exists, but ship
  the prototype terminal window and session interactions through the isolated
  simulation adapter.
- **Access:** reproduce password, API-token, SSH-key, session and transient-root
  workflows with Base UI dialogs and current security contracts.
- **Applications:** reproduce Installed, Catalog and Activity views plus the
  install, update, start/stop, uninstall and source-detail flows. Use the
  simulation adapter for the complete module until the native/container
  application management API and lifecycle work are delivered.
- **System:** use real APIs for General settings, device information, UI version
  management and supported power actions. Reproduce Time, Update and Recovery,
  Storage, Diagnostics and Support, backup/restore and factory-reset flows with
  simulated state and progress where no API exists.

Simulated state is deterministic, ephemeral and reset when the application is
reloaded. Simulated actions may update that in-memory state and show the same
progress, success and failure surfaces as the prototype, but they must never
issue a request, persist device data, invoke a real power/security operation or
claim that the underlying system changed. Mixed real/simulated System and
Services pages retain one bottom simulation notice for the page and identify
the simulated scope in its text.

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
- Cover every simulated route with tests proving that the bottom simulation
  notice is visible in both locales, state resets on reload, and representative
  actions never call the HTTP transport. Mixed pages must also prove that real
  controls continue to use their production APIs.
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
- Simulated controls can be mistaken for real device behavior. The mandatory
  bottom notice, explicit adapter boundary, ephemeral state and no-network
  tests reduce that risk; the implementation must not use silent fallback or
  persist simulated results.
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
English and Chinese resources; every route and workflow represented by the
prototype; real adapters for currently supported APIs; isolated, ephemeral
simulation adapters and bottom notices for every unsupported capability; unit,
accessibility, security, visual and critical-flow tests; generated route tree
and committed `dist`; focused APID embedding verification; and updates to the
built-in UI development guide and changelog that describe the delivered
implementation.

Out of scope: backend or OpenAPI changes; real application lifecycle, browser
terminal, time, automatic-update policy, storage, diagnostics, support, backup,
recovery or factory-reset effects; persistence of simulated state; other locales; a
user-selectable color-palette system; compatibility for pre-release UI layouts;
and modifying or embedding the supplied prototype bundle.

## Alternatives

1. **Hide every unsupported module.** This keeps the production UI entirely
   API-backed but prevents design and interaction review of planned functions;
   rejected by the clarified product requirement.
2. **Only reskin the current pages.** This is faster but leaves network write
   workflows and responsive interaction materially short of the approved
   prototype; rejected.
3. **Render unsupported modules as disabled static screens.** This avoids
   simulated state but cannot validate the prototype's dialogs, progress and
   multi-step flows; rejected.
4. **Copy the prototype's HTML/CSS/JavaScript runtime.** This is visually close
   but violates the PMA Web architecture, component, state, testing and
   security requirements; rejected.

## Annotations

- 2026-09-02: Created after inspecting the complete supplied prototype, current
  frontend source, embedded build contract, OpenAPI surface and baseline quality
  gates.
- 2026-09-02: Revised after the user required all unimplemented prototype
  functions to remain interactive with a simulation notice at the bottom of
  each affected page.
- 2026-09-02: User approved the revised complete-prototype implementation.
- 2026-09-02: Delivered the responsive horizontal console, all prototype
  routes, typed production adapters, isolated application/terminal/system
  simulations, bilingual light/dark appearances, and three committed visual
  baselines. The normal UI gate reports 95.62% statements, 86.60% branches,
  96.29% functions and 96.59% lines; 29 unit tests, 14 applicable Playwright
  checks, the reproducible package gate and focused APID VFS/namespace tests
  pass. The final embedded tree contains 34 files totaling 1,067,103 bytes
  raw and 501,172 bytes as per-file gzip streams; its generated Rust asset
  table is 5,926 bytes.
