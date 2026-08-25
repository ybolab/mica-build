// Reading a mos disk image without touching the host.
//
// PLAN-014 M4 (RFCT-110), the M4a half: the typed helpers M4b..M4d port checks
// on top of. The toolset is os/verify-image-v2.sh's, unchanged and deliberately
// so -- sgdisk for the GPT, mtools at an offset for the FAT boot slots, a byte
// range extracted out of the image and read with debugfs/tune2fs for the ext4
// partitions, unsquashfs for the packed root, and `veritysetup verify`, which
// walks the hash tree in USERSPACE and never creates a device-mapper target,
// never calls losetup and never mounts anything. No loop mounts, no host
// mutation, nothing that needs root.
//
// ═══ WHAT THIS FILE IS REALLY ABOUT: TOOLS THAT SUCCEED AT NOTHING ═══
//
// Every helper below was driven against a malformed input before it was
// written, on 2026-08-25 in the pinned alpine:3.21 with the package set the
// shell verifier installs. Four of the five tools answer a question they could
// not answer with something that reads exactly like an answer:
//
//   sgdisk -p FILE, on 64 MiB of zeros with no partition table at all:
//       prints "Creating new GPT entries in memory.", INVENTS a random disk
//       GUID, lists zero partitions, and EXITS 0. `sgdisk --verify` on the same
//       file prints "No problems found." -- a green about a file that has no
//       GPT. (os/verify-image-v2.sh:1397 greps that sentence out too, which is
//       where the discriminator below comes from; it is the tool's own
//       statement that it found none.)
//
//   debugfs -R "ls -p /" FILE, on a file that is not ext4:
//       EXITS 0, prints NOTHING on stdout, and puts "Filesystem not open" on
//       stderr. A caller reading the exit status gets an empty directory
//       listing for a filesystem it never opened.
//
//   unsquashfs -d DEST ARCHIVE some/path/not/in/it:
//       EXITS 0 and creates an empty DEST. A caller that then reads DEST/some
//       /path finds nothing, and the reason it finds nothing is indistinguish-
//       able from the file being empty in the image.
//
//   veritysetup verify ... :
//       exits 1 BOTH for "Verification of root hash failed." -- which is a real
//       answer, the failing direction of the check -- and for "Device X is not
//       a valid VERITY device." -- which is not an answer at all. A helper that
//       mapped status 1 to `false` would report a corrupt payload for a
//       mis-computed offset.
//
// So no helper here decides anything by exit status alone. Each one knows what
// its tool's output looks like when the tool actually did the work, and refuses
// -- loudly, naming the tool and what it saw -- when it did not. The check
// above decides what a failure MEANS; the helper never decides it by silence.
// This is the same rule tools.ts states for ToolError, one layer up.
//
// The shell verifier ends nearly every capture in `|| true` and lets the
// resulting empty string fail the check. That works there because the check
// still goes red -- but it goes red describing a VALUE when the truth is that
// the tool never ran, and this campaign has spent whole tasks on the difference
// between those two sentences.

import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readSync, statSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ToolOutputError, type RunOptions, type ToolRuntime } from './tools.ts'

/** mtools refuses a file whose size is not a whole number of sectors unless told. */
const MTOOLS_ENV = ['env', 'MTOOLS_SKIP_CHECK=1'] as const

// ---------------------------------------------------------------------------
// byte ranges
// ---------------------------------------------------------------------------

/**
 * Copy `length` bytes at `offset` out of `image` into `dest`.
 *
 * WHY THIS IS NOT `dd`, when the scope says dd-extract. It is the same bytes:
 * measured on 2026-08-25 against ROOTFS-A of the real cx3576 image, this
 * function and `dd bs=1M skip=146 count=256 conv=sparse` produced files with
 * the same sha256. What it is not is a container round trip and a second copy
 * of the offset arithmetic -- dd's skip/count are in BLOCKS, so every call site
 * divides by a block size, and a partition whose start is not a whole number of
 * MiB silently extracts from the wrong place. Here the unit is bytes because
 * the GPT's unit is sectors and the layout's is MiB, and one conversion in one
 * place is the whole point. Nothing is mutated: `image` is opened read-only.
 */
