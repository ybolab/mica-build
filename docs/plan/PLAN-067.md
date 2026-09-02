# PLAN-067 Align the built-in console with the approved prototype details

- **status**: completed
- **createdAt**: 2026-09-02 21:25
- **approvedAt**: 2026-09-02 21:25
- **completedAt**: 2026-09-02 21:35
- **relatedTask**: [UI-012](../task/UI-012.md)

## Context

The approved prototype is `docs/zh/design/mos-ui/project/index.dc.html`, which
layers its own `<style>` block over the `industry` design system. It pins a
Klein palette, a Barlow body face for every heading, a 15px/13px text pair, a
1280px container with 32/24/16px gutters, compact/medium/wide breakpoints at
581px and 1100px, and a fixed set of control geometries.

`pkgs/mosd/apid/ui/src/styles.css` re-derives that system in OKLCH on top of
shadcn `base-nova` primitives. The palette conversion is close, but the layer
above it is not: page titles are 29px against the prototype's 22px, secondary
copy collapses to 11-12px against a uniform 13px, tags are pills rather than
4px chips, table rows are a fixed 58px with 11px uppercase headers, the header
is 64px with a circular condensed logo and full-height nav tabs, the footer is
an 11px translucent blur over the surface color, and the breakpoints are
1080/780/560. The sign-in card lost the prototype's blueprint frame, and four
pages still render an `.eyebrow` paragraph that the stylesheet hides.

Component styling in this project is applied through global `data-slot`
selectors in `styles.css` rather than by editing the vendored `base-nova`
primitives. That contract stays.

## Proposal

1. Restate the design tokens from the prototype's Klein palette for both
   themes, add the missing `hover`, `accent-soft`, `accent-strong`, `skeleton`
   and shadow roles, and give the header chrome the prototype's chrome, active
   and logo colors in light and dark.
2. Reset the type scale and density: 22px page titles and 16px section titles
   in Barlow, 13px secondary copy everywhere it is now 11-12px, 15px table and
   control text, 13px footer text, and the prototype's card paddings without a
   card shadow.
3. Rebuild the shell chrome in `app-shell.tsx` and `styles.css`: a 56/52px
   header, a 28px square logo mark with the stacked wordmark and hostname, nav
   pills with an inverted active state, 36px icon actions, a 44px footer drawn
   on the page ground with the connection dot, and a 300px drawer whose nav
   items are 48px and whose foot carries connection and release state.
4. Move the breakpoints to 581px/1100px and apply the prototype's container
   width, page gutters, 24px page rhythm, `260px + 32px` section split and
   metric/summary grid counts.
5. Restyle the controls to the prototype: 38/32/36px buttons at 15px 600 with
   the primary, secondary, ghost, danger and danger-outline variants; 38px
   inputs with a 1.5px border on the surface; 4px 13px 700 tags; 15px tables
   with 13px 700 headers on the hover ground; the segmented tab strip; the
   36x20 switch; 8px dialogs that become bottom sheets under 581px; 6px
   progress bars; skeleton and spinner helpers; and the press micro-interaction.
6. Restore the blueprint frame with registration marks on the sign-in card and
   delete the dead `.eyebrow` markup and rule.
7. Run the pinned frontend gate (`bash pkgs/mosd/apid/ui/run.sh`) and
   regenerate the three Playwright appearance baselines.

## Risks

- The three committed Playwright screenshots are appearance baselines by
  definition and will all change. They are regenerated in step 7, not
  suppressed.
- Density changes can clip long localized strings. Both locales are checked on
  the compact breakpoint for the shell, tables and tab strips.
- `styles.css` overrides `base-nova` through `data-slot` selectors; a size
  change applied there also reaches dialogs and menus that reuse the same
  slots. Each override is scoped to the slot it targets rather than to
  element selectors.
- Scope stays visual. Page and section content, routes, API bindings and the
  simulation boundary are untouched, so a reader comparing the prototype's
  mocked device data with the console will still see different values.

## Outcome

Delivered as proposed, with two corrections found by rendering the prototype
bundle and comparing the shell against it directly:

- The navigation icon set was still the one PLAN-064 chose. It now uses the
  prototype's icons: layout-grid, network, server, package, key and cpu.
- The footer detail and release state were hidden from the medium breakpoint
  down. The prototype hides them only in the compact shell, so they now
  disappear at 580px rather than at 1100px.
