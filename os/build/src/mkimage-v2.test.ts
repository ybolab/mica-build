// The assembler, driven over FABRICATED inputs -- and every refusal driven from
// the failing side.
//
// FABRICATED, LIKE os/tests/mkimage-v2-selftest.sh's, AND FOR ITS REASON. A test
// that read _out/cx3576/ would be a test that cannot run on a fresh clone, and
// producing those inputs costs a ~40-minute emulated arm64 rootfs build to
// exercise an assembler that does not care what is inside the payload it places.
// The four properties this assembler actually reads off its inputs are their
// SIZE, their first four bytes, the KEY=value lines of one env file and the
// verity table on the cmdlines -- all of which a fixture can carry honestly.
//
// THE BYTE-IDENTITY GATE IS NOT HERE. It is shell-against-TypeScript over the
// real _out/cx3576/ inputs, it takes minutes and 1.3 GiB, and os/build/HARNESS.md
// carries the recipe and the two hashes. What IS here is everything that gate
// cannot see: a gate compares bytes for a GOOD input, and a port that quietly
// dropped a refusal produces identical bytes for every good input and passes it
// perfectly. What it stopped catching is a board that needs re-flashing.
//
// Slot A's cmdline is written with LOWERCASE PARTUUIDs and slot B's with
// UPPERCASE, deliberately: the real producer emits lowercase (udev and libblkid
// spell by-partuuid names that way) and the layout is uppercase, and a literal
// comparison between them once refused a correct build. Both must be accepted.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry, loadGeometryFromPath, type Geometry } from './geometry.ts'
import { deriveLayout, gptSpecFor } from './layout-cx3576.ts'
import {
  assembleCx3576,
  checkLoaderLanded,
  envFileGet,
  magicHexAt,
  mountsFor,
  sameBytes,
  type AssemblyInputs,
} from './mkimage-v2.ts'
import { BOARDS_DIR, makeWorkDir, REPO_ROOT } from './paths.ts'
import { OPEN_TIMEOUT_MS, TOOL_TIMEOUT_MS } from './testing.ts'
import { Toolbox } from './toolbox.ts'
import { CX3576_ASSEMBLY } from './toolsets.ts'
import { truncate } from './tools/dd.ts'
import { listFat } from './tools/mtools.ts'
import { readPartition, verifyGpt, writeGpt } from './tools/sgdisk.ts'

/** A whole assembly writes ~1.3 GiB of sparse image and formats six filesystems. */
const ASSEMBLE_TIMEOUT_MS = 600_000

const g = loadGeometry('cx3576')
const BOOT_CMD_PATH = join(BOARDS_DIR, 'cx3576', 'boot.cmd')
const HASH = '776ffaf3c23c995829e39e443ef46e0b2ea5dd40d8a0ba9aa8849dfb9335f49f'
const MIB = 1024 * 1024

let tb: Toolbox
let dir: string
let base: AssemblyInputs

/** Deterministic filler: one byte repeated, so a rebuild sees identical input bytes. */
function filler(path: string, bytes: number, byte: number, prefix?: Buffer): void {
  const buf = Buffer.alloc(bytes, byte)
  if (prefix !== undefined) prefix.copy(buf, 0)
  writeFileSync(path, buf)
}

/** A cmdline in the shape os/rootfs/build-v2.sh emits, at the case asked for. */
function cmdlineFor(guid: string): string {
  return `dm-mod.create="rootfs,,,ro,0 8192 verity 1 PARTUUID=${guid} PARTUUID=${guid} 4096 4096 `
    + `1024 1024 sha256 ${HASH} ${g.veritySalt}" dm-mod.waitfor=PARTUUID=${guid} root=/dev/dm-0 `
    + `rootfstype=squashfs ro rootwait ${g.require('BOARD_CMDLINE_ARGS')}\n`
}

