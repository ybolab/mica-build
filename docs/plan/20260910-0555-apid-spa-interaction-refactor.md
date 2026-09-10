# 20260910-0555-apid-spa-interaction-refactor Repair and refactor apid console interaction

- **status**: completed
- **createdAt**: 2026-09-10 05:55
- **approvedAt**: 2026-09-10 06:20
- **relatedTask**: 20260910-0555-apid-spa-interaction-refactor

## Context

The console under `pkgs/mosd/apid/ui/` is a React 19 + Vite 8 SPA served by apid
over HTTPS at `/_ui/`. It has 27 unit-test files, an 11-case Playwright suite,
and `lint`, `typecheck` and `test` all pass on the current tree. The defects
below are therefore not build failures; they are behaviours no gate looks at.

Findings come from reading every source file, from a Vitest probe, and from a
Playwright run against `bun run dev:bare` with the e2e mock API, driven from a
sibling `mcr.microsoft.com/playwright:v1.62.1-noble` container. Measured values
are marked as such. Registry facts come from `shadcn@4.19.1 view @shadcn/<name>`
against the `base-nova` style this project already declares.

### A. Confirming a destructive action does not close its dialog

Measured twice. A Vitest probe on `ResetPanel` found the `alertdialog` role still
in the document after a successful stage. A browser probe on the token table
found the dialog still painted, the row still listed, and no outcome shown; the
operator's only exit is Escape or Cancel, and a second press re-issues the
request.

Eleven confirm dialogs across eight files behave this way — token revoke, SSH key
removal, transient root password, close-token-reveal, application removal,
snapshot deletion, Wi-Fi network removal, WireGuard peer removal, WireGuard key
rotation, reset staging, rollback and UI-bundle deletion.

**The primitive is not at fault.** `src/shared/components/ui/alert-dialog.tsx`
diffs against the upstream `base-nova` registry item with only the substitutions
the CLI itself makes — import path, `IconPlaceholder` → lucide, the dropped
`"use client"` and `cn-font-heading`. Upstream's `AlertDialogAction` is
deliberately a bare `Button` rather than an `AlertDialogPrimitive.Close`, because
an async confirm often has to stay open while it is pending; supplying the close
is the caller's job. The same holds for `dialog.tsx`, `button.tsx`, `table.tsx`
and `tabs.tsx`, all of which match upstream.

So this is eleven call sites each re-deriving the same interaction, and ten of
them getting it wrong. `PowerAction` in `system-page.tsx` is the only one that
works, via a hand-rolled `setOpen(false)`. Patching the registry file would fix
the symptom and put the project permanently at odds with `shadcn add`; the fix
belongs in a shared composite that every call site uses instead.

### B. There is no global feedback channel

The tree contains no toast. Outcomes are reported by 94 hand-placed inline
paragraphs carrying `className="callout …"` — 52 error, 25 warning, 8 success —
and the placement is inconsistent.

- Most writes report nothing at all on success. Measured: on the update tab,
  pressing **Save policy** against a 200 response leaves the DOM unchanged, so a
  saved policy and a dropped click look identical. The same holds for save
  source, save windows, the built-in/custom UI switch, bundle activate and
  deactivate, service enable/disable, Wi-Fi and WireGuard add and remove, token
  revoke and SSH key add and remove.
- Errors from several mutations are folded into one panel-level callout —
  `tokens.error ?? mint.error ?? revoke.error` on the access page, five sources
  on the SSH panel, four on the UI manager. The reader cannot tell which action
  failed, and because TanStack Query keeps a mutation's error until the next
  `mutate`, the callout stays on screen after the operator has moved on.
- Feedback for an action taken inside a dialog is rendered outside it, at the
  bottom of the page, where a modal was covering it.

The registry answers this directly: `@shadcn/toast` in `base-nova` wraps
`@base-ui/react/toast` — a toast manager, `Toaster`, typed
success/info/warning/error/loading, stacking, swipe dismiss and a live region.
Its only npm dependency is `@base-ui/react`, already installed. **No new
dependency is needed for the toast.**

### C. Dialog geometry is wrong on short viewports and self-contradictory

