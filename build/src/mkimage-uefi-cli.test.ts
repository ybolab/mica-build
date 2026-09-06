// The CLI: where the inputs are, and what it refuses.
//
// Cheap and pure -- nothing here assembles. What it is about is the seam between
// "the caller said where things are" and "the assembler was handed paths", which
// is the layer at which the x64 assembly contract derives everything from its own
// ${BASH_SOURCE[0]} and can therefore be pointed nowhere.

import { describe, expect, test } from 'bun:test'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry, loadGeometryFromPath } from './geometry.ts'
import { parseArgs } from './mkimage-uefi-cli.ts'
import { assembleUefi, rootfsProducer } from './mkimage-uefi.ts'
import { boardEnvPath, makeWorkDir, REPO_ROOT } from './paths.ts'

// The board these cases drive. A constant here rather than an import,
// because the module under test no longer has one to import: the assembler
// serves every UEFI board and the board is the caller's to say. x64 is used
// because it is the board whose image this host can actually assemble.
const BOARD = 'x64'
const g = loadGeometry(BOARD)

describe('the arguments', () => {
  test('the output directory defaults to the NAMED board, not to one of them', () => {
    expect(parseArgs(['--board', 'x64']).outDir).toBe(join(REPO_ROOT, '_out', 'x64'))
    expect(parseArgs(['--board', 'virt-arm64']).outDir).toBe(join(REPO_ROOT, '_out', 'virt-arm64'))
    expect(parseArgs(['--board', 'x64']).grubCfg).toBeUndefined()
  })

  test('--board is REQUIRED, and the refusal names the boards it found', () => {
    // The one thing a default would buy is not typing it, and the thing it
    // would cost is a run that assembles the other board's layout under this
    // board's output name. The refusal lists the UEFI boards read off the
    // tree, so it cannot name a set that has gone stale.
    expect(() => parseArgs([])).toThrow(/no --board given/)
    expect(() => parseArgs([])).toThrow(/x64/)
    expect(() => parseArgs([])).toThrow(/virt-arm64/)
  })

  test('--board is order-independent with respect to --out-dir', () => {
    // The default is computed after parsing, so a --board arriving second does
    // not leave the output directory pointing at a different board.
    expect(parseArgs(['--board', 'virt-arm64']).outDir).toBe(join(REPO_ROOT, '_out', 'virt-arm64'))
    expect(parseArgs(['--out-dir', '/o', '--board', 'virt-arm64']).outDir).toBe('/o')
    expect(parseArgs(['--board', 'virt-arm64', '--out-dir', '/o']).outDir).toBe('/o')
  })

  test('all three can be given explicitly', () => {
    const o = parseArgs(['--board', 'x64', '--out-dir', '/o', '--grub-cfg', '/g/grub.cfg'])
    expect(o.board).toBe('x64')
    expect(o.outDir).toBe('/o')
    expect(o.grubCfg).toBe('/g/grub.cfg')
  })

  test('an unknown argument is refused rather than ignored', () => {
    // run.sh forwards everything after the mode flag straight here. An argument
    // this parser shrugged at would be an assembly answering a request it did not
    // read -- which is the same failure the first-position rule guards against
    // one layer up.
    expect(() => parseArgs(['--board', 'x64', '--profile', 'dev']))
      .toThrow(/unknown argument "--profile"/)
  })

  test('a flag with no value is refused rather than reading the next flag as one', () => {
    expect(() => parseArgs(['--board'])).toThrow(/--board needs a board name/)
    expect(() => parseArgs(['--board', 'x64', '--out-dir'])).toThrow(/--out-dir needs a directory/)
    expect(() => parseArgs(['--board', 'x64', '--grub-cfg'])).toThrow(/--grub-cfg needs a file/)
  })

  test('MOS_ROOTFS_SLOT_MIB is NOT read, and the usage says so', () => {
    // the x64 assembly contract sources boards/x64/board.env before it reads that key,
    // so the board's 512 has already overwritten anything the environment said.
    // A CLI that honoured it would give the x64 release path a slot mode its
    // shell has never had. Asserted by the absence of the plumbing: neither the
    // parser nor the options carry it.
    expect(Object.keys(parseArgs(['--board', 'x64']))).toEqual(['board', 'outDir', 'grubCfg'])
    expect(JSON.stringify(parseArgs(['--board', 'x64', '--out-dir', '/o']))).not.toContain('SLOT')
  })
})