beforeAll(async () => {
  dir = makeWorkDir('mkimage-v2-test')
  const rknS = Buffer.from(g.requirePartition('LOADER').require('MAGIC_HEX'), 'hex')

  // Two distinct U-Boot blobs, mirroring the board's two variants. Both carry
  // the idbloader magic, because the assembler refuses a blob without it; the
  // filler after it is what makes them differ, which is what the pairing guard
  // needs to have something to compare.
  filler(join(dir, 'u-boot-rockchip.bin'), 4 * MIB, 0x11, rknS)
  filler(join(dir, 'u-boot-debug.bin'), 4 * MIB, 0x22, rknS)
  filler(join(dir, 'u-boot-nomagic.bin'), 4 * MIB, 0x33)
  filler(join(dir, 'u-boot-oversize.bin'), Number(g.requireInt('UBOOT_MAX_BYTES')) + 1, 0x11, rknS)
  filler(join(dir, 'Image'), 512 * 1024, 0x44)
  filler(join(dir, 'rk3576-src.dtb'), 64 * 1024, 0x55)
  filler(join(dir, 'rootfs-verity.img'), 4 * MIB, 0x66)
  filler(join(dir, 'rootfs-verity-ragged.img'), 4 * MIB + 1, 0x66)
  filler(join(dir, 'rootfs-verity-huge.img'), 300 * MIB, 0x66)
  writeFileSync(join(dir, 'rootfs-verity.env'),
    `VERITY_ROOT_HASH=${HASH}\nVERITY_SALT=${g.veritySalt}\nVERITY_HASH_ALGO=sha256\n`)
  writeFileSync(join(dir, 'boot-cmdline-a.txt'),
    cmdlineFor(g.requirePartition('ROOTFS_A').require('GUID').toLowerCase()))
  writeFileSync(join(dir, 'boot-cmdline-b.txt'),
    cmdlineFor(g.requirePartition('ROOTFS_B').require('GUID').toUpperCase()))

  // The factory /var. Only two properties of the real export reach the
  // assembler: it must be a directory, and it must contain lib/.
  const fv = join(dir, 'factory-var')
  for (const d of ['lib/dpkg', 'lib/mos', 'cache', 'log', 'tmp']) mkdirSync(join(fv, d), { recursive: true })
  writeFileSync(join(fv, 'lib', 'dpkg', 'status'), 'Package: mosd\nStatus: install ok installed\n')
  writeFileSync(join(fv, 'lib', 'mos', 'state.json'), '{}\n')
  const fvNoLib = join(dir, 'factory-var-nolib')
  mkdirSync(join(fvNoLib, 'cache'), { recursive: true })

  base = {
    kernelImage: join(dir, 'Image'),
    dtb: join(dir, 'rk3576-src.dtb'),
    uboot: join(dir, 'u-boot-rockchip.bin'),
    ubootDebug: join(dir, 'u-boot-debug.bin'),
    rootfsVerityImg: join(dir, 'rootfs-verity.img'),
    rootfsVerityEnv: join(dir, 'rootfs-verity.env'),
    bootCmdlineA: join(dir, 'boot-cmdline-a.txt'),
    bootCmdlineB: join(dir, 'boot-cmdline-b.txt'),
    factoryVar: fv,
    imgOut: join(dir, 'out.img'),
  }

  // Every input is pinned to FILE_MTIME, the instant the assembler pins its own
  // staged files to. mke2fs -d copies the SOURCE inode's times in, so a fixture
  // built at wall-clock time would make the rebuild comparison below measure
  // this file rather than the assembler.
  tb = await Toolbox.open(CX3576_ASSEMBLY, { mounts: [REPO_ROOT] })
  await tb.must(['find', dir, '-exec', 'touch', '-h', '-d', g.ext4.fileMtime, '{}', '+'])
}, OPEN_TIMEOUT_MS)

afterAll(async () => {
  await tb?.close()
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
})

/** Assemble with the shared toolbox, swapping in whatever the case is about. */
async function assemble(
  overrides: Partial<AssemblyInputs> = {},
  extra: { slotPin?: string, geometry?: Geometry } = {},
): Promise<Awaited<ReturnType<typeof assembleCx3576>>> {
  return assembleCx3576({ ...base, ...overrides }, {
    toolbox: tb,
    slotPin: extra.slotPin,
    geometry: extra.geometry,
    log: () => {},
  })
}

