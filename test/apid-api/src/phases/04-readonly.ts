/**
 * Phase 04 -- the read-only surface: the panes, the reserved `/api/` subtree,
 * the static-asset fallback, the path-traversal contract and the POST-only
 * guards.
 *
 * Nothing here changes one thing on the device. Every request is a GET, with
 * two exceptions that are still read-only in effect: a `POST` to a fallback
 * path, which `serve::fallback` refuses on the method before it looks at
 * anything else, and the `GET`s aimed at the POST-only mutation routes, which
 * exist precisely to prove that a GET reaches no handler. Anything that
 * actually mutates belongs in 05-mutate.
 *
 * Three properties of this file are load-bearing and are the reason it is as
 * long as it is:
 *
 *   - **A pane is not proved by a 200.** The gate is a `middleware::from_fn`
 *     layered over every route, so a gate misfire that served the wrong pane
 *     still answers 200 with `text/html`. Every pane therefore also asserts a
 *     string that ONLY that pane renders. The nav bar is rendered into all six
 *     of them and carries the words "Network", "Power", "SSH" and
 *     "Containers", so those words discriminate nothing; the markers below are
 *     sentences and legends from the pane bodies for exactly that reason.
 *
 *   - **Every path-shape assertion goes through `client.raw()`.** `fetch()`
 *     normalises `..` and `%2e%2e` before the request leaves the process
 *     (measured 2026-08-24, and the selftest holds that measurement). A
 *     traversal probe issued through `fetch` asserts on a string the client
 *     rewrote, which is a test of bun and not of apid.
 *
 *   - **`Accept` decides half the fallback contract.** `serve::offers_html()`
 *     is true only for an `Accept` range of exactly `text/html` or `text/*`.
 *     The wildcard range -- spelled out here rather than written literally,
 *     because the literal three characters would close this comment -- is
 *     FALSE. It is curl's default, and it is this client's default. Running
 *     the fallback set with a default client returns 404 for every row and
 *     produces six green checks that reached none of the code they name. Both
 *     columns are asserted for every row, always.
 */

import { Client, checkbox, type HttpResponse } from "../client.ts";
import type { Phase, PhaseContext } from "../runner.ts";

/**
 * axum's `Html` responder and `assets::mime` both emit
 * `text/html; charset=utf-8`, so the media type is matched with its parameters
 * left free. Pinning the charset would assert a detail no design document
 * states; leaving the media type unpinned would let `application/json` pass.
 */
const HTML_CONTENT_TYPE = /^text\/html\s*(;.*)?$/i;

/** How much of an unexpected body to quote in a failure detail. */
const SNIPPET = 200;

// ---------------------------------------------------------------------------
// 1. The panes
// ---------------------------------------------------------------------------

interface Pane {
  readonly path: string;
  /** A string ONLY this pane renders. Never a word the nav bar also carries. */
  readonly marker: string;
  /** Named in the check text, so a red line says what was looked for. */
  readonly markerName: string;
}

/**
 * The six declared, session-gated GET panes and the string that identifies
 * each one.
 *
 * `/ssh`, `/containers` and `/hostname` are fixed by the subtask brief.
 * `/`, `/network` and `/power` were chosen here, and the choices are:
 *
 *   - `/` renders `pane("Status", status_body(..))`. `status_body` emits
 *     `h2 { "System" }` and `h2 { "Network state" }` unconditionally -- before
 *     any branch on whether mosd answered -- so `Network state` survives a
 *     device whose bus calls are all failing, where the pane renders error
 *     boxes and nothing else. It is also not a nav word: the nav renders
 *     `>Network</a>`, which does not contain the substring `Network state`.
 *
 *   - `/network` renders one `form` per configured interface and then, outside
 *     that loop, an "Add interface" fieldset. The per-interface forms are
 *     conditional on there being interfaces -- the pane's own empty branch is
 *     `p { "No interfaces configured." }` -- so a marker taken from them would
 *     be a marker that depends on the device's network configuration. The
 *     "Add interface" legend is unconditional and is rendered by no other pane.
 *
 *   - `/power` opens with one unconditional sentence above both action forms.
 *     The forms themselves carry the confirm tokens, which 05-mutate and
 *     07/08 need; a read-only phase should not assert on the token strings,
 *     because that would couple this phase to the shape of a control it must
 *     never submit. The sentence is the stable, body-level choice.
 *
 * `/hostname` is handled separately below: its marker is the CURRENT hostname,
 * which cannot be hardcoded, so the assertion is that the field is there and
 * carries a non-empty value.
 */
