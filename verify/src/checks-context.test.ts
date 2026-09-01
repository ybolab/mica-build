// The image context's caches, driven from the side where they LIE.
//
// `createImageContext` memoises two expensive things -- a partition's extracted
// bytes and the unpacked read-only root -- and both must be keyed on the image
// as well as on the slot. Every packed-root check goes through `unpackRoot`, so
// a cache that hands back the previous image's tree makes all of them agree
// with the oracle about an image neither of them read.
//
// Nothing here runs a container. `sgdisk` and `unsquashfs` are answered by a
// runtime built below, which is what lets the two images differ in exactly one
// thing -- their payload bytes -- and lets the assertion be about that.

import { describe, expect, test } from 'bun:test'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBoard } from './board.ts'
import { createImageContext } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import type { ToolResult, ToolRuntime } from './tools.ts'
import { ToolOutputError } from './tools.ts'

const SECTOR = 512
const ROOT_FIRST_SECTOR = 2048
const ROOT_SECTORS = 2048 // 1 MiB
const IMAGE_SECTORS = 8192 // 4 MiB

/**
 * A file of `IMAGE_SECTORS` sectors whose rootfs-a range is filled with `marker`.
 *
 * The marker is the ONLY thing that differs between the two images these tests
 * build, so a tree unpacked from one and reported as the other's is visible as
 * a single character.
 */
function writeImage(path: string, marker: string): string {
  const fd = openSync(path, 'w')
  try {
    const zeros = new Uint8Array(IMAGE_SECTORS * SECTOR)
    writeSync(fd, zeros, 0, zeros.length, 0)
    const payload = new TextEncoder().encode(marker.repeat(ROOT_SECTORS * SECTOR / marker.length))
    writeSync(fd, payload, 0, ROOT_SECTORS * SECTOR, ROOT_FIRST_SECTOR * SECTOR)
  }
  finally {
    closeSync(fd)
  }
  return path
}

const SGDISK_TABLE = [
  'Disk /x: 8192 sectors, 4.0 MiB',
  'Sector size (logical): 512 bytes',
  'Disk identifier (GUID): 00000000-0000-0000-0000-000000000001',
  'Number  Start (sector)    End (sector)  Size       Code  Name',
  `     1            ${ROOT_FIRST_SECTOR}            ${ROOT_FIRST_SECTOR + ROOT_SECTORS - 1}   1024.0 KiB  8300  rootfs-a`,
].join('\n')

const SGDISK_INFO = [
  'Partition GUID code: 0FC63DAF-8483-4772-8E79-3D69D8477DE4',
  'Partition unique GUID: 00000000-0000-0000-0000-0000000000A1',
  `First sector: ${ROOT_FIRST_SECTOR}`,
  `Last sector: ${ROOT_FIRST_SECTOR + ROOT_SECTORS - 1}`,
  `Partition size: ${ROOT_SECTORS} sectors`,
  "Partition name: 'rootfs-a'",
  'Attribute flags: 0000000000000000',
].join('\n')

/**
 * Answers `sgdisk` from the table above and `unsquashfs` by writing the
 * payload's FIRST BYTE into `<dest>/marker`.
 *
 * That is the whole trick: a real unsquashfs turns a payload into a tree, and
 * so does this -- a tree whose one file says which payload it came from. Every
 * other command is refused by name, so a helper that reached for something the
 * fixture did not set up would be answered by a failure rather than by a
 * default.
 */
function fakeTools(log?: string[]): ToolRuntime {
  return {
    route: 'host',
    announce: 'verify: fixture runtime (checks-context.test.ts)',
    run: async (argv): Promise<ToolResult> => {
      log?.push(argv.join(' '))
      if (argv[0] === 'sgdisk' && argv[1] === '-p') {
        return { argv, code: 0, stdout: SGDISK_TABLE, stderr: '' }
      }
      if (argv[0] === 'sgdisk' && argv[1] === '-i') {
        return { argv, code: 0, stdout: SGDISK_INFO, stderr: '' }
      }
      if (argv[0] === 'unsquashfs') {
        const dest = argv[argv.indexOf('-d') + 1] as string
        const file = argv[argv.length - 1] as string
        mkdirSync(dest, { recursive: true })
        writeFileSync(join(dest, 'marker'), String.fromCharCode(readFileSync(file)[0] as number))
        return { argv, code: 0, stdout: '', stderr: '' }
      }
      throw new ToolOutputError(`the fixture runtime was asked to run \`${argv.join(' ')}\``)
    },
    dispose: async () => {},
  }
}

const BOARD = loadBoard(boardEnvPath('cx3576'))

interface Scratch {
  readonly dir: string
  readonly workDir: string
  readonly imageA: string
  readonly imageB: string
}

function scratch(): Scratch {
  const dir = mkdtempSync(join(tmpdir(), 'mos-ctx-'))
  const workDir = join(dir, 'work')
  mkdirSync(workDir, { recursive: true })
  return {
    dir,
    workDir,
    imageA: writeImage(join(dir, 'a.img'), 'A'),
    imageB: writeImage(join(dir, 'b.img'), 'B'),
  }
}

/** What `unpackRoot` says the packed root contains, for the marker file. */
function markerOf(root: string): string {
  return readFileSync(join(root, 'marker'), 'utf8')
}