/** A board.env with lines appended; a later assignment wins, as in a shell. */
function mutatedBoard(appended: string): { geometry: Geometry, cleanup: () => void } {
  const d = makeWorkDir('mkimage-v2-board')
  const path = join(d, 'board.env')
  writeFileSync(path, `${readFileSync(join(BOARDS_DIR, 'cx3576', 'board.env'), 'utf8')}\n${appended}\n`)
  return { geometry: loadGeometryFromPath(path), cleanup: () => rmSync(d, { recursive: true, force: true }) }
}

describe('the fixture is what these tests say it is', () => {
  test('the two u-boot blobs differ, and both carry the idbloader magic', () => {
    // Without this the pairing guard's negative case would be testing two
    // identical files that the guard is right to reject for a different reason.
    expect(sameBytes(join(dir, 'u-boot-rockchip.bin'), join(dir, 'u-boot-debug.bin'))).toBe(false)
    expect(magicHexAt(join(dir, 'u-boot-rockchip.bin'), 0n)).toBe('524b4e53')
    expect(magicHexAt(join(dir, 'u-boot-debug.bin'), 0n)).toBe('524b4e53')
    expect(magicHexAt(join(dir, 'u-boot-nomagic.bin'), 0n)).not.toBe('524b4e53')
  })

  test('the fabricated env file reads the way the assembler reads it', () => {
    expect(envFileGet(join(dir, 'rootfs-verity.env'), 'VERITY_ROOT_HASH')).toBe(HASH)
    expect(envFileGet(join(dir, 'rootfs-verity.env'), 'VERITY_SALT')).toBe(g.veritySalt)
    expect(envFileGet(join(dir, 'rootfs-verity.env'), 'NOT_THERE')).toBe('')
  })

  test('a later KEY=value wins, as a shell reading top to bottom would', () => {
    const p = join(dir, 'twice.env')
    writeFileSync(p, 'K=first\nOTHER=x\nK=second\n')
    expect(envFileGet(p, 'K')).toBe('second')
  })
})

// --- THE REFUSALS ------------------------------------------------------------

describe('the factory /var', () => {
  test('absent is refused, naming the producer to run', async () => {
    expect(assemble({ factoryVar: join(dir, 'nowhere') }))
      .rejects.toThrow(/is not a directory\. The rootfs build exports the factory \/var tree/)
  })

  test('a FILE where a directory should be is refused too', async () => {
    expect(assemble({ factoryVar: join(dir, 'Image') })).rejects.toThrow(/is not a directory/)
  })

  test('a /var with no lib\/ is refused -- no dpkg database, no mosd state', async () => {
    expect(assemble({ factoryVar: join(dir, 'factory-var-nolib') }))
      .rejects.toThrow(/the staged factory \/var has no lib\/; seeding EPHEMERAL from it would produce a \/var with no dpkg database/)
  }, ASSEMBLE_TIMEOUT_MS)
})

describe('THE UBOOT-MOS-ONLY RULE', () => {
  test('a missing uboot-mos names the make target, and says the v1 blob is not a substitute', async () => {
    try {
      await assemble({ uboot: join(dir, 'nowhere.bin') })
      throw new Error('unreachable')
    } catch (e) {
      const s = String(e)
      expect(s).toContain("build it with 'make -C board/cx3576 uboot-mos'")
      expect(s).toContain('is NOT a substitute')
      expect(s).toContain('CONFIG_ENV_IS_NOWHERE')
      expect(s).toContain('silently never run the RAUC A/B handshake')
    }
  })

  test('THE PAIRING GUARD: a uboot-mos byte-identical to the debug build', async () => {
    // The whole family of "someone copied or symlinked the debug build into
    // uboot-mos because the real build was inconvenient". Neither mistake
    // announces itself: the image boots, looks healthy, and never runs the
    // handshake.
    try {
      await assemble({ uboot: join(dir, 'u-boot-debug.bin') })
      throw new Error('unreachable')
    } catch (e) {
      expect(String(e)).toMatch(/is byte-identical to the debug build at/)
      expect(String(e)).toContain('do not copy or symlink the other variant into place')
      // The refusal quotes the env offsets the real variant carries.
      expect(String(e)).toContain(g.requirePartition('UENV_A').require('OFFSET_BYTES'))
    }
  })

  test('and the pairing guard is SKIPPED when there is no debug build to compare with', async () => {
    // Its absence disables nothing else -- a checkout with only uboot-mos built
    // must still assemble. Without this control the guard could be "always
    // refuses" and every case above would still pass.
    const r = await assemble({ ubootDebug: join(dir, 'nowhere.bin'), imgOut: join(dir, 'no-debug.img') })
    expect(r.loaderStartSector).toBe(64n)
    rmSync(r.image, { force: true })
  }, ASSEMBLE_TIMEOUT_MS)
})

