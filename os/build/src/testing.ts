// Timeouts for the tests that drive real tools, and why they are not the default.
//
// bun's default per-test and per-hook timeout is 5 s, which is right for a
// suite that computes and wrong for one that starts containers. Measured on
// this host, 2026-08-25:
//
//   Toolbox.open, host route                      ~4 ms
//   Toolbox.open, alpine + apk (assembly toolset) ~2.1 s
//   Toolbox.open, alpine + apk coreutils          ~4.6 s
//   Toolbox.open, debian + apt (rauc, bundle)     ~7-40 s
//   one docker exec into an open toolbox          ~40 ms
//   one docker run --rm (what a session avoids)   ~320 ms
//
// The 4.6 s open is the one that matters: it is UNDER the default and it flaked
// against it, which is the worst kind of limit -- green on a warm image cache
// and red on a cold one, for a reason that has nothing to do with what is being
// tested. So the tests that open a toolbox say so with a number, at the place
// that pays the cost, rather than the whole suite being given a blanket flag
// that would also hide a genuine hang in the tests that compute.
//
// These are CEILINGS, not budgets. The whole suite runs in well under a minute
// of tool time on a warm cache; what they buy is that a cold pull or a slow
// registry is a slow run rather than a red one.

/** For a hook that opens one or more toolboxes: an image may have to be pulled. */
export const OPEN_TIMEOUT_MS = 300_000

/** For a test that drives real tools through an already-open toolbox. */
export const TOOL_TIMEOUT_MS = 120_000
