// The host half of the x64 assembly contract: where the inputs are, what the output is
// called, and the -latest symlink.
//
// The shell has no such seam -- it is one file from `stat -c%s` to `ln -sf` --
// but the split is src/mkimage-cx3576-cli.ts's, for the same reason: the epoch in
// the filename is the only per-build variation, computed here, once, so nothing
// downstream may see a clock. An assembler that could read the time is one
// whose output might depend on when it ran, and the byte-identity gate is that
// it does not.
//
// It deliberately does not derive its inputs from ${MOS_BOARD}:
// the x64 assembly contract hardcodes x64 in its layout path and its output directory
// and reads MOS_BOARD for nothing, so a cx3576 left in the environment must not
// name the wrong board to build. See ROOTFS_PRODUCER in src/mkimage-x64.ts.

import { lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry } from './geometry.ts'
import { assembleX64, BOARD, ROOTFS_PRODUCER } from './mkimage-x64.ts'
import { REPO_ROOT } from './paths.ts'

const USAGE = `usage: bash os/build/run.sh --mkimage-x64 [--out-dir DIR] [--grub-cfg FILE]

Assembles the flashable x64 A/B GPT disk image. Inputs come from _out/${BOARD}/.

  --out-dir DIR    where the rootfs-side inputs are and the image is written
                   (default: _out/${BOARD})
  --grub-cfg FILE  the grub.cfg template (default: os/boards/${BOARD}/grub.cfg)

environment:
  MOS_BUILD_TOOLBOX    host|container -- force the route the tools run on

MOS_ROOTFS_SLOT_MIB is NOT read from the process environment. The x64 board
definition supplies its slot floor, so x64 has one slot mode rather than the
cx3576 assembler's separate frozen-geometry mode.
`

export interface CliOptions {
  readonly outDir: string
  readonly grubCfg: string | undefined
}

export function parseArgs(argv: readonly string[]): CliOptions {
  let outDir = join(REPO_ROOT, '_out', BOARD)
  let grubCfg: string | undefined
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--out-dir' || a === '--grub-cfg') {
      if (next === undefined) throw new Error(`${a} needs a ${a === '--out-dir' ? 'directory' : 'file'}\n\n${USAGE}`)
      if (a === '--out-dir') outDir = next
      else grubCfg = next
      i += 1
      continue
    }
    if (a === '--help' || a === '-h') {
      console.log(USAGE)
      process.exit(0)
    }
    throw new Error(`unknown argument ${JSON.stringify(a)}\n\n${USAGE}`)
  }
  return { outDir, grubCfg }
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv)
  const geometry = loadGeometry(BOARD)
  const outDir = options.outDir

  mkdirSync(outDir, { recursive: true })
  const imgName = `${geometry.naming.prefix}${Math.floor(Date.now() / 1000)}${geometry.naming.suffix}`
  const imgOut = join(outDir, imgName)

  const result = await assembleX64({
    rootfsVerityImg: join(outDir, 'rootfs-verity.img'),
    rootfsVerityEnv: join(outDir, 'rootfs-verity.env'),
    kernel: join(outDir, 'boot', 'vmlinuz'),
    initrd: join(outDir, 'boot', 'initrd.img'),
    factoryVar: join(outDir, 'factory-var'),
    imgOut,
    grubCfgIn: options.grubCfg,
  })

  const latest = join(outDir, geometry.naming.latestName)
  // `ln -sfn`: replace, do not follow. lstat rather than exists, because the
  // link this replaces points at the PREVIOUS image and a dangling one -- the
  // shape a cleaned _out/ leaves -- is invisible to a followed stat while still
  // making symlink() fail with EEXIST.
  if (lstatSync(latest, { throwIfNoEntry: false }) !== undefined) unlinkSync(latest)
  symlinkSync(imgName, latest)

  // The same three blocks the x64 assembly contract prints, and the middle one is the
  // reason: the fragment RAUC replaces on every install is the file whose
  // contents an operator most often needs to see, and it is the one file in the
  // image that no `ls` will show them.
  const bytes = Bun.file(imgOut).size
  console.log(`=== image: ${imgOut} (${bytes} bytes, ${Math.floor(bytes / 1048576)} MiB) ===`)
  console.log('=== slot A boot facts (the fragment RAUC replaces on every install) ===')
  console.log(`  verity root hash ${result.verity.rootHash}`)
  console.log(`  ${result.slot.summary}`)
  console.log(`  ${geometry.naming.latestName} -> ${imgName}`)
  return 0
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)))
  } catch (e) {
    // The rootfs-side inputs are the family a reader is most likely to be
    // missing, so the producer is named once here rather than in every message.
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`)
    console.error(`note: the rootfs-side inputs come from '${ROOTFS_PRODUCER}'`)
    process.exit(1)
  }
}
