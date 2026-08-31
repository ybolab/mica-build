// The regression a stale extraction workspace produced, driven through a real
// check rather than through an assertion about directories.
//
// The shape it arrives in: build an image, verify it, rebuild the rootfs, verify
// again at the same --work. The second run re-reads the GPT and re-extracts
// every partition, and then reads the FIRST image's `cmdline.cfg` out of the
// workspace -- `fatText` skips the mcopy when the destination is already there,
// and the destination is named after the SLOT. `verity-hash-vs-built` compares
// the root hash on that command line against `_out/<board>/rootfs-verity.env`,
// which the rebuild DID update, so the run reports the new image as carrying the
// old release's root hash. A FAIL about an image the verifier never looked at.
//
// x64, because it is the board whose command line is composed from two FAT files
// and the board the end-to-end exercise of this fix builds. Nothing here runs a
// container: mcopy is answered from a per-image table below, which is what lets
// the two images differ in exactly one thing -- the root hash in the fragment --
// and lets the assertion be about that.

import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBoard, type Board } from './board.ts'
import { CMDLINE_CHECKS_ALL } from './checks-cmdline.ts'
import { createImageContext, runChecks, type CheckCase, type CheckResult } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import { runChecked, ToolOutputError, type ToolResult, type ToolRuntime } from './tools.ts'
import { prepareWorkDir } from './workspace.ts'

const BOARD: Board = loadBoard(boardEnvPath('x64'))

/** The two releases: one root hash each, and nothing else differing. */
const HASH_V1 = '29809478ef06ccd26a88fb48f5faa78e8477a20dad8ca407a435eaa14419ef8a'
const HASH_V2 = 'b0f3cd21a7be44c0f0f0a6cd3f6d2f9c8a5e1d47c9b2e0763f4a1c58d2e97b30'
const SALT = BOARD.get('VERITY_SALT') ?? ''

function offsetOf(layout: string): number {
  const raw = BOARD.partition(layout)?.get('OFFSET_BYTES')
  if (raw === undefined) throw new Error(`${BOARD.path} declares no ${layout}_OFFSET_BYTES`)
  return Number(raw)
}

/** The shipped x64 grub.cfg's slot-A `linux` line, with ${MOS_*} unexpanded. */
const GRUB_CFG = 'set default=0\nset slot_a_root="${mos_disk},gpt2"\n'
  + 'menuentry "mos slot A" --id A {\n'
  + '        linux (${slot_a_root})/vmlinuz dm-mod.create="rootfs,,,ro,0 ${MOS_SECTORS} verity 1 '
  + 'PARTUUID=${MOS_ROOT_PARTUUID} PARTUUID=${MOS_ROOT_PARTUUID} ${MOS_DATA_BLOCK_SIZE} '
  + '${MOS_HASH_BLOCK_SIZE} ${MOS_DATA_BLOCKS} ${MOS_HASH_START_BLOCK} ${MOS_HASH_ALGO} '
  + '${MOS_ROOT_HASH} ${MOS_SALT}" root=/dev/dm-0 rootfstype=squashfs ro rootwait rauc.slot=A\n'
  + '        initrd (${slot_a_root})/initrd.img\n}\n'

/** The shipped x64 cmdline.cfg fragment -- the ONE file a rootfs rebuild changes. */
function cmdlineFrag(hash: string): string {
  return 'set MOS_SECTORS=464928\nset MOS_ROOT_PARTUUID=00000000-0000-0000-0000-000000000002\n'
    + 'set MOS_DATA_BLOCK_SIZE=4096\nset MOS_HASH_BLOCK_SIZE=4096\nset MOS_DATA_BLOCKS=58116\n'
    + `set MOS_HASH_START_BLOCK=58116\nset MOS_HASH_ALGO=sha256\nset MOS_ROOT_HASH=${hash}\n`
    + `set MOS_SALT=${SALT}\n`
}

/** What each image's FATs carry, keyed `<offset>::<path in the FAT>`. */
function fatOf(hash: string): Record<string, string> {
  return {
    [`${offsetOf('ESP')}::EFI/mos/grub.cfg`]: GRUB_CFG,
    [`${offsetOf('BOOT_A')}::cmdline.cfg`]: cmdlineFrag(hash),
  }
}

/**
 * A runtime that answers mcopy out of `fat`, and refuses everything else by name.
 *
 * One runtime per RUN, holding one image's files: a stub that answered from both
 * images at once could not tell the two runs apart, and it is precisely the
 * second run reading the first image's bytes that this file is about.
 */
function fakeTools(fat: Record<string, string>, log?: string[]): ToolRuntime {
  const exec = async (argv: readonly string[]): Promise<ToolResult> => {
    const line = argv.join(' ')
    log?.push(line)
    const mcopy = /mcopy -n -i \S+@@(\d+) ::\/(\S+) (\S+)$/.exec(line)
    if (mcopy === null) {
      throw new ToolOutputError(`the workspace fixture was asked to run \`${line}\``)
    }
    const body = fat[`${mcopy[1] as string}::${mcopy[2] as string}`]
    if (body === undefined) {
      return { argv, code: 1, stdout: '', stderr: `File "::/${mcopy[2] as string}" not found\n` }
    }
    writeFileSync(mcopy[3] as string, body)
    return { argv, code: 0, stdout: '', stderr: '' }
  }
  return {
    route: 'host',
    announce: 'os/verify: fixture runtime (workspace.test.ts)',
    run: (argv, options) => runChecked(exec, argv, options),
    dispose: async () => {},
  }
}

