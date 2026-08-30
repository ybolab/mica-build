// The layout walk for ONE image, with the crossing number read off that image.
//
// `walkLayout` needs a verity-slot size, because the board definition
// deliberately does not declare where everything after the slots begins -- the
// slot size is content-derived and read back from the GPT. Three families need
// that walk against a live image: the ext4 tiers' offsets, ROOTFS-B's zero-fill extent, and the
// U-Boot blob's containment arithmetic. This is the one place that combines
// them, so the reading is made once and the same way each time.
//
// WHY THE SLOT SIZE IS A PARAMETER TO walkLayout AND NOT SOMETHING IT FETCHES:
// `layout.ts` says it, and it is the same rule here. A caller must not be able
// to hand the same number to both sides of a comparison. What this function
// hands back is the LAYOUT's arithmetic given the image's slot size; the checks
// that compare the image against the layout still read the image separately.

import type { ImageContext } from './checks.ts'
import { walkLayout, type LayoutWalk } from './layout.ts'
import { ToolOutputError } from './tools.ts'

export interface ImageLayout {
  readonly walk: LayoutWalk
  readonly mibBytes: number
  readonly sectorsPerMib: number
  /** ROOTFS-A's size as the IMAGE's GPT reports it, or 0 when unusable. */
  readonly slotSectors: number
  /** The same value in MiB, or 0 (`SLOT_MIB`). */
  readonly slotMib: number
  /** `PART_START_MIB_<name>` -- where the layout puts that row. */
  startMib: (layoutName: string) => number
  /** That row's size in MiB, floored as the oracle's `bs=1M count=` is. */
  sizeMib: (layoutName: string) => number
}

export async function imageLayout(ctx: ImageContext): Promise<ImageLayout> {
  const board = ctx.board
  const mibBytes = board.mibBytes
  const sectorSize = board.sectorSize
  if (mibBytes === undefined || sectorSize === undefined || sectorSize <= 0) {
    throw new ToolOutputError(
      `${board.path} must declare SECTOR_SIZE and MIB_BYTES as positive integers; every offset this `
      + `harness reads converts between the two.`,
    )
  }
  const sectorsPerMib = Math.floor(mibBytes / sectorSize)
  const gpt = await ctx.gpt()
  const partnum = Number(board.partition('ROOTFS_A')?.get('PARTNUM') ?? Number.NaN)
  const raw = gpt.partition(partnum)?.sizeSectors ?? 0
  // `SLOT_MIB=0; slot_sectors=0` unless the size is a positive whole number of
  // MiB. Zero is not a defensive default here -- it is the
  // oracle's own value, and the checks that use it test for it.
  const usable = raw > 0 && raw % sectorsPerMib === 0
  const slotSectors = usable ? raw : 0
  const walk = walkLayout(board, slotSectors)
  const rowOrRefuse = (layoutName: string) => {
    const row = walk.row(layoutName)
    if (row === undefined) {
      throw new ToolOutputError(
        `${board.path} lists no ${layoutName} in LAYOUT_PARTITIONS, so this walk has no offset for `
        + `it. Defaulted to 0 it would read the image's own GPT as the partition's content.`,
      )
    }
    return row
  }
  return {
    walk,
    mibBytes,
    sectorsPerMib,
    slotSectors,
    slotMib: usable ? raw / sectorsPerMib : 0,
    startMib: (n: string) => Math.floor(rowOrRefuse(n).startSector / sectorsPerMib),
    sizeMib: (n: string) => Math.floor(rowOrRefuse(n).sizeSectors / sectorsPerMib),
  }
}
