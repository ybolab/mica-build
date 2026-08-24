/**
 * The login backoff, measured from outside the process it protects.
 *
 * mosd/apid/src/auth.rs sets BACKOFF_BASE = 1s and BACKOFF_MAX = 300s, and the
 * window after N consecutive failures is `1s * 2^(N-1)`, capped. Two of that
 * design's properties cannot be shown by a test that lives inside apid:
 *
 *   - the throttle is enforced across a genuinely NEW TCP connection, not just
 *     on a kept-alive one that a handler-level test would reuse, and
 *   - the guard is GLOBAL rather than per-client, so an armed window refuses
 *     the CORRECT password too.
 *
 * The second is not a curiosity. It is an operational fact with a cost: an
 * administrator who knows the password waits, exactly as an attacker does.
 * This phase asserts it deliberately rather than treating it as a surprise.
 *
 * The counters persist to `<state_dir>/login_guard.json` and survive a restart
 * (docs/design/access.md section 6, RFCT-085). That half is asserted in
 * 07b-postreboot, on the far side of a real reboot; this phase's last act is to
 * leave the guard ARMED so 07b has something to find.
 */

import { Client, type HttpResponse } from "../client.ts";
import type { Phase, PhaseContext } from "../runner.ts";
import type { Reporter } from "../report.ts";

/** mosd/apid/src/auth.rs: BACKOFF_BASE. */
export const BACKOFF_BASE_MS = 1_000;
/** mosd/apid/src/auth.rs: BACKOFF_MAX. */
export const BACKOFF_MAX_MS = 300_000;

/** `ctx.state` key under which this phase leaves what 07 must persist. */
export const BACKOFF_STATE_KEY = "06-backoff.guard";

/** What 06 leaves behind, what 07 writes to disk, and what 07b re-measures. */
export interface BackoffState {
  /** Consecutive failures this phase drove the run to before it stopped. */
  readonly failures: number;
  /** Wall-clock of the last observed 401, i.e. when the live window opened. */
  readonly lastFailureAtMs: number;
  readonly lastFailureAtIso: string;
  /** `1s * 2^(failures-1)`, capped -- what auth.rs's curve predicts. */
  readonly expectedWindowMs: number;
  /** The windows this phase actually measured, in order. Shape, not promise. */
  readonly observedWindowsMs: readonly number[];
}

/** The curve from auth.rs, written once so no assertion re-derives it. */
export function expectedWindowMs(failures: number): number {
  if (failures < 1) return 0;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
}

// Four failures is an 8s window. Five would be 16s and six 32s, and the phase
// would then spend most of its time waiting on a throttle it installed itself.
const TARGET_FAILURES = 4;
// One probe every 400ms resolves a 1s window and a 2s window apart comfortably
// while costing four TLS handshakes per second at worst.
const PROBE_INTERVAL_MS = 400;
// Generous against the real windows (1s, 2s, 4s) so that a timeout here means
// something other than slowness -- see the hint in the failure detail.
const WINDOW_TIMEOUT_MS = 60_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface WindowOpened {
  readonly kind: "opened";
  /** Wall-clock of the 401 that reopened the window (and re-armed the guard). */
  readonly at: number;
  /** How long the window held, measured from the previous 401. */
  readonly windowMs: number;
  readonly attempts: number;
}
export interface WindowUnexpected {
  readonly kind: "unexpected";
  readonly response: HttpResponse;
}
export interface WindowTimedOut {
  readonly kind: "timeout";
  readonly attempts: number;
  readonly waitedMs: number;
  readonly lastStatus: number;
}
export type WindowOutcome = WindowOpened | WindowUnexpected | WindowTimedOut;

/**
 * Hold a wrong password against the guard until it lets one through again.
 *
 * `since` is the wall-clock of the PREVIOUS 401, not of the first probe, so the
 * returned `windowMs` is the whole window and not "the window minus whatever
 * the caller did in between".
 *
 * Every probe opens a new socket. A 401 here IS the next failure: it means the
 * guard admitted the attempt and auth.rs rejected the password, which is what
 * arms the next, longer window.
 *
 * Exported because 07b-postreboot measures the SAME curve on the far side of a
 * reboot, and two copies of this loop would be two chances to measure it
 * differently.
 */
