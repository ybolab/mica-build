# PLAN-058 Add built-in UI localization and Spectrum themes

- **status**: completed
- **createdAt**: 2026-09-01 22:14
- **approvedAt**: 2026-09-01 22:40
- **relatedTask**: [UI-004](../task/UI-004.md)

## Context

The built-in UI is a React 19/Vite 8 single-page app under
`pkgs/mosd/apid/ui`. `main.tsx` currently composes only TanStack Query and the
router. Every operator-facing string in the root session gate, authentication,
shell, task progress, Overview, Network, Services, Access and System is
hard-coded in English. Date and uptime formatting also use implicit browser or
English-only presentation.

The color system is already centralized in `src/styles.css`: semantic tokens
have light values in `:root` and dark values inside a
`prefers-color-scheme: dark` media query. It follows the operating system but
has no light/dark override, provider, control or persistence. `index.html`
starts with `lang="en"` and a fixed dark `theme-color`.

The delivery boundary is stricter than a normal Vite app. APID embeds exactly
`dist/index.html`, `dist/assets/app.js` and `dist/assets/app.css`, and its CSP
allows only same-origin script/style. Locale JSON files or a runtime HTTP
backend would become unserved assets. Translations therefore need to be
compiled into the existing JavaScript bundle, with code splitting still off.

The existing tree contains user-owned, uncommitted changes that move the
transient root password into the SSH panel, add page spacing and regenerate the
two embedded assets. Localization must be applied on top of those edits rather
than replacing or separating them.

The current baseline passes lint, typecheck and all eight Vitest tests. Existing
total coverage is 24.51% lines, so this feature must add focused coverage for
preference behavior and translation completeness without claiming the whole
SPA has reached the 80% target.

The npm registry reports `i18next` 26.4.1 and `react-i18next` 17.0.13 as the
latest stable releases on 2026-09-01. Their declared React/TypeScript peer
ranges cover this project. No HTTP backend or component-library dependency is
needed.

The project already declares the shadcn `base-nova` style in `components.json`,
uses `@base-ui/react` 1.7.0 underneath its owned primitives, and uses Lucide for
icons. The user has now made that implementation boundary explicit and selected
Adobe Spectrum as the design system. Spectrum 2 therefore becomes the visual,
interaction, theme and accessibility reference, while shadcn/base-nova and Base
UI remain the only React component runtime. Mixing React Spectrum or Spectrum
Web Components into the same screens would create conflicting state, styling
and accessibility abstractions.

## Proposal

### UI system boundary and Spectrum mapping

- Keep all React controls in the shadcn `base-nova` + Base UI ecosystem. Audit
  the existing owned Button, Card, Field, Status and Switch primitives, and add
  the shadcn/base-nova Select primitive through the shadcn CLI for Language and
  Appearance. Do not introduce React Spectrum, Spectrum Web Components,
  Spectrum CSS or another component runtime.
- Use Spectrum 2 as the normative design layer: background layers, content
  hierarchy, action and focus treatment, semantic feedback, disabled states,
  spacing, radius, elevation and motion are mapped into the app's local
  semantic CSS variables. Components consume only those local tokens, keeping
  shadcn ownership and the three-file offline build intact.
- Replace chartreuse as the primary action/focus color with Spectrum's blue
  action hierarchy. Keep the existing mos chartreuse only as an optional,
  non-interactive brand marker; it must not encode action, focus, success or
  health. Success, notice/warning and danger remain separate semantic roles and
  always have text or icon support.
- Provide one touch-safe scale based on Spectrum's larger control treatment,
  with a 44 CSS-pixel minimum interactive target. Density switching is not
  added in this feature.
- Preserve system fonts for offline delivery because Adobe Clean is not a
  bundled/licensed project asset. Preserve Lucide as the configured shadcn icon
  set. The result is Spectrum-aligned rather than a claim that Adobe's React
  components, typeface or proprietary product chrome are embedded.
- Update the Chinese design and development guides so their color, component,
  light/dark and i18n guidance matches the shipped implementation instead of
  retaining the old chartreuse-primary/system-only theme rules.

### Localization runtime

- Add `i18next@26.4.1` and `react-i18next@17.0.13` as exact dependencies.
- Keep English and Simplified Chinese resources in typed TypeScript modules so
  both languages compile into `app.js` and key-shape drift fails typecheck.
- Initialize one i18n instance before render and mount `I18nextProvider` above
  Query, Theme and Router providers.
- Support only `en` and `zh-CN`. Resolve the first visit from a safely-read
  `mos.ui.locale` preference, then `navigator.languages`; normalize all
  Chinese variants to `zh-CN` and everything else to English.
- Persist an explicit selection in browser local storage and update the root
  `lang` attribute immediately. Do not read locale from query strings, cookies
  or server state.
- Localize all frontend-owned visible text, accessible names, confirmations,
  empty/error fallbacks, status labels, dates and uptime formatting across the
  shipped routes. Preserve identifiers and unknown device/backend values
  verbatim; backend-supplied error prose remains authoritative until the API
  carries stable localized error semantics.

The small two-source detector is kept in the app rather than adding
`i18next-browser-languagedetector`: the supported input surface is intentionally
only local storage and navigator, and avoiding query/cookie detection reduces
both bundle and untrusted-input surface.

### Theme runtime

- Add one ThemeProvider with `system`, `light` and `dark` modes; default to
  system and persist the choice as `mos.ui.theme`.
- Resolve and apply the initial theme synchronously before React renders, then
  listen to `prefers-color-scheme` changes only while mode is system.
- Apply `.light` or `.dark` to the document root, keep `color-scheme` and the
  theme-color meta value synchronized, and expose the selected mode through a
  typed hook. Do not duplicate it in Query or Zustand state.
