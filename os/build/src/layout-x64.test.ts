// The x64 derived layout: the slot sizing and the start chain, driven at the
// sizes an off-by-one lives at, and against bash.
//
// EVERY TEST HERE IS PURE, and that is the argument for the module being pure.
// The arithmetic below decides where DATA starts; one MiB out produces an image
// that assembles, verifies, boots, and cannot take an update on a device flashed
// with the other number. Reached only through an assembly it would be a bug found
// by diffing 1.9 GiB; reached here it is driven in milliseconds at payload sizes
// no real rootfs has had.
//
// AND ONE THING THESE TESTS ARE FOR THAT layout-cx3576.test.ts IS NOT: proving
// that the two boards' slot arithmetic really is two arithmetics. The claim in
// src/layout-x64.ts's header -- that x64 applies its headroom to a BYTE count
// where cx3576 applies it to a MiB count, and that this is a difference in
// numbers rather than in spelling -- is measured below rather than asserted.

import { describe, expect, test } from 'bun:test'
import { $ } from 'bun'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry, loadGeometryFromPath } from './geometry.ts'
import { decideSlot, deriveLayout, gptSpecFor, placementMib } from './layout-x64.ts'
import { boardEnvPath, makeWorkDir } from './paths.ts'
import { writeGptArgs } from './tools/sgdisk.ts'

const g = loadGeometry('x64')
const MIB = 1048576n

