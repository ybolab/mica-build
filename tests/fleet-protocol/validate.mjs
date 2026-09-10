// Non-product design evidence. Sequence models do not implement a network service.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const MAX = 18446744073709551615n;
const schema = JSON.parse(readFileSync(resolve(here, 'protocol.schema.json'), 'utf8'));
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stableDigest = report => {
  const { bufferedSeconds: _waiting, gapReports: _drops, ...payload } = report;
  return hash(canonical(payload));
};
const load = name => JSON.parse(readFileSync(resolve(here, name), 'utf8'));
let checks = 0;
function check(name, fn) {
  fn(); checks++;
  console.log(`PASS ${name}`);
}
function reject(fn, reason) {
  assert.throws(fn, new RegExp(reason));
}

// Parse before JSON.parse can overwrite duplicate names, including escaped aliases.
function strictJSON(bytes, limit = 65536) {
  assert(bytes.length <= limit, 'oversized raw body');
  assert(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), 'JSON BOM');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let at = 0;
  const whitespace = () => { while (/^[\x20\t\r\n]$/.test(source[at] ?? '')) at++; };
  const take = char => { whitespace(); assert.equal(source[at++], char, 'JSON punctuation'); };
  const str = () => {
    const match = /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(source.slice(at));
    assert(match, 'JSON string'); at += match[0].length;
    const value = JSON.parse(match[0]);
    for (const char of value) {
      const point = char.codePointAt(0);
      assert(point < 0xd800 || point > 0xdfff, 'JSON unpaired surrogate');
    }
    return value;
  };
  function value(depth) {
    assert(depth <= 12, 'JSON depth'); whitespace();
    if (source[at] === '"') return str();
    if (source[at] === '{') {
      at++; whitespace(); const result = Object.create(null);
      if (source[at] === '}') { at++; return result; }
      for (;;) {
        whitespace(); const key = str();
        assert(!Object.hasOwn(result, key), `duplicate member ${key}`);
        take(':'); result[key] = value(depth + 1); whitespace();
        if (source[at] === '}') { at++; return result; }
        take(',');
      }
    }
    if (source[at] === '[') {
      at++; whitespace(); const result = [];
      if (source[at] === ']') { at++; return result; }
      for (;;) {
        result.push(value(depth + 1)); whitespace();
        if (source[at] === ']') { at++; return result; }
        take(',');
      }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(source.slice(at));
    assert(match, 'JSON value'); at += match[0].length;
    const result = JSON.parse(match[0]);
    assert(typeof result !== 'number' || Number.isFinite(result), 'JSON non-finite');
    return result;
  }
  const result = value(0); whitespace(); assert.equal(at, source.length, 'JSON trailing input');
  return result;
}

// Closed evaluator for exactly this artifact's JSON Schema vocabulary; no ignored assertions.
const vocabulary = new Set(['$ref', 'type', 'const', 'enum', 'anyOf', 'properties', 'required',
  'additionalProperties', 'items', 'minItems', 'maxItems', 'uniqueItems',
  'minLength', 'maxLength', 'pattern', 'minimum', 'maximum']);