function checkNamed(id: string): CheckCase {
  const found = CMDLINE_CHECKS_ALL.find(c => c.id === id)
  if (found === undefined) throw new Error(`no cmdline check is registered as '${id}'`)
  return found
}

interface Release {
  readonly image: string
  readonly hash: string
}

/**
 * One verify run, prepared and driven exactly the way src/verify-cli.ts does:
 * the workspace first, then a context over it, then the register.
 */
async function verifyRun(
  workRoot: string,
  outDir: string,
  release: Release,
  log?: string[],
): Promise<CheckResult> {
  const workDir = prepareWorkDir(workRoot, BOARD.name)
  const ctx = createImageContext({
    board: BOARD,
    image: release.image,
    tools: fakeTools(fatOf(release.hash), log),
    workDir,
    outDir,
  })
  const run = await runChecks(ctx, [checkNamed('verity-hash-vs-built')])
  expect(run.failures.map(f => `${f.id}: ${f.error.message}`)).toEqual([])
  const first = run.results[0]
  if (first === undefined) throw new Error('the check concluded nothing')
  return first
}

interface Scratch {
  readonly dir: string
  readonly workRoot: string
  readonly outDir: string
}

/** `_out/verify` and `_out/<board>`, in a directory of their own. */
function scratch(): Scratch {
  const dir = mkdtempSync(join(tmpdir(), 'mos-workspace-'))
  const workRoot = join(dir, 'verify')
  const outDir = join(dir, 'out')
  mkdirSync(workRoot, { recursive: true })
  mkdirSync(outDir, { recursive: true })
  return { dir, workRoot, outDir }
}

/** The rebuild: a new image file, and the verity parameters the build rewrites. */
function release(s: Scratch, name: string, hash: string): Release {
  const image = join(s.dir, name)
  writeFileSync(image, '')
  writeFileSync(join(s.outDir, 'rootfs-verity.env'), `VERITY_ROOT_HASH=${hash}\n`)
  return { image, hash }
}

describe('a verify run never reads the workspace an earlier run left', () => {
  test('A REBUILT IMAGE IS NOT VERIFIED AGAINST THE PREVIOUS ONE\'S CMDLINE', async () => {
    const s = scratch()
    try {
      // Run 1: the image as built, and the check agrees with it.
      const first = await verifyRun(s.workRoot, s.outDir, release(s, 'v1.img', HASH_V1))
      expect(first.verdict).toBe('pass')

      // What run 1 left behind, and the file the false verdict came out of.
      // Asserted rather than assumed: if `fatText` had written nothing, run 2
      // would re-extract for want of anything to reuse and this test would pass
      // without having reproduced anything.
      const workDir = join(s.workRoot, BOARD.name)
      const left = readdirSync(workDir)
      expect(left.length).toBeGreaterThan(0)
      expect(left).toContain('slot-cmdline-a.cfg')

      // The rebuild: a different image, a different root hash, and
      // rootfs-verity.env rewritten by the build beside it.
      const rebuilt = release(s, 'v2.img', HASH_V2)
      const log: string[] = []
      const second = await verifyRun(s.workRoot, s.outDir, rebuilt, log)

      // Before the fix this was `fail`, and the message carried HASH_V1 -- the
      // root hash of an image this run never opened.
      expect(second.message).not.toContain(HASH_V1)
      expect(second.message).toContain(HASH_V2)
      expect(second.verdict).toBe('pass')

      // ...because the second run really did go back to the image for it,
      // rather than reading a file that was already there.
      expect(log.filter(l => l.includes('cmdline.cfg')).length).toBeGreaterThan(0)
    }
    finally {
      rmSync(s.dir, { recursive: true, force: true })
    }
  })

  test('the workspace a run starts from is EMPTY, and is only ever this board\'s', async () => {
    const s = scratch()
    try {
      // A populated workspace for this board, and one for another board beside
      // it: the emptying is scoped to `<workRoot>/<board>`, because --work is a
      // path the caller chose and may keep more than this run's extracts in.
      const mine = join(s.workRoot, BOARD.name)
      const other = join(s.workRoot, 'cx3576')
      for (const dir of [mine, other]) {
        mkdirSync(join(dir, 'root-rootfs-a-0123456789abcdef'), { recursive: true })
        writeFileSync(join(dir, 'slot-cmdline-a.cfg'), 'set MOS_ROOT_HASH=stale\n')
      }
      expect(readdirSync(mine).length).toBe(2)

      expect(prepareWorkDir(s.workRoot, BOARD.name)).toBe(mine)
      expect(readdirSync(mine)).toEqual([])
      expect(readdirSync(other).sort()).toEqual(['root-rootfs-a-0123456789abcdef', 'slot-cmdline-a.cfg'])
      expect(existsSync(join(s.workRoot, 'cx3576', 'slot-cmdline-a.cfg'))).toBe(true)
    }
    finally {
      rmSync(s.dir, { recursive: true, force: true })
    }
  })

  test('a workspace that is not there yet is created rather than refused', async () => {
    // The first run on a fresh checkout, which is the common case: `_out/verify`
    // does not exist at all and the run has to work all the same.
    const s = scratch()
    try {
      rmSync(s.workRoot, { recursive: true, force: true })
      const workDir = prepareWorkDir(s.workRoot, BOARD.name)
      expect(workDir).toBe(join(s.workRoot, BOARD.name))
      expect(readdirSync(workDir)).toEqual([])
    }
    finally {
      rmSync(s.dir, { recursive: true, force: true })
    }
  })
})
