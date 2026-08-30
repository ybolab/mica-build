/**
 * Phase 05b -- the typed network surface: typed pane forms, the live-state
 * readers, and the rotate-key action.
 *
 * The three kinds M2..M5 taught mosd to render are only reachable through apid
 * from this milestone on, and none of them can be observed from inside the
 * process: a pane that renders a `kind` control and a route that fronts a bus
 * method are exactly the things `cargo test` cannot tell apart from routes.rs
 * saying so. That is what this phase is for.
 *
 * It builds a **tunnel** and not a VLAN or a bridge, deliberately. A VLAN needs
 * a declared parent and a bridge enslaves a declared port, and the only
 * interface this guest has is the one every other assertion in the suite
 * travels over -- so both would reconfigure `eth0` and drop the port forward
 * mid-run, the failure 05-mutate's `networkNoOp` refuses to risk for the same
 * reason. A WireGuard tunnel is a new link that touches nothing: `wg-e2e` is
 * created from nothing, addressed out of a range nothing here routes, and left
 * behind. The pane's VLAN and bridge controls are still asserted -- as markup
 * on the form, and as the reconciler's cross-field rules echoed back at 422 --
 * which is everything about them that can be checked without taking the link.
 *
 * IMAGE SKEW. Every check below needs an image built from a tree that carries
 * An older image has no `kind` control, no `/api/v1/actions/...`
 * route and no `publicKey` in its live state, and this phase goes red on all
 * three at once -- which is the correct reading of "the image predates the
 * milestone", not a defect in apid. 04-readonly documents the same hazard for
 * the routes it was written against.
 */

import type { HttpResponse } from "../client.ts";
import { openConsole, type ConsoleLog } from "../console.ts";
import type { Phase, PhaseContext } from "../runner.ts";

/**
 * The tunnel this phase creates. Not an interface the guest already has, and
 * not a name any other phase writes: a collision would make one phase's
 * cleanup another phase's failure.
 */
const TUNNEL = "wg-e2e";

/** The name this phase mints its bearer under, distinct from 05d's two. */
const TOKEN_NAME = "mos-e2e-wireguard";

/** `Authorization: Bearer <token>`, the credential every /api/v1 call here sends. */
function bearerHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Mint this phase's bearer through §3.2's bootstrap.
 *
 * The session cookie was withdrawn from `/api/v1/`, so the
 * jar 05-mutate left behind no longer authenticates the four API reads and the
 * rotate action below. It still authenticates `POST /builtin/tokens`, which is
 * not an `/api/v1/` route and is exactly the bootstrap an operator holding only
 * a browser uses. So this phase mints its own, once, and sends it thereafter.
 *
 * Minted rather than carried from 05d because 05d runs AFTER this phase, and a
 * phase that depended on a later one would invert the runner's order.
 */
async function mintBearer(ctx: PhaseContext): Promise<string | undefined> {
  const { client, report } = ctx;
  const minted = await client.post("/builtin/tokens", { name: TOKEN_NAME });
  if (
    !report.expectStatus(
      minted,
      200,
      "POST /builtin/tokens with the session cookie mints this phase's bearer (M9: /api/v1/ takes no cookie)",
    )
  ) {
    return undefined;
  }
  const token = /<pre>([^<]+)<\/pre>/.exec(minted.body)?.[1]?.trim();
  report.check(
    token !== undefined,
    "the mint page carries the plaintext, which appears in this one response and never again",
    token !== undefined ? undefined : `body: ${JSON.stringify(minted.body.slice(0, 400))}`,
  );
  return token;
}

/** Addressing for the tunnel; a range nothing in this guest routes. */
const TUNNEL_ADDRESS = "10.199.0.2/24";

/** The port the tunnel listens on. Arbitrary, and nothing dials it. */
const TUNNEL_LISTEN_PORT = "51899";

/**
 * A syntactically valid X25519 public key: 32 constant bytes in padded base64.
 *
 * Its private half was never generated, so it authorises nothing anywhere. It
 * exists so that a rejected peer is apid's verdict on the write path and not on
 * a malformed blob -- the same reason 05-mutate's throwaway SSH key exists.
 */
