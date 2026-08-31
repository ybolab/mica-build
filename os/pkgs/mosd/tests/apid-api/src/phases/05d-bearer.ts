/**
 * Phase 05d -- the bearer credential, end to end, and the 401 M9 depends on.
 *
 * The session cookie is removed from `/api/v1/`. It may not be
 * scheduled until something proves a bearer token drives the whole API surface,
 * because after that cutover the cookie is gone and a harness that still leans
 * on it is a harness that cannot run. This phase is that proof, and it is a
 * proof only because it runs: an earlier pass declined to write an `apid-api` phase it
 * would not execute, on the reasoning that *a phase written but never run is a
 * claim, not a measurement*.
 *
 * **The cookie is used exactly once, and never again.** `POST /builtin/tokens`
 * is the bootstrap, and it has to be the cookie: the three `/api/v1/tokens`
 * routes take `ApiBearer` and refuse a session outright, so the first token
 * cannot be minted with a token. Every request after that mint is issued from
 * `bearer`, a SECOND `Client` whose jar has never been handed a `Set-Cookie`
 * line -- structural rather than a `sendCookies: false` on each call, because a
 * flag can be forgotten on one request out of thirty and an empty jar cannot.
 * The emptiness is asserted, not assumed, at the top and again at the end.
 *
 * What the phase leaves behind is what it found: the settings flag it flips is
 * flipped back, the key it adds is removed, and both tokens it mints are
 * revoked. The one exception is `wg-e2e`'s private key, which the rotate action
 * replaces by definition -- 05b-wireguard leaves the tunnel behind and no later
 * phase reads its key.
 *
 * IMAGE SKEW. Every check here needs an image built from a tree carrying
 * Bearer auth and the token routes, M4 (the scalar write),
 * M5 (the authorized-keys collection) and the rotate action. An
 * older image has no `/builtin/tokens` at all and this phase goes red at its
 * first check -- which is the correct reading of "the image predates the
 * milestone", the hazard 04-readonly and 05b document for their own surfaces.
 */

import { Client, type HttpResponse } from "../client.ts";
import type { Phase, PhaseContext } from "../runner.ts";

/** The label the bootstrap token is minted under, and the phase that owns it. */
const BOOTSTRAP_NAME = "mos-e2e-bearer-bootstrap";

/** The label of the second token, the one that outlives the first's revocation. */
const SECOND_NAME = "mos-e2e-bearer-second";

/**
 * The scalar this phase writes. One of `WRITABLE_SETTINGS`' four, and the only
 * one no other phase touches: 05-mutate drives `container.enabled` and
 * `access.ssh.enabled` through their panes and 07b reads back `hostname`, so
 * writing any of those three here would make one phase's cleanup another
 * phase's failure. The value is flipped and then flipped back.
 */
const FLAG_PATH = "mqtt.enabled";

/**
 * A throwaway ed25519 public key, generated with `ssh-keygen` and its private
 * half destroyed at generation time. Distinct from 05-mutate's key on purpose:
 * that one may still be stored when this phase runs, and posting it again would
 * meet `key_exists` at 409 -- a correct answer to the wrong question.
 */
const KEY_TEXT =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILM7ddYJUJl8N9shWadt6sXH31iNOmFqDd66syqBRdTm";
const KEY_COMMENT = "mos-e2e-bearer-suite@invalid";
const KEY_LINE = `${KEY_TEXT} ${KEY_COMMENT}`;

/** What `ssh-keygen -lf` prints for the key above. Note the `/`. */
const KEY_FINGERPRINT = "SHA256:s/nCh3B62WwWUc4cdWtW50nmmyeqNroQIiztgjsA4hs";

/**
 * The tunnel 05b-wireguard declares and leaves behind, and the action route
 * over it. Rotating twice is not a conflict: each rotation draws a new key and
 * no phase after 05b reads the old one.
 */
const TUNNEL = "wg-e2e";
const ROTATE_PATH = `/api/v1/actions/wireguard/${TUNNEL}/rotate-key`;

const SSH_KEYS_PATH = "/api/v1/ssh/authorized-keys";
const TOKENS_PATH = "/api/v1/tokens";
const SETTINGS_PREFIX = "/api/v1/settings/";
const TASKS_PREFIX = "/api/v1/tasks/";
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** How much of an unexpected body to quote in a failure detail. */
const SNIPPET = 240;

