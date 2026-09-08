// Host-side entry point for the explicitly SD-only s905x5m image.

import { lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry } from './geometry.ts'
import { slotPinFromEnv } from './layout-cx3576.ts'
import {
  assembleS905x5mSd,
  BOARD,
  ROOTFS_PRODUCER,
  SD_IMAGE_MARKER,
} from './mkimage-s905x5m-sd.ts'
import { REPO_ROOT } from './paths.ts'

const USAGE = `usage: bash build/run.sh --mkimage-s905x5m-sd [--out-dir DIR]

Assembles the s905x5m layout-v2 image for an SD card. The board continues to
run vendor U-Boot from eMMC boot0; this image writes no bootloader. It formats
p1 as the cfgload bridge vendor U-Boot requires, so it MUST NOT be written to
eMMC.

  --out-dir DIR    rootfs inputs and SD image output (default: _out/${BOARD})
Boot inputs are read from DIR/boot/, exported from the selected board package.

Build the rootfs first with:
  MOS_BOARD=${BOARD} bash ${ROOTFS_PRODUCER}
`

export interface CliOptions {
  readonly outDir: string
}

export function parseArgs(
  argv: readonly string[],
  _env: Record<string, string | undefined>,
): CliOptions {
  let outDir = join(REPO_ROOT, '_out', BOARD)
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE)
      process.exit(0)
    }
    if (arg === '--out-dir') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} needs a directory\n\n${USAGE}`)
      }
      outDir = value
      i += 1
      continue
    }
    throw new Error(`unknown argument ${JSON.stringify(arg)}\n\n${USAGE}`)
  }
  return { outDir }
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv, process.env)
  const geometry = loadGeometry(BOARD)
  mkdirSync(options.outDir, { recursive: true })

  if (
    !geometry.naming.prefix.includes(SD_IMAGE_MARKER)
    || !geometry.naming.latestName.includes(SD_IMAGE_MARKER)
  ) {
    throw new Error(
      `${geometry.path} must carry '${SD_IMAGE_MARKER}' in IMAGE_NAME_PREFIX and `
      + `IMAGE_LATEST_NAME; this assembler's output is safe for SD only`,
    )
  }

  const imageName = `${geometry.naming.prefix}${Math.floor(Date.now() / 1000)}${geometry.naming.suffix}`
  const image = join(options.outDir, imageName)
  await assembleS905x5mSd({
    kernelImage: join(options.outDir, 'boot', 'Image'),
    dtb: join(options.outDir, 'boot', 's7d_s905x5m_m100.dtb'),
    bootCmd: join(options.outDir, 'boot', 'boot.cmd'),
    rootfsVerityImg: join(options.outDir, 'rootfs-verity.img'),
    rootfsVerityEnv: join(options.outDir, 'rootfs-verity.env'),
    bootCmdlineA: join(options.outDir, 'boot-cmdline-a.txt'),
    bootCmdlineB: join(options.outDir, 'boot-cmdline-b.txt'),
    factoryVar: join(options.outDir, 'factory-var'),
    bootIniTemplate: join(options.outDir, 'boot', 'boot-sd.ini.in'),
    imgOut: image,
  }, { geometry, slotPin: slotPinFromEnv() })

  const latest = join(options.outDir, geometry.naming.latestName)
  if (lstatSync(latest, { throwIfNoEntry: false }) !== undefined) unlinkSync(latest)
  symlinkSync(imageName, latest)
  console.log(`assembled SD-only ${image} (${geometry.naming.latestName} -> ${imageName})`)
  console.log('medium restriction: write this image to a confirmed SD card only; never to eMMC')
  return 0
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)))
  }
  catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
