/**
 * Phase 02 -- first-boot setup.
 *
 * This is the only phase in the suite that can run at all: /setup is
 * once-only, so every rejection it asserts is reachable ONLY before the
 * successful POST and the 409 is reachable ONLY after it. The order below is
 * therefore load-bearing, not stylistic, and a re-run needs a fresh boot.
 *
 * The centre of the phase is not the 303. It is what the 303 carries and what
 * the device does afterwards: the session cookie, checked a name and five
 * attributes at a time -- SameSite=Lax there is the whole of apid's cross-site
 * defence, because there is no CSRF token --
 * and a second, stranger client observing that the gate now sends it somewhere
 * different.
 */

import { Client, checkbox, parseSetCookie, type FormFields, type HttpResponse } from "../client.ts";
import type { Reporter } from "../report.ts";
import type { Phase } from "../runner.ts";
import { GATE_TARGET_BEFORE_SETUP } from "./01-transport.ts";

const SESSION_COOKIE = "apid_session";

/**
 * The attributes of the cookie apid mints, verbatim from
 * mosd/apid/src/session.rs:102-104:
 *
 *     apid_session=<id>.<hmac>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400
 *
 * The name is checked separately from these; each attribute gets its own check
 * so a red run names the attribute that was lost rather than "the cookie was
 * wrong". Phase 03 asserts the same list against the cookie /login mints, because setup and login are two different
 * handlers and a divergence between them is exactly what this suite is for.
 */
const SESSION_COOKIE_ATTRIBUTES: readonly string[] = [
  "Path=/",
  "HttpOnly",
  "Secure",
  "SameSite=Lax",
  "Max-Age=86400",
];

/** Not a hostname by any reading: spaces and punctuation are not label bytes. */
const INVALID_HOSTNAME = "not a valid hostname!";

/** Seven bytes. The floor is eight, so this is one short of acceptable. */
const SHORT_PASSWORD = "sevenby";

/** Substrings a CSRF/anti-forgery scheme would have to put in the markup. */
const CSRF_MARKERS: readonly string[] = [
  "csrf",
  "xsrf",
  "authenticity_token",
  "anti-forgery",
  "antiforgery",
  "requestverificationtoken",
];

/** ...and the response headers such a scheme would have to set. */
const CSRF_HEADERS: readonly string[] = [
  "x-csrf-token",
  "csrf-token",
  "x-xsrf-token",
  "x-requestverificationtoken",
  "x-anti-forgery-token",
];

