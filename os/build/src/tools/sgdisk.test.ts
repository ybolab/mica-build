// The sgdisk wrapper, against the real sgdisk, driven from the failing side.
//
// The layouts written here are BOTH shipped boards' static geometry, taken
// from src/geometry.ts rather than made up: cx3576's eleven partitions with a
// loader at sector 64, and x64's nine with none. Only the partitions whose
// start and size the definition pins are written -- the rootfs slots and the
// tail are sized at assembly time from the built rootfs, and that chain is
// M6b's and M6c's.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry, type Geometry, type PlacedPartition } from '../geometry.ts'
import { makeWorkDir, REPO_ROOT, requireShippedBoards } from '../paths.ts'
import { Toolbox, ToolError } from '../toolbox.ts'
import { OPEN_TIMEOUT_MS, TOOL_TIMEOUT_MS } from '../testing.ts'
import { CX3576_ASSEMBLY } from '../toolsets.ts'
import { readPartition, verifyGpt, writeGpt, writeGptArgs, type GptPartitionSpec } from './sgdisk.ts'
import { truncate } from './dd.ts'

let tb: Toolbox
let work = ''

beforeAll(async () => {
  work = makeWorkDir('sgdisk')
  tb = await Toolbox.open(CX3576_ASSEMBLY, { mounts: [REPO_ROOT], cwd: work })
}, OPEN_TIMEOUT_MS)
afterAll(async () => {
  await tb?.close()
  if (work !== '') rmSync(work, { recursive: true, force: true })
}, OPEN_TIMEOUT_MS)

/** The partitions a board definition pins outright -- start AND size both given. */
function pinned(g: Geometry): { spec: GptPartitionSpec, p: PlacedPartition }[] {
  return g.partitions
    .filter(p => p.start !== undefined && p.size !== undefined && p.partnum !== undefined)
    .map(p => ({
      p,
      spec: {
        partnum: p.partnum!,
        startSector: p.start!.sectors,
        sizeSectors: p.size!.sectors,
        label: p.label,
        typecode: p.typecode,
        guid: p.guid,
      },
    }))
}

describe('the argv shape, without a disk', () => {
  test('a whole GPT, in the order sgdisk applies it', () => {
    const argv = writeGptArgs({
      diskGuid: 'AAAAAAAA-0000-4000-8000-000000000000',
      alignSectors: 1n,
      clear: true,
      partitions: [{ partnum: 1n, startSector: 64n, sizeSectors: 32704n, label: 'loader', typecode: 'T', guid: 'G' }],
    }, '/w/disk.img')
    expect(argv).toEqual([
      'sgdisk', '--clear', '-a', '1', '--disk-guid=AAAAAAAA-0000-4000-8000-000000000000',
      '--new=1:64:+32704S', '--change-name=1:loader', '--typecode=1:T', '--partition-guid=1:G',
      '/w/disk.img',
    ])
  })

  test('no alignment flag when none was asked for -- an alignment nobody chose moved the loader once', () => {
    const argv = writeGptArgs({
      diskGuid: 'G', partitions: [{ partnum: 1n, startSector: 2048n, sizeSectors: 2048n }],
    }, 'd.img')
    expect(argv).not.toContain('-a')
    expect(argv).not.toContain('--clear')
    // os/mkimage-x64.sh passes neither, and this is what "not defaulted" means.
    expect(argv).toEqual(['sgdisk', '--disk-guid=G', '--new=1:2048:+2048S', 'd.img'])
  })

  test('an empty partition set is refused: sgdisk would write a valid empty table and exit 0', () => {
    expect(() => writeGptArgs({ diskGuid: 'G', partitions: [] }, 'd.img'))
      .toThrow(/no partitions in it.*empty success/s)
  })

  test('a partition number given twice is refused: sgdisk applies both and the second wins', () => {
    expect(() => writeGptArgs({
      diskGuid: 'G',
      partitions: [
        { partnum: 4n, startSector: 2048n, sizeSectors: 2048n, label: 'boot-a' },
        { partnum: 4n, startSector: 4096n, sizeSectors: 2048n, label: 'boot-b' },
      ],
    }, 'd.img')).toThrow(/4 is given twice \(boot-a and boot-b\).*one fewer partition/s)
  })

  test('a zero length is refused: sgdisk reads it as "to the end of the disk"', () => {
    expect(() => writeGptArgs({
      diskGuid: 'G', partitions: [{ partnum: 1n, startSector: 2048n, sizeSectors: 0n }],
    }, 'd.img')).toThrow(/end of the disk/)
  })

  test('a partition number of zero is refused; GPT numbers start at 1', () => {
    expect(() => writeGptArgs({
      diskGuid: 'G', partitions: [{ partnum: 0n, startSector: 2048n, sizeSectors: 8n }],
    }, 'd.img')).toThrow(/GPT numbers start at 1/)
  })
})

