# 20260910-0555-apid-spa-interaction-refactor Repair and refactor apid console interaction

- **status**: completed
- **priority**: P1
- **owner**: worker/apid-spa-20260910
- **createdAt**: 2026-09-10 05:55

## Description

The embedded apid console (`pkgs/mosd/apid/ui/`) has a set of interaction
defects that make destructive operations read as if nothing happened, and a
structural duplication that keeps producing them. Repair the interaction layer
and refactor the shared component surface behind it: a single global toast
channel for operation outcomes, confirmation dialogs that actually close and
report, dialogs sized and scrolled for the short viewports an appliance panel
has, and one component tree instead of the two that exist today.

This is complete-image development. No compatibility path is owed to any
previous console build.

## ActiveForm

Investigating and repairing the apid console interaction layer.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Full PMA tier: cross-cutting across the shared UI kit, every feature page and
  the stylesheet.
- Baseline: d64b23a7 with the working tree of the concurrent storage task
  untouched; this task changes only `pkgs/mosd/apid/ui/` plus its own records.
- Plan: [investigation and proposal](../plan/20260910-0555-apid-spa-interaction-refactor.md).

## Acceptance

- `src/shared/components/ui/` holds registry primitives only; every file maps to
  a shadcn `base-nova` registry item name.
- No component is hand-written where the registry ships an equivalent; the
  proposal names any exception and there are currently none.
- Feature pages compose shared composites; a mechanical gate refuses raw
  `<table>` / `<textarea>` / `role="dialog"` / `.callout` / colour literals under
  `src/features/**`, and refuses a forbidden UI ecosystem in the lockfile.
- Confirming a destructive dialog closes it, and the outcome is reported.
- Every mutation reports success as well as failure, through one feedback path.
- A dialog taller than the viewport scrolls inside itself; its title and footer
  buttons stay reachable at 1024x520.
- Opening a dialog from the header settings menu dismisses that menu.
- One component tree, one `cn`, one HTTP module, one `StatusTone`.
- `styles.css` carries tokens and imports only, in oklch, with no rule reaching
  into a vendored primitive.
- `lint`, `typecheck`, `test`, Playwright and `build.sh --check` pass; coverage
  measures the components it claims to.
- No npm dependency added.

- complete: registry-based library extracted; policy gate green in build.sh --check
