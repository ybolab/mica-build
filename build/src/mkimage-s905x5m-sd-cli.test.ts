import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { parseArgs } from './mkimage-s905x5m-sd-cli.ts'
import { loadGeometry } from './geometry.ts'
import { REPO_ROOT } from './paths.ts'

describe('the s905x5m SD assembler arguments', () => {
  test('default inputs name the composed s905x5m output', () => {
    expect(parseArgs([], {})).toEqual({
      outDir: join(REPO_ROOT, '_out', 's905x5m'),
    })
    expect(loadGeometry('s905x5m').naming).toEqual({
      prefix: 's905x5m-mos-sd-',
      suffix: '.img',
      latestName: 's905x5m-mos-sd-latest.img',
    })
  })

  test('BSP overrides cannot substitute unselected boot inputs', () => {
    expect(parseArgs([], { BOARD_DIR: '/environment', BSP_OUT: '/stale' }))
      .toEqual({ outDir: join(REPO_ROOT, '_out', 's905x5m') })
    expect(() => parseArgs(['--board-dir', '/argument'], {})).toThrow(/unknown argument/)
  })

  test('the composed output directory can be supplied', () => {
    expect(parseArgs(['--out-dir', '/out'], {})).toEqual({ outDir: '/out' })
  })

  test('unknown and valueless arguments are refused', () => {
    expect(() => parseArgs(['--image', '/tmp/x'], {})).toThrow(/unknown argument "--image"/)
    expect(() => parseArgs(['--out-dir'], {})).toThrow(/--out-dir needs a directory/)
    expect(() => parseArgs(['--out-dir', '--other'], {})).toThrow(/--out-dir needs a directory/)
  })
})