`styles.css` sets `[data-slot="dialog-content"], [data-slot="alert-dialog-content"]`
to `width: min(520px, 100%)` with `padding: 24px`. It sets no `max-height` and no
internal scrolling; only the `max-width: 580px` media query adds
`max-height: 92vh; overflow-y: auto`.

Measured at 1024x520 with the add-interface dialog in static mode: content top
`-36.8px`, bottom `556.8px` against a `520px` viewport, `overflow-y: visible`,
`max-height: none`, `scrollHeight === clientHeight`. The title is clipped off the
top, both footer buttons are clipped off the bottom, and nothing scrolls. A
1024x600 panel is a normal appliance display.

Three sizing systems disagree inside the same element: the component's Tailwind
`sm:max-w-sm`, the stylesheet's `min(520px, 100%)`, and `AlertDialogContent`'s
`size` prop (`max-w-xs`, dead — no call site passes it and the stylesheet wins).
`AlertDialogFooter`'s `-mx-4 -mb-4` cancels a `p-4` the stylesheet has replaced
with `24px`, so the footer band no longer reaches the popup edge.

The install wizard passes `showCloseButton={false}` and offers no Cancel on steps
0–2, so it has no visible way out; `.wizard-body { min-height: 200px }` leaves a
large empty block under one line of content.

### D. Two overlays open at once

`LanguageControl` renders its `Dialog` inside `DropdownMenuContent`. Measured:
opening the language picker from the header leaves the settings menu open and
painted above the dialog backdrop, unblurred, with two focus scopes competing.

The menu's rows are raw `<button className="menu-item">` rather than
`DropdownMenuItem`, so the menu has no roving focus, no typeahead, and does not
close when a row is activated — sign-out has the same problem.

### E. The project is off the `/pma-web` UI Library Policy

This is the structural finding, and A–D are its symptoms. The policy's
*Component sourcing order* is: existing project component → shadcn registry →
`@base-ui/react` wrapper → hand-written, with the last "almost never" and only
with a justification in the proposal. The console currently hand-writes a large
component layer that the registry already ships.

Twelve registry primitives are vendored: `alert-dialog`, `button`, `dialog`,
`dropdown-menu`, `input`, `label`, `progress`, `select`, `sheet`, `switch`,
`table`, `tabs`. Everything else is hand-written. Each row below is a
hand-written component whose registry equivalent exists and was not used:

| hand-written today | registry equivalent |
|---|---|
| `components/ui/card.tsx` (`Card`, `CardHeader`) | `card` |
| `components/ui/status.tsx` (`Status` dot) | `badge`, `spinner` |
| `shared/components/status-badge.tsx` | `badge` |
| `shared/components/field.tsx` | `field` |
| `product-layout.tsx` `Surface` / `Section` | `card`, `item` |
| `product-layout.tsx` `EmptyState`, 2× `.empty` | `empty` |
| `product-layout.tsx` `InlineAlert`, 94 `.callout` | `alert` |
| `shared/components/task-progress.tsx` | `alert`, `spinner` |
| raw `<textarea>` in `time-panel.tsx` | `textarea` |
| raw file input in `ui-management-page.tsx` | `input-group`, `field` |
| 8 raw `<table>` on `.data-table` / `.ui-table` | `table` (vendored, unused there) |
| `.skeleton-line` rows in `network-page.tsx` | `skeleton` |
| `.spinner` boot screen in `__root.tsx` | `spinner` |
| hand-rolled `.upload-progress` bar | `progress` (vendored, unused there) |
| `.segmented` radiogroup in `interface-detail.tsx` | `toggle-group` |
| `.theme-control` radiogroup in `preferences.tsx` | `toggle-group` |
| `.language-list` button list | `item` + `input` + `scroll-area` |
| `.menu-item` raw buttons in the header menu | `dropdown-menu` items (vendored) |
| `TerminalWindow` hand-rolled modal + backdrop | `dialog` (vendored), `scroll-area` |
| `.metric` / `.attention-row` / `.collection-row` / `.panel-row` | `item` |
| `.details` / `.fact-grid` definition lists | `item`, `field` |
| `.reveal-panel` | `alert`, `input-group` |

