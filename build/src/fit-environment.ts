import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, readFileSync, statSync, truncateSync, writeSync } from 'node:fs'
import type { FileLayout } from './file-layout.ts'

export interface FitBootRecord { id: string, kernelId: string, generation: number, tries: number | null }

/** Raw U-Boot redundant-environment encoding; only mos_entries is accepted. */
export function encodeFitEnvironment(records: FitBootRecord[], flag: number): Buffer<ArrayBuffer> {
  const id = /^[0-9a-f]{64}$/
  if (!records.length || records.length > 3 || !Number.isInteger(flag) || flag < 0 || flag > 255) throw new Error('Invalid environment bounds')
  for (const [i, record] of records.entries()) {
    if (!id.test(record.id) || !id.test(record.kernelId) || !Number.isSafeInteger(record.generation) || record.generation <= 0
      || (record.tries !== null && (!Number.isInteger(record.tries) || record.tries < 0 || record.tries > 3))
      || records.slice(0, i).some(previous => previous.id === record.id || previous.generation <= record.generation)) throw new Error('Invalid boot record')
  }
  const value = `v1|${records.map(record => `${record.id},${record.kernelId},${record.generation},${record.tries ?? '-'}`).join(';')}`
  if (value.length > 512) throw new Error('Boot records exceed environment bound')
  const bytes = Buffer.alloc(65536)
  bytes[4] = flag
  bytes.write(`mos_entries=${value}`, 5, 'ascii')
  let crc = 0xffffffff
  for (const byte of bytes.subarray(5)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  bytes.writeUInt32LE((~crc) >>> 0, 0)
  return bytes
}

export function writeFirmwareRegion(layout: FileLayout, loader: string, records: FitBootRecord[], output: string): void {
  const ranges = layout.firmware, partition = layout.partitions[0]!
  if (!ranges || layout.backend !== 'uboot-fit' || layout.board !== 'cx3576') throw new Error('Expected cx3576 firmware geometry')
  const size = statSync(loader).size
  if (existsSync(output) || size <= 4 || size > ranges.loaderSizeSectors * 512) throw new Error('Invalid firmware size or existing output')
  const bytes = readFileSync(loader)
  if (bytes.subarray(0, 4).toString('ascii') !== 'RKNS') throw new Error('Invalid Rockchip loader header')
  const copies = [encodeFitEnvironment(records, 0), encodeFitEnvironment(records, 1)]
  copyFileSync(loader, output)
  truncateSync(output, partition.sizeSectors * 512)
  const fd = openSync(output, 'r+')
  try {
    for (const [slot, offset] of ranges.envOffsets.entries()) {
      const copy = copies[slot]!
      if (writeSync(fd, copy, 0, copy.length, offset - partition.startSector * 512) !== copy.length) throw new Error('Short environment write')
    }
    fsyncSync(fd)
  } finally { closeSync(fd) }
}