const PEER_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

/** Length of the base64 spelling of a 32-byte key, padding included. */
const KEY_LENGTH = 44;

/** The action route, whose `{iface}` is the tunnel above. */
const ROTATE_PATH = `/api/v1/actions/wireguard/${TUNNEL}/rotate-key`;

/** A TCG guest reconciles slowly; this is the window each check names. */
const RECONCILE_TIMEOUT_MS = 60_000;
/** The link-liveness window, matching 05-mutate's. */
const LINK_TIMEOUT_MS = 30_000;

const phase: Phase = {
  id: "05b-wireguard",
  title:
    "the M6 surface: typed pane forms, live kind/publicKey readers, and the rotate-key action",
  assumes:
    "05-mutate ran and left a valid session in the jar, the device out of setup mode, and " +
    "the link this suite talks over still up. It also assumes NO interface named " +
    `"${TUNNEL}" exists: this phase creates it, and a pre-existing one would mean the ` +
    "public key it reads back was drawn by an earlier run rather than by this one. It " +
    "performs NO failed login, so 06-backoff still inherits a failure run of zero.",

  async run(ctx: PhaseContext): Promise<void> {
    const log = openConsole(ctx.config.consoleLog);
    const token = await mintBearer(ctx);
    if (token === undefined) return;
    await assertPaneControls(ctx);
    await assertCrossFieldEchoes(ctx);
    const publicKey = await assertTunnelCreation(ctx, log, token);
    await assertPeerRoundTrip(ctx);
    await assertRotation(ctx, publicKey, token);
    await assertNoPrivateKeyAnywhere(ctx, token);
  },
};

// 5b.1 the pane's typed controls

async function assertPaneControls(ctx: PhaseContext): Promise<void> {
  const { client, report } = ctx;
  report.note("");
  report.note("  5b.1 the network pane offers a typed form for every kind");

  const pane = await client.get("/network");
  if (!report.expectStatus(pane, 200, "GET /network answers 200")) return;

  // The kind control, by its four values. A pane that rendered the select and
  // omitted a value would leave that kind unreachable through the UI while
  // every other check here still passed.
  for (const kind of ["physical", "vlan", "bridge", "wireguard"]) {
    report.expectBodyContains(
      pane,
      `value="${kind}"`,
      `the Network pane offers kind "${kind}" in its kind control`,
    );
  }
  // And each kind's own parameters, by input name.
  for (const [field, why] of [
    ["vlanParent", "a VLAN's parent"],
    ["vlanId", "a VLAN's 802.1Q id"],
    ["bridgePorts", "a bridge's ports"],
    ["listenPort", "a tunnel's listen port"],
  ] as const) {
    report.expectBodyContains(
      pane,
      `name="${field}"`,
      `the Network pane carries an input for ${why} (name="${field}")`,
    );
  }
}

// 5b.2 the reconciler's cross-field rules, echoed as readable form errors

/**
 * Rules `validate_network` enforces in mosd, asserted through the pane.
 *
 * Every row names an interface that does not exist and a parent or port that
 * does not exist either, so a row that (wrongly) succeeded would still write
 * nothing this suite depends on -- and the assertion below is that none of them
 * succeeds.
 */
const CROSS_FIELD_ROWS: readonly {
  readonly fields: Readonly<Record<string, string>>;
  readonly because: string;
}[] = [
  {
    fields: {
      iface: "e2e-vlan",
      kind: "vlan",
      vlanParent: "no-such-iface",
      vlanId: "4000",
    },
    because: "a VLAN parent that is not a declared network entry",
  },
  {
    fields: { iface: "e2e-vlan", kind: "vlan", vlanId: "4000" },
    because: "a VLAN with no parent named at all",
  },
  {
    fields: { iface: "e2e-br", kind: "bridge", bridgePorts: "no-such-iface" },
    because: "a bridge port that is not a declared network entry",
  },
  {
    fields: { iface: "e2e-vlan", kind: "vlan", vlanParent: "eth0", vlanId: "not-a-number" },
    because: "a VLAN id that is not a number",
  },
  {
    fields: { iface: "e2e-wg", kind: "wireguard", listenPort: "not-a-number" },
    because: "a listen port that is not a number",
  },
  {
    fields: { iface: "e2e-x", kind: "tunnel" },
    because: "a kind the schema does not have",
  },
];

