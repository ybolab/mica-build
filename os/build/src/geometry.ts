// The typed geometry of a board, in the shape an assembler asks questions in.
//
// os/verify's board.ts already turns a board.env into an ordered partition set
// with roles and numbers (verify-package.ts says why that model is imported and
// not copied), and hands back `number | undefined` fields. That is right for a
// lint, which reports what is missing and never stops at the first fault; an
// assembler wants the sector for sgdisk and the MiB for dd, or the build is over.
// It does not assemble and does not decide whether a board definition is
// correct: os/verify/src/lint.ts reports a contradiction, this refuses to use
// one, because there is no honest single number to hand an assembler when the
// file declares two. It stops short of the derived layout too -- the rootfs
// slot size and the starts chained off it, differently in os/mkimage-v2.sh (deleted: PLAN-014) and
// os/mkimage-x64.sh -- because those depend on inputs that do not exist until
// an assembly runs and sit under a byte-identity gate.

import { boardEnvPath } from './paths.ts'
import { loadBoard, type Board, type Partition } from './verify-package.ts'

/** A quantity the model reads as an integer whose value is not one, or contradicts another. */
export interface GeometryFault {
  readonly partition: string | undefined
  readonly key: string
  readonly value: string
  readonly reason: string
}

/**
 * One offset or length, in all three units the board definitions use.
 *
 * A start is declared in MiB on one partition, in sectors on another and in
 * both on a third: cx3576 writes LOADER_START_SECTOR only, and
 * BOOT_A_START_MIB, _START_SECTOR and _OFFSET_BYTES; x64 computes all three
 * with $(( )). sgdisk wants sectors and dd wants MiB, so a Placement carries
 * all three, derived from whichever the file declared against the board's own
 * SECTOR_SIZE and MIB_BYTES rather than against 512 and 1048576 written down
 * again.
 */
export interface Placement {
  readonly bytes: bigint
  readonly sectors: bigint
  readonly mib: bigint | undefined
  /** The key the number came from. The other units are derived from it. */
  readonly from: string
}

export interface PlacedPartition {
  readonly name: string
  /** 1-based position in LAYOUT_PARTITIONS -- the order repart pairs on. */
  readonly position: number
  readonly role: string | undefined
  readonly partnum: bigint | undefined
  readonly label: string | undefined
  readonly guid: string | undefined
  readonly typecode: string | undefined
  /** Undefined when the definition declares no start at all; that is a real case (sizes-only tails). */
  readonly start: Placement | undefined
  readonly size: Placement | undefined
  readonly fatLabel: string | undefined
  readonly fatVolumeId: string | undefined
  readonly fsLabel: string | undefined
  readonly fsUuid: string | undefined
  /** The underlying model entry, for anything this shape does not name. */
  readonly model: Partition
  /** Raw access for any suffix. Undefined when not declared. */
  get: (suffix: string) => string | undefined
  /** True even when the value is the empty string -- declared-empty is not absent. */
  declared: (suffix: string) => boolean
  /** The value, or a throw naming the key and the file. */
  require: (suffix: string) => string
  /** The integer value, or a throw naming the key and the file. */
  requireInt: (suffix: string) => bigint
}

export interface Ext4Settings {
  readonly blockSize: bigint
  readonly features: string
  /** mke2fs reads this out of the ENVIRONMENT; it is not a flag. */
  readonly fakeTime: string
  /** `touch -d` form, with its leading `@`. */
  readonly fileMtime: string
  /** SOURCE_DATE_EPOCH form -- fileMtime without the `@`, which is what mkimage wants. */
  readonly sourceDateEpoch: string
}

export interface DiskSettings {
  readonly guid: string
  readonly alignSectors: bigint
  readonly headMib: bigint
  readonly tailSlackMib: bigint
  readonly typecodeEsp: string | undefined
  readonly typecodeLinux: string | undefined
}

export interface SlotSizing {
  /** MOS_ROOTFS_SLOT_MIB: the pinned slot size, and the floor when unpinned. */
  readonly slotMib: bigint
  readonly headroomPct: bigint
  readonly alignMib: bigint
}

export interface ImageNaming {
  readonly prefix: string
  readonly suffix: string
  readonly latestName: string
}

