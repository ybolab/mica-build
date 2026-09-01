// The typed geometry, against BOTH shipped boards and against the files.
//
// ANYTHING THAT PASSES ON cx3576 ALONE IS HALF TESTED. M3a's parser passed
// cx3576 141 keys out of 141 while x64 was wholly unreadable, because x64
// spells nearly every start with `$(( ))` and cx3576 spells none of them that
// way. The two boards differ in almost every dimension this file models: 11
// partitions against 9, a U-Boot loader at a fixed sector against no loader at
// all, GPT_ALIGN_SECTORS=1 against 2048, three lists declared EMPTY ON PURPOSE
// on x64 and populated on cx3576. So every structural assertion below runs over
// both, and the board-specific ones are spelled out per board with the value
// copied out of the file.

import { describe, expect, test } from 'bun:test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry, loadGeometryFromPath, modelGeometry, type Geometry } from './geometry.ts'
import { boardEnvPath, makeWorkDir, requireShippedBoards } from './paths.ts'
import { loadBoard } from './verify-package.ts'

const BOARDS = requireShippedBoards()

/**
 * A copy of a real board definition with lines appended.
 *
 * Appended rather than substituted: M3c recorded a negative fixture built with
 * `sed` that changed nothing, because the key it targeted appears in x64 only
 * inside a COMMENT -- so "rejected on both routes" was a claim about an
 * unmutated file. A later assignment wins over an earlier one exactly as it
 * would in a shell reading top to bottom, so appending always bites.
 */
