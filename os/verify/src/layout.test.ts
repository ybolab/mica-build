// The board-definition walk, against both shipped boards and against
// definitions edited to break each rule it enforces.
//
// PLAN-014 M4b (RFCT-110). The walk produces one half of every GPT geometry
// check; the numbers below are asserted against the two REAL board
// definitions, so a layout change that silently moves a partition fails here
// before it reaches a parity run.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBoard } from './board.ts'
import { walkLayout } from './layout.ts'
import { boardEnvPath } from './paths.ts'

/**
 * Write a mutated copy of a real board definition and hand it to `fn`.
 *
 * Called `candidate.env` rather than `board.env` for the reason
 * src/board.test.ts gives: a message about the copy should say "candidate", not
 * name a real board it is not.
 */
function withMutatedBoard<T>(board: string, edit: (text: string) => string, fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'mos-layout-'))
  try {
    const p = join(dir, 'candidate.env')
    writeFileSync(p, edit(readFileSync(boardEnvPath(board), 'utf8')))
    return fn(p)
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))

// The real slot sizes, as `sgdisk -p` reads them off the two shipped images.
// Passed in rather than fetched, which is the whole point of the parameter.
const CX_SLOT_SECTORS = 524288
const X64_SLOT_SECTORS = 1048576

describe('cx3576 — the eleven-partition U-Boot layout', () => {
  const walk = walkLayout(cx3576, CX_SLOT_SECTORS)

  test('walks every partition the definition declares, in order', () => {
    expect(walk.rows.map(r => r.name)).toEqual([
      'LOADER', 'UENV_A', 'UENV_B', 'BOOT_A', 'BOOT_B',
      'ROOTFS_A', 'ROOTFS_B', 'META', 'STATE', 'EPHEMERAL', 'DATA',
    ])
    expect(walk.rows.map(r => r.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(walk.sectorsPerMib).toBe(2048)
  })

  test('a fixed start is taken, and everything after it follows the cursor', () => {
    // LOADER..ROOTFS_A declare starts; ROOTFS_B onwards are packed.
    expect(walk.row('LOADER')?.startSector).toBe(64)
    expect(walk.row('ROOTFS_A')?.startSector).toBe(299008)
    // Not declared anywhere: rootfs-a's start plus its image-derived size.
    expect(walk.row('ROOTFS_B')?.startSector).toBe(299008 + CX_SLOT_SECTORS)
    expect(walk.row('META')?.startSector).toBe(299008 + 2 * CX_SLOT_SECTORS)
  })

  test('a verity slot takes the size read out of the IMAGE, not a declared one', () => {
    expect(walk.row('ROOTFS_A')?.sizeSectors).toBe(CX_SLOT_SECTORS)
    expect(walk.row('ROOTFS_B')?.sizeSectors).toBe(CX_SLOT_SECTORS)
    // Hand it a different image and every row after the slots moves. That is
    // the property that makes this a walk rather than a table.
    const other = walkLayout(cx3576, CX_SLOT_SECTORS * 2)
    expect(other.row('META')?.startSector).toBe(299008 + 4 * CX_SLOT_SECTORS)
  })

  test('_SIZE_SECTORS wins over _SIZE_MIB, and _SIZE_MIB is converted', () => {
    expect(walk.row('LOADER')?.sizeSectors).toBe(32704)
    expect(walk.row('UENV_A')?.sizeSectors).toBe(128)
    expect(walk.row('BOOT_A')?.sizeSectors).toBe(64 * 2048)
  })

  test('the total is the walk plus the declared tail slack', () => {
    expect(walk.tailSlackMib).toBe(1)
    expect(walk.endSector).toBe(2691072)
    expect(walk.totalSizeMib).toBe(1315)
  })

  test('label, typecode and GUID come from the definition', () => {
    expect(walk.row('DATA')?.label).toBe('data')
    expect(walk.row('LOADER')?.typecode).toBe('8DA63339-0007-60C0-C436-083AC8230908')
    expect(walk.row('ROOTFS_A')?.guid).toBe('5AC35760-0002-4000-8000-000000000005')
  })
})

describe('x64 — the nine-partition GRUB layout, same walk', () => {
  const walk = walkLayout(x64, X64_SLOT_SECTORS)

  test('nine rows, no loader, ESP first', () => {
    expect(walk.rows.map(r => r.name)).toEqual([
      'ESP', 'BOOT_A', 'BOOT_B', 'ROOTFS_A', 'ROOTFS_B', 'META', 'STATE', 'EPHEMERAL', 'DATA',
    ])
    expect(walk.row('ESP')?.startSector).toBe(2048)
  })

  test('the same arithmetic reaches this board\'s own numbers', () => {
    expect(walk.row('ROOTFS_A')?.startSector).toBe(257 * 2048)
    expect(walk.row('DATA')?.startSector).toBe(3835904)
    expect(walk.totalSizeMib).toBe(1938)
  })
})

describe('driven from the failing side', () => {
  test('a partition with no size at all is refused BY NAME', () => {
    withMutatedBoard('cx3576', t => t.replace(/^META_SIZE_MIB=.*$/m, 'META_SIZE_MIB='), (p) => {
      expect(() => walkLayout(loadBoard(p), CX_SLOT_SECTORS))
        .toThrow(/gives META no size/)
    })
  })

  test('a size that is not a number is refused rather than falling through to the next key', () => {
    // The failure this exists for: read as "absent", `BOOT_A_SIZE_MIB=sixty`
    // would leave BOOT_A with no size and the walk would take the verity-slot
    // branch or die three rows later, blaming the wrong partition.
    withMutatedBoard('cx3576', t => t.replace(/^BOOT_A_SIZE_MIB=.*$/m, 'BOOT_A_SIZE_MIB=sixty'), (p) => {
      expect(() => walkLayout(loadBoard(p), CX_SLOT_SECTORS))
        .toThrow(/BOOT_A_SIZE_MIB='sixty'/)
    })
  })

  test('a start that is not a number is refused the same way', () => {
    withMutatedBoard('cx3576', t => t.replace(/^LOADER_START_SECTOR=.*$/m, 'LOADER_START_SECTOR=0x40'), (p) => {
      expect(() => walkLayout(loadBoard(p), CX_SLOT_SECTORS))
        .toThrow(/LOADER_START_SECTOR='0x40'/)
    })
  })

  test('an empty LAYOUT_PARTITIONS is refused, not walked as zero rows', () => {
    withMutatedBoard('cx3576', t => t.replace(/^LAYOUT_PARTITIONS=.*$/m, 'LAYOUT_PARTITIONS=""'), (p) => {
      expect(() => walkLayout(loadBoard(p), CX_SLOT_SECTORS))
        .toThrow(/declares no LAYOUT_PARTITIONS/)
    })
  })

  test('a partition listed but not declared is refused at the first key it needs', () => {
    // `modelBoard` builds a row for every name in LAYOUT_PARTITIONS whether or
    // not the file declares anything for it, so a listed-but-absent partition
    // arrives here as a row of undefineds rather than as a missing row. It is
    // refused either way; the message names the key, which is what sends a
    // reader to the line they have to add.
    withMutatedBoard(
      'cx3576',
      t => t.replace(/^LAYOUT_PARTITIONS=.*$/m, 'LAYOUT_PARTITIONS="LOADER GHOST"'),
      (p) => {
        expect(() => walkLayout(loadBoard(p), CX_SLOT_SECTORS))
          .toThrow(/declares no GHOST_PARTNUM/)
      },
    )
  })

  test('a Board that reports a listed partition as absent is refused BY NAME', () => {
    // The branch above cannot take through `loadBoard`, and a guard nobody has
    // ever seen take is the shape this tree keeps finding broken. `partition()`
    // is an interface method whose contract allows undefined, so it is driven
    // here rather than left to be reasoned about.
    const hollow = { ...cx3576, partition: () => undefined } as unknown as typeof cx3576
    expect(() => walkLayout(hollow, CX_SLOT_SECTORS))
      .toThrow(/lists LOADER in LAYOUT_PARTITIONS and declares nothing for it/)
  })

  test('a missing IMAGE_TAIL_SLACK_MIB is refused rather than read as zero', () => {
    withMutatedBoard('cx3576', t => t.replace(/^IMAGE_TAIL_SLACK_MIB=.*$/m, '# gone'), (p) => {
      expect(() => walkLayout(loadBoard(p), CX_SLOT_SECTORS))
        .toThrow(/declares no IMAGE_TAIL_SLACK_MIB/)
    })
  })

  test('a missing PARTNUM is refused', () => {
    withMutatedBoard('cx3576', t => t.replace(/^META_PARTNUM=.*$/m, '# gone'), (p) => {
      expect(() => walkLayout(loadBoard(p), CX_SLOT_SECTORS))
        .toThrow(/declares no META_PARTNUM/)
    })
  })
})
