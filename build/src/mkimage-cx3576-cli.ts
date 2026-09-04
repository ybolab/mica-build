// The host half of the cx3576 assembly contract: where the inputs are, what the output is
// called, and the -latest symlink.
//
// THE SEAM: epoch naming and the -latest symlink happen on the host side, in
// this file; src/mkimage-cx3576.ts is everything below them. The seam is
// structural rather than conventional, because nothing re-execs:
// src/mkimage-cx3576.ts is called in-process and the toolbox decides, per toolset,
// whether the TOOLS run here or in the pinned container.
//
// THE EPOCH IN THE FILENAME IS THE ONLY PER-BUILD VARIATION, and it is computed
// here, once: the image CONTENT must not depend on when it was assembled, so
// nothing downstream of this line
// is allowed to see a clock.

import { existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry } from './geometry.ts'
import { assembleCx3576, BOARD, ROOTFS_PRODUCER, ubootMissingError } from './mkimage-cx3576.ts'
import { slotPinFromEnv } from './layout-cx3576.ts'
import { REPO_ROOT } from './paths.ts'

const USAGE = `usage: bash build/run.sh --mkimage-cx3576 [--out-dir DIR] [--board-dir DIR]

Assembles the flashable cx3576 A/B GPT disk image. Inputs come from
_out/${BOARD}/ and boards/${BOARD}/bsp/out/.

  --out-dir DIR    where the rootfs-side inputs are and the image is written
                   (default: _out/${BOARD})
  --board-dir DIR  the BSP tree (default: boards/${BOARD}/bsp, or BOARD_DIR)

environment:
  MOS_ROOTFS_SLOT_MIB  supplied AT ALL selects the frozen-geometry mode; its
                       absence selects the floor mode. Never its value.
  MOS_BUILD_TOOLBOX    container -- the only route there is; host is refused by name
`

export interface CliOptions {
  readonly outDir: string
  readonly boardDir: string
}

export function parseArgs(argv: readonly string[], env: Record<string, string | undefined>): CliOptions {
  let outDir = join(REPO_ROOT, '_out', BOARD)
  let boardDir = env.BOARD_DIR ?? join(REPO_ROOT, 'boards', BOARD, 'bsp')
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--out-dir' || a === '--board-dir') {
      if (next === undefined) throw new Error(`${a} needs a directory\n\n${USAGE}`)
      if (a === '--out-dir') outDir = next
      else boardDir = next
      i += 1
      continue
    }
    if (a === '--help' || a === '-h') {
      console.log(USAGE)
      process.exit(0)
    }
    throw new Error(`unknown argument ${JSON.stringify(a)}\n\n${USAGE}`)
  }
  return { outDir, boardDir }
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv, process.env)
  const geometry = loadGeometry(BOARD)

  const outDir = options.outDir
  const boardDir = options.boardDir
  const rootfsVerityImg = join(outDir, 'rootfs-verity.img')
  const rootfsVerityEnv = join(outDir, 'rootfs-verity.env')
  const bootCmdlineA = join(outDir, 'boot-cmdline-a.txt')
  const bootCmdlineB = join(outDir, 'boot-cmdline-b.txt')
  const kernelImage = join(boardDir, 'out', 'kernel', 'Image')
  const dtb = join(boardDir, 'out', 'kernel', 'rk3576-src.dtb')
  const ubootBin = geometry.require('UBOOT_BIN_NAME')
  const uboot = join(boardDir, 'out', geometry.require('UBOOT_VARIANT_DIR'), ubootBin)
  const ubootDebug = join(boardDir, 'out', geometry.require('UBOOT_DEBUG_VARIANT_DIR'), ubootBin)

  // The two families of missing input get DIFFERENT sentences, as they do in the
  // shell: one is produced by a script you can run, the other by a BSP build or
  // a BOARD_DIR that is pointed somewhere else.
  for (const input of [rootfsVerityImg, rootfsVerityEnv, bootCmdlineA, bootCmdlineB]) {
    if (!existsSync(input)) {
      throw new Error(`${input} not found; run 'bash ${ROOTFS_PRODUCER}' first`)
    }
  }
  for (const input of [kernelImage, dtb]) {
    if (!existsSync(input)) {
      throw new Error(`${input} not found; build the BSP or set BOARD_DIR (currently: ${boardDir})`)
    }
  }
  if (!existsSync(uboot)) {
    console.error(`note: BOARD_DIR is currently ${boardDir}`)
    throw ubootMissingError(uboot, geometry.require('UBOOT_DEBUG_VARIANT_DIR'))
  }

  mkdirSync(outDir, { recursive: true })
  const imgName = `${geometry.naming.prefix}${Math.floor(Date.now() / 1000)}${geometry.naming.suffix}`
  const imgOut = join(outDir, imgName)

  await assembleCx3576({
    kernelImage,
    dtb,
    uboot,
    ubootDebug,
    rootfsVerityImg,
    rootfsVerityEnv,
    bootCmdlineA,
    bootCmdlineB,
    factoryVar: join(outDir, 'factory-var'),
    imgOut,
  }, { slotPin: slotPinFromEnv() })

  const latest = join(outDir, geometry.naming.latestName)
  // `ln -sfn`: replace, do not follow. lstat rather than exists, because the
  // link this replaces points at the PREVIOUS image and a dangling one -- the
  // shape a cleaned _out/ leaves -- is invisible to a followed stat while still
  // making symlink() fail with EEXIST. And unlink rather than a plain overwrite,
  // because without the -n a symlink pointing at a DIRECTORY is replaced inside
  // it rather than replaced.
  if (lstatSync(latest, { throwIfNoEntry: false }) !== undefined) unlinkSync(latest)
  symlinkSync(imgName, latest)
  console.log(`assembled ${imgOut} (${geometry.naming.latestName} -> ${imgName})`)
  return 0
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)))
  } catch (e) {
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
