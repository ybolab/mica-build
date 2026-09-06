// The host half of the UEFI assembly contract: which board, where the inputs
// are, what the output is called, and the -latest symlink.
//
// The shell has no such seam -- it is one file from `stat -c%s` to `ln -sf` --
// but the split is src/mkimage-cx3576-cli.ts's, for the same reason: the epoch in
// the filename is the only per-build variation, computed here, once, so nothing
// downstream may see a clock. An assembler that could read the time is one
// whose output might depend on when it ran, and the byte-identity gate is that
// it does not.
//
// THE BOARD COMES FROM --board AND FROM NOWHERE ELSE. Not from ${MOS_BOARD}:
// the predecessor hardcoded x64 in its layout path and its output directory and
// read MOS_BOARD for nothing, precisely so that a cx3576 left in the
// environment could not name the wrong board to build. Two UEFI boards means
// the board has to be said, so it is said on the command line where it is
// visible in the invocation rather than inherited from a shell that may have
// been set up for something else. There is no default, for the same reason:
// with two boards, a default is a silent choice between them.

import { lstatSync, mkdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry } from './geometry.ts'
import { assembleUefi, rootfsProducer } from './mkimage-uefi.ts'
import { REPO_ROOT, shippedBoards } from './paths.ts'

const USAGE = `usage: bash build/run.sh --mkimage-uefi --board B [--out-dir DIR] [--grub-cfg FILE]

Assembles the flashable A/B GPT disk image for a UEFI board -- one whose
firmware finds an ESP and hands over to GRUB. Inputs come from _out/<board>/.

  --board B        which UEFI board; REQUIRED, and there is no default, because
                   a default would be a silent choice between the boards
  --out-dir DIR    where the rootfs-side inputs are and the image is written
                   (default: _out/<board>)
  --grub-cfg FILE  the grub.cfg template (default: boards/<board>/grub.cfg)

environment:
  MOS_BUILD_TOOLBOX    container -- the only route there is; host is refused by name

MOS_ROOTFS_SLOT_MIB is NOT read from the process environment. A UEFI board's
definition supplies its own slot floor, so this assembler has one slot mode
rather than the cx3576 assembler's separate frozen-geometry mode.
`

export interface CliOptions {
  readonly board: string
  readonly outDir: string
  readonly grubCfg: string | undefined
}

export function parseArgs(argv: readonly string[]): CliOptions {
  let board: string | undefined
  let outDir: string | undefined
  let grubCfg: string | undefined
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = argv[i + 1]
    if (a === '--board' || a === '--out-dir' || a === '--grub-cfg') {
      if (next === undefined) {
        const what = a === '--out-dir' ? 'directory' : a === '--board' ? 'board name' : 'file'
        throw new Error(`${a} needs a ${what}\n\n${USAGE}`)
      }
      if (a === '--board') board = next
      else if (a === '--out-dir') outDir = next
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
  if (board === undefined || board === '') {
    throw new Error(
      'no --board given, and this assembler serves every UEFI board rather than one.\n'
      + `Known UEFI boards in this tree: ${uefiBoards().join(', ') || '(none found)'}.\n\n${USAGE}`,
    )
  }
  // AFTER the board is known, so the default output directory is this board's.
  // Defaulting it before the loop would make `--out-dir` and `--board` order-
  // dependent, and a --board that arrived second would write one board's image
  // into the other board's directory.
  return { board, outDir: outDir ?? join(REPO_ROOT, '_out', board), grubCfg }
}

/**
 * The boards this assembler can build, read off the tree, for the refusal above.
 *
 * A UEFI board is one whose layout names a grub bootloader backend -- the same
 * question `RAUC_BOOTLOADER` answers for RAUC. Discovered rather than listed,
 * for the reason verify/src/paths.ts gives at length: a literal is what a new
 * board gets left out of, and a refusal that names the wrong set is worse than
 * one that names none.
 */
function uefiBoards(): string[] {
  return shippedBoards().filter((b) => {
    try {
      return loadGeometry(b).board.bootloader === 'grub'
    } catch {
      return false
    }
  })
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv)
  const geometry = loadGeometry(options.board)
  const outDir = options.outDir

  mkdirSync(outDir, { recursive: true })
  const imgName = `${geometry.naming.prefix}${Math.floor(Date.now() / 1000)}${geometry.naming.suffix}`
  const imgOut = join(outDir, imgName)

  const result = await assembleUefi({
    board: options.board,
    rootfsVerityImg: join(outDir, 'rootfs-verity.img'),
    rootfsVerityEnv: join(outDir, 'rootfs-verity.env'),
    kernel: join(outDir, 'boot', 'vmlinuz'),
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
    // The board is taken back off the argv rather than from parseArgs, which is
    // one of the things that can have thrown: a note naming the wrong board's
    // producer would be worse than a note naming none.
    const i = process.argv.indexOf('--board')
    const board = i >= 0 ? process.argv[i + 1] : undefined
    console.error(`error: ${e instanceof Error ? e.message : String(e)}`)
    if (board !== undefined && board !== '') {
      console.error(`note: the rootfs-side inputs come from '${rootfsProducer(board)}'`)
    }
    process.exit(1)
  }
}
