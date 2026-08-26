// The CLI: where the inputs are, and what it refuses.
//
// Cheap and pure -- nothing here assembles. What it is about is the seam between
// "the caller said where things are" and "the assembler was handed paths", which
// is the layer at which os/mkimage-x64.sh derives everything from its own
// ${BASH_SOURCE[0]} and can therefore be pointed nowhere.

import { describe, expect, test } from 'bun:test'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry, loadGeometryFromPath } from './geometry.ts'
import { parseArgs } from './mkimage-x64-cli.ts'
import { assembleX64, BOARD, ROOTFS_PRODUCER } from './mkimage-x64.ts'
import { boardEnvPath, makeWorkDir, REPO_ROOT } from './paths.ts'

const g = loadGeometry(BOARD)

describe('the arguments', () => {
  test('the default output directory is _out/x64', () => {
    expect(parseArgs([]).outDir).toBe(join(REPO_ROOT, '_out', 'x64'))
    expect(parseArgs([]).grubCfg).toBeUndefined()
  })

  test('both can be given explicitly', () => {
    const o = parseArgs(['--out-dir', '/o', '--grub-cfg', '/g/grub.cfg'])
    expect(o.outDir).toBe('/o')
    expect(o.grubCfg).toBe('/g/grub.cfg')
  })

  test('an unknown argument is refused rather than ignored', () => {
    // run.sh forwards everything after the mode flag straight here. An argument
    // this parser shrugged at would be an assembly answering a request it did not
    // read -- which is the same failure the first-position rule guards against
    // one layer up.
    expect(() => parseArgs(['--board', 'cx3576'])).toThrow(/unknown argument "--board"/)
  })

  test('a flag with no value is refused rather than reading the next flag as one', () => {
    expect(() => parseArgs(['--out-dir'])).toThrow(/--out-dir needs a directory/)
    expect(() => parseArgs(['--grub-cfg'])).toThrow(/--grub-cfg needs a file/)
  })

  test('MOS_ROOTFS_SLOT_MIB is NOT read, and the usage says so', () => {
    // os/mkimage-x64.sh sources os/boards/x64/board.env before it reads that key,
    // so the board's 512 has already overwritten anything the environment said.
    // A CLI that honoured it would give the x64 release path a slot mode its
    // shell has never had. Asserted by the absence of the plumbing: neither the
    // parser nor the options carry it.
    expect(Object.keys(parseArgs([]))).toEqual(['outDir', 'grubCfg'])
    expect(JSON.stringify(parseArgs(['--out-dir', '/o']))).not.toContain('SLOT')
  })
})

describe('the inputs it derives', () => {
  test('all five come from the OUT DIRECTORY, and none from a BSP tree', async () => {
    // The other difference from src/mkimage-v2-cli.ts, and it is the board's:
    // cx3576 takes its kernel and dtb from board/cx3576/out and its U-Boot from a
    // BSP build, so it has two families of missing input and two sentences. x64
    // has one family -- everything is produced by the rootfs build -- so it has
    // one sentence, and this is what says the second family does not exist.
    const dir = makeWorkDir('x64-cli')
    try {
      const missing = join(dir, 'nothing')
      // Every one of the five, absent, reaches the SAME refusal.
      await expect(assembleX64({
        rootfsVerityImg: join(missing, 'rootfs-verity.img'),
        rootfsVerityEnv: join(missing, 'rootfs-verity.env'),
        kernel: join(missing, 'boot', 'vmlinuz'),
        initrd: join(missing, 'boot', 'initrd.img'),
        factoryVar: join(missing, 'factory-var'),
        imgOut: join(dir, 'out.img'),
      }, { log: () => {} })).rejects.toThrow(
        /rootfs-verity\.img not found\. Build the root first: MOS_BOARD=x64 bash os\/rootfs\/build-v2\.sh/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the producer sentence names x64 as a LITERAL, never ${MOS_BOARD}', () => {
    // os/mkimage-x64.sh:150 records the failure this prevents: the message used
    // to interpolate a variable no board.env sets, so under `set -u` the one case
    // someone had written an actionable message for died with "MOS_BOARD: unbound
    // variable" instead of printing it. A `${MOS_BOARD:-x64}` default would still
    // have been wrong -- a cx3576 left in the environment would name the wrong
    // board to build.
    expect(ROOTFS_PRODUCER).toBe('MOS_BOARD=x64 bash os/rootfs/build-v2.sh')
    expect(ROOTFS_PRODUCER).not.toContain('$')
  })

  test('the image name and the -latest link come from the board, not from here', () => {
    expect(g.naming.prefix).toBe('x64-mos-v2-')
    expect(g.naming.suffix).toBe('.img')
    expect(g.naming.latestName).toBe('x64-mos-v2-latest.img')
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
      await expect(assembleX64({
        rootfsVerityImg: '/nowhere/a', rootfsVerityEnv: '/nowhere/b', kernel: '/nowhere/c',
        initrd: '/nowhere/d', factoryVar: '/nowhere/e', imgOut: join(dir, 'out.img'),
      }, { geometry: bad, log: () => {} })).rejects.toThrow(
        /unusable value\(s\), and an assembler cannot pick one of two contradictory numbers/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
