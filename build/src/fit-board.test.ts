import { expect, test } from 'bun:test'
import { validateFitKernel } from './fit-board.ts'

function kernel() {
  const bytes = Buffer.alloc(64)
  bytes.write('ARMd', 56, 'ascii')
  bytes.writeBigUInt64LE(33816576n, 16)
  return bytes
}

test('S905X5M FIT uses the actual ARM64 extent and clears the reserved memory', () => {
  expect(() => validateFitKernel('s905x5m', kernel(), 33065472, 65536)).not.toThrow()
  const relocated = kernel()
  relocated.writeBigUInt64LE(0x80000n, 8)
  expect(() => validateFitKernel('s905x5m', relocated, 33065472, 65536)).toThrow('alignment')
  const oversized = kernel()
  oversized.writeBigUInt64LE(256n * 1048576n, 16)
  expect(() => validateFitKernel('s905x5m', oversized, 33065472, 65536)).toThrow('extent')
  expect(() => validateFitKernel('s905x5m', kernel(), 33065472, 3 * 1048576)).toThrow('DTB')
  expect(() => validateFitKernel('s905x5m', Buffer.alloc(64), 33065472, 65536)).toThrow('ARM64')
})
