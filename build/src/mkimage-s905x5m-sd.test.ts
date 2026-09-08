import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry } from './geometry.ts'
import {
  assembleS905x5mSd,
  escapeUbootDoubleQuoted,
  mountsForSd,
  renderBootIni,
  SD_BOOT_TEMPLATE,
  type SdAssemblyInputs,
} from './mkimage-s905x5m-sd.ts'
import { BOARDS_DIR, makeWorkDir, REPO_ROOT } from './paths.ts'
import { EMMC_PAYLOADS, extractS905x5mEmmcPayloads } from './s905x5m-emmc-payloads.ts'
import { OPEN_TIMEOUT_MS } from './testing.ts'
import { Toolbox } from './toolbox.ts'
import { CX3576_ASSEMBLY } from './toolsets.ts'
import { listFat } from './tools/mtools.ts'
import { readPartition } from './tools/sgdisk.ts'

const ASSEMBLE_TIMEOUT_MS = 600_000
const MIB = 1024 * 1024
const HASH = '776ffaf3c23c995829e39e443ef46e0b2ea5dd40d8a0ba9aa8849dfb9335f49f'
const g = loadGeometry('s905x5m')

let dir: string
let tb: Toolbox
let base: SdAssemblyInputs

function filler(path: string, bytes: number, byte: number): void {
  writeFileSync(path, Buffer.alloc(bytes, byte))
}

function cmdlineFor(guid: string): string {
  return `dm-mod.create="rootfs,,,ro,0 8192 verity 1 PARTUUID=${guid} PARTUUID=${guid} 4096 4096 `
    + `1024 1025 sha256 ${HASH} ${g.veritySalt}" dm-mod.waitfor=PARTUUID=${guid} root=/dev/dm-0 `
    + `rootfstype=squashfs ro rootwait ${g.require('BOARD_CMDLINE_ARGS')}\n`
}

beforeAll(async () => {
  dir = makeWorkDir('mkimage-s905x5m-sd-test')
  filler(join(dir, 'Image'), MIB, 0x44)
  filler(join(dir, 's7d_s905x5m_m100.dtb'), 64 * 1024, 0x55)
  filler(join(dir, 'rootfs-verity.img'), 4 * MIB, 0x66)
  writeFileSync(
    join(dir, 'rootfs-verity.env'),
    `VERITY_ROOT_HASH=${HASH}\nVERITY_SALT=${g.veritySalt}\nVERITY_HASH_ALGO=sha256\n`,
  )
  writeFileSync(
    join(dir, 'boot-cmdline-a.txt'),
    cmdlineFor(g.requirePartition('ROOTFS_A').require('GUID').toLowerCase()),
  )
  writeFileSync(
    join(dir, 'boot-cmdline-b.txt'),
    cmdlineFor(g.requirePartition('ROOTFS_B').require('GUID').toUpperCase()),
  )
  const factoryVar = join(dir, 'factory-var')
  mkdirSync(join(factoryVar, 'lib', 'dpkg'), { recursive: true })
  mkdirSync(join(factoryVar, 'lib', 'mos'), { recursive: true })
  writeFileSync(join(factoryVar, 'lib', 'dpkg', 'status'), 'Package: mosd\nStatus: install ok installed\n')
  writeFileSync(join(factoryVar, 'lib', 'mos', 'state.json'), '{}\n')

  base = {
    kernelImage: join(dir, 'Image'),
    dtb: join(dir, 's7d_s905x5m_m100.dtb'),
    rootfsVerityImg: join(dir, 'rootfs-verity.img'),
    rootfsVerityEnv: join(dir, 'rootfs-verity.env'),
    bootCmdlineA: join(dir, 'boot-cmdline-a.txt'),
    bootCmdlineB: join(dir, 'boot-cmdline-b.txt'),
    factoryVar,
    bootIniTemplate: join(BOARDS_DIR, 's905x5m', 'boot-sd.ini.in'),
    imgOut: join(dir, 's905x5m-sd-test.img'),
  }
  tb = await Toolbox.open(CX3576_ASSEMBLY, { mounts: [REPO_ROOT] })
  await tb.must(['find', dir, '-exec', 'touch', '-h', '-d', g.ext4.fileMtime, '{}', '+'])
}, OPEN_TIMEOUT_MS)