describe('unpackRoot does not hand back a previous image\'s root', () => {
  test('TWO RUNS AT ONE --work AGAINST TWO DIFFERENT IMAGES DO NOT SILENTLY AGREE', async () => {
    // THE REGRESSION, in the shape a parity run makes it: `--work _out/parity`
    // twice, two images. The second run re-extracts the partition -- extractRange
    // always reopens its destination with 'w' -- and used to reuse the FIRST
    // image's unpacked tree, because the cache was named `root-rootfs-a` on both.
    // Both runs then reported on a tree only one of them had read.
    const s = scratch()
    try {
      const rootA = await createImageContext({
        board: BOARD, image: s.imageA, tools: fakeTools(), workDir: s.workDir,
      }).unpackRoot()
      expect(markerOf(rootA)).toBe('A')

      const rootB = await createImageContext({
        board: BOARD, image: s.imageB, tools: fakeTools(), workDir: s.workDir,
      }).unpackRoot()

      // The assertion that was false before the fix, and the one every
      // packed-root check in batch 2 rests on.
      expect(markerOf(rootB)).toBe('B')
      expect(rootB).not.toBe(rootA)
    }
    finally {
      rmSync(s.dir, { recursive: true, force: true })
    }
  })

  test('the same image at the same --work IS reused -- the point of keying, not dropping', async () => {
    // The other direction. Dropping the short-circuit would also stop the wrong
    // answer, by making the second run THROW (squashfsExtract refuses a dest
    // that exists, by name). This asserts the reuse the keyed cache keeps: the
    // second context runs no unsquashfs at all, and gets the same directory.
    const s = scratch()
    try {
      const first = await createImageContext({
        board: BOARD, image: s.imageA, tools: fakeTools(), workDir: s.workDir,
      }).unpackRoot()

      const log: string[] = []
      const second = await createImageContext({
        board: BOARD, image: s.imageA, tools: fakeTools(log), workDir: s.workDir,
      }).unpackRoot()

      expect(second).toBe(first)
      expect(markerOf(second)).toBe('A')
      expect(log.filter(l => l.startsWith('unsquashfs'))).toEqual([])
    }
    finally {
      rmSync(s.dir, { recursive: true, force: true })
    }
  })

  test('a run KILLED mid-unpack leaves nothing a later run mistakes for a finished tree', async () => {
    // The hole one layer down, and the reason the unpack is published by rename.
    // A partial tree at the cache's name is indistinguishable from a complete
    // one -- existsSync says yes to both -- and "is X absent from the image?"
    // then passes for every path unsquashfs had not reached. Two L3s in this
    // campaign have been SIGKILLed mid-run, so this is not hypothetical.
    const s = scratch()
    try {
      const dying: ToolRuntime = {
        ...fakeTools(),
        run: async (argv): Promise<ToolResult> => {
          if (argv[0] === 'unsquashfs') {
            const dest = argv[argv.indexOf('-d') + 1] as string
            mkdirSync(dest, { recursive: true }) // half a tree...
            throw new ToolOutputError('killed mid-unpack')
          }
          return fakeTools().run(argv)
        },
        dispose: async () => {},
      }
      await expect(createImageContext({
        board: BOARD, image: s.imageA, tools: dying, workDir: s.workDir,
      }).unpackRoot()).rejects.toThrow(/killed mid-unpack/)

      // Nothing under the work directory is named like a finished root.
      expect(readdirSync(s.workDir).filter(e => e.startsWith('root-'))).toEqual([])

      // ...and the next run unpacks for real rather than adopting the wreckage.
      const root = await createImageContext({
        board: BOARD, image: s.imageA, tools: fakeTools(), workDir: s.workDir,
      }).unpackRoot()
      expect(markerOf(root)).toBe('A')
    }
    finally {
      rmSync(s.dir, { recursive: true, force: true })
    }
  })

  test('one context unpacks ONCE, however many checks ask', async () => {
    // The in-run memo, which is what makes ctx.unpackRoot() cheap enough for a
    // whole batch of checks to call it. Unchanged by the fix; asserted so that
    // keying the cache on content cannot quietly turn one unpack into forty.
    const s = scratch()
    try {
      const log: string[] = []
      const ctx = createImageContext({
        board: BOARD, image: s.imageA, tools: fakeTools(log), workDir: s.workDir,
      })
      const roots = await Promise.all([ctx.unpackRoot(), ctx.unpackRoot(), ctx.unpackRoot()])
      expect(new Set(roots).size).toBe(1)
      expect(log.filter(l => l.startsWith('unsquashfs')).length).toBe(1)
    }
    finally {
      rmSync(s.dir, { recursive: true, force: true })
    }
  })

  test('the cache name carries the payload digest, so two images cannot share one', async () => {
    // Named explicitly because it is the mechanism the first test rests on: the
    // directory is named after what is IN it. A future change that reverted to
    // `root-<slot>` would pass no test above except the first, and this one says
    // why the first passes.
    const s = scratch()
    try {
      const a = await createImageContext({
        board: BOARD, image: s.imageA, tools: fakeTools(), workDir: s.workDir,
      }).unpackRoot()
      const b = await createImageContext({
        board: BOARD, image: s.imageB, tools: fakeTools(), workDir: s.workDir,
      }).unpackRoot()
      expect(a).toMatch(/\/root-rootfs-a-[0-9a-f]{16}$/)
      expect(b).toMatch(/\/root-rootfs-a-[0-9a-f]{16}$/)
      expect(a).not.toBe(b)
      expect(existsSync(a)).toBe(true)
      expect(existsSync(b)).toBe(true)
    }
    finally {
      rmSync(s.dir, { recursive: true, force: true })
    }
  })
})