describe('THE LOADER MUST CONTAIN A LOADER', () => {
  test('a blob without the RKNS magic is refused before anything is written', async () => {
    // A blob the BootROM will not load produces an image that passes every
    // structural check and does not boot.
    expect(assemble({ uboot: join(dir, 'u-boot-nomagic.bin') }))
      .rejects.toThrow(/starts with '33333333', not the Rockchip idbloader magic '524b4e53' \('RKNS'\); the RK3576 BootROM would not recognise it at sector 64/)
  })

  test('a blob that does not fit the loader partition is refused', async () => {
    expect(assemble({ uboot: join(dir, 'u-boot-oversize.bin') }))
      .rejects.toThrow(/does not fit between sector 64 and uenv-a at 16 MiB/)
  })

  test('a blob exactly UBOOT_MAX_BYTES long fits', async () => {
    // The positive control for the size check: `>` and not `>=`.
    const exact = join(dir, 'u-boot-exact.bin')
    filler(exact, Number(g.requireInt('UBOOT_MAX_BYTES')), 0x11,
      Buffer.from(g.requirePartition('LOADER').require('MAGIC_HEX'), 'hex'))
    const r = await assemble({ uboot: exact, imgOut: join(dir, 'exact.img') })
    expect(r.ubootBytes).toBe(g.requireInt('UBOOT_MAX_BYTES'))
    rmSync(r.image, { force: true })
  }, ASSEMBLE_TIMEOUT_MS)
})

describe('the loader identities the board file documents and cannot compute', () => {
  test('a drifting identity stops the assembly, and all three are reported', async () => {
    const m = mutatedBoard('UBOOT_SEEK_SECTOR=2048\nUBOOT_MAX_BYTES=1')
    try {
      await assemble({}, { geometry: m.geometry })
      throw new Error('unreachable')
    } catch (e) {
      expect(String(e)).toContain('LOADER_START_SECTOR=64 but the U-Boot blob is written at sector 2048')
      expect(String(e)).toContain('UBOOT_MAX_BYTES is 1')
    } finally { m.cleanup() }
  })

  test('a board whose values contradict each other is refused before the identities', async () => {
    // geometry.faults is the model's "this key is spelled two ways and they
    // disagree" list. An assembler has no honest single number to use.
    const m = mutatedBoard('BOOT_A_START_SECTOR=99')
    try {
      await assemble({}, { geometry: m.geometry })
      throw new Error('unreachable')
    } catch (e) {
      expect(String(e)).toContain('unusable value')
      expect(String(e)).toContain('BOOT_A_START_SECTOR')
    } finally { m.cleanup() }
  })
})

