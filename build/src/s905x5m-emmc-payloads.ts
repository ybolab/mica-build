// Extract the complete eMMC package payloads from the SD image assembler's
// finished bytes. This is deliberately a consumer, not a second image writer:
// the GPT and every exported partition must be the bytes the one assembler
// already placed from board.env.

import {
  chmodSync,
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { loadGeometry, type Geometry } from './geometry.ts'
import { deriveLayout, gptSpecFor, type DerivedLayout } from './layout-cx3576.ts'
import { REPO_ROOT } from './paths.ts'
import { Toolbox } from './toolbox.ts'
import { CX3576_ASSEMBLY } from './toolsets.ts'
import { readPartition, verifyGpt, type GptPartitionInfo } from './tools/sgdisk.ts'

export const EMMC_PAYLOAD_BOARD = 's905x5m'
export const SD_IMAGE_MARKER = '-sd-'

// The Amlogic GPT item is the primary 34 sectors followed by the backup 33
// sectors. Its eMMC writer consumes the primary table and regenerates the
// backup at the target's real capacity, but the vendor package format carries
// both regions (67 * 512 = 34304 bytes on this board).
const GPT_PRIMARY_SECTORS = 34n
const GPT_BACKUP_SECTORS = 33n
const COPY_CHUNK_BYTES = 4 * 1024 * 1024

export interface EmmcPayloadSpec {
  /** Board.env partition identity, rather than a free-form manifest label. */
  readonly partition: string
  /** Filename the Amlogic manifest consumes. */
  readonly file: string
  /** A factory reset must leave this range entirely zero. */
  readonly mustBeZero: boolean
}

// p1 (RESERVED) is the SD-only cfgload bridge and p2 (ENV) remains vendor
// owned. Every remaining partition is mos-owned state and must be initialized
// when the complete package replaces a foreign user-area GPT.
export const EMMC_PAYLOADS: readonly EmmcPayloadSpec[] = [
  { partition: 'UENV_A', file: 'uenv-a.PARTITION', mustBeZero: true },
  { partition: 'UENV_B', file: 'uenv-b.PARTITION', mustBeZero: true },
  { partition: 'BOOT_A', file: 'boot-a.PARTITION', mustBeZero: false },
  { partition: 'BOOT_B', file: 'boot-b.PARTITION', mustBeZero: false },
  { partition: 'ROOTFS_A', file: 'rootfs-a.PARTITION', mustBeZero: false },
  { partition: 'ROOTFS_B', file: 'rootfs-b.PARTITION', mustBeZero: true },
  { partition: 'META', file: 'meta.PARTITION', mustBeZero: false },
  { partition: 'STATE', file: 'state.PARTITION', mustBeZero: false },
  { partition: 'EPHEMERAL', file: 'ephemeral.PARTITION', mustBeZero: false },
  { partition: 'DATA', file: 'data.PARTITION', mustBeZero: false },
]

export interface EmmcPayloadExtractionOptions {
  readonly toolbox?: Toolbox
  readonly geometry?: Geometry
  readonly log?: (line: string) => void
}

export interface ExtractedEmmcPayload {
  readonly partition: string
  readonly file: string
  readonly bytes: bigint
  readonly allZero: boolean
}

export interface EmmcPayloadExtractionResult {
  readonly image: string
  readonly outDir: string
  readonly layout: DerivedLayout
  readonly gptBytes: bigint
  readonly payloads: readonly ExtractedEmmcPayload[]
}

interface CopyRange {
  readonly offset: bigint
  readonly bytes: bigint
}

interface CopyResult {
  readonly bytes: bigint
  readonly allZero: boolean
}

function safeOffset(value: bigint, what: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${what} is ${value}, outside Node's exact file-offset range`)
  }
  return Number(value)
}

