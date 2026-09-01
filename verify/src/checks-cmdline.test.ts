// The kernel-command-line family, driven from the failing side.
//
// The assertions are the same on both
// boards and only the EXTRACTION differs, so nearly every case below is run
// twice -- once against a U-Boot slot's verity env and once against a grub
// board's grub.cfg composed with its slot's cmdline.cfg. A family tested on one
// board is a family half tested, and this one has two completely different
// readers behind one set of conclusions.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBoard, type Board } from './board.ts'
import { CMDLINE_CHECKS_ALL } from './checks-cmdline.ts'
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
  SCRATCH = mkdtempSync(join(REPO_ROOT, '_out', 'verify-cmdline-'))
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

/** A textual mutation that refuses to be a no-op -- see checks-bootchain.test.ts. */
function mutate(text: string, from: string | RegExp, to: string): string {
  const after = text.replace(from as never, to)
  if (after === text) {
    throw new Error(`the mutation ${String(from)} -> '${to}' changed nothing; the fixture is `
      + `unmutated and any RED this case reports is about something else`)
  }
  return after
}

// ── what each board's boot path really carries ────────────────────────────

const CX_HASH = '776ffaf3c23c995829e39e443ef46e0b2ea5dd40d8a0ba9aa8849dfb9335f49f'
const X64_HASH = '29809478ef06ccd26a88fb48f5faa78e8477a20dad8ca407a435eaa14419ef8a'
const SALT = '0000000000000000000000000000000000000000000000000000000000000001'

/** The shipped cx3576 mos-verity-a.env, captured 2026-08-26. */
function verityEnv(guid: string, hash: string, salt = SALT): string {
  return `verity_args=dm-mod.create="rootfs,,,ro,0 190064 verity 1 PARTUUID=${guid} `
    + `PARTUUID=${guid} 4096 4096 23758 23758 sha256 ${hash} ${salt}" `
    + `dm-mod.waitfor=PARTUUID=${guid}\n`
}

/** The shipped cx3576 boot.scr body, for the rauc.slot= source. */
const CX_SCRIPT = 'setenv rootargs "root=/dev/dm-0 rootfstype=squashfs ro rootwait"\n'
  + 'setenv raucargs "rauc.slot=${bootslot}"\n'

/** The shipped x64 grub.cfg's two `linux` lines, with ${MOS_*} unexpanded. */
function grubCfg(guidA: string, guidB: string): string {
  const line = (letter: string, guid: string) =>
    `        linux (\${slot_${letter}_root})/vmlinuz dm-mod.create="rootfs,,,ro,0 \${MOS_SECTORS} `
    + `verity 1 PARTUUID=${guid} PARTUUID=${guid} \${MOS_DATA_BLOCK_SIZE} \${MOS_HASH_BLOCK_SIZE} `
    + `\${MOS_DATA_BLOCKS} \${MOS_HASH_START_BLOCK} \${MOS_HASH_ALGO} \${MOS_ROOT_HASH} \${MOS_SALT}" `
    + `dm-mod.waitfor=PARTUUID=${guid} root=/dev/dm-0 rootfstype=squashfs ro rootwait `
    + `rauc.slot=${letter.toUpperCase()} console=tty0 net.ifnames=0`
  return `set default=0\nset slot_a_root="\${mos_disk},gpt2"\nset slot_b_root="\${mos_disk},gpt3"\n`
    + `menuentry "mos slot A" --id A {\n${line('a', guidA)}\n        initrd (\${slot_a_root})/initrd.img\n}\n`
    + `menuentry "mos slot B" --id B {\n${line('b', guidB)}\n        initrd (\${slot_b_root})/initrd.img\n}\n`
}

/** The shipped x64 cmdline.cfg fragment. */
function cmdlineFrag(hash: string, salt = SALT): string {
  return `set MOS_SECTORS=464928\nset MOS_DATA_BLOCK_SIZE=4096\nset MOS_HASH_BLOCK_SIZE=4096\n`
    + `set MOS_DATA_BLOCKS=58116\nset MOS_HASH_START_BLOCK=58116\nset MOS_HASH_ALGO=sha256\n`
    + `set MOS_ROOT_HASH=${hash}\nset MOS_SALT=${salt}\n`
}

