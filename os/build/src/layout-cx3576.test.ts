// The derived layout: the slot sizing and the start chain, driven at the sizes
// an off-by-one lives at.
//
// EVERY TEST HERE IS PURE, and that is the argument for the module being pure.
// The arithmetic below decides where DATA starts; getting it wrong by one MiB
// produces an image that assembles, verifies, boots, and cannot take an update
// on a device flashed with the other number. Reached only through an assembly it
// would be a bug found by diffing 1.3 GiB; reached here it is driven in
// milliseconds at a payload one MiB under a pin, one MiB over it, and exactly on
// the alignment boundary -- sizes no real rootfs has had yet.

import { describe, expect, test } from 'bun:test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry, loadGeometryFromPath } from './geometry.ts'
import {
  decideSlot,
  deriveLayout,
  gptSpecFor,
  loaderIdentityFaults,
  parseSlotPin,
  slotPinFromEnv,
} from './layout-cx3576.ts'
import { boardEnvPath, makeWorkDir } from './paths.ts'
import { writeGptArgs } from './tools/sgdisk.ts'

const g = loadGeometry('cx3576')
const IMG = '/nowhere/rootfs-verity.img'

/** A board.env with lines appended; a later assignment wins, as in a shell. */
function mutated(appended: string): { path: string, cleanup: () => void } {
  const dir = makeWorkDir('layout-cx3576')
  const path = join(dir, 'board.env')
  writeFileSync(path, `${readFileSync(boardEnvPath('cx3576'), 'utf8')}\n${appended}\n`)
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('the board this file is about reads the way the file says', () => {
  test('the constants every assertion below is written against', () => {
    // Copied out of os/boards/cx3576/board.env. If one of these moves, the
    // expected numbers below are stale and should be recomputed rather than the
    // test being relaxed to whatever it now produces.
    expect({
      floor: g.slot.slotMib,
      headroom: g.slot.headroomPct,
      align: g.slot.alignMib,
      rootfsAStart: g.requirePartition('ROOTFS_A').start?.mib,
      meta: g.requireInt('META_SIZE_MIB'),
      state: g.requireInt('STATE_SIZE_MIB'),
      varMib: g.requireInt('MOS_VAR_MIB'),
      data: g.requireInt('DATA_SIZE_MIB'),
      tail: g.disk.tailSlackMib,
    }).toEqual({
      floor: 256n, headroom: 125n, align: 16n, rootfsAStart: 146n,
      meta: 16n, state: 64n, varMib: 512n, data: 64n, tail: 1n,
    })
  })
})

describe('the mode is chosen by PRESENCE, never by value', () => {
  test('a pin equal to the built-in default still selects the frozen mode', () => {
    // os/mkimage-v2.sh (deleted: PLAN-014) captures `${MOS_ROOTFS_SLOT_MIB+set}` before sourcing the
    // layout precisely so this holds. A port that compared the value against the
    // board's default would agree on every number and disagree about the MODE --
    // and the mode is what decides whether an oversized rootfs is a failure or a
    // silently bigger image no flashed device can take an update for.
    const pinned = decideSlot(g, 10n, '256', IMG)
    const floored = decideSlot(g, 10n, undefined, IMG)
    expect(pinned.slotMib).toBe(floored.slotMib)
    expect(pinned.mode).toBe('pinned')
    expect(floored.mode).toBe('floor')
  })

  test('an EMPTY pin is supplied, and is refused rather than falling back', () => {
    // `MOS_ROOTFS_SLOT_MIB=` is a release build whose pin got lost, not a dev
    // build. Reading it as "unset" would quietly produce a floor-mode image on
    // the release path.
    expect(slotPinFromEnv({ MOS_ROOTFS_SLOT_MIB: '' })).toBe('')
    expect(() => decideSlot(g, 10n, '', IMG)).toThrow(/is not a positive whole number of MiB/)
    expect(slotPinFromEnv({})).toBeUndefined()
  })

  for (const bad of ['0', '-16', '256.5', '256M', ' 256', 'abc', '+256', '0256']) {
    test(`the pin ${JSON.stringify(bad)} is refused`, () => {
      expect(() => parseSlotPin(bad)).toThrow(/is not a positive whole number of MiB/)
    })
  }
  test('and a plain positive integer is not', () => {
    // The positive control: a regex that rejected everything would satisfy the
    // eight cases above by rejecting the good one too.
    expect(parseSlotPin('256')).toBe(256n)
    expect(parseSlotPin('1')).toBe(1n)
  })
})

describe('pinned: the geometry is frozen and an oversized rootfs is a failure', () => {
  test('a payload one MiB over the pin is refused, by how much', () => {
    expect(() => decideSlot(g, 257n, '256', IMG))
      .toThrow(/pinned at MOS_ROOTFS_SLOT_MIB=256 MiB but .* is 257 MiB -- 1 MiB too large/)
  })

  test('the refusal says the slot cannot be grown, and why', () => {
    try {
      decideSlot(g, 300n, '256', IMG)
      throw new Error('unreachable')
    } catch (e) {
      expect(String(e)).toContain('frozen for every device already flashed')
      expect(String(e)).toContain('shrink the rootfs instead')
    }
  })

  test('a payload exactly at the pin fits, and the slot is the pin', () => {
    const d = decideSlot(g, 256n, '256', IMG)
    expect(d.slotMib).toBe(256n)
    expect(d.summary).toContain('(pinned, frozen geometry)')
  })

  test('a pin much larger than the payload does NOT shrink to fit', () => {
    // Frozen means frozen in both directions: the fleet was partitioned at the
    // pin, so a small rootfs still gets the pinned slot.
    expect(decideSlot(g, 10n, '1024', IMG).slotMib).toBe(1024n)
  })
})

describe('floor: the default is a floor and the slot grows with the content', () => {
  const cases: [bigint, bigint, string][] = [
    [94n, 256n, 'the real payload: 118 after headroom, 128 aligned, under the 256 floor'],
    [10n, 256n, 'far under the floor'],
    [204n, 256n, '255 after headroom, 256 aligned -- exactly the floor, from below'],
    [205n, 272n, 'one MiB more: 257 after headroom, 272 aligned -- the first size over the floor'],
    [206n, 272n, 'still 272; the alignment is what quantises it'],
    [400n, 512n, '500 after headroom, 512 aligned'],
    [408n, 512n, '510 after headroom, 512 aligned'],
    [409n, 512n, '512 after headroom EXACTLY, and 512 is already 16-aligned'],
    [410n, 528n, '513 after headroom, 528 aligned -- the +99 ceiling is what makes this 528'],
  ]
  for (const [payload, expected, why] of cases) {
    test(`${payload} MiB -> ${expected} MiB (${why})`, () => {
      expect(decideSlot(g, payload, undefined, IMG).slotMib).toBe(expected)
    })
  }

  test('the +99 is a CEILING, and dropping it changes the answer', () => {
    // `(payload * 125 + 99) / 100` in integer arithmetic. The floor is visible
    // only with the 256 MiB floor out of the way, so this removes it -- and
    // asserts a payload where ceil and floor genuinely disagree AFTER alignment,
    // because most of them do not and a case where they agree proves nothing.
    //
    // Measured against the shell itself (os/build/HARNESS.md carries the
    // recipe): 205 MiB is the discriminating size at the shipped floor -- ceil
    // gives 257 -> 272, floor gives 256 -> 256.
    const m = mutated('MOS_ROOTFS_SLOT_MIB=1')
    try {
      const small = loadGeometryFromPath(m.path)
      // 13 * 125 = 1625; ceil -> 17 -> aligned 32. floor -> 16 -> aligned 16.
      expect(decideSlot(small, 13n, undefined, IMG).slotMib).toBe(32n)
      // 12 * 125 = 1500 exactly: ceil and floor agree at 15 -> aligned 16.
      expect(decideSlot(small, 12n, undefined, IMG).slotMib).toBe(16n)
      // 80 * 125 = 10000 -> 100 exactly -> aligned 112, because 100 is not
      // 16-aligned. The alignment step is what moves this one, not the ceiling.
      expect(decideSlot(small, 80n, undefined, IMG).slotMib).toBe(112n)
    } finally { m.cleanup() }
    // And at the shipped floor, where it decides a real image's size.
    expect(decideSlot(g, 205n, undefined, IMG).slotMib).toBe(272n)
  })

  test('the summary names the floor, the headroom and the alignment', () => {
    expect(decideSlot(g, 94n, undefined, IMG).summary)
      .toContain('(floor 256, 125% headroom, 16 MiB aligned)')
  })
})

describe('the start chain, and the image length that follows', () => {
  test('the real build: slot 256 MiB', () => {
    expect(deriveLayout(g, 256n)).toEqual({
      slotMib: 256n,
      rootfsBStartMib: 402n,     // 146 + 256
      metaStartMib: 658n,        // 402 + 256
      stateStartMib: 674n,       // 658 + 16
      ephemeralStartMib: 738n,   // 674 + 64
      dataStartMib: 1250n,       // 738 + 512
      totalSizeMib: 1315n,       // 1250 + 64 + 1
    })
  })

  test('every start is the previous start plus the previous size', () => {
    // Written as the identity rather than as numbers, so a slot size nobody has
    // used yet is covered too.
    for (const slotMib of [16n, 256n, 512n, 4096n]) {
      const l = deriveLayout(g, slotMib)
      expect(l.rootfsBStartMib - 146n).toBe(slotMib)
      expect(l.metaStartMib - l.rootfsBStartMib).toBe(slotMib)
      expect(l.stateStartMib - l.metaStartMib).toBe(g.requireInt('META_SIZE_MIB'))
      expect(l.ephemeralStartMib - l.stateStartMib).toBe(g.requireInt('STATE_SIZE_MIB'))
      expect(l.dataStartMib - l.ephemeralStartMib).toBe(g.requireInt('MOS_VAR_MIB'))
      expect(l.totalSizeMib - l.dataStartMib)
        .toBe(g.requireInt('DATA_SIZE_MIB') + g.disk.tailSlackMib)
    }
  })

  test('DATA is last, and the tail slack is behind it', () => {
    // The backup GPT lives in that slack, and systemd-repart extends DATA to the
    // end of the disk on first boot -- which it can only do if nothing follows.
    const l = deriveLayout(g, 256n)
    const last = g.partitions[g.partitions.length - 1]
    expect(last?.name).toBe('DATA')
    expect(l.totalSizeMib - (l.dataStartMib + g.requireInt('DATA_SIZE_MIB'))).toBe(1n)
  })

  test('a zero or negative slot is not a slot', () => {
    expect(() => deriveLayout(g, 0n)).toThrow(/is not a slot/)
    expect(() => deriveLayout(g, -16n)).toThrow(/is not a slot/)
  })

  test('the chain is in BigInt end to end', () => {
    // A slot size past 2^53 survives exactly. board.ts reads its integers with
    // Number() and would not; geometry.ts re-reads the string for this reason,
    // and the arithmetic here has to keep the width it was given.
    const huge = 9007199254740993n
    expect(deriveLayout(g, huge).metaStartMib).toBe(146n + huge + huge)
  })
})

describe('the loader identities board.env documents and cannot compute', () => {
  test('the shipped board satisfies all three', () => {
    expect(loaderIdentityFaults(g)).toEqual([])
  })

  test('a loader that does not start where the bootloader is written', () => {
    const m = mutated('UBOOT_SEEK_SECTOR=2048')
    try {
      expect(loaderIdentityFaults(loadGeometryFromPath(m.path))).toEqual([
        expect.stringContaining('LOADER_START_SECTOR=64 but the U-Boot blob is written at sector 2048'),
      ])
    } finally { m.cleanup() }
  })

  test('a loader partition that is not UBOOT_MAX_BYTES long', () => {
    const m = mutated('UBOOT_MAX_BYTES=16744449')
    try {
      expect(loaderIdentityFaults(loadGeometryFromPath(m.path))).toEqual([
        expect.stringContaining('the loader partition is 16744448 bytes but UBOOT_MAX_BYTES is 16744449'),
      ])
    } finally { m.cleanup() }
  })

  test('a loader that does not abut uenv-a', () => {
    const m = mutated('UENV_A_START_SECTOR=32769\nUENV_A_START_MIB=\nUENV_A_OFFSET_BYTES=')
    try {
      const faults = loaderIdentityFaults(loadGeometryFromPath(m.path))
      expect(faults.length).toBe(1)
      expect(faults[0]).toContain('the loader partition ends at sector 32768 but uenv-a starts at 32769')
      expect(faults[0]).toContain('the two must abut')
    } finally { m.cleanup() }
  })

  test('three drifting numbers produce three lines, not one', () => {
    // A reader who fixes the one they were shown and rebuilds should not
    // discover the second twenty minutes later.
    const m = mutated('UBOOT_SEEK_SECTOR=2048\nUBOOT_MAX_BYTES=1\nUENV_A_START_SECTOR=99\nUENV_A_START_MIB=\nUENV_A_OFFSET_BYTES=')
    try {
      expect(loaderIdentityFaults(loadGeometryFromPath(m.path)).length).toBe(3)
    } finally { m.cleanup() }
  })
})

describe('the GPT this assembler asks sgdisk for', () => {
  const layout = deriveLayout(g, 256n)
  const spec = gptSpecFor(g, layout)

  test('the order is LAYOUT_PARTITIONS, read off the board and not written here', () => {
    // os/mkimage-v2.sh (deleted: PLAN-014) spells eleven --new flags in a fixed sequence, which is a
    // second copy of LAYOUT_PARTITIONS that nothing checks. This walks the list,
    // so a partition added to the board file cannot be a partition sgdisk never
    // writes.
    expect(spec.partitions.map(p => p.partnum)).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 11n])
    expect(spec.partitions.length).toBe(g.partitions.length)
  })

  test('every start and size, in sectors, against the file and the chain', () => {
    const s = (mib: bigint): bigint => mib * 2048n
    expect(spec.partitions.map(p => [p.label, p.startSector, p.sizeSectors])).toEqual([
      ['loader', 64n, 32704n],
      ['uenv-a', s(16n), 128n],
      ['uenv-b', s(17n), 128n],
      ['boot-a', s(18n), s(64n)],
      ['boot-b', s(82n), s(64n)],
      ['rootfs-a', s(146n), s(256n)],
      ['rootfs-b', s(402n), s(256n)],
      ['meta', s(658n), s(16n)],
      ['state', s(674n), s(64n)],
      ['ephemeral', s(738n), s(512n)],
      ['data', s(1250n), s(64n)],
    ])
  })

  test('the two rootfs slots are sized from the SLOT, not from the file', () => {
    // Neither declares a size; both take the decided one. rootfs-b declares no
    // start either.
    const other = gptSpecFor(g, deriveLayout(g, 512n))
    const slots = other.partitions.filter(p => p.label?.startsWith('rootfs'))
    expect(slots.map(p => p.sizeSectors)).toEqual([512n * 2048n, 512n * 2048n])
    expect(slots[1]?.startSector).toBe((146n + 512n) * 2048n)
  })

  test('nothing runs past the end of the image', () => {
    const totalSectors = g.mibToSectors(layout.totalSizeMib)
    for (const p of spec.partitions) {
      expect(`${p.label} ends at ${p.startSector + p.sizeSectors} of ${totalSectors}`)
        .toBe(`${p.label} ends at ${p.startSector + p.sizeSectors} of ${totalSectors}`)
      expect(p.startSector + p.sizeSectors <= totalSectors).toBe(true)
    }
  })

  test('no two partitions overlap', () => {
    const sorted = [...spec.partitions].sort((a, b) => (a.startSector < b.startSector ? -1 : 1))
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]!
      const here = sorted[i]!
      expect(`${here.label} starts at ${here.startSector}, after ${prev.label} ends at ${prev.startSector + prev.sizeSectors}`)
        .toBe(`${here.label} starts at ${here.startSector}, after ${prev.label} ends at ${prev.startSector + prev.sizeSectors}`)
      expect(here.startSector >= prev.startSector + prev.sizeSectors).toBe(true)
    }
  })

  test('the alignment is the board\'s, and it reaches the argv', () => {
    expect(spec.alignSectors).toBe(1n)
    expect(spec.clear).toBe(true)
    const argv = writeGptArgs(spec, '/tmp/x.img')
    expect(argv.slice(0, 4)).toEqual(['sgdisk', '--clear', '-a', '1'])
  })

  test('a board that declares NO alignment gets sgdisk\'s default, not an invented one', () => {
    // x64 passes no -a at all. Defaulting it here would silently give that board
    // an alignment its shell never asked for, and the whole point of this flag
    // is that an alignment nobody asked for is how the loader moved.
    const m = mutated('GPT_ALIGN_SECTORS=')
    try {
      const nudged = loadGeometryFromPath(m.path)
      expect(nudged.disk.alignSectors).toBe(0n)
      const noAlign = gptSpecFor(nudged, deriveLayout(nudged, 256n))
      expect(noAlign.alignSectors).toBeUndefined()
      expect(writeGptArgs(noAlign, '/tmp/x.img')).not.toContain('-a')
    } finally { m.cleanup() }
  })
})