export async function waitForWindow(
  probe: Client,
  wrongPassword: string,
  since: number,
  collect: HttpResponse[] = [],
  timeoutMs: number = WINDOW_TIMEOUT_MS,
): Promise<WindowOutcome> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastStatus = 0;
  for (;;) {
    probe.freshConnection();
    const response = await probe.post("/login", { password: wrongPassword });
    const at = Date.now();
    attempts += 1;
    lastStatus = response.status;
    collect.push(response);
    if (response.status === 401) {
      return { kind: "opened", at, windowMs: at - since, attempts };
    }
    if (response.status !== 429) return { kind: "unexpected", response };
    if (Date.now() >= deadline) {
      return { kind: "timeout", attempts, waitedMs: at - since, lastStatus };
    }
    await sleep(PROBE_INTERVAL_MS);
  }
}

export function reportWindowFailure(report: Reporter, what: string, outcome: WindowOutcome): void {
  if (outcome.kind === "unexpected") {
    report.fail(
      what,
      [
        `expected: 429 while the window is open, then 401 once it closes`,
        `actual:   status ${outcome.response.status} from POST /login`,
        `note:     any other status means the guard is not the thing answering`,
      ].join("\n"),
    );
    return;
  }
  if (outcome.kind === "timeout") {
    report.fail(
      what,
      [
        `expected: the window to close and a 401 to become possible again`,
        `actual:   still ${outcome.lastStatus} after ${outcome.attempts} probe(s) over ${outcome.waitedMs}ms`,
        `hint:     auth.rs caps the window at ${BACKOFF_MAX_MS}ms, so a wait this long`,
        `          means either the failure run is far higher than this phase drove`,
        `          it, or a 429 itself counts as a failure -- in which case polling`,
        `          can never reopen the window and this measurement is impossible`,
        `          by construction rather than merely slow.`,
      ].join("\n"),
    );
  }
}