export function extractRange(image: string, offset: number, length: number, dest: string): string {
  requireWholeNumbers({ offset, length })
  const size = statSync(image).size
  if (offset + length > size) {
    throw new ToolOutputError(
      `extractRange wants bytes ${offset}..${offset + length} of ${image}, which is ${size} bytes long. `
      + `A short read here would hand the next tool a TRUNCATED partition, and every tool below `
      + `answers a truncated partition with a content complaint rather than a size one.`,
    )
  }
  mkdirSync(dirname(dest), { recursive: true })
  const src = openSync(image, 'r')
  const out = openSync(dest, 'w')
  try {
    const chunk = new Uint8Array(4 * 1024 * 1024)
    let done = 0
    while (done < length) {
      const want = Math.min(chunk.length, length - done)
      const got = readSync(src, chunk, 0, want, offset + done)
      if (got === 0) {
        throw new ToolOutputError(
          `${image} ended after ${done} of ${length} bytes from offset ${offset}, though it reports `
          + `${size} bytes. The extract would be short and the tool reading it would blame its content.`,
        )
      }
      writeSync(out, chunk, 0, got)
      done += got
    }
  }
  finally {
    closeSync(src)
    closeSync(out)
  }
  return dest
}

/** Read `length` bytes at `offset`. For magic numbers and superblock fields. */
export function readBytes(image: string, offset: number, length: number): Uint8Array {
  requireWholeNumbers({ offset, length })
  const buf = new Uint8Array(length)
  const fd = openSync(image, 'r')
  try {
    const got = readSync(fd, buf, 0, length, offset)
    if (got !== length) {
      throw new ToolOutputError(
        `wanted ${length} bytes at offset ${offset} of ${image} and got ${got}. A short read here `
        + `becomes a magic number that does not match, which reads as a wrong image rather than a `
        + `wrong offset.`,
      )
    }
  }
  finally {
    closeSync(fd)
  }
  return buf
}

