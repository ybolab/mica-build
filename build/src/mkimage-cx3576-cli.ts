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

const USAGE = `usage: bash build/run.sh --mkimage-cx3576 [--out-dir DIR] [--bsp-out DIR]

Assembles the flashable cx3576 A/B GPT disk image. Every input the image
carries comes from _out/${BOARD}/ -- the verity image, the per-slot cmdlines,
and _out/${BOARD}/boot/, where the rootfs build exported this board's kernel,
device tree, U-Boot blob and boot.cmd out of the packed root. _out/boards/${BOARD}/
is read for one thing only: the debug U-Boot variant, to refuse an image
assembled from it.

  --out-dir DIR    where the rootfs build's outputs are and the image is written
                   (default: _out/${BOARD})
  --bsp-out DIR    the BSP build products (default: _out/boards/${BOARD}, or BSP_OUT)

environment:
  MOS_ROOTFS_SLOT_MIB  supplied AT ALL selects the frozen-geometry mode; its
                       absence selects the floor mode. Never its value.
  MOS_BUILD_TOOLBOX    container -- the only route there is; host is refused by name
`

export interface CliOptions {
  readonly outDir: string
  readonly bspOut: string
}

export function parseArgs(argv: readonly string[], env: Record<string, string | undefined>): CliOptions {
  let outDir = join(REPO_ROOT, '_out', BOARD)
  let bspOut = env.BSP_OUT ?? join(REPO_ROOT, '_out', 'boards', BOARD)
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--out-dir' || a === '--bsp-out') {
      if (next === undefined) throw new Error(`${a} needs a directory\n\n${USAGE}`)
      if (a === '--out-dir') outDir = next
      else bspOut = next
      i += 1
      continue
    }
    if (a === '--help' || a === '-h') {
      console.log(USAGE)
      process.exit(0)
    }
    throw new Error(`unknown argument ${JSON.stringify(a)}\n\n${USAGE}`)
  }
  return { outDir, bspOut }
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv, process.env)
  const geometry = loadGeometry(BOARD)

  const outDir = options.outDir
  const bspOut = options.bspOut
  const rootfsVerityImg = join(outDir, 'rootfs-verity.img')
  const rootfsVerityEnv = join(outDir, 'rootfs-verity.env')
  const bootCmdlineA = join(outDir, 'boot-cmdline-a.txt')
  const bootCmdlineB = join(outDir, 'boot-cmdline-b.txt')
  // THE BOOT INPUTS COME OUT OF THE ROOTFS BUILD'S EXPORT, not out of BSP_OUT
  // (PLAN-086 S2). They ride into the root inside mos-board-cx3576 -- which is
  // what makes "which blobs was this image assembled from" a property of the
  // package set rather than of the directory the build happened to be run
  // beside -- and rootfs/scripts/pack-export-boot.sh takes them back out of the
  // packed root into _out/<board>/boot/ before it ships. Reading them from
  // BSP_OUT here would assemble an image from blobs the composed root never saw,
  // which is the one difference this export exists to make impossible.
  //
  // Nothing is lost from the BSP compare: verify's bsp-compare family still
  // reads each assembled slot's Image and device tree back and diffs them
  // against ${BSP_OUT}/kernel/, so the export drifting from the BSP build is a
  // check going red rather than a fact nobody looks at.
  const bootExport = join(outDir, 'boot')
  const kernelImage = join(bootExport, 'Image')
  const dtb = join(bootExport, 'rk3576-src.dtb')
  const bootCmd = join(bootExport, 'boot.cmd')
  const ubootBin = geometry.require('UBOOT_BIN_NAME')
  const uboot = join(bootExport, ubootBin)
  // The debug variant is the one input still read from BSP_OUT, and it is read
  // only to be compared: no package carries it, because no image may be
  // assembled from it. Absent, the pairing guard below simply does not fire.
  const ubootDebug = join(bspOut, geometry.require('UBOOT_DEBUG_VARIANT_DIR'), ubootBin)

  // The two families of missing input keep DIFFERENT sentences, and the split
  // has moved with the inputs: one family is what the rootfs build writes
  // itself, the other is what it exports out of the board package. Both are
  // produced by the same command, and saying which kind is missing is what
  // tells a reader whether the composition is wrong or the board package is.
  for (const input of [rootfsVerityImg, rootfsVerityEnv, bootCmdlineA, bootCmdlineB]) {
    if (!existsSync(input)) {
      throw new Error(`${input} not found; run 'bash ${ROOTFS_PRODUCER}' first`)
    }
  }
  for (const input of [kernelImage, dtb, bootCmd]) {
    if (!existsSync(input)) {
      throw new Error(
        `${input} not found; it is exported out of the packed root by `
        + `'MOS_BOARD=${BOARD} bash ${ROOTFS_PRODUCER}', which takes it from the installed `
        + `mos-board-${BOARD} package. An export missing a file means that package did not carry it`,
      )
    }
  }
  if (!existsSync(uboot)) {
    throw ubootMissingError(uboot, geometry.require('UBOOT_DEBUG_VARIANT_DIR'))
  }

  mkdirSync(outDir, { recursive: true })
  const imgName = `${geometry.naming.prefix}${Math.floor(Date.now() / 1000)}${geometry.naming.suffix}`
  const imgOut = join(outDir, imgName)

  await assembleCx3576({
    kernelImage,
    dtb,
    bootCmd,
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
