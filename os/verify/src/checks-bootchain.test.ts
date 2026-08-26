// The boot chain, driven from the failing side: one mutation per check.
//
// Every case asserts the check GREEN first and RED after exactly one edit, and
// asserts the message names the thing that moved -- a check that goes red about
// BOOT-A when BOOT-B is the broken slot sends a reader to the wrong partition,
// and the parity harness still calls it a clean divergence.
//
// The BSP compare is driven in both directions here and in neither in the field.
// `board/cx3576/out/` is not populated in a checkout, so on the real image both
// verifiers say `compare source not found` and the byte-compare's passing
// direction is never taken. These cases take it: a temporary BOARD_DIR with a
// matching artefact, one with a differing artefact, and one with none.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  ftruncateSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { loadBoard, type Board } from './board.ts'
import { bootChainChecks } from './checks-bootchain.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import { walkLayout } from './layout.ts'
import { boardEnvPath, REPO_ROOT } from './paths.ts'
import type { CheckResult } from './parity.ts'
import { runChecked, ToolOutputError, type ToolResult, type ToolRuntime } from './tools.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))
const CHECKS = bootChainChecks([cx3576, x64])

/** The real slot sizes on the shipped images, as sgdisk reads them. */
const SLOT = { cx3576: 524288, x64: 1048576 } as const

// _out/, never /tmp: these files are read back through helpers that this host's
// docker cannot see under /tmp, and the suite's other scratch lives there too.
// Created and removed by the same condition, which is what a `-t` filter broke.
// `mkdtempSync` at module scope ran in every file bun LOADED, but `afterAll`
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
  SCRATCH = mkdtempSync(join(REPO_ROOT, '_out', 'verify-bootchain-'))
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

// ── the boot slots' contents, as files a stubbed mcopy hands over ──────────

/** The first 64 bytes of the real cx3576 boot.scr, plus a body. */
function uImage(body: string, magic = '27051956'): Buffer {
  const head = Buffer.alloc(64)
  Buffer.from(magic, 'hex').copy(head, 0)
  head.writeUInt32BE(body.length, 12)
  head[30] = 6 // IH_TYPE_SCRIPT
  Buffer.from('mos boot').copy(head, 32)
  return Buffer.concat([head, Buffer.from(`\0\0\0\0\0\0\0\0${body}`, 'latin1')])
}

/** The partition numbers the shipped cx3576 boot.cmd bakes in. */
const SCRIPT_BODY = `setenv verityaddr 0x40f00000
if test "\${bootslot}" = ""; then
        setenv bootslot A
        setenv bootpart 4
        setenv rootpart 6
else
        setenv bootslot B
        setenv bootpart 5
        setenv rootpart 7
fi
setenv rootargs "root=/dev/dm-0 rootfstype=squashfs ro rootwait"
setenv raucargs "rauc.slot=\${bootslot}"
`

const VERITY_A = 'verity_args=dm-mod.create="rootfs,,,ro,0 190064 verity 1 '
  + 'PARTUUID=5ac35760-0002-4000-8000-000000000005 PARTUUID=5ac35760-0002-4000-8000-000000000005 '
  + '4096 4096 23758 23758 sha256 776ffaf3 0000000001" '
  + 'dm-mod.waitfor=PARTUUID=5ac35760-0002-4000-8000-000000000005\n'
const VERITY_B = mutate(VERITY_A, /000000000005/g, '000000000006')

/**
 * A textual mutation that REFUSES to be a no-op.
 *
 * Three L3s in this campaign have shipped a `replace` whose needle was not in
 * the subject: the fixture came out unmutated, the check went green, and the
 * case reported that the guard had noticed something. So the edit is asserted
 * to have changed the text before it is ever handed to a check.
 */
function mutate(text: string, from: string | RegExp, to: string): string {
  const after = typeof from === 'string' ? text.replace(from, to) : text.replace(from, to)
  if (after === text) {
    throw new Error(`the mutation ${String(from)} -> '${to}' changed nothing; the fixture is unmutated `
      + `and any RED this case reports is about something else`)
  }
  return after
}

interface SlotContent { readonly [file: string]: Buffer | undefined }

/** cx3576's BOOT-A and BOOT-B as the shipped image carries them. */
function healthySlots(): { a: SlotContent, b: SlotContent } {
  const scr = uImage(SCRIPT_BODY)
  return {
    a: {
      'Image': Buffer.from('KERNEL-IMAGE-BYTES'),
      'rk3576-src.dtb': Buffer.from([0xd0, 0x0d, 0xfe, 0xed, 1, 2, 3, 4]),
      'boot.scr': scr,
      'mos-verity-a.env': Buffer.from(VERITY_A, 'latin1'),
    },
    b: {
      'Image': Buffer.from('KERNEL-IMAGE-BYTES'),
      'rk3576-src.dtb': Buffer.from([0xd0, 0x0d, 0xfe, 0xed, 1, 2, 3, 4]),
      'boot.scr': scr,
      'mos-verity-b.env': Buffer.from(VERITY_B, 'latin1'),
    },
  }
}

