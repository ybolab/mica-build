import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseFileLayout, checkCapacity } from './file-layout.ts'
import { REPO_ROOT } from './paths.ts'

test('x64 has exactly ESP, SYSTEM and last-growing DATA with independent capacity checks', () => {
  const layout = parseFileLayout(readFileSync(join(REPO_ROOT, 'boards/x64/board.env'), 'utf8'))
  expect(layout.partitions.map(p => p.name)).toEqual(['ESP', 'SYSTEM', 'DATA'])
  expect(layout.partitions.map(p => p.startSector)).toEqual([2048, 513 * 2048, 2561 * 2048])
  expect(() => checkCapacity(layout, 100 * 1048576, 20 * 1048576)).not.toThrow()
  expect(() => checkCapacity(layout, 800 * 1048576, 20 * 1048576)).toThrow('SYSTEM')
  expect(() => checkCapacity(layout, 100 * 1048576, 200 * 1048576)).toThrow('ESP')
})

test('refuse changed partition order, overlap, zero length and duplicate GUIDs', () => {
  const source = readFileSync(join(REPO_ROOT, 'boards/x64/board.env'), 'utf8')
  for (const [before, after] of [
    ['ESP SYSTEM DATA', 'ESP DATA SYSTEM'],
    ['SYSTEM_START_MIB=513', 'SYSTEM_START_MIB=512'],
    ['DATA_SIZE_MIB=256', 'DATA_SIZE_MIB=0'],
    ['SYSTEM_GUID=5AC35760-0064-4000-8000-000000000002', 'SYSTEM_GUID=5AC35760-0064-4000-8000-000000000001'],
  ]) {
    expect(source).toContain(before!)
    expect(() => parseFileLayout(source.replace(before!, after!))).toThrow()
  }
})

test('cx3576 reserves one raw firmware partition across loader and both environments', () => {
  const layout = parseFileLayout(readFileSync(join(REPO_ROOT, 'boards/cx3576/board.env'), 'utf8'))
  expect(layout.partitions.map(p => p.name)).toEqual(['FIRMWARE', 'SYSTEM', 'DATA'])
  expect(layout.partitions.map(p => p.startSector)).toEqual([64, 18 * 2048, 1042 * 2048])
  expect(layout.partitions[0]!.sizeSectors).toBe(18 * 2048 - 64)
  expect(layout.partitions[1]!.sizeSectors * 512).toBe(1024 * 1048576)
  expect(layout.sizeSectors * 512).toBe(1299 * 1048576)
  expect(layout.firmware).toEqual({ loaderStartSector: 64, loaderSizeSectors: 32704, envOffsets: [16777216, 17825792], envSize: 65536 })
  expect(() => checkCapacity(layout, 100 * 1048576, 60 * 1048576)).not.toThrow()
  expect(() => checkCapacity(layout, 220 * 1048576, 78 * 1048576)).not.toThrow()
  expect(() => checkCapacity(layout, 221 * 1048576, 78 * 1048576)).toThrow('SYSTEM')
})

test('cx3576 refuses relocated, overlapping or unprotected firmware ranges', () => {
  const source = readFileSync(join(REPO_ROOT, 'boards/cx3576/board.env'), 'utf8')
  for (const [before, after] of [
    ['FIRMWARE_START_SECTOR=64', 'FIRMWARE_START_SECTOR=2048'],
    ['FIRMWARE_SIZE_SECTORS=36800', 'FIRMWARE_SIZE_SECTORS=36799'],
    ['UBOOT_MAX_BYTES=16744448', 'UBOOT_MAX_BYTES=17825792'],
    ['UENV_A_OFFSET_BYTES=16777216', 'UENV_A_OFFSET_BYTES=16777728'],
    ['UENV_B_OFFSET_BYTES=17825792', 'UENV_B_OFFSET_BYTES=16777216'],
    ['UENV_SIZE_BYTES=65536', 'UENV_SIZE_BYTES=131072'],
    ['GPT_ALIGN_SECTORS=1', 'GPT_ALIGN_SECTORS=2048'],
    ['FIRMWARE_TYPECODE=8DA63339-0007-60C0-C436-083AC8230908', 'FIRMWARE_TYPECODE=0FC63DAF-8483-4772-8E79-3D69D8477DE4'],
  ]) {
    expect(source).toContain(before!)
    expect(() => parseFileLayout(source.replace(before!, after!))).toThrow()
  }
})
