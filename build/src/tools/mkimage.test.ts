// mkimage, against the real u-boot-tools and against cx3576's REAL boot.cmd.
//
// What this proves is reproducibility, because that is the only thing mkimage
// can get silently wrong here: without SOURCE_DATE_EPOCH it stamps the legacy
// image header with the wall clock, exits 0, and the boot script differs on
// every build. So the test is two compilations of the same source, and the
// control is two compilations with different epochs.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry } from '../geometry.ts'
import { makeWorkDir, REPO_ROOT } from '../paths.ts'
import { OPEN_TIMEOUT_MS, TOOL_TIMEOUT_MS } from '../testing.ts'
import { Toolbox, ToolError } from '../toolbox.ts'
import { CX3576_ASSEMBLY } from '../toolsets.ts'
import { bootScriptArgs, makeBootScript, readImageHeader } from './mkimage.ts'

/** cx3576's own boot source -- the file the cx3576 assembly contract compiles. */
const BOOT_CMD = join(REPO_ROOT, 'boards', 'cx3576', 'boot.cmd')

let tb: Toolbox
let work = ''

beforeAll(async () => {
  work = makeWorkDir('mkimage')
  tb = await Toolbox.open(CX3576_ASSEMBLY, { mounts: [REPO_ROOT], cwd: work })
}, OPEN_TIMEOUT_MS)
afterAll(async () => {
  await tb?.close()
  if (work !== '') rmSync(work, { recursive: true, force: true })
}, OPEN_TIMEOUT_MS)

describe('the argv shape', () => {
  test('the cx3576 assembly contract\'s shape, and no -A', () => {
    // A boot script is architecture-independent; an -A here would put a claim
    // in the header that U-Boot then checks.
    expect(bootScriptArgs({ input: 'boot.cmd', output: 'boot.scr', name: 'mos boot', sourceDateEpoch: '1577836800' }))
      .toEqual(['mkimage', '-T', 'script', '-C', 'none', '-n', 'mos boot', '-d', 'boot.cmd', 'boot.scr'])
  })

  test('the epoch is not on the command line at all -- mkimage reads it from the ENVIRONMENT', () => {
    const argv = bootScriptArgs({ input: 'a', output: 'b', name: 'n', sourceDateEpoch: '1577836800' })
    expect(argv.join(' ')).not.toContain('1577836800')
  })
})

describe('against the real mkimage, on cx3576\'s own boot.cmd', () => {
  test('the same source and the same epoch compile to the same bytes, twice', async () => {
    const g = loadGeometry('cx3576')
    // The epoch comes out of the board definition: FILE_MTIME="@1577836800".
    expect(g.ext4.sourceDateEpoch).toBe('1577836800')

    const a = join(work, 'a.scr')
    const b = join(work, 'b.scr')
    for (const out of [a, b]) {
      await makeBootScript(tb, { input: BOOT_CMD, output: out, name: 'mos boot', sourceDateEpoch: g.ext4.sourceDateEpoch })
    }
    const ba = await Bun.file(a).bytes()
    const bb = await Bun.file(b).bytes()
    expect(ba.length).toBeGreaterThan(64)
    expect(ba).toEqual(bb)
  }, TOOL_TIMEOUT_MS)

  test('...and a DIFFERENT epoch produces different bytes, so the comparison above means something', async () => {
    // Without this, "identical twice" would also hold for a mkimage that
    // ignored the variable entirely -- and the failure being guarded against is
    // exactly a header stamped with something the build did not choose.
    const c = join(work, 'c.scr')
    await makeBootScript(tb, { input: BOOT_CMD, output: c, name: 'mos boot', sourceDateEpoch: '1600000000' })
    expect(await Bun.file(c).bytes()).not.toEqual(await Bun.file(join(work, 'a.scr')).bytes())
  }, TOOL_TIMEOUT_MS)

  test('the header carries the pinned timestamp, readable back', async () => {
    const header = await readImageHeader(tb, join(work, 'a.scr'))
    expect(header).toContain('Image Type')
    expect(header).toContain('Script')
    // 1577836800 is 2020-01-01 00:00:00 UTC, and mkimage -l prints it as a date.
    expect(header).toContain('2020')
  }, TOOL_TIMEOUT_MS)

  test('the name reaches the header too', async () => {
    const named = join(work, 'named.scr')
    await makeBootScript(tb, { input: BOOT_CMD, output: named, name: 'a distinctive name', sourceDateEpoch: '1577836800' })
    expect(await readImageHeader(tb, named)).toContain('a distinctive name')
  }, TOOL_TIMEOUT_MS)
})

describe('every failure is reported', () => {
  test('a SOURCE_DATE_EPOCH that is not an epoch is refused BEFORE mkimage runs', async () => {
    // Refused rather than passed through, because mkimage falls back to the
    // wall clock when it cannot read the variable -- and says nothing.
    for (const bad of ['', '@1577836800', 'yesterday', '1577836800 ']) {
      await expect(makeBootScript(tb, { input: BOOT_CMD, output: join(work, 'x.scr'), name: 'n', sourceDateEpoch: bad }))
        .rejects.toThrow(/which is not an epoch/)
    }
    // The '@' spelling is the one a caller would actually reach for: the board
    // definitions write FILE_MTIME="@1577836800", and geometry.ext4
    // .sourceDateEpoch is that value with the '@' already removed.
    await expect(makeBootScript(tb, { input: BOOT_CMD, output: join(work, 'x.scr'), name: 'n', sourceDateEpoch: '@1577836800' }))
      .rejects.toThrow(/without the '@'/)
  })

  test('a source that is not there is a ToolError carrying mkimage\'s words', async () => {
    let err: ToolError | undefined
    try {
      await makeBootScript(tb, { input: join(work, 'absent.cmd'), output: join(work, 'y.scr'), name: 'n', sourceDateEpoch: '1577836800' })
    } catch (e) { err = e as ToolError }
    expect(err).toBeInstanceOf(ToolError)
    expect(err!.message).toContain('absent.cmd')
    expect(err!.exitCode).not.toBe(0)
  }, TOOL_TIMEOUT_MS)

  test('reading the header of something that is not an image fails rather than returning nothing', async () => {
    const notAnImage = join(work, 'not-an-image.bin')
    writeFileSync(notAnImage, 'this is not a u-boot image\n')
    await expect(readImageHeader(tb, notAnImage)).rejects.toThrow(/could not read the header/)
  }, TOOL_TIMEOUT_MS)
})
