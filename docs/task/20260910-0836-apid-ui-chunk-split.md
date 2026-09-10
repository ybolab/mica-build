# 20260910-0836-apid-ui-chunk-split Split the apid console entry bundle

- **status**: completed
- **priority**: P2
- **owner**: worker/apid-spa-20260910
- **createdAt**: 2026-09-10 08:36

## Description

The console shipped one 594 kB entry chunk, past Vite's 500 kB warning. On an
appliance the cost is parse and compile time on a weak core, not transfer: the
bundle is served from the device's own flash. Split it so the first paint parses
what it needs and the rest arrives in parallel.

Two causes, measured from the entry chunk's own source map: the vendor libraries
were never grouped, and one route module re-exported three panels for a test,
which defeats the router plugin's code splitting for that route and hoisted the
whole system page into the entry.

## ActiveForm

Splitting the apid console entry bundle.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Follows 20260910-0555-apid-spa-interaction-refactor, which left this open.
- User approved the split directly rather than through a plan file.

## Result

- Entry chunk 594 kB -> 106 kB (gzip 187 kB -> 33 kB). No chunk trips the
  warning; the largest is `ui-primitives` at 242 kB.
- Vendors grouped into `react` (190 kB), `ui-primitives` (242 kB), `router`
  (111 kB) and `i18n` (48 kB), each preloaded in parallel from `index.html`.
- Dropping the route re-export moved the system page into its own 48 kB chunk,
  loaded only when that route is opened. Measured against the production build
  in a browser: 14 chunks on first paint, 10 more on navigating to System, no
  console errors.
- `verify-ui-policy.sh` gained a ninth check refusing a route module that
  exports anything but its `Route`, which is what caused the hoist. Verified by
  mutation: adding a re-export to the network route turns it red.

## Acceptance

- No chunk trips Vite's size warning.
- The entry chunk carries the shell and its providers, not a feature page.
- A route module exports its route and nothing else.
- The entry script stays `assets/index-*.js`, which `verify/src/checks-fixture.ts`
  matches on by prefix.
- `lint`, `typecheck`, `test`, the policy gate, the browser suite and
  `build.sh --check` all pass.

- complete: entry chunk 594 kB -> 106 kB; route-export check added to the policy gate