const PANES: readonly Pane[] = [
  {
    path: "/",
    marker: "Network state",
    markerName: 'the Status pane\'s "Network state" heading',
  },
  {
    path: "/network",
    marker: "Add interface",
    markerName: 'the Network pane\'s "Add interface" legend',
  },
  {
    path: "/power",
    marker: "Rebooting is what activates a newly installed system slot.",
    markerName: "the Power pane's opening sentence",
  },
  {
    path: "/ssh",
    marker: "Every authorized key is a root key.",
    markerName: "the SSH pane's root-key notice",
  },
  {
    path: "/containers",
    marker: "Containers on this device run as root. Rootless mode is not built,",
    markerName: "the Containers pane's root notice",
  },
];

// ---------------------------------------------------------------------------
// 2. The reserved /api/ subtree
// ---------------------------------------------------------------------------

/**
 * Targets that must all produce `api_not_found`'s envelope.
 *
 * `/api` and `/api/` are BOTH here, and the pair is the point rather than a
 * duplicate. `nest("/api", ..)` claims `/api`, `/api/x` and `/api/x/y` and
 * **not** `/api/` -- which is why routes.rs declares `/api/` a second time,
 * with `any(api_not_found)`, immediately after the nest. If that second
 * declaration were ever dropped, `/api/` would fall through to the asset
 * router: a request that begins `/api/` answered by the SPA fallback, which is
 * exactly what api.md §4.1 rule 1 forbids. Over the wire is the only place
 * that split is observable -- from inside the router both spellings look like
 * the same prefix.
 */
const API_TARGETS: readonly string[] = [
  "/api/",
  "/api",
  "/api/versions",
  "/api/v1/settings",
  "/api/deeply/nested/thing",
];

// ---------------------------------------------------------------------------
// 3. The static-asset fallback and path traversal
// ---------------------------------------------------------------------------

interface FallbackRow {
  readonly target: string;
  /** Expected status for `Accept: text/html`. */
  readonly withHtml: 200 | 404;
  /** Expected status for `Accept: * / *`. Always 404; see `offers_html`. */
  readonly withAny: 404;
  /** Which of §4.2's conditions decides this row, quoted in the check text. */
  readonly because: string;
}

/**
 * The fallback contract, both columns, in the shape `serve::respond` produces
 * it ON A BUNDLE-LESS DEVICE.
 *
 * READ THE LIMIT BEFORE READING THE TABLE.
 *
 * ===========================================================================
 * WHAT THIS TABLE DOES NOT TEST: api.md §4.4's traversal guards.
 *
 * `serve::respond()` calls `asset_path::resolve()` -- the function that holds
 * every §4.4 guard: the dot-segment rejection, the residual-escape rejection,
 * the NUL rejection, the escaped-separator rejection and the
 * canonicalised-root containment assertion -- ONLY inside
 * `if let Some(root) = active_root(..)`. With no bundle active at `/srv/ui`,
 * `active_root` is `None` and that whole block is skipped. Not one line of
 * §4.4 executes.
 *
 * The 404s below therefore come from §4.2 conditions 3 and 4 --
 * `offers_html()` and `ends_in_a_route_segment()` -- and from nowhere else.
 * They are the RIGHT statuses arrived at by a DIFFERENT route, and a comment
 * here claiming this phase covers §4.4 would be precisely the defect this
 * suite exists to prevent: a green check standing in for code that never ran.
 *
 * Reaching §4.4 needs an active bundle on the DATA partition at `/srv/ui`,
 * and the campaign's seeding tool writes STATE only. Closing that gap needs a
 * bundle-seeding step, which is not this phase and is not this campaign's
 * tooling as it stands.
 * ===========================================================================
 *
 * With that said, the rows:
 *
 *   `/../../etc/passwd` -- last segment `passwd`, no `.` and no `%`, so
 *   `ends_in_a_route_segment()` is TRUE. With `text/html` it reaches condition
 *   5 and gets the built-in UI: **200 is the CORRECT answer and is asserted as
 *   correct.** It is the SPA fallback on a bundle-less device, not a traversal
 *   hole -- no filesystem was consulted, because `active_root` was `None`.
 *   The assertion that would actually catch a traversal is the NEGATIVE one on
 *   the body, made below, and it is worth more than the status code.
 *
 *   `/%2e%2e%2fetc%2fpasswd`, `/%252e%252e%2fetc%2fpasswd`, `/x%00y` -- the
 *   `%2f` are literal escapes, not separators, so each target is a SINGLE
 *   segment containing `%`. `ends_in_a_route_segment()` rejects a `%` exactly
 *   as it rejects a `.`, because a surviving `%` may decode to one. 404 in
 *   both columns.
 *
 *   `/no-such-route` -- an ordinary SPA route: no `.`, no `%`. 200 under
 *   `text/html`, 404 under the wildcard range. This row is the control that
 *   proves the `Accept` column is doing work rather than everything being 404.
 *
 *   `/no-such-asset.js` -- last segment carries a `.`, so it reads as a
 *   filename and never becomes HTML. 404 in both columns.
 */
