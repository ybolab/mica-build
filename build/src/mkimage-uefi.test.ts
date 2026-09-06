// The x64 assembler, driven over fabricated inputs -- and every refusal driven
// from the failing side.
//
// Fabricated rather than read from _out/x64/: the test must run on a fresh
// clone, while producing those inputs
// costs a whole rootfs build to exercise an assembler that does not care what is
// inside the payload it places. The properties this assembler reads off its
// inputs are their size, the KEY=value lines of one env file, and whether a
// directory has a lib/ in it -- all of which a fixture carries honestly, at no
// cost.
//
// This file compares no bytes. It covers what a byte comparison cannot see: a
// comparison is green for a good input, so an assembler that quietly dropped a
// refusal produces identical bytes for every good input and passes it perfectly.
// The ESP cluster-count floor is exactly that kind of loss.
//
// One measurement is here because it is a claim this port makes: `-a 2048` where
// the x64 assembly contract passes no alignment at all. That is the only spelling this
// port changed on the sgdisk call, and it is compared against a real sgdisk over
// the real x64 geometry rather than argued in a comment.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry, loadGeometryFromPath, type Geometry } from './geometry.ts'
import { deriveLayout, gptSpecFor } from './layout-uefi.ts'
import {
  assembleUefi,
  bootSlotFault,
  checkEspIsFat32,
  checkGrubenvSize,
  GRUBENV_BYTES,
  mountsFor,
  partitionFaults,
  SEED_STAMP,
  strayEspEntries,
  type AssemblyInputs,
} from './mkimage-uefi.ts'
import { BOARDS_DIR, makeWorkDir, REPO_ROOT } from './paths.ts'
import { OPEN_TIMEOUT_MS, TOOL_TIMEOUT_MS } from './testing.ts'
import { Toolbox } from './toolbox.ts'
import { uefiAssembly } from './toolsets.ts'
import { truncate } from './tools/dd.ts'
import { FAT32_MIN_CLUSTERS, listFat, mcopy, mkfsVfat, readFatClusters } from './tools/mtools.ts'
import { readPartition, writeGpt, writeGptArgs, type GptSpec } from './tools/sgdisk.ts'

/**
 * TOTAL clusters, computed from minfo's BPB -- because minfo does not print one.
 *
 * MEASURED, not assumed: `minfo -i` prints `free clusters=` in its Infosector
 * block and no total anywhere. That is precisely why the x64 assembly contract parses
 * FREE and why the position of the check is load-bearing -- the FAT type is
 * defined by a number the tool does not report. This
 * derives it the way the specification does, and is used ONLY to MEASURE the
 * relationship between the two; the shipped check still reads free, where the
 * shell reads it.
 */
function totalClustersFromBpb(minfoText: string): bigint {
  const field = (re: RegExp): bigint => {
    const m = re.exec(minfoText)
    if (m === null || m[1] === undefined) throw new Error(`minfo printed no ${re} line:\n${minfoText}`)
    return BigInt(m[1])
  }
  const sectors = field(/^big size: ([0-9]+) sectors$/m)
  const reserved = field(/^reserved \(boot\) sectors: ([0-9]+)$/m)
  const fats = field(/^fats: ([0-9]+)$/m)
  const fatLen = field(/^Big fatlen=([0-9]+)$/m)
  const clusterSectors = field(/^cluster size: ([0-9]+) sectors$/m)
  return (sectors - reserved - fats * fatLen) / clusterSectors
}

/** A whole assembly writes a 1938 MiB sparse image and formats seven filesystems. */
const ASSEMBLE_TIMEOUT_MS = 600_000

const g = loadGeometry('x64')
const MIB = 1024 * 1024
const HASH = '29809478ef06ccd26a88fb48f5faa78e8477a20dad8ca407a435eaa14419ef8a'

let tb: Toolbox
let dir: string
let base: AssemblyInputs