/**
 * A minted token: what the mint answered, in the two forms the rest of the
 * phase needs it in.
 */
interface Minted {
  readonly id: string;
  readonly token: string;
}

/**
 * The path segment for a fingerprint.
 *
 * `/` is legal inside a SHA-256 fingerprint's base64 and it is NOT a path
 * separator here, so it is sent percent-encoded -- the same spelling apid's own
 * route tests use (`ssh_key_url` in `os/pkgs/mosd/apid/src/tests.rs`). Sent raw
 * it would split the segment and the request would name a route that does not
 * exist, and the 404 would read as "apid forgot the key".
 */
function keySegment(fingerprint: string): string {
  return encodeURIComponent(fingerprint);
}

/** `Authorization: Bearer <token>`, the only credential this phase sends. */
function bearerHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function snippet(body: string): string {
  return body.length <= SNIPPET ? body : `${body.slice(0, SNIPPET)}...`;
}

/** Parse a response body as JSON, or undefined when it is not JSON at all. */
function json(response: HttpResponse): unknown {
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Wait for the task id in a 202 response to reach a successful terminal record. */
async function awaitApply(
  ctx: PhaseContext,
  bearer: Client,
  token: string,
  accepted: HttpResponse,
  what: string,
): Promise<boolean> {
  const body = json(accepted);
  const taskId = isRecord(body) ? body["taskId"] : undefined;
  if (typeof taskId !== "string" || taskId === "") {
    return ctx.report.fail(`${what} returns a taskId`, `actual: ${snippet(accepted.body)}`);
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await bearer.get(`${TASKS_PREFIX}${encodeURIComponent(taskId)}`, {
      headers: bearerHeaders(token),
    });
    if (!ctx.report.expectStatus(
      response,
      200,
      `${what}: GET /api/v1/tasks/{id} is readable over the bearer`,
    )) return false;
    const task = json(response);
    if (isRecord(task) && task["status"] === "finished") {
      return ctx.report.check(
        task["outcome"] === "succeeded",
        `${what}: the apply task reaches succeeded`,
        `actual: ${snippet(response.body)}`,
      );
    }
    await sleep(250);
  }
  return ctx.report.fail(`${what}: the apply task reaches a terminal outcome`, "deadline: 30s");
}

// 1. The bootstrap mint -- the one cookie request in this phase

/**
 * Lift the id and the plaintext off `minted_page`.
 *
 * The page shows the identifier in a `<code>` and the whole token in a `<pre>`,
 * and this is the only response in which the plaintext exists. Parsing markup
 * is not ideal and is not avoidable: `POST /builtin/tokens` answers HTML by
 * design, because it is a form post under §6.3's prefix and outside the `v1`
 * contract.
 */
function parseMintedPage(body: string): { id?: string; token?: string } {
  const id = /Identifier:\s*<code>([^<]+)<\/code>/.exec(body)?.[1]?.trim();
  const token = /<pre>([^<]+)<\/pre>/.exec(body)?.[1]?.trim();
  return { id, token };
}

async function bootstrapMint(ctx: PhaseContext): Promise<Minted | undefined> {
  const { client, report } = ctx;
  report.note("  -- 1. the bootstrap mint: the session cookie, used once and then never");

  // Deliberately through `client`, the phase's ONE cookie-authenticated
  // request. `/api/v1/tokens` would answer 401 here however good the session
  // is, which is the boundary §3.2 draws and the reason this route exists.
  const minted = await client.post("/builtin/tokens", { name: BOOTSTRAP_NAME });
  if (
    !report.expectStatus(
      minted,
      200,
      `POST /builtin/tokens with the session cookie mints the first token (the only way the first token can exist)`,
    )
  ) {
    return undefined;
  }

  const { id, token } = parseMintedPage(minted.body);
  const parsed = id !== undefined && token !== undefined;
  report.check(
    parsed,
    "the mint page carries the token identifier and the plaintext, which appear in this one response and never again",
    parsed
      ? undefined
      : [
          `expected: an "Identifier: <code>..</code>" and a <pre>..</pre> on the mint page`,
          `actual:   id=${JSON.stringify(id)} token=${JSON.stringify(token)}`,
          `body:     ${JSON.stringify(snippet(minted.body))}`,
        ].join("\n"),
  );
  if (!parsed) return undefined;

  // The wire format is `mos_<id>_<secret>`, and the id on the page has to be
  // the id inside the token: a page that showed one token's id beside another's
  // plaintext would make every DELETE in section 3 address the wrong entry.
  const shaped = token.startsWith(`mos_${id}_`);
  report.check(
    shaped,
    `the plaintext is spelled mos_<id>_<secret> and carries the identifier the page displayed`,
    shaped
      ? undefined
      : [
          `expected: a token beginning ${JSON.stringify(`mos_${id}_`)}`,
          `actual:   ${JSON.stringify(token.slice(0, 24))}...`,
        ].join("\n"),
  );

  return { id, token };
}

// 2. The API surface, driven by the bearer and nothing else

async function settingsRead(ctx: PhaseContext, bearer: Client, token: string): Promise<void> {
  const { report } = ctx;
  const response = await bearer.get(`${SETTINGS_PREFIX}hostname`, {
    headers: bearerHeaders(token),
  });
  if (
    !report.expectStatus(
      response,
      200,
      "a settings READ over the bearer: GET /api/v1/settings/hostname is 200",
    )
  ) {
    return;
  }
  const value = json(response);
  report.check(
    typeof value === "string" && value.length > 0,
    "the read answers the value itself (ResourceValue is serde(transparent)), not a wrapper around it",
    [
      `expected: a non-empty JSON string`,
      `actual:   ${JSON.stringify(snippet(response.body))}`,
    ].join("\n"),
  );
}

async function settingsWrite(ctx: PhaseContext, bearer: Client, token: string): Promise<void> {
  const { report } = ctx;
  const path = `${SETTINGS_PREFIX}${FLAG_PATH}`;

  const before = await bearer.get(path, { headers: bearerHeaders(token) });
  if (
    !report.expectStatus(
      before,
      200,
      `the flag this phase writes reads back before it is touched: GET /api/v1/settings/${FLAG_PATH} is 200`,
    )
  ) {
    return;
  }
  const original = json(before);
  if (typeof original !== "boolean") {
    report.fail(
      `${FLAG_PATH} reads as a JSON boolean, which is what this phase flips`,
      [
        `expected: true or false`,
        `actual:   ${JSON.stringify(snippet(before.body))}`,
      ].join("\n"),
    );
    return;
  }

  const flipped = !original;
  const write = await bearer.request("PUT", path, {
    headers: bearerHeaders(token),
    body: JSON.stringify(flipped),
    contentType: "application/json",
  });
  if (!report.expectStatus(
    write,
    202,
    `a settings WRITE over the bearer: PUT /api/v1/settings/${FLAG_PATH} ${flipped} is 202`,
  )) return;
  if (!await awaitApply(ctx, bearer, token, write, "the bearer settings write")) return;

  const after = await bearer.get(path, { headers: bearerHeaders(token) });
  report.expectJson(
    after,
    flipped,
    `the write took: reading ${FLAG_PATH} back over the bearer answers ${flipped}`,
  );

  // Left as found. A phase that flips a switch on a device and walks away has
  // changed the machine every later phase runs against.
  const restore = await bearer.request("PUT", path, {
    headers: bearerHeaders(token),
    body: JSON.stringify(original),
    contentType: "application/json",
  });
  if (!report.expectStatus(
    restore,
    202,
    `${FLAG_PATH} is restored to ${original}, so this phase leaves the device as it found it`,
  )) return;
  await awaitApply(ctx, bearer, token, restore, "the settings restore");
}

async function collection(ctx: PhaseContext, bearer: Client, token: string): Promise<void> {
  const { report } = ctx;

  // (a) the listing
  const list = await bearer.get(SSH_KEYS_PATH, { headers: bearerHeaders(token) });
  if (
    !report.expectStatus(
      list,
      200,
      "a collection LISTING over the bearer: GET /api/v1/ssh/authorized-keys is 200",
    )
  ) {
    return;
  }
  const listed = json(list);
  report.check(
    isRecord(listed) && Array.isArray(listed["keys"]) && typeof listed["notice"] === "string",
    "the listing is an object carrying `keys` and the collection's `notice`, not a bare array",
    [
      `expected: {"keys": [..], "notice": ".."}`,
      `actual:   ${JSON.stringify(snippet(list.body))}`,
    ].join("\n"),
  );

  // (b) the add
  const add = await bearer.request("POST", SSH_KEYS_PATH, {
    headers: bearerHeaders(token),
    body: JSON.stringify({ key: KEY_LINE }),
    contentType: "application/json",
  });
  if (
    !report.expectStatus(
      add,
      201,
      "a collection POST over the bearer: adding an authorized key is 201",
    )
  ) {
    return;
  }
  const added = json(add);
  const addedFingerprint =
    isRecord(added) && isRecord(added["key"]) ? added["key"]["fingerprint"] : undefined;
  report.check(
    addedFingerprint === KEY_FINGERPRINT,
    "the add answers the fingerprint `ssh-keygen -lf` prints, which is this entry's DELETE segment",
    [
      `expected: ${JSON.stringify(KEY_FINGERPRINT)}`,
      `actual:   ${JSON.stringify(addedFingerprint)}`,
      `body:     ${JSON.stringify(snippet(add.body))}`,
    ].join("\n"),
  );

  // (c) it is really in the collection, read back over the bearer
  const relist = await bearer.get(SSH_KEYS_PATH, { headers: bearerHeaders(token) });
  report.expectBodyContains(
    relist,
    KEY_FINGERPRINT,
    "the added key is in the listing the bearer reads back",
  );

  // (d) the delete. The fingerprint carries a `/`, sent percent-encoded.
  const remove = await bearer.request("DELETE", `${SSH_KEYS_PATH}/${keySegment(KEY_FINGERPRINT)}`, {
    headers: bearerHeaders(token),
  });
  report.expectStatus(
    remove,
    204,
    "a collection DELETE over the bearer: removing the key by its percent-encoded fingerprint is 204",
  );

  const gone = await bearer.get(SSH_KEYS_PATH, { headers: bearerHeaders(token) });
  report.check(
    !gone.body.includes(KEY_FINGERPRINT),
    "the delete took: the fingerprint is absent from the listing afterwards",
    [
      `expected: no ${JSON.stringify(KEY_FINGERPRINT)} in the listing`,
      `actual:   ${JSON.stringify(snippet(gone.body))}`,
    ].join("\n"),
  );
}

async function action(ctx: PhaseContext, bearer: Client, token: string): Promise<void> {
  const { report } = ctx;
  const rotate = await bearer.request("POST", ROTATE_PATH, { headers: bearerHeaders(token) });
  if (
    !report.expectStatus(
      rotate,
      200,
      `an ACTION over the bearer: POST ${ROTATE_PATH} is 200`,
    )
  ) {
    return;
  }
  const body = json(rotate);
  const publicKey = isRecord(body) ? body["publicKey"] : undefined;
  report.check(
    typeof publicKey === "string" && publicKey.length === 44 && publicKey.endsWith("="),
    "the rotation answers the new public half in padded base64, and no private material",
    [
      `expected: a 44-character padded base64 X25519 public key under "publicKey"`,
      `actual:   ${JSON.stringify(snippet(rotate.body))}`,
    ].join("\n"),
  );
  report.check(
    !rotate.body.includes("privateKey"),
    "the rotation body carries no `privateKey` member -- there is no read-back route for the private half, ever",
    [`actual: ${JSON.stringify(snippet(rotate.body))}`].join("\n"),
  );
}

// 3. The token lifecycle, driven by the bearer

async function lifecycle(
  ctx: PhaseContext,
  bearer: Client,
  first: Minted,
): Promise<Minted | undefined> {
  const { report } = ctx;
  report.note("  -- 3. the token lifecycle: list, mint a second, revoke the first");

  const list = await bearer.get(TOKENS_PATH, { headers: bearerHeaders(first.token) });
  if (!report.expectStatus(list, 200, "GET /api/v1/tokens over the bearer is 200")) {
    return undefined;
  }
  // A bare array, not an object with a `tokens` member: the listing is the
  // collection itself, which is what `openapi.json` declares for this route.
  const listed = json(list);
  const rows = Array.isArray(listed) ? listed : undefined;
  const carriesFirst =
    rows?.some((row) => isRecord(row) && row["id"] === first.id && row["name"] === BOOTSTRAP_NAME) ??
    false;
  report.check(
    carriesFirst,
    "the listing is an array carrying the bootstrap token by the id and name it was minted under",
    [
      `expected: a row {"id": ${JSON.stringify(first.id)}, "name": ${JSON.stringify(BOOTSTRAP_NAME)}}`,
      `actual:   ${JSON.stringify(snippet(list.body))}`,
    ].join("\n"),
  );
  report.check(
    !list.body.includes(first.token) && !list.body.includes("hash"),
    "the listing publishes neither the plaintext nor the stored digest",
    [`actual: ${JSON.stringify(snippet(list.body))}`].join("\n"),
  );

  // The second token is minted THROUGH the API, with the first as credential:
  // the bootstrap page is the only way to the FIRST token, not to every token.
  const mint = await bearer.request("POST", TOKENS_PATH, {
    headers: bearerHeaders(first.token),
    body: JSON.stringify({ name: SECOND_NAME }),
    contentType: "application/json",
  });
  if (
    !report.expectStatus(
      mint,
      201,
      "POST /api/v1/tokens with the first token as credential mints a second: 201",
    )
  ) {
    return undefined;
  }
  const minted = json(mint);
  const id = isRecord(minted) ? minted["id"] : undefined;
  const token = isRecord(minted) ? minted["token"] : undefined;
  if (typeof id !== "string" || typeof token !== "string") {
    report.fail(
      "the mint answers an id and the plaintext token",
      [
        `expected: {"id": "..", "name": "..", "token": "mos_.."}`,
        `actual:   ${JSON.stringify(snippet(mint.body))}`,
      ].join("\n"),
    );
    return undefined;
  }

  // Revoked with the SECOND token, so the revocation cannot be confused with a
  // token revoking itself and the credential doing the work is provably a
  // different one from the credential being destroyed.
  const revoke = await bearer.request("DELETE", `${TOKENS_PATH}/${first.id}`, {
    headers: bearerHeaders(token),
  });
  report.expectStatus(
    revoke,
    204,
    "DELETE /api/v1/tokens/{id} revokes the first token, addressed by id and authorised by the second: 204",
  );

  // The contract is "on the NEXT request", and this is that request. The token
  // set is read per request from the `access` subtree, so nothing is cached
  // that could keep a revoked token alive for a window.
  const refused = await bearer.get(`${SETTINGS_PREFIX}hostname`, {
    headers: bearerHeaders(first.token),
  });
  report.expectStatus(
    refused,
    401,
    "the revoked token is refused on the very NEXT request: 401",
  );
  report.expectJson(
    refused,
    { error: { code: "not_authenticated", source: "apid" } },
    "the refusal is §2.4's envelope with `not_authenticated`",
    { subset: true },
  );

  // And the revocation was surgical: the other token is untouched.
  const survivor = await bearer.get(`${SETTINGS_PREFIX}hostname`, {
    headers: bearerHeaders(token),
  });
  report.expectStatus(
    survivor,
    200,
    "the second token still drives the API in the same breath: 200",
  );

  return { id, token };
}

// 4. The negative M9 depends on

async function noCredential(ctx: PhaseContext, bearer: Client): Promise<void> {
  const { report } = ctx;
  report.note("  -- 4. no credential at all: the 401 the cookie cutover depends on");

  const bare = await bearer.get(`${SETTINGS_PREFIX}hostname`);
  if (
    !report.expectStatus(
      bare,
      401,
      "a request carrying NO credential is 401, and not the gate's 303 to /login",
    )
  ) {
    // Worth saying out loud: a 303 here is exactly the failure §3.1 names, a
    // script reading the whole exchange as success.
    report.note(
      `  NOTE: the response was ${bare.status}${
        bare.headers.get("location") === undefined
          ? ""
          : ` to ${bare.headers.get("location")}`
      }`,
    );
    return;
  }
  report.expectHeaderMatches(
    bare,
    "content-type",
    /^application\/json\s*(;.*)?$/i,
    "the 401 is JSON, so a client that parses the envelope on every other failure has something to parse here",
  );
  report.expectJson(
    bare,
    { error: { code: "not_authenticated", source: "apid" } },
    "the 401 body is §2.4's envelope: `error.code` is `not_authenticated` and `error.source` is `apid`",
    { subset: true },
  );

  const body = json(bare);
  const detail = isRecord(body) && isRecord(body["error"]) ? body["error"] : undefined;
  report.check(
    detail !== undefined && !("path" in detail) && typeof detail["message"] === "string",
    "the envelope carries a human message and omits `path` -- a failed authentication names no dot-path",
    [
      `expected: error.message present, error.path absent`,
      `actual:   ${JSON.stringify(snippet(bare.body))}`,
    ].join("\n"),
  );

  // A garbage bearer is the same answer as no bearer: "one this device does not
  // hold" and "none at all" are the same failure and must not be told apart.
  const wrong = await bearer.get(`${SETTINGS_PREFIX}hostname`, {
    headers: bearerHeaders("mos_deadbeef_notatokenthisdeviceeverminted"),
  });
  report.expectStatus(
    wrong,
    401,
    "a bearer token this device does not hold is 401, indistinguishable from none at all",
  );
}

// the phase

const phase: Phase = {
  id: "05d-bearer",
  title: "the bearer credential drives /api/v1/ end to end, and no credential is 401",
  assumes:
    "03-login left a verified session cookie in the shared client's jar (the one and only " +
    "cookie request here is the bootstrap mint), 05b-wireguard left the wg-e2e tunnel " +
    "declared so the rotate action has a subject, and no earlier phase has minted an API " +
    "token, so this phase mints, lists, revokes and cleans up the whole set it created.",

  async run(ctx: PhaseContext): Promise<void> {
    const { report, config, client } = ctx;

    // The second client. Its jar is empty because nothing has ever handed it a
    // response, and it stays empty because nothing in this phase logs in with
    // it -- so no request it makes can carry a cookie, whatever a later editor
    // forgets. Asserted rather than asserted-in-a-comment.
    const bearer = new Client(config);
    report.check(
      bearer.jar.names().length === 0,
      "the bearer client's cookie jar is empty before the phase starts, so no /api/v1/ request below can carry a session",
      `actual: ${JSON.stringify(bearer.jar.names())}`,
    );
    report.check(
      client.jar.names().length > 0,
      "the shared client still holds the session cookie 03-login established, which is what the bootstrap mint needs",
      `actual: the shared jar holds ${JSON.stringify(client.jar.names())}`,
    );

    const first = await bootstrapMint(ctx);
    if (first === undefined) {
      report.skip(
        "the bearer-driven surface",
        "the bootstrap mint did not yield a token, so there is no credential to drive it with",
      );
      return;
    }

    report.note("  -- 2. the surface, driven by Authorization: Bearer and nothing else");
    await settingsRead(ctx, bearer, first.token);
    await settingsWrite(ctx, bearer, first.token);
    await collection(ctx, bearer, first.token);
    await action(ctx, bearer, first.token);

    const second = await lifecycle(ctx, bearer, first);

    await noCredential(ctx, bearer);

    // 5. cleanup, and the standing proof that nothing above leaked a cookie
    report.note("  -- 5. cleanup: the token set this phase created, removed");
    if (second === undefined) {
      report.skip(
        "revoking the second token",
        "the lifecycle section did not mint one, so there is nothing to revoke",
      );
    } else {
      const last = await bearer.request("DELETE", `${TOKENS_PATH}/${second.id}`, {
        headers: bearerHeaders(second.token),
      });
      report.expectStatus(
        last,
        204,
        "the second token revokes itself, leaving the device with the token set it started with",
      );
      const dead = await bearer.get(TOKENS_PATH, { headers: bearerHeaders(second.token) });
      report.expectStatus(
        dead,
        401,
        "a token that revoked itself is refused on its own next request: 401",
      );
    }

    report.check(
      bearer.jar.names().length === 0,
      "the bearer client's jar is STILL empty at the end: every /api/v1/ request in this phase was driven by the token alone",
      `actual: ${JSON.stringify(bearer.jar.names())}`,
    );
  },
};

export default phase;