const FALLBACK_ROWS: readonly FallbackRow[] = [
  {
    target: "/../../etc/passwd",
    withHtml: 200,
    withAny: 404,
    because:
      "last segment 'passwd' is a route segment, so text/html reaches §4.2 condition 5 (the SPA fallback) and */* is refused by condition 3",
  },
  {
    target: "/%2e%2e%2fetc%2fpasswd",
    withHtml: 404,
    withAny: 404,
    because: "the whole target is one segment containing '%', so §4.2 condition 4 refuses it",
  },
  {
    target: "/%252e%252e%2fetc%2fpasswd",
    withHtml: 404,
    withAny: 404,
    because: "double-encoded, still one segment containing '%', still condition 4",
  },
  {
    target: "/x%00y",
    withHtml: 404,
    withAny: 404,
    because: "an encoded NUL is a '%' in the last segment, so condition 4 refuses it",
  },
  {
    target: "/no-such-route",
    withHtml: 200,
    withAny: 404,
    because: "an ordinary SPA route: condition 5 under text/html, condition 3 under */*",
  },
  {
    target: "/no-such-asset.js",
    withHtml: 404,
    withAny: 404,
    because: "the last segment carries a '.', so condition 4 reads it as a filename",
  },
];

/**
 * Signs that a passwd file reached the client.
 *
 * These are asserted ABSENT from the 200 that `/../../etc/passwd` returns.
 * That body should be the built-in Status pane, and the Status pane reads
 * mosd and `/proc/uptime` and nothing else -- so none of these can appear in
 * it legitimately. If one ever does, the 200 has stopped being the SPA
 * fallback and has started being a file, and the status code alone would not
 * have said so.
 */
const PASSWD_SIGNS: readonly string[] = ["root:", "/bin/", ":x:0:0:"];

// ---------------------------------------------------------------------------
// 4. The POST-only guards
// ---------------------------------------------------------------------------

/**
 * Every route routes.rs declares with `post(..)` and no `get(..)`, at the
 * commit this image is built from.
 *
 * The reason is written in routes.rs beside two of them and applies to all
 * nine: no GET handler exists, so no browser prefetch, no crawler and no
 * mis-clicked link can power the appliance off, enable SSH, set a root
 * password, change the key list, start the container engine, end a session or
 * deactivate a working custom UI. A 405 here is the guard holding.
 *
 * `/power/reboot` and `/power/poweroff` are deliberately NOT in this list --
 * they are issued separately below, each followed immediately by a `/healthz`
 * probe, so the liveness assertion sits next to the request it is about.
 */
const POST_ONLY: readonly string[] = [
  "/logout",
  "/ssh/enable",
  "/ssh/password",
  "/ssh/keys/add",
  "/ssh/keys/remove",
  "/containers/enable",
  "/builtin/deactivate",
];

// ---------------------------------------------------------------------------
// 5. /builtin and /builtin/
// ---------------------------------------------------------------------------

/**
 * The escape section's legend and button label, rendered by `escape_section()`
 * and therefore by `builtin_home` alone.
 *
 * `home` -- the handler behind `/` and behind the SPA fallback -- does NOT
 * render it: routes.rs says so in as many words, that `/` is conditional and
 * stays conditional and the escape control belongs on the pane that is
 * reachable unconditionally. That makes this string a marker for `/builtin`
 * specifically, rather than a marker for "some Status pane", which is what the
 * "same pane" assertion needs it to be.
 */
const BUILTIN_MARKER = "Deactivate the custom UI";