describe('against the real sgdisk, for both shipped boards', () => {
  for (const board of requireShippedBoards()) {
    test(`${board}: every pinned partition lands where the definition says`, async () => {
      const g = loadGeometry(board)
      const parts = pinned(g)
      // Not "no mismatches found": a loop over nothing finds none either.
      // cx3576 pins five outright (loader, both uenv, both boot); x64 pins
      // three (esp, both boot). Everything after the rootfs slots is sized in
      // the definition and PLACED at assembly time, which is M6b's and M6c's
      // chain and deliberately not modelled here.
      const expected = board === 'cx3576' ? 5 : 3
      expect(`${board}: ${parts.length} pinned partitions`).toBe(`${board}: ${expected} pinned partitions`)
      expect(parts.map(x => x.p.name).join(' ')).toBe(
        board === 'cx3576' ? 'LOADER UENV_A UENV_B BOOT_A BOOT_B' : 'ESP BOOT_A BOOT_B',
      )

      const img = join(work, `${board}.img`)
      await truncate(tb, img, '2048M')
      await writeGpt(tb, img, {
        diskGuid: g.disk.guid,
        // 1 on cx3576 and 2048 on x64, out of the definitions, not a default.
        alignSectors: g.disk.alignSectors === 0n ? undefined : g.disk.alignSectors,
        clear: true,
        partitions: parts.map(x => x.spec),
      })
      expect(await verifyGpt(tb, img)).toContain('No problems found')

      for (const { p, spec } of parts) {
        const got = await readPartition(tb, img, spec.partnum)
        // Read BACK, not asserted about what was asked for: sgdisk is free to
        // move a start, and asking proves nothing about the table.
        expect(`${board}/${p.name} start`).toBe(`${board}/${p.name} start`)
        expect(`${p.name}@${got.firstSector}`).toBe(`${p.name}@${spec.startSector}`)
        expect(`${p.name}:${got.sizeSectors}`).toBe(`${p.name}:${spec.sizeSectors}`)
        expect(`${p.name}:${got.name}`).toBe(`${p.name}:${p.label}`)
        expect(`${p.name}:${got.guid.toUpperCase()}`).toBe(`${p.name}:${p.guid?.toUpperCase()}`)
        expect(`${p.name}:${got.typecode.toUpperCase()}`).toBe(`${p.name}:${p.typecode?.toUpperCase()}`)
      }
   }, TOOL_TIMEOUT_MS)
  }

  test('cx3576 is the board that needs -a 1, and WITHOUT it sgdisk relocates the loader and exits 0', async () => {
    // The failure this whole knob exists for, driven. os/boards/cx3576/board.env
    // puts the loader at sector 64, which is not 2048-aligned; sgdisk moves it
    // silently and the bootloader ends up outside its own partition.
    const g = loadGeometry('cx3576')
    const loader = g.requirePartition('LOADER')
    const spec: GptPartitionSpec = {
      partnum: loader.partnum!,
      startSector: loader.start!.sectors,
      sizeSectors: loader.size!.sectors,
      label: loader.label,
    }
    expect(spec.startSector).toBe(64n)

    const withA = join(work, 'align-1.img')
    const withoutA = join(work, 'align-default.img')
    await truncate(tb, withA, '64M')
    await truncate(tb, withoutA, '64M')
    await writeGpt(tb, withA, { diskGuid: g.disk.guid, alignSectors: 1n, clear: true, partitions: [spec] })
    const r = await writeGpt(tb, withoutA, { diskGuid: g.disk.guid, clear: true, partitions: [spec] })

    expect(r.exitCode).toBe(0)
    expect((await readPartition(tb, withA, spec.partnum)).firstSector).toBe(64n)
    expect((await readPartition(tb, withoutA, spec.partnum)).firstSector).toBe(2048n)
    // And sgdisk --verify is happy with the relocated one, which is why the
    // check that matters is a read-back and not a verify.
    expect(await verifyGpt(tb, withoutA)).toContain('No problems found')
  }, TOOL_TIMEOUT_MS)
})