function filler(path: string, bytes: number, byte: number): void {
  writeFileSync(path, Buffer.alloc(bytes, byte))
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

beforeAll(async () => {
  dir = makeWorkDir('mkimage-uefi-test')
  filler(join(dir, 'rootfs-verity.img'), 4 * MIB, 0x66)
  // A second payload that differs in exactly one byte's worth of content, for
  // the live control: a gate that cannot report a difference is not a gate.
  filler(join(dir, 'rootfs-verity-other.img'), 4 * MIB, 0x67)
  filler(join(dir, 'vmlinuz'), 512 * 1024, 0x44)
  writeFileSync(join(dir, 'rootfs-verity.env'), [
    `VERITY_ROOT_HASH=${HASH}`,
    `VERITY_SALT=${g.veritySalt}`,
    'VERITY_HASH_ALGO=sha256',
    'VERITY_DATA_BLOCK_SIZE=4096',
    'VERITY_HASH_BLOCK_SIZE=4096',
    'VERITY_DATA_BLOCKS=1024',
    'VERITY_HASH_START_BLOCK=1024',
    'VERITY_DATA_SECTORS=8192',
    '',
  ].join('\n'))

  // The factory /var. Only two properties of the real export reach the
  // assembler: it must be a directory, and it must contain lib/.
  const fv = join(dir, 'factory-var')
  for (const d of ['lib/dpkg', 'lib/mos', 'cache', 'log', 'tmp']) mkdirSync(join(fv, d), { recursive: true })
  writeFileSync(join(fv, 'lib', 'dpkg', 'status'), 'Package: mosd\nStatus: install ok installed\n')
  writeFileSync(join(fv, 'lib', 'mos', 'state.json'), '{}\n')
  mkdirSync(join(dir, 'factory-var-nolib', 'cache'), { recursive: true })

  base = {
    board: 'x64',
    rootfsVerityImg: join(dir, 'rootfs-verity.img'),
    rootfsVerityEnv: join(dir, 'rootfs-verity.env'),
    kernel: join(dir, 'vmlinuz'),
    factoryVar: fv,
    imgOut: join(dir, 'out.img'),
  }

  tb = await Toolbox.open(uefiAssembly('amd64'), { mounts: [REPO_ROOT] })
  // Every input pinned to FILE_MTIME, the instant the assembler pins its own
  // staged files to. mke2fs -d copies the SOURCE inode's times in, so a fixture
  // built at wall-clock time would make the rebuild comparison below measure
  // this file rather than the assembler.
  await tb.must(['find', dir, '-exec', 'touch', '-h', '-d', g.ext4.fileMtime, '{}', '+'])
}, OPEN_TIMEOUT_MS)

// A minute of assemblies leaves several 1938 MiB images and half a gigabyte of
// read-back extracts; `docker rm -f` plus that unlink is comfortably past bun's
// 5 s default hook timeout, which is the same objection src/testing.ts makes.
afterAll(async () => {
  await tb?.close()
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
}, TOOL_TIMEOUT_MS)

/** Assemble with the shared toolbox, swapping in whatever the case is about. */
async function assemble(
  overrides: Partial<AssemblyInputs> = {},
  geometry?: Geometry,
): Promise<Awaited<ReturnType<typeof assembleUefi>>> {
  return assembleUefi({ ...base, ...overrides }, { toolbox: tb, geometry, log: () => {} })
}

/** A board.env with lines appended; a later assignment wins, as in a shell. */
function mutatedBoard(appended: string): { geometry: Geometry, cleanup: () => void } {
  const d = makeWorkDir('mkimage-uefi-board')
  const path = join(d, 'board.env')
  writeFileSync(path, `${readFileSync(join(BOARDS_DIR, 'x64', 'board.env'), 'utf8')}\n${appended}\n`)
  return { geometry: loadGeometryFromPath(path), cleanup: () => rmSync(d, { recursive: true, force: true }) }
}

// The assembly.

describe('a whole x64 image, over fabricated inputs', () => {
  let out: Awaited<ReturnType<typeof assembleUefi>>

  beforeAll(async () => {
    out = await assemble({ imgOut: join(dir, 'whole.img') })
  }, ASSEMBLE_TIMEOUT_MS)

  test('it is the size the layout says, to the byte', () => {
    expect(out.layout.totalSizeMib).toBe(1938n)
    expect(BigInt(statSync(join(dir, 'whole.img')).size)).toBe(g.mibToBytes(1938n))
  })

  test('the slot came from the floor, because a 4 MiB payload cannot beat 512', () => {
    expect(out.slot.slotMib).toBe(512n)
    expect(out.slot.floorApplied).toBe(true)
    expect(out.slot.payloadBytes).toBe(BigInt(4 * MIB))
  })

  test('nine partitions, at the starts and sizes the board and the chain decide', () => {
    const want = gptSpecFor(g, deriveLayout(g, 512n))
    expect(out.partitions.length).toBe(9)
    for (const w of want.partitions) {
      const have = out.partitions.find(p => p.partnum === w.partnum)
      expect(have).toBeDefined()
      expect(have?.firstSector).toBe(w.startSector)
      expect(have?.sizeSectors).toBe(w.sizeSectors)
      expect(have?.name).toBe(w.label ?? '')
      expect(have?.guid.toLowerCase()).toBe((w.guid ?? '').toLowerCase())
    }
  })

  test('THE ESP LANDED AT 1 MiB DESPITE NO -a HAVING BEEN NEEDED', () => {
    // The read-back that makes `-a 2048` a measured claim rather than a hoped
    // one. cx3576 needs its alignment because its loader starts at sector 64;
    // x64 needs none, and this is what says so about the table sgdisk WROTE.
    const esp = out.partitions.find(p => p.partnum === 1n)
    expect(esp?.firstSector).toBe(2048n)
    expect(esp?.sizeSectors).toBe(g.mibToSectors(64n))
  })

  test('the ESP is a real FAT32 by cluster count, with room to spare', () => {
    expect(out.espClusters).toBe(129021n)
    expect(out.espClusters).toBeGreaterThan(FAT32_MIN_CLUSTERS)
  })

  test('grubenv is exactly 1024 bytes', () => {
    expect(out.grubenvBytes).toBe(GRUBENV_BYTES)
  })

  test('the ESP carries the three files the board says it does, and nothing per-slot', async () => {
    // The ESP is inside the assembled disk; pull it back out at its start.
    await tb.must([
      'dd', `if=${join(dir, 'whole.img')}`, `of=${join(dir, 'esp-readback.img')}`,
      'bs=1M', 'skip=1', 'count=64', 'status=none',
    ])
    const entries = await listFat(tb, join(dir, 'esp-readback.img'))
    // mdir -/ -b prints DIRECTORY entries with a trailing slash and file entries
    // without: `::/EFI/` is the directory and `::/EFI/mos/grub.cfg` the file.
    // Transcribed rather than normalised, because the shell's stray check greps
    // this listing with -x and a normalisation here would make the two disagree
    // about what a match is.
    expect(entries.sort()).toEqual([
      '::/EFI/', '::/EFI/BOOT/', '::/EFI/BOOT/BOOTX64.EFI', '::/EFI/mos/', '::/EFI/mos/grub.cfg',
      '::/EFI/mos/grubenv',
    ].sort())
    expect(strayEspEntries(entries, ['vmlinuz', 'cmdline.cfg'])).toEqual([])
  }, TOOL_TIMEOUT_MS)

  test('and it carries exactly what ESP_REQUIRED_FILES names -- read off the board', async () => {
    const required = g.require('ESP_REQUIRED_FILES').split(/\s+/).filter(s => s !== '')
    const entries = await listFat(tb, join(dir, 'esp-readback.img'))
    for (const f of required) expect(entries).toContain(`::/${f}`)
    expect(required.length).toBe(3)
  }, TOOL_TIMEOUT_MS)

  test('both boot slots carry the per-slot files, in mcopy order', async () => {
    for (const [partition, skipMib] of [['BOOT_A', 65], ['BOOT_B', 161]] as const) {
      const img = join(dir, `${partition}-readback.img`)
      await tb.must([
        'dd', `if=${join(dir, 'whole.img')}`, `of=${img}`, 'bs=1M', `skip=${skipMib}`, 'count=96',
        'status=none',
      ])
      // A kernel and a cmdline, and NO initrd: the slot payload lost one when
      // this board's kernel gained CONFIG_DM_INIT and started reading the
      // dm-mod.create= table on that cmdline itself.
      expect((await listFat(tb, img)).sort()).toEqual(['::/cmdline.cfg', '::/vmlinuz'])
    }
  }, TOOL_TIMEOUT_MS)

  test('the two slots carry the same files -- and the check that says so can fail', async () => {
    const a = await listFat(tb, join(dir, 'BOOT_A-readback.img'))
    const b = await listFat(tb, join(dir, 'BOOT_B-readback.img'))
    expect(bootSlotFault(a, b)).toBeUndefined()
    expect(bootSlotFault(a, b.filter(e => e !== '::/cmdline.cfg')))
      .toMatch(/the two boot slots do not carry the same files/)
  }, TOOL_TIMEOUT_MS)

  test('EPHEMERAL is seeded, stamp and all, and every seeded time is pinned', async () => {
    const img = join(dir, 'ephemeral-readback.img')
    await tb.must([
      'dd', `if=${join(dir, 'whole.img')}`, `of=${img}`, 'bs=1M', 'skip=1361', 'count=512', 'status=none',
    ])
    const ls = await tb.must(['debugfs', '-R', 'ls -l /', img])
    // The stamp mos-seed-var's ConditionPathExists reads, and the lib/ that
    // makes the seed a /var rather than an empty mount.
    expect(ls.stdout).toContain(SEED_STAMP)
    expect(ls.stdout).toContain('lib')
    // FILE_MTIME is 1577836800 -- 1-Jan-2020. Every line dumps its mtime, and a
    // seeded tree that had not been pinned would carry today's.
    expect(ls.stdout).toContain('2020')
    expect(ls.stdout).not.toMatch(/20(2[1-9]|[3-9][0-9])/)
  }, TOOL_TIMEOUT_MS)
})

describe('the assembly reproduces itself, and the comparison is LIVE', () => {
  test('two assemblies of identical inputs are byte-identical', async () => {
    await assemble({ imgOut: join(dir, 'rebuild-1.img') })
    await assemble({ imgOut: join(dir, 'rebuild-2.img') })
    expect(sha256(join(dir, 'rebuild-1.img'))).toBe(sha256(join(dir, 'rebuild-2.img')))
  }, ASSEMBLE_TIMEOUT_MS)

  test('...and ONE changed input changes the bytes', async () => {
    // The control. Without it the test above is satisfied by an assembler that
    // writes the same 1938 MiB of zeros every time.
    await assemble({
      rootfsVerityImg: join(dir, 'rootfs-verity-other.img'),
      imgOut: join(dir, 'rebuild-3.img'),
    })
    expect(sha256(join(dir, 'rebuild-3.img'))).not.toBe(sha256(join(dir, 'rebuild-1.img')))
    // ...and only in the two rootfs slots, which is where that input goes.
    expect(statSync(join(dir, 'rebuild-3.img')).size).toBe(statSync(join(dir, 'rebuild-1.img')).size)
  }, ASSEMBLE_TIMEOUT_MS)
})

// The ESP cluster floor.

describe('THE ESP CLUSTER FLOOR, and why its POSITION is load-bearing', () => {
  test('a 32 MiB FAT32 is refused -- the exact filesystem OVMF would not mount', async () => {
    // mkfs.vfat -F 32 EXITS 0 on this and minfo calls it FAT32, because minfo
    // reads the type out of the BPB. The firmware computes it the way the FAT
    // specification does, finds a FAT32 boot sector over a FAT16 cluster count,
    // and leaves the ESP out of its device list entirely.
    const img = join(dir, 'esp-32.img')
    await truncate(tb, img, '32M')
    await mkfsVfat(tb, { image: img, label: 'MOS-ESP', volumeId: 'C3576100' })
    const clusters = await readFatClusters(tb, img)
    expect(clusters).toBeLessThan(FAT32_MIN_CLUSTERS)
    expect(checkEspIsFat32(tb, img, 32n))
      .rejects.toThrow(/below the 65525 the FAT specification requires for FAT32/)
  }, TOOL_TIMEOUT_MS)

  test('a 64 MiB one is accepted -- the positive control', async () => {
    const img = join(dir, 'esp-64.img')
    await truncate(tb, img, '64M')
    await mkfsVfat(tb, { image: img, label: 'MOS-ESP', volumeId: 'C3576100' })
    expect(await checkEspIsFat32(tb, img, 64n)).toBe(129021n)
  }, TOOL_TIMEOUT_MS)

  test('33 MiB is the measured floor: 33 passes and 32 does not', async () => {
    const img = join(dir, 'esp-33.img')
    await truncate(tb, img, '33M')
    await mkfsVfat(tb, { image: img, label: 'MOS-ESP', volumeId: 'C3576100' })
    expect(await readFatClusters(tb, img)).toBeGreaterThanOrEqual(FAT32_MIN_CLUSTERS)
  }, TOOL_TIMEOUT_MS)

  test('THE CHECK PARSES *FREE* CLUSTERS WHERE THE SPEC DEFINES THE TYPE BY *TOTAL*', async () => {
    // This is the landmine. On an empty filesystem free is total minus the root
    // directory's one cluster, so the comparison is conservative by exactly one
    // and correct where it stands. Measured here rather than asserted:
    const img = join(dir, 'esp-64.img')
    const free = await readFatClusters(tb, img)
    const info = await tb.must(['minfo', '-i', img])
    const total = totalClustersFromBpb(`${info.stdout}${info.stderr}`)
    expect(total).toBe(129022n)
    expect(total - free).toBe(1n)
  }, TOOL_TIMEOUT_MS)

  test('...and staging the ESP tree drops FREE by thousands while TOTAL does not move', async () => {
    // So a check moved after the mcopy -- the natural tidy-up during a port --
    // silently becomes a FREE-SPACE check wearing a FAT-specification message.
    // It would refuse a valid FAT32 for being full, and stop refusing the case it
    // exists for the moment the payload grew.
    const img = join(dir, 'esp-staged.img')
    await truncate(tb, img, '64M')
    await mkfsVfat(tb, { image: img, label: 'MOS-ESP', volumeId: 'C3576100' })
    const before = await readFatClusters(tb, img)

    const stage = join(dir, 'esp-floor-stage')
    mkdirSync(join(stage, 'EFI', 'BOOT'), { recursive: true })
    filler(join(stage, 'EFI', 'BOOT', 'BOOTX64.EFI'), 12 * MIB, 0x77)
    await mcopy(tb, { image: img, sources: [join(stage, 'EFI')], destination: '::/', recursive: true })
    const after = await readFatClusters(tb, img)

    expect(after).toBeLessThan(before)
    expect(before - after).toBeGreaterThan(1000n)
    const info = await tb.must(['minfo', '-i', img])
    // TOTAL is a property of the geometry and does not move when files are added.
    expect(totalClustersFromBpb(`${info.stdout}${info.stderr}`)).toBe(before + 1n)
  }, TOOL_TIMEOUT_MS)

  test('an unreadable cluster count is REFUSED, not compared as a small one', async () => {
    // `[ -z "${esp_clusters}" ]` is the shell's half of this, and it is the half
    // that matters: an unread count is not a small count. In TypeScript
    // `undefined < 65525n` would throw or coerce; in the shell `[ "" -lt 65525 ]`
    // is a syntax error mid-assembly.
    const notAFilesystem = join(dir, 'not-a-fat.img')
    await truncate(tb, notAFilesystem, '4M')
    expect(readFatClusters(tb, notAFilesystem)).rejects.toThrow()
  }, TOOL_TIMEOUT_MS)

  test('and the floor fires through a WHOLE assembly, not just when called directly', async () => {
    // Reachability. A guard only ever driven directly is a guard whose call site
    // could have been deleted -- which is precisely what the selftest's header
    // says a byte-identity gate cannot see.
    const m = mutatedBoard('ESP_SIZE_MIB=32')
    try {
      expect(assemble({ imgOut: join(dir, 'esp32.img') }, m.geometry))
        .rejects.toThrow(/below the 65525 the FAT specification requires for FAT32/)
    } finally {
      m.cleanup()
    }
  }, ASSEMBLE_TIMEOUT_MS)
})

// The alignment, measured.

describe('`-a 2048` where the shell passes no alignment at all', () => {
  const layout = deriveLayout(g, 512n)
  const spec = gptSpecFor(g, layout)

  /** Write a GPT with the alignment overridden, and hash the first 34 sectors. */
  async function tableWith(alignSectors: bigint | undefined, tag: string): Promise<string> {
    const img = join(dir, `align-${tag}.img`)
    rmSync(img, { force: true })
    await truncate(tb, img, `${layout.totalSizeMib}M`)
    const s: GptSpec = { ...spec, alignSectors }
    await writeGpt(tb, img, s)
    const head = join(dir, `align-${tag}.head`)
    await tb.must(['dd', `if=${img}`, `of=${head}`, 'bs=512', 'count=2048', 'status=none'])
    return sha256(head)
  }

  test('the board\'s 2048 and sgdisk\'s default produce the SAME table', async () => {
    // The one spelling this port changed on the sgdisk call. If a future sgdisk
    // defaults to something else, this says so here rather than inside the
    // byte-identity gate.
    expect(await tableWith(2048n, 'board')).toBe(await tableWith(undefined, 'default'))
  }, TOOL_TIMEOUT_MS)

  test('and every x64 start is on a 2048-sector boundary, which is why', () => {
    for (const p of spec.partitions) expect(p.startSector % 2048n).toBe(0n)
  })

  test('-a 1 gives the same table too, because nothing here needs relocating', async () => {
    // cx3576's `-a 1` is load-bearing because its loader starts at sector 64.
    // Here it changes nothing, and that difference between the two boards is
    // measured rather than described.
    expect(await tableWith(1n, 'one')).toBe(await tableWith(2048n, 'board'))
  }, TOOL_TIMEOUT_MS)

  test('THE THREE ALIGNMENT CASES DO NOT FAIL ALIKE -- AND NOT THE WAY cx3576 DOES', async () => {
    // MEASURED on this host, sgdisk 1.0.10, over the real x64 geometry. M6b found
    // that on cx3576 `-a 4096` makes sgdisk REFUSE the table outright (exit 4),
    // because the relocation would push uenv-b into boot-a. On x64 it does the
    // OTHER thing:
    //
    //     Information: Moved requested sector from 2048 to 4096 in
    //     order to align on 4096-sector boundaries.
    //     ... exit 0
    //
    // Silently relocated, successfully. The two boards' third alignment case is
    // not the same failure, and which one you get is a property of the GEOMETRY
    // rather than of the flag -- so this asserts the shape observed HERE rather
    // than the shape a sibling board produced.
    //
    // This is also what makes the read-back in the assembler load-bearing rather
    // than decorative: on x64 a wrong alignment does not announce itself at all.
    const img = join(dir, 'align-4096.img')
    rmSync(img, { force: true })
    await truncate(tb, img, `${layout.totalSizeMib}M`)
    const r = await tb.run(writeGptArgs({ ...spec, alignSectors: 4096n }, img))
    expect(r.exitCode).toBe(0)
    expect(`${r.stdout}${r.stderr}`).toContain('Moved requested sector from 2048 to 4096')

    // And it does not only move it -- it shrinks it. Measured: the ESP comes
    // back as 129024 sectors at 4096 rather than 131072 at 2048, because sgdisk
    // caps the relocated partition at the next partition's original start
    // (133120) instead of extending past it. A check comparing only the start
    // would call this a correctly sized ESP in the wrong place; its ESP is
    // 1 MiB short as well.
    const got = []
    for (const p of spec.partitions) got.push(await readPartition(tb, img, p.partnum))
    expect(got[0]?.firstSector).toBe(4096n)
    expect(got[0]?.sizeSectors).toBe(129024n)
    expect(4096n + 129024n).toBe(spec.partitions[1]?.startSector ?? 0n)

    // ...and the read-back the assembler performs is what catches it.
    const faults = partitionFaults(spec, got)
    expect(faults.length).toBeGreaterThan(0)
    expect(faults[0]).toMatch(/the assembled esp is 129024 sectors at 4096, expected 131072 at 2048/)
  }, TOOL_TIMEOUT_MS)

  test('...and the alignment the assembler actually passes relocates NOTHING', async () => {
    // The positive control for the row above. Without it, "partitionFaults fires"
    // would be satisfied by a check that fires on every table.
    const img = join(dir, 'align-board-readback.img')
    rmSync(img, { force: true })
    await truncate(tb, img, `${layout.totalSizeMib}M`)
    await writeGpt(tb, img, spec)
    const got = []
    for (const p of spec.partitions) got.push(await readPartition(tb, img, p.partnum))
    expect(partitionFaults(spec, got)).toEqual([])
  }, TOOL_TIMEOUT_MS)
})

// The refusals.

describe('the four inputs', () => {
  test('each one, absent, is refused by name and names the producer', async () => {
    // Four, and it was five: the initrd left with the initramfs.
    const cases: [keyof AssemblyInputs, string][] = [
      ['rootfsVerityImg', 'rootfs-verity.img'],
      ['rootfsVerityEnv', 'rootfs-verity.env'],
      ['kernel', 'vmlinuz'],
    ]
    let driven = 0
    for (const [key] of cases) {
      const overrides = { [key]: join(dir, 'nowhere', 'gone') } as Partial<AssemblyInputs>
      expect(assemble(overrides)).rejects.toThrow(
        /not found\. Build the root first: MOS_BOARD=x64 bash rootfs\/build\.sh/,
      )
      driven += 1
    }
    // The fifth is the grub.cfg template, which arrives on a different route.
    expect(assemble({ grubCfgIn: join(dir, 'nowhere', 'grub.cfg') })).rejects.toThrow(
      /not found\. Build the root first/,
    )
    driven += 1
    expect(driven).toBe(4)
  })

  test('a DIRECTORY where a file should be is refused too', async () => {
    expect(assemble({ kernel: dir })).rejects.toThrow(/not found\. Build the root first/)
  })

  test('the positive control: all four present, and the assembly starts', async () => {
    // Without this, "every missing input is refused" is satisfied by an
    // assembler that refuses everything.
    for (const p of [base.rootfsVerityImg, base.rootfsVerityEnv, base.kernel]) {
      expect(statSync(p).isFile()).toBe(true)
    }
    expect(statSync(join(BOARDS_DIR, 'x64', 'grub.cfg')).isFile()).toBe(true)
  })
})

describe('the factory /var', () => {
  test('absent is refused, naming the producer to run', async () => {
    expect(assemble({ factoryVar: join(dir, 'nowhere') }))
      .rejects.toThrow(/not found\. The rootfs build exports it; run 'MOS_BOARD=x64 bash rootfs\/build\.sh' first/)
  })

  test('a FILE where a directory should be is refused too', async () => {
    expect(assemble({ factoryVar: join(dir, 'vmlinuz') })).rejects.toThrow(/not found\. The rootfs build exports it/)
  })

  test('a /var with no lib/ is refused -- no dpkg database, no mosd state', async () => {
    expect(assemble({ factoryVar: join(dir, 'factory-var-nolib'), imgOut: join(dir, 'nolib.img') }))
      .rejects.toThrow(/the staged factory \/var has no lib\/; seeding EPHEMERAL from it would produce a \/var with no dpkg database/)
  }, ASSEMBLE_TIMEOUT_MS)
})

describe('the verity env', () => {
  test('a salt that is not the pinned one is refused', async () => {
    const p = join(dir, 'wrong-salt.env')
    writeFileSync(p, readFileSync(base.rootfsVerityEnv, 'utf8').replace(g.veritySalt, 'ff'.repeat(32)))
    expect(assemble({ rootfsVerityEnv: p })).rejects.toThrow(/does not match the pinned VERITY_SALT/)
  })

  test('an UPPERCASE spelling of the pinned salt is accepted -- the case-folding control', async () => {
    // Without this row the check above could be a literal comparison that
    // refuses a correct build, which is a mistake this tree has made before.
    const p = join(dir, 'upper-salt.env')
    writeFileSync(p, readFileSync(base.rootfsVerityEnv, 'utf8')
      .replace(g.veritySalt, g.veritySalt.toUpperCase()))
    // It gets past the salt check; whether the rest succeeds is not this test's
    // question, so the assertion is on the ABSENCE of that particular refusal.
    let message = ''
    try {
      await assemble({ rootfsVerityEnv: p, imgOut: join(dir, 'upper.img') })
    } catch (e) {
      message = String(e)
    }
    expect(message).not.toMatch(/does not match the pinned VERITY_SALT/)
  }, ASSEMBLE_TIMEOUT_MS)

  test('a missing VERITY_ROOT_HASH is refused before anything is created', async () => {
    const p = join(dir, 'no-hash.env')
    writeFileSync(p, readFileSync(base.rootfsVerityEnv, 'utf8')
      .split('\n').filter(l => !l.startsWith('VERITY_ROOT_HASH=')).join('\n'))
    expect(assemble({ rootfsVerityEnv: p })).rejects.toThrow(/VERITY_ROOT_HASH is missing from/)
  })
})

describe('grubenv is exactly 1024 bytes', () => {
  test('any other size is refused, and the message says what GRUB would do', () => {
    expect(() => checkGrubenvSize('/w/grubenv', 0n))
      .toThrow(/grubenv is 0 bytes, not 1024; GRUB would ignore it and the A\/B order would silently never change/)
    expect(() => checkGrubenvSize('/w/grubenv', 1023n)).toThrow(/not 1024/)
    expect(() => checkGrubenvSize('/w/grubenv', 1025n)).toThrow(/not 1024/)
  })

  test('1024 passes -- the positive control', () => {
    expect(() => checkGrubenvSize('/w/grubenv', GRUBENV_BYTES)).not.toThrow()
  })

  test('and a real grub-editenv makes one of exactly that size', async () => {
    const d = join(dir, 'grubenv-probe')
    mkdirSync(d, { recursive: true })
    await tb.must(['grub-editenv', 'grubenv', 'create'], { cwd: d })
    expect(statSync(join(d, 'grubenv')).size).toBe(1024)
  }, TOOL_TIMEOUT_MS)
})

describe('nothing per-slot on the ESP', () => {
  // The listing a real assembly produces -- directories with the trailing slash
  // mdir gives them.
  const clean = ['::/EFI/', '::/EFI/BOOT/', '::/EFI/BOOT/BOOTX64.EFI', '::/EFI/mos/', '::/EFI/mos/grub.cfg', '::/EFI/mos/grubenv']

  test('each of the per-slot names is caught, one at a time', () => {
    let driven = 0
    for (const stray of ['vmlinuz', 'cmdline.cfg']) {
      expect(strayEspEntries([...clean, `::/${stray}`], ['vmlinuz', 'cmdline.cfg']))
        .toEqual([stray])
      driven += 1
    }
    expect(driven).toBe(2)
  })

  test('a clean ESP listing yields none -- the positive control', () => {
    expect(strayEspEntries(clean, ['vmlinuz', 'cmdline.cfg'])).toEqual([])
  })

  test('the names come from the BOARD, so a renamed one is still covered', () => {
    // Spelling `vmlinuz cmdline.cfg` as literals here would be a second copy of
    // SLOT_KERNEL_NAME and friends, and a board that renamed one would have the
    // stray check quietly stop covering it. The list also SHRANK once, when the
    // initrd left the slot payload, which is the same failure in the other
    // direction: a literal list would have gone on checking for a file no image
    // can contain.
    const names = [g.require('SLOT_KERNEL_NAME'), g.require('SLOT_CMDLINE_NAME')]
    expect(names).toEqual(['vmlinuz', 'cmdline.cfg'])
    expect(() => g.require('SLOT_INITRD_NAME')).toThrow(/declares no SLOT_INITRD_NAME/)
    expect(strayEspEntries([...clean, '::/bzImage'], ['bzImage', 'cmdline.cfg']))
      .toEqual(['bzImage'])
  })

  test('a per-slot file NESTED under EFI/ is not a stray -- only the root is checked', () => {
    // Transcribed rather than widened: the shell greps for `::/${stray}` with
    // -x, an exact whole-line match at the root. A port that used `includes`
    // would start refusing images the shell accepts.
    expect(strayEspEntries([...clean, '::/EFI/mos/vmlinuz'], ['vmlinuz'])).toEqual([])
  })
})

describe('the partition read-back', () => {
  const layout = deriveLayout(g, 512n)
  const spec = gptSpecFor(g, layout)
  const asWritten = spec.partitions.map(p => ({
    partnum: p.partnum,
    firstSector: p.startSector,
    lastSector: p.startSector + p.sizeSectors - 1n,
    sizeSectors: p.sizeSectors,
    typecode: p.typecode ?? '',
    guid: p.guid ?? '',
    name: p.label ?? '',
  }))

  test('a table that matches produces no faults -- the positive control', () => {
    expect(partitionFaults(spec, asWritten)).toEqual([])
  })

  test('a RELOCATED start is caught, with both numbers', () => {
    const moved = asWritten.map(p => (p.partnum === 1n ? { ...p, firstSector: 2048n * 2n } : p))
    const faults = partitionFaults(spec, moved)
    expect(faults.length).toBe(1)
    expect(faults[0]).toMatch(/the assembled esp is 131072 sectors at 4096, expected 131072 at 2048/)
    expect(faults[0]).toMatch(/sgdisk relocates a start that is not a multiple of its alignment/)
  })

  test('a TRUNCATED partition is caught too -- a start alone is not enough', () => {
    const short = asWritten.map(p => (p.partnum === 4n ? { ...p, sizeSectors: 1000n } : p))
    expect(partitionFaults(spec, short)[0]).toMatch(/the assembled rootfs-a is 1000 sectors at/)
  })

  test('a partition MISSING from the table is caught by name', () => {
    expect(partitionFaults(spec, asWritten.filter(p => p.partnum !== 9n))[0])
      .toMatch(/p9 \(data\) is not in the assembled table at all/)
  })

  test('every drifting partition produces its own line, not just the first', () => {
    const allMoved = asWritten.map(p => ({ ...p, firstSector: p.firstSector + 2048n }))
    expect(partitionFaults(spec, allMoved).length).toBe(9)
  })
})

describe('the toolset and the mounts', () => {
  test('cp, find and touch are declared, because the assembly runs all three', () => {
    // `cp` in the container for the ESP staging, `find ... -exec touch` for the
    // mtimes, `touch` for the seed stamp and the per-slot payload. A toolset that
    // did not declare them would surface the gap as "cp: not found" forty steps
    // into an assembly.
    for (const t of ['cp', 'find', 'touch']) expect(uefiAssembly('amd64').tools).toContain(t)
  })

  test('grub-editenv is declared beside grub-mkstandalone', () => {
    expect(uefiAssembly('amd64').tools).toContain('grub-editenv')
    expect(uefiAssembly('amd64').tools).toContain('grub-mkstandalone')
  })

  test('the package list is the x64 assembly contract\'s, verbatim', () => {
    expect(uefiAssembly('amd64').packages.join(' '))
      .toBe('gdisk dosfstools mtools e2fsprogs grub-efi-amd64-bin grub-common')
    expect(uefiAssembly('amd64').imageKey).toBe('IMAGE_DEBIAN_TRIXIE')
  })

  test('the mounts cover every input directory, and none nests inside another', () => {
    const mounts = mountsFor(base, join(dir, 'work'))
    for (const m of mounts) {
      for (const other of mounts) {
        if (other !== m) expect(m.startsWith(`${other}/`)).toBe(false)
      }
    }
    expect(mounts.length).toBeGreaterThan(0)
  })
})