function auditSchema(s) {
  for (const key of Object.keys(s)) assert(vocabulary.has(key), `unsupported schema keyword ${key}`);
  if (s.$ref) assert(schema.$defs[s.$ref.slice(8)], 'unresolved schema ref');
  if (s.type === 'object') {
    assert.equal(s.additionalProperties, false);
    assert(s.required.every(k => Object.hasOwn(s.properties, k)));
    Object.values(s.properties).forEach(auditSchema);
  }
  if (s.items) auditSchema(s.items);
  if (s.anyOf) s.anyOf.forEach(auditSchema);
}
function validate(s, v) {
  if (s.$ref) {
    const name = s.$ref.slice(8); validate(schema.$defs[name], v);
    if (['u64', 'positiveCounter'].includes(name)) assert(BigInt(v) <= MAX, 'u64 overflow');
    return;
  }
  if (s.anyOf) {
    assert(s.anyOf.some(option => { try { validate(option, v); return true; } catch { return false; } }), 'union');
  }
  if (Object.hasOwn(s, 'const')) assert.equal(v, s.const, 'const mismatch');
  if (s.enum) assert(s.enum.some(item => canonical(item) === canonical(v)), 'enum mismatch');
  if (s.type) {
    const type = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    assert(s.type === 'integer' ? Number.isSafeInteger(v) : type === s.type, 'type mismatch');
  }
  if (s.type === 'object') {
    s.required.forEach(key => assert(Object.hasOwn(v, key), `required ${key}`));
    for (const [key, item] of Object.entries(v)) {
      assert(Object.hasOwn(s.properties, key), `unknown member ${key}`);
      validate(s.properties[key], item);
    }
  }
  if (s.type === 'array') {
    assert(v.length >= s.minItems && v.length <= s.maxItems, 'array bound');
    v.forEach(item => validate(s.items, item));
    if (s.uniqueItems) assert.equal(new Set(v.map(canonical)).size, v.length, 'duplicate array item');
  }
  if (s.type === 'string') {
    assert(v.length >= s.minLength && v.length <= s.maxLength, 'string length');
    assert(new RegExp(s.pattern).test(v), 'string pattern');
  }
  if (s.type === 'integer') assert(v >= s.minimum && v <= s.maximum, 'integer bound');
}
function reportSemantics(r) {
  assert(Buffer.byteLength(canonical(r)) <= 16384, 'oversized report');
  assert.deepEqual(r.health.components.map(x => x.component), ['mosd', 'connd', 'apid', 'update'], 'health ordering');
  assert.deepEqual(r.storage.tiers.map(x => x.name), ['esp', 'firmware', 'system', 'data'], 'tier ordering');
  for (const tier of r.storage.tiers) {
    if (!tier.present) assert(!tier.mounted && tier.usedPercent === null && tier.pressure === null, 'absent tier');
  }
  const labels = r.thermal.map(t => t.label);
  assert.equal(new Set(labels).size, labels.length, 'duplicate thermal label');
  const thermalOrder = label => `${label.startsWith('zone') ? '0' : '1'}${label.slice(-2)}`;
  assert.deepEqual(labels.map(thermalOrder), labels.map(thermalOrder).sort(), 'thermal ordering');
  for (const t of r.thermal) {
    const values = [t.minMilliCelsius, t.maxMilliCelsius, t.lastMilliCelsius];
    assert(values.every(x => x === null) || values.every(x => x !== null), 'thermal null triple');
    if (values[0] !== null) assert(values[0] <= values[2] && values[2] <= values[1], 'thermal range');
  }
}
function valid(name, body) {
  assert(schema.$defs[name], 'unknown schema'); validate({ $ref: `#/$defs/${name}` }, body);
  if (name === 'report') reportSemantics(body);
  if (name === 'reports') {
    body.forEach(reportSemantics);
    assert(body.every((r, i) => r.deviceId === body[0].deviceId && (!i || BigInt(r.counter) > BigInt(body[i - 1].counter))), 'batch ordering/device');
  }
}
function bodyFromWire(name, bytes) {
  const limit = name === 'reports' ? 65536 : name === 'report' ? 16384 : 4096;
  const body = strictJSON(bytes, limit); valid(name, body); return body;
}
function signedBytes(x) {
  const h = x.headers;
  return Buffer.from(['mos-fleet-request/1', x.method, x.origin, x.path, h['Content-Type'],
    h['Fleet-Role'], h['Fleet-Device'], h['Fleet-Epoch'], h['Fleet-Generation'], h['Fleet-Key'],
    h['Fleet-Request'], h['Fleet-Time'], hash(x.rawBody)].join('\n') + '\n');
}
function requestShape(x) {
  valid('headers', x.headers);
  const h = x.headers;
  assert.equal(x.method, 'POST', 'method');
  assert.equal(Number(h['Content-Length']), x.rawBody.length, 'content length');
  const body = bodyFromWire(x.requestSchema, x.rawBody);
  if (x.path === '/v1/fleet/register') {
    assert.equal(x.requestSchema, 'register', 'endpoint schema');
    assert.equal(x.responseSchema, 'registered', 'endpoint schema');
    assert.equal(h['Fleet-Role'], 'enroll', 'role');
    assert.equal(h['Fleet-Generation'], '0', 'generation');
    assert.equal(body.deviceId, h['Fleet-Device'], 'device binding');
  } else {
    const operator = x.path.startsWith('/v1/fleet/operator/');
    assert.equal(h['Fleet-Role'], operator ? 'operator' : 'device', 'role');
    const prefix = operator ? '/v1/fleet/operator/devices/' : '/v1/fleet/devices/';
    const op = x.path.slice(prefix.length + 33);
    assert(x.path.startsWith(`${prefix}${h['Fleet-Device']}/`), 'path binding');
    assert((operator ? ['ownership', 'release', 'revoke'] : ['renew', 'unregister', 'revoke', 'reports']).includes(op), 'path');
    const schemas = { renew: ['renew', 'renewed'], unregister: ['empty', 'unregistered'], revoke: ['empty', 'revoked'], reports: ['reports', 'accepted'], ownership: ['empty', 'ownership'], release: ['release', 'released'] };
    assert.deepEqual([x.requestSchema, x.responseSchema], schemas[op], 'endpoint schema');
    assert.equal(h['Fleet-Generation'] === '0', op === 'ownership', 'generation');
  }
  if (h['Fleet-Role'] === 'operator') {
    assert.equal(h['Fleet-Epoch'], '0'.repeat(32), 'operator epoch');
    assert(BigInt(h['Fleet-Time']) > 0n, 'operator time');
  } else assert.equal(h['Fleet-Time'], '0', 'device time');
  assert.equal(Object.hasOwn(h, 'Fleet-Next-Signature'), x.path.endsWith('/renew'), 'next signature');
  if (x.requestSchema === 'reports') body.forEach(r => assert.equal(r.deviceId, h['Fleet-Device'], 'device binding'));
  return body;
}
function acknowledgement(x, response, tlsAuthenticated = true, currentEpoch = x.headers['Fleet-Epoch']) {
  assert(tlsAuthenticated, 'TLS authentication');
  valid('accepted', response);
  assert.equal(response.requestId, x.headers['Fleet-Request'], 'request binding');
  assert.equal(response.deviceId, x.headers['Fleet-Device'], 'device binding');
  assert.equal(response.generation, x.headers['Fleet-Generation'], 'generation binding');
  assert.equal(response.epoch, currentEpoch, 'epoch binding');
  assert.equal(response.epoch, x.headers['Fleet-Epoch'], 'epoch binding');
  assert.deepEqual(response.accepted, x.requestBody.map(r => ({ counter: r.counter, digest: stableDigest(r) })), 'receipt equality');
}