const phase: Phase = {
  id: "02-setup",
  title: "setup: the rejections, the first admin password, and the session cookie it mints",
  assumes:
    "phase 01 observed the device in SETUP MODE -- it watched the gate herd /, /hostname " +
    "and even /login to /setup, which is only true while no admin password hash exists in " +
    "mosd's settings -- and left the cookie jar empty, having proved no route minted a " +
    "session on the way. This phase needs both: the rejections below are reachable only " +
    "before setup succeeds, and it consumes the pre-setup redirect target 01 recorded so " +
    "its device-effect assertion is a before/after delta rather than a bare status code.",

  async run(ctx) {
    const { client, report, config } = ctx;

    // The whole payload is identical in every case below except the field
    // under test, so a rejection is attributable to that field and to nothing
    // else. Two details of the encoding matter:
    //
    //   - `hostname` is OMITTED, not sent empty. Leaving the device's current
    //     name alone is what an operator who only wants a password does, and
    //     "" is itself an invalid hostname -- it would 422 for the wrong
    //     reason and the 400 cases below would never be reached.
    //   - `dhcp` is a CHECKBOX. A ticked box sends its value; an unticked box
    //     sends NOTHING AT ALL, it does not send "off". `checkbox()` says so
    //     in the type. Ticked here so setup does not also try to commit a
    //     static address that the fields deliberately do not carry.
    const setupFields = (overrides: FormFields = {}): FormFields => ({
      password: config.adminPassword,
      confirm: config.adminPassword,
      dhcp: checkbox(true),
      ...overrides,
    });

    // -- the setup form, which the CSRF assertion below is about -------------
    //
    // Fetched before anything is posted, and asserted to be a real form: a
    // "there is no CSRF token in this body" check against a 500 or an empty
    // body would pass while proving nothing.
    const form = await client.get("/setup");
    report.expectStatus(form, 200, "GET /setup serves the setup form while the device is unconfigured");
    report.expectBodyContains(form, "<form", "the setup page really is a form, so the CSRF check below is not vacuous");

    // -- 1. password != confirm --------------------------------------------
    const mismatched = await client.post(
      "/setup",
      setupFields({ confirm: `${config.adminPassword}-not-the-same` }),
    );
    report.expectStatus(mismatched, 400, "POST /setup with password != confirm is rejected 400");
    expectNoCookie(report, mismatched, "the mismatched-confirm rejection");

    // A rejected setup that nonetheless wrote the hash would be a serious
    // defect, and one that no status-code assertion can see. The observable is
    // the gate: if the hash had landed, this would now redirect to /login.
    const stillUnconfigured = await client.get("/");
    report.expectStatus(stillUnconfigured, 303, "GET / is still answered 303 after the rejected setup");
    report.expectHeader(
      stillUnconfigured,
      "location",
      "/setup",
      "the rejected setup left NO password hash behind -- the gate still sends / to /setup, not /login",
    );

    // -- 2. a password one byte under the floor ------------------------------
    const short = await client.post(
      "/setup",
      setupFields({ password: SHORT_PASSWORD, confirm: SHORT_PASSWORD }),
    );
    report.expectStatus(
      short,
      400,
      `POST /setup with a ${Buffer.byteLength(SHORT_PASSWORD, "utf8")}-byte password is rejected 400 (the floor is 8)`,
    );
    expectNoCookie(report, short, "the short-password rejection");

    // -- 3. a hostname that is not a hostname --------------------------------
    //
    // 422 and not 400: the password is valid here, so the request is
    // well-formed and it is the hostname's CONTENT that is unprocessable.
    const badHostname = await client.post("/setup", setupFields({ hostname: INVALID_HOSTNAME }));
    report.expectStatus(
      badHostname,
      422,
      `POST /setup with the hostname ${JSON.stringify(INVALID_HOSTNAME)} is rejected 422`,
    );
    expectNoCookie(report, badHostname, "the invalid-hostname rejection");

    // -- 4. the real setup ---------------------------------------------------
    const accepted = await client.post("/setup", setupFields());
    report.expectStatus(accepted, 303, "POST /setup with a valid password is accepted 303");
    report.expectHeader(accepted, "location", "/", "the accepted setup redirects to /");

    // -- 5. the session cookie, one attribute per check ----------------------
    const line = accepted.setCookie[0];
    const cookie = line === undefined ? undefined : parseSetCookie(line);
    report.check(
      cookie !== undefined && cookie.name === SESSION_COOKIE,
      `the accepted setup mints a cookie named ${SESSION_COOKIE}`,
      [
        `expected: one Set-Cookie line whose name is ${SESSION_COOKIE}`,
        `actual:   ${accepted.setCookie.length} line(s): ${JSON.stringify(accepted.setCookie)}`,
      ].join("\n"),
    );
    for (const attribute of SESSION_COOKIE_ATTRIBUTES) {
      report.expectCookieAttributes(
        line,
        SESSION_COOKIE,
        [attribute],
        `the setup session cookie carries ${attribute}`,
      );
    }

    // -- 6. there is no CSRF token, and that is the point --------------------
    //
    // apid ships NO anti-forgery token of any kind. That is not an oversight
    // this suite is working around: it means `SameSite=Lax` on the cookie
    // asserted above is the ENTIRE cross-site defence for every mutating form
    // in this surface -- /setup, /login, /network, /hostname, /ssh/*,
    // /containers/enable, /power/reboot, /power/poweroff.
    //
    // So this check pins the current design rather than a token's absence. If
    // someone ever weakens the cookie to SameSite=None, the attribute check
    // above goes red and THIS check is the line that says what was lost with
    // it: after that change there is nothing left defending those forms.
    const csrfInForm = CSRF_MARKERS.filter((marker) => form.body.toLowerCase().includes(marker));
    const csrfInResponse = CSRF_MARKERS.filter((marker) =>
      accepted.body.toLowerCase().includes(marker),
    );
    report.check(
      csrfInForm.length === 0 && csrfInResponse.length === 0,
      "apid ships NO CSRF token -- neither the setup form nor the setup response carries one, so SameSite=Lax is the whole cross-site defence",
      [
        `expected: none of ${CSRF_MARKERS.join(", ")} in the setup form or the setup response`,
        `actual:   form body matched ${csrfInForm.join(", ") || "none"}; response body matched ${csrfInResponse.join(", ") || "none"}`,
        `note:     a token appearing here is not a failure of apid -- it means this`,
        `          comment and this suite's threat model are out of date`,
      ].join("\n"),
    );
    const csrfHeaders = CSRF_HEADERS.filter(
      (name) => form.headers.has(name) || accepted.headers.has(name),
    );
    report.check(
      csrfHeaders.length === 0,
      "no anti-forgery header accompanies either the setup form or the setup response",
      [
        `expected: none of ${CSRF_HEADERS.join(", ")}`,
        `actual:   ${csrfHeaders.join(", ") || "none"} present`,
      ].join("\n"),
    );

    // -- 7. the session value is opaque --------------------------------------
    //
    // <id>.<hmac>, both hex. A session that embedded the credential -- or the
    // account name -- would satisfy every status-code assertion ever written
    // about this surface, so the value itself has to be looked at.
    const value = cookie?.value ?? "";
    report.check(
      /^[0-9a-f]+\.[0-9a-f]+$/i.test(value),
      "the session value is an opaque <hex>.<hex> pair, as session.rs mints it",
      [
        `expected: a value matching /^[0-9a-f]+\\.[0-9a-f]+$/`,
        `actual:   ${JSON.stringify(value)}`,
      ].join("\n"),
    );
    const leaks = credentialEncodings(config.adminPassword);
    const leaked = [...leaks].filter(([, encoded]) => value.toLowerCase().includes(encoded));
    const names = ["admin", "root", "webadmin"].filter((name) =>
      value.toLowerCase().includes(name),
    );
    report.check(
      leaked.length === 0 && names.length === 0,
      "the session value carries neither the admin password (in any obvious encoding) nor a username",
      [
        `expected: none of ${[...leaks.keys()].join(", ")} encodings of the password, and no admin/root/webadmin`,
        `actual:   password visible as ${leaked.map(([how]) => how).join(", ") || "nothing"}; names matched ${names.join(", ") || "none"}`,
        `value:    ${JSON.stringify(value)}`,
      ].join("\n"),
    );

    // -- 8. the redirect leads somewhere real --------------------------------
    //
    // GUARDED for the same reason as 03-login step 7: `follow` throws on a
    // response with no Location, and a phase that throws stops reporting. The
    // live run of 2026-08-24 lost the whole tail of 03-login to exactly that,
    // so the shape is fixed here too rather than waiting for a run to find it.
    if (accepted.headers.get("location") === undefined) {
      report.skip(
        "following the setup redirect to / answers 200 with the new session",
        `the setup response was ${accepted.status} and carried no Location header, so there is ` +
          `no redirect to follow. The failure is the one reported above.`,
      );
    } else {
      const landed = await client.follow(accepted);
      report.expectStatus(landed, 200, "following the setup redirect to / answers 200 with the new session");
      report.expectHeaderMatches(landed, "content-type", /^text\/html/i, "the page at / is served as HTML");
      report.check(
        landed.body.trim() !== "",
        "the page at / has a body, so the session really is being honoured",
        [`expected: a non-empty body`, `actual:   ${landed.body.length} bytes`].join("\n"),
      );
    }

    // -- 9. the device left setup mode -- the device-effect assertion --------
    //
    // HOW THIS IS OBSERVED, and why it is the assertion that matters: the
    // gate's redirect target is driven by whether `access.webAdmin`'s password
    // hash exists in MOSD's settings, not by anything apid holds in memory. So
    // a SECOND client -- fresh, empty jar, no part of the exchange above --
    // being sent to /login where phase 01 watched it be sent to /setup proves
    // the POST travelled apid -> system bus -> mosd and that the write landed.
    //
    // The 303 in step 4 proves none of that: a handler that returned 303 and
    // wrote nothing would pass it. A behaviour change observed by a different
    // client is what cannot be faked.
    const recorded = ctx.state.get(GATE_TARGET_BEFORE_SETUP);
    const before = typeof recorded === "string" ? recorded : "/setup";
    const stranger = new Client(config);
    const strangerIndex = await stranger.get("/");
    report.expectStatus(
      strangerIndex,
      303,
      "a second client with an empty jar is still redirected off / -- setup did not open the device up",
    );
    report.expectHeader(
      strangerIndex,
      "location",
      "/login",
      `a second client with an empty jar is now sent to /login, where before setup phase 01 observed ${before} -- the password hash reached mosd's settings`,
    );

    // -- 10. setup is once-only ----------------------------------------------
    const again = await client.post("/setup", setupFields());
    report.expectStatus(
      again,
      409,
      "a second POST /setup is refused 409 -- the admin password can only be set once",
    );

    // The jar carries the session into phase 03, which logs it out. The 409
    // above must not have disturbed it.
    report.check(
      client.jar.get(SESSION_COOKIE) !== undefined,
      "the jar still holds the session cookie, which phase 03 assumes and logs out",
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

/**
 * A rejected setup must not hand out a session. Asserted for each rejection
 * separately, because "the status was 400" says nothing about what the
 * response carried alongside it.
 */
function expectNoCookie(report: Reporter, response: HttpResponse, what: string): boolean {
  return report.check(
    response.setCookie.length === 0,
    `${what} sets no cookie -- a refused setup mints no session`,
    [
      `expected: no Set-Cookie header at all`,
      `actual:   ${response.setCookie.length} line(s): ${JSON.stringify(response.setCookie)}`,
    ].join("\n"),
  );
}

/**
 * The encodings a credential would plausibly be visible in if it had been
 * stuffed into the session value. Hex matters most: a hex-encoded password
 * would satisfy the `<hex>.<hex>` shape check above on its own.
 */
function credentialEncodings(password: string): Map<string, string> {
  const bytes = Buffer.from(password, "utf8");
  return new Map<string, string>([
    ["verbatim", password.toLowerCase()],
    ["hex", bytes.toString("hex").toLowerCase()],
    ["base64", bytes.toString("base64").toLowerCase()],
  ]);
}

export default phase;