const RAUC_CONF = (guids: Record<string, string>): string =>
  `[system]\ncompatible=mos\nbootloader=grub\n\n`
  + Object.entries(guids).map(([slot, g]) =>
    `[slot.${slot}]\ndevice=/dev/disk/by-partuuid/${g}\ntype=raw\n`).join('\n')

/** A squashfs payload with the magic, the zstd compressor id and no ext4 magic. */
function squashfsPayload(over: { magic?: string, comp?: number, ext4?: boolean } = {}): Buffer {
  const buf = Buffer.alloc(4096)
  Buffer.from(over.magic ?? 'hsqs', 'latin1').copy(buf, 0)
  buf.writeUInt16LE(over.comp ?? 6, 20)
  if (over.ext4 === true) buf.writeUInt16LE(0xef53, 1024 + 56)
  return buf
}

/**
 * One data block plus the block the cmdline's hash_start_block names.
 *
 * `superblock: true` is an image packed the way `veritysetup format` packs one
 * WITHOUT --no-superblock: the metadata sits at the hash offset and the tree
 * begins a block later. Everything else here is a tree top level, which is a
 * hash and looks like nothing in particular.
 */
function payloadAtHashStart(over: { superblock: boolean }): Buffer {
  const buf = Buffer.alloc(8192)
  squashfsPayload().copy(buf, 0)
  Buffer.from(over.superblock ? 'verity\0\0' : '\x98\x4f\xe2\x2a\x84\xdb\xe6\x34', 'latin1')
    .copy(buf, 4096)
  return buf
}