/** Both `/builtin` spellings render `pane("Status", ..)`, hence this `h1`. */
const STATUS_HEADING = "<h1>Status</h1>";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function snippet(body: string): string {
  return body.length <= SNIPPET ? body : `${body.slice(0, SNIPPET)}...`;
}

function describeBody(response: HttpResponse): string {
  return `${response.body.length} bytes, beginning ${JSON.stringify(snippet(response.body))}`;
}

/**
 * The `value` of the hostname pane's `<input name="hostname">`.
 *
 * `undefined` means the input is not in the body at all; `""` means it is
 * there and empty. The two get different failure lines, because they are
 * different bugs -- a missing field is the wrong pane, an empty field is a
 * device whose hostname setting did not come back from mosd.
 *
 * No entity decoding: `valid_hostname` admits letters, digits and hyphens
 * only, so a value that needed decoding would already be a finding.
 */
export function hostnameInputValue(body: string): string | undefined {
  for (const tag of body.match(/<input\b[^>]*>/gi) ?? []) {
    if (!/\bname="hostname"/i.test(tag)) continue;
    return /\bvalue="([^"]*)"/i.exec(tag)?.[1] ?? "";
  }
  return undefined;
}

/** The `error` object out of an `/api/` envelope, or undefined if there isn't one. */
function errorObjectOf(parsed: unknown): Record<string, unknown> | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const error = (parsed as Record<string, unknown>)["error"];
  if (typeof error !== "object" || error === null || Array.isArray(error)) return undefined;
  return error as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// the phase
// ---------------------------------------------------------------------------

const phase: Phase = {
  id: "04-readonly",
  title: "read-only surface: the panes, the reserved /api/ envelope, the fallback and traversal contract, and the POST-only guards",
  assumes:
    "phase 03 left a VALID SESSION in the client's jar and the device out of setup mode, " +
    "so the gate admits these requests rather than redirecting them to /login or /setup; " +
    "and that NO custom UI bundle is active at /srv/ui, which docs/design/api.md §5.2 " +
    "calls the shipped state of every device. The bundle-less assumption is not incidental: " +
    "with a bundle active, `/` would serve the bundle's index instead of the Status pane and " +
    "the fallback rows below would be decided by asset_path::resolve rather than by §4.2's " +
    "conditions, so every assertion in sections 1 and 3 would be asserting a different contract.",

  async run(ctx: PhaseContext) {
    const { client, report } = ctx;

    // A second client, never logged in. Its jar starts empty and this phase
    // never posts credentials with it, so it stays that way -- which is what
    // makes it usable as the "an anonymous caller sees the gate" probe.
    const anonymous = new Client(ctx.config);

    await assertPanes(ctx);
    await assertApiSubtree(ctx, anonymous);
    await assertFallbackAndTraversal(ctx);
    await assertPostOnlyGuards(ctx);
    await assertBuiltin(ctx, anonymous);
    await assertImageSkewGuard(ctx);

    // The anonymous client must still be anonymous, or every 303 above was
    // asserted against a client that might have had a session all along.
    report.check(
      anonymous.jar.get("apid_session") === undefined,
      "the unauthenticated probe client never acquired a session, so its 303s were genuinely anonymous",
      [
        `expected: an empty jar on the probe client`,
        `actual:   it holds ${anonymous.jar.names().join(", ") || "nothing"}`,
      ].join("\n"),
    );

    // And the session-bearing client must STILL hold its session: a phase that
    // silently lost the cookie would hand 05-mutate a broken assumption, and
    // 05's failures would read as 05's bugs.
    report.check(
      client.jar.get("apid_session") !== undefined,
      "the session survived this phase, so 05-mutate inherits the session 03-login left",
      [
        `expected: apid_session still in the jar`,
        `actual:   the jar holds ${client.jar.names().join(", ") || "nothing"}`,
      ].join("\n"),
    );
  },
};

// ---------------------------------------------------------------------------
// 1. panes
// ---------------------------------------------------------------------------

