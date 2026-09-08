// PLAN-086 S2: what the packed root must NOT carry, and what has to exist
// outside it instead.
//
// Two removals, and each of them is only defensible together with an export:
//
//   - The DEBUG INFORMATION. Thirteen binaries in this root carried 42.7 MB of
//     `.debug*`, `.symtab` and `.strtab`, and every one of them is built by
//     this repository (RFCT-346 measured it; Debian ships its own stripped).
//     They are stripped during packing and the debug halves are written to
//     `_out/<board>/debug/`. Stripping alone would be a size reduction that
//     costs the ability to resolve a core dump from a device, so the check
//     that matters is not "the root is clean" but "the root is clean AND every
//     binary it stripped has a debug file that names it".
//   - The BOOT INPUTS. The kernel a slot boots is on the boot partition and
//     the bootloader is in the loader region; a second copy inside the verity
//     root is 54 MB on cx3576 and 53 MB on a UEFI board that nothing reads.
//     They are exported to `_out/<board>/boot/`, which is what the image
//     assembler and the bundle builder both read.
//
// THE MATCH IS THE BUILD ID, and this file is the independent reader of it.
// `rootfs/scripts/pack-export-debug.sh` establishes the match at build time
// with `readelf`; these checks re-establish it from the IMAGE, with their own
// ELF parser (`elf.ts`), against the manifest the build wrote. Two things could
// have gone wrong between those two moments and only this side can see either:
// the squashfs could carry a different binary than the one that was stripped,
// and the export could have been overwritten by another board's build.
//
// EVERY NEGATIVE HERE REPORTS THE SIZE OF THE SPACE IT SEARCHED. "No debug
// sections in the packed root" and "no boot blobs in the packed root" are both
// satisfied by a root with nothing in it, and `packedRoot` refusing an empty
// unpack is not enough on its own -- a root with no ELF files at all, or one
// whose `/boot` never existed, would pass both while asserting nothing.

