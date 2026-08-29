// Batch 1a: the GPT geometry.
//
// Every check here reads the table the image carries through `readGpt` and the
// table the board declares through `walkLayout`, and compares the two. The
// context deliberately offers no route from a check to a board-resolved
// partition table: a check comparing the image to the board definition has to
// read the two independently, or it hands itself the same number on both
// sides.
//
// The one number that crosses.
//
// A verity slot's size is content-derived, so the layout does not declare it --
// `walkLayout` takes it as a parameter and everything downstream of the slots
// follows from it. It is read off the image here, once, exactly as
// os/verify-image-v2.sh:1441 (deleted) reads it, and it is refused unless it is a
// positive whole-MiB multiple. When it is refused the walk is fed 0, which is
// what makes the size and image-size checks FAIL rather than compare a slot
// against a size derived from itself.

import { statSync } from 'node:fs'
import type { Board } from './board.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import type { GptTable } from './image.ts'
import { sgdiskVerify } from './image.ts'
import { walkLayout, type LayoutWalk } from './layout.ts'
import type { CheckResult } from './parity.ts'
import { ToolOutputError } from './tools.ts'
import { eqCi, verdict } from './verdict.ts'

function declaredKey(board: Board, key: string): string {
  const v = board.get(key)
  if (v === undefined || v.trim() === '') {
    throw new ToolOutputError(
      `${board.path} declares no ${key}, so this check has nothing to compare the image against. `
      + `Answered as a throw rather than as a failed check: a fail here would be a statement about `
      + `the IMAGE, and a missing key is a statement about the board definition.`,
    )
  }
  return v
}

function intKey(board: Board, key: string): number {
  const raw = declaredKey(board, key)
  if (!/^[+-]?\d+$/.test(raw.trim())) {
    throw new ToolOutputError(`${board.path} declares ${key}='${raw}', which is read as a number here.`)
  }
  return Number(raw.trim())
}

/**
 * The verity-slot size, read off the image and refused unless it is usable.
 *
 * `sectorsPerMib` comes from the board's own SECTOR_SIZE/MIB_BYTES because the
 * conversion has to be the layout's; `gpt.sectorSize` is what sgdisk reports
 * and is asserted against nothing here.
 */
function slotFromImage(gpt: GptTable, board: Board): { sectors: number, mib: number } {
  const sectorsPerMib = Math.floor(intKey(board, 'MIB_BYTES') / intKey(board, 'SECTOR_SIZE'))
  const partnum = intKey(board, 'ROOTFS_A_PARTNUM')
  const raw = gpt.partition(partnum)?.sizeSectors ?? 0
  const usable = raw > 0 && raw % sectorsPerMib === 0
  return usable ? { sectors: raw, mib: raw / sectorsPerMib } : { sectors: 0, mib: 0 }
}

interface Geometry {
  readonly gpt: GptTable
  readonly walk: LayoutWalk
  readonly slotMib: number
}

/**
 * The two tables and the crossing number, for one image.
 *
 * Recomputed per check rather than cached across them. `ctx.gpt()` is already
 * memoised, so the only repeated work is the arithmetic of the walk -- and a
 * shared mutable geometry would let one check's reading decide another's,
 * which is the coupling this whole file exists to avoid.
 */
async function geometryOf(ctx: ImageContext): Promise<Geometry> {
  const gpt = await ctx.gpt()
  const slot = slotFromImage(gpt, ctx.board)
  return { gpt, walk: walkLayout(ctx.board, slot.sectors), slotMib: slot.mib }
}

/** Every per-partition check fires once per row, identified by partition number. */
const PER_PARTITION = /^p(\d+) /

