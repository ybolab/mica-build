// The image-shape and file-capability family, driven from the failing side.
//
// Four conclusions per board, and two of them are awkward to express: the
// partition COUNT, which has no board-independent substring, and the capability
// comparison, whose passing direction on both shipped images is "both empty".

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBoard, type Board } from './board.ts'
import { capsFromReport, SHAPE_CHECKS_ALL } from './checks-shape.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import { walkLayout } from './layout.ts'
import { boardEnvPath, REPO_ROOT } from './paths.ts'
import type { CheckResult } from './parity.ts'
import { runChecked, ToolOutputError, type ToolResult, type ToolRuntime } from './tools.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))
const SLOT = { cx3576: 524288, x64: 1048576 } as const

// CREATED AND REMOVED BY THE SAME CONDITION, which is what a `-t` filter broke.
// `mkdtempSync` at MODULE SCOPE ran in every file bun LOADED, but `afterAll`
// runs only in a file that has a MATCHING test -- so a filtered run created
// four scratch directories and removed one, leaving exactly the `_out/verify-*`
// drift image.test.ts's own comment says was fixed. Measured 2026-08-26:
// `run.sh -t 'the partition count'` left verify-bootchain-*, verify-cmdline-*
// and verify-test-* behind. `process.on('exit')` does NOT close it -- driven on
// bun 1.4.0, the handler never fires under the test runner, filtered or not.
// A top-level `beforeAll` does: it is skipped by exactly the condition that
// skips `afterAll`, so the pair is symmetric again.
let SCRATCH = ''
beforeAll(() => {
  mkdirSync(join(REPO_ROOT, '_out'), { recursive: true })
  SCRATCH = mkdtempSync(join(REPO_ROOT, '_out', 'verify-shape-'))
})
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

/**
 * The scratch directory, refusing to be read before `beforeAll` made it.
 *
 * `join('', 'w1')` is `'w1'` -- a RELATIVE path, so a read that outran the hook
 * would write fixtures into the process cwd and the tests would pass, which is
 * the failure this package exists to catch rather than commit.
 */
function scratch(): string {
  if (SCRATCH === '') {
    throw new Error('the scratch directory was read before beforeAll created it')
  }
  return SCRATCH
}

interface World {
  readonly board: Board
  /** The name the default path is a symlink to, or undefined for a real file. */
  link?: string
  /** How many partitions the IMAGE's table carries. Defaults to the layout's. */
  partitions?: number
  /** `_out/<board>/rootfs-report.txt`, or absent. */
  report?: string
  /** What `getcap -r ROOT` prints on stdout, root-prefixed by the fixture. */
  packedCaps?: readonly string[]
  /** Whether setcap/getcap round-trip in this environment. */
  capsObservable?: boolean
}

let seq = 0