async function assertPanes(ctx: PhaseContext): Promise<void> {
  const { client, report } = ctx;
  report.note("  -- 1. the panes: 200 is not the assertion, the body is");

  for (const pane of PANES) {
    const response = await client.get(pane.path);
    report.expectStatus(response, 200, `GET ${pane.path} answers 200`);
    report.expectHeaderMatches(
      response,
      "content-type",
      HTML_CONTENT_TYPE,
      `GET ${pane.path} is typed as HTML`,
    );
    report.expectBodyContains(
      response,
      pane.marker,
      `GET ${pane.path} renders ITS OWN pane and not another: the body carries ${pane.markerName}`,
    );
  }

  // The hostname pane, whose marker cannot be a literal: the device's name is
  // whatever 02-setup gave it, and 05-mutate is about to change it. Asserting
  // a hardcoded name here would either be asserting 02's input twice or would
  // go red the moment the setup password/hostname defaults were changed.
  const hostnamePane = await client.get("/hostname");
  report.expectStatus(hostnamePane, 200, "GET /hostname answers 200");
  report.expectHeaderMatches(
    hostnamePane,
    "content-type",
    HTML_CONTENT_TYPE,
    "GET /hostname is typed as HTML",
  );

  const current = hostnameInputValue(hostnamePane.body);
  report.check(
    current !== undefined,
    'GET /hostname renders ITS OWN pane and not another: the body carries an <input name="hostname">',
    [
      `expected: an <input> tag carrying name="hostname"`,
      `actual:   no such input in ${describeBody(hostnamePane)}`,
    ].join("\n"),
  );
  report.check(
    current !== undefined && current !== "",
    "the hostname pane pre-fills the device's CURRENT hostname (a non-empty value attribute)",
    [
      `expected: a non-empty value="..." on the hostname input`,
      `actual:   ${current === undefined ? "the input was absent entirely" : 'value="" -- the input is there but carries no hostname'}`,
    ].join("\n"),
  );

  // Offered to later phases, required by none: 05-mutate renames the device
  // and may want to know what it was called first. Left here rather than in a
  // shared file so that this phase remains the only file this subtask edits.
  if (current !== undefined && current !== "") ctx.state.set("04-readonly:hostname", current);
}

// ---------------------------------------------------------------------------
// 2. the reserved /api/ subtree
// ---------------------------------------------------------------------------

async function assertApiSubtree(ctx: PhaseContext, anonymous: Client): Promise<void> {
  const { client, report } = ctx;
  report.note("  -- 2. the reserved /api/ subtree and its 404 envelope");

  for (const target of API_TARGETS) {
    // raw(), because the /api vs /api/ split IS a path-shape assertion: the
    // trailing slash is the entire difference between the two declarations in
    // routes.rs, and a client that normalised it away would collapse the two
    // cases into one and still print two PASS lines.
    const response = await client.raw(target);

    report.expectStatus(response, 404, `GET ${target} answers 404 from the reserved subtree`);
    report.expectHeader(
      response,
      "content-type",
      "application/json",
      `GET ${target} is typed application/json, never HTML`,
    );
    report.expectHeader(
      response,
      "cache-control",
      "no-store",
      `GET ${target} carries Cache-Control: no-store (§4.3 makes that EVERY /api/ response, not only the successful ones)`,
    );

    let parsed: unknown;
    let parseError: string | undefined;
    try {
      parsed = JSON.parse(response.body);
    } catch (error) {
      parseError = String(error);
    }
    const errorObject = errorObjectOf(parsed);
    const actual =
      parseError !== undefined
        ? `a body that is not JSON (${parseError}): ${describeBody(response)}`
        : errorObject === undefined
          ? `JSON with no object under "error": ${JSON.stringify(snippet(response.body))}`
          : `error = ${JSON.stringify(errorObject)}`;

    report.check(
      errorObject !== undefined,
      `GET ${target} returns a body that parses as JSON and carries an "error" object`,
      [`expected: {"error":{...}}`, `actual:   ${actual}`].join("\n"),
    );
    report.check(
      errorObject?.["code"] === "not_found",
      `GET ${target}: error.code is "not_found"`,
      [`expected: error.code === "not_found"`, `actual:   ${actual}`].join("\n"),
    );
    report.check(
      errorObject?.["source"] === "apid",
      `GET ${target}: error.source is "apid", so a client knows the daemon answered and not a proxy`,
      [`expected: error.source === "apid"`, `actual:   ${actual}`].join("\n"),
    );

    // Ends-with, not equals. The envelope's wording is `no API route at
    // <path>`, but the contract-bearing half is the PATH: it is what tells a
    // client which of its requests was refused, and it is the half that would
    // silently break if `OriginalUri` were ever swapped for the nested `Uri`
    // (which would report `/versions`, not `/api/versions`).
    const message = errorObject?.["message"];
    report.check(
      typeof message === "string" && message.endsWith(target),
      `GET ${target}: error.message ends in the requested path, so the refusal names what was refused`,
      [
        `expected: a string message ending in ${JSON.stringify(target)}`,
        `actual:   ${actual}`,
      ].join("\n"),
    );

    // §2.4 defines `path` as the settings dot-path at fault. A request that
    // matched no route has no dot-path, so an envelope carrying one would be
    // telling a client to look at a setting that has nothing to do with this.
    report.check(
      errorObject !== undefined && !Object.hasOwn(errorObject, "path"),
      `GET ${target}: the envelope carries NO error.path (§2.4 reserves it for the settings dot-path at fault, and a route miss has none)`,
      [`expected: no "path" key inside "error"`, `actual:   ${actual}`].join("\n"),
    );
  }

  // The gate wraps `/api/` exactly as it wraps everything but `/healthz`. An
  // API client that saw the 404 envelope above and concluded "the prefix is
  // reserved but open" would be wrong, and would misread its own 303s as
  // routing bugs. `/healthz` is the ONLY unauthenticated route.
  const gated = await anonymous.raw("/api/versions", { sendCookies: false });
  report.expectStatus(
    gated,
    303,
    "an UNAUTHENTICATED GET /api/versions is 303 to the login page, not the 404 envelope: the gate wraps the reserved subtree too",
  );
  report.expectHeader(
    gated,
    "location",
    "/login",
    "the unauthenticated /api/versions redirect names /login",
  );
}