export interface Geometry {
  readonly board: Board
  readonly name: string
  readonly path: string
  readonly sectorSize: bigint
  readonly mibBytes: bigint
  readonly sectorsPerMib: bigint
  readonly arch: string
  readonly bootloader: string
  readonly partitions: readonly PlacedPartition[]
  readonly disk: DiskSettings
  readonly ext4: Ext4Settings
  readonly naming: ImageNaming
  readonly slot: SlotSizing
  readonly veritySalt: string
  /**
   * Everything this layer could not read as a number, or read two ways.
   *
   * Collected, never thrown, never dropped -- board.ts's discipline, and for
   * its reason: a board with three bad integers should produce three lines.
   * `board.faults` is the model's own list and is separate.
   */
  readonly faults: readonly GeometryFault[]
  partition: (name: string) => PlacedPartition | undefined
  /** The partition, or a throw naming it and the file. */
  requirePartition: (name: string) => PlacedPartition
  /** Every partition of a role, in LAYOUT_PARTITIONS order. */
  partitionsWithRole: (role: string) => readonly PlacedPartition[]
  /** The board key's value, or a throw naming the key and the file. */
  require: (key: string) => string
  /** The board key's integer value, or a throw naming the key and the file. */
  requireInt: (key: string) => bigint
  mibToBytes: (mib: bigint) => bigint
  mibToSectors: (mib: bigint) => bigint
  sectorsToBytes: (sectors: bigint) => bigint
  /** Bytes -> sectors, refusing a byte count that is not a whole number of them. */
  bytesToSectors: (bytes: bigint) => bigint
}

const INTEGER = /^[+-]?[0-9]+$/

/**
 * A board.env value read as a bigint.
 *
 * Re-read from the string rather than taken from board.ts's `number`, which
 * comes from `Number(t)`: exact to 2^53 and silently not beyond it, so
 * `Number('9007199254740993')` is 9007199254740992 and says nothing about it.
 * board-env.ts evaluates `$(( ))` in BigInt because "these are byte offsets;
 * past 2^53 a double stops being exact, and a size that is silently one byte
 * out is the class of defect this package exists to make visible."
 */
function parseInt64(raw: string): bigint | undefined {
  const t = raw.trim()
  if (!INTEGER.test(t)) return undefined
  return BigInt(t)
}

// Required means throws, and the refusal names the key AND the file: under
// `set -u` the shell says "BOOT_A_START_MIB: unbound variable" and names
// neither, and a consumer using `${X:-}` says nothing at all.
function missing(key: string, path: string, what: string): Error {
  return new Error(
    `${path} declares no ${key}, and ${what}. A board definition is the single source of truth for `
    + `its board, so a key an assembler needs is a build failure here rather than a default invented `
    + `by whoever needed it first.`,
  )
}

function notAnInteger(key: string, value: string, path: string): Error {
  return new Error(
    `${key}=${JSON.stringify(value)} in ${path} is read as an integer and is not one.`,
  )
}

