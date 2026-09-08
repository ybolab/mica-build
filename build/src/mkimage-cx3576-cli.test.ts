// The host half: where the inputs are, and the two families of missing one.
//
// the cx3576 assembly contract gives a missing rootfs input and a missing BSP input
// DIFFERENT sentences, and the difference is the whole value of the check: one
// is produced by a script you can run in a minute, the other by a BSP build or a
// BSP_OUT pointed somewhere else. Collapsing them into "not found" would be a
// message that is true and does not tell you what to do.
//
// Nothing here assembles. main() is driven only as far as its preconditions,
// which is where these refusals live; the assembly itself is
// src/mkimage-cx3576.test.ts's.

import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry } from './geometry.ts'
import { main, parseArgs } from './mkimage-cx3576-cli.ts'
import { boardEnvPath, makeWorkDir, REPO_ROOT } from './paths.ts'
import { loadBoard } from './verify-package.ts'

const g = loadGeometry('cx3576')

describe('the arguments', () => {
  test('the defaults are _out/cx3576 and boards/cx3576/bsp', () => {
    expect(parseArgs([], {})).toEqual({
      outDir: join(REPO_ROOT, '_out', 'cx3576'),
      bspOut: join(REPO_ROOT, '_out', 'boards', 'cx3576'),
    })
  })

  test('BSP_OUT from the environment wins, as it does in the shell', () => {
    expect(parseArgs([], { BSP_OUT: '/opt/bsp-out' }).bspOut).toBe('/opt/bsp-out')
  })

  test('both directories can be given explicitly, and the flag beats the environment', () => {
    expect(parseArgs(['--out-dir', '/o', '--bsp-out', '/b'], { BSP_OUT: '/opt/bsp-out' }))
      .toEqual({ outDir: '/o', bspOut: '/b' })
  })

  test('an unknown argument is refused rather than ignored', () => {
    // Ignored, `--out-dir` misspelled would assemble into _out/ and report
    // success about a directory nobody asked for.
    expect(() => parseArgs(['--outdir', '/o'], {})).toThrow(/unknown argument "--outdir"/)
  })

  test('a flag with no value is refused rather than reading the next flag as one', () => {
    expect(() => parseArgs(['--out-dir'], {})).toThrow(/--out-dir needs a directory/)
  })
})

describe('the two families of missing input', () => {
  function emptyOut(): { dir: string, cleanup: () => void } {
    const d = makeWorkDir('cli-inputs')
    mkdirSync(join(d, 'out'), { recursive: true })
    return { dir: d, cleanup: () => rmSync(d, { recursive: true, force: true }) }
  }

  test('a missing rootfs input names the producer to RUN', async () => {
    const e = emptyOut()
    try {
      await expect(main(['--out-dir', join(e.dir, 'out'), '--bsp-out', join(e.dir, 'board')]))
        .rejects.toThrow(/rootfs-verity\.img not found; run 'bash rootfs\/build\.sh' first/)
    } finally { e.cleanup() }
  })

  test('a missing boot-export input names the export and the package behind it', async () => {
    // The rootfs side has to be satisfied first, or the other message wins --
    // which is itself the order the shell checks in.
    //
    // PLAN-086 S2: this used to name BSP_OUT, because that is where the
    // assembler read the kernel and the device tree from. It reads
    // _out/<board>/boot/ now, and BSP_OUT could be pointed anywhere at all
    // without changing what the image is assembled from -- so a message naming
    // it would send a reader to a directory that no longer decides anything.
    const e = emptyOut()
    try {
      const out = join(e.dir, 'out')
      for (const f of ['rootfs-verity.img', 'rootfs-verity.env', 'boot-cmdline-a.txt', 'boot-cmdline-b.txt']) {
        writeFileSync(join(out, f), '')
      }
      await expect(main(['--out-dir', out, '--bsp-out', '/opt/nowhere']))
        .rejects.toThrow(/boot\/Image not found; it is exported out of the packed root by 'MOS_BOARD=cx3576 bash rootfs\/build\.sh'/)
    } finally { e.cleanup() }
  })

  test('a missing uboot-mos gets the uboot-mos-only sentence, not "not found"', async () => {
    // The kernel, the device tree and boot.cmd have to be in the export first,
    // or the sentence above wins -- the u-boot blob is checked last, exactly as
    // it was when all three came from BSP_OUT.
    const e = emptyOut()
    try {
      const out = join(e.dir, 'out')
      const board = join(e.dir, 'board')
      for (const f of ['rootfs-verity.img', 'rootfs-verity.env', 'boot-cmdline-a.txt', 'boot-cmdline-b.txt']) {
        writeFileSync(join(out, f), '')
      }
      mkdirSync(join(out, 'boot'), { recursive: true })
      for (const f of ['Image', 'rk3576-src.dtb', 'boot.cmd']) writeFileSync(join(out, 'boot', f), '')
      await expect(main(['--out-dir', out, '--bsp-out', board]))
        .rejects.toThrow(/build it with 'make -C boards\/cx3576\/bsp uboot-mos'/)
    } finally { e.cleanup() }
  })

  test('the boot inputs are read from the EXPORT, never from BSP_OUT', async () => {
    // The property PLAN-086 S2 is for, driven from the side that can fail: a
    // BSP_OUT holding every blob does not satisfy the assembler, because a
    // BSP tree and the packed root can disagree about which kernel this image
    // was composed with, and only one of them is in the image.
    const e = emptyOut()
    try {
      const out = join(e.dir, 'out')
      const board = join(e.dir, 'board')
      for (const f of ['rootfs-verity.img', 'rootfs-verity.env', 'boot-cmdline-a.txt', 'boot-cmdline-b.txt']) {
        writeFileSync(join(out, f), '')
      }
      mkdirSync(join(board, 'kernel'), { recursive: true })
      mkdirSync(join(board, 'uboot-mos'), { recursive: true })
      for (const f of ['Image', 'rk3576-src.dtb']) writeFileSync(join(board, 'kernel', f), '')
      writeFileSync(join(board, 'uboot-mos', 'u-boot-rockchip.bin'), '')
      await expect(main(['--out-dir', out, '--bsp-out', board]))
        .rejects.toThrow(/boot\/Image not found; it is exported out of the packed root/)
    } finally { e.cleanup() }
  })

  test('the uboot paths are built from the BOARD, not written here', () => {
    // UBOOT_VARIANT_DIR / UBOOT_DEBUG_VARIANT_DIR / UBOOT_BIN_NAME. A literal
    // 'uboot-mos/u-boot-rockchip.bin' here would be a second copy of the board's
    // answer, and the pairing guard would compare the wrong two files the day
    // the board renamed either.
    expect(g.require('UBOOT_VARIANT_DIR')).toBe('uboot-mos')
    expect(g.require('UBOOT_DEBUG_VARIANT_DIR')).toBe('uboot')
    expect(g.require('UBOOT_BIN_NAME')).toBe('u-boot-rockchip.bin')
  })
})

describe('the board definition itself', () => {
  test('a board.env that is not there is refused by name', () => {
    // `[ ! -f "${LAYOUT_ENV}" ]` in the shell, and the first thing it does.
    // Here the model refuses it, which is the same check one layer down -- but
    // it has to actually name the path, or an assembly with no layout reads as
    // a parse failure.
    expect(() => loadBoard(join(REPO_ROOT, '_out', 'no-such-board.env')))
      .toThrow(/no-such-board\.env/)
  })

  test('and the real one is there, so the assertion above is about absence', () => {
    expect(loadBoard(boardEnvPath('cx3576')).name).toBe('cx3576')
  })
})