const phase: Phase = {
  id: "06-backoff",
  title: "login backoff: the guard is global, its window doubles, and it survives a restart",
  assumes:
    "phase 05 left the session valid and the admin password unchanged, and the " +
    "login FAILURE RUN IS ZERO -- 03-login ended with a SUCCESSFUL login, which " +
    "resets the counter. This phase is meaningless if it inherits an armed guard: " +
    "every window it measures would be one step further along a curve it did not " +
    "start, and the first 401 it expects would be a 429 instead.",

  async run(ctx: PhaseContext): Promise<void> {
    const { report, config } = ctx;

    // A SEPARATE client with its own empty jar. The failures below arm a global
    // guard; the requests themselves must not touch the session that 07 hands
    // across the reboot, and nothing here should ever be sent with a cookie.
    const probe = new Client(config);
    const wrongPassword = `${config.adminPassword}-not-the-password`;

    // Every 401 and 429 this phase sees, kept so the Set-Cookie assertion at
    // the end can be made over all of them at once rather than piecemeal.
    const refusals: HttpResponse[] = [];

    // -- failure 1 ---------------------------------------------------------
    probe.freshConnection();
    const first = await probe.post("/login", { password: wrongPassword });
    let lastFailureAt = Date.now();
    refusals.push(first);
    report.expectStatus(first, 401, "a wrong password is refused with 401 (failure 1 of the run)");

    // -- the reconnect, which is why this phase exists ----------------------
    //
    // fetch() pools connections, so a throttle measured over one kept-alive
    // socket says nothing about apid's accept path. freshConnection() puts the
    // next request on the raw socket transport, which always dials and always
    // sends `Connection: close`. That the throttle survives a genuinely new TCP
    // connection is precisely the thing an in-process test cannot show, and it
    // is the reason this phase runs against a real machine over a real socket.
    probe.freshConnection();
    const overNewSocket = await probe.post("/login", { password: wrongPassword });
    refusals.push(overNewSocket);
    report.expectStatus(
      overNewSocket,
      429,
      "the window refuses a second attempt made over a genuinely NEW TCP connection",
    );
    report.check(
      overNewSocket.transport === "socket",
      "that second attempt really did open a new socket rather than reuse a pooled one",
      [
        `expected: transport "socket" (a fresh dial, Connection: close)`,
        `actual:   transport ${JSON.stringify(overNewSocket.transport)}`,
        `note:     without this the 429 above would be an assertion about apid's`,
        `          handler and not about its accept path.`,
      ].join("\n"),
    );

    // -- global, not per-client --------------------------------------------
    //
    // The guard keys on nothing: an armed window refuses the CORRECT password.
    // This is deliberate in auth.rs and it is the property with the real
    // operational cost -- an administrator who knows the password waits, and a
    // suite that quietly skipped this would be hiding the design, not testing it.
    probe.freshConnection();
    const correctInsideWindow = await probe.post("/login", { password: config.adminPassword });
    refusals.push(correctInsideWindow);
    report.expectStatus(
      correctInsideWindow,
      429,
      "the CORRECT password is ALSO refused inside the window: the guard is GLOBAL, not per-client",
    );

    // -- let the run grow, and measure the shape of the curve ---------------
    const observed: number[] = [];
    let failures = 1;
    let measurementFailed = false;
    for (let step = 2; step <= TARGET_FAILURES; step += 1) {
      const what = `the window from failure ${step - 1} closes and a ${step}${step === 2 ? "nd" : step === 3 ? "rd" : "th"} failure becomes possible`;
      const outcome = await waitForWindow(probe, wrongPassword, lastFailureAt, refusals);
      if (outcome.kind !== "opened") {
        reportWindowFailure(report, what, outcome);
        measurementFailed = true;
        break;
      }
      observed.push(outcome.windowMs);
      lastFailureAt = outcome.at;
      failures = step;
      report.pass(what);
      report.note(
        `    window after ${step - 1} failure(s): ${outcome.windowMs}ms observed, ` +
          `${expectedWindowMs(step - 1)}ms predicted by auth.rs, ${outcome.attempts} probe(s)`,
      );
    }

    // Shape, never milliseconds. This host is a shared, contended TCG machine:
    // an assertion on `1000ms +/- 100ms` would go red for reasons that have
    // nothing to do with apid, and a flaky check teaches a reader to ignore it.
    if (!measurementFailed) {
      for (let index = 1; index < observed.length; index += 1) {
        const previous = observed[index - 1] ?? 0;
        const current = observed[index] ?? 0;
        report.check(
          current > previous,
          `the window GREW between failure ${index} and failure ${index + 1} (backoff is exponential, not flat)`,
          [
            `expected: window(${index + 1}) > window(${index}) -- auth.rs doubles it`,
            `actual:   ${current}ms is not greater than ${previous}ms`,
            `observed: ${observed.map((ms) => `${ms}ms`).join(" -> ")}`,
            `predicted:${observed.map((_, i) => ` ${expectedWindowMs(i + 1)}ms`).join(" ->")}`,
          ].join("\n"),
        );
      }
      if (observed.length < 2) {
        report.fail(
          "the phase measured at least two windows, so growth could be compared at all",
          [
            `expected: at least 2 measured windows`,
            `actual:   ${observed.length}`,
          ].join("\n"),
        );
      }
    }

    // -- no credential material is ever handed out on a refusal -------------
    const withCookies = refusals.filter((response) => response.setCookie.length > 0);
    report.check(
      withCookies.length === 0,
      "no Set-Cookie is ever issued on a 401 or a 429",
      [
        `expected: every refusal to carry no Set-Cookie at all`,
        `actual:   ${withCookies.length} of ${refusals.length} refusal(s) carried one`,
        ...withCookies
          .slice(0, 3)
          .map((r) => `          ${r.status} ${r.requestTarget}: ${JSON.stringify(r.setCookie)}`),
      ].join("\n"),
    );
    report.check(
      probe.jar.names().length === 0,
      "the probe client's jar is still empty, so nothing above authenticated by accident",
      [
        `expected: an empty jar after ${refusals.length} refused login(s)`,
        `actual:   ${JSON.stringify(probe.jar.names())}`,
      ].join("\n"),
    );

    // -- leave it armed, on purpose -----------------------------------------
    //
    // This is the setup for 07b. The guard's counters live in
    // <state_dir>/login_guard.json, and /var/lib/mos is a bind onto the STATE
    // partition (os/rootfs/overlay-v2/etc/systemd/system/var-lib-mos.mount), so
    // they are expected to survive the reboot 07 is about to cause. Leaving the
    // window OPEN here is what gives 07b something to find on the far side.
    probe.freshConnection();
    const stillArmed = await probe.post("/login", { password: wrongPassword });
    refusals.push(stillArmed);
    report.expectStatus(
      stillArmed,
      429,
      "the guard is demonstrably still ARMED as this phase ends -- deliberate: it is the setup for 07b",
    );

    const state: BackoffState = {
      failures,
      lastFailureAtMs: lastFailureAt,
      lastFailureAtIso: new Date(lastFailureAt).toISOString(),
      expectedWindowMs: expectedWindowMs(failures),
      observedWindowsMs: observed,
    };
    ctx.state.set(BACKOFF_STATE_KEY, state);
    report.note(
      `    leaving the guard armed at ${state.failures} failure(s); auth.rs predicts a ` +
        `${state.expectedWindowMs}ms window opening at ${state.lastFailureAtIso}. ` +
        `07 persists this across the process boundary; 07b re-measures it rather than trusting it.`,
    );
  },
};

export default phase;