/** Build the geometry over an already-modelled board. */
export function modelGeometry(board: Board): Geometry {
  const faults: GeometryFault[] = []
  const path = board.path

  const req = (key: string, what: string): string => {
    const v = board.get(key)
    if (v === undefined) throw missing(key, path, what)
    return v
  }
  const reqInt = (key: string, what: string): bigint => {
    const v = req(key, what)
    const n = parseInt64(v)
    if (n === undefined) throw notAnInteger(key, v, path)
    return n
  }
  const optInt = (key: string, partition?: string): bigint | undefined => {
    const v = board.get(key)
    if (v === undefined) return undefined
    const n = parseInt64(v)
    if (n === undefined) {
      faults.push({ partition, key, value: v, reason: 'is read as an integer here, and it is not one' })
      return undefined
    }
    return n
  }

  const sectorSize = reqInt('SECTOR_SIZE', 'every sector-addressed number in a layout is meaningless without it')
  const mibBytes = reqInt('MIB_BYTES', 'every MiB-addressed number in a layout is meaningless without it')
  if (sectorSize <= 0n) throw new Error(`SECTOR_SIZE=${sectorSize} in ${path} is not a positive sector size`)
  if (mibBytes <= 0n) throw new Error(`MIB_BYTES=${mibBytes} in ${path} is not a positive size`)
  if (mibBytes % sectorSize !== 0n) {
    // Not pedantry: every partition on both boards is placed in MiB and
    // partitioned in sectors, so a MiB that is not a whole number of sectors
    // makes every conversion below a rounding decision nobody made.
    throw new Error(
      `MIB_BYTES=${mibBytes} is not a whole number of SECTOR_SIZE=${sectorSize} sectors in ${path}. `
      + `Every start in this layout is spelled in one unit and consumed in the other, so there would `
      + `be no exact conversion between them.`,
    )
  }
  const sectorsPerMib = mibBytes / sectorSize

  const mibToBytes = (mib: bigint): bigint => mib * mibBytes
  const mibToSectors = (mib: bigint): bigint => mib * sectorsPerMib
  const sectorsToBytes = (sectors: bigint): bigint => sectors * sectorSize
  const bytesToSectors = (bytes: bigint): bigint => {
    if (bytes % sectorSize !== 0n) {
      throw new Error(
        `${bytes} bytes is not a whole number of ${sectorSize}-byte sectors, and rounding it would `
        + `move a partition boundary by less than a sector -- which is not a thing a disk has.`,
      )
    }
    return bytes / sectorSize
  }

  /**
   * Normalise a start or a size that may be spelled in up to three units.
   *
   * Where two are declared they must agree. The schema lint reports that
   * disagreement as a verdict about the file; this refuses to pick one of two
   * contradictory numbers to hand an assembler, which is a different thing and
   * is why both exist.
   */
  const placement = (
    p: string,
    mibKey: string,
    sectorKey: string,
    byteKey: string | undefined,
  ): Placement | undefined => {
    const mib = optInt(mibKey, p)
    const sectors = optInt(sectorKey, p)
    const bytes = byteKey === undefined ? undefined : optInt(byteKey, p)

    const candidates: { from: string, bytes: bigint, mib: bigint | undefined }[] = []
    if (mib !== undefined) candidates.push({ from: mibKey, bytes: mibToBytes(mib), mib })
    if (sectors !== undefined) candidates.push({ from: sectorKey, bytes: sectorsToBytes(sectors), mib: undefined })
    if (bytes !== undefined && byteKey !== undefined) candidates.push({ from: byteKey, bytes, mib: undefined })
    const first = candidates[0]
    if (first === undefined) return undefined

    for (const c of candidates.slice(1)) {
      if (c.bytes === first.bytes) continue
      faults.push({
        partition: p,
        key: c.from,
        value: board.get(c.from) ?? '',
        reason: `is ${c.bytes} bytes and ${first.from} is ${first.bytes}; the two spell the same `
          + `${mibKey.endsWith('_START_MIB') ? 'start' : 'length'} and disagree, so there is no single `
          + `number to place`,
      })
    }

    // The MiB is carried when the file gave one, and derived when it divides
    // exactly. dd seeks in MiB on both assemblers, so a start that is a whole
    // MiB should offer one whether or not the file spelled it that way.
    const mibValue = first.mib ?? (first.bytes % mibBytes === 0n ? first.bytes / mibBytes : undefined)
    return {
      bytes: first.bytes,
      sectors: first.bytes / sectorSize,
      mib: mibValue,
      from: first.from,
    }
  }

  const place = (m: Partition): PlacedPartition => {
    const k = (suffix: string): string => `${m.name}_${suffix}`
    const get = (suffix: string): string | undefined => m.get(suffix)
    return {
      name: m.name,
      position: m.position,
      role: m.role,
      partnum: optInt(k('PARTNUM'), m.name),
      label: m.label,
      guid: m.guid,
      typecode: m.typecode,
      start: placement(m.name, k('START_MIB'), k('START_SECTOR'), k('OFFSET_BYTES')),
      size: placement(m.name, k('SIZE_MIB'), k('SIZE_SECTORS'), k('SIZE_BYTES')),
      fatLabel: m.fatLabel,
      fatVolumeId: m.fatVolumeId,
      fsLabel: m.fsLabel,
      fsUuid: m.fsUuid,
      model: m,
      get,
      declared: (suffix: string) => m.declared(suffix),
      require: (suffix: string) => req(k(suffix), `it is what ${m.name} is placed or formatted by`),
      requireInt: (suffix: string) => reqInt(k(suffix), `it is what ${m.name} is placed or formatted by`),
    }
  }

  const partitions = board.partitions.map(place)
  const byName = new Map(partitions.map(p => [p.name, p]))

  const fileMtime = req('FILE_MTIME', 'every timestamp written into an image is pinned to it')

  return {
    board,
    name: board.name,
    path,
    sectorSize,
    mibBytes,
    sectorsPerMib,
    arch: req('MOS_ARCH', 'it decides which toolchain and which container architecture a build uses'),
    bootloader: req('RAUC_BOOTLOADER', 'it decides which boot backend an assembler writes'),
    partitions,
    disk: {
      guid: req('DISK_GUID', 'a GPT with an invented disk GUID is not reproducible'),
      // Not required: os/mkimage-x64.sh passes no -a at all and lets sgdisk use
      // its default, while cx3576 must pass 1 because its loader starts at
      // sector 64. Defaulting it here would silently give x64 an alignment its
      // shell never asked for.
      alignSectors: optInt('GPT_ALIGN_SECTORS') ?? 0n,
      headMib: reqInt('IMAGE_HEAD_MIB', 'it is the space before the first partition'),
      tailSlackMib: reqInt('IMAGE_TAIL_SLACK_MIB', 'it is the slack after the last one'),
      typecodeEsp: board.get('TYPECODE_ESP'),
      typecodeLinux: board.get('TYPECODE_LINUX'),
    },
    ext4: {
      blockSize: reqInt('EXT4_BLOCK_SIZE', 'mke2fs is called with it on every filesystem in the image'),
      features: req('EXT4_FEATURES', 'it is what makes an ext4 in this image reproducible'),
      fakeTime: req('E2FSPROGS_FAKE_TIME', 'without it mke2fs stamps the current time into every superblock'),
      fileMtime,
      // `@1577836800` is the `touch -d` spelling; mkimage wants the bare
      // number in SOURCE_DATE_EPOCH. os/mkimage-v2.sh (deleted: PLAN-014) writes
      // `SOURCE_DATE_EPOCH="${FILE_MTIME#@}"` at the call; deriving it once
      // here is the same derivation with one place to be wrong.
      sourceDateEpoch: fileMtime.startsWith('@') ? fileMtime.slice(1) : fileMtime,
    },
    naming: {
      prefix: req('IMAGE_NAME_PREFIX', 'it is the name of the artifact a build produces'),
      suffix: req('IMAGE_NAME_SUFFIX', 'it is the name of the artifact a build produces'),
      latestName: req('IMAGE_LATEST_NAME', 'it is the symlink a build points at its output'),
    },
    slot: {
      slotMib: reqInt('MOS_ROOTFS_SLOT_MIB', 'it is the pinned rootfs slot size, and the floor when unpinned'),
      headroomPct: reqInt('ROOTFS_SLOT_HEADROOM_PCT', 'it is how much an unpinned slot grows over its payload'),
      alignMib: reqInt('ROOTFS_SLOT_ALIGN_MIB', 'it is what an unpinned slot size is rounded up to'),
    },
    veritySalt: req('VERITY_SALT', 'a hash tree built with a random salt is not reproducible'),
    faults,
    partition: (n: string) => byName.get(n),
    requirePartition: (n: string) => {
      const p = byName.get(n)
      if (p !== undefined) return p
      throw new Error(
        `${path} has no partition called ${n}. LAYOUT_PARTITIONS lists `
        + `${board.layoutPartitions === undefined ? '(nothing -- the key is absent)' : board.layoutPartitions.join(' ')}.`,
      )
    },
    partitionsWithRole: (role: string) => partitions.filter(p => p.role === role),
    require: (key: string) => req(key, 'an assembler asked for it'),
    requireInt: (key: string) => reqInt(key, 'an assembler asked for it'),
    mibToBytes,
    mibToSectors,
    sectorsToBytes,
    bytesToSectors,
  }
}

/** Read and model one `boards/<board>/board.env` as geometry. */
export function loadGeometry(board: string): Geometry {
  return modelGeometry(loadBoard(boardEnvPath(board)))
}

/** Read and model an arbitrary path as geometry -- a mutated copy, for instance. */
export function loadGeometryFromPath(path: string): Geometry {
  return modelGeometry(loadBoard(path))
}
