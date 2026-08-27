/**
 * Phase 04 -- the read-only surface: the panes, the reserved `/api/` subtree,
 * the static-asset fallback, the path-traversal contract and the POST-only
 * guards.
 *
 * Nothing here changes the device. Every request is a GET, bar two that are
 * read-only in effect: a `POST` to a fallback path, which `serve::fallback`
 * refuses on the method first, and the `GET`s aimed at POST-only mutation
 * routes, which prove a GET reaches no handler. Mutation belongs in 05-mutate.
 *
 * Every path-shape assertion goes through `client.raw()`: `fetch()` normalises
 * `..` and `%2e%2e` before the request leaves the process (measured 2026-08-24,
 * held by the selftest), so a probe issued through `fetch` tests bun, not apid.
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

// 1. The panes

interface Pane {
  readonly path: string;
  /**
   * A string only this pane renders, never a word the nav bar also carries: the
   * gate is a `middleware::from_fn` over every route, so a misfire that served
   * the wrong pane still answers 200 with `text/html`, and "Network", "Power",
   * "SSH" and "Containers" render into all six panes.
   */
  readonly marker: string;
  /** Named in the check text, so a red line says what was looked for. */
  readonly markerName: string;
}

/**
 * The declared, session-gated GET panes and the string identifying each.
 *
 * `/` is NOT here: the harness seeds a UI bundle (see section 3), so `/` is
 * §4.1's one exception and serves the active bundle's `index.html` rather
 * than a pane. Section 3 asserts it against the fixture byte for byte.
 * `/network` uses the unconditional "Add interface" legend, because the
 * per-interface forms are conditional on there being interfaces (the empty
 * branch is `p { "No interfaces configured." }`). `/power` uses its one
 * unconditional opening sentence rather than the confirm tokens its forms
 * carry, which would couple a read-only phase to a control it must never
 * submit. `/hostname` is handled below: its marker is the current hostname,
 * which cannot be hardcoded, so the assertion is that the field is present
 * and non-empty.
 */