Alongside that, the same composite is re-derived per page instead of being
shared: three spellings of a confirm dialog (`ConfirmAction` in `network-page`,
`PowerAction` in `system-page`, inline blocks in six files), two form-dialog
spellings, four table spellings.

And the module layout is doubled, so there is no single place a shared component
could live:

- two component trees — `src/components/**` and `src/shared/components/**`; the
  former's `Card` renders exactly the latter's `Surface` markup, and 14 files
  import it
- two byte-identical `cn` helpers — `src/lib/utils.ts` (2 importers) and
  `src/shared/lib/utils.ts` (15)
- `src/lib/api.ts` is a one-line re-export of `src/shared/lib/http.ts`; 15 files
  import the alias, 10 the original
- `StatusTone` declared twice
- `components.json` aliases shadcn to `@/shared/components`, so everything under
  `src/components/` is off the project's own declared baseline

Registry check for the components needed to close this gap: `alert`, `badge`,
`card`, `empty`, `field`, `input-group`, `item`, `scroll-area`, `separator`,
`skeleton`, `spinner`, `textarea`, `toast`, `toggle-group`, `tooltip` all declare
`cn` as their only npm dependency. **Fifteen primitives, zero new npm
dependencies.** Only `command` would add one (`cmdk`); see *Alternatives*.

### F. `styles.css` is a parallel styling system

591 lines. 152 bespoke class selectors, 27 rules reaching into vendored
primitives through `[data-slot=…]`, 16 rules matching the utility classes those
primitives emit (`.group\/button[class*="h-7"]`), 17 `!important`, 81 hex
literals and 0 oklch values.

The policy forbids exactly this shape: a hand-written layer "may not introduce a
parallel styling or behavior system", primitives "must not contain hex codes …
or hard-coded Tailwind palette colors", and colour belongs in the three-block
token layering, in oklch. Matching on emitted utility classes is also silently
fragile — a variant rename inside a primitive drops the geometry with nothing to
catch it.

One rendering bug already follows from it: the UI-manager table runs text
together — `kiosk1.2.0`, `5.0 MiB1.0 MiB package`, `validatedAPI compatible`,
`its files changed after activationAPI incompatible` — because the rule making
`strong`/`small` block-level is scoped to `.table-surface [data-slot="table-cell"]`
and that table is a hand-rolled `.ui-table`.

`.reveal-panel` and `.wizard-list` are each defined twice with conflicting rules.
Twelve class blocks are dead — `stepper`, `wizard-copy`, `catalog-meta`,
`json-view`, `cell-primary`, `progress-line`, `network-table`, `section-divider`,
`app-icon`, `tabs-row`, `page-heading`, `input-control` — no `.tsx` emits them.
Terminal colours (`#0b0f14`, `#e6edf3`, `#2a3441`, `#7ee787`) are literals with
no token.

### G. Smaller interaction defects

- `InterfaceRow` puts `onClick={navigate}` on a `<tr>` that already contains a
  `<Link>` to the same route: not focusable, no role, and a click on the link
  runs both paths.
- The token copy button calls `void navigator.clipboard.writeText(...)` and then
  sets "Copied" unconditionally; a rejected write is swallowed and still reads as
  success.
- `HostnamePanel` keeps its local draft after a successful save, so the field
  shows the local string rather than the confirmed one and the button stays
  armed.
- `SystemPage` renders `<Tabs key={initialTab} defaultValue={initialTab}>`
  uncontrolled: changing tab never updates the URL hash, so a tab cannot be
  linked or survive a reload.
- Row actions disable by mutation, not by row: `disabled={revoke.isPending}`
  greys out every row's button while one row is being deleted.
- The Wi-Fi add dialog does not reset `hidden` and `priority` after a successful
  add.
- The setup screen shows the one-time bootstrap token with no copy control.
- `UpdateChecks` opens a second `useQuery` on the `['update-state']` key with a
  different `queryFn` type than `useUpdateState`: one key, two definitions.

### H. The coverage number does not measure the components

