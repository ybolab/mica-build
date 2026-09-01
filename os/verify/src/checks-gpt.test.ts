// The GPT families, driven from the failing side: one mutation per check.
//
// Each case asserts the check is
// GREEN against an unmutated fixture and RED against a fixture that differs in
// exactly one field -- because "agrees with the oracle" is what a check that
// cannot fail also reports, and only the mutation separates them.
//
// The message is asserted too, not just the verdict. A check that goes red
// while naming a different partition sends a reader to the wrong place, and
// the parity harness would still call it a clean divergence.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBoard } from './board.ts'
import { GPT_CHECKS } from './checks-gpt.ts'
import { gptWith, gptWithout, healthyGpt, imageFixture, toolsAnswering, type FixtureRequest } from './checks-fixture.ts'
import type { CheckCase } from './checks.ts'
import type { GptTable } from './image.ts'
import { boardEnvPath } from './paths.ts'
import type { CheckResult } from './parity.ts'

/** A mutated copy of a real board definition, named `candidate` -- see board.test.ts. */
async function withMutatedBoard(
  board: string,
  edit: (text: string) => string,
  fn: (path: string) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'mos-gpt-check-'))
  try {
    const p = join(dir, 'candidate.env')
    writeFileSync(p, edit(readFileSync(boardEnvPath(board), 'utf8')))
    await fn(p)
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))

/** The real slot size on the shipped cx3576 image, as sgdisk reads it. */
const SLOT = 524288

function checkNamed(id: string): CheckCase {
  const found = GPT_CHECKS.find(c => c.id === id)
  if (found === undefined) throw new Error(`no GPT check is registered as '${id}'`)
  return found
}

/** Run one check against one synthetic table and hand back its results. */
async function drive(id: string, over: Partial<FixtureRequest> = {}): Promise<readonly CheckResult[]> {
  const board = over.board ?? cx3576
  const request: FixtureRequest = {
    board,
    gpt: over.gpt ?? healthyGpt(board, SLOT),
    ...(over.tools === undefined ? {} : { tools: over.tools }),
    ...(over.imageBytes === undefined ? {} : { imageBytes: over.imageBytes }),
  }
  const fixture = imageFixture(request)
  try {
    return await checkNamed(id).run(fixture.ctx)
  }
  finally {
    fixture.dispose()
  }
}

/** The one firing of a `one` check, or the firing for `instance`. */
function firing(results: readonly CheckResult[], instance?: string): CheckResult {
  const found = instance === undefined ? results[0] : results.find(r => r.instance === instance)
  if (found === undefined) throw new Error(`no firing${instance === undefined ? '' : ` for instance ${instance}`}`)
  return found
}

const SGDISK_CLEAN = 'The operation has completed successfully.\n\nNo problems found. 2048 free sectors\n'

describe('gpt-verify-clean', () => {
  test('green when sgdisk finds no problems', async () => {
    const tools = toolsAnswering(/sgdisk --verify/, { stdout: SGDISK_CLEAN })
    expect(firing(await drive('gpt-verify-clean', { tools })).verdict).toBe('pass')
  })

  test('RED when sgdisk reports a damaged table', async () => {
    const tools = toolsAnswering(/sgdisk --verify/, {
      stdout: 'Caution: invalid main GPT header, but valid backup\n\nIdentified 1 problems!\n',
    })
    const r = firing(await drive('gpt-verify-clean', { tools }))
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/reported problems/)
  })

  test('RED on a Caution that is not one of the two benign alignment notes', async () => {
    // The oracle filters "doesn't begin on a" and "degraded performance" and
    // nothing else; a fixture that only ever drove the "problems!" branch
    // would leave the complaint filter untested in both directions.
    const tools = toolsAnswering(/sgdisk --verify/, {
      stdout: 'Warning: the partition table overlaps the last partition\n\nNo problems found.\n',
    })
    expect(firing(await drive('gpt-verify-clean', { tools })).verdict).toBe('fail')
  })

  test('a benign alignment Caution stays green', async () => {
    const tools = toolsAnswering(/sgdisk --verify/, {
      stdout: "Caution: partition 1 doesn't begin on a 2048-sector boundary\n\nNo problems found.\n",
    })
    expect(firing(await drive('gpt-verify-clean', { tools })).verdict).toBe('pass')
  })
})