import { createHash } from 'node:crypto'
import { closeSync, existsSync, lstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { packedRoot } from './checks-root.ts'
import type { CheckCase, ImageContext } from './checks.ts'
import { buildId, ET_REL, isElf, isRemovableDebugSection, readElf } from './elf.ts'
import type { CheckResult } from './parity.ts'
import { verdict } from './verdict.ts'

/** Where the pack stage's two exports land, relative to `_out/<board>/`. */
const DEBUG_DIR = 'debug'
const BOOT_DIR = 'boot'
const DEBUG_MANIFEST = 'manifest.tsv'

/**
 * The marker `pack-export-boot.sh` writes when the root held no `/boot/vmlinuz`.
 *
 * A board whose kernel arrives through its board package leaves the kernel
 * half of the export with nothing to do, and an empty directory is not
 * exportable through a `COPY`. It is excluded from the "the export is not
 * empty" count for the obvious reason: it is the record of an absence.
 */
const NO_KERNEL_MARKER = '.no-kernel-in-root'

/**
 * Kernel modules, excluded from the debug scan by the same two rules the build
 * script uses -- path and ELF type.
 *
 * A module's `.symtab` is what the loader resolves its relocations against, so
 * it is not a stripping target; PLAN-086's risk table says to treat them
 * separately.
 */
//
// BOTH SPELLINGS. On a merged-/usr root `/lib` is a symlink and the walk below
// never descends into it, so `/usr/lib/modules/` is the only path that can
// occur -- but a root where `/lib` is a real directory would put the modules
// there, and the cost of the second entry is one string against a check that
// would otherwise strip-test every kernel module in such a tree.
const MODULE_DIRS = ['/usr/lib/modules/', '/lib/modules/']

/** Every regular file in the root, image-absolute, that starts with the ELF magic. */
function elfFiles(root: string): string[] {
  const out: string[] = []
  const visit = (dir: string): void => {
    let names: string[]
    try {
      names = readdirSync(join(root, dir))
    }
    catch {
      return
    }
    for (const name of names.sort()) {
      const path = dir === '' ? `/${name}` : `${dir}/${name}`
      let st
      try {
        st = lstatSync(join(root, path))
      }
      catch {
        continue
      }
      if (st.isDirectory()) visit(path)
      // lstat, so a symlink is never followed: what is AT the path is the
      // question, and following one would report a binary twice and could walk
      // out of the root entirely.
      else if (st.isFile() && isElf(join(root, path))) out.push(path)
    }
  }
  visit('')
  return out
}

interface ElfSurvey {
  /** Not under a modules directory, not relocatable, and readable. */
  readonly userSpace: readonly string[]
  /** Excluded because they are kernel modules, by path or by `e_type`. */
  readonly modules: readonly string[]
  /**
   * Begins with the ELF magic and does not parse as one.
   *
   * NOT a failure, and reported rather than dropped. Four bytes of magic is a
   * cheap test and other things start with them; the build side takes the same
   * view, since `readelf -h` failing there leaves the file unstripped and
   * unmentioned. What keeps that from hiding a real binary is the search-space
   * guard below: every path the build recorded stripping has to turn up in
   * `userSpace`, and one that stopped parsing would not.
   */
  readonly unreadable: readonly string[]
}

/** Split the ELF files of a root into the three categories the strip cares about. */
function surveyElf(root: string, paths: readonly string[]): ElfSurvey {
  const userSpace: string[] = []
  const modules: string[] = []
  const unreadable: string[] = []
  for (const p of paths) {
    if (MODULE_DIRS.some(d => p.startsWith(d))) {
      modules.push(p)
      continue
    }
    try {
      if (readElf(join(root, p)).type === ET_REL) modules.push(p)
      else userSpace.push(p)
    }
    catch {
      unreadable.push(p)
    }
  }
  return { userSpace, modules, unreadable }
}

function sha256(file: string): string {
  const hash = createHash('sha256')
  const fd = openSync(file, 'r')
  try {
    const chunk = new Uint8Array(4 * 1024 * 1024)
    let position = 0
    for (;;) {
      const got = readSync(fd, chunk, 0, chunk.length, position)
      if (got === 0) break
      hash.update(chunk.subarray(0, got))
      position += got
    }
  }
  finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

export interface DebugRow {
  readonly path: string
  readonly buildId: string
  readonly debug: string
  readonly bytesBefore: number
  readonly bytesAfter: number
  readonly sha256: string
}

/**
 * `_out/<board>/debug/manifest.tsv`, as the pack stage writes it.
 *
 * A malformed row THROWS rather than being skipped: a manifest this reader
 * silently drops rows from is a manifest that can shrink to nothing while the
 * check over it goes on passing.
 */
export function parseDebugManifest(text: string, source: string): DebugRow[] {
  const rows: DebugRow[] = []
  for (const [i, line] of text.split('\n').entries()) {
    if (line.trim() === '' || line.startsWith('#')) continue
    const f = line.split('\t')
    if (f.length !== 6) {
      throw new Error(
        `${source}:${i + 1} has ${f.length} tab-separated field(s), not the 6 this manifest is `
        + `written with (path, build-id, debug, bytes-before, bytes-after, sha256): ${line}`,
      )
    }
    const [path, id, debug, before, after, digest] = f as [string, string, string, string, string, string]
    if (!/^[0-9a-f]{8,}$/.test(id)) {
      throw new Error(`${source}:${i + 1} declares the build-id '${id}', which is not lowercase hex`)
    }
    if (!/^[0-9a-f]{64}$/.test(digest)) {
      throw new Error(`${source}:${i + 1} declares the sha256 '${digest}', which is not 64 hex characters`)
    }
    rows.push({
      path,
      buildId: id,
      debug,
      bytesBefore: Number(before),
      bytesAfter: Number(after),
      sha256: digest,
    })
  }
  return rows
}

function manifestPath(ctx: ImageContext): string {
  return join(ctx.outDir, DEBUG_DIR, DEBUG_MANIFEST)
}

export const DEBUG_CHECKS: readonly CheckCase[] = [
  {
    // The negative: nothing in the shipped root still carries what a strip
    // takes. PLAN-086's acceptance clause, over the image rather than over the
    // build that produced it.
    id: 'packed-no-user-debug-sections',
    shell: {
      pass: 'no user-space binary in the packed root carries debug or static symbol sections',
      fail: [
        'still carry debug or static symbol sections',
        'were not among them',
        'this walk has no search space',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'packed-no-user-debug-sections'
      const root = await packedRoot(ctx)
      const all = elfFiles(root)
      const { userSpace, modules, unreadable } = surveyElf(root, all)

      // THE SPACE SEARCHED, and it is pinned to the manifest rather than to a
      // number. A walk that reads the wrong tree, or that stopped recognising
      // an ELF, finds nothing carrying debug sections and reports the same
      // green as a correctly stripped root -- so what this requires is that the
      // walk can see the very files that DID carry them when the build looked.
      // A count threshold would have been the other option and it is worse: any
      // figure large enough to mean something is a figure about Debian's
      // package set, which is not what this check is about and would go red on
      // a smaller runtime, which is what PLAN-086 is FOR.
      const manifest = manifestPath(ctx)
      if (!existsSync(manifest)) {
        return [verdict(id, false,
          `this walk has no search space: ${manifest} is not there. That manifest is the record of `
          + `which binaries carried debug sections, and without it nothing says this walk read the `
          + `tree they are in`)]
      }
      const named = parseDebugManifest(readFileSync(manifest, 'utf8'), manifest).map(r => r.path)
      if (named.length === 0) {
        return [verdict(id, false,
          `this walk has no search space: ${manifest} names no binary, so "no user-space binary `
          + `carries debug sections" would be asserted over a set nothing vouches for`)]
      }
      const found = new Set(userSpace)
      const unseen = named.filter(p => !found.has(p))
      if (unseen.length > 0) {
        return [verdict(id, false,
          `this walk found ${userSpace.length} user-space ELF file(s) in the packed root and `
          + `${unseen.length} of the ${named.length} the build stripped were not among them: `
          + `${unseen.join(' ')}. Either the walk is not reading the shipped tree or those binaries `
          + `are no longer in it, and in both cases the negative below is about something else`)]
      }
      const carrying = userSpace.filter(p =>
        readElf(join(root, p)).sections.some(s => isRemovableDebugSection(s.name)))
      if (carrying.length > 0) {
        return [verdict(id, false,
          `${carrying.length} user-space binary/binaries in the packed root still carry debug or `
          + `static symbol sections: ${carrying.slice(0, 10).join(' ')}`
          + `${carrying.length > 10 ? ` (and ${carrying.length - 10} more)` : ''}`)]
      }
      return [verdict(id, true,
        `no user-space binary in the packed root carries debug or static symbol sections `
        + `(${userSpace.length} scanned, including all ${named.length} the build recorded `
        + `stripping; ${modules.length} kernel module(s) and relocatable object(s) deliberately `
        + `left alone, ${unreadable.length} file(s) carry the magic and no readable ELF header)`)]
    },
  },
  {
    // The half that makes the strip defensible: every binary whose debug
    // information was taken out has a debug file that names it, and the binary
    // in the IMAGE is the one that was stripped.
    id: 'debug-export-matches-shipped',
    shell: {
      pass: 'every stripped binary has a matching exported debug file',
      fail: [
        'the debug export manifest is missing:',
        'the debug export is empty',
        'the debug export does not match the shipped binaries',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'debug-export-matches-shipped'
      const manifest = manifestPath(ctx)
      if (!existsSync(manifest)) {
        return [verdict(id, false,
          `the debug export manifest is missing: ${manifest} (produce it with rootfs/build.sh)`)]
      }
      const rows = parseDebugManifest(readFileSync(manifest, 'utf8'), manifest)
      if (rows.length === 0) {
        return [verdict(id, false,
          `the debug export is empty: ${manifest} names no binary. The strip and the export are one `
          + `operation, so an empty manifest beside a stripped root is debug information that was `
          + `destroyed rather than separated`)]
      }
      const root = await packedRoot(ctx)
      const faults: string[] = []
      for (const row of rows) {
        const shipped = join(root, row.path)
        if (!existsSync(shipped)) {
          faults.push(`${row.path} is named in the manifest and is not in the packed root`)
          continue
        }
        const got = buildId(shipped)
        if (got !== row.buildId) {
          faults.push(
            `${row.path} in the image reports build-id ${got ?? '(none)'} and the manifest records `
            + `${row.buildId}, so the exported debug file describes a different build of it`,
          )
          continue
        }
        const digest = sha256(shipped)
        if (digest !== row.sha256) {
          faults.push(
            `${row.path} in the image hashes to ${digest.slice(0, 16)}… and the manifest records `
            + `${row.sha256.slice(0, 16)}…, so what shipped is not what was stripped`,
          )
          continue
        }
        const debugFile = join(ctx.outDir, DEBUG_DIR, row.debug)
        if (!existsSync(debugFile)) {
          faults.push(`${row.path} has no exported debug file at ${debugFile}`)
          continue
        }
        const debugId = buildId(debugFile)
        if (debugId !== row.buildId) {
          faults.push(
            `${row.debug} reports build-id ${debugId ?? '(none)'} and is the debug file for `
            + `${row.path}, whose build-id is ${row.buildId}. The note is the only thing tying the `
            + `two together`,
          )
        }
      }
      if (faults.length > 0) {
        return [verdict(id, false,
          `the debug export does not match the shipped binaries: ${faults.join('; ')}`)]
      }
      const saved = rows.reduce((n, r) => n + r.bytesBefore - r.bytesAfter, 0)
      return [verdict(id, true,
        `every stripped binary has a matching exported debug file: ${rows.length} of them, matched `
        + `by GNU build-id and by the sha256 of the binary the image ships, ${saved} byte(s) of `
        + `debug and symbol data moved out of the root`)]
    },
  },
  {
    // The boot half. A negative over the root, and the positive that keeps it
    // from being satisfied by a build that lost the blobs instead of moving
    // them.
    id: 'packed-no-boot-blobs',
    shell: {
      pass: 'the packed root carries no boot blobs',
      fail: [
        'the packed root carries boot blobs',
        'the boot export holds no blob',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const id = 'packed-no-boot-blobs'
      const exportDir = join(ctx.outDir, BOOT_DIR)
      const exported = existsSync(exportDir)
        ? readdirSync(exportDir).filter(n => n !== NO_KERNEL_MARKER).sort()
        : []
      if (exported.length === 0) {
        return [verdict(id, false,
          `the boot export holds no blob: ${exportDir}. Every boot input this root used to carry is `
          + `supposed to be in there -- the kernel a slot boots, and on a U-Boot board the device `
          + `tree, the bootloader and boot.cmd -- so an empty export beside a root with none of them `
          + `is a build that deleted them rather than moved them`)]
      }
      const root = await packedRoot(ctx)
      // The space searched. /boot has to EXIST and has to hold the kernel
      // config, which is deliberately kept: it is the record of how the kernel
      // was built and the subject of the kernel-config family. A root with no
      // /boot at all satisfies "no vmlinuz in /boot" trivially.
      const bootDir = join(root, 'boot')
      const boot = existsSync(bootDir) ? readdirSync(bootDir).sort() : undefined
      if (boot === undefined || !boot.some(n => n.startsWith('config-'))) {
        return [verdict(id, false,
          `the packed root has no /boot/config-*, so the directory the kernel blobs would be in `
          + `either does not exist or is not the one this image ships (/boot holds `
          + `${boot === undefined ? 'nothing: the directory is absent' : boot.join(' ') || '(nothing)'}). `
          + `The config is kept on purpose and is what says this check read the right tree`)]
      }
      const blobs = boot.filter(n =>
        n.startsWith('vmlinuz') || n.startsWith('initrd') || n === 'Image' || n === 'bzImage')
        .map(n => `/boot/${n}`)
      const boardDir = join(root, 'usr', 'lib', 'mos', 'board')
      if (existsSync(boardDir)) {
        const visit = (dir: string): void => {
          for (const name of readdirSync(join(root, dir)).sort()) {
            const path = `${dir}/${name}`
            if (lstatSync(join(root, path)).isDirectory()) visit(path)
            else blobs.push(path)
          }
        }
        visit('/usr/lib/mos/board')
      }
      if (blobs.length > 0) {
        return [verdict(id, false,
          `the packed root carries boot blobs: ${blobs.join(' ')}. Every one of them also exists `
          + `where the device reads it -- the boot partition, or the loader region -- so the copy `
          + `inside the verity root is bytes nothing can use`)]
      }
      return [verdict(id, true,
        `the packed root carries no boot blobs (/boot holds ${boot.join(' ')} and there is no `
        + `/usr/lib/mos/board), and the ${exported.length} exported input(s) ${exported.join(' ')} `
        + `are in ${exportDir} where the image assembler and the bundle builder read them`)]
    },
  },
]