`vitest.config.ts` restricts `coverage.include` to seven files. The reported
97.11% is measured over 208 statements while roughly 9,000 lines of components
sit outside the denominator. The 80% gate is met by narrowing scope. No test
asserts that a confirm dialog closes, which is why A survived 27 test files and
an 11-case browser suite.

## Proposal

Rebuild the console's UI on the registry and extract a real shared component
library, so that no feature page assembles primitives by hand again. Six steps,
each independently verifiable.

### Step 1 — Declare the library boundary and gate it

Two layers, and a rule per layer:

- `src/shared/components/ui/` — **registry primitives only**, added with
  `bun x shadcn@4.19.1 add <name>`, treated as owned code, kept diffable against
  upstream. Nothing hand-written lands here.
- `src/shared/components/` — **project composites**, built exclusively from those
  primitives. This is the system library every feature imports.

`src/features/**` composes composites; it does not reach for a primitive to build
a control that a composite should own, and it carries no `className` that styles
a control rather than placing it.

Add `pkgs/mosd/apid/ui/verify-ui-policy.sh`, wired into the `build.sh --check`
gate, asserting the policy mechanically rather than by review habit:

- no `@radix-ui|@mui|@mantine|@chakra-ui|antd|@headlessui|@ariakit` in the lockfile
- `components.json` still declares `base-nova`
- no raw `<table>`, `<textarea>`, `<select>`, `<dialog>`, `role="dialog"`,
  `role="radiogroup"`, `role="progressbar"` or `className="callout` under
  `src/features/**`
- no hex or `rgb(`/`oklch(` literal in any `.tsx`
- every file in `src/shared/components/ui/` corresponds to a registry item name

The gate is the part that answers "so later modules are easier to add": a new
page cannot re-open this hole without the check going red.

### Step 2 — Install the missing primitives

`bun x shadcn@4.19.1 add alert badge card empty field input-group item
scroll-area separator skeleton spinner textarea toast toggle-group tooltip`

Fifteen items, verified above to add no npm dependency. Review each generated
file for the two substitutions the CLI makes in this project (lucide icons, `cn`
import path) and commit them as owned code.

### Step 3 — Build the composite layer

Roughly a dozen composites, each replacing a pattern currently re-derived per
page. Named here because they are the deliverable, not an implementation detail:

| composite | replaces | built from |
|---|---|---|
| `ConfirmDialog` | 11 confirm sites | `alert-dialog`, `button`, `spinner` |
| `FormDialog` | 4 add/edit dialogs, review dialog | `dialog`, `field`, `button` |
| `PageHeader` / `PageSection` | `product-layout` | `card`, `separator` |
| `Panel` | `Card` + `Surface` + `.surface-title` | `card` |
| `DataTable` | 8 raw tables | `table`, `empty`, `skeleton` |
| `FactList` | `.details`, `.fact-grid`, `.compact-details` | `item`, `separator` |
| `MetricCard` | `.metric` | `card`, `item` |
| `RowItem` | `.panel-row`, `.collection-row`, `.attention-row` | `item` |
| `StatusDot` | `components/ui/status.tsx` | `badge`, `spinner` |
| `Callout` | 94 `.callout` paragraphs | `alert` |
| `TaskProgress` | current hand-rolled version | `alert`, `progress`, `spinner` |
| `CopyField` | token reveal, setup token, key values | `input-group`, `button` |
| `SegmentedControl` | `.segmented`, `.theme-control` | `toggle-group` |
| `FilePicker` | raw file input + `.upload-progress` | `field`, `input-group`, `progress` |
| `SearchList` | `.language-list` | `input`, `item`, `scroll-area` |

`ConfirmDialog` owns what the eleven call sites each got wrong: open state,
pending state, closing on success, keeping open on failure, and the toast. A
caller passes a title, a description, a tone and an async handler, and cannot
express the broken behaviour.

**Zero hand-written primitives.** Every composite above is assembled from
registry primitives, so the policy's step 4 never fires and the proposal owes no
justification for one. The two decorative exceptions are not components: the
blueprint corner marks on the sign-in card and the `m` logo mark stay as CSS on a
`card`.