describe('gpt-disk-guid', () => {
  test('green against the declared GUID, whatever the case', async () => {
    const table = healthyGpt(cx3576, SLOT)
    const lowered: GptTable = { ...table, diskGuid: table.diskGuid.toLowerCase() }
    expect(firing(await drive('gpt-disk-guid', { gpt: lowered })).verdict).toBe('pass')
  })

  test('RED when the image carries another board\'s disk GUID', async () => {
    // The mutation is x64's real disk GUID: the failure this catches is an
    // image assembled with the wrong layout, not a random string.
    const table = healthyGpt(cx3576, SLOT)
    const swapped: GptTable = { ...table, diskGuid: '5AC35760-0064-4000-8000-000000000000' }
    const r = firing(await drive('gpt-disk-guid', { gpt: swapped }))
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/disk GUID is '5AC35760-0064-4000-8000-000000000000', expected 5AC35760-0002/)
  })
})

describe('the per-partition family', () => {
  test('all six are green against an unmutated table, on both boards', async () => {
    for (const [board, slot] of [[cx3576, SLOT], [x64, 1048576]] as const) {
      for (const id of [
        'gpt-partlabel', 'gpt-typecode', 'gpt-partition-guid',
        'gpt-partition-size', 'gpt-partition-start', 'gpt-partition-attrs',
      ]) {
        const results = await drive(id, { board, gpt: healthyGpt(board, slot) })
        expect(results.length).toBe(board.partitions.length)
        for (const r of results) expect(r.verdict).toBe('pass')
      }
    }
  })

  test('gpt-partlabel goes RED on ONE partition and names it', async () => {
    const gpt = gptWith(healthyGpt(cx3576, SLOT), 9, { name: 'stat' })
    const results = await drive('gpt-partlabel', { gpt })
    expect(firing(results, '9').verdict).toBe('fail')
    expect(firing(results, '9').message).toMatch(/p9 PARTLABEL is stat, expected 'state'/)
    // Everything else stays green: a mutation that reddened the whole family
    // would not tell you which partition it was about.
    expect(results.filter(r => r.verdict === 'fail').map(r => r.instance)).toEqual(['9'])
  })

  test('gpt-partlabel is case SENSITIVE, unlike the GUID checks', async () => {
    const gpt = gptWith(healthyGpt(cx3576, SLOT), 9, { name: 'STATE' })
    expect(firing(await drive('gpt-partlabel', { gpt }), '9').verdict).toBe('fail')
  })

  test('gpt-typecode goes RED when a boot slot stops being an ESP', async () => {
    // The real failure: U-Boot finds a bootable partition by TYPE, so a boot
    // slot typed linux-generic is a slot the bootloader will not offer.
    const gpt = gptWith(healthyGpt(cx3576, SLOT), 4, { typeGuid: '0FC63DAF-8483-4772-8E79-3D69D8477DE4' })
    const r = firing(await drive('gpt-typecode', { gpt }), '4')
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/p4 typecode is '0FC63DAF/)
  })

  test('gpt-typecode folds case', async () => {
    const gpt = gptWith(healthyGpt(cx3576, SLOT), 4, { typeGuid: 'c12a7328-f81f-11d2-ba4b-00a0c93ec93b' })
    expect(firing(await drive('gpt-typecode', { gpt }), '4').verdict).toBe('pass')
  })

  test('gpt-partition-guid goes RED when two slots SWAP GUIDs', async () => {
    // The failure that matters: RAUC addresses slots by PARTUUID, so swapping
    // rootfs-a and rootfs-b makes an install overwrite the running slot. The
    // labels, sizes and starts are all still right.
    let gpt = healthyGpt(cx3576, SLOT)
    gpt = gptWith(gpt, 6, { uniqueGuid: '5AC35760-0002-4000-8000-000000000006' })
    gpt = gptWith(gpt, 7, { uniqueGuid: '5AC35760-0002-4000-8000-000000000005' })
    const results = await drive('gpt-partition-guid', { gpt })
    expect(results.filter(r => r.verdict === 'fail').map(r => r.instance).sort()).toEqual(['6', '7'])
  })

  test('gpt-partition-size goes RED on a slot that is one MiB short', async () => {
    const gpt = gptWith(healthyGpt(cx3576, SLOT), 8, { sizeSectors: 32768 - 2048 })
    const r = firing(await drive('gpt-partition-size', { gpt }), '8')
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/p8 \(meta\) size is '30720' sectors, expected 32768/)
  })

  test('gpt-partition-size goes RED, not green, when the SLOT SIZE is unusable', async () => {
    // A rootfs slot that is not a whole-MiB multiple resolves to `want = 0` in
    // the walk. Without the `want > 0` guard the image's own 0 would equal it
    // and the check would pass by comparing the slot against a size derived
    // from itself -- which is the exact shape of the defect that made this
    // guard exist in the oracle.
    const gpt = gptWith(healthyGpt(cx3576, SLOT), 6, { sizeSectors: SLOT + 1 })
    const results = await drive('gpt-partition-size', { gpt })
    expect(firing(results, '6').verdict).toBe('fail')
    expect(firing(results, '7').verdict).toBe('fail')
  })

  test('gpt-partition-start goes RED on a partition that moved', async () => {
    const gpt = gptWith(healthyGpt(cx3576, SLOT), 10, { firstSector: 1511424 + 2048 })
    const r = firing(await drive('gpt-partition-start', { gpt }), '10')
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/p10 \(ephemeral\) starts at sector '1513472', expected 1511424/)
  })

  test('gpt-partition-attrs goes RED on any bit set', async () => {
    // The legacy-BIOS-bootable bit -- the one a well-meaning `sgdisk -A 4:set:2`
    // would set, and the one the layout says the slot choice must never come from.
    const gpt = gptWith(healthyGpt(cx3576, SLOT), 4, { attributeFlags: '0000000000000004' })
    const r = firing(await drive('gpt-partition-attrs', { gpt }), '4')
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/attribute flags are '0000000000000004', expected all bits clear/)
  })

  test('a partition MISSING from the image reddens every field of that row', async () => {
    const gpt = gptWithout(healthyGpt(cx3576, SLOT), 11)
    for (const id of ['gpt-partlabel', 'gpt-typecode', 'gpt-partition-guid', 'gpt-partition-size', 'gpt-partition-start', 'gpt-partition-attrs']) {
      const results = await drive(id, { gpt })
      // Still eleven firings: the walk decides how many rows there are, so a
      // partition the image lost is a row that FAILS rather than a row that
      // silently stops being compared.
      expect(results.length).toBe(11)
      expect(firing(results, '11').verdict).toBe('fail')
    }
  })
})