// ---------------------------------------------------------------------------
// 3. the fallback and the traversal contract
// ---------------------------------------------------------------------------

async function assertFallbackAndTraversal(ctx: PhaseContext): Promise<void> {
  const { client, report } = ctx;
  report.note(
    "  -- 3. the static-asset fallback (§4.2). NOT §4.4's guards: with no bundle",
  );
  report.note(
    "        active, asset_path::resolve is never called and no guard executes.",
  );

  for (const row of FALLBACK_ROWS) {
    // raw() for both columns. fetch() rewrites `..` and `%2e%2e` before the
    // wire, so these targets have to be written onto the socket by hand or
    // the assertion is about bun's URL parser.
    const html = await client.raw(row.target, { headers: { Accept: "text/html" } });
    report.expectStatus(
      html,
      row.withHtml,
      `GET ${row.target} with Accept: text/html -> ${row.withHtml} (${row.because})`,
    );

    const any = await client.raw(row.target, { headers: { Accept: "*/*" } });
    report.expectStatus(
      any,
      row.withAny,
      `GET ${row.target} with Accept: */* -> ${row.withAny} (offers_html() is FALSE for */*, so no fallback HTML is ever produced for it)`,
    );

    if (row.withHtml === 200) {
      report.expectHeaderMatches(
        html,
        "content-type",
        HTML_CONTENT_TYPE,
        `GET ${row.target} with Accept: text/html is typed as HTML`,
      );
      report.expectBodyContains(
        html,
        "Network state",
        `GET ${row.target} with Accept: text/html serves the BUILT-IN Status pane -- the SPA fallback, reached without touching the filesystem`,
      );
    }

    // Every 404 in this table is empty-bodied by construction: serve.rs's
    // `not_found()` builds `asset_response(Vec::new(), None, ..)`. Asserting
    // no HTML comes back is §4.2's own acceptance property -- "a request that
    // a developer expected to be JSON never returns HTML" -- and it is the
    // half of the */* column that a bare status check would miss.
    for (const [label, response, expected] of [
      ["text/html", html, row.withHtml],
      ["*/*", any, row.withAny],
    ] as const) {
      if (expected !== 404) continue;
      report.check(
        !response.body.includes("<"),
        `GET ${row.target} with Accept: ${label} refuses with an EMPTY body, never an HTML error page`,
        [
          `expected: a body carrying no markup at all`,
          `actual:   ${describeBody(response)}`,
        ].join("\n"),
      );
    }
  }

  // The assertion that would actually catch a traversal.
  //
  // `/../../etc/passwd` answering 200 is CORRECT: `active_root` is `None`, so
  // no path was ever resolved against a filesystem, and §4.2 condition 5 hands
  // back the built-in UI. The status code alone cannot tell that apart from a
  // 200 carrying /etc/passwd. This can, and it is the check worth having.
  const traversal = await client.raw("/../../etc/passwd", {
    headers: { Accept: "text/html" },
  });
  for (const sign of PASSWD_SIGNS) {
    report.check(
      !traversal.body.includes(sign),
      `the 200 from /../../etc/passwd is the SPA fallback and not a passwd file: its body contains no ${JSON.stringify(sign)}`,
      [
        `expected: no ${JSON.stringify(sign)} anywhere in the body`,
        `actual:   it is present in ${describeBody(traversal)}`,
      ].join("\n"),
    );
  }

  // §4.2 condition 2: the method is checked before the Accept header, before
  // the path shape and before any bundle lookup, so this 405 does not depend
  // on any of them.
  const posted = await client.raw("/no-such-route", { method: "POST", body: "" });
  report.expectStatus(
    posted,
    405,
    "POST to a fallback path (/no-such-route) -> 405: §4.2 condition 2 checks the method before anything else",
  );
  report.expectHeader(
    posted,
    "allow",
    "GET, HEAD",
    "the fallback's 405 names the methods it does admit (Allow: GET, HEAD)",
  );
}