/** The two boot paths, retold with hash_start_block = 1 so a fixture can hold it. */
function cxFatHashStart1(): Record<string, string | undefined> {
  const guidA = (cx3576.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
  return cxFat({
    [`${offsetOf(cx3576, 'BOOT_A')}::mos-verity-a.env`]:
      mutate(verityEnv(guidA, CX_HASH), '4096 4096 23758 23758', '4096 4096 1 1'),
  })
}
function x64FatHashStart1(): Record<string, string | undefined> {
  return x64Fat({
    [`${offsetOf(x64, 'BOOT_A')}::cmdline.cfg`]:
      mutate(cmdlineFrag(X64_HASH), 'set MOS_HASH_START_BLOCK=58116', 'set MOS_HASH_START_BLOCK=1'),
  })
}

interface World {
  readonly board: Board
  /** Files in each FAT, keyed `<offset>::<path>`. */
  fat: Record<string, string | undefined>
  /** `_out/<board>/rootfs-verity.env`, or absent. */
  params?: string
  /** ROOTFS-A's extracted payload. */
  payload?: Buffer
  /** What `veritysetup verify` exits with. */
  verity?: number
  /** `/etc/rauc/system.conf` in the unpacked root. */
  raucConf?: string
}

let seq = 0

function fixture(world: World): { ctx: ImageContext, dispose: () => void } {
  const board = world.board
  const dir = join(scratch(), `w${seq += 1}`)
  mkdirSync(dir, { recursive: true })
  const outDir = join(dir, 'out')
  mkdirSync(outDir, { recursive: true })
  if (world.params !== undefined) writeFileSync(join(outDir, 'rootfs-verity.env'), world.params)
  const root = join(dir, 'root')
  if (world.raucConf !== undefined) {
    mkdirSync(join(root, 'etc/rauc'), { recursive: true })
    writeFileSync(join(root, 'etc/rauc/system.conf'), world.raucConf)
  }
  const payload = join(dir, 'rootfs-a.img')
  writeFileSync(payload, world.payload ?? squashfsPayload())

  const walk = walkLayout(board, SLOT[board.name as 'cx3576' | 'x64'])
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

  const exec = async (argv: readonly string[]): Promise<ToolResult> => {
    const line = argv.join(' ')
    const mcopy = /mcopy -n -i \S+@@(\d+) ::\/(\S+) (\S+)$/.exec(line)
    if (mcopy !== null) {
      const body = world.fat[`${mcopy[1]}::${mcopy[2]}`]
      if (body === undefined) {
        return { argv, code: 1, stdout: '', stderr: `File "::/${mcopy[2]}" not found\n` }
      }
      writeFileSync(mcopy[3] as string, body)
      return { argv, code: 0, stdout: '', stderr: '' }
    }
    const mdir = /mdir -\/ -b -i \S+@@(\d+) ::\/$/.exec(line)
    if (mdir !== null) {
      const at = `${mdir[1]}::`
      const names = Object.keys(world.fat).filter(k => k.startsWith(at)).map(k => `::/${k.slice(at.length)}`)
      return { argv, code: 0, stdout: `${names.join('\n')}\n`, stderr: '' }
    }
    if (line.startsWith('veritysetup verify')) {
      const code = world.verity ?? 0
      return {
        argv,
        code,
        stdout: '',
        stderr: code === 0 ? '' : 'Verification of root hash failed.\n',
      }
    }
    throw new Error(`the stub has no transcript for: ${line}`)
  }

  const refuse = (what: string): never => {
    throw new ToolOutputError(`the cmdline fixture has no ${what}.`)
  }
  const ctx: ImageContext = {
    board,
    image: join(dir, 'fixture.img'),
    tools: { route: 'host', announce: 'stub', run: (a, o) => runChecked(exec, a, o), dispose: async () => {} },
    workDir: dir,
    outDir,
    caDir: join(dir, 'ca'),
    gpt: async () => ({
      image: join(dir, 'fixture.img'),
      sectorSize: board.sectorSize ?? 512,
      diskGuid: board.get('DISK_GUID') ?? '',
      totalSectors: walk.totalSizeMib * walk.sectorsPerMib,
      partitions,
      partition: (n: number) => partitions.find(p => p.number === n),
    }),
    partition: async () => refuse('partition lookup'),
    fatSlot: async () => refuse('GPT-derived FAT slot -- these checks take the offset from the layout'),
    extract: async () => refuse('extracted payloads'),
    extractAt: async () => payload,
    unpackRoot: async () => (world.raucConf === undefined ? refuse('unpacked root') : root),
  }
  return { ctx, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

function offsetOf(board: Board, layout: string): number {
  return Number(board.partition(layout)?.get('OFFSET_BYTES') ?? 0)
}

/** cx3576's boot path: the two verity envs and the compiled script. */
function cxFat(over: Partial<Record<string, string>> = {}): Record<string, string | undefined> {
  const a = offsetOf(cx3576, 'BOOT_A')
  const b = offsetOf(cx3576, 'BOOT_B')
  const guidA = (cx3576.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
  const guidB = (cx3576.partition('ROOTFS_B')?.guid ?? '').toLowerCase()
  return {
    [`${a}::mos-verity-a.env`]: verityEnv(guidA, CX_HASH),
    [`${b}::mos-verity-b.env`]: verityEnv(guidB, CX_HASH),
    [`${a}::boot.scr`]: CX_SCRIPT,
    ...over,
  }
}

/** x64's boot path: grub.cfg on the ESP and a cmdline.cfg on each slot. */
function x64Fat(over: Partial<Record<string, string>> = {}): Record<string, string | undefined> {
  const esp = offsetOf(x64, 'ESP')
  const a = offsetOf(x64, 'BOOT_A')
  const b = offsetOf(x64, 'BOOT_B')
  const guidA = (x64.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
  const guidB = (x64.partition('ROOTFS_B')?.guid ?? '').toLowerCase()
  return {
    [`${esp}::EFI/mos/grub.cfg`]: grubCfg(guidA, guidB),
    [`${esp}::EFI/BOOT/BOOTX64.EFI`]: 'MZ',
    [`${esp}::EFI/mos/grubenv`]: '# GRUB Environment Block\n',
    [`${a}::cmdline.cfg`]: cmdlineFrag(X64_HASH),
    [`${b}::cmdline.cfg`]: cmdlineFrag(X64_HASH),
    ...over,
  }
}

function cxWorld(over: Partial<World> = {}): World {
  return { board: cx3576, fat: cxFat(), params: `VERITY_ROOT_HASH=${CX_HASH}\n`, ...over }
}
function x64World(over: Partial<World> = {}): World {
  return { board: x64, fat: x64Fat(), params: `VERITY_ROOT_HASH=${X64_HASH}\n`, ...over }
}

function checkNamed(id: string): CheckCase {
  const found = CMDLINE_CHECKS_ALL.find(c => c.id === id)
  if (found === undefined) throw new Error(`no cmdline check is registered as '${id}'`)
  return found
}

async function drive(id: string, world: World): Promise<readonly CheckResult[]> {
  const fx = fixture(world)
  try {
    return await checkNamed(id).run(fx.ctx)
  }
  finally {
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

// ── the two readers, before anything is asserted about what they read ─────

describe('the command line is composed the way each bootloader composes it', () => {
  test('the two readers agree about a healthy image, from completely different files', async () => {
    // The point of the whole module: everything downstream is one set of
    // conclusions over two extractions, so both are driven for every check.
    for (const w of [cxWorld(), x64World()]) {
      const r = one(await drive('verity-table-read-only', w))
      expect(r.verdict).toBe('pass')
    }
  })

  test('GRUB: a slot whose cmdline.cfg is MISSING leaves ${MOS_*} unexpanded', async () => {
    // Not silently empty. The oracle's loop only substitutes what the fragment
    // defines, so a missing fact arrives as a literal `${MOS_ROOT_HASH}` -- and
    // the verity table is then unparseable rather than plausibly wrong.
    const fat = x64Fat()
    delete fat[`${offsetOf(x64, 'BOOT_A')}::cmdline.cfg`]
    const r = one(await drive('verity-hash-vs-built', x64World({ fat })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('${MOS_ROOT_HASH}')
  })

  test('GRUB: a grub.cfg that never mentions the slot yields NO command line', async () => {
    const fat = x64Fat({
      [`${offsetOf(x64, 'ESP')}::EFI/mos/grub.cfg`]: 'set default=0\nset timeout=3\n',
    })
    const r = one(await drive('cmdline-waitfor', x64World({ fat })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('carries NO dm-mod.waitfor=')
  })

  test('GRUB: a fragment that is installed but grub.cfg never references is NOT enough', async () => {
    // The half this composition exists to catch. The fragment is right and the
    // linux line has no ${MOS_ROOT_HASH} in it at all, so the kernel would be
    // given a table with no root hash -- and a check that read the fragment
    // alone would pass.
    const guidA = (x64.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
    const noRef = mutate(grubCfg(guidA, guidA), /\$\{MOS_ROOT_HASH\}/g, 'deadbeef')
    const r = one(await drive('verity-hash-vs-built', x64World({
      fat: x64Fat({ [`${offsetOf(x64, 'ESP')}::EFI/mos/grub.cfg`]: noRef }),
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain(`is 'deadbeef'`)
  })
})

describe('verity-payload-verifies', () => {
  test('green on both boards when veritysetup walks the tree', async () => {
    for (const w of [cxWorld(), x64World()]) {
      expect(one(await drive('verity-payload-verifies', w)).verdict).toBe('pass')
    }
  })

  test('RED when the payload does not verify against the hash the kernel is given', async () => {
    const r = one(await drive('verity-payload-verifies', cxWorld({ verity: 1 })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('FAILED dm-verity verification')
  })

  test('RED, and NOT a verification, when there is no table to read', async () => {
    // `[ -z "${cmdline_hash}" ] || [ "${hash_offset}" -eq 0 ]` -- the table is
    // read BEFORE veritysetup is asked anything, because a missing table and a
    // corrupt payload are different repairs.
    const fat = cxFat({ [`${offsetOf(cx3576, 'BOOT_A')}::mos-verity-a.env`]: 'nothing useful here\n' })
    const r = one(await drive('verity-payload-verifies', cxWorld({ fat })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('could not read a dm-mod.create= verity table out of BOOT-A')
  })

  test('a data block size that is not a number is also an unreadable table', async () => {
    // The guard widened with --no-superblock: the walk now takes the block
    // sizes, the data-block count and the algorithm from the TABLE too, because
    // there is no superblock left to read them out of. A field that does not
    // parse would otherwise reach veritysetup as a default and walk a different
    // tree, which reads as a payload that does not verify.
    const guidA = (cx3576.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
    const bad = mutate(verityEnv(guidA, CX_HASH), '4096 4096 23758 23758', 'xxxx 4096 23758 23758')
    const r = one(await drive('verity-payload-verifies', cxWorld({
      fat: cxFat({ [`${offsetOf(cx3576, 'BOOT_A')}::mos-verity-a.env`]: bad }),
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('could not read a dm-mod.create= verity table')
  })

  test('a hash_start_block that is not a number makes the offset 0, and that is a FAIL', async () => {
    // Reproduced behavior: a non-numeric field leaves hash_offset at 0, and 0
    // is the sentinel the branch above tests for -- so a malformed table is
    // reported as unreadable rather than verified at offset zero.
    const guidA = (cx3576.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
    const bad = mutate(verityEnv(guidA, CX_HASH), '4096 4096 23758 23758', '4096 4096 23758 xxxxx')
    const r = one(await drive('verity-payload-verifies', cxWorld({
      fat: cxFat({ [`${offsetOf(cx3576, 'BOOT_A')}::mos-verity-a.env`]: bad }),
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('could not read a dm-mod.create= verity table')
  })
})

describe('verity-hash-start-no-superblock', () => {
  // The check that would have caught the defect all of the above missed: every
  // other assertion here was green on an image no board could boot, because
  // veritysetup wrote a superblock at hash_start_block and veritysetup read it
  // back, while dm-init reads that block as the hash tree's top level.

  test('RED on a payload formatted the OLD way, quoting the magic it found', async () => {
    for (const [board, fat] of [[cx3576, cxFatHashStart1()], [x64, x64FatHashStart1()]] as const) {
      const world = board === cx3576
        ? cxWorld({ fat, payload: payloadAtHashStart({ superblock: true }) })
        : x64World({ fat, payload: payloadAtHashStart({ superblock: true }) })
      const r = one(await drive('verity-hash-start-no-superblock', world))
      expect(r.verdict).toBe('fail')
      expect(r.message).toContain('points at a verity SUPERBLOCK')
      // The magic itself, not a paraphrase of it: `verity\0\0` in hex.
      expect(r.message).toContain('7665726974790000')
      expect(r.message).toContain('--no-superblock')
    }
  })

  test('green once the same offset holds hash tree instead', async () => {
    for (const [board, fat] of [[cx3576, cxFatHashStart1()], [x64, x64FatHashStart1()]] as const) {
      const world = board === cx3576
        ? cxWorld({ fat, payload: payloadAtHashStart({ superblock: false }) })
        : x64World({ fat, payload: payloadAtHashStart({ superblock: false }) })
      const r = one(await drive('verity-hash-start-no-superblock', world))
      expect(r.verdict).toBe('pass')
      expect(r.message).toContain('points at hash tree')
    }
  })

  test('RED, and NOT a byte comparison, when there is no table to read', async () => {
    const fat = cxFat({ [`${offsetOf(cx3576, 'BOOT_A')}::mos-verity-a.env`]: 'nothing useful here\n' })
    const r = one(await drive('verity-hash-start-no-superblock', cxWorld({ fat })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('could not read a dm-mod.create= verity table out of BOOT-A')
  })

  test('RED when the payload ends before the offset the cmdline names', async () => {
    // The shipped table's hash_start_block against a one-block payload. A read
    // past the end would come back short and compare against nothing, which is
    // the shape "no superblock found" takes when there is no payload either.
    const r = one(await drive('verity-hash-start-no-superblock', cxWorld()))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('ends before the hash_start_block')
  })
})

describe('verity-hash-vs-built', () => {
  test('green when the cmdline hash is the one the local build produced', async () => {
    for (const w of [cxWorld(), x64World()]) {
      expect(one(await drive('verity-hash-vs-built', w)).verdict).toBe('pass')
    }
  })

  test('RED when the image was assembled from a DIFFERENT rootfs than the tree holds', async () => {
    const r = one(await drive('verity-hash-vs-built', cxWorld({
      params: `VERITY_ROOT_HASH=${'0'.repeat(64)}\n`,
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain(`is '${CX_HASH}'`)
  })

  test('RED, naming the path, when the parameter file was never produced', async () => {
    const w = cxWorld()
    delete (w as { params?: string }).params
    const r = one(await drive('verity-hash-vs-built', w))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('verity parameter file not found:')
  })

  test('the LAST VERITY_ROOT_HASH= line wins, as `sed | tail -n1` does', async () => {
    // A parameter file appended to rather than rewritten: the oracle takes the
    // last line, and a reader taking the first would compare against a stale
    // build and report a defect in the image.
    expect(one(await drive('verity-hash-vs-built', cxWorld({
      params: `VERITY_ROOT_HASH=${'0'.repeat(64)}\nVERITY_ROOT_HASH=${CX_HASH}\n`,
    }))).verdict).toBe('pass')
  })
})

describe('verity-salt-on-cmdline', () => {
  test('green on both boards', async () => {
    for (const w of [cxWorld(), x64World()]) {
      expect(one(await drive('verity-salt-on-cmdline', w)).verdict).toBe('pass')
    }
  })

  test('RED on a salt that is not the layout\'s', async () => {
    const guidA = (cx3576.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
    const r = one(await drive('verity-salt-on-cmdline', cxWorld({
      fat: cxFat({
        [`${offsetOf(cx3576, 'BOOT_A')}::mos-verity-a.env`]:
          verityEnv(guidA, CX_HASH, `${'0'.repeat(63)}2`),
      }),
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('expected 0000000000000000000000000000000000000000000000000000000000000001')
  })

  test('the salt is $NF and the hash $(NF-1) -- POSITIONS FROM THE END', async () => {
    // Reproduced, not improved on: a table with one extra trailing field yields
    // the wrong two, and a reader indexing from the front would disagree with
    // the oracle on exactly the malformed tables this is about.
    const guidA = (cx3576.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
    const extra = mutate(verityEnv(guidA, CX_HASH), `${SALT}"`, `${SALT} trailing"`)
    const r = one(await drive('verity-salt-on-cmdline', cxWorld({
      fat: cxFat({ [`${offsetOf(cx3576, 'BOOT_A')}::mos-verity-a.env`]: extra }),
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain(`is 'trailing'`)
  })
})

describe('cmdline-waitfor', () => {
  test('green on both boards, naming the argument it found', async () => {
    for (const w of [cxWorld(), x64World()]) {
      const r = one(await drive('cmdline-waitfor', w))
      expect(r.verdict).toBe('pass')
      expect(r.message).toContain('dm-mod.waitfor=PARTUUID=')
    }
  })

  test('RED when dm-mod.waitfor= is dropped -- boot becomes FLAKY, not broken', async () => {
    // dm_init_init() runs at late_initcall and wait_for_device_probe() does not
    // cover eMMC discovery, so verity assembly races the probe. The image boots
    // most of the time, which is the hardest class of defect to find later.
    const guidA = (cx3576.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
    const without = mutate(verityEnv(guidA, CX_HASH), / dm-mod\.waitfor=PARTUUID=[0-9a-f-]+/, '')
    const r = one(await drive('cmdline-waitfor', cxWorld({
      fat: cxFat({ [`${offsetOf(cx3576, 'BOOT_A')}::mos-verity-a.env`]: without }),
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('carries NO dm-mod.waitfor=')
  })
})

describe('the ROOTFS-A payload\'s own bytes', () => {
  test('green: hsqs, compressor 6, no ext4 superblock', async () => {
    for (const id of ['rootfs-a-squashfs-magic', 'rootfs-a-compressor', 'rootfs-a-no-ext4']) {
      expect(one(await drive(id, cxWorld())).verdict).toBe('pass')
    }
  })

  test('RED when the slot holds something that is not a squashfs', async () => {
    const r = one(await drive('rootfs-a-squashfs-magic', cxWorld({
      payload: squashfsPayload({ magic: 'ustr' }),
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain(`(got 'ustr')`)
  })

  test('a ZERO-FILLED slot reads as the EMPTY string, because `tr -d` strips NULs', async () => {
    const r = one(await drive('rootfs-a-squashfs-magic', cxWorld({ payload: Buffer.alloc(4096) })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain(`(got '')`)
  })

  test('RED on a compressor that is not zstd -- the kernel has no decompressor for it', async () => {
    // xz is compressor id 4. The image assembles, and the device cannot mount
    // its own root.
    const r = one(await drive('rootfs-a-compressor', cxWorld({ payload: squashfsPayload({ comp: 4 }) })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain(`compressor id is '4', expected 6 (zstd)`)
  })

  test('RED when a WRITABLE root was packed into the verity slot', async () => {
    const r = one(await drive('rootfs-a-no-ext4', cxWorld({ payload: squashfsPayload({ ext4: true }) })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('ROOTFS-A carries an ext4 superblock')
  })
})

describe('verity-table-read-only', () => {
  test('green on both boards', async () => {
    for (const w of [cxWorld(), x64World()]) {
      expect(one(await drive('verity-table-read-only', w)).verdict).toBe('pass')
    }
  })

  test('RED when the table drops its ro flag -- the root becomes writable by design', async () => {
    const guidA = (cx3576.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
    const rw = mutate(verityEnv(guidA, CX_HASH), 'rootfs,,,ro,', 'rootfs,,,rw,')
    const r = one(await drive('verity-table-read-only', cxWorld({
      fat: cxFat({ [`${offsetOf(cx3576, 'BOOT_A')}::mos-verity-a.env`]: rw }),
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('is not marked read-only')
  })
})

describe('rauc-slot-on-boot-path', () => {
  test('green on both boards, once per slot', async () => {
    for (const w of [cxWorld(), x64World()]) {
      const r = await drive('rauc-slot-on-boot-path', w)
      expect(r.map(x => x.instance)).toEqual(['A', 'B'])
      expect(r.every(x => x.verdict === 'pass')).toBe(true)
    }
  })

  test('U-Boot: rauc.slot= comes from boot.scr, which is NOT the verity env', async () => {
    // The oracle concatenates scr-A with the slot's verity env rather
    // than composing, because either may legitimately carry it. Removing it
    // from the script alone is enough to fail both slots.
    const fat = cxFat({ [`${offsetOf(cx3576, 'BOOT_A')}::boot.scr`]: 'setenv rootargs "root=/dev/dm-0"\n' })
    const r = await drive('rauc-slot-on-boot-path', cxWorld({ fat }))
    expect(at(r, 'A').verdict).toBe('fail')
    expect(at(r, 'A').message).toContain(`found 'root=/dev/dm-0'`)
    expect(at(r, 'A').message).toContain('Did not find booted slot')
  })

  test('GRUB: a linux line without rauc.slot= fails that slot and not the other', async () => {
    const guidA = (x64.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
    const guidB = (x64.partition('ROOTFS_B')?.guid ?? '').toLowerCase()
    const cfg = mutate(grubCfg(guidA, guidB), ' rauc.slot=A', '')
    const r = await drive('rauc-slot-on-boot-path', x64World({
      fat: x64Fat({ [`${offsetOf(x64, 'ESP')}::EFI/mos/grub.cfg`]: cfg }),
    }))
    expect(at(r, 'A').verdict).toBe('fail')
    expect(at(r, 'B').verdict).toBe('pass')
  })

  test('a root= naming the slot\'s own PARTUUID is the OTHER passing direction', async () => {
    // rauc's root= fallback works when root= is a partition it can realpath.
    // A mos image boots root=/dev/dm-0, which is why rauc.slot= is required --
    // but the branch exists and must be able to pass.
    const guidA = (x64.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
    const guidB = (x64.partition('ROOTFS_B')?.guid ?? '').toLowerCase()
    const cfg = mutate(mutate(grubCfg(guidA, guidB), ' rauc.slot=A', ''),
      'root=/dev/dm-0 rootfstype=squashfs ro rootwait console',
      `root=PARTUUID=${guidA} rootfstype=squashfs ro rootwait console`)
    const r = await drive('rauc-slot-on-boot-path', x64World({
      fat: x64Fat({ [`${offsetOf(x64, 'ESP')}::EFI/mos/grub.cfg`]: cfg }),
    }))
    expect(at(r, 'A').verdict).toBe('pass')
    expect(at(r, 'A').message).toContain(`root= names the slot's own PARTUUID`)
  })
})

// ── the ESP ───────────────────────────────────────────────────────────────

describe('the ESP and the GRUB boot chain', () => {
  const raucOk = (): string => RAUC_CONF({
    'rootfs.0': (x64.partition('ROOTFS_A')?.guid ?? '').toLowerCase(),
    'rootfs.1': (x64.partition('ROOTFS_B')?.guid ?? '').toLowerCase(),
    'boot.0': (x64.partition('BOOT_A')?.guid ?? '').toLowerCase(),
    'boot.1': (x64.partition('BOOT_B')?.guid ?? '').toLowerCase(),
  })

  test('green: the ESP carries the whole static chain and nothing per-slot', async () => {
    expect(one(await drive('esp-boot-chain', x64World())).verdict).toBe('pass')
    expect(one(await drive('esp-no-per-slot-file', x64World())).verdict).toBe('pass')
    expect(one(await drive('esp-grub-cfg-no-hash', x64World())).verdict).toBe('pass')
  })

  test('RED, naming the file, when the EFI binary is missing', async () => {
    const fat = x64Fat()
    delete fat[`${offsetOf(x64, 'ESP')}::EFI/BOOT/BOOTX64.EFI`]
    const r = one(await drive('esp-boot-chain', x64World({ fat })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toBe('the ESP is missing: EFI/BOOT/BOOTX64.EFI')
  })

  test('RED when the ESP carries a PER-SLOT file no install could ever replace', async () => {
    // From the other side: the ESP is in no slot group, so a vmlinuz here
    // would be frozen at whatever was flashed while the rootfs it describes
    // moved on.
    const r = one(await drive('esp-no-per-slot-file', x64World({
      fat: x64Fat({ [`${offsetOf(x64, 'ESP')}::vmlinuz`]: 'kernel' }),
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('the ESP carries per-slot file(s): vmlinuz')
  })

  test('RED when grub.cfg bakes a root hash into a linux line', async () => {
    const guidA = (x64.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
    const baked = mutate(grubCfg(guidA, guidA), '${MOS_ROOT_HASH}', X64_HASH)
    const r = one(await drive('esp-grub-cfg-no-hash', x64World({
      fat: x64Fat({ [`${offsetOf(x64, 'ESP')}::EFI/mos/grub.cfg`]: baked }),
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('bakes a literal hash into a linux line')
  })

  test('a hash on a line that is NOT a `linux` line does not trip it', async () => {
    // The grep is scoped to `^[[:space:]]*linux[[:space:]]`; a comment or a
    // `set` carrying a long hex run is not the kernel's command line.
    const guidA = (x64.partition('ROOTFS_A')?.guid ?? '').toLowerCase()
    const cfg = `# built from rootfs ${X64_HASH}\n${grubCfg(guidA, guidA)}`
    expect(one(await drive('esp-grub-cfg-no-hash', x64World({
      fat: x64Fat({ [`${offsetOf(x64, 'ESP')}::EFI/mos/grub.cfg`]: cfg }),
    }))).verdict).toBe('pass')
  })

  test('a U-Boot board SKIPS all three, through the entry that owns the line', async () => {
    const r = one(await drive('esp-boot-chain', cxWorld()))
    expect(r.verdict).toBe('skip')
    expect(r.message).toContain('the ESP assertions (bootloader=uboot)')
    expect(checkNamed('esp-no-per-slot-file').boards).toEqual(['x64'])
    expect(checkNamed('esp-grub-cfg-no-hash').boards).toEqual(['x64'])
  })

  test('green: no RAUC slot points at the ESP, and the boot slots are the boot partitions', async () => {
    const w = x64World({ raucConf: raucOk() })
    expect(one(await drive('rauc-no-slot-on-esp', w)).verdict).toBe('pass')
    expect(one(await drive('rauc-boot-slots-are-boot-partitions', w)).verdict).toBe('pass')
  })

  test('RED when a slot points at the ESP -- the partition the FIRMWARE boots', async () => {
    // The x64 image really did declare [slot.boot.0] and [slot.boot.1] on its
    // two ESPs, and every other check passed. UEFI picks an ESP and nothing on
    // the device gets a say, so the inactive one was a filesystem no boot reads.
    const espGuid = (x64.partition('ESP')?.guid ?? '').toLowerCase()
    const r = one(await drive('rauc-no-slot-on-esp', x64World({
      raucConf: mutate(raucOk(), (x64.partition('BOOT_A')?.guid ?? '').toLowerCase(), espGuid),
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('a RAUC slot points at the ESP')
  })

  test('RED when the boot slots are not the layout\'s boot partitions', async () => {
    const r = one(await drive('rauc-boot-slots-are-boot-partitions', x64World({
      raucConf: mutate(raucOk(), '[slot.boot.1]\ndevice=/dev/disk/by-partuuid/',
        '[slot.boot.1]\ndevice=/dev/mmcblk0p3\n#'),
    })))
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain(`the boot slots are not the layout's boot partitions`)
  })

  test('a U-Boot board SKIPS the ESP-versus-slot assertion', async () => {
    const r = one(await drive('rauc-no-slot-on-esp', cxWorld()))
    expect(r.verdict).toBe('skip')
    expect(r.message).toContain('the ESP-versus-boot-slot assertion (bootloader=uboot)')
  })
})
