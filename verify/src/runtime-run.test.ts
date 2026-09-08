import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { PACKAGE_DIR } from './paths.ts'

describe('runtime run.sh route', () => {
  test('refuses the Bun container route before it can test a board from somewhere else', async () => {
    const proc = Bun.spawn([
      'bash', join(PACKAGE_DIR, 'run.sh'), '--runtime', '192.0.2.1',
      '--board', 's905x5m', '--expect-hostname', 'fixture-board', '--image', '/missing.img',
    ], {
      env: { ...process.env, MOS_VERIFY_BUN: '', MOS_VERIFY_CONTAINER: '1' },
      stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
    })
    const [stdout, stderr, status] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ])
    expect(status).toBe(1)
    expect(`${stdout}\n${stderr}`).toContain('refuses the Bun-container fallback')
  })
})