// ---------------------------------------------------------------------------
// 4. the POST-only guards
// ---------------------------------------------------------------------------

async function assertPostOnlyGuards(ctx: PhaseContext): Promise<void> {
  const { client, report } = ctx;
  report.note("  -- 4. the POST-only guards, and the machine still being up afterwards");

  // The two power actions first, each followed straight away by /healthz.
  //
  // A 405 says the ROUTER refused the GET. It does not say the handler was not
  // reached -- a route that had grown a GET handler which fired and then
  // returned the wrong status would look identical from here. A live /healthz
  // immediately afterwards says the machine is still running, which is the
  // only observation that distinguishes "refused" from "obeyed", and it is the
  // one that cannot be argued with.
  for (const [path, action] of [
    ["/power/reboot", "reboot"],
    ["/power/poweroff", "power the appliance off"],
  ] as const) {
    const refused = await client.get(path);
    report.expectStatus(
      refused,
      405,
      `GET ${path} -> 405: no GET handler exists, so no prefetch, crawler or mis-clicked link can ${action}`,
    );

    const health = await client.get("/healthz");
    report.expectStatus(
      health,
      200,
      `the device is STILL RUNNING after GET ${path} was refused (/healthz answers 200)`,
    );
  }

  for (const path of POST_ONLY) {
    const refused = await client.get(path);
    report.expectStatus(
      refused,
      405,
      `GET ${path} -> 405: the route is declared POST-only and no GET handler exists`,
    );
  }
}

// ---------------------------------------------------------------------------
// 5. /builtin and /builtin/
// ---------------------------------------------------------------------------

async function assertBuiltin(ctx: PhaseContext, anonymous: Client): Promise<void> {
  const { client, report } = ctx;
  report.note("  -- 5. /builtin and /builtin/: both spellings, one pane");

  // raw() for both: the trailing slash IS the assertion. `nest("/builtin", ..)`
  // claims `/builtin` and NOT `/builtin/`, which is why routes.rs declares the
  // slashed spelling a second time outside the nest. §6.3 asks for ONE
  // unconditional path to the built-in UI, and an operator recovering a device
  // -- who is reading the slashed spelling out of the design document -- should
  // not have to get the slash right. A client that normalised the difference
  // would test one spelling twice.
  for (const target of ["/builtin", "/builtin/"] as const) {
    const response = await client.raw(target);
    report.expectStatus(response, 200, `GET ${target} answers 200`);
    report.expectHeaderMatches(
      response,
      "content-type",
      HTML_CONTENT_TYPE,
      `GET ${target} is typed as HTML`,
    );
    report.expectBodyContains(
      response,
      STATUS_HEADING,
      `GET ${target} renders the Status pane`,
    );
    report.expectBodyContains(
      response,
      BUILTIN_MARKER,
      `GET ${target} renders §6.3's escape control, so both spellings reach the SAME pane`,
    );
  }

  // ...and the shared marker above is a marker, not something every pane has:
  // `/` renders `pane("Status", status_body(..))` with no escape section, and
  // routes.rs says that is deliberate -- `/` is conditional and stays
  // conditional, and the escape control belongs on the unconditional path.
  // Without this line, "both spellings render the same pane" would be
  // satisfied by both of them rendering any Status pane at all.
  const root = await client.get("/");
  report.check(
    !root.body.includes(BUILTIN_MARKER),
    `GET / does NOT render the escape control, so ${JSON.stringify(BUILTIN_MARKER)} identifies /builtin specifically and not "any Status pane"`,
    [
      `expected: the escape section on /builtin only`,
      `actual:   / also carries ${JSON.stringify(BUILTIN_MARKER)}, so the marker above proves nothing`,
    ].join("\n"),
  );

  // Gated like everything else except /healthz. §6.3's prefix is a way IN to
  // the built-in UI for an authenticated operator; it is not a hole.
  const gated = await anonymous.raw("/builtin/", { sendCookies: false });
  report.expectStatus(
    gated,
    303,
    "an UNAUTHENTICATED GET /builtin/ is 303 to the login page: §6.3's prefix is gated like every other route except /healthz",
  );
  report.expectHeader(
    gated,
    "location",
    "/login",
    "the unauthenticated /builtin/ redirect names /login",
  );
}