function mutatedBoard(board: string, appended: string): { path: string, cleanup: () => void } {
  const dir = makeWorkDir(`geometry-${board}`)
  const path = join(dir, 'board.env')
  writeFileSync(path, `${readFileSync(boardEnvPath(board), 'utf8')}\n${appended}\n`)
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('the discovery this file iterates is not empty', () => {
  test('both shipped boards are in scope', () => {
    // Every `for (const b of BOARDS)` below is green over an empty list. This
    // is the assertion that makes the rest of the file evidence.
    expect(BOARDS).toEqual(['cx3576', 'x64'])
  })

  test('the mutation helper actually changes the file it copies', () => {
    // Same lesson, one level down: a fixture that is a byte-for-byte copy of a
    // real board would pass every negative test below by not being negative.
    const m = mutatedBoard('x64', 'ESP_START_SECTOR=4096')
    try {
      expect(readFileSync(m.path, 'utf8')).not.toBe(readFileSync(boardEnvPath('x64'), 'utf8'))
      expect(loadGeometryFromPath(m.path).board.get('ESP_START_SECTOR')).toBe('4096')
      expect(loadGeometry('x64').board.get('ESP_START_SECTOR')).toBe('2048')
    } finally { m.cleanup() }
  })
})

describe('both boards model without a fault', () => {
  for (const board of BOARDS) {
    test(`${board}: no geometry faults and no model faults`, () => {
      const g = loadGeometry(board)
      expect(`${board} geometry faults: ${JSON.stringify(g.faults)}`).toBe(`${board} geometry faults: []`)
      expect(`${board} model faults: ${JSON.stringify(g.board.faults)}`).toBe(`${board} model faults: []`)
    })

    test(`${board}: every partition in LAYOUT_PARTITIONS is placed, in order, with its number`, () => {
      const g = loadGeometry(board)
      const listed = g.board.layoutPartitions
      expect(listed).toBeDefined()
      expect(g.partitions.map(p => p.name)).toEqual([...listed!])
      expect(g.partitions.map(p => p.position)).toEqual(listed!.map((_, i) => i + 1))
      // A partition with no number cannot be written to a GPT at all.
      expect(g.partitions.filter(p => p.partnum === undefined).map(p => p.name)).toEqual([])
      expect(g.partitions.map(p => Number(p.partnum))).toEqual(listed!.map((_, i) => i + 1))
    })

    test(`${board}: a MiB is a whole number of sectors, and the conversions round-trip`, () => {
      const g = loadGeometry(board)
      expect(g.mibBytes % g.sectorSize).toBe(0n)
      expect(g.sectorsPerMib).toBe(g.mibBytes / g.sectorSize)
      expect(g.mibToBytes(7n)).toBe(7n * g.mibBytes)
      expect(g.mibToSectors(7n)).toBe(7n * g.sectorsPerMib)
      expect(g.sectorsToBytes(g.mibToSectors(7n))).toBe(g.mibToBytes(7n))
      expect(g.bytesToSectors(g.mibToBytes(7n))).toBe(g.mibToSectors(7n))
    })

    test(`${board}: every declared start and size agrees in all three units`, () => {
      const g = loadGeometry(board)
      let placed = 0
      for (const p of g.partitions) {
        for (const place of [p.start, p.size]) {
          if (place === undefined) continue
          placed += 1
          expect(`${p.name}: ${place.bytes % g.sectorSize}`).toBe(`${p.name}: 0`)
          expect(`${p.name}: ${place.sectors}`).toBe(`${p.name}: ${place.bytes / g.sectorSize}`)
          if (place.mib !== undefined) {
            expect(`${p.name}: ${place.mib * g.mibBytes}`).toBe(`${p.name}: ${place.bytes}`)
          }
        }
      }
      // Not "no disagreements found": a loop over nothing finds none either.
      expect(placed).toBeGreaterThan(8)
    })

    test(`${board}: the placement agrees with what the FILE says, key for key`, () => {
      // The strongest form available without sourcing the file: every start
      // and size key the definition actually declares is compared against the
      // number this model derived. HARNESS.md carries the bash-oracle version,
      // which compares against a shell that really did source it.
      const g = loadGeometry(board)
      let compared = 0
      for (const p of g.partitions) {
        const cases: [string, bigint | undefined][] = [
          [`${p.name}_START_SECTOR`, p.start?.sectors],
          [`${p.name}_OFFSET_BYTES`, p.start?.bytes],
          [`${p.name}_START_MIB`, p.start?.mib],
          [`${p.name}_SIZE_SECTORS`, p.size?.sectors],
          [`${p.name}_SIZE_MIB`, p.size?.mib],
        ]
        for (const [key, got] of cases) {
          const declared = g.board.get(key)
          if (declared === undefined) continue
          compared += 1
          expect(`${key}=${got}`).toBe(`${key}=${BigInt(declared.trim())}`)
        }
      }
      expect(compared).toBeGreaterThan(10)
    })
  }
})

describe('cx3576: the U-Boot board, values copied from os/boards/cx3576/board.env', () => {
  const g = (): Geometry => loadGeometry('cx3576')

  test('eleven partitions, arm64, uboot, sector 512, MiB 1048576', () => {
    expect(g().partitions.length).toBe(11)
    expect(g().arch).toBe('arm64')
    expect(g().bootloader).toBe('uboot')
    expect(g().sectorSize).toBe(512n)
    expect(g().mibBytes).toBe(1048576n)
    expect(g().sectorsPerMib).toBe(2048n)
  })

  test('the loader is at a fixed SECTOR and declares no MiB at all', () => {
    // LOADER_START_SECTOR=64, LOADER_SIZE_SECTORS=32704 -- and 64 is NOT
    // 2048-aligned, which is the whole reason GPT_ALIGN_SECTORS=1 exists.
    const loader = g().requirePartition('LOADER')
    expect(loader.role).toBe('raw-blob')
    expect(loader.partnum).toBe(1n)
    expect(loader.start?.from).toBe('LOADER_START_SECTOR')
    expect(loader.start?.sectors).toBe(64n)
    expect(loader.start?.bytes).toBe(32768n)
    expect(loader.start?.mib).toBeUndefined()
    expect(loader.size?.sectors).toBe(32704n)
    expect(loader.declared('START_MIB')).toBe(false)
    expect(g().disk.alignSectors).toBe(1n)
  })

  test('BOOT_A spells its start three ways and they are the same place', () => {
    const boot = g().requirePartition('BOOT_A')
    expect(boot.start?.mib).toBe(18n)
    expect(boot.start?.sectors).toBe(36864n)
    expect(boot.start?.bytes).toBe(18874368n)
    expect(boot.fatLabel).toBe('BOOT-A')
    expect(boot.fatVolumeId).toBe('C3576003')
    expect(boot.size?.mib).toBe(64n)
  })

  test('a size given by a ${reference} resolves against the same file', () => {
    // EPHEMERAL_SIZE_MIB="${MOS_VAR_MIB}" and MOS_VAR_MIB=512.
    expect(g().requirePartition('EPHEMERAL').size?.mib).toBe(512n)
    expect(g().require('MOS_VAR_MIB')).toBe('512')
  })

  test('the two uboot-env partitions are the redundant pair, sized in sectors', () => {
    const uenv = g().partitionsWithRole('uboot-env')
    expect(uenv.map(p => p.name)).toEqual(['UENV_A', 'UENV_B'])
    // UENV_A_SIZE_SECTORS="${UENV_SIZE_SECTORS}" and UENV_SIZE_SECTORS=128.
    expect(uenv.map(p => p.size?.sectors)).toEqual([128n, 128n])
    expect(uenv.map(p => p.start?.mib)).toEqual([16n, 17n])
  })

  test('the pinned settings an assembler needs', () => {
    expect(g().slot).toEqual({ slotMib: 256n, headroomPct: 125n, alignMib: 16n })
    expect(g().ext4.blockSize).toBe(4096n)
    expect(g().ext4.features).toBe('^orphan_file,^metadata_csum_seed')
    expect(g().ext4.fileMtime).toBe('@1577836800')
    expect(g().ext4.sourceDateEpoch).toBe('1577836800')
    expect(g().ext4.fakeTime).toBe('1577836800')
    expect(g().disk.headMib).toBe(16n)
    expect(g().disk.tailSlackMib).toBe(1n)
    expect(g().naming.latestName).toBe('cx3576-mos-latest.img')
  })
})

describe('x64: the GRUB board, values copied from os/boards/x64/board.env', () => {
  const g = (): Geometry => loadGeometry('x64')

  test('nine partitions, amd64, grub, and NO loader partition', () => {
    expect(g().partitions.length).toBe(9)
    expect(g().arch).toBe('amd64')
    expect(g().bootloader).toBe('grub')
    expect(g().partitionsWithRole('raw-blob')).toEqual([])
    expect(g().partition('LOADER')).toBeUndefined()
    expect(g().partitionsWithRole('uboot-env')).toEqual([])
  })

  test('every start is computed by $(( )) in the file, and lands where the arithmetic says', () => {
    // ESP_START_SECTOR=$((ESP_START_MIB * MIB_BYTES / SECTOR_SIZE)). This is
    // the shape that made x64 wholly unreadable to M3a's first parser, so it
    // is asserted with the numbers rather than with a round-trip.
    const esp = g().requirePartition('ESP')
    expect(esp.start?.mib).toBe(1n)
    expect(esp.start?.sectors).toBe(2048n)
    expect(esp.start?.bytes).toBe(1048576n)
    expect(esp.size?.mib).toBe(64n)
    const bootB = g().requirePartition('BOOT_B')
    expect(bootB.start?.mib).toBe(161n)
    expect(bootB.start?.sectors).toBe(329728n)
    expect(bootB.start?.bytes).toBe(168820736n)
  })

  test('GPT_ALIGN_SECTORS is 2048 here and 1 on cx3576 -- not a default either way', () => {
    expect(g().disk.alignSectors).toBe(2048n)
    expect(loadGeometry('cx3576').disk.alignSectors).toBe(1n)
  })

  test('the three lists x64 declares EMPTY are still statements, not absences', () => {
    // A QEMU machine has no radio firmware and no MAC to burn, and the
    // emptiness is the statement. Under the `${X:-}` idiom every shell consumer
    // uses, these are indistinguishable from a board that forgot them.
    const b = g().board
    expect(b.firmwareFiles).toEqual([])
    expect(b.hwinitConfs).toEqual([])
    expect(b.radios).toEqual([])
    expect(b.declared('BOARD_FIRMWARE_FILES')).toBe(true)
    expect(b.declared('BOARD_HWINIT_CONFS')).toBe(true)
    expect(b.declared('BOARD_RADIOS')).toBe(true)
    // ...and a key that really is absent reads as absent.
    expect(b.declared('LOADER_MAGIC_HEX')).toBe(false)
    expect(g().partition('LOADER')).toBeUndefined()
  })

  test('the pinned settings differ from cx3576 where the boards differ', () => {
    expect(g().slot).toEqual({ slotMib: 512n, headroomPct: 125n, alignMib: 16n })
    expect(g().disk.headMib).toBe(1n)
    expect(g().naming.latestName).toBe('x64-mos-latest.img')
    // Identical where they are meant to be identical: the reproducibility pins.
    expect(g().ext4).toEqual(loadGeometry('cx3576').ext4)
    expect(g().veritySalt).toBe(loadGeometry('cx3576').veritySalt)
  })
})

describe('a required key that is missing is a build failure naming the key and the file', () => {
  test('require names both', () => {
    const g = loadGeometry('x64')
    expect(() => g.require('NO_SUCH_KEY')).toThrow(/NO_SUCH_KEY/)
    expect(() => g.require('NO_SUCH_KEY')).toThrow(boardEnvPath('x64'))
  })

  test('requireInt refuses a value that is not an integer, and says what it read', () => {
    const g = loadGeometry('x64')
    // A real key whose value is not a number: MOS_ARCH=amd64.
    expect(() => g.requireInt('MOS_ARCH')).toThrow(/MOS_ARCH="amd64"/)
    expect(() => g.requireInt('MOS_ARCH')).toThrow(/is not one/)
  })

  test('requirePartition names the partition and lists what there is', () => {
    const g = loadGeometry('x64')
    expect(() => g.requirePartition('LOADER')).toThrow(/has no partition called LOADER/)
    expect(() => g.requirePartition('LOADER')).toThrow(/ESP BOOT_A BOOT_B/)
  })

  test("a partition's own require names the partition's key", () => {
    const g = loadGeometry('x64')
    const esp = g.requirePartition('ESP')
    expect(esp.requireInt('START_MIB')).toBe(1n)
    expect(() => esp.require('MAGIC_HEX')).toThrow(/ESP_MAGIC_HEX/)
  })

  test('a board with no SECTOR_SIZE cannot be modelled at all, and says so', () => {
    const dir = makeWorkDir('no-sector-size')
    try {
      const p = join(dir, 'board.env')
      writeFileSync(p, 'LAYOUT_BOARD=nosec\nMIB_BYTES=1048576\nLAYOUT_PARTITIONS="A"\nA_PARTNUM=1\n')
      expect(() => loadGeometryFromPath(p)).toThrow(/declares no SECTOR_SIZE/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('contradictions are refused rather than resolved', () => {
  test('a start spelled two ways that disagree becomes a fault, and both numbers are named', () => {
    const m = mutatedBoard('x64', 'ESP_START_SECTOR=4096')
    try {
      const g = loadGeometryFromPath(m.path)
      const fault = g.faults.find(f => f.key === 'ESP_START_SECTOR')
      expect(fault).toBeDefined()
      expect(fault!.partition).toBe('ESP')
      expect(fault!.reason).toContain('2097152')
      expect(fault!.reason).toContain('1048576')
      // The first-declared unit still answers, so a caller that ignores faults
      // gets the FILE's own first word rather than a silently blended number.
      expect(g.requirePartition('ESP').start?.from).toBe('ESP_START_MIB')
    } finally { m.cleanup() }
  })

  test('the same mutation on cx3576, whose starts are written by hand rather than computed', () => {
    const m = mutatedBoard('cx3576', 'BOOT_A_OFFSET_BYTES=999')
    try {
      const g = loadGeometryFromPath(m.path)
      expect(g.faults.map(f => f.key)).toContain('BOOT_A_OFFSET_BYTES')
    } finally { m.cleanup() }
  })

  test('the positive control: the unmutated boards produce no fault at all', () => {
    for (const b of BOARDS) expect(`${b}: ${loadGeometry(b).faults.length}`).toBe(`${b}: 0`)
  })

  test('a MiB that is not a whole number of sectors is refused, not rounded', () => {
    const m = mutatedBoard('x64', 'SECTOR_SIZE=3')
    try {
      expect(() => loadGeometryFromPath(m.path)).toThrow(/not a whole number of SECTOR_SIZE=3 sectors/)
    } finally { m.cleanup() }
  })

  test('bytesToSectors refuses a byte count that is not a whole number of sectors', () => {
    const g = loadGeometry('x64')
    expect(g.bytesToSectors(1024n)).toBe(2n)
    expect(() => g.bytesToSectors(513n)).toThrow(/not a thing a disk has/)
  })

  test('a non-integer where a number belongs is a fault, collected and not thrown', () => {
    const m = mutatedBoard('x64', 'ESP_PARTNUM=one\nBOOT_A_SIZE_MIB=ninety-six')
    try {
      const g = loadGeometryFromPath(m.path)
      // BOTH, not just the first: a board with two bad integers should produce
      // two lines. That is board.ts's discipline and this layer keeps it.
      expect(g.faults.map(f => f.key).sort()).toEqual(['BOOT_A_SIZE_MIB', 'ESP_PARTNUM'])
      expect(g.requirePartition('ESP').partnum).toBeUndefined()
    } finally { m.cleanup() }
  })
})

describe('byte offsets are read at the width they were written', () => {
  test('a size past 2^53 survives this layer exactly', () => {
    // board-env.ts evaluates `$(( ))` in BigInt for this reason: "these are
    // byte offsets; past 2^53 a double stops being exact, and a size that is
    // silently one byte out is the class of defect this package exists to make
    // visible." This layer re-reads the string rather than taking board.ts's
    // `number`, so the width survives the whole way through.
    // ROOTFS_A, because it is the one partition that declares no size on
    // either board -- appending a size to a partition that already has one
    // would be a CONTRADICTION and would be reported as such, which is a
    // different test (above) and would not exercise the width at all.
    const m = mutatedBoard('x64', 'ROOTFS_A_SIZE_SECTORS=9007199254740993')
    try {
      const g = loadGeometryFromPath(m.path)
      const size = g.requirePartition('ROOTFS_A').size
      expect(size?.from).toBe('ROOTFS_A_SIZE_SECTORS')
      expect(size?.sectors).toBe(9007199254740993n)
      expect(String(size?.sectors)).toBe('9007199254740993')
      expect(size?.bytes).toBe(9007199254740993n * 512n)
    } finally { m.cleanup() }
  })

  test('and the same value read as a double would NOT be exact -- which is why', () => {
    // The positive control for the claim above, stated as arithmetic rather
    // than as a comment. Number('9007199254740993') is 9007199254740992.
    expect(Number('9007199254740993')).toBe(9007199254740992)
    expect(BigInt('9007199254740993') === 9007199254740993n).toBe(true)
  })
})

describe('modelGeometry works over a board handed in, not only over a path', () => {
  test('the same answer either way', () => {
    const viaPath = loadGeometry('cx3576')
    const viaModel = modelGeometry(loadBoard(boardEnvPath('cx3576')))
    expect(viaModel.name).toBe(viaPath.name)
    expect(viaModel.partitions.map(p => p.name)).toEqual(viaPath.partitions.map(p => p.name))
    expect(viaModel.partitions.map(p => p.start?.sectors)).toEqual(viaPath.partitions.map(p => p.start?.sectors))
  })
})
