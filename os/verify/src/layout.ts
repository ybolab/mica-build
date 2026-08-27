// The partition table the board definition describes, walked the way
// os/verify-image-v2.sh:1450-1516 (deleted: PLAN-014) walks it.
//
// One half of every GPT geometry check; the other half is the table the image
// actually carries, read by `readGpt`. The two are produced by different code
// from different inputs and only then compared, the property the oracle's own
// comment at :1450 insists on and the reason the hand-written chain it replaced
// (`rootfs_b_start_mib = ...; meta_start_mib = ...`) was wrong -- it restated
// the arithmetic the assembler had already done, so a gap both agreed on passed.
//
// Size resolves in the schema's order: an explicit `_SIZE_SECTORS`, else
// `_SIZE_MIB`, else -- for a `verity-slot` -- the size read back out of the
// image, because a rootfs slot's size is content-derived
// (`MOS_ROOTFS_SLOT_MIB` in the layout env) and declaring it would restate what
// the build computed. Start is where this stops being a lookup: a partition
// either declares a fixed start (`_START_SECTOR` or `_START_MIB`) or begins
// where the previous one ended, which is what a partition table means and what
// makes the packing itself the thing under test.

import type { Board, Partition } from './board.ts'
import { ToolOutputError } from './tools.ts'

/** One expected row: what the board definition says partition `number` must be. */
export interface LayoutRow {
  /** The LAYOUT_PARTITIONS name, e.g. `BOOT_A`. Not the PARTLABEL. */
  readonly name: string
  readonly number: number
  readonly label: string
  readonly typecode: string
  readonly guid: string
  readonly sizeSectors: number
  readonly startSector: number
}

export interface LayoutWalk {
  readonly rows: readonly LayoutRow[]
  readonly sectorsPerMib: number
  /** Where the last partition ends, in sectors. The image's tail slack starts here. */
  readonly endSector: number
  /** `endSector` in MiB plus IMAGE_TAIL_SLACK_MIB -- the whole image. */
  readonly totalSizeMib: number
  readonly tailSlackMib: number
  /** Resolve a row by its LAYOUT_PARTITIONS name. */
  row: (name: string) => LayoutRow | undefined
}

/**
 * A declared value read as an integer, refusing anything else by name.
 *
 * The board model's own `int()` records a fault and returns undefined, which
 * here would fall through to the next candidate in the size order and resolve a
 * partition's size from the WRONG key. The oracle has no such fallthrough --
 * `$((v * SECTORS_PER_MIB))` on a non-number is a hard error under `set -e` --
 * so this refuses too, and says which key it refused.
 */
function intOf(raw: string | undefined, key: string): number | undefined {
  if (raw === undefined) return undefined
  const t = raw.trim()
  if (t === '') return undefined
  if (!/^[+-]?\d+$/.test(t)) {
    throw new ToolOutputError(
      `${key}='${raw}' is read as a whole number of sectors or MiB here and is not one. Resolved as `
      + `"absent" it would fall through to the next key in the size order and give this partition `
      + `another one's arithmetic.`,
    )
  }
  return Number(t)
}

function required(value: string | undefined, key: string, board: Board): string {
  if (value === undefined || value.trim() === '') {
    throw new ToolOutputError(
      `${board.path} declares no ${key}; this walk reads the layout and has nothing to read.`,
    )
  }
  return value
}

function sizeSectorsOf(p: Partition, sectorsPerMib: number, slotSectors: number, board: Board): number {
  const sectors = intOf(p.get('SIZE_SECTORS'), `${p.name}_SIZE_SECTORS`)
  if (sectors !== undefined) return sectors
  const mib = intOf(p.get('SIZE_MIB'), `${p.name}_SIZE_MIB`)
  if (mib !== undefined) return mib * sectorsPerMib
  if (p.role === 'verity-slot') return slotSectors
  throw new ToolOutputError(
    `${board.path} gives ${p.name} no size: it declares neither ${p.name}_SIZE_SECTORS nor `
    + `${p.name}_SIZE_MIB, and its role is not verity-slot.`,
  )
}

function fixedStartOf(p: Partition, sectorsPerMib: number): number | undefined {
  const sector = intOf(p.get('START_SECTOR'), `${p.name}_START_SECTOR`)
  if (sector !== undefined) return sector
  const mib = intOf(p.get('START_MIB'), `${p.name}_START_MIB`)
  if (mib !== undefined) return mib * sectorsPerMib
  return undefined
}

/**
 * Walk one board definition into the table it describes.
 *
 * `slotSectors` is the verity-slot size read from the image. It is a parameter
 * rather than something this function fetches, so that a caller cannot
 * accidentally hand the same number to both sides of a comparison: the check
 * that asserts a rootfs slot's size against the layout floor takes it from
 * here, and the checks that assert the image against the layout take everything
 * else from here and the image from `readGpt`.
 */
export function walkLayout(board: Board, slotSectors: number): LayoutWalk {
  const mibBytes = board.mibBytes
  const sectorSize = board.sectorSize
  if (mibBytes === undefined || sectorSize === undefined || sectorSize <= 0) {
    throw new ToolOutputError(
      `${board.path} must declare SECTOR_SIZE and MIB_BYTES as positive integers; this walk converts `
      + `between the two units at every row and cannot guess either.`,
    )
  }
  const sectorsPerMib = Math.floor(mibBytes / sectorSize)
  const names = board.layoutPartitions
  if (names === undefined || names.length === 0) {
    throw new ToolOutputError(
      `${board.path} declares no LAYOUT_PARTITIONS; this walk walks the board definition and has `
      + `nothing to walk. os/verify-image-v2.sh:1414 refuses the same state for the same reason.`,
    )
  }

  const rows: LayoutRow[] = []
  let cursor = 0
  for (const name of names) {
    const p = board.partition(name)
    if (p === undefined) {
      throw new ToolOutputError(`${board.path} lists ${name} in LAYOUT_PARTITIONS and declares nothing for it.`)
    }
    const number = intOf(p.get('PARTNUM'), `${name}_PARTNUM`)
    if (number === undefined) {
      throw new ToolOutputError(`${board.path} declares no ${name}_PARTNUM.`)
    }
    const size = sizeSectorsOf(p, sectorsPerMib, slotSectors, board)
    const start = fixedStartOf(p, sectorsPerMib) ?? cursor
    cursor = start + size
    rows.push({
      name,
      number,
      label: required(p.label, `${name}_LABEL`, board),
      typecode: required(p.typecode, `${name}_TYPECODE`, board),
      guid: required(p.guid, `${name}_GUID`, board),
      sizeSectors: size,
      startSector: start,
    })
  }

  const tailSlackMib = intOf(board.get('IMAGE_TAIL_SLACK_MIB'), 'IMAGE_TAIL_SLACK_MIB')
  if (tailSlackMib === undefined) {
    throw new ToolOutputError(
      `${board.path} declares no IMAGE_TAIL_SLACK_MIB. The image's total size is the walk plus that `
      + `slack, and a missing slack would be read as zero -- an image one MiB smaller than the one `
      + `the assembler builds, reported as a defect in the image.`,
    )
  }

  const byName = new Map(rows.map(r => [r.name, r]))
  return {
    rows,
    sectorsPerMib,
    endSector: cursor,
    totalSizeMib: Math.floor(cursor / sectorsPerMib) + tailSlackMib,
    tailSlackMib,
    row: (n: string) => byName.get(n),
  }
}
