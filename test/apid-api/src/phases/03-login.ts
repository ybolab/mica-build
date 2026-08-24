/**
 * Phase 03 -- logout, login, and the session both handlers mint.
 *
 * Phase 02 got a session by completing setup. That is a one-shot path: it can
 * never be exercised again on this device. /login is the path an operator
 * actually uses, it is a DIFFERENT handler, and it mints its own cookie -- so
 * the name and the five attributes phase 02 asserted are asserted again here,
 * one check each, against this handler's output instead. A divergence
 * between the two handlers is precisely the kind of thing a suite that only
 * checked "did I get a session?" would never see.
 *
 * This phase also leaves the login guard clean for phase 06, and says so.
 */

import { parseSetCookie } from "../client.ts";
import type { Phase } from "../runner.ts";

const SESSION_COOKIE = "apid_session";

/** The same list phase 02 asserts against the SETUP handler's cookie. */
const SESSION_COOKIE_ATTRIBUTES: readonly string[] = [
  "Path=/",
  "HttpOnly",
  "Secure",
  "SameSite=Lax",
  "Max-Age=86400",
];

/**
 * mosd/apid/src/auth.rs: BACKOFF_BASE = 1s, BACKOFF_MAX = 300s, and the window
 * after n consecutive failures is 1s * 2^(n-1), capped. Exactly ONE failed
 * attempt is made below, so the window this phase has to outlast is 1s.
 */
const BACKOFF_BASE_MS = 1_000;

/** Slack over the computed window, for scheduling and for clock granularity. */
const BACKOFF_MARGIN_MS = 750;