describe('the inputs it derives', () => {
  test('all four come from the OUT DIRECTORY, and none from a BSP tree', async () => {
    // The other difference from src/mkimage-cx3576-cli.ts, and it is the board's:
    // cx3576 takes its kernel and dtb from boards/cx3576/bsp/out and its U-Boot from a
    // BSP build, so it has two families of missing input and two sentences. x64
    // has one family -- everything is produced by the rootfs build -- so it has
    // one sentence, and this is what says the second family does not exist.
    const dir = makeWorkDir('x64-cli')
    try {
      const missing = join(dir, 'nothing')
      // Every one of the four, absent, reaches the SAME refusal. It was five
      // until the initrd left with the initramfs.
      await expect(assembleUefi({
        board: BOARD,
        rootfsVerityImg: join(missing, 'rootfs-verity.img'),
        rootfsVerityEnv: join(missing, 'rootfs-verity.env'),
        kernel: join(missing, 'boot', 'vmlinuz'),
        factoryVar: join(missing, 'factory-var'),
        imgOut: join(dir, 'out.img'),
      }, { log: () => {} })).rejects.toThrow(
        /rootfs-verity\.img not found\. Build the root first: MOS_BOARD=x64 bash rootfs\/build\.sh/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the producer sentence names the board it was GIVEN, never ${MOS_BOARD}', () => {
    // the x64 assembly contract records the failure this prevents: the message used
    // to interpolate a variable no board.env sets, so under `set -u` the one case
    // someone had written an actionable message for died with "MOS_BOARD: unbound
    // variable" instead of printing it. A `${MOS_BOARD:-x64}` default would still
    // have been wrong -- a cx3576 left in the environment would name the wrong
    // board to build.
    //
    // Parameterising it for the second UEFI board keeps that property rather
    // than trading it away: the sentence is built from the board the caller
    // passed down, so it still cannot name a board other than the one being
    // assembled, and it still contains nothing a shell would expand.
    expect(rootfsProducer('x64')).toBe('MOS_BOARD=x64 bash rootfs/build.sh')
    expect(rootfsProducer('virt-arm64')).toBe('MOS_BOARD=virt-arm64 bash rootfs/build.sh')
    expect(rootfsProducer(BOARD)).not.toContain('$')
  })

  test('the image name and the -latest link come from the board, not from here', () => {
    expect(g.naming.prefix).toBe('x64-mos-')
    expect(g.naming.suffix).toBe('.img')
    expect(g.naming.latestName).toBe('x64-mos-latest.img')
  })
})

describe('the board definition itself', () => {
  test('a board.env that is not there is refused by name', () => {
    const dir = makeWorkDir('x64-cli-board')
    try {
      expect(() => loadGeometryFromPath(join(dir, 'board.env'))).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('and the real one is there, so the assertion above is about absence', () => {
    expect(existsSync(boardEnvPath(BOARD))).toBe(true)
  })

  test('a board with contradictory numbers is refused before anything is created', async () => {
    // geometry.ts collects rather than throws, and the assembler is what refuses
    // to pick one of two contradictory numbers to hand a tool. Driven with a
    // start declared twice, in two units, disagreeing.
    const dir = makeWorkDir('x64-cli-contradiction')
    try {
      const path = join(dir, 'board.env')
      writeFileSync(path, `${await Bun.file(boardEnvPath(BOARD)).text()}\nESP_START_SECTOR=9999\n`)
      const bad = loadGeometryFromPath(path)
      expect(bad.faults.length).toBeGreaterThan(0)
      await expect(assembleUefi({
        board: BOARD,
        rootfsVerityImg: '/nowhere/a', rootfsVerityEnv: '/nowhere/b', kernel: '/nowhere/c',
        factoryVar: '/nowhere/e', imgOut: join(dir, 'out.img'),
      }, { geometry: bad, log: () => {} })).rejects.toThrow(
        /unusable value\(s\), and an assembler cannot pick one of two contradictory numbers/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