### Step 4 — Toast, and one feedback contract

Mount `Toaster` in `AppProviders`. Add `src/shared/feedback/` with a
`useMutationFeedback` hook that takes a success message and derives the failure
message from `ApiError`, so every write reports both, and make
`mutationCache.onError` in `query-client.ts` the single place a request failure
becomes a toast. Delete the merged per-panel error callouts.

Inline `Callout` survives only where the message is a **state of the device**
rather than the **outcome of a click** — reset staged, rotation required,
planned/simulated notices, reboot pending. Those must survive a page revisit; a
toast must not.

### Step 5 — Convert the pages, and fix C, D, G while doing it

Rewrite the 9 feature pages and 12 panels onto the composites. Alongside:

- give `DialogContent` / `AlertDialogContent` `max-height: calc(100dvh - 2rem)`
  with a `scroll-area` body and pinned header and footer, and collapse the three
  sizing systems into one size prop on the component
- move the language picker out of `DropdownMenuContent`; convert the header menu
  rows to `DropdownMenuItem`
- give the install wizard a Cancel control
- make the `<tr>` row-link a single `Link`, not a row handler plus a link
- surface clipboard rejection through the toast instead of reporting success
- clear the hostname and policy drafts on confirmed save
- make `SystemPage` tabs controlled and write the hash
- disable row actions per row, not per mutation
- reset the Wi-Fi dialog on success
- give the setup token a `CopyField`
- one `queryFn` per query key

### Step 6 — Reduce `styles.css` to tokens, and fix the gates

`styles.css` keeps the three-block token layering — `:root`, `.dark`,
`@theme inline` — plus `@import`s and the two decorative rules. The 152 bespoke
class selectors, 27 `data-slot` overrides, 16 utility-class matches and 17
`!important`s go away, because the geometry now lives in the primitives where the
class names are stable. Convert the 81 hex literals to oklch and lift the four
terminal colours into tokens.

Widen `coverage.include` to `src/**/*.{ts,tsx}` less the generated route tree and
the entry point, and set the threshold to what the tree actually reaches, no
lower than 80%.

Verify the whole thing with `lint`, `typecheck`, `test`, `bun run test:e2e`,
`verify-ui-policy.sh`, and `bash pkgs/mosd/apid/ui/build.sh --check`, which runs
the gate set inside the pinned `IMAGE_BUN_1` — the only bun whose chunk hashes
match the shipped dist.

New tests that would be red today: a Vitest case per confirm site asserting the
`alertdialog` role is gone after confirming; a Vitest case per converted panel
asserting the toast text on success and on a 4xx; Playwright cases for the
1024x520 dialog staying inside the viewport, for the settings menu dismissing
when the language dialog opens, and for **Save policy** producing a visible
confirmation.

## Risks

- **Diff size.** Steps 3 and 5 touch nearly every component file. Land them as
  separate commits — primitives, composites, page conversion, stylesheet — so
  each stays reviewable, and keep the tests passing at every commit.
- **Playwright visual baselines.** Three approved snapshots exist; steps 5 and 6
  change dialog geometry, table spacing and control geometry, so all three need
  regenerating. Regenerate deliberately and show the before/after, never
  `--update-snapshots` blind.
- **Registry drift.** Generated primitives are owned code, but a future
  `shadcn add` on an already-vendored name would overwrite local edits. The
  policy gate records the registry name per file so the drift is visible; the
  rule is to re-apply the two known substitutions, never to fork behaviour.
- **`base-nova` visual delta.** The registry's `card`, `item` and `alert` do not
  render pixel-identically to the current bespoke CSS. The approved prototype
  look is carried by the tokens, which are preserved, but spacing and radii will
  shift slightly. If the prototype must be matched pixel-for-pixel, say so and
  the tokens absorb it rather than a new override layer.
- **Concurrent work.** The tree carries an unrelated in-flight change set for the
  storage task. This plan touches only `pkgs/mosd/apid/ui/**` plus its own PMA
  records; nothing overlaps.
