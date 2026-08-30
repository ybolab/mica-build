/**
 * The build-time half of `os/pkgs/mosd/tests/apid-api`: every phase literal that is ALSO
 * stated in `os/pkgs/mosd/apid/openapi.json`, asserted to agree with it.
 *
 * WHAT THIS EXISTS FOR. A milestone changes a shipped,
 * wire-visible value -- a status, a media type, a response member -- and a phase
 * under `src/phases/` goes on pinning the OLD value as a literal. Nothing fails
 * until somebody boots the image, because the phase only runs under a booted
 * run: `make os-apid-api-test`, forty minutes and a built image away. This file
 * closes the part of that gap that needs no boot, and says nothing about the
 * part that does.
 *
 * THERE ARE EXACTLY TWO COPIES OF EVERY VALUE, AND THIS ASSERTS THEY AGREE.
 * The phase file's literal is read out of the phase file's own bytes -- never
 * imported, never restated here -- and compared against what `openapi.json`
 * declares. A row carries no copy of the status or the media type: it carries
 * only WHERE to read the phase's copy (`anchor`) and WHICH declaration in the
 * document it must agree with (`path`, `method`, `status`). So:
 *
 *   - the document moves and the phase does not  -> red, naming both
 *   - the phase moves and the document does not  -> red, naming both
 *   - both move together                         -> green, correctly
 *   - the anchored assertion is renamed or deleted -> red, naming the anchor
 *
 * That last one is deliberate. `docs/verify-index.sh`'s header argues at length
 * that a check which silently matches nothing is worse than no check, because
 * it reports the same green either way. An anchor that finds 0 sites, or 2, is
 * a hard failure here rather than a skipped row.
 *
 * SCHEMA ROWS DO carry the member names they assert, which is a third copy --
 * and that is sound rather than sloppy, because the row's names must be found
 * IN THE PHASE'S OWN SOURCE SPAN before they are looked up in the document. A
 * stale name in this table can therefore only produce a false RED, never a
 * false green.
 *
 * WHAT IS NOT HERE. Every pin whose agreement cannot be asserted against a
 * committed artefact: the HTML pane surface (`/login`, `/setup`, `/power/*`,
 * `/healthz` -- `openapi.json` documents `/api/` and nothing else), the error
 * `code` VALUES (`ApiErrorDetail.code` is declared an open set with no enum, so
 * no artefact states which code a given route and status answers), response
 * HEADERS (`openapi.json` carries no `headers` member anywhere -- measured:
 * zero occurrences), the `/api/v1/state/...` bodies (declared `ResourceValue`,
 * i.e. any JSON), and everything timing-, console- or reboot-shaped. Those are
 * the section 4, not this file's silence.
 *
 * Runs with no network, no docker, no QEMU and no image:
 *
 *     bun run spec-pins          # from os/pkgs/mosd/tests/apid-api
 *     make os-apid-api-spec-pins # from the repository root, in the pinned bun
 */

const REPO_ROOT = new URL("../../../../../../", import.meta.url);
const OPENAPI = new URL("os/pkgs/mosd/apid/openapi.json", REPO_ROOT);
const HARNESS_ROOT = new URL("../", import.meta.url);

/** Where the phase's copy of the value is read from. */
type Span = "call" | "line";

interface StatusPin {
  readonly kind: "status";
  readonly file: string;
  readonly anchor: string;
  readonly path: string;
  readonly method: string;
  readonly what: string;
}

interface MediaPin {
  readonly kind: "media";
  readonly file: string;
  readonly anchor: string;
  readonly path: string;
  readonly method: string;
  readonly status: string;
  readonly what: string;
}

interface SchemaPin {
  readonly kind: "schema";
  readonly file: string;
  readonly anchor: string;
  readonly span: Span;
  readonly schema: string;
  /** required: in `required`. present: in `properties`. optional: in
   *  `properties` and NOT in `required`. absent: in neither. exact: the schema's
   *  `required` AND `properties` are exactly these names and no others. */
  readonly mode: "required" | "present" | "optional" | "absent" | "exact";
  readonly names: readonly string[];
  readonly what: string;
}

type Pin = StatusPin | MediaPin | SchemaPin;

const BEARER = "src/phases/05d-bearer.ts";
const WIREGUARD = "src/phases/05b-wireguard.ts";
const READONLY = "src/phases/04-readonly.ts";