describe('gpt-rootfs-slots-same-size and gpt-rootfs-slot-floor', () => {
  test('green on the real geometry', async () => {
    expect(firing(await drive('gpt-rootfs-slots-same-size')).verdict).toBe('pass')
    expect(firing(await drive('gpt-rootfs-slot-floor')).verdict).toBe('pass')
  })

  test('RED when the slot is not a whole number of MiB', async () => {
    const gpt = gptWith(healthyGpt(cx3576, SLOT), 6, { sizeSectors: SLOT - 7 })
    const r = firing(await drive('gpt-rootfs-slots-same-size', { gpt }))
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/not a positive whole-MiB multiple/)
  })

  test('RED when the slot is below the layout floor', async () => {
    // 255 MiB against cx3576's declared 256 floor -- a whole-MiB slot, so the
    // check above stays green and only this one goes red.
    const gpt = gptWith(healthyGpt(cx3576, SLOT), 6, { sizeSectors: 255 * 2048 })
    expect(firing(await drive('gpt-rootfs-slots-same-size', { gpt })).verdict).toBe('pass')
    const r = firing(await drive('gpt-rootfs-slot-floor', { gpt }))
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/rootfs slot 255 MiB is below the 256 MiB layout floor/)
  })
})

describe('gpt-image-size', () => {
  test('green when the file is exactly the walk plus the tail slack', async () => {
    const r = firing(await drive('gpt-image-size'))
    expect(r.verdict).toBe('pass')
    expect(r.message).toMatch(/image size is 1378877440 bytes \/ 1315 MiB/)
  })

  test('RED when the image is one MiB short of the walk', async () => {
    // The failure: an assembler that forgot the tail slack. DATA would then end
    // at the last byte of the medium and systemd-repart would have nothing to
    // grow into.
    const r = firing(await drive('gpt-image-size', { imageBytes: 1314 * 1048576 }))
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/image size is 1377828864 bytes, expected 1378877440/)
  })

  test('RED when the slot size is unusable, even if the file happens to be right', async () => {
    const gpt = gptWith(healthyGpt(cx3576, SLOT), 6, { sizeSectors: SLOT + 1 })
    expect(firing(await drive('gpt-image-size', { gpt, imageBytes: 1315 * 1048576 })).verdict).toBe('fail')
  })
})