async function assertCrossFieldEchoes(ctx: PhaseContext): Promise<void> {
  const { client, report } = ctx;
  report.note("");
  report.note("  5b.2 the pane echoes the reconciler's cross-field rules as 422s");

  for (const row of CROSS_FIELD_ROWS) {
    const response = await client.post("/network", row.fields);
    report.expectStatus(
      response,
      422,
      `POST /network with ${row.because} is refused with 422 by the pane's echo of the reconciler's rule`,
    );
  }

  // The refusals must not have written anything: a rejected tree leaves the
  // settings as it found them, and an interface named by a rejected row must
  // not turn up on the pane afterwards.
  const pane = await client.get("/network");
  const leaked = ["e2e-vlan", "e2e-br", "e2e-wg", "e2e-x"].filter((name) =>
    pane.body.includes(`name="iface" value="${name}"`),
  );
  report.check(
    leaked.length === 0,
    "no refused interface reached the settings tree: the pane renders none of them afterwards",
    [
      `expected: none of e2e-vlan, e2e-br, e2e-wg, e2e-x configured`,
      `actual:   ${leaked.join(", ")} present on the pane`,
    ].join("\n"),
  );
}

// 5b.3 creating the tunnel, and the two live-state fields M5 added

/**
 * Create the tunnel through the pane and read its public key out of live state.
 *
 * The public key is the observable proof that mosd drew a private key: the
 * private half is written to a mode-0640 file on STATE and there is no route
 * that returns it, so its public half arriving in `GET /api/v1/state/network`
 * is the only evidence available from outside the device -- and is exactly the
 * evidence the design intends to be available.
 */