function fixture(world: World): { ctx: ImageContext, dispose: () => void } {
  const board = world.board
  const dir = join(scratch(), `w${seq += 1}`)
  mkdirSync(dir, { recursive: true })
  const outDir = join(dir, 'out')
  mkdirSync(outDir, { recursive: true })
  if (world.report !== undefined) writeFileSync(join(outDir, 'rootfs-report.txt'), world.report)
  const root = join(dir, 'root')
  mkdirSync(root, { recursive: true })

  const image = join(dir, `${board.get('IMAGE_LATEST_NAME')}`)
  if (world.link === undefined) writeFileSync(image, '')
  else symlinkSync(world.link, image)

  const walk = walkLayout(board, SLOT[board.name as 'cx3576' | 'x64'])
  if (world.partitions !== undefined && world.partitions > walk.rows.length) {
    // The same class of no-op `mutate` refuses in checks-bootchain.test.ts: a
    // slice can only ever REMOVE rows, so asking for more than the layout
    // declares would silently produce an unmutated table and a green check.
    throw new Error(`${board.name} declares ${walk.rows.length} partitions; a fixture cannot have `
      + `${world.partitions}, and asking for them would leave the table unmutated`)
  }
  const rows = walk.rows.slice(0, world.partitions ?? walk.rows.length)
  const partitions = rows.map(r => ({
    number: r.number,
    firstSector: r.startSector,
    lastSector: r.startSector + r.sizeSectors - 1,
    sizeSectors: r.sizeSectors,
    typeGuid: r.typecode,
    uniqueGuid: r.guid,
    name: r.label,
    attributeFlags: '0000000000000000',
  }))

  const exec = async (argv: readonly string[]): Promise<ToolResult> => {
    const line = argv.join(' ')
    if (line.startsWith('sh -c : > ')) return { argv, code: 0, stdout: '', stderr: '' }
    if (line.startsWith('setcap ')) {
      return world.capsObservable === false
        ? { argv, code: 1, stdout: '', stderr: 'Failed to set capabilities on file\n' }
        : { argv, code: 0, stdout: '', stderr: '' }
    }
    if (line.startsWith('getcap -r ')) {
      const body = (world.packedCaps ?? []).map(c => `${root}${c}`).join('\n')
      return { argv, code: 0, stdout: body === '' ? '' : `${body}\n`, stderr: '' }
    }
    if (line.startsWith('getcap ')) {
      // The probe file. It reads back what setcap wrote unless this environment
      // silently drops security.* xattrs -- which is the case the probe exists
      // for and which reads EXACTLY like a rootfs with no capabilities.
      return world.capsObservable === false
        ? { argv, code: 0, stdout: '', stderr: '' }
        : { argv, code: 0, stdout: `${argv[1]} cap_net_raw=ep\n`, stderr: '' }
    }
    throw new Error(`the stub has no transcript for: ${line}`)
  }

  const refuse = (what: string): never => {
    throw new ToolOutputError(`the shape fixture has no ${what}.`)
  }
  const ctx: ImageContext = {
    board,
    image,
    tools: { route: 'host', announce: 'stub', run: (a, o) => runChecked(exec, a, o), dispose: async () => {} },
    workDir: dir,
    outDir,
    caDir: join(dir, 'ca'),
    gpt: async () => ({
      image,
      sectorSize: board.sectorSize ?? 512,
      diskGuid: board.get('DISK_GUID') ?? '',
      totalSectors: walk.totalSizeMib * walk.sectorsPerMib,
      partitions,
      partition: (n: number) => partitions.find(p => p.number === n),
    }),
    partition: async () => refuse('partition lookup'),
    fatSlot: async () => refuse('FAT slots'),
    extract: async () => refuse('extracted payloads'),
    extractAt: async () => refuse('image byte ranges'),
    unpackRoot: async () => root,
  }
  return { ctx, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

function checkNamed(id: string): CheckCase {
  const found = SHAPE_CHECKS_ALL.find(c => c.id === id)
  if (found === undefined) throw new Error(`no shape check is registered as '${id}'`)
  return found
}

async function drive(id: string, world: World): Promise<CheckResult> {
  const fx = fixture(world)
  try {
    const first = (await checkNamed(id).run(fx.ctx))[0]
    if (first === undefined) throw new Error('the check concluded nothing')
    return first
  }
  finally {
    fx.dispose()
  }
}

const REPORT_EMPTY = `== summary ==
paths 4354

== file capabilities ==

== setuid/setgid (mode uid gid path; identical in source tree and packed image) ==
4755 0 0 /usr/bin/su
`

const REPORT_TWO = `== file capabilities ==
/usr/bin/ping cap_net_raw=ep
/usr/bin/dumpcap cap_net_admin,cap_net_raw=eip

== setuid/setgid (mode uid gid path; identical in source tree and packed image) ==
`

// ── the default path ──────────────────────────────────────────────────────

describe('image-default-path-symlink', () => {
  test('green when the default path is a symlink to a timestamped image', async () => {
    for (const [board, name] of [[cx3576, 'cx3576-mos-1787661246.img'],
      [x64, 'x64-mos-1787660533.img']] as const) {
      const r = await drive('image-default-path-symlink', { board, link: name })
      expect(r.verdict).toBe('pass')
      expect(r.message).toBe(`default path is a symlink to ${name}`)
    }
  })

  test('RED when the default path is a REAL FILE rather than a link', async () => {
    // The shape an assembler produces when it writes the image straight to the
    // -latest name: the previous build is gone and nothing records which build
    // this is.
    const r = await drive('image-default-path-symlink', { board: cx3576 })
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('got: not a symlink')
  })

  test('RED when the link names something that is not a timestamped image', async () => {
    const r = await drive('image-default-path-symlink', { board: cx3576, link: 'cx3576-mos-dev.img' })
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('cx3576-mos-<epoch>.img')
  })

  test('RED on the OTHER board\'s image name, which is a real assembly mistake', async () => {
    const r = await drive('image-default-path-symlink', { board: cx3576, link: 'x64-mos-1787660533.img' })
    expect(r.verdict).toBe('fail')
  })

  test('a leading ./ is stripped, as the oracle strips it', async () => {
    const r = await drive('image-default-path-symlink', { board: x64, link: './x64-mos-1787660533.img' })
    expect(r.verdict).toBe('pass')
    expect(r.message).toBe('default path is a symlink to x64-mos-1787660533.img')
  })
})

// ── the partition count ───────────────────────────────────────────────────

describe('the partition count, as one entry per board', () => {
  test('the counts are DERIVED from each board\'s own LAYOUT_PARTITIONS', () => {
    // The register entry the campaign could not write until now. It is a
    // derivation and not a literal: the matcher's number comes from the same
    // list the oracle counts, so a board that changed its layout changes both
    // sides at once.
    const cx = checkNamed('gpt-partition-count-cx3576')
    const x = checkNamed('gpt-partition-count-x64')
    expect(cx.shell.pass).toBe(`exactly ${(cx3576.layoutPartitions ?? []).length} partitions`)
    expect(x.shell.pass).toBe(`exactly ${(x64.layoutPartitions ?? []).length} partitions`)
    expect(cx.shell.pass).not.toBe(x.shell.pass)
    expect(cx.boards).toEqual(['cx3576'])
    expect(x.boards).toEqual(['x64'])
  })

  test('green when the image carries exactly what the layout declares', async () => {
    expect((await drive('gpt-partition-count-cx3576', { board: cx3576 })).verdict).toBe('pass')
    expect((await drive('gpt-partition-count-x64', { board: x64 })).verdict).toBe('pass')
  })

  test('RED when the image is one partition short', async () => {
    // The shape an assembler produces when a partition is added to the layout
    // and not to the sgdisk run: every check that walks by NUMBER then reads
    // the wrong entry, which is how this became eleven rather than ten.
    const r = await drive('gpt-partition-count-cx3576', { board: cx3576, partitions: 10 })
    expect(r.verdict).toBe('fail')
    expect(r.message).toBe('found 10 partitions, expected 11')
  })

  test('RED when a cx3576 image carries x64\'s NINE partitions', async () => {
    // The failure that produced this check: `EXPECT_PARTS=11` was the cx3576
    // number written into a script both boards run, and `MOS_BOARD=x64` died
    // four checks in on `LOADER_PARTNUM: unbound variable` rather than
    // reporting a difference.
    const r = await drive('gpt-partition-count-cx3576', { board: cx3576, partitions: 9 })
    expect(r.verdict).toBe('fail')
    expect(r.message).toBe('found 9 partitions, expected 11')
  })

  test('the fixture REFUSES to ask for more partitions than the layout declares', () => {
    // Because a slice can only remove rows: the table would come out unmutated
    // and the case would report a green as a caught failure.
    expect(() => fixture({ board: x64, partitions: 11 }))
      .toThrow(/x64 declares 9 partitions/)
  })
})

// ── file capabilities ─────────────────────────────────────────────────────

describe('capability-observable', () => {
  test('green when setcap writes an xattr getcap can read back', async () => {
    expect((await drive('capability-observable', { board: cx3576 })).verdict).toBe('pass')
  })

  test('RED when the environment silently drops security.* xattrs', async () => {
    // THE REASON THIS PROBE COMES FIRST. A container that drops security.*
    // produces an EMPTY capability inventory, which is exactly what a rootfs
    // with no file capabilities produces -- so without this probe the
    // comparison below passes for the wrong reason.
    const r = await drive('capability-observable', { board: cx3576, capsObservable: false })
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('no claim about capability preservation can be made here')
  })
})

describe('capabilities-preserved', () => {
  test('green, and HONEST, when both inventories are empty', async () => {
    // Both shipped rootfs trees really are empty here, and the oracle says so
    // out loud rather than dressing it up as a preservation proof.
    const r = await drive('capabilities-preserved', { board: cx3576, report: REPORT_EMPTY })
    expect(r.verdict).toBe('pass')
    expect(r.message).toContain('both EMPTY')
    expect(r.message).toContain('xattr survival is NOT demonstrated by this image')
  })

  test('green, with a COUNT, when capabilities exist and survived', async () => {
    const r = await drive('capabilities-preserved', {
      board: cx3576,
      report: REPORT_TWO,
      packedCaps: ['/usr/bin/ping cap_net_raw=ep', '/usr/bin/dumpcap cap_net_admin,cap_net_raw=eip'],
    })
    expect(r.verdict).toBe('pass')
    expect(r.message).toBe('all 2 file capabilities survived packing into the squashfs '
      + '(security.capability xattrs preserved)')
  })

  test('RED when a capability was DROPPED by packing -- the CONFIG_SQUASHFS_XATTR failure', async () => {
    // A squashfs built without xattr support packs the files and loses their
    // capabilities: ping is installed, is not setuid, and cannot open a socket.
    const r = await drive('capabilities-preserved', {
      board: cx3576,
      report: REPORT_TWO,
      packedCaps: ['/usr/bin/ping cap_net_raw=ep'],
    })
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('file capabilities changed during packing')
    expect(r.message).toContain('dumpcap')
  })

  test('RED when packing GAINED a capability the source never had', async () => {
    const r = await drive('capabilities-preserved', {
      board: cx3576,
      report: REPORT_EMPTY,
      packedCaps: ['/usr/bin/nc cap_net_admin=eip'],
    })
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('file capabilities changed during packing')
  })

  test('the comparison is SORTED, because getcap -r walks in readdir order', async () => {
    // Two walks of the same tree need not agree about order, and R4 measured a
    // defect as four different byte counts from nothing but the clock. Both
    // sides are sorted, so the comparison is of a SET.
    const r = await drive('capabilities-preserved', {
      board: cx3576,
      report: REPORT_TWO,
      packedCaps: ['/usr/bin/dumpcap cap_net_admin,cap_net_raw=eip', '/usr/bin/ping cap_net_raw=ep'],
    })
    expect(r.verdict).toBe('pass')
  })

  test('RED, naming the path, when the build produced no report', async () => {
    const r = await drive('capabilities-preserved', { board: cx3576 })
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('capability inventory not found:')
  })

  test('NOT EVALUATED, rather than passed, when the environment cannot observe a capability', async () => {
    // The dependency stated as a verdict: an unobservable environment makes
    // this a FAIL that says so, not a pass over two empty lists.
    const r = await drive('capabilities-preserved', {
      board: cx3576,
      report: REPORT_EMPTY,
      capsObservable: false,
    })
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('file-capability preservation not evaluated')
  })
})

describe('the report section reader', () => {
  test('it takes the file-capability section and stops at the next one', () => {
    expect(capsFromReport(REPORT_TWO)).toEqual([
      '/usr/bin/dumpcap cap_net_admin,cap_net_raw=eip',
      '/usr/bin/ping cap_net_raw=ep',
    ])
  })

  test('an EMPTY section is an empty list, and it is a legitimate result', () => {
    expect(capsFromReport(REPORT_EMPTY)).toEqual([])
  })

  test('the NEXT section\'s lines are not read as capabilities', () => {
    // The failure a range that ran to end-of-file would have: the setuid
    // section's `4755 0 0 /usr/bin/su` would be compared against getcap output
    // and every image would fail.
    expect(capsFromReport(REPORT_EMPTY).join(' ')).not.toContain('4755')
  })

  test('a report with NO such section at all is empty rather than an error', () => {
    expect(capsFromReport('== summary ==\npaths 1\n')).toEqual([])
  })

  test('trailing whitespace is stripped, as `sed s/[[:space:]]*$//` strips it', () => {
    expect(capsFromReport('== file capabilities ==\n/usr/bin/ping cap_net_raw=ep   \n== next ==\n'))
      .toEqual(['/usr/bin/ping cap_net_raw=ep'])
  })
})