afterAll(async () => {
  await tb?.close()
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
})

describe('the SD boot.ini renderer', () => {
  const template = readFileSync(join(BOARDS_DIR, 's905x5m', 'boot-sd.ini.in'), 'utf8')

  test('renders the real boot partition and preserves dm-mod.create quotes', () => {
    const rendered = renderBootIni({
      template,
      cmdline: cmdlineFor(g.requirePartition('ROOTFS_A').require('GUID')),
      bootPartnum: 5n,
      slot: 'A',
    })
    expect(rendered.startsWith('ODROIDC5-UBOOT-CONFIG\n')).toBe(true)
    expect(rendered).toContain('setenv partition 5')
    expect(rendered).toContain('rauc.slot=A')
    expect(rendered).toContain('dm-mod.create=\\"rootfs,,,ro')
    expect(rendered).toContain('fdt rm /chosen bootargs')
    expect(rendered.indexOf('fdt rm /chosen bootargs')).toBeLessThan(rendered.indexOf('booti ${loadaddr_kernel}'))
    expect(rendered).not.toContain('@MOS_')
  })

  test('escapes every character that could leave the double-quoted word', () => {
    expect(escapeUbootDoubleQuoted('a\\b"c$d`e')).toBe('a\\\\b\\"c\\$d\\`e')
  })

  test('refuses a missing or duplicated token', () => {
    expect(() => renderBootIni({
      template: template.replace('@MOS_SLOT@', ''), cmdline: 'x', bootPartnum: 5n, slot: 'A',
    })).toThrow(new RegExp(`${SD_BOOT_TEMPLATE} contains 0 @MOS_SLOT@ tokens`))
    expect(() => renderBootIni({
      template: `${template}\n@MOS_SLOT@`, cmdline: 'x', bootPartnum: 5n, slot: 'A',
    })).toThrow(new RegExp(`${SD_BOOT_TEMPLATE} contains 2 @MOS_SLOT@ tokens`))
  })

  test('refuses a command line with an embedded newline', () => {
    expect(() => renderBootIni({ template, cmdline: 'one\ntwo', bootPartnum: 5n, slot: 'A' }))
      .toThrow(/must be exactly one non-NUL line/)
  })
})

describe('the SD-only boundary', () => {
  test('the output name must say SD before any input is opened', async () => {
    await expect(assembleS905x5mSd({ ...base, imgOut: join(dir, 'ambiguous.img') }, { toolbox: tb }))
      .rejects.toThrow(/has no '-sd-' marker/)
  })

  test('mounts outside the repository are carried in without nested duplicates', () => {
    const mounts = mountsForSd({ ...base, kernelImage: '/opt/bsp/out/kernel/Image' }, join(dir, 'work'))
    expect(mounts).toContain(REPO_ROOT)
    expect(mounts).toContain('/opt/bsp/out/kernel')
    for (const a of mounts) for (const b of mounts) {
      expect(a === b || !a.startsWith(`${b}/`)).toBe(true)
    }
  })

  test('rejects a boot command whose literal partition number drifted before opening a toolbox', async () => {
    const stale = join(dir, 'stale-boot.cmd')
    writeFileSync(
      stale,
      readFileSync(join(BOARDS_DIR, 's905x5m', 'boot.cmd'), 'utf8')
        .replace('setenv bootpart 5', 'setenv bootpart 9'),
    )
    await expect(assembleS905x5mSd({ ...base, bootCmd: stale }, { geometry: g }))
      .rejects.toThrow(/sets 'bootpart' to '9' for slot A, but the layout puts that partition at p5/)
  })
})