const phase: Phase = {
  id: "03-login",
  title: "login: /logout kills the session server-side, and /login mints an equivalent one",
  assumes:
    "phase 02 completed setup, so an admin password hash now exists in mosd's settings -- " +
    "the device is configured, not unconfigured, and the gate therefore sends an " +
    "unauthenticated caller to /login rather than /setup -- and it left the session it was " +
    "issued in the shared client's jar. This phase logs that session out, proves it is dead " +
    "server-side, logs back in with config.adminPassword, and leaves a fresh valid session " +
    "in the jar plus a login guard with zero consecutive failures for every later phase.",

  async run(ctx) {
    const { client, report, config } = ctx;

    // Read the session BEFORE logging out: step 2 replays this exact value by
    // hand and step 6 requires the new session to differ from it.
    const previousSession = client.jar.get(SESSION_COOKIE)?.value;
    report.check(
      previousSession !== undefined,
      "phase 02 left a session in the jar for this phase to log out of",
      [
        `expected: ${SESSION_COOKIE} present in the jar`,
        `actual:   cookies held: ${client.jar.names().join(", ") || "none"}`,
      ].join("\n"),
    );

    // -- 1. logout ----------------------------------------------------------
    const loggedOut = await client.post("/logout", {});
    report.expectStatus(loggedOut, 303, "POST /logout is answered 303");
    report.expectHeader(loggedOut, "location", "/login", "logging out sends the caller to /login");
    report.expectCookieAttributes(
      loggedOut.setCookie[0],
      SESSION_COOKIE,
      ["Path=/", "Max-Age=0"],
      "the logout response clears the session cookie with Max-Age=0 on the same Path",
    );

    // A jar that merely overwrote the value would leave the NAME present, and
    // every later "we are logged out" assertion would pass while asserting
    // nothing. Max-Age=0 is a deletion, and the jar has to treat it as one.
    report.check(
      client.jar.get(SESSION_COOKIE) === undefined,
      "the jar DROPPED the session cookie rather than keeping a cleared one",
      [
        `expected: jar.get(${JSON.stringify(SESSION_COOKIE)}) === undefined`,
        `actual:   cookies held: ${client.jar.names().join(", ") || "none"}`,
      ].join("\n"),
    );

    // -- 2. the old session is dead SERVER-side ------------------------------
    //
    // The check above only proves the CLIENT forgot the cookie, which any
    // logout that did nothing at all would also satisfy. `logout` calls
    // `state.sessions.remove`, so the session id must no longer be honoured
    // even when it is presented deliberately. Replayed by hand, with the jar
    // suppressed so nothing else can be what the gate is reacting to.
    if (previousSession === undefined) {
      report.skip(
        "the cleared session id is refused when replayed by hand",
        "there was no pre-logout session to replay -- see the failed precondition above",
      );
    } else {
      const replayed = await client.get("/", {
        sendCookies: false,
        headers: { Cookie: `${SESSION_COOKIE}=${previousSession}` },
      });
      report.expectStatus(
        replayed,
        303,
        "replaying the cleared session id by hand is answered 303, not 200",
      );
      report.expectHeader(
        replayed,
        "location",
        "/login",
        "the cleared session id is refused SERVER-side -- logout removed it, it did not merely clear the cookie",
      );
    }

    // -- 3. the gate on a CONFIGURED device ----------------------------------
    //
    // /login, not /setup. Phase 01 watched this same request go to /setup; the
    // difference is the admin password hash phase 02 wrote, and it is the
    // reason an unauthenticated caller is now offered a login page instead of
    // an opportunity to claim the device.
    const anonymous = await client.get("/");
    report.expectStatus(anonymous, 303, "GET / with an empty jar is answered 303");
    report.expectHeader(
      anonymous,
      "location",
      "/login",
      "GET / with an empty jar goes to /login and NOT to /setup -- the device is configured now",
    );

    // -- 4. a wrong password -------------------------------------------------
    const attemptedAt = Date.now();
    const wrong = await client.post("/login", {
      password: `${config.adminPassword}-wrong`,
    });
    report.expectStatus(wrong, 401, "POST /login with the wrong password is answered 401");
    report.check(
      wrong.setCookie.length === 0,
      "the rejected login mints no session -- it sets no cookie at all",
      [
        `expected: no Set-Cookie header at all`,
        `actual:   ${wrong.setCookie.length} line(s): ${JSON.stringify(wrong.setCookie)}`,
      ].join("\n"),
    );

    // -- 5. ...and the correct one, once the guard disarms -------------------
    //
    // THE TIMING TRAP. That one failure armed the login guard, and the guard is
    // GLOBAL rather than per-client: for BACKOFF_BASE * 2^(failures-1) = 1s it
    // refuses the CORRECT password too, with 429. So the correct attempt is
    // held until the window has demonstrably passed. Exactly one failure was
    // made above precisely to keep that window at one second; four would make
    // it eight, and the suite would be waiting on its own throttle.
    const armedUntil = attemptedAt + BACKOFF_BASE_MS;
    const waitMs = Math.max(0, armedUntil - Date.now()) + BACKOFF_MARGIN_MS;
    await sleep(waitMs);

    const good = await client.post("/login", { password: config.adminPassword });
    report.check(
      good.status === 303,
      "POST /login with the correct password is accepted 303 once the backoff window has expired",
      [
        `expected: status 303`,
        `actual:   status ${good.status}${
          good.status === 429
            ? " -- the GLOBAL login guard was still armed. It refuses the correct password too;" +
              " either the window is longer than BACKOFF_BASE * 2^(failures-1) or a failure was" +
              " counted that this phase did not make."
            : ""
        }`,
        `waited:   ${waitMs}ms after the single failed attempt (BACKOFF_BASE=${BACKOFF_BASE_MS}ms)`,
      ].join("\n"),
    );
    report.expectHeader(good, "location", "/", "the accepted login redirects to /");

    // The same name and attributes phase 02 asserted, against the OTHER handler.
    const line = good.setCookie[0];
    const cookie = line === undefined ? undefined : parseSetCookie(line);
    report.check(
      cookie !== undefined && cookie.name === SESSION_COOKIE,
      `the accepted login mints a cookie named ${SESSION_COOKIE}`,
      [
        `expected: one Set-Cookie line whose name is ${SESSION_COOKIE}`,
        `actual:   ${good.setCookie.length} line(s): ${JSON.stringify(good.setCookie)}`,
      ].join("\n"),
    );
    for (const attribute of SESSION_COOKIE_ATTRIBUTES) {
      report.expectCookieAttributes(
        line,
        SESSION_COOKIE,
        [attribute],
        `the login session cookie carries ${attribute}, exactly as the setup handler's did`,
      );
    }

    // -- 6. a new session, not the old one back ------------------------------
    //
    // A logout that removed the id but a login that handed the same one back
    // would make step 2 a fluke rather than a property.
    const currentSession = cookie?.value;
    report.check(
      currentSession !== undefined && currentSession !== previousSession,
      "the login minted a NEW session id, not the one logout removed",
      [
        `expected: a session value different from the pre-logout one`,
        `before:   ${JSON.stringify(previousSession ?? "<none>")}`,
        `after:    ${JSON.stringify(currentSession ?? "<none>")}`,
      ].join("\n"),
    );

    // -- 7. the redirect leads somewhere real --------------------------------
    const landed = await client.follow(good);
    report.expectStatus(landed, 200, "following the login redirect to / answers 200 with the new session");
    report.expectHeaderMatches(landed, "content-type", /^text\/html/i, "the page at / is served as HTML");
    report.check(
      landed.body.trim() !== "",
      "the page at / has a body, so the new session really is being honoured",
      [`expected: a non-empty body`, `actual:   ${landed.body.length} bytes`].join("\n"),
    );

    // -- 8. what this phase leaves behind ------------------------------------
    //
    // A successful login resets the consecutive-failure run to zero, so the
    // guard is disarmed and its counter is at 0 -- not at the 1 that step 4
    // put there. Phase 06 therefore inherits a CLEAN guard and can compute the
    // windows it measures from a known starting point; if this phase ever
    // stopped ending on a success, 06's first window would be 2s instead of 1s
    // and its failure would read as a backoff defect rather than as this.
    //
    // Not asserted here on purpose: the only way to observe the counter from
    // outside is to fail another login, which would re-arm the very guard this
    // phase is handing over clean. 06 owns that measurement.
    report.note(
      "  note: this phase ends on a successful login, so 06-backoff inherits a login guard with zero consecutive failures.",
    );

    report.check(
      client.jar.get(SESSION_COOKIE) !== undefined,
      "the jar carries the new session out of this phase, which every later phase assumes",
      [
        `expected: ${SESSION_COOKIE} present in the jar`,
        `actual:   cookies held: ${client.jar.names().join(", ") || "none"}`,
      ].join("\n"),
    );
  },
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export default phase;