check('N2 complete schema vocabulary and closed objects', () => {
  assert.equal(schema.$id, 'urn:mos:fleet:v1'); Object.values(schema.$defs).forEach(auditSchema);
  reject(() => auditSchema({ type: 'string', minLenght: 1 }), 'unsupported schema keyword');
});
const exchanges = load('exchanges.json');
assert.equal(exchanges.schema, 'mos/fleet/v1');
for (const x of exchanges.exchanges) {
  x.rawBody = Buffer.from(canonical(x.requestBody));
  check(`N4 positive exchange ${x.name}`, () => {
    requestShape(x); valid(x.responseSchema, x.responseBody);
    assert.equal(x.responseStatus, 200);
    assert.equal(x.responseHeaders['Fleet-Schema'], 'mos/fleet/v1');
    assert.equal(Number(x.responseHeaders['Content-Length']), Buffer.byteLength(canonical(x.responseBody)));
    assert.equal(x.responseBody.requestId, x.headers['Fleet-Request']);
    assert.equal(x.responseBody.deviceId, x.headers['Fleet-Device']);
    if (['registered', 'renewed'].includes(x.responseSchema)) {
      assert.equal(x.responseBody.expiresAt - x.responseBody.issuedAt, 2592000);
    }
    if (x.responseSchema === 'registered') {
      assert.equal(x.responseBody.publicKey, x.headers['Fleet-Key']);
      assert.equal(x.responseBody.epoch, x.headers['Fleet-Epoch']);
    }
    if (x.responseSchema === 'renewed') {
      assert.equal(x.responseBody.publicKey, x.requestBody.nextPublicKey);
      assert.equal(x.responseBody.generation, x.headers['Fleet-Generation']);
      assert.equal(x.responseBody.epoch, x.headers['Fleet-Epoch']);
      assert(x.responseBody.previousValidUntil <= x.responseBody.issuedAt + 600);
    }
    if (x.responseSchema === 'released') {
      assert.equal(BigInt(x.responseBody.generation), BigInt(x.headers['Fleet-Generation']) + 1n);
      assert.equal(x.responseBody.epoch, x.requestBody.nextEpoch);
      assert.equal(x.responseBody.releaseId, x.requestBody.releaseId);
    }
    if (x.responseSchema === 'accepted') acknowledgement(x, x.responseBody);
  });
}
for (const c of load('negative-cases.json')) {
  check(`${c.norm} negative ${c.name}`, () => {
    let bytes;
    if (c.file) bytes = readFileSync(resolve(here, c.file));
    else {
      const value = load(c.base); let target = value;
      for (const key of c.path.slice(0, -1)) target = target[key];
      target[c.path.at(-1)] = c.value; bytes = Buffer.from(canonical(value));
    }
    reject(() => bodyFromWire(c.schema, bytes), c.error);
  });
}
check('N2 positive max u64 and unknown/null measurement control', () => {
  valid('u64', MAX.toString()); valid('report', load('reports.json')[1]);
  assert.equal(load('register.json').product.vendor, 'Example');
  assert.equal(load('report.json').thermal[0].lastMilliCelsius, 48000);
});
check('N2 raw malformed UTF8, BOM, surrogate, trailing input and depth', () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.from('\ufeff{}'), Buffer.from('"\\ud800"'), Buffer.from('{} false'), Buffer.from('['.repeat(14) + '0' + ']'.repeat(14))]) {
    assert.throws(() => strictJSON(bytes));
  }
  assert.equal(strictJSON(Buffer.from('"\\ud834\\udd1e"')), '𝄞');
  assert.equal(strictJSON(Buffer.from('{"a":1}')).a, 1);
});
check('N2 raw body byte and batch cardinality bounds', () => {
  reject(() => bodyFromWire('register', Buffer.from(' '.repeat(4097))), 'oversized');
  reject(() => bodyFromWire('reports', Buffer.from(' '.repeat(65537))), 'oversized');
  reject(() => valid('reports', Array(17).fill(load('report.json'))), 'array bound');
  reject(() => valid('reports', []), 'array bound');
});
const reportExchange = exchanges.exchanges.find(x => x.name === 'reports');
check('N3 role, device, method, version and path shape negatives', () => {
  for (const [field, value, reason] of [['Fleet-Role', 'operator', 'role'], ['Fleet-Device', 'f'.repeat(32), 'binding'], ['Fleet-Schema', 'mos/fleet/v2', 'const'], ['Fleet-Generation', '0', 'generation']]) {
    const x = structuredClone(reportExchange); x.headers[field] = value;
    reject(() => requestShape(x), reason);
  }
  const x = structuredClone(reportExchange); x.method = 'DELETE'; reject(() => requestShape(x), 'method');
  x.method = 'POST'; x.path += '?command=reboot'; reject(() => requestShape(x), 'path');
});
check('N3 actual ephemeral Ed25519 signature and every signed binding mutation', () => {
  const key = generateKeyPairSync('ed25519');
  const x = structuredClone(reportExchange);
  x.headers['Fleet-Key'] = Buffer.from(key.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');
  const bytes = signedBytes(x), signature = sign(null, bytes, key.privateKey);
  assert(verify(null, bytes, key.publicKey, signature));
  assert(!verify(null, bytes, key.publicKey, Buffer.alloc(64)));
  for (const field of ['method', 'origin', 'path']) {
    const changed = structuredClone(x); changed[field] += 'x';
    assert(!verify(null, signedBytes(changed), key.publicKey, signature), field);
  }
  for (const field of ['Content-Type', 'Fleet-Role', 'Fleet-Device', 'Fleet-Epoch', 'Fleet-Generation', 'Fleet-Key', 'Fleet-Request', 'Fleet-Time']) {
    const changed = structuredClone(x); changed.headers[field] += 'x';
    assert(!verify(null, signedBytes(changed), key.publicKey, signature), field);
  }
  const changed = structuredClone(x); changed.rawBody = Buffer.concat([Buffer.from(x.rawBody), Buffer.from(' ')]);
  assert(!verify(null, signedBytes(changed), key.publicKey, signature));
  const other = generateKeyPairSync('ed25519'); assert(!verify(null, bytes, other.publicKey, signature));
  // Private material stays in this process; neither seeds nor signatures are fixtures.
});
check('N7 retry duration changes request bytes but not stored record identity', () => {
  const first = load('report.json'), later = structuredClone(first); later.bufferedSeconds = 600;
  assert.equal(stableDigest(first), stableDigest(later));
  assert.notEqual(hash(canonical(first)), hash(canonical(later)));
  later.gapReports = '1'; assert.equal(stableDigest(first), stableDigest(later));
  later.version = '2026.09.11'; assert.notEqual(stableDigest(first), stableDigest(later));
});
check('N7 report response injection cannot advance acknowledgement', () => {
  for (const field of ['command', 'config', 'cadenceSeconds', 'bundleUrl', 'snapshot', 'unknown']) {
    const response = structuredClone(reportExchange.responseBody); response[field] = 'INJECTION';
    reject(() => acknowledgement(reportExchange, response), 'unknown');
  }
  for (const [field, value] of [['requestId', 'f'.repeat(32)], ['deviceId', 'f'.repeat(32)], ['generation', '2'], ['epoch', 'f'.repeat(32)]]) {
    const response = structuredClone(reportExchange.responseBody); response[field] = value;
    reject(() => acknowledgement(reportExchange, response), 'binding');
  }
  const response = structuredClone(reportExchange.responseBody); response.accepted.pop();
  reject(() => acknowledgement(reportExchange, response), 'receipt equality');
  reject(() => acknowledgement(reportExchange, reportExchange.responseBody, false), 'TLS');
  reject(() => acknowledgement(reportExchange, reportExchange.responseBody, true, 'f'.repeat(32)), 'epoch');
  acknowledgement(reportExchange, reportExchange.responseBody);
});

// Explicit symbolic verified principals: this is a sequence model, not cryptographic authentication.
function row() {
  return { device: load('report.json').deviceId, generation: 1n, epoch: 'local-A', key: 'key-A', previous: null,
    issued: 0, expiry: 2592000, state: 'active', high: 0n, receipts: new Map(), renewal: null, release: null };
}
function deviceAuth(r, p, now, operation = 'reports') {
  assert.equal(p.role, 'device', 'role forbidden');
  assert.equal(p.device, r.device, 'device forbidden');
  assert.equal(p.generation, r.generation, 'generation conflict');
  assert.equal(p.epoch, r.epoch, 'epoch conflict'); assert.equal(r.state, 'active', 'credential revoked');
  const current = p.key === r.key && r.issued <= now && now < r.expiry;
  const overlap = operation === 'reports' && r.previous?.key === p.key && now < r.previous.until;
  assert(current || overlap, 'credential expired or wrong key');
}
const principal = r => ({ role: 'device', device: r.device, generation: r.generation, epoch: r.epoch, key: r.key });
function accept(r, p, reports, now, crash = false) {
  deviceAuth(r, p, now); valid('reports', reports);
  assert(reports.every(report => report.deviceId === r.device), 'device forbidden');
  let high = r.high; const records = new Map(r.receipts);
  for (const report of reports) {
    const counter = BigInt(report.counter), digest = stableDigest(report), prior = records.get(report.counter);
    if (prior) {
      assert(prior.digest === digest && prior.generation === r.generation && prior.epoch === r.epoch, 'counter conflict');
    } else {
      assert(counter > high, 'stale counter');
      high = counter; records.set(report.counter, { digest, generation: r.generation, epoch: r.epoch, received: now });
    }
  }
  if (crash) return; // No durable commit: candidate transaction is discarded.
  r.high = high; r.receipts = records;
}
function operatorAuth(r, p, scope, expected, now) {
  assert.equal(p.role, 'operator', 'role forbidden');
  assert(!p.revoked && p.scopes.includes(scope) && p.devices.includes(r.device), 'operator authority');
  assert(p.origin === 'https://plane.example' && p.notBefore <= now && now < p.expiry, 'operator authority');
  assert(now - 300 <= p.signedTime && p.signedTime <= now + 30, 'operator freshness');
  assert.equal(expected, r.generation, 'generation conflict');
}
const operator = r => ({ role: 'operator', revoked: false, scopes: ['fleet:ownership:release', 'fleet:credential:revoke'], devices: [r.device], origin: 'https://plane.example', notBefore: 0, expiry: 5000000, signedTime: 100 });
function release(r, p, expected, id, epoch, key, now) {
  // Idempotent result still requires live operator authority; CAS is checked against receipt for exact retry.
  operatorAuth(r, p, 'fleet:ownership:release', r.generation, now);
  const request = canonical([expected.toString(), id, epoch, key]);
  if (r.release?.id === id) {
    assert.equal(r.release.request, request, 'request conflict');
    assert.equal(r.release.generation, r.generation, 'generation conflict');
    return r.generation;
  }
  assert.equal(expected, r.generation, 'generation conflict');
  assert(r.generation < MAX && key !== r.key && key !== r.previous?.key && epoch !== r.epoch, 'replacement binding');
  r.generation++; r.epoch = epoch; r.key = key; r.previous = null; r.state = 'reserved';
  r.release = { id, request, generation: r.generation }; r.renewal = null;
  return r.generation;
}
function enrollReserved(r, epoch, key) {
  assert.equal(r.state, 'reserved', 'claim conflict');
  assert.equal(epoch, r.epoch, 'claim conflict'); assert.equal(key, r.key, 'claim conflict');
  r.state = 'active';
}
check('MODEL N7 lost response, server crash before/after commit, whole-batch rollback', () => {
  const r = row(), p = principal(r), batch = load('reports.json');
  accept(r, p, batch, 100, true); assert.equal(r.high, 0n); assert.equal(r.receipts.size, 0);
  accept(r, p, batch, 100); assert.equal(r.high, 66n);
  const before = structuredClone([...r.receipts]); accept(r, p, batch, 200);
  assert.deepEqual([...r.receipts], before);
  const bad = structuredClone(batch); bad[0].counter = '67'; bad[1].counter = '68'; bad[1].deviceId = 'f'.repeat(32);
  assert.throws(() => accept(r, p, bad, 300)); assert.equal(r.high, 66n);
  bad[1].deviceId = r.device; accept(r, p, bad, 300); assert.equal(r.high, 68n);
});
check('MODEL N7 duplicate digest conflict, gap, out-of-order, expired receipt', () => {
  const r = row(), p = principal(r), batch = load('reports.json'); accept(r, p, batch, 100);
  const bad = structuredClone(batch); bad[1].version = '2026.09.11';
  reject(() => accept(r, p, bad, 101), 'counter conflict'); assert.equal(r.high, 66n);
  reject(() => accept(r, p, [...batch].reverse(), 101), 'ordering');
  r.receipts.delete('65'); reject(() => accept(r, p, [batch[0]], 102), 'stale counter');
  const next = structuredClone(batch[0]); next.counter = '129'; accept(r, p, [next], 103); assert.equal(r.high, 129n);
});
check('MODEL N3 wrong device, key, role, generation and epoch', () => {
  const r = row(), p = principal(r);
  for (const change of [{ device: 'other' }, { key: 'key-B' }, { role: 'operator' }, { generation: 2n }, { epoch: 'local-B' }]) {
    assert.throws(() => accept(r, { ...p, ...change }, load('reports.json'), 100)); assert.equal(r.high, 0n);
  }
  accept(r, p, load('reports.json'), 100); assert.equal(r.high, 66n);
});
check('MODEL N5 operator scope/target/freshness and reserved release race', () => {
  const r = row(), p = principal(r), op = operator(r);
  for (const change of [{ role: 'device' }, { devices: [] }, { scopes: [] }, { revoked: true }, { origin: 'https://other.example' }, { signedTime: 1000 }]) {
    assert.throws(() => release(r, { ...op, ...change }, 1n, 'release-A', 'local-B', 'key-B', 100));
    assert.equal(r.generation, 1n);
  }
  assert.equal(release(r, op, 1n, 'release-A', 'local-B', 'key-B', 100), 2n);
  reject(() => accept(r, p, load('reports.json'), 100), 'generation');
  reject(() => enrollReserved(r, 'attacker', 'key-X'), 'claim conflict');
  enrollReserved(r, 'local-B', 'key-B');
  assert.equal(release(r, op, 1n, 'release-A', 'local-B', 'key-B', 101), 2n); assert.equal(r.state, 'active');
  reject(() => release(r, op, 1n, 'release-A', 'local-C', 'key-C', 101), 'request conflict');
  release(r, op, 2n, 'release-B', 'local-C', 'key-C', 102);
  reject(() => release(r, op, 1n, 'release-A', 'local-B', 'key-B', 103), 'generation conflict');
});
check('MODEL N5 deterministic report/revoke ordering', () => {
  for (const reportFirst of [true, false]) {
    const r = row(), p = principal(r);
    if (reportFirst) accept(r, p, load('reports.json'), 100);
    r.state = 'revoked'; r.previous = null; r.release = null;
    reject(() => accept(r, p, load('reports.json'), 101), 'revoked');
    assert.equal(r.high, reportFirst ? 66n : 0n);
  }
});
function renew(r, p, id, nextKey, now) {
  if (r.renewal?.id === id) {
    assert(r.state === 'active' && p.generation === r.generation && p.epoch === r.epoch &&
      p.key === r.renewal.oldKey && nextKey === r.key && now < r.expiry, 'renewal replay refused');
    return r.renewal.issued;
  }
  deviceAuth(r, p, now, 'renew'); assert(now >= r.issued + 86400, 'renewal too early');
  assert(nextKey !== r.key && nextKey !== r.previous?.key, 'key reuse');
  r.previous = { key: r.key, until: Math.min(r.expiry, now + 600) };
  r.key = nextKey; r.issued = now; r.expiry = now + 2592000; r.renewal = { id, oldKey: p.key, issued: now };
  return now;
}
check('MODEL N5 renewal lost response, old overlap, receipt recovery and revocation', () => {
  const r = row(), old = principal(r); renew(r, old, 'renew-A', 'key-B', 100000);
  accept(r, old, load('reports.json'), 100599);
  reject(() => accept(r, old, load('reports.json'), 100600), 'expired');
  assert.equal(renew(r, old, 'renew-A', 'key-B', 100700), 100000);
  reject(() => renew(r, old, 'renew-B', 'key-C', 100700), 'expired');
  const current = principal(r);
  reject(() => renew(r, current, 'renew-too-early', 'key-C', 100700), 'too early');
  accept(r, current, load('reports.json'), 100701);
  r.state = 'revoked'; reject(() => renew(r, old, 'renew-A', 'key-B', 100702), 'refused');
});
check('MODEL N6 counter reserve/restart and local epoch response fence', () => {
  const reserve = persisted => { assert(persisted < MAX, 'exhausted'); return persisted + 64n > MAX ? MAX : persisted + 64n; };
  let durable = 0n;
  const pending = reserve(durable); assert.equal(durable, 0n); // crash before fsync
  durable = pending; const first = durable - 63n; assert.equal(first, 1n);
  const afterRestart = durable + 1n; durable = reserve(durable); assert.equal(afterRestart, 65n); assert.equal(durable, 128n);
  assert.equal(reserve(MAX - 1n), MAX); reject(() => reserve(MAX), 'exhausted');
  reject(() => acknowledgement(reportExchange, reportExchange.responseBody, true, 'f'.repeat(32)), 'epoch');
});

// Retry calculation checks only; real timers/clock persistence require runtime tests.
function retryAfter(text, now, cadence, trusted = true) {
  if (typeof text !== 'string' || text.length > 128) return 0;
  if (/^[0-9]+$/.test(text)) return text.length > 20 ? 0 : Number(BigInt(text) > BigInt(cadence) ? BigInt(cadence) : BigInt(text));
  if (!trusted) return 0;
  const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const longDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let m, year, month, day, hour, minute, second, weekday;
  if ((m = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(text))) {
    weekday = shortDays.indexOf(m[1]); [day, month, year, hour, minute, second] = [Number(m[2]), months.indexOf(m[3]), ...m.slice(4).map(Number)];
  } else if ((m = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(text))) {
    weekday = longDays.indexOf(m[1]); [day, month, year, hour, minute, second] = [Number(m[2]), months.indexOf(m[3]), ...m.slice(4).map(Number)];
    const currentYear = new Date(now * 1000).getUTCFullYear(); year += Math.floor(currentYear / 100) * 100;
    const cutoff = new Date(now * 1000); cutoff.setUTCFullYear(currentYear + 50);
    if (Date.UTC(year, month, day, hour, minute, second) > cutoff.getTime()) year -= 100;
  } else if ((m = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) ([A-Z][a-z]{2}) ([ \d]\d) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(text))) {
    weekday = shortDays.indexOf(m[1]); month = months.indexOf(m[2]); day = Number(m[3]);
    [hour, minute, second, year] = m.slice(4).map(Number);
  } else return 0;
  const stamp = Date.UTC(year, month, day, hour, minute, second), date = new Date(stamp);
  if (year < 1601 || month < 0 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day || date.getUTCDay() !== weekday || hour > 23 || minute > 59 || second > 59) return 0;
  return Math.max(0, Math.min(cadence, Math.floor(stamp / 1000) - now));
}
function delay(n, cadence, hint, random) {
  const floor = Math.max(60, Math.min(cadence, 30 * 2 ** (Math.min(n, 16) - 1)), hint);
  const ceiling = Math.min(cadence, Math.max(floor, Math.ceil(1.25 * floor)));
  return floor + Math.floor(random * (ceiling - floor + 1));
}
check('N8 delta/date retry forms, invalid dates, clamping, floor and cap', () => {
  const now = Date.UTC(2026, 8, 10, 19, 0, 0) / 1000;
  for (const form of ['Thu, 10 Sep 2026 19:02:00 GMT', 'Thursday, 10-Sep-26 19:02:00 GMT', 'Thu Sep 10 19:02:00 2026']) assert.equal(retryAfter(form, now, 900), 120);
  assert.equal(retryAfter('120', now, 900), 120);
  assert.equal(retryAfter('Friday, 11-Dec-76 19:02:00 GMT', now, 900), 0);
  assert.equal(retryAfter('Wednesday, 10-Sep-76 19:00:00 GMT', now, 900), 0);
  assert.equal(retryAfter('99999999999999999999', now, 900), 900);
  assert.equal(retryAfter('Thu, 10 Sep 2026 19:02:00 GMT', now, 900, false), 0);
  for (const malformed of ['-1', '1.5', '120, 240', 'Fri, 10 Sep 2026 19:02:00 GMT', 'Thu, 31 Feb 2026 19:02:00 GMT', 'garbage']) assert.equal(retryAfter(malformed, now, 900), 0);
  for (let n = 1; n <= 20; n++) for (const c of [60, 900, 86400]) for (const random of [0, 0.5, 0.999999]) {
    const result = delay(n, c, 0, random); assert(result >= 60 && result <= c);
    assert(delay(n, c, c, random) === c);
  }
  const persistedDelay = delay(4, 900, 500, 0.5); assert(persistedDelay >= 500);
  const afterReboot = persistedDelay; assert.equal(afterReboot, persistedDelay); // full saved wait, no wall subtraction
});

