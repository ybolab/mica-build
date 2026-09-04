import type { Release } from './db/schema'
import { Buffer } from 'node:buffer'
import { createPublicKey, verify } from 'node:crypto'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { createService } from './app'
import { parseConfig } from './config'
import { catalogs, sessions } from './db/schema'

const adminToken = 'test-admin-token-with-at-least-32-characters'
const origin = 'http://updates.localhost'
let directory: string
let service: Awaited<ReturnType<typeof createService>>

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mos-updates-test-'))
  service = await createService(parseConfig({ ADMIN_TOKEN: adminToken, DATA_DIR: directory, PUBLIC_URL: origin, MAX_UPLOAD_BYTES: '1024', LOG_LEVEL: 'silent' }))
})
afterEach(async () => {
  service?.close()
  await rm(directory, { recursive: true, force: true })
})

function request(path: string, method = 'GET', body?: unknown, authenticated = true) {
  return service.app.request(`${origin}${path}`, {
    method,
    headers: { ...(authenticated ? { Authorization: `Bearer ${adminToken}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

test('administrative operations require authentication', async () => {
  expect((await request('/api/releases', 'GET', undefined, false)).status).toBe(401)
  expect((await request('/api/releases', 'POST', {}, false)).status).toBe(401)
})

test('a draft becomes discoverable only after upload and publication', async () => {
  const created = await request('/api/releases', 'POST', { board: 'cx3576', channel: 'stable', version: '0.1.0', epoch: 1, notes: 'First release' })
  expect(created.status).toBe(201)
  const release = await created.json()
  expect((await request(`/api/releases/${release.id}/publish`, 'POST')).status).toBe(409)
  const upload = await service.app.request(`${origin}/api/releases/${release.id}/artifact`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/octet-stream' },
    body: 'test-rauc-bundle',
  })
  expect(upload.status).toBe(200)
  expect((await request(`/v1/artifacts/${release.id}`, 'GET', undefined, false)).status).toBe(404)
  expect((await request(`/api/releases/${release.id}/publish`, 'POST')).status).toBe(200)
  const envelope = await (await request('/v1/manifest.json', 'GET', undefined, false)).json()
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64').toString())
  expect(payload.releases).toHaveLength(1)
  expect(payload.releases[0].epoch).toBe(1)
  const download = await request(`/v1/artifacts/${release.id}`, 'GET', undefined, false)
  expect(download.status).toBe(200)
  expect(await download.text()).toBe('test-rauc-bundle')
  expect((await request(`/api/releases/${release.id}/withdraw`, 'POST')).status).toBe(200)
  expect((await request(`/v1/artifacts/${release.id}`, 'GET', undefined, false)).status).toBe(404)
})

async function draft(epoch = 1, board = 'cx3576', channel = 'stable'): Promise<Release> {
  const response = await request('/api/releases', 'POST', { board, channel, version: `0.${epoch}.0`, epoch })
  expect(response.status).toBe(201)
  return response.json()
}
function upload(id: string, body: BodyInit | null = '0123456789', headers: Record<string, string> = {}) {
  return service.app.request(`${origin}/api/releases/${id}/artifact`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/octet-stream', ...headers },
    body,
  })
}
async function published(epoch = 1, board = 'cx3576', channel = 'stable') {
  const release = await draft(epoch, board, channel)
  expect((await upload(release.id)).status).toBe(200)
  expect((await request(`/api/releases/${release.id}/publish`, 'POST')).status).toBe(200)
  return release
}

test('catalog signatures bind the exact payload, release identity and download digest', async () => {
  await published()
  const envelope = await (await request('/v1/manifest.json')).json()
  const status = await (await request('/api/status')).json()
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(status.signing.publicKey, 'base64').toString('base64url') }, format: 'jwk' })
  const payload = Buffer.from(envelope.payload, 'base64')
  expect(verify(null, payload, key, Buffer.from(envelope.signature, 'base64'))).toBe(true)
  const document = JSON.parse(payload.toString())
  expect(document.schema).toBe('mos/updates/v1')
  expect(document.releases[0].artifact.sha256).toBe('84d89877f0d4041efb6bf91a16f0248f2fd573e6af05c19f96bedb9f882f7882')
  document.releases[0].board = 'x64'
  expect(verify(null, Buffer.from(JSON.stringify(document)), key, Buffer.from(envelope.signature, 'base64'))).toBe(false)
  expect(envelope.keyId).toBe(status.signing.keyId)
})

test('catalog reads never renew metadata, including after expiry and restart', async () => {
  const before = await (await request('/v1/manifest.json')).text()
  using _clock = spyOn(Date, 'now').mockReturnValue(Date.now() + 30 * 86400000)
  expect((await (await request('/api/status')).json()).expired).toBe(true)
  expect(await (await request('/v1/manifest.json')).text()).toBe(before)
  service.close()
  service = await createService(parseConfig({ ADMIN_TOKEN: adminToken, DATA_DIR: directory, PUBLIC_URL: origin, LOG_LEVEL: 'silent' }))
  expect(await (await request('/v1/manifest.json')).text()).toBe(before)
  expect((await request('/api/metadata/refresh', 'POST')).status).toBe(200)
  expect(await (await request('/v1/manifest.json')).text()).not.toBe(before)
  expect((await (await request('/api/status')).json()).expired).toBe(false)
})

test('higher epochs become channel heads without crossing board or channel boundaries', async () => {
  const first = await published(1)
  const second = await published(2)
  const beta = await published(1, 'cx3576', 'beta')
  const x64 = await published(1, 'x64')
  const decode = async () => JSON.parse(Buffer.from((await (await request('/v1/manifest.json')).json()).payload, 'base64').toString())
  expect((await decode()).channels).toEqual(expect.arrayContaining([
    { board: 'cx3576', channel: 'stable', releaseId: second.id, epoch: 2 },
    { board: 'cx3576', channel: 'beta', releaseId: beta.id, epoch: 1 },
    { board: 'x64', channel: 'stable', releaseId: x64.id, epoch: 1 },
  ]))
  await request(`/api/releases/${second.id}/withdraw`, 'POST')
  expect((await decode()).channels).toContainEqual({ board: 'cx3576', channel: 'stable', releaseId: first.id, epoch: 1 })
  expect((await request(`/api/releases/${second.id}/publish`, 'POST')).status).toBe(409)
})

test('withdrawal does not reset the highest published epoch', async () => {
  const higher = await published(10)
  await request(`/api/releases/${higher.id}/withdraw`, 'POST')
  const lower = await draft(9)
  await upload(lower.id)
  const response = await request(`/api/releases/${lower.id}/publish`, 'POST')
  expect(response.status).toBe(409)
  expect((await response.json()).error.code).toBe('epoch_not_increasing')
})

test('duplicate epochs, unknown fields and invalid release identities are rejected', async () => {
  await draft()
  expect((await request('/api/releases', 'POST', { board: 'cx3576', channel: 'stable', version: '1.0', epoch: 1 })).status).toBe(409)
  for (const extra of [{ epoch: 0 }, { epoch: 1.5 }, { epoch: Number.MAX_SAFE_INTEGER + 1 }, { board: '../x64' }, { channel: 'unknown' }, { version: '<script>' }, { admin: true }, { notes: 'x'.repeat(10001) }]) {
    const response = await request('/api/releases', 'POST', { board: 'cx3576', channel: 'stable', version: '1.0', epoch: 2, ...extra })
    expect(response.status).toBe(400)
  }
})

test('failed signing rolls back publication, audit entry and catalog together', async () => {
  const release = await draft()
  await upload(release.id)
  const before = await (await request('/v1/manifest.json')).text()
  const beforeAudit = await (await request('/api/audit')).text()
  using _failingSigner = spyOn(service.service.signer, 'sign').mockImplementation(() => {
    throw new Error('test signing failure')
  })
  expect((await request(`/api/releases/${release.id}/publish`, 'POST')).status).toBe(500)
  expect(service.service.get(release.id).status).toBe('draft')
  expect(await (await request('/v1/manifest.json')).text()).toBe(before)
  expect(await (await request('/api/audit')).text()).toBe(beforeAudit)
})

test('unknown releases and invalid state transitions fail explicitly', async () => {
  expect((await request('/api/releases/missing/publish', 'POST')).status).toBe(404)
  expect((await upload('missing')).status).toBe(404)
  expect((await request('/missing')).status).toBe(404)
  const release = await draft()
  expect((await request(`/api/releases/${release.id}/withdraw`, 'POST')).status).toBe(409)
  await upload(release.id)
  expect((await upload(release.id)).status).toBe(409)
})

test('uploads bound streamed bytes without trusting Content-Length and remove failed files', async () => {
  const release = await draft()
  expect((await upload(release.id, 'x'.repeat(1025))).status).toBe(413)
  expect((await upload(release.id, 'x', { 'Content-Length': '2048' })).status).toBe(413)
  expect((await upload(release.id, 'x', { 'Content-Length': 'invalid' })).status).toBe(413)
  expect((await upload(release.id, '')).status).toBe(400)
  expect((await upload(release.id, null)).status).toBe(400)
  expect((await upload(release.id, 'x', { 'Content-Length': '2' })).status).toBe(400)
  expect((await upload(release.id, 'x', { 'Content-Type': 'text/plain' })).status).toBe(415)
  expect(await readdir(join(directory, 'artifacts'))).toHaveLength(0)
  expect(service.service.get(release.id).sha256).toBeNull()
  expect((await upload(release.id, 'x'.repeat(1024))).status).toBe(200)
})

test('two concurrent uploads commit exactly one immutable artifact', async () => {
  const release = await draft()
  let releaseStream: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    releaseStream = resolve
  })
  const stream = () => new ReadableStream<Uint8Array>({ async start(controller) {
    await gate
    controller.enqueue(new TextEncoder().encode('bundle'))
    controller.close()
  } })
  const first = upload(release.id, stream())
  const second = upload(release.id, stream())
  releaseStream?.()
  const responses = await Promise.all([first, second])
  expect(responses.map(item => item.status).sort()).toEqual([200, 409])
  expect(await readdir(join(directory, 'artifacts'))).toHaveLength(1)
  expect(service.service.get(release.id).size).toBe(6)
})

test.each([
  ['bytes=2-5', 206, '2345'],
  ['bytes=7-', 206, '789'],
  ['bytes=-3', 206, '789'],
  ['bytes=0-100', 206, '0123456789'],
  ['bytes=10-', 416, ''],
  ['bytes=5-2', 416, ''],
  ['bytes=-0', 416, ''],
  ['bytes=-', 416, ''],
  ['bytes=0-1,3-4', 416, ''],
  ['invalid', 416, ''],
  ['bytes=9007199254740992-', 416, ''],
  ['bytes=-999999999999999999999', 416, ''],
])('download range %s returns %s', async (range, code, expected) => {
  const release = await published()
  const response = await service.app.request(`${origin}/v1/artifacts/${release.id}`, { headers: { Range: range } })
  expect(response.status).toBe(code)
  expect(await response.text()).toBe(expected)
  expect(response.headers.get('accept-ranges')).toBe('bytes')
  if (code === 416)
    expect(response.headers.get('content-range')).toBe('bytes */10')
})

test('HEAD, conditional requests and If-Range preserve HTTP semantics', async () => {
  const release = await published()
  const path = `${origin}/v1/artifacts/${release.id}`
  const full = await service.app.request(path)
  const etag = full.headers.get('etag') ?? ''
  expect(etag).not.toBe('')
  expect((await service.app.request(path, { headers: { 'If-None-Match': etag } })).status).toBe(304)
  const head = await service.app.request(path, { method: 'HEAD', headers: { Range: 'bytes=0-1' } })
  expect(head.status).toBe(200)
  expect(head.headers.get('content-length')).toBe('10')
  expect(await head.text()).toBe('')
  const changed = await service.app.request(path, { headers: { 'Range': 'bytes=0-1', 'If-Range': '"old"' } })
  expect(changed.status).toBe(200)
  expect(await changed.text()).toBe('0123456789')
})

test('missing or truncated storage does not return a successful download', async () => {
  const release = await published()
  const name = service.service.get(release.id).artifact!
  await writeFile(join(directory, 'artifacts', name), 'short')
  expect((await request(`/v1/artifacts/${release.id}`)).status).toBe(503)
  await rm(join(directory, 'artifacts', name))
  expect((await request(`/v1/artifacts/${release.id}`)).status).toBe(503)
})

async function login(token = adminToken, requestOrigin = origin) {
  return service.app.request(`${origin}/api/session`, { method: 'POST', headers: { 'Origin': requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
}

test('cookie sessions are HttpOnly and same-origin mutations are required', async () => {
  expect((await login(adminToken, 'http://foreign.localhost')).status).toBe(403)
  expect((await login('wrong')).status).toBe(401)
  const response = await login()
  expect(response.status).toBe(200)
  const header = response.headers.get('set-cookie') ?? ''
  expect(header).toContain('HttpOnly')
  expect(header).toContain('SameSite=Strict')
  const cookie = header.split(';')[0] ?? ''
  const authenticated = await service.app.request(`${origin}/api/releases`, { headers: { Cookie: cookie } })
  expect(authenticated.status).toBe(200)
  const rejected = await service.app.request(`${origin}/api/metadata/refresh`, { method: 'POST', headers: { Cookie: cookie, Origin: 'http://foreign.localhost' } })
  expect(rejected.status).toBe(403)
  const accepted = await service.app.request(`${origin}/api/metadata/refresh`, { method: 'POST', headers: { Cookie: cookie, Origin: origin } })
  expect(accepted.status).toBe(200)
  expect((await service.app.request(`${origin}/api/session`, { method: 'DELETE', headers: { Cookie: cookie, Origin: origin } })).status).toBe(200)
  expect((await service.app.request(`${origin}/api/releases`, { headers: { Cookie: cookie } })).status).toBe(401)
})

test('session expiry and administrator-token changes invalidate previous cookies', async () => {
  const cookie = (await login()).headers.get('set-cookie')?.split(';')[0] ?? ''
  expect((await service.app.request(`${origin}/api/releases`, { headers: { Cookie: cookie } })).status).toBe(200)
  service.store.db.update(sessions).set({ expiresAt: Date.now() - 1 }).run()
  expect((await service.app.request(`${origin}/api/releases`, { headers: { Cookie: cookie } })).status).toBe(401)
  const freshCookie = (await login()).headers.get('set-cookie')?.split(';')[0] ?? ''
  service.close()
  service = await createService(parseConfig({ ADMIN_TOKEN: `${adminToken}-rotated`, DATA_DIR: directory, PUBLIC_URL: origin, LOG_LEVEL: 'silent' }))
  expect((await service.app.request(`${origin}/api/releases`, { headers: { Cookie: freshCookie } })).status).toBe(401)
})

test('failed logins are rate limited and the window resets', async () => {
  for (let attempt = 0; attempt < 20; attempt++)
    expect((await login('wrong')).status).toBe(401)
  const limited = await login('wrong')
  expect(limited.status).toBe(429)
  expect(limited.headers.get('retry-after')).toBe('60')
  using _clock = spyOn(Date, 'now').mockReturnValue(Date.now() + 61000)
  expect((await login()).status).toBe(200)
})

test('malformed and oversized JSON requests fail safely', async () => {
  const invalid = await service.app.request(`${origin}/api/releases`, { method: 'POST', headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: '{' })
  expect(invalid.status).toBe(400)
  const large = await request('/api/releases', 'POST', { notes: 'x'.repeat(40000) })
  expect(large.status).toBe(413)
  expect((await request('/healthz', 'GET', undefined, false)).status).toBe(200)
  expect((await request('/v1/manifest.json')).headers.get('cache-control')).toBe('no-store')
})

test('database failures do not expose SQL or paths to the client', async () => {
  service.store.db.delete(catalogs).run()
  const response = await request('/healthz')
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: { code: 'internal_error', message: 'Internal server error' } })
})

test('embedded console assets receive restrictive security headers', async () => {
  const app = await createService(parseConfig({ ADMIN_TOKEN: adminToken, DATA_DIR: directory, PUBLIC_URL: origin, LOG_LEVEL: 'silent' }), { html: '<html>console</html>', css: 'body{}', js: 'document.title="console"' })
  try {
    const response = await app.app.request(`${origin}/`)
    expect(await response.text()).toBe('<html>console</html>')
    expect(response.headers.get('content-security-policy')).toContain('script-src \'self\'')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await app.app.request(`${origin}/style.css`)).headers.get('content-type')).toBe('text/css')
    expect((await app.app.request(`${origin}/app.js`)).headers.get('content-type')).toBe('text/javascript')
  }
  finally {
    app.close()
  }
})