describe('gpt-data-is-last', () => {
  test('green on the real geometry', async () => {
    const r = firing(await drive('gpt-data-is-last'))
    expect(r.verdict).toBe('pass')
    expect(r.message).toMatch(/data is the last partition \(p11\) and ends at sector 2691071/)
  })

  test('RED when DATA ends early, leaving an untracked tail', async () => {
    const gpt = gptWith(healthyGpt(cx3576, SLOT), 11, { lastSector: 2691071 - 2048 })
    const r = firing(await drive('gpt-data-is-last', { gpt }))
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/end at sector 2691071 \(1 MiB tail slack\); it is p11 ending at '2689023'/)
  })

  test('RED when the LAYOUT does not put DATA last', async () => {
    // Driven through the layout, because "which partition is last" is a
    // property of the declared ORDER: DATA moved ahead of EPHEMERAL leaves
    // DATA's own last sector untouched and still has to go red, since a DATA
    // that is not last is a DATA systemd-repart cannot grow.
    withMutatedBoard(
      'cx3576',
      t => t.replace(
        /^LAYOUT_PARTITIONS=.*$/m,
        'LAYOUT_PARTITIONS="LOADER UENV_A UENV_B BOOT_A BOOT_B ROOTFS_A ROOTFS_B META STATE DATA EPHEMERAL"',
      ),
      async (path) => {
        const board = loadBoard(path)
        const r = firing(await drive('gpt-data-is-last', { board, gpt: healthyGpt(board, SLOT) }))
        expect(r.verdict).toBe('fail')
        // p10 is EPHEMERAL's PARTNUM, which the reorder did not change -- the
        // message names the partition that IS last, which is the one to move.
        expect(r.message).toMatch(/it is p10 ending at /)
      },
    )
  })

  test('RED when DATA is missing from the image entirely', async () => {
    const gpt = gptWithout(healthyGpt(cx3576, SLOT), 11)
    const r = firing(await drive('gpt-data-is-last', { gpt }))
    expect(r.verdict).toBe('fail')
    expect(r.message).toMatch(/ending at ''/)
  })
})

describe('a check that cannot decide THROWS rather than returning a fail', () => {
  test('a board declaring no DISK_GUID', async () => {
    const hollow = { ...cx3576, get: (k: string) => (k === 'DISK_GUID' ? undefined : cx3576.get(k)) }
    await expect(drive('gpt-disk-guid', { board: hollow as typeof cx3576 }))
      .rejects.toThrow(/declares no DISK_GUID/)
  })

  test('a board declaring a non-numeric MOS_ROOTFS_SLOT_MIB', async () => {
    const bad = { ...cx3576, get: (k: string) => (k === 'MOS_ROOTFS_SLOT_MIB' ? 'lots' : cx3576.get(k)) }
    await expect(drive('gpt-rootfs-slot-floor', { board: bad as typeof cx3576 }))
      .rejects.toThrow(/MOS_ROOTFS_SLOT_MIB='lots'/)
  })
})