async function assertTunnelCreation(
  ctx: PhaseContext,
  log: ConsoleLog,
  token: string,
): Promise<string | undefined> {
  const { client, report } = ctx;
  report.note("");
  report.note(`  5b.3 create ${TUNNEL} and read the kind and public key mosd publishes`);

  const marker = log.mark(`POST /network (create ${TUNNEL})`);
  const created = await client.post("/network", {
    iface: TUNNEL,
    kind: "wireguard",
    listenPort: TUNNEL_LISTEN_PORT,
    address: TUNNEL_ADDRESS,
    gateway: "",
    dns: "",
  });
  if (
    !report.expectStatus(
      created,
      303,
      `POST /network (iface=${TUNNEL}, kind=wireguard) is accepted with 303`,
    )
  ) {
    // A dropped link and a crashed daemon look the same over HTTP. What the
    // guest said while it happened is on the console, so paste it rather than
    // making someone re-boot the image to find out. A note, not a check.
    report.note("    what the guest wrote to the console during the write:");
    for (const line of log.describeWindow(marker)) report.note(`    ${line}`);
    return undefined;
  }

  // The link is the one thing this phase could plausibly have broken, and over
  // HTTP a dropped link is indistinguishable from apid crashing. Cookies are
  // withheld so a session problem cannot be misread as a link problem.
  await report.expectEventually(
    `creating a tunnel did not drop the link: /healthz answers 200 within ${LINK_TIMEOUT_MS}ms`,
    async () => {
      const health = await client.get("/healthz", { sendCookies: false });
      if (health.status !== 200) throw new Error(`/healthz answered ${health.status}`);
      return true;
    },
    { timeoutMs: LINK_TIMEOUT_MS, intervalMs: 1_000 },
  );

  // The live-state readers. Polled, because the reconcile that publishes them
  // runs after the 303 and a TCG guest is slow.
  let publicKey: string | undefined;
  await report.expectEventually(
    `GET /api/v1/state/network publishes kind "wireguard" and a publicKey for ${TUNNEL} within ${RECONCILE_TIMEOUT_MS}ms`,
    async () => {
      const state = await client.get("/api/v1/state/network", {
        headers: bearerHeaders(token),
      });
      if (state.status !== 200) throw new Error(`the state route answered ${state.status}`);
      const entry = entryOf(state, TUNNEL);
      if (entry === undefined) throw new Error(`no ${TUNNEL} entry: ${snippet(state.body)}`);
      if (entry["kind"] !== "wireguard") throw new Error(`kind is ${JSON.stringify(entry["kind"])}`);
      const key = entry["publicKey"];
      if (typeof key !== "string" || key === "") throw new Error("no publicKey in the entry");
      publicKey = key;
      return true;
    },
    { timeoutMs: RECONCILE_TIMEOUT_MS, intervalMs: 2_000 },
  );

  report.check(
    publicKey !== undefined && publicKey.length === KEY_LENGTH && publicKey.endsWith("="),
    `the published public key is a 32-byte X25519 key in base64 (${KEY_LENGTH} characters)`,
    [
      `expected: a ${KEY_LENGTH}-character padded base64 string`,
      `actual:   ${publicKey === undefined ? "no key was published" : JSON.stringify(publicKey)}`,
    ].join("\n"),
  );

  // `kind` is published for EVERY entry, not only the tunnel: M5 added it
  // beside the public key, and a reader that only looked at tunnels would miss
  // a physical entry that lost its kind.
  const state = await client.get("/api/v1/state/network", {
    headers: bearerHeaders(token),
  });
  const entries = objectOf(state);
  const kindless = Object.entries(entries ?? {})
    .filter(([, value]) => asObject(value)?.["kind"] === undefined)
    .map(([name]) => name);
  report.check(
    entries !== undefined && kindless.length === 0,
    "every entry in the published network state names its kind, not only the tunnel",
    [
      `expected: a "kind" member on every entry`,
      `actual:   ${entries === undefined ? `a body that is not an object: ${snippet(state.body)}` : `${kindless.join(", ")} carry none`}`,
    ].join("\n"),
  );

  // And the pane renders them, which is the other half of "live-state readers".
  const pane = await client.get("/network");
  report.expectBodyContains(
    pane,
    "Public key:",
    "the Network pane renders the tunnel's published public key",
  );
  if (publicKey !== undefined) {
    report.expectBodyContains(
      pane,
      publicKey,
      "the key the pane renders is the key the API published, not a second source",
    );
  }
  return publicKey;
}

// 5b.4 the peer round trip

async function assertPeerRoundTrip(ctx: PhaseContext): Promise<void> {
  const { client, report } = ctx;
  report.note("");
  report.note("  5b.4 a peer is added and removed through the pane's own routes");

  // A peer the reconciler would refuse, first: the echo has to fire before the
  // write, or the operator reads a 502 from a failed bus call instead.
  const refused = await client.post("/network/peers/add", {
    iface: TUNNEL,
    publicKey: "not-a-wireguard-key",
    allowedIps: "",
    endpoint: "",
    persistentKeepalive: "",
  });
  report.expectStatus(
    refused,
    422,
    "POST /network/peers/add with a public key that is not a key is refused with 422",
  );
  report.check(
    !refused.body.includes("not-a-wireguard-key"),
    "the refusal does NOT echo the submitted key back onto the page",
    [
      `expected: the pasted value absent from the response`,
      `actual:   it is in the ${refused.body.length}-byte body`,
      `note:     an operator who pasted a PRIVATE key into this field must not find it here.`,
    ].join("\n"),
  );

  const added = await client.post("/network/peers/add", {
    iface: TUNNEL,
    publicKey: PEER_KEY,
    allowedIps: "10.199.1.0/24",
    endpoint: "peer.invalid:51820",
    persistentKeepalive: "25",
  });
  report.expectStatus(added, 303, `POST /network/peers/add is accepted with 303 for ${TUNNEL}`);

  const withPeer = await client.get("/network");
  report.expectBodyContains(
    withPeer,
    PEER_KEY,
    "the added peer is rendered in the tunnel's peer list",
  );

  const removed = await client.post("/network/peers/remove", {
    iface: TUNNEL,
    publicKey: PEER_KEY,
  });
  report.expectStatus(removed, 303, "POST /network/peers/remove is accepted with 303");

  const withoutPeer = await client.get("/network");
  report.check(
    !withoutPeer.body.includes(PEER_KEY),
    "the removed peer is gone from the pane, so the removal rewrote the stored list",
    [
      `expected: the peer key absent from the pane`,
      `actual:   still present in the ${withoutPeer.body.length}-byte body`,
    ].join("\n"),
  );
}

