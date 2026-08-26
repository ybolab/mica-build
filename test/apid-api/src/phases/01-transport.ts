/**
 * Phase 01 -- transport.
 *
 * Everything asserted here is invisible to an in-process test of apid's axum
 * `Router`, which calls handlers directly: no socket, so no certificate; no
 * second listener, so no :80 -> :443 redirect; no published port, so nothing
 * proves the daemon is reachable. This phase is purely about the wire, and runs
 * first because everything after it depends on the wire being what it claims.
 *
 * It is also the phase that establishes the device is unconfigured -- no
 * admin password hash exists yet -- which is the precondition phase 02
 * consumes and can only observe once per boot.
 */

import type { CertificateInfo, HttpResponse } from "../client.ts";
import type { Phase } from "../runner.ts";

/**
 * What the TLS handshake reports against a peer that signed its own
 * certificate: the chain is one certificate deep and that certificate is its
 * own issuer. Measured against apid 2026-08-24.
 */
const SELF_SIGNED_ERROR = "DEPTH_ZERO_SELF_SIGNED_CERT";

/** The port apid's HTTPS listener binds INSIDE the guest. See below. */
const GUEST_HTTPS_PORT = 443;

/**
 * Where phase 02 reads the gate's pre-setup redirect target from.
 *
 * 02's device-effect assertion is a DELTA -- the same request, from a client
 * with an empty jar, answered differently before and after setup. The "before"
 * half can only be observed on an unconfigured device, i.e. here, so it is
 * recorded rather than re-derived.
 */
export const GATE_TARGET_BEFORE_SETUP = "01-transport:gate-target-before-setup";