const PANES: readonly Pane[] = [
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

// 2. The reserved /api/ subtree

/**
 * Targets that must all produce `api_not_found`'s envelope.
 *
 * `/api` and `/api/` are both here, and the pair is the point.
 * `nest("/api", ..)` claims `/api`, `/api/x` and `/api/x/y` and **not** `/api/`,
 * which is why routes.rs declares `/api/` a second time with
 * `any(api_not_found)` immediately after the nest. Drop that second
 * declaration and `/api/` falls through to the asset router -- a request
 * beginning `/api/` answered by the SPA fallback, which api.md §4.1 rule 1
 * forbids. Over the wire is the only place that split is observable: from
 * inside the router both spellings look like the same prefix.
 */
const API_TARGETS: readonly string[] = [
  "/api/",
  "/api",
  "/api/versions",
  "/api/v1/settings",
  "/api/deeply/nested/thing",
];

// 3. The static-asset fallback and path traversal

interface FallbackRow {
  readonly target: string;
  /** Expected status for `Accept: text/html`. */
  readonly withHtml: 200 | 404;
  /**
   * Expected status for `Accept: * / *`, always 404: `offers_html()` is true
   * only for a range of exactly `text/html` or `text/*`. That wildcard range --
   * spelled out rather than written literally, because the literal three
   * characters would close this comment -- is curl's default and this client's,
   * so running the table with a default client returns 404 for every row and
   * greens six checks that reached none of the code they name. Both columns are
   * asserted for every row, always.
   */
  readonly withAny: 404;
  /**
   * What decides this row, quoted in the check text. With the harness's
   * bundle active, `asset_path::resolve` runs FIRST: a §4.4 guard firing is a
   * 404 for both columns (`eligible_for_fallback` is false for every guard),
   * and only a well-formed miss (`Rejection::NotFound`) falls through to
   * §4.2's conditions 3-5.
   */
  readonly because: string;
}

/**
 * The fallback and traversal contract, both columns, in the shape
 * `serve::respond` produces it with the harness's bundle active.
 *
 * run.sh seeds `test/apid-api/fixture/ui-bundle` into DATA at
 * `/srv/ui/.staging-1` before the first boot and apid's start-up activates
 * it, so `active_root(..)` is `Some` and `asset_path::resolve()` -- the
 * function holding the dot-segment, residual-escape, NUL and
 * escaped-separator rejections and the canonicalised-root containment
 * assertion -- executes for every row here. Before that fixture existed the
 * phase said so in this comment's place: with no bundle at `/srv/ui` not one
 * line of §4.4 runs and the 404s all come from §4.2 conditions 3 and 4.
 *
 * The distinguishing row is `/../../etc/passwd` under `text/html`: bundle-less
 * it was 200 (the SPA fallback -- nothing ever touched a filesystem), and a
 * regression that skipped the guards would make it 200 again (the bundle's
 * index via condition 5). 404 here is over-the-wire proof the `..` rejection
 * fired. The anchor assertions before the table prove the bundle is active,
 * without which every 404 below would prove nothing.
 */
const FALLBACK_ROWS: readonly FallbackRow[] = [
  {
    target: "/../../etc/passwd",
    withHtml: 404,
    withAny: 404,
    because:
      "resolve() rejects the '..' components (ParentDir), no guard rejection is eligible for the fallback -- bundle-less this was 200, so this 404 IS the guard executing",
  },
  {
    target: "/%2e%2e%2fetc%2fpasswd",
    withHtml: 404,
    withAny: 404,
    because:
      "decodes once to '/../etc/passwd', so the dot-segment rejection (ParentDir) fires on the decoded form",
  },
  {
    target: "/%252e%252e%2fetc%2fpasswd",
    withHtml: 404,
    withAny: 404,
    because:
      "double-encoded: a '%' survives the single decode pass, so the residual-escape rejection fires rather than a second decode",
  },
  {
    target: "/x%00y",
    withHtml: 404,
    withAny: 404,
    because: "decodes to a NUL byte, which rule 4 rejects explicitly (Nul)",
  },
  {
    target: "/no-such-route",
    withHtml: 200,
    withAny: 404,
    because:
      "a well-formed miss (NotFound) is the ONE rejection eligible for the fallback: condition 5 serves the bundle's index under text/html, condition 3 refuses */*",
  },
  {
    target: "/no-such-asset.js",
    withHtml: 404,
    withAny: 404,
    because:
      "a well-formed miss, but the last segment carries a '.', so §4.2 condition 4 reads it as a filename",
  },
];

/**
 * Signs that the appliance's real passwd file reached the client.
 *
 * Asserted absent from every 200 this section observes -- the bundle root,
 * the SPA fallback and the in-bundle `etc/passwd` decoy. The fixture is
 * written to contain none of these strings, so one appearing means a real
 * file escaped the bundle root, which the status code alone would not say.
 */
const PASSWD_SIGNS: readonly string[] = ["root:", "/bin/", ":x:0:0:"];

// The fixture the harness seeds, read from the same tree run.sh seeds it
// from, so the expected bodies below cannot drift from what is on the disk.
// Read lazily inside the phase: an unreadable fixture must fail the phase
// with its path in the line, not kill the whole suite at import time.

/** Root of the seeded bundle fixture, relative to this file. */
const FIXTURE_ROOT = new URL("../../fixture/ui-bundle/", import.meta.url);

async function fixtureText(relative: string): Promise<string | undefined> {
  try {
    return await Bun.file(new URL(relative, FIXTURE_ROOT)).text();
  } catch {
    return undefined;
  }
}

// 4. The POST-only guards

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
 * `/power/reboot` and `/power/poweroff` are deliberately not in this list:
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

// 5. /builtin and /builtin/

/**
 * The escape section's legend and button label, rendered by `escape_section()`
 * and therefore by `builtin_home` alone.
 *
 * `home` -- the handler behind `/` and behind the SPA fallback -- does not
 * render it: `/` is conditional and stays conditional, and the escape control
 * belongs on the pane reachable unconditionally. That makes this string a
 * marker for `/builtin` specifically rather than for "some Status pane", which
 * is what the "same pane" assertion needs.
 */
const BUILTIN_MARKER = "Deactivate the custom UI";

/** Both `/builtin` spellings render `pane("Status", ..)`, hence this `h1`. */
const STATUS_HEADING = "<h1>Status</h1>";

// helpers

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

// the phase

const phase: Phase = {
  id: "04-readonly",
  title: "read-only surface: the panes, the reserved /api/ envelope, the fallback and traversal contract, and the POST-only guards",
  assumes:
    "phase 03 left a VALID SESSION in the client's jar and the device out of setup mode, " +
    "so the gate admits these requests rather than redirecting them to /login or /setup; " +
    "and that run.sh seeded test/apid-api/fixture/ui-bundle into DATA at /srv/ui/.staging-1 " +
    "before the first boot, so apid's start-up activated it and a custom UI bundle IS active. " +
    "The bundle is not incidental: with one active, `/` serves the bundle's index and the " +
    "fallback rows are decided by asset_path::resolve -- the function holding §4.4's traversal " +
    "guards -- before §4.2's conditions, which is the entire point (RFCT-141): bundle-less, " +
    "not one line of the guard set executes over the wire. Section 3 asserts the bundle is " +
    "active before trusting any traversal row.",

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

    // And the session-bearing client must still hold its session: a phase that
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

// 1. panes

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

// 2. the reserved /api/ subtree

async function assertApiSubtree(ctx: PhaseContext, anonymous: Client): Promise<void> {
  const { client, report } = ctx;
  report.note("  -- 2. the reserved /api/ subtree and its 404 envelope");

  for (const target of API_TARGETS) {
    // raw(), because the /api vs /api/ split is a path-shape assertion: the
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
    // <path>`, but the contract-bearing half is the path: it is what tells a
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
  // API client that read the 404 envelope above as "the prefix is reserved but
  // open" would misread its own 303s as routing bugs. `/healthz` is the only
  // unauthenticated route.
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

// 3. the fallback and the traversal contract

async function assertFallbackAndTraversal(ctx: PhaseContext): Promise<void> {
  const { client, report } = ctx;
  report.note(
    "  -- 3. the fallback AND §4.4's traversal guards: the seeded bundle makes",
  );
  report.note(
    "        asset_path::resolve execute for every probe below (RFCT-141).",
  );

  // The anchors, before any traversal row is trusted. Every guard rejection
  // is a 404, and a bundle-less device also answers most of these rows 404 --
  // via §4.2's conditions, with the guards never executing. So first prove
  // the bundle is active, by the two observations only an active bundle can
  // produce: `/` serving the fixture's index byte for byte, and an in-bundle
  // asset coming back byte for byte. After these, a 404 from a hostile row is
  // evidence about the guards and not about an empty /srv/ui.
  const expectedIndex = await fixtureText("index.html");
  const expectedAsset = await fixtureText("assets/app.js");
  const expectedDecoy = await fixtureText("etc/passwd");
  report.check(
    expectedIndex !== undefined && expectedAsset !== undefined && expectedDecoy !== undefined,
    "the fixture at test/apid-api/fixture/ui-bundle is readable from inside the suite container",
    [
      `expected: index.html, assets/app.js and etc/passwd under ${FIXTURE_ROOT.pathname}`,
      `actual:   ${[
        expectedIndex === undefined ? "index.html unreadable" : undefined,
        expectedAsset === undefined ? "assets/app.js unreadable" : undefined,
        expectedDecoy === undefined ? "etc/passwd unreadable" : undefined,
      ]
        .filter((part) => part !== undefined)
        .join(", ")}`,
    ].join("\n"),
  );

  const root = await client.get("/");
  report.expectStatus(root, 200, "GET / answers 200");
  report.expectHeaderMatches(root, "content-type", HTML_CONTENT_TYPE, "GET / is typed as HTML");
  report.check(
    expectedIndex !== undefined && root.body === expectedIndex,
    "GET / serves the ACTIVE BUNDLE's index.html byte for byte -- the seeded fixture was activated at start-up, so §4.4's guards are live for every row below",
    [
      `expected: the exact content of test/apid-api/fixture/ui-bundle/index.html`,
      `actual:   ${describeBody(root)}`,
      ``,
      `A Status pane here means NO bundle is active: either run.sh's DATA seeding`,
      `step did not run, or apid's start-up refused the staged tree (the console`,
      `log would carry the refusal). Every traversal 404 below would then be`,
      `§4.2's conditions answering, not the guards, and this phase says so here`,
      `rather than printing green rows about code that never ran.`,
    ].join("\n"),
  );

  const asset = await client.raw("/assets/app.js", { headers: { Accept: "*/*" } });
  report.expectStatus(
    asset,
    200,
    "GET /assets/app.js -> 200: asset_path::resolve's happy path serves an in-bundle file (the same function whose guards the rows below probe)",
  );
  report.check(
    expectedAsset !== undefined && asset.body === expectedAsset,
    "GET /assets/app.js returns the fixture's asset byte for byte",
    [
      `expected: the exact content of test/apid-api/fixture/ui-bundle/assets/app.js`,
      `actual:   ${describeBody(asset)}`,
    ].join("\n"),
  );

  // The decoy: rule 3 observed over the wire. `/etc/passwd` decodes to an
  // absolute-looking path; resolve() strips the leading separators and joins
  // the remaining components under the bundle root, so it must land on the
  // bundle's own `etc/passwd` and never on the appliance's. A body equal to
  // the fixture file is the join-not-concatenate semantics; a body carrying
  // any PASSWD_SIGNS entry is the escape the guards exist to stop.
  const decoy = await client.raw("/etc/passwd", { headers: { Accept: "*/*" } });
  report.expectStatus(
    decoy,
    200,
    "GET /etc/passwd -> 200: the absolute-looking path resolves INSIDE the bundle, to its etc/passwd decoy (rule 3: leading separators stripped, components joined)",
  );
  report.check(
    expectedDecoy !== undefined && decoy.body === expectedDecoy,
    "GET /etc/passwd returns the bundle's decoy byte for byte, not the appliance's passwd",
    [
      `expected: the exact content of test/apid-api/fixture/ui-bundle/etc/passwd`,
      `actual:   ${describeBody(decoy)}`,
    ].join("\n"),
  );
  for (const sign of PASSWD_SIGNS) {
    report.check(
      !decoy.body.includes(sign),
      `the /etc/passwd body carries no ${JSON.stringify(sign)} -- no real passwd file escaped the bundle root`,
      [
        `expected: no ${JSON.stringify(sign)} anywhere in the body`,
        `actual:   it is present in ${describeBody(decoy)}`,
      ].join("\n"),
    );
  }

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
      report.check(
        expectedIndex !== undefined && html.body === expectedIndex,
        `GET ${row.target} with Accept: text/html serves the ACTIVE BUNDLE's index byte for byte -- §4.2 condition 5's SPA fallback, reached only because resolve() answered NotFound`,
        [
          `expected: the exact content of test/apid-api/fixture/ui-bundle/index.html`,
          `actual:   ${describeBody(html)}`,
        ].join("\n"),
      );
      for (const sign of PASSWD_SIGNS) {
        report.check(
          !html.body.includes(sign),
          `the 200 from ${row.target} carries no ${JSON.stringify(sign)} -- it is the SPA fallback and not a file that escaped the root`,
          [
            `expected: no ${JSON.stringify(sign)} anywhere in the body`,
            `actual:   it is present in ${describeBody(html)}`,
          ].join("\n"),
        );
      }
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

// 4. the POST-only guards

async function assertPostOnlyGuards(ctx: PhaseContext): Promise<void> {
  const { client, report } = ctx;
  report.note("  -- 4. the POST-only guards, and the machine still being up afterwards");

  // The two power actions first, each followed straight away by /healthz.
  //
  // A 405 says the router refused the GET. It does not say the handler was not
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

// 5. /builtin and /builtin/

async function assertBuiltin(ctx: PhaseContext, anonymous: Client): Promise<void> {
  const { client, report } = ctx;
  report.note("  -- 5. /builtin and /builtin/: both spellings, one pane");

  // raw() for both: the trailing slash is the assertion. `nest("/builtin", ..)`
  // claims `/builtin` and not `/builtin/`, which is why routes.rs declares the
  // slashed spelling a second time outside the nest. §6.3 asks for one
  // unconditional path to the built-in UI, and an operator recovering a device
  // reads the slashed spelling out of the design document, so neither spelling
  // may depend on getting the slash right. A client that normalised the
  // difference would test one spelling twice.
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

  // ...and the shared marker above stays a marker for /builtin alone. With
  // the harness's bundle active, `/` serves the bundle's index (section 3
  // asserted that byte for byte), so this line now checks the fixture's
  // hygiene: an index carrying the escape-control string would let a broken
  // /builtin pass the "same pane" assertion above by accident. The escape
  // control belongs on the unconditional path and nowhere else.
  const root = await client.get("/");
  report.check(
    !root.body.includes(BUILTIN_MARKER),
    `GET / does NOT carry the escape control, so ${JSON.stringify(BUILTIN_MARKER)} identifies /builtin specifically`,
    [
      `expected: the escape section on /builtin only`,
      `actual:   / also carries ${JSON.stringify(BUILTIN_MARKER)}, so the marker above proves nothing`,
    ].join("\n"),
  );

  // Gated like everything else except /healthz. §6.3's prefix is a way in to
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

// 6. the image-skew guard

/**
 * Routes this tree's routes.rs declares that the running image does not have.
 *
 * Measured 2026-08-24: the image is built from a tree at or before 67b999b, and
 * main gained `.route("/mqtt", get(mqtt_form))` and `.route("/mqtt/enable",
 * post(mqtt_enable))` at ddf3a86 12:07, after the image was built at 10:48, so
 * `PANES` and `POST_ONLY` correctly omit them. A check rather than a report
 * sentence, so both go red at once when the image is rebuilt from a newer main.
 * `GET /mqtt` under a wildcard `Accept` is 404 only because §4.2 condition 3
 * refuses HTML for that range, where a real `get(mqtt_form)` answers 200 (the
 * `text/html` column is deliberately not asserted -- the SPA fallback and a real
 * pane both return 200 there); `POST /mqtt/enable` is 405 only because §4.2
 * condition 2 checks the method first. Neither can survive the route arriving.
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