// 5b.5 the rotate-key action

async function assertRotation(
  ctx: PhaseContext,
  before: string | undefined,
  token: string,
): Promise<void> {
  const { client, report } = ctx;
  report.note("");
  report.note("  5b.5 POST /api/v1/actions/wireguard/{iface}/rotate-key");

  // Unauthenticated FIRST, and it must be the §2.4 envelope rather than the
  // gate's redirect. A client that followed a 303 here would land on GET
  // /login, read 200, and believe it had rotated a key.
  const anonymous = await client.post(ROTATE_PATH, {}, { sendCookies: false });
  report.expectStatus(
    anonymous,
    401,
    "an UNAUTHENTICATED rotate answers 401, not the gate's redirect: the route answers for itself",
  );
  report.check(
    anonymous.headers.get("location") === undefined,
    "the unauthenticated rotate carries NO Location header, so no client can read it as success",
    [
      `expected: no Location`,
      `actual:   ${anonymous.headers.get("location") ?? "(none)"}`,
    ].join("\n"),
  );
  report.expectHeader(
    anonymous,
    "content-type",
    "application/json",
    "the unauthenticated rotate is typed application/json, never HTML",
  );

  // A GET does not exist: a rotation replaces a tunnel's identity, so nothing
  // that merely follows a link may perform one.
  const viaGet = await client.get(ROTATE_PATH, { headers: bearerHeaders(token) });
  report.check(
    viaGet.status === 405,
    "GET on the rotate route is 405: the route is POST-only",
    [`expected: 405`, `actual:   ${viaGet.status}${describe(viaGet)}`].join("\n"),
  );

  // An interface that is not DECLARED AT ALL is 404, since split
  // mosd's rotate-key error: the contract rules that on
  // this route *"404 added: an undeclared entry. 422 now means only 'exists and
  // is not a tunnel'"*. This phase was written against a tree that predated
  // that split and asserted 422 here, so the two conditions had one status
  // between them and an absent entry was indistinguishable from a wrong-kinded
  // one -- which is the distinction the correction exists to make.
  const undeclared = await client.post(
    "/api/v1/actions/wireguard/no-such-iface/rotate-key",
    {},
    { headers: bearerHeaders(token) },
  );
  report.expectStatus(
    undeclared,
    404,
    "rotating an interface that is not a declared network entry at all is 404",
  );
  report.expectJson(
    undeclared,
    { error: { code: "settings_not_found", source: "mosd", path: "network.no-such-iface" } },
    "the refusal carries §2.4's envelope: settings_not_found, from mosd, naming the dot-path at fault",
    { subset: true },
  );

  // And the rotation itself.
  const rotated = await client.post(ROTATE_PATH, {}, { headers: bearerHeaders(token) });
  if (!report.expectStatus(rotated, 200, `POST ${ROTATE_PATH} answers 200`)) return;
  report.expectHeader(
    rotated,
    "cache-control",
    "no-store",
    "the rotation's answer carries Cache-Control: no-store, like every /api/ response",
  );

  const body = objectOf(rotated);
  const members = body === undefined ? [] : Object.keys(body);
  report.check(
    members.length === 1 && members[0] === "publicKey",
    "the rotation's body carries publicKey AND NOTHING ELSE -- there is no private half in it",
    [
      `expected: exactly one member, "publicKey"`,
      `actual:   ${members.length === 0 ? snippet(rotated.body) : members.join(", ")}`,
    ].join("\n"),
  );

  const after = typeof body?.["publicKey"] === "string" ? (body["publicKey"] as string) : undefined;
  report.check(
    after !== undefined && after.length === KEY_LENGTH && after !== before,
    "the rotation answered a NEW public key: a rotation that returned the old one changed no key",
    [
      `expected: a ${KEY_LENGTH}-character key different from the one published before`,
      `before:   ${before ?? "(never read)"}`,
      `after:    ${after ?? "(absent)"}`,
    ].join("\n"),
  );

  // The reconcile that follows republishes it, so live state catches up with
  // what the caller was handed. This is what makes the answer trustworthy:
  // a public key nothing on the device is using would be a lie with a 200.
  if (after !== undefined) {
    await report.expectEventually(
      `the published live state catches up with the rotated key within ${RECONCILE_TIMEOUT_MS}ms`,
      async () => {
        const state = await client.get("/api/v1/state/network", {
        headers: bearerHeaders(token),
      });
        if (state.status !== 200) throw new Error(`the state route answered ${state.status}`);
        const entry = entryOf(state, TUNNEL);
        if (entry?.["publicKey"] !== after) {
          throw new Error(`live state still says ${JSON.stringify(entry?.["publicKey"])}`);
        }
        return true;
      },
      { timeoutMs: RECONCILE_TIMEOUT_MS, intervalMs: 2_000 },
    );
  }
}