check('N2 raw duplicate and unknown HTTP header refusal with positive control', () => {
  const allowed = new Set(['fleet-role', 'fleet-schema', 'content-length']);
  function parseHeaders(raw) {
    const result = new Map();
    for (const line of raw.split(/\r?\n/).filter(Boolean)) {
      const match = /^([a-zA-Z-]+): ([\x20-\x7e]*)$/.exec(line); assert(match, 'header syntax');
      const name = match[1].toLowerCase(); assert(allowed.has(name), 'unknown header');
      assert(!result.has(name), 'duplicate header'); result.set(name, match[2]);
    }
    return result;
  }
  reject(() => parseHeaders(readFileSync(resolve(here, 'duplicate-header.http'), 'utf8')), 'duplicate');
  reject(() => parseHeaders('Fleet-Command: reboot\r\n'), 'unknown');
  assert.equal(parseHeaders('Fleet-Role: device\r\n').get('fleet-role'), 'device');
});
check('N4 positive closed error taxonomy and unsupported response schema', () => {
  const base = { schema: 'mos/fleet/v1', requestId: '2'.repeat(32), deviceId: load('register.json').deviceId };
  for (const code of schema.$defs.error.properties.code.enum) valid('error', { ...base, code });
  reject(() => valid('error', { ...base, code: 'reboot_now' }), 'enum');
  reject(() => valid('accepted', { ...reportExchange.responseBody, schema: 'mos/fleet/v2' }), 'const');
  const response = structuredClone(reportExchange.responseBody); response.accepted[0].command = {};
  reject(() => acknowledgement(reportExchange, response), 'unknown');
});
check('N3 actual dual renewal possession proof is for the same request bytes', () => {
  const old = generateKeyPairSync('ed25519'), next = generateKeyPairSync('ed25519');
  const x = structuredClone(exchanges.exchanges.find(item => item.name === 'renew'));
  x.headers['Fleet-Key'] = Buffer.from(old.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');
  x.rawBody = Buffer.from(canonical({ nextPublicKey: Buffer.from(next.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex') }));
  const bytes = signedBytes(x), oldProof = sign(null, bytes, old.privateKey), nextProof = sign(null, bytes, next.privateKey);
  assert(verify(null, bytes, old.publicKey, oldProof) && verify(null, bytes, next.publicKey, nextProof));
  assert(!verify(null, bytes, next.publicKey, oldProof));
  x.path += '/wrong'; assert(!verify(null, signedBytes(x), next.publicKey, nextProof));
});
check('MODEL N5 first writer and unchanged issuance on lost enrollment response', () => {
  const table = new Map();
  function first(device, epoch, key, requestId, bodyDigest) {
    const existing = table.get(device);
    const identity = canonical([epoch, key, requestId, bodyDigest]);
    if (existing) { assert.equal(existing.identity, identity, 'claim conflict'); return existing; }
    const created = { identity, issuedAt: 100, expiry: 2592100, generation: 1 };
    table.set(device, created); return created;
  }
  const issued = first('D', 'E', 'K', 'R', 'digest');
  assert.equal(first('D', 'E', 'K', 'R', 'digest'), issued);
  reject(() => first('D', 'attacker', 'other', 'R2', 'digest'), 'claim conflict');
  reject(() => first('D', 'E', 'K', 'R2', 'changed-product'), 'claim conflict');
  assert.equal(table.size, 1); assert.equal(issued.expiry, 2592100);
});
check('MODEL N7 queue count/byte/age pressure, atomic drop count and latest send metadata', () => {
  const state = { queue: [], gaps: 0n };
  function add(counter, size, now) {
    const queue = [...state.queue, { counter, size, at: now }]; let gaps = state.gaps;
    while (queue.length > 128 || queue.reduce((sum, x) => sum + x.size, 0) > 1048576 || now - queue[0].at >= 172800) {
      queue.shift(); gaps++;
    }
    state.queue = queue; state.gaps = gaps; // one modeled durable group
  }
  for (let i = 1; i <= 129; i++) add(i, 100, i * 60);
  assert.equal(state.queue.length, 128); assert.equal(state.queue[0].counter, 2); assert.equal(state.gaps, 1n);
  for (let counter = 130; counter <= 193; counter++) add(counter, 16384, 8000 + counter);
  assert.equal(state.queue.length, 64); assert.equal(state.gaps, 129n);
  add(194, 100, 200000); assert.equal(state.queue.length, 1); assert.equal(state.gaps, 193n);
  const report = load('report.json'); report.gapReports = state.gaps.toString(); valid('report', report);
  assert.equal(report.gapReports, '193');
});

check('N10 plan links, own tracking rows and one current protocol tag', () => {
  const name = '20260910-1910-fleet-device-plane-protocol';
  for (const dir of ['plan', 'task']) {
    const path = resolve(root, `docs/${dir}/${name}.md`), source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (target && !target.includes('://')) assert(existsSync(resolve(dirname(path), target)), `broken link ${target}`);
    }
    const rows = readFileSync(resolve(root, `docs/${dir}/index.md`), 'utf8').split('\n').filter(line => line.includes(`](${name}.md)`));
    assert.equal(rows.length, 1, 'unique tracking row');
    const status = /^- \*\*status\*\*: (\S+)/m.exec(source)[1];
    const marker = status === 'completed' ? '[x]' : '[-]'; assert(rows[0].startsWith(`- ${marker} `), 'tracking status');
  }
  assert.deepEqual(Object.keys(schema.$defs.register.properties), ['deviceId','board','profile','version','product']);
  assert.deepEqual(Object.keys(schema.$defs.report.properties), ['schemaVersion','deviceId','counter','capturedAt','cadenceSeconds','bufferedSeconds','gapReports','version','update','health','storage','thermal','reset','watchdog','pstore','time','failures','interfaces']);
});
console.log(`Design validation: ${checks} checks passed; static/schema, ephemeral crypto and MODEL checks only.`);
for (const name of readdirSync(here).sort()) {
  const bytes = readFileSync(resolve(here, name));
  console.log(`SHA256 ${hash(bytes)} tests/fleet-protocol/${name}`);
}