export const GPT_CHECKS: readonly CheckCase[] = [
  {
    // sgdisk says "No problems found." about a file with no partition table at
    // all; `sgdiskVerify` refuses that reading before this check sees it, so
    // reaching here means there WAS a table to verify.
    id: 'gpt-verify-clean',
    shell: {
      pass: 'sgdisk --verify reports no problems',
      fail: 'sgdisk --verify reported problems',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const v = await sgdiskVerify(ctx.tools, ctx.image)
      return [verdict(
        'gpt-verify-clean',
        v.clean,
        v.clean
          ? 'sgdisk --verify reports no problems'
          : `sgdisk --verify reported problems: ${v.output.split('\n').join(' ')}`,
      )]
    },
  },

  {
    id: 'gpt-disk-guid',
    // eq_ci prints "<what> is <want>" passing and "<what> is '<got>', expected
    // <want>" failing, so the leading clause is the whole shared substring.
    shell: { pass: 'disk GUID is ' },
    run: async (ctx) => {
      const gpt = await ctx.gpt()
      return [eqCi('gpt-disk-guid', 'disk GUID', gpt.diskGuid, declaredKey(ctx.board, 'DISK_GUID'))]
    },
  },

  // Not ported: the partition COUNT.
  //
  // `pass "exactly ${EXPECT_PARTS} partitions"`. Its identity cannot be
  // expressed as a substring, and this was measured rather than guessed --
  // every candidate, counted against both boards' real conclusions:
  //
  //   ` partitions`  cx3576 3, x64 3   the count, the image-size line, and
  //       one uenv line per board
  //   `exactly `     cx3576 13, x64 8  `p1 ... ends exactly where uenv-a
  //       begins`, `contains exactly one kernel's modules`, and ten more
  //
  // Nothing else in the sentence is board-independent: the only tokens are
  // `exactly`, the count, and `partitions`, and the count is the one thing the
  // oracle deliberately stopped writing down (:1408 -- `EXPECT_PARTS=11` is why
  // `MOS_BOARD=x64` once died four checks in). Registering `exactly 11
  // partitions` per board would put that literal back, in the register, where a
  // board that changed its partition count would go `orphan` instead of red.
  //
  // Leaving it unclaimed is the state the harness is built to describe: it
  // stays a `not-ported` line with PASS written next to it. Closing it needs an
  // ANCHORED matcher -- `ShellMatcher` accepts a substring and nothing else --
  // which is a change to the instrument and M4e's to make. The boot-slot
  // required-files family in checks-slots.ts is blocked by the same shape.

  {
    id: 'gpt-partlabel',
    cardinality: 'many',
    instance: PER_PARTITION,
    // Not eq_ci: the PARTLABEL comparison is case SENSITIVE in the oracle, and
    // its two directions share `p<n> PARTLABEL is`.
    shell: { pass: ' PARTLABEL is ' },
    run: async (ctx) => {
      const { gpt, walk } = await geometryOf(ctx)
      return walk.rows.map((row) => {
        const got = gpt.partition(row.number)?.name
        return verdict(
          'gpt-partlabel',
          got === row.label,
          got === row.label
            ? `p${row.number} PARTLABEL is '${row.label}'`
            : `p${row.number} PARTLABEL is ${got ?? 'unreadable'}, expected '${row.label}'`,
          { instance: String(row.number) },
        )
      })
    },
  },

  {
    id: 'gpt-typecode',
    cardinality: 'many',
    instance: PER_PARTITION,
    shell: { pass: ' typecode is ' },
    run: async (ctx) => {
      const { gpt, walk } = await geometryOf(ctx)
      return walk.rows.map(row => eqCi(
        'gpt-typecode',
        `p${row.number} typecode`,
        gpt.partition(row.number)?.typeGuid,
        row.typecode,
        { instance: String(row.number) },
      ))
    },
  },

  {
    id: 'gpt-partition-guid',
    cardinality: 'many',
    instance: PER_PARTITION,
    shell: { pass: ' partition GUID is ' },
    run: async (ctx) => {
      const { gpt, walk } = await geometryOf(ctx)
      return walk.rows.map(row => eqCi(
        'gpt-partition-guid',
        `p${row.number} partition GUID`,
        gpt.partition(row.number)?.uniqueGuid,
        row.guid,
        { instance: String(row.number) },
      ))
    },
  },

  {
    id: 'gpt-partition-size',
    cardinality: 'many',
    instance: PER_PARTITION,
    // `) size is ` and not ` size is `: the latter would also claim
    // "image size is ..." and "rootfs slot ... size is ...".
    shell: { pass: ') size is ' },
    run: async (ctx) => {
      const { gpt, walk } = await geometryOf(ctx)
      return walk.rows.map((row) => {
        const got = gpt.partition(row.number)?.sizeSectors
        // `want > 0` is not decoration: a verity slot whose size the image
        // could not supply resolves to 0 here, and 0 == 0 would then PASS by
        // comparing the slot against a size derived from itself.
        const ok = row.sizeSectors > 0 && got === row.sizeSectors
        return verdict(
          'gpt-partition-size',
          ok,
          ok
            ? `p${row.number} (${row.label}) size is ${row.sizeSectors} sectors`
            : `p${row.number} (${row.label}) size is '${got ?? ''}' sectors, expected ${row.sizeSectors}`,
          { instance: String(row.number) },
        )
      })
    },
  },

  {
    id: 'gpt-partition-start',
    cardinality: 'many',
    instance: PER_PARTITION,
    shell: { pass: ') starts at sector' },
    run: async (ctx) => {
      const { gpt, walk } = await geometryOf(ctx)
      return walk.rows.map((row) => {
        const got = gpt.partition(row.number)?.firstSector
        const ok = row.startSector > 0 && got === row.startSector
        return verdict(
          'gpt-partition-start',
          ok,
          ok
            ? `p${row.number} (${row.label}) starts at sector ${row.startSector}`
            : `p${row.number} (${row.label}) starts at sector '${got ?? ''}', expected ${row.startSector}`,
          { instance: String(row.number) },
        )
      })
    },
  },

  {
    // v2 sets no GPT attribute bits anywhere: the ESP typecode alone makes a
    // boot slot bootable to U-Boot, and the slot choice comes from the RAUC
    // BOOT_ORDER environment, never from a GPT flag.
    id: 'gpt-partition-attrs',
    cardinality: 'many',
    instance: PER_PARTITION,
    shell: { pass: ') attribute flags are' },
    run: async (ctx) => {
      const { gpt, walk } = await geometryOf(ctx)
      return walk.rows.map((row) => {
        const got = gpt.partition(row.number)?.attributeFlags ?? ''
        const ok = /^0+$/.test(got)
        return verdict(
          'gpt-partition-attrs',
          ok,
          ok
            ? `p${row.number} (${row.label}) attribute flags are clear (${got})`
            : `p${row.number} (${row.label}) attribute flags are '${got}', expected all bits clear`,
          { instance: String(row.number) },
        )
      })
    },
  },

  {
    id: 'gpt-rootfs-slots-same-size',
    shell: {
      pass: 'rootfs-a and rootfs-b are the same size',
      fail: 'rootfs-a size is not a positive whole-MiB multiple',
    },
    run: async (ctx) => {
      const { slotMib } = await geometryOf(ctx)
      return [verdict(
        'gpt-rootfs-slots-same-size',
        slotMib > 0,
        slotMib > 0
          ? `rootfs-a and rootfs-b are the same size (${slotMib} MiB each)`
          : 'rootfs-a size is not a positive whole-MiB multiple, so the A/B slots cannot be compared',
      )]
    },
  },

  {
    id: 'gpt-rootfs-slot-floor',
    shell: { pass: 'rootfs slot ' },
    run: async (ctx) => {
      const { slotMib } = await geometryOf(ctx)
      const floor = intKey(ctx.board, 'MOS_ROOTFS_SLOT_MIB')
      const ok = slotMib >= floor
      return [verdict(
        'gpt-rootfs-slot-floor',
        ok,
        ok
          ? `rootfs slot ${slotMib} MiB is at or above the ${floor} MiB layout floor`
          : `rootfs slot ${slotMib} MiB is below the ${floor} MiB layout floor`,
      )]
    },
  },

  {
    // The size the walk arrives at, against the file on disk. `statSync`
    // follows the symlink, as the oracle's `stat -Lc %s` does -- the board
    // default path IS a symlink, and an lstat here would compare the length of
    // a link target string against a gigabyte.
    id: 'gpt-image-size',
    shell: { pass: 'image size is ' },
    run: async (ctx) => {
      const { walk, slotMib } = await geometryOf(ctx)
      const mibBytes = intKey(ctx.board, 'MIB_BYTES')
      const expected = walk.totalSizeMib * mibBytes
      const actual = statSync(ctx.image).size
      const ok = slotMib > 0 && actual === expected
      const terms = `the ${walk.rows.length} partitions ${walk.rows.map(r => r.name).join(' ')} `
        + `end at ${Math.floor(walk.endSector / walk.sectorsPerMib)} MiB, plus ${walk.tailSlackMib} MiB of tail slack`
      return [verdict(
        'gpt-image-size',
        ok,
        ok
          ? `image size is ${expected} bytes / ${walk.totalSizeMib} MiB (${terms})`
          : `image size is ${actual} bytes, expected ${expected} (${terms})`,
      )]
    },
  },

  {
    // DATA must be the LAST partition and must end exactly the tail slack short
    // of the end of the image. That pairing is what systemd-repart needs in
    // order to extend it to the end of the real medium on first boot.
    id: 'gpt-data-is-last',
    shell: {
      pass: 'data is the last partition',
      fail: 'data must be the last partition',
    },
    run: async (ctx) => {
      const { gpt, walk } = await geometryOf(ctx)
      const dataPartnum = intKey(ctx.board, 'DATA_PARTNUM')
      const wantLast = (walk.totalSizeMib - walk.tailSlackMib) * walk.sectorsPerMib - 1
      const gotLast = gpt.partition(dataPartnum)?.lastSector
      // Last by start, from the walk -- the same reading the oracle takes, and
      // not "the highest partition number": a table whose numbering and whose
      // order disagree is exactly the state this is here to catch.
      const lastRow = walk.rows.reduce((a, b) => (b.startSector > a.startSector ? b : a))
      const ok = lastRow.number === dataPartnum && gotLast === wantLast
      return [verdict(
        'gpt-data-is-last',
        ok,
        ok
          ? `data is the last partition (p${dataPartnum}) and ends at sector ${wantLast}, `
            + `leaving the ${walk.tailSlackMib} MiB repart tail`
          : `data must be the last partition and end at sector ${wantLast} (${walk.tailSlackMib} MiB `
            + `tail slack); it is p${lastRow.number} ending at '${gotLast ?? ''}'`,
      )]
    },
  },
]