// 5b.6 the leak canary

/**
 * No surface this daemon serves carries a private key.
 *
 * The private half cannot be canaried by value -- nothing outside the device
 * ever learns it, which is the property under test -- so this asserts the
 * absence structurally instead: no `privateKey` member anywhere in either tree,
 * and no route that answers one.
 */
async function assertNoPrivateKeyAnywhere(ctx: PhaseContext, token: string): Promise<void> {
  const { client, report } = ctx;
  report.note("");
  report.note("  5b.6 no surface serves a private key");

  for (const path of [
    "/api/v1/state/network",
    `/api/v1/settings/network.${TUNNEL}`,
    "/network",
  ]) {
    // Both surfaces in one list, taking different credentials since M9: the
    // two API paths take the bearer, the pane takes the cookie.
    // It stays one list because the claim is that NO surface serves the key,
    // and two loops would let one of them quietly stop being checked.
    const response = path.startsWith("/api/")
      ? await client.get(path, { headers: bearerHeaders(token) })
      : await client.get(path);
    report.check(
      response.status === 200 && !response.body.includes("privateKey"),
      `GET ${path} names no privateKey anywhere in its body`,
      [
        `expected: 200 with no "privateKey" substring`,
        `actual:   ${response.status}${response.body.includes("privateKey") ? ", and the body names privateKey" : ""}`,
      ].join("\n"),
    );
  }

  // Asked for directly, by dot-path. There is no such member, so mosd refuses
  // the path -- and the one thing this must never be is a 200 carrying a key.
  const direct = await client.get(`/api/v1/state/network.${TUNNEL}.privateKey`, {
    headers: bearerHeaders(token),
  });
  report.check(
    direct.status !== 200,
    "asking for the private key BY DOT-PATH does not answer one: there is no such member and no route that produces it",
    [
      `expected: anything but 200 (mosd refuses a dot-path that does not resolve)`,
      `actual:   ${direct.status}${describe(direct)}`,
    ].join("\n"),
  );
}

// helpers

/** `response.body` parsed as a JSON object, or undefined. */
function objectOf(response: HttpResponse): Record<string, unknown> | undefined {
  try {
    return asObject(JSON.parse(response.body));
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** One interface's entry out of a `GET /api/v1/state/network` body. */
function entryOf(response: HttpResponse, iface: string): Record<string, unknown> | undefined {
  return asObject(objectOf(response)?.[iface]);
}

function snippet(body: string): string {
  const flat = body.replace(/\s+/g, " ");
  return flat.length <= 200 ? flat : `${flat.slice(0, 200)}...`;
}

function describe(response: HttpResponse): string {
  return response.body === "" ? "" : ` -- ${snippet(response.body)}`;
}

export default phase;