describe('the argv normalisation is measured, not assumed', () => {
  // src/tools/sgdisk.ts writes ONE shape where the two shell assemblers write
  // two. That is only safe if the differences produce identical bytes, so the
  // comparison is re-run here rather than recorded as a claim: the day a
  // different sgdisk disagrees, it says so at this layer instead of inside
  // M6b's byte-identity gate.
  const partitions: GptPartitionSpec[] = [
    { partnum: 1n, startSector: 2048n, sizeSectors: 131072n, label: 'esp', typecode: 'C12A7328-F81F-11D2-BA4B-00A0C93EC93B', guid: '5AC35760-0064-4000-8000-000000000001' },
    { partnum: 2n, startSector: 133120n, sizeSectors: 196608n, label: 'boot-a', typecode: 'EBD0A0A2-B9E5-4433-87C0-68B6B72699C7', guid: '5AC35760-0064-4000-8000-000000000003' },
  ]
  const diskGuid = '5AC35760-0064-4000-8000-000000000000'

  /**
   * Build one image and hash it IN THE CONTAINER.
   *
   * sha256sum rather than reading the file into this process: these images are
   * 300 MiB each and six of them are built below, and pulling 1.8 GiB through
   * Bun.file().bytes() to compare partition tables was slow enough to time the
   * suite out -- measured, and the reason this helper looks like this.
   */
  async function build(name: string, argv: string[]): Promise<string> {
    const img = join(work, name)
    await truncate(tb, img, '300M')
    await tb.must([...argv, img])
    const r = await tb.must(['sha256sum', img])
    const digest = r.stdout.trim().split(/\s+/)[0] ?? ''
    // An unread digest would compare equal to another unread one, which is the
    // "agrees on all 0 keys" shape os/verify/HARNESS.md records.
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    return digest
  }

  test('this wrapper agrees byte for byte with os/mkimage-x64.sh\'s flag order and +NM sizes', async () => {
    const ours = await build('order-ours.img', writeGptArgs({ diskGuid, partitions }, '').slice(0, -1))
    const x64Shape = await build('order-x64.img', [
      'sgdisk', `--disk-guid=${diskGuid}`,
      ...partitions.flatMap(p => [
        `--new=${p.partnum}:${p.startSector}:+${p.sizeSectors / 2048n}M`,
        `--typecode=${p.partnum}:${p.typecode}`,
        `--partition-guid=${p.partnum}:${p.guid}`,
        `--change-name=${p.partnum}:${p.label}`,
      ]),
    ])
    expect(ours).toEqual(x64Shape)
  }, TOOL_TIMEOUT_MS)

  test('and with os/mkimage-v2.sh\'s --clear plus -a 1, where every start is MiB-aligned', async () => {
    const ours = await build('clear-ours.img', writeGptArgs({ diskGuid, partitions }, '').slice(0, -1))
    const v2Shape = await build('clear-v2.img', [
      'sgdisk', '--clear', '-a', '1', `--disk-guid=${diskGuid}`,
      ...partitions.flatMap(p => [
        `--new=${p.partnum}:${p.startSector}:+${p.sizeSectors}S`,
        `--change-name=${p.partnum}:${p.label}`,
        `--typecode=${p.partnum}:${p.typecode}`,
        `--partition-guid=${p.partnum}:${p.guid}`,
      ]),
    ])
    expect(ours).toEqual(v2Shape)
  }, TOOL_TIMEOUT_MS)

  test('the comparison above is not vacuous: a REAL difference is visible to it', async () => {
    // Two images that differ in one partition GUID, compared the same way. If
    // the comparison were reading empty files -- the failure mode the bash
    // oracle in os/verify/HARNESS.md hit, "agrees on all 0 keys" -- this would
    // pass too.
    const a = await build('diff-a.img', writeGptArgs({ diskGuid, partitions }, '').slice(0, -1))
    const b = await build('diff-b.img', writeGptArgs({
      diskGuid,
      partitions: [{ ...partitions[0]!, guid: '5AC35760-0064-4000-8000-0000000000FF' }, partitions[1]!],
    }, '').slice(0, -1))
    expect(a).not.toEqual(b)
  }, TOOL_TIMEOUT_MS)
})