const SETTINGS = "/api/v1/settings/{path}";
const KEYS = "/api/v1/ssh/authorized-keys";
const KEY = "/api/v1/ssh/authorized-keys/{fingerprint}";
const TOKENS = "/api/v1/tokens";
const TOKEN = "/api/v1/tokens/{id}";
const ROTATE = "/api/v1/actions/wireguard/{iface}/rotate-key";
const VERSIONS = "/api/versions";

const PINS: readonly Pin[] = [
  // -- statuses: `paths.<path>.<method>.responses.<status>` must exist --------
  { kind: "status", file: BEARER, anchor: "a settings READ over the bearer", method: "get", path: SETTINGS, what: "the bearer settings read" },
  { kind: "status", file: BEARER, anchor: "the flag this phase writes reads back before it is touched", method: "get", path: SETTINGS, what: "the pre-write settings read" },
  { kind: "status", file: BEARER, anchor: "a settings WRITE over the bearer", method: "put", path: SETTINGS, what: "the bearer settings write" },
  { kind: "status", file: BEARER, anchor: "so this phase leaves the device as it found it", method: "put", path: SETTINGS, what: "the settings restore" },
  { kind: "status", file: BEARER, anchor: "a collection LISTING over the bearer", method: "get", path: KEYS, what: "the authorized-keys listing" },
  { kind: "status", file: BEARER, anchor: "a collection POST over the bearer", method: "post", path: KEYS, what: "the authorized-keys add" },
  { kind: "status", file: BEARER, anchor: "a collection DELETE over the bearer", method: "delete", path: KEY, what: "the authorized-keys delete" },
  { kind: "status", file: BEARER, anchor: "an ACTION over the bearer", method: "post", path: ROTATE, what: "the rotate action over the bearer" },
  { kind: "status", file: BEARER, anchor: "GET /api/v1/tokens over the bearer is", method: "get", path: TOKENS, what: "the token listing" },
  { kind: "status", file: BEARER, anchor: "with the first token as credential mints a second", method: "post", path: TOKENS, what: "the second mint" },
  { kind: "status", file: BEARER, anchor: "revokes the first token, addressed by id", method: "delete", path: TOKEN, what: "the first revocation" },
  { kind: "status", file: BEARER, anchor: "the revoked token is refused on the very NEXT request", method: "get", path: SETTINGS, what: "the revoked token's refusal" },
  { kind: "status", file: BEARER, anchor: "the second token still drives the API in the same breath", method: "get", path: SETTINGS, what: "the surviving token" },
  { kind: "status", file: BEARER, anchor: "a request carrying NO credential is", method: "get", path: SETTINGS, what: "the no-credential refusal" },
  { kind: "status", file: BEARER, anchor: "a bearer token this device does not hold is", method: "get", path: SETTINGS, what: "the unknown-token refusal" },
  { kind: "status", file: BEARER, anchor: "the second token revokes itself, leaving the device", method: "delete", path: TOKEN, what: "the self-revocation" },
  { kind: "status", file: BEARER, anchor: "a token that revoked itself is refused on its own next request", method: "get", path: TOKENS, what: "the self-revoked token's refusal" },
  { kind: "status", file: WIREGUARD, anchor: "an UNAUTHENTICATED rotate answers", method: "post", path: ROTATE, what: "the unauthenticated rotate" },
  { kind: "status", file: WIREGUARD, anchor: "rotating an interface that is not a declared network entry at all is", method: "post", path: ROTATE, what: "the undeclared-interface rotate" },
  { kind: "status", file: WIREGUARD, anchor: "${ROTATE_PATH} answers", method: "post", path: ROTATE, what: "the rotation itself" },
  { kind: "status", file: WIREGUARD, anchor: "GET on the rotate route is", method: "post", path: ROTATE, what: "the rotate route's method guard" },
  { kind: "status", file: READONLY, anchor: "an UNAUTHENTICATED GET /api/versions answers", method: "get", path: VERSIONS, what: "the discovery route" },

  // -- media types: the response declares `content.<media>` ------------------
  { kind: "media", file: READONLY, anchor: "the unauthenticated /api/versions answer is typed", method: "get", path: VERSIONS, status: "200", what: "the discovery route's media type" },
  { kind: "media", file: WIREGUARD, anchor: "the unauthenticated rotate is typed", method: "post", path: ROTATE, status: "401", what: "the unauthenticated rotate's media type" },
  { kind: "media", file: BEARER, anchor: "the 401 is JSON, so a client that parses the envelope", method: "get", path: SETTINGS, status: "401", what: "the no-credential refusal's media type" },

  // -- response members: `components.schemas.<name>` -------------------------
  { kind: "schema", file: BEARER, anchor: "the listing is an object carrying", span: "call", schema: "AuthorizedKeyList", mode: "required", names: ["keys", "notice"], what: "the authorized-keys listing's members" },
  { kind: "schema", file: BEARER, anchor: 'isRecord(added["key"]) ? added["key"]["fingerprint"]', span: "line", schema: "AddedAuthorizedKey", mode: "required", names: ["key"], what: "the add response's `key`" },
  { kind: "schema", file: BEARER, anchor: 'isRecord(added["key"]) ? added["key"]["fingerprint"]', span: "line", schema: "AuthorizedKeyEntry", mode: "present", names: ["fingerprint"], what: "the entry's `fingerprint`" },
  { kind: "schema", file: WIREGUARD, anchor: 'members[0] === "publicKey"', span: "line", schema: "WireguardRotation", mode: "exact", names: ["publicKey"], what: "the rotation body, which is publicKey AND NOTHING ELSE" },
  { kind: "schema", file: BEARER, anchor: '!rotate.body.includes("privateKey")', span: "line", schema: "WireguardRotation", mode: "absent", names: ["privateKey"], what: "no private half in the rotation body" },
  { kind: "schema", file: BEARER, anchor: 'row["id"] === first.id && row["name"] === BOOTSTRAP_NAME', span: "line", schema: "ApiTokenSummary", mode: "required", names: ["id", "name"], what: "the token summary's members" },
  { kind: "schema", file: BEARER, anchor: 'const token = isRecord(minted) ? minted["token"] : undefined;', span: "line", schema: "MintedToken", mode: "required", names: ["token"], what: "the mint's plaintext member" },
  { kind: "schema", file: BEARER, anchor: 'const id = isRecord(minted) ? minted["id"] : undefined;', span: "line", schema: "MintedToken", mode: "required", names: ["id"], what: "the mint's id member" },
  { kind: "schema", file: BEARER, anchor: 'typeof detail["message"] === "string"', span: "line", schema: "ApiErrorDetail", mode: "required", names: ["message"], what: "the envelope's human message" },
  { kind: "schema", file: READONLY, anchor: 'const error = (parsed as Record<string, unknown>)["error"];', span: "line", schema: "ApiError", mode: "required", names: ["error"], what: "the envelope's one member" },
  { kind: "schema", file: READONLY, anchor: 'errorObject?.["code"] === "not_found"', span: "line", schema: "ApiErrorDetail", mode: "required", names: ["code"], what: "the envelope's machine token" },
  { kind: "schema", file: READONLY, anchor: 'errorObject?.["source"] === "apid"', span: "line", schema: "ApiErrorDetail", mode: "required", names: ["source"], what: "the envelope's source" },
  { kind: "schema", file: READONLY, anchor: '!Object.hasOwn(errorObject, "path")', span: "line", schema: "ApiErrorDetail", mode: "optional", names: ["path"], what: "the envelope's dot-path, declared but not required" },
];