/** A board.env with lines appended; a later assignment wins, as in a shell. */
function mutated(appended: string): { path: string, cleanup: () => void } {
  const dir = makeWorkDir('layout-x64')
  const path = join(dir, 'board.env')
  writeFileSync(path, `${readFileSync(boardEnvPath('x64'), 'utf8')}\n${appended}\n`)
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

describe('the board this file is about reads the way the file says', () => {
  test('the constants every assertion below is written against', () => {
    // Copied out of os/boards/x64/board.env. If one of these moves, the expected
    // numbers below are stale and should be recomputed rather than the test being
    // relaxed to whatever it now produces.
    expect({
      floor: g.slot.slotMib,
      headroom: g.slot.headroomPct,
      align: g.slot.alignMib,
      mibBytes: g.mibBytes,
      espStart: g.requirePartition('ESP').start?.mib,
      espSize: g.requirePartition('ESP').requireInt('SIZE_MIB'),
      bootA: g.requirePartition('BOOT_A').start?.mib,
      bootB: g.requirePartition('BOOT_B').start?.mib,
      bootSize: g.requireInt('BOOT_SIZE_MIB'),
      rootfsAStart: g.requirePartition('ROOTFS_A').start?.mib,
      meta: g.requireInt('META_SIZE_MIB'),
      state: g.requireInt('STATE_SIZE_MIB'),
      varMib: g.requireInt('MOS_VAR_MIB'),
      data: g.requireInt('DATA_SIZE_MIB'),
      tail: g.disk.tailSlackMib,
      align2048: g.disk.alignSectors,
    }).toEqual({
      floor: 512n, headroom: 125n, align: 16n, mibBytes: 1048576n,
      espStart: 1n, espSize: 64n, bootA: 65n, bootB: 161n, bootSize: 96n,
      rootfsAStart: 257n, meta: 16n, state: 64n, varMib: 512n, data: 64n,
      tail: 1n, align2048: 2048n,
    })
  })

  test('the nine partitions, in LAYOUT_PARTITIONS order', () => {
    expect(g.partitions.map(p => p.name)).toEqual([
      'ESP', 'BOOT_A', 'BOOT_B', 'ROOTFS_A', 'ROOTFS_B', 'META', 'STATE', 'EPHEMERAL', 'DATA',
    ])
  })

  test('and there is no loader and no uenv pair -- the deliberate absences', () => {
    // Stated from this side too, because "x64 has no loader" is what makes
    // checkLoaderLanded cx3576's and not shared. A board that grew one silently
    // would leave this port with an unasserted partition.
    expect(g.partition('LOADER')).toBeUndefined()
    expect(g.partition('UENV_A')).toBeUndefined()
    expect(g.partition('UENV_B')).toBeUndefined()
  })
})

describe('the slot is sized from the payload BYTE count', () => {
  test('the real input: 240123904 bytes -> 512 MiB, and the FLOOR is what said so', () => {
    // This is the size of the rootfs-verity.img the byte-identity gate ran
    // against, and 512 is the number os/mkimage-x64.sh printed for it.
    const d = decideSlot(g, 240123904n)
    expect(d.slotMib).toBe(512n)
    expect(d.floorApplied).toBe(true)
  })

  test('a payload big enough to beat the floor grows the slot', () => {
    // 500 MiB * 1.25 = 625 MiB, aligned up to 640.
    const d = decideSlot(g, 500n * MIB)
    expect(d.slotMib).toBe(640n)
    expect(d.floorApplied).toBe(false)
  })

  test('the boundary: a computed size that EQUALS the floor did not come from it', () => {
    // 416074957 is the largest payload whose grown-and-aligned size is UNDER the
    // floor (496) and 416074958 is the first one that reaches it. The slot is 512
    // on both sides and only one of them got there by the floor -- which is the
    // distinction `floorApplied` exists to keep, and the one a `slot === floor`
    // test could not see.
    const justUnder = decideSlot(g, 416074957n)
    expect(justUnder.slotMib).toBe(512n)
    expect(justUnder.floorApplied).toBe(true)

    const onIt = decideSlot(g, 416074958n)
    expect(onIt.slotMib).toBe(512n)
    expect(onIt.floorApplied).toBe(false)
  })

  test('exactly on the 16 MiB alignment boundary, and one byte past it', () => {
    // 429496730 is the largest payload the 512 MiB slot holds and 429496731 is
    // the first that needs 528; 442918503 is the largest 528 holds and 442918504
    // is the first that needs 544. One byte either side of an alignment step,
    // which is where an off-by-one in the ceiling or the round-up lives.
    expect(decideSlot(g, 429496730n).slotMib).toBe(512n)
    expect(decideSlot(g, 429496731n).slotMib).toBe(528n)
    expect(decideSlot(g, 442918503n).slotMib).toBe(528n)
    expect(decideSlot(g, 442918504n).slotMib).toBe(544n)
  })

  test('an empty payload is refused, not sized', () => {
    expect(() => decideSlot(g, 0n)).toThrow(/is not a rootfs/)
    expect(() => decideSlot(g, -1n)).toThrow(/is not a rootfs/)
  })

  test('the three board constants are each refused when they are not positive', () => {
    for (const [key, pattern] of [
      ['ROOTFS_SLOT_HEADROOM_PCT=0', /is not a positive percentage/],
      ['ROOTFS_SLOT_ALIGN_MIB=0', /is not a positive alignment/],
      ['MOS_ROOTFS_SLOT_MIB=0', /is not a positive slot floor/],
    ] as const) {
      const m = mutated(key)
      try {
        expect(() => decideSlot(loadGeometryFromPath(m.path), 240123904n)).toThrow(pattern)
      } finally {
        m.cleanup()
      }
    }
  })

  test('the arithmetic is BigInt end to end', () => {
    // A payload past 2^53 survives exactly. `Number(9007199254740993)` is
    // 9007199254740992 and says nothing about it, which is the class of defect
    // src/geometry.ts is BigInt for.
    const huge = 9007199254740993n * MIB
    expect(decideSlot(g, huge).slotMib).toBe(11258999068426256n)
  })
})

describe('the headroom is applied to BYTES, and that is a different function', () => {
  // The claim in src/layout-x64.ts's header, measured. cx3576's spelling is
  // `(payloadMib * pct + 99) / 100` over a payload already ceilinged to MiB;
  // x64's is `(payloadBytes * pct) / 100` ceilinged to MiB afterwards.
  const alignUp = (n: bigint) => ((n + 15n) / 16n) * 16n
  const cx3576Spelling = (bytes: bigint): bigint => {
    const mib = (bytes + MIB - 1n) / MIB
    return alignUp((mib * 125n + 99n) / 100n)
  }
  const x64Spelling = (bytes: bigint): bigint => alignUp(((bytes * 125n) / 100n + MIB - 1n) / MIB)

  test('they agree on every whole-MiB payload from 1 to 2048 MiB', () => {
    let checked = 0
    for (let m = 1n; m <= 2048n; m += 1n) {
      expect(x64Spelling(m * MIB)).toBe(cx3576Spelling(m * MIB))
      checked += 1
    }
    // A loop that ran zero times agrees about nothing; this is the shape of
    // vacuity this package refuses everywhere else.
    expect(checked).toBe(2048)
  })

  test('and they DISAGREE on payloads that are not, which is why this is a second file', () => {
    // Measured: 12583292 bytes -- a payload between 11 and 12 MiB -- gives 16 MiB
    // by x64's spelling and 32 by cx3576's. The difference survives the 16 MiB
    // alignment rather than being absorbed by it, which is the part that makes it
    // a difference in NUMBERS and not in style.
    expect(x64Spelling(12583292n)).toBe(16n)
    expect(cx3576Spelling(12583292n)).toBe(32n)

    // Not one lucky value: a prime-strided sweep over 0..2 GiB finds thousands.
    let disagreements = 0
    for (let b = 1n; b <= 2n * 1024n * MIB; b += 7919n) {
      if (x64Spelling(b) !== cx3576Spelling(b)) disagreements += 1
    }
    expect(disagreements).toBeGreaterThan(1000)
  })

  test('decideSlot implements the x64 spelling and not the other one', () => {
    // The test above compares two local functions and would pass if BOTH were
    // wrong. This is what ties it to the shipped code.
    expect(decideSlot(g, 12583292n).slotMib).toBe(512n) // the floor still wins here
    // ...so drive it below the floor by lowering the floor on a mutated board.
    const m = mutated('MOS_ROOTFS_SLOT_MIB=1')
    try {
      const gm = loadGeometryFromPath(m.path)
      expect(decideSlot(gm, 12583292n).slotMib).toBe(16n)
      expect(decideSlot(gm, 12583292n).slotMib).not.toBe(32n)
    } finally {
      m.cleanup()
    }
  })
})

describe('the x64 slot arithmetic, against a bash oracle', () => {
  // The same `$(( ))` os/mkimage-x64.sh:117-121 does, driven by bash. The three
  // constants are passed as ARGUMENTS rather than by sourcing os/boards/x64/
  // board.env: an oracle that read the board file would be testing the parser
  // this comparison is supposed to be independent of.
  const oracle = async (bytes: bigint): Promise<bigint> => {
    const script = `
      b=$1; pct=$2; align=$3; mib=$4; floor=$5
      s=$(( (b * pct / 100 + mib - 1) / mib ))
      s=$(( (s + align - 1) / align * align ))
      if [ "$s" -lt "$floor" ]; then s="$floor"; fi
      printf '%s\\n' "$s"
    `
    const r = await $`bash -c ${script} bash ${String(bytes)} ${String(g.slot.headroomPct)} ${String(g.slot.alignMib)} ${String(g.mibBytes)} ${String(g.slot.slotMib)}`.quiet()
    return BigInt(r.stdout.toString().trim())
  }

  // Sizes bash can hold exactly (its arithmetic is 64-bit signed), spread over
  // the floor, the alignment boundary and the plain middle.
  const PAYLOADS = [
    1n, 1048576n, 12583292n, 240123904n, 416074957n, 416074958n,
    429496730n, 429496731n, 442918503n, 442918504n,
    500n * MIB, 1023n * MIB + 1n, 2n * 1024n * MIB, 4n * 1024n * MIB - 1n,
  ]

  test('bash and decideSlot agree on every payload', async () => {
    let checked = 0
    for (const b of PAYLOADS) {
      expect(await oracle(b)).toBe(decideSlot(g, b).slotMib)
      checked += 1
    }
    expect(checked).toBe(PAYLOADS.length)
    expect(checked).toBeGreaterThan(0)
  }, 60_000)

  test('and the oracle is LIVE -- a mutated one disagrees', async () => {
    // An oracle that agreed for the wrong reason would make the test above a
    // statement about nothing. Dropping the `+ mib - 1` turns the ceiling into a
    // floor; it must then disagree on a payload whose headroom is not a whole
    // MiB.
    const broken = async (bytes: bigint): Promise<bigint> => {
      const script = `
        b=$1; pct=$2; align=$3; mib=$4; floor=$5
        s=$(( b * pct / 100 / mib ))
        s=$(( (s + align - 1) / align * align ))
        if [ "$s" -lt "$floor" ]; then s="$floor"; fi
        printf '%s\\n' "$s"
      `
      const r = await $`bash -c ${script} bash ${String(bytes)} 125 16 1048576 1`.quiet()
      return BigInt(r.stdout.toString().trim())
    }
    const m = mutated('MOS_ROOTFS_SLOT_MIB=1')
    try {
      const gm = loadGeometryFromPath(m.path)
      // 12583292 * 1.25 = 15729115 bytes = 14.999... MiB. The ceiling makes it
      // 15 and the alignment 16; the floor makes it 14 and the alignment 16 too
      // -- so this pair is NOT where the mutation shows, and a test that only
      // tried it would call a broken oracle live. 268435457 bytes is where it
      // does: ceiling 321 -> 336, floor 320 -> 320.
      expect(await broken(268435457n)).toBe(320n)
      expect(decideSlot(gm, 268435457n).slotMib).toBe(336n)
    } finally {
      m.cleanup()
    }
  }, 60_000)
})

describe('the chain from ROOTFS_A down to DATA', () => {
  const layout = deriveLayout(g, 512n)

  test('the real geometry, MiB for MiB', () => {
    expect({ ...layout }).toEqual({
      slotMib: 512n,
      rootfsBStartMib: 769n, // 257 + 512
      metaStartMib: 1281n, // 769 + 512
      stateStartMib: 1297n, // 1281 + 16
      ephemeralStartMib: 1361n, // 1297 + 64
      dataStartMib: 1873n, // 1361 + 512
      totalSizeMib: 1938n, // 1873 + 64 + 1
    })
  })

  test('1938 MiB is what the shell printed for these inputs', () => {
    // "assembled 1938 MiB, 512 MiB per rootfs slot" -- os/mkimage-x64.sh, over
    // the same rootfs-verity.img the byte-identity gate used.
    expect(deriveLayout(g, decideSlot(g, 240123904n).slotMib).totalSizeMib).toBe(1938n)
  })

  test('no two partitions overlap and nothing runs past the end', () => {
    const spec = gptSpecFor(g, layout)
    const spans = spec.partitions
      .map(p => ({ label: p.label, from: p.startSector, to: p.startSector + p.sizeSectors }))
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    const end = g.mibToSectors(layout.totalSizeMib)
    let previousEnd = g.mibToSectors(g.disk.headMib)
    for (const s of spans) {
      expect(s.from).toBeGreaterThanOrEqual(previousEnd)
      expect(s.to).toBeLessThanOrEqual(end)
      previousEnd = s.to
    }
    expect(spans.length).toBe(9)
  })

  test('DATA is last, and the tail slack is behind it', () => {
    const spec = gptSpecFor(g, layout)
    const data = spec.partitions.find(p => p.label === 'data')
    expect(data).toBeDefined()
    const dataEnd = (data?.startSector ?? 0n) + (data?.sizeSectors ?? 0n)
    for (const p of spec.partitions) expect(p.startSector).toBeLessThanOrEqual(data?.startSector ?? 0n)
    expect(g.mibToSectors(layout.totalSizeMib) - dataEnd).toBe(g.mibToSectors(g.disk.tailSlackMib))
  })

  test('the slot size moves everything after it, and nothing before it', () => {
    const bigger = deriveLayout(g, 640n)
    expect(bigger.rootfsBStartMib - layout.rootfsBStartMib).toBe(128n)
    expect(bigger.dataStartMib - layout.dataStartMib).toBe(256n) // both slots moved
    expect(placementMib(g, bigger).ESP).toBe(placementMib(g, layout).ESP)
    expect(placementMib(g, bigger).BOOT_B).toBe(placementMib(g, layout).BOOT_B)
  })

  test('a slot of zero is refused rather than chained off', () => {
    expect(() => deriveLayout(g, 0n)).toThrow(/is not a slot/)
  })
})

describe('the GPT is read off the board, not written out a second time', () => {
  const layout = deriveLayout(g, 512n)

  test('a partition added to the board file appears in the table', () => {
    // The whole reason gptSpecFor walks LAYOUT_PARTITIONS: os/mkimage-x64.sh
    // spells nine --new flags in sequence, and a tenth partition added to the
    // board and forgotten in the script is one sgdisk never writes -- with
    // nothing to notice.
    const m = mutated([
      'SPARE_PARTNUM=10', 'SPARE_LABEL=spare', 'SPARE_START_MIB=1900', 'SPARE_SIZE_MIB=8',
      'SPARE_GUID=5AC35760-0064-4000-8000-000000000099',
      'SPARE_TYPECODE=0FC63DAF-8483-4772-8E79-3D69D8477DE4',
      'SPARE_ROLE=ext4', 'SPARE_FS_LABEL=spare', 'SPARE_FS_UUID=5ac35760-0064-4000-8000-000000000199',
      `LAYOUT_PARTITIONS="${'ESP BOOT_A BOOT_B ROOTFS_A ROOTFS_B META STATE EPHEMERAL DATA SPARE'}"`,
    ].join('\n'))
    try {
      const gm = loadGeometryFromPath(m.path)
      const spec = gptSpecFor(gm, deriveLayout(gm, 512n))
      expect(spec.partitions.map(p => p.label)).toEqual([
        'esp', 'boot-a', 'boot-b', 'rootfs-a', 'rootfs-b', 'meta', 'state', 'ephemeral', 'data', 'spare',
      ])
    } finally {
      m.cleanup()
    }
  })

  test('both rootfs slots take the slot size and nothing else does', () => {
    const spec = gptSpecFor(g, deriveLayout(g, 640n))
    const bySize = new Map(spec.partitions.map(p => [p.label, p.sizeSectors]))
    expect(bySize.get('rootfs-a')).toBe(g.mibToSectors(640n))
    expect(bySize.get('rootfs-b')).toBe(g.mibToSectors(640n))
    expect(bySize.get('esp')).toBe(g.mibToSectors(64n))
    expect(bySize.get('boot-a')).toBe(g.mibToSectors(96n))
  })

  test('the alignment passed is the BOARD\'s 2048', () => {
    expect(gptSpecFor(g, layout).alignSectors).toBe(2048n)
    expect(writeGptArgs(gptSpecFor(g, layout), '/x.img')).toContain('2048')
  })

  test('a board that declares no alignment gets none passed', () => {
    // geometry.ts reads an absent GPT_ALIGN_SECTORS as 0n and this turns that
    // into "omit the flag", which is sgdisk's own default. Not `?? 2048`: an
    // alignment nobody asked for is how cx3576's loader moved in the first place.
    const m = mutated('GPT_ALIGN_SECTORS=')
    try {
      const gm = loadGeometryFromPath(m.path)
      const argv = writeGptArgs(gptSpecFor(gm, deriveLayout(gm, 512n)), '/x.img')
      expect(argv).not.toContain('-a')
    } finally {
      m.cleanup()
    }
  })

  test('--clear is NOT passed, which is what os/mkimage-x64.sh does', () => {
    expect(writeGptArgs(gptSpecFor(g, layout), '/x.img')).not.toContain('--clear')
  })

  test('a partition with neither a declared nor a derived start is refused', () => {
    const m = mutated('ESP_START_MIB=\nESP_START_SECTOR=\nESP_OFFSET_BYTES=')
    try {
      const gm = loadGeometryFromPath(m.path)
      expect(() => gptSpecFor(gm, deriveLayout(gm, 512n))).toThrow(/declares no start for ESP/)
    } finally {
      m.cleanup()
    }
  })

  test('a partition with no size and no slot sizing is refused', () => {
    const m = mutated('META_SIZE_MIB_UNUSED=1\nMETA_SIZE_MIB=')
    try {
      const gm = loadGeometryFromPath(m.path)
      // META_SIZE_MIB is also a chain input, so the throw may come from either
      // side; both are refusals and neither is a silently placed partition.
      expect(() => gptSpecFor(gm, deriveLayout(gm, 512n))).toThrow()
    } finally {
      m.cleanup()
    }
  })
})