describe('every failure is reported, and none is swallowed', () => {
  test('writing to a file that is not there is a ToolError carrying sgdisk\'s words', async () => {
    let err: ToolError | undefined
    try {
      await writeGpt(tb, join(work, 'absent.img'), {
        diskGuid: 'G', partitions: [{ partnum: 1n, startSector: 2048n, sizeSectors: 2048n }],
      })
    } catch (e) { err = e as ToolError }
    expect(err).toBeInstanceOf(ToolError)
    expect(err!.message).toContain('could not write the GPT')
    expect(err!.message).toMatch(/does not exist|Error is 2/)
  })

  test('verifyGpt fails on a NONZERO exit', async () => {
    await expect(verifyGpt(tb, join(work, 'still-absent.img'))).rejects.toThrow(/reported problems/)
  })

  test('verifyGpt ALSO fails on problem text with exit 0, which is its other shape', async () => {
    // os/mkimage-v2.sh (deleted): "Both failure shapes -- nonzero exit AND problem text
    // with exit 0 -- must reach the same friendly error." The second shape is
    // the one an exit-status check misses, so it is produced for real: a valid
    // table, and then a disk shrunk underneath it. Overlapping partitions do
    // NOT produce it -- sgdisk refuses those outright with exit 4, which was
    // this test's first draft and would have proved only the first shape.
    const img = join(work, 'shrunk.img')
    await truncate(tb, img, '64M')
    await writeGpt(tb, img, {
      diskGuid: '5AC35760-0064-4000-8000-000000000000', clear: true, alignSectors: 1n,
      partitions: [{ partnum: 1n, startSector: 2048n, sizeSectors: 8192n, label: 'a' }],
    })
    expect(await verifyGpt(tb, img)).toContain('No problems found')

    await truncate(tb, img, '32M')
    const raw = await tb.run(['sgdisk', '--verify', img])
    // The premise, asserted rather than assumed: sgdisk EXITS 0 over this.
    expect(raw.exitCode).toBe(0)
    expect(`${raw.stdout}${raw.stderr}`).toContain('Identified 5 problems')
    expect(`${raw.stdout}${raw.stderr}`).not.toContain('No problems found')
    // The wrapper is not content with it.
    await expect(verifyGpt(tb, img)).rejects.toThrow(/reported problems/)
  }, TOOL_TIMEOUT_MS)

  test('the positive control: verifyGpt passes a table that is actually fine', async () => {
    const img = join(work, 'fine.img')
    await truncate(tb, img, '64M')
    await writeGpt(tb, img, {
      diskGuid: '5AC35760-0064-4000-8000-000000000000', clear: true,
      partitions: [{ partnum: 1n, startSector: 2048n, sizeSectors: 8192n, label: 'a' }],
    })
    expect(await verifyGpt(tb, img)).toContain('No problems found')
  })

  test('readPartition refuses a partition that is not in the table rather than returning zeroes', async () => {
    const img = join(work, 'fine.img')
    let msg = ''
    try { await readPartition(tb, img, 9n) } catch (e) { msg = (e as ToolError).message }
    expect(msg).toMatch(/partition 9|no readable/)
    expect(msg).toContain(img)
  })
})