describe('the verity payload and what the producer said about it', () => {
  test('a payload that is not a whole number of MiB', async () => {
    // It is written RAW into a slot, so it must land on a whole MiB boundary.
    expect(assemble({ rootfsVerityImg: join(dir, 'rootfs-verity-ragged.img') }))
      .rejects.toThrow(/is 4194305 bytes, not a non-zero whole-MiB multiple; fix os\/rootfs\/build-v2\.sh/)
  })

  test('an EMPTY payload -- zero is a whole number of MiB and is not a rootfs', async () => {
    const empty = join(dir, 'empty.img')
    writeFileSync(empty, '')
    expect(assemble({ rootfsVerityImg: empty })).rejects.toThrow(/is 0 bytes, not a non-zero whole-MiB multiple/)
  })

  test('no VERITY_ROOT_HASH in the env file', async () => {
    const p = join(dir, 'no-hash.env')
    writeFileSync(p, `VERITY_SALT=${g.veritySalt}\n`)
    expect(assemble({ rootfsVerityEnv: p }))
      .rejects.toThrow(/VERITY_ROOT_HASH missing from .*; fix os\/rootfs\/build-v2\.sh/)
  })

  test('a salt that is not the pinned one', async () => {
    // A hash tree built with a different salt is a different tree; the board
    // pins the salt precisely so the same content always yields the same hash.
    const p = join(dir, 'wrong-salt.env')
    writeFileSync(p, `VERITY_ROOT_HASH=${HASH}\nVERITY_SALT=${'f'.repeat(64)}\n`)
    expect(assemble({ rootfsVerityEnv: p })).rejects.toThrow(/does not match the pinned VERITY_SALT/)
  })

  test('and the salt comparison folds case', async () => {
    const p = join(dir, 'upper-salt.env')
    writeFileSync(p, `VERITY_ROOT_HASH=${HASH.toUpperCase()}\nVERITY_SALT=${g.veritySalt.toUpperCase()}\n`)
    const r = await assemble({ rootfsVerityEnv: p, imgOut: join(dir, 'upper.img') })
    expect(r.rootHash).toBe(HASH.toUpperCase())
    rmSync(r.image, { force: true })
  }, ASSEMBLE_TIMEOUT_MS)
})

describe('SLOT-PIN STRICT MODE, through the assembler', () => {
  test('a pin the payload does not fit is a build failure, by how much', async () => {
    expect(assemble({ rootfsVerityImg: join(dir, 'rootfs-verity-huge.img') }, { slotPin: '256' }))
      .rejects.toThrow(/pinned at MOS_ROOTFS_SLOT_MIB=256 MiB but .* is 300 MiB -- 44 MiB too large/)
  })

  test('an unreadable pin is refused rather than falling back to the default', async () => {
    expect(assemble({}, { slotPin: 'lots' })).rejects.toThrow(/is not a positive whole number of MiB/)
  })

  test('the same payload assembles fine UNPINNED -- the floor grows to fit it', async () => {
    // The control that makes the case above a statement about the MODE rather
    // than about the payload.
    const r = await assemble(
      { rootfsVerityImg: join(dir, 'rootfs-verity-huge.img'), imgOut: join(dir, 'grown.img') },
    )
    expect(r.slot.mode).toBe('floor')
    expect(r.slot.slotMib).toBe(384n)   // ceil(300*125/100)=375 -> 16-aligned 384
    rmSync(r.image, { force: true })
  }, ASSEMBLE_TIMEOUT_MS)
})

describe('the boot.cmd guards reach the assembly', () => {
  test('a stale partition number stops the build', async () => {
    // The guards themselves are driven exhaustively in boot-cx3576.test.ts; this
    // is the wiring -- that the assembler actually consults them, over the file
    // it is going to compile.
    const stale = join(dir, 'boot-stale.cmd')
    writeFileSync(stale, readFileSync(BOOT_CMD_PATH, 'utf8').replace('setenv bootpart 4', 'setenv bootpart 9'))
    expect(assemble({ bootCmd: stale }))
      .rejects.toThrow(/sets 'bootpart' to '9' for slot A, but the layout puts that partition at p4/)
  })

  test('an out-of-range boot-attempts value stops the build', async () => {
    const bad = join(dir, 'boot-attempts.cmd')
    writeFileSync(bad, readFileSync(BOOT_CMD_PATH, 'utf8').replace('setenv BOOT_A_LEFT 3', 'setenv BOOT_A_LEFT 12'))
    expect(assemble({ bootCmd: bad })).rejects.toThrow(/boot-attempts value of 12/)
  })

  test('a boot.cmd that is not there', async () => {
    expect(assemble({ bootCmd: join(dir, 'nowhere.cmd') })).rejects.toThrow(/not found/)
  })

  test('a cmdline that lost dm-mod.waitfor stops the build', async () => {
    const p = join(dir, 'cmdline-nowait.txt')
    writeFileSync(p, readFileSync(base.bootCmdlineA, 'utf8').replace(/ dm-mod\.waitfor=\S+/, ''))
    expect(assemble({ bootCmdlineA: p })).rejects.toThrow(/carries no dm-mod\.waitfor=/)
  }, ASSEMBLE_TIMEOUT_MS)

  test('slot B\'s cmdline pointing at rootfs-a stops the build', async () => {
    const p = join(dir, 'cmdline-b-wrong.txt')
    writeFileSync(p, cmdlineFor(g.requirePartition('ROOTFS_A').require('GUID').toLowerCase()))
    expect(assemble({ bootCmdlineB: p }))
      .rejects.toThrow(/the slot-B verity table in .* does not reference PARTUUID/)
  }, ASSEMBLE_TIMEOUT_MS)
})

