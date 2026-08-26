// The host half: where the inputs are, and the two families of missing one.
//
// os/mkimage-v2.sh gives a missing rootfs input and a missing BSP input
// DIFFERENT sentences, and the difference is the whole value of the check: one
// is produced by a script you can run in a minute, the other by a BSP build or a
// BOARD_DIR pointed somewhere else. Collapsing them into "not found" would be a
// message that is true and does not tell you what to do.
//
// Nothing here assembles. main() is driven only as far as its preconditions,
// which is where these refusals live; the assembly itself is
// src/mkimage-v2.test.ts's.

import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry } from './geometry.ts'
import { main, parseArgs } from './mkimage-v2-cli.ts'
import { boardEnvPath, makeWorkDir, REPO_ROOT } from './paths.ts'
import { loadBoard } from './verify-package.ts'

const g = loadGeometry('cx3576')

describe('the arguments', () => {
  test('the defaults are _out/cx3576 and board/cx3576', () => {
    expect(parseArgs([], {})).toEqual({
      outDir: join(REPO_ROOT, '_out', 'cx3576'),
      boardDir: join(REPO_ROOT, 'board', 'cx3576'),
    })
  })

  test('BOARD_DIR from the environment wins, as it does in the shell', () => {
    expect(parseArgs([], { BOARD_DIR: '/opt/bsp' }).boardDir).toBe('/opt/bsp')
  })

  test('both directories can be given explicitly, and the flag beats the environment', () => {
    expect(parseArgs(['--out-dir', '/o', '--board-dir', '/b'], { BOARD_DIR: '/opt/bsp' }))
      .toEqual({ outDir: '/o', boardDir: '/b' })
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
      await expect(main(['--out-dir', join(e.dir, 'out'), '--board-dir', join(e.dir, 'board')]))
        .rejects.toThrow(/rootfs-verity\.img not found; run 'bash os\/rootfs\/build-v2\.sh' first/)
    } finally { e.cleanup() }
  })

  test('a missing BSP input names BOARD_DIR and says what it currently is', async () => {
    // The rootfs side has to be satisfied first, or the other message wins --
    // which is itself the order the shell checks in.
    const e = emptyOut()
    try {
      const out = join(e.dir, 'out')
      for (const f of ['rootfs-verity.img', 'rootfs-verity.env', 'boot-cmdline-a.txt', 'boot-cmdline-b.txt']) {
        writeFileSync(join(out, f), '')
      }
      await expect(main(['--out-dir', out, '--board-dir', '/opt/nowhere']))
        .rejects.toThrow(/Image not found; build the BSP or set BOARD_DIR \(currently: \/opt\/nowhere\)/)
    } finally { e.cleanup() }
  })

  test('a missing uboot-mos gets the uboot-mos-only sentence, not "not found"', async () => {
    const e = emptyOut()
    try {
      const out = join(e.dir, 'out')
      const board = join(e.dir, 'board')
      for (const f of ['rootfs-verity.img', 'rootfs-verity.env', 'boot-cmdline-a.txt', 'boot-cmdline-b.txt']) {
        writeFileSync(join(out, f), '')
      }
      mkdirSync(join(board, 'out', 'kernel'), { recursive: true })
      writeFileSync(join(board, 'out', 'kernel', 'Image'), '')
      writeFileSync(join(board, 'out', 'kernel', 'rk3576-src.dtb'), '')
      await expect(main(['--out-dir', out, '--board-dir', board]))
        .rejects.toThrow(/build it with 'make -C board\/cx3576 uboot-mos'/)
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