describe('a whole SD assembly', () => {
  let image: string

  beforeAll(async () => {
    const result = await assembleS905x5mSd(base, { toolbox: tb, log: () => {} })
    image = result.image
  }, ASSEMBLE_TIMEOUT_MS)

  test('keeps the twelve-partition layout and leaves the image sparse-sized', async () => {
    expect(existsSync(image)).toBe(true)
    expect(BigInt(statSync(image).size)).toBe(g.mibToBytes(1425n))
    for (let n = 1n; n <= 12n; n += 1n) expect((await readPartition(tb, image, n)).partnum).toBe(n)
  }, ASSEMBLE_TIMEOUT_MS)

  test('p1 is only the cfgload bridge, and boot-a remains p5', async () => {
    const p1 = join(dir, 'p1.img')
    const p5 = join(dir, 'p5.img')
    const p6 = join(dir, 'p6.img')
    await tb.must(['dd', `if=${image}`, `of=${p1}`, 'bs=1M', 'skip=36', 'count=64', 'status=none'])
    await tb.must(['dd', `if=${image}`, `of=${p5}`, 'bs=1M', 'skip=128', 'count=64', 'status=none'])
    await tb.must(['dd', `if=${image}`, `of=${p6}`, 'bs=1M', 'skip=192', 'count=64', 'status=none'])
    expect(await listFat(tb, p1)).toEqual(['::/Image', '::/boot.ini'])
    expect(await listFat(tb, p5)).toEqual([
      '::/Image',
      '::/boot.scr',
      '::/mos-verity-a.env',
      '::/s7d_s905x5m_m100.dtb',
    ].sort())
    expect(await listFat(tb, p6)).toEqual([
      '::/Image',
      '::/boot.scr',
      '::/mos-verity-b.env',
      '::/s7d_s905x5m_m100.dtb',
    ].sort())
    const bootIni = join(dir, 'boot-a.ini')
    const bootScrA = join(dir, 'boot-a.scr')
    const bootScrB = join(dir, 'boot-b.scr')
    await tb.must(['mcopy', '-i', p1, '::/boot.ini', bootIni])
    await tb.must(['mcopy', '-i', p5, '::/boot.scr', bootScrA])
    await tb.must(['mcopy', '-i', p6, '::/boot.scr', bootScrB])
    expect(readFileSync(bootIni, 'utf8')).toContain('setenv partition 5')
    expect(readFileSync(bootScrA).subarray(0, 4).toString('hex')).toBe('27051956')
    expect(readFileSync(bootScrA).equals(readFileSync(bootScrB))).toBe(true)
  }, ASSEMBLE_TIMEOUT_MS)

  test('derives every eMMC-owned payload from the assembled bytes, never p1 or p2', async () => {
    const payloadDir = join(dir, 'emmc-payloads')
    const result = await extractS905x5mEmmcPayloads(image, payloadDir, { toolbox: tb, log: () => {} })
    expect(result.gptBytes).toBe(34304n)
    expect(result.payloads.map(payload => payload.file)).toEqual(EMMC_PAYLOADS.map(payload => payload.file))
    expect(statSync(payloadDir).mode & 0o777).toBe(0o777)
    expect(result.payloads.filter(payload => payload.allZero).map(payload => payload.partition))
      .toEqual(['UENV_A', 'UENV_B', 'ROOTFS_B'])
    expect(statSync(join(payloadDir, 'uenv-a.PARTITION')).size).toBe(64 * 1024)
    expect(statSync(join(payloadDir, 'rootfs-b.PARTITION')).size).toBe(256 * MIB)
    expect(existsSync(join(payloadDir, 'reserved.PARTITION'))).toBe(false)
    expect(existsSync(join(payloadDir, 'env.PARTITION'))).toBe(false)

    const gpt = readFileSync(join(payloadDir, 'gpt.bin'))
    expect(gpt.subarray(512, 520).toString('ascii')).toBe('EFI PART')
    expect(await listFat(tb, join(payloadDir, 'boot-a.PARTITION'))).toEqual([
      '::/Image',
      '::/boot.scr',
      '::/mos-verity-a.env',
      '::/s7d_s905x5m_m100.dtb',
    ].sort())
  }, ASSEMBLE_TIMEOUT_MS)
})