// ---------------------------------------------------------------------------
// 6. the image-skew guard
// ---------------------------------------------------------------------------

/**
 * Routes that exist in THIS TREE's routes.rs but not in the running image.
 *
 * This is under-coverage that announces itself, and the reason it is a CHECK
 * rather than a sentence in a report is that a sentence in a report is read
 * once. Measured 2026-08-24: the image under test is built from a tree at or
 * before 67b999b; local main gained `.route("/mqtt", get(mqtt_form))` and
 * `.route("/mqtt/enable", post(mqtt_enable))` at ddf3a86, 12:07, AFTER the
 * image was built at 10:48. So this branch has the routes, the device does
 * not, and `PANES` and `POST_ONLY` above correctly omit them.
 *
 * The assertions are therefore that these paths behave as the FALLBACK, which
 * is the truth about the device today. They are chosen to be the two that
 * CANNOT both survive the routes arriving:
 *
 *   - `GET /mqtt` with `Accept: *\/*` is 404 only because §4.2 condition 3
 *     refuses to make HTML for a wildcard range. A real `get(mqtt_form)`
 *     ignores `Accept` entirely and answers 200. (The `text/html` column is
 *     deliberately NOT asserted: the SPA fallback and a real pane BOTH return
 *     200 there, so it would prove nothing either way.)
 *   - `POST /mqtt/enable` is 405 only because §4.2 condition 2 checks the
 *     method before anything else. A real `post(mqtt_enable)` answers 303, or
 *     400, or anything but 405.
 *
 * When somebody rebuilds the image from a newer main, both go red at once and
 * the failure detail says what to do about it.
 */
const SKEWED_ROUTES_HINT =
  "the image now serves /mqtt; add it to PANES and /mqtt/enable to POST_ONLY in 04-readonly, then update this guard.";

async function assertImageSkewGuard(ctx: PhaseContext): Promise<void> {
  const { client, report } = ctx;
  report.note(
    "  -- 6. the image-skew guard: routes this TREE has that the running IMAGE does not",
  );

  const wildcard = await client.raw("/mqtt", { headers: { Accept: "*/*" } });
  report.check(
    wildcard.status === 404,
    "GET /mqtt with Accept: */* -> 404: the running image has NO /mqtt route, so this is the static-asset fallback and not a pane",
    [
      `expected: 404 -- §4.2 condition 3 refuses to produce HTML for a wildcard range,`,
      `          which is the only reason an unrouted path 404s here.`,
      `actual:   ${wildcard.status}${describeBody(wildcard)}`,
      ``,
      `THIS IS AN IMAGE-SKEW GUARD, NOT A DEFECT IN apid. A 200 means the device`,
      `now HAS the route -- local main added /mqtt at ddf3a86 (12:07 2026-08-24),`,
      `after the image under test was built (10:48). So:`,
      `  ${SKEWED_ROUTES_HINT}`,
    ].join("\n"),
  );

  const enable = await client.post("/mqtt/enable", { enabled: checkbox(true) });
  report.check(
    enable.status === 405,
    "POST /mqtt/enable -> 405: the running image has NO /mqtt/enable route, so the fallback refuses it on the method",
    [
      `expected: 405 -- §4.2 condition 2 checks the method before anything else,`,
      `          so an unrouted path refuses a POST without looking at the body.`,
      `actual:   ${enable.status}${describeBody(enable)}`,
      ``,
      `THIS IS AN IMAGE-SKEW GUARD, NOT A DEFECT IN apid. Anything but 405 means`,
      `a real post(mqtt_enable) answered, i.e. the image is newer than the one`,
      `this phase was written against. So:`,
      `  ${SKEWED_ROUTES_HINT}`,
    ].join("\n"),
  );
}

export default phase;