- Refactor the existing semantic variables into explicit Spectrum-aligned
  light and `.dark` blocks while preserving the user's current structural and
  spacing changes. `system` maps browser light/dark to those same two themes;
  Spectrum's optional darkest theme is not added.

### Controls and provider composition

- Add a small Preferences control using labelled shadcn/base-nova Selects,
  backed by Base UI, for Language and Appearance. This adds an owned project
  primitive but no second component ecosystem.
- Show it on authentication/setup screens and in the authenticated shell so a
  user can recover from an unreadable language or theme without navigating to
  another page.
- Keep every target at least 44 CSS pixels and make the compact shell layout a
  second row when needed instead of hiding preferences.
- Move provider composition to `src/app/providers.tsx` with the order
  I18nextProvider -> QueryClientProvider -> ThemeProvider -> RouterProvider.

### Tests and delivery

1. Add failing tests first for locale normalization/resource parity and for
   persisted/system theme resolution.
2. Add component coverage proving selectors update language, root attributes,
   theme class and local storage.
3. Update existing route tests to use the production i18n provider while
   keeping their English behavioral assertions.
4. Run lint, typecheck, focused tests, the full suite, coverage and `run.sh`.
5. Regenerate and commit only the fixed `dist` assets, recording raw/gzip
   bundle deltas and confirming no extra output asset was created.

## Risks

- Translation breadth can leave a raw English string in an uncommon branch.
  Typed resources, a source-string audit and full-route review mitigate this.
- i18next and the Chinese catalog increase the embedded JavaScript size. The
  exact raw/gzip delta must be reported; no runtime locale asset is allowed.
- Applying an explicit stored theme after HTML parsing can flash. Synchronous
  initialization in the external bundled script minimizes this without
  violating the CSP with an inline bootstrap script.
- Spectrum is a design-system reference here, not an imported component
  implementation. A documented local token mapping and focused visual/state
  tests prevent the result from degrading into a superficial color swap while
  avoiding incompatible React runtimes.
- Replacing the current action accent materially changes contrast and visual
  emphasis. Every light/dark content, border, focus and semantic pair must be
  checked at WCAG AA, and statuses must remain understandable without color.
- Server-provided error text and unknown enum values may remain English. The UI
  must not discard more precise backend evidence merely to translate it.
- Browser-local preferences do not follow an administrator to another browser
  and are shared by sessions in the same browser profile. Device-wide storage
  would require a new settings contract and is out of scope.
- `access.tsx`, `styles.css` and `dist` overlap current user changes. All edits
  and verification must use the working versions as their base.

## Scope

In scope: provider composition, two typed inline locales, locale/theme
preference runtime, controls before and after authentication, migration of all
currently shipped UI strings, a shadcn/base-nova Select backed by Base UI,
Spectrum-aligned semantic light/dark CSS and component states, corresponding
Chinese design/development-guide updates, focused tests, dependencies/lockfile
and deterministic embedded assets.

Out of scope: backend/API localization, device-wide preference settings,
additional locales, translated raw JSON/logs, route or feature additions,
React Spectrum/Spectrum Web Components, Adobe font redistribution, a density
selector, Spectrum's darkest theme, replacing native confirmations, changing
the fixed embedded-asset contract, or modifying the user's unrelated Access
information architecture.

## Alternatives

1. **Hand-written dictionary/context only.** Smaller, but recreates fallback,
   interpolation and React subscription behavior; rejected in favor of the
   standard i18next core with inline resources.
2. **HTTP locale JSON plus language detector plugins.** Conventional for a web
   app, but incompatible with APID's three embedded assets and unnecessary for
   two bundled locales.
3. **Keep system-only theme selection.** This is the current behavior and does
   not satisfy explicit light/dark choice.
4. **Store preferences on the device.** Would synchronize browsers, but adds a
   public settings/API contract and changes the single-browser preference into
   device configuration; deferred.
5. **Mix React Spectrum or Spectrum Web Components with shadcn.** This would be
   closer to Adobe's packaged components but violates the requested
   shadcn/Base UI implementation boundary and duplicates primitive behavior;
   rejected in favor of a documented Spectrum-to-local-token mapping.
6. **Import legacy Spectrum CSS variables.** The Spectrum Web Components
   project marks the older variables as deprecated in favor of Spectrum Core,
   and a global package would weaken local component ownership; rejected.
7. **Change only the accent hex value.** Too shallow to constitute use of the
   design system; rejected because theme layers, states, focus, contrast,
   spacing and motion must move together.

## References

- [Spectrum design tokens](https://spectrum.adobe.com/page/design-tokens/)
- [Spectrum color fundamentals](https://spectrum.adobe.com/page/color-fundamentals/)
- [Spectrum theming](https://spectrum.adobe.com/page/theming/)
- [Spectrum inclusive design](https://spectrum.adobe.com/page/inclusive-design/)
- [Spectrum Web Components theme API](https://opensource.adobe.com/spectrum-web-components/tools/theme/api/)

## Annotations

- 2026-09-01: Created after the user requested implementation of i18n and
  light/dark themes in the built-in UI.
- 2026-09-01: Revised after the user required shadcn + Base UI implementation
  with Adobe Spectrum as the design system. The proposal now keeps one React
  component runtime, maps Spectrum 2 into local semantic tokens and makes the
  primary action/focus palette change explicit.
- 2026-09-01: User explicitly approved the revised proposal; implementation
  started at 22:40 UTC.
- 2026-09-01: Completed with typed inline English/Chinese resources,
  persisted language and system/light/dark preferences, Spectrum-aligned local
  tokens, shadcn/Base UI controls, synchronized Chinese guides, 17 passing
  tests and deterministic three-file APID assets. The task record contains
  coverage, contrast and bundle-size evidence.
