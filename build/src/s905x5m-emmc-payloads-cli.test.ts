import { describe, expect, test } from 'bun:test'
import { parseArgs } from './s905x5m-emmc-payloads-cli.ts'

describe('the s905x5m complete eMMC payload extractor arguments', () => {
  test('requires an explicit SD image and new output directory', () => {
    expect(parseArgs(['--image', '/images/s905x5m-sd.img', '--out-dir', '/output/payloads']))
      .toEqual({ image: '/images/s905x5m-sd.img', outDir: '/output/payloads' })
    expect(() => parseArgs([])).toThrow(/--image is required/)
    expect(() => parseArgs(['--image', '/x'])).toThrow(/--out-dir is required/)
  })

  test('refuses valueless and unknown arguments', () => {
    expect(() => parseArgs(['--image'])).toThrow(/--image needs a path/)
    expect(() => parseArgs(['--out-dir', '--image', '/x'])).toThrow(/--out-dir needs a path/)
    expect(() => parseArgs(['--source', '/x', '--out-dir', '/y'])).toThrow(/unknown argument "--source"/)
  })
})