/** The device tree fdtget reads, as a per-(node, property) answer table. */
type FdtTable = Record<string, string | undefined>

function healthyFdt(): FdtTable {
  return {
    '/leds/status-red label': 'status-red',
    '/leds/status-red default-state': 'on',
    '/leds/status-red -t x gpios': '117 17 1',
    '/leds/status-blue label': 'status-blue',
    '/leds/status-blue default-state': 'off',
    '/leds/status-blue -t x gpios': '117 8 0',
  }
}

interface World {
  readonly board: Board
  slots: { a: SlotContent, b: SlotContent }
  fdt: FdtTable
  /** Bytes written into the image at absolute offsets, over a sparse zero file. */
  poke?: ReadonlyArray<readonly [number, Buffer]>
  /** `${BOARD_DIR}/out/...` contents; absent means the compare source is missing. */
  bsp?: Record<string, Buffer>
}

function tools(world: World, offsets: { a: number, b: number }): ToolRuntime {
  const exec = async (argv: readonly string[]): Promise<ToolResult> => {
    const line = argv.join(' ')
    const mcopy = /mcopy -n -i \S+@@(\d+) ::\/(\S+) (\S+)$/.exec(line)
    if (mcopy !== null) {
      const at = Number(mcopy[1])
      const which = at === offsets.a ? world.slots.a : at === offsets.b ? world.slots.b : undefined
      if (which === undefined) throw new Error(`the stub has no FAT at offset ${at}`)
      const bytes = which[mcopy[2] as string]
      if (bytes === undefined) {
        return { argv, code: 1, stdout: '', stderr: `File "::/${mcopy[2]}" not found\n` }
      }
      writeFileSync(mcopy[3] as string, bytes)
      return { argv, code: 0, stdout: '', stderr: '' }
    }
    const fdt = /fdtget (?:-t (\w) )?\S+ (\S+) (\S+)$/.exec(line)
    if (fdt !== null) {
      const key = fdt[1] === undefined
        ? `${fdt[2]} ${fdt[3]}`
        : `${fdt[2]} -t ${fdt[1]} ${fdt[3]}`
      const value = world.fdt[key]
      if (value === undefined) {
        return { argv, code: 1, stdout: '', stderr: `Error at '${fdt[3]}': FDT_ERR_NOTFOUND\n` }
      }
      return { argv, code: 0, stdout: `${value}\n`, stderr: '' }
    }
    throw new Error(`the stub has no transcript for: ${line}`)
  }
  return { route: 'host', announce: 'stub', run: (a, o) => runChecked(exec, a, o), dispose: async () => {} }
}

let seq = 0

