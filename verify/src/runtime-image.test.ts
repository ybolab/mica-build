import { describe, expect, test } from 'bun:test'
import { kernelReleaseFromImage, sha256 } from './runtime-image.ts'

describe('runtime named-image identity', () => {
  test('finds a kernel release in raw Image bytes and rejects malformed text', () => {
    const bytes = new TextEncoder().encode(`prefix Linux version 6.12.38-m100-arm64 (builder) suffix`)
    expect(kernelReleaseFromImage(bytes)).toBe('6.12.38-m100-arm64')
    expect(kernelReleaseFromImage(new TextEncoder().encode('Linux version bad/value'))).toBeUndefined()
  })

  test('hashes bytes rather than decoded text', async () => {
    expect(await sha256(new Uint8Array([0, 0xff, 1]))).toBe('47ffa3ea45a70b8a41c2c0825df323c00a8b7a01c1ea06083cc41dddcc001123')
  })
})