describe('the inputs a build cannot start without', () => {
  for (const [key, why] of [
    ['kernelImage', 'it is a BSP artifact'],
    ['dtb', 'it is a BSP artifact'],
    ['rootfsVerityEnv', "produce it with 'os/rootfs/build-v2.sh'"],
    ['bootCmdlineA', "produce it with 'os/rootfs/build-v2.sh'"],
    ['bootCmdlineB', "produce it with 'os/rootfs/build-v2.sh'"],
  ] as [keyof AssemblyInputs, string][]) {
    test(`${key} absent, and the message says what makes it`, async () => {
      try {
        await assemble({ [key]: join(dir, 'nowhere') } as Partial<AssemblyInputs>)
        throw new Error('unreachable')
      } catch (e) {
        expect(String(e)).toContain('not found')
        expect(String(e)).toContain(why)
      }
    })
  }
})

// --- THE ALIGNMENT, WHICH IS THE ONE THAT IS NOT COSMETIC --------------------

describe('THE LOADER LANDS AT SECTOR 64, checked against the written table', () => {
  const layout = deriveLayout(g, 256n)
  const loaderPartnum = g.requirePartition('LOADER').requireInt('PARTNUM')

  test('with the board\'s -a 1, sgdisk puts it at 64 and the check passes', async () => {
    const img = join(dir, 'gpt-aligned.img')
    await truncate(tb, img, `${layout.totalSizeMib}M`)
    await writeGpt(tb, img, gptSpecFor(g, layout))
    const got = await readPartition(tb, img, loaderPartnum)
    expect(got.firstSector).toBe(64n)
    expect(got.sizeSectors).toBe(32704n)
    expect(() => checkLoaderLanded(g, got)).not.toThrow()
    rmSync(img, { force: true })
  }, TOOL_TIMEOUT_MS)

  test('WITHOUT it sgdisk silently relocates the loader to 2048, and exits 0', async () => {
    // Measured in M6a and re-measured here, against a real sgdisk. Every other
    // flag-order and unit difference between the two shell assemblers is
    // byte-identical; this one is not. A relocated loader partition no longer
    // covers the bootloader, and systemd-repart discards every region no
    // partition entry covers -- on the very first boot, while growing DATA. The
    // device boots once and comes up in maskrom on the next power-on.
    const img = join(dir, 'gpt-unaligned.img')
    await truncate(tb, img, `${layout.totalSizeMib}M`)
    const spec = gptSpecFor(g, layout)
    const written = await writeGpt(tb, img, { ...spec, alignSectors: undefined })
    expect(written.exitCode).toBe(0)                       // exit 0. It said nothing.
    expect(await verifyGpt(tb, img)).toContain('No problems found')  // and it verifies.

    const got = await readPartition(tb, img, loaderPartnum)
    expect(got.firstSector).toBe(2048n)                    // NOT 64.
    expect(() => checkLoaderLanded(g, got))
      .toThrow(/the assembled loader partition is 30720 sectors at 2048, expected 32704 at 64\. sgdisk relocates a non-2048-aligned start unless -a 1 is passed/)
    rmSync(img, { force: true })
  }, TOOL_TIMEOUT_MS)

  test('an alignment that is set but WRONG fails too -- in EITHER of its two shapes', async () => {
    // "Omitted" is not the only way to get this wrong, and the two wrong ways do
    // not fail alike -- measured here rather than assumed:
    //
    //   -a 2048  the same as omitting it. sgdisk moves the loader to 2048,
    //            SILENTLY, exit 0, and only the read-back catches it.
    //   -a 4096  sgdisk moves the loader to 4096 AND uenv-b to 36864, which
    //            collides with boot-a -- so it refuses the whole table with
    //            exit 4 and saves nothing.
    //
    // Both are failures and neither is a quietly relocated image. Recording the
    // second matters because it is the shape a reader would assume behaves like
    // the first: a check written only against silent relocation would be right
    // about what it caught and wrong about what it thought it was catching.
    const silent = join(dir, 'gpt-a2048.img')
    await truncate(tb, silent, `${layout.totalSizeMib}M`)
    const wrote = await writeGpt(tb, silent, { ...gptSpecFor(g, layout), alignSectors: 2048n })
    expect(wrote.exitCode).toBe(0)
    const moved = await readPartition(tb, silent, loaderPartnum)
    expect(moved.firstSector).toBe(2048n)
    expect(() => checkLoaderLanded(g, moved)).toThrow(/expected 32704 at 64/)
    rmSync(silent, { force: true })

    const refused = join(dir, 'gpt-a4096.img')
    await truncate(tb, refused, `${layout.totalSizeMib}M`)
    await expect(writeGpt(tb, refused, { ...gptSpecFor(g, layout), alignSectors: 4096n }))
      .rejects.toThrow(/sgdisk could not write the GPT of/)
    rmSync(refused, { force: true })
  }, TOOL_TIMEOUT_MS)

  test('a size that came back short is refused as well as a moved start', async () => {
    // Both halves of the comparison. A check that only looked at the start would
    // pass a loader partition that begins at 64 and stops before the bootloader
    // ends.
    expect(() => checkLoaderLanded(g, {
      partnum: 1n, firstSector: 64n, lastSector: 1063n, sizeSectors: 1000n,
      typecode: '', guid: '', name: 'loader',
    })).toThrow(/is 1000 sectors at 64, expected 32704 at 64/)
  })
})

