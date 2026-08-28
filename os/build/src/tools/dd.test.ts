// dd and truncate, on BOTH routes, driven from the failing side.
//
// dd is the tool that makes the case for the toolbox interpreting nothing: on
// SUCCESS it writes its summary to STDERR. A layer that read a non-empty stderr
// as failure would fail every correct dd; a layer that read an empty one as
// success would pass every failed debugfs. Both are asserted here.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeWorkDir, REPO_ROOT } from '../paths.ts'
import { Toolbox, ToolError } from '../toolbox.ts'
import { OPEN_TIMEOUT_MS, TOOL_TIMEOUT_MS } from '../testing.ts'
import { COREUTILS } from '../toolsets.ts'
import { dd, ddArgs, truncate } from './dd.ts'

let host: Toolbox
let container: Toolbox
let work = ''

beforeAll(async () => {
  work = makeWorkDir('dd')
  host = await Toolbox.open(COREUTILS, { route: 'host', mounts: [REPO_ROOT], cwd: work })
  container = await Toolbox.open(COREUTILS, { route: 'container', mounts: [REPO_ROOT], cwd: work })
}, OPEN_TIMEOUT_MS)
afterAll(async () => {
  await host?.close()
  await container?.close()
  if (work !== '') rmSync(work, { recursive: true, force: true })
}, OPEN_TIMEOUT_MS)

describe('the argv shape, without a disk', () => {
  test('the placement both assemblers do, in MiB', () => {
    expect(ddArgs({ input: 'boot-a.img', output: 'disk.img', blockSize: '1M', seekBlocks: 18n, conv: ['notrunc', 'sparse'], quiet: true }))
      .toEqual(['dd', 'if=boot-a.img', 'of=disk.img', 'bs=1M', 'seek=18', 'conv=notrunc,sparse', 'status=none'])
  })

  test('cx3576 writes its loader in SECTORS, and conv is not normalised across callers', () => {
    // os/mkimage-v2.sh (deleted: PLAN-014): bs=512 seek=64 conv=notrunc,sparse.
    // os/mkimage-x64.sh: bs=1M conv=notrunc -- no sparse. They agree on the
    // bytes for an already-zero target and this layer does not choose for them.
    expect(ddArgs({ input: 'u-boot.bin', output: 'disk.img', blockSize: '512', seekBlocks: 64n, conv: ['notrunc', 'sparse'], quiet: true }))
      .toContain('seek=64')
    expect(ddArgs({ input: 'esp.img', output: 'disk.img', blockSize: '1M', seekBlocks: 1n, conv: ['notrunc'], quiet: true }))
      .toContain('conv=notrunc')
  })

  test('status=none is not the default -- a silenced dd is harder to read, not safer', () => {
    expect(ddArgs({ input: 'a', output: 'b', blockSize: '1M' })).not.toContain('status=none')
  })

  test('count=0 is refused: dd would copy nothing and exit 0', () => {
    expect(() => ddArgs({ input: 'a', output: 'b', blockSize: '1M', countBlocks: 0n }))
      .toThrow(/copy nothing and exit 0/)
  })

  test('an empty bs is refused: dd reads it as zero', () => {
    expect(() => ddArgs({ input: 'a', output: 'b', blockSize: '' })).toThrow(/empty bs=/)
  })

  test('a negative seek or skip is refused', () => {
    expect(() => ddArgs({ input: 'a', output: 'b', blockSize: '1M', seekBlocks: -1n })).toThrow(/seek to block -1/)
    expect(() => ddArgs({ input: 'a', output: 'b', blockSize: '1M', skipBlocks: -1n })).toThrow(/skip to block -1/)
  })
})

describe('against the real dd, and identically on both routes', () => {
  test('a payload placed at an offset lands at that offset, byte for byte, on host and in container', async () => {
    const payload = join(work, 'payload.bin')
    writeFileSync(payload, Buffer.alloc(1048576, 0x41))

    const results: string[] = []
    for (const [name, tb] of [['host', host], ['container', container]] as const) {
      const img = join(work, `${name}.img`)
      await truncate(tb, img, '8M')
      await dd(tb, { input: payload, output: img, blockSize: '1M', seekBlocks: 3n, conv: ['notrunc', 'sparse'], quiet: true })
      const bytes = await Bun.file(img).bytes()
      expect(`${name} size`).toBe(`${name} size`)
      expect(bytes.length).toBe(8 * 1048576)
      // At the offset, and nowhere before it.
      expect(bytes[3 * 1048576]).toBe(0x41)
      expect(bytes[3 * 1048576 - 1]).toBe(0x00)
      expect(bytes[4 * 1048576 - 1]).toBe(0x41)
      expect(bytes[4 * 1048576]).toBe(0x00)
      results.push(new Bun.CryptoHasher('sha256').update(bytes).digest('hex'))
    }
    // The two routes wrote the same disk. That is the property every later
    // milestone's byte-identity gate stands on.
    expect(results[0]).toBe(results[1]!)
    expect(results[0]).toMatch(/^[0-9a-f]{64}$/)
  }, TOOL_TIMEOUT_MS)

  test('dd writes its SUMMARY to stderr on SUCCESS -- which is why this layer interprets nothing', async () => {
    const payload = join(work, 'payload.bin')
    const img = join(work, 'noisy.img')
    await truncate(host, img, '2M')
    const r = await dd(host, { input: payload, output: img, blockSize: '1M', seekBlocks: 1n, conv: ['notrunc'] })
    expect(r.ok).toBe(true)
    expect(r.exitCode).toBe(0)
    // Non-empty stderr, exit 0, and the run was correct.
    expect(r.stderr).toContain('records in')
    expect(r.stderr).toContain('records out')
  })

  test('...and status=none silences exactly that, without changing the verdict', async () => {
    const payload = join(work, 'payload.bin')
    const img = join(work, 'quiet.img')
    await truncate(host, img, '2M')
    const r = await dd(host, { input: payload, output: img, blockSize: '1M', seekBlocks: 1n, conv: ['notrunc'], quiet: true })
    expect(r.ok).toBe(true)
    expect(r.stderr.trim()).toBe('')
  })
})

describe('every failure is reported', () => {
  test('an input that is not there is a ToolError carrying dd\'s own words', async () => {
    let err: ToolError | undefined
    try {
      await dd(host, { input: join(work, 'absent.bin'), output: join(work, 'out.img'), blockSize: '1M', quiet: true })
    } catch (e) { err = e as ToolError }
    expect(err).toBeInstanceOf(ToolError)
    expect(err!.exitCode).not.toBe(0)
    expect(err!.message).toContain('absent.bin')
    expect(err!.message).toMatch(/No such file/)
  })

  test('the same failure on the container route, and it reads the same', async () => {
    let err: ToolError | undefined
    try {
      await dd(container, { input: join(work, 'absent.bin'), output: join(work, 'out.img'), blockSize: '1M', quiet: true })
    } catch (e) { err = e as ToolError }
    expect(err).toBeInstanceOf(ToolError)
    expect(err!.route).toBe('container')
    expect(err!.message).toMatch(/No such file/)
  })

  test('truncate refuses a zero-length image rather than making one', async () => {
    await expect(truncate(host, join(work, 'zero.img'), '0')).rejects.toThrow(/which is not an image/)
    await expect(truncate(host, join(work, 'zero.img'), '')).rejects.toThrow(/which is not an image/)
  })

  test('truncate into a directory that is not there is a ToolError, not a silent skip', async () => {
    await expect(truncate(host, join(work, 'no', 'such', 'dir', 'x.img'), '1M'))
      .rejects.toThrow(/could not size/)
  })
})