// -- reporting, in the register run.sh and the verification contract use ---------

let passes = 0;
let failures = 0;

function pass(what: string): void {
  passes += 1;
  console.log(`PASS: ${what}`);
}

function fail(what: string, detail: readonly string[]): void {
  failures += 1;
  console.log(`FAIL: ${what}`);
  for (const line of detail) console.log(`    ${line}`);
}

// -- reading the phase's own copy --------------------------------------------

const sources = new Map<string, string>();

async function sourceOf(file: string): Promise<string> {
  const held = sources.get(file);
  if (held !== undefined) return held;
  const text = await Bun.file(new URL(file, HARNESS_ROOT)).text();
  sources.set(file, text);
  return text;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/**
 * The single occurrence of `anchor`, or a sentence saying why there is not one.
 *
 * Zero and two are both errors: a renamed assertion and a duplicated one each
 * mean this row no longer names one place in the phase, and a row that quietly
 * matched nothing would print the same green as a row that matched and agreed.
 */
function locate(source: string, anchor: string): { at: number } | { why: string } {
  const first = source.indexOf(anchor);
  if (first === -1) {
    return {
      why: `no occurrence of the anchor -- the assertion it names was renamed or deleted, so this row reads nothing`,
    };
  }
  const second = source.indexOf(anchor, first + 1);
  if (second !== -1) {
    return {
      why: `${countOccurrences(source, anchor)} occurrences of the anchor (first at line ${lineOf(source, first)}, next at line ${lineOf(source, second)}) -- an anchor must name ONE site`,
    };
  }
  return { at: first };
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let at = source.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = source.indexOf(needle, at + 1);
  }
  return count;
}

