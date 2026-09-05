import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from './app'
import { parseConfig } from './config'

test('real HTTP transport preserves artifact byte ranges and HEAD lengths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mos-http-test-'))
  const token = 'http-test-administrator-token-with-32-characters'
  const service = await createService(parseConfig({ ADMIN_TOKEN: token, DATA_DIR: directory, LOG_LEVEL: 'silent' }))
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: service.app.fetch })
  const base = `http://127.0.0.1:${server.port}`
  const authorization = { Authorization: `Bearer ${token}` }
  try {
    const created = await fetch(`${base}/api/releases`, { method: 'POST', headers: { ...authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ board: 'cx3576', channel: 'stable', version: '1.0', epoch: 1 }) })
    const release = await created.json()
    const uploaded = await fetch(`${base}/api/releases/${release.id}/artifact`, { method: 'PUT', headers: { ...authorization, 'Content-Type': 'application/octet-stream' }, body: '0123456789' })
    expect(uploaded.status).toBe(200)
    expect((await fetch(`${base}/api/releases/${release.id}/publish`, { method: 'POST', headers: authorization })).status).toBe(200)
    for (const [range, expected] of [['bytes=2-5', '2345'], ['bytes=7-', '789'], ['bytes=-3', '789']] as const) {
      const response = await fetch(`${base}/v1/artifacts/${release.id}`, { headers: { Range: range } })
      expect(response.status).toBe(206)
      expect(await response.text()).toBe(expected)
      expect(response.headers.get('content-length')).toBe(String(expected.length))
    }
    const head = await fetch(`${base}/v1/artifacts/${release.id}`, { method: 'HEAD' })
    expect(head.headers.get('content-length')).toBe('10')
    expect(await head.text()).toBe('')
  }
  finally {
    await server.stop(true)
    service.close()
    await rm(directory, { recursive: true, force: true })
  }
})