// --- THE WHOLE THING ---------------------------------------------------------

describe('a whole assembly, and what is actually in it', () => {
  let out: Awaited<ReturnType<typeof assembleCx3576>>

  beforeAll(async () => {
    out = await assemble({ imgOut: join(dir, 'full.img') })
  }, ASSEMBLE_TIMEOUT_MS)

  test('it exists, at the size the layout derived', () => {
    expect(existsSync(out.image)).toBe(true)
    expect(BigInt(statSync(out.image).size)).toBe(g.mibToBytes(out.layout.totalSizeMib))
    expect(out.layout.totalSizeMib).toBe(1315n)   // a 4 MiB payload, floored at 256
    expect(out.slot.mode).toBe('floor')
  })

  test('and the .tmp it was built as is gone', () => {
    expect(existsSync(`${out.image}.tmp`)).toBe(false)
  })

  test('THE LOADER IS AT SECTOR 64, in the assembled table, with RKNS at its first byte', () => {
    expect(out.loaderStartSector).toBe(64n)
    expect(out.loaderSizeSectors).toBe(32704n)
    expect(magicHexAt(out.image, 64n * 512n)).toBe('524b4e53')
  })

  test('every partition is where the board and the chain say', async () => {
    const spec = gptSpecFor(g, out.layout)
    for (const want of spec.partitions) {
      const got = await readPartition(tb, out.image, want.partnum)
      expect(`p${want.partnum} ${got.name} ${got.firstSector} ${got.sizeSectors} ${got.guid.toLowerCase()} ${got.typecode.toLowerCase()}`)
        .toBe(`p${want.partnum} ${want.label} ${want.startSector} ${want.sizeSectors} ${want.guid?.toLowerCase()} ${want.typecode?.toLowerCase()}`)
    }
  }, ASSEMBLE_TIMEOUT_MS)

  test('sgdisk finds no problems with the finished table', async () => {
    expect(await verifyGpt(tb, out.image)).toContain('No problems found')
  }, TOOL_TIMEOUT_MS)

  test('each boot slot carries exactly the four files, and NO extlinux', async () => {
    // No extlinux/extlinux.conf: both U-Boot boot frameworks try extlinux before
    // boot.scr, so one here would silently bypass the whole A/B handshake. And
    // no UNSUFFIXED mos-verity.env: a RAUC-installed slot only ever carries the
    // suffixed file, so writing it would leave that path untested until the
    // first update.
    for (const [part, suffix] of [['BOOT_A', 'a'], ['BOOT_B', 'b']] as [string, string][]) {
      const p = g.requirePartition(part)
      const slice = join(dir, `slice-${suffix}.img`)
      await tb.must(['dd', `if=${out.image}`, `of=${slice}`, 'bs=1M',
        `skip=${p.start?.mib}`, `count=${g.requireInt('BOOT_SIZE_MIB')}`, 'status=none'])
      expect(await listFat(tb, slice)).toEqual([
        '::/Image', `::/${g.require('BOOT_SCRIPT_NAME')}`, `::/mos-verity-${suffix}.env`, '::/rk3576-src.dtb',
      ].sort())
      rmSync(slice, { force: true })
    }
  }, ASSEMBLE_TIMEOUT_MS)

  test('the assembly rebuilds BYTE-IDENTICALLY from the same inputs', async () => {
    // The property the whole design is for. EPHEMERAL is the one filesystem
    // seeded from a tree, and without pin_seeded_times these two differ in the
    // inode table -- 106 bytes of it, spanning every inode the seed created.
    const again = await assemble({ imgOut: join(dir, 'full-again.img') })
    const cmp = await tb.run(['cmp', out.image, again.image])
    expect(`${cmp.exitCode}: ${cmp.stdout}${cmp.stderr}`).toBe('0: ')
    rmSync(again.image, { force: true })
  }, ASSEMBLE_TIMEOUT_MS)

  test('and a changed input changes the bytes -- the comparison is live', async () => {
    // Without this, "byte-identical" could be a comparison that always passes.
    const other = join(dir, 'other-uboot.bin')
    filler(other, 4 * MIB, 0x77, Buffer.from(g.requirePartition('LOADER').require('MAGIC_HEX'), 'hex'))
    const changed = await assemble({ uboot: other, imgOut: join(dir, 'full-changed.img') })
    const cmp = await tb.run(['cmp', '-s', out.image, changed.image])
    expect(cmp.exitCode).not.toBe(0)
    rmSync(changed.image, { force: true })
  }, ASSEMBLE_TIMEOUT_MS)

  test('the work directory is removed, image and all', () => {
    // The staged boot trees, the six filesystem images and the copied /var are
    // hundreds of MiB; a leaked one per assembly fills a disk quietly.
    const work = join(REPO_ROOT, 'os', 'build', '.work')
    const leaked = existsSync(work)
      ? readdirSync(work).filter(n => n.startsWith('mkimage-cx3576-'))
      : []
    expect(leaked).toEqual([])
  })
})

describe('the mounts an assembly asks the toolbox for', () => {
  test('the repository, and the directory of every input outside it', () => {
    const m = mountsFor({ ...base, kernelImage: '/opt/bsp/out/kernel/Image' }, join(dir, 'w'))
    expect(m).toContain(REPO_ROOT)
    expect(m).toContain('/opt/bsp/out/kernel')
  })

  test('a directory already inside another mount is dropped', () => {
    // docker takes nested -v flags and the inner one shadows writes made through
    // the outer, so two mounts of the same bytes is not a harmless duplicate.
    const m = mountsFor(base, join(dir, 'w'))
    expect(m).toEqual([REPO_ROOT])
    for (const a of m) {
      for (const b of m) expect(a === b || !a.startsWith(`${b}/`)).toBe(true)
    }
  })
})