/** The whole source line holding `at`. */
function lineSpan(source: string, at: number): string {
  const start = source.lastIndexOf("\n", at) + 1;
  const end = source.indexOf("\n", at);
  return source.slice(start, end === -1 ? source.length : end);
}

/**
 * The `report.<something>(..)` call holding `at`, parens balanced.
 *
 * Walks back to the nearest `report.` before the anchor -- every assertion in
 * this harness goes through the reporter, so that is the statement boundary --
 * and forward to the paren that closes it.
 */
function callSpan(source: string, at: number): string | undefined {
  const start = source.lastIndexOf("report.", at);
  if (start === -1) return undefined;
  const open = source.indexOf("(", start);
  if (open === -1 || open > at) return undefined;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return undefined;
}

/**
 * Blank out every string, template and regex literal in a span.
 *
 * The status extractor below counts INTEGER LITERALS, and every one of these
 * assertions also spells its status out in the prose a red line prints -- "is
 * 401", "answers 200". Those are characters inside a string; masking is what
 * keeps them from being read as a second pinned value and turning every row
 * into "expected exactly one, found two".
 */
function maskLiterals(span: string): string {
  let out = "";
  let i = 0;
  while (i < span.length) {
    const c = span[i] ?? "";
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += " ";
      i += 1;
      while (i < span.length) {
        const d = span[i] ?? "";
        if (d === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (d === quote) {
          out += " ";
          i += 1;
          break;
        }
        out += d === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }
    if (c === "/" && span[i + 1] === "^") {
      // A regex literal, which these assertions only ever open with `^`.
      out += " ";
      i += 1;
      while (i < span.length) {
        const d = span[i] ?? "";
        if (d === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (d === "/") {
          out += " ";
          i += 1;
          break;
        }
        out += d === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Every integer literal in [100, 599] left after masking. */
function statusLiterals(span: string): number[] {
  const found: number[] = [];
  for (const match of maskLiterals(span).matchAll(/\b(\d{3})\b/g)) {
    const value = Number(match[1]);
    if (value >= 100 && value <= 599) found.push(value);
  }
  return found;
}

// -- reading the document's copy ---------------------------------------------

interface Document {
  readonly paths: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, unknown> }> }>>;
  readonly components: { schemas: Record<string, { required?: string[]; properties?: Record<string, unknown> }> };
}

function operationOf(doc: Document, path: string, method: string): Record<string, { content?: Record<string, unknown> }> | string {
  const item = doc.paths[path];
  if (item === undefined) {
    return `openapi.json declares no path ${path} at all. Declared: ${Object.keys(doc.paths).join(", ")}`;
  }
  const operation = item[method];
  if (operation === undefined) {
    return `openapi.json declares ${path} but not the ${method.toUpperCase()} on it. Declared methods: ${Object.keys(item).join(", ").toUpperCase()}`;
  }
  return operation.responses ?? {};
}

// -- the checks ---------------------------------------------------------------

async function checkStatus(pin: StatusPin, doc: Document): Promise<void> {
  const what = `${pin.file}: ${pin.what} pins the status ${pin.method.toUpperCase()} ${pin.path} declares`;
  const source = await sourceOf(pin.file);
  const found = locate(source, pin.anchor);
  if ("why" in found) {
    fail(what, [`anchor:   ${JSON.stringify(pin.anchor)}`, `actual:   ${found.why}`]);
    return;
  }
  const line = lineOf(source, found.at);
  const span = callSpan(source, found.at);
  if (span === undefined) {
    fail(what, [
      `${pin.file}:${line}`,
      `actual:   the anchor is not inside a report.<..>(..) call, so there is no assertion to read a status out of`,
    ]);
    return;
  }
  const literals = statusLiterals(span);
  if (literals.length !== 1) {
    fail(what, [
      `${pin.file}:${line}`,
      `expected: exactly one HTTP status literal in the anchored assertion`,
      `actual:   ${literals.length === 0 ? "none" : literals.join(", ")}`,
      `span:     ${flatten(span)}`,
    ]);
    return;
  }
  const pinned = String(literals[0]);
  const responses = operationOf(doc, pin.path, pin.method);
  if (typeof responses === "string") {
    fail(what, [`${pin.file}:${line}`, `pinned:   ${pinned}`, `actual:   ${responses}`]);
    return;
  }
  if (!Object.hasOwn(responses, pinned)) {
    fail(what, [
      `${pin.file}:${line}`,
      `pinned:   ${pinned}   (the literal in the phase file, right now)`,
      `pointer:  /paths/${escapePointer(pin.path)}/${pin.method}/responses/${pinned}`,
      `declared: ${Object.keys(responses).join(", ")}   (what openapi.json says this operation answers)`,
      `read as:  the phase asserts a status openapi.json does not declare for this route.`,
      `          Either a milestone moved the shipped status and this phase still pins the`,
      `          old one, or the phase was pointed at the wrong route.`,
    ]);
    return;
  }
  pass(`${what} (${pinned})`);
}

async function checkMedia(pin: MediaPin, doc: Document): Promise<void> {
  const what = `${pin.file}: ${pin.what} pins a media type ${pin.method.toUpperCase()} ${pin.path} ${pin.status} declares`;
  const source = await sourceOf(pin.file);
  const found = locate(source, pin.anchor);
  if ("why" in found) {
    fail(what, [`anchor:   ${JSON.stringify(pin.anchor)}`, `actual:   ${found.why}`]);
    return;
  }
  const line = lineOf(source, found.at);
  const span = callSpan(source, found.at);
  if (span === undefined) {
    fail(what, [`${pin.file}:${line}`, `actual:   the anchor is not inside a report.<..>(..) call`]);
    return;
  }
  // `\/` in a regex literal is the same media type as `/` in a string; the
  // backslashes come out before the comparison rather than being spelled twice.
  const flat = span.replace(/\\/g, "");
  const responses = operationOf(doc, pin.path, pin.method);
  if (typeof responses === "string") {
    fail(what, [`${pin.file}:${line}`, `actual:   ${responses}`]);
    return;
  }
  const response = responses[pin.status];
  if (response === undefined) {
    fail(what, [
      `${pin.file}:${line}`,
      `expected: a ${pin.status} response on ${pin.method.toUpperCase()} ${pin.path}`,
      `declared: ${Object.keys(responses).join(", ")}`,
    ]);
    return;
  }
  const declared = Object.keys(response.content ?? {});
  const pinned = declared.filter((media) => flat.includes(media));
  if (pinned.length === 0) {
    fail(what, [
      `${pin.file}:${line}`,
      `expected: the anchored assertion to name one of the media types openapi.json declares`,
      `declared: ${declared.join(", ") || "(the response declares no content at all)"}`,
      `pointer:  /paths/${escapePointer(pin.path)}/${pin.method}/responses/${pin.status}/content`,
      `span:     ${flatten(span)}`,
      `read as:  the phase asserts a Content-Type this response is not documented to send.`,
    ]);
    return;
  }
  pass(`${what} (${pinned.join(", ")})`);
}

async function checkSchema(pin: SchemaPin, doc: Document): Promise<void> {
  const what = `${pin.file}: ${pin.what} agrees with components.schemas.${pin.schema}`;
  const source = await sourceOf(pin.file);
  const found = locate(source, pin.anchor);
  if ("why" in found) {
    fail(what, [`anchor:   ${JSON.stringify(pin.anchor)}`, `actual:   ${found.why}`]);
    return;
  }
  const line = lineOf(source, found.at);
  const span = pin.span === "line" ? lineSpan(source, found.at) : callSpan(source, found.at);
  if (span === undefined) {
    fail(what, [`${pin.file}:${line}`, `actual:   the anchor is not inside a report.<..>(..) call`]);
    return;
  }
  // The row's names are checked against the PHASE first. A name this table
  // claims but the phase does not spell is a stale row, and it goes red here
  // rather than being looked up in the document and passing on the strength of
  // this file alone.
  const unspelled = pin.names.filter((name) => !span.includes(`"${name}"`));
  if (unspelled.length > 0) {
    fail(what, [
      `${pin.file}:${line}`,
      `expected: the anchored source to spell ${pin.names.map((n) => JSON.stringify(n)).join(", ")}`,
      `actual:   it does not spell ${unspelled.map((n) => JSON.stringify(n)).join(", ")}`,
      `span:     ${flatten(span)}`,
      `read as:  this row is stale -- the phase renamed the member it pins.`,
    ]);
    return;
  }

  const schema = doc.components.schemas[pin.schema];
  if (schema === undefined) {
    fail(what, [
      `${pin.file}:${line}`,
      `actual:   openapi.json declares no schema named ${pin.schema}. Declared: ${Object.keys(doc.components.schemas).join(", ")}`,
    ]);
    return;
  }
  const required = schema.required ?? [];
  const properties = Object.keys(schema.properties ?? {});
  const pointer = `/components/schemas/${pin.schema}`;

  const wrong: string[] = [];
  for (const name of pin.names) {
    if (pin.mode === "required" && !required.includes(name)) wrong.push(`${name} is not in required`);
    if (pin.mode === "present" && !properties.includes(name)) wrong.push(`${name} is not a property`);
    if (pin.mode === "optional" && !properties.includes(name)) wrong.push(`${name} is not a property`);
    if (pin.mode === "optional" && required.includes(name)) wrong.push(`${name} IS in required, so the phase's "absent here" assertion contradicts the document`);
    if (pin.mode === "absent" && properties.includes(name)) wrong.push(`${name} IS a property, and the phase asserts no response ever carries it`);
  }
  if (pin.mode === "exact") {
    const names = [...pin.names].sort().join(", ");
    if ([...required].sort().join(", ") !== names) wrong.push(`required is [${required.join(", ")}], not [${names}]`);
    if ([...properties].sort().join(", ") !== names) wrong.push(`properties are [${properties.join(", ")}], not [${names}]`);
  }
  if (wrong.length > 0) {
    fail(what, [
      `${pin.file}:${line}`,
      `pinned:   ${pin.names.map((n) => JSON.stringify(n)).join(", ")} (${pin.mode})`,
      `pointer:  ${pointer}`,
      `declared: required = [${required.join(", ")}]; properties = [${properties.join(", ")}]`,
      ...wrong.map((line) => `actual:   ${line}`),
      `read as:  the phase asserts a body shape openapi.json no longer declares.`,
    ]);
    return;
  }
  pass(`${what} (${pin.mode}: ${pin.names.join(", ")})`);
}

function escapePointer(path: string): string {
  return path.replace(/~/g, "~0").replace(/\//g, "~1");
}

function flatten(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= 200 ? one : `${one.slice(0, 200)}...`;
}

// -- the run ------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`note: reading ${OPENAPI.pathname}`);
  let doc: Document;
  try {
    doc = JSON.parse(await Bun.file(OPENAPI).text()) as Document;
  } catch (error) {
    console.log("FAIL: the committed OpenAPI document is readable JSON");
    console.log(`    ${OPENAPI.pathname}: ${error instanceof Error ? error.message : String(error)}`);
    console.log("RESULT: FAIL (0/1 checks)");
    process.exitCode = 1;
    return;
  }

  for (const pin of PINS) {
    if (pin.kind === "status") await checkStatus(pin, doc);
    else if (pin.kind === "media") await checkMedia(pin, doc);
    else await checkSchema(pin, doc);
  }

  const total = passes + failures;
  // Zero checks is a failure, for the reason run.sh gives about its own totals:
  // "no FAIL lines" is equally true of a run in which nothing executed at all.
  if (total === 0) {
    console.log("FAIL: the pin table is not empty");
    console.log("    PINS carries no rows, so this run asserted nothing and must not read as success.");
    console.log("RESULT: FAIL (0/1 checks)");
    process.exitCode = 1;
    return;
  }
  console.log(`RESULT: ${failures === 0 ? "PASS" : "FAIL"} (${passes}/${total} checks)`);
  if (failures > 0) process.exitCode = 1;
}

await main();