const phase: Phase = {
  id: "01-transport",
  title: "transport: the self-signed certificate, the :80 -> :443 redirect, and the setup-mode gate",
  assumes:
    "nothing but the boot -- this phase is first and takes no state from any other. " +
    "It assumes a guest that has just come up with apid listening on both published " +
    "ports and that has never completed /setup, so no admin password hash exists in " +
    "mosd's settings and the cookie jar is empty. It leaves the jar empty and records " +
    "one fact for phase 02: the redirect target the gate uses while the device is " +
    "still unconfigured.",

  async run(ctx) {
    const { client, report, config } = ctx;

    // -- 1. the certificate apid generated for itself ----------------------
    //
    // apid has no CA and is handed no certificate: on first boot it generates
    // one and writes it into its StateDirectory, then serves it. Nothing signs
    // it but itself, so a client that verifies against the system trust store
    // must reject it -- and the exact shape of that rejection is the evidence
    // that this is a self-signed leaf rather than, say, an unrelated chain
    // problem or a proxy in the path.
    let certificate: CertificateInfo | undefined;
    try {
      certificate = await client.inspectCertificate();
    } catch (error) {
      report.fail("the HTTPS listener completes a TLS handshake and presents a certificate", [
        `expected: a handshake with ${client.origin("https")} yielding a peer certificate`,
        `actual:   ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
      ].join("\n"));
    }

    if (certificate !== undefined) {
      const cert = certificate;
      report.check(
        cert.authorized === false,
        "the TLS certificate does NOT verify against the system trust store",
        [
          `expected: authorized=false -- nothing but apid signs apid's certificate`,
          `actual:   authorized=${cert.authorized}`,
          `note:     an authorized=true here would mean the peer is not the device's`,
          `          own listener, or that a proxy terminated TLS in front of it`,
        ].join("\n"),
      );

      report.check(
        cert.authorizationError === SELF_SIGNED_ERROR,
        `the handshake rejects the certificate as ${SELF_SIGNED_ERROR}, not as some other chain fault`,
        [
          `expected: authorizationError=${JSON.stringify(SELF_SIGNED_ERROR)}`,
          `actual:   ${JSON.stringify(cert.authorizationError ?? "<none reported>")}`,
        ].join("\n"),
      );

      // Subject == issuer IS what "self-signed" means. Asserting only the
      // authorizationError above would also accept a certificate signed by an
      // untrusted CA whose leaf happened to fail the same way.
      const subject = distinguishedName(cert.subject);
      const issuer = distinguishedName(cert.issuer);
      report.check(
        cert.subject !== undefined && subject === issuer,
        "the certificate's subject equals its issuer, which is what self-signed MEANS",
        [
          `expected: subject and issuer to be the same distinguished name`,
          `subject:  ${subject}`,
          `issuer:   ${issuer}`,
        ].join("\n"),
      );

      const validTo = cert.valid_to === undefined ? Number.NaN : Date.parse(cert.valid_to);
      report.check(
        Number.isFinite(validTo) && validTo > Date.now(),
        "the certificate is still inside its validity window",
        [
          `expected: valid_to in the future (now ${new Date().toISOString()})`,
          `actual:   valid_to=${JSON.stringify(cert.valid_to ?? "<absent>")}`,
          `          valid_from=${JSON.stringify(cert.valid_from ?? "<absent>")}`,
        ].join("\n"),
      );
    }

    // -- 2. the :80 -> :443 redirect, asserted and NEVER followed ----------
    //
    // apid answers plain HTTP with a 308 whose Location names the port it
    // listens on INSIDE the guest -- 443. From inside the guest that is the
    // correct answer. From here it is not: we reached :80 through a published
    // port forward, and the guest's own :443 is not an address that exists on
    // this side of it.
    //
    // So this asserts the Location and never calls follow() on it. A client
    // that follows blindly dials an unreachable authority, blocks until the
    // 15s timeout, and reports a connection failure -- which reads as "apid is
    // down" and costs an hour. `Client.follow` refuses cross-authority
    // Locations for the same reason; this phase simply never asks.
    for (const path of ["/", "/hostname"] as const) {
      const upgraded = await client.http(path);

      report.expectStatus(
        upgraded,
        308,
        `GET ${path} on the plain-HTTP listener is answered 308 -- the only 308 in apid's surface`,
      );
      report.expectHeaderMatches(
        upgraded,
        "location",
        /^https:\/\//,
        `the 308 for ${path} sends the caller to an https:// URL`,
      );

      const location = upgraded.headers.get("location");
      const target = parseAbsolute(location);
      report.check(
        target !== undefined && effectivePort(target) === GUEST_HTTPS_PORT,
        `the 308 for ${path} names the guest's own port ${GUEST_HTTPS_PORT}, not the forwarded port ${config.httpsPort} we dialled`,
        [
          `expected: a Location whose authority is on port ${GUEST_HTTPS_PORT} -- apid answers with`,
          `          the port it binds inside the guest, which is right from inside the`,
          `          guest and is NOT followable through a published port forward`,
          `actual:   ${location === undefined ? "<absent>" : JSON.stringify(location)}`,
        ].join("\n"),
      );
      report.check(
        target !== undefined && target.pathname === path,
        `the 308 for ${path} preserves the path it was asked for`,
        [
          `expected: a Location whose path is ${JSON.stringify(path)}`,
          `actual:   ${target === undefined ? `an unparseable Location ${JSON.stringify(location ?? "<absent>")}` : JSON.stringify(target.pathname)}`,
        ].join("\n"),
      );
    }

    // -- 3. /healthz, the one route the gate lets through -------------------
    //
    // Sent with cookies suppressed as well as with an empty jar, so this says
    // "unauthenticated" and not merely "we happen to have no cookie yet".
    const healthz = await client.get("/healthz", { sendCookies: false });
    report.expectStatus(
      healthz,
      200,
      "/healthz answers 200 with no session -- it is the ONLY route the gate lets through unauthenticated",
    );
    report.check(
      healthz.body.trim() !== "",
      "/healthz answers with a non-empty body, not a bare 200",
      [
        `expected: a body with content`,
        `actual:   ${healthz.body.length} bytes: ${JSON.stringify(healthz.body.slice(0, 120))}`,
      ].join("\n"),
    );

    // -- 4. setup mode is in force -----------------------------------------
    //
    // While no admin password hash exists, the gate sends EVERYTHING except
    // /healthz to /setup -- including /login. That last one is the interesting
    // case: a merely unauthenticated caller on a configured device is sent to
    // /login, so /login -> /setup is the observable that distinguishes an
    // UNCONFIGURED device from an unauthenticated one. Phase 02 needs the
    // former and would silently test the wrong thing against the latter.
    const gated: Array<{ readonly path: string; readonly what: string }> = [
      { path: "/", what: "the index" },
      { path: "/hostname", what: "an ordinary admin route" },
      {
        path: "/login",
        what: "the login page itself -- with no password hash to check against, even /login is herded to /setup, which is what proves the device is UNCONFIGURED rather than merely unauthenticated",
      },
    ];

    const unauthenticated: Array<{ readonly label: string; readonly response: HttpResponse }> = [
      { label: "GET /healthz", response: healthz },
    ];

    let observedGateTarget: string | undefined;
    for (const { path, what } of gated) {
      const response = await client.get(path);
      unauthenticated.push({ label: `GET ${path}`, response });
      report.expectStatus(response, 303, `GET ${path} is answered 303 with an empty jar (${what})`);
      report.expectHeader(
        response,
        "location",
        "/setup",
        `GET ${path} is redirected to /setup while the device has no admin password (${what})`,
      );
      if (path === "/") observedGateTarget = response.headers.get("location");
    }

    // -- 5. nothing minted a session on the way through the gate ------------
    //
    // A suite that only checked the status codes above would not notice a
    // session cookie falling out of the setup gate, which would hand an
    // unauthenticated caller a credential on a device that has no password.
    for (const { label, response } of unauthenticated) {
      report.check(
        response.setCookie.length === 0,
        `${label} sets no cookie -- no session is minted before setup`,
        [
          `expected: no Set-Cookie header at all`,
          `actual:   ${response.setCookie.length} Set-Cookie line(s): ${JSON.stringify(response.setCookie)}`,
        ].join("\n"),
      );
    }
    report.check(
      client.jar.get("apid_session") === undefined,
      "the cookie jar is still empty after the whole unauthenticated sweep",
      [
        `expected: no apid_session in the jar`,
        `actual:   cookies held: ${client.jar.names().join(", ") || "none"}`,
      ].join("\n"),
    );

    // The one fact phase 02 takes from here. Nothing else is stored: every
    // other observation above is re-derivable, this one is not, because after
    // 02 succeeds the device can never be unconfigured again this boot.
    ctx.state.set(GATE_TARGET_BEFORE_SETUP, observedGateTarget ?? "/setup");
  },
};

// helpers

/** A stable, printable rendering of a certificate's subject or issuer. */
function distinguishedName(name: unknown): string {
  if (name === null || name === undefined || typeof name !== "object") return "<absent>";
  const parts = Object.entries(name as Record<string, unknown>)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join("+") : String(value)}`)
    .sort();
  return parts.length === 0 ? "<empty>" : parts.join(", ");
}

function parseAbsolute(location: string | undefined): URL | undefined {
  if (location === undefined) return undefined;
  try {
    return new URL(location);
  } catch {
    return undefined;
  }
}

/** The port a URL actually names, with the scheme's default made explicit. */
function effectivePort(url: URL): number {
  if (url.port !== "") return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

export default phase;