/** A context over a sparse image of the right size, and the stubbed tools above. */
function fixture(world: World): { ctx: ImageContext, dispose: () => void } {
  const board = world.board
  const dir = join(scratch(), `w${seq += 1}`)
  mkdirSync(dir, { recursive: true })
  const image = join(dir, 'fixture.img')
  const mib = board.mibBytes ?? 1048576
  const walk = walkLayout(board, SLOT[board.name as 'cx3576' | 'x64'])
  const fd = openSync(image, 'w')
  ftruncateSync(fd, walk.totalSizeMib * mib)
  for (const [at, bytes] of world.poke ?? []) writeSync(fd, bytes, 0, bytes.length, at)
  closeSync(fd)

  const partitions = walk.rows.map(r => ({
    number: r.number,
    firstSector: r.startSector,
    lastSector: r.startSector + r.sizeSectors - 1,
    sizeSectors: r.sizeSectors,
    typeGuid: r.typecode,
    uniqueGuid: r.guid,
    name: r.label,
    attributeFlags: '0000000000000000',
  }))
  const gpt = {
    image,
    sectorSize: board.sectorSize ?? 512,
    diskGuid: board.get('DISK_GUID') ?? '',
    totalSectors: walk.totalSizeMib * walk.sectorsPerMib,
    partitions,
    partition: (n: number) => partitions.find(p => p.number === n),
  }
  const offsets = {
    a: Number(board.partition('BOOT_A')?.get('OFFSET_BYTES') ?? 0),
    b: Number(board.partition('BOOT_B')?.get('OFFSET_BYTES') ?? 0),
  }
  const refuse = (what: string): never => {
    throw new ToolOutputError(`the boot-chain fixture has no ${what}.`)
  }
  const ctx: ImageContext = {
    board,
    image,
    tools: tools(world, offsets),
    workDir: dir,
    outDir: dir,
    gpt: async () => gpt,
    partition: async () => refuse('partition lookup'),
    fatSlot: async () => refuse('GPT-derived FAT slot -- these checks take the offset from the layout'),
    extract: async () => refuse('extracted payloads'),
    extractAt: async () => refuse('image byte ranges'),
    unpackRoot: async () => refuse('unpacked root'),
  }
  return { ctx, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

function checkNamed(id: string): CheckCase {
  const found = CHECKS.find(c => c.id === id)
  if (found === undefined) {
    throw new Error(`no boot-chain check is registered as '${id}'`)
  }
  return found
}

/** Run one check, with `${BOARD_DIR}` pointed at this world's BSP tree if it has one. */
async function drive(id: string, world: World): Promise<readonly CheckResult[]> {
  const fx = fixture(world)
  const saved = process.env['BOARD_DIR']
  if (world.bsp !== undefined) {
    const dir = join(scratch(), `bsp${seq}`)
    for (const [rel, bytes] of Object.entries(world.bsp)) {
      const at = join(dir, rel)
      mkdirSync(join(at, '..'), { recursive: true })
      writeFileSync(at, bytes)
    }
    mkdirSync(dir, { recursive: true })
    process.env['BOARD_DIR'] = dir
  }
  else {
    // No BSP tree at all -- which is what a checkout is, and what makes the
    // oracle's own cx3576 run RESULT FAIL (387/395).
    process.env['BOARD_DIR'] = join(scratch(), 'no-such-bsp-tree')
  }
  try {
    return await checkNamed(id).run(fx.ctx)
  }
  finally {
    if (saved === undefined) delete process.env['BOARD_DIR']
    else process.env['BOARD_DIR'] = saved
    fx.dispose()
  }
}

function one(results: readonly CheckResult[]): CheckResult {
  const first = results[0]
  if (first === undefined) throw new Error('the check concluded nothing')
  return first
}

function at(results: readonly CheckResult[], instance: string): CheckResult {
  const found = results.find(r => r.instance === instance)
  if (found === undefined) {
    throw new Error(`no firing for '${instance}' in ${results.map(r => r.instance).join(', ')}`)
  }
  return found
}

function world(over: Partial<World> = {}): World {
  return { board: cx3576, slots: healthySlots(), fdt: healthyFdt(), ...over }
}

describe('the mutation helper refuses a no-op', () => {
  test('a needle that is not in the subject is an ERROR, not an unmutated fixture', () => {
    expect(() => mutate(SCRIPT_BODY, 'setenv bootpart 9', 'setenv bootpart 3'))
      .toThrow(/changed nothing/)
    expect(mutate(SCRIPT_BODY, 'setenv bootpart 4', 'setenv bootpart 3')).not.toBe(SCRIPT_BODY)
  })
})

// the raw pre-GPT blob and its BSP compares

const UBOOT_AT = 64 * 512
const UBOOT_BLOB = Buffer.from('RKNSU-BOOT-BLOB-BYTES-0123456789')
const UBOOT_SRC = 'out/uboot-mos/u-boot-rockchip.bin'
const UBOOT_DEBUG_SRC = 'out/uboot/u-boot-rockchip.bin'

describe('uboot-blob-matches-variant', () => {
  const id = 'uboot-blob-matches-variant-cx3576'

  test('green when the image carries the uboot-mos build byte for byte', async () => {
    const r = one(await drive(id, world({
      poke: [[UBOOT_AT, UBOOT_BLOB]],
      bsp: { [UBOOT_SRC]: UBOOT_BLOB },
    })))
    expect(r.verdict).toBe('pass')
    expect(r.message).toContain('u-boot at sector 64 matches the uboot-mos variant')
  })

  test('RED when the blob at sector 64 differs from the build', async () => {
    // The mutation a stale _out/ makes: the image was assembled from one build
    // and the tree now holds another, so the device would boot a bootloader
    // nobody can reproduce.
    const r = one(await drive(id, world({
      poke: [[UBOOT_AT, UBOOT_BLOB]],
      bsp: { [UBOOT_SRC]: Buffer.from('A-DIFFERENT-U-BOOT-BUILD-01234567') },
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('a v2 image may only carry the uboot-mos variant')
  })

  test('RED, naming the path, when the BSP tree was never built', async () => {
    // The state a checkout is in: board/ BSP builds are not run here, so the
    // tree is unpopulated and the compare source is absent.
    const r = one(await drive(id, world({ poke: [[UBOOT_AT, UBOOT_BLOB]] })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('u-boot compare source not found')
    expect(r.message).toContain('out/uboot-mos/u-boot-rockchip.bin')
  })

  test('the skip belongs to a DIFFERENT entry, and this one does not exist on x64', async () => {
    expect(checkNamed(id).boards).toEqual(['cx3576'])
    const skip = one(await drive('uboot-blob-skipped', world({ board: x64 })))
    expect(skip.verdict).toBe('skip')
    expect(skip.message).toContain('the raw pre-GPT loader area (bootloader=grub)')
  })
})

describe('uboot-blob-not-debug', () => {
  const id = 'uboot-blob-not-debug-cx3576'

  test('green when the image is NOT the debug build', async () => {
    const r = one(await drive(id, world({
      poke: [[UBOOT_AT, UBOOT_BLOB]],
      bsp: { [UBOOT_DEBUG_SRC]: Buffer.from('DEBUG-U-BOOT-BUILD-0123456789012') },
    })))
    expect(r.verdict).toBe('pass')
    expect(r.message).toContain('differs from the debug variant (uboot)')
  })

  test('RED when a DEBUG blob was flashed -- the image that boots and never rolls back', async () => {
    // The debug variant has CONFIG_ENV_IS_NOWHERE and no pinned bootmeth order,
    // so BOOT_ORDER is never consulted, attempts are never counted and rollback
    // never happens -- with nothing on the console to say so.
    const r = one(await drive(id, world({
      poke: [[UBOOT_AT, UBOOT_BLOB]],
      bsp: { [UBOOT_DEBUG_SRC]: UBOOT_BLOB },
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('is byte-identical to the DEBUG u-boot')
  })

  test('RED, naming the path, when the debug build is absent', async () => {
    const r = one(await drive(id, world({ poke: [[UBOOT_AT, UBOOT_BLOB]] })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('u-boot debug-variant compare source not found')
  })
})

describe('the containment pair reads the SAME uboot_size the compare did', () => {
  test('green when the build fits below uenv-a and inside p1', async () => {
    const w = world({ poke: [[UBOOT_AT, UBOOT_BLOB]], bsp: { [UBOOT_SRC]: UBOOT_BLOB } })
    expect(one(await drive('uboot-blob-below-uenv-cx3576', w)).verdict).toBe('pass')
    const fits = one(await drive('uboot-blob-fits-loader-cx3576', w))
    expect(fits.verdict).toBe('pass')
    expect(fits.message).toContain('is fully contained in p1')
  })

  test('RED when the build reaches into uenv-a', async () => {
    // UBOOT_MAX_BYTES is 16744448 and uenv-a is at 16 MiB; a build one byte
    // over would be written straight through the redundant environment.
    const big = Buffer.alloc(17 * 1024 * 1024)
    big[0] = 1
    const r = one(await drive('uboot-blob-below-uenv-cx3576', world({ bsp: { [UBOOT_SRC]: big } })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('reaches into uenv-a at 16777216 bytes / 16 MiB')
  })

  test('RED when the build does not fit inside the loader partition', async () => {
    const big = Buffer.alloc(17 * 1024 * 1024)
    const r = one(await drive('uboot-blob-fits-loader-cx3576', world({ bsp: { [UBOOT_SRC]: big } })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('the blob must fit inside its own partition with room left')
  })

  test('an ABSENT build is size 0, and 0 fails BOTH -- the oracle\'s uboot_size=0', async () => {
    // The coupling that makes these four one family: the not-found branch sets
    // uboot_size=0 and the two containment checks then conclude about a blob of
    // zero bytes rather than about the image. Both must FAIL, not pass by
    // arithmetic on zero.
    const w = world({ poke: [[UBOOT_AT, UBOOT_BLOB]] })
    expect(one(await drive('uboot-blob-below-uenv-cx3576', w)).verdict).toBe('fail')
    expect(one(await drive('uboot-blob-fits-loader-cx3576', w)).verdict).toBe('fail')
  })
})

// the BSP kernel artefacts, per slot

describe('the per-slot BSP byte-compare', () => {
  test('one entry per slot per artefact, derived from BOOT_SLOT_REQUIRED_FILES', async () => {
    // Image and rk3576-src.dtb -- and NOT boot.scr or mos-verity-a.env, which
    // the assembler writes rather than the BSP build.
    const ids = CHECKS.filter(c => c.id.startsWith('bsp-compare-')).map(c => c.id)
    expect(ids.sort()).toEqual([
      'bsp-compare-cx3576-BOOT-A-Image',
      'bsp-compare-cx3576-BOOT-A-rk3576-src.dtb',
      'bsp-compare-cx3576-BOOT-B-Image',
      'bsp-compare-cx3576-BOOT-B-rk3576-src.dtb',
    ])
  })

  test('green when the slot matches the local BSP artifact', async () => {
    const r = one(await drive('bsp-compare-cx3576-BOOT-A-Image', world({
      bsp: { 'out/kernel/Image': Buffer.from('KERNEL-IMAGE-BYTES') },
    })))
    expect(r.verdict).toBe('pass')
    expect(r.message).toContain('factory: BOOT-A Image matches the local BSP artifact')
  })

  test('RED when the slot carries a DIFFERENT kernel from the one in the tree', async () => {
    const r = one(await drive('bsp-compare-cx3576-BOOT-A-Image', world({
      bsp: { 'out/kernel/Image': Buffer.from('A-DIFFERENT-KERNEL') },
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('factory: BOOT-A Image differs from the local BSP artifact')
  })

  test('RED when the artefact is not in the slot at all', async () => {
    const slots = healthySlots()
    const a = { ...slots.a }
    delete (a as Record<string, Buffer | undefined>)['Image']
    const r = one(await drive('bsp-compare-cx3576-BOOT-A-Image', world({
      slots: { a, b: slots.b },
      bsp: { 'out/kernel/Image': Buffer.from('KERNEL-IMAGE-BYTES') },
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toBe('BOOT-A Image missing or unreadable')
  })

  test('RED, naming the path, when the BSP tree was never built', async () => {
    const r = one(await drive('bsp-compare-cx3576-BOOT-B-rk3576-src.dtb', world()))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('BOOT-B rk3576-src.dtb compare source not found:')
    expect(r.message).toContain('out/kernel/rk3576-src.dtb')
  })

  test('the SLOT is part of the identity: B\'s entry reads B\'s copy', async () => {
    // A generated family that read the A slot four times would be green here
    // and would say nothing about B.
    const slots = healthySlots()
    const r = one(await drive('bsp-compare-cx3576-BOOT-B-Image', world({
      slots: { a: slots.a, b: { ...slots.b, 'Image': Buffer.from('B-HAS-A-DIFFERENT-KERNEL') } },
      bsp: { 'out/kernel/Image': Buffer.from('KERNEL-IMAGE-BYTES') },
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('BOOT-B Image differs')
  })
})

// the status-LED device tree

describe('the status-LED device tree', () => {
  test('twelve entries on cx3576, and none on a board with no indicator', () => {
    const led = CHECKS.filter(c => c.id.startsWith('led-label-') || c.id.startsWith('led-state-')
      || c.id.startsWith('led-gpio-'))
    expect(led.length).toBe(12)
    expect(led.every(c => c.boards?.includes('cx3576') === true)).toBe(true)
    expect(led.some(c => c.boards?.includes('x64') === true)).toBe(false)
  })

  test('green on the shipped device tree', async () => {
    for (const id of ['led-label-cx3576-BOOT-A-status-red', 'led-state-cx3576-BOOT-A-status-red',
      'led-gpio-cx3576-BOOT-A-status-red', 'led-gpio-cx3576-BOOT-B-status-blue']) {
      expect(one(await drive(id, world())).verdict).toBe('pass')
    }
  })

  test('RED when a label is renamed -- /sys/class/leds/status-red stops existing', async () => {
    const fdt = { ...healthyFdt(), '/leds/status-red label': 'led-red' }
    const r = one(await drive('led-label-cx3576-BOOT-A-status-red', world({ fdt })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toBe(`BOOT-A rk3576-src.dtb: /leds/status-red label is 'led-red', expected 'status-red'`)
  })

  test('RED when default-state flips -- the device boots dark', async () => {
    const fdt = { ...healthyFdt(), '/leds/status-red default-state': 'off' }
    const r = one(await drive('led-state-cx3576-BOOT-A-status-red', world({ fdt })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain(`default-state is 'off', expected 'on'`)
  })

  test('RED when the GPIO FLAGS CELL is inverted, which nothing else catches', async () => {
    // The load-bearing one. Label and default-state still read exactly right;
    // only the third cell of `gpios` says whether the line is active-low, and a
    // red indicator wired the other way is dark exactly when it should be lit.
    const fdt = { ...healthyFdt(), '/leds/status-red -t x gpios': '117 17 0' }
    const label = one(await drive('led-label-cx3576-BOOT-A-status-red', world({ fdt })))
    const state = one(await drive('led-state-cx3576-BOOT-A-status-red', world({ fdt })))
    const gpio = one(await drive('led-gpio-cx3576-BOOT-A-status-red', world({ fdt })))
    expect(label.verdict).toBe('pass')
    expect(state.verdict).toBe('pass')
    expect(gpio.verdict).toBe('fail')
    expect(gpio.message).toContain(`GPIO flags cell is '0', expected 1 (active-low)`)
    expect(gpio.message).toContain('drives this LED backwards')
  })

  test('RED, saying "missing", when the node is not in the tree at all', async () => {
    const fdt: FdtTable = { ...healthyFdt() }
    delete fdt['/leds/status-blue label']
    const r = one(await drive('led-label-cx3576-BOOT-B-status-blue', world({ fdt })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain(`label is 'missing'`)
  })

  test('RED, and NOT a throw, when the dtb was never extracted from the slot', async () => {
    // The oracle's `fdtget "${dtb}" ... 2>/dev/null || true` on a file mcopy
    // never wrote: every one of the six conclusions FAILS. A port that threw
    // would be a run that died where the oracle printed six FAILs.
    const slots = healthySlots()
    const a = { ...slots.a }
    delete (a as Record<string, Buffer | undefined>)['rk3576-src.dtb']
    const r = one(await drive('led-gpio-cx3576-BOOT-A-status-red', world({ slots: { a, b: slots.b } })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain(`GPIO flags cell is 'missing'`)
  })

  test('a gpios property with FEWER than three cells is missing, not wrong', async () => {
    const fdt = { ...healthyFdt(), '/leds/status-blue -t x gpios': '117 8' }
    const r = one(await drive('led-gpio-cx3576-BOOT-B-status-blue', world({ fdt })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain(`GPIO flags cell is 'missing'`)
  })

  test('a board with no indicator prints ONE skip per slot, and it is a skip', async () => {
    const r = await drive('led-dtb-skipped', world({ board: x64 }))
    expect(r.map(x => x.instance)).toEqual(['BOOT-A', 'BOOT-B'])
    expect(r.every(x => x.verdict === 'skip')).toBe(true)
    expect(at(r, 'BOOT-A').message).toContain('x64 declares BOARD_HAS_STATUS_LED=0')
  })
})

// the compiled boot script

describe('boot-scr-identical', () => {
  test('green when both slots carry the same compiled script', async () => {
    expect(one(await drive('boot-scr-identical', world())).verdict).toBe('pass')
  })

  test('RED when the two slots have drifted apart', async () => {
    // Whichever copy U-Boot runs may boot EITHER slot, so two different
    // scripts means the behaviour depends on which slot the environment
    // happened to select -- and that is the variable the handshake sets.
    const slots = healthySlots()
    const r = one(await drive('boot-scr-identical', world({
      slots: { a: slots.a, b: { ...slots.b, 'boot.scr': uImage(`${SCRIPT_BODY}setenv extra 1\n`) } },
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('differs between BOOT-A and BOOT-B')
  })

  test('RED when one slot has no script at all', async () => {
    const slots = healthySlots()
    const b = { ...slots.b }
    delete (b as Record<string, Buffer | undefined>)['boot.scr']
    expect(one(await drive('boot-scr-identical', world({ slots: { a: slots.a, b } }))).verdict).toBe('fail')
  })

  test('a grub board SKIPS, through the entry that owns the line', async () => {
    const r = one(await drive('boot-scr-skipped', world({ board: x64 })))
    expect(r.verdict).toBe('skip')
    expect(r.message).toContain('the boot.scr assertions (bootloader=grub)')
  })
})

describe('boot-scr-uimage-magic', () => {
  test('green on the legacy uImage magic', async () => {
    const r = one(await drive('boot-scr-uimage-magic', world()))
    expect(r.verdict).toBe('pass')
    expect(r.message).toBe('boot.scr carries the legacy uImage magic 27051956')
  })

  test('RED on a PLAIN TEXT boot.cmd copied in place of the compiled script', async () => {
    // The mutation that reads like a simplification: the source is human
    // readable and the compiled form is not, so someone copies boot.cmd. U-Boot
    // `source` refuses it and the board does not boot.
    const slots = healthySlots()
    const r = one(await drive('boot-scr-uimage-magic', world({
      slots: { a: { ...slots.a, 'boot.scr': Buffer.from(SCRIPT_BODY) }, b: slots.b },
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain(`boot.scr magic is '73657465'`)
  })

  test('RED, at the empty string, when the script is not in the slot', async () => {
    const slots = healthySlots()
    const a = { ...slots.a }
    delete (a as Record<string, Buffer | undefined>)['boot.scr']
    const r = one(await drive('boot-scr-uimage-magic', world({ slots: { a, b: slots.b } })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain(`magic is ''`)
  })
})

describe('the four partition numbers baked into boot.scr', () => {
  test('one entry per (variable, slot), generated from that board\'s own partnums', () => {
    const ids = CHECKS.filter(c => c.id.startsWith('boot-scr-bootpart') || c.id.startsWith('boot-scr-rootpart'))
    expect(ids.map(c => c.id).sort()).toEqual([
      'boot-scr-bootpart-A-cx3576', 'boot-scr-bootpart-B-cx3576',
      'boot-scr-rootpart-A-cx3576', 'boot-scr-rootpart-B-cx3576',
    ])
  })

  test('green on the shipped script', async () => {
    for (const id of ['boot-scr-bootpart-A-cx3576', 'boot-scr-bootpart-B-cx3576',
      'boot-scr-rootpart-A-cx3576', 'boot-scr-rootpart-B-cx3576']) {
      expect(one(await drive(id, world())).verdict).toBe('pass')
    }
  })

  test('RED on a script built before LOADER shifted every number by one', async () => {
    // The renumbering assertion. A stale value does not announce itself: U-Boot
    // persists the boot-attempt decrement, then fails to find Image in a
    // partition that now holds something else, and the board is bricked until
    // it is re-flashed.
    const stale = mutate(
      mutate(SCRIPT_BODY, 'setenv bootpart 4', 'setenv bootpart 3'),
      'setenv rootpart 6', 'setenv rootpart 5')
    const slots = healthySlots()
    const w = world({ slots: { a: { ...slots.a, 'boot.scr': uImage(stale) }, b: slots.b } })
    const boot = one(await drive('boot-scr-bootpart-A-cx3576', w))
    expect(boot.verdict).toBe('fail')
    expect(boot.message).toContain(`sets bootpart='3' for slot A, but the layout puts that partition at p4`)
    expect(one(await drive('boot-scr-rootpart-A-cx3576', w)).verdict).toBe('fail')
    // ...and B's numbers are untouched, which is what proves the slots separate.
    expect(one(await drive('boot-scr-bootpart-B-cx3576', w)).verdict).toBe('pass')
  })

  test('RED, saying "nothing", when the stanza does not set the variable', async () => {
    const gone = mutate(SCRIPT_BODY, '        setenv rootpart 7\n', '')
    const slots = healthySlots()
    const r = one(await drive('boot-scr-rootpart-B-cx3576', world({
      slots: { a: { ...slots.a, 'boot.scr': uImage(gone) }, b: slots.b },
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain(`sets rootpart='nothing' for slot B`)
  })

  test('a `setenv bootpart` OUTSIDE any slot stanza does not satisfy either slot', async () => {
    // The awk is stanza-scoped: `$1 == "setenv" && $2 == var && in_slot`. A
    // value set before the first `setenv bootslot` belongs to neither.
    const hoisted = `setenv bootpart 4\nsetenv rootpart 6\n${mutate(
      mutate(SCRIPT_BODY, '        setenv bootpart 4\n', ''),
      '        setenv rootpart 6\n', '')}`
    const slots = healthySlots()
    const r = one(await drive('boot-scr-bootpart-A-cx3576', world({
      slots: { a: { ...slots.a, 'boot.scr': uImage(hoisted) }, b: slots.b },
    })))
    expect(r.verdict).toBe('fail')
  })
})

describe('boot-scr-root-args', () => {
  test('green on the shipped rootargs', async () => {
    expect(one(await drive('boot-scr-root-args', world())).verdict).toBe('pass')
  })

  test('RED when the root is mounted READ-WRITE', async () => {
    // `ro` removed: the verity device is read-only by construction, so the
    // mount fails at boot -- and this is the second of the two independent
    // places the read-only property is asserted.
    const rw = mutate(SCRIPT_BODY, 'rootfstype=squashfs ro rootwait', 'rootfstype=squashfs rw rootwait')
    const slots = healthySlots()
    const r = one(await drive('boot-scr-root-args', world({
      slots: { a: { ...slots.a, 'boot.scr': uImage(rw) }, b: slots.b },
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain(`does not set 'root=/dev/dm-0 rootfstype=squashfs ro'`)
  })

  test('RED when root= names a partition instead of the verity device', async () => {
    const direct = mutate(SCRIPT_BODY, 'root=/dev/dm-0', 'root=PARTUUID=5ac35760-0002-4000-8000-000000000005')
    const slots = healthySlots()
    expect(one(await drive('boot-scr-root-args', world({
      slots: { a: { ...slots.a, 'boot.scr': uImage(direct) }, b: slots.b },
    }))).verdict).toBe('fail')
  })

  test('a grub board SKIPS, through the entry that owns the line', async () => {
    const r = one(await drive('boot-scr-root-args-skipped', world({ board: x64 })))
    expect(r.verdict).toBe('skip')
    expect(r.message).toContain('the boot.scr root-argument assertions (bootloader=grub)')
  })
})

// the verity environment pair

describe('verity-env-own-partuuid', () => {
  test('green: each slot names its own rootfs and not the other', async () => {
    const r = await drive('verity-env-own-partuuid', world())
    expect(r.map(x => x.instance)).toEqual(['A', 'B'])
    expect(r.every(x => x.verdict === 'pass')).toBe(true)
  })

  test('RED when the two envs are SWAPPED -- an update verifies the slot it replaced', async () => {
    const slots = healthySlots()
    const r = await drive('verity-env-own-partuuid', world({
      slots: {
        a: { ...slots.a, 'mos-verity-a.env': Buffer.from(VERITY_B, 'latin1') },
        b: { ...slots.b, 'mos-verity-b.env': Buffer.from(VERITY_A, 'latin1') },
      },
    }))
    expect(at(r, 'A').verdict).toBe('fail')
    expect(at(r, 'B').verdict).toBe('fail')
    expect(at(r, 'A').message).toContain('must not mention 5AC35760-0002-4000-8000-000000000006')
  })

  test('RED when a slot mentions BOTH rootfs partitions', async () => {
    // Not a swap: A names its own AND the other's, which passes any check that
    // only asks "does it name its own".
    const slots = healthySlots()
    const both = `${VERITY_A}# see also PARTUUID=5ac35760-0002-4000-8000-000000000006\n`
    const r = await drive('verity-env-own-partuuid', world({
      slots: { a: { ...slots.a, 'mos-verity-a.env': Buffer.from(both, 'latin1') }, b: slots.b },
    }))
    expect(at(r, 'A').verdict).toBe('fail')
    expect(at(r, 'B').verdict).toBe('pass')
  })

  test('RED, naming the file, when a slot has no verity env', async () => {
    const slots = healthySlots()
    const b = { ...slots.b }
    delete (b as Record<string, Buffer | undefined>)['mos-verity-b.env']
    const r = await drive('verity-env-own-partuuid', world({ slots: { a: slots.a, b } }))
    expect(at(r, 'B').verdict).toBe('fail')
    expect(at(r, 'B').message).toBe('B mos-verity-b.env is missing or empty')
  })
})

describe('verity-env-ab-differ-only-by-partuuid', () => {
  const id = 'verity-env-ab-differ-only-by-partuuid'

  test('green: rewriting A\'s PARTUUID to B\'s reproduces B exactly', async () => {
    expect(one(await drive(id, world())).verdict).toBe('pass')
  })

  test('RED when the two tables have drifted by more than the PARTUUID', async () => {
    // The failure this exists for: A and B were regenerated at different times
    // and carry different root hashes or block counts, so one slot verifies
    // against parameters that describe the other.
    const slots = healthySlots()
    const r = one(await drive(id, world({
      slots: {
        a: slots.a,
        b: { ...slots.b, 'mos-verity-b.env': Buffer.from(mutate(VERITY_B, '23758 23758', '23759 23759'), 'latin1') },
      },
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('differ by more than the rootfs PARTUUID')
  })

  test('the comparison is NOT made when a slot\'s env is missing -- the oracle\'s precondition', async () => {
    const slots = healthySlots()
    const b = { ...slots.b }
    delete (b as Record<string, Buffer | undefined>)['mos-verity-b.env']
    const r = one(await drive(id, world({ slots: { a: slots.a, b } })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('could not be made')
  })
})

// the regions that ship zero-filled

describe('rootfs-b-zero', () => {
  test('green on a slot that is entirely zero', async () => {
    const r = one(await drive('rootfs-b-zero', world()))
    expect(r.verdict).toBe('pass')
    expect(r.message).toContain('factory: ROOTFS-B is entirely zero (256 MiB')
  })

  test('RED when ROOTFS-B was written at build -- the update that installs over itself', async () => {
    // ROOTFS-B holding a payload at the factory means the first update has
    // nowhere clean to land and the A/B pair is not a pair.
    const rootfsBAt = 402 * 1024 * 1024
    const r = one(await drive('rootfs-b-zero', world({ poke: [[rootfsBAt, Buffer.from('hsqs')]] })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toBe('factory: ROOTFS-B contains 4 non-zero bytes, expected none')
  })
})

describe('uenv-zero', () => {
  test('green on both environment partitions', async () => {
    const r = await drive('uenv-zero', world())
    expect(r.map(x => x.instance)).toEqual(['UENV-A', 'UENV-B'])
    expect(r.every(x => x.verdict === 'pass')).toBe(true)
    expect(at(r, 'UENV-A').message).toContain('is entirely zero (64 KiB at 16777216 bytes')
  })

  test('RED when a build machine\'s environment was flashed into UENV-B', async () => {
    // A non-blank environment means U-Boot inherits the build host's
    // BOOT_ORDER and attempt counters instead of writing its own on first boot.
    const r = await drive('uenv-zero', world({ poke: [[17825792, Buffer.from('bootcmd=run x')]] }))
    expect(at(r, 'UENV-A').verdict).toBe('pass')
    expect(at(r, 'UENV-B').verdict).toBe('fail')
    expect(at(r, 'UENV-B').message).toContain('contains 13 non-zero bytes')
  })

  test('a grub board SKIPS, through its own entry', async () => {
    const r = one(await drive('uenv-zero-skipped', world({ board: x64 })))
    expect(r.verdict).toBe('skip')
    expect(r.message).toContain('the zero-filled U-Boot environment pair (bootloader=grub)')
  })
})