function requireImage(path: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${path} is not an assembled ${EMMC_PAYLOAD_BOARD} SD image`)
  }
  if (!basename(path).includes(SD_IMAGE_MARKER)) {
    throw new Error(
      `${path} has no '${SD_IMAGE_MARKER}' marker. Complete eMMC payloads may only be derived from `
      + 'the explicitly SD-only assembler output, never from an ambiguous block image.',
    )
  }
}

function requireEmptyDestination(path: string): void {
  if (existsSync(path)) {
    throw new Error(
      `${path} already exists. Payload extraction publishes one new directory so a previous package input `
      + 'cannot be silently mixed with this image.',
    )
  }
  mkdirSync(dirname(path), { recursive: true })
}

/** Identity mounts for the source SD image and the directory the extractor publishes. */
export function mountsForEmmcPayloads(image: string, outDir: string): string[] {
  const dirs = new Set<string>([REPO_ROOT, dirname(resolve(image)), dirname(resolve(outDir))])
  const all = [...dirs].sort()
  return all.filter(dir => !all.some(other => other !== dir && dir.startsWith(`${other}/`)))
}

function sameText(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function partitionMismatch(message: string): never {
  throw new Error(`the assembled SD image is not the required ${EMMC_PAYLOAD_BOARD} GPT: ${message}`)
}

async function verifyMosGpt(
  tb: Toolbox,
  image: string,
  geometry: Geometry,
): Promise<{ layout: DerivedLayout, partitions: ReadonlyMap<string, GptPartitionInfo> }> {
  await verifyGpt(tb, image)

  const rootAId = geometry.requirePartition('ROOTFS_A').requireInt('PARTNUM')
  const rootBId = geometry.requirePartition('ROOTFS_B').requireInt('PARTNUM')
  const rootA = await readPartition(tb, image, rootAId)
  const rootB = await readPartition(tb, image, rootBId)
  if (rootA.sizeSectors !== rootB.sizeSectors) {
    partitionMismatch(`ROOTFS_A is ${rootA.sizeSectors} sectors but ROOTFS_B is ${rootB.sizeSectors}`)
  }
  const slotBytes = rootA.sizeSectors * geometry.sectorSize
  if (slotBytes <= 0n || slotBytes % geometry.mibBytes !== 0n) {
    partitionMismatch(`the rootfs slot is ${slotBytes} bytes, not a positive whole-MiB size`)
  }
  const layout = deriveLayout(geometry, slotBytes / geometry.mibBytes)
  const expected = gptSpecFor(geometry, layout)
  if (expected.partitions.length !== geometry.partitions.length) {
    throw new Error(
      `internal error: ${geometry.path} yielded ${geometry.partitions.length} board partitions but `
      + `gptSpecFor yielded ${expected.partitions.length}`,
    )
  }

  const actual = new Map<string, GptPartitionInfo>()
  for (const [index, want] of expected.partitions.entries()) {
    const boardPartition = geometry.partitions[index]
    if (boardPartition === undefined) throw new Error(`internal error: no board partition at GPT index ${index}`)
    const got = await readPartition(tb, image, want.partnum)
    const faults: string[] = []
    if (got.firstSector !== want.startSector) faults.push(`start ${got.firstSector}, expected ${want.startSector}`)
    if (got.sizeSectors !== want.sizeSectors) faults.push(`size ${got.sizeSectors}, expected ${want.sizeSectors}`)
    if (got.name !== want.label) faults.push(`name ${JSON.stringify(got.name)}, expected ${JSON.stringify(want.label)}`)
    if (!sameText(got.typecode, want.typecode ?? '')) faults.push(`type ${got.typecode}, expected ${want.typecode}`)
    if (!sameText(got.guid, want.guid ?? '')) faults.push(`GUID ${got.guid}, expected ${want.guid}`)
    if (faults.length > 0) partitionMismatch(`${boardPartition.name} (p${want.partnum}): ${faults.join('; ')}`)
    actual.set(boardPartition.name, got)
  }
  return { layout, partitions: actual }
}

function writeWhole(fd: number, data: Buffer, length: number, position: bigint, path: string): void {
  let done = 0
  while (done < length) {
    const wrote = writeSync(fd, data, done, length - done, safeOffset(position + BigInt(done), `${path} write offset`))
    if (wrote <= 0) throw new Error(`writing ${path} stopped after ${done} of ${length} bytes`)
    done += wrote
  }
}

/**
 * Copy exact logical file ranges while preserving all-zero runs as holes.
 *
 * Sparse output is byte-identical to a fully allocated output but prevents a
 * zero-filled inactive root slot and fresh filesystems from consuming a second
 * full image's worth of workspace before the packer reads them.
 */
function copyRanges(input: string, output: string, ranges: readonly CopyRange[]): CopyResult {
  const source = openSync(input, 'r')
  const destination = openSync(output, 'w')
  const buffer = Buffer.alloc(COPY_CHUNK_BYTES)
  const zero = Buffer.alloc(COPY_CHUNK_BYTES)
  let outputOffset = 0n
  let allZero = true
  try {
    for (const range of ranges) {
      if (range.bytes <= 0n) throw new Error(`${output} was given a non-positive extraction range of ${range.bytes} bytes`)
      let inputOffset = range.offset
      let remaining = range.bytes
      while (remaining > 0n) {
        const requested = Number(remaining > BigInt(buffer.length) ? BigInt(buffer.length) : remaining)
        const read = readSync(source, buffer, 0, requested, safeOffset(inputOffset, `${input} read offset`))
        if (read !== requested) {
          throw new Error(`${input} ended at ${inputOffset + BigInt(read)} while extracting ${output}`)
        }
        const bytes = buffer.subarray(0, read)
        if (!bytes.equals(zero.subarray(0, read))) {
          writeWhole(destination, buffer, read, outputOffset, output)
          allZero = false
        }
        inputOffset += BigInt(read)
        outputOffset += BigInt(read)
        remaining -= BigInt(read)
      }
    }
    ftruncateSync(destination, safeOffset(outputOffset, `${output} size`))
    return { bytes: outputOffset, allZero }
  }
  finally {
    closeSync(destination)
    closeSync(source)
  }
}

function requirePayloadState(spec: EmmcPayloadSpec, result: CopyResult): void {
  if (result.bytes === 0n) throw new Error(`${spec.file} extracted no bytes`)
  if (spec.mustBeZero && !result.allZero) {
    throw new Error(
      `${spec.partition} in the assembled SD image contains non-zero bytes. A complete factory package must `
      + `clear this range rather than preserve an inactive slot or U-Boot environment from another install.`,
    )
  }
  if (!spec.mustBeZero && result.allZero) {
    throw new Error(`${spec.partition} in the assembled SD image is entirely zero; a complete package cannot boot or initialize it`)
  }
}

/**
 * Extract the complete eMMC package inputs from one completed SD image.
 *
 * No device path is accepted or opened. The only writes are new regular files
 * below outDir, which are later fed to the Amlogic container packer.
 */
export async function extractS905x5mEmmcPayloads(
  image: string,
  outDir: string,
  options: EmmcPayloadExtractionOptions = {},
): Promise<EmmcPayloadExtractionResult> {
  requireImage(image)
  requireEmptyDestination(outDir)
  const geometry = options.geometry ?? loadGeometry(EMMC_PAYLOAD_BOARD)
  if (geometry.faults.length > 0) {
    throw new Error(
      `${geometry.path} has ${geometry.faults.length} unusable value(s):\n`
      + geometry.faults.map(f => `  ${f.key}=${JSON.stringify(f.value)} ${f.reason}`).join('\n'),
    )
  }
  const log = options.log ?? ((line: string) => console.log(line))
  const ownToolbox = options.toolbox === undefined
  const tb = options.toolbox ?? await Toolbox.open(CX3576_ASSEMBLY, {
    mounts: mountsForEmmcPayloads(image, outDir),
    announce: log,
  })
  const output = resolve(outDir)
  const temporary = mkdtempSync(join(dirname(output), `.${basename(output)}.tmp-`))
  // The extractor may run in the pinned Bun container while BuildKit runs on
  // the host daemon. A root-owned mkdtemp defaults to 0700, which makes the
  // named payload context unreadable to that daemon and prevents the caller
  // from cleaning a failed build. The files remain ordinary 0644 outputs; this
  // grants the caller traversal and unlink permission in this random temporary
  // hand-off directory, not write access to the eventual package artifact.
  chmodSync(temporary, 0o777)
  let published = false
  try {
    const { layout, partitions } = await verifyMosGpt(tb, image, geometry)
    const imageBytes = BigInt(statSync(image).size)
    if (imageBytes % geometry.sectorSize !== 0n) {
      throw new Error(`${image} is ${imageBytes} bytes, not a whole number of ${geometry.sectorSize}-byte sectors`)
    }
    const primaryBytes = GPT_PRIMARY_SECTORS * geometry.sectorSize
    const backupBytes = GPT_BACKUP_SECTORS * geometry.sectorSize
    if (imageBytes < primaryBytes + backupBytes) {
      throw new Error(`${image} is too short to contain the primary and backup GPT regions`)
    }
    const gpt = copyRanges(image, join(temporary, 'gpt.bin'), [
      { offset: 0n, bytes: primaryBytes },
      { offset: imageBytes - backupBytes, bytes: backupBytes },
    ])
    if (gpt.allZero || gpt.bytes !== primaryBytes + backupBytes) {
      throw new Error(`gpt.bin extraction produced ${gpt.bytes} bytes and allZero=${gpt.allZero}`)
    }

    const payloads: ExtractedEmmcPayload[] = []
    for (const spec of EMMC_PAYLOADS) {
      const partition = partitions.get(spec.partition)
      if (partition === undefined) throw new Error(`the verified GPT has no ${spec.partition} entry to extract`)
      const result = copyRanges(image, join(temporary, spec.file), [{
        offset: partition.firstSector * geometry.sectorSize,
        bytes: partition.sizeSectors * geometry.sectorSize,
      }])
      requirePayloadState(spec, result)
      payloads.push({ partition: spec.partition, file: spec.file, bytes: result.bytes, allZero: result.allZero })
    }

    renameSync(temporary, output)
    published = true
    log(
      `extracted ${payloads.length} mos-owned eMMC partitions plus gpt.bin from ${image}; `
      + 'RESERVED and ENV were intentionally not exported',
    )
    return { image, outDir: output, layout, gptBytes: gpt.bytes, payloads }
  }
  finally {
    if (!published) rmSync(temporary, { recursive: true, force: true })
    if (ownToolbox) await tb.close()
  }
}