function requireWholeNumbers(values: Record<string, number>): void {
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ToolOutputError(
        `${name} is ${value}; it must be a non-negative whole number of bytes. NaN is what an `
        + `unparsed layout value becomes, and NaN offsets read from position 0 without complaining.`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// 1. the GPT, with sgdisk
// ---------------------------------------------------------------------------

export interface GptPartition {
  readonly number: number
  readonly firstSector: number
  readonly lastSector: number
  readonly sizeSectors: number
  /** Uppercase, as sgdisk prints it. Compare case-folded; udev prints lowercase. */
  readonly typeGuid: string
  readonly uniqueGuid: string
  readonly name: string
  /** Sixteen hex digits, as `Attribute flags:` prints them. */
  readonly attributeFlags: string
}

export interface GptTable {
  readonly image: string
  readonly sectorSize: number
  readonly diskGuid: string
  readonly totalSectors: number
  readonly partitions: readonly GptPartition[]
  partition: (n: number) => GptPartition | undefined
}

/**
 * sgdisk's admission that the file it was handed has no partition table.
 *
 * It prints this and then behaves as though it had been asked to CREATE one --
 * exit 0, an invented disk GUID, an empty table. Everything downstream of that
 * is fiction, and the fiction is well formed.
 */
const SGDISK_INVENTED = 'Creating new GPT entries'

async function sgdisk(rt: ToolRuntime, args: readonly string[], context: string): Promise<string> {
  const r = await rt.run(['sgdisk', ...args], { context })
  const both = `${r.stdout}\n${r.stderr}`
  if (both.includes(SGDISK_INVENTED)) {
    throw new ToolOutputError(
      `${context}: sgdisk said "${SGDISK_INVENTED} in memory." and then exited ${r.code}.\n`
      + `  That is sgdisk reporting there is NO partition table on this file and offering to invent\n`
      + `  one. Driven on 64 MiB of zeros it goes on to print a random disk GUID, an empty partition\n`
      + `  list and "No problems found." -- a complete, green, entirely fictional table. Nothing\n`
      + `  below may be read as an observation of the image.`,
    )
  }
  return r.stdout
}

/** Parse `sgdisk -p` and `sgdisk -i N` into the fields every GPT check reads. */
export async function readGpt(rt: ToolRuntime, image: string): Promise<GptTable> {
  const table = await sgdisk(rt, ['-p', image], `reading the GPT of ${image}`)

  const sectorSize = intAfter(table, /^Sector size \(logical\): (\d+) bytes$/m, 'Sector size (logical)', image)
  const totalSectors = intAfter(table, /^Disk .*: (\d+) sectors,/m, 'the disk sector count', image)
  const diskGuid = strAfter(table, /^Disk identifier \(GUID\): (\S+)$/m, 'Disk identifier (GUID)', image)

  // The numbered rows of `sgdisk -p`'s table, which is the ONLY statement of
  // how many partitions there are. os/verify-image-v2.sh:1418 counts the same
  // rows with the same shape.
  const numbers = [...table.matchAll(/^\s+(\d+)\s+\d+\s+\d+\s/gm)].map(m => Number(m[1]))
  if (numbers.length === 0) {
    throw new ToolOutputError(
      `sgdisk -p ${image} listed no partitions. It did not say "${SGDISK_INVENTED}", so this is a `
      + `real but EMPTY partition table -- which no mos image has ever been. Read as data it would `
      + `make every per-partition check below vacuous rather than failed.`,
    )
  }

  const partitions: GptPartition[] = []
  for (const n of numbers) {
    const info = await sgdisk(rt, ['-i', String(n), image], `reading partition ${n} of ${image}`)
    // "Partition #7 does not exist." is what sgdisk says for a number the table
    // does not carry -- at exit 0, with no other output. It cannot happen for a
    // number that came out of the table above, which is exactly why it is
    // checked: if it ever does, the two readings disagree with each other.
    if (/does not exist/.test(info)) {
      throw new ToolOutputError(
        `sgdisk -p ${image} listed partition ${n} and sgdisk -i ${n} says it does not exist. `
        + `The two readings of one table disagree; neither can be used.`,
      )
    }
    const firstSector = intAfter(info, /^First sector: (\d+)/m, `partition ${n} First sector`, image)
    const lastSector = intAfter(info, /^Last sector: (\d+)/m, `partition ${n} Last sector`, image)
    partitions.push({
      number: n,
      firstSector,
      lastSector,
      sizeSectors: intAfter(info, /^Partition size: (\d+) sectors/m, `partition ${n} Partition size`, image),
      typeGuid: strAfter(info, /^Partition GUID code: (\S+)/m, `partition ${n} GUID code`, image),
      uniqueGuid: strAfter(info, /^Partition unique GUID: (\S+)/m, `partition ${n} unique GUID`, image),
      // A partition name may be empty, so this one tolerates an empty capture --
      // and only this one. `Partition name: ''` is a fact about the image.
      name: (/^Partition name: '(.*)'$/m.exec(info)?.[1]) ?? refuse(`partition ${n} Partition name`, image, info),
      attributeFlags: strAfter(info, /^Attribute flags: (\S+)/m, `partition ${n} Attribute flags`, image),
    })
  }

  return {
    image,
    sectorSize,
    diskGuid,
    totalSectors,
    partitions,
    partition: (n: number) => partitions.find(p => p.number === n),
  }
}

export interface SgdiskVerdict {
  readonly clean: boolean
  readonly output: string
  /** The Caution/Warning lines that are not the two benign alignment notes. */
  readonly complaints: readonly string[]
}

/**
 * `sgdisk --verify`, with the same reading os/verify-image-v2.sh:1394 gives it.
 *
 * "No problems found." alone is not the verdict: sgdisk says that about a file
 * with no GPT at all. The invented-table sentence is refused by `sgdisk()`
 * above, so reaching here means there WAS a table to verify.
 */
export async function sgdiskVerify(rt: ToolRuntime, image: string): Promise<SgdiskVerdict> {
  const r = await rt.run(['sgdisk', '--verify', image], {
    context: `sgdisk --verify ${image}`,
    allow: [1, 2, 3, 4, 5, 6, 7, 8],
  })
  const output = `${r.stdout}${r.stderr}`
  if (output.includes(SGDISK_INVENTED)) {
    throw new ToolOutputError(
      `sgdisk --verify ${image} said "${SGDISK_INVENTED} in memory." and then "No problems found." `
      + `There is no partition table on this file; the clean bill of health is about one sgdisk `
      + `made up.`,
    )
  }
  const complaints = output.split('\n')
    .filter(l => /Caution|Warning/.test(l))
    .filter(l => !/doesn't (begin|end) on a|degraded performance/.test(l))
  const clean = output.includes('No problems found')
    && !/problems!|Problem:|invalid GPT|damaged GPT/.test(output)
    && complaints.length === 0
  return { clean, output, complaints }
}

// ---------------------------------------------------------------------------
// 2. the FAT boot slots, with mtools AT AN OFFSET
// ---------------------------------------------------------------------------

/** A FAT filesystem living at a byte offset inside a larger image. */
export interface FatSlot {
  readonly image: string
  readonly offsetBytes: number
}

function mtoolsTarget(slot: FatSlot): string {
  requireWholeNumbers({ 'the FAT slot offset': slot.offsetBytes })
  // mtools' own syntax for "the filesystem starts here": image@@offset. No
  // extraction, no temp file, and no second copy of the offset arithmetic.
  return `${slot.image}@@${slot.offsetBytes}`
}

async function mtool(
  rt: ToolRuntime,
  argv: readonly string[],
  slot: FatSlot,
  what: string,
  options?: RunOptions,
): Promise<string> {
  const r = await rt.run([...MTOOLS_ENV, ...argv], {
    context: `${what} in the FAT at offset ${slot.offsetBytes} of ${slot.image}`,
    ...options,
  })
  // mtools is honest about a bad offset -- "init :: non DOS media", exit 1 --
  // so the status carries it. What it is not honest about is WHICH offset, so
  // the context above supplies it: the same message appears for a slot that is
  // simply empty, and those are different edits.
  return r.stdout
}

/** The volume label, as `mlabel -s` reports it, trailing padding removed. */
export async function fatVolumeLabel(rt: ToolRuntime, slot: FatSlot): Promise<string> {
  const out = await mtool(rt, ['mlabel', '-s', '-i', mtoolsTarget(slot), '::'], slot, 'reading the volume label')
  const line = /^ *Volume label is (.*?) *$/m.exec(out)
  if (line === null) {
    // "Volume has no label" is a real answer and is returned as the empty
    // string; anything else means mlabel printed something this does not know.
    if (/has no label/.test(out)) return ''
    throw new ToolOutputError(
      `mlabel -s on the FAT at offset ${slot.offsetBytes} of ${slot.image} exited 0 and printed `
      + `neither a volume label nor "has no label":\n${out.trim() || '(nothing)'}`,
    )
  }
  return line[1] ?? ''
}

/**
 * Every path in the slot, recursively, as `::/name` -- `mdir -/ -b`'s own form.
 *
 * An empty listing is returned as an empty array rather than refused: a boot
 * slot with nothing in it is a thing a check must be able to observe and fail.
 */
export async function fatList(rt: ToolRuntime, slot: FatSlot): Promise<string[]> {
  const out = await mtool(rt, ['mdir', '-/', '-b', '-i', mtoolsTarget(slot), '::/'], slot, 'listing')
  return out.split('\n').map(l => l.trimEnd()).filter(l => l.startsWith('::'))
}

/**
 * Copy one file out of the slot and hand back its bytes.
 *
 * mcopy exits 1 and says `File "::/x" not found` for a path that is not there,
 * which is the one tool in this file that reports an absence honestly -- so an
 * absence throws, and `fatTryRead` is the way to ask a question that tolerates
 * one.
 */
export async function fatReadFile(rt: ToolRuntime, slot: FatSlot, path: string): Promise<string> {
  const target = path.startsWith('::') ? path : `::/${path.replace(/^\/+/, '')}`
  const out = await mtool(rt, ['mcopy', '-n', '-i', mtoolsTarget(slot), target, '-'], slot, `reading ${path}`)
  return out
}

/** The same read, with "it is not there" as an answer rather than a throw. */
export async function fatTryReadFile(
  rt: ToolRuntime,
  slot: FatSlot,
  path: string,
): Promise<string | undefined> {
  const target = path.startsWith('::') ? path : `::/${path.replace(/^\/+/, '')}`
  const r = await rt.run([...MTOOLS_ENV, 'mcopy', '-n', '-i', mtoolsTarget(slot), target, '-'], {
    context: `reading ${path} from the FAT at offset ${slot.offsetBytes} of ${slot.image}`,
    allow: [1],
  })
  if (r.code === 0) return r.stdout
  if (/not found/.test(r.stderr)) return undefined
  // Exit 1 for a reason that is NOT absence -- a bad offset, an unreadable
  // image -- must not be reported as absence. Same shape as veritysetup below.
  throw new ToolOutputError(
    `mcopy could not read ${path} from the FAT at offset ${slot.offsetBytes} of ${slot.image}, and `
    + `not because it is absent:\n  ${r.stderr.trim() || '(no stderr)'}\n`
    + `  Returning "absent" here would turn a broken read into a fact about the image.`,
  )
}

// ---------------------------------------------------------------------------
// 3. the ext4 partitions, with tune2fs and debugfs over an extracted range
// ---------------------------------------------------------------------------

/** e2fsprogs put their version banner on stderr and nothing else, when well. */
const E2FS_BANNER = /^(debugfs|tune2fs|dumpe2fs|e2fsck) \d+\.\d+/

export interface Ext4Super {
  readonly file: string
  /** Every `Key: value` line, keys exactly as e2fsprogs spells them. */
  readonly fields: ReadonlyMap<string, string>
  readonly volumeName: string
  readonly uuid: string
  readonly blockSize: number
  readonly blockCount: number
  readonly features: readonly string[]
  readonly state: string
  get: (key: string) => string | undefined
}

/** `tune2fs -l`, refused unless it actually opened a filesystem. */
export async function ext4Super(rt: ToolRuntime, file: string): Promise<Ext4Super> {
  const r = await rt.run(['tune2fs', '-l', file], { context: `reading the ext4 superblock of ${file}` })
  const fields = new Map<string, string>()
  for (const line of r.stdout.split('\n')) {
    const m = /^([A-Za-z][^:]*):\s{2,}(.*?)\s*$/.exec(line)
    if (m !== null && m[1] !== undefined) fields.set(m[1], m[2] ?? '')
  }
  const magic = fields.get('Filesystem magic number')
  if (magic !== '0xEF53') {
    throw new ToolOutputError(
      `tune2fs -l ${file} exited 0 but its "Filesystem magic number" is ${magic ?? 'absent'}, not `
      + `0xEF53. Whatever it read, it was not an ext4 superblock.`,
    )
  }
  const get = (key: string): string | undefined => fields.get(key)
  return {
    file,
    fields,
    volumeName: get('Filesystem volume name') ?? '',
    uuid: get('Filesystem UUID') ?? '',
    blockSize: Number(get('Block size') ?? Number.NaN),
    blockCount: Number(get('Block count') ?? Number.NaN),
    features: (get('Filesystem features') ?? '').split(/\s+/).filter(f => f !== ''),
    state: get('Filesystem state') ?? '',
    get,
  }
}

/**
 * Run one debugfs command and hand back its stdout.
 *
 * THE STDERR RULE, and why it is the whole check. debugfs exits 0 whether or
 * not it opened the filesystem -- measured: `debugfs -R "ls -p /"` on a file
 * that is not ext4 exits 0 with empty stdout. What differs is stderr: on a
 * filesystem it opened, stderr is EXACTLY the one-line version banner; on one
 * it did not, the banner is followed by "...while trying to open FILE" and
 * "ls: Filesystem not open". So the rule is: one line of stderr, and it is the
 * banner. Any second line is a refusal, quoted.
 */
export async function debugfsRun(rt: ToolRuntime, file: string, command: string): Promise<string> {
  const r = await rt.run(['debugfs', '-R', command, file], {
    context: `debugfs -R "${command}" on ${file}`,
  })
  const noise = r.stderr.split('\n').map(l => l.trim()).filter(l => l !== '' && !E2FS_BANNER.test(l))
  if (noise.length > 0) {
    throw new ToolOutputError(
      `debugfs -R "${command}" ${file} EXITED 0 and complained:\n`
      + noise.map(l => `    ${l}`).join('\n')
      + `\n  debugfs exits 0 whether or not it opened the filesystem, so the status says nothing. `
      + `Its stderr is the whole answer, and this one is not the version banner alone.`,
    )
  }
  return r.stdout
}

export interface Ext4Entry {
  readonly inode: number
  /** Octal, as `ls -p` prints it: `040755`. */
  readonly mode: string
  readonly uid: number
  readonly gid: number
  readonly name: string
}

/** `ls -p DIR`, parsed. Always contains `.` and `..` on a real ext4. */
export async function ext4List(rt: ToolRuntime, file: string, dir: string): Promise<Ext4Entry[]> {
  const out = await debugfsRun(rt, file, `ls -p ${dir}`)
  const entries: Ext4Entry[] = []
  for (const line of out.split('\n')) {
    // /inode/mode/uid/gid/name/size/
    const parts = line.split('/')
    if (parts.length < 6 || parts[1] === undefined || !/^\d+$/.test(parts[1])) continue
    entries.push({
      inode: Number(parts[1]),
      mode: parts[2] ?? '',
      uid: Number(parts[3] ?? Number.NaN),
      gid: Number(parts[4] ?? Number.NaN),
      name: parts[5] ?? '',
    })
  }
  if (entries.length === 0) {
    throw new ToolOutputError(
      `debugfs listed ${dir} in ${file} and produced no entries at all, not even "." and "..". `
      + `Every directory on a mounted-able ext4 has those two; a listing without them is a listing `
      + `of nothing, and read as data it makes an "is X absent?" check pass.`,
    )
  }
  return entries
}

/** `stat PATH`, as a field map. `undefined` when the path is not in the tree. */
export async function ext4Stat(
  rt: ToolRuntime,
  file: string,
  path: string,
): Promise<Map<string, string> | undefined> {
  const r = await rt.run(['debugfs', '-R', `stat ${path}`, file], {
    context: `debugfs -R "stat ${path}" on ${file}`,
  })
  const noise = r.stderr.split('\n').map(l => l.trim()).filter(l => l !== '' && !E2FS_BANNER.test(l))
  // "File not found by ext2_lookup" is the answer "it is not there"; anything
  // else on stderr is the tool failing, and the two must not be one value.
  if (noise.length > 0) {
    if (noise.every(l => /File not found by ext2_lookup|stat: File not found/.test(l))) return undefined
    throw new ToolOutputError(
      `debugfs -R "stat ${path}" ${file} complained about something other than the path:\n`
      + noise.map(l => `    ${l}`).join('\n'),
    )
  }
  const fields = new Map<string, string>()
  for (const m of r.stdout.matchAll(/(\w[\w ]*?):\s+(\S+)/g)) {
    if (m[1] !== undefined && !fields.has(m[1])) fields.set(m[1], m[2] ?? '')
  }
  if (fields.size === 0) return undefined
  return fields
}

// ---------------------------------------------------------------------------
// 4. the packed root, with unsquashfs
// ---------------------------------------------------------------------------

export interface SquashfsSuper {
  readonly file: string
  readonly version: string
  readonly sizeBytes: number
  readonly compression: string
  readonly blockSize: number
}

/** `unsquashfs -s`. Exits 1 and says so on anything that is not a squashfs. */
export async function squashfsSuper(rt: ToolRuntime, file: string): Promise<SquashfsSuper> {
  const r = await rt.run(['unsquashfs', '-s', file], { context: `reading the squashfs superblock of ${file}` })
  const version = /Found a valid SQUASHFS (\S+) superblock/.exec(r.stdout)?.[1]
  if (version === undefined) {
    throw new ToolOutputError(
      `unsquashfs -s ${file} exited 0 without reporting a valid superblock:\n${r.stdout.trim() || '(nothing)'}`,
    )
  }
  return {
    file,
    version,
    sizeBytes: intAfter(r.stdout, /^Filesystem size (\d+) bytes/m, 'Filesystem size', file),
    compression: strAfter(r.stdout, /^Compression (\S+)/m, 'Compression', file),
    blockSize: intAfter(r.stdout, /^Block size (\d+)/m, 'Block size', file),
  }
}

/**
 * Unpack `paths` (or the whole archive) into `dest`, and PROVE each one landed.
 *
 * Measured: `unsquashfs -d DEST ARCHIVE nope/nothing` exits 0 and leaves DEST
 * empty. So a caller asking for three files and getting none would read three
 * absences out of one silent failure -- and "absent from the image" is exactly
 * what several checks in the oracle assert. Each requested path is therefore
 * asserted present under DEST afterwards, by name.
 */
export async function squashfsExtract(
  rt: ToolRuntime,
  file: string,
  dest: string,
  paths?: readonly string[],
): Promise<string> {
  if (existsSync(dest)) {
    throw new ToolOutputError(
      `${dest} already exists. unsquashfs merges into an existing directory, so a second extract `
      + `into the same place would hand back a tree that is partly the previous one -- and every `
      + `"is this file in the image?" check below would then be about the wrong image.`,
    )
  }
  const wanted = (paths ?? []).map(p => p.replace(/^\/+/, ''))
  await rt.run(['unsquashfs', '-n', '-xattrs', '-q', '-d', dest, file, ...wanted], {
    context: `unpacking ${file}${wanted.length > 0 ? ` (${wanted.join(' ')})` : ''}`,
  })
  // lstat, NOT existsSync. Driven against the real cx3576 image on 2026-08-25:
  // `etc/os-release` in the packed root is a symlink to `../usr/lib/os-release`,
  // and asking for it alone extracts the LINK without its target. existsSync
  // follows the link, finds nothing at the other end and reports the path as
  // unextracted -- a refusal about a file that is right there, which is the
  // mirror image of the swallow this guard exists to prevent and just as wrong.
  // What the guard is asking is "did unsquashfs put something at this path",
  // and lstat is the call that answers that question.
  const lost = wanted.filter(p => !extracted(join(dest, p)))
  if (lost.length > 0) {
    throw new ToolOutputError(
      `unsquashfs exited 0 and did not extract ${lost.join(', ')} from ${file}.\n`
      + `  It exits 0 for a path that is not in the archive, so the status said nothing. Whether `
      + `those paths are absent from the IMAGE is a question for a check; it is not something this `
      + `helper may answer by handing back an empty directory.`,
    )
  }
  if (wanted.length === 0 && !existsSync(dest)) {
    throw new ToolOutputError(`unsquashfs exited 0 and created no ${dest} at all from ${file}.`)
  }
  return dest
}

/** Every path in the archive, as `unsquashfs -l` prints them, `squashfs-root` stripped. */
export async function squashfsList(rt: ToolRuntime, file: string): Promise<string[]> {
  const r = await rt.run(['unsquashfs', '-l', file], { context: `listing ${file}` })
  const paths = r.stdout.split('\n')
    .filter(l => l.startsWith('squashfs-root'))
    .map(l => l.slice('squashfs-root'.length))
    .filter(l => l !== '')
  if (paths.length === 0) {
    throw new ToolOutputError(
      `unsquashfs -l ${file} exited 0 and listed nothing under squashfs-root. An empty listing `
      + `makes every "is X in the image?" check answer no.`,
    )
  }
  return paths
}

// ---------------------------------------------------------------------------
// 5. dm-verity, in userspace
// ---------------------------------------------------------------------------

export type VerityVerdict = 'verified' | 'mismatch'

export interface VerityRequest {
  readonly dataFile: string
  readonly hashFile: string
  readonly rootHash: string
  readonly hashOffset: number
}

/**
 * `veritysetup verify`, which walks the hash tree in USERSPACE.
 *
 * It never creates a device-mapper target, never calls losetup and never mounts
 * anything -- which is what makes it safe against a host, and it is the reason
 * the oracle chose it (os/verify-image-v2.sh:2190).
 *
 * BOTH ANSWERS EXIT 1, AND ONLY ONE OF THEM IS AN ANSWER. Measured:
 *   "Verification of root hash failed."          -> exit 1, the failing DIRECTION
 *   "Device X is not a valid VERITY device."     -> exit 1, the tool got nowhere
 * Mapping status 1 to `mismatch` would report a corrupt payload for a
 * mis-computed hash offset, and mis-computed offsets are the likeliest defect
 * in a port that is re-deriving them from a board definition.
 */
export async function verityVerify(rt: ToolRuntime, req: VerityRequest): Promise<VerityVerdict> {
  requireWholeNumbers({ 'the verity hash offset': req.hashOffset })
  if (!/^[0-9a-fA-F]{32,128}$/.test(req.rootHash)) {
    throw new ToolOutputError(
      `'${req.rootHash}' is not a root hash. veritysetup would refuse it, at exit 1, in the same `
      + `breath it uses to say a payload does not verify.`,
    )
  }
  const r = await rt.run(
    ['veritysetup', 'verify', req.dataFile, req.hashFile, req.rootHash, `--hash-offset=${req.hashOffset}`],
    { context: `verifying ${req.dataFile} against ${req.rootHash}`, allow: [1] },
  )
  if (r.code === 0) return 'verified'
  const said = `${r.stdout}${r.stderr}`
  if (/Verification of root hash failed/.test(said)) return 'mismatch'
  throw new ToolOutputError(
    `veritysetup verify exited 1 for a reason that is NOT a hash mismatch:\n`
    + `    ${said.trim().split('\n').join('\n    ') || '(no output)'}\n`
    + `  data=${req.dataFile} hash=${req.hashFile} --hash-offset=${req.hashOffset}\n`
    + `  Reporting this as "mismatch" would blame the image for a wrong offset or an unreadable file.`,
  )
}

// ---------------------------------------------------------------------------

/** True when SOMETHING is at `path`, dangling symlink included. */
function extracted(path: string): boolean {
  try {
    lstatSync(path)
    return true
  }
  catch {
    return false
  }
}

function refuse(what: string, image: string, output: string): never {
  throw new ToolOutputError(
    `could not read ${what} out of the tool's output for ${image}. It exited 0, so this is a `
    + `format this parser does not know rather than a failure it swallowed:\n`
    + output.trim().split('\n').slice(0, 12).map(l => `    ${l}`).join('\n'),
  )
}

function strAfter(output: string, pattern: RegExp, what: string, image: string): string {
  const value = pattern.exec(output)?.[1]
  if (value === undefined || value === '') refuse(what, image, output)
  return value
}

function intAfter(output: string, pattern: RegExp, what: string, image: string): number {
  const value = Number(strAfter(output, pattern, what, image))
  if (!Number.isSafeInteger(value)) refuse(what, image, output)
  return value
}