- **The device is not exercised here.** All measurement is against the e2e mock
  API. The plan changes no API call, but a run against a real apid on QEMU before
  closing the task is cheap insurance.

## Scope

`pkgs/mosd/apid/ui/` only.

- added: 15 registry primitives, ~15 composites, toast provider and feedback
  hook, `verify-ui-policy.sh` — about 33 new files
- rewritten: 9 feature pages, 12 panels, `providers.tsx`, `query-client.ts`
- deleted: `src/components/ui/card.tsx`, `src/components/ui/status.tsx`,
  `src/lib/utils.ts`, `src/lib/api.ts`, `shared/components/status-badge.tsx`,
  `shared/components/field.tsx`, most of `product-layout.tsx`; ~500 of 591 lines
  of `styles.css`
- config: `components.json` (nothing to change), `vitest.config.ts`, `build.sh`
- tests: ~11 new confirm-close cases, ~20 toast cases, 3 new Playwright cases, 3
  regenerated snapshots
- dependencies: `cmdk`, pulled by `@shadcn/command` for the language picker

About 70 files touched. No API change, no Rust, no image contract.

## Alternatives

- **`SearchList` from `input` + `item` + `scroll-area`** instead of
  `@shadcn/command`, to stay at zero new dependencies. Not taken: the user chose
  the registry answer, so the language picker uses `command` and `cmdk` is the
  plan's one new dependency — permitted by the policy as a headless library
  scoped to one feature.
- **Patch `AlertDialogAction` to wrap `AlertDialogPrimitive.Close`.** Two lines,
  fixes A immediately. Rejected: it forks a registry file away from upstream for
  a behaviour upstream chose on purpose, it cannot express "stay open while
  pending", and it leaves the eleven duplicated call sites in place.
- **Repair only, no library extraction** (A–D and G, skip the registry work).
  Much smaller diff. Rejected because it is what produced this state: one
  primitive used eleven ways, 94 ad-hoc callouts and 152 bespoke CSS classes are
  the accumulated cost of fixing symptoms, and the next module would add more.
- **Keep `styles.css` as the visual source of truth and only add the missing
  primitives.** Rejected: the stylesheet reaches into the primitives it would
  then be sharing a page with, so the two layers keep fighting; it is the reason
  the UI-manager spacing bug exists.

## Annotations

- 2026-09-10 — User: the plan must follow `/pma-web`'s shadcn + Base UI rule and
  extract a global system component library rather than hand-assembling
  components. Plan rewritten accordingly: `sonner` withdrawn in favour of
  `@shadcn/toast` over `@base-ui/react/toast` (no new dependency); the
  `AlertDialogAction` patch withdrawn in favour of a shared `ConfirmDialog`,
  after diffing the vendored primitive and finding it identical to upstream; the
  scope widened from an interaction repair to a registry-based library
  extraction with a mechanical policy gate.
- 2026-09-10 — User approved. Both open decisions resolved: the language picker
  uses `@shadcn/command` (accepting `cmdk` as the one new dependency), and the
  `base-nova` visual delta against the current bespoke CSS is accepted, so the
  tokens carry the prototype's look and no override layer is reinstated.
- 2026-09-10 — `cmdk` withdrawn after installing it. It pulls sixteen
  `@radix-ui/*` packages transitively, including a second dialog implementation,
  which the Hard Lock forbids and the new gate refuses. The premise the approval
  rested on — a headless library scoped to one feature — was not true of it. The
  language picker uses `@shadcn/combobox` instead: the registry's own filtered
  list, wrapping `@base-ui/react`'s combobox, with no npm dependency at all. The
  plan therefore added **zero** dependencies rather than one.
- 2026-09-10 — Completed. The console runs on 29 registry primitives and 15
  composites; `verify-ui-policy.sh` passes 8/8 inside `build.sh --check`;
  232 unit tests and 22 browser cases pass. Two extra findings, both fixed:
  `DropdownMenuLabel` outside a `DropdownMenuGroup` crashes base-ui and took the
  settings menu down, and `e2e/console.spec.ts:45` asserted a string that has
  never existed in the catalogue — it was red before this work and nothing runs
  the Playwright suite in the gate.
